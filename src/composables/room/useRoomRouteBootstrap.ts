import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTransferTransportLabel } from '@/lib/transferTransport'
import type { PreparedUpload } from '@/lib/uploadSelection'
import {
  getHostPeerIdFromQuery,
  getTransferTransportFromQuery,
  isGeneratedId,
} from '@/lib/roomLink'
import { useNotificationStore } from '@/stores/notifications'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSignalingStore } from '@/stores/signaling'

export function useRoomRouteBootstrap() {
  const route = useRoute()
  const router = useRouter()
  const sessionStore = useSessionStore()
  const roomStore = useRoomStore()
  const notificationStore = useNotificationStore()
  const signalingStore = useSignalingStore()

  const {
    room,
    members,
    messages,
    transfers,
    draftMessage,
    isJoinView,
    connectedMemberCount,
    activeTransferTransport,
    preferBackendRelay,
  } = storeToRefs(roomStore)
  const { items: notifications } = storeToRefs(notificationStore)
  const {
    state: signalingState,
    errorMessage,
    retryCount,
    isHistoryLoading,
  } = storeToRefs(signalingStore)

  const roomIdParam = computed(() =>
    typeof route.params.roomId === 'string' ? route.params.roomId : null
  )
  const hasJoinQuery = computed(() =>
    Object.prototype.hasOwnProperty.call(route.query, 'host')
  )
  const joinHostPeerId = computed(() =>
    getHostPeerIdFromQuery(route.query.host)
  )
  const inviteTransport = computed(() =>
    getTransferTransportFromQuery(route.query.transport)
  )
  const joinLinkIssue = computed(() => {
    if (!hasJoinQuery.value) {
      return null
    }

    if (!roomIdParam.value || !isGeneratedId(roomIdParam.value, 'room')) {
      return 'This room link is invalid or incomplete.'
    }

    if (!joinHostPeerId.value || !isGeneratedId(joinHostPeerId.value, 'peer')) {
      return 'This invite is missing a valid host peer ID.'
    }

    return null
  })
  const isChatDisabled = computed(
    () => isJoinView.value && signalingState.value !== 'connected'
  )
  const isFileShareDisabled = computed(
    () =>
      isChatDisabled.value ||
      (isJoinView.value && connectedMemberCount.value < 2)
  )
  const joinStateTitle = computed(() => {
    switch (signalingState.value) {
      case 'starting':
        return 'Preparing the room session.'
      case 'connecting':
        return 'Connecting to the host.'
      case 'retrying':
        return 'Trying the host again.'
      case 'connected':
        return ''
      case 'disconnected':
        return 'This device is disconnected from the host.'
      case 'error':
        return 'The room connection hit an error.'
      default:
        return 'Waiting to start the join flow.'
    }
  })
  const joinStateDetail = computed(() => {
    if (joinLinkIssue.value) {
      return joinLinkIssue.value
    }

    if (errorMessage.value) {
      return errorMessage.value
    }

    switch (signalingState.value) {
      case 'starting':
        return 'Preparing the local peer identity and signaling client.'
      case 'connecting':
        return 'PeerJS is contacting the host and opening the room channel.'
      case 'retrying':
        return 'The host did not answer yet. Automatic reconnect is still in progress.'
      case 'connected':
        return ''
      case 'disconnected':
        return 'The host channel is down. Retry manually or verify that the host is still online.'
      default:
        return 'The room link has been decoded correctly and is ready to connect.'
    }
  })
  const canRetryJoin = computed(
    () =>
      !joinLinkIssue.value &&
      !(
        room.value?.localMode === 'join' && room.value.status === 'disconnected'
      ) &&
      (signalingState.value === 'connecting' ||
        signalingState.value === 'retrying' ||
        signalingState.value === 'disconnected' ||
        signalingState.value === 'error')
  )
  const showJoinBanner = computed(
    () => hasJoinQuery.value && signalingState.value !== 'connected'
  )
  const showHostDisconnectedModal = computed(
    () =>
      room.value?.localMode === 'join' && room.value.status === 'disconnected'
  )
  const hostDisconnectedDetail = computed(
    () => errorMessage.value ?? 'The host is no longer connected to this room.'
  )
  const currentTransportLabel = computed(() =>
    preferBackendRelay.value
      ? 'Backend relay'
      : getTransferTransportLabel(activeTransferTransport.value)
  )
  const currentTransportDetail = computed(() => {
    if (preferBackendRelay.value) {
      return 'This room is routing chat and file transfers through the backend relay.'
    }

    if (activeTransferTransport.value === 'backend-relay') {
      return 'A current transfer has fallen back to the backend relay while the room stays in WebRTC-first mode.'
    }

    return 'This room is currently using WebRTC for direct peer-to-peer traffic.'
  })
  const localPeerId = computed(() => sessionStore.peer?.id ?? null)
  const localPeerLabel = computed(
    () => sessionStore.peer?.label ?? 'Unassigned'
  )

  watch(
    [roomIdParam, joinLinkIssue, joinHostPeerId, inviteTransport],
    ([roomId, linkIssue, hostPeerId, nextInviteTransport]) => {
      if (!roomId || linkIssue) {
        return
      }

      if (hostPeerId) {
        roomStore.prepareJoinRoom(
          roomId,
          hostPeerId,
          nextInviteTransport === null
            ? preferBackendRelay.value
            : nextInviteTransport === 'backend-relay'
        )
        signalingStore.ensureJoiner(roomId, hostPeerId)

        return
      }

      sessionStore.ensureSession('host')
      roomStore.ensureHostedRoom(roomId)
      signalingStore.ensureHost(roomId)
    },
    {
      immediate: true,
    }
  )

  function goBack() {
    signalingStore.destroyPeer()
    roomStore.clearRoom()
    sessionStore.clearSession()
    notificationStore.clearAll()
    router.push({
      name: 'home',
    })
  }

  function retryConnection() {
    signalingStore.retryJoinConnection()
  }

  function sendDraftMessage() {
    signalingStore.sendDraftMessage()
  }

  function updateDraftMessage(value: string) {
    roomStore.updateDraftMessage(value)
  }

  function cancelTransfer(transferId: string) {
    signalingStore.cancelTransfer(transferId)
  }

  function downloadTransfer(transferId: string) {
    signalingStore.requestTransferReplay(transferId)
  }

  async function sendFiles(upload: PreparedUpload) {
    try {
      await signalingStore.sendFiles(upload.files)
    } finally {
      await upload.cleanup?.()
    }
  }

  return {
    room,
    members,
    messages,
    transfers,
    draftMessage,
    notifications,
    errorMessage,
    retryCount,
    isHistoryLoading,
    joinLinkIssue,
    connectedMemberCount,
    isChatDisabled,
    isFileShareDisabled,
    joinStateTitle,
    joinStateDetail,
    canRetryJoin,
    showJoinBanner,
    showHostDisconnectedModal,
    hostDisconnectedDetail,
    currentTransportLabel,
    currentTransportDetail,
    localPeerId,
    localPeerLabel,
    goBack,
    retryConnection,
    updateDraftMessage,
    sendDraftMessage,
    cancelTransfer,
    downloadTransfer,
    sendFiles,
  }
}
