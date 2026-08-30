import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, MessageCircleMore, Search, StickyNote, Target, UserRoundCheck } from 'lucide-react';
import type { Activity } from '@azhan-crm/contracts';
import { api } from '../api';
import { EmptyState, ErrorState, LoadingState } from '../components/ui';
import { formatRelativeTime } from '../utils';

const activityLabels: Record<Activity['type'] | 'all', string> = {
  all: 'Semua aktivitas',
  message: 'Pesan',
  stage: 'Perubahan tahap',
  note: 'Catatan',
  deal: 'Deal',
  assignment: 'Assignment',
};

function activityIcon(type: Activity['type']) {
  if (type === 'message') return <MessageCircleMore />;
  if (type === 'deal') return <Target />;
  if (type === 'note') return <StickyNote />;
  if (type === 'assignment') return <UserRoundCheck />;
  return <ArrowRightLeft />;
}

export function ActivitiesPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<Activity['type'] | 'all'>('all');
  const activities = useQuery({ queryKey: ['activities'], queryFn: () => api.activities(100) });
  const filtered = useMemo(() => (activities.data ?? []).filter((activity) => {
    const matchesText = `${activity.title} ${activity.description} ${activity.actor}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesText && (type === 'all' || activity.type === type);
  }), [activities.data, search, type]);

  if (activities.isLoading) return <LoadingState label="Memuat aktivitas…" />;
  if (activities.error) return <ErrorState message="Aktivitas belum dapat dimuat." onRetry={() => void activities.refetch()} />;
  const messageCount = activities.data?.filter((activity) => activity.type === 'message').length ?? 0;
  const dealCount = activities.data?.filter((activity) => activity.type === 'deal').length ?? 0;
  const workflowCount = activities.data?.filter((activity) => ['stage', 'assignment'].includes(activity.type)).length ?? 0;

  return (
    <div className="page activities-page">
      <header className="directory-page-header"><div><span className="eyebrow">Riwayat workspace</span><h1>Aktivitas</h1><p>Jejak perubahan penting, follow-up, pesan, dan Deal dalam workspace aktif.</p></div><span className="directory-page-header__count">{filtered.length} aktivitas</span></header>
      <section className="activity-insights" aria-label="Ringkasan aktivitas">
        <div><span className="activity-icon activity-icon--message"><MessageCircleMore /></span><span><small>Percakapan</small><strong>{messageCount}</strong></span></div>
        <div><span className="activity-icon activity-icon--deal"><Target /></span><span><small>Deal tercatat</small><strong>{dealCount}</strong></span></div>
        <div><span className="activity-icon activity-icon--stage"><ArrowRightLeft /></span><span><small>Perubahan workflow</small><strong>{workflowCount}</strong></span></div>
      </section>
      <section className="panel activities-page-panel">
        <div className="table-tools activities-tools">
          <label className="search-input search-input--wide"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari aktivitas atau pelaku…" aria-label="Cari aktivitas" /></label>
          <span className="table-result-count"><strong>{filtered.length}</strong> aktivitas</span>
        </div>
        <div className="activity-type-tabs" aria-label="Filter jenis aktivitas">{Object.entries(activityLabels).map(([value, label]) => <button key={value} className={type === value ? 'activity-type-tab activity-type-tab--active' : 'activity-type-tab'} onClick={() => setType(value as Activity['type'] | 'all')} aria-pressed={type === value}>{label}</button>)}</div>
        <div className="activity-list activity-list--page">
          {filtered.map((activity) => (
            <article key={activity.id} className="activity-item">
              <span className={`activity-icon activity-icon--${activity.type}`}>{activityIcon(activity.type)}</span>
              <div className="activity-item__body"><div className="activity-item__heading"><strong>{activity.title}</strong><time>{formatRelativeTime(activity.occurredAt)}</time></div><p>{activity.description}</p><small>Oleh {activity.actor}</small></div>
            </article>
          ))}
          {!filtered.length ? <EmptyState title="Aktivitas tidak ditemukan" description="Ubah pencarian atau jenis aktivitas." /> : null}
        </div>
      </section>
    </div>
  );
}
