import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Site } from '../api';
import { FeedbackSettings } from '../components/FeedbackSettings';
import { DeleteSiteDialog } from '../components/SiteDialogs';
import { Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { CodeBlock, Snippet } from '../components/Snippet';
import { ErrorBox, PageHeader, Toggle } from '../components/ui';
import { timeAgo } from '../format';

const API_EXAMPLE = `// Attach your own user id and attributes to the session
jarjar('identify', 'user-42', { plan: 'pro', email_verified: true });

// Mark moments you want to filter recordings by
jarjar('event', 'checkout_started');

// Let visitors opt out (stored in their browser)
jarjar('optOut');

// Calls made before t.js has loaded are queued if you add this first:
window.jarjar = window.jarjar || function () { (jarjar.q = jarjar.q || []).push(arguments); };`;

export function SettingsPage() {
  const { site, reloadSites } = useSite();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => toForm(site));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => setForm(toForm(site)), [site]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await api<Site>(`/sites/${site.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          domains: form.domains,
          sampleRate: form.sampleRate,
          maskAllText: form.maskAllText,
          respectDnt: form.respectDnt,
        },
      });
      setSaved(true);
      reloadSites();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <PageHeader title="Settings" subtitle={site.name} />
      <div className="stack" style={{ maxWidth: 820 }}>
        <div className="card">
          <div className="card-header">
            <h2>Tracking code</h2>
            {site.lastSeenAt ? (
              <span className="badge badge-success">
                <span className="live-dot" /> Last data {timeAgo(site.lastSeenAt)}
              </span>
            ) : (
              <span className="badge badge-warning">Waiting for first data</span>
            )}
          </div>
          <div className="card-body stack">
            <p className="muted" style={{ margin: 0 }}>
              Add this to the <code>&lt;head&gt;</code> of every page. Your site key is <code>{site.id}</code>.
            </p>
            <Snippet siteId={site.id} />
            <div className="row small muted">
              <Icon name="external" />
              <span>
                Try it on the <Link to={`/sites/${site.id}/test`}>test page</Link>. Add <code>data-jj-mask</code> to elements whose text should never be recorded, or{' '}
                <code>data-jj-block</code> to hide them entirely.
              </span>
            </div>
          </div>
        </div>

        <form className="card" onSubmit={save}>
          <div className="card-header">
            <h2>Site settings</h2>
          </div>
          <div className="card-body form-grid">
            <div className="field">
              <label htmlFor="site-name">Name</label>
              <input id="site-name" type="text" required value={form.name} onChange={(e) => update('name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="site-domains">Allowed domains</label>
              <textarea id="site-domains" rows={2} placeholder="example.com, shop.example.com" value={form.domains} onChange={(e) => update('domains', e.target.value)} />
              <span className="hint">Data from other origins is rejected. Subdomains are included. Leave empty to accept any origin.</span>
            </div>
            <div className="field">
              <label htmlFor="site-sample">Sessions to record: {form.sampleRate}%</label>
              <input id="site-sample" type="range" min={0} max={100} step={5} value={form.sampleRate} onChange={(e) => update('sampleRate', Number(e.target.value))} />
              <span className="hint">Lower this on busy sites to save storage. 0% pauses tracking.</span>
            </div>
            <Toggle checked={form.maskAllText} onChange={(v) => update('maskAllText', v)} label="Mask all text in recordings" hint="Replaces every piece of text with asterisks. Form inputs are always masked." />
            <Toggle checked={form.respectDnt} onChange={(v) => update('respectDnt', v)} label="Respect Do Not Track" hint="Skip visitors whose browser sends Do Not Track or Global Privacy Control." />

            <ErrorBox error={error} />
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && (
                <span className="row small" style={{ color: 'var(--success)' }}>
                  <Icon name="check" /> Saved — the tracker picks this up within a minute.
                </span>
              )}
            </div>
          </div>
        </form>

        <FeedbackSettings />

        <div className="card">
          <div className="card-header">
            <h2>JavaScript API</h2>
          </div>
          <div className="card-body">
            <CodeBlock code={API_EXAMPLE} />
          </div>
        </div>

        <div className="card danger-zone">
          <div className="card-header">
            <h2>Delete site</h2>
          </div>
          <div className="card-body row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className="muted">Permanently removes the site and all data collected for it.</span>
            <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
              <Icon name="trash" /> Delete site
            </button>
          </div>
        </div>
      </div>
      {deleting && <DeleteSiteDialog site={site} onClose={() => setDeleting(false)} onDeleted={() => { reloadSites(); navigate('/sites'); }} />}
    </>
  );
}

interface FormState {
  name: string;
  domains: string;
  sampleRate: number;
  maskAllText: boolean;
  respectDnt: boolean;
}

function toForm(site: Site): FormState {
  return {
    name: site.name,
    domains: site.domains.join(', '),
    sampleRate: site.sampleRate,
    maskAllText: site.maskAllText,
    respectDnt: site.respectDnt,
  };
}
