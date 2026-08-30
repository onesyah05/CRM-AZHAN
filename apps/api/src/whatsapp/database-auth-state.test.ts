import { describe, expect, it, vi } from 'vitest';
import type { Pool } from '@azhan-crm/database';
import { clearLoggedOutDatabaseAuthState, useDatabaseAuthState } from './database-auth-state.js';

describe('database WhatsApp auth state', () => {
  it('mengantre pembersihan setelah penyimpanan kredensial selesai', async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('SELECT')) return [[]];
      return [{ affectedRows: 1 }];
    });
    const pool = { execute } as unknown as Pool;
    const auth = await useDatabaseAuthState(pool, 1, 'test-secret-at-least-32-characters');

    await auth.saveCreds();
    await auth.clear();

    expect(statements.at(-2)).toContain('encrypted_auth_state');
    expect(statements.at(-1)).toContain('SET encrypted_auth_state=NULL');
  });

  it('membersihkan auth lama hanya untuk sesi berstatus logged_out', async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1 }]);
    const cleared = await clearLoggedOutDatabaseAuthState({ execute } as unknown as Pool, 7);

    expect(cleared).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("connection_status='logged_out'"), [7]);
  });
});
