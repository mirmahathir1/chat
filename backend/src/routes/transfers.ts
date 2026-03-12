import { BlobNotFoundError, del, get } from '@vercel/blob'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { RelayConfig } from '../config.js'
import type { RelayLogger } from '../services/relay-logger.js'
import type {
  RelayFileDeleteRequest,
  RelayTransferCancelRequest,
} from '../types/relay.js'

interface TransfersRouteDeps {
  config: RelayConfig
  logger: RelayLogger
}

type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
) => Promise<boolean>

export function createTransfersRouteHandler(
  deps: TransfersRouteDeps
): RequestHandler {
  return async (req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = normalizePathname(url.pathname)

    const uploadTokenMatch = pathname.match(
      /^\/api\/transfers\/([^/]+)\/files\/([^/]+)\/upload-token$/
    )

    if (method === 'POST' && uploadTokenMatch) {
      ensureBlobTokenConfigured()

      const transferId = uploadTokenMatch[1]!
      const fileId = uploadTokenMatch[2]!
      const payload = (await readJsonBody(req, 64 * 1024)) as HandleUploadBody
      const result = await handleUpload({
        body: payload,
        onBeforeGenerateToken: async (nextPathname) => {
          if (!isRelayBlobPathname(transferId, fileId, nextPathname)) {
            throw new Error(
              'Relay uploads must target the expected transfer file prefix.'
            )
          }

          return {
            addRandomSuffix: false,
            allowOverwrite: false,
            maximumSizeInBytes: deps.config.maxFileBytes,
            validUntil: Date.now() + deps.config.sessionTtlMs,
          }
        },
        request: req,
      })

      sendJson(res, 200, result)
      return true
    }

    const fileMatch = pathname.match(/^\/api\/transfers\/([^/]+)\/files\/([^/]+)$/)

    if (fileMatch && method === 'GET') {
      ensureBlobTokenConfigured()

      const transferId = fileMatch[1]!
      const fileId = fileMatch[2]!
      const blobPathname = url.searchParams.get('pathname')?.trim() ?? ''

      if (!blobPathname) {
        sendJson(res, 400, {
          error: 'File download requests must include a pathname query value.',
        })

        return true
      }

      if (!isRelayBlobPathname(transferId, fileId, blobPathname)) {
        sendJson(res, 400, {
          error: 'The requested Blob pathname does not match this transfer file.',
        })

        return true
      }

      const blobResult = await get(blobPathname, {
        access: 'private',
        useCache: false,
      })

      if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
        sendJson(res, 404, {
          error: 'Relay file was not found.',
        })

        return true
      }

      res.writeHead(200, {
        'Content-Disposition': blobResult.blob.contentDisposition,
        'Content-Length': String(blobResult.blob.size),
        'Content-Type': blobResult.blob.contentType,
        ETag: blobResult.blob.etag,
      })

      await streamToNodeResponse(blobResult.stream, res)
      deps.logger.debug('Relay file downloaded.', {
        fileId,
        pathname: blobPathname,
        transferId,
      })

      return true
    }

    const ackMatch = pathname.match(
      /^\/api\/transfers\/([^/]+)\/files\/([^/]+)\/ack$/
    )

    if (ackMatch && method === 'POST') {
      ensureBlobTokenConfigured()

      const transferId = ackMatch[1]!
      const fileId = ackMatch[2]!
      const payload = await readJsonBody(req, 16 * 1024)
      const parsed = parseRelayFileDeleteRequest(payload)

      if (!parsed.ok) {
        sendJson(res, 400, {
          error: parsed.error,
        })

        return true
      }

      if (!isRelayBlobPathname(transferId, fileId, parsed.value.pathname)) {
        sendJson(res, 400, {
          error: 'The acknowledged Blob pathname does not match this transfer file.',
        })

        return true
      }

      await deleteRelayBlob(parsed.value.pathname)

      sendJson(res, 200, {
        fileId,
        status: 'acknowledged',
        transferId,
      })

      return true
    }

    const cancelMatch = pathname.match(/^\/api\/transfers\/([^/]+)\/cancel$/)

    if (cancelMatch && method === 'POST') {
      ensureBlobTokenConfigured()

      const transferId = cancelMatch[1]!
      const payload = await readJsonBody(req, 64 * 1024)
      const parsed = parseRelayTransferCancelRequest(payload)

      if (!parsed.ok) {
        sendJson(res, 400, {
          error: parsed.error,
        })

        return true
      }

      const validPathnames = parsed.value.pathnames.filter((pathnameValue) =>
        isRelayTransferPathname(transferId, pathnameValue)
      )

      const deletedCount = await deleteRelayBlobs(validPathnames)

      sendJson(res, 200, {
        deletedCount,
        reason: parsed.value.reason ?? null,
        status: 'cancelled',
        transferId,
      })

      return true
    }

    return false
  }
}

