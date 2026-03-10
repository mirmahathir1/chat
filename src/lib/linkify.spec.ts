import { describe, expect, it } from 'vitest'
import { splitTextWithLinks } from '@/lib/linkify'

describe('splitTextWithLinks', () => {
  it('keeps plain text as a single text segment', () => {
    expect(splitTextWithLinks('plain message')).toEqual([
      {
        type: 'text',
        value: 'plain message',
      },
    ])
  })

  it('extracts and normalizes URLs while preserving surrounding text', () => {
    expect(splitTextWithLinks('See https://peerjs.com for details')).toEqual([
      {
        type: 'text',
        value: 'See ',
      },
      {
        type: 'link',
        value: 'https://peerjs.com/',
      },
      {
        type: 'text',
        value: ' for details',
      },
    ])
  })
})
