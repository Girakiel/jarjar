import type { FastifyInstance } from 'fastify';
import type { SQLInputValue } from 'node:sqlite';
import type { Database } from '../db';
import { clamp, gunzip, int, notFound, rangeFromQuery, sendJson, str } from '../http';

interface SessionRow {
  id: string;
  site_id: string;
  visitor_id: string;
  started_at: number;
  last_seen_at: number;
  first_ts: number;
  last_ts: number;
  entry_url: string | null;
  referrer: string | null;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  screen_w: number | null;
  screen_h: number | null;
  language: string | null;
  country: string | null;
  page_count: number;
  click_count: number;
  rage_clicks: number;
  dead_clicks: number;
  error_count: number;
  recording_bytes: number;
  user_id: string | null;
  user_attrs: string | null;
  tags: string;
  viewed: number;
}

function toSession(row: SessionRow) {
  return {
    id: row.id,
    siteId: row.site_id,
    visitorId: row.visitor_id,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    duration: Math.max(0, row.last_ts - row.first_ts),
    entryUrl: row.entry_url,
    referrer: row.referrer,
    userAgent: row.user_agent,
    browser: row.browser,
    os: row.os,
    device: row.device,
    screen: row.screen_w && row.screen_h ? `${row.screen_w}×${row.screen_h}` : null,
    language: row.language,
    country: row.country,
    pageCount: row.page_count,
    clickCount: row.click_count,
    rageClicks: row.rage_clicks,
    deadClicks: row.dead_clicks,
    errorCount: row.error_count,
    recordingBytes: row.recording_bytes,
    userId: row.user_id,
    userAttrs: row.user_attrs ? JSON.parse(row.user_attrs) : null,
    tags: JSON.parse(row.tags) as string[],
    viewed: !!row.viewed,
    // Still receiving data within the last 30 seconds.
    live: Date.now() - row.last_seen_at < 30_000,
  };
}

export const TEST_TAG = 'jarjar_test';

const SORTS: Record<string, string> = {
  newest: 's.started_at DESC',
  oldest: 's.started_at ASC',
  longest: '(s.last_ts - s.first_ts) DESC',
  pages: 's.page_count DESC, s.started_at DESC',
  frustration: '(s.rage_clicks * 3 + s.error_count * 2 + s.dead_clicks) DESC, s.started_at DESC',
};

