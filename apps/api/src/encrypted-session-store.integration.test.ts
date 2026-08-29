import session, { type SessionData } from 'express-session';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabasePool, parseDatabaseUrl, runMigrations, type Pool } from '@azhan-crm/database';
import { EncryptedMysqlSessionStore } from './encrypted-session-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL wajib diisi untuk integration test session.');
const target = parseDatabaseUrl(databaseUrl);
if (!target.database.startsWith('azhan_crm_test_')) {
  throw new Error('Integration test hanya boleh memakai database berprefix azhan_crm_test_.');
}

let pool: Pool;
let store: EncryptedMysqlSessionStore;

beforeAll(async () => {
  await runMigrations(databaseUrl);
  pool = createDatabasePool(databaseUrl);
  store = new EncryptedMysqlSessionStore(pool, 'integration-test-encryption-key-32-bytes');
});

afterAll(async () => {
  await pool?.end();
  const connection = await createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
  });
  try {
    await connection.query(`DROP DATABASE \`${target.database}\``);
  } finally {
    await connection.end();
  }
});

const setSession = (id: string, value: SessionData) => new Promise<void>((resolve, reject) => {
  store.set(id, value, (error) => error ? reject(error) : resolve());
});

const getSession = (id: string) => new Promise<SessionData | null>((resolve, reject) => {
  store.get(id, (error, value) => error ? reject(error) : resolve(value ?? null));
});

const destroySession = (id: string) => new Promise<void>((resolve, reject) => {
  store.destroy(id, (error) => error ? reject(error) : resolve());
});

describe('EncryptedMysqlSessionStore', () => {
  it('menyimpan token terenkripsi dan dapat memulihkan session', async () => {
    const value = {
      cookie: Object.assign(new session.Cookie(), { maxAge: 60_000 }),
      accessToken: 'access-token-sensitive',
      refreshToken: 'refresh-token-sensitive',
    } as SessionData;
    await setSession('session-fixed', value);

    const [rows] = await pool.execute<(RowDataPacket & { encrypted_payload: Buffer })[]>(
      'SELECT encrypted_payload FROM crm_http_sessions WHERE session_id=?',
      ['session-fixed'],
    );
    expect(rows[0]?.encrypted_payload.toString('utf8')).not.toContain('access-token-sensitive');
    expect((await getSession('session-fixed'))?.accessToken).toBe('access-token-sensitive');

    await destroySession('session-fixed');
    expect(await getSession('session-fixed')).toBeNull();
  });
});
