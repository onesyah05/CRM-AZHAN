import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
	downloadMediaMessage,
	normalizeMessageContent,
  type Contact,
  type WAMessage,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import type { ContactPresence, MessageStatus, WhatsAppStatus } from '@azhan-crm/contracts';
import type { Pool, ResultSetHeader, RowDataPacket } from '@azhan-crm/database';
import { normalizeIndonesianPhone } from '../phone.js';
import { clearLoggedOutDatabaseAuthState, useDatabaseAuthState } from './database-auth-state.js';
import type { HistoricalWhatsAppContact, HistoricalWhatsAppMessage, IncomingWhatsAppMessage, WhatsAppGateway, WhatsAppPresenceUpdate } from './gateway.js';

type Socket = ReturnType<typeof makeWASocket>;
type GatewayLogger = {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
};

class ConnectionLockBusyError extends Error {
  constructor() {
	super('WhatsApp connection lease is still active.');
	this.name = 'ConnectionLockBusyError';
  }
}

function extractText(message: WAMessage): string {
  const content = normalizeMessageContent(message.message);
  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    content?.documentMessage?.caption ??
    ''
  ).trim();
}

function historyMessageStatus(message: WAMessage): MessageStatus {
  const status = Number(message.status ?? 0);
  if (status >= 4) return 'read';
  if (status === 3) return 'delivered';
  return 'sent';
}

function mediaExtension(mimeType: string, type: Exclude<IncomingWhatsAppMessage['type'], 'text'>): string {
  const known: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
    'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/aac': 'aac',
  };
  return known[mimeType] ?? (type === 'document' ? 'bin' : type);
}

