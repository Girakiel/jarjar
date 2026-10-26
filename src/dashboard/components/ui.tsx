import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatNumber } from '../format';
import { Icon, type IconName } from './Icon';

export function Spinner() {
  return (
    <div className="center">
      <div className="spinner" role="status" aria-label="Loading" />
    </div>
  );
}

export function ErrorBox({ error }: { error: { message: string } | string | undefined }) {
  if (!error) return null;
  return <div className="error-box">{typeof error === 'string' ? error : error.message}</div>;
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; icon?: IconName; count?: number }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'active' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
          {o.count !== undefined && <span className="count">{formatNumber(o.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="field">
      <label className="toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="track" />
        {label}
      </label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function BarList({ items, total, format = formatNumber }: { items: Array<{ name: string; count: number; label?: ReactNode }>; total?: number; format?: (n: number) => string }) {
  if (!items.length) return <div className="muted small">No data yet</div>;
  const max = total ?? Math.max(...items.map((i) => i.count));
  return (
    <div className="barlist">
      {items.map((item) => (
        <div className="barlist-row" key={item.name}>
          <div className="fill" style={{ width: `${max ? (item.count / max) * 100 : 0}%` }} />
          <span className="truncate">{item.label ?? item.name}</span>
          <span className="value">{format(item.count)}</span>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, delta, invert }: { label: string; value: ReactNode; delta?: number | null; invert?: boolean }) {
  let deltaEl: ReactNode = null;
  if (delta !== undefined && delta !== null && Number.isFinite(delta) && Math.abs(delta) >= 0.005) {
    const good = invert ? delta < 0 : delta > 0;
    deltaEl = (
      <span className={`delta ${good ? 'up' : 'down'}`}>
        {delta > 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(0)}%
      </span>
    );
  }
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {deltaEl}
    </div>
  );
}

export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-sm btn-icon ${className}`}
      title="Copy"
      aria-label="Copy to clipboard"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

const DAY_OPTIONS = [
  { value: '1', label: '24h' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
];

function storedDays(): string {
  try {
    return localStorage.getItem('jj_days') ?? '30';
  } catch {
    return '30';
  }
}

/** Date range shared across pages through the ?days= query param. */
export function useDays(): [number, (days: number) => void] {
  const [params, setParams] = useSearchParams();
  const days = Number(params.get('days') ?? storedDays()) || 30;
  const setDays = (value: number) => {
    try {
      localStorage.setItem('jj_days', String(value));
    } catch {
      /* ignore */
    }
    const next = new URLSearchParams(params);
    next.set('days', String(value));
    setParams(next, { replace: true });
  };
  return [days, setDays];
}

export function DaysPicker() {
  const [days, setDays] = useDays();
  return <Segmented label="Date range" value={String(days)} options={DAY_OPTIONS} onChange={(v) => setDays(Number(v))} />;
}

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="header-actions">{children}</div>}
    </div>
  );
}
