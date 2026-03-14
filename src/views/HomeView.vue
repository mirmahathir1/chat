<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppBrand from '@/components/AppBrand.vue'
import RelayPreferencePanel from '@/components/room/RelayPreferencePanel.vue'
import { createBackendRelayClient } from '@/lib/backendRelayClient'
import { normalizeHumanReadableId } from '@/lib/humanId'
import SharePanel from '@/components/room/SharePanel.vue'
import { useRoomStore } from '@/stores/room'
import { useSignalingStore } from '@/stores/signaling'

const router = useRouter()
const roomStore = useRoomStore()
const signalingStore = useSignalingStore()
const {
  room,
  connectedMemberCount,
  preferBackendRelay,
  relayBackendConfigured,
} = storeToRefs(roomStore)
const {
  isReady,
  state: signalingState,
  errorMessage,
} = storeToRefs(signalingStore)
const joinRoomCode = ref('')
const joinRoomError = ref('')
const showSharePanel = computed(() => Boolean(room.value && isReady.value))
const relayBackendClient = createBackendRelayClient()
const relayFileTransfersConfigured = ref(relayBackendConfigured.value)

if (relayBackendClient.isConfigured) {
  void relayBackendClient
    .getHealth()
    .then((health) => {
      relayFileTransfersConfigured.value = health.blobConfigured
    })
    .catch(() => {
      relayFileTransfersConfigured.value = false
    })
} else {
  relayFileTransfersConfigured.value = false
}

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

function joinTypedRoom() {
  const normalizedRoomCode = normalizeHumanReadableId(joinRoomCode.value)

  if (!normalizedRoomCode) {
    joinRoomError.value = 'Enter a room code like amber-wave-42.'

    return
  }

  joinRoomError.value = ''
  router.push({
    name: 'room',
    params: {
      roomId: normalizedRoomCode,
    },
    query: {
      host: normalizedRoomCode,
      transport: preferBackendRelay.value ? 'backend-relay' : 'webrtc',
    },
  })
}
</script>

<template>
  <main class="page-shell home-view">
    <section class="panel home-view__launchpad">
      <AppBrand class="home-view__brand" />
      <h2>Scan the QR code or type the room code to join the live room.</h2>

      <Transition name="ui-fade" appear>
        <div v-if="!isReady" class="home-view__status">
          <p v-if="errorMessage">{{ errorMessage }}</p>
          <p v-else-if="signalingState === 'disconnected'">
            The host channel disconnected before it finished starting.
          </p>
          <p v-else>Preparing the host channel...</p>
          <Transition name="ui-fade" appear>
            <button
              v-if="
                signalingState === 'error' || signalingState === 'disconnected'
              "
              type="button"
              class="secondary-button"
              @click="retryHost"
            >
              Retry host
            </button>
          </Transition>
        </div>
      </Transition>

      <div
        :class="[
          'home-view__content',
          { 'home-view__content--single': !showSharePanel },
        ]"
      >
        <Transition name="ui-fade-scale" appear>
          <SharePanel
            v-if="showSharePanel && room"
            :room="room"
            :show-header="false"
            :show-actions="false"
            :show-room-code="false"
          />
        </Transition>

        <div class="home-view__secondary">
          <Transition name="ui-fade" appear>
            <SharePanel
              v-if="showSharePanel && room"
              :room="room"
              :show-header="false"
              :show-qr="false"
            />
          </Transition>

          <form class="home-view__manual-join" @submit.prevent="joinTypedRoom">
            <p class="eyebrow">Manual join</p>
            <label class="home-view__manual-join-label" for="room-code">
              Type room code of other device
            </label>
            <div class="home-view__manual-join-row">
              <input
                id="room-code"
                v-model="joinRoomCode"
                type="text"
                data-testid="manual-room-code"
                placeholder="amber-wave-42"
                autocapitalize="off"
                autocomplete="off"
                spellcheck="false"
                @input="joinRoomError = ''"
              />
              <button
                type="submit"
                class="secondary-button"
                data-testid="join-room-button"
              >
                Join room
              </button>
            </div>
            <Transition name="ui-fade" appear>
              <p v-if="joinRoomError" class="home-view__manual-join-error">
                {{ joinRoomError }}
              </p>
            </Transition>
          </form>

          <RelayPreferencePanel
            v-model="preferBackendRelay"
            :configured="relayFileTransfersConfigured"
          />
        </div>
      </div>
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

.home-view__brand {
  margin-bottom: 1rem;
}

h2 {
  margin: 0.35rem 0 0;
  font-size: 1.5rem;
}

.home-view__status {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0 0;
  color: var(--text-muted);
}

.home-view__content {
  display: grid;
  gap: 1rem;
  margin-top: 1.25rem;
}

.home-view__secondary {
  display: grid;
  align-content: start;
  gap: 1rem;
}

.home-view__manual-join {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.03);
}

.home-view__manual-join-label {
  color: var(--text-main);
  font-size: 0.95rem;
}

.home-view__manual-join-row {
  display: flex;
  gap: 0.75rem;
}

.home-view__manual-join-row button {
  flex: 0 0 auto;
}

.home-view__manual-join-error {
  margin: 0;
  color: var(--accent-soft);
}

@media (max-width: 640px) {
  .home-view__manual-join-row {
    flex-direction: column;
  }
}

@media (min-width: 900px) {
  .home-view__launchpad {
    width: min(100%, 62rem);
  }

  .home-view__content {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }

  .home-view__content--single {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
