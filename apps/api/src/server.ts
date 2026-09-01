import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import pino from 'pino';
import { Server as SocketServer } from 'socket.io';
import { z } from 'zod';
import type { ApiErrorShape, Lead, UserContext } from '@azhan-crm/contracts';
import { createDatabasePool, DealConflictError, DistributionValidationError, MySqlCrmStore, VersionConflictError, type Pool } from '@azhan-crm/database';
import { config } from './config.js';
import { TestFixtureStore } from './test-fixture-store.js';
import { EncryptedMysqlSessionStore } from './encrypted-session-store.js';
import { ErpGateway, ErpGatewayError } from './erp/gateway.js';
import { BaileysWhatsAppGateway } from './whatsapp/baileys-gateway.js';
import { TestFixtureWhatsAppGateway } from './whatsapp/test-fixture-gateway.js';
import type { WhatsAppGateway } from './whatsapp/gateway.js';
import { normalizeIndonesianPhone } from './phone.js';

const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.accessToken', '*.refreshToken', '*.qrDataUrl'],
});
const databasePool: Pool | null = config.testFixtures ? null : createDatabasePool(config.databaseUrl!);
let store: TestFixtureStore | MySqlCrmStore = config.testFixtures ? new TestFixtureStore() : new MySqlCrmStore(databasePool!);
const erp = new ErpGateway(config.erpApiBaseUrl);
const whatsapp: WhatsAppGateway = config.testFixtures
  ? new TestFixtureWhatsAppGateway()
  : new BaileysWhatsAppGateway(
	config.waAuthPath,
	config.waAuthDriver,
	databasePool ?? undefined,
	config.sessionEncryptionKey,
	logger,
  );
const outboxWorkerId = `crm-api-${process.pid}-${crypto.randomUUID()}`;
let outboxRunning = false;
const metrics = {
  startedAt: Date.now(),
  dealAttempts: 0,
  dealCompleted: 0,
  dealFailed: 0,
  dealLatencyMsTotal: 0,
  outboundSent: 0,
  outboundRetried: 0,
  outboxWorkerFailures: 0,
};

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: config.corsOrigins, credentials: true },
});

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
const sessionOptions: session.SessionOptions = {
    name: 'azhan_crm_session',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    },
    ...(databasePool ? { store: new EncryptedMysqlSessionStore(databasePool, config.sessionEncryptionKey) } : {}),
};
const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use((request, response, next) => {
  const startedAt = performance.now();
  const correlationId = request.header('x-correlation-id') ?? crypto.randomUUID();
  response.setHeader('x-correlation-id', correlationId);
  response.locals.correlationId = correlationId;
  response.once('finish', () => logger.info({
    eventType: 'http_request',
    method: request.method,
    path: request.path,
    statusCode: response.statusCode,
    durationMs: Math.round(performance.now() - startedAt),
    correlationId,
    brandId: request.session?.user?.brand?.id,
  }, 'HTTP request completed'));
  next();
});

const rateLimitKey = (request: Request) => ipKeyGenerator(
  request.ip ?? request.socket.remoteAddress ?? '127.0.0.1',
);

const mutationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: rateLimitKey,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

function testUser(): UserContext {
  return {
    id: 1,
    name: 'Admin Test',
    email: 'admin@test.azhan.test',
    role: 'manager',
    brand: { id: 1, name: 'Nava Tour', primaryColor: '#CC904A' },
  };
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
  retryable = false,
  fieldErrors: Array<{ field: string; message: string }> = [],
) {
  const payload: ApiErrorShape = {
    error: {
      code,
      message,
      correlation_id: String(response.locals.correlationId),
      retryable,
      field_errors: fieldErrors,
    },
  };
  response.status(status).json(payload);
}

function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (!request.session.user) {
    sendError(response, 401, 'UNAUTHORIZED', 'Silakan masuk untuk melanjutkan.');
    return;
  }
  next();
}

function requireBrand(request: Request, response: Response, next: NextFunction) {
  if (!request.session.user) {
    sendError(response, 401, 'UNAUTHORIZED', 'Silakan masuk untuk melanjutkan.');
    return;
  }
  if (!request.session.user.brand) {
    sendError(response, 409, 'BRAND_REQUIRED', 'Pilih brand sebelum membuka data CRM.');
    return;
  }
  next();
}

function requireManager(request: Request, response: Response, next: NextFunction) {
  if (!request.session.user) {
    sendError(response, 401, 'UNAUTHORIZED', 'Silakan masuk untuk melanjutkan.');
    return;
  }
  if (request.session.user.role === 'sales') {
    sendError(response, 403, 'MANAGER_REQUIRED', 'Fitur ini hanya dapat diakses Admin CRM.');
    return;
  }
  next();
}

function brandId(request: Request): number {
  const id = request.session.user?.brand?.id;
  if (!id) throw new Error('Brand context is required');
  return id;
}

function assigneeScope(request: Request): number | undefined {
  return request.session.user?.role === 'sales' ? request.session.user.id : undefined;
}

function canAccessLead(request: Request, lead: Lead): boolean {
  const scopedUserId = assigneeScope(request);
  return !scopedUserId || lead.assigneeUserId === scopedUserId;
}

async function canAccessConversation(request: Request, conversationId: string): Promise<boolean> {
  return (await store.listConversations(brandId(request), assigneeScope(request))).some((item) => item.id === conversationId);
}

async function canAccessMessage(request: Request, messageId: string): Promise<boolean> {
  const scopedUserId = assigneeScope(request);
  return !scopedUserId || store.messageBelongsToAssignee(brandId(request), messageId, scopedUserId);
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
}

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
}

async function refreshErpSession(request: Request): Promise<string> {
  if (!request.session.refreshToken) throw new ErpGatewayError(401, 'SESSION_EXPIRED', 'Sesi ERP telah berakhir. Silakan masuk kembali.', false);
  const tokens = await erp.refresh(request.session.refreshToken);
  request.session.accessToken = tokens.access_token;
  request.session.refreshToken = tokens.refresh_token ?? request.session.refreshToken;
  request.session.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1_000;
  await saveSession(request);
  return tokens.access_token;
}

