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

export function buildShareUrl(roomId: string, hostPeerId: string) {
  const roomPath = buildRoomPath(roomId)

  if (typeof window === 'undefined') {
    return `${roomPath}?host=${hostPeerId}`
  }

  const url = new URL(roomPath, window.location.origin)

  url.searchParams.set('host', hostPeerId)

  return url.toString()
}

export function getHostPeerIdFromQuery(hostQuery: unknown) {
  if (typeof hostQuery !== 'string') {
    return null
  }

  const hostPeerId = hostQuery.trim()

  return hostPeerId.length > 0 ? hostPeerId : null
}

export function isGeneratedId(value: string, prefix: string) {
  return new RegExp(`^${prefix}-[a-f0-9]{8}$`).test(value)
}
