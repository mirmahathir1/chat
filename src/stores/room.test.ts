import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationStore } from '@/stores/notifications'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'

describe('room store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('bootstraps a hosted room with host presence and notifications', () => {
    const roomStore = useRoomStore()
    const sessionStore = useSessionStore()
    const notificationStore = useNotificationStore()

    const roomId = 'amber-blaze-12'
    roomStore.bootstrapHostedRoom(roomId)

    expect(roomStore.room).toMatchObject({
      hostPeerId: roomId,
      id: roomId,
      localMode: 'host',
      status: 'active',
    })
    expect(roomStore.room?.shareUrl).toBe(
      '/room/amber-blaze-12?host=amber-blaze-12&transport=webrtc'
    )
    expect(sessionStore.peer?.id).toBe(roomId)
    expect(roomStore.members).toHaveLength(1)
    expect(roomStore.members[0]).toMatchObject({
      connectionState: 'connected',
      id: roomId,
      role: 'host',
    })
    expect(roomStore.presenceEvents).toHaveLength(1)
    expect(roomStore.presenceEvents[0]).toMatchObject({
      peerId: roomId,
      type: 'host-created',
    })
    expect(notificationStore.items).toHaveLength(3)
  })

  it('prepares a join room and carries the invite transport into the share url', () => {
    const roomStore = useRoomStore()
    const sessionStore = useSessionStore()
    const notificationStore = useNotificationStore()

    roomStore.prepareJoinRoom('amber-blaze-12', 'echo-frost-34', true)

    expect(roomStore.preferBackendRelay).toBe(true)
    expect(roomStore.room).toMatchObject({
      hostPeerId: 'echo-frost-34',
      id: 'amber-blaze-12',
      localMode: 'join',
      status: 'draft',
    })
    expect(roomStore.room?.shareUrl).toBe(
      '/room/amber-blaze-12?host=echo-frost-34&transport=backend-relay'
    )
    expect(roomStore.members).toHaveLength(2)
    expect(
      roomStore.members.find((member) => member.role === 'host')
    ).toMatchObject({
      connectionState: 'idle',
      id: 'echo-frost-34',
    })
    expect(
      roomStore.members.find((member) => member.role === 'member')?.id
    ).toBe(sessionStore.peer?.id)
    expect(roomStore.presenceEvents[0]).toMatchObject({
      peerId: sessionStore.peer?.id,
      type: 'joined',
    })
    expect(notificationStore.items).toHaveLength(2)
  })
})
