import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createTransferFiles,
  validateTransferFiles,
} from '@/lib/fileTransfer'
import { createId } from '@/lib/id'
import { buildShareUrl } from '@/lib/roomLink'
import type {
  ChatMessage,
  FileTransfer,
  PeerIdentity,
  PresenceEvent,
  RoomNotification,
  RoomSummary,
  TransferFile,
} from '@/types/chat'
import { useNotificationStore } from '@/stores/notifications'
import { useSessionStore } from '@/stores/session'

export const maxChatMessageBytes = 2048

interface DraftMessageResult {
  message: ChatMessage | null
  error: string | null
}

interface DraftTransferResult {
  transfer: FileTransfer | null
  files: File[] | null
  error: string | null
}

function buildSystemMessage(body: string, createdAt: string): ChatMessage {
  return {
    id: createId('message'),
    kind: 'system',
    senderId: 'system',
    senderLabel: 'Room',
    body,
    createdAt,
    status: 'sent',
  }
}

function buildInitialNotifications(
  host: PeerIdentity,
  room: RoomSummary
): RoomNotification[] {
  return [
    {
      id: createId('notification'),
      title: 'Hosted room ready',
      detail:
        'Hosted room is live. Scan the QR code from another device to open the join flow for this room.',
      tone: 'success',
      createdAt: room.createdAt,
      seen: false,
    },
    {
      id: createId('notification'),
      title: 'Chat ready',
      detail:
        'Text chat is live. The host relays messages across the room through the signaling channel.',
      tone: 'info',
      createdAt: room.createdAt,
      seen: false,
    },
    {
      id: createId('notification'),
      title: 'Share link is ready',
      detail:
        `${host.label} is the current host for room ${room.id}.`,
      tone: 'info',
      createdAt: room.createdAt,
      seen: false,
    },
  ]
}

function buildTextMessage(
  sender: Pick<PeerIdentity, 'id' | 'label'>,
  body: string,
  createdAt: string,
  status: ChatMessage['status'],
  id = createId('message')
): ChatMessage {
  return {
    id,
    kind: 'text',
    senderId: sender.id,
    senderLabel: sender.label,
    body,
    createdAt,
    status,
  }
}

