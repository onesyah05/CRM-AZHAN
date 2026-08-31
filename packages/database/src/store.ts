import { randomUUID } from 'node:crypto';
import type {
  Activity,
  Conversation,
  DashboardMetrics,
  DashboardPeriod,
  DealRequest,
  DealResult,
  Lead,
  Message,
  Stage,
  Tag,
  TeamMember,
  TeamPerformance,
} from '@azhan-crm/contracts';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { seedDefaultStages } from './defaults.js';
import { selectNextRotationMember } from './distribution.js';

interface LeadRow extends RowDataPacket {
  id: string;
  brand_id: number;
  contact_id: string;
  conversation_id: string | null;
  display_name: string;
  phone_e164: string;
  email: string | null;
  city: string | null;
  source: string | null;
  stage_key: string;
  assignee_erp_user_id: number | null;
  assignee_name: string | null;
  erp_schedule_id: number | null;
  schedule_name: string | null;
  departure_plan: string | null;
  room_type: Lead['roomType'];
  pax: number;
  estimated_value: number;
  next_follow_up_at: string | null;
  notes: string | null;
  deal_substatus: Lead['dealSubstatus'] | null;
  erp_jamaah_id: number | null;
  erp_booking_id: number | null;
  erp_payment_id: number | null;
  lost_reason: string | null;
  version: number;
  updated_at: string;
  created_at: string;
  unread_count: number | null;
  stage_age_days: number;
}

interface TagRow extends RowDataPacket {
  lead_id: string;
  id: number;
  name: string;
  color: string;
}

interface ConversationRow extends RowDataPacket {
  id: string;
  brand_id: number;
  lead_id: string;
  display_name: string;
  phone_e164: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  assignee_erp_user_id: number | null;
  assignee_name: string | null;
}

interface ConversationTransportRow extends RowDataPacket {
  whatsapp_jid: string;
}

interface TeamMemberRow extends RowDataPacket {
  brand_id: number;
  erp_user_id: number;
  email: string;
  display_name: string;
  allocation_percent: number;
  allocated_in_cycle: number;
  rotation_position: number;
  is_active: number | boolean;
}

interface DistributionStateRow extends RowDataPacket {
  cycle_number: number;
  assigned_in_cycle: number;
  cursor_position: number;
}

interface MessageRow extends RowDataPacket {
  id: string;
  conversation_id: string;
  whatsapp_message_id: string;
  direction: Message['direction'];
  message_type: Message['type'];
  body: string | null;
  status: Message['status'];
  sent_at: string;
	media_object_key?: string | null;
	media_mime_type?: string | null;
	media_file_name?: string | null;
}

export interface OutboundMessageJob {
  id: string;
  brandId: number;
  attempts: number;
  payload: {
    messageId: string;
    conversationId: string;
    phone: string;
    body: string;
	type?: Message['type'];
	mediaObjectKey?: string;
	mimeType?: string;
	fileName?: string;
  };
}

interface StageRow extends RowDataPacket {
  stage_key: string;
  name: string;
  color: string;
  position: number;
  kind: Stage['kind'];
}

interface IdRow extends RowDataPacket {
  id: number | string;
}

interface ActivityRow extends RowDataPacket {
  id: string;
  activity_type: Activity['type'];
  title: string;
  description: string | null;
  actor_name: string;
  occurred_at: string;
  lead_id: string;
}

const leadSelect = `
  SELECT LOWER(CONCAT(SUBSTRING(HEX(l.id),1,8),'-',SUBSTRING(HEX(l.id),9,4),'-',SUBSTRING(HEX(l.id),13,4),'-',SUBSTRING(HEX(l.id),17,4),'-',SUBSTRING(HEX(l.id),21,12))) AS id, l.brand_id, LOWER(CONCAT(SUBSTRING(HEX(l.contact_id),1,8),'-',SUBSTRING(HEX(l.contact_id),9,4),'-',SUBSTRING(HEX(l.contact_id),13,4),'-',SUBSTRING(HEX(l.contact_id),17,4),'-',SUBSTRING(HEX(l.contact_id),21,12))) AS contact_id,
         LOWER(CONCAT(SUBSTRING(HEX(cv.id),1,8),'-',SUBSTRING(HEX(cv.id),9,4),'-',SUBSTRING(HEX(cv.id),13,4),'-',SUBSTRING(HEX(cv.id),17,4),'-',SUBSTRING(HEX(cv.id),21,12))) AS conversation_id, c.display_name, c.phone_e164, c.email, c.city, c.source,
         s.stage_key, l.assignee_erp_user_id, l.assignee_name, l.erp_schedule_id, l.schedule_name, l.departure_plan,
         l.room_type, l.pax, l.estimated_value, l.next_follow_up_at, l.notes, l.deal_substatus,
         l.erp_jamaah_id, l.erp_booking_id, l.erp_payment_id, l.lost_reason, l.version, l.updated_at,l.created_at,
         COALESCE(cv.unread_count, 0) AS unread_count,
         GREATEST(DATEDIFF(UTC_TIMESTAMP(), l.updated_at), 0) AS stage_age_days
    FROM crm_leads l
    JOIN crm_contacts c ON c.id = l.contact_id AND c.brand_id = l.brand_id
    JOIN crm_stages s ON s.id = l.stage_id AND s.brand_id = l.brand_id
    LEFT JOIN crm_conversations cv ON cv.lead_id = l.id AND cv.brand_id = l.brand_id
`;

