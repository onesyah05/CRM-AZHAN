import { describe, expect, it } from 'vitest';
import { DemoStore } from './demo-store.js';

describe('DemoStore tenant scope', () => {
  it('does not return a lead through another brand scope', () => {
    const store = new DemoStore();
    expect(store.getLead(2, 'lead-1')).toBeNull();
    expect(store.updateLead(2, 'lead-1', { name: 'Tidak boleh' })).toBeNull();
  });

  it('requires the Deal flow for the Deal stage', () => {
    const store = new DemoStore();
    expect(() => store.moveLead(1, 'lead-1', 'deal', 'Tester')).toThrow('DEAL_FLOW_REQUIRED');
  });

  it('returns the same Deal result for the same idempotency key', () => {
    const store = new DemoStore();
    const request = {
      scheduleId: 101,
      roomType: 'Quad' as const,
      pax: 2,
      commitmentType: 'book_seat' as const,
      seatHoldExpiresAt: '2026-08-31T10:00:00+07:00',
    };
    const first = store.processDeal(1, 'lead-1', request, 'fixed-key');
    const second = store.processDeal(1, 'lead-1', request, 'fixed-key');
    expect(first?.lead.stageId).toBe('deal');
    expect(first?.lead.dealSubstatus).toBe('book_seat');
    expect(first?.lead.erpBookingId).toBeTypeOf('number');
    expect(first?.lead.erpJamaahId).toBeTypeOf('number');
    expect(second?.conversionId).toBe(first?.conversionId);
    expect(second?.lead.erpBookingId).toBe(first?.lead.erpBookingId);
  });
});
