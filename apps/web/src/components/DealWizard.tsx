import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, CreditCard, ShieldCheck, TicketCheck } from 'lucide-react';
import type { CommitmentType, DealRequest, Lead, Schedule } from '@azhan-crm/contracts';
import { api, ApiClientError } from '../api';
import { formatCurrency } from '../utils';
import { Dialog } from './ui';

const commitmentOptions: Array<{
  id: CommitmentType;
  label: string;
  description: string;
  icon: typeof TicketCheck;
}> = [
  { id: 'book_seat', label: 'Book Seat', description: 'Tahan kursi tanpa mencatat pembayaran.', icon: TicketCheck },
  { id: 'dp', label: 'DP', description: 'Catat uang muka dan tunggu verifikasi.', icon: CreditCard },
  { id: 'lunas', label: 'Lunas', description: 'Catat pembayaran penuh.', icon: ShieldCheck },
];

function tomorrowLocal(): string {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function DealWizard({
  lead,
  schedules,
  onClose,
  onCompleted,
}: {
  lead: Lead;
  schedules: Schedule[];
  onClose: () => void;
  onCompleted: (lead: Lead) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [scheduleId, setScheduleId] = useState(lead.scheduleId ?? schedules[0]?.id ?? 0);
  const [roomType, setRoomType] = useState<Lead['roomType']>(lead.roomType);
  const [pax, setPax] = useState(lead.pax);
  const [commitmentType, setCommitmentType] = useState<CommitmentType>('book_seat');
  const [seatHoldExpiresAt, setSeatHoldExpiresAt] = useState(tomorrowLocal());
  const [paymentAmount, setPaymentAmount] = useState(5_000_000);
  const [paymentMethod, setPaymentMethod] = useState('transfer');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentProofUrl, setPaymentProofUrl] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());
  const selectedSchedule = schedules.find((schedule) => schedule.id === scheduleId);
  const totalValue = selectedSchedule ? selectedSchedule.prices[roomType] * pax : 0;
  const effectivePaymentAmount = commitmentType === 'lunas' ? totalValue : paymentAmount;
  const erpDashboardBaseUrl = (import.meta.env.VITE_ERP_DASHBOARD_URL as string | undefined)?.replace(/\/$/, '');
  const paymentProofValid = !paymentProofUrl.trim() || (() => { try { return ['http:', 'https:'].includes(new URL(paymentProofUrl).protocol); } catch { return false; } })();

  const payload = useMemo<DealRequest>(() => ({
    scheduleId,
    roomType,
    pax,
    commitmentType,
    ...(commitmentType === 'book_seat'
      ? (seatHoldExpiresAt ? { seatHoldExpiresAt: new Date(seatHoldExpiresAt).toISOString() } : {})
      : {
          paymentAmount: effectivePaymentAmount,
          paymentMethod,
          paymentDate,
          ...(paymentProofUrl.trim() ? { paymentProofUrl: paymentProofUrl.trim() } : {}),
        }),
  }), [commitmentType, effectivePaymentAmount, pax, paymentDate, paymentMethod, paymentProofUrl, roomType, scheduleId, seatHoldExpiresAt]);

  const mutation = useMutation({
    mutationFn: () => api.deal(lead.id, payload, idempotencyKey.current),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      setStep(4);
      onCompleted(result.lead);
    },
  });

  const canContinue = step === 1
    ? lead.name.trim().length > 1 && lead.phone.trim().length > 0
    : Boolean(selectedSchedule && selectedSchedule.seatRemaining >= pax && pax > 0 && paymentProofValid && (commitmentType === 'book_seat' ? seatHoldExpiresAt : effectivePaymentAmount > 0));

  return (
    <Dialog
      title="Proses Deal"
      description="Buat booking ERP dan catat jenis komitmen calon jamaah."
      onClose={onClose}
      size="lg"
    >
      <div className="wizard-progress" aria-label={`Langkah ${Math.min(step, 3)} dari 3`}>
        {['Data jamaah', 'Paket & komitmen', 'Konfirmasi'].map((label, index) => (
          <div key={label} className={`wizard-progress__item ${step > index ? 'wizard-progress__item--active' : ''}`}>
            <span>{step > index + 1 ? <Check size={14} /> : index + 1}</span><strong>{label}</strong>
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="wizard-body">
          <div className="notice-card notice-card--info">
            <ShieldCheck size={20} />
            <div><strong>Data akan dihubungkan ke ERP</strong><p>Pastikan nama dan nomor WhatsApp sesuai calon jamaah.</p></div>
          </div>
          <dl className="review-grid">
            <div><dt>Nama jamaah</dt><dd>{lead.name}</dd></div>
            <div><dt>Nomor WhatsApp</dt><dd>{lead.phone}</dd></div>
            <div><dt>Email</dt><dd>{lead.email || 'Belum diisi'}</dd></div>
            <div><dt>Domisili</dt><dd>{lead.city || 'Belum diisi'}</dd></div>
          </dl>
          <p className="helper-text">CRM akan memakai data ini untuk membuat jamaah dan booking ERP secara idempoten.</p>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="wizard-body form-stack">
          <label className="field"><span>Paket/Jadwal</span>
            <select value={scheduleId} onChange={(event) => setScheduleId(Number(event.target.value))}>
              {schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name} · {schedule.seatRemaining} seat</option>)}
            </select>
          </label>
          <div className="form-row">
            <label className="field"><span>Tipe kamar</span>
              <select value={roomType} onChange={(event) => setRoomType(event.target.value as Lead['roomType'])}>
                <option>Quad</option><option>Triple</option><option>Double</option>
              </select>
            </label>
            <label className="field"><span>Jumlah jamaah</span>
              <input type="number" min={1} max={20} value={pax} onChange={(event) => setPax(Number(event.target.value))} />
            </label>
          </div>
          <fieldset className="commitment-fieldset">
            <legend>Jenis komitmen</legend>
            <div className="commitment-options">
              {commitmentOptions.map(({ id, label, description, icon: Icon }) => (
                <label key={id} className={`commitment-option ${commitmentType === id ? 'commitment-option--selected' : ''}`}>
                  <input type="radio" name="commitment" value={id} checked={commitmentType === id} onChange={() => setCommitmentType(id)} />
                  <Icon size={20} /><span><strong>{label}</strong><small>{description}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          {commitmentType === 'book_seat' ? (
            <label className="field"><span>Batas Book Seat</span>
              <div className="input-with-icon"><CalendarClock size={18} /><input type="datetime-local" value={seatHoldExpiresAt} onChange={(event) => setSeatHoldExpiresAt(event.target.value)} /></div>
              <small>Kursi dilepas otomatis jika belum berubah menjadi DP/Lunas.</small>
            </label>
          ) : (
            <div className="form-stack">
              <div className="form-row">
              <label className="field"><span>Nominal pembayaran</span><input type="number" min={1} value={effectivePaymentAmount} disabled={commitmentType === 'lunas'} onChange={(event) => setPaymentAmount(Number(event.target.value))} /><small>{commitmentType === 'lunas' ? 'Otomatis sama dengan total booking.' : 'Nominal uang muka yang diterima.'}</small></label>
              <label className="field"><span>Metode</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="transfer">Transfer</option><option value="cash">Tunai</option></select></label>
              <label className="field"><span>Tanggal</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
              </div>
              <label className="field"><span>URL bukti pembayaran <small>(opsional)</small></span><input type="url" value={paymentProofUrl} aria-invalid={!paymentProofValid} onChange={(event) => setPaymentProofUrl(event.target.value)} placeholder="https://…" />{!paymentProofValid ? <small className="field-error">Gunakan URL http:// atau https:// yang valid.</small> : null}</label>
            </div>
          )}
          <div className="price-summary"><span>Estimasi nilai booking</span><strong>{formatCurrency(totalValue)}</strong></div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="wizard-body">
          <div className="confirmation-hero"><span><Check size={22} /></span><div><h3>Periksa sebelum memproses</h3><p>Aksi hanya dijalankan sekali meski tombol tertekan kembali.</p></div></div>
          <dl className="review-grid review-grid--boxed">
            <div><dt>Jamaah</dt><dd>{lead.name}</dd></div>
            <div><dt>Paket</dt><dd>{selectedSchedule?.name}</dd></div>
            <div><dt>Kamar & jumlah</dt><dd>{roomType} · {pax} orang</dd></div>
            <div><dt>Jenis komitmen</dt><dd>{commitmentOptions.find((item) => item.id === commitmentType)?.label}</dd></div>
            <div><dt>Nilai booking</dt><dd>{formatCurrency(totalValue)}</dd></div>
            <div><dt>{commitmentType === 'book_seat' ? 'Batas hold' : 'Pembayaran'}</dt><dd>{commitmentType === 'book_seat' ? new Date(seatHoldExpiresAt).toLocaleString('id-ID') : formatCurrency(effectivePaymentAmount)}</dd></div>
          </dl>
          {mutation.error ? (
            <div className="inline-error" role="alert">
              {mutation.error instanceof ApiClientError ? mutation.error.message : 'Proses Deal belum berhasil.'}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 4 ? (
        <div className="success-state" role="status">
          <span><Check size={30} /></span>
          <h3>Deal berhasil diproses</h3>
          <p>{mutation.data?.message}</p>
          <div className="success-state__meta"><span>ID Booking</span><strong>#{mutation.data?.lead.erpBookingId}</strong></div>
          {erpDashboardBaseUrl && mutation.data?.lead.erpBookingId ? <a className="button button--secondary" href={`${erpDashboardBaseUrl}/bookings/${mutation.data.lead.erpBookingId}`} target="_blank" rel="noreferrer">Buka booking ERP</a> : null}
          <button className="button button--primary" onClick={onClose}>Selesai</button>
        </div>
      ) : (
        <footer className="dialog__footer">
          <button className="button button--secondary" onClick={() => step === 1 ? onClose() : setStep((value) => value - 1)} disabled={mutation.isPending}>{step === 1 ? 'Batal' : 'Kembali'}</button>
          {step < 3 ? (
            <button className="button button--primary" disabled={!canContinue} onClick={() => setStep((value) => value + 1)}>Lanjutkan</button>
          ) : (
            <button className="button button--primary" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Memproses…' : 'Buat booking & Deal'}</button>
          )}
        </footer>
      )}
    </Dialog>
  );
}
