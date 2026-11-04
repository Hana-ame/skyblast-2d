// net/RoomManager.ts —— 联机层：房间/匹配（骨架：内存房间）
export interface Room {
  id: string
  players: number[]
  max: number
}

export class RoomManager {
  private rooms = new Map<string, Room>()

  create(id: string, max: number): Room {
    const room: Room = { id, players: [], max }
    this.rooms.set(id, room)
    return room
  }

  join(id: string, playerId: number): Room | null {
    const room = this.rooms.get(id)
    if (!room || room.players.length >= room.max) return null
    if (!room.players.includes(playerId)) room.players.push(playerId)
    return room
  }

  leave(id: string, playerId: number): void {
    const room = this.rooms.get(id)
    if (!room) return
    room.players = room.players.filter((p) => p !== playerId)
    if (room.players.length === 0) this.rooms.delete(id)
  }

  list(): Room[] {
    return [...this.rooms.values()]
  }
}
