import { createContext, useContext, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApi, type Site } from '../api';
import { useAuth } from '../App';
import { Icon, type IconName } from './Icon';
import { Empty, ErrorBox, Spinner } from './ui';
import { formatDateTime, formatDay } from '../format';

interface SitesContextValue {
  sites: Site[];
  reloadSites: () => void;
}

interface SiteContextValue extends SitesContextValue {
  site: Site;
}

const SitesContext = createContext<SitesContextValue | null>(null);
const SiteContext = createContext<SiteContextValue | null>(null);

/** All sites, with their 30-day stats. Available on every page inside the layout. */
export function useSites(): SitesContextValue {
  const ctx = useContext(SitesContext);
  if (!ctx) throw new Error('useSites outside of the layout');
  return ctx;
}

/** The site whose pages are being viewed. */
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
  { to: 'insights', label: 'Insights', icon: 'insights' },
  { to: 'pages', label: 'Pages', icon: 'page' },
  { to: 'recordings', label: 'Recordings', icon: 'recordings' },
  { to: 'heatmaps', label: 'Heatmaps', icon: 'heatmaps' },
  { to: 'journeys', label: 'Journeys', icon: 'journeys' },
  { to: 'feedback', label: 'Feedback', icon: 'feedback' },
  { to: 'surveys', label: 'Surveys', icon: 'survey' },
  { to: 'test', label: 'Test page', icon: 'click' },
  { to: 'settings', label: 'Settings', icon: 'settings' },
];

export function Layout() {
  const { siteId } = useParams();
  const { user, version, logout } = useAuth();
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

  let content;
  if (error) content = <ErrorBox error={error} />;
  else if (!sites) content = <Spinner />;
  else if (!siteId) content = <Outlet />;
  else if (!site) {
    content = (
      <Empty icon="error" title="Site not found">
        <p>It may have been deleted.</p>
        <Link className="btn" to="/sites">
          See all sites
        </Link>
      </Empty>
    );
  } else {
    content = (
      <SiteContext.Provider value={{ site, sites, reloadSites: reload }}>
        <Outlet />
      </SiteContext.Provider>
    );
  }

  return (
    <SitesContext.Provider value={{ sites: sites ?? [], reloadSites: reload }}>
      <div className="app">
        <aside className="sidebar">
          <Brand />
          <nav className="nav nav-top">
            <NavLink to={{ pathname: '/sites', search }} end>
              <Icon name="sites" />
              <span>All sites</span>
            </NavLink>
          </nav>
          {sites && sites.length > 0 && (
            <select
              className="site-select"
              aria-label="Site"
              value={siteId ?? ''}
              onChange={(e) => navigate(e.target.value === '__new' ? '/sites?add=1' : `/sites/${e.target.value}${search}`)}
            >
              {!siteId && (
                <option value="" disabled>
                  Choose a site…
                </option>
              )}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="__new">+ Add a site…</option>
            </select>
          )}
          {siteId && (
            <nav className="nav">
              {NAV.map((item) => (
                <NavLink key={item.label} to={{ pathname: `/sites/${siteId}${item.to ? `/${item.to}` : ''}`, search }} end={item.end}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          )}
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <Icon name="user" />
              <span className="email" title={user.email}>
                {user.email}
              </span>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Sign out" aria-label="Sign out" onClick={logout}>
                <Icon name="logout" />
              </button>
            </div>
            {version && (
              <div className="sidebar-version" title={version.date ? `Built from commit ${version.commit}, made ${formatDateTime(Date.parse(version.date))}` : `Built from commit ${version.commit}`}>
                Version {version.commit}
                {version.date && ` · ${formatDay(version.date.slice(0, 10))}`}
              </div>
            )}
          </div>
        </aside>
        <main className="main">{content}</main>
      </div>
    </SitesContext.Provider>
  );
}
