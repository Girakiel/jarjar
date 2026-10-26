import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import 'rrweb-player/dist/style.css';
import { api, useApi, type SessionDetail } from '../api';
import { DeviceIcon, Icon, type IconName } from '../components/Icon';
import { useSite } from '../components/Layout';
import { Empty, ErrorBox, PageHeader, Spinner, useDays } from '../components/ui';
import { flag, formatBytes, formatDateTime, formatDuration, pathOf, RATING_EMOJI } from '../format';
import { sessionLabel } from './Recordings';

type Kind = 'page' | 'click' | 'rage' | 'error' | 'event' | 'feedback';

interface TimelineItem {
  offset: number;
  kind: Kind;
  title: string;
  sub?: string;
}

const KIND_ICON: Record<Kind, IconName> = {
  page: 'page',
  click: 'click',
  rage: 'rage',
  error: 'error',
  event: 'tag',
  feedback: 'feedback',
};

// rrweb-player is a compiled Svelte component; its typings omit the Svelte runtime methods.
type PlayerInstance = rrwebPlayer & { $set(props: Record<string, unknown>): void; $destroy(): void };

const MARKER_COLORS = { 'rage-click': '#e5484d', 'dead-click': '#d97b06', error: '#f76b15', event: '#d97b06', feedback: '#2b9a66', 'survey-response': '#2b9a66' };

interface RawEvent {
  type: number;
  timestamp: number;
  data: { href?: string; source?: number; type?: number; tag?: string; payload?: Record<string, unknown> };
}

/** Turns rrweb events into a human-readable list of what happened. */
function buildTimeline(events: RawEvent[]): TimelineItem[] {
  if (!events.length) return [];
  const start = events[0].timestamp;
  const items: TimelineItem[] = [];
  let lastHref = '';
  for (const e of events) {
    const offset = e.timestamp - start;
    if (e.type === 4 && e.data.href && e.data.href !== lastHref) {
      lastHref = e.data.href;
      items.push({ offset, kind: 'page', title: 'Viewed page', sub: pathOf(e.data.href) });
    } else if (e.type === 3 && e.data.source === 2 && e.data.type === 2) {
      items.push({ offset, kind: 'click', title: 'Click' });
    } else if (e.type === 5) {
      const payload = e.data.payload ?? {};
      if (e.data.tag === 'rage-click') items.push({ offset, kind: 'rage', title: 'Rage click', sub: String(payload.selector ?? '') });
      else if (e.data.tag === 'dead-click') items.push({ offset, kind: 'rage', title: 'Dead click', sub: String(payload.label ?? payload.selector ?? '') });
      else if (e.data.tag === 'error') items.push({ offset, kind: 'error', title: 'JavaScript error', sub: String(payload.message ?? '') });
      else if (e.data.tag === 'event') items.push({ offset, kind: 'event', title: String(payload.name ?? 'Event'), sub: 'Custom event' });
      else if (e.data.tag === 'feedback') items.push({ offset, kind: 'feedback', title: 'Left feedback', sub: RATING_EMOJI[Number(payload.rating)] ?? '' });
      else if (e.data.tag === 'survey') items.push({ offset, kind: 'event', title: 'Saw a survey' });
      else if (e.data.tag === 'survey-response') {
        items.push({ offset, kind: 'feedback', title: payload.completed === false ? 'Answered part of a survey' : 'Answered a survey' });
      }
    }
  }
  return items;
}

