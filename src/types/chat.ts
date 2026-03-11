export type PeerRole = 'host' | 'member'
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
export type RoomStatus = 'draft' | 'active' | 'disconnected'
export type LocalRoomMode = 'host' | 'join'
export type SignalingState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'connecting'
  | 'retrying'
  | 'connected'
  | 'disconnected'
  | 'error'
export type MessageKind = 'text' | 'system'
export type MessageDeliveryState = 'local' | 'pending' | 'sent' | 'failed'
export type PresenceEventType = 'host-created' | 'joined' | 'left'
export type TransferDirection = 'incoming' | 'outgoing'
export type TransferStatus =
  | 'queued'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type NotificationTone = 'info' | 'success' | 'warning'

export interface PeerIdentity {
  id: string
  label: string
  role: PeerRole
  connectionState: ConnectionState
  joinedAt: string
}

export interface LocalPeerSession {
  peer: PeerIdentity
  createdAt: string
  deviceLabel: string
}

export interface RoomSummary {
  id: string
  name: string
  hostPeerId: string
  shareUrl: string
  createdAt: string
  status: RoomStatus
  localMode: LocalRoomMode
}

export interface ChatMessage {
  id: string
  kind: MessageKind
  senderId: string
  senderLabel: string
  body: string
  createdAt: string
  status: MessageDeliveryState
}

export interface TransferFile {
  id: string
  name: string
  size: number
  mimeType: string
  downloadUrl?: string
}

export interface FileTransfer {
  id: string
  senderId: string
  senderLabel: string
  peerId: string
  peerLabel?: string
  direction: TransferDirection
  status: TransferStatus
  progress: number
  createdAt: string
  totalBytes?: number
  error?: string
  files: TransferFile[]
}

export interface PresenceEvent {
  id: string
  type: PresenceEventType
  peerId: string
  peerLabel: string
  createdAt: string
}

export interface RoomNotification {
  id: string
  title: string
  detail: string
  tone: NotificationTone
  createdAt: string
  seen: boolean
}
