import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useApi, type HeatmapPage, type Session, type SessionDetail, type Site, type Survey } from '../api';
import { Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { PageHeader, Segmented } from '../components/ui';
import { formatDuration } from '../format';

// Must match the tag public/demo.html adds to its visits, and TEST_TAG on the server.
const TEST_TAG = 'jarjar_test';
const POLL_MS = 3000;
const SIZES = { desktop: 1280, mobile: 390 } as const;
type PreviewDevice = keyof typeof SIZES;

interface Results {
  session: Session | null;
  detail: SessionDetail | null;
  snapshotAt: number | null;
}

function useFrameSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function TestPage() {
  const { site, reloadSites } = useSite();
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [frameKey, setFrameKey] = useState(0);
  const [results, setResults] = useState<Results>({ session: null, detail: null, snapshotAt: null });
  const [busy, setBusy] = useState(false);
  // Sessions from before "Start a new test" stay hidden.
  const ignored = useRef(new Set<string>());
  const stageRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stage = useFrameSize(stageRef);
  // ?survey=ID previews that survey in the shop (from the survey editor).
  const [params, setParams] = useSearchParams();
  const previewId = params.get('survey');
  const { data: previewSurvey } = useApi<Survey>(previewId ? `/surveys/${previewId}` : null);
  const stopPreview = () => {
    const next = new URLSearchParams(params);
    next.delete('survey');
    setParams(next, { replace: true });
  };

  const poll = useCallback(async () => {
    const [list, pages] = await Promise.all([
      api<{ sessions: Session[] }>(`/sites/${site.id}/sessions?tag=${TEST_TAG}&days=1&limit=5`),
      api<HeatmapPage[]>(`/sites/${site.id}/heatmaps/pages?days=1`),
    ]);
    const session = list.sessions.find((s) => !ignored.current.has(s.id)) ?? null;
    const detail = session ? await api<SessionDetail>(`/sessions/${session.id}`) : null;
    const demo = pages.find((p) => p.path === '/demo');
    setResults({ session, detail, snapshotAt: demo?.devices[device === 'desktop' ? 'desktop' : 'mobile'].snapshotAt ?? null });
  }, [site.id, device]);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped && document.visibilityState === 'visible') poll().catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [poll]);

  /** Forgets the test visitor's session so the reloaded page starts a fresh recording. */
  const restart = () => {
    if (results.session) ignored.current.add(results.session.id);
    try {
      iframeRef.current?.contentWindow?.sessionStorage.removeItem('_jj_s');
    } catch {
      /* ignore */
    }
    setResults({ session: null, detail: null, snapshotAt: null });
    setFrameKey((k) => k + 1);
  };

  const deleteTestData = async () => {
    if (!confirm('Delete all recordings made on the test page?')) return;
    setBusy(true);
    try {
      await api(`/sites/${site.id}/test-data`, { method: 'DELETE' });
      restart();
    } finally {
      setBusy(false);
    }
  };

  const updateSite = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api<Site>(`/sites/${site.id}`, { method: 'PATCH', body });
      reloadSites();
      // The tracker caches its config for a minute; a new session picks the change up now.
      restart();
    } finally {
      setBusy(false);
    }
  };

  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const blockedByDnt = site.respectDnt && (nav.doNotTrack === '1' || nav.globalPrivacyControl === true);

  const width = SIZES[device];
  const scale = stage.width ? Math.min(1, (stage.width - 24) / width) : 1;
  const frameHeight = stage.height ? Math.floor((stage.height - 24) / scale) : 600;

  const { session, detail, snapshotAt } = results;
  const scroll = detail?.pageviews.reduce((best, p) => Math.max(best, p.docH ? Math.min(1, p.maxScroll / p.docH) : 0), 0) ?? 0;
  const events = session?.tags.filter((t) => t !== TEST_TAG) ?? [];
  const feedbackCount = detail?.feedback.length ?? 0;

  const checks: Array<{ label: string; done: boolean; text: React.ReactNode }> = [
    {
      label: 'Session recording',
      done: !!session,
      text: session ? `${formatDuration(session.duration)} recorded so far` : 'Starts a second after the page loads',
    },
    { label: 'Clicks', done: !!session?.clickCount, text: session?.clickCount ? `${session.clickCount} clicks` : 'Click any button or link' },
    {
      label: 'Rage click',
      done: !!session?.rageClicks,
      text: session?.rageClicks ? `${session.rageClicks} detected` : 'Click “Watch the video” 3+ times quickly',
    },
    {
      label: 'JavaScript error',
      done: !!session?.errorCount,
      text: session?.errorCount ? `${session.errorCount} captured` : 'The same button throws an error on purpose',
    },
    { label: 'Scroll depth', done: scroll >= 0.9, text: scroll ? `${Math.round(scroll * 100)}% of the page` : 'Scroll to the bottom' },
    { label: 'Custom events', done: events.length > 0, text: events.length ? events.join(', ') : 'Choose a subscription plan' },
    {
      label: 'Feedback',
      done: feedbackCount > 0,
      text: feedbackCount ? (
        `${feedbackCount} response${feedbackCount === 1 ? '' : 's'}`
      ) : site.feedback.enabled ? (
        `Use the “${site.feedback.texts.tab}” tab on the ${site.feedback.position} edge`
      ) : (
        <>
          The widget is off.{' '}
          <button type="button" className="link-button" disabled={busy} onClick={() => updateSite({ feedback: { enabled: true } })}>
            Turn it on
          </button>
        </>
      ),
    },
    { label: 'Heatmap snapshot', done: !!snapshotAt, text: snapshotAt ? 'Captured' : 'Taken automatically when the page loads' },
  ];

  return (
    <div className="test-page">
      <PageHeader title="Test page" subtitle="Use the demo shop like a visitor would. jarjar records it exactly as it would on your site.">
        <Segmented
          label="Preview size"
          value={device}
          onChange={(v) => setDevice(v)}
          options={[
            { value: 'desktop', label: 'Desktop', icon: 'desktop' },
            { value: 'mobile', label: 'Mobile', icon: 'mobile' },
          ]}
        />
        <button type="button" className="btn btn-sm" onClick={restart}>
          Start a new test
        </button>
      </PageHeader>

      {blockedByDnt && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="error" />
          <div style={{ flex: 1 }}>
            Your browser sends “Do Not Track”, and this site respects it, so nothing will be recorded.{' '}
            <button type="button" className="link-button" disabled={busy} onClick={() => updateSite({ respectDnt: false })}>
              Stop respecting it for this site
            </button>
          </div>
        </div>
      )}

      {previewId && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="survey" />
          <div style={{ flex: 1 }}>
            Previewing the survey <strong>{previewSurvey?.name ?? '…'}</strong>. It appears in the shop in a moment, even if it's switched off. Answers are
            saved as test data.{' '}
            <Link to={`/sites/${site.id}/surveys/${previewId}`}>See its results</Link>
          </div>
          <button type="button" className="btn btn-sm" onClick={stopPreview}>
            Stop preview
          </button>
        </div>
      )}

      <div className="test-layout">
        <div className="card test-stage" ref={stageRef}>
          <div className="test-frame" style={{ width: width * scale, height: frameHeight * scale }}>
            <iframe
              key={`${frameKey}-${device}-${previewId ?? ''}`}
              ref={iframeRef}
              title="Demo shop"
              src={`/demo?site=${site.id}${previewId ? `&jj_survey=${previewId}` : ''}`}
              style={{ width, height: frameHeight, transform: `scale(${scale})` }}
            />
          </div>
        </div>

        <div className="card test-results">
          <div className="card-header">
            <h2>What jarjar captured</h2>
            {session?.live && (
              <span className="badge badge-success">
                <span className="live-dot" /> Live
              </span>
            )}
          </div>
          <ul className="checklist">
            {checks.map((c) => (
              <li key={c.label} className={c.done ? 'done' : ''}>
                <span className="check-mark">{c.done ? <Icon name="check" /> : null}</span>
                <span>
                  <strong>{c.label}</strong>
                  <span className="small muted">{c.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="test-actions">
            <p className="small muted" style={{ margin: 0 }}>
              Data arrives every few seconds. Open the results to see them like you will for real visitors:
            </p>
            {session ? (
              <Link className="btn btn-primary" to={`/sites/${site.id}/recordings/${session.id}`}>
                <Icon name="recordings" /> Watch the recording
              </Link>
            ) : (
              <button type="button" className="btn btn-primary" disabled>
                <Icon name="recordings" /> Watch the recording
              </button>
            )}
            <Link className="btn" to={`/sites/${site.id}/heatmaps?path=${encodeURIComponent('/demo')}&device=${device}&days=1`}>
              <Icon name="heatmaps" /> Open the heatmap
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={deleteTestData}>
              <Icon name="trash" /> Delete test data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
