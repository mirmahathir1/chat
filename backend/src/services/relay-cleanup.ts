import type { RelayLogger } from './relay-logger.js'
import type { RelayChunkStore, RelaySessionStoreContract } from './relay-store.js'

interface RelayCleanupOptions {
  chunkStore: RelayChunkStore
  intervalMs: number
  logger?: RelayLogger
  sessionStore: RelaySessionStoreContract
}

export function startRelayCleanup(options: RelayCleanupOptions) {
  const timer = setInterval(() => {
    const expiredChunks = options.chunkStore.sweepExpired()
    const expiredSessions = options.sessionStore.sweepExpired()

    if (expiredChunks === 0 && expiredSessions === 0) {
      return
    }

    options.logger?.info('Relay cleanup sweep completed.', {
      expiredChunks,
      expiredSessions,
    })
  }, options.intervalMs)

  timer.unref()

  return {
    stop() {
      clearInterval(timer)
    },
  }
}
