<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { formatBytes } from '@/lib/fileTransfer'
import { splitTextWithLinks } from '@/lib/linkify'
import { formatTimeLabel } from '@/lib/time'
import type { ChatMessage, FileTransfer } from '@/types/chat'

const props = defineProps<{
  draft: string
  messages: ChatMessage[]
  transfers: FileTransfer[]
  localPeerId?: string | null
  disabled?: boolean
  fileDisabled?: boolean
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  send: []
  'send-files': [files: File[]]
}>()

const draftModel = computed({
  get: () => props.draft,
  set: (value: string) => emit('update:draft', value),
})

const hasDraft = computed(() => props.draft.trim().length > 0)
const fileInput = ref<HTMLInputElement | null>(null)
const draftInput = ref<HTMLTextAreaElement | null>(null)
const transcriptList = ref<HTMLOListElement | null>(null)
const isAtTranscriptBottom = ref(true)
const showJumpToLatest = ref(false)
const transcriptItems = computed(() =>
  [...props.messages, ...props.transfers]
    .map((item) =>
      'kind' in item
        ? { type: 'message' as const, createdAt: item.createdAt, item }
        : { type: 'transfer' as const, createdAt: item.createdAt, item }
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
)

function updateTranscriptScrollState() {
  if (!transcriptList.value) {
    return
  }

  const distanceFromBottom =
    transcriptList.value.scrollHeight -
    transcriptList.value.scrollTop -
    transcriptList.value.clientHeight

  isAtTranscriptBottom.value = distanceFromBottom <= 24

  if (isAtTranscriptBottom.value) {
    showJumpToLatest.value = false
  }
}

function scrollTranscriptToBottom(behavior: 'auto' | 'smooth' = 'smooth') {
  if (!transcriptList.value) {
    return
  }

  if (typeof transcriptList.value.scrollTo === 'function') {
    transcriptList.value.scrollTo({
      top: transcriptList.value.scrollHeight,
      behavior,
    })
  } else {
    transcriptList.value.scrollTop = transcriptList.value.scrollHeight
  }

  isAtTranscriptBottom.value = true
  showJumpToLatest.value = false
}

function isLocalTranscriptEntry(
  entry: (typeof transcriptItems.value)[number] | undefined
) {
  if (!entry) {
    return false
  }

  if (entry.type === 'message') {
    return entry.item.kind === 'text' && entry.item.senderId === props.localPeerId
  }

  return entry.item.direction === 'outgoing'
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    emit('send')
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

function emitSelectedFiles(fileList: FileList | null) {
  if (!fileList) {
    return
  }

  const files = Array.from(fileList)

  if (files.length > 0) {
    emit('send-files', files)
  }
}

function handleFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement

  emitSelectedFiles(target.files)
  target.value = ''
}

function handleTranscriptScroll() {
  updateTranscriptScrollState()
}

function resizeDraftInput() {
  if (!draftInput.value) {
    return
  }

  draftInput.value.style.height = '0px'
  draftInput.value.style.height = `${Math.min(draftInput.value.scrollHeight, 180)}px`
}

watch(
  () => props.draft,
  async () => {
    await nextTick()
    resizeDraftInput()
  },
  {
    immediate: true,
  }
)

watch(
  transcriptItems,
  async (nextItems, previousItems = []) => {
    await nextTick()

    if (!transcriptList.value || nextItems.length === 0) {
      return
    }

    const previousTail = previousItems.at(-1)
    const nextTail = nextItems.at(-1)
    const isNewTail = nextTail?.item.id !== previousTail?.item.id

    if (previousItems.length === 0) {
      scrollTranscriptToBottom('auto')

      return
    }

    if (isAtTranscriptBottom.value || isLocalTranscriptEntry(nextTail)) {
      scrollTranscriptToBottom(isNewTail ? 'smooth' : 'auto')

      return
    }

    if (isNewTail) {
      showJumpToLatest.value = true
    }
  },
  {
    immediate: true,
  }
)
</script>

<template>
  <section class="panel chat-panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Chat</p>
        <h2>Room transcript</h2>
      </div>
    </div>

    <div class="chat-panel__transcript">
      <ol
        ref="transcriptList"
        class="chat-panel__list"
        @scroll="handleTranscriptScroll"
      >
        <li
          v-for="entry in transcriptItems"
          :key="entry.item.id"
          :class="[
            'chat-panel__message',
            entry.type === 'message'
              ? `chat-panel__message--${entry.item.kind}`
              : 'chat-panel__message--transfer',
            {
              'chat-panel__message--self':
                entry.type === 'message'
                  ? entry.item.kind === 'text' && entry.item.senderId === props.localPeerId
                  : entry.item.direction === 'outgoing',
            },
          ]"
        >
          <template v-if="entry.type === 'message'">
            <div class="chat-panel__meta">
              <strong>{{ entry.item.senderLabel }}</strong>
              <span>{{ formatTimeLabel(entry.item.createdAt) }}</span>
              <span>{{ entry.item.status }}</span>
            </div>
            <p class="chat-panel__body">
              <template
                v-for="(segment, index) in splitTextWithLinks(entry.item.body)"
                :key="`${entry.item.id}-${segment.type}-${index}`"
              >
                <a
                  v-if="segment.type === 'link'"
                  :href="segment.value"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ segment.value }}
                </a>
                <span v-else>{{ segment.value }}</span>
              </template>
            </p>
          </template>
          <template v-else>
            <div class="chat-panel__meta">
              <strong>
                {{ entry.item.direction === 'outgoing' ? 'You shared files' : entry.item.peerLabel }}
              </strong>
              <span>{{ formatTimeLabel(entry.item.createdAt) }}</span>
              <span>{{ entry.item.status }}</span>
            </div>
            <div
              v-if="entry.item.status !== 'completed'"
              class="chat-panel__transfer-progress"
            >
              <div
                class="chat-panel__transfer-progress-fill"
                :style="{ width: `${entry.item.progress}%` }"
              />
            </div>
            <div class="chat-panel__transfer-summary">
              <span>{{ Math.round(entry.item.progress) }}%</span>
              <span v-if="entry.item.totalBytes">
                {{ formatBytes(entry.item.totalBytes) }}
              </span>
            </div>
            <ul class="chat-panel__transfer-files">
              <li v-for="file in entry.item.files" :key="file.id">
                <span>{{ file.name }}</span>
                <a v-if="file.downloadUrl" :href="file.downloadUrl" :download="file.name">
                  Download
                </a>
              </li>
            </ul>
            <p v-if="entry.item.error" class="chat-panel__transfer-error">
              {{ entry.item.error }}
            </p>
          </template>
        </li>
      </ol>

      <button
        v-if="showJumpToLatest"
        type="button"
        class="chat-panel__jump-button"
        aria-label="Scroll to latest messages"
        @click="scrollTranscriptToBottom()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 5v12M6.5 12.5 12 18l5.5-5.5"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </svg>
      </button>
    </div>

    <div class="chat-panel__composer">
      <input
        ref="fileInput"
        type="file"
        class="chat-panel__file-input"
        multiple
        @change="handleFileInputChange"
      />
      <div class="chat-panel__composer-bar">
        <textarea
          id="message-draft"
          ref="draftInput"
          v-model="draftModel"
          rows="1"
          class="chat-panel__draft-input"
          :disabled="disabled"
          :placeholder="
              disabled
                ? 'Chat unlocks once the host connection is ready.'
              : 'Type a room message...'
          "
          @input="resizeDraftInput"
          @keydown="handleComposerKeydown"
        />
        <button
          type="button"
          class="chat-panel__action-button"
          :disabled="fileDisabled"
          aria-label="Attach files"
          @click="openFilePicker"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8 12.5 14.86 5.64a4 4 0 1 1 5.66 5.66l-9.19 9.19a6 6 0 1 1-8.49-8.48l8.48-8.49"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
        </button>
        <button
          type="button"
          class="chat-panel__action-button chat-panel__action-button--send"
          :disabled="disabled || !hasDraft"
          aria-label="Send message"
          @click="$emit('send')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 12 20 4 14 20 11 13 4 12Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.chat-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  padding: 1.25rem;
  overflow: hidden;
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

