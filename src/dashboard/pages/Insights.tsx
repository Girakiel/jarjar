import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi, type Insight, type InsightsResponse, type InsightType } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { useSite } from '../components/Layout';
import { DaysPicker, Empty, ErrorBox, PageHeader, Spinner, Stat, useDays } from '../components/ui';
import { formatNumber, formatPercent } from '../format';

const TYPE_ICON: Record<InsightType, IconName> = {
  rage: 'rage',
  dead: 'click',
  error: 'error',
  form: 'page',
  unseen: 'scroll',
  shallow: 'scroll',
  bounce: 'exit',
  exit: 'exit',
  rating: 'feedback',
  funnel: 'funnel',
};

const TYPE_LABEL: Record<InsightType, string> = {
  rage: 'Rage clicks',
  dead: 'Dead clicks',
  error: 'JavaScript error',
  form: 'Form drop-off',
  unseen: 'Unseen content',
  shallow: 'Scroll depth',
  bounce: 'Bounces',
  exit: 'Exit page',
  rating: 'Low ratings',
  funnel: 'Funnel drop-off',
};

const SEVERITY_LABEL = { high: 'High impact', medium: 'Medium', low: 'Low' };

const CHECKS = [
  'Rage clicks: elements people click over and over',
  "Dead clicks: things people click that don't do anything",
  'JavaScript errors visitors run into',
  'Forms people start but don’t send, and where they stop',
  'Content most visitors never scroll to',
  'Pages people bounce from or leave the site on',
  'Pages with low feedback ratings',
  'The biggest drop-off in each funnel',
];

