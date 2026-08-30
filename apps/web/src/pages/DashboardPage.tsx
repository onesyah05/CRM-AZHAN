import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Clock3, Eye, MessageCircleMore, Target, TrendingUp, UsersRound } from 'lucide-react';
import { api } from '../api';
import { ErrorState, LoadingState } from '../components/ui';
import { formatCompactCurrency, formatRelativeTime } from '../utils';
import type { DashboardPeriod, UserContext } from '@azhan-crm/contracts';
import { useState } from 'react';

export function DashboardPage({ user }: { user: UserContext }) {
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const dashboard = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.dashboard(period) });
  const stages = useQuery({ queryKey: ['stages'], queryFn: api.stages });
  if (dashboard.isLoading || stages.isLoading) return <LoadingState label="Menyiapkan ringkasan CRM…" />;
  if (dashboard.error || !dashboard.data || !stages.data) return <ErrorState message="Ringkasan belum tersedia." onRetry={() => void dashboard.refetch()} />;

  const maxStage = Math.max(...dashboard.data.stageDistribution.map((item) => item.count), 1);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
  const dateLabel = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(now).toUpperCase();
  return (
    <div className="page page--dashboard">
      <header className="dashboard-hero">
        <div className="dashboard-hero__title">
          <span className="eyebrow">{dateLabel}</span>
          <h1>{`${greeting}, tim ${user.brand?.name ?? 'CRM'}`}</h1>
          <p>Prioritaskan respons cepat, lalu dorong calon jamaah yang sudah siap mengambil keputusan.</p>
        </div>
        <div className="dashboard-hero__actions">
          <label className="select-button"><span className="sr-only">Periode dashboard</span><select value={period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}><option value="today">24 jam</option><option value="week">7 hari</option><option value="month">30 hari</option><option value="all">Semua waktu</option></select></label>
          <a className="button button--secondary" href="/conversations?unread=1"><Eye size={17} />Buka inbox</a>
        </div>
      </header>

      <section className="dashboard-command" aria-label="Prioritas dan ringkasan CRM">
        <div className="dashboard-command__priority">
          <span className="dashboard-command__icon"><MessageCircleMore size={20} /></span>
          <div><strong>{dashboard.data.unread ? `${dashboard.data.unread} pesan perlu respons` : 'Inbox sudah terkendali'}</strong><span>{dashboard.data.unread ? 'Balas pesan yang belum dibaca untuk menjaga lead tetap hangat.' : 'Tidak ada pesan baru yang menunggu respons.'}</span></div>
          <a href="/conversations?unread=1" className="dashboard-command__link">Tinjau inbox <ArrowUpRight size={15} /></a>
        </div>
        <dl className="dashboard-kpis">
          <div><dt><UsersRound size={15} /> Lead baru</dt><dd>{dashboard.data.newLeads}</dd></div>
          <div><dt><Target size={15} /> Deal</dt><dd>{dashboard.data.deals}<small>{dashboard.data.conversionRate}% konversi</small></dd></div>
          <div><dt><TrendingUp size={15} /> Pipeline</dt><dd>{formatCompactCurrency(dashboard.data.pipelineValue)}</dd></div>
          <div><dt><Target size={15} /> Lost</dt><dd>{dashboard.data.lost}</dd></div>
        </dl>
      </section>

      <div className="dashboard-layout">
        <section className="panel pipeline-overview">
          <header className="panel__header"><div><h2>Distribusi pipeline</h2><p>Jumlah lead aktif pada setiap tahap</p></div><a href="/pipeline">Lihat pipeline <ArrowUpRight size={15} /></a></header>
          <div className="stage-chart">
            {dashboard.data.stageDistribution.filter((item) => item.stageId !== 'lost').map((item) => {
              const stage = stages.data.find((candidate) => candidate.id === item.stageId);
              return (
                <div className="stage-chart__row" key={item.stageId}>
                  <div><span className="stage-dot" style={{ backgroundColor: stage?.color }} /><span>{stage?.name}</span></div>
                  <div className="stage-chart__bar"><span style={{ width: `${Math.max((item.count / maxStage) * 100, item.count ? 10 : 0)}%`, backgroundColor: stage?.color }} /></div>
                  <strong>{item.count}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel activity-panel">
          <header className="panel__header"><div><h2>Aktivitas terbaru</h2><p>Perubahan penting pada workspace</p></div></header>
          <div className="activity-list">
            {dashboard.data.activities.map((activity) => (
              <article key={activity.id} className="activity-item">
                <span className={`activity-icon activity-icon--${activity.type}`}>{activity.type === 'message' ? <MessageCircleMore /> : activity.type === 'deal' ? <Target /> : <TrendingUp />}</span>
                <div><strong>{activity.title}</strong><p>{activity.description}</p><small>{activity.actor} · {formatRelativeTime(activity.occurredAt)}</small></div>
              </article>
            ))}
          </div>
        </section>
        <aside className="dashboard-sidebar">
          <section className="panel response-card">
            <span className="response-card__icon"><Clock3 /></span>
            <span>Median respons pertama</span>
            <strong>{dashboard.data.medianFirstResponseMinutes} menit</strong>
            <p>Target tim di bawah 10 menit. Performa hari ini masih dalam SLA.</p>
            <div className="progress"><span style={{ width: '72%' }} /></div>
          </section>
          <section className="panel focus-card">
            <span className="eyebrow">Aksi berikutnya</span>
            <h2>Jaga momentum lead hangat</h2>
            <p>Lead pada tahap Qualified dan Negosiasi paling berpeluang dikonversi hari ini.</p>
            <a className="button button--primary" href="/pipeline">Buka pipeline <ArrowUpRight size={17} /></a>
          </section>
        </aside>
      </div>
    </div>
  );
}
