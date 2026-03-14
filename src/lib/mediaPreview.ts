import type { TransferFile } from '@/types/chat'

export type TransferFilePreviewKind = 'image' | 'video'

export function getMimeTypePreviewKind(
  mimeType: string | null | undefined
): TransferFilePreviewKind | null {
  const normalizedMimeType = String(mimeType ?? '').trim().toLowerCase()

  if (normalizedMimeType.startsWith('image/')) {
    return 'image'
  }

  if (normalizedMimeType.startsWith('video/')) {
    return 'video'
  }

  return null
}

export function getTransferFilePreviewKind(
  file: Pick<TransferFile, 'mimeType'>
) {
  return getMimeTypePreviewKind(file.mimeType)
}

export function resolveTransferFilePreviewUrl(
  file: Pick<TransferFile, 'previewUrl' | 'downloadUrl'>
) {
  return file.previewUrl ?? file.downloadUrl ?? null
}

export function isTransferFilePreviewable(
  file: Pick<TransferFile, 'mimeType' | 'previewUrl' | 'downloadUrl'>
) {
  return (
    getTransferFilePreviewKind(file) !== null &&
    resolveTransferFilePreviewUrl(file) !== null
  )
}

export function createLocalTransferPreviewUrl(file: File) {
  if (
    getMimeTypePreviewKind(file.type) === null ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return undefined
  }

  return URL.createObjectURL(file)
}
