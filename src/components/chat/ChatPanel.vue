<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatBytes } from '@/lib/fileTransfer'
import { splitTextWithLinks } from '@/lib/linkify'
import { formatTimeLabel } from '@/lib/time'
import type { ChatMessage, FileTransfer } from '@/types/chat'

const props = defineProps<{
  draft: string
  messages: ChatMessage[]
  transfers: FileTransfer[]
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
const isDraggingFiles = ref(false)
const hasTransfers = computed(() => props.transfers.length > 0)

function handleComposerKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
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

function handleFileDragOver(event: DragEvent) {
  event.preventDefault()
  isDraggingFiles.value = true
}

function handleFileDragLeave() {
  isDraggingFiles.value = false
}

function handleFileDrop(event: DragEvent) {
  event.preventDefault()
  isDraggingFiles.value = false
  emitSelectedFiles(event.dataTransfer?.files ?? null)
}
</script>

<template>
  <section class="panel chat-panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Chat</p>
        <h2>Room transcript</h2>
      </div>
      <span class="phase-chip">Text first</span>
    </div>

    <ol class="chat-panel__list">
      <li
        v-for="message in messages"
        :key="message.id"
        :class="['chat-panel__message', `chat-panel__message--${message.kind}`]"
      >
        <div class="chat-panel__meta">
          <strong>{{ message.senderLabel }}</strong>
          <span>{{ formatTimeLabel(message.createdAt) }}</span>
          <span>{{ message.status }}</span>
        </div>
        <p class="chat-panel__body">
          <template
            v-for="(segment, index) in splitTextWithLinks(message.body)"
            :key="`${message.id}-${segment.type}-${index}`"
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
      </li>
    </ol>

    <section class="chat-panel__transfer-panel">
      <div class="chat-panel__transfer-header">
        <div>
          <p class="eyebrow">Files</p>
          <h3>Room sharing</h3>
        </div>
        <button
          type="button"
          class="secondary-button"
          :disabled="fileDisabled"
          @click="openFilePicker"
        >
          Share files
        </button>
      </div>

      <input
        ref="fileInput"
        type="file"
        class="chat-panel__file-input"
        multiple
        @change="handleFileInputChange"
      />

      <div
        :class="[
          'chat-panel__dropzone',
          { 'chat-panel__dropzone--active': isDraggingFiles },
        ]"
        @dragover="handleFileDragOver"
        @dragleave="handleFileDragLeave"
        @drop="handleFileDrop"
      >
        <strong>Drop files here</strong>
        <span>
          {{ fileDisabled ? 'Wait for another connected peer to receive files.' : 'Send one or many files through the room.' }}
        </span>
      </div>

      <ul v-if="hasTransfers" class="chat-panel__transfer-list">
        <li
          v-for="transfer in transfers"
          :key="transfer.id"
          class="chat-panel__transfer-item"
        >
          <div class="chat-panel__transfer-meta">
            <strong>
              {{ transfer.direction === 'outgoing' ? 'Outgoing files' : transfer.peerLabel }}
            </strong>
            <span>{{ transfer.status }}</span>
          </div>
          <div class="chat-panel__transfer-progress">
            <div
              class="chat-panel__transfer-progress-fill"
              :style="{ width: `${transfer.progress}%` }"
            />
          </div>
          <div class="chat-panel__transfer-summary">
            <span>{{ Math.round(transfer.progress) }}%</span>
            <span v-if="transfer.totalBytes">
              {{ formatBytes(transfer.totalBytes) }}
            </span>
          </div>
          <ul class="chat-panel__transfer-files">
            <li v-for="file in transfer.files" :key="file.id">
              <span>{{ file.name }}</span>
              <a v-if="file.downloadUrl" :href="file.downloadUrl" :download="file.name">
                Download
              </a>
            </li>
          </ul>
          <p v-if="transfer.error" class="chat-panel__transfer-error">
            {{ transfer.error }}
          </p>
        </li>
      </ul>
    </section>

    <div class="chat-panel__composer">
      <label for="message-draft" class="eyebrow">Composer</label>
      <textarea
        id="message-draft"
        v-model="draftModel"
        rows="4"
        :disabled="disabled"
        :placeholder="
            disabled
              ? 'Chat unlocks when text messaging lands in the next phase.'
            : 'Type a room message...'
        "
        @keydown="handleComposerKeydown"
      />
      <div class="chat-panel__composer-footer">
        <p>
          {{
            disabled
              ? 'This join screen is read-only until text chat lands.'
              : 'Ctrl or Cmd + Enter sends the draft through the host relay.'
          }}
        </p>
        <button
          type="button"
          :disabled="disabled || !hasDraft"
          @click="$emit('send')"
        >
          Send message
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.chat-panel {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 0;
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

.chat-panel__list {
  display: grid;
  gap: 0.9rem;
  min-height: 0;
  padding: 0;
  margin: 1.25rem 0 0;
  list-style: none;
  overflow: auto;
}

.chat-panel__message {
  padding: 0.95rem 1rem;
  border-radius: 1.2rem;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
}

.chat-panel__message--system {
  background: rgba(255, 181, 117, 0.08);
  border-color: rgba(255, 181, 117, 0.22);
}

.chat-panel__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.chat-panel__body {
  margin: 0.6rem 0 0;
  line-height: 1.65;
}

.chat-panel__composer {
  display: grid;
  gap: 0.75rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.chat-panel__transfer-panel {
  display: grid;
  gap: 0.9rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.chat-panel__transfer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.chat-panel__transfer-header h3 {
  margin: 0.25rem 0 0;
  font-size: 1.05rem;
}

.chat-panel__file-input {
  display: none;
}

.chat-panel__dropzone {
  display: grid;
  gap: 0.35rem;
  padding: 1rem;
  border: 1px dashed var(--border-strong);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-muted);
}

.chat-panel__dropzone--active {
  background: rgba(255, 181, 117, 0.08);
  border-color: var(--accent);
}

.chat-panel__transfer-list {
  display: grid;
  gap: 0.8rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-panel__transfer-item {
  display: grid;
  gap: 0.55rem;
  padding: 0.95rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.03);
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

.chat-panel__composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.chat-panel__composer-footer p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.88rem;
}

@media (max-width: 720px) {
  .chat-panel__composer-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .chat-panel__transfer-header,
  .chat-panel__transfer-meta,
  .chat-panel__transfer-summary,
  .chat-panel__transfer-files li {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
