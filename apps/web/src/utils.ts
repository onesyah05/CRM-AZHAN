export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)} M`;
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(0)} jt`;
  return formatCurrency(value);
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return 'baru saja';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}j`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}h`;
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(date);
}

export function formatDateTime(value: string): string {
  if (!value) return 'Belum dijadwalkan';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export function commitmentLabel(value?: string): string {
  const labels: Record<string, string> = {
    book_seat: 'Book Seat',
    book_seat_expired: 'Book Seat Kedaluwarsa',
    dp_pending: 'DP Menunggu Verifikasi',
    dp_confirmed: 'DP Terkonfirmasi',
    dp_rejected: 'DP Ditolak — Perlu Tindak Lanjut',
    paid: 'Lunas',
  };
  return value ? labels[value] ?? value : '';
}
