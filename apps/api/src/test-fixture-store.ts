import type {
  Activity,
  Conversation,
  DashboardMetrics,
  DashboardPeriod,
  DealRequest,
  DealResult,
  Lead,
  Message,
  Schedule,
  Stage,
  Tag,
  TeamMember,
  TeamPerformance,
} from '@azhan-crm/contracts';

const now = Date.now();
const isoAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const tags: Record<string, Tag> = {
  priority: { id: 'priority', name: 'Prioritas', color: '#E5484D' },
  november: { id: 'november', name: 'November', color: '#7C5CFC' },
  family: { id: 'family', name: 'Keluarga', color: '#168A55' },
  dubai: { id: 'dubai', name: 'Plus Dubai', color: '#B65C00' },
};

export const defaultStages: Stage[] = [
  { id: 'new', name: 'Baru', color: '#3478F6', position: 1, kind: 'open' },
  { id: 'contacted', name: 'Dihubungi', color: '#64748B', position: 2, kind: 'open' },
  { id: 'follow_up', name: 'Follow Up', color: '#D97706', position: 3, kind: 'open' },
  { id: 'qualified', name: 'Qualified', color: '#7C3AED', position: 4, kind: 'open' },
  { id: 'negotiation', name: 'Negosiasi', color: '#DB2777', position: 5, kind: 'open' },
  { id: 'deal', name: 'Deal', color: '#168A55', position: 6, kind: 'won' },
  { id: 'lost', name: 'Lost', color: '#C9362B', position: 7, kind: 'lost' },
];

const schedules: Schedule[] = [
  {
    id: 101,
    name: 'Umrah Akhir Tahun — 12 Hari',
    departureDate: '2026-11-18',
    seatRemaining: 14,
    prices: { Quad: 31_900_000, Triple: 34_500_000, Double: 38_900_000 },
  },
  {
    id: 102,
    name: 'Umrah Plus Dubai — 13 Hari',
    departureDate: '2027-01-12',
    seatRemaining: 8,
    prices: { Quad: 39_500_000, Triple: 42_000_000, Double: 46_500_000 },
  },
  {
    id: 103,
    name: 'Ramadan Awal — 10 Hari',
    departureDate: '2027-02-08',
    seatRemaining: 21,
    prices: { Quad: 35_750_000, Triple: 38_250_000, Double: 42_500_000 },
  },
];

