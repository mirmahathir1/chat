<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, ref, watchEffect } from 'vue'
import type { RoomSummary } from '@/types/chat'

const props = withDefaults(
  defineProps<{
    room: RoomSummary
    showHeader?: boolean
  }>(),
  {
    showHeader: true,
  }
)

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const qrDataUrl = ref('')
const isHostView = computed(() => props.room.localMode === 'host')
const manualJoinCode = computed(() =>
  props.room.id === props.room.hostPeerId ? props.room.id : null
)

watchEffect(async () => {
  if (!isHostView.value) {
    qrDataUrl.value = ''

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
</script>

<template>
  <section
    :class="[
      'panel',
      'share-panel',
      { 'share-panel--headerless': !showHeader },
    ]"
  >
    <Transition name="ui-fade" appear>
      <div v-if="showHeader" class="section-heading">
        <span class="phase-chip">Invite link</span>
      </div>
    </Transition>

    <Transition name="ui-fade-scale" appear>
      <div v-if="isHostView" class="share-panel__qr">
        <img :src="qrDataUrl" alt="QR code for the room invite link" />
      </div>
    </Transition>

    <Transition name="ui-fade" appear>
      <div v-if="manualJoinCode" class="share-panel__room-code">
        <span>Room code</span>
        <code>{{ manualJoinCode }}</code>
        <p>Type this code on another device to connect.</p>
      </div>
    </Transition>

    <div class="share-panel__actions">
      <button
        type="button"
        data-testid="copy-join-link"
        :data-share-url="room.shareUrl"
        @click="copyShareLink"
      >
        {{ copyState === 'copied' ? 'Link copied' : 'Copy join link' }}
      </button>
    </div>

    <Transition name="ui-fade" appear>
      <p v-if="copyState === 'failed'" class="share-panel__feedback">
        Clipboard access was blocked in this browser. Copy the URL manually for
        now.
      </p>
    </Transition>
  </section>
</template>

<style scoped>
.share-panel {
  padding: 1.25rem;
}

.share-panel--headerless .share-panel__qr {
  margin-top: 0;
}

.share-panel--headerless .share-panel__room-code {
  justify-items: center;
  text-align: center;
}

.share-panel--headerless .share-panel__room-code code {
  font-size: clamp(1.8rem, 7vw, 2.75rem);
  letter-spacing: 0.06em;
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

.share-panel__room-code {
  display: grid;
  gap: 0.35rem;
  margin-top: 1rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.03);
}

.share-panel__room-code span {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.share-panel__room-code code {
  font-size: 1.15rem;
  font-weight: 700;
}

.share-panel__room-code p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

code {
  overflow-wrap: anywhere;
  color: var(--text-main);
  font-family:
    ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Monaco, Consolas,
    'Liberation Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.4;
}

textarea {
  resize: none;
}

.share-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}

.share-panel__feedback {
  margin: 0.75rem 0 0;
  color: var(--accent-soft);
}
</style>
