import type { FileTransfer, TransferFile } from '@/types/chat'

export function buildReplayTransferFiles(files: TransferFile[]) {
  return files.map(({ downloadUrl, ...file }) => file)
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
