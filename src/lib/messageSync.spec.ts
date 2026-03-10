import { describe, expect, it } from 'vitest'
import { mergeSyncedMessages } from '@/lib/messageSync'
import type { ChatMessage } from '@/types/chat'

function buildMessage(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'createdAt'>
): ChatMessage {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'text',
    senderId: overrides.senderId ?? 'peer-local',
    senderLabel: overrides.senderLabel ?? 'Local peer',
    body: overrides.body ?? 'message',
    createdAt: overrides.createdAt,
    status: overrides.status ?? 'sent',
  }
}

describe('mergeSyncedMessages', () => {
  it('adds synced room history while preserving local transient messages', () => {
    const localMessages = [
      buildMessage({
        id: 'system-local',
        kind: 'system',
        body: 'Connected to the host through the signaling layer.',
        createdAt: '2026-03-10T10:00:00.000Z',
      }),
      buildMessage({
        id: 'pending-local',
        body: 'Still pending',
        createdAt: '2026-03-10T10:00:03.000Z',
        status: 'pending',
      }),
    ]
    const remoteMessages = [
      buildMessage({
        id: 'remote-1',
        senderId: 'peer-host',
        senderLabel: 'Host',
        body: 'Existing room history',
        createdAt: '2026-03-10T10:00:01.000Z',
      }),
    ]

    expect(mergeSyncedMessages(localMessages, remoteMessages)).toEqual([
      localMessages[0],
      remoteMessages[0],
      localMessages[1],
    ])
  })

  it('prefers the synced copy when a message already exists locally', () => {
    const localMessages = [
      buildMessage({
        id: 'message-1',
        body: 'Draft copy',
        createdAt: '2026-03-10T10:00:00.000Z',
        status: 'pending',
      }),
    ]
    const remoteMessages = [
      buildMessage({
        id: 'message-1',
        senderId: 'peer-host',
        senderLabel: 'Host',
        body: 'Delivered copy',
        createdAt: '2026-03-10T10:00:00.000Z',
        status: 'sent',
      }),
    ]

    expect(mergeSyncedMessages(localMessages, remoteMessages)).toEqual(
      remoteMessages
    )
  })
})
