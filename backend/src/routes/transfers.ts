import { BlobNotFoundError, del, get } from '@vercel/blob'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { RelayConfig } from '../config.js'
import { readJsonBody, sendJson } from '../http/json.js'
import { normalizePathname } from '../http/pathname.js'
import type { RelayLogger } from '../services/relay-logger.js'
import {
  parseRelayFileDeleteRequest,
  parseRelayTransferCancelRequest,
} from '../validators/transfers.js'

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

    const fileMatch = pathname.match(
      /^\/api\/transfers\/([^/]+)\/files\/([^/]+)$/
    )

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
          error:
            'The requested Blob pathname does not match this transfer file.',
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
          error:
            'The acknowledged Blob pathname does not match this transfer file.',
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
