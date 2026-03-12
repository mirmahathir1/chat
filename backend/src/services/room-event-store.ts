import type {
  CreateRelayRoomEventRequest,
  RelayRoomEventRecord,
} from '../types/room-event.js'

interface RoomEventStoreConfig {
  maxEventsPerRoom: number
}

interface StoredRoomEvents {
  events: RelayRoomEventRecord[]
  nextEventId: number
}

export interface RelayRoomEventStoreStats {
  roomsWithEvents: number
  storedEvents: number
}

export class RelayRoomEventStore {
  private readonly rooms = new Map<string, StoredRoomEvents>()

  constructor(private readonly config: RoomEventStoreConfig) {}

  publish(roomId: string, input: CreateRelayRoomEventRequest) {
    const room = this.getOrCreateRoom(roomId)
    const event: RelayRoomEventRecord = {
      createdAt: new Date().toISOString(),
      id: room.nextEventId,
      message: input.message,
      roomId,
      senderPeerId: input.senderPeerId,
      targetPeerId: input.targetPeerId ?? null,
    }

    room.nextEventId += 1
    room.events.push(event)

    if (room.events.length > this.config.maxEventsPerRoom) {
      room.events.splice(0, room.events.length - this.config.maxEventsPerRoom)
    }

    return event
  }

  getLatestEventId(roomId: string) {
    const room = this.rooms.get(roomId)

    if (!room) {
      return 0
    }

    return Math.max(room.nextEventId - 1, 0)
  }

  getEventsAfter(roomId: string, peerId: string, afterEventId: number) {
    const room = this.rooms.get(roomId)

    if (!room) {
      return {
        events: [],
        latestEventId: 0,
      }
    }

    return {
      events: room.events.filter(
        (event) =>
          event.id > afterEventId &&
          event.senderPeerId !== peerId &&
          (event.targetPeerId === null || event.targetPeerId === peerId)
      ),
      latestEventId: this.getLatestEventId(roomId),
    }
  }

  getStats(): RelayRoomEventStoreStats {
    let storedEvents = 0

    for (const room of this.rooms.values()) {
      storedEvents += room.events.length
    }

    return {
      roomsWithEvents: this.rooms.size,
      storedEvents,
    }
  }

  private getOrCreateRoom(roomId: string) {
    const existingRoom = this.rooms.get(roomId)

    if (existingRoom) {
      return existingRoom
    }

    const nextRoom: StoredRoomEvents = {
      events: [],
      nextEventId: 1,
    }

    this.rooms.set(roomId, nextRoom)

    return nextRoom
  }
}
