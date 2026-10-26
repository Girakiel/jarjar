// Per-page metrics for the Pages view.
import type { Database } from './db';

const MAX_TIME_ON_PAGE_MS = 30 * 60 * 1000;
const BOUNCE_MS = 10_000;

export interface PageStats {
  path: string;
  title: string | null;
  views: number;
  visitors: number;
  avgTime: number | null; // ms
  avgScroll: number | null; // 0-1
  entries: number;
  bounceRate: number | null;
  exitRate: number;
  clicks: number;
  rageClicks: number;
  deadClicks: number;
  errors: number;
  rating: number | null;
  ratings: number;
  devices: string[]; // devices with a heatmap snapshot
}

export function pageStats(db: Database, siteId: string, from: number, to: number): PageStats[] {
  const range = [siteId, from, to] as const;
  const views = db.all<{ session_id: string; path: string; title: string | null; client_ts: number; doc_h: number; max_scroll: number; last_ts: number; duration: number }>(
    `SELECT p.session_id, p.path, p.title, p.client_ts, p.doc_h, p.max_scroll, s.last_ts, (s.last_ts - s.first_ts) AS duration
     FROM pageviews p JOIN sessions s ON s.id = p.session_id
     WHERE p.site_id = ? AND p.ts >= ? AND p.ts < ?
     ORDER BY p.session_id, p.client_ts
     LIMIT 1000000`,
    ...range,
  );

  const pages = new Map<
    string,
    { title: string | null; views: number; sessions: Set<string>; time: number; timed: number; depth: number; measured: number; entries: number; bounces: number; exits: number }
  >();
  const page = (path: string) => {
    let p = pages.get(path);
    if (!p) pages.set(path, (p = { title: null, views: 0, sessions: new Set(), time: 0, timed: 0, depth: 0, measured: 0, entries: 0, bounces: 0, exits: 0 }));
    return p;
  };

  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    const prev = views[i - 1];
    const next = views[i + 1];
    const first = !prev || prev.session_id !== v.session_id;
    const last = !next || next.session_id !== v.session_id;
    const p = page(v.path);
    p.views++;
    p.sessions.add(v.session_id);
    if (v.title) p.title = v.title;
    const spent = (last ? v.last_ts : next.client_ts) - v.client_ts;
    if (spent >= 0 && spent <= MAX_TIME_ON_PAGE_MS) {
      p.time += spent;
      p.timed++;
    }
    if (v.doc_h > 0) {
      p.depth += Math.min(1, v.max_scroll / v.doc_h);
      p.measured++;
    }
    if (first) {
      p.entries++;
      if (last && v.duration < BOUNCE_MS) p.bounces++;
    }
    if (last) p.exits++;
  }

  const byPath = <T>(rows: Array<T & { path: string }>) => new Map(rows.map((r) => [r.path, r]));
  const clicks = byPath(
    db.all<{ path: string; clicks: number; rage: number; dead: number }>(
      'SELECT path, COUNT(*) AS clicks, SUM(rage) AS rage, SUM(dead) AS dead FROM clicks WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY path',
      ...range,
    ),
  );
  const errors = byPath(db.all<{ path: string; n: number }>('SELECT path, SUM(count) AS n FROM js_errors WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY path', ...range));
  const ratings = byPath(
    db.all<{ path: string; avg: number; n: number }>(
      'SELECT path, AVG(rating) AS avg, COUNT(*) AS n FROM feedback WHERE site_id = ? AND created_at >= ? AND created_at < ? GROUP BY path',
      ...range,
    ),
  );
  const snapshots = new Map<string, string[]>();
  for (const s of db.all<{ path: string; device: string }>('SELECT path, device FROM snapshots WHERE site_id = ?', siteId)) {
    snapshots.set(s.path, [...(snapshots.get(s.path) ?? []), s.device]);
  }

  return [...pages.entries()]
    .map(([path, p]) => ({
      path,
      title: p.title,
      views: p.views,
      visitors: p.sessions.size,
      avgTime: p.timed ? Math.round(p.time / p.timed) : null,
      avgScroll: p.measured ? p.depth / p.measured : null,
      entries: p.entries,
      bounceRate: p.entries ? p.bounces / p.entries : null,
      exitRate: p.exits / p.views,
      clicks: clicks.get(path)?.clicks ?? 0,
      rageClicks: clicks.get(path)?.rage ?? 0,
      deadClicks: clicks.get(path)?.dead ?? 0,
      errors: errors.get(path)?.n ?? 0,
      rating: ratings.get(path)?.avg ?? null,
      ratings: ratings.get(path)?.n ?? 0,
      devices: snapshots.get(path) ?? [],
    }))
    .sort((a, b) => b.views - a.views);
}

/** Headline numbers for every site, for the Sites page. */
export function siteSummaries(db: Database, now = Date.now()) {
  const since = now - 30 * 86_400_000;
  const sparkFrom = now - 14 * 86_400_000;
  const group = <T extends { site_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.site_id, r]));

  const activity = group(
    db.all<{ site_id: string; sessions: number; visitors: number; pageviews: number }>(
      `SELECT site_id, COUNT(*) AS sessions, COUNT(DISTINCT visitor_id) AS visitors, SUM(page_count) AS pageviews
       FROM sessions WHERE started_at >= ? GROUP BY site_id`,
      since,
    ),
  );
  const lastSeen = group(db.all<{ site_id: string; t: number }>('SELECT site_id, MAX(last_seen_at) AS t FROM sessions GROUP BY site_id'));
  const storage = group(db.all<{ site_id: string; bytes: number }>('SELECT site_id, SUM(recording_bytes) AS bytes FROM sessions GROUP BY site_id'));
  const pages = group(db.all<{ site_id: string; n: number }>('SELECT site_id, COUNT(DISTINCT path) AS n FROM pageviews WHERE ts >= ? GROUP BY site_id', since));
  const surveys = group(db.all<{ site_id: string; n: number }>('SELECT site_id, COUNT(*) AS n FROM surveys WHERE active = 1 GROUP BY site_id'));
  const daily = new Map<string, number[]>();
  for (const row of db.all<{ site_id: string; day: number; n: number }>(
    `SELECT site_id, CAST((started_at - ?) / 86400000 AS INTEGER) AS day, COUNT(*) AS n
     FROM sessions WHERE started_at >= ? GROUP BY site_id, day`,
    sparkFrom, sparkFrom,
  )) {
    const days = daily.get(row.site_id) ?? new Array(14).fill(0);
    if (row.day >= 0 && row.day < 14) days[row.day] = row.n;
    daily.set(row.site_id, days);
  }

  return (siteId: string) => ({
    lastSeenAt: lastSeen.get(siteId)?.t ?? null,
    stats: {
      sessions: activity.get(siteId)?.sessions ?? 0,
      visitors: activity.get(siteId)?.visitors ?? 0,
      pageviews: activity.get(siteId)?.pageviews ?? 0,
      pages: pages.get(siteId)?.n ?? 0,
      storageBytes: storage.get(siteId)?.bytes ?? 0,
      activeSurveys: surveys.get(siteId)?.n ?? 0,
      daily: daily.get(siteId) ?? new Array(14).fill(0),
    },
  });
}
