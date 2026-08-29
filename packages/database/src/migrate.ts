import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { ensureDatabaseExists, parseDatabaseUrl } from './pool.js';
import { loadWorkspaceEnv } from './env.js';

interface MigrationRow extends RowDataPacket {
  filename: string;
}

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  await ensureDatabaseExists(databaseUrl);
  const target = parseDatabaseUrl(databaseUrl);
  const connection = await createConnection({ ...target, multipleStatements: true, timezone: 'Z' });
  const appliedNow: string[] = [];
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS crm_schema_migrations (
        filename VARCHAR(255) NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [rows] = await connection.query<MigrationRow[]>('SELECT filename FROM crm_schema_migrations');
    const applied = new Set(rows.map((row) => row.filename));
    const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
    const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    for (const filename of files) {
      if (applied.has(filename)) continue;
      const sql = await readFile(resolve(migrationsDir, filename), 'utf8');
      await connection.query(sql);
      await connection.execute('INSERT INTO crm_schema_migrations (filename) VALUES (?)', [filename]);
      appliedNow.push(filename);
    }
    return appliedNow;
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  loadWorkspaceEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL wajib diisi untuk menjalankan migration CRM.');
  const applied = await runMigrations(databaseUrl);
  process.stdout.write(applied.length ? `Migration diterapkan: ${applied.join(', ')}\n` : 'Schema CRM sudah terbaru.\n');
}
