import type {
  RelayChunkStore,
  RelayChunkStoreStats,
} from './relay-store.js'
import type { RelayChunkRecord, StoreRelayChunkInput } from '../types/relay.js'

interface ChunkStoreConfig {
  chunkTtlMs: number
  maxChunkBytes: number
}

interface StoredChunk extends RelayChunkRecord {
  payload: Buffer
}

export class InMemoryChunkStore implements RelayChunkStore {
  private readonly chunks = new Map<string, StoredChunk>()

  constructor(private readonly config: ChunkStoreConfig) {}

  storeChunk(input: StoreRelayChunkInput) {
    if (input.payload.byteLength > this.config.maxChunkBytes) {
      throw new Error(
        `Chunk exceeded the configured max size of ${this.config.maxChunkBytes} bytes.`
      )
    }

    const now = Date.now()
    const chunk: StoredChunk = {
      chunkIndex: input.chunkIndex,
      createdAt: toIsoString(now),
      expiresAt: toIsoString(now + this.config.chunkTtlMs),
      fileId: input.fileId,
      payload: input.payload,
      recipientPeerId: input.recipientPeerId,
      senderPeerId: input.senderPeerId,
      sessionId: input.sessionId,
      sizeBytes: input.payload.byteLength,
      totalChunks: input.totalChunks,
      transferId: input.transferId,
    }

    this.chunks.set(buildChunkKey(input.transferId, input.fileId, input.chunkIndex), chunk)

    return toChunkRecord(chunk)
  }

  getNextChunk(transferId: string, recipientPeerId: string, afterChunkIndex: number) {
    const now = Date.now()
    let nextChunk: StoredChunk | null = null

    for (const chunk of this.chunks.values()) {
      if (chunk.transferId !== transferId || chunk.recipientPeerId !== recipientPeerId) {
        continue
      }

      if (Date.parse(chunk.expiresAt) <= now) {
        continue
      }

      if (chunk.chunkIndex <= afterChunkIndex) {
        continue
      }

      if (!nextChunk || chunk.chunkIndex < nextChunk.chunkIndex) {
        nextChunk = chunk
      }
    }

    if (!nextChunk) {
      return null
    }

    return {
      metadata: toChunkRecord(nextChunk),
      payload: nextChunk.payload,
    }
  }

  acknowledgeChunk(transferId: string, fileId: string, chunkIndex: number) {
    const key = buildChunkKey(transferId, fileId, chunkIndex)
    const chunk = this.chunks.get(key)

    if (!chunk) {
      return null
    }

    this.chunks.delete(key)

    return toChunkRecord(chunk)
  }

  countPendingChunks(transferId: string) {
    let count = 0

    for (const chunk of this.chunks.values()) {
      if (chunk.transferId === transferId) {
        count += 1
      }
    }

    return count
  }

  getStats(): RelayChunkStoreStats {
    const pendingTransfers = new Set<string>()

    for (const chunk of this.chunks.values()) {
      pendingTransfers.add(chunk.transferId)
    }

    return {
      pendingTransfers: pendingTransfers.size,
      storedChunks: this.chunks.size,
    }
  }

  deleteTransferChunks(transferId: string) {
    let deletedCount = 0

    for (const [key, chunk] of this.chunks.entries()) {
      if (chunk.transferId !== transferId) {
        continue
      }

      this.chunks.delete(key)
      deletedCount += 1
    }

    return deletedCount
  }

  sweepExpired(now = Date.now()) {
    let expiredChunks = 0

    for (const [key, chunk] of this.chunks.entries()) {
      if (Date.parse(chunk.expiresAt) > now) {
        continue
      }

      this.chunks.delete(key)
      expiredChunks += 1
    }

    return expiredChunks
  }
}

function buildChunkKey(transferId: string, fileId: string, chunkIndex: number) {
  return `${transferId}:${fileId}:${chunkIndex}`
}

function toChunkRecord(chunk: StoredChunk): RelayChunkRecord {
  return {
    chunkIndex: chunk.chunkIndex,
    createdAt: chunk.createdAt,
    expiresAt: chunk.expiresAt,
    fileId: chunk.fileId,
    recipientPeerId: chunk.recipientPeerId,
    senderPeerId: chunk.senderPeerId,
    sessionId: chunk.sessionId,
    sizeBytes: chunk.sizeBytes,
    totalChunks: chunk.totalChunks,
    transferId: chunk.transferId,
  }
}

function toIsoString(timestamp: number) {
  return new Date(timestamp).toISOString()
}
