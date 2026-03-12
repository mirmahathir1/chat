import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RelayRoomEventStore } from '../services/room-event-store.js'
import type { RelayLogger } from '../services/relay-logger.js'
import type {
  CreateRelayRoomEventRequest,
  RelayRoomEventMessage,
} from '../types/room-event.js'

interface RoomEventsRouteDeps {
  logger: RelayLogger
  roomEventStore: RelayRoomEventStore
}

type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
) => Promise<boolean>

export function createRoomEventsRouteHandler(
  deps: RoomEventsRouteDeps
): RequestHandler {
  return async (req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = normalizePathname(url.pathname)

    const cursorMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/events\/cursor$/)

    if (method === 'GET' && cursorMatch) {
      const roomId = cursorMatch[1]!

      sendJson(res, 200, {
        latestEventId: deps.roomEventStore.getLatestEventId(roomId),
        roomId,
      })

      return true
    }

    const eventsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/events$/)

    if (!eventsMatch) {
      return false
    }

    const roomId = eventsMatch[1]!

    if (method === 'POST') {
      const payload = await readJsonBody(req, 64 * 1024)
      const parsedEvent = parseCreateRoomEventRequest(payload)

      if (!parsedEvent.ok) {
        sendJson(res, 400, {
          error: parsedEvent.error,
        })

        return true
      }

      const event = deps.roomEventStore.publish(roomId, parsedEvent.value)

      if (event.message.type === 'chat-broadcast') {
        deps.logger.info('Backend relay chat stored.', {
          eventId: event.id,
          roomId,
          senderPeerId: event.senderPeerId,
        })
      }

      deps.logger.debug('Relay room event stored.', {
        eventId: event.id,
        messageType: event.message.type,
        roomId,
        senderPeerId: event.senderPeerId,
        targetPeerId: event.targetPeerId,
      })

      sendJson(res, 201, {
        eventId: event.id,
        roomId,
        status: 'queued',
      })

      return true
    }

    if (method === 'GET') {
      const peerId = url.searchParams.get('peerId')?.trim() ?? ''
      const afterEventId = Number.parseInt(
        url.searchParams.get('after') ?? '0',
        10
      )

      if (!peerId) {
        sendJson(res, 400, {
          error: 'Room event polling requires a peerId query parameter.',
        })

        return true
      }

      if (!Number.isFinite(afterEventId) || afterEventId < 0) {
        sendJson(res, 400, {
          error: 'Room event polling requires a non-negative after value.',
        })

        return true
      }

      const { events, latestEventId } = deps.roomEventStore.getEventsAfter(
        roomId,
        peerId,
        afterEventId
      )

      sendJson(res, 200, {
        events,
        latestEventId,
        roomId,
      })

      return true
    }

    return false
  }
}

function parseCreateRoomEventRequest(
  value: unknown
):
  | { ok: true; value: CreateRelayRoomEventRequest }
  | { error: string; ok: false } {
  if (!value || typeof value !== 'object') {
    return {
      error: 'Room event request must be a JSON object.',
      ok: false,
    }
  }

  const message = (value as { message?: unknown }).message
  const senderPeerId = (value as { senderPeerId?: unknown }).senderPeerId
  const targetPeerId = (value as { targetPeerId?: unknown }).targetPeerId

  if (
    !message ||
    typeof message !== 'object' ||
    typeof (message as { type?: unknown }).type !== 'string'
  ) {
    return {
      error: 'Room event requests must include a message object with a type.',
      ok: false,
    }
  }

  if (typeof senderPeerId !== 'string' || senderPeerId.trim() === '') {
    return {
      error: 'Room event requests must include a senderPeerId.',
      ok: false,
    }
  }

  if (
    targetPeerId !== undefined &&
    targetPeerId !== null &&
    (typeof targetPeerId !== 'string' || targetPeerId.trim() === '')
  ) {
    return {
      error: 'targetPeerId must be a non-empty string when provided.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      message: message as RelayRoomEventMessage,
      senderPeerId,
      targetPeerId: targetPeerId ?? null,
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
