<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import NotificationPanel from '@/components/notifications/NotificationPanel.vue'
import MembersPanel from '@/components/room/MembersPanel.vue'
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
const isLeftDrawerOpen = ref(false)
const isRightDrawerOpen = ref(false)
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
const localPeerLabel = computed(
  () => sessionStore.peer?.label ?? 'Unassigned'
)
const roomSubtitle = computed(() => {
  if (!room.value) {
    return ''
  }

  return room.value.localMode === 'host'
    ? `Host ${sessionStore.peer?.label ?? 'unassigned'} is listening on ${room.value.hostPeerId}.`
    : `Join flow prepared for host ${room.value.hostPeerId}.`
})
const roomStatusPills = computed(() => [
  `Status ${room.value?.status ?? 'idle'}`,
  `Active members ${connectedMemberCount.value}`,
  `Signaling ${signalingState.value}`,
  `Presence events ${presenceEvents.value.length}`,
])

watch(
  [roomIdParam, joinLinkIssue, joinHostPeerId],
  ([roomId, linkIssue, hostPeerId]) => {
    if (!roomId || linkIssue) {
      return
    }

    if (hostPeerId) {
      roomStore.prepareJoinRoom(roomId, hostPeerId)
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

watch(
  () => route.fullPath,
  () => {
    isLeftDrawerOpen.value = false
    isRightDrawerOpen.value = false
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

function openLeftDrawer() {
  isRightDrawerOpen.value = false
  isLeftDrawerOpen.value = true
}

function closeLeftDrawer() {
  isLeftDrawerOpen.value = false
}

function openRightDrawer() {
  isLeftDrawerOpen.value = false
  isRightDrawerOpen.value = true
}

function closeRightDrawer() {
  isRightDrawerOpen.value = false
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
    <div class="room-view__toolbar">
      <button
        type="button"
        class="room-view__icon-button room-view__icon-button--left"
        aria-label="Open room drawer"
        @click="openLeftDrawer"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-width="2"
          />
        </svg>
      </button>

      <div class="room-view__toolbar-copy">
        <p class="room-view__identity">Hi {{ localPeerLabel }} !</p>
      </div>

      <button
        type="button"
        class="room-view__icon-button room-view__icon-button--right"
        aria-label="Open notifications drawer"
        @click="openRightDrawer"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 4a4 4 0 0 0-4 4v2.3c0 .7-.2 1.38-.58 1.97L6 14.5h12l-1.42-2.23A3.7 3.7 0 0 1 16 10.3V8a4 4 0 0 0-4-4Z"
            fill="none"
            stroke="currentColor"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
          <path
            d="M10 18a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-width="1.8"
          />
        </svg>
      </button>
    </div>

    <ChatPanel
      :messages="messages"
      :transfers="transfers"
      :draft="draftMessage"
      :local-peer-id="sessionStore.peer?.id"
      :disabled="isChatDisabled"
      :file-disabled="isFileShareDisabled"
      @update:draft="roomStore.updateDraftMessage"
      @send="sendDraftMessage"
      @send-files="sendFiles"
    />

    <div
      v-if="isLeftDrawerOpen"
      class="room-view__drawer-backdrop"
      @click="closeLeftDrawer"
    />
    <aside
      :class="[
        'room-view__drawer',
        'room-view__drawer--left',
        { 'room-view__drawer--open': isLeftDrawerOpen },
      ]"
    >
      <div class="room-view__drawer-header">
        <div>
          <p class="eyebrow">Room</p>
          <h2>{{ room.name }}</h2>
          <p class="room-view__drawer-subtitle">
            {{ roomSubtitle }}
          </p>
          <p v-if="errorMessage" class="room-view__drawer-error">
            {{ errorMessage }}
          </p>
        </div>
        <button
          type="button"
          class="room-view__drawer-close"
          aria-label="Close room drawer"
          @click="closeLeftDrawer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m6 6 12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="2"
            />
          </svg>
        </button>
      </div>

      <div class="room-view__drawer-status">
        <span
          v-for="status in roomStatusPills"
          :key="status"
          class="room-view__status-pill"
        >
          {{ status }}
        </span>
      </div>

      <div class="room-view__drawer-actions">
        <button type="button" class="secondary-button" @click="goBack">
          Back to lobby
        </button>
      </div>

      <section v-if="showJoinBanner" class="panel room-view__join-banner">
        <p class="eyebrow">Join flow</p>
        <h2>{{ joinStateTitle }}</h2>
        <p>{{ joinStateDetail }}</p>
        <div class="room-view__join-actions">
          <button v-if="canRetryJoin" type="button" @click="retryConnection">
            Retry connection
          </button>
          <span v-if="retryCount > 0" class="room-view__join-meta">
            Retry attempts {{ retryCount }}
          </span>
        </div>
      </section>

      <SharePanel :room="room" />
      <MembersPanel
        :members="members"
        :host-peer-id="room.hostPeerId"
        :active-member-count="connectedMemberCount"
      />
    </aside>

    <div
      v-if="isRightDrawerOpen"
      class="room-view__drawer-backdrop"
      @click="closeRightDrawer"
    />
    <aside
      :class="[
        'room-view__drawer',
        'room-view__drawer--right',
        { 'room-view__drawer--open': isRightDrawerOpen },
      ]"
    >
      <button
        type="button"
        class="room-view__drawer-close room-view__drawer-close--floating"
        aria-label="Close notifications drawer"
        @click="closeRightDrawer"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="m6 6 12 12M18 6 6 18"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-width="2"
          />
        </svg>
      </button>
      <NotificationPanel :notifications="notifications" />
    </aside>
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
        Return to the lobby to create a new hosted room.
      </p>
      <button type="button" @click="goBack">Back to lobby</button>
    </section>
  </main>
</template>

<style scoped>
.room-view {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 1rem;
  height: 100vh;
  height: 100dvh;
  min-height: 100vh;
  padding-top: 1.25rem;
  padding-bottom: 1.25rem;
  overflow: hidden;
}

.room-view__toolbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
}

.room-view__toolbar-copy {
  text-align: center;
}

.room-view__identity {
  margin: 0;
  color: var(--text-main);
  font-size: clamp(1rem, 2.4vw, 1.35rem);
  font-weight: 600;
}

.room-view__icon-button {
  display: inline-grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  padding: 0;
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-main);
  box-shadow: none;
}

.room-view__icon-button svg,
.room-view__drawer-close svg {
  width: 1.6rem;
  height: 1.6rem;
}

.room-view :deep(.chat-panel) {
  height: 100%;
  min-height: 0;
}

.room-view__drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(8, 5, 4, 0.6);
  backdrop-filter: blur(6px);
}

.room-view__drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  z-index: 21;
  width: min(26rem, calc(100vw - 1.5rem));
  padding: 1rem;
  overflow-y: auto;
  background:
    linear-gradient(180deg, rgba(28, 20, 18, 0.98), rgba(18, 13, 11, 0.96)),
    var(--surface-strong);
  box-shadow: var(--shadow);
  transition: transform 220ms ease;
}

