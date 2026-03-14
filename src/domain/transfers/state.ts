import { normalizeTransfer } from '@/lib/transferTransport'
import type {
  FileTransfer,
  TransferFile,
  TransferTransport,
} from '@/types/chat'

export function upsertTransfer(
  transfers: FileTransfer[],
  transfer: FileTransfer
): FileTransfer[] {
  const normalizedTransfer = normalizeTransfer(transfer)
  const existingIndex = transfers.findIndex(
    (currentTransfer) => currentTransfer.id === normalizedTransfer.id
  )

  if (existingIndex === -1) {
    return [normalizedTransfer, ...transfers].slice(0, 20)
  }

  return transfers.map((currentTransfer, index) =>
    index === existingIndex
      ? normalizeTransfer({ ...currentTransfer, ...normalizedTransfer })
      : currentTransfer
  )
}

export function updateTransferProgress(
  transfers: FileTransfer[],
  transferId: string,
  progress: number,
  status: FileTransfer['status'] = 'transferring',
  bytesPerSecond?: number
): FileTransfer[] {
  const transfer = transfers.find(
    (currentTransfer) => currentTransfer.id === transferId
  )

  if (!transfer) {
    return transfers
  }

  return upsertTransfer(transfers, {
    ...transfer,
    status,
    progress: Math.max(0, Math.min(100, progress)),
    bytesPerSecond:
      status === 'transferring'
        ? (bytesPerSecond ?? transfer.bytesPerSecond)
        : undefined,
    error: undefined,
  })
}

export function completeTransfer(
  transfers: FileTransfer[],
  transferId: string,
  files?: TransferFile[]
): FileTransfer[] {
  const transfer = transfers.find(
    (currentTransfer) => currentTransfer.id === transferId
  )

  if (!transfer) {
    return transfers
  }

  return upsertTransfer(transfers, {
    ...transfer,
    files: files ?? transfer.files,
    status: 'completed',
    progress: 100,
    bytesPerSecond: undefined,
    error: undefined,
  })
}

export function failTransfer(
  transfers: FileTransfer[],
  transferId: string,
  error: string
): FileTransfer[] {
  const transfer = transfers.find(
    (currentTransfer) => currentTransfer.id === transferId
  )

  if (!transfer) {
    return transfers
  }

  return upsertTransfer(transfers, {
    ...transfer,
    status: 'failed',
    bytesPerSecond: undefined,
    error,
  })
}

export function cancelTransfer(
  transfers: FileTransfer[],
  transferId: string
): FileTransfer[] {
  const transfer = transfers.find(
    (currentTransfer) => currentTransfer.id === transferId
  )

  if (!transfer) {
    return transfers
  }

  return upsertTransfer(transfers, {
    ...transfer,
    status: 'cancelled',
    progress: 0,
    bytesPerSecond: undefined,
    error: undefined,
  })
}

export function failTransfersForPeer(
  transfers: FileTransfer[],
  peerId: string,
  error: string
): FileTransfer[] {
  return transfers.map((transfer) => {
    if (transfer.peerId !== peerId || transfer.status === 'completed') {
      return transfer
    }

    return {
      ...transfer,
      status: 'failed',
      bytesPerSecond: undefined,
      error,
    }
  })
}

export function normalizeTransfers(transfers: FileTransfer[]): FileTransfer[] {
  return transfers.map(normalizeTransfer)
}

export function setTransferTransport(
  transfers: FileTransfer[],
  transferId: string,
  transport: TransferTransport
): FileTransfer[] {
  const transfer = transfers.find(
    (currentTransfer) => currentTransfer.id === transferId
  )

  if (!transfer) {
    return transfers
  }

  return upsertTransfer(transfers, {
    ...transfer,
    transport,
  })
}
