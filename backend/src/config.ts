import type { RelayLogLevel } from './services/relay-logger.js'

export interface RelayConfig {
  allowedOrigins: '*' | string[]
  cleanupIntervalMs: number
  logLevel: RelayLogLevel
  maxFileBytes: number
  pollIntervalMs: number
  port: number
  sessionTtlMs: number
}

const defaults = {
  cleanupIntervalMs: 60 * 1000,
  logLevel: 'info',
  maxFileBytes: 5 * 1024 * 1024 * 1024 * 1024,
  pollIntervalMs: 1500,
  port: 8787,
  sessionTtlMs: 15 * 60 * 1000,
} as const

function parseNumber(value: string | undefined, fallback: number) {
  if (!value || value.trim() === '') {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseAllowedOrigins(value: string | undefined): RelayConfig['allowedOrigins'] {
  if (!value || value.trim() === '') {
    return ['http://localhost:5173']
  }

  if (value.trim() === '*') {
    return '*'
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return origins.length > 0 ? origins : ['http://localhost:5173']
}

function parseLogLevel(value: string | undefined): RelayLogLevel {
  const normalized = value?.trim().toLowerCase()

  if (
    normalized === 'silent' ||
    normalized === 'error' ||
    normalized === 'info' ||
    normalized === 'debug'
  ) {
    return normalized
  }

  return defaults.logLevel
}

export function readRelayConfig(env = process.env): RelayConfig {
  const configuredMaxFileBytes = parseNumber(
    env.RELAY_MAX_FILE_BYTES,
    parseNumber(env.RELAY_MAX_CHUNK_BYTES, defaults.maxFileBytes)
  )

  return {
    allowedOrigins: parseAllowedOrigins(env.RELAY_ALLOWED_ORIGINS),
    cleanupIntervalMs: parseNumber(
      env.RELAY_CLEANUP_INTERVAL_MS,
      defaults.cleanupIntervalMs
    ),
    logLevel: parseLogLevel(env.RELAY_LOG_LEVEL),
    maxFileBytes: configuredMaxFileBytes,
    pollIntervalMs: parseNumber(
      env.RELAY_POLL_INTERVAL_MS,
      defaults.pollIntervalMs
    ),
    port: parseNumber(env.RELAY_PORT, defaults.port),
    sessionTtlMs: parseNumber(
      env.RELAY_SESSION_TTL_MS,
      defaults.sessionTtlMs
    ),
  }
}
