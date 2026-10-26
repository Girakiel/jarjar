import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, useApi, type NameCount, type Session } from '../api';
import { DeviceIcon, Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { DaysPicker, Empty, ErrorBox, PageHeader, Segmented, Spinner, useDays } from '../components/ui';
import { flag, formatDateTime, formatDuration, pathOf, timeAgo } from '../format';

const PAGE_SIZE = 50;

export function sessionLabel(s: Pick<Session, 'userId' | 'visitorId'>): string {
  return s.userId ?? `Visitor ${s.visitorId.slice(0, 8)}`;
}

export function RecordingsPage() {
  const { site } = useSite();
  const [days] = useDays();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [extra, setExtra] = useState<Session[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const filter = (key: string) => params.get(key) ?? '';
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const query = new URLSearchParams({ days: String(days), limit: String(PAGE_SIZE) });
  for (const key of ['device', 'minDuration', 'rage', 'dead', 'errors', 'unviewed', 'page', 'tag', 'user', 'sort']) {
    if (filter(key)) query.set(key, filter(key));
  }
  const queryString = query.toString();
  const { data, error, loading } = useApi<{ total: number; sessions: Session[] }>(`/sites/${site.id}/sessions?${queryString}`);
  const { data: tags } = useApi<NameCount[]>(`/sites/${site.id}/tags`);

  // Debounced text filters.
  const [pageInput, setPageInput] = useState(filter('page'));
  const [userInput, setUserInput] = useState(filter('user'));
  useEffect(() => {
    const t = setTimeout(() => {
      if (pageInput !== filter('page')) setFilter('page', pageInput);
      if (userInput !== filter('user')) setFilter('user', userInput);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageInput, userInput]);

  useEffect(() => setExtra([]), [queryString]);

  const sessions = [...(data?.sessions ?? []), ...extra];
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await api<{ sessions: Session[] }>(`/sites/${site.id}/sessions?${queryString}&offset=${sessions.length}`);
      setExtra((e) => [...e, ...next.sessions]);
    } finally {
      setLoadingMore(false);
    }
  };

  const search = `?days=${days}`;

  return (
    <>
      <PageHeader title="Recordings" subtitle={data ? `${data.total.toLocaleString()} sessions` : ' '}>
        <DaysPicker />
      </PageHeader>
      <div className="card">
        <div className="filters">
          <Segmented
            label="Device"
            value={filter('device') || 'all'}
            onChange={(v) => setFilter('device', v === 'all' ? '' : v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'desktop', label: '', icon: 'desktop' },
              { value: 'tablet', label: '', icon: 'tablet' },
              { value: 'mobile', label: '', icon: 'mobile' },
            ]}
          />
          <select aria-label="Minimum duration" value={filter('minDuration')} onChange={(e) => setFilter('minDuration', e.target.value)}>
            <option value="">Any duration</option>
            <option value="10">≥ 10 s</option>
            <option value="30">≥ 30 s</option>
            <option value="60">≥ 1 min</option>
            <option value="180">≥ 3 min</option>
          </select>
          <input type="search" placeholder="Visited page…" aria-label="Visited page" value={pageInput} onChange={(e) => setPageInput(e.target.value)} />
          <input type="search" placeholder="User or visitor id…" aria-label="User id" value={userInput} onChange={(e) => setUserInput(e.target.value)} />
          {!!tags?.length && (
            <select aria-label="Event" value={filter('tag')} onChange={(e) => setFilter('tag', e.target.value)}>
              <option value="">Any event</option>
              {tags.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.count})
                </option>
              ))}
            </select>
          )}
          <label className="check">
            <input type="checkbox" checked={filter('rage') === '1'} onChange={(e) => setFilter('rage', e.target.checked ? '1' : '')} />
            Rage clicks
          </label>
          <label className="check">
            <input type="checkbox" checked={filter('dead') === '1'} onChange={(e) => setFilter('dead', e.target.checked ? '1' : '')} />
            Dead clicks
          </label>
          <label className="check">
            <input type="checkbox" checked={filter('errors') === '1'} onChange={(e) => setFilter('errors', e.target.checked ? '1' : '')} />
            JS errors
          </label>
          <label className="check">
            <input type="checkbox" checked={filter('unviewed') === '1'} onChange={(e) => setFilter('unviewed', e.target.checked ? '1' : '')} />
            Not watched
          </label>
          <select aria-label="Sort" value={filter('sort')} onChange={(e) => setFilter('sort', e.target.value)} style={{ marginLeft: 'auto' }}>
            <option value="">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="longest">Longest</option>
            <option value="pages">Most pages</option>
            <option value="frustration">Most frustrated</option>
          </select>
        </div>

        {error ? (
          <div className="card-body">
            <ErrorBox error={error} />
          </div>
        ) : loading && !data ? (
          <Spinner />
        ) : !sessions.length ? (
          <Empty icon="recordings" title="No recordings match">
            <p>{site.lastSeenAt ? 'Try widening the date range or clearing filters.' : 'Install the tracking code to start recording sessions.'}</p>
            {!site.lastSeenAt && (
              <Link className="btn btn-primary" to={`/sites/${site.id}/settings`}>
                Get the tracking code
              </Link>
            )}
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th className="play-cell" />
                  <th>User</th>
                  <th>Date</th>
                  <th className="num">Duration</th>
                  <th className="num">Pages</th>
                  <th>Entry page</th>
                  <th>Device</th>
                  <th>Signals</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => navigate(`/sites/${site.id}/recordings/${s.id}${search}`)}>
                    <td className="play-cell">
                      <Link to={`/sites/${site.id}/recordings/${s.id}${search}`} className={`play-btn ${s.viewed ? 'viewed' : ''}`} aria-label="Play recording" onClick={(e) => e.stopPropagation()}>
                        <Icon name="play" />
                      </Link>
                    </td>
                    <td>
                      <div className="who">
                        <strong className="truncate" style={{ maxWidth: 200 }}>
                          {flag(s.country)} {sessionLabel(s)}
                        </strong>
                        <span className="small muted">
                          {s.browser} · {s.os}
                        </span>
                      </div>
                    </td>
                    <td title={formatDateTime(s.startedAt)}>
                      <div className="row">
                        {s.live && <span className="live-dot" title="Live" />}
                        {timeAgo(s.startedAt)}
                      </div>
                    </td>
                    <td className="num mono">{formatDuration(s.duration)}</td>
                    <td className="num">{s.pageCount}</td>
                    <td className="truncate" style={{ maxWidth: 220 }} title={s.entryUrl ?? ''}>
                      {pathOf(s.entryUrl)}
                    </td>
                    <td>
                      <DeviceIcon device={s.device} />
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                        {s.rageClicks > 0 && (
                          <span className="badge badge-danger" title="Rage clicks">
                            <Icon name="rage" />
                            {s.rageClicks}
                          </span>
                        )}
                        {s.deadClicks > 0 && (
                          <span className="badge badge-warning" title="Dead clicks">
                            <Icon name="click" />
                            {s.deadClicks}
                          </span>
                        )}
                        {s.errorCount > 0 && (
                          <span className="badge badge-warning" title="JavaScript errors">
                            <Icon name="error" />
                            {s.errorCount}
                          </span>
                        )}
                        {s.tags.slice(0, 3).map((t) => (
                          <span key={t} className="badge badge-accent">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && sessions.length < data.total && (
          <div className="card-body" style={{ textAlign: 'center', borderTop: '1px solid var(--border)' }}>
            <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : `Load more (${data.total - sessions.length} left)`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
