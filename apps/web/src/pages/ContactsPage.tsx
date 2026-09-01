import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Import, MapPin, MessageCircleMore, Search, UserCheck, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ContactImportResult } from '@azhan-crm/contracts';
import { api } from '../api';
import { Avatar, Dialog, EmptyState, ErrorState, LoadingState } from '../components/ui';

type ParsedImport = {
  contacts: Array<{ name: string; phone: string }>;
  errors: string[];
};

export function parseContactImport(value: string): ParsedImport {
  const contacts: ParsedImport['contacts'] = [];
  const errors: string[] = [];
  for (const [index, rawLine] of value.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf('|');
    const name = separator >= 0 ? line.slice(0, separator).trim() : '';
    const phone = separator >= 0 ? line.slice(separator + 1).trim() : '';
    if (!name || !phone || phone.includes('|')) {
      errors.push(`Baris ${index + 1}: gunakan format nama|nomorhp.`);
      continue;
    }
    contacts.push({ name, phone });
  }
  if (!contacts.length && !errors.length) errors.push('Masukkan minimal satu kontak.');
  if (contacts.length > 1_000) errors.push('Maksimal 1.000 kontak dalam satu impor.');
  return { contacts, errors };
}

export function ContactsPage({ canImport = false }: { canImport?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: api.contacts });
  const parsedImport = useMemo(() => parseContactImport(importValue), [importValue]);
  const importMutation = useMutation({
    mutationFn: () => api.importContacts(parsedImport.contacts),
    onSuccess: async (result) => {
      setImportResult(result);
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
  const normalizedSearch = search.trim().toLowerCase();
  const filteredContacts = useMemo(() => (contacts.data ?? []).filter((contact) => (
    `${contact.name} ${contact.phone} ${contact.city} ${contact.source} ${contact.assignee ?? ''}`.toLowerCase().includes(normalizedSearch)
  )), [contacts.data, normalizedSearch]);
  if (contacts.isLoading) return <LoadingState label="Memuat kontak…" />;
  if (contacts.error || !contacts.data) return <ErrorState message="Kontak belum tersedia." onRetry={() => void contacts.refetch()} />;
  const assignedCount = contacts.data.filter((contact) => contact.assignee).length;
  const conversationCount = contacts.data.filter((contact) => contact.conversationId).length;
  const cityCount = new Set(contacts.data.map((contact) => contact.city).filter(Boolean)).size;
  const closeImport = () => {
    setImportOpen(false);
    setImportResult(null);
    importMutation.reset();
  };
  return (
    <div className="page contacts-page">
      <header className="directory-page-header">
        <div><span className="eyebrow">Direktori WhatsApp</span><h1>Kontak</h1><p>Nomor dari histori WhatsApp dan kontak yang diimpor untuk brand aktif.</p></div>
        <div>
          {canImport ? <button className="button button--secondary" onClick={() => { setImportOpen(true); setImportResult(null); }}><Import size={17} />Impor kontak</button> : null}
          <button className="button button--primary" onClick={() => navigate('/conversations')}><MessageCircleMore size={17} />Buka inbox</button>
        </div>
      </header>
      <section className="directory-insights" aria-label="Ringkasan kontak">
        <div><span><UsersRound size={18} /></span><small>Total kontak</small><strong>{contacts.data.length}</strong></div>
        <div><span><MessageCircleMore size={18} /></span><small>Punya percakapan</small><strong>{conversationCount}</strong></div>
        <div><span><UserCheck size={18} /></span><small>Sudah punya PIC</small><strong>{assignedCount}</strong></div>
        <div><span><MapPin size={18} /></span><small>Domisili</small><strong>{cityCount} kota</strong></div>
      </section>
      <section className="panel contacts-panel">
        <div className="table-tools"><label className="search-input search-input--wide"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau nomor…" aria-label="Cari kontak" /></label><span className="table-result-count"><strong>{filteredContacts.length}</strong> dari {contacts.data.length} kontak</span></div>
        {filteredContacts.length ? <div className="data-table-wrap"><table className="data-table contacts-table"><thead><tr><th>Kontak</th><th>Domisili</th><th>Sumber</th><th>PIC</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{filteredContacts.map((contact) => <tr key={contact.id}><td><div className="table-contact"><Avatar name={contact.name} size="sm" {...(contact.conversationId ? { src: `/api/v1/conversations/${contact.conversationId}/avatar` } : {})} /><span><strong>{contact.name}</strong><small>{contact.phone}</small></span></div></td><td>{contact.city || '—'}</td><td>{contact.source || '—'}</td><td>{contact.assignee || 'Belum ditugaskan'}</td><td><span className={`contact-status ${contact.conversationId ? 'contact-status--active' : ''}`}>{contact.conversationId ? 'Ada percakapan' : 'Kontak tersimpan'}</span></td><td>{contact.conversationId ? <button className="button button--small button--secondary contact-chat-button" onClick={() => navigate(`/conversations?conversation=${encodeURIComponent(contact.conversationId!)}`)} aria-label={`Buka percakapan ${contact.name}`}><MessageCircleMore size={15} />Chat</button> : <span className="contact-no-chat">Belum ada chat</span>}</td></tr>)}</tbody></table></div> : <EmptyState title="Kontak tidak ditemukan" description="Coba nama, nomor, kota, atau sumber lain." />}
      </section>
      {importOpen ? <Dialog title="Impor kontak massal" description="Satu kontak per baris menggunakan pemisah |" onClose={closeImport}>
        <div className="dialog-form-body contact-import-dialog">
          {importResult ? <div className="contact-import-success" role="status"><CheckCircle2 size={22} /><div><strong>{importResult.imported} kontak diproses</strong><p>{importResult.created} baru, {importResult.updated} diperbarui{importResult.duplicates ? `, ${importResult.duplicates} duplikat dalam input dilewati` : ''}.</p></div></div> : <>
            <label className="field field--wide"><span>Daftar kontak</span><textarea rows={12} value={importValue} onChange={(event) => setImportValue(event.target.value)} placeholder={'Ahmad Fauzi|081234567890\nSiti Aminah|6281234567890'} autoFocus /><small>Contoh: Nama Jamaah|081234567890. Maksimal 1.000 baris.</small></label>
            {parsedImport.errors.length ? <div className="inline-error" role="alert"><div>{parsedImport.errors.slice(0, 5).map((error) => <span key={error}>{error}</span>)}</div></div> : null}
            {importMutation.error ? <div className="inline-error" role="alert">{importMutation.error.message}</div> : null}
            <div className="contact-import-preview"><strong>{parsedImport.contacts.length}</strong><span>kontak siap diimpor</span></div>
          </>}
        </div>
        <footer className="dialog__footer">{importResult ? <button className="button button--primary" onClick={closeImport}>Selesai</button> : <><button className="button button--secondary" onClick={closeImport}>Batal</button><button className="button button--primary" disabled={Boolean(parsedImport.errors.length) || !parsedImport.contacts.length || importMutation.isPending} onClick={() => importMutation.mutate()}><Import size={16} />{importMutation.isPending ? 'Mengimpor…' : 'Impor kontak'}</button></>}</footer>
      </Dialog> : null}
    </div>
  );
}
