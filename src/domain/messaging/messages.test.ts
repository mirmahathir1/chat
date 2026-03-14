import { describe, expect, it } from 'vitest'
import {
  buildTextMessage,
  failPendingMessagesForPeer,
  markMessageStatus,
  maxChatMessageBytes,
  validateChatBody,
} from '@/domain/messaging/messages'
import type { ChatMessage } from '@/types/chat'

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    kind: 'text',
    senderId: 'peer-1',
    senderLabel: 'Peer 1',
    body: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  }
}

describe('messaging domain', () => {
  it('trims and validates chat bodies', () => {
    expect(validateChatBody('  hello  ')).toEqual({
      body: 'hello',
      error: null,
    })
    expect(validateChatBody('   ')).toEqual({
      body: null,
      error: 'Messages cannot be empty.',
    })
    expect(validateChatBody('a'.repeat(maxChatMessageBytes + 1))).toEqual({
      body: null,
      error: `Messages must stay under ${maxChatMessageBytes} bytes.`,
    })
  })

  it('marks message status and uses fallback messages when needed', () => {
    const sentMessage = buildTextMessage(
      {
        id: 'peer-1',
        label: 'Peer 1',
      },
      'hello',
      '2026-01-01T00:00:00.000Z',
      'pending',
      'message-1'
    )

    expect(markMessageStatus([sentMessage], 'message-1', 'sent')).toEqual([
      {
        ...sentMessage,
        status: 'sent',
      },
    ])

    expect(
      markMessageStatus(
        [],
        'message-2',
        'failed',
        createMessage({ id: 'message-2' })
      )
    ).toEqual([
      {
        ...createMessage({ id: 'message-2' }),
        status: 'failed',
      },
    ])
  })

  it('fails only pending messages for the requested peer', () => {
    expect(
      failPendingMessagesForPeer(
        [
          createMessage({
            id: 'pending-1',
            senderId: 'peer-1',
            status: 'pending',
          }),
          createMessage({ id: 'sent-1', senderId: 'peer-1', status: 'sent' }),
          createMessage({
            id: 'pending-2',
            senderId: 'peer-2',
            status: 'pending',
          }),
        ],
        'peer-1'
      )
    ).toEqual([
      createMessage({ id: 'pending-1', senderId: 'peer-1', status: 'failed' }),
      createMessage({ id: 'sent-1', senderId: 'peer-1', status: 'sent' }),
      createMessage({ id: 'pending-2', senderId: 'peer-2', status: 'pending' }),
    ])
  })
})
