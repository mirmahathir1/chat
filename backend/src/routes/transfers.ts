import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RelayConfig } from '../config.js'
import type { RelayLogger } from '../services/relay-logger.js'
import type {
  RelayChunkStore,
  RelaySessionStoreContract,
} from '../services/relay-store.js'
import type {
  CreateRelayTransferRequest,
  RelayChunkAckRequest,
  RelayCompleteTransferRequest,
  RelayFileDescriptor,
  RelayTransferCancelRequest,
} from '../types/relay.js'

interface TransfersRouteDeps {
  chunkStore: RelayChunkStore
  config: RelayConfig
  logger: RelayLogger
  sessionStore: RelaySessionStoreContract
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

    if (method === 'POST' && pathname === '/api/transfers') {
      const payload = await readJsonBody(req, 64 * 1024)
      const parsedRequest = parseCreateTransferRequest(payload)

      if (!parsedRequest.ok) {
        sendJson(res, 400, {
          error: parsedRequest.error,
        })

        return true
      }

      const session = deps.sessionStore.createSession(parsedRequest.value)

      deps.logger.info('Relay session created.', {
        recipientPeerId: session.recipientPeerId,
        roomId: session.roomId,
        senderPeerId: session.senderPeerId,
        totalBytes: session.totalBytes,
        transferId: session.transferId,
      })

      sendJson(res, 201, {
        endpoints: {
          ackPathTemplate: `/api/transfers/${session.transferId}/chunks/{chunkIndex}/ack`,
          cancelPath: `/api/transfers/${session.transferId}/cancel`,
          completePath: `/api/transfers/${session.transferId}/complete`,
          nextChunkPath: `/api/transfers/${session.transferId}/chunks/next`,
          uploadPathTemplate: `/api/transfers/${session.transferId}/chunks/{chunkIndex}`,
        },
        expiresAt: session.expiresAt,
        maxChunkBytes: deps.config.maxChunkBytes,
        pollIntervalMs: deps.config.pollIntervalMs,
        sessionId: session.sessionId,
        status: session.status,
        transferId: session.transferId,
      })

      return true
    }

