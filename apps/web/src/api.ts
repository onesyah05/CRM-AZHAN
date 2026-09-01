import type {
  ApiErrorShape,
  Activity,
  Conversation,
  Contact,
  ContactImportResult,
  DashboardMetrics,
  DashboardPeriod,
  DealRequest,
  DealResult,
  Lead,
  Message,
  Schedule,
  Stage,
  TeamMember,
  TeamPerformance,
  UserContext,
  WhatsAppStatus,
} from '@azhan-crm/contracts';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly fieldErrors: Array<{ field: string; message: string }> = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorShape | null;
    if (payload?.error) {
      throw new ApiClientError(
        payload.error.code,
        payload.error.message,
        payload.error.retryable,
        payload.error.field_errors,
      );
    }
    throw new ApiClientError('REQUEST_FAILED', 'Permintaan belum berhasil.', response.status >= 500);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  context: () => request<UserContext>('/api/v1/context'),
  login: (email: string, password: string) =>
    request<UserContext>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),
	selectBrand: (brandId: number) => request<UserContext>('/api/v1/auth/select-brand', { method: 'POST', body: JSON.stringify({ brandId }) }),
  dashboard: (period: DashboardPeriod = 'month') => request<DashboardMetrics>(`/api/v1/dashboard?period=${period}`),
  activities: (limit = 100) => request<Activity[]>(`/api/v1/activities?limit=${limit}`),
  team: () => request<TeamMember[]>('/api/v1/team'),
  teamPerformance: (period: DashboardPeriod = 'month') => request<TeamPerformance[]>(`/api/v1/team/performance?period=${period}`),
  createTeamMember: (payload: { email: string; displayName: string; password: string }) =>
    request<TeamMember>('/api/v1/team', { method: 'POST', body: JSON.stringify(payload) }),
  updateTeamMember: (userId: number, payload: { email: string; displayName: string; isActive: boolean }) =>
    request<TeamMember>(`/api/v1/team/${userId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  resetTeamMemberPassword: (userId: number, password: string) =>
    request<void>(`/api/v1/team/${userId}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  updateTeamDistribution: (allocations: Array<{ userId: number; percent: number }>) =>
    request<TeamMember[]>('/api/v1/team/distribution', { method: 'PUT', body: JSON.stringify({ allocations }) }),
  stages: () => request<Stage[]>('/api/v1/stages'),
  schedules: () => request<Schedule[]>('/api/v1/schedules'),
  leads: () => request<Lead[]>('/api/v1/leads'),
  updateLead: (leadId: string, payload: Partial<Lead> & { version: number }) =>
    request<Lead>(`/api/v1/leads/${leadId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  syncPayment: (leadId: string) => request<Lead>(`/api/v1/leads/${leadId}/sync-payment`, { method: 'POST' }),
  moveLead: (leadId: string, stageId: string, lostReason?: string) =>
    request<Lead>(`/api/v1/leads/${leadId}/stage`, {
      method: 'PUT',
      body: JSON.stringify({ stageId, ...(lostReason ? { lostReason } : {}) }),
    }),
  deal: (leadId: string, payload: DealRequest, idempotencyKey: string) =>
    request<DealResult>(`/api/v1/leads/${leadId}/deal`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(payload),
    }),
  conversations: () => request<Conversation[]>('/api/v1/conversations'),
  contacts: () => request<Contact[]>('/api/v1/contacts'),
  importContacts: (contacts: Array<{ name: string; phone: string }>) =>
    request<ContactImportResult>('/api/v1/contacts/import', { method: 'POST', body: JSON.stringify({ contacts }) }),
  messages: (conversationId: string) => request<Message[]>(`/api/v1/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, body: string) =>
    request<Message>(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
	retryMessage: (messageId: string) => request<Message>(`/api/v1/messages/${messageId}/retry`, { method: 'POST' }),
	updatePresence: (conversationId: string, presence: 'composing' | 'paused') =>
	  request<void>(`/api/v1/conversations/${conversationId}/presence`, {
		method: 'POST', body: JSON.stringify({ presence }),
	  }),
	sendMedia: async (conversationId: string, file: File, caption = ''): Promise<Message> => {
	  const response = await fetch(`/api/v1/conversations/${conversationId}/media?caption=${encodeURIComponent(caption)}`, {
		method: 'POST', credentials: 'include', headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file,
	  });
	  if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as ApiErrorShape | null;
		throw new ApiClientError(payload?.error.code ?? 'MEDIA_FAILED', payload?.error.message ?? 'Lampiran belum terkirim.', response.status >= 500);
	  }
	  return response.json() as Promise<Message>;
	},
  whatsappStatus: () => request<WhatsAppStatus>('/api/v1/whatsapp/status'),
  connectWhatsapp: () => request<WhatsAppStatus>('/api/v1/whatsapp/connect', { method: 'POST' }),
  disconnectWhatsapp: (logout = false) =>
    request<WhatsAppStatus>('/api/v1/whatsapp/disconnect', { method: 'POST', body: JSON.stringify({ logout }) }),
};
