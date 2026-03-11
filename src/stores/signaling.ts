import Peer, { PeerErrorType, type DataConnection } from 'peerjs'
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { readFileInChunks } from '@/lib/fileTransfer'
import { mergeSyncedMessages } from '@/lib/messageSync'
import { getPeerOptions } from '@/lib/peerConfig'
import {
  buildReplayTransferFiles,
  hasReplayableFileSet,
  listTransfersToReplay,
} from '@/lib/transferReplay'
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
import { maxChatMessageBytes, useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import type {
  ChatMessage,
  FileTransfer,
  LocalRoomMode,
  PeerIdentity,
  PresenceEvent,
  PresenceEventType,
  SignalingState,
  TransferFile,
} from '@/types/chat'

interface MemberHelloMessage {
  type: 'member-hello'
  roomId: string
  peer: Pick<PeerIdentity, 'id' | 'label' | 'joinedAt'>
}

interface HostWelcomeMessage {
  type: 'host-welcome'
  roomId: string
  host: Pick<PeerIdentity, 'id' | 'label' | 'joinedAt'>
  members: PeerIdentity[]
  presenceEvents: PresenceEvent[]
  messages: ChatMessage[]
  transfers?: FileTransfer[]
}

interface RoomSyncMessage {
  type: 'room-sync'
  roomId: string
  members: PeerIdentity[]
  presenceEvents: PresenceEvent[]
}

interface PresenceBroadcastMessage {
  type: 'presence-event'
  roomId: string
  event: Omit<PresenceEvent, 'id'>
}

interface ChatSendMessage {
  type: 'chat-send'
  roomId: string
  message: Pick<ChatMessage, 'id' | 'body' | 'createdAt'>
}

interface ChatBroadcastMessage {
  type: 'chat-broadcast'
  roomId: string
  message: ChatMessage
}

interface ChatRejectedMessage {
  type: 'chat-rejected'
  roomId: string
  messageId: string
  reason: string
}

interface FileOfferMessage {
  type: 'file-offer'
  roomId: string
  transferId: string
  sender: Pick<PeerIdentity, 'id' | 'label'>
  files: TransferFile[]
  totalBytes: number
  createdAt?: string
  targetPeerId?: string
}

interface FileChunkMessage {
  type: 'file-chunk'
  roomId: string
  transferId: string
  fileId: string
  chunkIndex: number
  totalChunks: number
  data: ArrayBuffer
  targetPeerId?: string
}

interface FileCompleteMessage {
  type: 'file-complete'
  roomId: string
  transferId: string
  targetPeerId?: string
}

interface ReplayTransferRequestMessage {
  type: 'replay-transfer'
  roomId: string
  transferId: string
  recipientPeerId: string
}

interface ReplayTransferUnavailableMessage {
  type: 'replay-transfer-unavailable'
  roomId: string
  transferId: string
  recipientPeerId: string
  reason: string
}

interface TransferCancelMessage {
  type: 'transfer-cancel'
  roomId: string
  transferId: string
  targetPeerId?: string
}

type SignalingMessage =
  | MemberHelloMessage
  | HostWelcomeMessage
  | RoomSyncMessage
  | PresenceBroadcastMessage
  | ChatSendMessage
  | ChatBroadcastMessage
  | ChatRejectedMessage
  | FileOfferMessage
  | FileChunkMessage
  | FileCompleteMessage
  | ReplayTransferRequestMessage
  | ReplayTransferUnavailableMessage
  | TransferCancelMessage

const maxRetryAttempts = 3
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

  const sessionStore = useSessionStore()
  const roomStore = useRoomStore()
  const notificationStore = useNotificationStore()
  const networkActivityStore = useNetworkActivityStore()

  const isReady = computed(
    () => state.value === 'listening' || state.value === 'connected'
  )

  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let listenersBound = false
  const incomingTransfers = new Map<string, IncomingTransferBuffer>()
  const cancelledIncomingTransfers = new Set<string>()
  const outgoingTransferFiles = new Map<string, File[]>()
  const outgoingTransferModes = new Map<string, OutgoingTransferMode>()
  const outgoingTransferTargets = new Map<string, string | null>()
  const cancelledOutgoingTransfers = new Set<string>()
  const incomingTransferActivityTokens = new Map<string, number>()
  let outgoingReplayChain = Promise.resolve()
  let peerBootstrapActivityToken: number | null = null
  let joinConnectionActivityToken: number | null = null

  function setState(nextState: SignalingState, nextError?: string | null) {
    state.value = nextState
    errorMessage.value = nextError ?? null
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
    outgoingTransferModes.set(transferId, mode)
    outgoingTransferTargets.set(transferId, targetPeerId)
  }

  function finishOutgoingTransfer(transferId: string) {
    outgoingTransferModes.delete(transferId)
    outgoingTransferTargets.delete(transferId)
    cancelledOutgoingTransfers.delete(transferId)
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

  function throwIfOutgoingTransferCancelled(transferId: string) {
    if (cancelledOutgoingTransfers.has(transferId)) {
      throw new TransferCancelledError(transferId)
    }
  }

  function handleOutgoingTransferCancelled(message: TransferCancelMessage) {
    cancelledOutgoingTransfers.add(message.transferId)

    const mode = outgoingTransferModes.get(message.transferId)

    if (!mode) {
      return
    }

    syncCancelledOutgoingTransfer(message.transferId, mode)

    if (message.targetPeerId) {
      notifyRecipientsTransferCancelled(message.transferId)
    }
  }

  async function disposeIncomingTransfer(transfer: IncomingTransferBuffer) {
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
      incomingTransfers.delete(transferId)
      finishIncomingTransferActivity(transferId)
      void disposeIncomingTransfer(transfer)
    }
  }

  function disposeAllIncomingTransfers() {
    const transfers = Array.from(incomingTransfers.values())

    incomingTransfers.clear()
    finishAllIncomingTransferActivity()

    for (const transfer of transfers) {
      transfer.failed = true
      void disposeIncomingTransfer(transfer)
    }
  }

  function resetConnections() {
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
    outgoingTransferFiles.clear()
    outgoingTransferModes.clear()
    cancelledOutgoingTransfers.clear()
    outgoingReplayChain = Promise.resolve()
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

    startOutgoingTransfer(transfer.id, 'live')
    roomStore.updateTransferProgress(transfer.id, 0)

    const offer: FileOfferMessage = {
      type: 'file-offer',
      roomId: room.id,
      transferId: transfer.id,
      sender: {
        id: localPeer.id,
        label: localPeer.label,
      },
      files: transfer.files,
      totalBytes: transfer.totalBytes ?? 0,
      createdAt: transfer.createdAt,
    }

    return networkActivityStore
      .track(async () => {
        if (room.localMode === 'host') {
          throwIfOutgoingTransferCancelled(transfer.id)
          broadcastToMembers(offer)
          await streamTransferFiles(
            transfer,
            files,
            (message) => {
              broadcastToMembers(message)
            },
            true
          )
          throwIfOutgoingTransferCancelled(transfer.id)
          broadcastToMembers({
            type: 'file-complete',
            roomId: room.id,
            transferId: transfer.id,
          } satisfies FileCompleteMessage)
          roomStore.completeTransfer(transfer.id)

          return true
        }

        if (!hostConnection.value?.open) {
          roomStore.failTransfer(
            transfer.id,
            'Reconnect to the host before sharing files.'
          )

          return false
        }

        const connection = hostConnection.value

        throwIfOutgoingTransferCancelled(transfer.id)
        connection.send(offer)
        await streamTransferFiles(
          transfer,
          files,
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
        throwIfOutgoingTransferCancelled(transfer.id)
        connection.send({
          type: 'file-complete',
          roomId: room.id,
          transferId: transfer.id,
        } satisfies FileCompleteMessage)
        roomStore.completeTransfer(transfer.id)

        return true
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
        finishOutgoingTransfer(transfer.id)
      })
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

  function cancelLocalIncomingTransfer(transferId: string) {
    cancelledIncomingTransfers.add(transferId)

    const roomTransfer = roomStore.transfers.find(
      (currentTransfer) => currentTransfer.id === transferId
    )
    const transfer = incomingTransfers.get(transferId)

    if (transfer) {
      transfer.failed = true
      incomingTransfers.delete(transferId)
      roomStore.cancelTransfer(transferId)
      settleHistoryTransfer(transferId)
      finishIncomingTransferActivity(transferId)
      void disposeIncomingTransfer(transfer)

      return roomTransfer ?? null
    }

    if (
      !roomTransfer ||
      roomTransfer.direction !== 'incoming' ||
      roomTransfer.status === 'completed'
    ) {
      return null
    }

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

      if (message.type === 'chat-send') {
        handleIncomingChatFromMember(connection, peerId, label, message)

        return
      }

      if (message.type === 'replay-transfer') {
        handleReplayTransferRequest(message)

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

    const trimmedBody = payload.message.body.trim()

    if (!trimmedBody) {
      connection.send({
        type: 'chat-rejected',
        roomId: room.id,
        messageId: payload.message.id,
        reason: 'Messages cannot be empty.',
      } satisfies ChatRejectedMessage)

      return
    }

    const messageBytes = new TextEncoder().encode(trimmedBody).length

    if (messageBytes > maxChatMessageBytes) {
      connection.send({
        type: 'chat-rejected',
        roomId: room.id,
        messageId: payload.message.id,
        reason: `Messages must stay under ${maxChatMessageBytes} bytes.`,
      } satisfies ChatRejectedMessage)

      return
    }

    const relayMessage: ChatMessage = {
      id: payload.message.id,
      kind: 'text',
      senderId: peerId,
      senderLabel: label,
      body: trimmedBody,
      createdAt: payload.message.createdAt,
      status: 'sent',
    }

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

  function registerIncomingTransfer(message: FileOfferMessage) {
    if (cancelledIncomingTransfers.has(message.transferId)) {
      return
    }

    if (incomingTransfers.has(message.transferId)) {
      return
    }

    startIncomingTransferActivity(message.transferId)
    incomingTransfers.set(message.transferId, {
      transferId: message.transferId,
      senderId: message.sender.id,
      senderLabel: message.sender.label,
      totalBytes: message.totalBytes,
      files: new Map(
        message.files.map((file) => [
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
      message.transferId,
      message.sender.id,
      message.sender.label,
      message.files,
      message.totalBytes,
      message.createdAt
    )
  }

  function appendIncomingFileChunk(message: FileChunkMessage) {
    if (cancelledIncomingTransfers.has(message.transferId)) {
      return
    }

    const transfer = incomingTransfers.get(message.transferId)

    if (!transfer) {
      return
    }

    const fileBuffer = transfer.files.get(message.fileId)

    if (
      !fileBuffer ||
      transfer.failed ||
      fileBuffer.receivedChunkIndexes.has(message.chunkIndex)
    ) {
      return
    }

    fileBuffer.writeChain = fileBuffer.writeChain
      .then(async () => {
        if (
          transfer.failed ||
          cancelledIncomingTransfers.has(message.transferId) ||
          fileBuffer.receivedChunkIndexes.has(message.chunkIndex)
        ) {
          return
        }

        const store = await fileBuffer.storePromise

        await writeTransferStoreChunk(store, message.data)

        if (
          transfer.failed ||
          cancelledIncomingTransfers.has(message.transferId)
        ) {
          return
        }

        fileBuffer.receivedChunkIndexes.add(message.chunkIndex)
        fileBuffer.receivedChunks += 1
        fileBuffer.receivedBytes += message.data.byteLength
        fileBuffer.totalChunks = message.totalChunks

        const receivedBytes = Array.from(transfer.files.values()).reduce(
          (sum, currentFile) => sum + currentFile.receivedBytes,
          0
        )
        const progress =
          transfer.totalBytes > 0
            ? (receivedBytes / transfer.totalBytes) * 100
            : 0

        roomStore.updateTransferProgress(message.transferId, progress)
      })
      .catch(async (error) => {
        if (transfer.failed) {
          return
        }

        transfer.failed = true
        roomStore.failTransfer(
          message.transferId,
          error instanceof Error
            ? error.message
            : 'Failed to write the incoming file.'
        )
        settleHistoryTransfer(message.transferId)
        incomingTransfers.delete(message.transferId)
        finishIncomingTransferActivity(message.transferId)
        await disposeIncomingTransfer(transfer)
      })
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
      roomStore.failTransfer(
        transferId,
        error instanceof Error ? error.message : 'File assembly failed.'
      )
      settleHistoryTransfer(transferId)
      await disposeIncomingTransfer(transfer)
    } finally {
      incomingTransfers.delete(transferId)
      finishIncomingTransferActivity(transferId)
    }
  }

  async function streamTransferFiles(
    transfer: FileTransfer,
    files: File[],
    send: (message: FileChunkMessage) => void,
    trackProgress = true
  ) {
    const roomId = roomStore.room?.id

    if (!roomId) {
      throw new Error('File transfers require an active room.')
    }

    let sentBytes = 0

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      throwIfOutgoingTransferCancelled(transfer.id)

      const file = files[fileIndex]
      const fileMeta = transfer.files[fileIndex]

      if (!file || !fileMeta) {
        continue
      }

      await readFileInChunks(file, async (chunk, chunkIndex, totalChunks) => {
        throwIfOutgoingTransferCancelled(transfer.id)

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
          const progress =
            (sentBytes / Math.max(transfer.totalBytes ?? sentBytes, 1)) * 100

          roomStore.updateTransferProgress(transfer.id, progress)
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
      const cancelledTransfer = cancelLocalIncomingTransfer(transferId)

      if (!cancelledTransfer) {
        return false
      }

      notifySenderTransferCancelled(cancelledTransfer)

      return true
    }

    const mode = outgoingTransferModes.get(transferId)

    if (mode) {
      cancelledOutgoingTransfers.add(transferId)
      syncCancelledOutgoingTransfer(transferId, mode)
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
    roomStore.updateTransferProgress(transferId, 0, 'queued')

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

    startOutgoingTransfer(transferId, 'replay', recipientPeerId)
    roomStore.updateTransferProgress(transferId, 0, 'queued')

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
        throwIfOutgoingTransferCancelled(transferId)
        if (!sendToMember(recipientPeerId, offer)) {
          throw new Error('The replay recipient is no longer connected.')
        }

        await streamTransferFiles(
          transfer,
          cachedFiles,
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
        throwIfOutgoingTransferCancelled(transferId)
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

      throwIfOutgoingTransferCancelled(transferId)
      hostConnection.value.send(offer)
      await streamTransferFiles(
        transfer,
        cachedFiles,
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
      throwIfOutgoingTransferCancelled(transferId)
      hostConnection.value.send({
        type: 'file-complete',
        roomId: room.id,
        transferId,
        targetPeerId: recipientPeerId,
      } satisfies FileCompleteMessage)
    } finally {
      roomStore.completeTransfer(transferId)
      finishOutgoingTransfer(transferId)
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
})

function isSignalingMessage(value: unknown): value is SignalingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type !== undefined
  )
}

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
