import { upload } from '@vercel/blob/client'
import type {
  AcknowledgeBackendRelayFileRequest,
  AcknowledgeBackendRelayFileResponse,
  BackendRelayClient,
  CancelBackendRelayTransferRequest,
  CancelBackendRelayTransferResponse,
  CreateBackendRelayRoomEventRequest,
  CreateBackendRelayRoomEventResponse,
  DownloadBackendRelayFileRequest,
  DownloadBackendRelayFileResponse,
  GetBackendRelayHealthResponse,
  GetBackendRelayRoomEventCursorRequest,
  GetBackendRelayRoomEventCursorResponse,
  PollBackendRelayRoomEventsRequest,
  PollBackendRelayRoomEventsResponse,
  UploadBackendRelayFileRequest,
  UploadBackendRelayFileResponse,
} from '@/lib/backendRelayTypes'

const defaultLocalRelayBaseUrl = 'http://localhost:8787'
const multipartUploadThresholdBytes = 5 * 1024 * 1024

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
    acknowledgeFile(requestBody: AcknowledgeBackendRelayFileRequest) {
      return requestJson<AcknowledgeBackendRelayFileResponse>(
        `/api/transfers/${requestBody.transferId}/files/${requestBody.fileId}/ack`,
        {
          body: JSON.stringify({
            pathname: requestBody.pathname,
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
            pathnames: requestBody.pathnames ?? [],
            peerId: requestBody.peerId,
            reason: requestBody.reason,
          }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      )
    },
    async downloadFile(requestBody: DownloadBackendRelayFileRequest) {
      const response = await request(
        `/api/transfers/${requestBody.transferId}/files/${requestBody.fileId}?pathname=${encodeURIComponent(requestBody.pathname)}`,
        {
          method: 'GET',
          signal: requestBody.signal,
        }
      )

      return {
        file: await streamResponseToFile(response, requestBody),
      } satisfies DownloadBackendRelayFileResponse
    },
    getHealth() {
      return requestJson<GetBackendRelayHealthResponse>('/api/health', {
        method: 'GET',
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
    async uploadFile(requestBody: UploadBackendRelayFileRequest) {
      if (!resolvedBaseUrl) {
        throw new Error(
          'Backend relay is not configured. Set VITE_RELAY_BACKEND_URL first.'
        )
      }

      const pathname = buildRelayBlobPath(
        requestBody.transferId,
        requestBody.fileId,
        requestBody.file.name
      )
      const result = await upload(pathname, requestBody.file, {
        abortSignal: requestBody.signal,
        access: 'private',
        contentType: requestBody.file.type || undefined,
        handleUploadUrl: new URL(
          `/api/transfers/${requestBody.transferId}/files/${requestBody.fileId}/upload-token`,
          `${resolvedBaseUrl}/`
        ).toString(),
        multipart: requestBody.file.size >= multipartUploadThresholdBytes,
        onUploadProgress(event) {
          requestBody.onProgress?.(event.loaded, event.total)
        },
      })

      return {
        contentType:
          result.contentType ||
          requestBody.file.type ||
          'application/octet-stream',
        downloadUrl: result.downloadUrl,
        etag: result.etag,
        fileId: requestBody.fileId,
        pathname: result.pathname,
        size: requestBody.file.size,
        url: result.url,
      } satisfies UploadBackendRelayFileResponse
    },
  }
}

function buildRelayBlobPath(transferId: string, fileId: string, fileName: string) {
  const safeName = sanitizePathSegment(fileName || 'file')
  const uniqueSuffix = crypto.randomUUID()

  return `relay/transfers/${transferId}/files/${fileId}/${uniqueSuffix}-${safeName}`
}

function sanitizePathSegment(value: string) {
  const trimmed = value.trim()

  return (trimmed || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

async function streamResponseToFile(
  response: Response,
  request: DownloadBackendRelayFileRequest
) {
  const contentLengthHeader = response.headers.get('content-length')
  const totalBytes = Number.parseInt(contentLengthHeader ?? '0', 10)
  const fallbackMimeType =
    response.headers.get('content-type') ||
    request.mimeType ||
    'application/octet-stream'

  if (!response.body) {
    const blob = await response.blob()
    request.onProgress?.(blob.size, blob.size)

    return new File([blob], request.fileName, {
      type: fallbackMimeType,
    })
  }

  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let loadedBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (!value) {
      continue
    }

    const normalizedChunk = value.slice()

    chunks.push(
      normalizedChunk.buffer.slice(
        normalizedChunk.byteOffset,
        normalizedChunk.byteOffset + normalizedChunk.byteLength
      )
    )
    loadedBytes += value.byteLength
    request.onProgress?.(loadedBytes, totalBytes || loadedBytes)
  }

  return new File(chunks, request.fileName, {
    type: fallbackMimeType,
  })
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
