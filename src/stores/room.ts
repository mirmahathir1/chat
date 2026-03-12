import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { hasConfiguredBackendRelay } from '@/lib/backendRelayClient'
import { createTransferFiles, validateTransferFiles } from '@/lib/fileTransfer'
import { createHumanReadableId, formatHumanReadableId } from '@/lib/humanId'
import { createId } from '@/lib/id'
import { buildShareUrl } from '@/lib/roomLink'
import { normalizeTransfer } from '@/lib/transferTransport'
import type {
  ChatMessage,
  FileTransfer,
  PeerIdentity,
  PresenceEvent,
  RoomNotification,
  RoomSummary,
  TransferFile,
  TransferTransport,
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
      detail: `${host.label} is the current host for room ${room.id}.`,
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

function buildRoomName(prefix: 'Hosted room' | 'Join room', roomId: string) {
  return `${prefix} ${formatHumanReadableId(roomId)}`
}

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomSummary | null>(loadStoredRoom())
  const members = ref<PeerIdentity[]>(loadStoredMembers())
  const messages = ref<ChatMessage[]>(loadStoredMessages())
  const presenceEvents = ref<PresenceEvent[]>(loadStoredPresenceEvents())
  const transfers = ref<FileTransfer[]>([])
  const draftMessage = ref('')
  const preferBackendRelay = ref(false)

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
  const activeTransferTransport = computed<TransferTransport>(() => {
    const activeTransfer = transfers.value.find(
      (transfer) =>
        transfer.status === 'queued' || transfer.status === 'transferring'
    )

    return activeTransfer?.transport ?? 'webrtc'
  })
  const relayBackendConfigured = computed(() => hasConfiguredBackendRelay())

  function persistRoomState() {
    return
  }

  function buildRoomShareUrl(roomId: string, hostPeerId: string) {
    return buildShareUrl(roomId, hostPeerId, preferBackendRelay.value)
  }

  function syncRoomShareUrl() {
    if (!room.value) {
      return
    }

    room.value = {
      ...room.value,
      shareUrl: buildRoomShareUrl(room.value.id, room.value.hostPeerId),
    }
  }

  function bootstrapHostedRoom(roomId = createHumanReadableId()) {
    const host = sessionStore.rotatePeerIdentity('host', roomId)
    const now = new Date().toISOString()
    const hostedRoom: RoomSummary = {
      id: roomId,
      name: buildRoomName('Hosted room', roomId),
      hostPeerId: host.id,
      shareUrl: buildRoomShareUrl(roomId, host.id),
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

  function prepareJoinRoom(
    roomId: string,
    hostPeerId: string,
    nextPreferBackendRelay = preferBackendRelay.value
  ) {
    const localPeer = sessionStore.rotatePeerIdentity('member')
    const now = new Date().toISOString()

    preferBackendRelay.value = nextPreferBackendRelay
    sessionStore.setRole('member')
    sessionStore.setConnectionState('idle')

    room.value = {
      id: roomId,
      name: buildRoomName('Join room', roomId),
      hostPeerId,
      shareUrl: buildRoomShareUrl(roomId, hostPeerId),
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
      shareUrl: buildRoomShareUrl(room.value.id, nextHostPeerId),
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
    const normalizedTransfer = normalizeTransfer(transfer)
    const existingIndex = transfers.value.findIndex(
      (currentTransfer) => currentTransfer.id === normalizedTransfer.id
    )

    if (existingIndex === -1) {
      transfers.value = [normalizedTransfer, ...transfers.value].slice(0, 20)

      return
    }

    transfers.value = transfers.value.map((currentTransfer, index) =>
      index === existingIndex
        ? normalizeTransfer({ ...currentTransfer, ...normalizedTransfer })
        : currentTransfer
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
      sessionStore.ensureSession(
        room.value?.localMode === 'host' ? 'host' : 'member'
      )
    const transfer: FileTransfer = {
      id: createId('transfer'),
      senderId: localPeer.id,
      senderLabel: localPeer.label,
      peerId:
        room.value?.localMode === 'join' ? room.value.hostPeerId : localPeer.id,
      peerLabel: 'Room members',
      direction: 'outgoing',
      transport: preferBackendRelay.value ? 'backend-relay' : 'webrtc',
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      totalBytes: validation.totalBytes,
      bytesPerSecond: undefined,
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
    totalBytes: number,
    createdAt?: string
  ) {
    const existingTransfer = transfers.value.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    upsertTransfer({
      id: transferId,
      senderId,
      senderLabel,
      peerId: senderId,
      peerLabel: senderLabel,
      direction: 'incoming',
      transport: existingTransfer?.transport ?? 'webrtc',
      status: 'queued',
      progress: 0,
      createdAt:
        existingTransfer?.createdAt ?? createdAt ?? new Date().toISOString(),
      totalBytes,
      bytesPerSecond: undefined,
      files,
    })
  }

  function updateTransferProgress(
    transferId: string,
    progress: number,
    status: FileTransfer['status'] = 'transferring',
    bytesPerSecond?: number
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
      bytesPerSecond:
        status === 'transferring'
          ? bytesPerSecond ?? transfer.bytesPerSecond
          : undefined,
      error: undefined,
    })
  }

  function completeTransfer(transferId: string, files?: TransferFile[]) {
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
      bytesPerSecond: undefined,
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
      bytesPerSecond: undefined,
      error,
    })
  }

  function cancelTransfer(transferId: string) {
    const transfer = transfers.value.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    if (!transfer) {
      return
    }

    upsertTransfer({
      ...transfer,
      status: 'cancelled',
      progress: 0,
      bytesPerSecond: undefined,
      error: undefined,
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
        bytesPerSecond: undefined,
        error,
      }
    })
  }

  function resetTransfers() {
    transfers.value = []
  }

  function replaceTransfers(nextTransfers: FileTransfer[]) {
    transfers.value = nextTransfers.map(normalizeTransfer)
    persistRoomState()
  }

  function setPreferBackendRelay(enabled: boolean) {
    preferBackendRelay.value = enabled
    syncRoomShareUrl()
    persistRoomState()
  }

  watch(preferBackendRelay, () => {
    syncRoomShareUrl()
    persistRoomState()
  })

  function setTransferTransport(
    transferId: string,
    transport: TransferTransport
  ) {
    const transfer = transfers.value.find(
      (currentTransfer) => currentTransfer.id === transferId
    )

    if (!transfer) {
      return
    }

    upsertTransfer({
      ...transfer,
      transport,
    })
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
    const member = members.value.find(
      (currentMember) => currentMember.id === peerId
    )

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
      sessionStore.ensureSession(
        room.value?.localMode === 'host' ? 'host' : 'member'
      )

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
      index === existingIndex
        ? { ...currentMessage, ...message }
        : currentMessage
    )
    persistRoomState()
  }

  function markMessageStatus(
    messageId: string,
    status: ChatMessage['status'],
    fallbackMessage?: ChatMessage
  ) {
    const existingMessage = messages.value.find(
      (message) => message.id === messageId
    )

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
    preferBackendRelay,
    memberCount,
    connectedMemberCount,
    hasActiveRoom,
    hostPeer,
    isHostView,
    isJoinView,
    activeTransferTransport,
    relayBackendConfigured,
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
    cancelTransfer,
    failTransfersForPeer,
    resetTransfers,
    replaceTransfers,
    setPreferBackendRelay,
    setTransferTransport,
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
