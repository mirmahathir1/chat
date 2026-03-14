import { normalizeTransfer } from '@/lib/transferTransport'
import { mergeLocalFileUrls, stripLocalFileUrls } from '@/lib/transferFiles'
import type { FileTransfer, TransferDirection } from '@/types/chat'

export function buildTransferHistorySnapshot(transfers: FileTransfer[]) {
  return transfers
    .filter((transfer) => transfer.status === 'completed')
    .map((transfer) => ({
      ...transfer,
      files: stripLocalFileUrls(transfer.files),
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
      ...normalizeTransfer(localTransfer ?? remoteTransfer),
      ...normalizeTransfer(remoteTransfer),
      direction,
      files: mergeLocalFileUrls(localTransfer?.files ?? [], remoteTransfer.files),
    }
  })
  const localOnlyTransfers = localTransfers.filter(
    (transfer) => !remoteTransferIds.has(transfer.id)
  )

  return [...mergedTransfers, ...localOnlyTransfers.map(normalizeTransfer)].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt)
  )
}
