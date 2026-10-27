import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Site } from '../api';
import { formatBytes, formatNumber } from '../format';
import { ErrorBox } from './ui';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="card-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AddSiteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (site: Site) => void }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api<Site>('/sites', { method: 'POST', body: { name, domains: domain } }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add a site" onClose={onClose}>
      <form className="card-body form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="new-site-name">Name</label>
          <input id="new-site-name" type="text" required placeholder="My shop" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="new-site-domain">Domain (optional)</label>
          <input id="new-site-domain" type="text" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <span className="hint">Only accept data from this domain and its subdomains. Leave empty to accept any.</span>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
            Create site
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteSiteDialog({ site, onClose, onDeleted }: { site: Site; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/sites/${site.id}`, { method: 'DELETE' });
      try {
        if (localStorage.getItem('jj_site') === site.id) localStorage.removeItem('jj_site');
      } catch {
        /* ignore */
      }
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Delete ${site.name}?`} onClose={onClose}>
      <form className="card-body form-grid" onSubmit={remove}>
        <p style={{ margin: 0 }}>
          This permanently deletes the site and everything recorded for it
          {site.stats
            ? ` (${formatNumber(site.stats.sessions)} visits in the last 30 days, ${formatBytes(site.stats.storageBytes)} of recordings)`
            : ''}
          , including heatmaps, feedback and surveys. Pages that still have its tracking code will stop being recorded.
        </p>
        <div className="field">
          <label htmlFor="confirm-site-name">
            Type <strong>{site.name}</strong> to confirm
          </label>
          <input id="confirm-site-name" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button className="btn btn-danger" type="submit" disabled={busy || typed !== site.name}>
            Delete site
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
