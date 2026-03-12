export type RelayLogLevel = 'silent' | 'error' | 'info' | 'debug'

interface RelayLogPayload {
  [key: string]: unknown
}

const logLevelOrder: Record<RelayLogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
}

export interface RelayLogger {
  debug(message: string, payload?: RelayLogPayload): void
  error(message: string, payload?: RelayLogPayload): void
  info(message: string, payload?: RelayLogPayload): void
  level: RelayLogLevel
}

export function createRelayLogger(level: RelayLogLevel): RelayLogger {
  return {
    level,
    debug(message, payload) {
      writeLog('debug', level, message, payload)
    },
    error(message, payload) {
      writeLog('error', level, message, payload)
    },
    info(message, payload) {
      writeLog('info', level, message, payload)
    },
  }
}

function writeLog(
  severity: Exclude<RelayLogLevel, 'silent'>,
  configuredLevel: RelayLogLevel,
  message: string,
  payload?: RelayLogPayload
) {
  if (logLevelOrder[configuredLevel] < logLevelOrder[severity]) {
    return
  }

  const logMethod =
    severity === 'error'
      ? console.error
      : severity === 'info'
        ? console.info
        : console.debug

  if (payload && Object.keys(payload).length > 0) {
    logMethod(message, payload)

    return
  }

  logMethod(message)
}
