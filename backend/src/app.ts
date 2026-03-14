import type { IncomingMessage, ServerResponse } from 'node:http'
import { readRelayConfig, type RelayConfig } from './config.js'
import { sendJson } from './http/json.js'
import { resolveRequestPathname } from './http/pathname.js'
import { createRoomEventsRouteHandler } from './routes/room-events.js'
import { createTransfersRouteHandler } from './routes/transfers.js'
import { createRelayLogger } from './services/relay-logger.js'
import { RelayRoomEventStore } from './services/room-event-store.js'

type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>
) => Promise<void>

export interface RelayApp {
  config: RelayConfig
  handler: RequestHandler
  logger: ReturnType<typeof createRelayLogger>
  stopCleanup: () => void
}

export function createRelayApp(config = readRelayConfig()): RelayApp {
  const logger = createRelayLogger(config.logLevel)
  const roomEventStore = new RelayRoomEventStore({
    maxEventsPerRoom: 200,
  })
  const handleTransfersRoute = createTransfersRouteHandler({
    config,
    logger,
  })
  const handleRoomEventsRoute = createRoomEventsRouteHandler({
    logger,
    roomEventStore,
  })

  const handler: RequestHandler = async (req, res) => {
    const pathname = resolveRequestPathname(req.url)

    try {
      applyCorsHeaders(req, res, config)

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()

        return
      }

      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, {
          blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
          cleanupIntervalMs: config.cleanupIntervalMs,
          fileStorageMode: 'vercel-blob',
          logLevel: config.logLevel,
          maxFileBytes: config.maxFileBytes,
          pollIntervalMs: config.pollIntervalMs,
          roomEventStats: roomEventStore.getStats(),
          sessionTtlMs: config.sessionTtlMs,
          status: 'ok',
          storageMode: 'mixed',
        })

        return
      }

      const handled = await handleTransfersRoute(req, res)

      if (handled) {
        return
      }

      const handledRoomEvents = await handleRoomEventsRoute(req, res)

      if (handledRoomEvents) {
        return
      }

      sendJson(res, 404, {
        error: 'Route not found.',
      })
    } catch (error) {
      const { errorMessage, statusCode } = resolveErrorResponse(error)

      logger.error('Relay backend request failed.', {
        error:
          error instanceof Error
            ? {
                message: error.message,
                name: error.name,
                stack: error.stack,
              }
            : error,
        method: req.method ?? 'GET',
        statusCode,
        url: req.url ?? '/',
      })

      if (res.headersSent) {
        res.end()

        return
      }

      sendJson(res, statusCode, {
        error: errorMessage,
      })
    }
  }

  return {
    config,
    handler,
    logger,
    stopCleanup() {},
  }
}

function resolveErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return {
      errorMessage: 'Request body must be valid JSON.',
      statusCode: 400,
    }
  }

  if (
    error instanceof Error &&
    error.message.startsWith('Request body exceeded ')
  ) {
    return {
      errorMessage: error.message,
      statusCode: 413,
    }
  }

  return {
    errorMessage: 'Internal server error.',
    statusCode: 500,
  }
}

function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  config: RelayConfig
) {
  const origin = getHeaderValue(req, 'origin')
  const allowedOrigin = resolveAllowedOrigin(origin, config.allowedOrigins)

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  }

  res.setHeader('Access-Control-Allow-Headers', ['content-type'].join(', '))
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader(
    'Access-Control-Expose-Headers',
    ['content-disposition', 'content-length', 'content-type', 'etag'].join(', ')
  )
  res.setHeader('Access-Control-Max-Age', '86400')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Vary', 'Origin')
}

function resolveAllowedOrigin(
  origin: string | null,
  allowedOrigins: RelayConfig['allowedOrigins']
) {
  if (allowedOrigins === '*') {
    return '*'
  }

  if (!origin) {
    return allowedOrigins[0] ?? null
  }

  return allowedOrigins.includes(origin) ? origin : null
}

function getHeaderValue(req: IncomingMessage, headerName: string) {
  const header = req.headers[headerName]

  if (typeof header === 'string') {
    return header
  }

  return header?.[0] ?? null
}

declare global {
  var __relayApp__: RelayApp | undefined
}

export function getRelayApp() {
  globalThis.__relayApp__ ??= createRelayApp()

  return globalThis.__relayApp__
}
