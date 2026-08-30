import { useMemo, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, CircleDollarSign, Clock3, Filter, GripVertical, LayoutGrid, MessageCircleMore, Search, TicketCheck, UserRound, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Lead } from '@azhan-crm/contracts';
import { api, ApiClientError } from '../api';
import { DealWizard } from '../components/DealWizard';
import { LeadDrawer } from '../components/LeadDrawer';
import { Avatar, Dialog, EmptyState, ErrorState, LoadingState, TagPill } from '../components/ui';
import { commitmentLabel, formatCompactCurrency, formatRelativeTime } from '../utils';

function LostDialog({ lead, onClose, onSubmit, pending, error }: { lead: Lead; onClose: () => void; onSubmit: (reason: string) => void; pending: boolean; error: string }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title="Tandai sebagai Lost" description={`Catat alasan ${lead.name} tidak melanjutkan.`} onClose={onClose} size="sm">
      <div className="dialog-form"><label className="field"><span>Alasan kehilangan</span><textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Contoh: jadwal belum cocok" autoFocus /></label>{error ? <div className="inline-error" role="alert">{error}</div> : null}</div>
      <footer className="dialog__footer"><button className="button button--secondary" onClick={onClose}>Batal</button><button className="button button--danger" disabled={reason.trim().length < 3 || pending} onClick={() => onSubmit(reason.trim())}>{pending ? 'Menyimpan…' : 'Tandai Lost'}</button></footer>
    </Dialog>
  );
}

