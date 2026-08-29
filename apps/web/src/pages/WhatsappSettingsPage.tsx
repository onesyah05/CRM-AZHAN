import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Link2, LogOut, MessageCircleMore, QrCode, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { api, ApiClientError } from '../api';
import { ErrorState, LoadingState, PageHeader } from '../components/ui';
import { formatDateTime } from '../utils';
import type { UserContext } from '@azhan-crm/contracts';

export function WhatsappSettingsPage({ user }: { user: UserContext }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['whatsapp-status'], queryFn: api.whatsappStatus, refetchInterval: 3_000 });
  const connect = useMutation({ mutationFn: api.connectWhatsapp, onSuccess: (data) => queryClient.setQueryData(['whatsapp-status'], data) });
  const disconnect = useMutation({ mutationFn: () => api.disconnectWhatsapp(true), onSuccess: (data) => queryClient.setQueryData(['whatsapp-status'], data) });
  if (status.isLoading) return <LoadingState label="Memeriksa koneksi WhatsApp…" />;
  if (status.error || !status.data) return <ErrorState message="Status WhatsApp belum tersedia." onRetry={() => void status.refetch()} />;
  const connected = status.data.status === 'connected';
  const mutationError = connect.error ?? disconnect.error;
  return (
    <div className="page page--settings">
      <PageHeader title="Koneksi WhatsApp" description="Hubungkan nomor WhatsApp brand untuk menerima dan membalas percakapan." />
      <div className="settings-grid">
        <section className="panel connection-card">
          <header><span className={`connection-card__icon ${connected ? 'connection-card__icon--connected' : ''}`}>{connected ? <CheckCircle2 /> : <Smartphone />}</span><div><h2>{connected ? 'WhatsApp terhubung' : 'WhatsApp belum terhubung'}</h2><p>{status.data.message}</p></div><span className={`connection-chip ${connected ? 'connection-chip--connected' : ''}`}><span className="status-dot" />{status.data.status.replace('_', ' ')}</span></header>
          {status.data.qrDataUrl ? <div className="qr-panel"><img src={status.data.qrDataUrl} alt="QR untuk menghubungkan WhatsApp" /><div><h3>Pindai QR dari WhatsApp</h3><ol><li>Buka WhatsApp di ponsel.</li><li>Pilih Perangkat tertaut.</li><li>Pindai QR ini sebelum kedaluwarsa.</li></ol></div></div> : null}
          {connected ? <dl className="connection-details"><div><dt>Nomor</dt><dd>{status.data.phone}</dd></div><div><dt>Terhubung sejak</dt><dd>{status.data.lastConnectedAt ? formatDateTime(status.data.lastConnectedAt) : '—'}</dd></div><div><dt>Workspace</dt><dd>{user.brand?.name ?? '—'}</dd></div></dl> : null}
          {mutationError ? <div className="inline-error" role="alert">{mutationError instanceof ApiClientError ? mutationError.message : 'Aksi belum berhasil.'}</div> : null}
          <footer>{connected ? <><button className="button button--secondary" disabled={connect.isPending || disconnect.isPending} onClick={() => connect.mutate()}><RefreshCw size={17} />Hubungkan ulang</button><button className="button button--danger-ghost" disabled={disconnect.isPending || connect.isPending} onClick={() => { if (window.confirm('Keluar dari WhatsApp dan hapus sesi perangkat untuk brand ini?')) disconnect.mutate(); }}><LogOut size={17} />Keluar & hapus sesi</button></> : <button className="button button--primary" disabled={connect.isPending} onClick={() => connect.mutate()}><QrCode size={17} />Tampilkan QR</button>}</footer>
        </section>
        <aside className="settings-aside">
          <section className="panel security-card"><span><ShieldCheck /></span><h3>Keamanan sesi</h3><p>Kredensial WhatsApp adalah data sensitif. Folder auth hanya dipakai pada development dan tidak boleh masuk Git.</p></section>
          {status.data.developmentStorage ? <section className="notice-card notice-card--warning"><AlertTriangle size={20} /><div><strong>Development storage aktif</strong><p>Gunakan auth store database terenkripsi sebelum production.</p></div></section> : null}
          <section className="panel checklist-card"><h3>Yang dapat dilakukan</h3><ul><li><MessageCircleMore size={16} />Terima dan balas pesan personal</li><li><Link2 size={16} />Hubungkan pesan ke lead otomatis</li><li><CheckCircle2 size={16} />Pantau status pengiriman</li></ul><small>Broadcast massal tidak disediakan.</small></section>
        </aside>
      </div>
    </div>
  );
}
