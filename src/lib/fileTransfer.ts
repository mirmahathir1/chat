import { createId } from '@/lib/id'
import type { TransferFile } from '@/types/chat'

export const maxTransferFiles = 500
export const maxTransferFileBytes = Number.POSITIVE_INFINITY
export const maxTransferTotalBytes = Number.POSITIVE_INFINITY
export const transferChunkBytes = 12 * 1024

export interface TransferValidationResult {
  files: File[] | null
  error: string | null
  totalBytes: number
}

export function validateTransferFiles(files: File[]) {
  const selectedFiles = files.filter((file) => file.size > 0)

  if (selectedFiles.length === 0) {
    return {
      files: null,
      error: 'Choose at least one non-empty file to share.',
      totalBytes: 0,
    } satisfies TransferValidationResult
  }

  if (selectedFiles.length > maxTransferFiles) {
    return {
      files: null,
      error: `Share up to ${maxTransferFiles} files at a time.`,
      totalBytes: 0,
    } satisfies TransferValidationResult
  }

  const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0)

  return {
    files: selectedFiles,
    error: null,
    totalBytes,
  } satisfies TransferValidationResult
}

export function createTransferFiles(files: ArrayLike<Pick<File, 'name' | 'size' | 'type'>>) {
  return Array.from(files).map((file) => ({
    id: createId('file'),
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
  })) satisfies TransferFile[]
}

export async function readFileInChunks(
  file: File,
  onChunk: (chunk: ArrayBuffer, chunkIndex: number, totalChunks: number) => Promise<void> | void
) {
  const totalChunks = Math.max(1, Math.ceil(file.size / transferChunkBytes))

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * transferChunkBytes
    const end = Math.min(file.size, start + transferChunkBytes)
    const chunk = await file.slice(start, end).arrayBuffer()

    await onChunk(chunk, chunkIndex, totalChunks)

    if ((chunkIndex + 1) % 8 === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  }
}

export function assembleTransferBlob(
  chunks: ArrayBuffer[],
  mimeType: string
) {
  return new Blob(chunks, {
    type: mimeType || 'application/octet-stream',
  })
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
