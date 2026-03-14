import type {
  CreateRelayRoomEventRequest,
  RelayRoomEventMessage,
} from '../types/room-event.js'

export function parseCreateRoomEventRequest(
  value: unknown
):
  | { ok: true; value: CreateRelayRoomEventRequest }
  | { error: string; ok: false } {
  if (!value || typeof value !== 'object') {
    return {
      error: 'Room event request must be a JSON object.',
      ok: false,
    }
  }

  const message = (value as { message?: unknown }).message
  const senderPeerId = (value as { senderPeerId?: unknown }).senderPeerId
  const targetPeerId = (value as { targetPeerId?: unknown }).targetPeerId

  if (
    !message ||
    typeof message !== 'object' ||
    typeof (message as { type?: unknown }).type !== 'string'
  ) {
    return {
      error: 'Room event requests must include a message object with a type.',
      ok: false,
    }
  }

  if (typeof senderPeerId !== 'string' || senderPeerId.trim() === '') {
    return {
      error: 'Room event requests must include a senderPeerId.',
      ok: false,
    }
  }

  if (
    targetPeerId !== undefined &&
    targetPeerId !== null &&
    (typeof targetPeerId !== 'string' || targetPeerId.trim() === '')
  ) {
    return {
      error: 'targetPeerId must be a non-empty string when provided.',
      ok: false,
    }
  }

  return {
    ok: true,
    value: {
      message: message as RelayRoomEventMessage,
      senderPeerId,
      targetPeerId: targetPeerId ?? null,
    },
  }
}