/** Collapses runs of plain clicks so the list stays readable. */
function collapseClicks(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (item.kind === 'click' && prev?.kind === 'click' && item.offset - prev.offset < 3000) {
      const n = Number(prev.title.match(/^(\d+)/)?.[1] ?? 1) + 1;
      prev.title = `${n} clicks`;
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

function indexAt(items: TimelineItem[], time: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].offset <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function Player({
  events,
  onTime,
  playerRef,
  startAt,
}: {
  events: eventWithTime[];
  onTime: (t: number) => void;
  playerRef: React.MutableRefObject<rrwebPlayer | null>;
  startAt?: number; // ms from the start of the recording
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const size = () => ({ width: wrap.clientWidth, height: Math.max(200, wrap.clientHeight - 80) });
    const player = new rrwebPlayer({
      target: wrap,
      props: {
        events,
        ...size(),
        autoPlay: true,
        skipInactive: true,
        speedOption: [1, 2, 4, 8],
        showWarning: false,
        mouseTail: { strokeStyle: 'rgba(139, 116, 255, 0.7)', lineWidth: 2 },
        UNSAFE_replayCanvas: false,
        tags: MARKER_COLORS,
        inactiveColor: 'rgba(110, 86, 207, 0.25)',
      },
    }) as PlayerInstance;
    playerRef.current = player;
    if (startAt) player.goto(startAt, true);
    player.addEventListener('ui-update-current-time', (detail) => onTimeRef.current((detail as { payload: number }).payload));

    const observer = new ResizeObserver(() => {
      player.$set(size());
      player.triggerResize();
    });
    observer.observe(wrap);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) {
        e.preventDefault();
        player.toggle();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      observer.disconnect();
      playerRef.current = null;
      player.getReplayer().destroy();
      player.$destroy();
    };
  }, [events, playerRef]);

  return <div className="player-wrap" ref={wrapRef} />;
}

