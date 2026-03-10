import { describe, expect, it } from 'vitest'
import {
  assembleTransferBlob,
  createTransferFiles,
  transferChunkBytes,
  validateTransferFiles,
} from '@/lib/fileTransfer'

describe('fileTransfer helpers', () => {
  it('builds transfer metadata from files', () => {
    const files = [
      new File(['alpha'], 'alpha.txt', { type: 'text/plain' }),
      new File(['beta'], 'beta.txt', { type: 'text/plain' }),
    ]

    const meta = createTransferFiles(files)

    expect(meta).toHaveLength(2)
    expect(meta[0]?.name).toBe('alpha.txt')
    expect(meta[1]?.mimeType).toBe('text/plain')
  })

  it('validates transfer size limits', () => {
    const file = new File(['ok'], 'ok.txt', { type: 'text/plain' })
    const result = validateTransferFiles([file])

    expect(result.error).toBeNull()
    expect(result.files).toHaveLength(1)
  })

  it('assembles chunks back into a blob', async () => {
    const blob = assembleTransferBlob(
      [new TextEncoder().encode('hello ').buffer, new TextEncoder().encode('world').buffer],
      'text/plain'
    )

    expect(blob.size).toBeGreaterThan(0)
    expect(await blob.text()).toBe('hello world')
    expect(transferChunkBytes).toBeGreaterThan(0)
  })
})
