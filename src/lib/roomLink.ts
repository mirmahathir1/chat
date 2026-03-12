import {
  isHumanReadableId,
  normalizeHumanReadableId,
} from '@/lib/humanId'
import type { TransferTransport } from '@/types/chat'

function normalizeBasePath(value: string | undefined) {
  if (!value) {
    return '/'
  }

  if (value === '/') {
    return value
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`

  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash
    : `${withLeadingSlash}/`
}

function buildRoomPath(roomId: string) {
  const basePath = normalizeBasePath(import.meta.env.BASE_URL)

  return `${basePath}room/${roomId}`.replace(/\/{2,}/g, '/')
}

function isLegacyGeneratedId(value: string, prefix: string) {
  return new RegExp(`^${prefix}-[a-f0-9]{8}$`).test(value)
}

export function normalizeIdInput(value: string) {
  const trimmed = value.trim()

  return normalizeHumanReadableId(trimmed) ?? trimmed
}

function normalizeInviteTransport(preferBackendRelay: boolean): TransferTransport {
  return preferBackendRelay ? 'backend-relay' : 'webrtc'
}

export function buildShareUrl(
  roomId: string,
  hostPeerId: string,
  preferBackendRelay = false
) {
  const normalizedRoomId = normalizeIdInput(roomId)
  const normalizedHostPeerId = normalizeIdInput(hostPeerId)
  const roomPath = buildRoomPath(normalizedRoomId)
  const transport = normalizeInviteTransport(preferBackendRelay)

  if (typeof window === 'undefined') {
    return `${roomPath}?host=${normalizedHostPeerId}&transport=${transport}`
  }

  const url = new URL(roomPath, window.location.origin)

  url.searchParams.set('host', normalizedHostPeerId)
  url.searchParams.set('transport', transport)

  return url.toString()
}

export function getHostPeerIdFromQuery(hostQuery: unknown) {
  if (typeof hostQuery !== 'string') {
    return null
  }

  const hostPeerId = normalizeIdInput(hostQuery)

  return hostPeerId.length > 0 ? hostPeerId : null
}

export function getTransferTransportFromQuery(
  transportQuery: unknown
): TransferTransport | null {
  if (typeof transportQuery !== 'string') {
    return null
  }

  const transport = transportQuery.trim().toLowerCase()

  if (transport === 'backend-relay' || transport === 'relay') {
    return 'backend-relay'
  }

  if (transport === 'webrtc' || transport === 'direct') {
    return 'webrtc'
  }

  return null
}

export function isGeneratedId(value: string, prefix: string) {
  if (prefix === 'room' || prefix === 'peer') {
    return isLegacyGeneratedId(value, prefix) || isHumanReadableId(value)
  }

  return isLegacyGeneratedId(value, prefix)
}
