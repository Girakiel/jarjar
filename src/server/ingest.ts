import {
  deviceForWidth,
  pageKey,
  RRWEB_CUSTOM,
  RRWEB_FULL_SNAPSHOT,
  RRWEB_META,
  type CollectPayload,
  type FeedbackPayload,
} from '../shared/protocol';
import type { Database } from './db';
import { badRequest, clamp, gzip, HttpError, int, num, str } from './http';
import type { Site } from './sites';
import { parseUserAgent } from './ua';

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_EVENTS = 20_000;
const MAX_CLICKS = 500;
const MAX_MOVES = 3000;
const MAX_TAGS = 50;
// Replace a page's heatmap snapshot at most this often.
const SNAPSHOT_REFRESH_MS = 60 * 60 * 1000;

export interface RequestInfo {
  userAgent: string;
  country: string | null;
  now?: number;
}

interface RrwebEvent {
  type: number;
  timestamp: number;
  data?: Record<string, unknown>;
}

function isEvent(e: unknown): e is RrwebEvent {
  return !!e && typeof e === 'object' && typeof (e as RrwebEvent).type === 'number' && typeof (e as RrwebEvent).timestamp === 'number';
}

export function parseCollectPayload(input: unknown): CollectPayload {
  if (!input || typeof input !== 'object') throw badRequest('invalid payload');
  const p = input as Record<string, unknown>;
  const pv = p.pv as Record<string, unknown> | undefined;
  if (typeof p.sid !== 'string' || !ID_RE.test(p.sid)) throw badRequest('invalid sid');
  if (typeof p.vid !== 'string' || !ID_RE.test(p.vid)) throw badRequest('invalid vid');
  if (!pv || typeof pv.id !== 'string' || !ID_RE.test(pv.id) || typeof pv.url !== 'string') throw badRequest('invalid pv');

  const payload: CollectPayload = {
    site: str(p.site, 64),
    sid: p.sid,
    vid: p.vid,
    pv: {
      id: pv.id,
      url: str(pv.url, 2000),
      title: str(pv.title, 200),
      ts: int(pv.ts, Date.now()),
      vw: clamp(int(pv.vw), 0, 20000),
      vh: clamp(int(pv.vh), 0, 20000),
      dh: clamp(int(pv.dh), 0, 1_000_000),
      sy: clamp(int(pv.sy), 0, 1_000_000),
    },
  };

  const meta = p.meta as Record<string, unknown> | undefined;
  if (meta && typeof meta === 'object') {
    payload.meta = {
      ua: str(meta.ua, 512),
      sw: clamp(int(meta.sw), 0, 20000),
      sh: clamp(int(meta.sh), 0, 20000),
      lang: str(meta.lang, 35),
      ref: str(meta.ref, 2000),
    };
  }
  if (Array.isArray(p.events)) payload.events = p.events.filter(isEvent).slice(0, MAX_EVENTS);
  if (Array.isArray(p.clicks)) {
    payload.clicks = p.clicks.slice(0, MAX_CLICKS).flatMap((c) => {
      if (!c || typeof c !== 'object' || typeof c.s !== 'string' || !c.s) return [];
      return [{ t: int(c.t), s: str(c.s, 1000), rx: clamp(num(c.rx), 0, 1), ry: clamp(num(c.ry), 0, 1), x: int(c.x), y: int(c.y), ...(c.r ? { r: 1 as const } : {}) }];
    });
  }
  if (Array.isArray(p.moves)) {
    payload.moves = p.moves.slice(0, MAX_MOVES).flatMap((m) => {
      if (!m || typeof m !== 'object' || typeof m.s !== 'string' || !m.s) return [];
      return [{ s: str(m.s, 1000), rx: clamp(num(m.rx), 0, 1), ry: clamp(num(m.ry), 0, 1), x: int(m.x), y: int(m.y) }];
    });
  }
  if (p.errors !== undefined) payload.errors = clamp(int(p.errors), 0, 1000);
  if (Array.isArray(p.tags)) payload.tags = p.tags.filter((t): t is string => typeof t === 'string' && t.length > 0).map((t) => t.slice(0, 100)).slice(0, MAX_TAGS);
  const identity = p.identity as Record<string, unknown> | undefined;
  if (identity && typeof identity === 'object' && typeof identity.id === 'string' && identity.id) {
    const attrs = identity.attrs && typeof identity.attrs === 'object' ? (identity.attrs as Record<string, string | number | boolean | null>) : undefined;
    payload.identity = { id: identity.id.slice(0, 200), attrs };
  }
  return payload;
}

