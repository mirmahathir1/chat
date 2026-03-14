import type { IncomingMessage, ServerResponse } from 'node:http'
import { readJsonBody, sendJson } from '../http/json.js'
import { normalizePathname } from '../http/pathname.js'
import type { RelayRoomEventStore } from '../services/room-event-store.js'
import type { RelayLogger } from '../services/relay-logger.js'
import { parseCreateRoomEventRequest } from '../validators/room-events.js'

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

    const cursorMatch = pathname.match(
      /^\/api\/rooms\/([^/]+)\/events\/cursor$/
    )

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
