import {
  isHumanReadableId,
  normalizeHumanReadableId,
} from '@/lib/humanId'

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

export function buildShareUrl(roomId: string, hostPeerId: string) {
  const normalizedRoomId = normalizeIdInput(roomId)
  const normalizedHostPeerId = normalizeIdInput(hostPeerId)
  const roomPath = buildRoomPath(normalizedRoomId)

  if (typeof window === 'undefined') {
    return `${roomPath}?host=${normalizedHostPeerId}`
  }

  const url = new URL(roomPath, window.location.origin)

  url.searchParams.set('host', normalizedHostPeerId)

  return url.toString()
}

export function getHostPeerIdFromQuery(hostQuery: unknown) {
  if (typeof hostQuery !== 'string') {
    return null
  }

  const hostPeerId = normalizeIdInput(hostQuery)

  return hostPeerId.length > 0 ? hostPeerId : null
}

export function isGeneratedId(value: string, prefix: string) {
  if (prefix === 'room' || prefix === 'peer') {
    return isLegacyGeneratedId(value, prefix) || isHumanReadableId(value)
  }

  return isLegacyGeneratedId(value, prefix)
}
