import { describe, expect, it } from 'vitest'
import {
  cancelTransfer,
  completeTransfer,
  failTransfer,
  failTransfersForPeer,
  setTransferTransport,
  updateTransferProgress,
  upsertTransfer,
} from '@/domain/transfers/state'
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
    status: 'queued',
    progress: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    totalBytes: 100,
    files: [
      {
        id: 'file-1',
        name: 'hello.txt',
        size: 100,
        mimeType: 'text/plain',
      },
    ],
    ...overrides,
  }
}

describe('transfer state domain', () => {
  it('upserts transfers and normalizes their transport', () => {
    expect(
      upsertTransfer([], createTransfer({ transport: undefined as never }))
    ).toEqual([createTransfer()])

    expect(
      upsertTransfer(
        [createTransfer({ progress: 10 })],
        createTransfer({ progress: 75, status: 'transferring' })
      )
    ).toEqual([createTransfer({ progress: 75, status: 'transferring' })])
  })

  it('updates transfer progress and terminal states', () => {
    const queuedTransfer = createTransfer({
      bytesPerSecond: 50,
      error: 'stale',
      progress: 10,
      status: 'queued',
    })

    const progressed = updateTransferProgress(
      [queuedTransfer],
      queuedTransfer.id,
      120,
      'transferring',
      400
    )

    expect(progressed).toEqual([
      createTransfer({
        bytesPerSecond: 400,
        error: undefined,
        progress: 100,
        status: 'transferring',
      }),
    ])

    expect(completeTransfer(progressed, queuedTransfer.id)).toEqual([
      createTransfer({
        bytesPerSecond: undefined,
        error: undefined,
        progress: 100,
        status: 'completed',
      }),
    ])

    expect(failTransfer(progressed, queuedTransfer.id, 'boom')).toEqual([
      createTransfer({
        bytesPerSecond: undefined,
        error: 'boom',
        progress: 100,
        status: 'failed',
      }),
    ])

    expect(cancelTransfer(progressed, queuedTransfer.id)).toEqual([
      createTransfer({
        bytesPerSecond: undefined,
        error: undefined,
        progress: 0,
        status: 'cancelled',
      }),
    ])
  })

  it('updates transfer transport and fails peer-matched transfers only', () => {
    const transfers = [
      createTransfer({ id: 'transfer-1', peerId: 'peer-2', status: 'queued' }),
      createTransfer({
        id: 'transfer-2',
        peerId: 'peer-2',
        status: 'completed',
        progress: 100,
      }),
      createTransfer({ id: 'transfer-3', peerId: 'peer-3', status: 'queued' }),
    ]

    expect(
      setTransferTransport(transfers, 'transfer-1', 'backend-relay')[0]
        ?.transport
    ).toBe('backend-relay')

    expect(failTransfersForPeer(transfers, 'peer-2', 'offline')).toEqual([
      createTransfer({
        id: 'transfer-1',
        error: 'offline',
        peerId: 'peer-2',
        status: 'failed',
      }),
      createTransfer({
        id: 'transfer-2',
        peerId: 'peer-2',
        progress: 100,
        status: 'completed',
      }),
      createTransfer({ id: 'transfer-3', peerId: 'peer-3', status: 'queued' }),
    ])
  })
})
