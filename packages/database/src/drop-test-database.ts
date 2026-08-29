import { createConnection } from 'mysql2/promise';
import { parseDatabaseUrl } from './pool.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL wajib diisi.');
const target = parseDatabaseUrl(databaseUrl);
if (!/^azhan_crm_test_[a-z0-9_]+$/.test(target.database)) {
  throw new Error('Hanya database berprefix azhan_crm_test_ yang boleh dihapus.');
}
const connection = await createConnection({
  host: target.host,
  port: target.port,
  user: target.user,
  password: target.password,
});
try {
  await connection.query(`DROP DATABASE IF EXISTS \`${target.database}\``);
  process.stdout.write(`Database test dihapus: ${target.database}\n`);
} finally {
  await connection.end();
}
