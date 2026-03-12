export type RelaySessionStatus = 'ready' | 'completed' | 'cancelled' | 'expired'

export interface RelayFileDescriptor {
  id: string
  name: string
  size: number
  type: string | null
}

export interface CreateRelayTransferRequest {
  files: RelayFileDescriptor[]
  recipientPeerId: string
  roomId: string
  senderPeerId: string
  totalBytes: number
}

export interface RelaySession {
  cancelReason?: string
  cancelledAt?: string
  completedAt?: string
  createdAt: string
  expiresAt: string
  files: RelayFileDescriptor[]
  recipientPeerId: string
  roomId: string
  senderPeerId: string
  sessionId: string
  status: RelaySessionStatus
  totalBytes: number
  transferId: string
  updatedAt: string
}

export interface StoreRelayChunkInput {
  chunkIndex: number
  fileId: string
  payload: Buffer
  recipientPeerId: string
  senderPeerId: string
  sessionId: string
  totalChunks: number
  transferId: string
}

export interface RelayChunkRecord {
  chunkIndex: number
  createdAt: string
  expiresAt: string
  fileId: string
  recipientPeerId: string
  senderPeerId: string
  sessionId: string
  sizeBytes: number
  totalChunks: number
  transferId: string
}

export interface RelayChunkAckRequest {
  fileId: string
  peerId: string
  sessionId: string
}

export interface RelayCompleteTransferRequest {
  peerId: string
  sessionId: string
}

export interface RelayTransferCancelRequest {
  peerId: string
  reason?: string
  sessionId: string
}
