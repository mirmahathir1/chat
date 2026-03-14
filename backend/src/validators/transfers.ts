import type {
  RelayFileDeleteRequest,
  RelayTransferCancelRequest,
} from '../types/relay.js'

export function parseRelayFileDeleteRequest(value: unknown):
  | {
      ok: true
      value: RelayFileDeleteRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!value || typeof value !== 'object') {
    return {
      error: 'Relay file acknowledgement must be a JSON object.',
      ok: false,
    }
  }

  const pathname = (value as { pathname?: unknown }).pathname

  if (typeof pathname !== 'string' || pathname.trim() === '') {
    return {
      error: 'Relay file acknowledgement must include a pathname.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      pathname: pathname.trim(),
    },
  }
}

export function parseRelayTransferCancelRequest(value: unknown):
  | {
      ok: true
      value: Required<Pick<RelayTransferCancelRequest, 'pathnames'>> &
        RelayTransferCancelRequest
    }
  | {
      error: string
      ok: false
    } {
  if (!value || typeof value !== 'object') {
    return {
      error: 'Relay transfer cancellation must be a JSON object.',
      ok: false,
    }
  }

  const pathnames = (value as { pathnames?: unknown }).pathnames
  const peerId = (value as { peerId?: unknown }).peerId
  const reason = (value as { reason?: unknown }).reason

  if (
    pathnames !== undefined &&
    (!Array.isArray(pathnames) ||
      pathnames.some(
        (pathname) => typeof pathname !== 'string' || pathname.trim() === ''
      ))
  ) {
    return {
      error: 'pathnames must be an array of non-empty strings when provided.',
      ok: false,
    }
  }

  if (
    peerId !== undefined &&
    (typeof peerId !== 'string' || peerId.trim() === '')
  ) {
    return {
      error: 'peerId must be a non-empty string when provided.',
      ok: false,
    }
  }

  if (
    reason !== undefined &&
    reason !== null &&
    (typeof reason !== 'string' || reason.trim() === '')
  ) {
    return {
      error: 'reason must be a non-empty string when provided.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      pathnames: (pathnames ?? []).map((pathname) => pathname.trim()),
      peerId: typeof peerId === 'string' ? peerId.trim() : undefined,
      reason: typeof reason === 'string' ? reason.trim() : undefined,
    },
  }
}
