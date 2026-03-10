<script setup lang="ts">
import { computed } from 'vue'
import { formatTimeLabel } from '@/lib/time'
import type { PeerIdentity } from '@/types/chat'

const props = defineProps<{
  members: PeerIdentity[]
  hostPeerId: string
  activeMemberCount: number
}>()

const orderedMembers = computed(() =>
  [...props.members].sort((left, right) => {
    if (left.id === props.hostPeerId) {
      return -1
    }

    if (right.id === props.hostPeerId) {
      return 1
    }

    return left.joinedAt.localeCompare(right.joinedAt)
  })
)
</script>

<template>
  <section class="panel members-panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Members</p>
        <h2>{{ activeMemberCount }} active</h2>
      </div>
      <span class="phase-chip">Host managed</span>
    </div>

    <ul v-if="orderedMembers.length" class="members-list">
      <li
        v-for="member in orderedMembers"
        :key="member.id"
        class="members-list__item"
      >
        <div>
          <div class="members-list__title">
            <strong>{{ member.label }}</strong>
            <span v-if="member.id === hostPeerId" class="member-badge"
              >Host</span
            >
          </div>
          <p>{{ member.id }}</p>
        </div>
        <div class="members-list__meta">
          <span>{{ member.connectionState }}</span>
          <span>{{ formatTimeLabel(member.joinedAt) }}</span>
        </div>
      </li>
    </ul>
    <p v-else class="members-panel__empty">
      Remote peers will appear here after signaling is wired in.
    </p>
  </section>
</template>

<style scoped>
.members-panel {
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

.members-list {
  display: grid;
  gap: 0.85rem;
  padding: 0;
  margin: 1.25rem 0 0;
  list-style: none;
}

.members-list__item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.95rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1.15rem;
  background: rgba(255, 255, 255, 0.03);
}

.members-list__title {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.members-list__item p {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.member-badge {
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  background: rgba(255, 181, 117, 0.16);
  color: var(--accent);
  font-size: 0.76rem;
}

.members-list__meta {
  display: grid;
  gap: 0.3rem;
  color: var(--text-muted);
  text-align: right;
  font-size: 0.82rem;
}

.members-panel__empty {
  margin: 1.25rem 0 0;
  color: var(--text-muted);
}

@media (max-width: 720px) {
  .members-list__item {
    flex-direction: column;
  }

  .members-list__meta {
    text-align: left;
  }
}
</style>
