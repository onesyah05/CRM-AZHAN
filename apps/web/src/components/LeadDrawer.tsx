import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Mail, MapPin, MessageCircleMore, Phone, RefreshCw, Save, TicketCheck, UserRound } from 'lucide-react';
import type { Lead, Schedule, Stage } from '@azhan-crm/contracts';
import { api, ApiClientError } from '../api';
import { commitmentLabel, formatCurrency, formatDateTime } from '../utils';
import { Avatar, Dialog, TagPill } from './ui';

export function LeadDrawer({
  lead,
  stages,
  schedules,
  onClose,
  onDeal,
}: {
  lead: Lead;
  stages: Stage[];
  schedules: Schedule[];
  onClose: () => void;
  onDeal: (lead: Lead) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(lead);
  const [editing, setEditing] = useState(false);
  useEffect(() => setForm(lead), [lead]);
  const stage = stages.find((item) => item.id === form.stageId);
  const erpDashboardBaseUrl = (import.meta.env.VITE_ERP_DASHBOARD_URL as string | undefined)?.replace(/\/$/, '');
  const requestClose = () => {
    if (editing && JSON.stringify(form) !== JSON.stringify(lead) && !window.confirm('Perubahan lead belum disimpan. Tutup tanpa menyimpan?')) return;
    onClose();
  };

  const mutation = useMutation({
    mutationFn: () => api.updateLead(lead.id, {
      name: form.name,
      email: form.email,
      city: form.city,
      source: form.source,
      assignee: form.assignee,
      scheduleId: form.scheduleId,
      scheduleName: form.scheduleName,
      departurePlan: form.departurePlan,
      roomType: form.roomType,
      pax: form.pax,
      estimatedValue: form.estimatedValue,
      nextFollowUp: form.nextFollowUp,
      notes: form.notes,
      version: lead.version,
    }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Lead[]>(['leads'], (current) => current?.map((item) => item.id === updated.id ? updated : item));
      setForm(updated);
      setEditing(false);
    },
  });
  const paymentSync = useMutation({
    mutationFn: () => api.syncPayment(lead.id),
    onSuccess: (updated) => {
      queryClient.setQueryData<Lead[]>(['leads'], (current) => current?.map((item) => item.id === updated.id ? updated : item));
      setForm(updated);
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const updateSchedule = (id: number) => {
    const schedule = schedules.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      scheduleId: schedule?.id ?? null,
      scheduleName: schedule?.name ?? '',
      estimatedValue: schedule ? schedule.prices[current.roomType] * current.pax : current.estimatedValue,
    }));
  };

  return (
    <Dialog title="Detail lead" description="Lihat konteks dan perbarui kebutuhan calon jamaah." onClose={requestClose} size="lg">
      <div className="lead-detail">
        <section className="lead-summary-card">
          <Avatar name={form.name} size="lg" />
          <div className="lead-summary-card__identity"><h3>{form.name}</h3><p>{form.phone}</p><div>{form.tags.map((tag) => <TagPill key={tag.id} tag={tag} />)}</div></div>
          <span className="stage-badge" style={{ '--stage-color': stage?.color ?? '#64748B' } as React.CSSProperties}>{stage?.name}</span>
        </section>

        {form.dealSubstatus ? (
          <div className={`notice-card ${form.dealSubstatus === 'dp_rejected' ? 'notice-card--warning' : 'notice-card--success'}`}><TicketCheck size={21} /><div><strong>{commitmentLabel(form.dealSubstatus)}</strong><p>Booking ERP #{form.erpBookingId} sudah terhubung ke lead ini.</p></div><span className="notice-card__actions">{['dp_pending', 'dp_rejected'].includes(form.dealSubstatus) ? <button className="icon-button" onClick={() => paymentSync.mutate()} disabled={paymentSync.isPending} aria-label="Sinkronkan status pembayaran ERP"><RefreshCw className={paymentSync.isPending ? 'spin' : ''} size={17} /></button> : null}{erpDashboardBaseUrl && form.erpBookingId ? <a href={`${erpDashboardBaseUrl}/bookings/${form.erpBookingId}`} target="_blank" rel="noreferrer" aria-label={`Buka booking ERP ${form.erpBookingId}`}><ExternalLink size={18} /></a> : null}</span></div>
        ) : null}
        {paymentSync.error ? <div className="inline-error" role="alert">{paymentSync.error instanceof ApiClientError ? paymentSync.error.message : 'Status pembayaran belum dapat disinkronkan.'}</div> : null}

        <div className="lead-detail__columns">
          <section className="detail-section">
            <header><div><span className="section-icon"><UserRound size={18} /></span><div><h3>Data calon jamaah</h3><p>Informasi kontak dan sumber lead</p></div></div>{!editing ? <button className="button button--secondary button--small" onClick={() => setEditing(true)}>Edit data</button> : null}</header>
            <div className="detail-form-grid">
              <label className="field"><span>Nama lengkap</span><input disabled={!editing} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="field"><span>Email</span><div className="input-with-icon"><Mail size={17} /><input disabled={!editing} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Belum diisi" /></div></label>
              <label className="field"><span>Domisili</span><div className="input-with-icon"><MapPin size={17} /><input disabled={!editing} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} placeholder="Belum diisi" /></div></label>
              <label className="field"><span>Sumber lead</span><input disabled={!editing} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></label>
            </div>
          </section>

          <aside className="detail-sidebar-card">
            <h3>Tindak lanjut</h3>
            <dl>
              <div><dt><Phone size={16} /> WhatsApp</dt><dd>{form.phone}</dd></div>
              <div><dt><UserRound size={16} /> PIC</dt><dd>{editing ? <input value={form.assignee} onChange={(event) => setForm({ ...form, assignee: event.target.value })} /> : form.assignee}</dd></div>
              <div><dt><CalendarClock size={16} /> Follow-up</dt><dd>{editing ? <input type="datetime-local" value={form.nextFollowUp.slice(0, 16)} onChange={(event) => setForm({ ...form, nextFollowUp: event.target.value })} /> : formatDateTime(form.nextFollowUp)}</dd></div>
              <div><dt><MessageCircleMore size={16} /> Conversation</dt><dd>Terhubung</dd></div>
            </dl>
          </aside>
        </div>

        <section className="detail-section">
          <header><div><span className="section-icon"><TicketCheck size={18} /></span><div><h3>Minat perjalanan</h3><p>Paket, kamar, dan estimasi transaksi</p></div></div></header>
          <div className="detail-form-grid detail-form-grid--travel">
            <label className="field field--wide"><span>Paket/Jadwal</span><select disabled={!editing} value={form.scheduleId ?? ''} onChange={(event) => updateSchedule(Number(event.target.value))}><option value="">Pilih paket</option>{schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select></label>
            <label className="field"><span>Tipe kamar</span><select disabled={!editing} value={form.roomType} onChange={(event) => { const roomType = event.target.value as Lead['roomType']; const schedule = schedules.find((item) => item.id === form.scheduleId); setForm({ ...form, roomType, estimatedValue: schedule ? schedule.prices[roomType] * form.pax : form.estimatedValue }); }}><option>Quad</option><option>Triple</option><option>Double</option></select></label>
            <label className="field"><span>Jumlah pax</span><input disabled={!editing} type="number" min={1} value={form.pax} onChange={(event) => { const pax = Number(event.target.value); const schedule = schedules.find((item) => item.id === form.scheduleId); setForm({ ...form, pax, estimatedValue: schedule ? schedule.prices[form.roomType] * pax : form.estimatedValue }); }} /></label>
            <label className="field"><span>Rencana berangkat</span><input disabled={!editing} value={form.departurePlan} onChange={(event) => setForm({ ...form, departurePlan: event.target.value })} /></label>
            <label className="field"><span>Estimasi nilai</span><input disabled value={formatCurrency(form.estimatedValue)} /></label>
            <label className="field field--wide"><span>Catatan</span><textarea disabled={!editing} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          </div>
          {mutation.error ? <div className="inline-error" role="alert">{mutation.error instanceof ApiClientError ? mutation.error.message : 'Perubahan belum tersimpan.'}</div> : null}
          {editing ? <div className="form-actions"><button className="button button--secondary" onClick={() => { setForm(lead); setEditing(false); }}>Batal</button><button className="button button--primary" disabled={mutation.isPending} onClick={() => mutation.mutate()}><Save size={17} />{mutation.isPending ? 'Menyimpan…' : 'Simpan perubahan'}</button></div> : null}
        </section>

        {!form.dealSubstatus ? (
          <footer className="lead-detail__deal-bar"><div><strong>Calon jamaah siap berkomitmen?</strong><span>Pilih Book Seat, DP, atau Lunas dan buat booking ERP.</span></div><button className="button button--success" onClick={() => onDeal(form)}><TicketCheck size={18} />Proses Deal</button></footer>
        ) : null}
      </div>
    </Dialog>
  );
}
