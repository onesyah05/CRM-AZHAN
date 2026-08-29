import { createConnection, createPool, type Pool } from 'mysql2/promise';

export interface DatabaseTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDatabaseUrl(databaseUrl: string): DatabaseTarget {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== 'mysql:') throw new Error('DATABASE_URL harus menggunakan protokol mysql://.');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('Nama database pada DATABASE_URL tidak valid.');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

export function createDatabasePool(databaseUrl: string): Pool {
  const target = parseDatabaseUrl(databaseUrl);
  return createPool({
    ...target,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    decimalNumbers: true,
    dateStrings: true,
    timezone: 'Z',
  });
}

export async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const target = parseDatabaseUrl(databaseUrl);
  const connection = await createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${target.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
}
