import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import makeWASocket, {
  DisconnectReason,
	downloadMediaMessage,
  type WAMessage,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import type { MessageStatus, WhatsAppStatus } from '@azhan-crm/contracts';
import type { Pool, ResultSetHeader } from '@azhan-crm/database';
import { normalizeIndonesianPhone } from '../phone.js';
import { useDatabaseAuthState } from './database-auth-state.js';
import type { IncomingWhatsAppMessage, WhatsAppGateway } from './gateway.js';

type Socket = ReturnType<typeof makeWASocket>;

function extractText(message: WAMessage): string {
  const content = message.message;
  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.documentMessage?.caption ??
    ''
  ).trim();
}

export class BaileysWhatsAppGateway implements WhatsAppGateway {
  private readonly sockets = new Map<number, Socket>();
  private readonly statuses = new Map<number, WhatsAppStatus>();
  private readonly reconnectAttempts = new Map<number, number>();
	private readonly lockHeartbeats = new Map<number, NodeJS.Timeout>();
	private readonly lockOwner = `crm-wa-${process.pid}-${randomUUID()}`;
  private incomingHandler: ((message: IncomingWhatsAppMessage) => Promise<void>) | null = null;
	private statusHandler: ((update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>) | null = null;

  constructor(
	private readonly authRoot: string,
	private readonly authDriver: 'filesystem' | 'database' = 'filesystem',
	private readonly databasePool?: Pool,
	private readonly encryptionSecret?: string,
  ) {}

  onIncoming(handler: (message: IncomingWhatsAppMessage) => Promise<void>): void {
    this.incomingHandler = handler;
  }

  onStatus(handler: (update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>): void {
	this.statusHandler = handler;
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
	if (!result.affectedRows) throw new Error('Koneksi WhatsApp brand ini sedang dimiliki worker lain.');
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

  private releaseConnectionLock(sessionId: number): void {
	const heartbeat = this.lockHeartbeats.get(sessionId);
	if (heartbeat) clearInterval(heartbeat);
	this.lockHeartbeats.delete(sessionId);
	if (this.authDriver === 'database' && this.databasePool) {
	  void this.databasePool.execute(
		`UPDATE crm_whatsapp_sessions SET lock_owner=NULL,lock_expires_at=NULL WHERE brand_id=? AND lock_owner=?`,
		[sessionId, this.lockOwner],
	  );
	}
  }

  async connect(sessionId: number): Promise<void> {
    if (this.sockets.has(sessionId)) return;
	await this.acquireConnectionLock(sessionId);
	let auth: Awaited<ReturnType<typeof useMultiFileAuthState>>;
	if (this.authDriver === 'database') {
	  if (!this.databasePool || !this.encryptionSecret) throw new Error('Database auth WhatsApp belum dikonfigurasi.');
	  auth = await useDatabaseAuthState(this.databasePool, sessionId, this.encryptionSecret);
	} else {
	  const authPath = join(this.authRoot, String(sessionId));
	  await mkdir(authPath, { recursive: true });
	  auth = await useMultiFileAuthState(authPath);
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
      browser: ['Azhan CRM', 'Chrome', '0.1.0'],
    });
    this.sockets.set(sessionId, socket);
    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
		this.setStatus(sessionId, {
          status: 'qr_required',
          qrDataUrl: await QRCode.toDataURL(qr, { margin: 1, width: 280 }),
          message: 'Pindai QR melalui menu Perangkat tertaut di WhatsApp.',
		  developmentStorage: this.authDriver === 'filesystem',
        });
      }

      if (connection === 'open') {
		this.reconnectAttempts.delete(sessionId);
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
        this.sockets.delete(sessionId);
		this.releaseConnectionLock(sessionId);
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
		this.setStatus(sessionId, {
          status: loggedOut ? 'logged_out' : 'reconnecting',
          message: loggedOut ? 'Perangkat telah logout.' : 'Koneksi terputus, mencoba kembali…',
		  developmentStorage: this.authDriver === 'filesystem',
        });
        if (!loggedOut) {
		  const attempts = (this.reconnectAttempts.get(sessionId) ?? 0) + 1;
		  this.reconnectAttempts.set(sessionId, attempts);
		  const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)) + Math.random() * 1_000;
          const timer = setTimeout(() => void this.connect(sessionId), delay);
          timer.unref();
        }
      }
    });

    socket.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) void this.handleIncoming(sessionId, message);
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
  }

  private async handleIncoming(sessionId: number, message: WAMessage): Promise<void> {
    if (!this.incomingHandler || message.key.fromMe) return;
    const jid = message.key.remoteJid;
    if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) return;
	const image = message.message?.imageMessage;
	const document = message.message?.documentMessage;
	const type = image ? 'image' : document ? 'document' : 'text';
    const body = extractText(message) || document?.fileName || (image ? 'Gambar' : '');
	if ((!body && type === 'text') || !message.key.id) return;
	let media: IncomingWhatsAppMessage['media'];
	if (image || document) {
	  const data = await downloadMediaMessage(message, 'buffer', {});
	  media = {
		data,
		mimeType: image?.mimetype ?? document?.mimetype ?? 'application/octet-stream',
		fileName: document?.fileName ?? `${message.key.id}.${image ? 'jpg' : 'bin'}`,
	  };
	}
    const phone = normalizeIndonesianPhone(jid.split('@')[0] ?? '');
    await this.incomingHandler({
      sessionId,
      messageId: message.key.id,
      jid,
      phone,
      pushName: message.pushName ?? phone,
      body,
	  type,
	  ...(media ? { media } : {}),
      occurredAt: new Date(Number(message.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString(),
    });
  }

  async sendText(input: { sessionId: number; phone: string; text: string; messageId?: string }): Promise<{ messageId: string }> {
    const socket = this.sockets.get(input.sessionId);
    if (!socket) throw new Error('WhatsApp belum terhubung.');
    const phone = normalizeIndonesianPhone(input.phone).replace('+', '');
	const result = await socket.sendMessage(`${phone}@s.whatsapp.net`, { text: input.text }, input.messageId ? { messageId: input.messageId } : undefined);
    if (!result?.key.id) throw new Error('WhatsApp tidak mengembalikan ID pesan.');
    return { messageId: result.key.id };
  }

  async sendMedia(input: { sessionId: number; phone: string; type: 'image' | 'document'; data: Buffer; mimeType: string; fileName: string; caption: string; messageId?: string }): Promise<{ messageId: string }> {
	const socket = this.sockets.get(input.sessionId);
	if (!socket) throw new Error('WhatsApp belum terhubung.');
	const jid = `${normalizeIndonesianPhone(input.phone).replace('+', '')}@s.whatsapp.net`;
	const content = input.type === 'image'
	  ? { image: input.data, caption: input.caption, mimetype: input.mimeType }
	  : { document: input.data, caption: input.caption, mimetype: input.mimeType, fileName: input.fileName };
	const result = await socket.sendMessage(jid, content, input.messageId ? { messageId: input.messageId } : undefined);
	if (!result?.key.id) throw new Error('WhatsApp tidak mengembalikan ID pesan.');
	return { messageId: result.key.id };
  }

  async disconnect(sessionId: number, logout = false): Promise<void> {
    const socket = this.sockets.get(sessionId);
    if (socket && logout) await socket.logout();
    socket?.end(undefined);
    this.sockets.delete(sessionId);
	this.releaseConnectionLock(sessionId);
	this.setStatus(sessionId, {
      status: logout ? 'logged_out' : 'disconnected',
      message: logout ? 'Perangkat telah logout.' : 'Koneksi diputuskan.',
	  developmentStorage: this.authDriver === 'filesystem',
    });
  }
}
