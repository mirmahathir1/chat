import { describe, expect, it } from 'vitest'
import { buildTransferHistorySnapshot, mergeSyncedTransfers } from '@/lib/transferSync'
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

describe('transfer sync helpers', () => {
  it('builds history snapshots from completed transfers without local download URLs', () => {
    const history = buildTransferHistorySnapshot([
      createTransfer({
        files: [
          {
            id: 'file-1',
            name: 'phase7.txt',
            size: 12,
            mimeType: 'text/plain',
            downloadUrl: 'blob:local-download',
          },
        ],
      }),
      createTransfer({
        id: 'transfer-2',
        status: 'transferring',
      }),
    ])

    expect(history).toHaveLength(1)
    expect(history[0]?.files[0]).toEqual({
      id: 'file-1',
      name: 'phase7.txt',
      size: 12,
      mimeType: 'text/plain',
    })
  })

  it('merges synced transfers while preserving local download URLs and sender perspective', () => {
    const localTransfers = [
      createTransfer({
        id: 'transfer-1',
        senderId: 'peer-host',
        senderLabel: 'Host',
        direction: 'incoming',
        files: [
          {
            id: 'file-1',
            name: 'phase7.txt',
            size: 12,
            mimeType: 'text/plain',
            downloadUrl: 'blob:existing-download',
          },
        ],
      }),
    ]
    const remoteTransfers = [
      createTransfer({
        id: 'transfer-1',
        senderId: 'peer-host',
        senderLabel: 'Host',
        direction: 'outgoing',
      }),
      createTransfer({
        id: 'transfer-2',
        senderId: 'peer-member',
        senderLabel: 'Member',
        direction: 'incoming',
        createdAt: '2026-03-10T00:01:00.000Z',
      }),
    ]

    const merged = mergeSyncedTransfers(
      localTransfers,
      remoteTransfers,
      'peer-joiner'
    )

    expect(merged).toHaveLength(2)
    expect(merged[0]?.direction).toBe('incoming')
    expect(merged[0]?.files[0]?.downloadUrl).toBe('blob:existing-download')
    expect(merged[1]?.senderLabel).toBe('Member')
  })

  it('marks synced transfers as outgoing for the original sender on reconnect', () => {
    const merged = mergeSyncedTransfers(
      [],
      [
        createTransfer({
          senderId: 'peer-self',
          senderLabel: 'Self',
          direction: 'incoming',
        }),
      ],
      'peer-self'
    )

    expect(merged[0]?.direction).toBe('outgoing')
  })

  it('treats a missing remote transfer snapshot as empty history', () => {
    const merged = mergeSyncedTransfers(
      [
        createTransfer({
          id: 'transfer-local',
        }),
      ],
      undefined,
      'peer-self'
    )

    expect(merged.map((transfer) => transfer.id)).toEqual(['transfer-local'])
  })
})
