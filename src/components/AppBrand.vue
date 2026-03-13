<script setup lang="ts">
import chatIconUrl from '@/assets/chat.png'

withDefaults(
  defineProps<{
    compact?: boolean
  }>(),
  {
    compact: false,
  }
)
</script>

<template>
  <div :class="['app-brand', { 'app-brand--compact': compact }]">
    <div class="app-brand__icon-frame">
      <img class="app-brand__icon" :src="chatIconUrl" alt="Chat app icon" />
    </div>
    <div class="app-brand__copy">
      <p class="app-brand__eyebrow">P2P Chat</p>
      <p class="app-brand__title">Chat</p>
    </div>
  </div>
</template>

<style scoped>
.app-brand {
  --app-brand-icon-size: 62%;
  display: inline-flex;
  align-items: center;
  gap: 0.9rem;
}

.app-brand__icon-frame {
  width: 3.5rem;
  height: 3.5rem;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.04);
  box-shadow:
    0 14px 28px rgba(0, 0, 0, 0.24),
    0 0 0 1px rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.app-brand__icon {
  width: var(--app-brand-icon-size);
  height: var(--app-brand-icon-size);
  display: block;
  object-fit: contain;
}

.app-brand__copy {
  display: grid;
  gap: 0.15rem;
}

.app-brand__eyebrow {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.app-brand__title {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  line-height: 0.94;
}

.app-brand--compact {
  --app-brand-icon-size: 66%;
  gap: 0.75rem;
}

.app-brand--compact .app-brand__icon-frame {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.85rem;
}

.app-brand--compact .app-brand__title {
  font-size: clamp(1.25rem, 3vw, 1.75rem);
}
</style>
