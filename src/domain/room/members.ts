import type { PeerIdentity } from '@/types/chat'

export function upsertMember(
  members: PeerIdentity[],
  member: PeerIdentity
): PeerIdentity[] {
  const existingIndex = members.findIndex(
    (currentMember) => currentMember.id === member.id
  )

  if (existingIndex === -1) {
    return [...members, member]
  }

  return members.map((currentMember, index) =>
    index === existingIndex ? { ...currentMember, ...member } : currentMember
  )
}

export function removeMember(members: PeerIdentity[], peerId: string) {
  return members.filter((member) => member.id !== peerId)
}

export function updateMemberConnectionState(
  members: PeerIdentity[],
  peerId: string,
  connectionState: PeerIdentity['connectionState']
) {
  const member = members.find((currentMember) => currentMember.id === peerId)

  if (!member) {
    return members
  }

  return upsertMember(members, {
    ...member,
    connectionState,
  })
}
