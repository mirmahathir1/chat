<script setup lang="ts">
import type { PeerIdentity, RoomSummary, SignalingState } from '@/types/chat'

defineProps<{
  room: RoomSummary
  localPeer: PeerIdentity | null
  presenceCount: number
  activeMemberCount: number
  signalingState: SignalingState
  signalingError: string | null
}>()

defineEmits<{
  back: []
}>()
</script>

<template>
  <header class="panel room-header">
    <div class="room-header__content">
      <p class="eyebrow">Hosted P2P Chat</p>
      <div class="room-header__title-row">
        <div>
          <h1>{{ room.name }}</h1>
          <p class="room-header__subtitle">
            {{
              room.localMode === 'host'
                ? `Host ${localPeer?.label ?? 'unassigned'} is listening for PeerJS joins on ${room.hostPeerId}.`
                : `Join flow prepared for host ${room.hostPeerId}.`
            }}
          </p>
          <p v-if="signalingError" class="room-header__error">
            {{ signalingError }}
          </p>
        </div>
        <div class="room-header__status">
          <span class="status-pill">Status {{ room.status }}</span>
          <span class="status-pill">Active members {{ activeMemberCount }}</span>
          <span class="status-pill">Signaling {{ signalingState }}</span>
          <span class="status-pill">Presence events {{ presenceCount }}</span>
        </div>
      </div>
    </div>
    <button class="secondary-button" type="button" @click="$emit('back')">
      Back to lobby
    </button>
  </header>
</template>

<style scoped>
.room-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 1.5rem;
}

.room-header__content {
  flex: 1;
  min-width: 0;
}

.room-header__title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 0.95;
}

.room-header__subtitle {
  max-width: 44rem;
  margin: 0.75rem 0 0;
  color: var(--text-muted);
}

.room-header__error {
  margin: 0.6rem 0 0;
  color: var(--accent);
}

.room-header__status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
}

.status-pill {
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 0.6rem 0.9rem;
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.92rem;
}

@media (max-width: 880px) {
  .room-header,
  .room-header__title-row {
    flex-direction: column;
  }

  .room-header__status {
    justify-content: flex-start;
  }
}
</style>
