import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { Pool, RowDataPacket } from 'mysql2/promise';

interface StoredAuthState {
  creds: AuthenticationCreds;
  keys: Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>>;
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function encrypt(value: StoredAuthState, secret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value, BufferJSON.replacer));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(value: Buffer, secret: string): StoredAuthState {
  if (value[0] !== 1 || value.length < 30) throw new Error('Format auth state WhatsApp tidak valid.');
  const iv = value.subarray(1, 13);
  const tag = value.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(value.subarray(29)), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext, BufferJSON.reviver) as StoredAuthState;
}

export async function useDatabaseAuthState(pool: Pool, brandId: number, secret: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const [rows] = await pool.execute<(RowDataPacket & { encrypted_auth_state: Buffer | null })[]>(
    'SELECT encrypted_auth_state FROM crm_whatsapp_sessions WHERE brand_id=? LIMIT 1',
    [brandId],
  );
  const stored = rows[0]?.encrypted_auth_state
    ? decrypt(rows[0].encrypted_auth_state, secret)
    : { creds: initAuthCreds(), keys: {} };
  let writeChain = Promise.resolve();

  const persist = () => {
    writeChain = writeChain.then(async () => {
      const encrypted = encrypt(stored, secret);
      await pool.execute(
        `INSERT INTO crm_whatsapp_sessions (brand_id,encrypted_auth_state,connection_status)
         VALUES (?,?,'disconnected')
         ON DUPLICATE KEY UPDATE encrypted_auth_state=VALUES(encrypted_auth_state)`,
        [brandId, encrypted],
      );
    });
    return writeChain;
  };

  const state: AuthenticationState = {
    creds: stored.creds,
    keys: {
      async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        const category = (stored.keys[type] ?? {}) as Record<string, unknown>;
        for (const id of ids) {
          let value = category[id] as SignalDataTypeMap[T] | undefined;
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value) as unknown as SignalDataTypeMap[T];
          }
          if (value) result[id] = value;
        }
        return result;
      },
      async set(data: SignalDataSet) {
        for (const type of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          const category = (stored.keys[type] ?? {}) as Record<string, unknown>;
          const updates = data[type] as Record<string, unknown | null> | undefined;
          for (const [id, value] of Object.entries(updates ?? {})) {
            if (value == null) delete category[id];
            else category[id] = value;
          }
          stored.keys[type] = category;
        }
        await persist();
      },
    },
  };
  return { state, saveCreds: persist };
}
