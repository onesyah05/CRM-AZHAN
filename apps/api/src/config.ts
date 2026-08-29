import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const workspaceEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(workspaceEnv)) loadEnvFile(workspaceEnv);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(9180),
  ERP_API_BASE_URL: z.string().url().default('http://localhost:9090'),
  SESSION_SECRET: z.string().min(16).default('development-only-change-me'),
  AUTH_ENCRYPTION_KEY: z.string().min(32).default('development-only-encryption-key!'),
  DATABASE_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5180'),
  TEST_FIXTURES: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  START_SERVER: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  WA_AUTH_DRIVER: z.enum(['filesystem', 'database']).default('filesystem'),
  WA_AUTH_PATH: z.string().default('.data/wa-auth'),
	MEDIA_STORAGE_PATH: z.string().default('.data/media'),
}).superRefine((value, context) => {
  const integrationMode = !value.TEST_FIXTURES;
  if (integrationMode && !value.DATABASE_URL) {
    context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL wajib diisi pada mode integrasi.' });
  }
  if (value.TEST_FIXTURES && value.NODE_ENV !== 'test') {
    context.addIssue({ code: 'custom', path: ['TEST_FIXTURES'], message: 'Fixture hanya boleh diaktifkan oleh pengujian.' });
  }
  if (value.NODE_ENV === 'production' && value.SESSION_SECRET === 'development-only-change-me') {
    context.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'SESSION_SECRET production wajib diganti.' });
  }
	if (value.NODE_ENV === 'production' && value.AUTH_ENCRYPTION_KEY === 'development-only-encryption-key!') {
	  context.addIssue({ code: 'custom', path: ['AUTH_ENCRYPTION_KEY'], message: 'AUTH_ENCRYPTION_KEY production wajib diganti.' });
	}
	if (value.NODE_ENV === 'production' && value.WA_AUTH_DRIVER !== 'database') {
	  context.addIssue({ code: 'custom', path: ['WA_AUTH_DRIVER'], message: 'WA_AUTH_DRIVER production wajib database.' });
	}
});

const parsed = envSchema.parse(process.env);

export const config = {
  nodeEnv: parsed.NODE_ENV,
  apiPort: parsed.API_PORT,
  erpApiBaseUrl: parsed.ERP_API_BASE_URL.replace(/\/$/, ''),
  sessionSecret: parsed.SESSION_SECRET,
  sessionEncryptionKey: parsed.AUTH_ENCRYPTION_KEY,
  databaseUrl: parsed.DATABASE_URL,
  corsOrigins: parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
  testFixtures: parsed.TEST_FIXTURES,
  startServer: parsed.START_SERVER,
  waAuthDriver: parsed.WA_AUTH_DRIVER,
  waAuthPath: resolve(process.cwd(), parsed.WA_AUTH_PATH),
	mediaStoragePath: resolve(process.cwd(), parsed.MEDIA_STORAGE_PATH),
};