const baseLeads: Lead[] = [
  {
    id: 'lead-1', brandId: 1, contactId: 'contact-1', conversationId: 'conv-1', name: 'Nadia Rahma',
    phone: '+62812••••312', email: 'nadia.rahma@example.test', city: 'Bekasi', source: 'WhatsApp Organik',
    stageId: 'new', assignee: 'Aulia', scheduleId: 101, scheduleName: schedules[0]?.name ?? '',
    departurePlan: 'November 2026', roomType: 'Quad', pax: 2, estimatedValue: 63_800_000,
    nextFollowUp: '2026-08-29T09:30:00+07:00', notes: 'Meminta rincian hotel dan maskapai.',
    tags: [tags.priority!, tags.november!], unread: 2, stageAgeDays: 0, version: 1, updatedAt: isoAgo(4),
  },
  {
    id: 'lead-2', brandId: 1, contactId: 'contact-2', conversationId: 'conv-2', name: 'Rizky Pratama',
    phone: '+62813••••948', email: '', city: 'Tangerang', source: 'Instagram', stageId: 'new', assignee: 'Fikri',
    scheduleId: 102, scheduleName: schedules[1]?.name ?? '', departurePlan: 'Januari 2027', roomType: 'Triple',
    pax: 1, estimatedValue: 42_000_000, nextFollowUp: '2026-08-29T11:00:00+07:00',
    notes: 'Tertarik paket Dubai, masih membandingkan jadwal.', tags: [tags.dubai!], unread: 1,
    stageAgeDays: 0, version: 1, updatedAt: isoAgo(11),
  },
  {
    id: 'lead-3', brandId: 1, contactId: 'contact-3', conversationId: 'conv-3', name: 'Siti Mahmudah',
    phone: '+62856••••103', email: 'siti@example.test', city: 'Depok', source: 'Referral', stageId: 'contacted',
    assignee: 'Salma', scheduleId: 101, scheduleName: schedules[0]?.name ?? '', departurePlan: 'November 2026',
    roomType: 'Quad', pax: 4, estimatedValue: 127_600_000, nextFollowUp: '2026-08-30T09:00:00+07:00',
    notes: 'Rombongan keluarga. Perlu kamar berdekatan.', tags: [tags.family!], unread: 0,
    stageAgeDays: 1, version: 1, updatedAt: isoAgo(90),
  },
  {
    id: 'lead-4', brandId: 1, contactId: 'contact-4', conversationId: 'conv-4', name: 'Hendra Wijaya',
    phone: '+62819••••651', email: '', city: 'Bogor', source: 'Meta Ads', stageId: 'follow_up', assignee: 'Aulia',
    scheduleId: 103, scheduleName: schedules[2]?.name ?? '', departurePlan: 'Februari 2027', roomType: 'Double',
    pax: 2, estimatedValue: 85_000_000, nextFollowUp: '2026-08-29T13:30:00+07:00',
    notes: 'Follow up setelah berdiskusi dengan pasangan.', tags: [tags.priority!], unread: 0,
    stageAgeDays: 3, version: 1, updatedAt: isoAgo(240),
  },
  {
    id: 'lead-5', brandId: 1, contactId: 'contact-5', conversationId: 'conv-5', name: 'Farah Azzahra',
    phone: '+62821••••784', email: 'farah@example.test', city: 'Jakarta', source: 'Website', stageId: 'qualified',
    assignee: 'Fikri', scheduleId: 101, scheduleName: schedules[0]?.name ?? '', departurePlan: 'November 2026',
    roomType: 'Triple', pax: 2, estimatedValue: 69_000_000, nextFollowUp: '2026-08-29T15:00:00+07:00',
    notes: 'Sudah cocok dengan paket, menunggu keputusan tipe kamar.', tags: [tags.november!], unread: 0,
    stageAgeDays: 2, version: 1, updatedAt: isoAgo(310),
  },
  {
    id: 'lead-6', brandId: 1, contactId: 'contact-6', conversationId: 'conv-6', name: 'Bambang Setiawan',
    phone: '+62817••••220', email: '', city: 'Bandung', source: 'Referral', stageId: 'negotiation', assignee: 'Salma',
    scheduleId: 102, scheduleName: schedules[1]?.name ?? '', departurePlan: 'Januari 2027', roomType: 'Quad',
    pax: 3, estimatedValue: 118_500_000, nextFollowUp: '2026-08-29T10:30:00+07:00',
    notes: 'Negosiasi kebutuhan tiga orang dan add-on city tour.', tags: [tags.dubai!, tags.family!], unread: 0,
    stageAgeDays: 1, version: 1, updatedAt: isoAgo(500),
  },
  {
    id: 'lead-7', brandId: 1, contactId: 'contact-7', conversationId: 'conv-7', name: 'Maya Puspita',
    phone: '+62895••••452', email: 'maya@example.test', city: 'Jakarta', source: 'WhatsApp Organik', stageId: 'deal',
    assignee: 'Aulia', scheduleId: 101, scheduleName: schedules[0]?.name ?? '', departurePlan: 'November 2026',
    roomType: 'Quad', pax: 1, estimatedValue: 31_900_000, nextFollowUp: '', notes: 'Sudah book seat sampai 31 Agustus.',
    tags: [tags.november!], unread: 0, stageAgeDays: 0, dealSubstatus: 'book_seat', erpJamaahId: 1201,
    erpBookingId: 9011, version: 2, updatedAt: isoAgo(780),
  },
];

const baseConversations: Conversation[] = baseLeads.slice(0, 6).map((lead, index) => ({
  id: lead.conversationId,
  brandId: lead.brandId,
  leadId: lead.id,
  name: lead.name,
  phone: lead.phone,
  avatarSeed: lead.name,
  lastMessage: [
    'Apakah masih ada seat untuk keberangkatan November?',
    'Kalau paket Dubai hotelnya dekat Masjidil Haram?',
    'Kami rencana berangkat berempat sekeluarga.',
    'Baik kak, nanti saya diskusikan dulu.',
    'Untuk tipe Triple selisih harganya berapa?',
    'Boleh kirim rincian fasilitas tambahannya?',
  ][index] ?? '',
  lastMessageAt: isoAgo([4, 11, 90, 240, 310, 500][index] ?? 600),
  unread: lead.unread,
  assignee: lead.assignee,
  tags: lead.tags,
  online: index === 0,
}));

