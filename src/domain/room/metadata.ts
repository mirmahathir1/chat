import { formatHumanReadableId } from '@/lib/humanId'
import { createId } from '@/lib/id'
import type { PeerIdentity, RoomNotification, RoomSummary } from '@/types/chat'

export function buildRoomName(
  prefix: 'Hosted room' | 'Join room',
  roomId: string
) {
  return `${prefix} ${formatHumanReadableId(roomId)}`
}

export function buildHostedRoomNotifications(
  host: PeerIdentity,
  room: RoomSummary
): RoomNotification[] {
  return [
    {
      id: createId('notification'),
      title: 'Hosted room ready',
      detail:
        'Hosted room is live. Scan the QR code from another device to open the join flow for this room.',
      tone: 'success',
      createdAt: room.createdAt,
      seen: false,
    },
    {
      id: createId('notification'),
      title: 'Chat ready',
      detail:
        'Text chat is live. The host relays messages across the room through the signaling channel.',
      tone: 'info',
      createdAt: room.createdAt,
      seen: false,
    },
    {
      id: createId('notification'),
      title: 'Share link is ready',
      detail: `${host.label} is the current host for room ${room.id}.`,
      tone: 'info',
      createdAt: room.createdAt,
      seen: false,
    },
  ]
}

export function buildJoinRoomNotifications(
  roomId: string,
  hostPeerId: string,
  createdAt: string
): RoomNotification[] {
  return [
    {
      id: createId('notification'),
      title: 'Join link loaded',
      detail: `This browser is staged to join room ${roomId} through host ${hostPeerId}.`,
      tone: 'success',
      createdAt,
      seen: false,
    },
    {
      id: createId('notification'),
      title: 'Connection pending',
      detail:
        'The scanned link is valid. This device will unlock room chat after the host connection is established.',
      tone: 'info',
      createdAt,
      seen: false,
    },
  ]
}
