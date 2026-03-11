import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNetworkActivityStore } from '@/stores/networkActivity'

describe('useNetworkActivityStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays visible while a tracked activity is in flight and hides after it settles', async () => {
    const networkActivityStore = useNetworkActivityStore()
    let resolveRequest!: () => void

    const request = networkActivityStore.track(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve
        }),
      0
    )

    expect(networkActivityStore.pendingCount).toBe(1)
    expect(networkActivityStore.isActive).toBe(true)

    resolveRequest()
    await request

    expect(networkActivityStore.pendingCount).toBe(1)
    vi.advanceTimersByTime(0)
    expect(networkActivityStore.pendingCount).toBe(0)
    expect(networkActivityStore.isActive).toBe(true)
    vi.advanceTimersByTime(140)

    expect(networkActivityStore.isActive).toBe(false)
  })

  it('shows a short pulse for fire-and-forget network sends', () => {
    const networkActivityStore = useNetworkActivityStore()

    networkActivityStore.pulse(120)

    expect(networkActivityStore.isActive).toBe(true)

    vi.advanceTimersByTime(121)

    expect(networkActivityStore.isActive).toBe(false)
  })
})
