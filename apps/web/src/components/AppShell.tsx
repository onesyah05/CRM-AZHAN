import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  ClipboardList,
  Bell,
  ExternalLink,
  KanbanSquare,
  Menu,
  MessageCircleMore,
  LogOut,
  Search,
  Settings,
  UserCog,
  UsersRound,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { UserContext } from '@azhan-crm/contracts';
import { api } from '../api';
import { getBrandForeground } from '../theme';
import { Avatar } from './ui';

const navItems = [
  { to: '/', label: 'Ringkasan', icon: BarChart3, end: true },
  { to: '/conversations', label: 'Percakapan', icon: MessageCircleMore },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/contacts', label: 'Kontak', icon: UsersRound },
  { to: '/activities', label: 'Aktivitas', icon: ClipboardList },
  { to: '/team', label: 'Tim CS', icon: UserCog, managerOnly: true },
  { to: '/settings/whatsapp', label: 'Pengaturan', icon: Settings, managerOnly: true },
];

export function AppShell({ user, children }: { user: UserContext; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { queryClient.clear(); void navigate('/login', { replace: true }); } });
  const waQuery = useQuery({ queryKey: ['whatsapp-status'], queryFn: api.whatsappStatus, refetchInterval: 8_000 });
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: api.conversations });
  const waConnected = waQuery.data?.status === 'connected';
  const unreadCount = conversations.data?.reduce((sum, conversation) => sum + conversation.unread, 0) ?? 0;
  const brandColor = user.brand?.primaryColor ?? '#CC904A';
  const brandName = user.brand?.name ?? 'Azhan ERP';
  const brandInitial = brandName.trim().slice(0, 1).toUpperCase();
  const roleLabel = user.role === 'manager' ? 'Admin Travel' : user.role === 'super_admin' ? 'Super Admin' : 'Sales';
  const erpDashboardUrl = import.meta.env.VITE_ERP_DASHBOARD_URL ?? 'http://localhost:5174';

  useEffect(() => {
    const focusGlobalSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusGlobalSearch);
    return () => window.removeEventListener('keydown', focusGlobalSearch);
  }, []);

  return (
    <div
      className="app-shell"
      style={{ '--color-brand': brandColor, '--color-brand-foreground': getBrandForeground(brandColor) } as React.CSSProperties}
    >
      <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Buka navigasi"><Menu /></button>
      {mobileOpen ? <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Tutup navigasi" /> : null}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--mobile-open' : ''}`}>
        <div className="sidebar__brand">
          {user.brand?.logoUrl && !logoFailed ? (
            <img className="sidebar__brand-logo" src={user.brand.logoUrl} alt={`Logo ${brandName}`} onError={() => setLogoFailed(true)} />
          ) : (
            <span className="brand-mark" aria-hidden="true">{brandInitial}</span>
          )}
          <div><strong>{brandName}</strong><span>CRM · Azhan ERP</span></div>
          <button className="sidebar__mobile-close" onClick={() => setMobileOpen(false)} aria-label="Tutup navigasi"><X size={20} /></button>
        </div>
        <nav className="sidebar__nav" aria-label="Navigasi utama">
          <span className="sidebar__label">CRM</span>
          {navItems.filter((item) => !item.managerOnly || user.role !== 'sales').map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              {...(end ? { end: true } : {})}
              className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="nav-item__icon"><Icon size={19} /></span>
              <span>{label}</span>
              {label === 'Percakapan' && unreadCount > 0 ? <span className="nav-count">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className={`wa-mini-status ${waConnected ? 'wa-mini-status--connected' : ''}`}>
            <span className="status-dot" />
            <div><strong>WhatsApp</strong><span>{waConnected ? 'Terhubung' : 'Perlu perhatian'}</span></div>
          </div>
          <a className="erp-dashboard-link" href={erpDashboardUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={17} /><span>Buka Dashboard ERP</span>
          </a>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <form className="global-search" onSubmit={(event) => { event.preventDefault(); if (globalSearch.trim()) void navigate(`/conversations?q=${encodeURIComponent(globalSearch.trim())}`); }}>
            <Search size={18} />
            <input ref={globalSearchRef} value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Cari lead, nomor, atau percakapan…" aria-label="Pencarian global" />
            <kbd>Ctrl K</kbd>
		  </form>
          <div className="topbar__actions">
            <span className={`connection-chip ${waConnected ? 'connection-chip--connected' : ''}`}>
              <span className="status-dot" />{waConnected ? 'WA terhubung' : 'WA terputus'}
            </span>
            <button className="icon-button" onClick={() => navigate('/conversations?unread=1')} aria-label={`${unreadCount} pesan belum dibaca`}><Bell size={20} />{unreadCount > 0 ? <span className="notification-dot" /> : null}</button>
            <div className="user-menu"><Avatar name={user.name} size="sm" /><div><strong>{user.name}</strong><span>{roleLabel}</span></div><button className="icon-button" onClick={() => logout.mutate()} disabled={logout.isPending} aria-label="Keluar dari CRM" title="Keluar"><LogOut size={17} /></button></div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
