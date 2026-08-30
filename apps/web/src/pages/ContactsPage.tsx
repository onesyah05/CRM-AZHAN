import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, MessageCircleMore, Search, UserCheck, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Avatar, EmptyState, ErrorState, LoadingState, TagPill } from '../components/ui';

export function ContactsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const leads = useQuery({ queryKey: ['leads'], queryFn: api.leads });
  const normalizedSearch = search.trim().toLowerCase();
  const filteredLeads = useMemo(() => (leads.data ?? []).filter((lead) => (
    `${lead.name} ${lead.phone} ${lead.city} ${lead.source}`.toLowerCase().includes(normalizedSearch)
  )), [leads.data, normalizedSearch]);
  if (leads.isLoading) return <LoadingState label="Memuat kontak…" />;
  if (leads.error || !leads.data) return <ErrorState message="Kontak belum tersedia." />;
  const assignedCount = leads.data.filter((lead) => lead.assignee && lead.assignee !== 'Belum ditugaskan').length;
  const unreadCount = leads.data.filter((lead) => lead.unread > 0).length;
  const cityCount = new Set(leads.data.map((lead) => lead.city).filter(Boolean)).size;
  return (
    <div className="page contacts-page">
      <header className="directory-page-header"><div><span className="eyebrow">Direktori calon jamaah</span><h1>Kontak</h1><p>Seluruh calon jamaah dari percakapan brand aktif, siap ditindaklanjuti oleh tim.</p></div><div><button className="button button--primary" onClick={() => navigate('/conversations')}><MessageCircleMore size={17} />Buka inbox</button></div></header>
      <section className="directory-insights" aria-label="Ringkasan kontak">
        <div><span><UsersRound size={18} /></span><small>Total kontak</small><strong>{leads.data.length}</strong></div>
        <div><span><UserCheck size={18} /></span><small>Sudah punya PIC</small><strong>{assignedCount}</strong></div>
        <div><span><MessageCircleMore size={18} /></span><small>Pesan baru</small><strong>{unreadCount}</strong></div>
        <div><span><MapPin size={18} /></span><small>Domisili</small><strong>{cityCount} kota</strong></div>
      </section>
      <section className="panel contacts-panel">
        <div className="table-tools"><label className="search-input search-input--wide"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau nomor…" aria-label="Cari kontak" /></label><span className="table-result-count"><strong>{filteredLeads.length}</strong> dari {leads.data.length} kontak</span></div>
        {filteredLeads.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Kontak</th><th>Domisili</th><th>Sumber</th><th>PIC</th><th>Tag</th><th>Aksi</th></tr></thead><tbody>{filteredLeads.map((lead) => <tr key={lead.id}><td><div className="table-contact"><Avatar name={lead.name} size="sm" /><span><strong>{lead.name}</strong><small>{lead.phone}</small></span></div></td><td>{lead.city || '—'}</td><td>{lead.source}</td><td>{lead.assignee}</td><td><div className="table-tags">{lead.tags.map((tag) => <TagPill key={tag.id} tag={tag} />)}</div></td><td><button className="button button--small button--secondary contact-chat-button" onClick={() => navigate(`/conversations?conversation=${encodeURIComponent(lead.conversationId)}`)} aria-label={`Buka percakapan ${lead.name}`}><MessageCircleMore size={15} />Chat</button></td></tr>)}</tbody></table></div> : <EmptyState title="Kontak tidak ditemukan" description="Coba nama, nomor, kota, atau sumber lead lain." />}
      </section>
    </div>
  );
}
