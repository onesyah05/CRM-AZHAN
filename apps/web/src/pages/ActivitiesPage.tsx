import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircleMore, Search, Target, TrendingUp } from 'lucide-react';
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

  return (
    <div className="page activities-page">
      <header className="directory-page-header"><div><span className="eyebrow">Riwayat workspace</span><h1>Aktivitas</h1><p>Jejak perubahan penting, follow-up, pesan, dan Deal dalam workspace aktif.</p></div><span className="directory-page-header__count">{filtered.length} aktivitas</span></header>
      <section className="panel activities-page-panel">
        <div className="table-tools activities-tools">
          <label className="search-input search-input--wide"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari aktivitas atau pelaku…" /></label>
          <label className="select-button"><span className="sr-only">Jenis aktivitas</span><select value={type} onChange={(event) => setType(event.target.value as Activity['type'] | 'all')}>{Object.entries(activityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <span>{filtered.length} aktivitas</span>
        </div>
        <div className="activity-list activity-list--page">
          {filtered.map((activity) => (
            <article key={activity.id} className="activity-item">
              <span className={`activity-icon activity-icon--${activity.type}`}>{activity.type === 'message' ? <MessageCircleMore /> : activity.type === 'deal' ? <Target /> : <TrendingUp />}</span>
              <div><strong>{activity.title}</strong><p>{activity.description}</p><small>{activity.actor} · {formatRelativeTime(activity.occurredAt)}</small></div>
            </article>
          ))}
          {!filtered.length ? <EmptyState title="Aktivitas tidak ditemukan" description="Ubah pencarian atau jenis aktivitas." /> : null}
        </div>
      </section>
    </div>
  );
}