export class BaileysWhatsAppGateway implements WhatsAppGateway {
  private readonly sockets = new Map<number, Socket>();
  private readonly statuses = new Map<number, WhatsAppStatus>();
  private readonly reconnectAttempts = new Map<number, number>();
	private readonly reconnectTimers = new Map<number, NodeJS.Timeout>();
	private readonly connectionWatchdogs = new Map<number, NodeJS.Timeout>();
	private readonly recoveringSockets = new WeakSet<Socket>();
	private readonly lockHeartbeats = new Map<number, NodeJS.Timeout>();
	private readonly authFinalizers = new Map<number, { flush: () => Promise<void>; clear: () => Promise<void> }>();
	private readonly presences = new Map<string, Omit<WhatsAppPresenceUpdate, 'sessionId' | 'phone'>>();
	private readonly historyChains = new Map<number, Promise<void>>();
	private readonly jidAliases = new Map<number, Map<string, string>>();
	private readonly profilePictures = new Map<string, { expiresAt: number; value: { data: Buffer; mimeType: string } | null }>();
	private readonly lockOwner = `crm-wa-${process.pid}-${randomUUID()}`;
  private incomingHandler: ((message: IncomingWhatsAppMessage) => Promise<void>) | null = null;
	private historyHandler: ((messages: HistoricalWhatsAppMessage[]) => Promise<void>) | null = null;
	private contactsHandler: ((contacts: HistoricalWhatsAppContact[]) => Promise<void>) | null = null;
	private statusHandler: ((update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>) | null = null;
	private presenceHandler: ((update: WhatsAppPresenceUpdate) => void) | null = null;

  constructor(
	private readonly authRoot: string,
	private readonly authDriver: 'filesystem' | 'database' = 'filesystem',
	private readonly databasePool?: Pool,
	private readonly encryptionSecret?: string,
	private readonly logger?: GatewayLogger,
  ) {}

  onIncoming(handler: (message: IncomingWhatsAppMessage) => Promise<void>): void {
    this.incomingHandler = handler;
  }

  onHistory(handler: (messages: HistoricalWhatsAppMessage[]) => Promise<void>): void {
	this.historyHandler = handler;
  }

  onContacts(handler: (contacts: HistoricalWhatsAppContact[]) => Promise<void>): void {
	this.contactsHandler = handler;
  }

  onStatus(handler: (update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>): void {
	this.statusHandler = handler;
  }

  onPresence(handler: (update: WhatsAppPresenceUpdate) => void): void {
	this.presenceHandler = handler;
  }

  private presenceKey(sessionId: number, phone: string): string {
	return `${sessionId}:${normalizeIndonesianPhone(phone)}`;
  }

  getPresence(sessionId: number, phone: string): Omit<WhatsAppPresenceUpdate, 'sessionId' | 'phone'> {
	return this.presences.get(this.presenceKey(sessionId, phone)) ?? { presence: 'offline' };
  }

  private setPresence(sessionId: number, phone: string, presence: ContactPresence, lastSeenAt?: string): void {
	const normalizedPhone = normalizeIndonesianPhone(phone);
	const value = { presence, ...(lastSeenAt ? { lastSeenAt } : {}) };
	this.presences.set(this.presenceKey(sessionId, normalizedPhone), value);
	this.presenceHandler?.({ sessionId, phone: normalizedPhone, ...value });
  }

  private clearPresences(sessionId: number): void {
	for (const key of this.presences.keys()) {
	  if (!key.startsWith(`${sessionId}:`)) continue;
	  const phone = key.slice(key.indexOf(':') + 1);
	  this.presences.delete(key);
	  this.presenceHandler?.({ sessionId, phone, presence: 'offline' });
	}
  }

  private prepareContacts(sessionId: number, contacts: Array<Partial<Contact>>): HistoricalWhatsAppContact[] {
	const aliases = this.jidAliases.get(sessionId) ?? new Map<string, string>();
	const syncedContacts: HistoricalWhatsAppContact[] = [];
	for (const contact of contacts) {
	  const name = contact.name ?? contact.notify ?? contact.verifiedName;
	  const phoneJid = [contact.jid, contact.id].find((jid) => jid?.endsWith('@s.whatsapp.net'));
	  if (!phoneJid) continue;
	  const contactAliases = [...new Set([contact.id, contact.jid, contact.lid].filter((jid): jid is string => Boolean(jid)))];
	  for (const jid of contactAliases) aliases.set(jid, phoneJid);
	  const phone = normalizeIndonesianPhone(phoneJid.split('@')[0] ?? '');
	  syncedContacts.push({ sessionId, phone, jid: phoneJid, aliases: contactAliases, name: name ?? phone });
	}
	this.jidAliases.set(sessionId, aliases);
	return syncedContacts;
  }

  private queueContacts(sessionId: number, contacts: HistoricalWhatsAppContact[]): void {
	if (!this.contactsHandler || !contacts.length) return;
	const previous = this.historyChains.get(sessionId) ?? Promise.resolve();
	const current = previous.then(() => this.contactsHandler?.(contacts)).catch((error) => {
	  this.logger?.warn({
		eventType: 'whatsapp_contact_sync_failed',
		brandId: sessionId,
		errorName: error instanceof Error ? error.name : 'UnknownError',
	  }, 'WhatsApp contacts could not be imported');
	});
	this.historyChains.set(sessionId, current);
	void current.finally(() => {
	  if (this.historyChains.get(sessionId) === current) this.historyChains.delete(sessionId);
	});
  }

  getStatus(sessionId: number): WhatsAppStatus {
    return (
      this.statuses.get(sessionId) ?? {
        status: 'disconnected',
        message: 'WhatsApp belum dihubungkan',
        developmentStorage: true,
      }
    );
  }

  private setStatus(sessionId: number, status: WhatsAppStatus): void {
	this.statuses.set(sessionId, status);
	if (this.authDriver !== 'database' || !this.databasePool) return;
	void this.databasePool.execute(
	  `INSERT INTO crm_whatsapp_sessions (brand_id,phone_e164,connection_status,last_connected_at)
	   VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE phone_e164=VALUES(phone_e164),
	   connection_status=VALUES(connection_status),last_connected_at=COALESCE(VALUES(last_connected_at),last_connected_at)`,
	  [sessionId, status.phone ?? null, status.status, status.lastConnectedAt ? new Date(status.lastConnectedAt) : null],
	);
  }

  private async acquireConnectionLock(sessionId: number): Promise<void> {
	if (this.authDriver !== 'database' || !this.databasePool) return;
	await this.databasePool.execute(
	  `INSERT INTO crm_whatsapp_sessions (brand_id,connection_status) VALUES (?,'disconnected')
	   ON DUPLICATE KEY UPDATE brand_id=VALUES(brand_id)`,
	  [sessionId],
	);
	const [result] = await this.databasePool.execute<ResultSetHeader>(
	  `UPDATE crm_whatsapp_sessions SET lock_owner=?,lock_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 45 SECOND)
	   WHERE brand_id=? AND (lock_owner IS NULL OR lock_owner=? OR lock_expires_at<UTC_TIMESTAMP(3))`,
	  [this.lockOwner, sessionId, this.lockOwner],
	);
	if (!result.affectedRows) throw new ConnectionLockBusyError();
	const heartbeat = setInterval(() => {
	  void this.databasePool?.execute(
		`UPDATE crm_whatsapp_sessions SET lock_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 45 SECOND)
		  WHERE brand_id=? AND lock_owner=?`,
		[sessionId, this.lockOwner],
	  );
	}, 15_000);
	heartbeat.unref();
	this.lockHeartbeats.set(sessionId, heartbeat);
  }

	private async releaseConnectionLock(sessionId: number): Promise<void> {
	const heartbeat = this.lockHeartbeats.get(sessionId);
	if (heartbeat) clearInterval(heartbeat);
	this.lockHeartbeats.delete(sessionId);
	if (this.authDriver === 'database' && this.databasePool) {
	  try {
		await this.databasePool.execute(
		  `UPDATE crm_whatsapp_sessions SET lock_owner=NULL,lock_expires_at=NULL WHERE brand_id=? AND lock_owner=?`,
		  [sessionId, this.lockOwner],
		);
	  } catch {
		this.logger?.warn({ eventType: 'whatsapp_lock_release_failed', brandId: sessionId }, 'WhatsApp connection lock release failed');
	  }
	}
  }

  private clearReconnectTimer(sessionId: number): void {
	const timer = this.reconnectTimers.get(sessionId);
	if (timer) clearTimeout(timer);
	this.reconnectTimers.delete(sessionId);
  }

  private clearConnectionWatchdog(sessionId: number): void {
	const watchdog = this.connectionWatchdogs.get(sessionId);
	if (watchdog) clearInterval(watchdog);
	this.connectionWatchdogs.delete(sessionId);
  }

  private startConnectionWatchdog(sessionId: number, socket: Socket): void {
	this.clearConnectionWatchdog(sessionId);
	const watchdog = setInterval(() => {
	  if (this.sockets.get(sessionId) !== socket) {
		this.clearConnectionWatchdog(sessionId);
		return;
	  }
	  if (!socket.ws.isOpen) void this.recoverDeadSocket(sessionId, socket);
	}, 15_000);
	watchdog.unref();
	this.connectionWatchdogs.set(sessionId, watchdog);
  }

  private async recoverDeadSocket(sessionId: number, socket: Socket): Promise<void> {
	if (this.sockets.get(sessionId) !== socket || this.recoveringSockets.has(socket)) return;
	this.recoveringSockets.add(socket);
	this.clearConnectionWatchdog(sessionId);
	this.logger?.warn({
	  eventType: 'whatsapp_dead_socket_detected',
	  brandId: sessionId,
	}, 'WhatsApp WebSocket stopped without a close event; reconnecting');
	const authFinalizer = this.authFinalizers.get(sessionId);
	try {
	  await authFinalizer?.flush();
	} catch (error) {
	  this.logger?.warn({
		eventType: 'whatsapp_auth_flush_failed',
		brandId: sessionId,
		errorName: error instanceof Error ? error.name : 'UnknownError',
	  }, 'WhatsApp auth state could not be flushed before reconnect');
	}
	await this.releaseConnectionLock(sessionId);
	if (this.sockets.get(sessionId) !== socket) return;
	this.sockets.delete(sessionId);
	this.authFinalizers.delete(sessionId);
	this.clearPresences(sessionId);
	socket.end(new Error('WhatsApp WebSocket is no longer open.'));
	this.setStatus(sessionId, {
	  status: 'reconnecting',
	  message: 'Koneksi terputus, mencoba kembali…',
	  developmentStorage: this.authDriver === 'filesystem',
	});
	this.scheduleReconnect(sessionId);
  }

  private scheduleReconnect(sessionId: number, statusCode?: number): void {
	if (this.reconnectTimers.has(sessionId)) return;
	const attempts = (this.reconnectAttempts.get(sessionId) ?? 0) + 1;
	this.reconnectAttempts.set(sessionId, attempts);
	const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)) + Math.round(Math.random() * 1_000);
	this.logger?.warn({
	  eventType: 'whatsapp_reconnect_scheduled',
	  brandId: sessionId,
	  reconnectAttempt: attempts,
	  retryDelayMs: delayMs,
	  ...(statusCode ? { statusCode } : {}),
	}, 'WhatsApp connection closed; reconnect scheduled');
	const timer = setTimeout(() => {
	  this.reconnectTimers.delete(sessionId);
	  void this.connect(sessionId).catch(() => this.scheduleReconnect(sessionId));
	}, delayMs);
	timer.unref();
	this.reconnectTimers.set(sessionId, timer);
  }

