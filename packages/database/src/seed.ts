import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabasePool } from './pool.js';
import { seedDefaultStages } from './defaults.js';
import { loadWorkspaceEnv } from './env.js';

export function readBrandIds(args: string[]): number[] {
  const values = args.flatMap((arg, index) => {
    if (arg.startsWith('--brand-id=')) return [arg.slice('--brand-id='.length)];
    if (arg === '--brand-id' && args[index + 1]) return [args[index + 1]!];
    return [];
  });
  const ids = [...new Set(values.map(Number))];
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Gunakan --brand-id=<id> dengan integer positif. Opsi boleh diulang.');
  }
  return ids;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  loadWorkspaceEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL wajib diisi untuk menjalankan seed CRM.');
  const pool = createDatabasePool(databaseUrl);
  try {
    const ids = readBrandIds(process.argv.slice(2));
    for (const id of ids) await seedDefaultStages(pool, id);
    process.stdout.write(`Stage default tersedia untuk brand: ${ids.join(', ')}\n`);
  } finally {
    await pool.end();
  }
}
