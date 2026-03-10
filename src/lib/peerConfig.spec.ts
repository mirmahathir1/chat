import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPeerOptions } from '@/lib/peerConfig'

describe('getPeerOptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('falls back to defaults when workflow env vars are blank', () => {
    vi.stubEnv('VITE_PEER_PORT', '')
    vi.stubEnv('VITE_PEER_SECURE', '')
    vi.stubEnv('VITE_PEER_DEBUG', '')

    expect(getPeerOptions()).toMatchObject({
      debug: 2,
      port: 443,
      secure: true,
    })
  })

  it('keeps explicit numeric and boolean overrides', () => {
    vi.stubEnv('VITE_PEER_PORT', '9000')
    vi.stubEnv('VITE_PEER_SECURE', 'false')
    vi.stubEnv('VITE_PEER_DEBUG', '1')

    expect(getPeerOptions()).toMatchObject({
      debug: 1,
      port: 9000,
      secure: false,
    })
  })
})
