export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_required'
  | 'connected'
  | 'reconnecting'
  | 'logged_out';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document';
export type ContactPresence = 'offline' | 'online' | 'typing' | 'recording';
export type CommitmentType = 'book_seat' | 'dp' | 'lunas';
export type DashboardPeriod = 'today' | 'week' | 'month' | 'all';
export type DealSubstatus =
  | 'book_seat'
  | 'book_seat_expired'
  | 'dp_pending'
  | 'dp_confirmed'
  | 'dp_rejected'
  | 'paid';

export interface BrandContext {
  id: number;
  name: string;
  primaryColor: string;
  logoUrl?: string;
}

export interface UserContext {
  id: number;
  name: string;
  email: string;
  role: 'super_admin' | 'manager' | 'sales';
  brand: BrandContext | null;
  availableBrands?: BrandContext[];
}

export interface TeamMember {
  userId: number;
  brandId: number;
  email: string;
  displayName: string;
  allocationPercent: number;
  allocatedInCycle: number;
  rotationPosition: number;
  isActive: boolean;
}

export interface TeamPerformance extends TeamMember {
  assignedLeads: number;
  openLeads: number;
  deals: number;
  lost: number;
  conversionRate: number;
  pipelineValue: number;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
  kind: 'open' | 'won' | 'lost';
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Lead {
  id: string;
  brandId: number;
  contactId: string;
  conversationId: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  source: string;
  stageId: string;
  assignee: string;
  assigneeUserId?: number;
  scheduleId: number | null;
  scheduleName: string;
  departurePlan: string;
  roomType: 'Quad' | 'Triple' | 'Double';
  pax: number;
  estimatedValue: number;
  nextFollowUp: string;
  notes: string;
  tags: Tag[];
  unread: number;
  stageAgeDays: number;
  dealSubstatus?: DealSubstatus;
  erpJamaahId?: number;
  erpBookingId?: number;
  erpPaymentId?: number;
  version: number;
  updatedAt: string;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  brandId: number;
  leadId: string;
  name: string;
  phone: string;
  phoneResolved?: boolean;
  avatarSeed: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
  assignee: string;
  assigneeUserId?: number;
  tags: Tag[];
  online: boolean;
  presence: ContactPresence;
  lastSeenAt?: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  source: string;
  conversationId?: string;
  leadId?: string;
  assignee?: string;
}

export interface ContactImportResult {
  imported: number;
  created: number;
  updated: number;
  duplicates: number;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  body: string;
  sentAt: string;
  status: MessageStatus;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
}

export interface Schedule {
  id: number;
  name: string;
  departureDate: string;
  seatRemaining: number;
  prices: {
    Quad: number;
    Triple: number;
    Double: number;
  };
}

export interface DashboardMetrics {
  newLeads: number;
  unread: number;
  deals: number;
  lost: number;
  conversionRate: number;
  medianFirstResponseMinutes: number;
  pipelineValue: number;
  stageDistribution: Array<{ stageId: string; count: number }>;
  activities: Activity[];
}

export interface Activity {
  id: string;
  type: 'message' | 'stage' | 'note' | 'deal' | 'assignment';
  title: string;
  description: string;
  actor: string;
  occurredAt: string;
  leadId?: string;
}

export interface DealRequest {
  scheduleId: number;
  roomType: 'Quad' | 'Triple' | 'Double';
  pax: number;
  commitmentType: CommitmentType;
  seatHoldExpiresAt?: string;
  paymentAmount?: number;
  paymentMethod?: string;
  paymentDate?: string;
  paymentProofUrl?: string;
}

export interface DealResult {
  lead: Lead;
  conversionId: string;
  status: 'completed' | 'requires_retry';
  message: string;
}

export interface WhatsAppStatus {
  status: ConnectionStatus;
  phone?: string;
  qrDataUrl?: string;
  lastConnectedAt?: string;
  message?: string;
  developmentStorage: boolean;
}

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    correlation_id: string;
    retryable: boolean;
    field_errors: Array<{ field: string; message: string }>;
  };
}
