import { describe, expect, it } from 'vitest';
import { selectNextRotationMember, type RotationMember } from './distribution.js';

describe('selectNextRotationMember', () => {
  it('mengikuti giliran dan berhenti memakai CS setelah kuotanya habis', () => {
    const members: RotationMember[] = [
      { userId: 1, quota: 10, used: 0 },
      { userId: 2, quota: 40, used: 0 },
      { userId: 3, quota: 30, used: 0 },
      { userId: 4, quota: 20, used: 0 },
    ];
    const sequence: number[] = [];
    let cursor = 0;
    for (let lead = 0; lead < 100; lead += 1) {
      const selected = selectNextRotationMember(members, cursor);
      expect(selected).not.toBeNull();
      sequence.push(selected!.member.userId);
      selected!.member.used += 1;
      cursor = selected!.nextCursor;
    }

    expect(sequence.slice(0, 6)).toEqual([1, 2, 3, 4, 1, 2]);
    expect(members.map((member) => member.used)).toEqual([10, 40, 30, 20]);
    expect(selectNextRotationMember(members, cursor)).toBeNull();
  });

  it('melewati member yang kuotanya sudah habis', () => {
    const members = [
      { userId: 1, quota: 1, used: 1 },
      { userId: 2, quota: 3, used: 1 },
    ];
    expect(selectNextRotationMember(members, 0)?.member.userId).toBe(2);
  });
});
