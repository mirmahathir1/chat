import Peer, {
  PeerErrorType,
  type DataConnection,
} from 'peerjs'
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { readFileInChunks } from '@/lib/fileTransfer'
import { mergeSyncedMessages } from '@/lib/messageSync'
import { getPeerOptions } from '@/lib/peerConfig'
import {
  abortTransferStore,
  closeTransferStore,
  createIncomingTransferStore,
  type TransferWritableStore,
  writeTransferStoreChunk,
} from '@/lib/transferStorage'
import { useNotificationStore } from '@/stores/notifications'
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
}

interface FileChunkMessage {
  type: 'file-chunk'
  roomId: string
  transferId: string
  fileId: string
  chunkIndex: number
  totalChunks: number
  data: ArrayBuffer
}

interface FileCompleteMessage {
  type: 'file-complete'
  roomId: string
  transferId: string
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

const maxRetryAttempts = 3

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

  const sessionStore = useSessionStore()
  const roomStore = useRoomStore()
  const notificationStore = useNotificationStore()

  const isReady = computed(
    () => state.value === 'listening' || state.value === 'connected'
  )

  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let listenersBound = false
  const incomingTransfers = new Map<string, IncomingTransferBuffer>()

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

      incomingTransfers.delete(transferId)
      void disposeIncomingTransfer(transfer)
    }
  }

  function disposeAllIncomingTransfers() {
    const transfers = Array.from(incomingTransfers.values())

    incomingTransfers.clear()

    for (const transfer of transfers) {
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
    clearRetryTimer()
  }

  function destroyPeer(resetContext = true) {
    resetConnections()
    peer.value?.destroy()
    peer.value = null
    if (resetContext) {
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
    const localPeer = sessionStore.ensureSession(nextMode === 'host' ? 'host' : 'member')

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

    const nextPeer = markRaw(new Peer(localPeer.id, getPeerOptions()))

    nextPeer.on('open', () => {
      if (peer.value !== nextPeer) {
        return
      }

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
      if (mode.value !== 'host' || connection.metadata?.roomId !== activeRoomId.value) {
        connection.close()

        return
      }

      bindHostConnection(connection)
    })

    nextPeer.on('disconnected', () => {
      if (peer.value !== nextPeer || nextPeer.destroyed) {
        return
      }

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

      sessionStore.setConnectionState('disconnected')
      roomStore.syncLocalPeer()
      setState('disconnected', 'Peer connection closed.')
    })

    nextPeer.on('error', (error) => {
      if (peer.value !== nextPeer) {
        return
      }

      const errorType = getPeerErrorType(error)

      if (errorType === PeerErrorType.UnavailableID) {
        handleDuplicateTabConflict()

        return
      }

      if (mode.value === 'join' && errorType === PeerErrorType.PeerUnavailable) {
        handleJoinDisconnect(
          'The host is offline or this room link is no longer reachable.'
        )

        return
      }

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
    })

    connection.on('data', (message) => {
      handleJoinMessage(message)
    })

    connection.on('close', () => {
      if (hostConnection.value === connection) {
        hostConnection.value = null
      }

      handleJoinDisconnect('The host connection closed.')
    })

    connection.on('error', (error) => {
      handleJoinDisconnect(formatPeerError(error))
    })
  }

  function handleJoinMessage(message: unknown) {
    if (!isSignalingMessage(message)) {
      return
    }

    if (message.type === 'host-welcome' || message.type === 'room-sync') {
      roomStore.replaceMembers(message.members)
      roomStore.replacePresenceEvents(message.presenceEvents)

      if (message.type === 'host-welcome') {
        roomStore.replaceMessages(
          mergeSyncedMessages(roomStore.messages, message.messages)
        )
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

    setState('error', reason)
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

    if (!transferResult.transfer || !transferResult.files || !room || !localPeer) {
      return false
    }

    const recipientCount = roomStore.members.filter(
      (member) =>
        member.id !== localPeer.id && member.connectionState === 'connected'
    ).length

    if (recipientCount === 0) {
      roomStore.failTransfer(
        transferResult.transfer.id,
        'No connected peers are available to receive files.'
      )
      notificationStore.pushNotification({
        title: 'No recipients available',
        detail: 'Wait for another connected member before sharing files.',
        tone: 'warning',
      })

      return false
    }

    roomStore.updateTransferProgress(transferResult.transfer.id, 0)

    const offer: FileOfferMessage = {
      type: 'file-offer',
      roomId: room.id,
      transferId: transferResult.transfer.id,
      sender: {
        id: localPeer.id,
        label: localPeer.label,
      },
      files: transferResult.transfer.files,
      totalBytes: transferResult.transfer.totalBytes ?? 0,
    }

    try {
      if (room.localMode === 'host') {
        broadcastToMembers(offer)
        await streamTransferFiles(
          transferResult.transfer,
          transferResult.files,
          (message) => {
            broadcastToMembers(message)
          }
        )
        broadcastToMembers({
          type: 'file-complete',
          roomId: room.id,
          transferId: transferResult.transfer.id,
        } satisfies FileCompleteMessage)
        roomStore.completeTransfer(transferResult.transfer.id)

        return true
      }

      if (!hostConnection.value?.open) {
        roomStore.failTransfer(
          transferResult.transfer.id,
          'Reconnect to the host before sharing files.'
        )

        return false
      }

      const connection = hostConnection.value

      connection.send(offer)
      await streamTransferFiles(transferResult.transfer, transferResult.files, (message) => {
        if (!connection.open) {
          throw new Error('The host connection closed before the upload finished.')
        }

        connection.send(message)
      })
      connection.send({
        type: 'file-complete',
        roomId: room.id,
        transferId: transferResult.transfer.id,
      } satisfies FileCompleteMessage)
      roomStore.completeTransfer(transferResult.transfer.id)

      return true
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'File transfer failed unexpectedly.'

      roomStore.failTransfer(transferResult.transfer.id, detail)
      notificationStore.pushNotification({
        title: 'File transfer failed',
        detail,
        tone: 'warning',
      })

      return false
    }
  }

  function broadcastToMembers(
    message: SignalingMessage,
    excludedPeerId?: string | null
  ) {
    for (const [peerId, connection] of Object.entries(memberConnections.value)) {
      if (peerId === excludedPeerId || !connection.open) {
        continue
      }

      connection.send(message)
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

    function activateMemberConnection(nextPeerId = peerId, nextLabel = label, nextJoinedAt = joinedAt) {
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
      } satisfies HostWelcomeMessage)
      broadcastRoomSync()
      broadcastPresenceEvent({
        type: presenceEvent.type,
        peerId: presenceEvent.peerId,
        peerLabel: presenceEvent.peerLabel,
        createdAt: presenceEvent.createdAt,
      })
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

      if (message.type === 'file-offer') {
        registerIncomingTransfer(message)
        broadcastToMembers(message, connection.peer)

        return
      }

      if (message.type === 'file-chunk') {
        appendIncomingFileChunk(message)
        broadcastToMembers(message, connection.peer)

        return
      }

      if (message.type === 'file-complete') {
        void finalizeIncomingTransfer(message.transferId)
        broadcastToMembers(message, connection.peer)
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
    ensureHost,
    ensureJoiner,
    retryJoinConnection,
    sendDraftMessage,
    sendFiles,
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

    broadcastToMembers({
      type: 'chat-broadcast',
      roomId: room.id,
      message,
    })
  }

  function registerIncomingTransfer(message: FileOfferMessage) {
    if (incomingTransfers.has(message.transferId)) {
      return
    }

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
      message.totalBytes
    )
  }

  function appendIncomingFileChunk(message: FileChunkMessage) {
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
        if (transfer.failed || fileBuffer.receivedChunkIndexes.has(message.chunkIndex)) {
          return
        }

        const store = await fileBuffer.storePromise

        await writeTransferStoreChunk(store, message.data)

        fileBuffer.receivedChunkIndexes.add(message.chunkIndex)
        fileBuffer.receivedChunks += 1
        fileBuffer.receivedBytes += message.data.byteLength
        fileBuffer.totalChunks = message.totalChunks

        const receivedBytes = Array.from(transfer.files.values()).reduce(
          (sum, currentFile) => sum + currentFile.receivedBytes,
          0
        )
        const progress =
          transfer.totalBytes > 0 ? (receivedBytes / transfer.totalBytes) * 100 : 0

        roomStore.updateTransferProgress(message.transferId, progress)
      })
      .catch(async (error) => {
        if (transfer.failed) {
          return
        }

        transfer.failed = true
        roomStore.failTransfer(
          message.transferId,
          error instanceof Error ? error.message : 'Failed to write the incoming file.'
        )
        incomingTransfers.delete(message.transferId)
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
        Array.from(transfer.files.values(), (fileBuffer) => fileBuffer.writeChain)
      )

      const completedFiles = await Promise.all(
        Array.from(transfer.files.values(), async (fileBuffer) => {
        if (
          fileBuffer.totalChunks > 0 &&
          fileBuffer.receivedChunks !== fileBuffer.totalChunks
        ) {
          throw new Error(`${fileBuffer.meta.name} did not finish downloading.`)
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
      await disposeIncomingTransfer(transfer)
    } finally {
      incomingTransfers.delete(transferId)
    }
  }

  async function streamTransferFiles(
    transfer: FileTransfer,
    files: File[],
    send: (message: FileChunkMessage) => void
  ) {
    const roomId = roomStore.room?.id

    if (!roomId) {
      throw new Error('File transfers require an active room.')
    }

    let sentBytes = 0

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex]
      const fileMeta = transfer.files[fileIndex]

      if (!file || !fileMeta) {
        continue
      }

      await readFileInChunks(file, async (chunk, chunkIndex, totalChunks) => {
        send({
          type: 'file-chunk',
          roomId,
          transferId: transfer.id,
          fileId: fileMeta.id,
          chunkIndex,
          totalChunks,
          data: chunk,
        })
        sentBytes += chunk.byteLength
        const progress =
          (sentBytes / Math.max(transfer.totalBytes ?? sentBytes, 1)) * 100

        roomStore.updateTransferProgress(transfer.id, progress)
      })
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
