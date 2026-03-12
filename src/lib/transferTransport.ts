import type { FileTransfer, TransferTransport } from '@/types/chat'

export function normalizeTransferTransport(
  transport: TransferTransport | null | undefined
): TransferTransport {
  return transport === 'backend-relay' ? 'backend-relay' : 'webrtc'
}

export function getTransferTransportLabel(
  transport: TransferTransport | null | undefined
) {
  return normalizeTransferTransport(transport) === 'backend-relay'
    ? 'Backend relay'
    : 'WebRTC'
}

export function normalizeTransfer(transfer: FileTransfer): FileTransfer {
  return {
    ...transfer,
    transport: normalizeTransferTransport(transfer.transport),
  }
}
