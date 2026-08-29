import type { Pool, PoolConnection } from 'mysql2/promise';

export const defaultStageSeeds = [
  ['new', 'Baru', '#3478F6', 1, 'open'],
  ['contacted', 'Dihubungi', '#64748B', 2, 'open'],
  ['follow_up', 'Follow Up', '#D97706', 3, 'open'],
  ['qualified', 'Qualified', '#7C3AED', 4, 'open'],
  ['negotiation', 'Negosiasi', '#DB2777', 5, 'open'],
  ['deal', 'Deal', '#168A55', 6, 'won'],
  ['lost', 'Lost', '#C9362B', 7, 'lost'],
] as const;

export async function seedDefaultStages(
  executor: Pool | PoolConnection,
  brandId: number,
): Promise<void> {
  if (!Number.isInteger(brandId) || brandId <= 0) throw new Error('brandId seed harus berupa integer positif.');
  for (const [key, name, color, position, kind] of defaultStageSeeds) {
    await executor.execute(
      `INSERT INTO crm_stages (brand_id, stage_key, name, color, position, kind)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), color=VALUES(color), kind=VALUES(kind)`,
      [brandId, key, name, color, position, kind],
    );
  }
}
