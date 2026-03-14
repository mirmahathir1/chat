import type { TransferFile } from '@/types/chat'

export function stripLocalFileUrls(files: TransferFile[]) {
  return files.map((file) => {
    const nextFile = { ...file }

    delete nextFile.downloadUrl
    delete nextFile.previewUrl

    return nextFile
  })
}

export function mergeLocalFileUrls(
  localFiles: TransferFile[],
  remoteFiles: TransferFile[]
) {
  const localFilesById = new Map(localFiles.map((file) => [file.id, file]))

  return remoteFiles.map((file) => {
    const localFile = localFilesById.get(file.id)

    if (!localFile?.downloadUrl && !localFile?.previewUrl) {
      return file
    }

    return {
      ...file,
      downloadUrl: localFile.downloadUrl,
      previewUrl: localFile.previewUrl,
    }
  })
}
