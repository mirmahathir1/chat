import type {
  CreateRelayTransferRequest,
  RelayChunkRecord,
  RelaySession,
  StoreRelayChunkInput,
} from '../types/relay.js'

export interface RelayChunkWithPayload {
  metadata: RelayChunkRecord
  payload: Buffer
}

export interface RelayChunkStoreStats {
  pendingTransfers: number
  storedChunks: number
}

export interface RelaySessionStoreStats {
  cancelledSessions: number
  completedSessions: number
  expiredSessions: number
  readySessions: number
  totalSessions: number
}

export interface RelayChunkStore {
  acknowledgeChunk(
    transferId: string,
    fileId: string,
    chunkIndex: number
  ): RelayChunkRecord | null
  countPendingChunks(transferId: string): number
  deleteTransferChunks(transferId: string): number
  getNextChunk(
    transferId: string,
    recipientPeerId: string,
    afterChunkIndex: number
  ): RelayChunkWithPayload | null
  getStats(): RelayChunkStoreStats
  storeChunk(input: StoreRelayChunkInput): RelayChunkRecord
  sweepExpired(now?: number): number
}

export interface RelaySessionStoreContract {
  createSession(input: CreateRelayTransferRequest): RelaySession
  getSession(transferId: string): RelaySession | null
  getStats(): RelaySessionStoreStats
  markCancelled(transferId: string, reason?: string): RelaySession
  markCompleted(transferId: string): RelaySession
  sweepExpired(now?: number): number
  touchSession(transferId: string): RelaySession | null
}