function InsightCard({ insight, siteId, search, onDismiss }: { insight: Insight; siteId: string; search: string; onDismiss: (insight: Insight) => void }) {
  const recording = (id: string) => `/sites/${siteId}/recordings/${id}${search}`;
  return (
    <div className={`card insight severity-${insight.severity}${insight.dismissed ? ' dismissed' : ''}`}>
      <div className="insight-head">
        <span className={`insight-icon ${insight.type}`}>
          <Icon name={TYPE_ICON[insight.type]} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className={`badge sev-${insight.severity}`}>{SEVERITY_LABEL[insight.severity]}</span>
            <span className="muted">{TYPE_LABEL[insight.type]}</span>
            <span className="faint">·</span>
            <span className="muted">
              {formatNumber(insight.sessions)} visit{insight.sessions === 1 ? '' : 's'} affected
              {insight.share !== null && insight.share < 1 && ` (${formatPercent(insight.share)})`}
            </span>
          </div>
          <h3 className="insight-title">{insight.title}</h3>
          <p className="insight-detail">{insight.detail}</p>
        </div>
      </div>
      {!!insight.quotes?.length && (
        <div className="insight-quotes">
          {insight.quotes.map((q, i) => (
            <blockquote key={i}>“{q}”</blockquote>
          ))}
        </div>
      )}
      <div className="insight-fix">
        <strong>How to fix it:</strong> {insight.fix}
      </div>
      <div className="insight-actions">
        {insight.examples.length > 0 && (
          <>
            <Link className="btn btn-sm btn-primary" to={recording(insight.examples[0])}>
              <Icon name="recordings" /> Watch a recording
            </Link>
            {insight.examples.length > 1 && (
              <span className="small muted row" style={{ gap: 6 }}>
                more:
                {insight.examples.slice(1).map((id, i) => (
                  <Link key={id} to={recording(id)}>
                    {i + 2}
                  </Link>
                ))}
              </span>
            )}
          </>
        )}
        {insight.heatmap && insight.path && (
          <Link
            className="btn btn-sm"
            to={`/sites/${siteId}/heatmaps${search}&path=${encodeURIComponent(insight.path)}&device=${insight.heatmap.device}&type=${insight.heatmap.type}`}
          >
            <Icon name="heatmaps" /> Open heatmap
          </Link>
        )}
        {insight.funnelId && (
          <Link className="btn btn-sm" to={`/sites/${siteId}/journeys${search}&tab=funnels&funnel=${insight.funnelId}`}>
            <Icon name="funnel" /> Open funnel
          </Link>
        )}
        <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => onDismiss(insight)}>
          {insight.dismissed ? 'Restore' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}

export function InsightsPage() {
  const { site } = useSite();
  const [days] = useDays();
  const { data, error, reload } = useApi<InsightsResponse>(`/sites/${site.id}/insights?days=${days}`);
  const [showDismissed, setShowDismissed] = useState(false);
  const search = `?days=${days}`;

  const toggleDismiss = async (insight: Insight) => {
    if (insight.dismissed) await api(`/sites/${site.id}/insights/dismiss?key=${encodeURIComponent(insight.key)}`, { method: 'DELETE' });
    else await api(`/sites/${site.id}/insights/dismiss`, { method: 'POST', body: { key: insight.key } });
    reload();
  };

  const header = (
    <PageHeader title="Insights" subtitle="Problems found across all visits, most important first, with how to fix them.">
      <DaysPicker />
    </PageHeader>
  );
  if (error) return <>{header}<ErrorBox error={error} /></>;
  if (!data) return <>{header}<Spinner /></>;

  const { summary } = data;
  const open = data.insights.filter((i) => !i.dismissed);
  const dismissed = data.insights.filter((i) => i.dismissed);

  return (
    <>
      {header}
      <div className="stack">
        <div className="stats">
          <Stat label="Visits" value={formatNumber(summary.sessions)} />
          <Stat
            label="Visits with frustration"
            value={summary.sessions ? `${formatNumber(summary.frustrated)} · ${formatPercent(summary.frustrated / summary.sessions)}` : '—'}
          />
          <Stat label="Rage clicks" value={formatNumber(summary.rageClicks)} />
          <Stat label="Dead clicks" value={formatNumber(summary.deadClicks)} />
          <Stat label="Visits with JS errors" value={formatNumber(summary.errorSessions)} />
          <Stat label="Forms abandoned" value={summary.formsStarted ? `${formatNumber(summary.formsAbandoned)} of ${formatNumber(summary.formsStarted)}` : '—'} />
        </div>

        {open.length === 0 ? (
          <div className="card">
            <Empty icon="insights" title={summary.sessions ? 'No problems found in this period' : 'No visits in this period yet'}>
              <p>jarjar checks every visit for:</p>
              <ul className="check-list">
                {CHECKS.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Empty>
          </div>
        ) : (
          open.map((insight) => <InsightCard key={insight.key} insight={insight} siteId={site.id} search={search} onDismiss={toggleDismiss} />)
        )}

        {dismissed.length > 0 && (
          <div>
            <button type="button" className="link-button small" onClick={() => setShowDismissed((v) => !v)}>
              {showDismissed ? 'Hide' : 'Show'} {dismissed.length} dismissed
            </button>
            {showDismissed && (
              <div className="stack" style={{ marginTop: 12 }}>
                {dismissed.map((insight) => (
                  <InsightCard key={insight.key} insight={insight} siteId={site.id} search={search} onDismiss={toggleDismiss} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** The top few open problems, for the Overview page. */
export function TopInsights({ siteId, days }: { siteId: string; days: number }) {
  const { data } = useApi<InsightsResponse>(`/sites/${siteId}/insights?days=${days}`);
  const top = data?.insights.filter((i) => !i.dismissed).slice(0, 3) ?? [];
  if (!top.length) return null;
  return (
    <div className="card">
      <div className="card-header">
        <h2>Top issues to fix</h2>
        <Link to={`/sites/${siteId}/insights?days=${days}`} className="small">
          All insights →
        </Link>
      </div>
      <div className="top-insights">
        {top.map((insight) => (
          <Link key={insight.key} to={`/sites/${siteId}/insights?days=${days}`} className="top-insight">
            <span className={`insight-icon ${insight.type}`}>
              <Icon name={TYPE_ICON[insight.type]} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="truncate" style={{ display: 'block' }}>{insight.title}</span>
              <span className="small muted">
                {formatNumber(insight.sessions)} visit{insight.sessions === 1 ? '' : 's'} affected
              </span>
            </span>
            <span className={`badge sev-${insight.severity}`}>{SEVERITY_LABEL[insight.severity]}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
