import Peer, { PeerErrorType, type DataConnection } from 'peerjs'
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import { buildTextMessage, validateChatBody } from '@/domain/messaging/messages'
import {
  maxRetryAttempts,
  minTransferSpeedSampleWindowMs,
  relayOfferAckTimeoutMs,
} from '@/domain/signaling/constants'
import {
  isSignalingMessage,
  type ChatBroadcastMessage,
  type ChatRejectedMessage,
  type ChatSendMessage,
  type FileChunkMessage,
  type FileCompleteMessage,
  type FileOfferAckMessage,
  type FileOfferMessage,
  type HostWelcomeMessage,
  type MemberHelloMessage,
  type RelayPreferenceMessage,
  type RelayTransferOfferMessage,
  type RelayTransferUploadedFileMessage,
  type ReplayTransferRequestMessage,
  type ReplayTransferUnavailableMessage,
  type SignalingMessage,
  type TransferCancelMessage,
} from '@/domain/signaling/protocol'
import { createBackendRelayClient } from '@/lib/backendRelayClient'
import { readFileInChunks } from '@/lib/fileTransfer'
import { pollBackendRelay } from '@/lib/backendRelayPolling'
import { mergeSyncedMessages } from '@/lib/messageSync'
import { getPeerOptions } from '@/lib/peerConfig'
import {
  buildReplayTransferFiles,
  hasReplayableFileSet,
  listTransfersToReplay,
} from '@/lib/transferReplay'
import { stripLocalFileUrls } from '@/lib/transferFiles'
import {
  buildTransferHistorySnapshot,
  mergeSyncedTransfers,
} from '@/lib/transferSync'
import {
  abortTransferStore,
  closeTransferStore,
  createIncomingTransferStore,
  type TransferWritableStore,
  writeTransferStoreChunk,
} from '@/lib/transferStorage'
import { useNotificationStore } from '@/stores/notifications'
import { useNetworkActivityStore } from '@/stores/networkActivity'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import type {
  ChatMessage,
  FileTransfer,
  LocalRoomMode,
  PresenceEvent,
  PresenceEventType,
  SignalingState,
  TransferFile,
} from '@/types/chat'
type OutgoingTransferMode = 'live' | 'replay'

interface IncomingFileBuffer {
  meta: TransferFile
  receivedChunkIndexes: Set<number>
  receivedChunks: number
  receivedBytes: number
  totalChunks: number
  storePromise: Promise<TransferWritableStore>
  writeChain: Promise<void>
}

interface IncomingTransferBuffer {
  transferId: string
  senderId: string
  senderLabel: string
  totalBytes: number
  files: Map<string, IncomingFileBuffer>
  failed: boolean
}

interface PendingDirectOfferAck {
  recipientPeerId: string
  resolve: () => void
  reject: (error: unknown) => void
  timeoutId: number
}

interface OutgoingRelayTransferSession {
  recipientPeerId: string
  uploadedFiles: RelayTransferUploadedFileMessage[]
  uploadController: AbortController
}

interface IncomingRelayTransferSession {
  downloadController: AbortController
  files: RelayTransferUploadedFileMessage[]
  senderPeerId: string
}

interface TransferSpeedSample {
  bytes: number
  bytesPerSecond?: number
  updatedAt: number
}

class TransferCancelledError extends Error {
  transferId: string

  constructor(transferId: string) {
    super('The recipient cancelled the transfer.')
    this.name = 'TransferCancelledError'
    this.transferId = transferId
  }
}

