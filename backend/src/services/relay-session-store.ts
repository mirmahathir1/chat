import { randomUUID } from 'node:crypto'
import type {
  RelaySessionStoreContract,
  RelaySessionStoreStats,
} from './relay-store.js'
import type { CreateRelayTransferRequest, RelaySession } from '../types/relay.js'

interface RelaySessionStoreConfig {
  sessionTtlMs: number
}

export class RelaySessionStore implements RelaySessionStoreContract {
  private readonly sessions = new Map<string, RelaySession>()

  constructor(private readonly config: RelaySessionStoreConfig) {}

  createSession(input: CreateRelayTransferRequest) {
    const now = Date.now()
    const session: RelaySession = {
      createdAt: toIsoString(now),
      expiresAt: toIsoString(now + this.config.sessionTtlMs),
      files: input.files,
      recipientPeerId: input.recipientPeerId,
      roomId: input.roomId,
      senderPeerId: input.senderPeerId,
      sessionId: `relay-session-${randomUUID()}`,
      status: 'ready',
      totalBytes: input.totalBytes,
      transferId: `relay-transfer-${randomUUID()}`,
      updatedAt: toIsoString(now),
    }

    this.sessions.set(session.transferId, session)

    return session
  }

  getSession(transferId: string) {
    const session = this.sessions.get(transferId)

    if (!session) {
      return null
    }

    if (session.status === 'ready' && Date.parse(session.expiresAt) <= Date.now()) {
      session.status = 'expired'
      session.updatedAt = toIsoString(Date.now())
      this.sessions.set(transferId, session)
    }

    return session
  }

  touchSession(transferId: string) {
    const session = this.getSession(transferId)

    if (!session || session.status === 'expired' || session.status === 'cancelled') {
      return session
    }

    const now = Date.now()

    session.updatedAt = toIsoString(now)
    session.expiresAt = toIsoString(now + this.config.sessionTtlMs)
    this.sessions.set(transferId, session)

    return session
  }

  markCompleted(transferId: string) {
    const session = this.getSession(transferId)

    if (!session) {
      throw new Error('Relay session was not found.')
    }

    const now = Date.now()

    session.completedAt = toIsoString(now)
    session.expiresAt = toIsoString(now + this.config.sessionTtlMs)
    session.status = 'completed'
    session.updatedAt = toIsoString(now)
    this.sessions.set(transferId, session)

    return session
  }

  markCancelled(transferId: string, reason?: string) {
    const session = this.getSession(transferId)

    if (!session) {
      throw new Error('Relay session was not found.')
    }

    const now = Date.now()

    session.cancelReason = reason
    session.cancelledAt = toIsoString(now)
    session.expiresAt = toIsoString(now + this.config.sessionTtlMs)
    session.status = 'cancelled'
    session.updatedAt = toIsoString(now)
    this.sessions.set(transferId, session)

    return session
  }

  sweepExpired(now = Date.now()) {
    let expiredSessions = 0

    for (const [transferId, session] of this.sessions.entries()) {
      if (session.status !== 'ready') {
        continue
      }

      if (Date.parse(session.expiresAt) > now) {
        continue
      }

      session.status = 'expired'
      session.updatedAt = toIsoString(now)
      this.sessions.set(transferId, session)
      expiredSessions += 1
    }

    return expiredSessions
  }

  getStats(): RelaySessionStoreStats {
    const stats: RelaySessionStoreStats = {
      cancelledSessions: 0,
      completedSessions: 0,
      expiredSessions: 0,
      readySessions: 0,
      totalSessions: this.sessions.size,
    }

    for (const session of this.sessions.values()) {
      if (session.status === 'ready') {
        stats.readySessions += 1
        continue
      }

      if (session.status === 'completed') {
        stats.completedSessions += 1
        continue
      }

      if (session.status === 'cancelled') {
        stats.cancelledSessions += 1
        continue
      }

      stats.expiredSessions += 1
    }

    return stats
  }
}

function toIsoString(timestamp: number) {
  return new Date(timestamp).toISOString()
}