export async function sessionRoutes(app: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  app.get<{ Params: { siteId: string } }>('/sites/:siteId/sessions', async (request) => {
    const q = request.query as Record<string, unknown>;
    const { from, to } = rangeFromQuery(q);
    const where = ['s.site_id = ?', 's.started_at >= ?', 's.started_at < ?', 's.recording_bytes > 0'];
    const params: SQLInputValue[] = [request.params.siteId, from, to];

    const device = str(q.device, 10);
    if (['desktop', 'tablet', 'mobile'].includes(device)) {
      where.push('s.device = ?');
      params.push(device);
    }
    const minDuration = int(q.minDuration);
    if (minDuration > 0) {
      where.push('(s.last_ts - s.first_ts) >= ?');
      params.push(minDuration * 1000);
    }
    if (q.rage === '1') where.push('s.rage_clicks > 0');
    if (q.dead === '1') where.push('s.dead_clicks > 0');
    if (q.errors === '1') where.push('s.error_count > 0');
    if (q.unviewed === '1') where.push('s.viewed = 0');
    const page = str(q.page, 500).trim();
    if (page) {
      where.push("EXISTS (SELECT 1 FROM pageviews p WHERE p.session_id = s.id AND p.path LIKE ? ESCAPE '\\')");
      params.push(`%${page.replace(/[\\%_]/g, '\\$&')}%`);
    }
    const tag = str(q.tag, 100).trim();
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = ?)');
      params.push(tag);
    }
    const user = str(q.user, 200).trim();
    if (user) {
      where.push('(s.user_id = ? OR s.visitor_id = ?)');
      params.push(user, user);
    }

    const limit = clamp(int(q.limit, 50), 1, 200);
    const offset = clamp(int(q.offset), 0, 1_000_000);
    const order = SORTS[str(q.sort, 20)] ?? SORTS.newest;
    const whereSql = where.join(' AND ');

    // Filters vary per request, so these are prepared on the fly rather than cached.
    const total = (db.raw.prepare(`SELECT COUNT(*) AS n FROM sessions s WHERE ${whereSql}`).get(...params) as { n: number }).n;
    const rows = db.raw
      .prepare(`SELECT s.* FROM sessions s WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as SessionRow[];
    return { total, sessions: rows.map(toSession) };
  });

  app.get<{ Params: { siteId: string } }>('/sites/:siteId/tags', async (request) => {
    return db
      .all<{ value: string; count: number }>(
        `SELECT j.value AS value, COUNT(*) AS count FROM sessions s, json_each(s.tags) j
         WHERE s.site_id = ? AND s.started_at > ? GROUP BY j.value ORDER BY count DESC LIMIT 100`,
        request.params.siteId, Date.now() - 90 * 86_400_000,
      )
      .map((r) => ({ name: r.value, count: r.count }));
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (request) => {
    const row = db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', request.params.id);
    if (!row) throw notFound('Recording not found');
    db.run('UPDATE sessions SET viewed = 1 WHERE id = ?', row.id);
    const pageviews = db.all(
      'SELECT id, url, path, title, client_ts AS ts, device, viewport_w AS viewportW, viewport_h AS viewportH, doc_h AS docH, max_scroll AS maxScroll FROM pageviews WHERE session_id = ? ORDER BY client_ts',
      row.id,
    );
    const feedback = db.all('SELECT rating, comment, created_at AS createdAt FROM feedback WHERE session_id = ? ORDER BY created_at', row.id);
    const neighbours = db.get<{ prev: string | null; next: string | null }>(
      `SELECT
         (SELECT id FROM sessions WHERE site_id = ? AND recording_bytes > 0 AND started_at > ? ORDER BY started_at ASC LIMIT 1) AS prev,
         (SELECT id FROM sessions WHERE site_id = ? AND recording_bytes > 0 AND started_at < ? ORDER BY started_at DESC LIMIT 1) AS next`,
      row.site_id, row.started_at, row.site_id, row.started_at,
    );
    return { session: { ...toSession(row), viewed: true }, pageviews, feedback, newer: neighbours?.prev ?? null, older: neighbours?.next ?? null };
  });

  // All rrweb events of a session, concatenated from the stored chunks without re-parsing them.
  app.get<{ Params: { id: string } }>('/sessions/:id/events', async (request, reply) => {
    const exists = db.get('SELECT 1 AS x FROM sessions WHERE id = ?', request.params.id);
    if (!exists) throw notFound('Recording not found');
    const chunks = db.all<{ data: Uint8Array }>('SELECT data FROM recording_chunks WHERE session_id = ? ORDER BY ts_start, id', request.params.id);
    const parts: string[] = [];
    for (const chunk of chunks) {
      const json = (await gunzip(chunk.data)).toString('utf8');
      const inner = json.slice(1, -1);
      if (inner) parts.push(inner);
    }
    return sendJson(request, reply, `[${parts.join(',')}]`);
  });

  // Removes everything recorded on jarjar's demo/test page, which tags its sessions with TEST_TAG.
  app.delete<{ Params: { siteId: string } }>('/sites/:siteId/test-data', async (request) => {
    const siteId = request.params.siteId;
    const sessions = db.transaction(() => {
      const ids = `SELECT s.id FROM sessions s WHERE s.site_id = ? AND EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = '${TEST_TAG}')`;
      db.run(`DELETE FROM feedback WHERE site_id = ? AND session_id IN (${ids})`, siteId, siteId);
      db.run(`DELETE FROM survey_responses WHERE site_id = ? AND session_id IN (${ids})`, siteId, siteId);
      db.run("DELETE FROM snapshots WHERE site_id = ? AND path LIKE '/demo%'", siteId);
      return db.run(`DELETE FROM sessions WHERE id IN (${ids})`, siteId).changes;
    });
    return { sessions };
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', async (request) => {
    const { changes } = db.run('DELETE FROM sessions WHERE id = ?', request.params.id);
    if (!changes) throw notFound('Recording not found');
    return { ok: true };
  });
}
