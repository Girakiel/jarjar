/** A tiny bar chart of recent daily values. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 32;
  const slot = w / Math.max(values.length, 1);
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => {
        const bh = v ? Math.max(2, (v / max) * (h - 2)) : 1;
        return <rect key={i} x={i * slot + slot * 0.15} y={h - bh} width={slot * 0.7} height={bh} rx={1} className={v ? 'on' : 'off'} />;
      })}
    </svg>
  );
}
