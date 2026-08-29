export interface RotationMember {
  userId: number;
  quota: number;
  used: number;
}

export interface RotationSelection {
  member: RotationMember;
  nextCursor: number;
}

export function selectNextRotationMember(members: RotationMember[], cursor: number): RotationSelection | null {
  if (!members.length) return null;
  const start = ((cursor % members.length) + members.length) % members.length;
  for (let offset = 0; offset < members.length; offset += 1) {
    const index = (start + offset) % members.length;
    const member = members[index];
    if (member && member.quota > member.used) {
      return { member, nextCursor: (index + 1) % members.length };
    }
  }
  return null;
}
