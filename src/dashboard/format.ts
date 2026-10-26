export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "2m 05s"-style, for summary numbers. */
export function formatDurationLong(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const numberFormat = new Intl.NumberFormat();
const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function formatNumber(n: number): string {
  return Math.abs(n) >= 10_000 ? compactFormat.format(n) : numberFormat.format(Math.round(n * 10) / 10);
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function formatDateTime(ts: number): string {
  return dateTime.format(ts);
}

export function formatDay(isoDate: string): string {
  return dateOnly.format(new Date(`${isoDate}T00:00:00`));
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return dateOnly.format(ts);
}

export function flag(country: string | null): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return '';
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function pathOf(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.pathname + (u.hash.startsWith('#/') ? u.hash : '');
  } catch {
    return url;
  }
}

export const RATING_EMOJI: Record<number, string> = { 1: '😡', 2: '🙁', 3: '😐', 4: '🙂', 5: '😍' };
export const RATING_LABEL: Record<number, string> = { 1: 'Hate', 2: 'Dislike', 3: 'Neutral', 4: 'Like', 5: 'Love' };
