import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@azhan-crm/database';

const mocks = vi.hoisted(() => {
  type EventHandler = (payload: never) => unknown;
  const sockets: Array<{
    ev: {
      on: ReturnType<typeof vi.fn>;
      emit: (event: string, payload: unknown) => Promise<void>;
    };
    end: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    presenceSubscribe: ReturnType<typeof vi.fn>;
    sendPresenceUpdate: ReturnType<typeof vi.fn>;
    readMessages: ReturnType<typeof vi.fn>;
	profilePictureUrl: ReturnType<typeof vi.fn>;
    ws: { isOpen: boolean };
    user?: { id: string };
  }> = [];
	const socketConfigs: unknown[] = [];

	const makeWASocket = vi.fn((config?: unknown) => {
	  socketConfigs.push(config);
    const handlers = new Map<string, EventHandler[]>();
    const socket = {
      ev: {
        on: vi.fn((event: string, handler: EventHandler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        }),
        emit: async (event: string, payload: unknown) => {
          for (const handler of handlers.get(event) ?? []) await handler(payload as never);
        },
      },
      end: vi.fn(),
      logout: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ key: { id: 'message-id' } })),
      presenceSubscribe: vi.fn(async () => undefined),
      sendPresenceUpdate: vi.fn(async () => undefined),
      readMessages: vi.fn(async () => undefined),
	  profilePictureUrl: vi.fn(async () => 'https://cdn.example.test/avatar.jpg'),
      ws: { isOpen: true },
    };
    sockets.push(socket);
    return socket;
  });

  return {
    makeWASocket,
    sockets,
	socketConfigs,
    saveCreds: vi.fn(async () => undefined),
    flushAuth: vi.fn(async () => undefined),
    clearAuth: vi.fn(async () => undefined),
    clearLoggedOutAuth: vi.fn(async () => false),
    downloadMediaMessage: vi.fn(async () => Buffer.from('synthetic-media')),
    toDataURL: vi.fn(async () => 'data:image/png;base64,cXItZml4dHVyZQ=='),
  };
});

vi.mock('@whiskeysockets/baileys', () => ({
  default: mocks.makeWASocket,
  Browsers: { ubuntu: () => ['Ubuntu', 'Chrome', '22.04.4'] },
  DisconnectReason: { loggedOut: 401 },
  downloadMediaMessage: mocks.downloadMediaMessage,
  normalizeMessageContent: (content: unknown) => content,
  useMultiFileAuthState: vi.fn(),
}));

vi.mock('qrcode', () => ({ default: { toDataURL: mocks.toDataURL } }));

vi.mock('./database-auth-state.js', () => ({
  clearLoggedOutDatabaseAuthState: mocks.clearLoggedOutAuth,
  useDatabaseAuthState: vi.fn(async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: mocks.saveCreds,
    flush: mocks.flushAuth,
    clear: mocks.clearAuth,
  })),
}));

import { BaileysWhatsAppGateway } from './baileys-gateway.js';

function databasePool(affectedRows = 1): Pool {
  return {
    execute: vi.fn(async () => [{ affectedRows }]),
  } as unknown as Pool;
}