async function withErpAccessToken<T>(request: Request, operation: (accessToken: string) => Promise<T>): Promise<T> {
  let accessToken = request.session.accessToken;
  if (!accessToken || (request.session.accessTokenExpiresAt ?? 0) <= Date.now() + 60_000) {
    accessToken = await refreshErpSession(request);
  }
  try {
    return await operation(accessToken);
  } catch (error) {
    if (!(error instanceof ErpGatewayError) || error.status !== 401) throw error;
    return operation(await refreshErpSession(request));
  }
}

async function syncLeadPayment(request: Request, response: Response, lead: Lead): Promise<Lead> {
  if (config.testFixtures || !lead.erpBookingId || !lead.erpPaymentId || !['dp_pending', 'dp_rejected'].includes(lead.dealSubstatus ?? '')) return lead;
  try {
    const payments = await withErpAccessToken(request, (token) => erp.listBookingPayments(
      token,
      lead.erpBookingId!,
      String(response.locals.correlationId),
    ));
    const payment = payments.find((item) => item.id === lead.erpPaymentId);
    if (!payment) return lead;
    return await (store as MySqlCrmStore).syncPaymentStatus(
      brandId(request),
      lead.id,
      payment.id,
      payment.status,
      payment.rejection_reason ?? null,
      request.session.user?.name ?? 'ERP Sync',
      String(response.locals.correlationId),
    ) ?? lead;
  } catch (error) {
    logger.warn({
      err: error,
      eventType: 'payment_sync_failed',
      brandId: brandId(request),
      entityId: lead.id,
      correlationId: response.locals.correlationId,
    }, 'ERP payment status sync failed');
    return lead;
  }
}

function moveSessionSockets(sessionId: string, activeBrandId: number) {
  for (const socket of io.of('/').sockets.values()) {
    if (socket.data.sessionId !== sessionId) continue;
    for (const room of socket.rooms) {
      if (room.startsWith('brand:')) socket.leave(room);
    }
    socket.join(`brand:${activeBrandId}`);
    socket.emit('context.changed', { brandId: activeBrandId });
  }
}

function disconnectSessionSockets(sessionId: string) {
  for (const socket of io.of('/').sockets.values()) {
    if (socket.data.sessionId === sessionId) socket.disconnect(true);
  }
}

