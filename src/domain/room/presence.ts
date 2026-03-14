import { createId } from '@/lib/id'
import type { PresenceEvent } from '@/types/chat'

export function buildPresenceEvent(
  type: PresenceEvent['type'],
  peerId: string,
  peerLabel: string,
  createdAt: string
): PresenceEvent {
  return {
    id: createId('presence'),
    type,
    peerId,
    peerLabel,
    createdAt,
  }
}

export function appendPresenceEvent(
  presenceEvents: PresenceEvent[],
  event: PresenceEvent
) {
  return [...presenceEvents, event]
}
