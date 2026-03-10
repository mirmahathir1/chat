import { describe, expect, it } from 'vitest'
import { formatTimeLabel } from '@/lib/time'

describe('formatTimeLabel', () => {
  it('returns a readable time label for ISO timestamps', () => {
    const label = formatTimeLabel('2026-03-10T12:34:00.000Z')

    expect(label.length).toBeGreaterThan(0)
  })
})
