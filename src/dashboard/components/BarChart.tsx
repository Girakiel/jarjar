import { useMemo, useState } from 'react';
import { formatDay, formatNumber } from '../format';

interface Point {
  date: string;
  value: number;
}

function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fills in missing days so the x-axis is continuous. */
export function fillDays(rows: Array<{ date: string; value: number }>, days: number): Point[] {
  const byDate = new Map(rows.map((r) => [r.date, r.value]));
  const out: Point[] = [];
  const today = new Date();
  for (let i = Math.max(days, 1) - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = localIsoDate(d);
    out.push({ date: key, value: byDate.get(key) ?? 0 });
  }
  return out;
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export function BarChart({ data, height = 180, label }: { data: Point[]; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const pad = { top: 10, right: 8, bottom: 22, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const slot = innerW / Math.max(data.length, 1);
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const labelEvery = Math.ceil(data.length / 8);
  const active = hover !== null ? data[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => {
          const y = pad.top + innerH * (1 - f);
          return (
            <g key={f}>
              <line className="gridline" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
              <text className="axis" x={pad.left - 6} y={y + 4} textAnchor="end">
                {formatNumber(max * f)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = max ? (d.value / max) * innerH : 0;
          const x = pad.left + slot * i + (slot - barW) / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={innerH} fill="transparent" />
              <rect className="bar" x={x} y={pad.top + innerH - h} width={barW} height={Math.max(h, d.value ? 1.5 : 0)} rx={Math.min(3, barW / 3)} opacity={hover === null || hover === i ? 1 : 0.55} />
              {i % labelEvery === 0 && (
                <text className="axis" x={pad.left + slot * i + slot / 2} y={height - 5} textAnchor="middle">
                  {formatDay(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active && (
        <div className="badge" style={{ position: 'absolute', top: 0, right: 0 }}>
          {formatDay(active.date)}: <strong>{formatNumber(active.value)}</strong>
        </div>
      )}
    </div>
  );
}
