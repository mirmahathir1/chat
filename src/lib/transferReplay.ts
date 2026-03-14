import type { FileTransfer, TransferFile } from '@/types/chat'
import { stripLocalFileUrls } from '@/lib/transferFiles'

export function buildReplayTransferFiles(files: TransferFile[]) {
  return stripLocalFileUrls(files)
}

export function listTransfersToReplay(
  transfers: FileTransfer[],
  recipientPeerId: string
) {
  return transfers
    .filter(
      (transfer) =>
        transfer.status === 'completed' && transfer.senderId !== recipientPeerId
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function hasReplayableFileSet(
  transfer: FileTransfer | undefined,
  files: File[] | undefined
) {
  return !!transfer && !!files && files.length === transfer.files.length
}
