import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createId } from '@/lib/id'
import type { ConnectionState, PeerIdentity, PeerRole } from '@/types/chat'

const sessionStorageKey = 'hosted-p2p-chat/session'
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
  const peer = ref<PeerIdentity | null>(loadStoredPeer())
  const createdAt = ref<string | null>(loadStoredCreatedAt())
  const deviceLabel = ref('This browser')

  const isReady = computed(() => peer.value !== null)

  function persistSession() {
    if (typeof window === 'undefined') {
      return
    }

    if (!peer.value || !createdAt.value) {
      window.localStorage.removeItem(sessionStorageKey)

      return
    }

    window.localStorage.setItem(
      sessionStorageKey,
      JSON.stringify({
        peer: peer.value,
        createdAt: createdAt.value,
      })
    )
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
  }
})

function loadStoredSession() {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(sessionStorageKey)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as {
      peer?: PeerIdentity
      createdAt?: string
    }
  } catch {
    window.localStorage.removeItem(sessionStorageKey)

    return null
  }
}

function loadStoredPeer() {
  return loadStoredSession()?.peer ?? null
}

function loadStoredCreatedAt() {
  return loadStoredSession()?.createdAt ?? null
}