    if (method === 'POST') {
      const uploadMatch = pathname.match(
        /^\/api\/transfers\/([^/]+)\/chunks\/(\d+)$/
      )

      if (uploadMatch) {
        const transferId = uploadMatch[1]!
        const chunkIndex = Number.parseInt(uploadMatch[2]!, 10)
        const sessionId = getRequiredHeader(req, 'x-relay-session-id')
        const senderPeerId = getRequiredHeader(req, 'x-relay-sender-peer-id')
        const fileId = getRequiredHeader(req, 'x-relay-file-id')
        const totalChunks = parseRequiredIntegerHeader(
          req,
          'x-relay-total-chunks'
        )

        if (!sessionId || !senderPeerId || !fileId || totalChunks === null) {
          sendJson(res, 400, {
            error:
              'Chunk upload requires x-relay-session-id, x-relay-sender-peer-id, x-relay-file-id, and x-relay-total-chunks headers.',
          })

          return true
        }

        const session = deps.sessionStore.getSession(transferId)

        if (!session) {
          sendJson(res, 404, {
            error: 'Relay session was not found.',
          })

          return true
        }

        if (session.status === 'expired' || session.status === 'cancelled') {
          sendJson(res, 410, {
            error: `Relay session is ${session.status}.`,
          })

          return true
        }

        if (session.status === 'completed') {
          sendJson(res, 409, {
            error: 'Relay session has already been completed.',
          })

          return true
        }

        if (session.sessionId !== sessionId || session.senderPeerId !== senderPeerId) {
          sendJson(res, 403, {
            error: 'Sender does not match the active relay session.',
          })

          return true
        }

        if (!session.files.some((file) => file.id === fileId)) {
          sendJson(res, 400, {
            error: 'Chunk references a file that is not part of the relay session.',
          })

          return true
        }

        const contentType = getHeaderValue(req, 'content-type')

        if (
          contentType &&
          !contentType.toLowerCase().startsWith('application/octet-stream')
        ) {
          sendJson(res, 415, {
            error: 'Chunk uploads must use application/octet-stream.',
          })

          return true
        }

        const body = await readBufferBody(req, deps.config.maxChunkBytes)

        if (body.byteLength === 0) {
          sendJson(res, 400, {
            error: 'Chunk uploads must include a non-empty request body.',
          })

          return true
        }

        const storedChunk = deps.chunkStore.storeChunk({
          chunkIndex,
          fileId,
          payload: body,
          recipientPeerId: session.recipientPeerId,
          senderPeerId,
          sessionId,
          totalChunks,
          transferId,
        })

        deps.sessionStore.touchSession(transferId)
        deps.logger.debug('Relay chunk stored.', {
          chunkIndex,
          fileId,
          sizeBytes: storedChunk.sizeBytes,
          transferId,
        })

        sendJson(res, 201, {
          chunkIndex: storedChunk.chunkIndex,
          expiresAt: storedChunk.expiresAt,
          sizeBytes: storedChunk.sizeBytes,
          status: 'stored',
          transferId,
        })

        return true
      }

      const ackMatch = pathname.match(
        /^\/api\/transfers\/([^/]+)\/chunks\/(\d+)\/ack$/
      )

      if (ackMatch) {
        const transferId = ackMatch[1]!
        const chunkIndex = Number.parseInt(ackMatch[2]!, 10)
        const payload = await readJsonBody(req, 16 * 1024)
        const parsedAck = parseChunkAckRequest(payload)

        if (!parsedAck.ok) {
          sendJson(res, 400, {
            error: parsedAck.error,
          })

          return true
        }

        const session = deps.sessionStore.getSession(transferId)

        if (!session) {
          sendJson(res, 404, {
            error: 'Relay session was not found.',
          })

          return true
        }

        if (
          session.sessionId !== parsedAck.value.sessionId ||
          session.recipientPeerId !== parsedAck.value.peerId
        ) {
          sendJson(res, 403, {
            error: 'Recipient does not match the active relay session.',
          })

          return true
        }

        const acknowledgedChunk = deps.chunkStore.acknowledgeChunk(
          transferId,
          parsedAck.value.fileId,
          chunkIndex
        )

        if (!acknowledgedChunk) {
          sendJson(res, 404, {
            error: 'Chunk was not found or has already been acknowledged.',
          })

          return true
        }

        deps.sessionStore.touchSession(transferId)
        deps.logger.debug('Relay chunk acknowledged.', {
          chunkIndex,
          fileId: parsedAck.value.fileId,
          pendingChunks: deps.chunkStore.countPendingChunks(transferId),
          transferId,
        })

        sendJson(res, 200, {
          chunkIndex,
          pendingChunks: deps.chunkStore.countPendingChunks(transferId),
          status: 'acknowledged',
          transferId,
        })

        return true
      }

      const completeMatch = pathname.match(/^\/api\/transfers\/([^/]+)\/complete$/)

      if (completeMatch) {
        const transferId = completeMatch[1]!
        const payload = await readJsonBody(req, 8 * 1024)
        const parsedRequest = parseCompleteTransferRequest(payload)

        if (!parsedRequest.ok) {
          sendJson(res, 400, {
            error: parsedRequest.error,
          })

          return true
        }

        const session = deps.sessionStore.getSession(transferId)

        if (!session) {
          sendJson(res, 404, {
            error: 'Relay session was not found.',
          })

          return true
        }

        if (
          session.sessionId !== parsedRequest.value.sessionId ||
          session.senderPeerId !== parsedRequest.value.peerId
        ) {
          sendJson(res, 403, {
            error: 'Sender does not match the active relay session.',
          })

          return true
        }

        const nextSession = deps.sessionStore.markCompleted(transferId)
        deps.logger.info('Relay transfer completed.', {
          pendingChunks: deps.chunkStore.countPendingChunks(transferId),
          transferId,
        })

        sendJson(res, 200, {
          expiresAt: nextSession.expiresAt,
          pendingChunks: deps.chunkStore.countPendingChunks(transferId),
          status: nextSession.status,
          transferId,
        })

        return true
      }

      const cancelMatch = pathname.match(/^\/api\/transfers\/([^/]+)\/cancel$/)

      if (cancelMatch) {
        const transferId = cancelMatch[1]!
        const payload = await readJsonBody(req, 16 * 1024)
        const parsedRequest = parseCancelTransferRequest(payload)

        if (!parsedRequest.ok) {
          sendJson(res, 400, {
            error: parsedRequest.error,
          })

          return true
        }

        const session = deps.sessionStore.getSession(transferId)

        if (!session) {
          sendJson(res, 404, {
            error: 'Relay session was not found.',
          })

          return true
        }

        const isParticipant =
          session.sessionId === parsedRequest.value.sessionId &&
          (session.senderPeerId === parsedRequest.value.peerId ||
            session.recipientPeerId === parsedRequest.value.peerId)

        if (!isParticipant) {
          sendJson(res, 403, {
            error: 'Only transfer participants can cancel a relay session.',
          })

          return true
        }

        deps.chunkStore.deleteTransferChunks(transferId)
        const cancelledSession = deps.sessionStore.markCancelled(
          transferId,
          parsedRequest.value.reason
        )
        deps.logger.info('Relay transfer cancelled.', {
          reason: cancelledSession.cancelReason ?? null,
          transferId,
        })

        sendJson(res, 200, {
          reason: cancelledSession.cancelReason ?? null,
          status: cancelledSession.status,
          transferId,
        })

        return true
      }
    }

