export interface BackendRelayFileDescriptor {
  id: string
  name: string
  size: number
  type: string | null
}

export interface BackendRelayUploadedFileDescriptor {
  contentType: string
  fileId: string
  pathname: string
  size: number
}

export type BackendRelayRoomEventMessage = {
  type: string
} & Record<string, unknown>

export interface UploadBackendRelayFileRequest {
  file: File
  fileId: string
  onProgress?: (loadedBytes: number, totalBytes: number) => void
  signal?: AbortSignal
  transferId: string
}

export interface UploadBackendRelayFileResponse {
  contentType: string
  downloadUrl: string
  etag: string
  fileId: string
  pathname: string
  size: number
  url: string
}

export interface DownloadBackendRelayFileRequest {
  fileId: string
  fileName: string
  mimeType: string
  onProgress?: (loadedBytes: number, totalBytes: number) => void
  pathname: string
  signal?: AbortSignal
  transferId: string
}

export interface DownloadBackendRelayFileResponse {
  file: File
}

export interface AcknowledgeBackendRelayFileRequest {
  fileId: string
  pathname: string
  transferId: string
}

export interface AcknowledgeBackendRelayFileResponse {
  fileId: string
  status: 'acknowledged'
  transferId: string
}

export interface CancelBackendRelayTransferRequest {
  pathnames?: string[]
  peerId?: string
  reason?: string
  transferId: string
}

export interface CancelBackendRelayTransferResponse {
  deletedCount?: number
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
  acknowledgeFile(
    request: AcknowledgeBackendRelayFileRequest
  ): Promise<AcknowledgeBackendRelayFileResponse>
  cancelTransfer(
    request: CancelBackendRelayTransferRequest
  ): Promise<CancelBackendRelayTransferResponse>
  downloadFile(
    request: DownloadBackendRelayFileRequest
  ): Promise<DownloadBackendRelayFileResponse>
  getRoomEventCursor(
    request: GetBackendRelayRoomEventCursorRequest
  ): Promise<GetBackendRelayRoomEventCursorResponse>
  pollRoomEvents(
    request: PollBackendRelayRoomEventsRequest
  ): Promise<PollBackendRelayRoomEventsResponse>
  publishRoomEvent(
    request: CreateBackendRelayRoomEventRequest
  ): Promise<CreateBackendRelayRoomEventResponse>
  uploadFile(
    request: UploadBackendRelayFileRequest
  ): Promise<UploadBackendRelayFileResponse>
}