export function PipelinePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('Semua PIC');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [scheduleFilter, setScheduleFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [dealLead, setDealLead] = useState<Lead | null>(null);
  const [lostLead, setLostLead] = useState<Lead | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const leads = useQuery({ queryKey: ['leads'], queryFn: api.leads });
  const stages = useQuery({ queryKey: ['stages'], queryFn: api.stages });
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules });
  const scheduleOptions = schedules.data ?? [];

  const moveMutation = useMutation({
    mutationFn: ({ leadId, stageId, lostReason }: { leadId: string; stageId: string; lostReason?: string }) => api.moveLead(leadId, stageId, lostReason),
    onMutate: async ({ leadId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ['leads'] });
      const previous = queryClient.getQueryData<Lead[]>(['leads']);
      queryClient.setQueryData<Lead[]>(['leads'], (current) => current?.map((lead) => lead.id === leadId ? { ...lead, stageId, stageAgeDays: 0 } : lead));
      return { previous };
    },
    onError: (_error, _variables, context) => queryClient.setQueryData(['leads'], context?.previous),
    onSuccess: (updated) => {
      queryClient.setQueryData<Lead[]>(['leads'], (current) => current?.map((lead) => lead.id === updated.id ? updated : lead));
      setLostLead(null);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  });

  const filteredLeads = useMemo(() => (leads.data ?? []).filter((lead) => {
    const matchSearch = `${lead.name} ${lead.phone} ${lead.scheduleName}`.toLowerCase().includes(search.toLowerCase());
    return matchSearch
      && (assignee === 'Semua PIC' || lead.assignee === assignee)
      && (stageFilter === 'all' || lead.stageId === stageFilter)
      && (tagFilter === 'all' || lead.tags.some((tag) => tag.id === tagFilter))
      && (scheduleFilter === 'all' || String(lead.scheduleId) === scheduleFilter)
      && (!unreadOnly || lead.unread > 0);
  }), [assignee, leads.data, scheduleFilter, search, stageFilter, tagFilter, unreadOnly]);
  const assignees = [...new Set((leads.data ?? []).map((lead) => lead.assignee))];
  const tags = [...new Map((leads.data ?? []).flatMap((lead) => lead.tags).map((tag) => [tag.id, tag])).values()];
  const activeValue = filteredLeads.filter((lead) => !['deal', 'lost'].includes(lead.stageId)).reduce((sum, lead) => sum + lead.estimatedValue, 0);
  const unreadLeadCount = filteredLeads.filter((lead) => lead.unread > 0).length;
  const agingLeadCount = filteredLeads.filter((lead) => !['deal', 'lost'].includes(lead.stageId) && lead.stageAgeDays >= 3).length;
  const activeFilterCount = [
    assignee !== 'Semua PIC',
    stageFilter !== 'all',
    tagFilter !== 'all',
    scheduleFilter !== 'all',
    unreadOnly,
  ].filter(Boolean).length;
  const hasFilteredCriteria = Boolean(search.trim()) || activeFilterCount > 0;
  const resetFilters = () => {
    setSearch('');
    setAssignee('Semua PIC');
    setStageFilter('all');
    setTagFilter('all');
    setScheduleFilter('all');
    setUnreadOnly(false);
  };

  const requestStageChange = (lead: Lead, stageId: string) => {
    if (stageId === lead.stageId) return;
    if (stageId === 'deal') { setDealLead(lead); return; }
    if (stageId === 'lost') { setLostLead(lead); return; }
    moveMutation.mutate({ leadId: lead.id, stageId });
  };

  const handleDrop = (event: DragEvent, stageId: string) => {
    event.preventDefault();
    setDragOverStage(null);
    const lead = leads.data?.find((item) => item.id === event.dataTransfer.getData('text/lead-id'));
    if (lead) requestStageChange(lead, stageId);
  };

  if (leads.isLoading || stages.isLoading) return <LoadingState label="Menyiapkan pipeline…" />;
  if (leads.error || stages.error || !stages.data) return <ErrorState message="Pipeline belum tersedia." onRetry={() => void Promise.all([leads.refetch(), stages.refetch(), schedules.refetch()])} />;

  return (
    <div className="page page--pipeline">
      <header className="pipeline-page-header">
        <div>
          <span className="eyebrow">Pipeline penjualan</span>
          <h1>Gerakkan lead sampai booking.</h1>
          <p>Pantau posisi, nilai, dan PIC setiap calon jamaah dalam satu papan kerja.</p>
        </div>
        <div className="pipeline-page-header__actions">
          <button className="button button--primary" onClick={() => navigate('/conversations')}><MessageCircleMore size={17} />Buka inbox</button>
        </div>
      </header>

      <section className="pipeline-insights" aria-label="Ringkasan pipeline">
        <div className="pipeline-insight">
          <span className="pipeline-insight__icon"><UsersRound size={18} /></span>
          <span><small>Lead terlihat</small><strong>{filteredLeads.length}</strong></span>
        </div>
        <div className="pipeline-insight">
          <span className="pipeline-insight__icon"><CircleDollarSign size={18} /></span>
          <span><small>Nilai aktif</small><strong>{formatCompactCurrency(activeValue)}</strong></span>
        </div>
        <div className="pipeline-insight">
          <span className="pipeline-insight__icon"><MessageCircleMore size={18} /></span>
          <span><small>Belum dibaca</small><strong>{unreadLeadCount} lead</strong></span>
        </div>
        <div className={`pipeline-insight ${agingLeadCount ? 'pipeline-insight--warning' : ''}`}>
          <span className="pipeline-insight__icon"><Clock3 size={18} /></span>
          <span><small>Perlu perhatian</small><strong>{agingLeadCount} lead</strong></span>
        </div>
      </section>

      {schedules.error ? <div className="inline-error pipeline-data-warning" role="alert"><span>Data paket belum tersedia. Pipeline tetap dapat digunakan.</span><button className="button button--secondary button--small" onClick={() => void schedules.refetch()}>Muat ulang paket</button></div> : null}
      <section className="pipeline-controls" aria-label="Kontrol pipeline">
        <div className="pipeline-toolbar">
          <label className="search-input search-input--wide"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, nomor, atau paket…" aria-label="Cari lead di pipeline" /></label>
          <label className="select-button pipeline-pic-select"><UserRound size={17} /><select value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label="Filter berdasarkan PIC"><option>Semua PIC</option>{assignees.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></label>
          <button className={`button button--secondary pipeline-filter-button ${filtersOpen ? 'button--active' : ''}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="pipeline-advanced-filters"><Filter size={17} />Filter{activeFilterCount ? <span>{activeFilterCount}</span> : null}</button>
          {hasFilteredCriteria ? <button className="pipeline-reset-button" onClick={resetFilters}>Reset semua</button> : null}
        </div>

        {filtersOpen ? <div className="pipeline-filter-row" id="pipeline-advanced-filters">
          <label className="field"><span>Tahap</span><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">Semua tahap</option>{stages.data.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
          <label className="field"><span>Tag</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">Semua tag</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <label className="field"><span>Paket</span><select value={scheduleFilter} disabled={schedules.isLoading || Boolean(schedules.error)} onChange={(event) => setScheduleFilter(event.target.value)}><option value="all">{schedules.isLoading ? 'Memuat paket…' : 'Semua paket'}</option>{scheduleOptions.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select></label>
          <label className="pipeline-filter-check"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /><span><strong>Belum dibaca</strong><small>Tampilkan lead dengan pesan baru</small></span></label>
        </div> : null}
      </section>

      <section className="pipeline-board" aria-labelledby="pipeline-board-title">
        <header className="pipeline-board__header">
          <div><span className="pipeline-board__icon"><LayoutGrid size={17} /></span><span><h2 id="pipeline-board-title">Alur penjualan</h2><small>{stages.data.length} tahap aktif</small></span></div>
          <p>Geser kartu atau ubah tahap dari kartu lead.</p>
        </header>
        <div className="kanban" aria-label="Pipeline lead">
          {stages.data.filter((stage) => stageFilter === 'all' || stage.id === stageFilter).map((stage) => {
          const stageLeads = filteredLeads.filter((lead) => lead.stageId === stage.id);
          const stageValue = stageLeads.reduce((sum, lead) => sum + lead.estimatedValue, 0);
          return (
            <section
              className={`kanban-column ${dragOverStage === stage.id ? 'kanban-column--drag-over' : ''}`}
              key={stage.id}
              style={{ '--stage-color': stage.color } as React.CSSProperties}
              onDragOver={(event) => { event.preventDefault(); setDragOverStage(stage.id); }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={(event) => handleDrop(event, stage.id)}
              aria-label={`Tahap ${stage.name}, ${stageLeads.length} lead`}
            >
              <header className="kanban-column__header">
                <div className="kanban-column__title"><span className="stage-dot" /><strong>{stage.name}</strong><em aria-label={`${stageLeads.length} lead`}>{stageLeads.length}</em></div>
                <small>{formatCompactCurrency(stageValue)} nilai pipeline</small>
              </header>
              <div className="kanban-column__body">
                {stageLeads.map((lead) => (
                  <article
                    className="lead-card"
                    key={lead.id}
                    draggable
                    onDragStart={(event) => { event.dataTransfer.setData('text/lead-id', lead.id); event.dataTransfer.effectAllowed = 'move'; }}
                  >
                    <header><button className="lead-card__identity" onClick={() => setDetailLead(lead)}><Avatar name={lead.name} size="sm" /><span><strong>{lead.name}</strong><small>{lead.phone}</small></span></button><GripVertical className="drag-handle" size={18} aria-hidden="true" /></header>
                    <button className="lead-card__main" onClick={() => setDetailLead(lead)}>
                      <span className="lead-card__package">{lead.scheduleName || 'Paket belum dipilih'}</span>
                      <span className="lead-card__facts"><span><CalendarClock size={14} />{lead.departurePlan || 'Rencana belum diisi'}</span><span>{lead.pax} pax</span></span>
                      <span className="lead-card__value"><CircleDollarSign size={15} />{formatCompactCurrency(lead.estimatedValue)}</span>
                    </button>
                    {lead.tags.length || lead.dealSubstatus ? <div className="lead-card__tags">{lead.tags.slice(0, 2).map((tag) => <TagPill key={tag.id} tag={tag} />)}{lead.tags.length > 2 ? <span className="lead-card__more-tags">+{lead.tags.length - 2}</span> : null}{lead.dealSubstatus ? <span className="commitment-badge"><TicketCheck size={13} />{commitmentLabel(lead.dealSubstatus)}</span> : null}</div> : null}
                    <footer><span className="lead-card__assignee"><UserRound size={13} />{lead.assignee}</span><span className={lead.stageAgeDays >= 3 ? 'age-warning' : ''}>{lead.stageAgeDays ? `${lead.stageAgeDays} hari di tahap ini` : formatRelativeTime(lead.updatedAt)}</span>{lead.unread ? <span className="unread-badge" aria-label={`${lead.unread} pesan belum dibaca`}>{lead.unread}</span> : null}</footer>
                    <label className="move-stage-select"><span>Tahap saat ini</span><span className="move-stage-select__control"><i aria-hidden="true" /><select value={lead.stageId} aria-label={`Tahap ${lead.name}`} onChange={(event) => { if (event.target.value !== lead.stageId) requestStageChange(lead, event.target.value); }}>{stages.data.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
                  </article>
                ))}
                {!stageLeads.length ? <EmptyState title="Belum ada lead" description="Geser kartu ke tahap ini atau ubah tahap dari kartu." /> : null}
              </div>
            </section>
          );
          })}
        </div>
      </section>
      <div className="sr-only" aria-live="polite">{moveMutation.isSuccess ? 'Tahap lead berhasil diperbarui.' : ''}</div>
      {moveMutation.error && !lostLead ? <div className="toast toast--error" role="alert">{moveMutation.error instanceof ApiClientError ? moveMutation.error.message : 'Tahap belum berubah.'}</div> : null}

      {detailLead ? <LeadDrawer lead={leads.data?.find((item) => item.id === detailLead.id) ?? detailLead} stages={stages.data} schedules={scheduleOptions} onClose={() => setDetailLead(null)} onDeal={(lead) => { setDetailLead(null); setDealLead(lead); }} /> : null}
      {dealLead ? <DealWizard lead={dealLead} schedules={scheduleOptions} onClose={() => setDealLead(null)} onCompleted={() => void queryClient.invalidateQueries({ queryKey: ['leads'] })} /> : null}
      {lostLead ? <LostDialog lead={lostLead} onClose={() => setLostLead(null)} pending={moveMutation.isPending} error={moveMutation.error instanceof ApiClientError ? moveMutation.error.message : ''} onSubmit={(reason) => moveMutation.mutate({ leadId: lostLead.id, stageId: 'lost', lostReason: reason })} /> : null}
    </div>
  );
}
