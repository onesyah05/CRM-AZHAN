import type { MessageStatus, WhatsAppStatus } from '@azhan-crm/contracts';
import type { IncomingWhatsAppMessage, WhatsAppGateway } from './gateway.js';

export class DemoWhatsAppGateway implements WhatsAppGateway {
  private status: WhatsAppStatus = {
    status: 'connected',
    phone: '+62812••••778',
    lastConnectedAt: new Date().toISOString(),
    message: 'Nomor demo terhubung',
    developmentStorage: true,
  };

  private incomingHandler: ((message: IncomingWhatsAppMessage) => Promise<void>) | null = null;
	private statusHandler: ((update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>) | null = null;

  async connect(): Promise<void> {
    this.status = {
      status: 'connected',
      phone: '+62812••••778',
      lastConnectedAt: new Date().toISOString(),
      message: 'Nomor demo terhubung',
      developmentStorage: true,
    };
  }

  async disconnect(): Promise<void> {
    this.status = {
      status: 'disconnected',
      message: 'Nomor demo diputuskan',
      developmentStorage: true,
    };
  }

  async sendText(input: { messageId?: string }): Promise<{ messageId: string }> {
    return { messageId: input.messageId ?? `demo-wa-${crypto.randomUUID()}` };
  }

  async sendMedia(input: { messageId?: string }): Promise<{ messageId: string }> {
	return { messageId: input.messageId ?? `demo-wa-${crypto.randomUUID()}` };
  }

  getStatus(): WhatsAppStatus {
    return this.status;
  }

  onIncoming(handler: (message: IncomingWhatsAppMessage) => Promise<void>): void {
    this.incomingHandler = handler;
  }

  onStatus(handler: (update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>): void {
	this.statusHandler = handler;
  }
}