  async restoreConnections(): Promise<void> {
	if (this.authDriver !== 'database' || !this.databasePool) return;
	const [rows] = await this.databasePool.execute<(RowDataPacket & {
	  brand_id: number;
	  connection_status: string;
	  has_auth: number;
	})[]>(
	  `SELECT brand_id,connection_status,encrypted_auth_state IS NOT NULL AS has_auth
	     FROM crm_whatsapp_sessions`,
	);
	for (const row of rows) {
	  if (row.connection_status === 'logged_out' || !row.has_auth) {
		if (row.connection_status === 'logged_out') {
		  this.statuses.set(row.brand_id, {
			status: 'logged_out',
			message: 'Perangkat telah logout. Pindai QR untuk menghubungkan kembali.',
			developmentStorage: false,
		  });
		}
		continue;
	  }
	  try {
		await this.connect(row.brand_id);
	  } catch (error) {
		this.logger?.warn({
		  eventType: 'whatsapp_restore_failed',
		  brandId: row.brand_id,
		  errorName: error instanceof Error ? error.name : 'UnknownError',
		}, 'Persisted WhatsApp connection restore failed');
	  }
	}
  }

  async connect(sessionId: number): Promise<void> {
	this.clearReconnectTimer(sessionId);
    if (this.sockets.has(sessionId)) return;
	let lockAcquired = false;
	try {
	  await this.acquireConnectionLock(sessionId);
	  lockAcquired = true;
	let auth: Awaited<ReturnType<typeof useMultiFileAuthState>>;
	if (this.authDriver === 'database') {
	  if (!this.databasePool || !this.encryptionSecret) throw new Error('Database auth WhatsApp belum dikonfigurasi.');
	  await clearLoggedOutDatabaseAuthState(this.databasePool, sessionId);
	  const databaseAuth = await useDatabaseAuthState(this.databasePool, sessionId, this.encryptionSecret);
	  auth = databaseAuth;
	  this.authFinalizers.set(sessionId, { flush: databaseAuth.flush, clear: databaseAuth.clear });
	} else {
	  const authPath = join(this.authRoot, String(sessionId));
	  if (this.statuses.get(sessionId)?.status === 'logged_out') await rm(authPath, { recursive: true, force: true });
	  await mkdir(authPath, { recursive: true });
	  auth = await useMultiFileAuthState(authPath);
	  this.authFinalizers.set(sessionId, {
		flush: async () => undefined,
		clear: () => rm(authPath, { recursive: true, force: true }),
	  });
	}
	const { state, saveCreds } = auth;

	this.setStatus(sessionId, {
      status: 'connecting',
      message: 'Menyiapkan koneksi WhatsApp…',
		developmentStorage: this.authDriver === 'filesystem',
    });

    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
	  browser: Browsers.ubuntu('Chrome'),
	  syncFullHistory: true,
	  shouldSyncHistoryMessage: () => true,
	  connectTimeoutMs: 20_000,
    });
    this.sockets.set(sessionId, socket);
    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
		this.reconnectAttempts.delete(sessionId);
		this.setStatus(sessionId, {
          status: 'qr_required',
          qrDataUrl: await QRCode.toDataURL(qr, { margin: 1, width: 280 }),
          message: 'Pindai QR melalui menu Perangkat tertaut di WhatsApp.',
		  developmentStorage: this.authDriver === 'filesystem',
        });
      }

      if (connection === 'open') {
		this.clearReconnectTimer(sessionId);
		this.reconnectAttempts.delete(sessionId);
		this.startConnectionWatchdog(sessionId, socket);
        const connectedPhone = socket.user?.id ? normalizeIndonesianPhone(socket.user.id.split(':')[0] ?? '') : '';
		this.setStatus(sessionId, {
          status: 'connected',
          ...(connectedPhone ? { phone: connectedPhone } : {}),
          lastConnectedAt: new Date().toISOString(),
          message: 'WhatsApp terhubung',
		  developmentStorage: this.authDriver === 'filesystem',
        });
      }

      if (connection === 'close') {
		if (this.sockets.get(sessionId) !== socket) return;
		if (this.recoveringSockets.has(socket)) return;
		this.recoveringSockets.add(socket);
		this.clearConnectionWatchdog(sessionId);
		const authFinalizer = this.authFinalizers.get(sessionId);
		await authFinalizer?.flush();
		await this.releaseConnectionLock(sessionId);
		if (this.sockets.get(sessionId) !== socket) return;
        this.sockets.delete(sessionId);
		this.clearPresences(sessionId);
		this.authFinalizers.delete(sessionId);
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
		const pairingBootstrapFailed = statusCode === 428 && !state.creds.registered;
		if (loggedOut) await authFinalizer?.clear();
		this.setStatus(sessionId, {
          status: loggedOut ? 'logged_out' : pairingBootstrapFailed ? 'disconnected' : 'reconnecting',
          message: loggedOut
			? 'Perangkat telah logout.'
			: pairingBootstrapFailed
			  ? 'QR belum berhasil dibuat. Tekan Tampilkan QR untuk mencoba lagi.'
			  : 'Koneksi terputus, mencoba kembali…',
		  developmentStorage: this.authDriver === 'filesystem',
        });
		if (!loggedOut && !pairingBootstrapFailed) {
		  this.scheduleReconnect(sessionId, statusCode);
        }
      }
    });

    socket.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) {
		void this.handleIncoming(sessionId, message).catch((error) => {
		  this.logger?.warn({
			eventType: 'whatsapp_incoming_message_failed',
			brandId: sessionId,
			errorName: error instanceof Error ? error.name : 'UnknownError',
		  }, 'Incoming WhatsApp message could not be imported');
		});
	  }
    });

	socket.ev.on('messaging-history.set', ({ contacts, messages }) => {
	  const names = new Map<string, string>();
	  for (const contact of contacts) {
		const name = contact.name ?? contact.notify ?? contact.verifiedName;
		if (name) for (const jid of [contact.id, contact.jid, contact.lid]) if (jid) names.set(jid, name);
	  }
	  const syncedContacts = this.prepareContacts(sessionId, contacts);
	  const previous = this.historyChains.get(sessionId) ?? Promise.resolve();
	  const current = previous.then(async () => {
		if (this.contactsHandler && syncedContacts.length) await this.contactsHandler(syncedContacts);
		if (this.historyHandler && messages.length) await this.handleHistory(sessionId, messages, names);
	  }).catch((error) => {
		this.logger?.warn({
		  eventType: 'whatsapp_history_sync_failed',
		  brandId: sessionId,
		  errorName: error instanceof Error ? error.name : 'UnknownError',
		}, 'WhatsApp history chunk could not be imported');
	  });
	  this.historyChains.set(sessionId, current);
	  void current.finally(() => {
		if (this.historyChains.get(sessionId) === current) this.historyChains.delete(sessionId);
	  });
	});

	socket.ev.on('contacts.upsert', (contacts) => {
	  this.queueContacts(sessionId, this.prepareContacts(sessionId, contacts));
	});

	socket.ev.on('contacts.update', (contacts) => {
	  this.queueContacts(sessionId, this.prepareContacts(sessionId, contacts));
	});

	socket.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
	  if (!lid.endsWith('@lid') || !jid.endsWith('@s.whatsapp.net')) return;
	  const aliases = this.jidAliases.get(sessionId) ?? new Map<string, string>();
	  aliases.set(lid, jid);
	  aliases.set(jid, jid);
	  this.jidAliases.set(sessionId, aliases);
	  const phone = normalizeIndonesianPhone(jid.split('@')[0] ?? '');
	  this.queueContacts(sessionId, [{ sessionId, phone, jid, aliases: [lid, jid], name: phone }]);
	});

	socket.ev.on('presence.update', ({ id, presences }) => {
	  for (const [participant, value] of Object.entries(presences)) {
		const jid = participant.endsWith('@s.whatsapp.net') ? participant : id;
		if (!jid.endsWith('@s.whatsapp.net')) continue;
		const phone = jid.split('@')[0] ?? '';
		const presence: ContactPresence = value.lastKnownPresence === 'composing'
		  ? 'typing'
		  : value.lastKnownPresence === 'recording'
			? 'recording'
			: value.lastKnownPresence === 'unavailable'
			  ? 'offline'
			  : 'online';
		const lastSeenAt = value.lastSeen ? new Date(value.lastSeen * 1_000).toISOString() : undefined;
		this.setPresence(sessionId, phone, presence, lastSeenAt);
	  }
	});

	socket.ev.on('messages.update', (updates) => {
	  if (!this.statusHandler) return;
	  for (const item of updates) {
		const messageId = item.key.id;
		if (!item.key.fromMe || !messageId || item.update.status == null) continue;
		const numericStatus = Number(item.update.status);
		const status: MessageStatus | null = numericStatus >= 4
		  ? 'read'
		  : numericStatus === 3
			? 'delivered'
			: numericStatus === 2
			  ? 'sent'
			  : numericStatus === 0
				? 'failed'
				: null;
		if (status) void this.statusHandler({ sessionId, messageId, status });
	  }
	});
	} catch (error) {
	  this.authFinalizers.delete(sessionId);
	  if (lockAcquired) await this.releaseConnectionLock(sessionId);
	  this.setStatus(sessionId, {
		status: 'reconnecting',
		message: 'Koneksi belum berhasil. Sistem akan mencoba kembali…',
		developmentStorage: this.authDriver === 'filesystem',
	  });
	  this.logger?.warn({
		eventType: 'whatsapp_connect_failed',
		brandId: sessionId,
		errorName: error instanceof Error ? error.name : 'UnknownError',
	  }, 'WhatsApp connection attempt failed');
	  if (error instanceof ConnectionLockBusyError) {
		this.scheduleReconnect(sessionId);
		return;
	  }
	  throw error;
	}
  }

  private async handleIncoming(sessionId: number, message: WAMessage): Promise<void> {
    if (!this.incomingHandler || message.key.fromMe) return;
	  const parsed = await this.parseMessage(sessionId, message, message.pushName ?? undefined);
	if (parsed) await this.incomingHandler(parsed);
  }

  private async handleHistory(sessionId: number, messages: WAMessage[], names: Map<string, string>): Promise<void> {
	if (!this.historyHandler) return;
	const parsed: HistoricalWhatsAppMessage[] = [];
	const ordered = [...messages].sort((left, right) => Number(left.messageTimestamp ?? 0) - Number(right.messageTimestamp ?? 0));
	for (const message of ordered) {
	  const jid = message.key.remoteJid ?? '';
	  const item = await this.parseMessage(sessionId, message, names.get(jid) ?? message.pushName ?? undefined);
	  if (item) parsed.push(item);
	}
	if (parsed.length) await this.historyHandler(parsed);
  }

  private async parseMessage(sessionId: number, message: WAMessage, name?: string): Promise<HistoricalWhatsAppMessage | null> {
	const originalJid = message.key.remoteJid;
	if (!originalJid || originalJid.endsWith('@broadcast') || originalJid.endsWith('@g.us') || originalJid.endsWith('@newsletter')) return null;
	const aliases = this.jidAliases.get(sessionId) ?? new Map<string, string>();
	const incomingPhoneJid = !message.key.fromMe && message.key.senderPn?.endsWith('@s.whatsapp.net')
	  ? message.key.senderPn
	  : undefined;
	const jid = aliases.get(originalJid) ?? incomingPhoneJid ?? originalJid;
	if (!jid.endsWith('@s.whatsapp.net')) {
	  if (originalJid.endsWith('@lid')) {
		this.logger?.warn({
		  eventType: 'whatsapp_lid_unresolved',
		  brandId: sessionId,
		}, 'WhatsApp LID message did not include a phone-number mapping');
	  }
	  return null;
	}
	if (originalJid !== jid) {
	  aliases.set(originalJid, jid);
	  aliases.set(jid, jid);
	  this.jidAliases.set(sessionId, aliases);
	}
	const content = normalizeMessageContent(message.message);
	const image = content?.imageMessage;
	const video = content?.videoMessage;
	const audio = content?.audioMessage;
	const document = content?.documentMessage;
	const mediaType = image ? 'image' : video ? 'video' : audio ? 'audio' : document ? 'document' : null;
	const type = mediaType ?? 'text';
    const body = extractText(message) || document?.fileName || (image ? 'Gambar' : video ? 'Video' : audio ? 'Pesan audio' : '');
	if ((!body && type === 'text') || !message.key.id) return null;
	let media: IncomingWhatsAppMessage['media'];
	if (mediaType) {
	  try {
		const data = await downloadMediaMessage(message, 'buffer', {});
		const mimeType = image?.mimetype ?? video?.mimetype ?? audio?.mimetype ?? document?.mimetype ?? 'application/octet-stream';
		media = {
		  data,
		  mimeType,
		  fileName: document?.fileName ?? `${message.key.id}.${mediaExtension(mimeType, mediaType)}`,
		};
	  } catch (error) {
		this.logger?.warn({
		  eventType: 'whatsapp_media_download_failed',
		  brandId: sessionId,
		  errorName: error instanceof Error ? error.name : 'UnknownError',
		}, 'WhatsApp media could not be downloaded');
	  }
	}
    const phone = normalizeIndonesianPhone(jid.split('@')[0] ?? '');
	return {
      sessionId,
      messageId: message.key.id,
      jid,
      phone,
	  pushName: name ?? phone,
      body,
	  type,
	  ...(media ? { media } : {}),
	  direction: message.key.fromMe ? 'outbound' : 'inbound',
	  status: message.key.fromMe ? historyMessageStatus(message) : 'read',
      occurredAt: new Date(Number(message.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString(),
	};
  }

  async sendText(input: { sessionId: number; phone: string; text: string; messageId?: string }): Promise<{ messageId: string }> {
    const socket = this.sockets.get(input.sessionId);
    if (!socket) throw new Error('WhatsApp belum terhubung.');
	if (!socket.ws.isOpen) {
	  void this.recoverDeadSocket(input.sessionId, socket);
	  throw new Error('Koneksi WhatsApp terputus dan sedang dihubungkan kembali.');
	}
    const phone = normalizeIndonesianPhone(input.phone).replace('+', '');
    const result = await socket.sendMessage(`${phone}@s.whatsapp.net`, { text: input.text });
    if (!result?.key.id) throw new Error('WhatsApp tidak mengembalikan ID pesan.');
    return { messageId: result.key.id };
  }

  async sendMedia(input: { sessionId: number; phone: string; type: Exclude<IncomingWhatsAppMessage['type'], 'text'>; data: Buffer; mimeType: string; fileName: string; caption: string; messageId?: string }): Promise<{ messageId: string }> {
	const socket = this.sockets.get(input.sessionId);
	if (!socket) throw new Error('WhatsApp belum terhubung.');
	if (!socket.ws.isOpen) {
	  void this.recoverDeadSocket(input.sessionId, socket);
	  throw new Error('Koneksi WhatsApp terputus dan sedang dihubungkan kembali.');
	}
	const jid = `${normalizeIndonesianPhone(input.phone).replace('+', '')}@s.whatsapp.net`;
	const result = input.type === 'image'
	  ? await socket.sendMessage(jid, { image: input.data, caption: input.caption, mimetype: input.mimeType })
	  : input.type === 'video'
		? await socket.sendMessage(jid, { video: input.data, caption: input.caption, mimetype: input.mimeType })
		: input.type === 'audio'
		  ? await socket.sendMessage(jid, { audio: input.data, mimetype: input.mimeType, ptt: false })
		  : await socket.sendMessage(jid, { document: input.data, caption: input.caption, mimetype: input.mimeType, fileName: input.fileName });
	if (!result?.key.id) throw new Error('WhatsApp tidak mengembalikan ID pesan.');
	return { messageId: result.key.id };
  }

  async subscribePresence(sessionId: number, phone: string): Promise<void> {
	const socket = this.sockets.get(sessionId);
	if (!socket) return;
	const jid = `${normalizeIndonesianPhone(phone).replace('+', '')}@s.whatsapp.net`;
	await socket.presenceSubscribe(jid);
  }

  async sendPresence(sessionId: number, phone: string, presence: 'composing' | 'paused'): Promise<void> {
	const socket = this.sockets.get(sessionId);
	if (!socket) throw new Error('WhatsApp belum terhubung.');
	const jid = `${normalizeIndonesianPhone(phone).replace('+', '')}@s.whatsapp.net`;
	await socket.sendPresenceUpdate(presence, jid);
  }

  async markRead(sessionId: number, phone: string, messageIds: string[]): Promise<void> {
	if (!messageIds.length) return;
	const socket = this.sockets.get(sessionId);
	if (!socket) throw new Error('WhatsApp belum terhubung.');
	const remoteJid = `${normalizeIndonesianPhone(phone).replace('+', '')}@s.whatsapp.net`;
	await socket.readMessages(messageIds.map((id) => ({ remoteJid, id, fromMe: false })));
  }

  async getProfilePicture(sessionId: number, phone: string): Promise<{ data: Buffer; mimeType: string } | null> {
	const normalizedPhone = normalizeIndonesianPhone(phone);
	const cacheKey = `${sessionId}:${normalizedPhone}`;
	const cached = this.profilePictures.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.value;
	const socket = this.sockets.get(sessionId);
	if (!socket) return null;
	try {
	  const jid = `${normalizedPhone.replace('+', '')}@s.whatsapp.net`;
	  const url = await socket.profilePictureUrl(jid, 'image');
	  if (!url) {
		this.profilePictures.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value: null });
		return null;
	  }
	  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	  if (!response.ok) throw new Error(`PROFILE_PICTURE_HTTP_${response.status}`);
	  const data = Buffer.from(await response.arrayBuffer());
	  if (!data.length || data.length > 5 * 1024 * 1024) throw new Error('PROFILE_PICTURE_INVALID_SIZE');
	  const value = { data, mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg' };
	  this.profilePictures.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, value });
	  return value;
	} catch (error) {
	  this.profilePictures.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value: null });
	  this.logger?.warn({
		eventType: 'whatsapp_profile_picture_unavailable',
		brandId: sessionId,
		errorName: error instanceof Error ? error.name : 'UnknownError',
	  }, 'WhatsApp profile picture is unavailable');
	  return null;
	}
  }

  async disconnect(sessionId: number, logout = false): Promise<void> {
	this.clearReconnectTimer(sessionId);
	this.clearConnectionWatchdog(sessionId);
	this.reconnectAttempts.delete(sessionId);
    const socket = this.sockets.get(sessionId);
	this.clearPresences(sessionId);
	const authFinalizer = this.authFinalizers.get(sessionId);
	this.sockets.delete(sessionId);
	this.authFinalizers.delete(sessionId);
    if (socket && logout) await socket.logout();
    socket?.end(undefined);
	await authFinalizer?.flush();
	if (logout) await authFinalizer?.clear();
	await this.releaseConnectionLock(sessionId);
	this.setStatus(sessionId, {
      status: logout ? 'logged_out' : 'disconnected',
      message: logout ? 'Perangkat telah logout.' : 'Koneksi diputuskan.',
	  developmentStorage: this.authDriver === 'filesystem',
    });
  }
}
