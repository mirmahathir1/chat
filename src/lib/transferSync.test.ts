import { describe, expect, it } from 'vitest'
import {
  buildTransferHistorySnapshot,
  mergeSyncedTransfers,
} from '@/lib/transferSync'
import type { FileTransfer } from '@/types/chat'

function createTransfer(overrides: Partial<FileTransfer> = {}): FileTransfer {
  return {
    id: 'transfer-1',
    senderId: 'peer-1',
    senderLabel: 'Peer 1',
    peerId: 'peer-2',
    peerLabel: 'Peer 2',
    direction: 'outgoing',
    transport: 'webrtc',
    status: 'completed',
    progress: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
    totalBytes: 100,
    files: [
      {
        id: 'file-1',
        name: 'hello.txt',
        size: 100,
        mimeType: 'text/plain',
        downloadUrl: 'blob:local',
        previewUrl: 'blob:preview',
      },
    ],
    ...overrides,
  }
}

describe('transferSync helpers', () => {
  it('builds a completed-only history snapshot without local file urls', () => {
    expect(
      buildTransferHistorySnapshot([
        createTransfer({
          id: 'completed-2',
          createdAt: '2026-01-01T00:00:02.000Z',
          status: 'completed',
        }),
        createTransfer({
          id: 'failed-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          status: 'failed',
        }),
        createTransfer({
          id: 'completed-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'completed',
        }),
      ])
    ).toEqual([
      createTransfer({
        id: 'completed-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        files: [
          {
            id: 'file-1',
            name: 'hello.txt',
            size: 100,
            mimeType: 'text/plain',
          },
        ],
      }),
      createTransfer({
        id: 'completed-2',
        createdAt: '2026-01-01T00:00:02.000Z',
        files: [
          {
            id: 'file-1',
            name: 'hello.txt',
            size: 100,
            mimeType: 'text/plain',
          },
        ],
      }),
    ])
  })

  it('merges remote transfers with local download urls and local-only entries', () => {
    expect(
      mergeSyncedTransfers(
        [
          createTransfer({
            id: 'shared',
            files: [
              {
                id: 'file-1',
                name: 'hello.txt',
                size: 100,
                mimeType: 'text/plain',
                downloadUrl: 'blob:local',
                previewUrl: 'blob:preview',
              },
            ],
          }),
          createTransfer({
            id: 'local-only',
            createdAt: '2026-01-01T00:00:02.000Z',
            status: 'queued',
          }),
        ],
        [
          createTransfer({
            id: 'shared',
            direction: 'incoming',
            senderId: 'peer-1',
            files: [
              {
                id: 'file-1',
                name: 'hello.txt',
                size: 100,
                mimeType: 'text/plain',
              },
            ],
          }),
        ],
        'peer-1'
      )
    ).toEqual([
      createTransfer({
        id: 'shared',
        direction: 'outgoing',
        files: [
          {
            id: 'file-1',
            name: 'hello.txt',
            size: 100,
            mimeType: 'text/plain',
            downloadUrl: 'blob:local',
            previewUrl: 'blob:preview',
          },
        ],
      }),
      createTransfer({
        id: 'local-only',
        createdAt: '2026-01-01T00:00:02.000Z',
        status: 'queued',
      }),
    ])
  })
})
