import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
import { api, ApiError, useApi, type Device, type HeatmapPage, type PointData, type ScrollData } from '../api';
import { drawHeat, drawScroll, reachAt, resolvePoints } from '../components/heatmap';
import { Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { DaysPicker, Empty, ErrorBox, PageHeader, Segmented, Spinner, useDays } from '../components/ui';
import { formatNumber, formatPercent, timeAgo } from '../format';

type HeatType = 'click' | 'move' | 'scroll';

const OVERLAY_ID = '__jarjar_heatmap';
const HIGHLIGHT_ID = '__jarjar_highlight';

function docSize(doc: Document) {
  const el = doc.documentElement;
  const body = doc.body;
  return {
    width: Math.max(el.scrollWidth, body?.scrollWidth ?? 0, el.clientWidth),
    height: Math.max(el.scrollHeight, body?.scrollHeight ?? 0, el.clientHeight),
  };
}

function overlayEl<T extends HTMLElement>(doc: Document, id: string, tag: string): T {
  let el = doc.getElementById(id) as T | null;
  if (!el) {
    el = doc.createElement(tag) as T;
    el.id = id;
    el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:2147483647;';
    // A child of <html> is positioned against the document, regardless of body styles.
    doc.documentElement.appendChild(el);
  }
  return el;
}

interface ViewProps {
  siteId: string;
  path: string;
  device: Device;
  type: HeatType;
  data: PointData | ScrollData | undefined;
  highlight: string | null;
}

function HeatmapView({ siteId, path, device, type, data, highlight }: ViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const snapWidth = useRef(1280);
  const scaleRef = useRef(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [readout, setReadout] = useState<string | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  // The snapshot frame is sandboxed without scripts, and canvases don't render in such documents.
  // So we draw here and hand the frame a plain image of the result.
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const drawId = useRef(0);

  const doc = () => replayerRef.current?.iframe.contentDocument ?? null;

  // Fit the snapshot's width into the stage and let the page scroll inside the frame.
  const layout = useCallback(() => {
    const stage = stageRef.current;
    const scaler = scalerRef.current;
    const iframe = replayerRef.current?.iframe;
    if (!stage || !scaler || !iframe) return;
    const width = snapWidth.current;
    const scale = Math.min(1, (stage.clientWidth - 32) / width);
    scaleRef.current = scale;
    const height = Math.floor(stage.clientHeight / scale);
    scaler.style.width = `${width}px`;
    scaler.style.height = `${height}px`;
    scaler.style.transform = `scale(${scale})`;
    scaler.style.left = `${Math.max(0, (stage.clientWidth - width * scale) / 2)}px`;
    iframe.width = String(width);
    iframe.height = String(height);
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    setLayoutTick((t) => t + 1);
  }, []);

  // Load the snapshot and rebuild it.
  useEffect(() => {
    const scaler = scalerRef.current;
    if (!scaler) return;
    let cancelled = false;
    setStatus('loading');
    api<Array<{ type: number; data: { width?: number } }>>(`/sites/${siteId}/heatmaps/snapshot?path=${encodeURIComponent(path)}&device=${device}`)
      .then((events) => {
        if (cancelled) return;
        snapWidth.current = events[0]?.data?.width || 1280;
        const replayer = new Replayer(events as never, {
          root: scaler,
          showWarning: false,
          mouseTail: false,
          triggerFocus: false,
          UNSAFE_replayCanvas: false,
          insertStyleRules: ['html, body { scroll-behavior: auto !important; }'],
        });
        replayerRef.current = replayer;
        replayer.on('fullsnapshot-rebuilded', () => {
          if (cancelled) return;
          replayer.enableInteract();
          const d = replayer.iframe.contentDocument;
          if (d) {
            // The snapshot is a picture, not a working page.
            const block = (e: Event) => e.preventDefault();
            d.addEventListener('click', block, true);
            d.addEventListener('submit', block, true);
            // Late-loading images and fonts move things around; redraw when they settle.
            let timer: ReturnType<typeof setTimeout>;
            d.addEventListener('load', () => {
              clearTimeout(timer);
              timer = setTimeout(() => setLayoutTick((t) => t + 1), 250);
            }, true);
          }
          layout();
          setStatus('ready');
          setTimeout(() => !cancelled && setLayoutTick((t) => t + 1), 1200);
        });
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        setStatus(err.status === 404 ? 'missing' : 'error');
        setMessage(err.message);
      });
    return () => {
      cancelled = true;
      replayerRef.current?.destroy();
      replayerRef.current = null;
      scaler.innerHTML = '';
    };
  }, [siteId, path, device, layout]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => layout());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [layout]);

  // Draw the overlay.
  useEffect(() => {
    const d = doc();
    if (status !== 'ready' || !d || !data) return;
    const img = overlayEl<HTMLImageElement>(d, OVERLAY_ID, 'img');
    img.style.display = 'none'; // keep it out of the size measurement
    const { width, height } = docSize(d);
    Object.assign(img.style, { display: '', width: `${width}px`, height: `${height}px` });
    img.alt = '';

    const canvas = canvasRef.current;
    const id = ++drawId.current;
    const publish = () =>
      canvas.toBlob((blob) => {
        if (!blob || id !== drawId.current) return;
        const previous = img.src;
        img.src = URL.createObjectURL(blob);
        if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
      });

    if (data.type === 'scroll') {
      const reach = data.reach.map(([sy, dh]) => Math.min(1, sy / dh)).sort((a, b) => a - b);
      const fold = data.reach.length ? data.reach.reduce((sum, [, dh, vh]) => sum + Math.min(1, vh / dh), 0) / data.reach.length : 0;
      drawScroll(canvas, reach, { width, height, fold });
      publish();
      const onMove = (e: MouseEvent) => setReadout(`${formatPercent(reachAt(reach, e.pageY / height))} of visitors scrolled this far`);
      const onLeave = () => setReadout(null);
      d.addEventListener('mousemove', onMove);
      d.addEventListener('mouseleave', onLeave);
      return () => {
        d.removeEventListener('mousemove', onMove);
        d.removeEventListener('mouseleave', onLeave);
        setReadout(null);
      };
    }
    // Grow spots a little when the page is shown zoomed out, so they stay readable.
    const zoom = Math.sqrt(scaleRef.current);
    const radius = (data.type === 'click' ? 26 : 34) / zoom;
    drawHeat(canvas, resolvePoints(d, data), { width, height, radius, dim: data.type === 'click' ? 0.3 : 0.2 });
    publish();
  }, [status, data, layoutTick]);

  // Outline the element hovered in the "top elements" list.
  useEffect(() => {
    const d = doc();
    if (status !== 'ready' || !d) return;
    const box = overlayEl<HTMLDivElement>(d, HIGHLIGHT_ID, 'div');
    const el = highlight ? (() => { try { return d.querySelector(highlight); } catch { return null; } })() : null;
    if (!el) {
      box.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    const win = d.defaultView!;
    Object.assign(box.style, {
      display: 'block',
      left: `${r.left + win.scrollX - 3}px`,
      top: `${r.top + win.scrollY - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
      border: '3px solid #8b74ff',
      borderRadius: '6px',
      boxShadow: '0 0 0 9999px rgba(10,10,20,0.35)',
    });
    if (r.top < 0 || r.bottom > win.innerHeight) el.scrollIntoView({ block: 'center' });
  }, [highlight, status, layoutTick]);

  return (
    <div className="heatmap-stage" ref={stageRef}>
      <div className="scaler" ref={scalerRef} />
      {status === 'loading' && (
        <div className="heatmap-overlay-msg">
          <div className="spinner" />
        </div>
      )}
      {status === 'missing' && (
        <div className="heatmap-overlay-msg">
          <div>
            <Icon name={device} />
            <p>
              No {device} snapshot of <strong>{path}</strong> yet.
              <br />
              It's captured automatically the next time someone visits this page on a {device}.
            </p>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="heatmap-overlay-msg">
          <ErrorBox error={message} />
        </div>
      )}
      {readout && <div className="scroll-readout">{readout}</div>}
    </div>
  );
}

export function HeatmapsPage() {
  const { site } = useSite();
  const [days] = useDays();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const { data: pages, error } = useApi<HeatmapPage[]>(`/sites/${site.id}/heatmaps/pages?days=${days}`);

  const set = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) next.set(k, v);
    setParams(next, { replace: true });
  };

  const path = params.get('path') ?? pages?.[0]?.path ?? null;
  const page = pages?.find((p) => p.path === path);
  const type = (params.get('type') as HeatType) || 'click';
  const preferredDevice = (): Device => {
    if (!page) return 'desktop';
    const ranked = (['desktop', 'mobile', 'tablet'] as Device[]).filter((d) => page.devices[d].snapshotAt).sort((a, b) => page.devices[b].views - page.devices[a].views);
    return ranked[0] ?? 'desktop';
  };
  const device = (params.get('device') as Device) || preferredDevice();

  const dataPath = path ? `/sites/${site.id}/heatmaps/data?path=${encodeURIComponent(path)}&device=${device}&type=${type}&days=${days}` : null;
  const { data, loading: dataLoading } = useApi<PointData | ScrollData>(dataPath);
  const current = data && data.type === type ? data : undefined;

  const filtered = useMemo(() => (pages ?? []).filter((p) => p.path.toLowerCase().includes(query.toLowerCase())), [pages, query]);

  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <PageHeader title="Heatmaps" subtitle="Where people click, move and how far they scroll.">
        <DaysPicker />
      </PageHeader>
      {!pages ? (
        <Spinner />
      ) : !pages.length ? (
        <div className="card">
          <Empty icon="heatmaps" title="No pages tracked yet">
            <p>Heatmaps appear here as soon as visitors load pages with the tracking code installed.</p>
            <Link className="btn btn-primary" to={`/sites/${site.id}/settings`}>
              Get the tracking code
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="heatmaps">
          <div className="card page-list">
            <div className="search">
              <input type="search" placeholder="Filter pages…" aria-label="Filter pages" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <ul>
              {filtered.map((p) => (
                <li key={p.path}>
                  <button type="button" className={p.path === path ? 'active' : ''} onClick={() => { setHighlight(null); set({ path: p.path }); }}>
                    <span className="path">{p.path}</span>
                    <span className="small muted">
                      {formatNumber(p.views)} views · {formatNumber(p.clicks)} clicks
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card heatmap-main">
            <div className="heatmap-toolbar">
              <Segmented
                label="Heatmap type"
                value={type}
                onChange={(v) => set({ type: v })}
                options={[
                  { value: 'click', label: 'Clicks', icon: 'click' },
                  { value: 'move', label: 'Moves', icon: 'move' },
                  { value: 'scroll', label: 'Scroll', icon: 'scroll' },
                ]}
              />
              <Segmented
                label="Device"
                value={device}
                onChange={(v) => set({ device: v })}
                options={(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => ({ value: d, label: '', icon: d, count: page?.devices[d].views ?? 0 }))}
              />
              <div className="legend" style={{ marginLeft: 'auto' }}>
                {current && (
                  <span>
                    {formatNumber(current.pageviews)} views
                    {current.type !== 'scroll' && ` · ${formatNumber(current.total)} ${current.type === 'click' ? 'clicks' : 'moves'}`}
                  </span>
                )}
                <span>Fewer</span>
                <span className="ramp" />
                <span>More</span>
              </div>
            </div>
            <div className="heatmap-body">
              {path && <HeatmapView siteId={site.id} path={path} device={device} type={type} data={current} highlight={highlight} />}
              <div className="heatmap-side">
                {dataLoading && !current ? (
                  <Spinner />
                ) : current?.type === 'click' ? (
                  <>
                    <h3 style={{ marginBottom: 8 }}>Most clicked elements</h3>
                    {!current.top.length && <p className="muted small">No clicks recorded on this page for this device.</p>}
                    {current.top.map((t, i) => (
                      <button
                        type="button"
                        key={t.selector}
                        className="top-el"
                        onMouseEnter={() => setHighlight(t.selector)}
                        onMouseLeave={() => setHighlight(null)}
                        onFocus={() => setHighlight(t.selector)}
                        onBlur={() => setHighlight(null)}
                      >
                        <span className="rank">{i + 1}</span>
                        <span className="truncate" style={{ flex: 1 }}>
                          <div>
                            <strong>{formatNumber(t.count)}</strong> <span className="muted small">({formatPercent(t.count / Math.max(1, current.total))})</span>
                            {t.rage > 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>{t.rage} rage</span>}
                          </div>
                          <div className="sel truncate" title={t.selector}>
                            {t.selector.split('>').slice(-2).join(' > ')}
                          </div>
                        </span>
                      </button>
                    ))}
                  </>
                ) : current?.type === 'scroll' ? (
                  <>
                    <h3 style={{ marginBottom: 8 }}>Scroll depth</h3>
                    <p className="muted small">Hover over the page to see how many visitors scrolled at least that far.</p>
                    <ScrollSummary data={current} />
                  </>
                ) : current?.type === 'move' ? (
                  <>
                    <h3 style={{ marginBottom: 8 }}>Mouse movement</h3>
                    <p className="muted small">Where visitors' cursors spent time — a rough proxy for attention on desktop.</p>
                  </>
                ) : null}
                {page && (
                  <p className="faint small" style={{ marginTop: 16 }}>
                    Snapshot {page.devices[device].snapshotAt ? `captured ${timeAgo(page.devices[device].snapshotAt!)}` : 'not captured yet'}.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ScrollSummary({ data }: { data: ScrollData }) {
  const reach = data.reach.map(([sy, dh]) => Math.min(1, sy / dh)).sort((a, b) => a - b);
  if (!reach.length) return <p className="muted small">No data.</p>;
  const avg = reach.reduce((s, r) => s + r, 0) / reach.length;
  return (
    <div className="barlist" style={{ marginTop: 10 }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <div className="barlist-row" key={f}>
          <div className="fill" style={{ width: formatPercent(reachAt(reach, f - 0.0001)) }} />
          <span>Reached {f * 100}% of page</span>
          <span className="value">{formatPercent(reachAt(reach, f - 0.0001))}</span>
        </div>
      ))}
      <div className="barlist-row">
        <span>Average depth</span>
        <span className="value">{formatPercent(avg)}</span>
      </div>
    </div>
  );
}
