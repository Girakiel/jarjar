import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, useApi, type Site } from '../api';
import { Icon } from '../components/Icon';
import { Brand, useSites } from '../components/Layout';
import { AddSiteDialog, DeleteSiteDialog } from '../components/SiteDialogs';
import { Sparkline } from '../components/Sparkline';
import { Empty, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';
import { formatBytes, formatNumber, timeAgo } from '../format';

/** Sends people to the site they used last, or to onboarding when there are none. */
export function Home() {
  const { data: sites, error } = useApi<Site[]>('/sites');
  if (error) return <ErrorBox error={error} />;
  if (!sites) return <Spinner />;
  if (!sites.length) return <NewSitePage first />;
  let last: string | null = null;
  try {
    last = localStorage.getItem('jj_site');
  } catch {
    /* ignore */
  }
  const site = sites.find((s) => s.id === last) ?? sites[0];
  return <Navigate to={`/sites/${site.id}`} replace />;
}

export function NewSitePage({ first = false }: { first?: boolean }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const site = await api<Site>('/sites', { method: 'POST', body: { name, domains: domain } });
      navigate(`/sites/${site.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card stack" style={{ maxWidth: 440 }} onSubmit={submit}>
        <div>
          <Brand />
          <h1>{first ? 'Add your first site' : 'Add a site'}</h1>
          <p className="lead">You'll get a tracking snippet to paste into your pages.</p>
        </div>
        <div className="field">
          <label htmlFor="name">Site name</label>
          <input id="name" type="text" required placeholder="My shop" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="domain">Domain (optional)</label>
          <input id="domain" type="text" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <span className="hint">Only accept data from this domain and its subdomains. Leave empty to accept any.</span>
        </div>
        <ErrorBox error={error} />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Create site
        </button>
        {!first && (
          <Link to="/" className="btn btn-ghost">
            Cancel
          </Link>
        )}
      </form>
    </div>
  );
}

function SiteStatus({ site }: { site: Site }) {
  if (site.sampleRate === 0) return <span className="badge">Paused</span>;
  if (!site.lastSeenAt) return <span className="badge badge-warning">Waiting for first data</span>;
  const recent = Date.now() - site.lastSeenAt < 60 * 60 * 1000;
  return (
    <span className={`badge ${recent ? 'badge-success' : ''}`}>
      {recent && <span className="live-dot" />} Data {timeAgo(site.lastSeenAt)}
    </span>
  );
}

function SiteCard({ site, onDelete }: { site: Site; onDelete: () => void }) {
  const stats = site.stats;
  const base = `/sites/${site.id}`;
  return (
    <div className="card site-card">
      <div className="site-card-head">
        <div style={{ minWidth: 0 }}>
          <Link to={base} className="site-name">
            {site.name}
          </Link>
          <div className="small muted row" style={{ gap: 6 }}>
            <Icon name="globe" />
            <span className="truncate">{site.domains.length ? site.domains.join(', ') : 'Any domain'}</span>
          </div>
        </div>
        <SiteStatus site={site} />
      </div>

      {stats && (
        <>
          <div className="site-card-visits">
            <div>
              <div className="site-card-number">{formatNumber(stats.sessions)}</div>
              <div className="small muted">visits, last 30 days</div>
            </div>
            <Sparkline values={stats.daily} label="Visits per day, last 14 days" />
          </div>
          <dl className="site-card-stats">
            <div>
              <dt>Pages</dt>
              <dd>{formatNumber(stats.pages)}</dd>
            </div>
            <div>
              <dt>Page views</dt>
              <dd>{formatNumber(stats.pageviews)}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{formatBytes(stats.storageBytes)}</dd>
            </div>
            <div>
              <dt>Feedback</dt>
              <dd>{site.feedback.enabled ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt>Surveys live</dt>
              <dd>{stats.activeSurveys}</dd>
            </div>
            <div>
              <dt>Recording</dt>
              <dd>{site.sampleRate}%</dd>
            </div>
          </dl>
        </>
      )}

      <div className="site-card-actions">
        <Link className="btn btn-primary btn-sm" to={base}>
          Open
        </Link>
        <Link className="btn btn-sm" to={`${base}/pages`}>
          <Icon name="page" /> Pages
        </Link>
        <Link className="btn btn-sm" to={site.lastSeenAt ? `${base}/settings` : base}>
          <Icon name={site.lastSeenAt ? 'settings' : 'code'} /> {site.lastSeenAt ? 'Settings' : 'Install'}
        </Link>
        <button type="button" className="btn btn-ghost btn-sm btn-icon site-delete" aria-label={`Delete ${site.name}`} title="Delete site" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

/** Every site this jarjar tracks: add, open, or remove them. */
export function SitesPage() {
  const { sites, reloadSites } = useSites();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [deleting, setDeleting] = useState<Site | null>(null);
  const adding = params.get('add') === '1';
  const setAdding = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('add', '1');
    else next.delete('add');
    setParams(next, { replace: true });
  };

  const total = (key: 'sessions' | 'pageviews' | 'storageBytes') => sites.reduce((sum, s) => sum + (s.stats?.[key] ?? 0), 0);

  return (
    <>
      <PageHeader title="Sites" subtitle="Every website this jarjar tracks.">
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add a site
        </button>
      </PageHeader>

      {sites.length === 0 ? (
        <div className="card">
          <Empty icon="sites" title="No sites yet">
            <p>Add a site to get its tracking code.</p>
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Add a site
            </button>
          </Empty>
        </div>
      ) : (
        <div className="stack">
          <div className="stats">
            <Stat label="Sites" value={formatNumber(sites.length)} />
            <Stat label="Visits, last 30 days" value={formatNumber(total('sessions'))} />
            <Stat label="Page views, last 30 days" value={formatNumber(total('pageviews'))} />
            <Stat label="Recordings stored" value={formatBytes(total('storageBytes'))} />
          </div>
          <div className="site-grid">
            {sites.map((site) => (
              <SiteCard key={site.id} site={site} onDelete={() => setDeleting(site)} />
            ))}
          </div>
        </div>
      )}

      {adding && (
        <AddSiteDialog
          onClose={() => setAdding(false)}
          onCreated={(site) => {
            reloadSites();
            navigate(`/sites/${site.id}`);
          }}
        />
      )}
      {deleting && (
        <DeleteSiteDialog
          site={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            reloadSites();
          }}
        />
      )}
    </>
  );
}
