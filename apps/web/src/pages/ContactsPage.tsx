import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircleMore, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Avatar, EmptyState, ErrorState, LoadingState, PageHeader, TagPill } from '../components/ui';

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
  return (
    <div className="page">
      <PageHeader title="Kontak" description="Calon jamaah dari seluruh percakapan brand aktif." actions={<button className="button button--primary" onClick={() => navigate('/conversations')}>Buka inbox</button>} />
      <section className="panel contacts-panel">
        <div className="table-tools"><label className="search-input search-input--wide"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau nomor…" /></label><span>{filteredLeads.length} dari {leads.data.length} kontak</span></div>
        {filteredLeads.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Kontak</th><th>Domisili</th><th>Sumber</th><th>PIC</th><th>Tag</th><th><span className="sr-only">Aksi</span></th></tr></thead><tbody>{filteredLeads.map((lead) => <tr key={lead.id}><td><div className="table-contact"><Avatar name={lead.name} size="sm" /><span><strong>{lead.name}</strong><small>{lead.phone}</small></span></div></td><td>{lead.city || '—'}</td><td>{lead.source}</td><td>{lead.assignee}</td><td>{lead.tags.map((tag) => <TagPill key={tag.id} tag={tag} />)}</td><td><button className="icon-button" onClick={() => navigate(`/conversations?conversation=${encodeURIComponent(lead.conversationId)}`)} aria-label={`Buka percakapan ${lead.name}`}><MessageCircleMore size={18} /></button></td></tr>)}</tbody></table></div> : <EmptyState title="Kontak tidak ditemukan" description="Coba nama, nomor, kota, atau sumber lead lain." />}
      </section>
    </div>
  );
}
