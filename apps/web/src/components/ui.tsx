import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle, X } from 'lucide-react';
import type { Tag } from '@azhan-crm/contracts';
import { initials } from '../utils';

export function Avatar({ name, size = 'md', src }: { name: string; size?: 'sm' | 'md' | 'lg'; src?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const colors = ['#2F6FED', '#7C3AED', '#137548', '#C24175', '#B65C00'];
  const index = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length;
  useEffect(() => setImageFailed(false), [src]);
  return (
    <span className={`avatar avatar--${size}`} style={{ backgroundColor: colors[index] }} aria-hidden="true">
      {src && !imageFailed ? <img src={src} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : initials(name)}
    </span>
  );
}

export function TagPill({ tag }: { tag: Tag }) {
  return <span className="tag-pill" style={{ '--tag-color': tag.color } as React.CSSProperties}>{tag.name}</span>;
}

export function LoadingState({ label = 'Memuat data…' }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <span className="state-block__loader"><LoaderCircle className="spin" size={22} /></span>
      <span>{label}</span>
      <span className="state-block__skeleton" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Inbox size={24} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={20} />
      <div><strong>Belum berhasil memuat data</strong><p>{message}</p></div>
      {onRetry ? <button className="button button--secondary" onClick={onRetry}>Coba lagi</button> : null}
    </div>
  );
}

export function Dialog({
  title,
  description,
  onClose,
  children,
  size = 'md',
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`dialog dialog--${size}`}
      aria-labelledby="dialog-title"
      aria-describedby={description ? 'dialog-description' : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="dialog__surface">
        <header className="dialog__header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description ? <p id="dialog-description">{description}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Tutup dialog"><X size={20} /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
