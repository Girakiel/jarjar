import { Link } from 'react-router-dom';
import { useApi, type Overview } from '../api';
import { BarChart, fillDays } from '../components/BarChart';
import { Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { Snippet } from '../components/Snippet';
import { BarList, DaysPicker, ErrorBox, PageHeader, Spinner, Stat, useDays } from '../components/ui';
import { flag, formatDurationLong, formatNumber, formatPercent, RATING_EMOJI } from '../format';
import { TopInsights } from './Insights';

function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

export function InstallCard({ siteId }: { siteId: string }) {
  return (
    <div className="card">
      <div className="card-body stack">
        <div>
          <h2>Install the tracking code</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Paste this into the <code>&lt;head&gt;</code> of every page you want to track. Data shows up here within seconds.
          </p>
        </div>
        <Snippet siteId={siteId} />
        <div className="row small muted">
          <Icon name="external" />
          <span>
            Want to try it first? Use the <Link to={`/sites/${siteId}/test`}>test page</Link> and watch the results appear.
          </span>
        </div>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { site } = useSite();
  const [days] = useDays();
  const tz = new Date().getTimezoneOffset();
  const { data, error, loading } = useApi<Overview>(`/sites/${site.id}/overview?days=${days}&tz=${tz}`);

  const header = (
    <PageHeader title="Overview" subtitle={site.name}>
      <DaysPicker />
    </PageHeader>
  );

  if (error) return <>{header}<ErrorBox error={error} /></>;
  if (!data || loading) return <>{header}<Spinner /></>;

  const { totals, previous } = data;
  const search = `?days=${days}`;

  if (!site.lastSeenAt && totals.sessions === 0) {
    return (
      <>
        {header}
        <InstallCard siteId={site.id} />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="stack">
        <div className="stats">
          <Stat label="Sessions" value={formatNumber(totals.sessions)} delta={change(totals.sessions, previous.sessions)} />
          <Stat label="Visitors" value={formatNumber(totals.visitors)} delta={change(totals.visitors, previous.visitors)} />
          <Stat label="Page views" value={formatNumber(totals.pageviews)} delta={change(totals.pageviews, previous.pageviews)} />
          <Stat label="Avg. session" value={formatDurationLong(totals.avgDuration)} delta={change(totals.avgDuration, previous.avgDuration)} />
          <Stat label="Pages / session" value={totals.avgPages.toFixed(1)} />
          <Stat
            label="Rage-click sessions"
            value={totals.sessions ? formatPercent(totals.rageSessions / totals.sessions) : '—'}
          />
          <Stat
            label="Feedback"
            value={data.feedback.avg ? `${RATING_EMOJI[Math.round(data.feedback.avg)]} ${data.feedback.avg.toFixed(1)}` : '—'}
          />
        </div>

        <TopInsights siteId={site.id} days={days} />

        <div className="card">
          <div className="card-header">
            <h2>Sessions per day</h2>
            <Link to={`/sites/${site.id}/recordings${search}`} className="small">
              Watch recordings →
            </Link>
          </div>
          <div className="card-body">
            <BarChart label="Sessions per day" data={fillDays(data.daily.map((d) => ({ date: d.date, value: d.sessions })), data.days)} />
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-header">
              <h2>Top pages</h2>
              <span className="small muted">Avg. scroll depth</span>
            </div>
            {data.topPages.length ? (
              <table className="table">
                <tbody>
                  {data.topPages.map((p) => (
                    <tr key={p.path}>
                      <td className="truncate" style={{ maxWidth: 260 }}>
                        <Link to={`/sites/${site.id}/heatmaps${search}&path=${encodeURIComponent(p.path)}`} title="Open heatmap">
                          {p.path}
                        </Link>
                      </td>
                      <td className="num">{formatNumber(p.views)}</td>
                      <td className="num" style={{ width: 150, whiteSpace: 'nowrap' }}>
                        <span className="scrollbar">
                          <div style={{ width: formatPercent(p.avgScroll ?? 0) }} />
                        </span>
                        {p.avgScroll === null ? '—' : formatPercent(p.avgScroll)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="card-body muted">No page views yet</div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Referrers</h2>
            </div>
            <div className="card-body">
              <BarList items={data.referrers} />
            </div>
          </div>
        </div>

        <div className="grid grid-3">
          <div className="card">
            <div className="card-header">
              <h2>Devices</h2>
            </div>
            <div className="card-body">
              <BarList items={data.devices.map((d) => ({ ...d, label: d.name.charAt(0).toUpperCase() + d.name.slice(1) }))} total={totals.sessions} />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h2>Browsers</h2>
            </div>
            <div className="card-body">
              <BarList items={data.browsers} total={totals.sessions} />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h2>Operating systems</h2>
            </div>
            <div className="card-body">
              <BarList items={data.os} total={totals.sessions} />
            </div>
          </div>
          {data.countries.some((c) => c.name !== 'Unknown') && (
            <div className="card">
              <div className="card-header">
                <h2>Countries</h2>
              </div>
              <div className="card-body">
                <BarList items={data.countries.map((c) => ({ ...c, label: `${flag(c.name)} ${c.name}` }))} total={totals.sessions} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
