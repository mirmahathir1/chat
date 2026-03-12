export interface RelayRoomEventMessage {
  type: string
  [key: string]: unknown
}

export interface CreateRelayRoomEventRequest {
  message: RelayRoomEventMessage
  senderPeerId: string
  targetPeerId?: string | null
}

export interface RelayRoomEventRecord {
  createdAt: string
  id: number
  message: RelayRoomEventMessage
  roomId: string
  senderPeerId: string
  targetPeerId: string | null
}
