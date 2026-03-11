import { describe, expect, it } from 'vitest'
import {
  buildReplayTransferFiles,
  hasReplayableFileSet,
  listTransfersToReplay,
} from '@/lib/transferReplay'
import type { FileTransfer } from '@/types/chat'

function createTransfer(overrides: Partial<FileTransfer> = {}): FileTransfer {
  return {
    id: overrides.id ?? 'transfer-1',
    senderId: overrides.senderId ?? 'peer-a',
    senderLabel: overrides.senderLabel ?? 'Peer A',
    peerId: overrides.peerId ?? 'peer-host',
    peerLabel: overrides.peerLabel ?? 'Room host',
    direction: overrides.direction ?? 'incoming',
    status: overrides.status ?? 'completed',
    progress: overrides.progress ?? 100,
    createdAt: overrides.createdAt ?? '2026-03-10T00:00:00.000Z',
    totalBytes: overrides.totalBytes ?? 12,
    error: overrides.error,
    files: overrides.files ?? [
      {
        id: 'file-1',
        name: 'phase7.txt',
        size: 12,
        mimeType: 'text/plain',
      },
    ],
  }
}

describe('transfer replay helpers', () => {
  it('builds replay-safe files without local download URLs', () => {
    expect(
      buildReplayTransferFiles([
        {
          id: 'file-1',
          name: 'phase7.txt',
          size: 12,
          mimeType: 'text/plain',
          downloadUrl: 'blob:download',
        },
      ])
    ).toEqual([
      {
        id: 'file-1',
        name: 'phase7.txt',
        size: 12,
        mimeType: 'text/plain',
      },
    ])
  })

  it('lists completed transfers for replay in chronological order and skips the recipient sender', () => {
    const transfers = listTransfersToReplay(
      [
        createTransfer({
          id: 'transfer-2',
          senderId: 'peer-recipient',
          createdAt: '2026-03-10T00:02:00.000Z',
        }),
        createTransfer({
          id: 'transfer-3',
          senderId: 'peer-b',
          status: 'failed',
          createdAt: '2026-03-10T00:03:00.000Z',
        }),
        createTransfer({
          id: 'transfer-1',
          senderId: 'peer-a',
          createdAt: '2026-03-10T00:01:00.000Z',
        }),
      ],
      'peer-recipient'
    )

    expect(transfers.map((transfer) => transfer.id)).toEqual(['transfer-1'])
  })

  it('checks whether a cached file set can replay a transfer', () => {
    const files = [
      new File(['hello'], 'hello.txt', {
        type: 'text/plain',
      }),
    ]

    expect(hasReplayableFileSet(createTransfer(), files)).toBe(true)
    expect(hasReplayableFileSet(createTransfer(), [])).toBe(false)
    expect(hasReplayableFileSet(undefined, files)).toBe(false)
  })
})
