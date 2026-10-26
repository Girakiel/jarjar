import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_FEEDBACK_TEXTS, DEVICES, type Device, type FeedbackTexts } from '../../shared/protocol';
import { api, type Site } from '../api';
import { Icon } from './Icon';
import { useSite } from './Layout';
import { ErrorBox, Segmented, Toggle } from './ui';

interface FormState {
  enabled: boolean;
  title: string;
  color: string;
  position: 'left' | 'right';
  style: 'emoji' | 'stars';
  allowPick: boolean;
  texts: FeedbackTexts;
  pages: string;
  devices: Device[];
}

const TEXT_FIELDS: Array<[keyof FeedbackTexts, string]> = [
  ['tab', 'Tab on the edge of the page'],
  ['placeholder', 'Comment box placeholder'],
  ['pick', '"Point at something" button'],
  ['pickHint', 'Instructions while pointing'],
  ['picked', 'Shown once something is selected'],
  ['send', 'Send button'],
  ['thanks', 'Thank-you message'],
];

const DEVICE_LABELS: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

function toForm(site: Site): FormState {
  const fb = site.feedback;
  return {
    enabled: fb.enabled,
    title: fb.title,
    color: fb.color,
    position: fb.position,
    style: fb.style,
    allowPick: fb.allowPick,
    texts: { ...fb.texts },
    pages: fb.pages.join('\n'),
    devices: [...fb.devices],
  };
}

/** A static picture of the widget, updated as settings change. */
function WidgetPreview({ form }: { form: FormState }) {
  const icons = form.style === 'stars' ? ['★', '★', '★', '★', '☆'] : ['😡', '🙁', '😐', '🙂', '😍'];
  return (
    <div className={`fb-preview ${form.position}`} aria-hidden="true">
      <div className="fb-preview-tab" style={{ background: form.color }}>
        {form.texts.tab}
      </div>
      <div className="fb-preview-panel">
        <div className="fb-preview-title">{form.title}</div>
        <div className={form.style === 'stars' ? 'fb-preview-stars' : 'fb-preview-emoji'} style={{ color: form.color }}>
          {icons.map((icon, i) => (
            <span key={i} className={form.style === 'emoji' && i === 3 ? 'selected' : ''} style={form.style === 'emoji' && i === 3 ? { borderColor: form.color } : undefined}>
              {icon}
            </span>
          ))}
        </div>
        <div className="fb-preview-input">{form.texts.placeholder}</div>
        {form.allowPick && <div className="fb-preview-pick">📍 {form.texts.pick}</div>}
        <div className="fb-preview-send" style={{ background: form.color }}>
          {form.texts.send}
        </div>
      </div>
    </div>
  );
}

export function FeedbackSettings() {
  const { site, reloadSites } = useSite();
  const [form, setForm] = useState(() => toForm(site));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => setForm(toForm(site)), [site]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };
  const updateText = (key: keyof FeedbackTexts, value: string) => update('texts', { ...form.texts, [key]: value });
  const toggleDevice = (device: Device, on: boolean) =>
    update('devices', on ? DEVICES.filter((d) => d === device || form.devices.includes(d)) : form.devices.filter((d) => d !== device));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await api<Site>(`/sites/${site.id}`, {
        method: 'PATCH',
        body: {
          feedback: {
            enabled: form.enabled,
            title: form.title,
            color: form.color,
            position: form.position,
            style: form.style,
            allowPick: form.allowPick,
            texts: form.texts,
            pages: form.pages,
            devices: form.devices,
          },
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

  return (
    <form className="card" onSubmit={save}>
      <div className="card-header">
        <h2>Feedback widget</h2>
        <Link to={`/sites/${site.id}/test`} className="small">
          Try it on the Test page →
        </Link>
      </div>
      <div className="card-body form-grid">
        <Toggle
          checked={form.enabled}
          onChange={(v) => update('enabled', v)}
          label="Show the feedback widget"
          hint="Adds a tab on the side of your pages where visitors rate their experience and leave a comment."
        />
        {form.enabled && (
          <>
            <div className="fb-settings">
              <div className="form-grid" style={{ flex: 1, minWidth: 260 }}>
                <div className="field">
                  <label htmlFor="fb-title">Question</label>
                  <input id="fb-title" type="text" value={form.title} onChange={(e) => update('title', e.target.value)} />
                </div>
                <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
                  <div className="field">
                    <span className="label">Position</span>
                    <Segmented
                      label="Position"
                      value={form.position}
                      onChange={(v) => update('position', v)}
                      options={[
                        { value: 'left', label: 'Left' },
                        { value: 'right', label: 'Right' },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <span className="label">Rating style</span>
                    <Segmented
                      label="Rating style"
                      value={form.style}
                      onChange={(v) => update('style', v)}
                      options={[
                        { value: 'emoji', label: '😍 Emoji' },
                        { value: 'stars', label: '★ Stars' },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="fb-color">Color</label>
                    <div className="color-input">
                      <input id="fb-color" type="color" value={form.color} onChange={(e) => update('color', e.target.value)} />
                      <code>{form.color}</code>
                    </div>
                  </div>
                </div>
                <Toggle
                  checked={form.allowPick}
                  onChange={(v) => update('allowPick', v)}
                  label="Let visitors point at part of the page"
                  hint="They click the element their feedback is about; you see it marked on the page."
                />
              </div>
              <WidgetPreview form={form} />
            </div>

            <div className="field">
              <label htmlFor="fb-pages">Show on pages</label>
              <textarea
                id="fb-pages"
                rows={3}
                placeholder={'/pricing\n/blog/*'}
                value={form.pages}
                onChange={(e) => update('pages', e.target.value)}
              />
              <span className="hint">One path per line; * matches anything (e.g. /blog/*). Leave empty to show it everywhere.</span>
            </div>
            <div className="field">
              <span className="label">Show on devices</span>
              <div className="row" style={{ gap: 16 }}>
                {DEVICES.map((d) => (
                  <label key={d} className="check">
                    <input type="checkbox" checked={form.devices.includes(d)} onChange={(e) => toggleDevice(d, e.target.checked)} />
                    {DEVICE_LABELS[d]}
                  </label>
                ))}
              </div>
            </div>

            <details className="wording">
              <summary>Wording and language</summary>
              <p className="hint">Change any text the visitor sees, for example to translate the widget.</p>
              <div className="wording-grid">
                {TEXT_FIELDS.map(([key, label]) => (
                  <div className="field" key={key}>
                    <label htmlFor={`fb-text-${key}`}>{label}</label>
                    <input
                      id={`fb-text-${key}`}
                      type="text"
                      value={form.texts[key]}
                      placeholder={DEFAULT_FEEDBACK_TEXTS[key]}
                      onChange={(e) => updateText(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={saving || (form.enabled && form.devices.length === 0)}>
            {saving ? 'Saving…' : 'Save widget'}
          </button>
          {saved && (
            <span className="row small" style={{ color: 'var(--success)' }}>
              <Icon name="check" /> Saved. Your pages pick this up within a minute.
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
