export interface BackendRelayFileDescriptor {
  id: string
  name: string
  size: number
  type: string | null
}

export type BackendRelayRoomEventMessage = {
  type: string
} & Record<string, unknown>

export interface CreateBackendRelayTransferRequest {
  files: BackendRelayFileDescriptor[]
  recipientPeerId: string
  roomId: string
  senderPeerId: string
  totalBytes: number
}

export interface CreateBackendRelayTransferResponse {
  endpoints: {
    ackPathTemplate: string
    cancelPath: string
    completePath: string
    nextChunkPath: string
    uploadPathTemplate: string
  }
  expiresAt: string
  maxChunkBytes: number
  pollIntervalMs: number
  sessionId: string
  status: 'ready'
  transferId: string
}

export interface UploadBackendRelayChunkRequest {
  chunkIndex: number
  data: ArrayBuffer | Blob | BufferSource
  fileId: string
  senderPeerId: string
  sessionId: string
  totalChunks: number
  transferId: string
}

export interface UploadBackendRelayChunkResponse {
  chunkIndex: number
  expiresAt: string
  sizeBytes: number
  status: 'stored'
  transferId: string
}

export interface PollBackendRelayChunkRequest {
  afterChunkIndex: number
  peerId: string
  sessionId: string
  transferId: string
}

export interface BackendRelayChunkPayload {
  chunkIndex: number
  data: ArrayBuffer
  expiresAt: string
  fileId: string
  sizeBytes: number
  totalChunks: number
  transferState: string
}

export type PollBackendRelayChunkResponse =
  | {
      status: 'chunk'
      value: BackendRelayChunkPayload
    }
  | {
      status: 'idle'
      transferState: string | null
    }

export interface AckBackendRelayChunkRequest {
  chunkIndex: number
  fileId: string
  peerId: string
  sessionId: string
  transferId: string
}

export interface AckBackendRelayChunkResponse {
  chunkIndex: number
  pendingChunks: number
  status: 'acknowledged'
  transferId: string
}

export interface CompleteBackendRelayTransferRequest {
  peerId: string
  sessionId: string
  transferId: string
}

export interface CompleteBackendRelayTransferResponse {
  expiresAt: string
  pendingChunks: number
  status: 'completed'
  transferId: string
}

export interface CancelBackendRelayTransferRequest {
  peerId: string
  reason?: string
  sessionId: string
  transferId: string
}

export interface CancelBackendRelayTransferResponse {
  reason: string | null
  status: 'cancelled'
  transferId: string
}

export interface CreateBackendRelayRoomEventRequest {
  message: BackendRelayRoomEventMessage
  roomId: string
  senderPeerId: string
  targetPeerId?: string | null
}

export interface CreateBackendRelayRoomEventResponse {
  eventId: number
  roomId: string
  status: 'queued'
}

export interface GetBackendRelayRoomEventCursorRequest {
  roomId: string
}

export interface GetBackendRelayRoomEventCursorResponse {
  latestEventId: number
  roomId: string
}

export interface PollBackendRelayRoomEventsRequest {
  afterEventId: number
  peerId: string
  roomId: string
  signal?: AbortSignal
}

export interface BackendRelayRoomEvent {
  createdAt: string
  id: number
  message: BackendRelayRoomEventMessage
  roomId: string
  senderPeerId: string
  targetPeerId: string | null
}

export interface PollBackendRelayRoomEventsResponse {
  events: BackendRelayRoomEvent[]
  latestEventId: number
  roomId: string
}

export interface BackendRelayClient {
  readonly baseUrl: string | null
  readonly isConfigured: boolean
  acknowledgeChunk(
    request: AckBackendRelayChunkRequest
  ): Promise<AckBackendRelayChunkResponse>
  cancelTransfer(
    request: CancelBackendRelayTransferRequest
  ): Promise<CancelBackendRelayTransferResponse>
  completeTransfer(
    request: CompleteBackendRelayTransferRequest
  ): Promise<CompleteBackendRelayTransferResponse>
  createTransfer(
    request: CreateBackendRelayTransferRequest
  ): Promise<CreateBackendRelayTransferResponse>
  getRoomEventCursor(
    request: GetBackendRelayRoomEventCursorRequest
  ): Promise<GetBackendRelayRoomEventCursorResponse>
  pollNextChunk(
    request: PollBackendRelayChunkRequest
  ): Promise<PollBackendRelayChunkResponse>
  pollRoomEvents(
    request: PollBackendRelayRoomEventsRequest
  ): Promise<PollBackendRelayRoomEventsResponse>
  publishRoomEvent(
    request: CreateBackendRelayRoomEventRequest
  ): Promise<CreateBackendRelayRoomEventResponse>
  uploadChunk(
    request: UploadBackendRelayChunkRequest
  ): Promise<UploadBackendRelayChunkResponse>
}