/** Finds the last Meta + FullSnapshot pair in a batch: a complete picture of the page at that moment. */
export function findSnapshot(events: RrwebEvent[]): { meta: RrwebEvent; full: RrwebEvent } | null {
  let meta: RrwebEvent | null = null;
  let found: { meta: RrwebEvent; full: RrwebEvent } | null = null;
  for (const e of events) {
    if (e.type === RRWEB_META) meta = e;
    else if (e.type === RRWEB_FULL_SNAPSHOT && meta) found = { meta, full: e };
  }
  return found;
}

function referrerOf(meta: CollectPayload['meta'], entryUrl: string): string | null {
  if (!meta?.ref) return null;
  try {
    // Internal navigation isn't a referrer.
    if (new URL(meta.ref).hostname === new URL(entryUrl).hostname) return null;
  } catch {
    return null;
  }
  return meta.ref;
}

export async function ingest(db: Database, site: Site, payload: CollectPayload, info: RequestInfo): Promise<void> {
  const now = info.now ?? Date.now();
  const { pv } = payload;
  const path = pageKey(pv.url);
  const device = deviceForWidth(pv.vw);
  const events = (payload.events ?? []) as RrwebEvent[];
  const clicks = payload.clicks ?? [];
  const moves = payload.moves ?? [];

  let minTs = pv.ts;
  let maxTs = pv.ts;
  let rageClicks = 0;
  for (const e of events) {
    if (e.timestamp < minTs) minTs = e.timestamp;
    if (e.timestamp > maxTs) maxTs = e.timestamp;
    if (e.type === RRWEB_CUSTOM && e.data?.tag === 'rage-click') rageClicks++;
  }
  for (const c of clicks) if (c.t > maxTs) maxTs = c.t;

  // Compress outside the transaction so the database lock is held briefly.
  let chunk: Buffer | null = null;
  if (events.length) chunk = await gzip(JSON.stringify(events));

  let snapshot: { path: string; device: string; width: number; height: number; data: Buffer; ts: number } | null = null;
  const found = events.length ? findSnapshot(events) : null;
  if (found) {
    const href = String(found.meta.data?.href ?? pv.url);
    const width = int(found.meta.data?.width, pv.vw);
    const snapPath = pageKey(href);
    const snapDevice = deviceForWidth(width);
    const existing = db.get<{ ts: number }>('SELECT ts FROM snapshots WHERE site_id = ? AND path = ? AND device = ?', site.id, snapPath, snapDevice);
    if (!existing || existing.ts < now - SNAPSHOT_REFRESH_MS) {
      snapshot = {
        path: snapPath,
        device: snapDevice,
        width,
        height: int(found.meta.data?.height, pv.vh),
        data: await gzip(JSON.stringify([found.meta, found.full])),
        ts: now,
      };
    }
  }

  const ua = payload.meta?.ua || info.userAgent;
  const { browser, os } = parseUserAgent(ua);

  db.transaction(() => {
    const existing = db.get<{ site_id: string; tags: string }>('SELECT site_id, tags FROM sessions WHERE id = ?', payload.sid);
    if (existing && existing.site_id !== site.id) throw new HttpError(403, 'session belongs to another site');

    if (!existing) {
      db.run(
        `INSERT INTO sessions (id, site_id, visitor_id, started_at, last_seen_at, first_ts, last_ts, entry_url, referrer,
           user_agent, browser, os, device, screen_w, screen_h, language, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        payload.sid, site.id, payload.vid, now, now, minTs, maxTs, pv.url, referrerOf(payload.meta, pv.url),
        ua, browser, os, device, payload.meta?.sw ?? null, payload.meta?.sh ?? null, payload.meta?.lang || null, info.country,
      );
    } else {
      db.run(
        `UPDATE sessions SET last_seen_at = ?, first_ts = MIN(first_ts, ?), last_ts = MAX(last_ts, ?),
           screen_w = COALESCE(screen_w, ?), screen_h = COALESCE(screen_h, ?), language = COALESCE(language, ?)
         WHERE id = ?`,
        now, minTs, maxTs, payload.meta?.sw ?? null, payload.meta?.sh ?? null, payload.meta?.lang || null, payload.sid,
      );
    }

    const pvExists = db.get('SELECT 1 AS x FROM pageviews WHERE id = ?', pv.id);
    if (!pvExists) {
      db.run(
        `INSERT INTO pageviews (id, session_id, site_id, url, path, title, ts, client_ts, device, viewport_w, viewport_h, doc_h, max_scroll)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        pv.id, payload.sid, site.id, pv.url, path, pv.title, now, pv.ts, device, pv.vw, pv.vh, pv.dh, Math.min(pv.sy, pv.dh || pv.sy),
      );
    } else {
      db.run(
        `UPDATE pageviews SET url = ?, title = COALESCE(NULLIF(?, ''), title), doc_h = MAX(doc_h, ?), max_scroll = MAX(max_scroll, ?)
         WHERE id = ? AND session_id = ?`,
        pv.url, pv.title, pv.dh, Math.min(pv.sy, pv.dh || pv.sy), pv.id, payload.sid,
      );
    }

    for (const c of clicks) {
      db.run(
        'INSERT INTO clicks (session_id, site_id, path, device, ts, selector, rel_x, rel_y, page_x, page_y, rage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        payload.sid, site.id, path, device, now, c.s, c.rx, c.ry, c.x, c.y, c.r ? 1 : 0,
      );
    }
    for (const m of moves) {
      db.run(
        'INSERT INTO moves (session_id, site_id, path, device, ts, selector, rel_x, rel_y, page_x, page_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        payload.sid, site.id, path, device, now, m.s, m.rx, m.ry, m.x, m.y,
      );
    }

    if (chunk) {
      db.run(
        'INSERT INTO recording_chunks (session_id, ts_start, ts_end, event_count, data) VALUES (?, ?, ?, ?, ?)',
        payload.sid, minTs, maxTs, events.length, chunk,
      );
    }

    let tags: string | null = null;
    if (payload.tags?.length) {
      const merged = new Set<string>(JSON.parse(existing?.tags ?? '[]'));
      for (const t of payload.tags) if (merged.size < MAX_TAGS) merged.add(t);
      tags = JSON.stringify([...merged]);
    }

    db.run(
      `UPDATE sessions SET
         page_count = page_count + ?, click_count = click_count + ?, rage_clicks = rage_clicks + ?,
         error_count = error_count + ?, recording_bytes = recording_bytes + ?,
         tags = COALESCE(?, tags), user_id = COALESCE(?, user_id), user_attrs = COALESCE(?, user_attrs)
       WHERE id = ?`,
      pvExists ? 0 : 1, clicks.length, rageClicks, payload.errors ?? 0, chunk?.length ?? 0,
      tags, payload.identity?.id ?? null, payload.identity?.attrs ? JSON.stringify(payload.identity.attrs) : null,
      payload.sid,
    );

    if (snapshot) {
      db.run(
        `INSERT INTO snapshots (site_id, path, device, ts, width, height, data) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (site_id, path, device) DO UPDATE SET ts = excluded.ts, width = excluded.width, height = excluded.height, data = excluded.data`,
        site.id, snapshot.path, snapshot.device, snapshot.ts, snapshot.width, snapshot.height, snapshot.data,
      );
    }
  });
}

export function parseFeedbackPayload(input: unknown): FeedbackPayload {
  if (!input || typeof input !== 'object') throw badRequest('invalid payload');
  const p = input as Record<string, unknown>;
  const rating = int(p.rating);
  if (rating < 1 || rating > 5) throw badRequest('rating must be 1-5');
  return {
    site: str(p.site, 64),
    sid: typeof p.sid === 'string' && ID_RE.test(p.sid) ? p.sid : '',
    vid: typeof p.vid === 'string' && ID_RE.test(p.vid) ? p.vid : '',
    url: str(p.url, 2000),
    vw: clamp(int(p.vw), 0, 20000),
    rating,
    comment: str(p.comment, 2000).trim(),
  };
}

export function saveFeedback(db: Database, site: Site, fb: FeedbackPayload, now = Date.now()): void {
  db.run(
    'INSERT INTO feedback (site_id, session_id, visitor_id, url, path, device, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    site.id, fb.sid || null, fb.vid || null, fb.url, pageKey(fb.url), deviceForWidth(fb.vw), fb.rating, fb.comment || null, now,
  );
}
