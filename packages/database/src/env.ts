import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

export function loadWorkspaceEnv(): void {
  const candidates = [
    process.env.CRM_ENV_FILE,
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ].filter((value): value is string => Boolean(value));
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file) loadEnvFile(file);
}
