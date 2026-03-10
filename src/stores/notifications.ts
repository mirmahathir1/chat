import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createId } from '@/lib/id'
import type { NotificationTone, RoomNotification } from '@/types/chat'

interface NotificationInput {
  title: string
  detail: string
  tone: NotificationTone
}

export const useNotificationStore = defineStore('notifications', () => {
  const items = ref<RoomNotification[]>([])

  function replaceAll(nextItems: RoomNotification[]) {
    items.value = nextItems
  }

  function pushNotification({ title, detail, tone }: NotificationInput) {
    const nextNotification: RoomNotification = {
      id: createId('notification'),
      title,
      detail,
      tone,
      createdAt: new Date().toISOString(),
      seen: false,
    }

    items.value = [nextNotification, ...items.value].slice(0, 10)
  }

  function clearAll() {
    items.value = []
  }

  return {
    items,
    replaceAll,
    pushNotification,
    clearAll,
  }
})
