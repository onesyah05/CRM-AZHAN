import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BarChart3, CheckCircle2, Eye, EyeOff, KanbanSquare, LockKeyhole, MessageCircleMore, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '../api';

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (user) => {
      queryClient.setQueryData(['context'], user);
      void navigate('/');
    },
  });
  const error = login.error;
  return (
    <div className="login-page">
      <aside className="login-story" aria-label="Ringkasan Azhan CRM">
        <div className="login-story__ambient" aria-hidden="true"><i /><i /><i /></div>
        <div className="login-story__brand"><span><Sparkles size={20} /></span><strong>Azhan ERP</strong></div>
        <div className="login-story__content">
          <span className="login-story__eyebrow">CRM UNTUK TRAVEL UMRAH</span>
          <h2>Satu workspace untuk percakapan, lead, dan closing.</h2>
          <p>Pantau setiap calon jamaah dari pesan pertama sampai booking terbentuk di ERP.</p>
          <div className="login-story__features">
            <div><span><MessageCircleMore /></span><div><strong>Inbox terpusat</strong><small>Percakapan WhatsApp dan profil lead dalam satu layar.</small></div></div>
            <div><span><KanbanSquare /></span><div><strong>Pipeline yang jelas</strong><small>Prioritaskan follow-up dan proses Deal tanpa kehilangan konteks.</small></div></div>
            <div><span><BarChart3 /></span><div><strong>Performa terukur</strong><small>Distribusi lead dan leaderboard CS per brand.</small></div></div>
          </div>
        </div>
        <div className="login-story__footer"><CheckCircle2 size={16} />Terhubung langsung dengan ekosistem Azhan ERP</div>
      </aside>
      <main className="login-form-wrap">
        <form className="login-form" onSubmit={(event) => { event.preventDefault(); login.mutate(); }}>
          <div className="login-product"><span className="login-form__mark"><LockKeyhole /></span><div><strong>Azhan ERP</strong><span>Customer Relationship Management</span></div></div>
          <span className="eyebrow">SELAMAT DATANG</span><h1>Masuk ke CRM</h1><p>Gunakan akun yang sama dengan Dashboard Travel ERP.</p>
          <label className="field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@travel.com" required /></label>
          <label className="field"><span>Password</span><div className="password-input"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan password" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          {error ? <div className="inline-error" role="alert">{error instanceof ApiClientError ? error.message : 'Login belum berhasil.'}</div> : null}
          <button className="button button--primary button--large login-submit" disabled={login.isPending} aria-busy={login.isPending}>{login.isPending ? 'Memeriksa akun…' : <>Masuk <ArrowRight size={18} /></>}</button>
          <small className="login-security"><ShieldCheck size={14} />Sesi browser menggunakan cookie HttpOnly.</small>
        </form>
        <p className="login-footer">Bagian dari ekosistem Azhan ERP</p>
      </main>
    </div>
  );
}
