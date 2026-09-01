import { describe, expect, it } from 'vitest';
import { parseContactImport } from './ContactsPage';

describe('parseContactImport', () => {
  it('membaca format nama|nomorhp dan mengabaikan baris kosong', () => {
    expect(parseContactImport('Ahmad Fauzi|081234567890\n\nSiti Aminah|6281234567890')).toEqual({
      contacts: [
        { name: 'Ahmad Fauzi', phone: '081234567890' },
        { name: 'Siti Aminah', phone: '6281234567890' },
      ],
      errors: [],
    });
  });

  it('menandai nomor tanpa nama dan pemisah berlebih sebagai kesalahan', () => {
    expect(parseContactImport('|081234567890\nBudi|0812|catatan')).toEqual({
      contacts: [],
      errors: [
        'Baris 1: gunakan format nama|nomorhp.',
        'Baris 2: gunakan format nama|nomorhp.',
      ],
    });
  });
});
