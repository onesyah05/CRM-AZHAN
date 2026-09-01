import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io as createSocket, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./whatsapp/baileys-gateway.js', () => ({
  BaileysWhatsAppGateway: class {
    onIncoming() {}
    onStatus() {}
  },
}));

let baseUrl: string;
let httpServer: Server;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.TEST_FIXTURES = 'true';
  ({ httpServer } = await import('./server.js'));
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
	if (!httpServer) return;
  await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
});

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

describe('Socket.IO session authorization', () => {
  it('menolak socket tanpa session login', async () => {
    const socket = createSocket(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
    await expect(waitForConnect(socket)).rejects.toThrow('UNAUTHORIZED');
    socket.disconnect();
  });

  it('menerima session login dan memutus socket saat logout', async () => {
    const login = await fetch(`${baseUrl}/api/v1/auth/test`, { method: 'POST' });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toContain('azhan_crm_session=');

    const socket = createSocket(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { cookie: cookie! },
    });
    await waitForConnect(socket);
    expect(socket.connected).toBe(true);

    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { cookie: cookie! } });
    expect(logout.status).toBe(204);
    await expect(disconnected).resolves.toBe('io server disconnect');
  });
});