async function persistIncomingMedia(brand: number, media: { data: Buffer; fileName: string }): Promise<string> {
  const extension = extname(media.fileName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const relativeKey = `${brand}/${crypto.randomUUID()}${extension}`;
  const brandDirectory = resolve(config.mediaStoragePath, String(brand));
  await mkdir(brandDirectory, { recursive: true });
  await writeFile(resolve(config.mediaStoragePath, relativeKey), media.data, { flag: 'wx' });
  return relativeKey;
}

function resolveMediaPath(objectKey: string): string | null {
  const root = resolve(config.mediaStoragePath);
  const target = resolve(root, objectKey);
  return target.startsWith(`${root}${sep}`) ? target : null;
}

app.get('/health', async (_request, response) => {
  let database = config.testFixtures ? 'not_required' : 'connected';
  let erpStatus = config.testFixtures ? 'not_required' : 'connected';
  if (databasePool) {
    try {
      await databasePool.query('SELECT 1');
    } catch {
      database = 'disconnected';
    }
  }
  if (!config.testFixtures) {
    try {
      const erpHealth = await fetch(`${config.erpApiBaseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (!erpHealth.ok) erpStatus = 'disconnected';
    } catch {
      erpStatus = 'disconnected';
    }
  }
  const degraded = database === 'disconnected' || erpStatus === 'disconnected';
  response.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    mode: config.testFixtures ? 'test' : 'integration',
    database,
    erp: erpStatus,
    outboxWorker: config.testFixtures ? 'not_required' : outboxRunning ? 'processing' : 'ready',
    whatsapp: config.testFixtures ? 'test' : 'tenant_scoped',
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', (_request, response) => response.json({
  uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1_000),
  deal: {
    attempts: metrics.dealAttempts,
    completed: metrics.dealCompleted,
    failed: metrics.dealFailed,
    averageLatencyMs: metrics.dealAttempts ? Math.round(metrics.dealLatencyMsTotal / metrics.dealAttempts) : 0,
  },
  outbound: {
    sent: metrics.outboundSent,
    retried: metrics.outboundRetried,
    workerFailures: metrics.outboxWorkerFailures,
    workerBusy: outboxRunning,
  },
}));

// Fixture endpoints exist only while NODE_ENV=test and TEST_FIXTURES=true.
app.post('/api/v1/test/reset', (_request, response) => {
  if (!config.testFixtures) {
    sendError(response, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan.');
    return;
  }
  store = new TestFixtureStore();
  response.status(204).end();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: rateLimitKey,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

app.post('/api/v1/auth/test', authLimiter, async (request, response) => {
  if (!config.testFixtures) {
    sendError(response, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan.');
    return;
  }
  await regenerateSession(request);
  request.session.user = testUser();
  response.json(request.session.user);
});

app.post('/api/v1/auth/login', authLimiter, async (request, response) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) {
    sendError(response, 400, 'VALIDATION_ERROR', 'Email atau password belum valid.');
    return;
  }
  try {
    const tokens = await erp.login(parsed.data.email, parsed.data.password);
    const myBrand = await erp.getMyBrand(tokens.access_token);
    const availableBrands = myBrand ? [] : await erp.listBrands(tokens.access_token);
    const user: UserContext = {
      id: tokens.user_id,
      name: tokens.display_name || parsed.data.email.split('@')[0] || 'Admin',
      email: parsed.data.email,
      role: tokens.role === 'cs' ? 'sales' : myBrand ? 'manager' : 'super_admin',
      brand: myBrand,
      ...(availableBrands.length ? { availableBrands } : {}),
    };
	await regenerateSession(request);
    request.session.user = user;
    request.session.accessToken = tokens.access_token;
    request.session.refreshToken = tokens.refresh_token;
	request.session.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1_000;
    request.session.availableBrands = availableBrands;
    response.json(user);
  } catch (error) {
    if (error instanceof ErpGatewayError) {
      sendError(response, error.status, error.code, error.message, error.retryable);
      return;
    }
    sendError(response, 500, 'LOGIN_FAILED', 'Login belum berhasil.');
  }
});

app.post('/api/v1/auth/select-brand', requireAuth, async (request, response) => {
  const parsed = z.object({ brandId: z.number().int().positive() }).safeParse(request.body);
  if (!parsed.success || request.session.user?.role !== 'super_admin') {
    sendError(response, 403, 'FORBIDDEN', 'Brand tidak dapat dipilih.');
    return;
  }
  try {
    const availableBrands = config.testFixtures
      ? request.session.availableBrands ?? []
      : await withErpAccessToken(request, (token) => erp.listBrands(token));
    const brand = availableBrands.find((item) => item.id === parsed.data.brandId);
    if (!brand) return sendError(response, 404, 'BRAND_NOT_FOUND', 'Brand tidak ditemukan atau akses sudah dicabut.');
    request.session.availableBrands = availableBrands;
    request.session.user = { ...request.session.user, brand, availableBrands };
    if (!config.testFixtures) await (store as MySqlCrmStore).ensureBrand(brand.id);
    await saveSession(request);
    moveSessionSockets(request.sessionID, brand.id);
    response.json(request.session.user);
  } catch (error) {
    if (error instanceof ErpGatewayError) return sendError(response, error.status, error.code, error.message, error.retryable);
    throw error;
  }
});

app.post('/api/v1/auth/refresh', requireAuth, async (request, response) => {
  if (config.testFixtures) return response.json(request.session.user);
  try {
    await refreshErpSession(request);
    response.json(request.session.user);
  } catch (error) {
    request.session.destroy(() => undefined);
    if (error instanceof ErpGatewayError) return sendError(response, 401, 'SESSION_EXPIRED', 'Sesi ERP telah berakhir. Silakan masuk kembali.');
    throw error;
  }
});

app.post('/api/v1/auth/logout', requireAuth, (request, response) => {
	const sessionId = request.sessionID;
  request.session.destroy((error) => {
    if (error) return sendError(response, 500, 'LOGOUT_FAILED', 'Sesi belum dapat diakhiri.');
	disconnectSessionSockets(sessionId);
    response.clearCookie('azhan_crm_session');
    response.status(204).end();
  });
});

app.get('/api/v1/context', requireAuth, (request, response) => response.json(request.session.user));

app.get('/api/v1/dashboard', requireBrand, async (request, response) => {
  const period = z.enum(['today', 'week', 'month', 'all']).catch('month').parse(request.query.period);
  response.json(await store.dashboard(brandId(request), period, assigneeScope(request)));
});
app.get('/api/v1/activities', requireBrand, async (request, response) => {
  const parsed = z.coerce.number().int().min(1).max(200).safeParse(request.query.limit ?? 100);
  if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Batas aktivitas belum valid.');
  response.json(await store.listActivities(brandId(request), parsed.data, assigneeScope(request)));
});

async function loadTeam(request: Request) {
  const activeBrandId = brandId(request);
  if (config.testFixtures) return store.listTeamMembers(activeBrandId);
  const users = await withErpAccessToken(request, (token) => erp.listCrmUsers(token, activeBrandId));
  return store.syncTeamMembers(activeBrandId, users.map((user) => ({
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    isActive: user.is_active,
  })));
}

app.get('/api/v1/team', requireBrand, requireManager, async (request, response) => {
  try {
    response.json(await loadTeam(request));
  } catch (error) {
    if (error instanceof ErpGatewayError) return sendError(response, error.status, error.code, error.message, error.retryable);
    throw error;
  }
});

app.post('/api/v1/team', requireBrand, requireManager, mutationLimiter, async (request, response) => {
  const parsed = z.object({
    email: z.string().email(),
    displayName: z.string().trim().min(2).max(120),
    password: z.string().min(8).max(200),
  }).safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Data akun CS belum valid.');
  if (config.testFixtures) return sendError(response, 409, 'TEST_READ_ONLY', 'Pembuatan akun tidak tersedia pada fixture pengujian.');
  try {
    const activeBrandId = brandId(request);
    const created = await withErpAccessToken(request, (token) => erp.createCrmUser(token, activeBrandId, parsed.data));
    const members = await loadTeam(request);
    response.status(201).json(members.find((member) => member.userId === created.id));
  } catch (error) {
    if (error instanceof ErpGatewayError) return sendError(response, error.status, error.code, error.message, error.retryable);
    throw error;
  }
});

app.put('/api/v1/team/distribution', requireBrand, requireManager, mutationLimiter, async (request, response) => {
  const parsed = z.object({ allocations: z.array(z.object({
    userId: z.number().int().positive(),
    percent: z.number().int().min(1).max(100),
  })).min(1).max(100) }).safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Pembagian lead belum valid.');
  try {
    response.json(await store.setTeamDistribution(brandId(request), parsed.data.allocations));
  } catch (error) {
    if (error instanceof DistributionValidationError) return sendError(response, 400, 'INVALID_DISTRIBUTION', error.message);
    throw error;
  }
});

app.put('/api/v1/team/:id', requireBrand, requireManager, mutationLimiter, async (request, response) => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
  const body = z.object({
    email: z.string().email(),
    displayName: z.string().trim().min(2).max(120),
    isActive: z.boolean(),
  }).safeParse(request.body);
  if (!params.success || !body.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Data akun CS belum valid.');
  if (config.testFixtures) return sendError(response, 409, 'TEST_READ_ONLY', 'Perubahan akun tidak tersedia pada fixture pengujian.');
  try {
    const activeBrandId = brandId(request);
    await withErpAccessToken(request, (token) => erp.updateCrmUser(token, activeBrandId, params.data.id, body.data));
    const members = await loadTeam(request);
    response.json(members.find((member) => member.userId === params.data.id));
  } catch (error) {
    if (error instanceof ErpGatewayError) return sendError(response, error.status, error.code, error.message, error.retryable);
    throw error;
  }
});

app.put('/api/v1/team/:id/password', requireBrand, requireManager, mutationLimiter, async (request, response) => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
  const body = z.object({ password: z.string().min(8).max(200) }).safeParse(request.body);
  if (!params.success || !body.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Password minimal 8 karakter.');
  if (config.testFixtures) return sendError(response, 409, 'TEST_READ_ONLY', 'Reset password tidak tersedia pada fixture pengujian.');
  try {
    await withErpAccessToken(request, (token) => erp.resetCrmUserPassword(token, brandId(request), params.data.id, body.data.password));
    response.status(204).end();
  } catch (error) {
    if (error instanceof ErpGatewayError) return sendError(response, error.status, error.code, error.message, error.retryable);
    throw error;
  }
});

app.get('/api/v1/team/performance', requireBrand, requireManager, async (request, response) => {
  const period = z.enum(['today', 'week', 'month', 'all']).catch('month').parse(request.query.period);
  response.json(await store.teamPerformance(brandId(request), period));
});

app.get('/api/v1/stages', requireBrand, async (request, response) => response.json(await store.listStages(brandId(request))));
app.get('/api/v1/schedules', requireBrand, async (request, response) => {
  if (config.testFixtures) {
    response.json((store as TestFixtureStore).listSchedules());
    return;
  }
  try {
    response.json(await withErpAccessToken(request, (token) => erp.listSchedules(token)));
  } catch (error) {
    if (error instanceof ErpGatewayError) {
      sendError(response, error.status, error.code, error.message, error.retryable);
      return;
    }
    sendError(response, 500, 'SCHEDULES_FAILED', 'Jadwal belum dapat dimuat.');
  }
});

app.get('/api/v1/contacts', requireBrand, async (request, response) => {
  response.json(await store.listContacts(brandId(request), assigneeScope(request)));
});

app.post('/api/v1/contacts/import', requireBrand, requireManager, mutationLimiter, async (request, response) => {
  const parsed = z.object({ contacts: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(6).max(30),
  })).min(1).max(1_000) }).safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Daftar kontak belum valid. Gunakan format nama|nomorhp.');
  const contacts = parsed.data.contacts.map((contact) => ({
    name: contact.name,
    phone: normalizeIndonesianPhone(contact.phone),
  }));
  const invalid = contacts
    .map((contact, index) => ({ contact, index }))
    .filter(({ contact }) => !/^\+[1-9]\d{7,14}$/.test(contact.phone));
  if (invalid.length) {
    return sendError(response, 400, 'INVALID_PHONE', 'Ada nomor telepon yang belum valid.', false,
      invalid.slice(0, 20).map(({ index }) => ({ field: `contacts.${index}.phone`, message: `Nomor pada baris ${index + 1} belum valid.` })));
  }
  response.status(201).json(await store.importContacts(brandId(request), contacts));
});

app.get('/api/v1/leads', requireBrand, async (request, response) => {
  const leads = await store.listLeads(brandId(request), assigneeScope(request));
  const synchronized: Lead[] = [];
  for (const lead of leads) synchronized.push(await syncLeadPayment(request, response, lead));
  response.json(synchronized);
});
app.get('/api/v1/leads/:id', requireBrand, async (request, response) => {
  const lead = await store.getLead(brandId(request), String(request.params.id));
  if (!lead || !canAccessLead(request, lead)) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
  response.json(await syncLeadPayment(request, response, lead));
});

app.post('/api/v1/leads/:id/sync-payment', requireBrand, mutationLimiter, async (request, response) => {
  const lead = await store.getLead(brandId(request), String(request.params.id));
  if (!lead || !canAccessLead(request, lead)) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
  response.json(await syncLeadPayment(request, response, lead));
});

const editableLeadSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  city: z.string().max(100).optional(),
  source: z.string().max(100).optional(),
  assignee: z.string().max(100).optional(),
  scheduleId: z.number().int().positive().nullable().optional(),
  scheduleName: z.string().max(180).optional(),
  departurePlan: z.string().max(120).optional(),
  roomType: z.enum(['Quad', 'Triple', 'Double']).optional(),
  pax: z.number().int().min(1).max(20).optional(),
  estimatedValue: z.number().min(0).optional(),
  nextFollowUp: z.string().max(50).optional(),
  notes: z.string().max(2_000).optional(),
  version: z.number().int().positive(),
});

app.put('/api/v1/leads/:id', requireBrand, mutationLimiter, async (request, response) => {
  const parsed = editableLeadSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(response, 400, 'VALIDATION_ERROR', 'Periksa kembali data lead.');
  }
  const current = await store.getLead(brandId(request), String(request.params.id));
  if (!current || !canAccessLead(request, current)) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
  if (request.session.user?.role === 'sales' && parsed.data.assignee !== undefined) {
    return sendError(response, 403, 'ASSIGNMENT_FORBIDDEN', 'CS tidak dapat mengubah PIC lead.');
  }
  if (current.version !== parsed.data.version) {
    return sendError(response, 409, 'VERSION_CONFLICT', 'Data lead berubah. Muat ulang sebelum menyimpan.');
  }
  const { version: _version, ...updates } = parsed.data;
  try {
    response.json(await store.updateLead(
      brandId(request),
      current.id,
      updates as Partial<Lead>,
      parsed.data.version,
      request.session.user?.name ?? 'Admin',
      String(response.locals.correlationId),
    ));
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return sendError(response, 409, 'VERSION_CONFLICT', 'Data lead berubah. Muat ulang sebelum menyimpan.');
    }
    throw error;
  }
});

app.put('/api/v1/leads/:id/stage', requireBrand, mutationLimiter, async (request, response) => {
  const parsed = z.object({ stageId: z.string().min(1), lostReason: z.string().min(3).optional() }).safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Tahap belum valid.');
  if (parsed.data.stageId === 'lost' && !parsed.data.lostReason) {
    return sendError(response, 400, 'LOST_REASON_REQUIRED', 'Alasan Lost wajib diisi.');
  }
  const current = await store.getLead(brandId(request), String(request.params.id));
  if (!current || !canAccessLead(request, current)) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
  try {
    const lead = await store.moveLead(
      brandId(request),
      String(request.params.id),
      parsed.data.stageId,
      request.session.user?.name ?? 'Admin',
      parsed.data.lostReason,
      String(response.locals.correlationId),
    );
    if (!lead) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
    response.json(lead);
  } catch (error) {
    if (error instanceof Error && error.message === 'DEAL_FLOW_REQUIRED') {
      return sendError(response, 409, 'DEAL_FLOW_REQUIRED', 'Gunakan Proses Deal untuk memindahkan lead ke Deal.');
    }
    throw error;
  }
});

const dealSchema = z.object({
  scheduleId: z.number().int().positive(),
  roomType: z.enum(['Quad', 'Triple', 'Double']),
  pax: z.number().int().min(1).max(20),
  commitmentType: z.enum(['book_seat', 'dp', 'lunas']),
  seatHoldExpiresAt: z.string().optional(),
  paymentAmount: z.number().positive().optional(),
  paymentMethod: z.string().optional(),
  paymentDate: z.string().optional(),
	 paymentProofUrl: z.string().url().optional(),
}).superRefine((value, context) => {
  if (value.commitmentType === 'book_seat' && !value.seatHoldExpiresAt) {
    context.addIssue({ code: 'custom', path: ['seatHoldExpiresAt'], message: 'Batas Book Seat wajib diisi.' });
  }
  if (value.commitmentType !== 'book_seat' && !value.paymentAmount) {
    context.addIssue({ code: 'custom', path: ['paymentAmount'], message: 'Nominal pembayaran wajib diisi.' });
  }
});

app.post('/api/v1/leads/:id/deal', requireBrand, mutationLimiter, async (request, response) => {
  const idempotencyKey = request.header('idempotency-key');
  if (!idempotencyKey) return sendError(response, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Kunci proses Deal tidak tersedia.');
  const parsed = dealSchema.safeParse(request.body);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
    return sendError(response, 400, 'VALIDATION_ERROR', 'Lengkapi data proses Deal.', false, fields);
  }
  const current = await store.getLead(brandId(request), String(request.params.id));
  if (!current || !canAccessLead(request, current)) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
  const dealStartedAt = performance.now();
  metrics.dealAttempts += 1;
  response.once('finish', () => {
    metrics.dealLatencyMsTotal += performance.now() - dealStartedAt;
    if (response.statusCode < 400) metrics.dealCompleted += 1;
    else metrics.dealFailed += 1;
  });
  try {
    const dealRequest = {
      scheduleId: parsed.data.scheduleId,
      roomType: parsed.data.roomType,
      pax: parsed.data.pax,
      commitmentType: parsed.data.commitmentType,
      ...(parsed.data.seatHoldExpiresAt ? { seatHoldExpiresAt: parsed.data.seatHoldExpiresAt } : {}),
      ...(parsed.data.paymentAmount ? { paymentAmount: parsed.data.paymentAmount } : {}),
      ...(parsed.data.paymentMethod ? { paymentMethod: parsed.data.paymentMethod } : {}),
      ...(parsed.data.paymentDate ? { paymentDate: parsed.data.paymentDate } : {}),
	  ...(parsed.data.paymentProofUrl ? { paymentProofUrl: parsed.data.paymentProofUrl } : {}),
    };
    if (config.testFixtures) {
      const result = (store as TestFixtureStore).processDeal(brandId(request), String(request.params.id), dealRequest, idempotencyKey);
      if (!result) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
      return response.json(result);
    }

    const persistentStore = store as MySqlCrmStore;
    const leadId = String(request.params.id);
    const prepared = await persistentStore.prepareDeal(brandId(request), leadId, dealRequest, idempotencyKey);
    if (!prepared) return sendError(response, 404, 'LEAD_NOT_FOUND', 'Lead tidak ditemukan.');
    if (prepared.replay) return response.json(prepared.replay);

    try {
      const erpResult = await withErpAccessToken(request, (token) => erp.processDeal(
        token, brandId(request), prepared.lead, dealRequest, idempotencyKey, String(response.locals.correlationId),
      ));
      const result = await persistentStore.completeDeal(
        brandId(request),
        leadId,
        prepared.conversionId,
        idempotencyKey,
        dealRequest,
        erpResult,
        request.session.user?.name ?? 'Admin',
        String(response.locals.correlationId),
      );
      return response.json(result);
    } catch (error) {
      const code = error instanceof ErpGatewayError ? error.code : 'DEAL_COMPLETION_FAILED';
      const message = error instanceof Error ? error.message : 'Proses Deal belum berhasil.';
      await persistentStore.failDeal(prepared.conversionId, code, message);
      throw error;
    }
  } catch (error) {
    if (error instanceof DealConflictError) {
      return sendError(response, 409, error.code, error.code === 'IDEMPOTENCY_CONFLICT'
        ? 'Kunci Deal digunakan dengan data berbeda.'
        : 'Lead ini sudah memiliki proses Deal. Gunakan retry pada proses yang sama.');
    }
    if (error instanceof ErpGatewayError) {
      return sendError(response, error.status, error.code, error.message, error.retryable);
    }
    if (error instanceof Error && error.message === 'SEAT_UNAVAILABLE') {
      return sendError(response, 409, 'SEAT_UNAVAILABLE', 'Seat pada jadwal ini tidak mencukupi.');
    }
    return sendError(response, 400, 'DEAL_FAILED', 'Proses Deal belum berhasil.');
  }
});

app.get('/api/v1/conversations', requireBrand, async (request, response) => {
  const currentBrandId = brandId(request);
  const conversations = await store.listConversations(currentBrandId, assigneeScope(request));
  response.json(conversations.map((conversation) => {
	const presence = whatsapp.getPresence(currentBrandId, conversation.phone);
	return {
	  ...conversation,
	  ...presence,
	  online: presence.presence !== 'offline',
	};
  }));
});
app.get('/api/v1/conversations/:id/avatar', requireBrand, async (request, response) => {
  const currentBrandId = brandId(request);
  const conversation = (await store.listConversations(currentBrandId, assigneeScope(request)))
	.find((item) => item.id === String(request.params.id));
  if (!conversation?.phoneResolved) return response.status(204).end();
  const picture = await whatsapp.getProfilePicture(currentBrandId, conversation.phone);
  if (!picture) return response.status(204).end();
  response.setHeader('Cache-Control', 'private, max-age=300');
  response.type(picture.mimeType).send(picture.data);
});
app.get('/api/v1/conversations/:id/messages', requireBrand, async (request, response) => {
  const currentBrandId = brandId(request);
  const conversationId = String(request.params.id);
  const allowed = (await store.listConversations(currentBrandId, assigneeScope(request))).some((item) => item.id === conversationId);
  if (!allowed) return sendError(response, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
  const transport = config.testFixtures
	? null
	: await (store as MySqlCrmStore).getConversationTransportContext(currentBrandId, conversationId);
  const messages = await store.listMessages(currentBrandId, conversationId);
  if (!messages) return sendError(response, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
  if (transport) {
	try {
	  await whatsapp.subscribePresence(currentBrandId, transport.phone);
	  if (transport.messageIds.length && whatsapp.getStatus(currentBrandId).status === 'connected') {
		await whatsapp.markRead(currentBrandId, transport.phone, transport.messageIds);
		await (store as MySqlCrmStore).markInboundMessagesRead(currentBrandId, conversationId, transport.messageIds);
	  }
	} catch (error) {
	  logger.warn({
		eventType: 'whatsapp_conversation_sync_failed',
		brandId: currentBrandId,
		errorName: error instanceof Error ? error.name : 'UnknownError',
	  }, 'WhatsApp presence/read synchronization failed');
	}
  }
  response.json(messages);
});

app.post('/api/v1/conversations/:id/presence', requireBrand, mutationLimiter, async (request, response) => {
  const parsed = z.object({ presence: z.enum(['composing', 'paused']) }).safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Status mengetik belum valid.');
  const currentBrandId = brandId(request);
  const conversation = (await store.listConversations(currentBrandId, assigneeScope(request)))
	.find((item) => item.id === String(request.params.id));
  if (!conversation) return sendError(response, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
  try {
	await whatsapp.sendPresence(currentBrandId, conversation.phone, parsed.data.presence);
	response.status(204).end();
  } catch (error) {
	sendError(response, 503, 'WHATSAPP_PRESENCE_FAILED', error instanceof Error ? error.message : 'Status mengetik belum terkirim.', true);
  }
});

app.post('/api/v1/conversations/:id/messages', requireBrand, mutationLimiter, async (request, response) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(4_000) }).safeParse(request.body);
  if (!parsed.success) return sendError(response, 400, 'VALIDATION_ERROR', 'Pesan tidak boleh kosong.');
  const conversation = (await store.listConversations(brandId(request), assigneeScope(request))).find((item) => item.id === String(request.params.id));
  if (!conversation) return sendError(response, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
  try {
	if (!config.testFixtures) {
	  const transport = await (store as MySqlCrmStore).getConversationTransportContext(brandId(request), conversation.id);
	  if (!transport) return sendError(response, 409, 'WHATSAPP_IDENTITY_SYNCING', 'Nomor WhatsApp kontak masih disinkronkan. Hubungkan ulang WhatsApp lalu tunggu histori selesai.');
	  const message = await (store as MySqlCrmStore).enqueueOutboundMessage(
		brandId(request), conversation.id, parsed.data.body,
	  );
	  if (!message) return sendError(response, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
	  io.to(`brand:${brandId(request)}`).emit('message.created', message);
	  return response.status(202).json(message);
	}
    const sent = await whatsapp.sendText({ sessionId: brandId(request), phone: conversation.phone, text: parsed.data.body });
    const message = await store.addMessage(brandId(request), conversation.id, parsed.data.body, sent.messageId, 'sent');
    if (message) io.to(`brand:${brandId(request)}`).emit('message.created', message);
    response.status(201).json(message);
  } catch (error) {
    sendError(response, 503, 'WHATSAPP_SEND_FAILED', error instanceof Error ? error.message : 'Pesan belum terkirim.', true);
  }
});

app.post(
  '/api/v1/conversations/:id/media',
  requireBrand,
  mutationLimiter,
  express.raw({ type: () => true, limit: '25mb' }),
  async (request, response) => {
	if (config.testFixtures) return sendError(response, 409, 'MEDIA_TEST_UNAVAILABLE', 'Lampiran tidak tersedia pada fixture pengujian.');
	if (!(await canAccessConversation(request, String(request.params.id)))) return sendError(response, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
	const transport = await (store as MySqlCrmStore).getConversationTransportContext(brandId(request), String(request.params.id));
	if (!transport) return sendError(response, 409, 'WHATSAPP_IDENTITY_SYNCING', 'Nomor WhatsApp kontak masih disinkronkan. Hubungkan ulang WhatsApp lalu tunggu histori selesai.');
	if (!Buffer.isBuffer(request.body) || !request.body.length) return sendError(response, 400, 'MEDIA_REQUIRED', 'Pilih file untuk dikirim.');
	const rawFileName = request.header('x-file-name') ?? 'lampiran';
	let decodedFileName: string;
	try { decodedFileName = decodeURIComponent(rawFileName); } catch { return sendError(response, 400, 'INVALID_FILE_NAME', 'Nama file belum valid.'); }
	const fileName = basename(decodedFileName).slice(0, 255);
	const extensionMimeTypes: Record<string, string> = {
	  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
	  '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.mov': 'video/quicktime', '.webm': 'video/webm',
	  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav', '.aac': 'audio/aac',
	  '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	};
	const declaredMimeType = (request.header('content-type') ?? 'application/octet-stream').split(';')[0] ?? 'application/octet-stream';
	const mimeType = declaredMimeType === 'application/octet-stream'
	  ? extensionMimeTypes[extname(fileName).toLowerCase()] ?? declaredMimeType
	  : declaredMimeType;
	const allowedMimeTypes = new Set([
	  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
	  'video/mp4', 'video/3gpp', 'video/quicktime', 'video/webm',
	  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/webm', 'audio/aac',
	  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	]);
	if (!allowedMimeTypes.has(mimeType)) return sendError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Format lampiran tidak didukung.');
	const type = mimeType.startsWith('image/')
	  ? 'image' as const
	  : mimeType.startsWith('video/')
		? 'video' as const
		: mimeType.startsWith('audio/')
		  ? 'audio' as const
		  : 'document' as const;
	const caption = String(request.query.caption ?? '').slice(0, 4_000);
	const objectKey = await persistIncomingMedia(brandId(request), { data: request.body, fileName });
	const message = await (store as MySqlCrmStore).enqueueOutboundMedia(brandId(request), String(request.params.id), {
	  type, body: caption, mediaObjectKey: objectKey, mimeType, fileName,
	});
	if (!message) return sendError(response, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
	io.to(`brand:${brandId(request)}`).emit('message.created', message);
	response.status(202).json(message);
  },
);

app.post('/api/v1/messages/:id/retry', requireBrand, mutationLimiter, async (request, response) => {
  if (config.testFixtures) return sendError(response, 409, 'MESSAGE_NOT_FAILED', 'Pesan fixture tidak memerlukan retry.');
  if (!(await canAccessMessage(request, String(request.params.id)))) return sendError(response, 404, 'MESSAGE_NOT_FAILED', 'Pesan tidak ditemukan.');
  const message = await (store as MySqlCrmStore).retryFailedMessage(brandId(request), String(request.params.id));
  if (!message) return sendError(response, 404, 'MESSAGE_NOT_FAILED', 'Pesan gagal tidak ditemukan atau sudah dijadwalkan ulang.');
  io.to(`brand:${brandId(request)}`).emit('message.status.updated', message);
  response.status(202).json(message);
});

app.get('/api/v1/messages/:id/media', requireBrand, async (request, response) => {
  if (config.testFixtures) return sendError(response, 404, 'MEDIA_NOT_FOUND', 'Lampiran tidak ditemukan.');
  if (!(await canAccessMessage(request, String(request.params.id)))) return sendError(response, 404, 'MEDIA_NOT_FOUND', 'Lampiran tidak ditemukan.');
  const media = await (store as MySqlCrmStore).getMessageMedia(brandId(request), String(request.params.id));
  if (!media) return sendError(response, 404, 'MEDIA_NOT_FOUND', 'Lampiran tidak ditemukan.');
  const path = resolveMediaPath(media.objectKey);
  if (!path) return sendError(response, 404, 'MEDIA_NOT_FOUND', 'Lampiran tidak ditemukan.');
  response.type(media.mimeType);
  const disposition = /^(image|video|audio)\//.test(media.mimeType) ? 'inline' : 'attachment';
  response.setHeader('Content-Disposition', `${disposition}; filename="${basename(media.fileName).replaceAll('"', '')}"`);
  response.sendFile(path, { dotfiles: 'allow' }, (error) => {
    if (error && !response.headersSent) sendError(response, 404, 'MEDIA_NOT_FOUND', 'Lampiran tidak ditemukan.');
  });
});

async function processOutboundQueue() {
  if (config.testFixtures || outboxRunning) return;
  outboxRunning = true;
  try {
	const persistentStore = store as MySqlCrmStore;
	const jobs = await persistentStore.claimOutboundJobs(outboxWorkerId, 10);
	for (const job of jobs) {
	  if (whatsapp.getStatus(job.brandId).status !== 'connected') {
		await persistentStore.deferOutboundJob(job.id);
		continue;
	  }
	  try {
		let sent: { messageId: string };
		if (job.payload.type && job.payload.type !== 'text') {
		  const mediaPath = job.payload.mediaObjectKey ? resolveMediaPath(job.payload.mediaObjectKey) : null;
		  if (!mediaPath) throw new Error('File lampiran tidak ditemukan.');
		  sent = await whatsapp.sendMedia({
			sessionId: job.brandId, phone: job.payload.phone, type: job.payload.type,
			data: await readFile(mediaPath), mimeType: job.payload.mimeType ?? 'application/octet-stream',
			fileName: job.payload.fileName ?? 'lampiran', caption: job.payload.body,
			messageId: job.payload.messageId,
		  });
		} else {
		  sent = await whatsapp.sendText({
			sessionId: job.brandId, phone: job.payload.phone, text: job.payload.body,
			messageId: job.payload.messageId,
		  });
		}
		const message = await persistentStore.completeOutboundJob(job, sent.messageId);
		metrics.outboundSent += 1;
		if (message) io.to(`brand:${job.brandId}`).emit('message.status.updated', message);
	  } catch (error) {
		const message = await persistentStore.retryOutboundJob(
		  job,
		  error instanceof Error ? error.message : 'WhatsApp send failed',
		);
		metrics.outboundRetried += 1;
		if (message) io.to(`brand:${job.brandId}`).emit('message.status.updated', message);
	  }
	}
  } catch (error) {
	metrics.outboxWorkerFailures += 1;
	logger.error({ err: error }, 'WhatsApp outbox worker failed');
  } finally {
	outboxRunning = false;
  }
}

app.get('/api/v1/whatsapp/status', requireBrand, (request, response) => response.json(whatsapp.getStatus(brandId(request))));
app.post('/api/v1/whatsapp/connect', requireBrand, requireManager, mutationLimiter, async (request, response) => {
  await whatsapp.connect(brandId(request));
  response.status(202).json(whatsapp.getStatus(brandId(request)));
});
app.post('/api/v1/whatsapp/disconnect', requireBrand, requireManager, mutationLimiter, async (request, response) => {
  const parsed = z.object({ logout: z.boolean().default(false) }).parse(request.body ?? {});
  await whatsapp.disconnect(brandId(request), parsed.logout);
  response.json(whatsapp.getStatus(brandId(request)));
});

whatsapp.onIncoming(async (incoming) => {
	const mediaObjectKey = incoming.media
	  ? await persistIncomingMedia(incoming.sessionId, incoming.media)
	  : undefined;
  const created = await store.ingestIncoming({
    brandId: incoming.sessionId,
    messageId: incoming.messageId,
    jid: incoming.jid,
    phone: incoming.phone,
    name: incoming.pushName,
    body: incoming.body,
    occurredAt: incoming.occurredAt,
	type: incoming.type,
	...(mediaObjectKey ? { mediaObjectKey } : {}),
	...(incoming.media ? { mediaMimeType: incoming.media.mimeType, mediaFileName: incoming.media.fileName } : {}),
  });
  io.to(`brand:${incoming.sessionId}`).emit('message.created', created);
});

whatsapp.onContacts(async (contacts) => {
  if (config.testFixtures || !contacts.length) return;
  const sessionId = contacts[0]!.sessionId;
  await (store as MySqlCrmStore).syncWhatsappContacts(
    sessionId,
    contacts.map(({ name, phone, jid, aliases }) => ({ name, phone, jid, aliases })),
  );
  io.to(`brand:${sessionId}`).emit('contacts.synced', { imported: contacts.length });
});

whatsapp.onHistory(async (messages) => {
  if (config.testFixtures || !messages.length) return;
  let imported = 0;
  for (const historical of messages) {
	try {
	  const mediaObjectKey = historical.media
		? await persistIncomingMedia(historical.sessionId, historical.media)
		: undefined;
	  await (store as MySqlCrmStore).ingestIncoming({
		brandId: historical.sessionId,
		messageId: historical.messageId,
		jid: historical.jid,
		phone: historical.phone,
		name: historical.pushName,
		body: historical.body,
		occurredAt: historical.occurredAt,
		type: historical.type,
		direction: historical.direction,
		status: historical.status,
		historical: true,
		...(mediaObjectKey ? { mediaObjectKey } : {}),
		...(historical.media ? { mediaMimeType: historical.media.mimeType, mediaFileName: historical.media.fileName } : {}),
	  });
	  imported += 1;
	} catch (error) {
	  logger.warn({
		eventType: 'whatsapp_history_message_import_failed',
		brandId: historical.sessionId,
		errorName: error instanceof Error ? error.name : 'UnknownError',
	  }, 'A WhatsApp history message could not be imported');
	}
  }
  const sessionId = messages[0]!.sessionId;
  io.to(`brand:${sessionId}`).emit('history.synced', { imported });
  logger.info({ eventType: 'whatsapp_history_synced', brandId: sessionId, imported }, 'WhatsApp history chunk imported');
});

whatsapp.onStatus(async (update) => {
  if (config.testFixtures) return;
  const message = await (store as MySqlCrmStore).updateMessageStatus(update.sessionId, update.messageId, update.status);
  if (message) io.to(`brand:${update.sessionId}`).emit('message.status.updated', message);
});

whatsapp.onPresence((update) => {
  io.to(`brand:${update.sessionId}`).emit('presence.updated', {
	phone: update.phone,
	presence: update.presence,
	...(update.lastSeenAt ? { lastSeenAt: update.lastSeenAt } : {}),
  });
});

if (!config.testFixtures && config.nodeEnv !== 'test') {
  const outboxTimer = setInterval(() => void processOutboundQueue(), 1_000);
  outboxTimer.unref();
}

io.use((socket, next) => {
  const socketRequest = socket.request as Request;
  const user = socketRequest.session?.user;
  if (!user?.brand) return next(new Error('UNAUTHORIZED'));
  socket.data.brandId = user.brand.id;
  socket.data.sessionId = socketRequest.sessionID;
  next();
});

io.on('connection', (socket) => {
  socket.join(`brand:${String(socket.data.brandId)}`);
	const socketRequest = socket.request as Request;
	const expiresAt = socketRequest.session.cookie.expires?.getTime();
	if (expiresAt) {
		const timeout = setTimeout(() => socket.disconnect(true), Math.max(0, expiresAt - Date.now()));
		timeout.unref();
		socket.once('disconnect', () => clearTimeout(timeout));
	}
});

const webDistPath = process.env.WEB_DIST_PATH ? resolve(process.cwd(), process.env.WEB_DIST_PATH) : null;
if (webDistPath && existsSync(resolve(webDistPath, 'index.html'))) {
  app.use(express.static(webDistPath));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || !request.accepts('html')) return next();
    response.sendFile(resolve(webDistPath, 'index.html'));
  });
}

app.use((_request, response) => sendError(response, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan.'));
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  logger.error({ err: error, correlationId: response.locals.correlationId }, 'Unhandled request error');
  sendError(response, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan internal.');
});

if (config.nodeEnv !== 'test' || config.startServer) {
  httpServer.listen(config.apiPort, () => {
    logger.info({ port: config.apiPort, mode: config.testFixtures ? 'test' : 'integration' }, 'Azhan CRM API ready');
	void whatsapp.restoreConnections().catch((error) => logger.error({
	  eventType: 'whatsapp_restore_connections_failed',
	  errorName: error instanceof Error ? error.name : 'UnknownError',
	}, 'WhatsApp persisted connections could not be restored'));
  });
}

export { app, httpServer };