function validateChatBody(body: string) {
  const trimmed = body.trim()

  if (!trimmed) {
    return {
      body: null,
      error: 'Messages cannot be empty.',
    }
  }

  const messageBytes = new TextEncoder().encode(trimmed).length

  if (messageBytes > maxChatMessageBytes) {
    return {
      body: null,
      error: `Messages must stay under ${maxChatMessageBytes} bytes.`,
    }
  }

  return {
    body: trimmed,
    error: null,
  }
}

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomSummary | null>(loadStoredRoom())
  const members = ref<PeerIdentity[]>(loadStoredMembers())
  const messages = ref<ChatMessage[]>(loadStoredMessages())
  const presenceEvents = ref<PresenceEvent[]>(loadStoredPresenceEvents())
  const transfers = ref<FileTransfer[]>([])
  const draftMessage = ref('')

  const sessionStore = useSessionStore()
  const notificationStore = useNotificationStore()

  const memberCount = computed(() => members.value.length)
  const connectedMemberCount = computed(
    () =>
      members.value.filter((member) => member.connectionState === 'connected')
        .length
  )
  const hasActiveRoom = computed(() => room.value?.status === 'active')
  const hostPeer = computed(
    () =>
      members.value.find((member) => member.id === room.value?.hostPeerId) ??
      null
  )
  const isHostView = computed(() => room.value?.localMode === 'host')
  const isJoinView = computed(() => room.value?.localMode === 'join')

  function persistRoomState() {
    return
  }

  function bootstrapHostedRoom(roomId = createId('room')) {
    const host = sessionStore.rotatePeerIdentity('host')
    const now = new Date().toISOString()
    const hostedRoom: RoomSummary = {
      id: roomId,
      name: `Hosted room ${roomId.slice(-4).toUpperCase()}`,
      hostPeerId: host.id,
      shareUrl: buildShareUrl(roomId, host.id),
      createdAt: now,
      status: 'active',
      localMode: 'host',
    }

    sessionStore.setRole('host')
    sessionStore.setConnectionState('connected')

    room.value = hostedRoom
    members.value = [
      {
        ...host,
        role: 'host',
        connectionState: 'connected',
      },
    ]
    presenceEvents.value = [
      {
        id: createId('presence'),
        type: 'host-created',
        peerId: host.id,
        peerLabel: host.label,
        createdAt: now,
      },
    ]
    transfers.value = []
    messages.value = []
    transfers.value = []
    draftMessage.value = ''
    notificationStore.replaceAll(buildInitialNotifications(host, hostedRoom))
    persistRoomState()

    return hostedRoom.id
  }

  function prepareJoinRoom(roomId: string, hostPeerId: string) {
    const localPeer = sessionStore.rotatePeerIdentity('member')
    const now = new Date().toISOString()

    sessionStore.setRole('member')
    sessionStore.setConnectionState('idle')

    room.value = {
      id: roomId,
      name: `Join room ${roomId.slice(-4).toUpperCase()}`,
      hostPeerId,
      shareUrl: buildShareUrl(roomId, hostPeerId),
      createdAt: now,
      status: 'draft',
      localMode: 'join',
    }
    members.value = [
      {
        id: hostPeerId,
        label: 'Room host',
        role: 'host',
        connectionState: 'idle',
        joinedAt: now,
      },
      {
        ...localPeer,
        role: 'member',
        connectionState: 'idle',
      },
    ]
    presenceEvents.value = [
      {
        id: createId('presence'),
        type: 'joined',
        peerId: localPeer.id,
        peerLabel: localPeer.label,
        createdAt: now,
      },
    ]
    messages.value = []
    transfers.value = []
    draftMessage.value = ''
    notificationStore.replaceAll([
      {
        id: createId('notification'),
        title: 'Join link loaded',
        detail: `This browser is staged to join room ${roomId} through host ${hostPeerId}.`,
        tone: 'success',
        createdAt: now,
        seen: false,
      },
      {
        id: createId('notification'),
        title: 'Connection pending',
        detail:
          'The scanned link is valid. This device will unlock room chat after the host connection is established.',
        tone: 'info',
        createdAt: now,
        seen: false,
      },
    ])
    persistRoomState()
  }

  function ensureHostedRoom(roomId: string) {
    if (room.value?.id === roomId && room.value.localMode === 'host') {
      return
    }

    bootstrapHostedRoom(roomId)
  }

  function refreshHostPeerIdentity(nextHostPeerId: string) {
    if (!room.value || room.value.localMode !== 'host') {
      return
    }

    room.value = {
      ...room.value,
      hostPeerId: nextHostPeerId,
      shareUrl: buildShareUrl(room.value.id, nextHostPeerId),
    }
    members.value = members.value.map((member) =>
      member.role === 'host'
        ? {
            ...member,
            id: nextHostPeerId,
          }
        : member
    )
    persistRoomState()
  }

  function updateRoomStatus(status: RoomSummary['status']) {
    if (!room.value) {
      return
    }

    room.value = {
      ...room.value,
      status,
    }
    persistRoomState()
  }

  function appendSystemMessage(body: string) {
    if (!room.value) {
      return
    }

    messages.value = [
      ...messages.value,
      buildSystemMessage(body, new Date().toISOString()),
    ]
    persistRoomState()
  }

  function recordPresenceEvent(
    type: PresenceEvent['type'],
    peerId: string,
    peerLabel: string,
    createdAt = new Date().toISOString()
  ) {
    const event: PresenceEvent = {
      id: createId('presence'),
      type,
      peerId,
      peerLabel,
      createdAt,
    }

    presenceEvents.value = [...presenceEvents.value, event]
    persistRoomState()

    return event
  }

  function replaceMessages(nextMessages: ChatMessage[]) {
    messages.value = nextMessages
    persistRoomState()
  }

  function replacePresenceEvents(nextPresenceEvents: PresenceEvent[]) {
    presenceEvents.value = nextPresenceEvents
    persistRoomState()
  }

  function upsertTransfer(transfer: FileTransfer) {
    const existingIndex = transfers.value.findIndex(
      (currentTransfer) => currentTransfer.id === transfer.id
    )

    if (existingIndex === -1) {
      transfers.value = [transfer, ...transfers.value].slice(0, 20)

      return
    }

    transfers.value = transfers.value.map((currentTransfer, index) =>
      index === existingIndex ? { ...currentTransfer, ...transfer } : currentTransfer
    )
  }

  function createOutgoingTransfer(selectedFiles: File[]): DraftTransferResult {
    const validation = validateTransferFiles(selectedFiles)

    if (!validation.files) {
      notificationStore.pushNotification({
        title: 'Files not shared',
        detail: validation.error ?? 'File validation failed.',
        tone: 'warning',
      })

      return {
        transfer: null,
        files: null,
        error: validation.error,
      }
    }

    const localPeer =
      sessionStore.peer ??
      sessionStore.ensureSession(room.value?.localMode === 'host' ? 'host' : 'member')
    const transfer: FileTransfer = {
      id: createId('transfer'),
      peerId:
        room.value?.localMode === 'join'
          ? room.value.hostPeerId
          : localPeer.id,
      peerLabel: 'Room members',
      direction: 'outgoing',
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      totalBytes: validation.totalBytes,
      files: createTransferFiles(validation.files),
    }

    upsertTransfer(transfer)

    return {
      transfer,
      files: validation.files,
      error: null,
    }
  }

  function createIncomingTransfer(
    transferId: string,
    senderId: string,
    senderLabel: string,
    files: TransferFile[],
    totalBytes: number
  ) {
    upsertTransfer({
      id: transferId,
      peerId: senderId,
      peerLabel: senderLabel,
      direction: 'incoming',
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      totalBytes,
      files,
    })
  }

  function updateTransferProgress(
    transferId: string,
    progress: number,
    status: FileTransfer['status'] = 'transferring'
  ) {
    const transfer = transfers.value.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    if (!transfer) {
      return
    }

    upsertTransfer({
      ...transfer,
      status,
      progress: Math.max(0, Math.min(100, progress)),
      error: undefined,
    })
  }

  function completeTransfer(
    transferId: string,
    files?: TransferFile[]
  ) {
    const transfer = transfers.value.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    if (!transfer) {
      return
    }

    upsertTransfer({
      ...transfer,
      files: files ?? transfer.files,
      status: 'completed',
      progress: 100,
      error: undefined,
    })
  }

  function failTransfer(transferId: string, error: string) {
    const transfer = transfers.value.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    if (!transfer) {
      return
    }

    upsertTransfer({
      ...transfer,
      status: 'failed',
      error,
    })
  }

  function failTransfersForPeer(peerId: string, error: string) {
    transfers.value = transfers.value.map((transfer) => {
      if (transfer.peerId !== peerId || transfer.status === 'completed') {
        return transfer
      }

      return {
        ...transfer,
        status: 'failed',
        error,
      }
    })
  }

  function resetTransfers() {
    transfers.value = []
  }

  function upsertMember(member: PeerIdentity) {
    const existingIndex = members.value.findIndex(
      (currentMember) => currentMember.id === member.id
    )

    if (existingIndex === -1) {
      members.value = [...members.value, member]
      persistRoomState()

      return
    }

    members.value = members.value.map((currentMember, index) =>
      index === existingIndex ? { ...currentMember, ...member } : currentMember
    )
    persistRoomState()
  }

  function replaceMembers(nextMembers: PeerIdentity[]) {
    members.value = nextMembers
    persistRoomState()
  }

  function removeMember(peerId: string) {
    members.value = members.value.filter((member) => member.id !== peerId)
    persistRoomState()
  }

  function updateMemberConnectionState(
    peerId: string,
    connectionState: PeerIdentity['connectionState']
  ) {
    const member = members.value.find((currentMember) => currentMember.id === peerId)

    if (!member) {
      return
    }

    upsertMember({
      ...member,
      connectionState,
    })
  }

  function syncLocalPeer() {
    if (!sessionStore.peer) {
      return
    }

    upsertMember(sessionStore.peer)
  }

  function createDraftMessage(): DraftMessageResult {
    const localPeer =
      sessionStore.peer ??
      sessionStore.ensureSession(room.value?.localMode === 'host' ? 'host' : 'member')

    if (!room.value) {
      return {
        message: null,
        error: 'Create or join a room before sending a message.',
      }
    }

    const validation = validateChatBody(draftMessage.value)

    if (!validation.body) {
      notificationStore.pushNotification({
        title: 'Message not sent',
        detail: validation.error ?? 'Message validation failed.',
        tone: 'warning',
      })

      return {
        message: null,
        error: validation.error,
      }
    }

    const message = buildTextMessage(
      localPeer,
      validation.body,
      new Date().toISOString(),
      'pending'
    )

    messages.value = [...messages.value, message]
    draftMessage.value = ''
    persistRoomState()

    return {
      message,
      error: null,
    }
  }

  function upsertMessage(message: ChatMessage) {
    const existingIndex = messages.value.findIndex(
      (currentMessage) => currentMessage.id === message.id
    )

    if (existingIndex === -1) {
      messages.value = [...messages.value, message]
      persistRoomState()

      return
    }

    messages.value = messages.value.map((currentMessage, index) =>
      index === existingIndex ? { ...currentMessage, ...message } : currentMessage
    )
    persistRoomState()
  }

  function markMessageStatus(
    messageId: string,
    status: ChatMessage['status'],
    fallbackMessage?: ChatMessage
  ) {
    const existingMessage = messages.value.find((message) => message.id === messageId)

    if (!existingMessage && fallbackMessage) {
      upsertMessage({
        ...fallbackMessage,
        status,
      })

      return
    }

    if (!existingMessage) {
      return
    }

    upsertMessage({
      ...existingMessage,
      status,
    })
  }

  function failPendingMessagesForPeer(peerId: string) {
    messages.value = messages.value.map((message) => {
      if (message.senderId !== peerId || message.status !== 'pending') {
        return message
      }

      return {
        ...message,
        status: 'failed',
      }
    })
    persistRoomState()
  }

  function updateDraftMessage(value: string) {
    draftMessage.value = value
  }

  function clearRoom() {
    room.value = null
    members.value = []
    messages.value = []
    presenceEvents.value = []
    transfers.value = []
    draftMessage.value = ''
  }

  return {
    room,
    members,
    messages,
    presenceEvents,
    transfers,
    draftMessage,
    memberCount,
    connectedMemberCount,
    hasActiveRoom,
    hostPeer,
    isHostView,
    isJoinView,
    bootstrapHostedRoom,
    prepareJoinRoom,
    ensureHostedRoom,
    refreshHostPeerIdentity,
    updateRoomStatus,
    appendSystemMessage,
    replaceMessages,
    recordPresenceEvent,
    replacePresenceEvents,
    createOutgoingTransfer,
    createIncomingTransfer,
    updateTransferProgress,
    completeTransfer,
    failTransfer,
    failTransfersForPeer,
    resetTransfers,
    upsertMember,
    replaceMembers,
    removeMember,
    updateMemberConnectionState,
    syncLocalPeer,
    createDraftMessage,
    upsertMessage,
    markMessageStatus,
    failPendingMessagesForPeer,
    updateDraftMessage,
    clearRoom,
  }
})

function loadStoredRoom() {
  return null
}

function loadStoredMembers() {
  return []
}

function loadStoredMessages() {
  return []
}

function loadStoredPresenceEvents() {
  return []
}
