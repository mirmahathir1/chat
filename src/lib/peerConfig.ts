import type { PeerJSOption } from 'peerjs'

const defaultStunUrls = [
  'stun:stun.l.google.com:19302',
  'stun:global.stun.twilio.com:3478',
]

function parseFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  return value === 'true'
}

function parseNumber(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

function parseList(value: string | undefined) {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readIceUrls(primaryValue: string | undefined, fallbackValue?: string) {
  const parsedPrimary = parseList(primaryValue)

  if (parsedPrimary && parsedPrimary.length > 0) {
    return parsedPrimary
  }

  const parsedFallback = parseList(fallbackValue)

  return parsedFallback && parsedFallback.length > 0 ? parsedFallback : null
}

function readTurnServer(): RTCIceServer | null {
  const urls = readIceUrls(
    import.meta.env.VITE_TURN_URLS,
    import.meta.env.VITE_TURN_URL
  )
  const username = import.meta.env.VITE_TURN_USERNAME?.trim()
  const credential = import.meta.env.VITE_TURN_CREDENTIAL?.trim()

  if (!urls || !username || !credential) {
    return null
  }

  const normalizedUrls: string | string[] =
    urls.length === 1 ? urls[0]! : urls

  return {
    urls: normalizedUrls,
    username,
    credential,
  }
}

export function getIceServers(): RTCIceServer[] {
  const stunUrls = readIceUrls(import.meta.env.VITE_STUN_URLS)
  const servers: RTCIceServer[] = (stunUrls ?? defaultStunUrls).map((urls) => ({
    urls,
  }))

  const turnServer = readTurnServer()

  if (turnServer) {
    servers.push(turnServer)
  }

  return servers
}

export function getPeerOptions(): PeerJSOption {
  return {
    debug: parseNumber(import.meta.env.VITE_PEER_DEBUG, 2),
    host: import.meta.env.VITE_PEER_HOST || '0.peerjs.com',
    port: parseNumber(import.meta.env.VITE_PEER_PORT, 443),
    path: import.meta.env.VITE_PEER_PATH || '/',
    secure: parseFlag(import.meta.env.VITE_PEER_SECURE, true),
    config: {
      iceServers: getIceServers(),
    },
  }
}