const baseMessages: Message[] = [
  { id: 'msg-1', conversationId: 'conv-1', direction: 'inbound', type: 'text', body: 'Assalamualaikum kak, saya lihat paket November di website.', sentAt: isoAgo(12), status: 'read' },
  { id: 'msg-2', conversationId: 'conv-1', direction: 'outbound', type: 'text', body: 'Waalaikumsalam Kak Nadia. Betul, paket November masih tersedia. Rencana berapa orang ya?', sentAt: isoAgo(9), status: 'read' },
  { id: 'msg-3', conversationId: 'conv-1', direction: 'inbound', type: 'text', body: 'Untuk berdua. Apakah masih ada seat untuk keberangkatan November?', sentAt: isoAgo(4), status: 'delivered' },
  { id: 'msg-4', conversationId: 'conv-2', direction: 'inbound', type: 'text', body: 'Kalau paket Dubai hotelnya dekat Masjidil Haram?', sentAt: isoAgo(11), status: 'delivered' },
  { id: 'msg-5', conversationId: 'conv-3', direction: 'inbound', type: 'text', body: 'Kami rencana berangkat berempat sekeluarga.', sentAt: isoAgo(90), status: 'read' },
  { id: 'msg-6', conversationId: 'conv-4', direction: 'outbound', type: 'text', body: 'Baik Pak Hendra, saya tunggu kabarnya. Saya follow up siang ini ya.', sentAt: isoAgo(260), status: 'read' },
  { id: 'msg-7', conversationId: 'conv-4', direction: 'inbound', type: 'text', body: 'Baik kak, nanti saya diskusikan dulu.', sentAt: isoAgo(240), status: 'read' },
];

const baseActivities: Activity[] = [
  { id: 'act-1', type: 'message', title: 'Pesan baru dari Nadia Rahma', description: 'Menanyakan ketersediaan seat November.', actor: 'WhatsApp', occurredAt: isoAgo(4), leadId: 'lead-1' },
  { id: 'act-2', type: 'stage', title: 'Farah pindah ke Qualified', description: 'Kebutuhan paket dan jadwal sudah cocok.', actor: 'Fikri', occurredAt: isoAgo(310), leadId: 'lead-5' },
  { id: 'act-3', type: 'deal', title: 'Maya berhasil Book Seat', description: 'Booking ERP #9011 terhubung.', actor: 'Aulia', occurredAt: isoAgo(780), leadId: 'lead-7' },
];

export class TestFixtureStore {
  private readonly leads = structuredClone(baseLeads);
  private readonly conversations = structuredClone(baseConversations);
  private readonly messages = structuredClone(baseMessages);
  private readonly activities = structuredClone(baseActivities);
  private readonly conversions = new Map<string, DealResult>();
  private readonly teamMembers: TeamMember[] = [
    { userId: 11, brandId: 1, email: 'aulia@fixture.test', displayName: 'Aulia', allocationPercent: 40, allocatedInCycle: 3, rotationPosition: 1, isActive: true },
    { userId: 12, brandId: 1, email: 'fikri@fixture.test', displayName: 'Fikri', allocationPercent: 30, allocatedInCycle: 2, rotationPosition: 2, isActive: true },
    { userId: 13, brandId: 1, email: 'salma@fixture.test', displayName: 'Salma', allocationPercent: 30, allocatedInCycle: 2, rotationPosition: 3, isActive: true },
  ];

  listStages(_brandId?: number): Stage[] {
    return structuredClone(defaultStages);
  }

  listTeamMembers(brandId: number): TeamMember[] {
    return structuredClone(this.teamMembers.filter((member) => member.brandId === brandId));
  }

  syncTeamMembers(brandId: number, _users: Array<{ userId: number; email: string; displayName: string; isActive: boolean }>): TeamMember[] {
    return this.listTeamMembers(brandId);
  }