export function ReplayPage() {
  const { site } = useSite();
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [days] = useDays();
  // ?at=<client timestamp> opens the recording just before that moment (e.g. from a feedback item).
  const [params] = useSearchParams();
  const at = Number(params.get('at')) || 0;
  const { data: detail, error } = useApi<SessionDetail>(`/sessions/${sessionId}`);
  const [events, setEvents] = useState<eventWithTime[]>();
  const [eventsError, setEventsError] = useState<string>();
  const [tab, setTab] = useState<'timeline' | 'details'>('timeline');
  const [current, setCurrent] = useState(-1);
  const playerRef = useRef<rrwebPlayer | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const search = `?days=${days}`;

  useEffect(() => {
    setEvents(undefined);
    setEventsError(undefined);
    api<eventWithTime[]>(`/sessions/${sessionId}/events`)
      .then((list) => setEvents([...list].sort((a, b) => a.timestamp - b.timestamp)))
      .catch((err) => setEventsError(err.message));
  }, [sessionId]);

  const timeline = useMemo(() => collapseClicks(buildTimeline((events ?? []) as unknown as RawEvent[])), [events]);
  const hasSnapshot = events?.some((e) => e.type === 2);
  const startAt = at && events?.length ? Math.max(0, at - events[0].timestamp - 3000) : undefined;

  const onTime = (t: number) => {
    const i = indexAt(timeline, t);
    setCurrent((prev) => (prev === i ? prev : i));
  };

  useEffect(() => {
    if (current < 0) return;
    listRef.current?.querySelector(`[data-i="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const remove = async () => {
    if (!confirm('Delete this recording? This cannot be undone.')) return;
    await api(`/sessions/${sessionId}`, { method: 'DELETE' });
    navigate(`/sites/${site.id}/recordings${search}`);
  };

  if (error) return <ErrorBox error={error} />;
  if (!detail) return <Spinner />;
  const s = detail.session;

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            <Link to={`/sites/${site.id}/recordings${search}`} className="btn btn-ghost btn-sm btn-icon" aria-label="Back to recordings">
              <Icon name="left" />
            </Link>
            {flag(s.country)} {sessionLabel(s)}
          </span>
        }
        subtitle={`${formatDateTime(s.startedAt)} · ${formatDuration(s.duration)} · ${s.pageCount} page${s.pageCount === 1 ? '' : 's'}`}
      >
        <button type="button" className="btn btn-sm" disabled={!detail.newer} onClick={() => navigate(`/sites/${site.id}/recordings/${detail.newer}${search}`)}>
          <Icon name="left" /> Newer
        </button>
        <button type="button" className="btn btn-sm" disabled={!detail.older} onClick={() => navigate(`/sites/${site.id}/recordings/${detail.older}${search}`)}>
          Older <Icon name="right" />
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          <Icon name="trash" /> Delete
        </button>
      </PageHeader>

      <div className="replay">
        {eventsError ? (
          <ErrorBox error={eventsError} />
        ) : !events ? (
          <div className="player-wrap center">
            <div className="spinner" />
          </div>
        ) : !hasSnapshot ? (
          <div className="card">
            <Empty icon="error" title="This recording can't be played">
              <p>The start of the recording never reached the server (for example, the visitor left within a second).</p>
            </Empty>
          </div>
        ) : (
          <Player events={events} onTime={onTime} playerRef={playerRef} startAt={startAt} />
        )}

        <div className="card replay-side">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>
              Timeline
            </button>
            <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>
              Details
            </button>
          </div>
          {tab === 'timeline' ? (
            <div className="timeline" ref={listRef}>
              {!timeline.length && <div className="muted small" style={{ padding: 12 }}>{events ? 'Nothing notable happened.' : 'Loading…'}</div>}
              {timeline.map((item, i) => (
                <button
                  type="button"
                  key={i}
                  data-i={i}
                  className={`timeline-item ${i === current ? 'current' : i < current ? 'past' : ''}`}
                  onClick={() => playerRef.current?.goto(Math.max(0, item.offset - 500), true)}
                >
                  <span className={`t-icon ${item.kind}`}>
                    <Icon name={KIND_ICON[item.kind]} />
                  </span>
                  <span className="t-body">
                    <div className="t-title">{item.title}</div>
                    {item.sub && <div className="t-sub" title={item.sub}>{item.sub}</div>}
                  </span>
                  <span className="t-time">{formatDuration(item.offset)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="details stack">
              <dl>
                <dt>User</dt>
                <dd>{s.userId ?? <span className="muted">Anonymous</span>}</dd>
                {s.userAttrs &&
                  Object.entries(s.userAttrs).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt className="truncate">{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                <dt>Visitor</dt>
                <dd className="mono small">{s.visitorId}</dd>
                <dt>Device</dt>
                <dd className="row">
                  <DeviceIcon device={s.device} /> {s.device}
                </dd>
                <dt>Browser</dt>
                <dd>{s.browser}</dd>
                <dt>OS</dt>
                <dd>{s.os}</dd>
                <dt>Screen</dt>
                <dd>{s.screen ?? '—'}</dd>
                <dt>Language</dt>
                <dd>{s.language ?? '—'}</dd>
                {s.country && (
                  <>
                    <dt>Country</dt>
                    <dd>
                      {flag(s.country)} {s.country}
                    </dd>
                  </>
                )}
                <dt>Referrer</dt>
                <dd>{s.referrer ? <a href={s.referrer} target="_blank" rel="noreferrer noopener">{s.referrer}</a> : <span className="muted">Direct</span>}</dd>
                <dt>Clicks</dt>
                <dd>
                  {s.clickCount}
                  {s.rageClicks > 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>{s.rageClicks} rage</span>}
                </dd>
                <dt>JS errors</dt>
                <dd>{s.errorCount}</dd>
                {s.tags.length > 0 && (
                  <>
                    <dt>Events</dt>
                    <dd className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {s.tags.map((t) => (
                        <span key={t} className="badge badge-accent">{t}</span>
                      ))}
                    </dd>
                  </>
                )}
                <dt>Size</dt>
                <dd>{formatBytes(s.recordingBytes)}</dd>
              </dl>
              <div>
                <h3 style={{ marginBottom: 8 }}>Pages</h3>
                <div className="barlist">
                  {detail.pageviews.map((p) => (
                    <div key={p.id} className="barlist-row" title={p.url}>
                      <span className="truncate">{p.path}</span>
                      <span className="value">{p.docH ? `${Math.round(Math.min(1, p.maxScroll / p.docH) * 100)}% scrolled` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
              {detail.feedback.length > 0 && (
                <div>
                  <h3 style={{ marginBottom: 8 }}>Feedback</h3>
                  {detail.feedback.map((f, i) => (
                    <p key={i} style={{ margin: '0 0 6px' }}>
                      {RATING_EMOJI[f.rating]} {f.comment ?? <span className="muted">No comment</span>}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
