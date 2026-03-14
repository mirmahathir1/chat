import { describe, expect, it } from 'vitest'
import { mergeSyncedMessages } from '@/lib/messageSync'
import type { ChatMessage } from '@/types/chat'

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    kind: 'text',
    senderId: 'peer-1',
    senderLabel: 'Peer 1',
    body: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'sent',
    ...overrides,
  }
}

describe('mergeSyncedMessages', () => {
  it('keeps remote history and preserves local system and unsent extras', () => {
    const merged = mergeSyncedMessages(
      [
        createMessage({
          id: 'pending-local',
          createdAt: '2026-01-01T00:00:03.000Z',
          status: 'pending',
        }),
        createMessage({
          id: 'system-local',
          createdAt: '2026-01-01T00:00:01.500Z',
          kind: 'system',
          senderId: 'system',
          senderLabel: 'Room',
          status: 'sent',
        }),
        createMessage({
          id: 'duplicate',
          body: 'stale',
          createdAt: '2026-01-01T00:00:02.000Z',
          status: 'failed',
        }),
      ],
      [
        createMessage({
          id: 'remote-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          body: 'remote',
        }),
        createMessage({
          id: 'duplicate',
          createdAt: '2026-01-01T00:00:02.000Z',
          body: 'fresh',
        }),
      ]
    )

    expect(merged).toEqual([
      createMessage({
        id: 'remote-1',
        createdAt: '2026-01-01T00:00:01.000Z',
        body: 'remote',
      }),
      createMessage({
        id: 'system-local',
        createdAt: '2026-01-01T00:00:01.500Z',
        kind: 'system',
        senderId: 'system',
        senderLabel: 'Room',
        status: 'sent',
      }),
      createMessage({
        id: 'duplicate',
        createdAt: '2026-01-01T00:00:02.000Z',
        body: 'fresh',
      }),
      createMessage({
        id: 'pending-local',
        createdAt: '2026-01-01T00:00:03.000Z',
        status: 'pending',
      }),
    ])
  })
})