function isTransferCancelledError(
  error: unknown
): error is TransferCancelledError {
  return error instanceof TransferCancelledError
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export const useSignalingStore = defineStore('signaling', () => {
  const peer = shallowRef<Peer | null>(null)
  const hostConnection = shallowRef<DataConnection | null>(null)
  const memberConnections = shallowRef<Record<string, DataConnection>>({})
  const mode = ref<LocalRoomMode | null>(null)
  const activeRoomId = ref<string | null>(null)
  const hostPeerId = ref<string | null>(null)
  const state = ref<SignalingState>('idle')
  const errorMessage = ref<string | null>(null)
  const retryCount = ref(0)
  const lastPresenceNotificationKey = ref<string | null>(null)
  const isHistoryLoading = ref(false)
  const pendingHistoryTransferIds = ref<string[]>([])
  const hasReceivedHistorySnapshot = ref(false)
  const backendRoomEventCursor = ref(0)
  const backendRoomEventPollController = shallowRef<AbortController | null>(
    null
  )

  const sessionStore = useSessionStore()
  const roomStore = useRoomStore()
  const notificationStore = useNotificationStore()
  const networkActivityStore = useNetworkActivityStore()
  const backendRelayClient = createBackendRelayClient()

  const isReady = computed(
    () => state.value === 'listening' || state.value === 'connected'
  )
  const isBackendRelayConfigured = computed(
    () => backendRelayClient.isConfigured
  )
  // eslint-disable-next-line no-useless-assignment
  const backendRoomRelayKey = computed(() => {
    const roomId = activeRoomId.value ?? roomStore.room?.id
    const localPeerId = sessionStore.peer?.id

    if (
      !roomStore.preferBackendRelay ||
      !backendRelayClient.isConfigured ||
      !roomId ||
      !localPeerId ||
      !mode.value
    ) {
      return null
    }

    if (mode.value === 'host') {
      return state.value === 'listening' || state.value === 'connected'
        ? `${mode.value}:${roomId}:${localPeerId}`
        : null
    }

    return state.value === 'connected'
      ? `${mode.value}:${roomId}:${localPeerId}`
      : null
  })

  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let listenersBound = false
  const incomingTransfers = new Map<string, IncomingTransferBuffer>()
  const cancelledIncomingTransfers = new Set<string>()
  const outgoingTransferFiles = new Map<string, File[]>()
  const outgoingTransferModes = new Map<string, OutgoingTransferMode>()
  const outgoingTransferSessionIds = new Map<string, number>()
  const outgoingTransferTargets = new Map<string, string | null>()
  const outgoingRelayTransfers = new Map<string, OutgoingRelayTransferSession>()
  const cancelledOutgoingTransferSessionIds = new Set<number>()
  const pendingDirectOfferAcks = new Map<string, PendingDirectOfferAck>()
  const incomingRelayTransfers = new Map<string, IncomingRelayTransferSession>()
  const incomingTransferActivityTokens = new Map<string, number>()
  const transferSpeedSamples = new Map<string, TransferSpeedSample>()
  let outgoingReplayChain = Promise.resolve()
  let nextOutgoingTransferSessionId = 0
  let peerBootstrapActivityToken: number | null = null
  let joinConnectionActivityToken: number | null = null

  function setState(nextState: SignalingState, nextError?: string | null) {
    state.value = nextState
    errorMessage.value = nextError ?? null

    if (
      (nextState === 'connected' || nextState === 'listening') &&
      roomStore.preferBackendRelay &&
      backendRelayClient.isConfigured
    ) {
      void startBackendRoomEventPolling()
    }
  }

  function bindWindowListeners() {
    if (listenersBound || typeof window === 'undefined') {
      return
    }

    listenersBound = true
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
  }

  function clearRetryTimer() {
    if (retryTimer === null) {
      return
    }

    clearTimeout(retryTimer)
    retryTimer = null
  }

  function startPeerBootstrapActivity() {
    if (peerBootstrapActivityToken !== null) {
      return
    }

    peerBootstrapActivityToken = networkActivityStore.start()
  }

  function finishPeerBootstrapActivity() {
    if (peerBootstrapActivityToken === null) {
      return
    }

    networkActivityStore.finish(peerBootstrapActivityToken)
    peerBootstrapActivityToken = null
  }

  function startJoinConnectionActivity() {
    if (joinConnectionActivityToken !== null) {
      return
    }

    joinConnectionActivityToken = networkActivityStore.start()
  }

  function finishJoinConnectionActivity() {
    if (joinConnectionActivityToken === null) {
      return
    }

    networkActivityStore.finish(joinConnectionActivityToken)
    joinConnectionActivityToken = null
  }

  function pulseNetworkActivity() {
    networkActivityStore.pulse()
  }

  function hasOpenMemberConnections() {
    return Object.values(memberConnections.value).some(
      (connection) => connection.open
    )
  }

  async function publishBackendRoomEvent(
    message: SignalingMessage,
    targetPeerIdOverride?: string | null
  ) {
    const roomId = activeRoomId.value ?? roomStore.room?.id
    const localPeerId = sessionStore.peer?.id
    const targetPeerId =
      targetPeerIdOverride ??
      ('targetPeerId' in message && typeof message.targetPeerId === 'string'
        ? message.targetPeerId
        : null)

    if (!roomId || !localPeerId || !backendRelayClient.isConfigured) {
      throw new Error('Backend relay is not configured for this room.')
    }

    await backendRelayClient.publishRoomEvent({
      message: message as unknown as {
        type: string
      } & Record<string, unknown>,
      roomId,
      senderPeerId: localPeerId,
      targetPeerId,
    })
  }

  function handleBackendRoomEventMessage(message: unknown) {
    if (!isSignalingMessage(message)) {
      return
    }

    handleJoinMessage(message)
  }

  function stopBackendRoomEventPolling() {
    backendRoomEventPollController.value?.abort()
    backendRoomEventPollController.value = null
    backendRoomEventCursor.value = 0
  }

  async function startBackendRoomEventPolling() {
    const roomId = activeRoomId.value ?? roomStore.room?.id
    const localPeerId = sessionStore.peer?.id

    if (
      backendRoomEventPollController.value ||
      !backendRelayClient.isConfigured ||
      !roomStore.preferBackendRelay ||
      !roomId ||
      !localPeerId
    ) {
      return
    }

    const controller = new AbortController()

    backendRoomEventPollController.value = controller

    try {
      while (!controller.signal.aborted) {
        const events = await pollBackendRelay({
          intervalMs: 1000,
          poll: async () => {
            const response = await backendRelayClient.pollRoomEvents({
              afterEventId: backendRoomEventCursor.value,
              peerId: localPeerId,
              roomId,
              signal: controller.signal,
            })

            backendRoomEventCursor.value = response.latestEventId

            return response.events.length > 0 ? response.events : null
          },
          signal: controller.signal,
        })

        for (const event of events) {
          handleBackendRoomEventMessage(event.message)
        }
      }
    } catch (error) {
      if (
        backendRoomEventPollController.value !== controller ||
        isAbortError(error)
      ) {
        return
      }

      notificationStore.pushNotification({
        title: 'Backend relay room sync failed',
        detail:
          error instanceof Error
            ? error.message
            : 'Backend relay room polling failed unexpectedly.',
        tone: 'warning',
      })
    } finally {
      if (backendRoomEventPollController.value === controller) {
        backendRoomEventPollController.value = null
      }
    }
  }

  function startIncomingTransferActivity(transferId: string) {
    if (incomingTransferActivityTokens.has(transferId)) {
      return
    }

    incomingTransferActivityTokens.set(transferId, networkActivityStore.start())
  }

  function finishIncomingTransferActivity(transferId: string) {
    const token = incomingTransferActivityTokens.get(transferId)

    if (token === undefined) {
      return
    }

    incomingTransferActivityTokens.delete(transferId)
    networkActivityStore.finish(token)
  }

  function finishAllIncomingTransferActivity() {
    for (const transferId of incomingTransferActivityTokens.keys()) {
      finishIncomingTransferActivity(transferId)
    }
  }

  function startOutgoingTransfer(
    transferId: string,
    mode: OutgoingTransferMode,
    targetPeerId: string | null = null
  ) {
    const sessionId = (nextOutgoingTransferSessionId += 1)

    outgoingTransferModes.set(transferId, mode)
    outgoingTransferSessionIds.set(transferId, sessionId)
    outgoingTransferTargets.set(transferId, targetPeerId)

    return sessionId
  }

  function finishOutgoingTransfer(transferId: string, sessionId: number) {
    cancelledOutgoingTransferSessionIds.delete(sessionId)

    if (outgoingTransferSessionIds.get(transferId) !== sessionId) {
      return
    }

    clearPendingDirectOfferAck(transferId)
    clearTransferSpeedSample(transferId)
    outgoingTransferModes.delete(transferId)
    outgoingTransferSessionIds.delete(transferId)
    outgoingTransferTargets.delete(transferId)
    outgoingRelayTransfers.delete(transferId)
  }

  function clearTransferSpeedSample(transferId: string) {
    transferSpeedSamples.delete(transferId)
  }

  function clearAllTransferSpeedSamples() {
    transferSpeedSamples.clear()
  }

  function primeTransferSpeedSample(transferId: string) {
    transferSpeedSamples.set(transferId, {
      bytes: 0,
      updatedAt: performance.now(),
    })
  }

  function measureTransferSpeed(transferId: string, transferredBytes: number) {
    const now = performance.now()
    const previousSample = transferSpeedSamples.get(transferId)

    if (!previousSample) {
      transferSpeedSamples.set(transferId, {
        bytes: transferredBytes,
        updatedAt: now,
      })

      return undefined
    }

    const byteDelta = transferredBytes - previousSample.bytes
    const timeDeltaMs = now - previousSample.updatedAt

    if (byteDelta <= 0 || timeDeltaMs < minTransferSpeedSampleWindowMs) {
      return previousSample.bytesPerSecond
    }

    const instantaneousBytesPerSecond = byteDelta / (timeDeltaMs / 1000)
    const bytesPerSecond =
      previousSample.bytesPerSecond === undefined
        ? instantaneousBytesPerSecond
        : previousSample.bytesPerSecond * 0.35 +
          instantaneousBytesPerSecond * 0.65

    transferSpeedSamples.set(transferId, {
      bytes: transferredBytes,
      bytesPerSecond,
      updatedAt: now,
    })

    return bytesPerSecond
  }

  function updateTransferProgressForBytes(
    transferId: string,
    transferredBytes: number,
    totalBytes: number
  ) {
    const progress =
      (transferredBytes / Math.max(totalBytes, transferredBytes, 1)) * 100

    roomStore.updateTransferProgress(
      transferId,
      progress,
      'transferring',
      measureTransferSpeed(transferId, transferredBytes)
    )
  }

  function syncCancelledOutgoingTransfer(
    transferId: string,
    mode: OutgoingTransferMode
  ) {
    if (mode === 'replay') {
      roomStore.completeTransfer(transferId)

      return
    }

    roomStore.cancelTransfer(transferId)
  }

  function throwIfOutgoingTransferCancelled(
    transferId: string,
    sessionId: number
  ) {
    if (cancelledOutgoingTransferSessionIds.has(sessionId)) {
      throw new TransferCancelledError(transferId)
    }
  }

  function clearPendingDirectOfferAck(transferId: string) {
    const pendingAck = pendingDirectOfferAcks.get(transferId)

    if (!pendingAck) {
      return
    }

    window.clearTimeout(pendingAck.timeoutId)
    pendingDirectOfferAcks.delete(transferId)
  }

  function rejectPendingDirectOfferAck(transferId: string, error: Error) {
    const pendingAck = pendingDirectOfferAcks.get(transferId)

    if (!pendingAck) {
      return
    }

    clearPendingDirectOfferAck(transferId)
    pendingAck.reject(error)
  }

  function resolveConnectedRecipientPeerIds(localPeerId: string) {
    return roomStore.members
      .filter(
        (member) =>
          member.id !== localPeerId && member.connectionState === 'connected'
      )
      .map((member) => member.id)
  }

  function resolveBackendRelayRecipientPeerId(localPeerId: string) {
    if (!backendRelayClient.isConfigured) {
      return null
    }

    const recipientPeerIds = resolveConnectedRecipientPeerIds(localPeerId)

    return recipientPeerIds.length === 1 ? (recipientPeerIds[0] ?? null) : null
  }

  function getBackendRelayAvailabilityError(localPeerId: string) {
    if (!backendRelayClient.isConfigured) {
      return 'Backend relay is not configured for this deployment.'
    }

    const recipientPeerIds = resolveConnectedRecipientPeerIds(localPeerId)

    if (recipientPeerIds.length !== 1) {
      return 'Backend relay mode currently supports exactly one connected recipient.'
    }

    return null
  }

  async function ensureBackendRelayFileTransportAvailable() {
    if (!backendRelayClient.isConfigured) {
      throw new Error('Backend relay is not configured for this deployment.')
    }

    const health = await backendRelayClient.getHealth()

    if (health.blobConfigured) {
      return
    }

    throw new Error(
      'Backend relay file transfers are unavailable because BLOB_READ_WRITE_TOKEN is not configured on the relay backend.'
    )
  }

  function waitForDirectOfferAck(transferId: string, recipientPeerId: string) {
    clearPendingDirectOfferAck(transferId)

    return new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingDirectOfferAcks.delete(transferId)
        reject(
          new Error(
            'Direct WebRTC transfer did not become ready before fallback timeout.'
          )
        )
      }, relayOfferAckTimeoutMs)

      pendingDirectOfferAcks.set(transferId, {
        recipientPeerId,
        resolve: () => {
          window.clearTimeout(timeoutId)
          pendingDirectOfferAcks.delete(transferId)
          resolve()
        },
        reject: (error) => {
          window.clearTimeout(timeoutId)
          pendingDirectOfferAcks.delete(transferId)
          reject(error)
        },
        timeoutId,
      })
    })
  }

  function handleOutgoingTransferCancelled(message: TransferCancelMessage) {
    const sessionId = outgoingTransferSessionIds.get(message.transferId)

    if (sessionId !== undefined) {
      cancelledOutgoingTransferSessionIds.add(sessionId)
    }

    rejectPendingDirectOfferAck(
      message.transferId,
      new TransferCancelledError(message.transferId)
    )

    const mode = outgoingTransferModes.get(message.transferId)

    if (!mode) {
      return
    }

    void cancelOutgoingRelayTransferSession(
      message.transferId,
      'The recipient cancelled the backend relay transfer.'
    )

    syncCancelledOutgoingTransfer(message.transferId, mode)

    // A recipient-originated cancellation has already reached the recipient that
    // requested it. Echoing another cancel back can race with a replay request
    // and re-cancel the restarted download.
  }

  async function disposeIncomingTransfer(
    transfer: IncomingTransferBuffer,
    preserveRelaySession = false
  ) {
    const relayTransfer = incomingRelayTransfers.get(transfer.transferId)

    relayTransfer?.downloadController.abort()

    if (!preserveRelaySession) {
      incomingRelayTransfers.delete(transfer.transferId)
    }

    await Promise.all(
      Array.from(transfer.files.values(), async (fileBuffer) => {
        try {
          await fileBuffer.writeChain
        } catch (error) {
          void error
        }

        const store = await fileBuffer.storePromise
        await abortTransferStore(store)
      })
    )
  }

  function disposeIncomingTransfersForPeer(peerId: string) {
    for (const [transferId, transfer] of incomingTransfers.entries()) {
      if (transfer.senderId !== peerId) {
        continue
      }

      transfer.failed = true
      clearTransferSpeedSample(transferId)
      incomingTransfers.delete(transferId)
      finishIncomingTransferActivity(transferId)
      void disposeIncomingTransfer(transfer)
    }
  }

  function disposeAllIncomingTransfers() {
    const transfers = Array.from(incomingTransfers.values())

    incomingTransfers.clear()
    for (const relayTransfer of incomingRelayTransfers.values()) {
      relayTransfer.downloadController.abort()
    }
    incomingRelayTransfers.clear()
    finishAllIncomingTransferActivity()

    for (const transfer of transfers) {
      transfer.failed = true
      clearTransferSpeedSample(transfer.transferId)
      void disposeIncomingTransfer(transfer)
    }
  }

  function resetConnections() {
    stopBackendRoomEventPolling()
    clearAllTransferSpeedSamples()
    hostConnection.value?.close()
    hostConnection.value = null

    for (const connection of Object.values(memberConnections.value)) {
      connection.close()
    }

    memberConnections.value = {}
    disposeAllIncomingTransfers()
    cancelledIncomingTransfers.clear()
    clearRetryTimer()
    resetHistoryLoading()
  }

  function clearOutgoingTransferCache() {
    for (const transferId of pendingDirectOfferAcks.keys()) {
      rejectPendingDirectOfferAck(
        transferId,
        new Error('The room session was reset before the transfer could start.')
      )
    }

    outgoingTransferFiles.clear()
    outgoingTransferModes.clear()
    outgoingTransferSessionIds.clear()
    outgoingRelayTransfers.clear()
    cancelledOutgoingTransferSessionIds.clear()
    pendingDirectOfferAcks.clear()
    clearAllTransferSpeedSamples()
    outgoingReplayChain = Promise.resolve()
    nextOutgoingTransferSessionId = 0
  }

  function resetHistoryLoading() {
    isHistoryLoading.value = false
    pendingHistoryTransferIds.value = []
    hasReceivedHistorySnapshot.value = false
  }

  function startHistoryLoading() {
    if (mode.value !== 'join') {
      resetHistoryLoading()

      return
    }

    isHistoryLoading.value = true
    pendingHistoryTransferIds.value = []
    hasReceivedHistorySnapshot.value = false
  }

  function applyHistorySnapshot(transfers: FileTransfer[]) {
    hasReceivedHistorySnapshot.value = true
    pendingHistoryTransferIds.value = transfers
      .filter(
        (transfer) =>
          transfer.senderId !== sessionStore.peer?.id &&
          transfer.files.some((file) => !file.downloadUrl)
      )
      .map((transfer) => transfer.id)
    isHistoryLoading.value = pendingHistoryTransferIds.value.length > 0
  }

  function settleHistoryTransfer(transferId: string) {
    if (!pendingHistoryTransferIds.value.includes(transferId)) {
      return
    }

    pendingHistoryTransferIds.value = pendingHistoryTransferIds.value.filter(
      (pendingTransferId) => pendingTransferId !== transferId
    )

    if (
      hasReceivedHistorySnapshot.value &&
      pendingHistoryTransferIds.value.length === 0
    ) {
      isHistoryLoading.value = false
    }
  }

  function destroyPeer(resetContext = true) {
    resetConnections()
    finishPeerBootstrapActivity()
    finishJoinConnectionActivity()
    peer.value?.destroy()
    peer.value = null
    if (resetContext) {
      clearOutgoingTransferCache()
      mode.value = null
      activeRoomId.value = null
      hostPeerId.value = null
      retryCount.value = 0
    }
    lastPresenceNotificationKey.value = null
    setState('idle')
  }

  function ensurePeer(nextMode: LocalRoomMode) {
    bindWindowListeners()
    const localPeer = sessionStore.ensureSession(
      nextMode === 'host' ? 'host' : 'member'
    )

    if (
      peer.value &&
      !peer.value.destroyed &&
      peer.value.id === localPeer.id &&
      state.value !== 'error' &&
      state.value !== 'disconnected'
    ) {
      return peer.value
    }

    destroyPeer(false)
    startPeerBootstrapActivity()

    const nextPeer = markRaw(new Peer(localPeer.id, getPeerOptions()))

    nextPeer.on('open', () => {
      if (peer.value !== nextPeer) {
        return
      }

      finishPeerBootstrapActivity()

      if (mode.value === 'host') {
        sessionStore.setConnectionState('connected')
        roomStore.syncLocalPeer()
        roomStore.updateRoomStatus('active')
        setState('listening')

        return
      }

      sessionStore.setConnectionState('connecting')
      roomStore.syncLocalPeer()
      setState('connecting')
      connectJoinerToHost()
    })

    nextPeer.on('connection', (connection) => {
      if (
        mode.value !== 'host' ||
        connection.metadata?.roomId !== activeRoomId.value
      ) {
        connection.close()

        return
      }

      bindHostConnection(connection)
    })

    nextPeer.on('disconnected', () => {
      if (peer.value !== nextPeer || nextPeer.destroyed) {
        return
      }

      finishPeerBootstrapActivity()
      resetHistoryLoading()
      sessionStore.setConnectionState('disconnected')
      roomStore.syncLocalPeer()
      setState(
        mode.value === 'join' ? 'retrying' : 'disconnected',
        'Lost contact with the signaling service.'
      )
      nextPeer.reconnect()
    })

    nextPeer.on('close', () => {
      if (peer.value !== nextPeer) {
        return
      }

      finishPeerBootstrapActivity()
      resetHistoryLoading()
      sessionStore.setConnectionState('disconnected')
      roomStore.syncLocalPeer()
      setState('disconnected', 'Peer connection closed.')
    })

    nextPeer.on('error', (error) => {
      if (peer.value !== nextPeer) {
        return
      }

      finishPeerBootstrapActivity()

      const errorType = getPeerErrorType(error)

      if (errorType === PeerErrorType.UnavailableID) {
        handleDuplicateTabConflict()

        return
      }

      if (
        mode.value === 'join' &&
        errorType === PeerErrorType.PeerUnavailable
      ) {
        handleJoinDisconnect(
          'The host is offline or this room link is no longer reachable.'
        )

        return
      }

      resetHistoryLoading()
      sessionStore.setConnectionState('disconnected')
      roomStore.syncLocalPeer()
      setState(
        mode.value === 'join' ? 'disconnected' : 'error',
        formatPeerError(error)
      )
      notificationStore.pushNotification({
        title: 'Signaling error',
        detail: formatPeerError(error),
        tone: 'warning',
      })
    })

    peer.value = nextPeer
    setState('starting')

    return nextPeer
  }

  function ensureHost(roomId: string) {
    if (mode.value !== 'host' || activeRoomId.value !== roomId) {
      destroyPeer()
      mode.value = 'host'
      activeRoomId.value = roomId
      hostPeerId.value = sessionStore.ensureSession('host').id
      retryCount.value = 0
    }

    sessionStore.setRole('host')
    roomStore.syncLocalPeer()
    ensurePeer('host')
  }

  function ensureJoiner(roomId: string, nextHostPeerId: string) {
    const shouldRestart =
      mode.value !== 'join' ||
      activeRoomId.value !== roomId ||
      hostPeerId.value !== nextHostPeerId

    if (shouldRestart) {
      destroyPeer()
      mode.value = 'join'
      activeRoomId.value = roomId
      hostPeerId.value = nextHostPeerId
      retryCount.value = 0
    }

    sessionStore.setRole('member')
    roomStore.syncLocalPeer()
    ensurePeer('join')

    if (peer.value?.open && !hostConnection.value) {
      connectJoinerToHost()
    }
  }

  function connectJoinerToHost() {
    const activePeer = peer.value
    const room = roomStore.room
    const localPeer = sessionStore.peer

    if (
      !activePeer ||
      !activePeer.open ||
      !room ||
      room.localMode !== 'join' ||
      !hostPeerId.value ||
      !localPeer
    ) {
      return
    }

    clearRetryTimer()
    hostConnection.value?.close()
    sessionStore.setConnectionState('connecting')
    roomStore.syncLocalPeer()
    roomStore.updateMemberConnectionState(hostPeerId.value, 'connecting')
    setState('connecting')
    finishJoinConnectionActivity()
    startJoinConnectionActivity()

    const connection = markRaw(
      activePeer.connect(hostPeerId.value, {
        reliable: true,
        metadata: {
          preferBackendRelay: roomStore.preferBackendRelay,
          roomId: room.id,
          peerId: localPeer.id,
          label: localPeer.label,
          joinedAt: localPeer.joinedAt,
        },
      })
    )

    hostConnection.value = connection

    connection.on('open', () => {
      if (hostConnection.value !== connection) {
        return
      }

      retryCount.value = 0
      sessionStore.setConnectionState('connected')
      roomStore.syncLocalPeer()
      roomStore.updateRoomStatus('active')
      roomStore.updateMemberConnectionState(hostPeerId.value!, 'connected')
      startHistoryLoading()
      notificationStore.pushNotification({
        title: 'Connected to host',
        detail: `Peer channel is open with host ${connection.peer}.`,
        tone: 'success',
      })
      setState('connected')
      connection.send({
        type: 'member-hello',
        preferBackendRelay: roomStore.preferBackendRelay,
        roomId: room.id,
        peer: {
          id: localPeer.id,
          label: localPeer.label,
          joinedAt: localPeer.joinedAt,
        },
      } satisfies MemberHelloMessage)
      finishJoinConnectionActivity()
    })

    connection.on('data', (message) => {
      handleJoinMessage(message)
    })

    connection.on('close', () => {
      if (hostConnection.value !== connection) {
        return
      }

      finishJoinConnectionActivity()
      hostConnection.value = null
      handleJoinDisconnect('The host connection closed.')
    })

    connection.on('error', (error) => {
      if (hostConnection.value !== connection) {
        return
      }

      finishJoinConnectionActivity()
      handleJoinDisconnect(formatPeerError(error))
    })
  }

  function handleJoinMessage(message: unknown) {
    if (!isSignalingMessage(message)) {
      return
    }

    if (
      'targetPeerId' in message &&
      typeof message.targetPeerId === 'string' &&
      message.targetPeerId !== sessionStore.peer?.id
    ) {
      return
    }

    if (message.type === 'host-welcome' || message.type === 'room-sync') {
      roomStore.setPreferBackendRelay(message.preferBackendRelay)
      roomStore.replaceMembers(message.members)
      roomStore.replacePresenceEvents(message.presenceEvents)

      if (message.type === 'host-welcome') {
        const mergedTransfers = mergeSyncedTransfers(
          roomStore.transfers,
          message.transfers,
          sessionStore.peer?.id
        )

        roomStore.replaceMessages(
          mergeSyncedMessages(roomStore.messages, message.messages)
        )
        roomStore.replaceTransfers(mergedTransfers)
        applyHistorySnapshot(mergedTransfers)
        roomStore.upsertMember({
          id: message.host.id,
          label: message.host.label,
          role: 'host',
          connectionState: 'connected',
          joinedAt: message.host.joinedAt,
        })
      }

      return
    }

    if (message.type === 'replay-transfer') {
      handleReplayTransferRequest(message)

      return
    }

    if (message.type === 'replay-transfer-unavailable') {
      roomStore.failTransfer(message.transferId, message.reason)
      settleHistoryTransfer(message.transferId)

      return
    }

    if (message.type === 'file-offer-ack') {
      handleDirectTransferReadyAck(message)

      return
    }

    if (message.type === 'relay-transfer-offer') {
      handleIncomingRelayTransferOffer(message)

      return
    }

    if (message.type === 'transfer-cancel') {
      handleTransferCancelled(message)

      return
    }

    if (message.type !== 'presence-event') {
      if (message.type === 'chat-broadcast') {
        roomStore.markMessageStatus(message.message.id, 'sent', message.message)

        return
      }

      if (message.type === 'chat-rejected') {
        roomStore.markMessageStatus(message.messageId, 'failed')
        notificationStore.pushNotification({
          title: 'Message rejected',
          detail: message.reason,
          tone: 'warning',
        })

        return
      }

      if (message.type === 'file-offer') {
        registerIncomingTransfer(message)

        return
      }

      if (message.type === 'file-chunk') {
        appendIncomingFileChunk(message)

        return
      }

      if (message.type === 'file-complete') {
        void finalizeIncomingTransfer(message.transferId)

        return
      }

      return
    }

    const alreadyRecorded = roomStore.presenceEvents.some(
      (event) =>
        event.type === message.event.type &&
        event.peerId === message.event.peerId &&
        event.createdAt === message.event.createdAt
    )

    if (!alreadyRecorded) {
      roomStore.recordPresenceEvent(
        message.event.type,
        message.event.peerId,
        message.event.peerLabel,
        message.event.createdAt
      )
    }

    const notificationKey = `${message.event.type}:${message.event.peerId}:${message.event.createdAt}`

    if (lastPresenceNotificationKey.value === notificationKey) {
      return
    }

    lastPresenceNotificationKey.value = notificationKey

    const notification = buildPresenceNotification(
      message.event.type,
      message.event.peerLabel,
      message.event.peerId === sessionStore.peer?.id
    )

    notificationStore.pushNotification(notification)
  }

  function handleJoinDisconnect(reason: string) {
    clearRetryTimer()
    finishJoinConnectionActivity()
    resetHistoryLoading()
    sessionStore.setConnectionState('disconnected')
    roomStore.syncLocalPeer()
    roomStore.updateRoomStatus('disconnected')
    disposeAllIncomingTransfers()
    if (sessionStore.peer) {
      roomStore.failPendingMessagesForPeer(sessionStore.peer.id)
      roomStore.failTransfersForPeer(
        hostPeerId.value ?? sessionStore.peer.id,
        reason
      )
    }

    if (hostPeerId.value) {
      roomStore.updateMemberConnectionState(hostPeerId.value, 'disconnected')
    }

    setState('disconnected', reason)
    notificationStore.pushNotification({
      title: 'Host connection unavailable',
      detail: reason,
      tone: 'warning',
    })

    scheduleRetry()
  }

  function scheduleRetry() {
    if (mode.value !== 'join') {
      return
    }

    if (retryCount.value >= maxRetryAttempts) {
      setState(
        'disconnected',
        'Automatic retries stopped. Retry manually or verify that the host is still online.'
      )

      return
    }

    clearRetryTimer()
    setState(
      'retrying',
      `Reconnect attempt ${retryCount.value + 1} of ${maxRetryAttempts} is waiting to retry.`
    )
    const delay = 1000 * (retryCount.value + 1)

    retryTimer = setTimeout(() => {
      retryCount.value += 1
      connectJoinerToHost()
    }, delay)
  }

  function retryJoinConnection() {
    if (mode.value !== 'join') {
      return
    }

    retryCount.value = 0
    clearRetryTimer()
    setState('connecting', 'Retrying the host connection now.')
    connectJoinerToHost()
  }

  function sendDraftMessage() {
    const room = roomStore.room
    const localPeer = sessionStore.peer
    const draftResult = roomStore.createDraftMessage()

    if (!draftResult.message || !room || !localPeer) {
      return false
    }

    if (roomStore.preferBackendRelay) {
      if (!backendRelayClient.isConfigured) {
        roomStore.markMessageStatus(draftResult.message.id, 'failed')
        notificationStore.pushNotification({
          title: 'Backend relay unavailable',
          detail:
            'Configure the backend relay before sending chat in relay mode.',
          tone: 'warning',
        })

        return false
      }

      pulseNetworkActivity()
      void publishBackendRoomEvent({
        type: 'chat-broadcast',
        roomId: room.id,
        message: {
          ...draftResult.message,
          status: 'sent',
        },
      } satisfies ChatBroadcastMessage)
        .then(() => {
          console.info('Backend relay chat sent.', {
            messageId: draftResult.message!.id,
            roomId: room.id,
            senderPeerId: localPeer.id,
          })
          roomStore.markMessageStatus(draftResult.message!.id, 'sent', {
            ...draftResult.message!,
            status: 'sent',
          })
        })
        .catch((error) => {
          roomStore.markMessageStatus(draftResult.message!.id, 'failed')
          notificationStore.pushNotification({
            title: 'Message not sent',
            detail:
              error instanceof Error
                ? error.message
                : 'Backend relay chat send failed unexpectedly.',
            tone: 'warning',
          })
        })

      return true
    }

    if (room.localMode === 'host') {
      relayHostMessage(draftResult.message)

      return true
    }

    if (!hostConnection.value?.open) {
      roomStore.markMessageStatus(draftResult.message.id, 'failed')
      notificationStore.pushNotification({
        title: 'Host unavailable',
        detail: 'Reconnect to the host before sending chat messages.',
        tone: 'warning',
      })

      return false
    }

    pulseNetworkActivity()
    hostConnection.value.send({
      type: 'chat-send',
      roomId: room.id,
      message: {
        id: draftResult.message.id,
        body: draftResult.message.body,
        createdAt: draftResult.message.createdAt,
      },
    } satisfies ChatSendMessage)

    return true
  }

  async function sendFiles(selectedFiles: File[]) {
    const room = roomStore.room
    const localPeer = sessionStore.peer
    const transferResult = roomStore.createOutgoingTransfer(selectedFiles)

    if (
      !transferResult.transfer ||
      !transferResult.files ||
      !room ||
      !localPeer
    ) {
      return false
    }

    const transfer = transferResult.transfer
    const files = transferResult.files

    outgoingTransferFiles.set(transfer.id, [...files])
    roomStore.setTransferTransport(transfer.id, 'webrtc')

    const relayRecipientPeerId = resolveBackendRelayRecipientPeerId(
      localPeer.id
    )

    const recipientCount = roomStore.members.filter(
      (member) =>
        member.id !== localPeer.id && member.connectionState === 'connected'
    ).length

    if (recipientCount === 0) {
      if (room.localMode === 'host') {
        roomStore.completeTransfer(transfer.id)
        notificationStore.pushNotification({
          title: 'Files cached locally',
          detail:
            'No one else is connected right now. The host will replay this upload automatically when someone joins.',
          tone: 'info',
        })

        return true
      }

      roomStore.failTransfer(
        transfer.id,
        'No connected peers are available to receive files.'
      )
      notificationStore.pushNotification({
        title: 'No recipients available',
        detail: 'Wait for another connected member before sharing files.',
        tone: 'warning',
      })

      return false
    }

    const outgoingSessionId = startOutgoingTransfer(
      transfer.id,
      'live',
      relayRecipientPeerId
    )
    primeTransferSpeedSample(transfer.id)
    roomStore.updateTransferProgress(transfer.id, 0)

    if (roomStore.preferBackendRelay) {
      const backendRelayAvailabilityError = getBackendRelayAvailabilityError(
        localPeer.id
      )

      if (backendRelayAvailabilityError) {
        roomStore.failTransfer(transfer.id, backendRelayAvailabilityError)
        notificationStore.pushNotification({
          title: 'Backend relay unavailable',
          detail: backendRelayAvailabilityError,
          tone: 'warning',
        })

        return false
      }
    }

    const offer: FileOfferMessage = {
      type: 'file-offer',
      roomId: room.id,
      transferId: transfer.id,
      sender: {
        id: localPeer.id,
        label: localPeer.label,
      },
      files: stripLocalFileUrls(transfer.files),
      totalBytes: transfer.totalBytes ?? 0,
      createdAt: transfer.createdAt,
    }

    return networkActivityStore
      .track(async () => {
        if (roomStore.preferBackendRelay) {
          return sendFilesOverBackendRelay({
            activation: 'preferred',
            files,
            recipientPeerId: relayRecipientPeerId!,
            room,
            sessionId: outgoingSessionId,
            transfer,
          })
        }

        const directOfferAck = relayRecipientPeerId
          ? waitForDirectOfferAck(transfer.id, relayRecipientPeerId)
          : null

        await sendTransferOfferOverWebRtc({
          offer,
          room,
          sessionId: outgoingSessionId,
          transferId: transfer.id,
        })

        if (directOfferAck) {
          try {
            await directOfferAck
          } catch {
            const recipientPeerId = relayRecipientPeerId

            if (!recipientPeerId) {
              throw new Error(
                'Backend relay fallback was requested without a single connected recipient.'
              )
            }

            return sendFilesOverBackendRelay({
              activation: 'fallback',
              files,
              recipientPeerId,
              room,
              sessionId: outgoingSessionId,
              transfer,
            })
          }
        }

        return finishWebRtcTransferAfterOffer({
          files,
          room,
          sessionId: outgoingSessionId,
          transfer,
        })
      })
      .catch((error) => {
        if (isTransferCancelledError(error)) {
          roomStore.cancelTransfer(transfer.id)

          return false
        }

        const detail =
          error instanceof Error
            ? error.message
            : 'File transfer failed unexpectedly.'

        roomStore.failTransfer(transfer.id, detail)
        notificationStore.pushNotification({
          title: 'File transfer failed',
          detail,
          tone: 'warning',
        })

        return false
      })
      .finally(() => {
        finishOutgoingTransfer(transfer.id, outgoingSessionId)
      })
  }

  async function sendTransferOfferOverWebRtc({
    offer,
    room,
    sessionId,
    transferId,
  }: {
    offer: FileOfferMessage
    room: NonNullable<typeof roomStore.room>
    sessionId: number
    transferId: string
  }) {
    if (room.localMode === 'host') {
      throwIfOutgoingTransferCancelled(transferId, sessionId)
      broadcastToMembers(offer)

      return
    }

    if (!hostConnection.value?.open) {
      throw new Error('Reconnect to the host before sharing files.')
    }

    const connection = hostConnection.value

    throwIfOutgoingTransferCancelled(transferId, sessionId)
    connection.send(offer)
  }

  async function finishWebRtcTransferAfterOffer({
    files,
    room,
    sessionId,
    transfer,
  }: {
    files: File[]
    room: NonNullable<typeof roomStore.room>
    sessionId: number
    transfer: FileTransfer
  }) {
    if (room.localMode === 'host') {
      throwIfOutgoingTransferCancelled(transfer.id, sessionId)
      await streamTransferFiles(
        transfer,
        files,
        sessionId,
        (message) => {
          broadcastToMembers(message)
        },
        true
      )
      throwIfOutgoingTransferCancelled(transfer.id, sessionId)
      broadcastToMembers({
        type: 'file-complete',
        roomId: room.id,
        transferId: transfer.id,
      } satisfies FileCompleteMessage)
      roomStore.completeTransfer(transfer.id)

      return true
    }

    if (!hostConnection.value?.open) {
      throw new Error('Reconnect to the host before sharing files.')
    }

    const connection = hostConnection.value

    throwIfOutgoingTransferCancelled(transfer.id, sessionId)
    await streamTransferFiles(
      transfer,
      files,
      sessionId,
      (message) => {
        if (!connection.open) {
          throw new Error(
            'The host connection closed before the upload finished.'
          )
        }

        connection.send(message)
      },
      true
    )
    throwIfOutgoingTransferCancelled(transfer.id, sessionId)
    connection.send({
      type: 'file-complete',
      roomId: room.id,
      transferId: transfer.id,
    } satisfies FileCompleteMessage)
    roomStore.completeTransfer(transfer.id)

    return true
  }

  async function sendFilesOverBackendRelay({
    activation,
    files,
    recipientPeerId,
    room,
    sessionId,
    transfer,
  }: {
    activation: 'preferred' | 'fallback'
    files: File[]
    recipientPeerId: string
    room: NonNullable<typeof roomStore.room>
    sessionId: number
    transfer: FileTransfer
  }) {
    const localPeer = sessionStore.peer

    if (!localPeer || !backendRelayClient.isConfigured) {
      throw new Error('Backend relay is not configured for this deployment.')
    }

    await ensureBackendRelayFileTransportAvailable()

    const relayTransfer: OutgoingRelayTransferSession = {
      recipientPeerId,
      uploadedFiles: [],
      uploadController: new AbortController(),
    }

    outgoingRelayTransfers.set(transfer.id, relayTransfer)
    roomStore.setTransferTransport(transfer.id, 'backend-relay')
    notificationStore.pushNotification({
      title:
        activation === 'preferred'
          ? 'Backend relay selected'
          : 'Backend relay active',
      detail:
        activation === 'preferred'
          ? 'This transfer is using the backend relay immediately.'
          : 'Direct WebRTC transfer did not become ready in time. This transfer is using the backend relay instead.',
      tone: 'info',
    })

    try {
      let uploadedBytes = 0

      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        throwIfOutgoingTransferCancelled(transfer.id, sessionId)

        const file = files[fileIndex]
        const fileMeta = transfer.files[fileIndex]

        if (!file || !fileMeta) {
          continue
        }

        const uploadedFile = await backendRelayClient.uploadFile({
          file,
          fileId: fileMeta.id,
          onProgress: (loadedBytes) => {
            updateTransferProgressForBytes(
              transfer.id,
              uploadedBytes + loadedBytes,
              transfer.totalBytes ?? uploadedBytes + loadedBytes
            )
          },
          signal: relayTransfer.uploadController.signal,
          transferId: transfer.id,
        })

        relayTransfer.uploadedFiles = [
          ...relayTransfer.uploadedFiles,
          {
            fileId: fileMeta.id,
            pathname: uploadedFile.pathname,
          },
        ]
        uploadedBytes += file.size
        updateTransferProgressForBytes(
          transfer.id,
          uploadedBytes,
          transfer.totalBytes ?? uploadedBytes
        )
      }

      throwIfOutgoingTransferCancelled(transfer.id, sessionId)

      const relayOffer = {
        type: 'relay-transfer-offer',
        roomId: room.id,
        transferId: transfer.id,
        sender: {
          id: localPeer.id,
          label: localPeer.label,
        },
        files: stripLocalFileUrls(transfer.files),
        totalBytes: transfer.totalBytes ?? 0,
        createdAt: transfer.createdAt,
        relay: {
          files: relayTransfer.uploadedFiles,
        },
        targetPeerId: recipientPeerId,
      } satisfies RelayTransferOfferMessage

      if (roomStore.preferBackendRelay) {
        await publishBackendRoomEvent(relayOffer)
      } else if (room.localMode === 'host') {
        if (!sendToMember(recipientPeerId, relayOffer)) {
          throw new Error('The relay recipient is no longer connected.')
        }
      } else if (hostConnection.value?.open) {
        hostConnection.value.send(relayOffer)
      } else {
        throw new Error(
          'Reconnect to the host before switching this transfer to backend relay.'
        )
      }

      roomStore.completeTransfer(transfer.id)

      return true
    } catch (error) {
      await cancelOutgoingRelayTransferSession(
        transfer.id,
        error instanceof Error
          ? error.message
          : 'Backend relay upload failed unexpectedly.'
      )

      if (!isTransferCancelledError(error)) {
        notifyRecipientsTransferCancelled(transfer.id)
      }

      throw error
    }
  }

  async function cancelOutgoingRelayTransferSession(
    transferId: string,
    reason: string
  ) {
    const relayTransfer = outgoingRelayTransfers.get(transferId)

    if (!relayTransfer) {
      return
    }

    relayTransfer.uploadController.abort()
    outgoingRelayTransfers.delete(transferId)

    try {
      await backendRelayClient.cancelTransfer({
        pathnames: relayTransfer.uploadedFiles.map((file) => file.pathname),
        peerId: sessionStore.peer?.id,
        reason,
        transferId,
      })
    } catch (error) {
      void error
    }
  }

  function broadcastToMembers(
    message: SignalingMessage,
    excludedPeerId?: string | null
  ) {
    for (const [peerId, connection] of Object.entries(
      memberConnections.value
    )) {
      if (peerId === excludedPeerId || !connection.open) {
        continue
      }

      connection.send(message)
    }
  }

  function sendToMember(peerId: string, message: SignalingMessage) {
    const connection = memberConnections.value[peerId]

    if (!connection?.open) {
      return false
    }

    connection.send(message)

    return true
  }

  function relayTransferMessage(
    message: FileOfferMessage | FileChunkMessage | FileCompleteMessage,
    senderPeerId?: string | null
  ) {
    if (message.targetPeerId) {
      sendToMember(message.targetPeerId, message)

      return
    }

    broadcastToMembers(message, senderPeerId)
  }

  function notifyReplayUnavailable(
    transferId: string,
    recipientPeerId: string,
    reason: string
  ) {
    const roomId = activeRoomId.value ?? roomStore.room?.id

    if (!roomId) {
      return
    }

    if (recipientPeerId === sessionStore.peer?.id) {
      roomStore.failTransfer(transferId, reason)

      return
    }

    const unavailableMessage = {
      type: 'replay-transfer-unavailable',
      roomId,
      transferId,
      recipientPeerId,
      reason,
    } satisfies ReplayTransferUnavailableMessage

    if (roomStore.preferBackendRelay && backendRelayClient.isConfigured) {
      void publishBackendRoomEvent(unavailableMessage, recipientPeerId)

      return
    }

    if (roomStore.room?.localMode === 'host') {
      sendToMember(recipientPeerId, unavailableMessage)

      return
    }

    if (hostConnection.value?.open) {
      hostConnection.value.send(unavailableMessage)
    }
  }

  function notifySenderTransferCancelled(transfer: FileTransfer) {
    const roomId = activeRoomId.value ?? roomStore.room?.id
    const localPeerId = sessionStore.peer?.id

    if (!roomId || !localPeerId || transfer.senderId === localPeerId) {
      return
    }

    const cancelMessage = {
      type: 'transfer-cancel',
      roomId,
      transferId: transfer.id,
      targetPeerId: transfer.senderId,
    } satisfies TransferCancelMessage

    if (roomStore.preferBackendRelay && backendRelayClient.isConfigured) {
      void publishBackendRoomEvent(cancelMessage)

      return
    }

    if (roomStore.room?.localMode === 'host') {
      if (cancelMessage.targetPeerId === localPeerId) {
        handleTransferCancelled(cancelMessage)

        return
      }

      sendToMember(cancelMessage.targetPeerId, cancelMessage)

      return
    }

    if (hostConnection.value?.open) {
      hostConnection.value.send(cancelMessage)
    }
  }

  function notifyRecipientsTransferCancelled(transferId: string) {
    const roomId = activeRoomId.value ?? roomStore.room?.id

    if (!roomId) {
      return
    }

    const targetPeerId = outgoingTransferTargets.get(transferId) ?? null
    const cancelMessage = {
      type: 'transfer-cancel',
      roomId,
      transferId,
      ...(targetPeerId ? { targetPeerId } : {}),
    } satisfies TransferCancelMessage

    if (roomStore.preferBackendRelay && backendRelayClient.isConfigured) {
      void publishBackendRoomEvent(cancelMessage)

      return
    }

    if (roomStore.room?.localMode === 'host') {
      if (targetPeerId) {
        sendToMember(targetPeerId, cancelMessage)

        return
      }

      broadcastToMembers(cancelMessage)

      return
    }

    if (hostConnection.value?.open) {
      hostConnection.value.send(cancelMessage)
    }
  }

  function abortIncomingRelayTransferDownload(transferId: string) {
    const relayTransfer = incomingRelayTransfers.get(transferId)

    if (!relayTransfer) {
      return false
    }

    relayTransfer.downloadController.abort()
    relayTransfer.downloadController = new AbortController()

    return true
  }

  function cancelLocalIncomingTransfer(
    transferId: string,
    preserveRelaySession = false
  ) {
    cancelledIncomingTransfers.add(transferId)

    const roomTransfer = roomStore.transfers.find(
      (currentTransfer) => currentTransfer.id === transferId
    )
    const transfer = incomingTransfers.get(transferId)

    if (transfer) {
      transfer.failed = true
      incomingTransfers.delete(transferId)
      clearTransferSpeedSample(transferId)
      roomStore.cancelTransfer(transferId)
      settleHistoryTransfer(transferId)
      finishIncomingTransferActivity(transferId)
      void disposeIncomingTransfer(transfer, preserveRelaySession)

      return roomTransfer ?? null
    }

    if (
      !roomTransfer ||
      roomTransfer.direction !== 'incoming' ||
      roomTransfer.status === 'completed'
    ) {
      return null
    }

    clearTransferSpeedSample(transferId)
    roomStore.cancelTransfer(transferId)
    settleHistoryTransfer(transferId)

    return roomTransfer
  }

  function handleTransferCancelled(message: TransferCancelMessage) {
    const roomTransfer = roomStore.transfers.find(
      (currentTransfer) => currentTransfer.id === message.transferId
    )

    if (roomTransfer?.direction === 'incoming') {
      cancelLocalIncomingTransfer(message.transferId)

      return
    }

    handleOutgoingTransferCancelled(message)
  }

  function requestHistoricalTransferReplays(recipientPeerId: string) {
    for (const transfer of listTransfersToReplay(
      roomStore.transfers,
      recipientPeerId
    )) {
      if (transfer.senderId === sessionStore.peer?.id) {
        queueOutgoingTransferReplay(transfer.id, recipientPeerId)

        continue
      }

      if (
        sendToMember(transfer.senderId, {
          type: 'replay-transfer',
          roomId: activeRoomId.value ?? roomStore.room?.id ?? '',
          transferId: transfer.id,
          recipientPeerId,
        } satisfies ReplayTransferRequestMessage)
      ) {
        continue
      }

      notifyReplayUnavailable(
        transfer.id,
        recipientPeerId,
        'The original sender is no longer connected to replay this upload.'
      )
    }
  }

  function broadcastRoomSync(excludedPeerId?: string | null) {
    const room = roomStore.room

    if (!room) {
      return
    }

    broadcastToMembers(
      {
        type: 'room-sync',
        preferBackendRelay: roomStore.preferBackendRelay,
        roomId: room.id,
        members: roomStore.members,
        presenceEvents: roomStore.presenceEvents,
      },
      excludedPeerId
    )
  }

  function broadcastPresenceEvent(
    event: Omit<PresenceEvent, 'id'>,
    excludedPeerId?: string | null
  ) {
    const room = roomStore.room

    if (!room) {
      return
    }

    broadcastToMembers(
      {
        type: 'presence-event',
        roomId: room.id,
        event,
      },
      excludedPeerId
    )
  }

  function bindHostConnection(connection: DataConnection) {
    const joinedAt =
      typeof connection.metadata?.joinedAt === 'string'
        ? connection.metadata.joinedAt
        : new Date().toISOString()
    const label =
      typeof connection.metadata?.label === 'string'
        ? connection.metadata.label
        : `Member ${connection.peer.slice(-4).toUpperCase()}`
    const peerId =
      typeof connection.metadata?.peerId === 'string'
        ? connection.metadata.peerId
        : connection.peer
    const preferredRelay = connection.metadata?.preferBackendRelay === true

    let didDisconnect = false
    let didActivate = false

    function activateMemberConnection(
      nextPeerId = peerId,
      nextLabel = label,
      nextJoinedAt = joinedAt
    ) {
      if (didActivate) {
        return
      }

      didActivate = true
      if (preferredRelay && !roomStore.preferBackendRelay) {
        roomStore.setPreferBackendRelay(true)
      }
      const duplicateConnection = memberConnections.value[connection.peer]

      if (duplicateConnection && duplicateConnection !== connection) {
        connection.close()
        notificationStore.pushNotification({
          title: 'Duplicate join ignored',
          detail: `${nextLabel} already has an active connection in this room.`,
          tone: 'warning',
        })

        return
      }

      memberConnections.value = {
        ...memberConnections.value,
        [connection.peer]: markRaw(connection),
      }

      roomStore.upsertMember({
        id: nextPeerId,
        label: nextLabel,
        role: 'member',
        connectionState: 'connected',
        joinedAt: nextJoinedAt,
      })
      const presenceEvent = roomStore.recordPresenceEvent(
        'joined',
        nextPeerId,
        nextLabel,
        new Date().toISOString()
      )
      notificationStore.pushNotification({
        title: 'Peer joined',
        detail: `${nextLabel} connected to the host channel.`,
        tone: 'success',
      })
      pulseNetworkActivity()
      connection.send({
        type: 'host-welcome',
        roomId: activeRoomId.value!,
        preferBackendRelay: roomStore.preferBackendRelay,
        host: {
          id: sessionStore.peer!.id,
          label: sessionStore.peer!.label,
          joinedAt: sessionStore.peer!.joinedAt,
        },
        members: roomStore.members,
        presenceEvents: roomStore.presenceEvents,
        messages: roomStore.messages,
        transfers: buildTransferHistorySnapshot(roomStore.transfers),
      } satisfies HostWelcomeMessage)
      broadcastRoomSync()
      broadcastPresenceEvent({
        type: presenceEvent.type,
        peerId: presenceEvent.peerId,
        peerLabel: presenceEvent.peerLabel,
        createdAt: presenceEvent.createdAt,
      })
      requestHistoricalTransferReplays(nextPeerId)
      setState('connected')
    }

    connection.on('open', () => {
      activateMemberConnection()
    })

    connection.on('data', (message) => {
      if (!isSignalingMessage(message)) {
        return
      }

      if (message.type === 'member-hello') {
        if (message.preferBackendRelay && !roomStore.preferBackendRelay) {
          roomStore.setPreferBackendRelay(true)
        }
        activateMemberConnection(
          message.peer.id,
          message.peer.label,
          message.peer.joinedAt
        )
        roomStore.upsertMember({
          id: message.peer.id,
          label: message.peer.label,
          role: 'member',
          connectionState: 'connected',
          joinedAt: message.peer.joinedAt,
        })
        broadcastRoomSync()

        return
      }

      if (message.type === 'relay-preference') {
        if (message.preferBackendRelay && !roomStore.preferBackendRelay) {
          roomStore.setPreferBackendRelay(true)
          broadcastRoomSync()
        }

        return
      }

      if (message.type === 'chat-send') {
        handleIncomingChatFromMember(connection, peerId, label, message)

        return
      }

      if (message.type === 'replay-transfer') {
        handleReplayTransferRequest(message)

        return
      }

      if (message.type === 'file-offer-ack') {
        if (message.targetPeerId === sessionStore.peer?.id) {
          handleDirectTransferReadyAck(message)
        } else {
          sendToMember(message.targetPeerId, message)
        }

        return
      }

      if (message.type === 'relay-transfer-offer') {
        if (message.targetPeerId === sessionStore.peer?.id) {
          handleIncomingRelayTransferOffer(message)
        } else {
          sendToMember(message.targetPeerId, message)
        }

        return
      }

      if (message.type === 'file-offer') {
        if (
          !message.targetPeerId ||
          message.targetPeerId === sessionStore.peer?.id
        ) {
          registerIncomingTransfer(message)
        }
        relayTransferMessage(message, connection.peer)

        return
      }

      if (message.type === 'file-chunk') {
        if (
          !message.targetPeerId ||
          message.targetPeerId === sessionStore.peer?.id
        ) {
          appendIncomingFileChunk(message)
        }
        relayTransferMessage(message, connection.peer)

        return
      }

      if (message.type === 'file-complete') {
        if (
          !message.targetPeerId ||
          message.targetPeerId === sessionStore.peer?.id
        ) {
          void finalizeIncomingTransfer(message.transferId)
        }
        relayTransferMessage(message, connection.peer)

        return
      }

      if (message.type === 'replay-transfer-unavailable') {
        sendToMember(message.recipientPeerId, message)

        return
      }

      if (message.type === 'transfer-cancel') {
        if (
          !message.targetPeerId ||
          message.targetPeerId === sessionStore.peer?.id
        ) {
          handleTransferCancelled(message)
        }

        if (message.targetPeerId) {
          if (message.targetPeerId !== sessionStore.peer?.id) {
            sendToMember(message.targetPeerId, message)
          }

          return
        }

        broadcastToMembers(message, connection.peer)

        return
      }
    })

    const handleDisconnect = () => {
      if (didDisconnect) {
        return
      }

      didDisconnect = true
      const existingConnection = memberConnections.value[connection.peer]

      if (existingConnection === connection) {
        const nextConnections = { ...memberConnections.value }

        delete nextConnections[connection.peer]
        memberConnections.value = nextConnections
      }

      const hadMember = roomStore.members.some((member) => member.id === peerId)

      roomStore.removeMember(peerId)

      if (!hadMember) {
        return
      }

      const presenceEvent = roomStore.recordPresenceEvent(
        'left',
        peerId,
        label,
        new Date().toISOString()
      )
      notificationStore.pushNotification({
        title: 'Peer disconnected',
        detail: `${label} left the host channel.`,
        tone: 'warning',
      })
      if (peerId) {
        roomStore.failPendingMessagesForPeer(peerId)
        roomStore.failTransfersForPeer(
          peerId,
          `${label} disconnected during the transfer.`
        )
        disposeIncomingTransfersForPeer(peerId)
      }
      if (hasOpenMemberConnections()) {
        pulseNetworkActivity()
      }
      broadcastRoomSync(connection.peer)
      broadcastPresenceEvent(
        {
          type: presenceEvent.type,
          peerId: presenceEvent.peerId,
          peerLabel: presenceEvent.peerLabel,
          createdAt: presenceEvent.createdAt,
        },
        connection.peer
      )
    }

    connection.on('close', handleDisconnect)
    connection.on('error', () => {
      handleDisconnect()
    })

    if (connection.open) {
      activateMemberConnection()
    }
  }

  return {
    state,
    errorMessage,
    retryCount,
    isReady,
    isHistoryLoading,
    isBackendRelayConfigured,
    ensureHost,
    ensureJoiner,
    retryJoinConnection,
    sendDraftMessage,
    sendFiles,
    cancelTransfer,
    requestTransferReplay,
    destroyPeer,
  }

  function handleIncomingChatFromMember(
    connection: DataConnection,
    peerId: string,
    label: string,
    payload: ChatSendMessage
  ) {
    const room = roomStore.room

    if (!room || payload.roomId !== room.id) {
      return
    }

    const validation = validateChatBody(payload.message.body)

    if (!validation.body) {
      connection.send({
        type: 'chat-rejected',
        roomId: room.id,
        messageId: payload.message.id,
        reason: validation.error ?? 'Message validation failed.',
      } satisfies ChatRejectedMessage)

      return
    }

    const relayMessage = buildTextMessage(
      {
        id: peerId,
        label,
      },
      validation.body,
      payload.message.createdAt,
      'sent',
      payload.message.id
    )

    roomStore.upsertMessage(relayMessage)
    broadcastChatMessage(relayMessage)
  }

  function relayHostMessage(message: ChatMessage) {
    const sentMessage: ChatMessage = {
      ...message,
      status: 'sent',
    }

    roomStore.upsertMessage(sentMessage)
    broadcastChatMessage(sentMessage)
  }

  function broadcastChatMessage(message: ChatMessage) {
    const room = roomStore.room

    if (!room) {
      return
    }

    if (hasOpenMemberConnections()) {
      pulseNetworkActivity()
    }

    broadcastToMembers({
      type: 'chat-broadcast',
      roomId: room.id,
      message,
    })
  }

  function ensureIncomingTransfer(
    input: Pick<
      FileOfferMessage,
      'transferId' | 'sender' | 'files' | 'totalBytes' | 'createdAt'
    >
  ) {
    if (cancelledIncomingTransfers.has(input.transferId)) {
      return false
    }

    if (incomingTransfers.has(input.transferId)) {
      return true
    }

    startIncomingTransferActivity(input.transferId)
    incomingTransfers.set(input.transferId, {
      transferId: input.transferId,
      senderId: input.sender.id,
      senderLabel: input.sender.label,
      totalBytes: input.totalBytes,
      files: new Map(
        input.files.map((file) => [
          file.id,
          {
            meta: file,
            receivedChunkIndexes: new Set<number>(),
            receivedChunks: 0,
            receivedBytes: 0,
            totalChunks: 0,
            storePromise: createIncomingTransferStore(file.id, file.name),
            writeChain: Promise.resolve(),
          } satisfies IncomingFileBuffer,
        ])
      ),
      failed: false,
    })
    roomStore.createIncomingTransfer(
      input.transferId,
      input.sender.id,
      input.sender.label,
      input.files,
      input.totalBytes,
      input.createdAt
    )
    primeTransferSpeedSample(input.transferId)

    return true
  }

  function registerIncomingTransfer(message: FileOfferMessage) {
    if (cancelledIncomingTransfers.has(message.transferId)) {
      return
    }

    if (
      !ensureIncomingTransfer({
        transferId: message.transferId,
        sender: message.sender,
        files: message.files,
        totalBytes: message.totalBytes,
        createdAt: message.createdAt,
      })
    ) {
      return
    }

    roomStore.setTransferTransport(message.transferId, 'webrtc')
    sendDirectTransferReadyAck(message.transferId, message.sender.id)
  }

  function appendIncomingFileChunk(message: FileChunkMessage) {
    if (cancelledIncomingTransfers.has(message.transferId)) {
      return
    }

    const transfer = incomingTransfers.get(message.transferId)

    if (!transfer) {
      return
    }

    void appendIncomingTransferChunk({
      chunkIndex: message.chunkIndex,
      data: message.data,
      fileId: message.fileId,
      totalChunks: message.totalChunks,
      transfer,
      transferId: message.transferId,
    })
  }

  function sendDirectTransferReadyAck(
    transferId: string,
    targetPeerId: string
  ) {
    const roomId = activeRoomId.value ?? roomStore.room?.id
    const localPeerId = sessionStore.peer?.id

    if (!roomId || !localPeerId) {
      return
    }

    const ackMessage = {
      type: 'file-offer-ack',
      roomId,
      transferId,
      peerId: localPeerId,
      targetPeerId,
    } satisfies FileOfferAckMessage

    if (roomStore.room?.localMode === 'host') {
      sendToMember(targetPeerId, ackMessage)

      return
    }

    if (hostConnection.value?.open) {
      hostConnection.value.send(ackMessage)
    }
  }

  function handleDirectTransferReadyAck(message: FileOfferAckMessage) {
    const pendingAck = pendingDirectOfferAcks.get(message.transferId)

    if (!pendingAck || pendingAck.recipientPeerId !== message.peerId) {
      return
    }

    pendingAck.resolve()
  }

  async function appendIncomingTransferChunk({
    chunkIndex,
    data,
    fileId,
    totalChunks,
    transfer,
    transferId,
  }: {
    chunkIndex: number
    data: ArrayBuffer
    fileId: string
    totalChunks: number
    transfer: IncomingTransferBuffer
    transferId: string
  }) {
    const fileBuffer = transfer.files.get(fileId)

    if (
      !fileBuffer ||
      transfer.failed ||
      fileBuffer.receivedChunkIndexes.has(chunkIndex)
    ) {
      return
    }

    fileBuffer.writeChain = fileBuffer.writeChain
      .then(async () => {
        if (
          transfer.failed ||
          cancelledIncomingTransfers.has(transferId) ||
          fileBuffer.receivedChunkIndexes.has(chunkIndex)
        ) {
          return
        }

        const store = await fileBuffer.storePromise

        await writeTransferStoreChunk(store, data)

        if (transfer.failed || cancelledIncomingTransfers.has(transferId)) {
          return
        }

        fileBuffer.receivedChunkIndexes.add(chunkIndex)
        fileBuffer.receivedChunks += 1
        fileBuffer.receivedBytes += data.byteLength
        fileBuffer.totalChunks = totalChunks

        const receivedBytes = Array.from(transfer.files.values()).reduce(
          (sum, currentFile) => sum + currentFile.receivedBytes,
          0
        )
        updateTransferProgressForBytes(
          transferId,
          receivedBytes,
          transfer.totalBytes
        )
      })
      .catch(async (error) => {
        if (transfer.failed) {
          return
        }

        transfer.failed = true
        clearTransferSpeedSample(transferId)
        roomStore.failTransfer(
          transferId,
          error instanceof Error
            ? error.message
            : 'Failed to write the incoming file.'
        )
        settleHistoryTransfer(transferId)
        incomingTransfers.delete(transferId)
        finishIncomingTransferActivity(transferId)
        await disposeIncomingTransfer(transfer)
      })

    await fileBuffer.writeChain
  }

  async function finalizeIncomingTransfer(transferId: string) {
    const transfer = incomingTransfers.get(transferId)

    if (!transfer || transfer.failed) {
      return
    }

    try {
      await Promise.all(
        Array.from(
          transfer.files.values(),
          (fileBuffer) => fileBuffer.writeChain
        )
      )

      const completedFiles = await Promise.all(
        Array.from(transfer.files.values(), async (fileBuffer) => {
          if (
            fileBuffer.totalChunks > 0 &&
            fileBuffer.receivedChunks !== fileBuffer.totalChunks
          ) {
            throw new Error(
              `${fileBuffer.meta.name} did not finish downloading.`
            )
          }

          const store = await fileBuffer.storePromise
          const completedFile = await closeTransferStore(store, {
            fileName: fileBuffer.meta.name,
            mimeType: fileBuffer.meta.mimeType,
          })

          return {
            ...fileBuffer.meta,
            downloadUrl: URL.createObjectURL(completedFile),
          }
        })
      )

      roomStore.completeTransfer(transferId, completedFiles)
      settleHistoryTransfer(transferId)
      notificationStore.pushNotification({
        title: 'Files ready',
        detail: `${transfer.senderLabel} shared ${completedFiles.length} file${completedFiles.length === 1 ? '' : 's'}.`,
        tone: 'success',
      })
    } catch (error) {
      transfer.failed = true
      clearTransferSpeedSample(transferId)
      roomStore.failTransfer(
        transferId,
        error instanceof Error ? error.message : 'File assembly failed.'
      )
      settleHistoryTransfer(transferId)
      await cancelIncomingRelayTransferSession(
        transferId,
        'The recipient could not complete the backend relay transfer.'
      )
      await disposeIncomingTransfer(transfer)
    } finally {
      clearTransferSpeedSample(transferId)
      incomingTransfers.delete(transferId)
      incomingRelayTransfers.get(transferId)?.downloadController.abort()
      incomingRelayTransfers.delete(transferId)
      finishIncomingTransferActivity(transferId)
    }
  }

  function handleIncomingRelayTransferOffer(
    message: RelayTransferOfferMessage
  ) {
    if (
      !ensureIncomingTransfer({
        transferId: message.transferId,
        sender: message.sender,
        files: message.files,
        totalBytes: message.totalBytes,
        createdAt: message.createdAt,
      })
    ) {
      return
    }

    const currentTransfer = roomStore.transfers.find(
      (transfer) => transfer.id === message.transferId
    )
    const existingRelayTransfer = incomingRelayTransfers.get(message.transferId)

    existingRelayTransfer?.downloadController.abort()

    incomingRelayTransfers.set(message.transferId, {
      downloadController: new AbortController(),
      files: message.relay.files,
      senderPeerId: message.sender.id,
    })

    roomStore.setTransferTransport(message.transferId, 'backend-relay')

    if (currentTransfer?.transport !== 'backend-relay') {
      notificationStore.pushNotification({
        title: 'Backend relay active',
        detail: `${message.sender.label} switched this transfer to backend relay.`,
        tone: 'info',
      })
    }

    void downloadIncomingRelayTransfer(message.transferId)
  }

  async function downloadIncomingRelayTransfer(transferId: string) {
    const relayTransfer = incomingRelayTransfers.get(transferId)
    const transfer = incomingTransfers.get(transferId)

    if (!relayTransfer || !transfer) {
      return
    }

    try {
      let downloadedBytes = 0

      for (const relayFile of relayTransfer.files) {
        if (relayTransfer.downloadController.signal.aborted) {
          return
        }

        const fileBuffer = transfer.files.get(relayFile.fileId)

        if (!fileBuffer) {
          throw new Error('The backend relay referenced an unknown file.')
        }

        const downloadedFile = await backendRelayClient.downloadFile({
          fileId: relayFile.fileId,
          fileName: fileBuffer.meta.name,
          mimeType: fileBuffer.meta.mimeType,
          onProgress: (loadedBytes) => {
            updateTransferProgressForBytes(
              transferId,
              downloadedBytes + loadedBytes,
              transfer.totalBytes ?? downloadedBytes + loadedBytes
            )
          },
          pathname: relayFile.pathname,
          signal: relayTransfer.downloadController.signal,
          transferId,
        })

        if (relayTransfer.downloadController.signal.aborted) {
          return
        }

        const store = await fileBuffer.storePromise

        await writeTransferStoreChunk(store, downloadedFile.file)
        fileBuffer.receivedChunkIndexes.add(0)
        fileBuffer.receivedChunks = 1
        fileBuffer.receivedBytes = downloadedFile.file.size
        fileBuffer.totalChunks = 1

        downloadedBytes += downloadedFile.file.size
        updateTransferProgressForBytes(
          transferId,
          downloadedBytes,
          transfer.totalBytes ?? downloadedBytes
        )

        await backendRelayClient.acknowledgeFile({
          fileId: relayFile.fileId,
          pathname: relayFile.pathname,
          transferId,
        })
      }

      await finalizeIncomingTransfer(transferId)
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      transfer.failed = true
      clearTransferSpeedSample(transferId)
      roomStore.failTransfer(
        transferId,
        error instanceof Error
          ? error.message
          : 'Backend relay download failed unexpectedly.'
      )
      settleHistoryTransfer(transferId)
      incomingTransfers.delete(transferId)
      finishIncomingTransferActivity(transferId)
      await cancelIncomingRelayTransferSession(
        transferId,
        error instanceof Error
          ? error.message
          : 'Backend relay download failed.'
      )
      await disposeIncomingTransfer(transfer)
    }
  }

  async function cancelIncomingRelayTransferSession(
    transferId: string,
    reason: string
  ) {
    const relayTransfer = incomingRelayTransfers.get(transferId)

    if (!relayTransfer) {
      return
    }

    relayTransfer.downloadController.abort()
    incomingRelayTransfers.delete(transferId)

    try {
      await backendRelayClient.cancelTransfer({
        pathnames: relayTransfer.files.map((file) => file.pathname),
        peerId: sessionStore.peer?.id,
        reason,
        transferId,
      })
    } catch (error) {
      void error
    }
  }

  async function streamTransferFiles(
    transfer: FileTransfer,
    files: File[],
    sessionId: number,
    send: (message: FileChunkMessage) => void,
    trackProgress = true
  ) {
    const roomId = roomStore.room?.id

    if (!roomId) {
      throw new Error('File transfers require an active room.')
    }

    let sentBytes = 0

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      throwIfOutgoingTransferCancelled(transfer.id, sessionId)

      const file = files[fileIndex]
      const fileMeta = transfer.files[fileIndex]

      if (!file || !fileMeta) {
        continue
      }

      await readFileInChunks(file, async (chunk, chunkIndex, totalChunks) => {
        throwIfOutgoingTransferCancelled(transfer.id, sessionId)

        send({
          type: 'file-chunk',
          roomId,
          transferId: transfer.id,
          fileId: fileMeta.id,
          chunkIndex,
          totalChunks,
          data: chunk,
        })

        if (trackProgress) {
          sentBytes += chunk.byteLength
          updateTransferProgressForBytes(
            transfer.id,
            sentBytes,
            transfer.totalBytes ?? sentBytes
          )
        }
      })
    }
  }

  function queueOutgoingTransferReplay(
    transferId: string,
    recipientPeerId: string
  ) {
    outgoingReplayChain = outgoingReplayChain
      .then(() =>
        networkActivityStore.track(
          () => replayOutgoingTransfer(transferId, recipientPeerId),
          0
        )
      )
      .catch((error) => {
        if (isTransferCancelledError(error)) {
          return
        }

        const detail =
          error instanceof Error
            ? error.message
            : 'A cached upload could not be replayed.'

        notifyReplayUnavailable(transferId, recipientPeerId, detail)
        notificationStore.pushNotification({
          title: 'Replay unavailable',
          detail,
          tone: 'warning',
        })
      })
  }

  function handleReplayTransferRequest(message: ReplayTransferRequestMessage) {
    const transfer = roomStore.transfers.find(
      (currentTransfer) => currentTransfer.id === message.transferId
    )

    if (!transfer) {
      notifyReplayUnavailable(
        message.transferId,
        message.recipientPeerId,
        'This upload is no longer available for replay.'
      )

      return
    }

    if (transfer.senderId === sessionStore.peer?.id) {
      queueOutgoingTransferReplay(message.transferId, message.recipientPeerId)

      return
    }

    if (roomStore.preferBackendRelay && backendRelayClient.isConfigured) {
      void publishBackendRoomEvent(message, transfer.senderId)

      return
    }

    if (sendToMember(transfer.senderId, { ...message })) {
      return
    }

    notifyReplayUnavailable(
      message.transferId,
      message.recipientPeerId,
      'The original sender is no longer connected to replay this upload.'
    )
  }

  function cancelTransfer(transferId: string) {
    const roomTransfer = roomStore.transfers.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    if (!roomTransfer || roomTransfer.status === 'completed') {
      return false
    }

    if (roomTransfer.direction === 'incoming') {
      const preserveRelaySession = roomTransfer.transport === 'backend-relay'

      if (preserveRelaySession) {
        abortIncomingRelayTransferDownload(transferId)
      }

      const cancelledTransfer = cancelLocalIncomingTransfer(
        transferId,
        preserveRelaySession
      )

      if (!cancelledTransfer) {
        return false
      }

      if (!preserveRelaySession) {
        notifySenderTransferCancelled(cancelledTransfer)
      }

      return true
    }

    const mode = outgoingTransferModes.get(transferId)
    const sessionId = outgoingTransferSessionIds.get(transferId)

    if (mode && sessionId !== undefined) {
      cancelledOutgoingTransferSessionIds.add(sessionId)
      rejectPendingDirectOfferAck(
        transferId,
        new TransferCancelledError(transferId)
      )
      syncCancelledOutgoingTransfer(transferId, mode)
      void cancelOutgoingRelayTransferSession(
        transferId,
        'The sender cancelled the backend relay transfer.'
      )
    } else {
      roomStore.cancelTransfer(transferId)
    }

    notifyRecipientsTransferCancelled(transferId)

    return true
  }

  function requestTransferReplay(transferId: string) {
    const room = roomStore.room
    const localPeer = sessionStore.peer
    const transfer = roomStore.transfers.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    if (!room || !localPeer || !transfer || transfer.direction !== 'incoming') {
      return false
    }

    cancelledIncomingTransfers.delete(transferId)
    primeTransferSpeedSample(transferId)
    roomStore.updateTransferProgress(transferId, 0, 'queued')

    const relayTransfer = incomingRelayTransfers.get(transferId)

    if (transfer.transport === 'backend-relay' && relayTransfer) {
      handleIncomingRelayTransferOffer({
        type: 'relay-transfer-offer',
        roomId: room.id,
        transferId,
        sender: {
          id: transfer.senderId,
          label: transfer.senderLabel,
        },
        files: buildReplayTransferFiles(transfer.files),
        totalBytes: transfer.totalBytes ?? 0,
        createdAt: transfer.createdAt,
        relay: {
          files: relayTransfer.files,
        },
        targetPeerId: localPeer.id,
      } satisfies RelayTransferOfferMessage)

      return true
    }

    const replayMessage = {
      type: 'replay-transfer',
      roomId: room.id,
      transferId,
      recipientPeerId: localPeer.id,
    } satisfies ReplayTransferRequestMessage

    if (room.localMode === 'host') {
      handleReplayTransferRequest(replayMessage)

      return true
    }

    if (roomStore.preferBackendRelay && backendRelayClient.isConfigured) {
      pulseNetworkActivity()
      void publishBackendRoomEvent(replayMessage, transfer.senderId).catch(
        (error) => {
          roomStore.failTransfer(
            transferId,
            error instanceof Error
              ? error.message
              : 'Reconnect to the backend relay before requesting this download again.'
          )
        }
      )

      return true
    }

    if (!hostConnection.value?.open) {
      roomStore.failTransfer(
        transferId,
        'Reconnect to the host before requesting this download again.'
      )

      return false
    }

    pulseNetworkActivity()
    hostConnection.value.send(replayMessage)

    return true
  }

  async function replayOutgoingTransfer(
    transferId: string,
    recipientPeerId: string
  ) {
    const room = roomStore.room
    const localPeer = sessionStore.peer
    const transfer = roomStore.transfers.find(
      (currentTransfer) => currentTransfer.id === transferId
    )
    const cachedFiles = outgoingTransferFiles.get(transferId)

    if (!room || !localPeer) {
      throw new Error('Transfer replay requires an active local room session.')
    }

    if (
      !hasReplayableFileSet(transfer, cachedFiles) ||
      !transfer ||
      !cachedFiles
    ) {
      throw new Error(
        'The original sender no longer has the selected files cached.'
      )
    }

    const outgoingSessionId = startOutgoingTransfer(
      transferId,
      'replay',
      recipientPeerId
    )
    primeTransferSpeedSample(transferId)
    roomStore.updateTransferProgress(transferId, 0, 'queued')

    if (roomStore.preferBackendRelay && backendRelayClient.isConfigured) {
      try {
        await sendFilesOverBackendRelay({
          activation: 'preferred',
          files: cachedFiles,
          recipientPeerId,
          room,
          sessionId: outgoingSessionId,
          transfer,
        })

        return
      } finally {
        roomStore.completeTransfer(transferId)
        finishOutgoingTransfer(transferId, outgoingSessionId)
      }
    }

    const offer: FileOfferMessage = {
      type: 'file-offer',
      roomId: room.id,
      transferId,
      sender: {
        id: transfer.senderId,
        label: transfer.senderLabel,
      },
      files: buildReplayTransferFiles(transfer.files),
      totalBytes: transfer.totalBytes ?? 0,
      createdAt: transfer.createdAt,
      targetPeerId: recipientPeerId,
    }

    try {
      if (room.localMode === 'host') {
        throwIfOutgoingTransferCancelled(transferId, outgoingSessionId)
        if (!sendToMember(recipientPeerId, offer)) {
          throw new Error('The replay recipient is no longer connected.')
        }

        await streamTransferFiles(
          transfer,
          cachedFiles,
          outgoingSessionId,
          (message) => {
            if (
              !sendToMember(recipientPeerId, {
                ...message,
                targetPeerId: recipientPeerId,
              })
            ) {
              throw new Error(
                'The replay recipient disconnected during the transfer.'
              )
            }
          },
          true
        )
        throwIfOutgoingTransferCancelled(transferId, outgoingSessionId)
        sendToMember(recipientPeerId, {
          type: 'file-complete',
          roomId: room.id,
          transferId,
          targetPeerId: recipientPeerId,
        } satisfies FileCompleteMessage)

        return
      }

      if (!hostConnection.value?.open) {
        throw new Error(
          'Reconnect to the host before replaying cached uploads.'
        )
      }

      throwIfOutgoingTransferCancelled(transferId, outgoingSessionId)
      hostConnection.value.send(offer)
      await streamTransferFiles(
        transfer,
        cachedFiles,
        outgoingSessionId,
        (message) => {
          if (!hostConnection.value?.open) {
            throw new Error(
              'The host connection closed before the replay finished.'
            )
          }

          hostConnection.value.send({
            ...message,
            targetPeerId: recipientPeerId,
          })
        },
        true
      )
      throwIfOutgoingTransferCancelled(transferId, outgoingSessionId)
      hostConnection.value.send({
        type: 'file-complete',
        roomId: room.id,
        transferId,
        targetPeerId: recipientPeerId,
      } satisfies FileCompleteMessage)
    } finally {
      roomStore.completeTransfer(transferId)
      finishOutgoingTransfer(transferId, outgoingSessionId)
    }
  }

  function handleDuplicateTabConflict() {
    const role = mode.value === 'host' ? 'host' : 'member'
    const nextPeer = sessionStore.rotatePeerIdentity(role)

    roomStore.syncLocalPeer()

    if (role === 'host') {
      hostPeerId.value = nextPeer.id
      roomStore.refreshHostPeerIdentity(nextPeer.id)
      notificationStore.pushNotification({
        title: 'Host moved to a fresh tab identity',
        detail:
          'Another tab was already using this host peer ID, so this tab generated a new one and refreshed the share link.',
        tone: 'warning',
      })

      if (activeRoomId.value) {
        ensureHost(activeRoomId.value)
      }

      return
    }

    notificationStore.pushNotification({
      title: 'Fresh tab session created',
      detail:
        'Another tab was already using this member peer ID, so this tab rejoined with a new local identity.',
      tone: 'warning',
    })

    if (activeRoomId.value && hostPeerId.value) {
      ensureJoiner(activeRoomId.value, hostPeerId.value)
    }
  }

  function handleOffline() {
    clearRetryTimer()
    resetHistoryLoading()
    sessionStore.setConnectionState('disconnected')
    roomStore.syncLocalPeer()
    roomStore.updateRoomStatus('disconnected')
    disposeAllIncomingTransfers()

    if (sessionStore.peer) {
      roomStore.failPendingMessagesForPeer(sessionStore.peer.id)
      roomStore.failTransfersForPeer(
        hostPeerId.value ?? sessionStore.peer.id,
        'Network connectivity was lost during the transfer.'
      )
    }

    setState(
      'disconnected',
      'This browser is offline. Reconnect to the internet to restore the room.'
    )
  }

  function handleOnline() {
    notificationStore.pushNotification({
      title: 'Back online',
      detail: 'Network connectivity returned. The room will try to recover.',
      tone: 'success',
    })

    if (mode.value === 'join') {
      retryJoinConnection()

      return
    }

    if (mode.value === 'host' && activeRoomId.value) {
      ensureHost(activeRoomId.value)
    }
  }

  watch(
    () => roomStore.preferBackendRelay,
    (preferBackendRelay, previousValue) => {
      if (preferBackendRelay === previousValue) {
        return
      }

      if (
        preferBackendRelay &&
        (state.value === 'connected' || state.value === 'listening') &&
        backendRelayClient.isConfigured
      ) {
        void startBackendRoomEventPolling()
      }

      if (mode.value === 'host') {
        broadcastRoomSync()

        return
      }

      if (
        mode.value === 'join' &&
        hostConnection.value?.open &&
        activeRoomId.value &&
        sessionStore.peer
      ) {
        hostConnection.value.send({
          type: 'relay-preference',
          peerId: sessionStore.peer.id,
          preferBackendRelay,
          roomId: activeRoomId.value,
        } satisfies RelayPreferenceMessage)
      }
    }
  )

  watch(
    backendRoomRelayKey,
    (nextKey) => {
      stopBackendRoomEventPolling()

      if (!nextKey) {
        return
      }

      void startBackendRoomEventPolling()
    },
    {
      immediate: true,
    }
  )
})

function buildPresenceNotification(
  eventType: PresenceEventType,
  peerLabel: string,
  isLocalPeer: boolean
) {
  if (eventType === 'joined') {
    return {
      title: isLocalPeer ? 'Joined room' : 'Peer joined',
      detail: isLocalPeer
        ? 'The host added this device to the room roster.'
        : `${peerLabel} joined the room.`,
      tone: 'success' as const,
    }
  }

  return {
    title: isLocalPeer ? 'Removed from room' : 'Peer left',
    detail: isLocalPeer
      ? 'The host removed this device from the room roster.'
      : `${peerLabel} left the room.`,
    tone: 'warning' as const,
  }
}

function formatPeerError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'PeerJS could not establish the connection.'
}

function getPeerErrorType(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as { type?: unknown }).type === 'string'
  ) {
    return (error as { type: string }).type
  }

  return null
}
