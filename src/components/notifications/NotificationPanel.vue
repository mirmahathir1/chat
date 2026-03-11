<script setup lang="ts">
import { formatTimeLabel } from '@/lib/time'
import type { RoomNotification } from '@/types/chat'

defineProps<{
  notifications: RoomNotification[]
}>()
</script>

<template>
  <section class="panel notification-panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Notifications</p>
        <h2>Room events</h2>
      </div>
      <span class="phase-chip">In-app feed</span>
    </div>

    <Transition name="ui-fade" mode="out-in" appear>
      <ul v-if="notifications.length" class="notification-list">
        <TransitionGroup name="ui-list" appear>
          <li
            v-for="notification in notifications"
            :key="notification.id"
            :class="[
              'notification-list__item',
              `notification-list__item--${notification.tone}`,
            ]"
          >
            <div class="notification-list__meta">
              <strong>{{ notification.title }}</strong>
              <span>{{ formatTimeLabel(notification.createdAt) }}</span>
            </div>
            <p>{{ notification.detail }}</p>
          </li>
        </TransitionGroup>
      </ul>
      <p v-else class="notification-panel__empty">
        Host presence changes and room notices will appear here.
      </p>
    </Transition>
  </section>
</template>

<style scoped>
.notification-panel {
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

.notification-list {
  display: grid;
  gap: 0.85rem;
  padding: 0;
  margin: 1.25rem 0 0;
  list-style: none;
}

.notification-list__item {
  padding: 0.95rem 1rem;
  border-radius: 1.15rem;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}

.notification-list__item--success {
  border-color: rgba(109, 214, 154, 0.26);
}

.notification-list__item--warning {
  border-color: rgba(255, 181, 117, 0.26);
}

.notification-list__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.notification-list__item p {
  margin: 0.55rem 0 0;
  line-height: 1.55;
}

.notification-panel__empty {
  margin: 1.25rem 0 0;
  color: var(--text-muted);
}

@media (max-width: 720px) {
  .notification-list__meta {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
