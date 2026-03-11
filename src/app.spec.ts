import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import router, { resetInitialNavigationGuardForTests } from '@/router'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSignalingStore } from '@/stores/signaling'

const signalingFns = vi.hoisted(() => ({
  ensureHost: vi.fn(),
  ensureJoiner: vi.fn(),
  retryJoinConnection: vi.fn(),
  sendDraftMessage: vi.fn(),
  sendFiles: vi.fn(),
  cancelIncomingTransfer: vi.fn(),
  requestTransferReplay: vi.fn(),
  destroyPeer: vi.fn(),
}))

vi.mock('@/stores/signaling', async () => {
  const { defineStore } = await import('pinia')
  const { computed, ref } = await import('vue')

  return {
    useSignalingStore: defineStore('signaling', () => {
      const state = ref<
        | 'idle'
        | 'starting'
        | 'listening'
        | 'connecting'
        | 'retrying'
        | 'connected'
        | 'disconnected'
        | 'error'
      >('connected')
      const errorMessage = ref<string | null>(null)
      const retryCount = ref(0)
      const isHistoryLoading = ref(false)
      const isReady = computed(() => state.value === 'connected')

      return {
        state,
        errorMessage,
        retryCount,
        isHistoryLoading,
        isReady,
        ensureHost: signalingFns.ensureHost,
        ensureJoiner: signalingFns.ensureJoiner,
        retryJoinConnection: signalingFns.retryJoinConnection,
        sendDraftMessage: signalingFns.sendDraftMessage,
        sendFiles: signalingFns.sendFiles,
        cancelIncomingTransfer: signalingFns.cancelIncomingTransfer,
        requestTransferReplay: signalingFns.requestTransferReplay,
        destroyPeer: signalingFns.destroyPeer,
      }
    }),
  }
})

