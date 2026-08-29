import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, CheckCheck, ChevronLeft, Clock3, FileText, Filter, Info, Paperclip, Search, Send, TicketCheck, UserRound } from 'lucide-react';
import type { Lead, Message, UserContext } from '@azhan-crm/contracts';
import { useSearchParams } from 'react-router-dom';
import { api, ApiClientError } from '../api';
import { Avatar, EmptyState, ErrorState, LoadingState, TagPill } from '../components/ui';
import { DealWizard } from '../components/DealWizard';
import { LeadDrawer } from '../components/LeadDrawer';
import { formatDateTime, formatRelativeTime } from '../utils';

export function ConversationsPage({ user }: { user: UserContext }) {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [unreadOnly, setUnreadOnly] = useState(searchParams.get('unread') === '1');
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(true);
  const [composer, setComposer] = useState('');
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [dealLead, setDealLead] = useState<Lead | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: api.conversations });
  const leads = useQuery({ queryKey: ['leads'], queryFn: api.leads });
  const stages = useQuery({ queryKey: ['stages'], queryFn: api.stages });
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules });
  const whatsappStatus = useQuery({ queryKey: ['whatsapp-status'], queryFn: api.whatsappStatus, refetchInterval: 5_000 });
  const messages = useQuery({
    queryKey: ['messages', selectedId],
    queryFn: () => api.messages(selectedId!),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (selectedId || !conversations.data?.length) return;
    const requestedId = searchParams.get('conversation');
    const requested = conversations.data.find((conversation) => conversation.id === requestedId);
    setSelectedId(requested?.id ?? conversations.data[0]!.id);
  }, [conversations.data, searchParams, selectedId]);

  useEffect(() => {
    setSearch(searchParams.get('q') ?? '');
    setUnreadOnly(searchParams.get('unread') === '1');
  }, [searchParams]);

  const filtered = useMemo(() => (conversations.data ?? []).filter((conversation) => {
    const matches = `${conversation.name} ${conversation.phone} ${conversation.lastMessage}`.toLowerCase().includes(search.toLowerCase());
    const lead = leads.data?.find((item) => item.id === conversation.leadId);
    const periodMs = periodFilter === 'today' ? 24 * 60 * 60 * 1_000 : periodFilter === 'week' ? 7 * 24 * 60 * 60 * 1_000 : periodFilter === 'month' ? 30 * 24 * 60 * 60 * 1_000 : null;
    return matches
      && (!unreadOnly || conversation.unread > 0)
      && (!assignedOnly || conversation.assignee === user.name)
      && (assigneeFilter === 'all' || conversation.assignee === assigneeFilter)
      && (stageFilter === 'all' || lead?.stageId === stageFilter)
      && (tagFilter === 'all' || conversation.tags.some((tag) => tag.id === tagFilter))
      && (!periodMs || Date.now() - new Date(conversation.lastMessageAt).getTime() <= periodMs);
  }), [assigneeFilter, assignedOnly, conversations.data, leads.data, periodFilter, search, stageFilter, tagFilter, unreadOnly, user.name]);
  const assignees = [...new Set((conversations.data ?? []).map((conversation) => conversation.assignee))];
  const tags = [...new Map((conversations.data ?? []).flatMap((conversation) => conversation.tags).map((tag) => [tag.id, tag])).values()];
  const selected = conversations.data?.find((conversation) => conversation.id === selectedId) ?? null;
  const selectedLead = leads.data?.find((lead) => lead.id === selected?.leadId) ?? null;
  const whatsappConnected = whatsappStatus.data?.status === 'connected';

  const sendMutation = useMutation({
    mutationFn: () => api.sendMessage(selectedId!, composer.trim()),
    onSuccess: async () => {
      setComposer('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
    },
  });
  const mediaMutation = useMutation({
    mutationFn: (file: File) => api.sendMedia(selectedId!, file, composer.trim()),
    onSuccess: async () => {
      setComposer('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
    },
  });
  const retryMutation = useMutation({
    mutationFn: api.retryMessage,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['messages', selectedId] }),
  });

	const statusIcon = (message: Message) => message.status === 'failed'
	  ? <AlertCircle size={14} />
	  : message.status === 'pending'
		? <Clock3 size={13} />
		: message.status === 'sent'
		  ? <Check size={14} />
		  : <CheckCheck size={14} />;

  if (conversations.isLoading || leads.isLoading) return <LoadingState label="Membuka inbox WhatsApp…" />;
  if (conversations.error || leads.error) return <ErrorState message="Percakapan belum dapat dimuat." onRetry={() => void conversations.refetch()} />;

  return (
    <div className={`conversation-workspace ${selectedId ? 'conversation-workspace--selected' : ''} ${!profileOpen ? 'conversation-workspace--profile-hidden' : ''}`}>
      <section className="conversation-list-panel">
        <header className="conversation-list-header">
          <div><h1>Percakapan</h1><span>{conversations.data?.reduce((sum, item) => sum + item.unread, 0)} belum dibaca</span></div>
        </header>
        <div className="conversation-tools">
          <label className="search-input"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari percakapan…" /></label>
          <button className={`icon-button ${filtersOpen ? 'icon-button--active' : ''}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-label="Filter percakapan"><Filter size={18} /></button>
        </div>
        {filtersOpen ? <div className="conversation-filters">
          <label><span>PIC</span><select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="all">Semua PIC</option>{assignees.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><span>Tahap</span><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">Semua tahap</option>{stages.data?.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
          <label><span>Tag</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">Semua tag</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <label><span>Waktu</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">Semua waktu</option><option value="today">24 jam</option><option value="week">7 hari</option><option value="month">30 hari</option></select></label>
          <label className="conversation-filter-check"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />Belum dibaca</label>
        </div> : null}
        <div className="inbox-tabs"><button className={`inbox-tab ${!assignedOnly ? 'inbox-tab--active' : ''}`} onClick={() => setAssignedOnly(false)}>Semua <span>{filtered.length}</span></button><button className={`inbox-tab ${assignedOnly ? 'inbox-tab--active' : ''}`} onClick={() => setAssignedOnly(true)}>Ditugaskan ke saya</button></div>
        <div className="conversation-list">
          {filtered.map((conversation) => (
            <button key={conversation.id} className={`conversation-row ${selectedId === conversation.id ? 'conversation-row--active' : ''}`} onClick={() => setSelectedId(conversation.id)}>
              <span className="avatar-wrap"><Avatar name={conversation.name} />{conversation.online ? <i className="online-dot" /> : null}</span>
              <span className="conversation-row__content">
                <span className="conversation-row__top"><strong>{conversation.name}</strong><time>{formatRelativeTime(conversation.lastMessageAt)}</time></span>
                <span className="conversation-preview">{conversation.lastMessage}</span>
                <span className="conversation-meta">{conversation.tags.slice(0, 1).map((tag) => <TagPill key={tag.id} tag={tag} />)}<small>{conversation.assignee}</small></span>
              </span>
              {conversation.unread ? <span className="unread-badge">{conversation.unread}</span> : null}
            </button>
          ))}
          {!filtered.length ? <EmptyState title="Tidak ada percakapan" description="Ubah kata pencarian atau filter inbox." /> : null}
        </div>
      </section>

      <section className="message-panel">
        {selected ? (
          <>
            <header className="message-header">
              <button className="icon-button message-header__back" onClick={() => setSelectedId(null)} aria-label="Kembali ke daftar"><ChevronLeft /></button>
              <Avatar name={selected.name} />
              <div><strong>{selected.name}</strong><span><i className="online-dot" /> WhatsApp · {selected.phone}</span></div>
              <div className="message-header__actions"><button className={`icon-button ${profileOpen ? 'icon-button--active' : ''}`} onClick={() => setProfileOpen((value) => !value)} aria-pressed={profileOpen} aria-label="Tampilkan profil lead"><Info size={19} /></button></div>
            </header>
            <div className="message-history" aria-live="polite">
              <div className="message-day">Hari ini</div>
              {messages.isLoading ? <LoadingState label="Memuat pesan…" /> : messages.data?.map((message) => (
                <div key={message.id} className={`message-bubble-wrap message-bubble-wrap--${message.direction}`}>
				  <div className="message-bubble">
					{message.type === 'image' && message.mediaUrl ? <a href={message.mediaUrl} target="_blank" rel="noreferrer"><img className="message-media-image" src={message.mediaUrl} alt={message.fileName ?? 'Lampiran gambar'} /></a> : null}
					{message.type === 'document' && message.mediaUrl ? <a className="message-document" href={message.mediaUrl} target="_blank" rel="noreferrer"><FileText size={18} />{message.fileName ?? 'Buka dokumen'}</a> : null}
					{message.body ? <p>{message.body}</p> : null}
					<span>{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.sentAt))}{message.direction === 'outbound' ? statusIcon(message) : null}</span>
					{message.status === 'failed' ? <button className="message-retry" onClick={() => retryMutation.mutate(message.id)}>Coba lagi</button> : null}
				  </div>
                </div>
              ))}
            </div>
            <form className="composer" onSubmit={(event) => { event.preventDefault(); if (composer.trim()) sendMutation.mutate(); }}>
              {!whatsappConnected ? <div className="composer-warning" role="status">WhatsApp tidak terhubung. Histori tetap dapat dibaca, tetapi pengiriman dinonaktifkan. <a href="/settings/whatsapp">Periksa koneksi</a></div> : null}
              {sendMutation.error || mediaMutation.error ? <div className="composer-error" role="alert">{(sendMutation.error ?? mediaMutation.error) instanceof ApiClientError ? (sendMutation.error ?? mediaMutation.error)?.message : 'Pesan belum terkirim.'}</div> : null}
              <div className="composer__box">
                <button type="button" className="icon-button" disabled={!whatsappConnected || mediaMutation.isPending} aria-label="Lampirkan file" onClick={() => fileInput.current?.click()}><Paperclip size={19} /></button>
                <input ref={fileInput} hidden type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) mediaMutation.mutate(file); event.currentTarget.value = ''; }} />
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (composer.trim()) sendMutation.mutate(); } }}
                  placeholder="Tulis balasan WhatsApp…"
                  rows={1}
                  aria-label="Pesan WhatsApp"
                />
                <button className="send-button" disabled={!whatsappConnected || !composer.trim() || sendMutation.isPending || mediaMutation.isPending} aria-label="Kirim pesan"><Send size={18} /></button>
              </div>
              <small>Enter untuk kirim · Shift+Enter untuk baris baru</small>
            </form>
          </>
        ) : <EmptyState title="Pilih percakapan" description="Pilih salah satu calon jamaah untuk membaca dan membalas pesan." />}
      </section>

      {profileOpen ? <aside className="contact-panel">
        {selectedLead ? (
          <>
            <header className="contact-panel__header"><span>Profil lead</span><button className="icon-button" onClick={() => setProfileOpen(false)} aria-label="Tutup panel profil"><Info size={18} /></button></header>
            <div className="contact-identity"><Avatar name={selectedLead.name} size="lg" /><h2>{selectedLead.name}</h2><p>{selectedLead.phone}</p><div>{selectedLead.tags.map((tag) => <TagPill key={tag.id} tag={tag} />)}</div></div>
            <div className="contact-properties">
              <div><span><UserRound size={16} /> PIC</span><strong>{selectedLead.assignee}</strong></div>
              <div><span><TicketCheck size={16} /> Tahap</span><strong>{stages.data?.find((stage) => stage.id === selectedLead.stageId)?.name}</strong></div>
              <div><span>Paket diminati</span><strong>{selectedLead.scheduleName || 'Belum dipilih'}</strong></div>
              <div><span>Rencana berangkat</span><strong>{selectedLead.departurePlan || 'Belum diisi'}</strong></div>
              <div><span>Follow-up berikutnya</span><strong>{formatDateTime(selectedLead.nextFollowUp)}</strong></div>
            </div>
            <div className="contact-note"><span>Catatan</span><p>{selectedLead.notes || 'Belum ada catatan.'}</p></div>
            <div className="contact-panel__actions"><button className="button button--secondary" onClick={() => setDetailLead(selectedLead)}>Lihat & edit detail</button>{selectedLead.stageId !== 'deal' ? <button className="button button--success" onClick={() => setDealLead(selectedLead)}>Proses Deal</button> : null}</div>
          </>
        ) : null}
      </aside> : null}

      {detailLead && stages.data && schedules.data ? <LeadDrawer lead={detailLead} stages={stages.data} schedules={schedules.data} onClose={() => setDetailLead(null)} onDeal={(lead) => { setDetailLead(null); setDealLead(lead); }} /> : null}
      {dealLead && schedules.data ? <DealWizard lead={dealLead} schedules={schedules.data} onClose={() => setDealLead(null)} onCompleted={() => void queryClient.invalidateQueries({ queryKey: ['leads'] })} /> : null}
    </div>
  );
}
