import { lazy, Suspense, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorState, LoadingState } from './components/ui';
import { api, ApiClientError } from './api';
const ContactsPage = lazy(() => import('./pages/ContactsPage').then((module) => ({ default: module.ContactsPage })));
const ConversationsPage = lazy(() => import('./pages/ConversationsPage').then((module) => ({ default: module.ConversationsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const PipelinePage = lazy(() => import('./pages/PipelinePage').then((module) => ({ default: module.PipelinePage })));
const WhatsappSettingsPage = lazy(() => import('./pages/WhatsappSettingsPage').then((module) => ({ default: module.WhatsappSettingsPage })));
const BrandSelectPage = lazy(() => import('./pages/BrandSelectPage').then((module) => ({ default: module.BrandSelectPage })));
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage').then((module) => ({ default: module.ActivitiesPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then((module) => ({ default: module.TeamPage })));

function AuthenticatedApp() {
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ['context'], queryFn: api.context, retry: false });

  useEffect(() => {
    if (!context.data) return;
    let disposed = false;
    let disconnect: (() => void) | undefined;
    void import('socket.io-client').then(({ io }) => {
      if (disposed) return;
      const socket = io({ withCredentials: true });
      disconnect = () => socket.disconnect();
      socket.on('message.created', () => {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['messages'] });
        void queryClient.invalidateQueries({ queryKey: ['leads'] });
        void queryClient.invalidateQueries({ queryKey: ['contacts'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      });
      socket.on('message.status.updated', () => {
        void queryClient.invalidateQueries({ queryKey: ['messages'] });
      });
      socket.on('presence.updated', () => {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      });
      socket.on('history.synced', () => {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['messages'] });
        void queryClient.invalidateQueries({ queryKey: ['leads'] });
        void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      });
      socket.on('contacts.synced', () => {
        void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      });
      socket.on('context.changed', () => {
        void queryClient.invalidateQueries();
      });
    });
    return () => { disposed = true; disconnect?.(); };
  }, [context.data, queryClient]);

  if (context.isLoading) return <div className="app-loading"><span className="brand-mark"><span>✦</span></span><LoadingState label="Menyiapkan workspace CRM…" /></div>;
  if (context.error) {
    if (context.error instanceof ApiClientError && context.error.code === 'UNAUTHORIZED') return <LoginPage />;
    return <div className="standalone-state"><ErrorState message="Workspace belum dapat dibuka." onRetry={() => void context.refetch()} /></div>;
  }
  if (!context.data) return <LoginPage />;
	if (!context.data.brand) return <BrandSelectPage user={context.data} />;

  return (
    <AppShell user={context.data}>
      <Routes>
        <Route path="/" element={<DashboardPage user={context.data} />} />
        <Route path="/conversations" element={<ConversationsPage user={context.data} />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/contacts" element={<ContactsPage canImport={context.data.role !== 'sales'} />} />
        <Route path="/activities" element={<ActivitiesPage />} />
        <Route path="/team" element={context.data.role === 'sales' ? <Navigate to="/" replace /> : <TeamPage />} />
        <Route path="/settings/whatsapp" element={context.data.role === 'sales' ? <Navigate to="/" replace /> : <WhatsappSettingsPage user={context.data} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return <Suspense fallback={<div className="app-loading"><LoadingState label="Memuat halaman…" /></div>}><Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<AuthenticatedApp />} /></Routes></Suspense>;
}
