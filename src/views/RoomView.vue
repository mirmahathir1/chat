<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import NotificationPanel from '@/components/notifications/NotificationPanel.vue'
import MembersPanel from '@/components/room/MembersPanel.vue'
import RoomHeader from '@/components/room/RoomHeader.vue'
import SharePanel from '@/components/room/SharePanel.vue'
import { getHostPeerIdFromQuery, isGeneratedId } from '@/lib/roomLink'
import { useNotificationStore } from '@/stores/notifications'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSignalingStore } from '@/stores/signaling'

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
  presenceEvents,
  isJoinView,
  connectedMemberCount,
} = storeToRefs(roomStore)
const { items: notifications } = storeToRefs(notificationStore)
const { state: signalingState, errorMessage, retryCount } =
  storeToRefs(signalingStore)
const roomIdParam = computed(() =>
  typeof route.params.roomId === 'string' ? route.params.roomId : null
)
const hasJoinQuery = computed(() =>
  Object.prototype.hasOwnProperty.call(route.query, 'host')
)
const joinHostPeerId = computed(() => getHostPeerIdFromQuery(route.query.host))
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
  () => isChatDisabled.value || connectedMemberCount.value < 2
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
      return 'This device is connected to the host.'
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
      return 'Chat and presence are now synchronized through the host-managed room.'
    case 'disconnected':
      return 'The host channel is down. Retry manually or verify that the host is still online.'
    default:
      return 'The room link has been decoded correctly and is ready to connect.'
  }
})
const canRetryJoin = computed(
  () =>
    !joinLinkIssue.value &&
    (signalingState.value === 'connecting' ||
      signalingState.value === 'retrying' ||
      signalingState.value === 'disconnected' ||
      signalingState.value === 'error')
)
const showJoinBanner = computed(() => hasJoinQuery.value)

watchEffect(() => {
  const roomId = roomIdParam.value

  if (!roomId || joinLinkIssue.value) {
    return
  }

  const hostPeerId = joinHostPeerId.value

  if (hostPeerId) {
    roomStore.prepareJoinRoom(roomId, hostPeerId)
    signalingStore.ensureJoiner(roomId, hostPeerId)

    return
  }

  sessionStore.ensureSession('host')
  roomStore.ensureHostedRoom(roomId)
  signalingStore.ensureHost(roomId)
})

function goBack() {
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

function sendFiles(files: File[]) {
  void signalingStore.sendFiles(files)
}
</script>

<template>
  <main v-if="room && !joinLinkIssue" class="page-shell room-view">
    <RoomHeader
      :room="room"
      :local-peer="sessionStore.peer"
      :presence-count="presenceEvents.length"
      :active-member-count="connectedMemberCount"
      :signaling-state="signalingState"
      :signaling-error="errorMessage"
      @back="goBack"
    />

    <section class="room-view__grid">
      <div class="room-view__rail">
        <SharePanel :room="room" />
        <MembersPanel
          :members="members"
          :host-peer-id="room.hostPeerId"
          :active-member-count="connectedMemberCount"
        />
      </div>

      <ChatPanel
        :messages="messages"
        :transfers="transfers"
        :draft="draftMessage"
        :disabled="isChatDisabled"
        :file-disabled="isFileShareDisabled"
        @update:draft="roomStore.updateDraftMessage"
        @send="sendDraftMessage"
        @send-files="sendFiles"
      />

      <NotificationPanel :notifications="notifications" />
    </section>

    <section v-if="showJoinBanner" class="panel room-view__join-banner">
      <p class="eyebrow">Join flow</p>
      <h2>{{ joinStateTitle }}</h2>
      <p>{{ joinStateDetail }}</p>
      <div class="room-view__join-actions">
        <button v-if="canRetryJoin" type="button" @click="retryConnection">
          Retry connection
        </button>
        <button
          v-if="joinLinkIssue"
          type="button"
          class="secondary-button"
          @click="goBack"
        >
          Back to lobby
        </button>
        <span v-if="retryCount > 0" class="room-view__join-meta">
          Retry attempts {{ retryCount }}
        </span>
      </div>
    </section>
  </main>

  <main
    v-else-if="joinLinkIssue"
    class="page-shell room-view room-view--empty"
  >
    <section class="panel room-view__empty-state">
      <p class="eyebrow">Invalid invite</p>
      <h1>That room link cannot be opened.</h1>
      <p>{{ joinLinkIssue }}</p>
      <button type="button" @click="goBack">Back to lobby</button>
    </section>
  </main>

  <main v-else class="page-shell room-view room-view--empty">
    <section class="panel room-view__empty-state">
      <p class="eyebrow">Room shell</p>
      <h1>No room is active yet.</h1>
      <p>
        Create a hosted room from the lobby to initialize the Phase 1 scaffold.
      </p>
      <button type="button" @click="goBack">Back to lobby</button>
    </section>
  </main>
</template>

<style scoped>
.room-view {
  display: grid;
  gap: 1.5rem;
  min-height: 100vh;
  padding-top: 2rem;
  padding-bottom: 2.5rem;
}

.room-view__grid {
  display: grid;
  grid-template-columns: minmax(17rem, 21rem) minmax(0, 1fr) minmax(
      17rem,
      20rem
    );
  gap: 1.25rem;
  min-height: 0;
}

.room-view__rail {
  display: grid;
  align-content: start;
  gap: 1.25rem;
}

.room-view--empty,
.room-view__empty-state {
  place-items: center;
}

.room-view__empty-state {
  max-width: 34rem;
  padding: 2rem;
  text-align: center;
}

.room-view__join-banner {
  padding: 1.25rem 1.5rem;
}

.room-view__join-banner h2 {
  margin: 0.25rem 0 0;
  font-size: 1.35rem;
}

.room-view__join-banner p:last-child {
  margin: 0.75rem 0 0;
  color: var(--text-muted);
  line-height: 1.6;
}

.room-view__join-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}

.room-view__join-meta {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.room-view__empty-state h1 {
  margin: 0.35rem 0 0;
  font-size: 2.4rem;
}

.room-view__empty-state p:last-of-type {
  color: var(--text-muted);
  line-height: 1.6;
}

@media (max-width: 1140px) {
  .room-view__grid {
    grid-template-columns: minmax(16rem, 20rem) minmax(0, 1fr);
  }

  .room-view__grid > :last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 860px) {
  .room-view {
    padding-top: 1rem;
    padding-bottom: 1.5rem;
  }

  .room-view__grid {
    grid-template-columns: 1fr;
  }

  .room-view__join-actions {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 640px) {
  .room-view__join-banner,
  .room-view__empty-state {
    padding: 1rem;
  }
}
</style>
