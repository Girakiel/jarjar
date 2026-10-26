import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type PageStats } from '../api';
import { Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { DaysPicker, Empty, ErrorBox, PageHeader, Spinner, useDays } from '../components/ui';
import { formatDuration, formatNumber, formatPercent, RATING_EMOJI } from '../format';

type SortKey = 'path' | 'views' | 'visitors' | 'avgTime' | 'avgScroll' | 'bounceRate' | 'exitRate' | 'clicks' | 'issues' | 'rating';

const COLUMNS: Array<{ key: SortKey; label: string; title?: string; numeric?: boolean }> = [
  { key: 'path', label: 'Page' },
  { key: 'views', label: 'Views', numeric: true },
  { key: 'visitors', label: 'Visitors', numeric: true },
  { key: 'avgTime', label: 'Avg. time', title: 'Average time spent on the page', numeric: true },
  { key: 'avgScroll', label: 'Scroll', title: 'Average scroll depth', numeric: true },
  { key: 'bounceRate', label: 'Bounce', title: 'Visits that started here and left within 10 seconds without seeing another page', numeric: true },
  { key: 'exitRate', label: 'Exit', title: 'Share of views after which the visit ended', numeric: true },
  { key: 'clicks', label: 'Clicks', numeric: true },
  { key: 'issues', label: 'Issues', title: 'Rage clicks, dead clicks and JavaScript errors' },
  { key: 'rating', label: 'Rating', title: 'Average feedback rating', numeric: true },
];

const issueCount = (p: PageStats) => p.rageClicks + p.deadClicks + p.errors;

function sortValue(p: PageStats, key: SortKey): number | string | null {
  if (key === 'path') return p.path;
  if (key === 'issues') return issueCount(p);
  return p[key];
}

export function PagesPage() {
  const { site } = useSite();
  const [days] = useDays();
  const { data, error } = useApi<PageStats[]>(`/sites/${site.id}/pages?days=${days}`);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'views', desc: true });
  const search = `?days=${days}`;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data ?? []).filter((p) => !q || p.path.toLowerCase().includes(q) || p.title?.toLowerCase().includes(q));
    return list.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va === null) return 1; // pages without data always last
      if (vb === null) return -1;
      const order = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number);
      return sort.desc ? -order : order;
    });
  }, [data, query, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'path' }));
  const heatmapDevice = (p: PageStats) => (p.devices.includes('desktop') ? 'desktop' : p.devices[0]);

  return (
    <>
      <PageHeader title="Pages" subtitle={`Every page of ${site.name} that visitors saw, and how it performs.`}>
        <DaysPicker />
      </PageHeader>
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Spinner />
      ) : !data.length ? (
        <div className="card">
          <Empty icon="page" title="No page views in this period">
            <p>{site.lastSeenAt ? 'Try a longer date range.' : 'Pages appear here once the tracking code is installed and visitors arrive.'}</p>
          </Empty>
        </div>
      ) : (
        <div className="card">
          <div className="filters">
            <input type="search" placeholder="Find a page…" aria-label="Find a page" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 260 }} />
            <span className="small muted">
              {formatNumber(rows.length)} of {formatNumber(data.length)} pages
            </span>
          </div>
          <div className="table-scroll">
            <table className="table pages-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={c.numeric ? 'num' : ''} title={c.title} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                      <button type="button" className="sort" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort.key === c.key && <span aria-hidden="true">{sort.desc ? ' ↓' : ' ↑'}</span>}
                      </button>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.path}>
                    <td className="page-cell">
                      <div className="truncate" title={p.path}>
                        <strong>{p.path}</strong>
                      </div>
                      {p.title && (
                        <div className="small muted truncate" title={p.title}>
                          {p.title}
                        </div>
                      )}
                    </td>
                    <td className="num">{formatNumber(p.views)}</td>
                    <td className="num">{formatNumber(p.visitors)}</td>
                    <td className="num mono">{p.avgTime === null ? '—' : formatDuration(p.avgTime)}</td>
                    <td className="num">{p.avgScroll === null ? '—' : formatPercent(p.avgScroll)}</td>
                    <td className="num">{p.bounceRate === null ? '—' : formatPercent(p.bounceRate)}</td>
                    <td className="num">{formatPercent(p.exitRate)}</td>
                    <td className="num">{formatNumber(p.clicks)}</td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {p.rageClicks > 0 && (
                          <span className="badge badge-danger" title="Rage clicks">
                            <Icon name="rage" />
                            {p.rageClicks}
                          </span>
                        )}
                        {p.deadClicks > 0 && (
                          <span className="badge badge-warning" title="Dead clicks">
                            <Icon name="click" />
                            {p.deadClicks}
                          </span>
                        )}
                        {p.errors > 0 && (
                          <span className="badge badge-warning" title="JavaScript errors">
                            <Icon name="error" />
                            {p.errors}
                          </span>
                        )}
                        {!issueCount(p) && <span className="faint">—</span>}
                      </div>
                    </td>
                    <td className="num" title={p.ratings ? `${p.ratings} feedback response${p.ratings === 1 ? '' : 's'}` : undefined}>
                      {p.rating === null ? <span className="faint">—</span> : `${RATING_EMOJI[Math.round(p.rating)]} ${p.rating.toFixed(1)}`}
                    </td>
                    <td>
                      <div className="row page-actions">
                        <Link
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Heatmap"
                          aria-label={`Heatmap of ${p.path}`}
                          to={`/sites/${site.id}/heatmaps${search}&path=${encodeURIComponent(p.path)}${heatmapDevice(p) ? `&device=${heatmapDevice(p)}` : ''}`}
                        >
                          <Icon name="heatmaps" />
                        </Link>
                        <Link className="btn btn-ghost btn-sm btn-icon" title="Recordings that visited this page" aria-label={`Recordings of ${p.path}`} to={`/sites/${site.id}/recordings${search}&page=${encodeURIComponent(p.path)}`}>
                          <Icon name="recordings" />
                        </Link>
                        <Link
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Where visitors go from here"
                          aria-label={`Journeys from ${p.path}`}
                          to={`/sites/${site.id}/journeys${search}&from=any&path=${encodeURIComponent(JSON.stringify([p.path]))}`}
                        >
                          <Icon name="journeys" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
