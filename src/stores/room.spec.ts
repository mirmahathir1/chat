import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { maxChatMessageBytes, useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'

describe('useRoomStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('bootstraps a hosted room using the local session as the host', () => {
    const sessionStore = useSessionStore()
    const roomStore = useRoomStore()
    const previousPeerId = sessionStore.ensureSession('member').id
    const roomId = roomStore.bootstrapHostedRoom('room-phase1')

    expect(roomId).toBe('room-phase1')
    expect(roomStore.room?.id).toBe('room-phase1')
    expect(roomStore.members).toHaveLength(1)
    expect(sessionStore.peer?.id).not.toBe(previousPeerId)
    expect(roomStore.members[0]?.id).toBe(sessionStore.peer?.id)
    expect(roomStore.members[0]?.role).toBe('host')
    expect(roomStore.room?.localMode).toBe('host')
    expect(roomStore.messages).toEqual([])
    expect(roomStore.presenceEvents[0]?.type).toBe('host-created')
  })

  it('creates an optimistic pending chat message from the local draft', () => {
    const roomStore = useRoomStore()

    roomStore.bootstrapHostedRoom('room-phase1')
    roomStore.updateDraftMessage('Phase 5 draft message')
    const result = roomStore.createDraftMessage()

    expect(result.error).toBeNull()
    expect(result.message?.status).toBe('pending')
    expect(roomStore.messages[roomStore.messages.length - 1]?.body).toBe(
      'Phase 5 draft message'
    )
    expect(roomStore.draftMessage).toBe('')
  })

  it('rejects empty and oversized drafts', () => {
    const roomStore = useRoomStore()

    roomStore.bootstrapHostedRoom('room-phase5')
    roomStore.updateDraftMessage('   ')

    expect(roomStore.createDraftMessage().error).toBe('Messages cannot be empty.')

    roomStore.updateDraftMessage('x'.repeat(3000))

    expect(roomStore.createDraftMessage().error).toBe(
      `Messages must stay under ${maxChatMessageBytes} bytes.`
    )
  })

  it('prepares a scanned room link as a join-ready room instead of hosting it', () => {
    const sessionStore = useSessionStore()
    const roomStore = useRoomStore()
    const originalPeerId = sessionStore.ensureSession('host').id

    roomStore.prepareJoinRoom('room-phase2', 'peer-hosted')

    expect(sessionStore.peer?.role).toBe('member')
    expect(sessionStore.peer?.id).not.toBe(originalPeerId)
    expect(roomStore.room?.id).toBe('room-phase2')
    expect(roomStore.room?.hostPeerId).toBe('peer-hosted')
    expect(roomStore.room?.localMode).toBe('join')
    expect(roomStore.room?.shareUrl).toContain('/room/room-phase2?host=peer-hosted')
    expect(roomStore.members).toHaveLength(2)
    expect(roomStore.messages).toEqual([])
  })

  it('updates tracked members and room status during signaling events', () => {
    const roomStore = useRoomStore()

    roomStore.bootstrapHostedRoom('room-phase3')
    roomStore.updateRoomStatus('disconnected')
    roomStore.upsertMember({
      id: 'peer-joiner',
      label: 'Joiner',
      role: 'member',
      connectionState: 'connecting',
      joinedAt: '2026-03-10T00:00:00.000Z',
    })
    roomStore.updateMemberConnectionState('peer-joiner', 'connected')
    roomStore.replaceMembers([
      roomStore.members[0]!,
      {
        id: 'peer-joiner',
        label: 'Joiner',
        role: 'member',
        connectionState: 'connected',
        joinedAt: '2026-03-10T00:00:00.000Z',
      },
    ])
    roomStore.replacePresenceEvents([
      roomStore.presenceEvents[0]!,
      {
        id: 'presence-joined',
        type: 'joined',
        peerId: 'peer-joiner',
        peerLabel: 'Joiner',
        createdAt: '2026-03-10T00:00:00.000Z',
      },
    ])

    expect(roomStore.room?.status).toBe('disconnected')
    expect(roomStore.members.some((member) => member.id === 'peer-joiner')).toBe(true)
    expect(roomStore.connectedMemberCount).toBe(2)
    expect(roomStore.presenceEvents[roomStore.presenceEvents.length - 1]?.type).toBe(
      'joined'
    )
  })

  it('reconciles pending messages when the host relay confirms delivery', () => {
    const sessionStore = useSessionStore()
    const roomStore = useRoomStore()

    roomStore.bootstrapHostedRoom('room-phase5')
    roomStore.updateDraftMessage('Relayed message')
    const pendingMessage = roomStore.createDraftMessage().message

    roomStore.markMessageStatus(pendingMessage!.id, 'sent', {
      ...pendingMessage!,
      senderId: sessionStore.peer!.id,
      senderLabel: sessionStore.peer!.label,
      status: 'sent',
    })

    expect(roomStore.messages[roomStore.messages.length - 1]?.status).toBe('sent')
  })

  it('refreshes the host share link after the local host identity rotates', () => {
    const sessionStore = useSessionStore()
    const roomStore = useRoomStore()

    roomStore.bootstrapHostedRoom('room-phase6')
    const nextPeer = sessionStore.rotatePeerIdentity('host')

    roomStore.refreshHostPeerIdentity(nextPeer.id)

    expect(roomStore.room?.hostPeerId).toBe(nextPeer.id)
    expect(roomStore.room?.shareUrl).toContain(`host=${nextPeer.id}`)
    expect(roomStore.members[0]?.id).toBe(nextPeer.id)
  })

  it('creates and updates transfer state for outgoing files', () => {
    const roomStore = useRoomStore()
    const file = new File(['phase-7'], 'phase7.txt', {
      type: 'text/plain',
    })

    roomStore.bootstrapHostedRoom('room-phase7')
    const result = roomStore.createOutgoingTransfer([file])

    expect(result.error).toBeNull()
    expect(result.transfer?.files).toHaveLength(1)

    roomStore.updateTransferProgress(result.transfer!.id, 55)
    roomStore.completeTransfer(result.transfer!.id)

    expect(roomStore.transfers[0]?.status).toBe('completed')
    expect(roomStore.transfers[0]?.progress).toBe(100)
  })

  it('clears the room state completely when the lobby is reopened', () => {
    const roomStore = useRoomStore()

    roomStore.bootstrapHostedRoom('room-phase8')
    roomStore.updateDraftMessage('temporary draft')
    roomStore.clearRoom()

    expect(roomStore.room).toBeNull()
    expect(roomStore.members).toEqual([])
    expect(roomStore.messages).toEqual([])
    expect(roomStore.presenceEvents).toEqual([])
    expect(roomStore.transfers).toEqual([])
    expect(roomStore.draftMessage).toBe('')
  })
})
