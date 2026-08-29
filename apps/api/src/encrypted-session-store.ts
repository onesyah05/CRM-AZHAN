import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import session, { type SessionData } from 'express-session';
import type { Pool, RowDataPacket } from 'mysql2/promise';

interface SessionRow extends RowDataPacket {
  encrypted_payload: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

type StoreCallback = (error?: unknown) => void;
type GetCallback = (error: unknown, session?: SessionData | null) => void;

export class EncryptedMysqlSessionStore extends session.Store {
  private readonly key: Buffer;

  constructor(private readonly pool: Pool, encryptionKey: string) {
    super();
    this.key = createHash('sha256').update(encryptionKey, 'utf8').digest();
  }

  get(sessionId: string, callback: GetCallback): void {
    void this.pool.execute<SessionRow[]>(
      `SELECT encrypted_payload, iv, auth_tag
         FROM crm_http_sessions WHERE session_id=? AND expires_at > UTC_TIMESTAMP(3)`,
      [sessionId],
    ).then(([rows]) => {
      const row = rows[0];
      if (!row) return callback(null, null);
      const decipher = createDecipheriv('aes-256-gcm', this.key, row.iv);
      decipher.setAuthTag(row.auth_tag);
      const payload = Buffer.concat([decipher.update(row.encrypted_payload), decipher.final()]).toString('utf8');
      callback(null, JSON.parse(payload) as SessionData);
    }).catch((error: unknown) => callback(error));
  }

  set(sessionId: string, value: SessionData, callback?: StoreCallback): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + (value.cookie.maxAge ?? 8 * 60 * 60 * 1000));
    void this.pool.execute(
      `INSERT INTO crm_http_sessions (session_id, encrypted_payload, iv, auth_tag, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE encrypted_payload=VALUES(encrypted_payload), iv=VALUES(iv),
         auth_tag=VALUES(auth_tag), expires_at=VALUES(expires_at)`,
      [sessionId, encrypted, iv, authTag, expiresAt],
    ).then(() => callback?.()).catch((error: unknown) => callback?.(error));
  }

  destroy(sessionId: string, callback?: StoreCallback): void {
    void this.pool.execute('DELETE FROM crm_http_sessions WHERE session_id=?', [sessionId])
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  touch(sessionId: string, value: SessionData, callback?: StoreCallback): void {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + (value.cookie.maxAge ?? 8 * 60 * 60 * 1000));
    void this.pool.execute('UPDATE crm_http_sessions SET expires_at=? WHERE session_id=?', [expiresAt, sessionId])
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }
}
