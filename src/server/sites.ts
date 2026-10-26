import crypto from 'node:crypto';
import type { TrackerConfig } from '../shared/protocol';
import type { Database } from './db';

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
  created_at: number;
}

export interface Site {
  id: string;
  name: string;
  domains: string[];
  sampleRate: number;
  maskAllText: boolean;
  respectDnt: boolean;
  feedback: { enabled: boolean; title: string; color: string };
  createdAt: number;
}

export function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    name: row.name,
    domains: row.domains ? row.domains.split(',') : [],
    sampleRate: row.sample_rate,
    maskAllText: !!row.mask_all_text,
    respectDnt: !!row.respect_dnt,
    feedback: { enabled: !!row.feedback_enabled, title: row.feedback_title, color: row.feedback_color },
    createdAt: row.created_at,
  };
}

export function trackerConfig(site: Site): TrackerConfig {
  return {
    enabled: site.sampleRate > 0,
    sampleRate: site.sampleRate,
    maskAllText: site.maskAllText,
    respectDnt: site.respectDnt,
    feedback: site.feedback.enabled ? site.feedback : null,
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

/** Small read-through cache: the ingest endpoint looks the site up on every request. */
export class SiteStore {
  private cache = new Map<string, Site | null>();

  constructor(private readonly db: Database) {}

  get(id: string): Site | undefined {
    if (!this.cache.has(id)) {
      const row = this.db.get<SiteRow>('SELECT * FROM sites WHERE id = ?', id);
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(id, row ? toSite(row) : null);
    }
    return this.cache.get(id) ?? undefined;
  }

  list(): Site[] {
    return this.db.all<SiteRow>('SELECT * FROM sites ORDER BY created_at').map(toSite);
  }

  create(name: string, domains: string[]): Site {
    const id = crypto.randomBytes(6).toString('hex');
    this.db.run('INSERT INTO sites (id, name, domains, created_at) VALUES (?, ?, ?, ?)', id, name, domains.join(','), Date.now());
    this.cache.delete(id);
    return this.get(id)!;
  }

  update(id: string, fields: Partial<Omit<SiteRow, 'id' | 'created_at'>>): Site | undefined {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined) as Array<[string, string | number]>;
    if (entries.length) {
      const sets = entries.map(([k]) => `${k} = ?`).join(', ');
      this.db.raw.prepare(`UPDATE sites SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => v), id);
    }
    this.cache.delete(id);
    return this.get(id);
  }

  delete(id: string): boolean {
    const { changes } = this.db.run('DELETE FROM sites WHERE id = ?', id);
    this.cache.delete(id);
    return changes > 0;
  }
}
