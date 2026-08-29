export { createDatabasePool, ensureDatabaseExists, parseDatabaseUrl } from './pool.js';
export { seedDefaultStages, defaultStageSeeds } from './defaults.js';
export { runMigrations } from './migrate.js';
export { DealConflictError, DistributionValidationError, MySqlCrmStore, VersionConflictError } from './store.js';
export type { ErpDealResult, PreparedDeal } from './store.js';
export type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
