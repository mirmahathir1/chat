import type {
  ChatMessage,
  FileTransfer,
  PeerIdentity,
  PresenceEvent,
  TransferFile,
} from '@/types/chat'

export interface MemberHelloMessage {
  type: 'member-hello'
  preferBackendRelay: boolean
  roomId: string
  peer: Pick<PeerIdentity, 'id' | 'label' | 'joinedAt'>
}

export interface HostWelcomeMessage {
  type: 'host-welcome'
  roomId: string
  preferBackendRelay: boolean
  host: Pick<PeerIdentity, 'id' | 'label' | 'joinedAt'>
  members: PeerIdentity[]
  presenceEvents: PresenceEvent[]
  messages: ChatMessage[]
  transfers?: FileTransfer[]
}

export interface RoomSyncMessage {
  type: 'room-sync'
  preferBackendRelay: boolean
  roomId: string
  members: PeerIdentity[]
  presenceEvents: PresenceEvent[]
}

export interface RelayPreferenceMessage {
  type: 'relay-preference'
  peerId: string
  preferBackendRelay: boolean
  roomId: string
}

export interface PresenceBroadcastMessage {
  type: 'presence-event'
  roomId: string
  event: Omit<PresenceEvent, 'id'>
}

export interface ChatSendMessage {
  type: 'chat-send'
  roomId: string
  message: Pick<ChatMessage, 'id' | 'body' | 'createdAt'>
}

export interface ChatBroadcastMessage {
  type: 'chat-broadcast'
  roomId: string
  message: ChatMessage
}

export interface ChatRejectedMessage {
  type: 'chat-rejected'
  roomId: string
  messageId: string
  reason: string
}

export interface FileOfferMessage {
  type: 'file-offer'
  roomId: string
  transferId: string
  sender: Pick<PeerIdentity, 'id' | 'label'>
  files: TransferFile[]
  totalBytes: number
  createdAt?: string
  targetPeerId?: string
}

export interface FileOfferAckMessage {
  type: 'file-offer-ack'
  roomId: string
  transferId: string
  peerId: string
  targetPeerId: string
}

export interface FileChunkMessage {
  type: 'file-chunk'
  roomId: string
  transferId: string
  fileId: string
  chunkIndex: number
  totalChunks: number
  data: ArrayBuffer
  targetPeerId?: string
}

export interface RelayTransferUploadedFileMessage {
  fileId: string
  pathname: string
}

export interface RelayTransferOfferMessage {
  type: 'relay-transfer-offer'
  roomId: string
  transferId: string
  sender: Pick<PeerIdentity, 'id' | 'label'>
  files: TransferFile[]
  totalBytes: number
  createdAt?: string
  relay: {
    files: RelayTransferUploadedFileMessage[]
  }
  targetPeerId: string
}

export interface FileCompleteMessage {
  type: 'file-complete'
  roomId: string
  transferId: string
  targetPeerId?: string
}

export interface ReplayTransferRequestMessage {
  type: 'replay-transfer'
  roomId: string
  transferId: string
  recipientPeerId: string
}

export interface ReplayTransferUnavailableMessage {
  type: 'replay-transfer-unavailable'
  roomId: string
  transferId: string
  recipientPeerId: string
  reason: string
}

export interface TransferCancelMessage {
  type: 'transfer-cancel'
  roomId: string
  transferId: string
  targetPeerId?: string
}

export type SignalingMessage =
  | MemberHelloMessage
  | HostWelcomeMessage
  | RoomSyncMessage
  | PresenceBroadcastMessage
  | ChatSendMessage
  | ChatBroadcastMessage
  | ChatRejectedMessage
  | RelayPreferenceMessage
  | FileOfferMessage
  | FileOfferAckMessage
  | FileChunkMessage
  | RelayTransferOfferMessage
  | FileCompleteMessage
  | ReplayTransferRequestMessage
  | ReplayTransferUnavailableMessage
  | TransferCancelMessage

export function isSignalingMessage(value: unknown): value is SignalingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}