.room-view__drawer--left {
  left: 0;
  transform: translateX(-100%);
  border-right: 1px solid var(--border);
}

.room-view__drawer--right {
  right: 0;
  transform: translateX(100%);
  border-left: 1px solid var(--border);
}

.room-view__drawer--open {
  transform: translateX(0);
}

.room-view__drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.room-view__drawer-header h2 {
  margin: 0.3rem 0 0;
  font-size: 1.5rem;
}

.room-view__drawer-close {
  display: inline-grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-main);
  box-shadow: none;
}

.room-view__drawer-close--floating {
  position: sticky;
  top: 0;
  z-index: 1;
  margin-left: auto;
}

.room-view__drawer-subtitle,
.room-view__drawer-error {
  margin: 0.65rem 0 0;
  color: var(--text-muted);
}

.room-view__drawer-error {
  color: var(--accent);
}

.room-view__drawer-status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 1rem;
}

.room-view__status-pill {
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 0.55rem 0.85rem;
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.88rem;
}

.room-view__drawer-actions {
  display: flex;
  margin-top: 1rem;
}

.room-view__drawer :deep(.panel) {
  margin-top: 1rem;
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
  .room-view :deep(.chat-panel) {
    height: 100%;
  }
}

@media (max-width: 860px) {
  .room-view {
    padding-top: 1rem;
    padding-bottom: 1.5rem;
  }

  .room-view__toolbar {
    gap: 0.65rem;
  }

  .room-view__identity {
    font-size: 1.2rem;
  }

  .room-view__join-actions {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 640px) {
  .room-view__toolbar {
    grid-template-columns: auto 1fr auto;
  }

  .room-view__icon-button {
    width: 3rem;
    height: 3rem;
  }

  .room-view__drawer {
    width: calc(100vw - 0.5rem);
    padding: 0.75rem;
  }

  .room-view__join-banner,
  .room-view__empty-state {
    padding: 1rem;
  }
}
</style>
