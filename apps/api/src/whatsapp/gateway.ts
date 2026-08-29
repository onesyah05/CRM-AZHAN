import type { MessageStatus, WhatsAppStatus } from '@azhan-crm/contracts';

export interface IncomingWhatsAppMessage {
  sessionId: number;
  messageId: string;
  jid: string;
  phone: string;
  pushName: string;
  body: string;
	type: 'text' | 'image' | 'document';
	media?: { data: Buffer; mimeType: string; fileName: string };
  occurredAt: string;
}

export interface WhatsAppGateway {
  connect(sessionId: number): Promise<void>;
  disconnect(sessionId: number, logout?: boolean): Promise<void>;
  sendText(input: { sessionId: number; phone: string; text: string; messageId?: string }): Promise<{ messageId: string }>;
	sendMedia(input: { sessionId: number; phone: string; type: 'image' | 'document'; data: Buffer; mimeType: string; fileName: string; caption: string; messageId?: string }): Promise<{ messageId: string }>;
  getStatus(sessionId: number): WhatsAppStatus;
  onIncoming(handler: (message: IncomingWhatsAppMessage) => Promise<void>): void;
  onStatus(handler: (update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>): void;
}
