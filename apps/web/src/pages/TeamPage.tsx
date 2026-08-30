import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Eye, EyeOff, KeyRound, Medal, Plus, Save, UserCheck, UserMinus, UsersRound, X } from 'lucide-react';
import type { DashboardPeriod } from '@azhan-crm/contracts';
import { api, ApiClientError } from '../api';
import { Avatar, Dialog, ErrorState, LoadingState } from '../components/ui';
import { formatCompactCurrency } from '../utils';

export function TeamPage() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ userId: number; displayName: string } | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [successNotice, setSuccessNotice] = useState('');
  const [allocations, setAllocations] = useState<Record<number, number>>({});
  const team = useQuery({ queryKey: ['team'], queryFn: api.team });
  const performance = useQuery({ queryKey: ['team-performance', period], queryFn: () => api.teamPerformance(period) });

  useEffect(() => {
    if (!team.data) return;
    setAllocations(Object.fromEntries(team.data.filter((member) => member.isActive).map((member) => [member.userId, member.allocationPercent])));
  }, [team.data]);

  const activeMembers = team.data?.filter((member) => member.isActive) ?? [];
  const totalAllocation = useMemo(() => activeMembers.reduce((sum, member) => sum + (allocations[member.userId] ?? 0), 0), [activeMembers, allocations]);
  const allocationDifference = Math.abs(100 - totalAllocation);
  const refreshTeam = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team'] }),
      queryClient.invalidateQueries({ queryKey: ['team-performance'] }),
    ]);
  };
  const create = useMutation({
    mutationFn: () => api.createTeamMember({ email, displayName, password }),
    onSuccess: async () => {
      setEmail(''); setDisplayName(''); setPassword(''); setPasswordConfirmation(''); setShowPassword(false); setShowCreate(false);
      setSuccessNotice(`Akun ${displayName} berhasil dibuat dan siap digunakan untuk login.`);
      await refreshTeam();
    },
  });
  const update = useMutation({
    mutationFn: (input: { userId: number; email: string; displayName: string; isActive: boolean }) =>
      api.updateTeamMember(input.userId, input),
    onSuccess: refreshTeam,
  });
  const saveDistribution = useMutation({
    mutationFn: () => api.updateTeamDistribution(activeMembers.map((member) => ({ userId: member.userId, percent: allocations[member.userId] ?? 0 }))),
    onSuccess: refreshTeam,
  });
  const resetPasswordMutation = useMutation({
    mutationFn: () => api.resetTeamMemberPassword(resetTarget!.userId, resetPassword),
    onSuccess: () => {
      setSuccessNotice(`Password ${resetTarget?.displayName ?? 'CS'} berhasil diperbarui.`);
      setResetTarget(null);
      setResetPassword('');
      setResetPasswordConfirmation('');
      setShowResetPassword(false);
    },
  });
  const mutationError = create.error ?? update.error ?? saveDistribution.error ?? resetPasswordMutation.error;
  const createPasswordMatches = password === passwordConfirmation;
  const resetPasswordMatches = resetPassword === resetPasswordConfirmation;

  if (team.isLoading || performance.isLoading) return <LoadingState label="Memuat tim dan performa CS…" />;
  if (team.error || performance.error || !team.data || !performance.data) {
    return <ErrorState message="Data tim CS belum dapat dimuat." onRetry={() => { void team.refetch(); void performance.refetch(); }} />;
  }

  return (
    <div className="page team-page">
      <header className="team-page-header">
        <div><span className="eyebrow">Admin CRM</span><h1>Tim CS dan distribusi lead</h1><p>Atur kapasitas tim, pembagian lead baru, dan lihat kontribusi setiap CS.</p></div>
        <button className="button button--primary" onClick={() => setShowCreate((value) => !value)}>{showCreate ? <X size={17} /> : <Plus size={17} />}{showCreate ? 'Tutup form' : 'Tambah akun CS'}</button>
      </header>

      {showCreate ? (
        <form className="panel team-create-form" onSubmit={(event) => { event.preventDefault(); if (createPasswordMatches) create.mutate(); }}>
          <div><h2>Buat akun CS</h2><p>Akun ini hanya dapat mengakses CRM dan lead yang ditugaskan kepadanya.</p></div>
          <label className="field"><span>Nama CS</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} /></label>
          <label className="field"><span>Email login</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field"><span>Password awal</span><div className="password-input"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          <label className="field"><span>Ulangi password</span><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required minLength={8} aria-invalid={passwordConfirmation.length > 0 && !createPasswordMatches} /></label>
          <button className="button button--primary" disabled={create.isPending || !createPasswordMatches}>{create.isPending ? 'Membuat akun…' : 'Buat akun CS'}</button>
        </form>
      ) : null}

      {successNotice ? <div className="inline-success" role="status">{successNotice}</div> : null}
      {mutationError ? <div className="inline-error" role="alert">{mutationError instanceof ApiClientError ? mutationError.message : 'Perubahan belum berhasil disimpan.'}</div> : null}

      <div className="team-workbench">
        <section className="panel team-distribution-card">
          <header className="panel__header"><div><h2>Rotasi jatah lead</h2><p>Satu siklus berisi 100 lead. Total persentase CS aktif harus tepat 100%.</p></div><span className={`allocation-total ${totalAllocation === 100 ? 'allocation-total--valid' : ''}`}>{totalAllocation}% / 100%</span></header>
          {activeMembers.length ? (
            <div className="team-allocation-list">
              <div className="allocation-progress" role="progressbar" aria-label="Total pembagian lead" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(totalAllocation, 100)}><span style={{ width: `${Math.min(totalAllocation, 100)}%` }} /></div>
              <p className={`allocation-guidance ${totalAllocation === 100 ? 'allocation-guidance--valid' : ''}`} role="status">
                {totalAllocation === 100 ? 'Pembagian sudah lengkap dan siap disimpan.' : totalAllocation < 100 ? `Tambahkan ${allocationDifference}% lagi agar rotasi dapat diaktifkan.` : `Kurangi ${allocationDifference}% agar total kembali tepat 100%.`}
              </p>
              {activeMembers.map((member) => (
                <div className="team-allocation-row" key={member.userId}>
                  <Avatar name={member.displayName} size="sm" />
                  <div><strong>{member.displayName}</strong><span>{member.allocatedInCycle} dari {member.allocationPercent} slot siklus terpakai</span></div>
                  <label><span className="sr-only">Persentase {member.displayName}</span><input type="number" min="1" max="100" value={allocations[member.userId] ?? 0} onChange={(event) => setAllocations((current) => ({ ...current, [member.userId]: Number(event.target.value) }))} /><strong>%</strong></label>
                </div>
              ))}
              <div className="team-distribution-actions"><p>Perubahan pembagian akan memulai siklus baru tanpa memindahkan lead lama.</p><button className="button button--primary" disabled={totalAllocation !== 100 || saveDistribution.isPending} onClick={() => saveDistribution.mutate()}><Save size={17} />{saveDistribution.isPending ? 'Menyimpan…' : 'Simpan pembagian'}</button></div>
            </div>
          ) : <div className="team-empty"><UsersRound size={24} /><strong>Belum ada CS aktif</strong><span>Tambahkan akun CS sebelum mengatur pembagian lead.</span></div>}
        </section>
        <aside className="team-workbench__summary" aria-label="Ringkasan tim CS">
          <div><span>CS aktif</span><strong>{activeMembers.length}</strong><small>Akun siap menerima lead</small></div>
          <div><span>Status rotasi</span><strong>{totalAllocation === 100 ? 'Siap' : 'Perlu diatur'}</strong><small>{totalAllocation === 100 ? 'Distribusi lead dapat berjalan otomatis.' : `Total saat ini ${totalAllocation}%.`}</small></div>
          <p><BarChart3 size={17} />Lead baru dibagikan otomatis. Lead lama tidak dipindahkan agar histori performa tetap akurat.</p>
        </aside>
      </div>

      <section className="panel team-performance-card">
        <header className="panel__header"><div><h2>Leaderboard performa CS</h2><p>Urutan berdasarkan Deal, kemudian jumlah lead yang ditangani.</p></div><label className="period-control"><span>Periode</span><select value={period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}><option value="today">Hari ini</option><option value="week">7 hari</option><option value="month">30 hari</option><option value="all">Semua</option></select></label></header>
        <div className="data-table-wrap"><table className="data-table team-table"><thead><tr><th>Peringkat</th><th>CS</th><th>Jatah</th><th>Lead</th><th>Aktif</th><th>Deal</th><th>Konversi</th><th>Nilai pipeline</th><th>Aksi</th></tr></thead><tbody>{performance.data.map((member, index) => <tr key={member.userId}><td><span className={`rank-badge ${index < 3 ? 'rank-badge--top' : ''}`}>{index < 3 ? <Medal size={15} /> : null}{index + 1}</span></td><td><div className="table-contact"><Avatar name={member.displayName} size="sm" /><span><strong>{member.displayName}</strong><small>{member.email}</small></span></div></td><td>{member.allocationPercent}%</td><td>{member.assignedLeads}</td><td>{member.openLeads}</td><td><strong>{member.deals}</strong></td><td>{member.conversionRate}%</td><td>{formatCompactCurrency(member.pipelineValue)}</td><td><div className="team-row-actions"><button className="button button--small button--secondary" onClick={() => { setResetTarget({ userId: member.userId, displayName: member.displayName }); setResetPassword(''); setResetPasswordConfirmation(''); setSuccessNotice(''); }}><KeyRound size={15} />Reset password</button><button className={`button button--small ${member.isActive ? 'button--secondary' : 'button--success'}`} disabled={update.isPending} onClick={() => update.mutate({ userId: member.userId, email: member.email, displayName: member.displayName, isActive: !member.isActive })}>{member.isActive ? <UserMinus size={15} /> : <UserCheck size={15} />}{member.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></td></tr>)}</tbody></table></div>
      </section>

      {resetTarget ? (
        <Dialog title={`Reset password ${resetTarget.displayName}`} description="Password lama langsung tidak berlaku setelah perubahan disimpan." size="sm" onClose={() => setResetTarget(null)}>
          <form onSubmit={(event) => { event.preventDefault(); if (resetPasswordMatches) resetPasswordMutation.mutate(); }}>
            <div className="dialog-form-body">
              <label className="field"><span>Password baru</span><div className="password-input"><input type={showResetPassword ? 'text' : 'password'} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} minLength={8} required autoFocus /><button type="button" onClick={() => setShowResetPassword((value) => !value)} aria-label={showResetPassword ? 'Sembunyikan password' : 'Tampilkan password'}>{showResetPassword ? <EyeOff /> : <Eye />}</button></div></label>
              <label className="field"><span>Ulangi password baru</span><input type={showResetPassword ? 'text' : 'password'} autoComplete="new-password" value={resetPasswordConfirmation} onChange={(event) => setResetPasswordConfirmation(event.target.value)} minLength={8} required aria-invalid={resetPasswordConfirmation.length > 0 && !resetPasswordMatches} /></label>
              {resetPasswordConfirmation.length > 0 && !resetPasswordMatches ? <p className="field-error">Konfirmasi password belum sama.</p> : <p className="field-hint">Gunakan minimal 8 karakter dan simpan password di tempat aman.</p>}
              {resetPasswordMutation.error ? <div className="inline-error" role="alert">{resetPasswordMutation.error instanceof ApiClientError ? resetPasswordMutation.error.message : 'Password belum berhasil diubah.'}</div> : null}
            </div>
            <footer className="dialog__footer"><button type="button" className="button button--secondary" onClick={() => setResetTarget(null)}>Batal</button><button className="button button--primary" disabled={resetPassword.length < 8 || !resetPasswordMatches || resetPasswordMutation.isPending}><KeyRound size={16} />{resetPasswordMutation.isPending ? 'Menyimpan…' : 'Simpan password baru'}</button></footer>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
