<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    configured?: boolean
    modelValue: boolean
  }>(),
  {
    configured: true,
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const modeStateLabel = computed(() =>
  props.modelValue ? 'Backend relay' : 'WebRTC first'
)
const detailLabel = computed(() =>
  props.modelValue
    ? 'Transfers use the backend relay immediately for this session.'
    : 'Transfers try direct WebRTC first and switch to the backend relay if the direct path does not become ready in time.'
)

function handleToggle(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <details class="relay-panel" data-testid="advanced-options">
    <summary class="relay-panel__summary" data-testid="advanced-options-toggle">
      <span class="relay-panel__summary-label">Advanced Options</span>
      <span class="relay-panel__summary-icon" aria-hidden="true" />
    </summary>

    <div class="relay-panel__content">
      <div class="relay-panel__header">
        <div class="relay-panel__copy">
          <p class="eyebrow">Transfer route</p>
          <p class="relay-panel__detail">{{ detailLabel }}</p>
          <p v-if="modelValue && !configured" class="relay-panel__warning">
            Backend relay is selected, but `VITE_RELAY_BACKEND_URL` is not set
            yet.
          </p>
        </div>
        <label class="relay-panel__switch" data-testid="relay-switch">
          <input
            :checked="modelValue"
            type="checkbox"
            data-testid="relay-toggle"
            @change="handleToggle"
          />
          <span class="relay-panel__slider" aria-hidden="true" />
          <span
            class="relay-panel__switch-label"
            data-testid="relay-mode-label"
          >
            {{ modeStateLabel }}
          </span>
        </label>
      </div>
    </div>
  </details>
</template>

<style scoped>
.relay-panel {
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.03);
}

.relay-panel__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  cursor: pointer;
  list-style: none;
}

.relay-panel__summary::-webkit-details-marker {
  display: none;
}

.relay-panel__summary-label {
  color: var(--text-main);
  font-size: 0.95rem;
  font-weight: 600;
}

.relay-panel__summary-icon {
  width: 0.65rem;
  height: 0.65rem;
  border-right: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
  transform: rotate(45deg);
  transition: transform 180ms ease;
}

.relay-panel[open] .relay-panel__summary-icon {
  transform: rotate(225deg);
}

.relay-panel__content {
  padding: 0 1rem 1rem;
}

.relay-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.relay-panel__copy {
  min-width: 0;
}

.relay-panel__detail,
.relay-panel__warning {
  margin: 0.5rem 0 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.relay-panel__warning {
  color: var(--accent-soft);
}

.relay-panel__switch {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  color: var(--text-main);
  font-size: 0.8rem;
  text-align: center;
}

.relay-panel__switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.relay-panel__slider {
  position: relative;
  display: inline-flex;
  width: 3.6rem;
  height: 2rem;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}

.relay-panel__slider::after {
  content: '';
  position: absolute;
  top: 0.18rem;
  left: 0.18rem;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  background: var(--text-main);
  transition: transform 150ms ease;
}

.relay-panel__switch input:checked + .relay-panel__slider {
  background: rgba(255, 181, 117, 0.18);
  border-color: rgba(255, 181, 117, 0.52);
}

.relay-panel__switch input:checked + .relay-panel__slider::after {
  transform: translateX(1.52rem);
}

.relay-panel__switch-label {
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .relay-panel__header {
    flex-direction: column;
  }

  .relay-panel__switch {
    justify-items: start;
    text-align: left;
  }
}
</style>
