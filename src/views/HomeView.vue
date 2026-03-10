<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'

const router = useRouter()
const sessionStore = useSessionStore()
const roomStore = useRoomStore()

sessionStore.ensureSession('host')

const displayName = computed({
  get: () => sessionStore.peer?.label ?? '',
  set: (value: string) => sessionStore.updateDisplayName(value),
})

function createHostedRoom() {
  const roomId = roomStore.bootstrapHostedRoom()

  router.push({
    name: 'room',
    params: {
      roomId,
    },
  })
}

function continueRoom() {
  if (!roomStore.room) {
    return
  }

  router.push({
    name: 'room',
    params: {
      roomId: roomStore.room.id,
    },
  })
}
</script>

<template>
  <main class="page-shell home-view">
    <section class="home-view__hero">
      <div class="panel home-view__intro">
        <p class="eyebrow">Phase 8</p>
        <h1>Test coverage for the hosted room model.</h1>
        <p class="home-view__lede">
          This phase adds broader unit coverage, app-flow integration tests, and
          a manual checklist for validating host, join, chat, and file-sharing
          behavior on real devices and mixed networks.
        </p>
        <ul class="home-view__checklist">
          <li>Stable host room creation, invite URLs, and QR sharing</li>
          <li>PeerJS signaling between joiners and the host</li>
          <li>Automated coverage plus real-device validation scenarios</li>
        </ul>
      </div>

      <div class="panel home-view__launchpad">
        <p class="eyebrow">Room host</p>
        <h2>Prepare this browser as the initial room provider.</h2>

        <label class="home-view__field">
          <span>Display name</span>
          <input
            v-model="displayName"
            type="text"
            maxlength="32"
            placeholder="Choose a host name"
          />
        </label>

        <div class="home-view__session-meta">
          <div>
            <span>Peer ID</span>
            <code>{{ sessionStore.peer?.id }}</code>
          </div>
          <div>
            <span>Device label</span>
            <strong>{{ sessionStore.deviceLabel }}</strong>
          </div>
        </div>

        <div class="home-view__actions">
          <button type="button" @click="createHostedRoom">
            Create hosted room
          </button>
          <button
            v-if="roomStore.room"
            type="button"
            class="secondary-button"
            @click="continueRoom"
          >
            Reopen current room
          </button>
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

.home-view__hero {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 1.5rem;
}

.home-view__intro,
.home-view__launchpad {
  padding: 1.75rem;
}

h1 {
  margin: 0.35rem 0 0;
  max-width: 14ch;
  font-size: clamp(2.5rem, 6vw, 4.8rem);
  line-height: 0.92;
}

h2 {
  margin: 0.35rem 0 0;
  font-size: 1.5rem;
}

.home-view__lede {
  max-width: 54ch;
  margin: 1rem 0 0;
  color: var(--text-muted);
  font-size: 1.04rem;
  line-height: 1.7;
}

.home-view__checklist {
  display: grid;
  gap: 0.75rem;
  margin: 1.5rem 0 0;
  padding: 0;
  list-style: none;
}

.home-view__checklist li {
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.03);
}

.home-view__field {
  display: grid;
  gap: 0.45rem;
  margin-top: 1.4rem;
}

.home-view__field span,
.home-view__session-meta span {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.home-view__session-meta {
  display: grid;
  gap: 1rem;
  margin-top: 1.3rem;
}

.home-view__session-meta div {
  display: grid;
  gap: 0.3rem;
}

.home-view__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-top: 1.5rem;
}

code {
  overflow-wrap: anywhere;
}

@media (max-width: 960px) {
  .home-view__hero {
    grid-template-columns: 1fr;
  }

  h1 {
    max-width: none;
  }
}
</style>
