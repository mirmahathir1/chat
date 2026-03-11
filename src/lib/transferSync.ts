import type { FileTransfer, TransferDirection, TransferFile } from '@/types/chat'

function stripDownloadUrls(files: TransferFile[]) {
  return files.map(({ downloadUrl, ...file }) => file)
}

function mergeTransferFiles(localFiles: TransferFile[], remoteFiles: TransferFile[]) {
  const localFilesById = new Map(localFiles.map((file) => [file.id, file]))

  return remoteFiles.map((file) => {
    const localFile = localFilesById.get(file.id)

    if (!localFile?.downloadUrl) {
      return file
    }

    return {
      ...file,
      downloadUrl: localFile.downloadUrl,
    }
  })
}

export function buildTransferHistorySnapshot(transfers: FileTransfer[]) {
  return transfers
    .filter((transfer) => transfer.status === 'completed')
    .map((transfer) => ({
      ...transfer,
      files: stripDownloadUrls(transfer.files),
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function mergeSyncedTransfers(
  localTransfers: FileTransfer[],
  remoteTransfers: FileTransfer[] | undefined,
  localPeerId?: string | null
) {
  const normalizedRemoteTransfers = Array.isArray(remoteTransfers)
    ? remoteTransfers
    : []
  const localTransfersById = new Map(localTransfers.map((transfer) => [transfer.id, transfer]))
  const remoteTransferIds = new Set(
    normalizedRemoteTransfers.map((transfer) => transfer.id)
  )

  const mergedTransfers = normalizedRemoteTransfers.map((remoteTransfer) => {
    const localTransfer = localTransfersById.get(remoteTransfer.id)
    const direction: TransferDirection =
      localPeerId && remoteTransfer.senderId === localPeerId
        ? 'outgoing'
        : 'incoming'

    return {
      ...(localTransfer ?? remoteTransfer),
      ...remoteTransfer,
      direction,
      files: mergeTransferFiles(localTransfer?.files ?? [], remoteTransfer.files),
    }
  })
  const localOnlyTransfers = localTransfers.filter(
    (transfer) => !remoteTransferIds.has(transfer.id)
  )

  return [...mergedTransfers, ...localOnlyTransfers].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )
}
