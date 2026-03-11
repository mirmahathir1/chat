import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const defaultPulseMs = 240
const defaultHideDelayMs = 140

export const useNetworkActivityStore = defineStore('networkActivity', () => {
  const pendingCount = ref(0)
  const isVisible = ref(false)

  let nextToken = 0
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  const activeTokens = new Set<number>()

  const isActive = computed(() => pendingCount.value > 0 || isVisible.value)

  function clearHideTimer() {
    if (hideTimer === null) {
      return
    }

    clearTimeout(hideTimer)
    hideTimer = null
  }

  function syncPendingCount() {
    pendingCount.value = activeTokens.size
  }

  function start() {
    clearHideTimer()
    isVisible.value = true

    const token = nextToken

    nextToken += 1
    activeTokens.add(token)
    syncPendingCount()

    return token
  }

  function finish(token: number, hideDelayMs = defaultHideDelayMs) {
    if (!activeTokens.delete(token)) {
      return
    }

    syncPendingCount()

    if (activeTokens.size > 0) {
      return
    }

    clearHideTimer()
    hideTimer = setTimeout(() => {
      if (activeTokens.size > 0) {
        return
      }

      isVisible.value = false
      hideTimer = null
    }, hideDelayMs)
  }

  function pulse(durationMs = defaultPulseMs) {
    const token = start()

    setTimeout(() => {
      finish(token, 0)
    }, durationMs)

    return token
  }

  async function track<T>(
    task: Promise<T> | (() => Promise<T>),
    minimumVisibleMs = defaultPulseMs
  ) {
    const token = start()
    const startedAt = Date.now()

    const settle = () => {
      const remainingMs = Math.max(
        0,
        minimumVisibleMs - (Date.now() - startedAt)
      )

      setTimeout(() => {
        finish(token)
      }, remainingMs)
    }

    try {
      const promise = typeof task === 'function' ? task() : task

      return await promise
    } finally {
      settle()
    }
  }

  function reset() {
    activeTokens.clear()
    syncPendingCount()
    clearHideTimer()
    isVisible.value = false
  }

  return {
    pendingCount,
    isVisible,
    isActive,
    start,
    finish,
    pulse,
    track,
    reset,
  }
})
