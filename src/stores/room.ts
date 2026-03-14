import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  buildSystemMessage,
  buildTextMessage,
  failPendingMessagesForPeer as failPendingMessagesForPeerState,
  markMessageStatus as markRoomMessageStatus,
  maxChatMessageBytes,
  upsertMessage as upsertRoomMessage,
  validateChatBody,
} from '@/domain/messaging/messages'
import {
  buildHostedRoomNotifications,
  buildJoinRoomNotifications,
  buildRoomName,
} from '@/domain/room/metadata'
import {
  removeMember as removeRoomMember,
  updateMemberConnectionState as updateRoomMemberConnectionState,
  upsertMember as upsertRoomMember,
} from '@/domain/room/members'
import { appendPresenceEvent, buildPresenceEvent } from '@/domain/room/presence'
import {
  cancelTransfer as cancelTransferState,
  completeTransfer as completeTransferState,
  failTransfer as failTransferState,
  failTransfersForPeer as failTransfersForPeerState,
  normalizeTransfers,
  setTransferTransport as setTransferTransportState,
  updateTransferProgress as updateTransferProgressState,
  upsertTransfer as upsertTransferState,
} from '@/domain/transfers/state'
import { hasConfiguredBackendRelay } from '@/lib/backendRelayClient'
import { createTransferFiles, validateTransferFiles } from '@/lib/fileTransfer'
import { createHumanReadableId } from '@/lib/humanId'
import { createId } from '@/lib/id'
import { buildShareUrl } from '@/lib/roomLink'
import type {
  ChatMessage,
  FileTransfer,
  PeerIdentity,
  PresenceEvent,
  RoomSummary,
  TransferFile,
  TransferTransport,
} from '@/types/chat'
import { useNotificationStore } from '@/stores/notifications'
import { useSessionStore } from '@/stores/session'

interface DraftMessageResult {
  message: ChatMessage | null
  error: string | null
}

interface DraftTransferResult {
  transfer: FileTransfer | null
  files: File[] | null
  error: string | null
}

export { maxChatMessageBytes }

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomSummary | null>(null)
  const members = ref<PeerIdentity[]>([])
  const messages = ref<ChatMessage[]>([])
  const presenceEvents = ref<PresenceEvent[]>([])
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
      buildPresenceEvent('host-created', host.id, host.label, now),
    ]
    transfers.value = []
    messages.value = []
    transfers.value = []
    draftMessage.value = ''
    notificationStore.replaceAll(buildHostedRoomNotifications(host, hostedRoom))

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
      buildPresenceEvent('joined', localPeer.id, localPeer.label, now),
    ]
    messages.value = []
    transfers.value = []
    draftMessage.value = ''
    notificationStore.replaceAll(
      buildJoinRoomNotifications(roomId, hostPeerId, now)
    )
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
  }

  function updateRoomStatus(status: RoomSummary['status']) {
    if (!room.value) {
      return
    }

    room.value = {
      ...room.value,
      status,
    }
  }

  function appendSystemMessage(body: string) {
    if (!room.value) {
      return
    }

    messages.value = [
      ...messages.value,
      buildSystemMessage(body, new Date().toISOString()),
    ]
  }

  function recordPresenceEvent(
    type: PresenceEvent['type'],
    peerId: string,
    peerLabel: string,
    createdAt = new Date().toISOString()
  ) {
    const event = buildPresenceEvent(type, peerId, peerLabel, createdAt)

    presenceEvents.value = appendPresenceEvent(presenceEvents.value, event)

    return event
  }

  function replaceMessages(nextMessages: ChatMessage[]) {
    messages.value = nextMessages
  }

  function replacePresenceEvents(nextPresenceEvents: PresenceEvent[]) {
    presenceEvents.value = nextPresenceEvents
  }

  function upsertTransfer(transfer: FileTransfer) {
    transfers.value = upsertTransferState(transfers.value, transfer)
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
    transfers.value = updateTransferProgressState(
      transfers.value,
      transferId,
      progress,
      status,
      bytesPerSecond
    )
  }

  function completeTransfer(transferId: string, files?: TransferFile[]) {
    transfers.value = completeTransferState(transfers.value, transferId, files)
  }

  function failTransfer(transferId: string, error: string) {
    transfers.value = failTransferState(transfers.value, transferId, error)
  }

  function cancelTransfer(transferId: string) {
    transfers.value = cancelTransferState(transfers.value, transferId)
  }

  function failTransfersForPeer(peerId: string, error: string) {
    transfers.value = failTransfersForPeerState(transfers.value, peerId, error)
  }

  function resetTransfers() {
    transfers.value = []
  }

  function replaceTransfers(nextTransfers: FileTransfer[]) {
    transfers.value = normalizeTransfers(nextTransfers)
  }

  function setPreferBackendRelay(enabled: boolean) {
    preferBackendRelay.value = enabled
    syncRoomShareUrl()
  }

  watch(preferBackendRelay, () => {
    syncRoomShareUrl()
  })

  function setTransferTransport(
    transferId: string,
    transport: TransferTransport
  ) {
    transfers.value = setTransferTransportState(
      transfers.value,
      transferId,
      transport
    )
  }

  function upsertMember(member: PeerIdentity) {
    members.value = upsertRoomMember(members.value, member)
  }

  function replaceMembers(nextMembers: PeerIdentity[]) {
    members.value = nextMembers
  }

  function removeMember(peerId: string) {
    members.value = removeRoomMember(members.value, peerId)
  }

  function updateMemberConnectionState(
    peerId: string,
    connectionState: PeerIdentity['connectionState']
  ) {
    members.value = updateRoomMemberConnectionState(
      members.value,
      peerId,
      connectionState
    )
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

    messages.value = upsertRoomMessage(messages.value, message)
    draftMessage.value = ''

    return {
      message,
      error: null,
    }
  }

  function upsertMessage(message: ChatMessage) {
    messages.value = upsertRoomMessage(messages.value, message)
  }

  function markMessageStatus(
    messageId: string,
    status: ChatMessage['status'],
    fallbackMessage?: ChatMessage
  ) {
    messages.value = markRoomMessageStatus(
      messages.value,
      messageId,
      status,
      fallbackMessage
    )
  }

  function failPendingMessagesForPeer(peerId: string) {
    messages.value = failPendingMessagesForPeerState(messages.value, peerId)
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