describe('BaileysWhatsAppGateway lifecycle', () => {
  beforeEach(() => {
	vi.useRealTimers();
    mocks.sockets.length = 0;
	mocks.socketConfigs.length = 0;
    mocks.makeWASocket.mockClear();
    mocks.saveCreds.mockClear();
    mocks.flushAuth.mockClear();
    mocks.clearAuth.mockClear();
    mocks.clearLoggedOutAuth.mockClear();
    mocks.downloadMediaMessage.mockClear();
    mocks.toDataURL.mockClear();
	vi.unstubAllGlobals();
  });

  it('memulihkan WebSocket mati meskipun Baileys tidak mengirim event close', async () => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0);
	const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
	await gateway.connect(1);
	const socket = mocks.sockets[0];
	await socket?.ev.emit('connection.update', { connection: 'open' });

	if (socket) socket.ws.isOpen = false;
	await vi.advanceTimersByTimeAsync(15_000);

	expect(gateway.getStatus(1)).toMatchObject({
	  status: 'reconnecting',
	  message: 'Koneksi terputus, mencoba kembali…',
	});
	expect(socket?.end).toHaveBeenCalledOnce();

	await vi.advanceTimersByTimeAsync(2_000);
	expect(mocks.makeWASocket).toHaveBeenCalledTimes(2);
	await gateway.disconnect(1);
	vi.restoreAllMocks();
  });

  it('menyediakan QR tanpa mengekspos payload mentah pada status', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    await gateway.connect(1);
    await mocks.sockets[0]?.ev.emit('connection.update', { qr: 'qr-secret-sintetis' });

    const status = gateway.getStatus(1);
    expect(status.status).toBe('qr_required');
    expect(status.qrDataUrl).toBe('data:image/png;base64,cXItZml4dHVyZQ==');
    expect(JSON.stringify(status)).not.toContain('qr-secret-sintetis');
  });

  it('mengabaikan event close terlambat dari socket yang sudah diganti', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    await gateway.connect(1);
    const oldSocket = mocks.sockets[0];
    await gateway.disconnect(1);
    await gateway.connect(1);

    await oldSocket?.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });

    expect(gateway.getStatus(1).status).toBe('connecting');
    expect(mocks.makeWASocket).toHaveBeenCalledTimes(2);
  });

  it('menjadwalkan ulang koneksi saat lease worker lama belum kedaluwarsa', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(0), 'test-secret-at-least-32-characters');

    await expect(gateway.connect(1)).resolves.toBeUndefined();

    expect(gateway.getStatus(1).status).toBe('reconnecting');
    expect(mocks.makeWASocket).not.toHaveBeenCalled();
    await gateway.disconnect(1);
  });

  it('menghapus auth invalid ketika WhatsApp menyatakan perangkat logout', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    await gateway.connect(1);

    await mocks.sockets[0]?.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    expect(gateway.getStatus(1).status).toBe('logged_out');
    expect(mocks.flushAuth).toHaveBeenCalledOnce();
    expect(mocks.clearAuth).toHaveBeenCalledOnce();
  });

  it('tidak masuk loop reconnect ketika registrasi diputus sebelum QR dibuat', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    await gateway.connect(1);

    await mocks.sockets[0]?.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 428 } } },
    });

    expect(gateway.getStatus(1)).toMatchObject({
      status: 'disconnected',
      message: 'QR belum berhasil dibuat. Tekan Tampilkan QR untuk mencoba lagi.',
    });
    expect(mocks.makeWASocket).toHaveBeenCalledOnce();
  });

  it('menerima video dan audio sebagai media percakapan', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    const incoming = vi.fn(async () => undefined);
    gateway.onIncoming(incoming);
    await gateway.connect(1);

    await mocks.sockets[0]?.ev.emit('messages.upsert', { messages: [{
      key: { id: 'video-message', remoteJid: '628123456789@s.whatsapp.net', fromMe: false },
      pushName: 'Kontak Sintetis', messageTimestamp: 1_788_000_000,
      message: { videoMessage: { caption: 'Video paket', mimetype: 'video/mp4' } },
    }] });
    await mocks.sockets[0]?.ev.emit('messages.upsert', { messages: [{
      key: { id: 'audio-message', remoteJid: '628123456789@s.whatsapp.net', fromMe: false },
      pushName: 'Kontak Sintetis', messageTimestamp: 1_788_000_001,
      message: { audioMessage: { mimetype: 'audio/ogg' } },
    }] });

    await vi.waitFor(() => expect(incoming).toHaveBeenCalledTimes(2));
    expect(incoming).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'video', body: 'Video paket', media: expect.objectContaining({ mimeType: 'video/mp4', fileName: 'video-message.mp4' }) }));
    expect(incoming).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'audio', body: 'Pesan audio', media: expect.objectContaining({ mimeType: 'audio/ogg', fileName: 'audio-message.ogg' }) }));
  });

  it('mengimpor histori dua arah secara kronologis beserta nama kontak', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    const history = vi.fn(async () => undefined);
    const contacts = vi.fn(async () => undefined);
    gateway.onHistory(history);
    gateway.onContacts(contacts);
    await gateway.connect(1);

    await mocks.sockets[0]?.ev.emit('messaging-history.set', {
      contacts: [{ id: '153136080437932@lid', jid: '628123456789@s.whatsapp.net', lid: '153136080437932@lid', name: 'Kontak Histori' }],
      messages: [
        {
          key: { id: 'newer-outbound', remoteJid: '153136080437932@lid', fromMe: true },
          messageTimestamp: 200,
          status: 4,
          message: { conversation: 'Balasan lama' },
        },
        {
          key: { id: 'older-inbound', remoteJid: '153136080437932@lid', fromMe: false },
          messageTimestamp: 100,
          message: { conversation: 'Pertanyaan lama' },
        },
      ],
    });

    await vi.waitFor(() => expect(contacts).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(history).toHaveBeenCalledOnce());
    expect(contacts).toHaveBeenCalledWith([
      expect.objectContaining({ phone: '+628123456789', jid: '628123456789@s.whatsapp.net', aliases: expect.arrayContaining(['153136080437932@lid']) }),
    ]);
    expect(history).toHaveBeenCalledWith([
      expect.objectContaining({ messageId: 'older-inbound', jid: '628123456789@s.whatsapp.net', phone: '+628123456789', pushName: 'Kontak Histori', direction: 'inbound', status: 'read' }),
      expect.objectContaining({ messageId: 'newer-outbound', jid: '628123456789@s.whatsapp.net', phone: '+628123456789', pushName: 'Kontak Histori', direction: 'outbound', status: 'read' }),
    ]);
	const socketConfig = mocks.socketConfigs[0] as { syncFullHistory?: boolean; shouldSyncHistoryMessage?: () => boolean };
	expect(socketConfig.syncFullHistory).toBe(true);
	expect(socketConfig.shouldSyncHistoryMessage?.()).toBe(true);
    expect(socketConfig).toMatchObject({ browser: ['Ubuntu', 'Chrome', '22.04.4'] });
  });

  it('mengabaikan status, broadcast, grup, newsletter, dan LID yang belum terpetakan', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    const incoming = vi.fn(async () => undefined);
    gateway.onIncoming(incoming);
    await gateway.connect(1);

    for (const [id, remoteJid] of [
      ['status', 'status@broadcast'],
      ['broadcast', '628123456789@broadcast'],
      ['group', '120363000000@g.us'],
      ['newsletter', '120363000000@newsletter'],
      ['unresolved-lid', '153136080437932@lid'],
    ]) {
      await mocks.sockets[0]?.ev.emit('messages.upsert', { messages: [{
        key: { id, remoteJid, fromMe: false },
        messageTimestamp: 1_788_000_000,
        message: { conversation: 'Tidak boleh masuk inbox' },
      }] });
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(incoming).not.toHaveBeenCalled();
  });

  it('menerima chat LID setelah WhatsApp membagikan pasangan nomor telepon', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    const incoming = vi.fn(async () => undefined);
    const contacts = vi.fn(async () => undefined);
    gateway.onIncoming(incoming);
    gateway.onContacts(contacts);
    await gateway.connect(1);

    await mocks.sockets[0]?.ev.emit('chats.phoneNumberShare', {
      lid: '153136080437932@lid',
      jid: '628123456789@s.whatsapp.net',
    });
    await mocks.sockets[0]?.ev.emit('messages.upsert', { messages: [{
      key: { id: 'resolved-lid', remoteJid: '153136080437932@lid', fromMe: false },
      messageTimestamp: 1_788_000_000,
      message: { conversation: 'Pesan dari LID valid' },
    }] });

    await vi.waitFor(() => expect(contacts).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(incoming).toHaveBeenCalledOnce());
    expect(incoming).toHaveBeenCalledWith(expect.objectContaining({
      jid: '628123456789@s.whatsapp.net',
      phone: '+628123456789',
      body: 'Pesan dari LID valid',
    }));
  });

  it('menerima chat LID langsung dari senderPn tanpa menunggu sinkronisasi kontak', async () => {
	const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
	const incoming = vi.fn(async () => undefined);
	gateway.onIncoming(incoming);
	await gateway.connect(1);

	await mocks.sockets[0]?.ev.emit('messages.upsert', { messages: [{
	  key: {
		id: 'direct-lid-message',
		remoteJid: '6936489631887:77@lid',
		senderPn: '628971731122@s.whatsapp.net',
		fromMe: false,
	  },
	  pushName: 'Kontak LID',
	  messageTimestamp: 1_788_000_000,
	  message: { conversation: 'Pesan LID diterima' },
	}] });

	await vi.waitFor(() => expect(incoming).toHaveBeenCalledOnce());
	expect(incoming).toHaveBeenCalledWith(expect.objectContaining({
	  jid: '628971731122@s.whatsapp.net',
	  phone: '+628971731122',
	  pushName: 'Kontak LID',
	  body: 'Pesan LID diterima',
	}));
  });

  it('mengirim video dan audio melalui payload Baileys yang sesuai', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    await gateway.connect(1);
    const socket = mocks.sockets[0];

    await gateway.sendMedia({ sessionId: 1, phone: '+628123456789', type: 'video', data: Buffer.from('video'), mimeType: 'video/mp4', fileName: 'paket.mp4', caption: 'Video paket' });
    await gateway.sendMedia({ sessionId: 1, phone: '+628123456789', type: 'audio', data: Buffer.from('audio'), mimeType: 'audio/mpeg', fileName: 'rekaman.mp3', caption: '' });

    expect(socket?.sendMessage).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ video: expect.any(Buffer), mimetype: 'video/mp4' }));
    expect(socket?.sendMessage).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ audio: expect.any(Buffer), mimetype: 'audio/mpeg', ptt: false }));
  });

  it('membiarkan Baileys membuat ID pesan native saat mengirim', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    await gateway.connect(1);

    const result = await gateway.sendText({
      sessionId: 1,
      phone: '+628123456789',
      text: 'Pesan uji',
      messageId: '00000000-0000-4000-8000-000000000001',
    });

    expect(mocks.sockets[0]?.sendMessage).toHaveBeenCalledWith('628123456789@s.whatsapp.net', { text: 'Pesan uji' });
    expect(result).toEqual({ messageId: 'message-id' });
  });

  it('menyinkronkan online, typing, dan read receipt tanpa mencampur tenant', async () => {
    const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
    const onPresence = vi.fn();
    gateway.onPresence(onPresence);
    await gateway.connect(7);
    const socket = mocks.sockets[0];

    await gateway.subscribePresence(7, '+628123456789');
    await gateway.sendPresence(7, '+628123456789', 'composing');
    await gateway.markRead(7, '+628123456789', ['incoming-message-id']);
    await socket?.ev.emit('presence.update', {
      id: '628123456789@s.whatsapp.net',
      presences: { '628123456789@s.whatsapp.net': { lastKnownPresence: 'composing' } },
    });

    expect(socket?.presenceSubscribe).toHaveBeenCalledWith('628123456789@s.whatsapp.net');
    expect(socket?.sendPresenceUpdate).toHaveBeenCalledWith('composing', '628123456789@s.whatsapp.net');
    expect(socket?.readMessages).toHaveBeenCalledWith([{ remoteJid: '628123456789@s.whatsapp.net', id: 'incoming-message-id', fromMe: false }]);
    expect(gateway.getPresence(7, '+628123456789')).toEqual({ presence: 'typing' });
    expect(gateway.getPresence(8, '+628123456789')).toEqual({ presence: 'offline' });
    expect(onPresence).toHaveBeenCalledWith({ sessionId: 7, phone: '+628123456789', presence: 'typing' });
  });

  it('mengambil dan menyimpan sementara foto profil WhatsApp', async () => {
	vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('avatar'), {
	  status: 200,
	  headers: { 'content-type': 'image/jpeg' },
	})));
	const gateway = new BaileysWhatsAppGateway('.data/wa-auth', 'database', databasePool(), 'test-secret-at-least-32-characters');
	await gateway.connect(1);

	const first = await gateway.getProfilePicture(1, '+628123456789');
	const second = await gateway.getProfilePicture(1, '+628123456789');

	expect(first).toEqual({ data: Buffer.from('avatar'), mimeType: 'image/jpeg' });
	expect(second).toEqual(first);
	expect(mocks.sockets[0]?.profilePictureUrl).toHaveBeenCalledOnce();
	expect(fetch).toHaveBeenCalledOnce();
  });

  it('memulihkan koneksi yang memiliki auth persisten ketika API menyala', async () => {
    const execute = vi.fn(async (sql: string) => sql.includes('SELECT brand_id')
      ? [[{ brand_id: 11, connection_status: 'connected', has_auth: 1 }]]
      : [{ affectedRows: 1 }]);
    const gateway = new BaileysWhatsAppGateway(
      '.data/wa-auth', 'database', { execute } as unknown as Pool, 'test-secret-at-least-32-characters',
    );

    await gateway.restoreConnections();

    expect(mocks.makeWASocket).toHaveBeenCalledOnce();
    expect(gateway.getStatus(11).status).toBe('connecting');
  });

  it('mempertahankan status logged out setelah API restart tanpa membuat socket sia-sia', async () => {
    const execute = vi.fn(async (sql: string) => sql.includes('SELECT brand_id')
      ? [[{ brand_id: 12, connection_status: 'logged_out', has_auth: 0 }]]
      : [{ affectedRows: 1 }]);
    const gateway = new BaileysWhatsAppGateway(
      '.data/wa-auth', 'database', { execute } as unknown as Pool, 'test-secret-at-least-32-characters',
    );

    await gateway.restoreConnections();

    expect(mocks.makeWASocket).not.toHaveBeenCalled();
    expect(gateway.getStatus(12).status).toBe('logged_out');
  });
});
