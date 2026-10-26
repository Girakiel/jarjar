import { createContext, useContext, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApi, type Site } from '../api';
import { useAuth } from '../App';
import { Icon, type IconName } from './Icon';
import { Empty, ErrorBox, Spinner } from './ui';

interface SiteContextValue {
  site: Site;
  sites: Site[];
  reloadSites: () => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite outside of a site route');
  return ctx;
}

export function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark">
        <Icon name="jar" />
      </span>
      jarjar
    </Link>
  );
}

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '', label: 'Overview', icon: 'overview', end: true },
  { to: 'recordings', label: 'Recordings', icon: 'recordings' },
  { to: 'heatmaps', label: 'Heatmaps', icon: 'heatmaps' },
  { to: 'feedback', label: 'Feedback', icon: 'feedback' },
  { to: 'test', label: 'Test page', icon: 'click' },
  { to: 'settings', label: 'Settings', icon: 'settings' },
];

export function Layout() {
  const { siteId } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: sites, error, reload } = useApi<Site[]>('/sites');
  const site = sites?.find((s) => s.id === siteId);

  useEffect(() => {
    if (site) {
      try {
        localStorage.setItem('jj_site', site.id);
      } catch {
        /* ignore */
      }
    }
  }, [site]);

  // Keep the selected date range when moving between sections.
  const days = new URLSearchParams(location.search).get('days');
  const search = days ? `?days=${days}` : '';

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        {sites && (
          <select
            className="site-select"
            aria-label="Site"
            value={siteId}
            onChange={(e) => navigate(e.target.value === '__new' ? '/sites/new' : `/sites/${e.target.value}${search}`)}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new">+ Add a site…</option>
          </select>
        )}
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.label} to={{ pathname: `/sites/${siteId}${item.to ? `/${item.to}` : ''}`, search }} end={item.end}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Icon name="user" />
          <span className="email" title={user.email}>
            {user.email}
          </span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Sign out" aria-label="Sign out" onClick={logout}>
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main className="main">
        {error ? (
          <ErrorBox error={error} />
        ) : !sites ? (
          <Spinner />
        ) : !site ? (
          <Empty icon="error" title="Site not found">
            <p>It may have been deleted.</p>
            <Link className="btn" to="/">
              Go to your sites
            </Link>
          </Empty>
        ) : (
          <SiteContext.Provider value={{ site, sites, reloadSites: reload }}>
            <Outlet />
          </SiteContext.Provider>
        )}
      </main>
    </div>
  );
}
