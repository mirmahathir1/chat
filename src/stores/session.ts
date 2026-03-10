import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createId } from '@/lib/id'
import type { ConnectionState, PeerIdentity, PeerRole } from '@/types/chat'

const defaultNames = [
  'Atlas Desk',
  'Copper Relay',
  'Harbor Node',
  'Signal Booth',
]

function createDefaultLabel() {
  const seed = defaultNames[Math.floor(Math.random() * defaultNames.length)]

  return `${seed} ${Math.floor(100 + Math.random() * 900)}`
}

export const useSessionStore = defineStore('session', () => {
  const peer = ref<PeerIdentity | null>(null)
  const createdAt = ref<string | null>(null)
  const deviceLabel = ref('This browser')

  const isReady = computed(() => peer.value !== null)

  function persistSession() {
    return
  }

  function ensureSession(role: PeerRole = 'host') {
    if (!peer.value) {
      const now = new Date().toISOString()

      peer.value = {
        id: createId('peer'),
        label: createDefaultLabel(),
        role,
        connectionState: 'idle',
        joinedAt: now,
      }
      createdAt.value = now
    }

    if (peer.value.role !== role) {
      peer.value = {
        ...peer.value,
        role,
      }
    }

    persistSession()

    return peer.value
  }

  function updateDisplayName(label: string) {
    const session = ensureSession(peer.value?.role ?? 'host')
    const nextLabel = label.trim()

    if (!nextLabel) {
      return
    }

    peer.value = {
      ...session,
      label: nextLabel,
    }
    persistSession()
  }

  function setConnectionState(connectionState: ConnectionState) {
    if (!peer.value) {
      return
    }

    peer.value = {
      ...peer.value,
      connectionState,
    }
    persistSession()
  }

  function setRole(role: PeerRole) {
    const session = ensureSession(role)

    peer.value = {
      ...session,
      role,
    }
    persistSession()
  }

  function rotatePeerIdentity(role: PeerRole = peer.value?.role ?? 'member') {
    const now = new Date().toISOString()
    const nextPeer: PeerIdentity = {
      id: createId('peer'),
      label: peer.value?.label ?? createDefaultLabel(),
      role,
      connectionState: 'idle',
      joinedAt: now,
    }

    peer.value = nextPeer
    createdAt.value = now
    persistSession()

    return nextPeer
  }

  function clearSession() {
    peer.value = null
    createdAt.value = null
  }

  return {
    peer,
    createdAt,
    deviceLabel,
    isReady,
    ensureSession,
    updateDisplayName,
    setConnectionState,
    setRole,
    rotatePeerIdentity,
    clearSession,
  }
})