    if (method === 'GET') {
      const nextChunkMatch = pathname.match(
        /^\/api\/transfers\/([^/]+)\/chunks\/next$/
      )

      if (nextChunkMatch) {
        const transferId = nextChunkMatch[1]!
        const sessionId = url.searchParams.get('sessionId')
        const peerId = url.searchParams.get('peerId')
        const after = parseInteger(url.searchParams.get('after'))

        if (!sessionId || !peerId || after === null) {
          sendJson(res, 400, {
            error: 'Polling requires sessionId, peerId, and numeric after query parameters.',
          })

          return true
        }

        const session = deps.sessionStore.getSession(transferId)

        if (!session) {
          sendJson(res, 404, {
            error: 'Relay session was not found.',
          })

          return true
        }

        if (session.sessionId !== sessionId || session.recipientPeerId !== peerId) {
          sendJson(res, 403, {
            error: 'Recipient does not match the active relay session.',
          })

          return true
        }

        if (session.status === 'expired' || session.status === 'cancelled') {
          sendJson(res, 410, {
            error: `Relay session is ${session.status}.`,
          })

          return true
        }

        const nextChunk = deps.chunkStore.getNextChunk(
          transferId,
          session.recipientPeerId,
          after
        )

        if (!nextChunk) {
          deps.logger.debug('Relay poll returned idle.', {
            after,
            transferId,
            transferState: session.status,
          })
          res.writeHead(204, {
            'x-relay-transfer-state': session.status,
          })
          res.end()

          return true
        }

        deps.sessionStore.touchSession(transferId)
        deps.logger.debug('Relay chunk served to recipient.', {
          chunkIndex: nextChunk.metadata.chunkIndex,
          fileId: nextChunk.metadata.fileId,
          recipientPeerId: session.recipientPeerId,
          transferId,
        })

        res.writeHead(200, {
          'Content-Length': nextChunk.payload.byteLength,
          'Content-Type': 'application/octet-stream',
          'x-relay-chunk-bytes': String(nextChunk.metadata.sizeBytes),
          'x-relay-chunk-index': String(nextChunk.metadata.chunkIndex),
          'x-relay-expires-at': nextChunk.metadata.expiresAt,
          'x-relay-file-id': nextChunk.metadata.fileId,
          'x-relay-total-chunks': String(nextChunk.metadata.totalChunks),
          'x-relay-transfer-state': session.status,
        })
        res.end(nextChunk.payload)

        return true
      }
    }

    return false
  }
}

function normalizePathname(pathname: string) {
  if (pathname === '/') {
    return pathname
  }

  return pathname.replace(/\/+$/, '')
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

  return Buffer.concat(chunks)
}