  setTeamDistribution(brandId: number, allocations: Array<{ userId: number; percent: number }>): TeamMember[] {
    for (const member of this.teamMembers.filter((item) => item.brandId === brandId)) {
      const allocation = allocations.find((item) => item.userId === member.userId);
      if (allocation) member.allocationPercent = allocation.percent;
      member.allocatedInCycle = 0;
    }
    return this.listTeamMembers(brandId);
  }

  teamPerformance(brandId: number, _period: DashboardPeriod = 'month'): TeamPerformance[] {
    return this.listTeamMembers(brandId).map((member) => {
      const leads = this.leads.filter((lead) => lead.brandId === brandId && lead.assignee === member.displayName);
      const deals = leads.filter((lead) => lead.stageId === 'deal').length;
      const lost = leads.filter((lead) => lead.stageId === 'lost').length;
      return {
        ...member,
        assignedLeads: leads.length,
        openLeads: leads.filter((lead) => !['deal', 'lost'].includes(lead.stageId)).length,
        deals,
        lost,
        conversionRate: deals + lost ? Math.round((deals / (deals + lost)) * 100) : 0,
        pipelineValue: leads.filter((lead) => !['deal', 'lost'].includes(lead.stageId)).reduce((sum, lead) => sum + lead.estimatedValue, 0),
      };
    }).sort((a, b) => b.deals - a.deals || b.assignedLeads - a.assignedLeads);
  }

  listSchedules(): Schedule[] {
    return structuredClone(schedules);
  }

  listLeads(brandId: number, assigneeUserId?: number): Lead[] {
    return structuredClone(this.leads.filter((lead) => lead.brandId === brandId && (!assigneeUserId || lead.assigneeUserId === assigneeUserId)));
  }

  getLead(brandId: number, leadId: string): Lead | null {
    const lead = this.leads.find((item) => item.brandId === brandId && item.id === leadId);
    return lead ? structuredClone(lead) : null;
  }