.chat-panel__list {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.18rem;
  min-height: 0;
  padding: 0;
  margin: 0;
  list-style: none;
  overflow: auto;
}

.chat-panel__transcript {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding-top: 1.25rem;
}

.chat-panel__message {
  width: fit-content;
  max-width: min(100%, 38rem);
  align-self: start;
  padding: 0.5rem 0.7rem;
  border-radius: 1.2rem;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
}

.chat-panel__jump-button {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  display: inline-grid;
  place-items: center;
  width: 3.3rem;
  height: 3.3rem;
  padding: 0;
  border: 1px solid rgba(242, 164, 99, 0.45);
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(242, 164, 99, 0.95), rgba(234, 116, 85, 0.92));
  color: #24130d;
  box-shadow: 0 18px 34px rgba(0, 0, 0, 0.26);
}

.chat-panel__jump-button svg {
  width: 1.5rem;
  height: 1.5rem;
}

.chat-panel__message--system {
  background: rgba(255, 181, 117, 0.08);
  border-color: rgba(255, 181, 117, 0.22);
}

.chat-panel__message--self {
  align-self: flex-end;
  background: linear-gradient(135deg, rgba(242, 164, 99, 0.28), rgba(234, 116, 85, 0.22));
  border-color: rgba(242, 164, 99, 0.4);
}

.chat-panel__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.2;
}

.chat-panel__body {
  margin: 0.08rem 0 0;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-panel__composer {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.chat-panel__file-input {
  display: none;
}

.chat-panel__transfer-meta,
.chat-panel__transfer-summary,
.chat-panel__transfer-files li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.chat-panel__transfer-meta,
.chat-panel__transfer-summary {
  color: var(--text-muted);
  font-size: 0.86rem;
}

.chat-panel__transfer-progress {
  overflow: hidden;
  height: 0.5rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}

.chat-panel__transfer-progress-fill {
  height: 100%;
  background: linear-gradient(135deg, #f2a463 0%, #ea7455 100%);
}

.chat-panel__transfer-files {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.9rem;
}

.chat-panel__transfer-error {
  margin: 0;
  color: var(--accent);
  font-size: 0.88rem;
}

.chat-panel__composer-bar {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: rgba(255, 255, 255, 0.04);
}

.chat-panel__draft-input {
  flex: 1;
  min-height: 3rem;
  max-height: 11.25rem;
  padding: 0.65rem 0;
  border: 0;
  background: transparent;
  resize: none;
  line-height: 1.5;
  overflow-y: auto;
}

.chat-panel__draft-input:focus {
  outline: none;
}

.chat-panel__action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 4.25rem;
  height: 4.25rem;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-main);
}

.chat-panel__action-button svg {
  width: 1.9rem;
  height: 1.9rem;
}

.chat-panel__action-button--send {
  background: linear-gradient(135deg, #f2a463 0%, #ea7455 100%);
  color: #24130d;
}

.chat-panel__action-button:disabled {
  opacity: 0.45;
}

@media (max-width: 720px) {
  .chat-panel__transfer-meta,
  .chat-panel__transfer-summary,
  .chat-panel__transfer-files li {
    flex-direction: column;
    align-items: flex-start;
  }

  .chat-panel__composer-bar {
    gap: 0.75rem;
  }
}
</style>
