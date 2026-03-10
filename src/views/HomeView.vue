<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import SharePanel from '@/components/room/SharePanel.vue'
import { useRoomStore } from '@/stores/room'
import { useSignalingStore } from '@/stores/signaling'

const router = useRouter()
const roomStore = useRoomStore()
const signalingStore = useSignalingStore()
const { room, connectedMemberCount } = storeToRefs(roomStore)
const { isReady, state: signalingState, errorMessage } = storeToRefs(signalingStore)

if (!roomStore.room || roomStore.room.localMode !== 'host') {
  signalingStore.ensureHost(roomStore.bootstrapHostedRoom())
} else {
  signalingStore.ensureHost(roomStore.room.id)
}

watch(
  connectedMemberCount,
  (count) => {
    if (count < 2 || !room.value || room.value.localMode !== 'host') {
      return
    }

    router.push({
      name: 'room',
      params: {
        roomId: room.value.id,
      },
    })
  },
  {
    immediate: true,
  }
)

function retryHost() {
  if (!room.value) {
    return
  }

  signalingStore.destroyPeer()
  signalingStore.ensureHost(room.value.id)
}
</script>

<template>
  <main class="page-shell home-view">
    <section class="panel home-view__launchpad">
      <p class="eyebrow">Room host</p>
      <h2>Scan this code to join the live room.</h2>

      <p class="home-view__launch-copy">
        The host is already listening. Scan the QR, and both browsers move into
        the room automatically.
      </p>

      <div v-if="!isReady" class="home-view__status">
        <p v-if="errorMessage">{{ errorMessage }}</p>
        <p v-else-if="signalingState === 'disconnected'">
          The host channel disconnected before it finished starting.
        </p>
        <p v-else>
          Preparing the host channel...
        </p>
        <button
          v-if="signalingState === 'error' || signalingState === 'disconnected'"
          type="button"
          class="secondary-button"
          @click="retryHost"
        >
          Retry host
        </button>
      </div>

      <SharePanel v-if="room && isReady" :room="room" />
    </section>
  </main>
</template>

<style scoped>
.home-view {
  display: grid;
  align-items: center;
  min-height: 100vh;
}

.home-view__launchpad {
  width: min(100%, 32rem);
  margin: 0 auto;
  padding: 1.75rem;
}

h2 {
  margin: 0.35rem 0 0;
  font-size: 1.5rem;
}

.home-view__launch-copy {
  margin: 1rem 0 0;
  color: var(--text-muted);
  line-height: 1.7;
}

.home-view__status {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0 0;
  color: var(--text-muted);
}
</style>