function parseCreateTransferRequest(
  value: unknown
):
  | {
      ok: true
      value: CreateRelayTransferRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!isRecord(value)) {
    return {
      error: 'Transfer creation requires a JSON object body.',
      ok: false,
    }
  }

  const { roomId, senderPeerId, recipientPeerId, totalBytes, files } = value

  if (!isNonEmptyString(roomId)) {
    return {
      error: 'roomId is required.',
      ok: false,
    }
  }

  if (!isNonEmptyString(senderPeerId)) {
    return {
      error: 'senderPeerId is required.',
      ok: false,
    }
  }

  if (!isNonEmptyString(recipientPeerId)) {
    return {
      error: 'recipientPeerId is required.',
      ok: false,
    }
  }

  if (!Array.isArray(files) || files.length === 0) {
    return {
      error: 'files must be a non-empty array.',
      ok: false,
    }
  }

  const parsedFiles: RelayFileDescriptor[] = []

  for (const file of files) {
    const parsedFile = parseFileDescriptor(file)

    if (!parsedFile.ok) {
      return parsedFile
    }

    parsedFiles.push(parsedFile.value)
  }

  if (typeof totalBytes !== 'number' || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return {
      error: 'totalBytes must be a positive number.',
      ok: false,
    }
  }

  const summedBytes = parsedFiles.reduce((sum, file) => sum + file.size, 0)

  if (summedBytes !== totalBytes) {
    return {
      error: 'totalBytes must equal the sum of file sizes.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      files: parsedFiles,
      recipientPeerId,
      roomId,
      senderPeerId,
      totalBytes,
    },
  }
}

function parseFileDescriptor(
  value: unknown
):
  | {
      ok: true
      value: RelayFileDescriptor
    }
  | {
      error: string
      ok: false
    } {
  if (!isRecord(value)) {
    return {
      error: 'Each file entry must be an object.',
      ok: false,
    }
  }

  if (!isNonEmptyString(value.id)) {
    return {
      error: 'Each file must include an id.',
      ok: false,
    }
  }

  if (!isNonEmptyString(value.name)) {
    return {
      error: 'Each file must include a name.',
      ok: false,
    }
  }

  if (
    typeof value.size !== 'number' ||
    !Number.isFinite(value.size) ||
    value.size <= 0
  ) {
    return {
      error: 'Each file must include a positive numeric size.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      id: value.id,
      name: value.name,
      size: value.size,
      type: typeof value.type === 'string' ? value.type : null,
    },
  }
}

function parseChunkAckRequest(
  value: unknown
):
  | {
      ok: true
      value: RelayChunkAckRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!isRecord(value)) {
    return {
      error: 'Chunk acknowledgement requires a JSON object body.',
      ok: false,
    }
  }

  if (!isNonEmptyString(value.sessionId)) {
    return {
      error: 'sessionId is required.',
      ok: false,
    }
  }

  if (!isNonEmptyString(value.peerId)) {
    return {
      error: 'peerId is required.',
      ok: false,
    }
  }

  if (!isNonEmptyString(value.fileId)) {
    return {
      error: 'fileId is required.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      fileId: value.fileId,
      peerId: value.peerId,
      sessionId: value.sessionId,
    },
  }
}

function parseCompleteTransferRequest(
  value: unknown
):
  | {
      ok: true
      value: RelayCompleteTransferRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!isRecord(value)) {
    return {
      error: 'Transfer completion requires a JSON object body.',
      ok: false,
    }
  }

  if (!isNonEmptyString(value.sessionId) || !isNonEmptyString(value.peerId)) {
    return {
      error: 'sessionId and peerId are required.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      peerId: value.peerId,
      sessionId: value.sessionId,
    },
  }
}

function parseCancelTransferRequest(
  value: unknown
):
  | {
      ok: true
      value: RelayTransferCancelRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!isRecord(value)) {
    return {
      error: 'Transfer cancellation requires a JSON object body.',
      ok: false,
    }
  }

  if (!isNonEmptyString(value.sessionId) || !isNonEmptyString(value.peerId)) {
    return {
      error: 'sessionId and peerId are required.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      peerId: value.peerId,
      reason: typeof value.reason === 'string' ? value.reason : undefined,
      sessionId: value.sessionId,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseInteger(value: string | null) {
  if (value === null || value.trim() === '') {
    return null
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isInteger(parsed) && parsed >= -1 ? parsed : null
}

function getRequiredHeader(req: IncomingMessage, headerName: string) {
  const header = getHeaderValue(req, headerName)

  return header && header.trim().length > 0 ? header.trim() : null
}

function parseRequiredIntegerHeader(
  req: IncomingMessage,
  headerName: string
) {
  const header = getRequiredHeader(req, headerName)

  if (!header) {
    return null
  }

  const parsed = Number.parseInt(header, 10)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function getHeaderValue(req: IncomingMessage, headerName: string) {
  const header = req.headers[headerName]

  if (typeof header === 'string') {
    return header
  }

  return header?.[0] ?? null
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
