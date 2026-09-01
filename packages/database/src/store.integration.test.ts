import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MySqlCrmStore } from './store.js';
import { runMigrations } from './migrate.js';
import { createDatabasePool, parseDatabaseUrl } from './pool.js';
import type { Pool } from 'mysql2/promise';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL wajib diisi untuk integration test database.');
const target = parseDatabaseUrl(databaseUrl);
if (!target.database.startsWith('azhan_crm_test_')) {
  throw new Error('Integration test hanya boleh memakai database berprefix azhan_crm_test_.');
}

let pool: Pool;
let store: MySqlCrmStore;

beforeAll(async () => {
  await runMigrations(databaseUrl);
  pool = createDatabasePool(databaseUrl);
  store = new MySqlCrmStore(pool);
});

afterAll(async () => {
  await pool?.end();
  const connection = await createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
  });
  try {
    await connection.query(`DROP DATABASE \`${target.database}\``);
  } finally {
    await connection.end();
  }
});

describe('MySqlCrmStore', () => {
  it('membagikan 100 lead sesuai rotasi kuota 10/40/30/20', async () => {
    const brandId = 303;
    await store.syncTeamMembers(brandId, [
      { userId: 1, email: 'cs1@example.test', displayName: 'CS 1', isActive: true },
      { userId: 2, email: 'cs2@example.test', displayName: 'CS 2', isActive: true },
      { userId: 3, email: 'cs3@example.test', displayName: 'CS 3', isActive: true },
      { userId: 4, email: 'cs4@example.test', displayName: 'CS 4', isActive: true },
    ]);
    await store.setTeamDistribution(brandId, [
      { userId: 1, percent: 10 },
      { userId: 2, percent: 40 },
      { userId: 3, percent: 30 },
      { userId: 4, percent: 20 },
    ]);

    const sequence: number[] = [];
    for (let index = 1; index <= 100; index += 1) {
      const created = await store.ingestIncoming({
        brandId,
        messageId: `rotation-message-${index}`,
        jid: `62812000${String(index).padStart(4, '0')}@s.whatsapp.net`,
        phone: `+62812000${String(index).padStart(4, '0')}`,
        name: `Lead Rotasi ${index}`,
        body: 'Informasi paket',
        occurredAt: new Date(Date.UTC(2026, 7, 29, 5, 0, index)).toISOString(),
      });
      sequence.push(created.lead.assigneeUserId!);
    }

    expect(sequence.slice(0, 6)).toEqual([1, 2, 3, 4, 1, 2]);
    await expect(store.listLeads(brandId, 1)).resolves.toHaveLength(10);
    await expect(store.listLeads(brandId, 2)).resolves.toHaveLength(40);
    await expect(store.listLeads(brandId, 3)).resolves.toHaveLength(30);
    await expect(store.listLeads(brandId, 4)).resolves.toHaveLength(20);
  }, 30_000);

  it('membuat contact, conversation, lead, dan message tepat satu kali', async () => {
    const input = {
      brandId: 101,
      messageId: 'wa-message-fixed',
      jid: '6281234567890@s.whatsapp.net',
      phone: '+6281234567890',
      name: 'Jamaah Test',
      body: 'Assalamualaikum',
      occurredAt: '2026-08-29T03:00:00.000Z',
	  type: 'image' as const,
	  mediaObjectKey: '101/media-fixed.jpg',
	  mediaMimeType: 'image/jpeg',
	  mediaFileName: 'brosur.jpg',
    };
    const first = await store.ingestIncoming(input);
    const duplicate = await store.ingestIncoming(input);

    expect(duplicate.message.id).toBe(first.message.id);
	expect(first.message.mediaUrl).toBe(`/api/v1/messages/${first.message.id}/media`);
    expect(await store.listLeads(101)).toHaveLength(1);
    expect(await store.listConversations(101)).toHaveLength(1);
    const messages = await store.listMessages(101, first.conversation.id);
    expect(messages).toHaveLength(1);
    const dashboard = await store.dashboard(101, 'today');
    expect(dashboard.newLeads).toBe(1);
    expect((await store.listActivities(101)).length).toBeGreaterThan(0);
    expect(await store.getLead(202, first.lead.id)).toBeNull();
  });

  it('mengimpor histori dua arah tanpa unread, aktivitas, atau rotasi lead baru', async () => {
	const brandId = 404;
	const common = {
	  brandId,
	  jid: '628123450404@s.whatsapp.net',
	  phone: '+628123450404',
	  name: 'Kontak Histori',
	  historical: true,
	} as const;
	await store.ingestIncoming({
	  ...common,
	  messageId: 'history-inbound-old',
	  body: 'Pertanyaan lama',
	  occurredAt: '2026-01-01T01:00:00.000Z',
	  direction: 'inbound',
	  status: 'read',
	});
	await store.ingestIncoming({
	  ...common,
	  messageId: 'history-outbound-new',
	  body: 'Balasan lama',
	  occurredAt: '2026-01-01T01:05:00.000Z',
	  direction: 'outbound',
	  status: 'delivered',
	});

	const [conversation] = await store.listConversations(brandId);
	const [lead] = await store.listLeads(brandId);
	const messages = await store.listMessages(brandId, conversation!.id);
	expect(conversation).toMatchObject({ unread: 0, lastMessage: 'Balasan lama' });
	expect(lead?.assigneeUserId).toBeUndefined();
	expect(messages?.map((message) => [message.direction, message.body, message.status])).toEqual([
	  ['inbound', 'Pertanyaan lama', 'read'],
	  ['outbound', 'Balasan lama', 'delivered'],
	]);
	await expect(store.listActivities(brandId)).resolves.toHaveLength(0);
  });

  it('mengimpor kontak massal secara idempoten dalam scope brand', async () => {
    const first = await store.importContacts(505, [
      { name: 'Nama Lama', phone: '+6281211112222' },
      { name: 'Nama Terbaru', phone: '+6281211112222' },
      { name: 'Kontak Kedua', phone: '+6281233334444' },
    ]);
    expect(first).toEqual({ imported: 2, created: 2, updated: 0, duplicates: 1 });

    const second = await store.importContacts(505, [{ name: 'Nama Diperbarui', phone: '+6281211112222' }]);
    expect(second).toEqual({ imported: 1, created: 0, updated: 1, duplicates: 0 });
    await expect(store.listContacts(505)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Nama Diperbarui', phone: '+6281211112222', source: 'Impor massal' }),
      expect.objectContaining({ name: 'Kontak Kedua', phone: '+6281233334444', source: 'Impor massal' }),
    ]));
    await expect(store.listContacts(506)).resolves.toHaveLength(0);
  });

  it('menggabungkan percakapan LID lama ke nomor WhatsApp asli tanpa kehilangan pesan', async () => {
    const brandId = 606;
    await store.ingestIncoming({
      brandId,
      messageId: 'real-phone-message',
      jid: '6281255556666@s.whatsapp.net',
      phone: '+6281255556666',
      name: 'Kontak Asli',
      body: 'Pesan lewat nomor asli',
      occurredAt: '2026-08-29T03:00:00.000Z',
    });
    await store.ingestIncoming({
      brandId,
      messageId: 'legacy-lid-message',
      jid: '153136080437932@lid',
      phone: '+153136080437932',
      name: 'Kontak Asli',
      body: 'Pesan lama lewat LID',
      occurredAt: '2026-08-29T03:01:00.000Z',
    });

    const unresolvedConversation = (await store.listConversations(brandId)).find((conversation) => conversation.phone === '+153136080437932');
    expect(unresolvedConversation?.phoneResolved).toBe(false);
    await expect(store.enqueueOutboundMessage(brandId, unresolvedConversation!.id, 'Jangan dikirim ke LID')).resolves.toBeNull();

    await store.syncWhatsappContacts(brandId, [{
      name: 'Kontak Asli',
      phone: '+6281255556666',
      jid: '6281255556666@s.whatsapp.net',
      aliases: ['153136080437932@lid', '6281255556666@s.whatsapp.net'],
    }]);

    const contacts = await store.listContacts(brandId);
    const conversations = await store.listConversations(brandId);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ phone: '+6281255556666', conversationId: conversations[0]?.id });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.phoneResolved).toBe(true);
    await expect(store.listMessages(brandId, conversations[0]!.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ body: 'Pesan lewat nomor asli' }),
      expect.objectContaining({ body: 'Pesan lama lewat LID' }),
    ]));
  });

  it('mengganti nama placeholder nomor ketika WhatsApp kemudian mengirim nama kontak', async () => {
    const brandId = 607;
    const common = {
      brandId,
      jid: '6281277778888@s.whatsapp.net',
      phone: '+6281277778888',
      occurredAt: '2026-08-29T03:00:00.000Z',
    };
    await store.ingestIncoming({ ...common, messageId: 'placeholder-name', name: '+6281277778888', body: 'Pesan pertama' });
    await store.ingestIncoming({ ...common, messageId: 'resolved-name', name: 'Nama dari WhatsApp', body: 'Pesan kedua' });

    await expect(store.listContacts(brandId)).resolves.toEqual([
      expect.objectContaining({ name: 'Nama dari WhatsApp', phone: '+6281277778888' }),
    ]);
  });

  it('mempertahankan optimistic version dan menyimpan alasan Lost', async () => {
    const [lead] = await store.listLeads(101);
    expect(lead).toBeDefined();
    const updated = await store.updateLead(101, lead!.id, { city: 'Jakarta' }, lead!.version, 'Tester', '00000000-0000-4000-8000-000000000001');
    expect(updated?.city).toBe('Jakarta');
    await expect(store.updateLead(101, lead!.id, { city: 'Bogor' }, lead!.version)).rejects.toThrow('VERSION_CONFLICT');

    const lost = await store.moveLead(101, lead!.id, 'lost', 'Tester', 'Jadwal belum cocok');
    expect(lost?.stageId).toBe('lost');
    const [rows] = await pool.execute<(RowDataPacket & { lost_reason: string })[]>(
      `SELECT lost_reason FROM crm_leads WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
      [101, lead!.id],
    );
    expect(rows[0]?.lost_reason).toBe('Jadwal belum cocok');
  });

  it('menyelesaikan Deal persisten dan me-replay idempotency key tanpa menggandakan konversi', async () => {
    const [lead] = await store.listLeads(101);
    expect(lead).toBeDefined();
    const request = {
      scheduleId: 88,
      roomType: 'Quad' as const,
      pax: 2,
      commitmentType: 'book_seat' as const,
      seatHoldExpiresAt: '2026-08-31T03:00:00.000Z',
    };
    const key = '00000000-0000-4000-8000-000000000099';
    const prepared = await store.prepareDeal(101, lead!.id, request, key);
    expect(prepared?.replay).toBeUndefined();
    const completed = await store.completeDeal(
      101,
      lead!.id,
      prepared!.conversionId,
      key,
      request,
      {
        status: 'completed',
        commitment_type: 'book_seat',
        deal_substatus: 'book_seat',
        jamaah_id: 1204,
        booking_id: 9012,
        booking_code: 'NV9012',
        booking_status: 'baru',
        seat_hold_expires_at: request.seatHoldExpiresAt,
      },
      'Tester',
      '00000000-0000-4000-8000-000000000002',
    );
    expect(completed.lead.stageId).toBe('deal');
    expect(completed.lead.erpBookingId).toBe(9012);

    const replay = await store.prepareDeal(101, lead!.id, request, key);
    expect(replay?.replay?.lead.erpBookingId).toBe(9012);
    const [rows] = await pool.execute<(RowDataPacket & { count: number })[]>(
      `SELECT COUNT(*) AS count FROM crm_deal_conversions WHERE brand_id=? AND lead_id=UNHEX(REPLACE(?, '-', ''))`,
      [101, lead!.id],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('mengantre pesan keluar, mengklaim job sekali, dan menyimpan delivery ack', async () => {
    const [conversation] = await store.listConversations(101);
    expect(conversation).toBeDefined();
    const pending = await store.enqueueOutboundMessage(101, conversation!.id, 'Pesan antrean');
    expect(pending?.status).toBe('pending');

    const [job] = await store.claimOutboundJobs('integration-worker', 10);
    expect(job?.payload.messageId).toBe(pending?.id);
    expect(await store.claimOutboundJobs('other-worker', 10)).toHaveLength(0);

    const sent = await store.completeOutboundJob(job!, 'native-whatsapp-message-id');
    expect(sent?.status).toBe('sent');
    const [messageRows] = await pool.execute<(RowDataPacket & { whatsapp_message_id: string })[]>(
      `SELECT whatsapp_message_id FROM crm_messages
        WHERE brand_id=? AND id=UNHEX(REPLACE(?, '-', ''))`,
      [101, pending!.id],
    );
    expect(messageRows[0]?.whatsapp_message_id).toBe('native-whatsapp-message-id');
    const delivered = await store.updateMessageStatus(101, 'native-whatsapp-message-id', 'delivered');
    expect(delivered?.status).toBe('delivered');
  });

  it('menolak akses lintas brand untuk setiap ID milik tenant lain', async () => {
    const [lead] = await store.listLeads(101);
    const [conversation] = await store.listConversations(101);
    expect(lead).toBeDefined();
    expect(conversation).toBeDefined();

    await expect(store.listMessages(202, conversation!.id)).resolves.toBeNull();
    await expect(store.getLead(202, lead!.id)).resolves.toBeNull();
    await expect(store.updateLead(202, lead!.id, { city: 'Tidak boleh berubah' }, lead!.version)).resolves.toBeNull();
    await expect(store.moveLead(202, lead!.id, 'contacted', 'Tenant lain')).resolves.toBeNull();
    await expect(store.enqueueOutboundMessage(202, conversation!.id, 'Pesan lintas tenant')).resolves.toBeNull();
  });

  it('menyinkronkan payment DP rejected lalu confirmed tanpa keluar dari scope brand', async () => {
    const created = await store.ingestIncoming({
      brandId: 101,
      messageId: 'wa-payment-sync',
      jid: '6281234567000@s.whatsapp.net',
      phone: '+6281234567000',
      name: 'Jamaah Payment',
      body: 'Saya siap DP',
      occurredAt: '2026-08-29T04:00:00.000Z',
      type: 'text',
    });
    const request = {
      scheduleId: 89,
      roomType: 'Triple' as const,
      pax: 1,
      commitmentType: 'dp' as const,
      paymentAmount: 5_000_000,
      paymentMethod: 'transfer',
      paymentDate: '2026-08-29',
    };
    const key = '00000000-0000-4000-8000-000000000199';
    const prepared = await store.prepareDeal(101, created.lead.id, request, key);
    const completed = await store.completeDeal(101, created.lead.id, prepared!.conversionId, key, request, {
      status: 'completed',
      commitment_type: 'dp',
      deal_substatus: 'dp_pending',
      jamaah_id: 1300,
      booking_id: 9200,
      booking_code: 'NV9200',
      booking_status: 'dp',
      payment_id: 7700,
    }, 'Tester');
    expect(completed.lead.dealSubstatus).toBe('dp_pending');

    const rejected = await store.syncPaymentStatus(101, created.lead.id, 7700, 'rejected', 'Bukti belum terbaca', 'ERP Sync');
    expect(rejected?.dealSubstatus).toBe('dp_rejected');
    const confirmed = await store.syncPaymentStatus(101, created.lead.id, 7700, 'confirmed', null, 'ERP Sync');
    expect(confirmed?.dealSubstatus).toBe('dp_confirmed');
    await expect(store.syncPaymentStatus(202, created.lead.id, 7700, 'rejected', null)).resolves.toBeNull();
  });
});
