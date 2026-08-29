export function normalizeIndonesianPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return `+${digits}`;
  if (digits.startsWith('0')) return `+62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `+62${digits}`;
  return `+${digits}`;
}

export function maskPhone(input: string): string {
  const normalized = normalizeIndonesianPhone(input);
  if (normalized.length < 8) return normalized;
  return `${normalized.slice(0, 5)}••••${normalized.slice(-3)}`;
}
