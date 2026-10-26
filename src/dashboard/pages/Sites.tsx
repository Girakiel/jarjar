import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, useApi, type Site } from '../api';
import { Brand } from '../components/Layout';
import { ErrorBox, Spinner } from '../components/ui';

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
