import { describe, expect, it } from 'vitest';
import { messageDayKey, messageDayLabel } from './ConversationsPage';

describe('label tanggal percakapan', () => {
  it('menggunakan zona waktu Jakarta untuk pergantian hari', () => {
    expect(messageDayKey('2026-08-30T17:30:00.000Z')).toBe('2026-08-31');
  });

  it('hanya menampilkan Hari ini dan Kemarin pada tanggal yang tepat', () => {
    const now = new Date('2026-08-31T12:00:00.000Z');
    expect(messageDayLabel('2026-08-31T05:00:00.000Z', now)).toBe('Hari ini');
    expect(messageDayLabel('2026-08-30T05:00:00.000Z', now)).toBe('Kemarin');
    expect(messageDayLabel('2026-06-13T05:00:00.000Z', now)).toContain('13 Juni 2026');
  });
});
