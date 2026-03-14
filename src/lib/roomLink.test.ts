import { describe, expect, it } from 'vitest'
import {
  buildShareUrl,
  getHostPeerIdFromQuery,
  getTransferTransportFromQuery,
} from '@/lib/roomLink'

describe('roomLink helpers', () => {
  it('builds a share url for server-side contexts', () => {
    expect(buildShareUrl(' Amber-Blaze-12 ', ' Echo-Frost-34 ', true)).toBe(
      '/room/amber-blaze-12?host=echo-frost-34&transport=backend-relay'
    )
  })

  it('parses and normalizes invite query values', () => {
    expect(getHostPeerIdFromQuery(' Echo-Frost-34 ')).toBe('echo-frost-34')
    expect(getHostPeerIdFromQuery('   ')).toBeNull()
    expect(getTransferTransportFromQuery('relay')).toBe('backend-relay')
    expect(getTransferTransportFromQuery(' direct ')).toBe('webrtc')
    expect(getTransferTransportFromQuery('smtp')).toBeNull()
  })
})
