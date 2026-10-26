import type { FastifyInstance } from 'fastify';
import { DEVICES, type Device } from '../../shared/protocol';
import type { Database } from '../db';
import { badRequest, notFound, rangeFromQuery, sendGzippedJson, sendJson, str } from '../http';

type Params = { siteId: string };

const MAX_CLICK_POINTS = 50_000;
const MAX_MOVE_POINTS = 60_000;
const MAX_SCROLL_ROWS = 50_000;

function deviceParam(value: unknown): Device {
  const device = str(value, 10) as Device;
  if (!DEVICES.includes(device)) throw badRequest('device must be desktop, tablet or mobile');
  return device;
}

function pathParam(value: unknown): string {
  const path = str(value, 2000);
  if (!path) throw badRequest('path is required');
  return path;
}

interface PointRow {
  selector: string;
  rel_x: number;
  rel_y: number;
  page_x: number;
  page_y: number;
}

/** Dedupes selectors so a point is [selectorIndex, relX, relY, pageX, pageY]. */
function encodePoints(rows: PointRow[]) {
  const selectors: string[] = [];
  const index = new Map<string, number>();
  const points = rows.map((r) => {
    let i = index.get(r.selector);
    if (i === undefined) {
      i = selectors.push(r.selector) - 1;
      index.set(r.selector, i);
    }
    return [i, r.rel_x, r.rel_y, r.page_x, r.page_y];
  });
  return { selectors, points };
}

export async function heatmapRoutes(app: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  app.get<{ Params: Params }>('/sites/:siteId/heatmaps/pages', async (request) => {
    const q = request.query as Record<string, unknown>;
    const { from, to } = rangeFromQuery(q);
    const siteId = request.params.siteId;
    const views = db.all<{ path: string; device: string; views: number }>(
      'SELECT path, device, COUNT(*) AS views FROM pageviews WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY path, device',
      siteId, from, to,
    );
    const clicks = db.all<{ path: string; device: string; clicks: number }>(
      'SELECT path, device, COUNT(*) AS clicks FROM clicks WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY path, device',
      siteId, from, to,
    );
    const snapshots = db.all<{ path: string; device: string; ts: number }>('SELECT path, device, ts FROM snapshots WHERE site_id = ?', siteId);

    type Entry = { path: string; views: number; clicks: number; devices: Record<string, { views: number; clicks: number; snapshotAt: number | null }> };
    const pages = new Map<string, Entry>();
    const entry = (path: string) => {
      let e = pages.get(path);
      if (!e) {
        e = { path, views: 0, clicks: 0, devices: {} };
        for (const d of DEVICES) e.devices[d] = { views: 0, clicks: 0, snapshotAt: null };
        pages.set(path, e);
      }
      return e;
    };
    for (const v of views) {
      const e = entry(v.path);
      e.views += v.views;
      if (e.devices[v.device]) e.devices[v.device].views = v.views;
    }
    for (const c of clicks) {
      const e = entry(c.path);
      e.clicks += c.clicks;
      if (e.devices[c.device]) e.devices[c.device].clicks = c.clicks;
    }
    for (const s of snapshots) {
      const e = pages.get(s.path);
      if (e?.devices[s.device]) e.devices[s.device].snapshotAt = s.ts;
    }
    return [...pages.values()].sort((a, b) => b.views - a.views).slice(0, 500);
  });

  app.get<{ Params: Params }>('/sites/:siteId/heatmaps/snapshot', async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const row = db.get<{ data: Uint8Array }>(
      'SELECT data FROM snapshots WHERE site_id = ? AND path = ? AND device = ?',
      request.params.siteId, pathParam(q.path), deviceParam(q.device),
    );
    if (!row) throw notFound('No snapshot of this page has been captured for this device yet');
    return sendGzippedJson(request, reply, row.data);
  });

  app.get<{ Params: Params }>('/sites/:siteId/heatmaps/data', async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const { from, to } = rangeFromQuery(q);
    const path = pathParam(q.path);
    const device = deviceParam(q.device);
    const type = str(q.type, 10);
    const args = [request.params.siteId, path, device, from, to] as const;
    const filter = 'site_id = ? AND path = ? AND device = ? AND ts >= ? AND ts < ?';
    const pageviews = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pageviews WHERE ${filter}`, ...args)!.n;

    let body: unknown;
    if (type === 'click' || type === 'move') {
      const table = type === 'click' ? 'clicks' : 'moves';
      const limit = type === 'click' ? MAX_CLICK_POINTS : MAX_MOVE_POINTS;
      const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${filter}`, ...args)!.n;
      const rows = db.all<PointRow>(
        `SELECT selector, rel_x, rel_y, page_x, page_y FROM ${table} WHERE ${filter} ORDER BY ts DESC LIMIT ${limit}`,
        ...args,
      );
      const top =
        type === 'click'
          ? db.all(
              `SELECT selector, COUNT(*) AS count, SUM(rage) AS rage FROM clicks WHERE ${filter}
               GROUP BY selector ORDER BY count DESC LIMIT 25`,
              ...args,
            )
          : [];
      body = { type, pageviews, total, ...encodePoints(rows), top };
    } else if (type === 'scroll') {
      const rows = db.all<{ max_scroll: number; doc_h: number; viewport_h: number }>(
        `SELECT max_scroll, doc_h, viewport_h FROM pageviews WHERE ${filter} AND doc_h > 0 LIMIT ${MAX_SCROLL_ROWS}`,
        ...args,
      );
      body = { type, pageviews, total: rows.length, reach: rows.map((r) => [r.max_scroll, r.doc_h, r.viewport_h]) };
    } else {
      throw badRequest('type must be click, move or scroll');
    }
    return sendJson(request, reply, JSON.stringify(body));
  });
}
