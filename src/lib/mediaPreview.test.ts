import { describe, expect, it } from 'vitest'
import {
  getMimeTypePreviewKind,
  isTransferFilePreviewable,
  resolveTransferFilePreviewUrl,
} from '@/lib/mediaPreview'

describe('mediaPreview helpers', () => {
  it('detects previewable image and video mime types', () => {
    expect(getMimeTypePreviewKind('image/png')).toBe('image')
    expect(getMimeTypePreviewKind(' VIDEO/MP4 ')).toBe('video')
    expect(getMimeTypePreviewKind('application/pdf')).toBeNull()
  })

  it('resolves local urls and checks preview availability', () => {
    expect(
      resolveTransferFilePreviewUrl({
        previewUrl: 'blob:preview',
        downloadUrl: 'blob:download',
      })
    ).toBe('blob:preview')

    expect(
      isTransferFilePreviewable({
        mimeType: 'image/jpeg',
        previewUrl: 'blob:preview',
      })
    ).toBe(true)

    expect(
      isTransferFilePreviewable({
        mimeType: 'video/mp4',
        downloadUrl: 'blob:download',
      })
    ).toBe(true)

    expect(
      isTransferFilePreviewable({
        mimeType: 'image/jpeg',
      })
    ).toBe(false)

    expect(
      isTransferFilePreviewable({
        mimeType: 'text/plain',
        downloadUrl: 'blob:download',
      })
    ).toBe(false)
  })
})