function buildRelayTransferPrefix(transferId: string) {
  return `relay/transfers/${transferId}/`
}

function buildRelayBlobPrefix(transferId: string, fileId: string) {
  return `${buildRelayTransferPrefix(transferId)}files/${fileId}/`
}

function isRelayTransferPathname(transferId: string, pathname: string) {
  return pathname.startsWith(buildRelayTransferPrefix(transferId))
}

function isRelayBlobPathname(
  transferId: string,
  fileId: string,
  pathname: string
) {
  return pathname.startsWith(buildRelayBlobPrefix(transferId, fileId))
}

function ensureBlobTokenConfigured() {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return
  }

  throw new Error(
    'BLOB_READ_WRITE_TOKEN is not configured for the relay backend.'
  )
}

async function deleteRelayBlob(pathname: string) {
  try {
    await del(pathname)
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return
    }

    throw error
  }
}

async function deleteRelayBlobs(pathnames: string[]) {
  let deletedCount = 0

  for (const pathname of pathnames) {
    await deleteRelayBlob(pathname)
    deletedCount += 1
  }

  return deletedCount
}

async function streamToNodeResponse(
  stream: ReadableStream<Uint8Array>,
  res: ServerResponse<IncomingMessage>
) {
  await new Promise<void>((resolve, reject) => {
    const readable = Readable.fromWeb(
      stream as unknown as NodeReadableStream<Uint8Array>
    )

    readable.on('error', reject)
    res.on('close', resolve)
    res.on('error', reject)
    res.on('finish', resolve)
    readable.pipe(res)
  })
}

function parseRelayFileDeleteRequest(
  value: unknown
):
  | {
      ok: true
      value: RelayFileDeleteRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!value || typeof value !== 'object') {
    return {
      error: 'Relay file acknowledgement must be a JSON object.',
      ok: false,
    }
  }

  const pathname = (value as { pathname?: unknown }).pathname

  if (typeof pathname !== 'string' || pathname.trim() === '') {
    return {
      error: 'Relay file acknowledgement must include a pathname.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      pathname: pathname.trim(),
    },
  }
}

function parseRelayTransferCancelRequest(
  value: unknown
):
  | {
      ok: true
      value: Required<Pick<RelayTransferCancelRequest, 'pathnames'>> &
        RelayTransferCancelRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!value || typeof value !== 'object') {
    return {
      error: 'Relay transfer cancellation must be a JSON object.',
      ok: false,
    }
  }

  const pathnames = (value as { pathnames?: unknown }).pathnames
  const peerId = (value as { peerId?: unknown }).peerId
  const reason = (value as { reason?: unknown }).reason

  if (
    pathnames !== undefined &&
    (!Array.isArray(pathnames) ||
      pathnames.some(
        (pathname) => typeof pathname !== 'string' || pathname.trim() === ''
      ))
  ) {
    return {
      error: 'pathnames must be an array of non-empty strings when provided.',
      ok: false,
    }
  }

  if (
    peerId !== undefined &&
    (typeof peerId !== 'string' || peerId.trim() === '')
  ) {
    return {
      error: 'peerId must be a non-empty string when provided.',
      ok: false,
    }
  }

  if (
    reason !== undefined &&
    reason !== null &&
    (typeof reason !== 'string' || reason.trim() === '')
  ) {
    return {
      error: 'reason must be a non-empty string when provided.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      pathnames: (pathnames ?? []).map((pathname) => pathname.trim()),
      peerId: typeof peerId === 'string' ? peerId.trim() : undefined,
      reason: typeof reason === 'string' ? reason.trim() : undefined,
    },
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes: number) {
  const body = await readBufferBody(req, maxBytes)

  if (body.byteLength === 0) {
    return {}
  }

  return JSON.parse(body.toString('utf8')) as unknown
}

async function readBufferBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    totalBytes += buffer.byteLength

    if (totalBytes > maxBytes) {
      throw new Error(`Request body exceeded ${maxBytes} bytes.`)
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks, totalBytes)
}

function normalizePathname(pathname: string) {
  if (pathname === '/') {
    return pathname
  }

  return pathname.replace(/\/+$/, '')
}

function sendJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown
) {
  const body = Buffer.from(JSON.stringify(payload))

  res.writeHead(statusCode, {
    'Content-Length': body.byteLength,
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(body)
}
