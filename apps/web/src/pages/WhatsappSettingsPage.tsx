import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Database, Edit3, Link2, LogOut, MessageCircleMore, Plus, QrCode, RefreshCw, Save, ShieldCheck, Smartphone, UserRound, Users, Wifi } from 'lucide-react';
import { api, ApiClientError } from '../api';
import { ErrorState, LoadingState } from '../components/ui';
import { formatDateTime } from '../utils';
import type { UserContext } from '@azhan-crm/contracts';

export function WhatsappSettingsPage({ user }: { user: UserContext }) {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({ queryKey: ['whatsapp-sessions'], queryFn: api.whatsappSessions, refetchInterval: 3_000 });
  const teamQuery = useQuery({ queryKey: ['team'], queryFn: api.team });
  const [selectedId, setSelectedId] = useState<number>();
  const [newLabel, setNewLabel] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [assignedUserIds, setAssignedUserIds] = useState<number[]>([]);
  const sessions = sessionsQuery.data ?? [];
  const selected = useMemo(() => sessions.find((item) => item.id === selectedId) ?? sessions[0], [selectedId, sessions]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (selected) {
      setLabelDraft(selected.label);
      setAssignedUserIds(selected.assignedUserIds);
    }
  // Reset editable fields only when switching devices; polling status must not erase unsaved edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['whatsapp-sessions'] });
  const connect = useMutation({ mutationFn: (sessionId: number) => api.connectWhatsapp(sessionId), onSuccess: refresh });
  const disconnect = useMutation({ mutationFn: (sessionId: number) => api.disconnectWhatsapp(true, sessionId), onSuccess: refresh });
  const create = useMutation({ mutationFn: api.createWhatsappSession, onSuccess: (session) => { setNewLabel(''); setSelectedId(session.id); refresh(); } });
  const rename = useMutation({ mutationFn: ({ id, label }: { id: number; label: string }) => api.updateWhatsappSession(id, label), onSuccess: refresh });
  const assign = useMutation({ mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) => api.assignWhatsappSession(id, userIds), onSuccess: refresh });

  if (sessionsQuery.isLoading) return <LoadingState label="Memeriksa perangkat WhatsApp…" />;
  if (sessionsQuery.error || !selected) return <ErrorState message="Perangkat WhatsApp belum tersedia." onRetry={() => void sessionsQuery.refetch()} />;
  const connected = selected.status.status === 'connected';
  const reconnecting = selected.status.status === 'reconnecting';
  const mutationError = connect.error ?? disconnect.error ?? create.error ?? rename.error ?? assign.error;
  const toggleAssignment = (userId: number) => setAssignedUserIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);

  return (
    <div className="page page--settings">
      <header className="settings-page-header">
        <div><span className="eyebrow">Channel komunikasi</span><h1>Perangkat WhatsApp</h1><p>Kelola beberapa nomor per brand dan tentukan CS yang boleh menangani percakapannya.</p></div>
        <span className={`connection-chip ${sessions.some((item) => item.status.status === 'connected') ? 'connection-chip--connected' : ''}`}><span className="status-dot" />{sessions.filter((item) => item.status.status === 'connected').length} terhubung</span>
      </header>

      <div className="whatsapp-device-layout">
        <aside className="panel whatsapp-device-list">
          <div className="whatsapp-device-list__header"><div><span className="eyebrow">Brand aktif</span><h2>{user.brand?.name ?? '—'}</h2></div><Smartphone size={20} /></div>
          <div className="whatsapp-device-list__items">
            {sessions.map((session) => (
              <button key={session.id} className={`whatsapp-device-item ${session.id === selected.id ? 'whatsapp-device-item--active' : ''}`} onClick={() => setSelectedId(session.id)}>
                <span className={`whatsapp-device-item__icon ${session.status.status === 'connected' ? 'whatsapp-device-item__icon--connected' : ''}`}><Smartphone size={18} /></span>
                <span className="whatsapp-device-item__copy"><strong>{session.label}</strong><small>{session.phone ?? 'Nomor belum terhubung'}</small></span>
                <span className={`status-dot ${session.status.status === 'connected' ? 'status-dot--connected' : ''}`} aria-label={session.status.status} />
              </button>
            ))}
          </div>
          <div className="whatsapp-device-add"><input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Nama perangkat baru" maxLength={120} /><button className="button button--secondary" disabled={create.isPending || newLabel.trim().length < 2} onClick={() => create.mutate(newLabel)}><Plus size={17} />Tambah perangkat</button></div>
        </aside>

        <section className="panel connection-card whatsapp-device-detail">
          <header><span className={`connection-card__icon ${connected ? 'connection-card__icon--connected' : ''}`}>{connected ? <CheckCircle2 /> : <Smartphone />}</span><div><h2>{selected.label}</h2><p>{selected.status.message ?? (connected ? 'WhatsApp terhubung' : 'Hubungkan nomor WhatsApp melalui QR.')}</p></div><span className={`connection-chip ${connected ? 'connection-chip--connected' : ''}`}><span className="status-dot" />{selected.status.status.replace('_', ' ')}</span></header>
          <div className="connection-flow" aria-label="Tahapan koneksi WhatsApp"><div className={connected || selected.status.qrDataUrl ? 'connection-flow__step connection-flow__step--complete' : 'connection-flow__step connection-flow__step--active'}><span><Smartphone size={17} /></span><div><strong>Perangkat</strong><small>{connected || selected.status.qrDataUrl ? 'Dikenali' : 'Siap dihubungkan'}</small></div></div><i aria-hidden="true" /><div className={connected ? 'connection-flow__step connection-flow__step--complete' : selected.status.qrDataUrl || reconnecting ? 'connection-flow__step connection-flow__step--active' : 'connection-flow__step'}><span><Database size={17} /></span><div><strong>Sesi aman</strong><small>{connected ? 'Tersimpan' : selected.status.qrDataUrl ? 'Menunggu QR' : 'Belum aktif'}</small></div></div><i aria-hidden="true" /><div className={connected ? 'connection-flow__step connection-flow__step--complete' : 'connection-flow__step'}><span><Wifi size={17} /></span><div><strong>Inbox CRM</strong><small>{connected ? 'Sinkron aktif' : 'Menunggu koneksi'}</small></div></div></div>
          {selected.status.qrDataUrl ? <div className="qr-panel"><img src={selected.status.qrDataUrl} alt={`QR untuk menghubungkan ${selected.label}`} /><div><h3>Pindai QR dari WhatsApp</h3><ol><li>Buka WhatsApp di ponsel.</li><li>Pilih Perangkat tertaut.</li><li>Pindai QR sebelum kedaluwarsa.</li></ol></div></div> : null}
          {connected ? <dl className="connection-details"><div><dt>Nomor</dt><dd>{selected.status.phone ?? selected.phone ?? '—'}</dd></div><div><dt>Terhubung sejak</dt><dd>{selected.status.lastConnectedAt ? formatDateTime(selected.status.lastConnectedAt) : '—'}</dd></div><div><dt>Status inbox</dt><dd>Pesan masuk aktif</dd></div></dl> : null}
          <div className="whatsapp-device-label"><label htmlFor="whatsapp-device-label">Nama perangkat</label><div><input id="whatsapp-device-label" value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} maxLength={120} /><button className="button button--secondary" disabled={rename.isPending || labelDraft.trim().length < 2 || labelDraft.trim() === selected.label} onClick={() => rename.mutate({ id: selected.id, label: labelDraft })}><Edit3 size={16} />Simpan nama</button></div></div>
          {mutationError ? <div className="inline-error" role="alert">{mutationError instanceof ApiClientError ? mutationError.message : 'Aksi perangkat belum berhasil.'}</div> : null}
          <footer>{connected ? <><button className="button button--secondary" disabled={connect.isPending || disconnect.isPending} onClick={() => connect.mutate(selected.id)}><RefreshCw size={17} />Hubungkan ulang</button><button className="button button--danger-ghost" disabled={disconnect.isPending || connect.isPending} onClick={() => { if (window.confirm(`Keluar dari ${selected.label} dan hapus sesi perangkat ini?`)) disconnect.mutate(selected.id); }}><LogOut size={17} />Keluar & hapus sesi</button></> : <button className="button button--primary" disabled={connect.isPending} onClick={() => connect.mutate(selected.id)}>{reconnecting ? <RefreshCw size={17} /> : <QrCode size={17} />}{reconnecting ? 'Coba lagi sekarang' : 'Tampilkan QR'}</button>}</footer>
        </section>

        <aside className="whatsapp-device-side">
          <section className="panel whatsapp-assignment-card"><div className="whatsapp-card-heading"><span><Users size={18} /></span><div><h3>CS yang ditugaskan</h3><p>Hanya CS terpilih yang dapat melihat dan membalas inbox perangkat ini.</p></div></div><div className="whatsapp-assignment-list">{teamQuery.isLoading ? <small>Memuat akun CS…</small> : (teamQuery.data ?? []).filter((member) => member.isActive).map((member) => <label key={member.userId} className="whatsapp-assignment-row"><input type="checkbox" checked={assignedUserIds.includes(member.userId)} onChange={() => toggleAssignment(member.userId)} /><span><strong>{member.displayName}</strong><small>{member.email}</small></span></label>)}{!teamQuery.isLoading && !(teamQuery.data ?? []).length ? <small>Belum ada akun CS aktif.</small> : null}</div><button className="button button--primary whatsapp-assignment-save" disabled={assign.isPending} onClick={() => assign.mutate({ id: selected.id, userIds: assignedUserIds })}><Save size={16} />Simpan penugasan</button></section>
          <section className="panel security-card"><span><ShieldCheck /></span><h3>Keamanan sesi</h3><p>Setiap nomor memiliki kredensial terenkripsi dan koneksi terpisah. Logout satu nomor tidak memutus perangkat lain.</p></section>
          {selected.status.developmentStorage ? <section className="notice-card notice-card--warning"><AlertTriangle size={20} /><div><strong>Development storage aktif</strong><p>Gunakan auth store database terenkripsi sebelum production.</p></div></section> : null}
          <section className="panel checklist-card"><h3>Yang dapat dilakukan</h3><ul><li><MessageCircleMore size={16} />Terima dan balas pesan personal</li><li><Link2 size={16} />Hubungkan pesan ke lead otomatis</li><li><UserRound size={16} />Batasi akses inbox per CS</li></ul><small>Broadcast massal tidak disediakan.</small></section>
        </aside>
      </div>
    </div>
  );
}