describe('app flows', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    signalingFns.sendDraftMessage.mockImplementation(() => {
      const roomStore = useRoomStore()
      const result = roomStore.createDraftMessage()

      if (!result.message) {
        return false
      }

      roomStore.markMessageStatus(result.message.id, 'sent')

      return true
    })
    signalingFns.sendFiles.mockResolvedValue(true)
  })

  afterEach(async () => {
    wrapper?.unmount()
    wrapper = null
    await router.push('/')
  })

  async function mountAt(path: string) {
    const pinia = createPinia()

    setActivePinia(pinia)
    await router.push(path)
    await router.isReady()

    wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
      },
    })

    await flushPromises()

    return wrapper
  }

  it('shows a host QR on the home screen without requiring room creation', async () => {
    const app = await mountAt('/')

    const roomStore = useRoomStore()

    expect(router.currentRoute.value.name).toBe('home')
    expect(roomStore.room?.localMode).toBe('host')
    expect(signalingFns.ensureHost).toHaveBeenCalledWith(roomStore.room!.id)
    expect(app.text()).toContain('Room details')
    expect(app.text()).not.toContain('Create hosted room')
    expect(
      app.find('img[alt="QR code for the room invite link"]').exists()
    ).toBe(true)
    expect(app.text()).not.toContain('Open join tab')
  })

  it('moves the host into the room after a participant connects from the home QR', async () => {
    const app = await mountAt('/')
    const roomStore = useRoomStore()
    const sessionStore = useSessionStore()

    roomStore.upsertMember({
      id: 'peer-joiner',
      label: 'Joiner',
      role: 'member',
      connectionState: 'connected',
      joinedAt: '2026-03-10T00:00:00.000Z',
    })
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('room')
    expect(router.currentRoute.value.params.roomId).toBe(roomStore.room?.id)
    expect(roomStore.connectedMemberCount).toBe(2)
    expect(roomStore.members[0]?.id).toBe(sessionStore.peer?.id)
    expect(app.find('button[aria-label="Open room drawer"]').exists()).toBe(
      true
    )
  })

  it('purges the active room and provisions a fresh host QR when returning to the lobby', async () => {
    const app = await mountAt('/room/room-deadbeef')
    const roomStore = useRoomStore()
    const previousRoomId = roomStore.room?.id

    expect(roomStore.room?.id).toBe('room-deadbeef')

    await app.get('button[aria-label="Open room drawer"]').trigger('click')
    await flushPromises()
    await app.get('button[aria-label="Exit room"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    expect(roomStore.room?.id).not.toBe(previousRoomId)
    expect(roomStore.room?.localMode).toBe('host')
    expect(roomStore.members).toHaveLength(1)
    expect(roomStore.messages).toEqual([])
    expect(app.text()).not.toContain('Create hosted room')
  })

  it('loads the join-room screen from a scanned room link', async () => {
    const app = await mountAt('/room/room-deadbeef?host=peer-feedcafe')
    const roomStore = useRoomStore()

    expect(signalingFns.ensureJoiner).toHaveBeenCalledWith(
      'room-deadbeef',
      'peer-feedcafe'
    )
    expect(roomStore.room?.localMode).toBe('join')
    expect(app.find('button[aria-label="Open room drawer"]').exists()).toBe(
      true
    )
    await app.get('button[aria-label="Open room drawer"]').trigger('click')
    await flushPromises()
    expect(app.text()).not.toContain('Join flow')
    expect(app.text()).not.toContain('This device is connected to the host.')
    expect(app.text()).not.toContain(
      'Chat and presence are now synchronized through the host-managed room.'
    )
    expect(app.text()).not.toContain('text chat lands')
  })

  it('redirects a browser reload on a room URL back to the home qr page', async () => {
    vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([
      {
        type: 'reload',
      } as PerformanceNavigationTiming,
    ])

    resetInitialNavigationGuardForTests()
    const app = await mountAt('/room/room-deadbeef?host=peer-feedcafe')
    const roomStore = useRoomStore()

    expect(router.currentRoute.value.name).toBe('home')
    expect(roomStore.room?.localMode).toBe('host')
    expect(signalingFns.ensureHost).toHaveBeenCalledWith(roomStore.room!.id)
    expect(app.text()).toContain('Scan the QR code')
  })

  it('shows a blocking host disconnected modal for joiners and returns home', async () => {
    const app = await mountAt('/room/room-deadbeef?host=peer-feedcafe')
    const roomStore = useRoomStore()
    const signalingStore = useSignalingStore()

    signalingStore.errorMessage = 'The host connection closed.'
    signalingStore.state = 'disconnected'
    roomStore.updateRoomStatus('disconnected')
    await flushPromises()

    expect(app.text()).toContain('Host Disconnected')
    expect(app.text()).toContain('Return to Home')
    expect(app.text()).not.toContain('Retry connection')

    const returnHomeButton = app
      .findAll('button')
      .find((button) => button.text() === 'Return to Home')

    expect(returnHomeButton).toBeTruthy()

    await returnHomeButton!.trigger('click')
    await flushPromises()

    expect(signalingFns.destroyPeer).toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('joins a room by typing a human-readable room code from the lobby', async () => {
    const app = await mountAt('/')
    const roomStore = useRoomStore()

    await app.get('#room-code').setValue('Amber-Wave-42')
    await app.get('form.home-view__manual-join').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.params.roomId).toBe('amber-wave-42')
    expect(signalingFns.ensureJoiner).toHaveBeenLastCalledWith(
      'amber-wave-42',
      'amber-wave-42'
    )
    expect(roomStore.room?.localMode).toBe('join')
  })

  it('sends a room chat message through the mocked signaling layer', async () => {
    const app = await mountAt('/room/room-deadbeef')

    await app.get('#message-draft').setValue('Hello https://peerjs.com')
    await app.get('button[aria-label="Send message"]').trigger('click')
    await flushPromises()

    expect(signalingFns.sendDraftMessage).toHaveBeenCalled()
    expect(app.text()).toContain('Hello https://peerjs.com/')
    expect(app.find('a[href="https://peerjs.com/"]').exists()).toBe(true)
  })

  it('keeps host file upload enabled when no other members are connected', async () => {
    const app = await mountAt('/room/room-deadbeef')

    expect(
      app.get('button[aria-label="Attach files"]').attributes('disabled')
    ).toBeUndefined()
  })
})
