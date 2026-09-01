import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, Check, CheckCheck, ChevronLeft, Clock3, FileText, FileWarning, Filter, Info, PackageOpen, Paperclip, Search, Send, TicketCheck, UserRound } from 'lucide-react';
import type { Lead, Message, UserContext } from '@azhan-crm/contracts';
import { useSearchParams } from 'react-router-dom';
import { api, ApiClientError } from '../api';
import { Avatar, EmptyState, ErrorState, LoadingState, TagPill } from '../components/ui';
import { DealWizard } from '../components/DealWizard';
import { LeadDrawer } from '../components/LeadDrawer';
import { formatDateTime, formatRelativeTime } from '../utils';

const crmTimeZone = 'Asia/Jakarta';

export function messageDayKey(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: crmTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function messageDayLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  const today = now;
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1_000);
  const key = messageDayKey(date);
  if (key === messageDayKey(today)) return 'Hari ini';
  if (key === messageDayKey(yesterday)) return 'Kemarin';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: crmTimeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function messageTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: crmTimeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function MessageAttachment({ message, onLoad }: { message: Message; onLoad: () => void }) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => setUnavailable(false), [message.id, message.mediaUrl]);
  if (message.type === 'text') return null;
  if (!message.mediaUrl || unavailable) {
    const typeName = message.type === 'image' ? 'Gambar' : message.type === 'video' ? 'Video' : message.type === 'audio' ? 'Audio' : 'File';
    return <div className="message-media-missing"><FileWarning size={22} /><span><strong>{typeName} tidak tersedia</strong><small>File media sudah tidak ada atau kedaluwarsa.</small></span></div>;
  }
  if (message.type === 'image') return <a href={message.mediaUrl} target="_blank" rel="noreferrer"><img className="message-media-image" src={message.mediaUrl} alt={message.fileName ?? 'Lampiran gambar'} onLoad={onLoad} onError={() => setUnavailable(true)} /></a>;
  if (message.type === 'video') return <video className="message-media-video" src={message.mediaUrl} controls preload="metadata" aria-label={message.fileName ?? 'Lampiran video'} onLoadedMetadata={onLoad} onError={() => setUnavailable(true)} />;
  if (message.type === 'audio') return <audio className="message-media-audio" src={message.mediaUrl} controls preload="metadata" aria-label={message.fileName ?? 'Lampiran audio'} onLoadedMetadata={onLoad} onError={() => setUnavailable(true)} />;
  return <a className="message-document" href={message.mediaUrl} target="_blank" rel="noreferrer"><FileText size={18} />{message.fileName ?? 'Buka dokumen'}</a>;
}

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
	const messageHistory = useRef<HTMLDivElement>(null);
	const messageEnd = useRef<HTMLDivElement>(null);
	const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const typingConversation = useRef<string | null>(null);
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
  const conversationReady = selected?.phoneResolved !== false;
  const canSend = whatsappConnected && conversationReady;
  const activeFilterCount = [unreadOnly, assignedOnly, assigneeFilter !== 'all', stageFilter !== 'all', tagFilter !== 'all', periodFilter !== 'all'].filter(Boolean).length;
  const messageGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; messages: Message[] }> = [];
    for (const message of messages.data ?? []) {
      const key = messageDayKey(message.sentAt);
      const current = groups.at(-1);
      if (current?.key === key) current.messages.push(message);
      else groups.push({ key, label: messageDayLabel(message.sentAt), messages: [message] });
    }
    return groups;
  }, [messages.data]);
  const scrollToLatest = useCallback(() => {
    const history = messageHistory.current;
    if (history) history.scrollTop = history.scrollHeight;
    else messageEnd.current?.scrollIntoView({ block: 'end' });
  }, []);

  useEffect(() => {
    if (messages.isLoading || !selectedId) return;
    const frame = requestAnimationFrame(scrollToLatest);
    const timer = window.setTimeout(scrollToLatest, 120);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [messages.data?.length, messages.isLoading, scrollToLatest, selectedId]);
  const resetConversationFilters = () => {
    setUnreadOnly(false);
    setAssignedOnly(false);
    setAssigneeFilter('all');
    setStageFilter('all');
    setTagFilter('all');
    setPeriodFilter('all');
  };

  const pauseTyping = (conversationId = selectedId) => {
	if (typingTimer.current) clearTimeout(typingTimer.current);
	typingTimer.current = null;
	if (conversationId && typingConversation.current === conversationId) {
	  typingConversation.current = null;
	  void api.updatePresence(conversationId, 'paused').catch(() => undefined);
	}
  };

  const updateComposer = (value: string) => {
	setComposer(value);
	if (!selectedId || !canSend) return;
	if (typingTimer.current) clearTimeout(typingTimer.current);
	if (!value.trim()) {
	  pauseTyping(selectedId);
	  return;
	}
	if (typingConversation.current !== selectedId) {
	  typingConversation.current = selectedId;
	  void api.updatePresence(selectedId, 'composing').catch(() => undefined);
	}
	typingTimer.current = setTimeout(() => pauseTyping(selectedId), 1_800);
  };

  useEffect(() => () => pauseTyping(selectedId), [selectedId]);

  const sendMutation = useMutation({
    mutationFn: () => api.sendMessage(selectedId!, composer.trim()),
    onSuccess: async () => {
	  pauseTyping(selectedId);
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
	  pauseTyping(selectedId);
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

	const messageStatusLabel = (status: Message['status']): string => {
	  switch (status) {
		case 'pending': return 'Menunggu dikirim';
		case 'sent': return 'Terkirim';
		case 'delivered': return 'Diterima';
		case 'read': return 'Dibaca';
		case 'failed': return 'Gagal';
	  }
	};

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
          <div><span className="eyebrow">Inbox WhatsApp</span><h1>Percakapan</h1><span>{conversations.data?.reduce((sum, item) => sum + item.unread, 0)} pesan belum dibaca</span></div>
          <span className="inbox-live-status"><i className={whatsappConnected ? 'online-dot' : ''} />{whatsappConnected ? 'Terhubung' : 'Offline'}</span>
        </header>
        <div className="conversation-tools">
          <label className="search-input"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari percakapan…" aria-label="Cari percakapan" /></label>
          <button className={`icon-button conversation-filter-button ${filtersOpen ? 'icon-button--active' : ''}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-label="Filter percakapan"><Filter size={18} />{activeFilterCount ? <span>{activeFilterCount}</span> : null}</button>
        </div>
        {filtersOpen ? <div className="conversation-filters">
          <label><span>PIC</span><select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="all">Semua PIC</option>{assignees.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><span>Tahap</span><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">Semua tahap</option>{stages.data?.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
          <label><span>Tag</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">Semua tag</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <label><span>Waktu</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">Semua waktu</option><option value="today">24 jam</option><option value="week">7 hari</option><option value="month">30 hari</option></select></label>
          <label className="conversation-filter-check"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />Belum dibaca</label>
          {activeFilterCount ? <button className="conversation-filter-reset" onClick={resetConversationFilters}>Reset filter</button> : null}
        </div> : null}
        <div className="inbox-tabs"><button className={`inbox-tab ${!assignedOnly ? 'inbox-tab--active' : ''}`} onClick={() => setAssignedOnly(false)}>Semua <span>{filtered.length}</span></button><button className={`inbox-tab ${assignedOnly ? 'inbox-tab--active' : ''}`} onClick={() => setAssignedOnly(true)}>Ditugaskan ke saya</button></div>
        <div className="conversation-list">
          {filtered.map((conversation) => (
            <button key={conversation.id} className={`conversation-row ${selectedId === conversation.id ? 'conversation-row--active' : ''}`} onClick={() => setSelectedId(conversation.id)} aria-pressed={selectedId === conversation.id}>
              <span className="avatar-wrap"><Avatar name={conversation.name} src={`/api/v1/conversations/${conversation.id}/avatar`} />{conversation.online ? <i className="online-dot" /> : null}</span>
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
              <Avatar name={selected.name} src={`/api/v1/conversations/${selected.id}/avatar`} />
              <div className="message-header__identity"><strong>{selected.name}</strong><span>{selected.online ? <i className="online-dot" /> : null}{selected.presence === 'typing' ? 'Sedang mengetik…' : selected.presence === 'recording' ? 'Sedang merekam audio…' : selected.presence === 'online' ? 'Online' : 'WhatsApp'} · {conversationReady ? selected.phone : 'Nomor sedang disinkronkan'}</span></div>
              <div className="message-header__actions"><button className={`icon-button ${profileOpen ? 'icon-button--active' : ''}`} onClick={() => setProfileOpen((value) => !value)} aria-pressed={profileOpen} aria-label="Tampilkan profil lead"><Info size={19} /></button></div>
            </header>
            <div ref={messageHistory} className="message-history" aria-live="polite">
              {messages.isLoading ? <LoadingState label="Memuat pesan…" /> : messageGroups.map((group) => (
                <Fragment key={group.key}>
                  <div className="message-day">{group.label}</div>
                  {group.messages.map((message) => {
                    const genericMediaBody = message.type === 'image' && message.body === 'Gambar'
                      || message.type === 'video' && message.body === 'Video'
                      || message.type === 'audio' && message.body === 'Pesan audio'
                      || message.type === 'document' && message.body === message.fileName;
                    return (
                      <div key={message.id} className={`message-bubble-wrap message-bubble-wrap--${message.direction}`}>
				        <div className="message-bubble">
				          <MessageAttachment message={message} onLoad={scrollToLatest} />
				          {message.body && !genericMediaBody ? <p>{message.body}</p> : null}
		                  <span className="message-meta">
							<time>{messageTime(message.sentAt)}</time>
							{message.direction === 'outbound' ? <span
								className={`message-status message-status--${message.status}`}
								title={`Status pesan: ${messageStatusLabel(message.status)}`}
								aria-label={`Status pesan: ${messageStatusLabel(message.status)}`}
							>
								{statusIcon(message)}<small>{messageStatusLabel(message.status)}</small>
							</span> : null}
						  </span>
				          {message.status === 'failed' ? <button className="message-retry" onClick={() => retryMutation.mutate(message.id)}>Coba lagi</button> : null}
				        </div>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
              {!messages.isLoading && !messages.data?.length ? <EmptyState title="Belum ada pesan" description="Mulai percakapan dari kolom balasan di bawah." /> : null}
              <div ref={messageEnd} className="message-history__end" aria-hidden="true" />
            </div>
            <form className="composer" onSubmit={(event) => { event.preventDefault(); if (canSend && composer.trim()) sendMutation.mutate(); }}>
              {!whatsappConnected ? <div className="composer-warning" role="status">WhatsApp tidak terhubung. Histori tetap dapat dibaca, tetapi pengiriman dinonaktifkan. <a href="/settings/whatsapp">Periksa koneksi</a></div> : null}
              {whatsappConnected && !conversationReady ? <div className="composer-warning" role="status">Nomor kontak lama masih disinkronkan. Tunggu sinkronisasi histori selesai sebelum mengirim pesan.</div> : null}
              {sendMutation.error || mediaMutation.error ? <div className="composer-error" role="alert">{(sendMutation.error ?? mediaMutation.error) instanceof ApiClientError ? (sendMutation.error ?? mediaMutation.error)?.message : 'Pesan belum terkirim.'}</div> : null}
              <div className="composer__box">
                <button type="button" className="icon-button" disabled={!canSend || mediaMutation.isPending} aria-label="Lampirkan file" onClick={() => fileInput.current?.click()}><Paperclip size={19} /></button>
                <input ref={fileInput} hidden type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) mediaMutation.mutate(file); event.currentTarget.value = ''; }} />
                <textarea
                  value={composer}
                  onChange={(event) => updateComposer(event.target.value)}
                  disabled={!conversationReady}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend && composer.trim()) sendMutation.mutate(); } }}
                  placeholder="Tulis balasan WhatsApp…"
                  rows={1}
                  aria-label="Pesan WhatsApp"
                />
                <button className="send-button" disabled={!canSend || !composer.trim() || sendMutation.isPending || mediaMutation.isPending} aria-label="Kirim pesan"><Send size={18} /></button>
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
            <div className="contact-identity"><Avatar name={selectedLead.name} size="lg" {...(selected ? { src: `/api/v1/conversations/${selected.id}/avatar` } : {})} /><h2>{selectedLead.name}</h2><p>{conversationReady ? selectedLead.phone : 'Nomor sedang disinkronkan'}</p><div>{selectedLead.tags.map((tag) => <TagPill key={tag.id} tag={tag} />)}</div></div>
            <div className="contact-properties">
              <div><span><UserRound size={16} /> PIC</span><strong>{selectedLead.assignee}</strong></div>
              <div><span><TicketCheck size={16} /> Tahap</span><strong>{stages.data?.find((stage) => stage.id === selectedLead.stageId)?.name}</strong></div>
              <div><span><PackageOpen size={16} /> Paket diminati</span><strong>{selectedLead.scheduleName || 'Belum dipilih'}</strong></div>
              <div><span><CalendarDays size={16} /> Rencana berangkat</span><strong>{selectedLead.departurePlan || 'Belum diisi'}</strong></div>
              <div><span><Clock3 size={16} /> Follow-up berikutnya</span><strong>{formatDateTime(selectedLead.nextFollowUp)}</strong></div>
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
