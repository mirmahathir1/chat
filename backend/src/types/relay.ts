export interface RelayFileDescriptor {
  id: string
  name: string
  size: number
  type: string | null
}

export interface RelayFileDeleteRequest {
  pathname: string
}

export interface RelayTransferCancelRequest {
  pathnames?: string[]
  peerId?: string
  reason?: string
}
