import type { ContactPresence, MessageStatus, MessageType, WhatsAppStatus } from '@azhan-crm/contracts';

export interface WhatsAppPresenceUpdate {
  sessionId: number;
  phone: string;
  presence: ContactPresence;
  lastSeenAt?: string;
}

export interface IncomingWhatsAppMessage {
  sessionId: number;
  messageId: string;
  jid: string;
  phone: string;
  pushName: string;
  body: string;
	type: MessageType;
	media?: { data: Buffer; mimeType: string; fileName: string };
  occurredAt: string;
}

export interface HistoricalWhatsAppMessage extends IncomingWhatsAppMessage {
  direction: 'inbound' | 'outbound';
  status: MessageStatus;
}

export interface HistoricalWhatsAppContact {
  sessionId: number;
  phone: string;
  jid: string;
  aliases: string[];
  name: string;
}

export interface WhatsAppGateway {
  restoreConnections(): Promise<void>;
  connect(sessionId: number): Promise<void>;
  disconnect(sessionId: number, logout?: boolean): Promise<void>;
  sendText(input: { sessionId: number; phone: string; text: string; messageId?: string }): Promise<{ messageId: string }>;
	sendMedia(input: { sessionId: number; phone: string; type: Exclude<MessageType, 'text'>; data: Buffer; mimeType: string; fileName: string; caption: string; messageId?: string }): Promise<{ messageId: string }>;
  subscribePresence(sessionId: number, phone: string): Promise<void>;
  sendPresence(sessionId: number, phone: string, presence: 'composing' | 'paused'): Promise<void>;
  markRead(sessionId: number, phone: string, messageIds: string[]): Promise<void>;
  getProfilePicture(sessionId: number, phone: string): Promise<{ data: Buffer; mimeType: string } | null>;
  getPresence(sessionId: number, phone: string): Omit<WhatsAppPresenceUpdate, 'sessionId' | 'phone'>;
  getStatus(sessionId: number): WhatsAppStatus;
  onIncoming(handler: (message: IncomingWhatsAppMessage) => Promise<void>): void;
  onHistory(handler: (messages: HistoricalWhatsAppMessage[]) => Promise<void>): void;
  onContacts(handler: (contacts: HistoricalWhatsAppContact[]) => Promise<void>): void;
  onStatus(handler: (update: { sessionId: number; messageId: string; status: MessageStatus }) => Promise<void>): void;
  onPresence(handler: (update: WhatsAppPresenceUpdate) => void): void;
}
