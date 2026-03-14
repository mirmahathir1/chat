import { createId } from '@/lib/id'
import type { ChatMessage, PeerIdentity } from '@/types/chat'

export const maxChatMessageBytes = 2048

type MessageSender = Pick<PeerIdentity, 'id' | 'label'>

interface ChatBodyValidationResult {
  body: string | null
  error: string | null
}

export function buildSystemMessage(
  body: string,
  createdAt: string
): ChatMessage {
  return {
    id: createId('message'),
    kind: 'system',
    senderId: 'system',
    senderLabel: 'Room',
    body,
    createdAt,
    status: 'sent',
  }
}

export function buildTextMessage(
  sender: MessageSender,
  body: string,
  createdAt: string,
  status: ChatMessage['status'],
  id = createId('message')
): ChatMessage {
  return {
    id,
    kind: 'text',
    senderId: sender.id,
    senderLabel: sender.label,
    body,
    createdAt,
    status,
  }
}

export function validateChatBody(body: string): ChatBodyValidationResult {
  const trimmed = body.trim()

  if (!trimmed) {
    return {
      body: null,
      error: 'Messages cannot be empty.',
    }
  }

  const messageBytes = new TextEncoder().encode(trimmed).length

  if (messageBytes > maxChatMessageBytes) {
    return {
      body: null,
      error: `Messages must stay under ${maxChatMessageBytes} bytes.`,
    }
  }

  return {
    body: trimmed,
    error: null,
  }
}

export function upsertMessage(
  messages: ChatMessage[],
  message: ChatMessage
): ChatMessage[] {
  const existingIndex = messages.findIndex(
    (currentMessage) => currentMessage.id === message.id
  )

  if (existingIndex === -1) {
    return [...messages, message]
  }

  return messages.map((currentMessage, index) =>
    index === existingIndex ? { ...currentMessage, ...message } : currentMessage
  )
}

export function markMessageStatus(
  messages: ChatMessage[],
  messageId: string,
  status: ChatMessage['status'],
  fallbackMessage?: ChatMessage
): ChatMessage[] {
  const existingMessage = messages.find((message) => message.id === messageId)

  if (!existingMessage && fallbackMessage) {
    return upsertMessage(messages, {
      ...fallbackMessage,
      status,
    })
  }

  if (!existingMessage) {
    return messages
  }

  return upsertMessage(messages, {
    ...existingMessage,
    status,
  })
}

export function failPendingMessagesForPeer(
  messages: ChatMessage[],
  peerId: string
): ChatMessage[] {
  return messages.map((message) => {
    if (message.senderId !== peerId || message.status !== 'pending') {
      return message
    }

    return {
      ...message,
      status: 'failed',
    }
  })
}
