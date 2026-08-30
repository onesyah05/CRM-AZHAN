import type { MessageStatus, WhatsAppStatus } from '@azhan-crm/contracts';
import type { HistoricalWhatsAppMessage, IncomingWhatsAppMessage, WhatsAppGateway, WhatsAppPresenceUpdate } from './gateway.js';

export class TestFixtureWhatsAppGateway implements WhatsAppGateway {
  private status: WhatsAppStatus = {
    status: 'connected',
    phone: '+62812••••778',
    lastConnectedAt: new Date().toISOString(),
    message: 'Nomor fixture terhubung',
    developmentStorage: true,
  };

  private incomingHandler: ((message: IncomingWhatsAppMessage) => Promise<void>) | null = null;
	private statusHandler: ((update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>) | null = null;

  async restoreConnections(): Promise<void> {}

  async connect(): Promise<void> {
    this.status = {
      status: 'connected',
      phone: '+62812••••778',
      lastConnectedAt: new Date().toISOString(),
      message: 'Nomor fixture terhubung',
      developmentStorage: true,
    };
  }

  async disconnect(): Promise<void> {
    this.status = {
      status: 'disconnected',
      message: 'Nomor fixture diputuskan',
      developmentStorage: true,
    };
  }

  async sendText(input: { messageId?: string }): Promise<{ messageId: string }> {
    return { messageId: input.messageId ?? `fixture-wa-${crypto.randomUUID()}` };
  }

  async sendMedia(input: { messageId?: string }): Promise<{ messageId: string }> {
	return { messageId: input.messageId ?? `fixture-wa-${crypto.randomUUID()}` };
  }

  async subscribePresence(): Promise<void> {}

  async sendPresence(): Promise<void> {}

  async markRead(): Promise<void> {}

  getPresence(): { presence: 'offline' } {
    return { presence: 'offline' };
  }

  getStatus(): WhatsAppStatus {
    return this.status;
  }

  onIncoming(handler: (message: IncomingWhatsAppMessage) => Promise<void>): void {
    this.incomingHandler = handler;
  }

  onHistory(_handler: (messages: HistoricalWhatsAppMessage[]) => Promise<void>): void {}

  onStatus(handler: (update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>): void {
	this.statusHandler = handler;
  }

  onPresence(_handler: (update: WhatsAppPresenceUpdate) => void): void {}
}