  updateLead(
    brandId: number,
    leadId: string,
    updates: Partial<Lead>,
    _expectedVersion?: number,
    _actor?: string,
    _correlationId?: string,
  ): Lead | null {
    const index = this.leads.findIndex((lead) => lead.brandId === brandId && lead.id === leadId);
    const current = this.leads[index];
    if (index < 0 || !current) return null;
    const protectedFields = ['id', 'brandId', 'erpBookingId', 'erpJamaahId', 'erpPaymentId'] as const;
    const safeUpdates = { ...updates };
    for (const field of protectedFields) delete safeUpdates[field];
    const updated: Lead = {
      ...current,
      ...safeUpdates,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.leads[index] = updated;
    const conversation = this.conversations.find((item) => item.brandId === brandId && item.leadId === leadId);
    if (conversation) {
      conversation.name = updated.name;
      conversation.assignee = updated.assignee;
      conversation.tags = updated.tags;
    }
    return structuredClone(updated);
  }

  moveLead(
    brandId: number,
    leadId: string,
    stageId: string,
    actor: string,
    lostReason?: string,
    _correlationId?: string,
  ): Lead | null {
    if (stageId === 'deal') throw new Error('DEAL_FLOW_REQUIRED');
    const lead = this.updateLead(brandId, leadId, { stageId, stageAgeDays: 0 });
    if (!lead) return null;
    const stage = defaultStages.find((item) => item.id === stageId);
    this.activities.unshift({
      id: `act-${crypto.randomUUID()}`,
      type: 'stage',
      title: `${lead.name} pindah ke ${stage?.name ?? stageId}`,
      description: stageId === 'lost' ? lostReason ?? '' : 'Tahap pipeline diperbarui.',
      actor,
      occurredAt: new Date().toISOString(),
      leadId,
    });
    return lead;
  }

  listConversations(brandId: number, assigneeUserId?: number): Conversation[] {
    return structuredClone(
      this.conversations
        .filter((conversation) => conversation.brandId === brandId && (!assigneeUserId || conversation.assigneeUserId === assigneeUserId))
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    );
  }

  listMessages(brandId: number, conversationId: string): Message[] | null {
    const conversation = this.conversations.find(
      (item) => item.brandId === brandId && item.id === conversationId,
    );
    if (!conversation) return null;
    conversation.unread = 0;
    const lead = this.leads.find((item) => item.brandId === brandId && item.id === conversation.leadId);
    if (lead) lead.unread = 0;
    return structuredClone(
      this.messages
        .filter((message) => message.conversationId === conversationId)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    );
  }

  messageBelongsToAssignee(brandId: number, messageId: string, assigneeUserId: number): boolean {
    const message = this.messages.find((item) => item.id === messageId);
    const conversation = message ? this.conversations.find((item) => item.id === message.conversationId && item.brandId === brandId) : undefined;
    return Boolean(conversation?.assigneeUserId === assigneeUserId);
  }

  addMessage(
    brandId: number,
    conversationId: string,
    body: string,
    whatsappMessageId = `msg-${crypto.randomUUID()}`,
    status: Message['status'] = 'sent',
  ): Message | null {
    const conversation = this.conversations.find(
      (item) => item.brandId === brandId && item.id === conversationId,
    );
    if (!conversation) return null;
    const message: Message = {
      id: whatsappMessageId,
      conversationId,
      direction: 'outbound',
      type: 'text',
      body,
      sentAt: new Date().toISOString(),
      status,
    };
    this.messages.push(message);
    conversation.lastMessage = body;
    conversation.lastMessageAt = message.sentAt;
    return structuredClone(message);
  }

  ingestIncoming(input: {
    brandId: number;
    messageId: string;
    jid?: string;
    phone: string;
    name: string;
    body: string;
    occurredAt: string;
  }): { conversation: Conversation; lead: Lead; message: Message } {
    const duplicate = this.messages.find((message) => message.id === input.messageId);
    if (duplicate) {
      const conversation = this.conversations.find((item) => item.id === duplicate.conversationId)!;
      const lead = this.leads.find((item) => item.id === conversation.leadId)!;
      return { conversation: structuredClone(conversation), lead: structuredClone(lead), message: structuredClone(duplicate) };
    }

    let conversation = this.conversations.find(
      (item) => item.brandId === input.brandId && item.phone === input.phone,
    );
    let lead = conversation
      ? this.leads.find((item) => item.brandId === input.brandId && item.id === conversation?.leadId)
      : undefined;

    if (!conversation || !lead) {
      const suffix = crypto.randomUUID();
      const leadId = `lead-${suffix}`;
      const conversationId = `conv-${suffix}`;
      lead = {
        id: leadId,
        brandId: input.brandId,
        contactId: `contact-${suffix}`,
        conversationId,
        name: input.name || input.phone,
        phone: input.phone,
        email: '',
        city: '',
        source: 'WhatsApp',
        stageId: 'new',
        assignee: 'Belum ditugaskan',
        scheduleId: null,
        scheduleName: '',
        departurePlan: '',
        roomType: 'Quad',
        pax: 1,
        estimatedValue: 0,
        nextFollowUp: '',
        notes: '',
        tags: [],
        unread: 1,
        stageAgeDays: 0,
        version: 1,
        updatedAt: input.occurredAt,
      };
      conversation = {
        id: conversationId,
        brandId: input.brandId,
        leadId,
        name: lead.name,
        phone: input.phone,
        avatarSeed: lead.name,
        lastMessage: input.body,
        lastMessageAt: input.occurredAt,
        unread: 1,
        assignee: lead.assignee,
        tags: [],
        online: false,
      };
      this.leads.push(lead);
      this.conversations.push(conversation);
    } else {
      conversation.lastMessage = input.body;
      conversation.lastMessageAt = input.occurredAt;
      conversation.unread += 1;
      lead.unread += 1;
      lead.updatedAt = input.occurredAt;
    }

    const message: Message = {
      id: input.messageId,
      conversationId: conversation.id,
      direction: 'inbound',
      type: 'text',
      body: input.body,
      sentAt: input.occurredAt,
      status: 'delivered',
    };
    this.messages.push(message);
    return {
      conversation: structuredClone(conversation),
      lead: structuredClone(lead),
      message: structuredClone(message),
    };
  }

  processDeal(brandId: number, leadId: string, request: DealRequest, idempotencyKey: string): DealResult | null {
    const cached = this.conversions.get(`${brandId}:${leadId}:${idempotencyKey}`);
    if (cached) return structuredClone(cached);
    const leadIndex = this.leads.findIndex((item) => item.brandId === brandId && item.id === leadId);
    const lead = this.leads[leadIndex];
    if (leadIndex < 0 || !lead) return null;
    const schedule = schedules.find((item) => item.id === request.scheduleId);
    if (!schedule) throw new Error('SCHEDULE_NOT_FOUND');
    if (schedule.seatRemaining < request.pax) throw new Error('SEAT_UNAVAILABLE');

    const substatus = request.commitmentType === 'book_seat'
      ? 'book_seat'
      : request.commitmentType === 'dp'
        ? 'dp_pending'
        : 'paid';
    // The public update path intentionally rejects ERP identifiers. Deal conversion is
    // the only internal workflow allowed to attach those identifiers to a lead.
    const updated: Lead = {
      ...lead,
      stageId: 'deal',
      stageAgeDays: 0,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      roomType: request.roomType,
      pax: request.pax,
      estimatedValue: schedule.prices[request.roomType] * request.pax,
      dealSubstatus: substatus,
      erpJamaahId: 1_200 + this.conversions.size,
      erpBookingId: 9_100 + this.conversions.size,
      ...(request.commitmentType !== 'book_seat' ? { erpPaymentId: 5_100 + this.conversions.size } : {}),
      version: lead.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.leads[leadIndex] = updated;

    const result: DealResult = {
      lead: updated,
      conversionId: `conversion-${crypto.randomUUID()}`,
      status: 'completed',
      message: request.commitmentType === 'book_seat'
        ? 'Booking fixture dibuat dan seat berhasil ditahan.'
        : request.commitmentType === 'dp'
          ? 'Booking fixture dibuat. DP menunggu verifikasi.'
          : 'Booking fixture dan pembayaran lunas berhasil dicatat.',
    };
    this.conversions.set(`${brandId}:${leadId}:${idempotencyKey}`, result);
    this.activities.unshift({
      id: `act-${crypto.randomUUID()}`,
      type: 'deal',
      title: `${updated.name} berhasil diproses sebagai Deal`,
      description: result.message,
      actor: 'Admin Test',
      occurredAt: new Date().toISOString(),
      leadId,
    });
    return structuredClone(result);
  }

  dashboard(brandId: number, period: DashboardPeriod = 'month', assigneeUserId?: number): DashboardMetrics {
    const leads = this.leads.filter((lead) => lead.brandId === brandId && (!assigneeUserId || lead.assigneeUserId === assigneeUserId));
    const periodMs = period === 'today' ? 24 * 60 * 60 * 1_000 : period === 'week' ? 7 * 24 * 60 * 60 * 1_000 : period === 'month' ? 30 * 24 * 60 * 60 * 1_000 : null;
    const cutoff = periodMs ? Date.now() - periodMs : 0;
    const periodLeads = leads.filter((lead) => new Date(lead.createdAt ?? lead.updatedAt).getTime() >= cutoff);
    const deals = leads.filter((lead) => lead.stageId === 'deal' && new Date(lead.updatedAt).getTime() >= cutoff).length;
    const lost = leads.filter((lead) => lead.stageId === 'lost' && new Date(lead.updatedAt).getTime() >= cutoff).length;
    const closed = deals + lost;
    return {
      newLeads: periodLeads.length,
      unread: leads.reduce((total, lead) => total + lead.unread, 0),
      deals,
      lost,
      conversionRate: closed > 0 ? Math.round((deals / closed) * 100) : Math.round((deals / leads.length) * 100),
      medianFirstResponseMinutes: 7,
      pipelineValue: leads
        .filter((lead) => !['deal', 'lost'].includes(lead.stageId))
        .reduce((total, lead) => total + lead.estimatedValue, 0),
      stageDistribution: defaultStages.map((stage) => ({
        stageId: stage.id,
        count: leads.filter((lead) => lead.stageId === stage.id).length,
      })),
      activities: structuredClone(this.activities.filter((activity) => new Date(activity.occurredAt).getTime() >= cutoff).slice(0, 5)),
    };
  }

  listActivities(brandId: number, limit = 100, assigneeUserId?: number): Activity[] {
    const leadIds = new Set(this.leads.filter((lead) => lead.brandId === brandId && (!assigneeUserId || lead.assigneeUserId === assigneeUserId)).map((lead) => lead.id));
    return structuredClone(this.activities.filter((activity) => !activity.leadId || leadIds.has(activity.leadId)).slice(0, Math.max(1, Math.min(limit, 200))));
  }
}
