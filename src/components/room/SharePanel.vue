<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, ref, watchEffect } from 'vue'
import type { RoomSummary } from '@/types/chat'

const props = defineProps<{
  room: RoomSummary
}>()

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const qrVisible = ref(props.room.localMode === 'host')
const qrDataUrl = ref('')

const shareFields = computed(() => [
  {
    label: 'Room ID',
    value: props.room.id,
  },
  {
    label: 'Host peer ID',
    value: props.room.hostPeerId,
  },
])

watchEffect(async () => {
  if (!qrVisible.value) {
    return
  }

  qrDataUrl.value = await QRCode.toDataURL(props.room.shareUrl, {
    width: 320,
    margin: 1,
    color: {
      dark: '#f7f1e7',
      light: '#0000',
    },
  })
})

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(props.room.shareUrl)
    copyState.value = 'copied'

    window.setTimeout(() => {
      copyState.value = 'idle'
    }, 1800)
  } catch {
    copyState.value = 'failed'
  }
}

function toggleQr() {
  qrVisible.value = !qrVisible.value
}
</script>

<template>
  <section class="panel share-panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Share</p>
        <h2>{{ room.localMode === 'host' ? 'Invite payload' : 'Loaded invite' }}</h2>
      </div>
      <span class="phase-chip">Phase 2 live</span>
    </div>

    <div v-if="qrVisible" class="share-panel__qr">
      <img :src="qrDataUrl" alt="QR code for the room invite link" />
    </div>
    <div v-else class="share-panel__qr-placeholder">
      <span>QR hidden until needed</span>
    </div>

    <div class="share-panel__fields">
      <div
        v-for="field in shareFields"
        :key="field.label"
        class="share-panel__field"
      >
        <span>{{ field.label }}</span>
        <code>{{ field.value }}</code>
      </div>
    </div>

    <label class="share-panel__url">
      <span>Share URL</span>
      <textarea readonly :value="room.shareUrl" rows="3" />
    </label>

    <div class="share-panel__actions">
      <button type="button" @click="copyShareLink">
        {{ copyState === 'copied' ? 'Link copied' : 'Copy join link' }}
      </button>
      <button type="button" class="secondary-button" @click="toggleQr">
        {{ qrVisible ? 'Hide QR' : 'Show QR' }}
      </button>
    </div>

    <p v-if="copyState === 'failed'" class="share-panel__feedback">
      Clipboard access was blocked in this browser. Copy the URL manually for
      now.
    </p>
  </section>
</template>

<style scoped>
.share-panel {
  padding: 1.25rem;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

h2 {
  margin: 0.25rem 0 0;
  font-size: 1.35rem;
}

.phase-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.4rem 0.7rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.share-panel__qr-placeholder {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  margin-top: 1.25rem;
  border: 1px dashed var(--border-strong);
  border-radius: 1.5rem;
  background:
    linear-gradient(
      135deg,
      rgba(255, 181, 117, 0.12),
      rgba(236, 105, 65, 0.08)
    ),
    rgba(255, 255, 255, 0.02);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.78rem;
}

.share-panel__qr {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  margin-top: 1.25rem;
  padding: 1rem;
  border: 1px solid var(--border-strong);
  border-radius: 1.5rem;
  background:
    radial-gradient(circle at top, rgba(255, 181, 117, 0.14), transparent 60%),
    rgba(255, 255, 255, 0.03);
}

.share-panel__qr img {
  width: 100%;
  height: auto;
  max-width: 16rem;
}

.share-panel__fields {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.share-panel__field {
  display: grid;
  gap: 0.35rem;
}

.share-panel__field span,
.share-panel__url span {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

code {
  overflow-wrap: anywhere;
  color: var(--text-main);
  font-size: 0.92rem;
}

.share-panel__url {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
}

textarea {
  resize: none;
}

.share-panel__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.share-panel__feedback {
  margin: 0.75rem 0 0;
  color: var(--accent-soft);
}
</style>
