import type {
  AckBackendRelayChunkRequest,
  AckBackendRelayChunkResponse,
  BackendRelayClient,
  CancelBackendRelayTransferRequest,
  CancelBackendRelayTransferResponse,
  CompleteBackendRelayTransferRequest,
  CompleteBackendRelayTransferResponse,
  CreateBackendRelayRoomEventRequest,
  CreateBackendRelayRoomEventResponse,
  CreateBackendRelayTransferRequest,
  CreateBackendRelayTransferResponse,
  GetBackendRelayRoomEventCursorRequest,
  GetBackendRelayRoomEventCursorResponse,
  PollBackendRelayChunkRequest,
  PollBackendRelayChunkResponse,
  PollBackendRelayRoomEventsRequest,
  PollBackendRelayRoomEventsResponse,
  UploadBackendRelayChunkRequest,
  UploadBackendRelayChunkResponse,
} from '@/lib/backendRelayTypes'

const defaultLocalRelayBaseUrl = 'http://localhost:8787'

interface RelayEnvironment {
  readonly DEV?: boolean
  readonly VITE_RELAY_BACKEND_URL?: string
}

function normalizeBaseUrl(value: string | undefined | null) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return null
  }

  return trimmed.replace(/\/+$/, '')
}

export function getBackendRelayBaseUrl(
  env: RelayEnvironment = import.meta.env
) {
  const explicitBaseUrl = normalizeBaseUrl(env.VITE_RELAY_BACKEND_URL)

  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  if (env.DEV) {
    return defaultLocalRelayBaseUrl
  }

  return null
}

export function hasConfiguredBackendRelay(
  env: RelayEnvironment = import.meta.env
) {
  return getBackendRelayBaseUrl(env) !== null
}

export function createBackendRelayClient(
  baseUrl = getBackendRelayBaseUrl()
): BackendRelayClient {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl)

  async function request(path: string, init?: RequestInit) {
    if (!resolvedBaseUrl) {
      throw new Error(
        'Backend relay is not configured. Set VITE_RELAY_BACKEND_URL first.'
      )
    }

    const response = await fetch(new URL(path, `${resolvedBaseUrl}/`), init)

    if (response.ok) {
      return response
    }

    throw new Error(await readErrorDetail(response))
  }

  async function requestJson<T>(path: string, init?: RequestInit) {
    const response = await request(path, init)

    return (await response.json()) as T
  }

  return {
    baseUrl: resolvedBaseUrl,
    isConfigured: resolvedBaseUrl !== null,
    acknowledgeChunk(requestBody: AckBackendRelayChunkRequest) {
      return requestJson<AckBackendRelayChunkResponse>(
        `/api/transfers/${requestBody.transferId}/chunks/${requestBody.chunkIndex}/ack`,
        {
          body: JSON.stringify({
            fileId: requestBody.fileId,
            peerId: requestBody.peerId,
            sessionId: requestBody.sessionId,
          }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      )
    },
    cancelTransfer(requestBody: CancelBackendRelayTransferRequest) {
      return requestJson<CancelBackendRelayTransferResponse>(
        `/api/transfers/${requestBody.transferId}/cancel`,
        {
          body: JSON.stringify({
            peerId: requestBody.peerId,
            reason: requestBody.reason,
            sessionId: requestBody.sessionId,
          }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      )
    },
    completeTransfer(requestBody: CompleteBackendRelayTransferRequest) {
      return requestJson<CompleteBackendRelayTransferResponse>(
        `/api/transfers/${requestBody.transferId}/complete`,
        {
          body: JSON.stringify({
            peerId: requestBody.peerId,
            sessionId: requestBody.sessionId,
          }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      )
    },
    createTransfer(requestBody: CreateBackendRelayTransferRequest) {
      return requestJson<CreateBackendRelayTransferResponse>('/api/transfers', {
        body: JSON.stringify(requestBody),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
    },
    getRoomEventCursor(requestBody: GetBackendRelayRoomEventCursorRequest) {
      return requestJson<GetBackendRelayRoomEventCursorResponse>(
        `/api/rooms/${encodeURIComponent(requestBody.roomId)}/events/cursor`,
        {
          method: 'GET',
        }
      )
    },
    async pollNextChunk(requestBody: PollBackendRelayChunkRequest) {
      const response = await request(
        `/api/transfers/${requestBody.transferId}/chunks/next?sessionId=${encodeURIComponent(requestBody.sessionId)}&peerId=${encodeURIComponent(requestBody.peerId)}&after=${requestBody.afterChunkIndex}`,
        {
          method: 'GET',
        }
      )

      if (response.status === 204) {
        return {
          status: 'idle',
          transferState: response.headers.get('x-relay-transfer-state'),
        } satisfies PollBackendRelayChunkResponse
      }

      return {
        status: 'chunk',
        value: {
          chunkIndex: Number.parseInt(
            response.headers.get('x-relay-chunk-index') ?? '-1',
            10
          ),
          data: await response.arrayBuffer(),
          expiresAt: response.headers.get('x-relay-expires-at') ?? '',
          fileId: response.headers.get('x-relay-file-id') ?? '',
          sizeBytes: Number.parseInt(
            response.headers.get('x-relay-chunk-bytes') ?? '0',
            10
          ),
          totalChunks: Number.parseInt(
            response.headers.get('x-relay-total-chunks') ?? '0',
            10
          ),
          transferState: response.headers.get('x-relay-transfer-state') ?? '',
        },
      } satisfies PollBackendRelayChunkResponse
    },
    pollRoomEvents(requestBody: PollBackendRelayRoomEventsRequest) {
      return requestJson<PollBackendRelayRoomEventsResponse>(
        `/api/rooms/${encodeURIComponent(requestBody.roomId)}/events?peerId=${encodeURIComponent(requestBody.peerId)}&after=${requestBody.afterEventId}`,
        {
          method: 'GET',
          signal: requestBody.signal,
        }
      )
    },
    publishRoomEvent(requestBody: CreateBackendRelayRoomEventRequest) {
      return requestJson<CreateBackendRelayRoomEventResponse>(
        `/api/rooms/${encodeURIComponent(requestBody.roomId)}/events`,
        {
          body: JSON.stringify({
            message: requestBody.message,
            senderPeerId: requestBody.senderPeerId,
            targetPeerId: requestBody.targetPeerId ?? null,
          }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      )
    },
    uploadChunk(requestBody: UploadBackendRelayChunkRequest) {
      return requestJson<UploadBackendRelayChunkResponse>(
        `/api/transfers/${requestBody.transferId}/chunks/${requestBody.chunkIndex}`,
        {
          body: toBodyInit(requestBody.data),
          headers: {
            'content-type': 'application/octet-stream',
            'x-relay-file-id': requestBody.fileId,
            'x-relay-sender-peer-id': requestBody.senderPeerId,
            'x-relay-session-id': requestBody.sessionId,
            'x-relay-total-chunks': String(requestBody.totalChunks),
          },
          method: 'POST',
        }
      )
    },
  }
}

function toBodyInit(data: ArrayBuffer | Blob | BufferSource): BodyInit {
  if (data instanceof ArrayBuffer || data instanceof Blob) {
    return data
  }

  return new Blob([data])
}

async function readErrorDetail(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string }

    if (payload.error) {
      return payload.error
    }
  } catch {
    return `Relay backend request failed with status ${response.status}.`
  }

  return `Relay backend request failed with status ${response.status}.`
}
