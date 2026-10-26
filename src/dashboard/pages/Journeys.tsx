import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useApi, type Funnel, type FunnelResult, type FunnelStep, type HeatmapPage, type JourneysResponse, type NameCount } from '../api';
import { Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { DaysPicker, Empty, ErrorBox, PageHeader, Segmented, Spinner, Stat, useDays } from '../components/ui';
import { formatNumber, formatPercent } from '../format';

const EXIT = '(exit)';

function useParam(key: string): [string | null, (value: string | null, extra?: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams();
  const set = (value: string | null, extra: Record<string, string | null> = {}) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ [key]: value, ...extra })) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: false });
  };
  return [params.get(key), set];
}

export function JourneysPage() {
  const { site } = useSite();
  const [days] = useDays();
  const [tab, setTab] = useParam('tab');
  const current = tab === 'funnels' ? 'funnels' : 'paths';

  return (
    <>
      <PageHeader title="Journeys" subtitle="How visitors move through your site, and where they drop off.">
        <DaysPicker />
      </PageHeader>
      <div className="tabs page-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={current === 'paths'} className={current === 'paths' ? 'active' : ''} onClick={() => setTab(null, { funnel: null, edit: null })}>
          <Icon name="journeys" /> Paths
        </button>
        <button type="button" role="tab" aria-selected={current === 'funnels'} className={current === 'funnels' ? 'active' : ''} onClick={() => setTab('funnels', { path: null, from: null })}>
          <Icon name="funnel" /> Funnels
        </button>
      </div>
      {current === 'paths' ? <PathsView siteId={site.id} days={days} /> : <FunnelsView siteId={site.id} days={days} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Paths

function PathsView({ siteId, days }: { siteId: string; days: number }) {
  const [pathParam, setPathParam] = useParam('path');
  const [from, setFrom] = useParam('from');
  let prefix: string[] = [];
  try {
    prefix = pathParam ? JSON.parse(pathParam) : [];
  } catch {
    prefix = [];
  }
  const anywhere = from === 'any';
  const { data, error } = useApi<JourneysResponse>(
    `/sites/${siteId}/journeys?days=${days}&anchor=${anywhere ? 'any' : 'entry'}&prefix=${encodeURIComponent(JSON.stringify(prefix))}`,
  );
  const setPrefix = (next: string[]) => setPathParam(next.length ? JSON.stringify(next) : null);
  const recording = (id: string) => `/sites/${siteId}/recordings/${id}?days=${days}`;

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  if (!data.sessions) {
    return (
      <div className="card">
        <Empty icon="journeys" title="No visits in this period">
          <p>Paths appear once visitors move between pages.</p>
        </Empty>
      </div>
    );
  }

  const last = prefix[prefix.length - 1];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <h2>Path explorer</h2>
          <Segmented
            label="Start from"
            value={anywhere ? 'any' : 'entry'}
            onChange={(v) => setFrom(v === 'any' ? 'any' : null, { path: null })}
            options={[
              { value: 'entry', label: 'Start of visit' },
              { value: 'any', label: 'Any point in the visit' },
            ]}
          />
        </div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="crumbs">
            <button type="button" className={`crumb${prefix.length ? '' : ' current'}`} onClick={() => setPrefix([])}>
              {anywhere ? 'Any page' : 'Visit starts'}
            </button>
            {prefix.map((p, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                <span className="faint">›</span>
                <button type="button" className={`crumb${i === prefix.length - 1 ? ' current' : ''}`} onClick={() => setPrefix(prefix.slice(0, i + 1))}>
                  {p}
                </button>
              </span>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {prefix.length === 0
              ? anywhere
                ? 'Pick a page to see where visitors go after it, wherever it comes in their visit.'
                : `Where ${formatNumber(data.matching)} visits started. Click a page to follow visitors from there.`
              : `${formatNumber(data.matching)} visits went ${prefix.length > 1 ? 'this way' : `to ${last}`}. Next, they went to:`}
          </p>
          <div className="path-steps">
            {data.next.map((step) => {
              const share = data.matching ? step.count / data.matching : 0;
              const exit = step.path === EXIT;
              return (
                <div key={step.path} className={`path-step${exit ? ' exit' : ''}`}>
                  <div className="path-fill" style={{ width: formatPercent(share) }} />
                  {exit ? (
                    <span className="path-name">
                      <Icon name="exit" /> Left the site
                    </span>
                  ) : (
                    <button type="button" className="path-name" onClick={() => setPrefix([...prefix, step.path])} title="Follow visitors from this page">
                      {step.path}
                    </button>
                  )}
                  <span className="path-count">
                    {formatNumber(step.count)} · {formatPercent(share)}
                  </span>
                  {step.examples[0] ? (
                    <Link to={recording(step.examples[0])} className="btn btn-ghost btn-sm" title="Watch a visitor who went this way">
                      <Icon name="recordings" />
                    </Link>
                  ) : (
                    <span style={{ width: 28 }} />
                  )}
                </div>
              );
            })}
            {!data.next.length && <p className="muted small">No visits match this path.</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Most common paths</h2>
          <span className="small muted">First four pages of each visit</span>
        </div>
        <table className="table">
          <tbody>
            {data.topPaths.map((p, i) => (
              <tr key={i}>
                <td>
                  <div className="path-chain">
                    {p.steps.map((s, k) => (
                      <span key={k} className="row" style={{ gap: 6 }}>
                        {k > 0 && <span className="faint">→</span>}
                        <button type="button" className="crumb" onClick={() => setFrom(null, { path: JSON.stringify(p.steps.slice(0, k + 1)) })}>
                          {s}
                        </button>
                      </span>
                    ))}
                    {p.more && <span className="faint">→ …</span>}
                  </div>
                </td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {formatNumber(p.count)} · {formatPercent(p.count / data.sessions)}
                </td>
                <td style={{ width: 44 }}>
                  {p.examples[0] && (
                    <Link to={recording(p.examples[0])} className="btn btn-ghost btn-sm" title="Watch a visitor who took this path">
                      <Icon name="recordings" />
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Funnels

function FunnelsView({ siteId, days }: { siteId: string; days: number }) {
  const [funnelId, setFunnel] = useParam('funnel');
  const [edit, setEdit] = useParam('edit');
  const { data: funnels, error, reload } = useApi<Funnel[]>(`/sites/${siteId}/funnels?days=${days}`);

  if (edit) {
    const existing = funnels?.find((f) => f.id === edit);
    if (edit !== 'new' && !existing) return funnels ? <ErrorBox error="Funnel not found" /> : <Spinner />;
    return (
      <FunnelEditor
        siteId={siteId}
        funnel={existing}
        onDone={(id) => {
          reload();
          setEdit(null, { funnel: id });
        }}
        onCancel={() => setEdit(null)}
      />
    );
  }
  if (funnelId) {
    return (
      <FunnelDetail
        siteId={siteId}
        funnelId={funnelId}
        days={days}
        onBack={() => setFunnel(null)}
        onEdit={() => setEdit(funnelId)}
        onDeleted={() => {
          reload();
          setFunnel(null);
        }}
      />
    );
  }

  if (error) return <ErrorBox error={error} />;
  if (!funnels) return <Spinner />;
  if (!funnels.length) {
    return (
      <div className="card">
        <Empty icon="funnel" title="Create your first funnel">
          <p>
            A funnel is the path you want visitors to take, like home → pricing → sign-up. You'll see how many make it through each step, and can watch
            recordings of the people who dropped off.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" /> New funnel
          </button>
        </Empty>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>
          <Icon name="plus" /> New funnel
        </button>
      </div>
      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Funnel</th>
              <th className="num">Entered</th>
              <th className="num">Completed</th>
              <th className="num">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {funnels.map((f) => (
              <tr key={f.id} className="clickable" onClick={() => setFunnel(f.id)}>
                <td>
                  <strong>{f.name}</strong>
                  <div className="small muted">{f.steps.map(stepText).join(' → ')}</div>
                </td>
                <td className="num">{formatNumber(f.entered ?? 0)}</td>
                <td className="num">{formatNumber(f.converted ?? 0)}</td>
                <td className="num">{f.entered ? formatPercent((f.converted ?? 0) / f.entered, 1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stepText(step: FunnelStep): string {
  return step.type === 'event' ? `event “${step.value}”` : step.value;
}

function FunnelDetail({ siteId, funnelId, days, onBack, onEdit, onDeleted }: { siteId: string; funnelId: string; days: number; onBack: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { data, error } = useApi<{ funnel: Funnel; result: FunnelResult }>(`/funnels/${funnelId}?days=${days}`);
  const recording = (id: string) => `/sites/${siteId}/recordings/${id}?days=${days}`;

  const remove = async () => {
    if (!confirm('Delete this funnel?')) return;
    await api(`/funnels/${funnelId}`, { method: 'DELETE' });
    onDeleted();
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const { funnel, result } = data;
  const entered = result.steps[0]?.count ?? 0;
  const completed = result.steps[result.steps.length - 1]?.count ?? 0;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Back to funnels" onClick={onBack}>
            <Icon name="left" />
          </button>
          <h2 style={{ fontSize: 18 }}>{funnel.name}</h2>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={onEdit}>
            Edit steps
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Visits in this period" value={formatNumber(result.sessions)} />
        <Stat label="Entered the funnel" value={formatNumber(entered)} />
        <Stat label="Completed it" value={formatNumber(completed)} />
        <Stat label="Conversion" value={entered ? formatPercent(completed / entered, 1) : '—'} />
      </div>

      <div className="card">
        <div className="card-body funnel">
          {result.steps.map((step, k) => {
            const share = entered ? step.count / entered : 0;
            const previous = k > 0 ? result.steps[k - 1].count : 0;
            return (
              <div key={k}>
                {k > 0 && (
                  <div className="funnel-drop">
                    <span>
                      ↓ {previous ? formatPercent(step.count / previous) : '—'} continued
                      {step.dropped > 0 && (
                        <>
                          {' · '}
                          <strong className="danger-text">{formatNumber(step.dropped)} left</strong>
                        </>
                      )}
                    </span>
                    {step.droppedExamples.length > 0 && (
                      <span className="row small" style={{ gap: 6 }}>
                        Watch who left:
                        {step.droppedExamples.map((id, i) => (
                          <Link key={id} to={recording(id)}>
                            {i + 1}
                          </Link>
                        ))}
                      </span>
                    )}
                  </div>
                )}
                <div className="funnel-step">
                  <span className="funnel-num">{k + 1}</span>
                  <div className="funnel-bar-wrap">
                    <div className="row small" style={{ justifyContent: 'space-between' }}>
                      <span>
                        <span className="muted">{step.type === 'event' ? 'Event' : 'Page'}</span> <strong>{step.value}</strong>
                      </span>
                      <span>
                        {formatNumber(step.count)} · {formatPercent(share)}
                      </span>
                    </div>
                    <div className="funnel-bar">
                      <div style={{ width: formatPercent(share) }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {result.convertedExamples.length > 0 && (
            <p className="small muted" style={{ margin: '14px 0 0' }}>
              Watch visitors who completed it:{' '}
              {result.convertedExamples.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <Link to={recording(id)}>{i + 1}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FunnelEditor({ siteId, funnel, onDone, onCancel }: { siteId: string; funnel?: Funnel; onDone: (id: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(funnel?.name ?? '');
  const [steps, setSteps] = useState<FunnelStep[]>(funnel?.steps ?? [{ type: 'page', value: '/' }, { type: 'page', value: '' }]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const { data: pages } = useApi<HeatmapPage[]>(`/sites/${siteId}/heatmaps/pages?days=90`);
  const { data: events } = useApi<NameCount[]>(`/sites/${siteId}/tags`);

  useEffect(() => setError(undefined), [name, steps]);

  const setStep = (i: number, step: FunnelStep) => setSteps(steps.map((s, j) => (j === i ? step : s)));
  const move = (i: number, by: number) => {
    const list = [...steps];
    const [s] = list.splice(i, 1);
    list.splice(i + by, 0, s);
    setSteps(list);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { name, steps: steps.filter((s) => s.value.trim()) };
      const saved = funnel
        ? await api<Funnel>(`/funnels/${funnel.id}`, { method: 'PATCH', body })
        : await api<Funnel>(`/sites/${siteId}/funnels`, { method: 'POST', body });
      onDone(saved.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="card-header">
        <h2>{funnel ? 'Edit funnel' : 'New funnel'}</h2>
      </div>
      <div className="card-body form-grid">
        <div className="field">
          <label htmlFor="funnel-name">Name</label>
          <input id="funnel-name" type="text" placeholder="Sign-up" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <span className="label">Steps, in order</span>
          <div className="stack" style={{ gap: 8 }}>
            {steps.map((step, i) => (
              <div key={i} className="row funnel-edit-step">
                <span className="funnel-num">{i + 1}</span>
                <select aria-label="Step type" value={step.type} onChange={(e) => setStep(i, { type: e.target.value as FunnelStep['type'], value: '' })}>
                  <option value="page">Visits page</option>
                  <option value="event">Triggers event</option>
                </select>
                <input
                  type="text"
                  aria-label="Page or event"
                  list={step.type === 'page' ? 'funnel-pages' : 'funnel-events'}
                  placeholder={step.type === 'page' ? '/pricing' : 'signup_completed'}
                  value={step.value}
                  onChange={(e) => setStep(i, { ...step, value: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remove step" disabled={steps.length <= 2} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
          </div>
          {steps.length < 10 && (
            <button type="button" className="link-button small" style={{ alignSelf: 'flex-start' }} onClick={() => setSteps([...steps, { type: 'page', value: '' }])}>
              + Add step
            </button>
          )}
          <span className="hint">
            Page steps match the page's path; * matches anything (e.g. /blog/*). Event steps match names you send with <code>jarjar('event', name)</code>. A visit counts for a step
            only if it did the earlier steps first.
          </span>
          <datalist id="funnel-pages">
            {pages?.map((p) => (
              <option key={p.path} value={p.path} />
            ))}
          </datalist>
          <datalist id="funnel-events">
            {events?.map((e) => (
              <option key={e.name} value={e.name} />
            ))}
          </datalist>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save funnel'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
