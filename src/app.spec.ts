import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import router from '@/router'
import { useRoomStore } from '@/stores/room'

const signalingFns = vi.hoisted(() => ({
  ensureHost: vi.fn(),
  ensureJoiner: vi.fn(),
  retryJoinConnection: vi.fn(),
  sendDraftMessage: vi.fn(),
  sendFiles: vi.fn(),
  destroyPeer: vi.fn(),
}))

vi.mock('@/stores/signaling', async () => {
  const { defineStore } = await import('pinia')
  const { computed, ref } = await import('vue')

  return {
    useSignalingStore: defineStore('signaling', () => {
      const state = ref<
        'idle' | 'starting' | 'listening' | 'connecting' | 'retrying' | 'connected' | 'disconnected' | 'error'
      >('connected')
      const errorMessage = ref<string | null>(null)
      const retryCount = ref(0)
      const isReady = computed(() => state.value === 'connected')

      return {
        state,
        errorMessage,
        retryCount,
        isReady,
        ensureHost: signalingFns.ensureHost,
        ensureJoiner: signalingFns.ensureJoiner,
        retryJoinConnection: signalingFns.retryJoinConnection,
        sendDraftMessage: signalingFns.sendDraftMessage,
        sendFiles: signalingFns.sendFiles,
        destroyPeer: signalingFns.destroyPeer,
      }
    }),
  }
})

describe('app flows', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    localStorage.clear()
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

  it('creates a hosted room from the home screen', async () => {
    const app = await mountAt('/')

    await app.get('input').setValue('Phase 8 Host')
    await app
      .findAll('button')
      .find((button) => button.text() === 'Create hosted room')!
      .trigger('click')
    await flushPromises()

    const roomStore = useRoomStore()

    expect(router.currentRoute.value.name).toBe('room')
    expect(roomStore.room?.localMode).toBe('host')
    expect(app.text()).toContain('Invite payload')
  })

  it('loads the join-room screen from a scanned room link', async () => {
    const app = await mountAt('/room/room-deadbeef?host=peer-feedcafe')
    const roomStore = useRoomStore()

    expect(signalingFns.ensureJoiner).toHaveBeenCalledWith(
      'room-deadbeef',
      'peer-feedcafe'
    )
    expect(roomStore.room?.localMode).toBe('join')
    expect(app.text()).toContain('This device is connected to the host.')
  })

  it('sends a room chat message through the mocked signaling layer', async () => {
    const app = await mountAt('/room/room-deadbeef')

    await app.get('#message-draft').setValue('Hello https://peerjs.com')
    await app
      .findAll('button')
      .find((button) => button.text() === 'Send message')!
      .trigger('click')
    await flushPromises()

    expect(signalingFns.sendDraftMessage).toHaveBeenCalled()
    expect(app.text()).toContain('Hello https://peerjs.com/')
    expect(app.find('a[href="https://peerjs.com/"]').exists()).toBe(true)
  })
})
