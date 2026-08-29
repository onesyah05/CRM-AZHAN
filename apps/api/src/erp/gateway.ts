import type { BrandContext, DealRequest, Lead, Schedule } from '@azhan-crm/contracts';
import type { ErpDealResult } from '@azhan-crm/database';

type JsonRecord = Record<string, unknown>;

export interface ErpPayment {
  id: number;
  booking_id: number;
  status: 'pending' | 'confirmed' | 'rejected';
  source: string;
  rejection_reason?: string | null;
}

export interface ErpCrmUser {
  id: number;
  brand_id: number;
  email: string;
  display_name: string;
  role: 'cs';
  is_active: boolean;
}

export interface ErpLoginResult {
  user_id: number;
  display_name: string;
  role: 'admin' | 'cs';
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class ErpGatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class ErpGateway {
  constructor(private readonly baseUrl: string) {}

  private resolveAssetUrl(value: string): string {
    try {
      return new URL(value, `${this.baseUrl.replace(/\/$/, '')}/`).toString();
    } catch {
      return value;
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    accessToken?: string,
    correlationId?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
          ...init.headers,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as JsonRecord;
      if (!response.ok) {
        const message = typeof payload.error === 'string' ? payload.error : 'ERP tidak dapat memproses permintaan.';
        throw new ErpGatewayError(
          response.status,
          `ERP_${response.status}`,
          message,
          response.status >= 500 || response.status === 429,
        );
      }
      return payload as T;
    } catch (error) {
      if (error instanceof ErpGatewayError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ErpGatewayError(504, 'ERP_TIMEOUT', 'ERP tidak merespons tepat waktu.', true);
      }
      throw new ErpGatewayError(503, 'ERP_UNAVAILABLE', 'ERP belum dapat dihubungi.', true);
    } finally {
      clearTimeout(timeout);
    }
  }

  login(email: string, password: string) {
    return this.request<ErpLoginResult>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
  }

  listCrmUsers(accessToken: string, brandId: number): Promise<ErpCrmUser[]> {
    return this.request<ErpCrmUser[]>(
      '/api/admin/crm/users',
      { method: 'GET', headers: { 'x-crm-brand-id': String(brandId) } },
      accessToken,
    );
  }

  createCrmUser(accessToken: string, brandId: number, input: { email: string; displayName: string; password: string }): Promise<ErpCrmUser> {
    return this.request<ErpCrmUser>(
      '/api/admin/crm/users',
      {
        method: 'POST',
        headers: { 'x-crm-brand-id': String(brandId) },
        body: JSON.stringify({ email: input.email, display_name: input.displayName, password: input.password }),
      },
      accessToken,
    );
  }

  updateCrmUser(accessToken: string, brandId: number, userId: number, input: { email: string; displayName: string; isActive: boolean }): Promise<ErpCrmUser> {
    return this.request<ErpCrmUser>(
      `/api/admin/crm/users/${userId}`,
      {
        method: 'PUT',
        headers: { 'x-crm-brand-id': String(brandId) },
        body: JSON.stringify({ email: input.email, display_name: input.displayName, is_active: input.isActive }),
      },
      accessToken,
    );
  }

  resetCrmUserPassword(accessToken: string, brandId: number, userId: number, password: string): Promise<void> {
    return this.request<void>(
      `/api/admin/crm/users/${userId}/password`,
      { method: 'PUT', headers: { 'x-crm-brand-id': String(brandId) }, body: JSON.stringify({ password }) },
      accessToken,
    );
  }

  refresh(refreshToken: string) {
    return this.request<{ access_token: string; refresh_token?: string; expires_in: number }>(
      '/api/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) },
    );
  }

  async getMyBrand(accessToken: string): Promise<BrandContext | null> {
    try {
      const brand = await this.request<{ id: number; name: string; primary_color?: string; logo_url?: string }>(
        '/api/admin/my-brand',
        { method: 'GET' },
        accessToken,
      );
      return {
        id: brand.id,
        name: brand.name,
        primaryColor: brand.primary_color ?? '#CC904A',
        ...(brand.logo_url ? { logoUrl: this.resolveAssetUrl(brand.logo_url) } : {}),
      };
    } catch (error) {
      if (error instanceof ErpGatewayError && error.status === 404) return null;
      throw error;
    }
  }

  async listBrands(accessToken: string): Promise<BrandContext[]> {
    const brands = await this.request<Array<{ id: number; name: string; primary_color?: string; logo_url?: string }>>(
      '/api/admin/brands',
      { method: 'GET' },
      accessToken,
    );
    return brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
      primaryColor: brand.primary_color ?? '#CC904A',
      ...(brand.logo_url ? { logoUrl: this.resolveAssetUrl(brand.logo_url) } : {}),
    }));
  }

  async listSchedules(accessToken: string): Promise<Schedule[]> {
    const schedules = await this.request<
      Array<{
        id: number;
        jadwal_nama: string;
        berangkat_tanggal: string;
        seat_sisa: number;
        harga_quad: number;
        harga_triple: number;
        harga_double: number;
      }>
    >('/api/admin/schedules?status=published', { method: 'GET' }, accessToken);
    return schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.jadwal_nama,
      departureDate: schedule.berangkat_tanggal,
      seatRemaining: schedule.seat_sisa,
      prices: {
        Quad: schedule.harga_quad,
        Triple: schedule.harga_triple,
        Double: schedule.harga_double,
      },
    }));
  }

  processDeal(
    accessToken: string,
    brandId: number,
    lead: Lead,
    deal: DealRequest,
    idempotencyKey: string,
    correlationId?: string,
  ): Promise<ErpDealResult> {
    return this.request<ErpDealResult>(
      '/api/admin/crm/deals',
      {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          brand_id: brandId,
          crm_lead_id: lead.id,
          jamaah: {
            ...(lead.erpJamaahId ? { id: lead.erpJamaahId } : {}),
            nama_lengkap: lead.name,
            no_hp: lead.phone,
            ...(lead.email ? { email: lead.email } : {}),
            ...(lead.city ? { alamat: lead.city } : {}),
          },
          schedule_id: deal.scheduleId,
          room_type: deal.roomType,
          pax: deal.pax,
          commitment_type: deal.commitmentType,
          ...(deal.seatHoldExpiresAt ? { seat_hold_expires_at: deal.seatHoldExpiresAt } : {}),
          ...(deal.paymentAmount ? { payment_amount: deal.paymentAmount } : {}),
          ...(deal.paymentMethod ? { payment_method: deal.paymentMethod } : {}),
          ...(deal.paymentDate ? { payment_date: deal.paymentDate } : {}),
          ...(deal.paymentProofUrl ? { payment_proof_url: deal.paymentProofUrl } : {}),
        }),
      },
      accessToken,
      correlationId,
    );
  }

  listBookingPayments(accessToken: string, bookingId: number, correlationId?: string): Promise<ErpPayment[]> {
    return this.request<ErpPayment[]>(
      `/api/admin/bookings/${bookingId}/payments`,
      { method: 'GET' },
      accessToken,
      correlationId,
    );
  }
}
