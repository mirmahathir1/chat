import type { ChatMessage } from '@/types/chat'

export function mergeSyncedMessages(
  localMessages: ChatMessage[],
  remoteMessages: ChatMessage[]
) {
  const remoteIds = new Set(remoteMessages.map((message) => message.id))
  const localExtras = localMessages.filter((message) => {
    if (remoteIds.has(message.id)) {
      return false
    }

    if (message.kind === 'system') {
      return true
    }

    return message.status === 'pending' || message.status === 'failed'
  })

  return [...remoteMessages, ...localExtras].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )
}