function toIso(value: string | null): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`).toISOString();
}

function toSqlDate(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function tagsByLead(rows: TagRow[]): Map<string, Tag[]> {
  const result = new Map<string, Tag[]>();
  for (const row of rows) {
    const list = result.get(row.lead_id) ?? [];
    list.push({ id: String(row.id), name: row.name, color: row.color });
    result.set(row.lead_id, list);
  }
  return result;
}

function mapLead(row: LeadRow, tags: Tag[]): Lead {
  return {
    id: row.id,
    brandId: row.brand_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id ?? '',
    name: row.display_name,
    phone: row.phone_e164,
    email: row.email ?? '',
    city: row.city ?? '',
    source: row.source ?? '',
    stageId: row.stage_key,
    assignee: row.assignee_name ?? 'Belum ditugaskan',
    ...(row.assignee_erp_user_id ? { assigneeUserId: row.assignee_erp_user_id } : {}),
    scheduleId: row.erp_schedule_id,
    scheduleName: row.schedule_name ?? '',
    departurePlan: row.departure_plan ?? '',
    roomType: row.room_type,
    pax: row.pax,
    estimatedValue: Number(row.estimated_value),
    nextFollowUp: toIso(row.next_follow_up_at),
    notes: row.notes ?? '',
    tags,
    unread: row.unread_count ?? 0,
    stageAgeDays: row.stage_age_days,
    ...(row.deal_substatus ? { dealSubstatus: row.deal_substatus } : {}),
    ...(row.erp_jamaah_id ? { erpJamaahId: row.erp_jamaah_id } : {}),
    ...(row.erp_booking_id ? { erpBookingId: row.erp_booking_id } : {}),
    ...(row.erp_payment_id ? { erpPaymentId: row.erp_payment_id } : {}),
    version: row.version,
    updatedAt: toIso(row.updated_at),
    createdAt: toIso(row.created_at),
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    type: row.message_type,
    body: row.body ?? '',
    sentAt: toIso(row.sent_at),
    status: row.status,
	...(row.media_object_key ? { mediaUrl: `/api/v1/messages/${row.id}/media` } : {}),
	...(row.media_mime_type ? { mimeType: row.media_mime_type } : {}),
	...(row.media_file_name ? { fileName: row.media_file_name } : {}),
  };
}

function mapTeamMember(row: TeamMemberRow): TeamMember {
  return {
    userId: Number(row.erp_user_id),
    brandId: Number(row.brand_id),
    email: row.email,
    displayName: row.display_name,
    allocationPercent: Number(row.allocation_percent),
    allocatedInCycle: Number(row.allocated_in_cycle),
    rotationPosition: Number(row.rotation_position),
    isActive: Boolean(row.is_active),
  };
}

export class VersionConflictError extends Error {
  constructor() {
    super('VERSION_CONFLICT');
  }
}

export class DealConflictError extends Error {
  constructor(public readonly code: 'DEAL_ALREADY_EXISTS' | 'IDEMPOTENCY_CONFLICT') {
    super(code);
  }
}

export class DistributionValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface ErpDealResult {
  status: 'completed';
  commitment_type: DealRequest['commitmentType'];
  deal_substatus: NonNullable<Lead['dealSubstatus']>;
  jamaah_id: number;
  booking_id: number;
  booking_code: string;
  booking_status: 'baru' | 'dp' | 'lunas';
  payment_id?: number;
  seat_hold_expires_at?: string;
}

export interface PreparedDeal {
  conversionId: string;
  lead: Lead;
  replay?: DealResult;
}

export class MySqlCrmStore {
  constructor(private readonly pool: Pool) {}

  async ensureBrand(brandId: number): Promise<void> {
    await seedDefaultStages(this.pool, brandId);
  }

  async syncTeamMembers(
    brandId: number,
    users: Array<{ userId: number; email: string; displayName: string; isActive: boolean }>,
  ): Promise<TeamMember[]> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [positionRows] = await connection.execute<(RowDataPacket & { max_position: number })[]>(
        'SELECT COALESCE(MAX(rotation_position),0) AS max_position FROM crm_team_members WHERE brand_id=? FOR UPDATE',
        [brandId],
      );
      let nextPosition = Number(positionRows[0]?.max_position ?? 0) + 1;
      for (const user of users) {
        await connection.execute(
          `INSERT INTO crm_team_members
             (brand_id,erp_user_id,email,display_name,rotation_position,is_active)
           VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             email=VALUES(email),
             display_name=VALUES(display_name),
             allocation_percent=IF(VALUES(is_active),allocation_percent,0),
             allocated_in_cycle=IF(VALUES(is_active),allocated_in_cycle,0),
             is_active=VALUES(is_active)`,
          [brandId, user.userId, user.email, user.displayName, nextPosition, user.isActive],
        );
        nextPosition += 1;
      }
      if (users.length) {
        const placeholders = users.map(() => '?').join(',');
        await connection.execute(
          `UPDATE crm_team_members SET is_active=FALSE,allocation_percent=0,allocated_in_cycle=0
            WHERE brand_id=? AND erp_user_id NOT IN (${placeholders})`,
          [brandId, ...users.map((user) => user.userId)],
        );
      } else {
        await connection.execute(
          'UPDATE crm_team_members SET is_active=FALSE,allocation_percent=0,allocated_in_cycle=0 WHERE brand_id=?',
          [brandId],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.listTeamMembers(brandId);
  }

  async listTeamMembers(brandId: number): Promise<TeamMember[]> {
    const [rows] = await this.pool.execute<TeamMemberRow[]>(
      `SELECT brand_id,erp_user_id,email,display_name,allocation_percent,allocated_in_cycle,
              rotation_position,is_active
         FROM crm_team_members WHERE brand_id=? ORDER BY rotation_position,erp_user_id`,
      [brandId],
    );
    return rows.map(mapTeamMember);
  }

  async setTeamDistribution(brandId: number, allocations: Array<{ userId: number; percent: number }>): Promise<TeamMember[]> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<TeamMemberRow[]>(
        `SELECT brand_id,erp_user_id,email,display_name,allocation_percent,allocated_in_cycle,
                rotation_position,is_active
           FROM crm_team_members WHERE brand_id=? AND is_active=TRUE ORDER BY rotation_position FOR UPDATE`,
        [brandId],
      );
      const allocationByUser = new Map(allocations.map((allocation) => [allocation.userId, allocation.percent]));
      if (!rows.length || rows.length !== allocationByUser.size) {
        throw new DistributionValidationError('Semua CS aktif wajib mendapat persentase.');
      }
      let total = 0;
      for (const row of rows) {
        const percent = allocationByUser.get(Number(row.erp_user_id));
        if (!Number.isInteger(percent) || !percent || percent < 1 || percent > 100) {
          throw new DistributionValidationError('Persentase setiap CS wajib bilangan bulat minimal 1%.');
        }
        total += percent;
      }
      if (total !== 100) throw new DistributionValidationError('Total pembagian lead wajib tepat 100%.');
      for (const row of rows) {
        const percent = allocationByUser.get(Number(row.erp_user_id));
        if (percent === undefined) throw new DistributionValidationError('Konfigurasi CS tidak lengkap.');
        await connection.execute(
          `UPDATE crm_team_members SET allocation_percent=?,allocated_in_cycle=0
            WHERE brand_id=? AND erp_user_id=?`,
          [percent, brandId, row.erp_user_id],
        );
      }
      await connection.execute(
        `INSERT INTO crm_distribution_state (brand_id,cycle_number,assigned_in_cycle,cursor_position)
         VALUES (?,1,0,0)
         ON DUPLICATE KEY UPDATE cycle_number=cycle_number+1,assigned_in_cycle=0,cursor_position=0`,
        [brandId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.listTeamMembers(brandId);
  }

  async teamPerformance(brandId: number, period: DashboardPeriod = 'month'): Promise<TeamPerformance[]> {
    const periodDays = period === 'today' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : null;
    const [rows] = await this.pool.execute<(TeamMemberRow & RowDataPacket & {
      assigned_leads: number; open_leads: number; deals: number; lost: number; pipeline_value: number;
    })[]>(
      `SELECT tm.brand_id,tm.erp_user_id,tm.email,tm.display_name,tm.allocation_percent,
              tm.allocated_in_cycle,tm.rotation_position,tm.is_active,
              COUNT(l.id) AS assigned_leads,
              COALESCE(SUM(s.kind='open'),0) AS open_leads,
              COALESCE(SUM(s.kind='won'),0) AS deals,
              COALESCE(SUM(s.kind='lost'),0) AS lost,
              COALESCE(SUM(CASE WHEN s.kind='open' THEN l.estimated_value ELSE 0 END),0) AS pipeline_value
         FROM crm_team_members tm
         LEFT JOIN crm_leads l ON l.brand_id=tm.brand_id AND l.assignee_erp_user_id=tm.erp_user_id
              AND l.deleted_at IS NULL ${periodDays ? 'AND l.updated_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)' : ''}
         LEFT JOIN crm_stages s ON s.id=l.stage_id AND s.brand_id=l.brand_id
        WHERE tm.brand_id=?
        GROUP BY tm.brand_id,tm.erp_user_id,tm.email,tm.display_name,tm.allocation_percent,
                 tm.allocated_in_cycle,tm.rotation_position,tm.is_active
        ORDER BY deals DESC,assigned_leads DESC,tm.rotation_position`,
      periodDays ? [periodDays, brandId] : [brandId],
    );
    return rows.map((row) => {
      const member = mapTeamMember(row);
      const deals = Number(row.deals);
      const lost = Number(row.lost);
      return {
        ...member,
        assignedLeads: Number(row.assigned_leads),
        openLeads: Number(row.open_leads),
        deals,
        lost,
        conversionRate: deals + lost ? Math.round((deals / (deals + lost)) * 100) : 0,
        pipelineValue: Number(row.pipeline_value),
      };
    });
  }

  private async nextLeadAssignee(connection: PoolConnection, brandId: number): Promise<{ userId: number; name: string } | null> {
    await connection.execute(
      `INSERT IGNORE INTO crm_distribution_state (brand_id,cycle_number,assigned_in_cycle,cursor_position)
       VALUES (?,1,0,0)`,
      [brandId],
    );
    const [stateRows] = await connection.execute<DistributionStateRow[]>(
      'SELECT cycle_number,assigned_in_cycle,cursor_position FROM crm_distribution_state WHERE brand_id=? FOR UPDATE',
      [brandId],
    );
    const state = stateRows[0];
    if (!state) return null;
    const [memberRows] = await connection.execute<TeamMemberRow[]>(
      `SELECT brand_id,erp_user_id,email,display_name,allocation_percent,allocated_in_cycle,
              rotation_position,is_active
         FROM crm_team_members
        WHERE brand_id=? AND is_active=TRUE AND allocation_percent>0
        ORDER BY rotation_position,erp_user_id FOR UPDATE`,
      [brandId],
    );
    const total = memberRows.reduce((sum, row) => sum + Number(row.allocation_percent), 0);
    if (!memberRows.length || total !== 100) return null;

    if (Number(state.assigned_in_cycle) >= 100) {
      await connection.execute('UPDATE crm_team_members SET allocated_in_cycle=0 WHERE brand_id=?', [brandId]);
      await connection.execute(
        `UPDATE crm_distribution_state SET cycle_number=cycle_number+1,assigned_in_cycle=0,cursor_position=0
          WHERE brand_id=?`,
        [brandId],
      );
      state.assigned_in_cycle = 0;
      state.cursor_position = 0;
      for (const member of memberRows) member.allocated_in_cycle = 0;
    }

    const selection = selectNextRotationMember(
      memberRows.map((row) => ({ userId: Number(row.erp_user_id), quota: Number(row.allocation_percent), used: Number(row.allocated_in_cycle) })),
      Number(state.cursor_position),
    );
    if (!selection) return null;
    const selectedRow = memberRows.find((row) => Number(row.erp_user_id) === selection.member.userId);
    if (!selectedRow) return null;
    await connection.execute(
      `UPDATE crm_team_members SET allocated_in_cycle=allocated_in_cycle+1
        WHERE brand_id=? AND erp_user_id=?`,
      [brandId, selection.member.userId],
    );
    await connection.execute(
      `UPDATE crm_distribution_state SET assigned_in_cycle=assigned_in_cycle+1,cursor_position=?
        WHERE brand_id=?`,
      [selection.nextCursor, brandId],
    );
    return { userId: selection.member.userId, name: selectedRow.display_name };
  }

  async listStages(brandId: number): Promise<Stage[]> {
    await this.ensureBrand(brandId);
    const [rows] = await this.pool.execute<StageRow[]>(
      `SELECT stage_key, name, color, position, kind
         FROM crm_stages WHERE brand_id=? ORDER BY position`,
      [brandId],
    );
    return rows.map((row) => ({ id: row.stage_key, name: row.name, color: row.color, position: row.position, kind: row.kind }));
  }

  private async loadTags(brandId: number): Promise<Map<string, Tag[]>> {
    const [rows] = await this.pool.execute<TagRow[]>(
      `SELECT LOWER(CONCAT(SUBSTRING(HEX(lt.lead_id),1,8),'-',SUBSTRING(HEX(lt.lead_id),9,4),'-',SUBSTRING(HEX(lt.lead_id),13,4),'-',SUBSTRING(HEX(lt.lead_id),17,4),'-',SUBSTRING(HEX(lt.lead_id),21,12))) AS lead_id, t.id, t.name, t.color
         FROM crm_lead_tags lt
         JOIN crm_tags t ON t.id=lt.tag_id AND t.brand_id=lt.brand_id
        WHERE lt.brand_id=? ORDER BY t.name`,
      [brandId],
    );
    return tagsByLead(rows);
  }

  async listLeads(brandId: number, assigneeUserId?: number): Promise<Lead[]> {
    await this.ensureBrand(brandId);
    const [rows] = await this.pool.execute<LeadRow[]>(
      `${leadSelect} WHERE l.brand_id=? AND l.deleted_at IS NULL ${assigneeUserId ? 'AND l.assignee_erp_user_id=?' : ''} ORDER BY l.updated_at DESC`,
      assigneeUserId ? [brandId, assigneeUserId] : [brandId],
    );
    const tags = await this.loadTags(brandId);
    return rows.map((row) => mapLead(row, tags.get(row.id) ?? []));
  }

  async getLead(brandId: number, leadId: string): Promise<Lead | null> {
    await this.ensureBrand(brandId);
    const [rows] = await this.pool.execute<LeadRow[]>(
      `${leadSelect} WHERE l.brand_id=? AND l.id=UNHEX(REPLACE(?, '-', '')) AND l.deleted_at IS NULL LIMIT 1`,
      [brandId, leadId],
    );
    const row = rows[0];
    if (!row) return null;
    const tags = await this.loadTags(brandId);
    return mapLead(row, tags.get(row.id) ?? []);
  }

  async updateLead(
    brandId: number,
    leadId: string,
    updates: Partial<Lead>,
    expectedVersion?: number,
    actor = 'Admin',
    correlationId?: string,
  ): Promise<Lead | null> {
    const current = await this.getLead(brandId, leadId);
    if (!current) return null;
    const version = expectedVersion ?? current.version;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE crm_contacts
            SET display_name=?, email=NULLIF(?, ''), city=NULLIF(?, ''), source=NULLIF(?, '')
          WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
        [updates.name ?? current.name, updates.email ?? current.email, updates.city ?? current.city, updates.source ?? current.source, brandId, current.contactId],
      );
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE crm_leads SET assignee_name=?, erp_schedule_id=?, schedule_name=?, departure_plan=?,
             room_type=?, pax=?, estimated_value=?, next_follow_up_at=?, notes=?, version=version+1
          WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) AND version=? AND deleted_at IS NULL`,
        [
          updates.assignee ?? current.assignee,
          updates.scheduleId === undefined ? current.scheduleId : updates.scheduleId,
          updates.scheduleName ?? current.scheduleName,
          updates.departurePlan ?? current.departurePlan,
          updates.roomType ?? current.roomType,
          updates.pax ?? current.pax,
          updates.estimatedValue ?? current.estimatedValue,
          toSqlDate(updates.nextFollowUp ?? current.nextFollowUp),
          updates.notes ?? current.notes,
          brandId,
          leadId,
          version,
        ],
      );
      if (result.affectedRows !== 1) throw new VersionConflictError();
      await this.insertAudit(connection, brandId, actor, 'lead', leadId, 'lead.updated', current, updates, correlationId);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getLead(brandId, leadId);
  }

  async moveLead(
    brandId: number,
    leadId: string,
    stageId: string,
    actor: string,
    lostReason?: string,
    correlationId?: string,
  ): Promise<Lead | null> {
    if (stageId === 'deal') throw new Error('DEAL_FLOW_REQUIRED');
    await this.ensureBrand(brandId);
    const current = await this.getLead(brandId, leadId);
    if (!current) return null;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [stageRows] = await connection.execute<(IdRow & { name: string })[]>(
        'SELECT id, name FROM crm_stages WHERE brand_id=? AND stage_key=? LIMIT 1',
        [brandId, stageId],
      );
      const stage = stageRows[0];
      if (!stage) throw new Error('STAGE_NOT_FOUND');
      await connection.execute(
        `UPDATE crm_leads SET stage_id=?, lost_reason=?, version=version+1
          WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) AND deleted_at IS NULL`,
        [stage.id, stageId === 'lost' ? lostReason ?? null : null, brandId, leadId],
      );
      await connection.execute(
        `INSERT INTO crm_activities
           (id, brand_id, lead_id, activity_type, title, description, actor_name, occurred_at)
         VALUES (UNHEX(REPLACE(?, '-', '')), ?, UNHEX(REPLACE(?, '-', '')), 'stage', ?, ?, ?, UTC_TIMESTAMP(3))`,
        [randomUUID(), brandId, leadId, `${current.name} pindah ke ${stage.name}`, stageId === 'lost' ? lostReason ?? '' : 'Tahap pipeline diperbarui.', actor],
      );
      await this.insertAudit(connection, brandId, actor, 'lead', leadId, 'lead.stage.changed', { stageId: current.stageId }, { stageId, lostReason }, correlationId);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getLead(brandId, leadId);
  }

  async listConversations(brandId: number, assigneeUserId?: number): Promise<Conversation[]> {
    const [rows] = await this.pool.execute<ConversationRow[]>(
      `SELECT LOWER(CONCAT(SUBSTRING(HEX(cv.id),1,8),'-',SUBSTRING(HEX(cv.id),9,4),'-',SUBSTRING(HEX(cv.id),13,4),'-',SUBSTRING(HEX(cv.id),17,4),'-',SUBSTRING(HEX(cv.id),21,12))) AS id, cv.brand_id, LOWER(CONCAT(SUBSTRING(HEX(cv.lead_id),1,8),'-',SUBSTRING(HEX(cv.lead_id),9,4),'-',SUBSTRING(HEX(cv.lead_id),13,4),'-',SUBSTRING(HEX(cv.lead_id),17,4),'-',SUBSTRING(HEX(cv.lead_id),21,12))) AS lead_id,
              c.display_name, c.phone_e164, cv.last_message_preview, cv.last_message_at,
              cv.unread_count, l.assignee_erp_user_id, l.assignee_name
         FROM crm_conversations cv
         JOIN crm_contacts c ON c.id=cv.contact_id AND c.brand_id=cv.brand_id
         JOIN crm_leads l ON l.id=cv.lead_id AND l.brand_id=cv.brand_id
        WHERE cv.brand_id=? AND l.deleted_at IS NULL ${assigneeUserId ? 'AND l.assignee_erp_user_id=?' : ''}
        ORDER BY cv.last_message_at DESC`,
      assigneeUserId ? [brandId, assigneeUserId] : [brandId],
    );
    const tags = await this.loadTags(brandId);
    return rows.map((row) => ({
      id: row.id,
      brandId: row.brand_id,
      leadId: row.lead_id,
      name: row.display_name,
      phone: row.phone_e164,
      avatarSeed: row.display_name,
      lastMessage: row.last_message_preview ?? '',
      lastMessageAt: toIso(row.last_message_at),
      unread: row.unread_count,
      assignee: row.assignee_name ?? 'Belum ditugaskan',
      ...(row.assignee_erp_user_id ? { assigneeUserId: row.assignee_erp_user_id } : {}),
      tags: tags.get(row.lead_id) ?? [],
      online: false,
      presence: 'offline',
    }));
  }

  async getConversationTransportContext(brandId: number, conversationId: string): Promise<{ phone: string; messageIds: string[] } | null> {
    const [conversations] = await this.pool.execute<ConversationTransportRow[]>(
      `SELECT whatsapp_jid FROM crm_conversations WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) LIMIT 1`,
      [brandId, conversationId],
    );
    const jid = conversations[0]?.whatsapp_jid;
    if (!jid) return null;
    const [messages] = await this.pool.execute<(RowDataPacket & { whatsapp_message_id: string })[]>(
      `SELECT whatsapp_message_id FROM crm_messages
        WHERE brand_id=? AND conversation_id=UNHEX(REPLACE(?, '-', '')) AND direction='inbound'
          AND status<>'read' AND whatsapp_message_id IS NOT NULL
        ORDER BY sent_at DESC LIMIT 500`,
      [brandId, conversationId],
    );
    return {
      phone: jid.split('@')[0] ?? '',
      messageIds: messages.map((message) => message.whatsapp_message_id),
    };
  }

  async markInboundMessagesRead(brandId: number, conversationId: string, messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    const placeholders = messageIds.map(() => '?').join(',');
    await this.pool.execute(
      `UPDATE crm_messages SET status='read'
        WHERE brand_id=? AND conversation_id=UNHEX(REPLACE(?, '-', '')) AND direction='inbound'
          AND whatsapp_message_id IN (${placeholders})`,
      [brandId, conversationId, ...messageIds],
    );
  }

  async listMessages(brandId: number, conversationId: string): Promise<Message[] | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [conversationRows] = await connection.execute<(IdRow & { lead_id: string })[]>(
        `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id, LOWER(CONCAT(SUBSTRING(HEX(lead_id),1,8),'-',SUBSTRING(HEX(lead_id),9,4),'-',SUBSTRING(HEX(lead_id),13,4),'-',SUBSTRING(HEX(lead_id),17,4),'-',SUBSTRING(HEX(lead_id),21,12))) AS lead_id
           FROM crm_conversations WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) FOR UPDATE`,
        [brandId, conversationId],
      );
      if (!conversationRows[0]) {
        await connection.rollback();
        return null;
      }
      await connection.execute(`UPDATE crm_conversations SET unread_count=0 WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`, [brandId, conversationId]);
      const [rows] = await connection.execute<MessageRow[]>(
        `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id, LOWER(CONCAT(SUBSTRING(HEX(conversation_id),1,8),'-',SUBSTRING(HEX(conversation_id),9,4),'-',SUBSTRING(HEX(conversation_id),13,4),'-',SUBSTRING(HEX(conversation_id),17,4),'-',SUBSTRING(HEX(conversation_id),21,12))) AS conversation_id,
				whatsapp_message_id,direction,message_type,body,status,sent_at,
				media_object_key,media_mime_type,media_file_name
           FROM crm_messages WHERE brand_id=? AND conversation_id=UNHEX(REPLACE(?, '-', '')) ORDER BY sent_at`,
        [brandId, conversationId],
      );
      await connection.commit();
      return rows.map(mapMessage);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async messageBelongsToAssignee(brandId: number, messageId: string, assigneeUserId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<IdRow[]>(
      `SELECT 1 AS id FROM crm_messages m
       JOIN crm_conversations cv ON cv.id=m.conversation_id AND cv.brand_id=m.brand_id
       JOIN crm_leads l ON l.id=cv.lead_id AND l.brand_id=cv.brand_id
       WHERE m.brand_id=? AND m.id=UNHEX(REPLACE(?, '-', '')) AND l.assignee_erp_user_id=? LIMIT 1`,
      [brandId, messageId, assigneeUserId],
    );
    return Boolean(rows[0]);
  }

  async addMessage(
    brandId: number,
    conversationId: string,
    body: string,
    whatsappMessageId = `local-${randomUUID()}`,
    status: Message['status'] = 'sent',
  ): Promise<Message | null> {
    const localId = randomUUID();
    const sentAt = new Date().toISOString();
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO crm_messages
         (id, brand_id, conversation_id, whatsapp_message_id, direction, message_type, body, status, sent_at)
       SELECT UNHEX(REPLACE(?, '-', '')), ?, id, ?, 'outbound', 'text', ?, ?, ?
         FROM crm_conversations WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
      [localId, brandId, whatsappMessageId, body, status, sentAt.slice(0, 23).replace('T', ' '), brandId, conversationId],
    );
    if (!result.affectedRows) return null;
    await this.pool.execute(
      `UPDATE crm_conversations SET last_message_preview=?, last_message_at=?
        WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
      [body, sentAt.slice(0, 23).replace('T', ' '), brandId, conversationId],
    );
    return { id: localId, conversationId, direction: 'outbound', type: 'text', body, sentAt, status };
  }

  async enqueueOutboundMessage(brandId: number, conversationId: string, body: string): Promise<Message | null> {
    const connection = await this.pool.getConnection();
    const messageId = randomUUID();
    const jobId = randomUUID();
    const sentAt = new Date().toISOString();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<(RowDataPacket & { phone_e164: string })[]>(
        `SELECT c.phone_e164 FROM crm_conversations cv JOIN crm_contacts c ON c.id=cv.contact_id
          WHERE cv.brand_id=? AND cv.id=UNHEX(REPLACE(?, '-', '')) FOR UPDATE`,
        [brandId, conversationId],
      );
      const phone = rows[0]?.phone_e164;
      if (!phone) {
        await connection.rollback();
        return null;
      }
      await connection.execute(
        `INSERT INTO crm_messages
           (id,brand_id,conversation_id,whatsapp_message_id,direction,message_type,body,status,sent_at)
         VALUES (UNHEX(REPLACE(?, '-', '')),?,UNHEX(REPLACE(?, '-', '')),?,'outbound','text',?,'pending',?)`,
        [messageId, brandId, conversationId, messageId, body, sentAt.slice(0, 23).replace('T', ' ')],
      );
      await connection.execute(
        `INSERT INTO crm_outbox_jobs
           (id,brand_id,job_type,dedupe_key,payload,status,available_at)
         VALUES (UNHEX(REPLACE(?, '-', '')),?,'whatsapp.send',?,?, 'pending',UTC_TIMESTAMP(3))`,
        [jobId, brandId, messageId, JSON.stringify({ messageId, conversationId, phone, body })],
      );
      await connection.execute(
        `UPDATE crm_conversations SET last_message_preview=?,last_message_at=? WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
        [body, sentAt.slice(0, 23).replace('T', ' '), brandId, conversationId],
      );
      await connection.commit();
      return { id: messageId, conversationId, direction: 'outbound', type: 'text', body, sentAt, status: 'pending' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async enqueueOutboundMedia(
    brandId: number,
    conversationId: string,
    input: { type: Exclude<Message['type'], 'text'>; body: string; mediaObjectKey: string; mimeType: string; fileName: string },
  ): Promise<Message | null> {
    const connection = await this.pool.getConnection();
    const messageId = randomUUID();
    const sentAt = new Date().toISOString();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<(RowDataPacket & { phone_e164: string })[]>(
        `SELECT c.phone_e164 FROM crm_conversations cv JOIN crm_contacts c ON c.id=cv.contact_id
          WHERE cv.brand_id=? AND cv.id=UNHEX(REPLACE(?, '-', '')) FOR UPDATE`,
        [brandId, conversationId],
      );
      const phone = rows[0]?.phone_e164;
      if (!phone) {
        await connection.rollback();
        return null;
      }
      await connection.execute(
        `INSERT INTO crm_messages
           (id,brand_id,conversation_id,whatsapp_message_id,direction,message_type,body,media_object_key,media_mime_type,media_file_name,status,sent_at)
         VALUES (UNHEX(REPLACE(?, '-', '')),?,UNHEX(REPLACE(?, '-', '')),?,'outbound',?,?,?,?,?,'pending',?)`,
        [messageId, brandId, conversationId, messageId, input.type, input.body, input.mediaObjectKey,
          input.mimeType, input.fileName, sentAt.slice(0, 23).replace('T', ' ')],
      );
      await connection.execute(
        `INSERT INTO crm_outbox_jobs (id,brand_id,job_type,dedupe_key,payload,status,available_at)
         VALUES (UNHEX(REPLACE(?, '-', '')),?,'whatsapp.send',?,?,'pending',UTC_TIMESTAMP(3))`,
        [randomUUID(), brandId, messageId, JSON.stringify({ messageId, conversationId, phone, ...input })],
      );
      await connection.execute(
        `UPDATE crm_conversations SET last_message_preview=?,last_message_at=? WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
        [input.body || input.fileName, sentAt.slice(0, 23).replace('T', ' '), brandId, conversationId],
      );
      await connection.commit();
      return {
        id: messageId, conversationId, direction: 'outbound', type: input.type, body: input.body,
        sentAt, status: 'pending', mediaUrl: `/api/v1/messages/${messageId}/media`, mimeType: input.mimeType, fileName: input.fileName,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimOutboundJobs(workerId: string, limit = 10): Promise<OutboundMessageJob[]> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
	  await connection.execute(
		`UPDATE crm_outbox_jobs SET status='pending',locked_at=NULL,locked_by=NULL
		  WHERE job_type='whatsapp.send' AND status='processing'
		    AND locked_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE)`,
	  );
      const [rows] = await connection.execute<(RowDataPacket & {
        id: string; brand_id: number; attempts: number; payload: OutboundMessageJob['payload'] | string;
      })[]>(
        `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id,brand_id,attempts,payload FROM crm_outbox_jobs
          WHERE job_type='whatsapp.send' AND status='pending' AND available_at<=UTC_TIMESTAMP(3)
          ORDER BY available_at,id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      for (const row of rows) {
        await connection.execute(
          `UPDATE crm_outbox_jobs SET status='processing',locked_at=UTC_TIMESTAMP(3),locked_by=? WHERE id=UNHEX(REPLACE(?, '-', ''))`,
          [workerId, row.id],
        );
      }
      await connection.commit();
      return rows.map((row) => ({
        id: row.id,
        brandId: row.brand_id,
        attempts: row.attempts,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) as OutboundMessageJob['payload'] : row.payload,
      }));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async completeOutboundJob(job: OutboundMessageJob): Promise<Message | null> {
    await this.pool.execute(
      `UPDATE crm_outbox_jobs SET status='completed',attempts=attempts+1,locked_at=NULL,locked_by=NULL,last_error=NULL
        WHERE id=UNHEX(REPLACE(?, '-', ''))`,
      [job.id],
    );
    await this.pool.execute(
      `UPDATE crm_messages SET status='sent',failure_code=NULL WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
      [job.brandId, job.payload.messageId],
    );
    return this.getMessageById(job.brandId, job.payload.messageId);
  }

  async retryOutboundJob(job: OutboundMessageJob, error: string, maxAttempts = 5): Promise<Message | null> {
    const attempts = job.attempts + 1;
    const permanent = attempts >= maxAttempts;
    const delaySeconds = Math.min(300, 2 ** attempts * 3) + Math.floor(Math.random() * 4);
    await this.pool.execute(
      `UPDATE crm_outbox_jobs SET status=?,attempts=?,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),
              locked_at=NULL,locked_by=NULL,last_error=? WHERE id=UNHEX(REPLACE(?, '-', ''))`,
      [permanent ? 'failed' : 'pending', attempts, delaySeconds, error.slice(0, 1_000), job.id],
    );
    await this.pool.execute(
      `UPDATE crm_messages SET status=?,failure_code=? WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
      [permanent ? 'failed' : 'pending', permanent ? 'MAX_RETRIES_EXCEEDED' : null, job.brandId, job.payload.messageId],
    );
    return this.getMessageById(job.brandId, job.payload.messageId);
  }

  async deferOutboundJob(jobId: string, delaySeconds = 10): Promise<void> {
    await this.pool.execute(
      `UPDATE crm_outbox_jobs SET status='pending',available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),
              locked_at=NULL,locked_by=NULL WHERE id=UNHEX(REPLACE(?, '-', ''))`,
      [delaySeconds, jobId],
    );
  }

  async retryFailedMessage(brandId: number, messageId: string): Promise<Message | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<IdRow[]>(
        `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id FROM crm_messages
          WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) AND direction='outbound' AND status='failed' FOR UPDATE`,
        [brandId, messageId],
      );
      if (!rows[0]) {
        await connection.rollback();
        return null;
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE crm_outbox_jobs SET status='pending',attempts=0,available_at=UTC_TIMESTAMP(3),
                locked_at=NULL,locked_by=NULL,last_error=NULL
          WHERE brand_id=? AND job_type='whatsapp.send' AND dedupe_key=? AND status='failed'`,
        [brandId, messageId],
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return null;
      }
      await connection.execute(
        `UPDATE crm_messages SET status='pending',failure_code=NULL WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
        [brandId, messageId],
      );
      await connection.commit();
      return this.getMessageById(brandId, messageId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateMessageStatus(brandId: number, whatsappMessageId: string, status: Message['status']): Promise<Message | null> {
    await this.pool.execute(
      `UPDATE crm_messages SET status=? WHERE brand_id=? AND whatsapp_message_id=? AND direction='outbound'`,
      [status, brandId, whatsappMessageId],
    );
    return this.getMessageByWhatsappId(brandId, whatsappMessageId);
  }

  private async getMessageById(brandId: number, messageId: string): Promise<Message | null> {
    const [rows] = await this.pool.execute<MessageRow[]>(
      `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id,LOWER(CONCAT(SUBSTRING(HEX(conversation_id),1,8),'-',SUBSTRING(HEX(conversation_id),9,4),'-',SUBSTRING(HEX(conversation_id),13,4),'-',SUBSTRING(HEX(conversation_id),17,4),'-',SUBSTRING(HEX(conversation_id),21,12))) AS conversation_id,
			  whatsapp_message_id,direction,message_type,body,status,sent_at,
			  media_object_key,media_mime_type,media_file_name
         FROM crm_messages WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) LIMIT 1`,
      [brandId, messageId],
    );
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async ingestIncoming(input: {
    brandId: number;
    messageId: string;
    jid?: string;
    phone: string;
    name: string;
    body: string;
    occurredAt: string;
	type?: Message['type'];
	mediaObjectKey?: string;
	mediaMimeType?: string;
	mediaFileName?: string;
	direction?: Message['direction'];
	status?: Message['status'];
	historical?: boolean;
  }): Promise<{ conversation: Conversation; lead: Lead; message: Message }> {
    await this.ensureBrand(input.brandId);
	const direction = input.direction ?? 'inbound';
	const historical = input.historical ?? false;
	const messageStatus = input.status ?? (direction === 'outbound' ? 'sent' : 'delivered');
    const connection = await this.pool.getConnection();
    let conversationId = '';
    let leadId = '';
    let localMessageId = '';
    let inserted = false;
    try {
      await connection.beginTransaction();
      const [duplicateRows] = await connection.execute<(MessageRow & { lead_id: string })[]>(
        `SELECT LOWER(CONCAT(SUBSTRING(HEX(m.id),1,8),'-',SUBSTRING(HEX(m.id),9,4),'-',SUBSTRING(HEX(m.id),13,4),'-',SUBSTRING(HEX(m.id),17,4),'-',SUBSTRING(HEX(m.id),21,12))) AS id, LOWER(CONCAT(SUBSTRING(HEX(m.conversation_id),1,8),'-',SUBSTRING(HEX(m.conversation_id),9,4),'-',SUBSTRING(HEX(m.conversation_id),13,4),'-',SUBSTRING(HEX(m.conversation_id),17,4),'-',SUBSTRING(HEX(m.conversation_id),21,12))) AS conversation_id,
                LOWER(CONCAT(SUBSTRING(HEX(cv.lead_id),1,8),'-',SUBSTRING(HEX(cv.lead_id),9,4),'-',SUBSTRING(HEX(cv.lead_id),13,4),'-',SUBSTRING(HEX(cv.lead_id),17,4),'-',SUBSTRING(HEX(cv.lead_id),21,12))) AS lead_id, m.whatsapp_message_id, m.direction,
				m.message_type,m.body,m.status,m.sent_at,m.media_object_key,m.media_mime_type,m.media_file_name
           FROM crm_messages m
           JOIN crm_conversations cv ON cv.id=m.conversation_id AND cv.brand_id=m.brand_id
          WHERE m.brand_id=? AND m.whatsapp_message_id=? LIMIT 1`,
        [input.brandId, input.messageId],
      );
      const duplicate = duplicateRows[0];
      if (duplicate) {
        conversationId = duplicate.conversation_id;
        leadId = duplicate.lead_id;
        localMessageId = duplicate.id;
      } else {
        const contactId = randomUUID();
        await connection.execute(
          `INSERT INTO crm_contacts (id, brand_id, phone_e164, display_name, source)
           VALUES (UNHEX(REPLACE(?, '-', '')), ?, ?, ?, 'WhatsApp')
           ON DUPLICATE KEY UPDATE display_name=IF(display_name='', VALUES(display_name), display_name)`,
          [contactId, input.brandId, input.phone, input.name || input.phone],
        );
        const [contactRows] = await connection.execute<(IdRow & { display_name: string })[]>(
          `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id, display_name FROM crm_contacts WHERE brand_id=? AND phone_e164=? LIMIT 1`,
          [input.brandId, input.phone],
        );
        const contact = contactRows[0];
        if (!contact) throw new Error('CONTACT_CREATE_FAILED');
        const jid = input.jid ?? `${input.phone.replace(/\D/g, '')}@s.whatsapp.net`;
        const [conversationRows] = await connection.execute<(IdRow & { lead_id: string })[]>(
          `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id, LOWER(CONCAT(SUBSTRING(HEX(lead_id),1,8),'-',SUBSTRING(HEX(lead_id),9,4),'-',SUBSTRING(HEX(lead_id),13,4),'-',SUBSTRING(HEX(lead_id),17,4),'-',SUBSTRING(HEX(lead_id),21,12))) AS lead_id
             FROM crm_conversations WHERE brand_id=? AND whatsapp_jid=? LIMIT 1 FOR UPDATE`,
          [input.brandId, jid],
        );
        const existingConversation = conversationRows[0];
        if (existingConversation) {
          conversationId = String(existingConversation.id);
          leadId = existingConversation.lead_id;
        } else {
          const [stageRows] = await connection.execute<IdRow[]>(
            "SELECT id FROM crm_stages WHERE brand_id=? AND stage_key='new' LIMIT 1",
            [input.brandId],
          );
          const stageId = stageRows[0]?.id;
          if (!stageId) throw new Error('DEFAULT_STAGE_MISSING');
          leadId = randomUUID();
          conversationId = randomUUID();
		  const assignee = historical ? null : await this.nextLeadAssignee(connection, input.brandId);
          await connection.execute(
            `INSERT INTO crm_leads
               (id, brand_id, contact_id, stage_id, assignee_erp_user_id, assignee_name, room_type, pax, estimated_value)
             VALUES (UNHEX(REPLACE(?, '-', '')), ?, UNHEX(REPLACE(?, '-', '')), ?, ?, ?, 'Quad', 1, 0)`,
            [leadId, input.brandId, String(contact.id), stageId, assignee?.userId ?? null, assignee?.name ?? 'Belum ditugaskan'],
          );
          await connection.execute(
            `INSERT INTO crm_conversations
               (id, brand_id, contact_id, lead_id, whatsapp_jid, last_message_preview, last_message_at, unread_count)
             VALUES (UNHEX(REPLACE(?, '-', '')), ?, UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?, '', NULL, 0)`,
            [conversationId, input.brandId, String(contact.id), leadId, jid],
          );
		  if (!historical) {
			await connection.execute(
			  `INSERT INTO crm_activities
				 (id, brand_id, lead_id, activity_type, title, description, actor_name, occurred_at)
			   VALUES (UNHEX(REPLACE(?, '-', '')), ?, UNHEX(REPLACE(?, '-', '')), 'message', ?, 'Lead dibuat otomatis dari percakapan pertama.', 'WhatsApp', ?)`,
			  [randomUUID(), input.brandId, leadId, `Pesan baru dari ${input.name || input.phone}`, toSqlDate(input.occurredAt)],
			);
		  }
          if (assignee && !historical) {
            await connection.execute(
              `INSERT INTO crm_activities
                 (id, brand_id, lead_id, activity_type, title, description, actor_erp_user_id, actor_name, occurred_at)
               VALUES (UNHEX(REPLACE(?, '-', '')), ?, UNHEX(REPLACE(?, '-', '')), 'assignment', ?, 'Lead dibagikan otomatis sesuai rotasi.', ?, 'Sistem', ?)`,
              [randomUUID(), input.brandId, leadId, `Lead ditugaskan ke ${assignee.name}`, assignee.userId, toSqlDate(input.occurredAt)],
            );
          }
        }
        localMessageId = randomUUID();
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT IGNORE INTO crm_messages
			 (id,brand_id,conversation_id,whatsapp_message_id,direction,message_type,body,media_object_key,media_mime_type,media_file_name,status,sent_at)
		   VALUES (UNHEX(REPLACE(?, '-', '')),?,UNHEX(REPLACE(?, '-', '')),?,?,?,?,?,?,?, ?,?)`,
		  [localMessageId,input.brandId,conversationId,input.messageId,direction,input.type ?? 'text',input.body,
			input.mediaObjectKey ?? null,input.mediaMimeType ?? null,input.mediaFileName ?? null,messageStatus,toSqlDate(input.occurredAt)],
        );
        inserted = insertResult.affectedRows === 1;
        if (inserted) {
          await connection.execute(
            `UPDATE crm_conversations
				SET last_message_preview=?, last_message_at=?, unread_count=unread_count+?
			  WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))
				AND (last_message_at IS NULL OR last_message_at<=?)`,
			[input.body, toSqlDate(input.occurredAt), direction === 'inbound' && !historical ? 1 : 0,
			  input.brandId, conversationId, toSqlDate(input.occurredAt)],
          );
          await connection.execute(
			`UPDATE crm_leads SET updated_at=GREATEST(updated_at,?) WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
            [toSqlDate(input.occurredAt), input.brandId, leadId],
          );
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const [conversation, lead, message] = await Promise.all([
      this.listConversations(input.brandId).then((items) => items.find((item) => item.id === conversationId)),
      this.getLead(input.brandId, leadId),
      this.getMessageByWhatsappId(input.brandId, input.messageId),
    ]);
    if (!conversation || !lead || !message) throw new Error(inserted ? 'INCOMING_PERSIST_FAILED' : 'INCOMING_DUPLICATE_LOOKUP_FAILED');
    return { conversation, lead, message };
  }

  private async getMessageByWhatsappId(brandId: number, messageId: string): Promise<Message | null> {
    const [rows] = await this.pool.execute<MessageRow[]>(
      `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id, LOWER(CONCAT(SUBSTRING(HEX(conversation_id),1,8),'-',SUBSTRING(HEX(conversation_id),9,4),'-',SUBSTRING(HEX(conversation_id),13,4),'-',SUBSTRING(HEX(conversation_id),17,4),'-',SUBSTRING(HEX(conversation_id),21,12))) AS conversation_id,
			  whatsapp_message_id,direction,message_type,body,status,sent_at,
			  media_object_key,media_mime_type,media_file_name
         FROM crm_messages WHERE brand_id=? AND whatsapp_message_id=? LIMIT 1`,
      [brandId, messageId],
    );
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async getMessageMedia(brandId: number, messageId: string): Promise<{ objectKey: string; mimeType: string; fileName: string } | null> {
	const [rows] = await this.pool.execute<(RowDataPacket & {
	  object_key: string; mime_type: string | null; file_name: string | null;
	})[]>(
	  `SELECT media_object_key AS object_key,media_mime_type AS mime_type,media_file_name AS file_name
		 FROM crm_messages WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) AND media_object_key IS NOT NULL LIMIT 1`,
	  [brandId, messageId],
	);
	const row = rows[0];
	return row ? { objectKey: row.object_key, mimeType: row.mime_type ?? 'application/octet-stream', fileName: row.file_name ?? 'lampiran' } : null;
  }

  async prepareDeal(brandId: number, leadId: string, request: DealRequest, idempotencyKey: string): Promise<PreparedDeal | null> {
    await this.ensureBrand(brandId);
    const connection = await this.pool.getConnection();
    let conversionId: string = randomUUID();
    let completed = false;
    try {
      await connection.beginTransaction();
      const [leadRows] = await connection.execute<IdRow[]>(
        `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id FROM crm_leads
          WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) AND deleted_at IS NULL FOR UPDATE`,
        [brandId, leadId],
      );
      if (!leadRows[0]) {
        await connection.rollback();
        return null;
      }
      const [rows] = await connection.execute<(RowDataPacket & {
        id: string;
        idempotency_key: string;
        status: string;
        request_payload: DealRequest | string;
      })[]>(
        `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id,idempotency_key,status,request_payload
           FROM crm_deal_conversions WHERE brand_id=? AND lead_id=UNHEX(REPLACE(?, '-', '')) FOR UPDATE`,
        [brandId, leadId],
      );
      const existing = rows[0];
      if (existing) {
        conversionId = existing.id;
        if (existing.idempotency_key !== idempotencyKey) throw new DealConflictError('DEAL_ALREADY_EXISTS');
        const previousPayload = typeof existing.request_payload === 'string'
          ? JSON.parse(existing.request_payload) as DealRequest
          : existing.request_payload;
        if (stableJson(previousPayload) !== stableJson(request)) throw new DealConflictError('IDEMPOTENCY_CONFLICT');
        completed = existing.status === 'completed';
        if (!completed) {
          await connection.execute(
            `UPDATE crm_deal_conversions SET status='pending',retry_count=retry_count+1,
                    last_error_code=NULL,last_error_message=NULL WHERE id=UNHEX(REPLACE(?, '-', ''))`,
            [conversionId],
          );
        }
      } else {
        await connection.execute(
          `INSERT INTO crm_deal_conversions
             (id,brand_id,lead_id,idempotency_key,commitment_type,status,request_payload)
           VALUES (UNHEX(REPLACE(?, '-', '')),?,UNHEX(REPLACE(?, '-', '')),?,?,'pending',?)`,
          [conversionId, brandId, leadId, idempotencyKey, request.commitmentType, stableJson(request)],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const lead = await this.getLead(brandId, leadId);
    if (!lead) return null;
    return {
      conversionId,
      lead,
      ...(completed ? {
        replay: { lead, conversionId, status: 'completed', message: 'Deal sudah pernah diproses.' },
      } : {}),
    };
  }

  async completeDeal(
    brandId: number,
    leadId: string,
    conversionId: string,
    idempotencyKey: string,
    request: DealRequest,
    erpResult: ErpDealResult,
    actor: string,
    correlationId?: string,
  ): Promise<DealResult> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [conversionRows] = await connection.execute<(RowDataPacket & { status: string })[]>(
        `SELECT status FROM crm_deal_conversions
          WHERE id=UNHEX(REPLACE(?, '-', '')) AND brand_id=? AND lead_id=UNHEX(REPLACE(?, '-', '')) AND idempotency_key=? FOR UPDATE`,
        [conversionId, brandId, leadId, idempotencyKey],
      );
      if (!conversionRows[0]) throw new DealConflictError('DEAL_ALREADY_EXISTS');
      const [stageRows] = await connection.execute<IdRow[]>(
        `SELECT id FROM crm_stages WHERE brand_id=? AND stage_key='deal' LIMIT 1`,
        [brandId],
      );
      const dealStageId = stageRows[0]?.id;
      if (!dealStageId) throw new Error('DEAL_STAGE_NOT_FOUND');

      await connection.execute(
        `UPDATE crm_deal_conversions SET status='completed',response_payload=?,erp_jamaah_id=?,
                erp_booking_id=?,erp_payment_id=?,last_error_code=NULL,last_error_message=NULL
          WHERE id=UNHEX(REPLACE(?, '-', ''))`,
        [JSON.stringify(erpResult), erpResult.jamaah_id, erpResult.booking_id, erpResult.payment_id ?? null, conversionId],
      );
      await connection.execute(
        `UPDATE crm_leads SET stage_id=?,erp_schedule_id=?,room_type=?,pax=?,deal_substatus=?,
                seat_hold_expires_at=?,erp_jamaah_id=?,erp_booking_id=?,erp_payment_id=?,version=version+1
          WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
        [dealStageId, request.scheduleId, request.roomType, request.pax, erpResult.deal_substatus,
          toSqlDate(erpResult.seat_hold_expires_at ?? ''), erpResult.jamaah_id, erpResult.booking_id,
          erpResult.payment_id ?? null, brandId, leadId],
      );
      await connection.execute(
        `UPDATE crm_contacts c JOIN crm_leads l ON l.contact_id=c.id
            SET c.erp_jamaah_id=? WHERE c.brand_id=? AND l.id=UNHEX(REPLACE(?, '-', ''))`,
        [erpResult.jamaah_id, brandId, leadId],
      );
      await connection.execute(
        `INSERT INTO crm_activities
           (id,brand_id,lead_id,activity_type,title,description,actor_name,occurred_at)
         VALUES (UNHEX(REPLACE(?, '-', '')),?,UNHEX(REPLACE(?, '-', '')),'deal','Deal berhasil diproses',?,?,UTC_TIMESTAMP(3))`,
        [randomUUID(), brandId, leadId, `Booking ERP #${erpResult.booking_code} dibuat dengan komitmen ${request.commitmentType}.`, actor],
      );
      await this.insertAudit(connection, brandId, actor, 'deal_conversion', conversionId, 'deal.completed', request, erpResult, correlationId);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const lead = await this.getLead(brandId, leadId);
    if (!lead) throw new Error('DEAL_LEAD_RELOAD_FAILED');
    return { lead, conversionId, status: 'completed', message: 'Booking ERP berhasil dibuat dan lead dipindahkan ke Deal.' };
  }

  async failDeal(conversionId: string, code: string, message: string): Promise<void> {
    await this.pool.execute(
      `UPDATE crm_deal_conversions SET status='requires_retry',last_error_code=?,last_error_message=?
        WHERE id=UNHEX(REPLACE(?, '-', '')) AND status<>'completed'`,
      [code.slice(0, 100), message.slice(0, 1_000), conversionId],
    );
  }

  async syncPaymentStatus(
    brandId: number,
    leadId: string,
    paymentId: number,
    paymentStatus: 'pending' | 'confirmed' | 'rejected',
    rejectionReason: string | null,
    actor = 'ERP Sync',
    correlationId?: string,
  ): Promise<Lead | null> {
    const nextSubstatus: NonNullable<Lead['dealSubstatus']> = paymentStatus === 'confirmed'
      ? 'dp_confirmed'
      : paymentStatus === 'rejected'
        ? 'dp_rejected'
        : 'dp_pending';
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<(RowDataPacket & { deal_substatus: Lead['dealSubstatus']; erp_payment_id: number | null })[]>(
        `SELECT deal_substatus,erp_payment_id FROM crm_leads
          WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', '')) FOR UPDATE`,
        [brandId, leadId],
      );
      const current = rows[0];
      if (!current || (current.erp_payment_id && current.erp_payment_id !== paymentId)) {
        await connection.rollback();
        return null;
      }
      if (current.deal_substatus !== nextSubstatus) {
        await connection.execute(
          `UPDATE crm_leads SET deal_substatus=?,erp_payment_id=?,version=version+1
            WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
          [nextSubstatus, paymentId, brandId, leadId],
        );
        const description = paymentStatus === 'confirmed'
          ? `Payment ERP #${paymentId} telah dikonfirmasi.`
          : paymentStatus === 'rejected'
            ? `Payment ERP #${paymentId} ditolak.${rejectionReason ? ` ${rejectionReason}` : ''}`.slice(0, 1_000)
            : `Payment ERP #${paymentId} menunggu verifikasi.`;
        await connection.execute(
          `INSERT INTO crm_activities
             (id,brand_id,lead_id,activity_type,title,description,actor_name,occurred_at)
           VALUES (UNHEX(REPLACE(?, '-', '')),?,UNHEX(REPLACE(?, '-', '')),'deal',?,?,?,UTC_TIMESTAMP(3))`,
          [randomUUID(), brandId, leadId, paymentStatus === 'confirmed' ? 'DP terkonfirmasi' : paymentStatus === 'rejected' ? 'DP ditolak' : 'DP menunggu verifikasi', description, actor],
        );
        await this.insertAudit(connection, brandId, actor, 'lead', leadId, 'payment.status_synced', current.deal_substatus, nextSubstatus, correlationId);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getLead(brandId, leadId);
  }

  async dashboard(brandId: number, period: DashboardPeriod = 'month', assigneeUserId?: number): Promise<DashboardMetrics> {
    const [leads, stages] = await Promise.all([this.listLeads(brandId, assigneeUserId), this.listStages(brandId)]);
    const periodMs = period === 'today' ? 24 * 60 * 60 * 1_000 : period === 'week' ? 7 * 24 * 60 * 60 * 1_000 : period === 'month' ? 30 * 24 * 60 * 60 * 1_000 : null;
    const cutoff = periodMs ? new Date(Date.now() - periodMs) : null;
    const changedInPeriod = (lead: Lead) => !cutoff || new Date(lead.updatedAt) >= cutoff;
    const createdInPeriod = (lead: Lead) => !cutoff || new Date(lead.createdAt ?? lead.updatedAt) >= cutoff;
    const deals = leads.filter((lead) => lead.stageId === 'deal' && changedInPeriod(lead)).length;
    const lost = leads.filter((lead) => lead.stageId === 'lost' && changedInPeriod(lead)).length;
    const [activityRows] = await this.pool.execute<ActivityRow[]>(
      `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id, activity_type, title, description, actor_name, occurred_at,
              LOWER(CONCAT(SUBSTRING(HEX(lead_id),1,8),'-',SUBSTRING(HEX(lead_id),9,4),'-',SUBSTRING(HEX(lead_id),13,4),'-',SUBSTRING(HEX(lead_id),17,4),'-',SUBSTRING(HEX(lead_id),21,12))) AS lead_id
         FROM crm_activities a WHERE a.brand_id=? ${cutoff ? 'AND a.occurred_at>=?' : ''}
              ${assigneeUserId ? 'AND EXISTS (SELECT 1 FROM crm_leads l WHERE l.id=a.lead_id AND l.brand_id=a.brand_id AND l.assignee_erp_user_id=?)' : ''}
         ORDER BY a.occurred_at DESC LIMIT 5`,
      [brandId, ...(cutoff ? [toSqlDate(cutoff.toISOString())] : []), ...(assigneeUserId ? [assigneeUserId] : [])],
    );
    const [responseRows] = await this.pool.execute<(RowDataPacket & { response_minutes: number })[]>(
      `SELECT TIMESTAMPDIFF(MINUTE,
                MIN(CASE WHEN direction='inbound' THEN sent_at END),
                MIN(CASE WHEN direction='outbound' THEN sent_at END)) AS response_minutes
         FROM crm_messages m
         ${assigneeUserId ? 'JOIN crm_conversations cv ON cv.id=m.conversation_id AND cv.brand_id=m.brand_id JOIN crm_leads l ON l.id=cv.lead_id AND l.brand_id=cv.brand_id' : ''}
         WHERE m.brand_id=? ${assigneeUserId ? 'AND l.assignee_erp_user_id=?' : ''} GROUP BY m.conversation_id
       HAVING response_minutes IS NOT NULL AND response_minutes >= 0`,
      assigneeUserId ? [brandId, assigneeUserId] : [brandId],
    );
    const responseTimes = responseRows.map((row) => Number(row.response_minutes)).sort((a, b) => a - b);
    const middle = Math.floor(responseTimes.length / 2);
    const median = responseTimes.length
      ? responseTimes.length % 2
        ? responseTimes[middle]!
        : Math.round((responseTimes[middle - 1]! + responseTimes[middle]!) / 2)
      : 0;
    return {
      newLeads: leads.filter(createdInPeriod).length,
      unread: leads.reduce((sum, lead) => sum + lead.unread, 0),
      deals,
      lost,
      conversionRate: deals + lost ? Math.round((deals / (deals + lost)) * 100) : 0,
      medianFirstResponseMinutes: median,
      pipelineValue: leads.filter((lead) => !['deal', 'lost'].includes(lead.stageId)).reduce((sum, lead) => sum + lead.estimatedValue, 0),
      stageDistribution: stages.map((stage) => ({ stageId: stage.id, count: leads.filter((lead) => lead.stageId === stage.id).length })),
      activities: activityRows.map((row) => ({
        id: row.id,
        type: row.activity_type,
        title: row.title,
        description: row.description ?? '',
        actor: row.actor_name,
        occurredAt: toIso(row.occurred_at),
        leadId: row.lead_id,
      })),
    };
  }

  async listActivities(brandId: number, limit = 100, assigneeUserId?: number): Promise<Activity[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
    const [rows] = await this.pool.execute<ActivityRow[]>(
      `SELECT LOWER(CONCAT(SUBSTRING(HEX(id),1,8),'-',SUBSTRING(HEX(id),9,4),'-',SUBSTRING(HEX(id),13,4),'-',SUBSTRING(HEX(id),17,4),'-',SUBSTRING(HEX(id),21,12))) AS id, activity_type, title, description, actor_name, occurred_at,
              LOWER(CONCAT(SUBSTRING(HEX(lead_id),1,8),'-',SUBSTRING(HEX(lead_id),9,4),'-',SUBSTRING(HEX(lead_id),13,4),'-',SUBSTRING(HEX(lead_id),17,4),'-',SUBSTRING(HEX(lead_id),21,12))) AS lead_id
         FROM crm_activities a WHERE a.brand_id=?
              ${assigneeUserId ? 'AND EXISTS (SELECT 1 FROM crm_leads l WHERE l.id=a.lead_id AND l.brand_id=a.brand_id AND l.assignee_erp_user_id=?)' : ''}
         ORDER BY a.occurred_at DESC LIMIT ${safeLimit}`,
      assigneeUserId ? [brandId, assigneeUserId] : [brandId],
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.activity_type,
      title: row.title,
      description: row.description ?? '',
      actor: row.actor_name,
      occurredAt: toIso(row.occurred_at),
      leadId: row.lead_id,
    }));
  }

  private async insertAudit(
    connection: PoolConnection,
    brandId: number,
    actor: string,
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    correlationId?: string,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO crm_audit_logs
         (id, brand_id, actor_name, entity_type, entity_id, action, before_payload, after_payload, correlation_id)
       VALUES (UNHEX(REPLACE(?, '-', '')), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), brandId, actor, entityType, entityId, action, JSON.stringify(before), JSON.stringify(after), correlationId ?? null],
    );
  }
}
