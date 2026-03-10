import { describe, expect, it } from 'vitest'
import {
  buildSelectionFromFileList,
  prepareSelectionForUpload,
} from '@/lib/uploadSelection'

describe('uploadSelection helpers', () => {
  it('builds a plain file selection from a file list', () => {
    const fileA = new File(['alpha'], 'alpha.txt', { type: 'text/plain' })
    const fileB = new File(['beta'], 'beta.txt', { type: 'text/plain' })
    const selection = buildSelectionFromFileList([fileA, fileB])

    expect(selection.entries).toHaveLength(2)
    expect(selection.folderCount).toBe(0)
    expect(selection.looseFileCount).toBe(2)
    expect(selection.isSinglePlainFile).toBe(false)
  })

  it('detects a dropped folder selection from relative file paths', () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'docs/hello.txt',
    })

    const selection = buildSelectionFromFileList([file])

    expect(selection.folderCount).toBe(1)
    expect(selection.itemCount).toBe(1)
    expect(selection.isSingleFolder).toBe(true)
    expect(selection.entries[0]?.archivePath).toBe('docs/hello.txt')
  })

  it('zips a multi-file selection into a single archive', async () => {
    const selection = buildSelectionFromFileList([
      new File(['alpha'], 'alpha.txt', { type: 'text/plain' }),
      new File(['beta'], 'beta.txt', { type: 'text/plain' }),
    ])

    const preparedUpload = await prepareSelectionForUpload(selection, 'zip')

    expect(preparedUpload.files).toHaveLength(1)
    expect(preparedUpload.files[0]?.name).toMatch(/\.zip$/)
    expect(preparedUpload.files[0]?.size).toBeGreaterThan(0)
    await preparedUpload.cleanup?.()
  })
})
