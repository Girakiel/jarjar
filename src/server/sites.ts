import crypto from 'node:crypto';
import { DEFAULT_FEEDBACK_TEXTS, type FeedbackTexts, type FeedbackWidgetConfig, type SurveyDefinition, type TrackerConfig } from '../shared/protocol';
import { cleanDevices, cleanPatterns, cleanText, parseJsonObject } from './clean';
import type { Database } from './db';
import { parseSurveyContent, type SurveyRow } from './surveys';

export interface SiteRow {
  id: string;
  name: string;
  domains: string;
  sample_rate: number;
  mask_all_text: number;
  respect_dnt: number;
  feedback_enabled: number;
  feedback_title: string;
  feedback_color: string;
  feedback_config: string;
  created_at: number;
}

export type FeedbackSettings = FeedbackWidgetConfig & { enabled: boolean };

export interface Site {
  id: string;
  name: string;
  domains: string[];
  sampleRate: number;
  maskAllText: boolean;
  respectDnt: boolean;
  feedback: FeedbackSettings;
  createdAt: number;
}

/** The widget settings kept in sites.feedback_config, with defaults filled in. */
export function cleanFeedbackConfig(raw: Record<string, unknown>): Omit<FeedbackWidgetConfig, 'title' | 'color'> {
  const texts = (raw.texts ?? {}) as Record<string, unknown>;
  return {
    position: raw.position === 'left' ? 'left' : 'right',
    style: raw.style === 'stars' ? 'stars' : 'emoji',
    allowPick: raw.allowPick !== false,
    texts: Object.fromEntries(
      Object.entries(DEFAULT_FEEDBACK_TEXTS).map(([key, fallback]) => [key, cleanText(texts[key], fallback)]),
    ) as unknown as FeedbackTexts,
    pages: cleanPatterns(raw.pages),
    devices: cleanDevices(raw.devices),
  };
}

export function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    name: row.name,
    domains: row.domains ? row.domains.split(',') : [],
    sampleRate: row.sample_rate,
    maskAllText: !!row.mask_all_text,
    respectDnt: !!row.respect_dnt,
    feedback: {
      enabled: !!row.feedback_enabled,
      title: row.feedback_title,
      color: row.feedback_color,
      ...cleanFeedbackConfig(parseJsonObject(row.feedback_config)),
    },
    createdAt: row.created_at,
  };
}

export function trackerConfig(site: Site, surveys: SurveyDefinition[]): TrackerConfig {
  const { enabled, ...feedback } = site.feedback;
  return {
    enabled: site.sampleRate > 0,
    sampleRate: site.sampleRate,
    maskAllText: site.maskAllText,
    respectDnt: site.respectDnt,
    feedback: enabled ? feedback : null,
    surveys,
  };
}

/** Normalizes user input like "https://www.Example.com/path" to "www.example.com". */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return '';
  }
}

/** An empty allow-list accepts any origin; "example.com" also accepts its subdomains. */
export function originAllowed(site: Site, origin: string | undefined): boolean {
  if (site.domains.length === 0) return true;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return site.domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Small read-through cache: the ingest endpoints look up the site (and the
 * tracker config its active surveys) on every request.
 */
export class SiteStore {
  private cache = new Map<string, Site | null>();
  private surveys = new Map<string, SurveyDefinition[]>();

  constructor(private readonly db: Database) {}

  get(id: string): Site | undefined {
    if (!this.cache.has(id)) {
      const row = this.db.get<SiteRow>('SELECT * FROM sites WHERE id = ?', id);
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(id, row ? toSite(row) : null);
    }
    return this.cache.get(id) ?? undefined;
  }

  activeSurveys(siteId: string): SurveyDefinition[] {
    let list = this.surveys.get(siteId);
    if (!list) {
      list = this.db
        .all<SurveyRow>('SELECT * FROM surveys WHERE site_id = ? AND active = 1 ORDER BY created_at', siteId)
        .map((row) => ({ id: row.id, ...parseSurveyContent(row.definition) }));
      if (this.surveys.size > 5000) this.surveys.clear();
      this.surveys.set(siteId, list);
    }
    return list;
  }

  /** Call after changing a site's surveys. */
  invalidate(siteId: string): void {
    this.cache.delete(siteId);
    this.surveys.delete(siteId);
  }

  list(): Site[] {
    return this.db.all<SiteRow>('SELECT * FROM sites ORDER BY created_at').map(toSite);
  }

  create(name: string, domains: string[]): Site {
    const id = crypto.randomBytes(6).toString('hex');
    this.db.run('INSERT INTO sites (id, name, domains, created_at) VALUES (?, ?, ?, ?)', id, name, domains.join(','), Date.now());
    this.invalidate(id);
    return this.get(id)!;
  }

  update(id: string, fields: Partial<Omit<SiteRow, 'id' | 'created_at'>>): Site | undefined {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined) as Array<[string, string | number]>;
    if (entries.length) {
      const sets = entries.map(([k]) => `${k} = ?`).join(', ');
      this.db.raw.prepare(`UPDATE sites SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => v), id);
    }
    this.invalidate(id);
    return this.get(id);
  }

  delete(id: string): boolean {
    const { changes } = this.db.run('DELETE FROM sites WHERE id = ?', id);
    this.invalidate(id);
    return changes > 0;
  }
}
