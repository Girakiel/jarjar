import type { FastifyInstance } from 'fastify';
import type { Database } from '../db';
import { badRequest, clamp, int, notFound, rangeFromQuery, str } from '../http';
import { pageStats, siteSummaries } from '../pages';
import { cleanFeedbackConfig, normalizeDomain, type SiteRow, type SiteStore } from '../sites';

type Params = { siteId: string };

function parseDomains(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  return [...new Set(list.map((d) => normalizeDomain(String(d))).filter(Boolean))].slice(0, 50);
}

export async function siteRoutes(app: FastifyInstance, opts: { db: Database; sites: SiteStore }): Promise<void> {
  const { db, sites } = opts;

  const requireSite = (id: string) => {
    const site = sites.get(id);
    if (!site) throw notFound('Site not found');
    return site;
  };

  app.get('/sites', async () => {
    const summary = siteSummaries(db);
    return sites.list().map((site) => ({ ...site, ...summary(site.id) }));
  });

  app.get<{ Params: Params }>('/sites/:siteId/pages', async (request) => {
    const site = requireSite(request.params.siteId);
    const { from, to } = rangeFromQuery(request.query as Record<string, unknown>);
    return pageStats(db, site.id, from, to);
  });

  app.post('/sites', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(body.name, 100).trim();
    if (!name) throw badRequest('Name is required');
    return sites.create(name, parseDomains(body.domains));
  });

  app.get<{ Params: Params }>('/sites/:siteId', async (request) => {
    const site = requireSite(request.params.siteId);
    const last = db.get<{ t: number | null }>('SELECT MAX(last_seen_at) AS t FROM sessions WHERE site_id = ?', site.id);
    return { ...site, lastSeenAt: last?.t ?? null };
  });

  app.patch<{ Params: Params }>('/sites/:siteId', async (request) => {
    const site = requireSite(request.params.siteId);
    const b = (request.body ?? {}) as Record<string, unknown>;
    const fields: Partial<SiteRow> = {};
    if (b.name !== undefined) {
      const name = str(b.name, 100).trim();
      if (!name) throw badRequest('Name is required');
      fields.name = name;
    }
    if (b.domains !== undefined) fields.domains = parseDomains(b.domains).join(',');
    if (b.sampleRate !== undefined) fields.sample_rate = clamp(int(b.sampleRate, 100), 0, 100);
    if (b.maskAllText !== undefined) fields.mask_all_text = b.maskAllText ? 1 : 0;
    if (b.respectDnt !== undefined) fields.respect_dnt = b.respectDnt ? 1 : 0;
    const fb = b.feedback as Record<string, unknown> | undefined;
    if (fb && typeof fb === 'object') {
      if (fb.enabled !== undefined) fields.feedback_enabled = fb.enabled ? 1 : 0;
      if (fb.title !== undefined) fields.feedback_title = str(fb.title, 200).trim() || 'How would you rate your experience?';
      if (fb.color !== undefined) {
        const color = str(fb.color, 9);
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw badRequest('Color must look like #6e56cf');
        fields.feedback_color = color;
      }
      // Appearance and targeting: merge onto the current settings so partial updates work.
      const current = site.feedback;
      const texts = fb.texts && typeof fb.texts === 'object' ? (fb.texts as Record<string, unknown>) : {};
      fields.feedback_config = JSON.stringify(
        cleanFeedbackConfig({
          position: fb.position ?? current.position,
          style: fb.style ?? current.style,
          allowPick: fb.allowPick ?? current.allowPick,
          texts: { ...current.texts, ...texts },
          pages: fb.pages ?? current.pages,
          devices: fb.devices ?? current.devices,
        }),
      );
    }
    return sites.update(request.params.siteId, fields);
  });

  app.delete<{ Params: Params }>('/sites/:siteId', async (request) => {
    if (!sites.delete(request.params.siteId)) throw notFound('Site not found');
    return { ok: true };
  });

  app.get<{ Params: Params }>('/sites/:siteId/overview', async (request) => {
    const site = requireSite(request.params.siteId);
    const query = request.query as Record<string, unknown>;
    const { from, to, days } = rangeFromQuery(query);
    // Minutes to add to UTC to get the viewer's local time (Date#getTimezoneOffset is the inverse).
    const tzShiftSec = -clamp(int(query.tz), -900, 900) * 60;
    const prevFrom = from - (to - from);

    const totalsSql = `SELECT COUNT(*) AS sessions, COUNT(DISTINCT visitor_id) AS visitors, COALESCE(SUM(page_count), 0) AS pageviews,
        COALESCE(AVG(last_ts - first_ts), 0) AS avgDuration, COALESCE(AVG(page_count), 0) AS avgPages,
        COALESCE(SUM(rage_clicks > 0), 0) AS rageSessions, COALESCE(SUM(error_count > 0), 0) AS errorSessions
      FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ?`;
    const totals = db.get(totalsSql, site.id, from, to)!;
    const previous = db.get(totalsSql, site.id, prevFrom, from)!;

    const daily = db.all(
      `SELECT date((started_at / 1000) + ?, 'unixepoch') AS date, COUNT(*) AS sessions, SUM(page_count) AS pageviews
       FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ? GROUP BY date ORDER BY date`,
      tzShiftSec, site.id, from, to,
    );

    const topPages = db.all(
      `SELECT path, COUNT(*) AS views,
         AVG(CASE WHEN doc_h > 0 THEN MIN(1.0, max_scroll * 1.0 / doc_h) END) AS avgScroll
       FROM pageviews WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY path ORDER BY views DESC LIMIT 10`,
      site.id, from, to,
    );

    const breakdown = (column: 'device' | 'browser' | 'os' | 'country') =>
      db.all(
        `SELECT COALESCE(${column}, 'Unknown') AS name, COUNT(*) AS count FROM sessions
         WHERE site_id = ? AND started_at >= ? AND started_at < ? GROUP BY name ORDER BY count DESC LIMIT 8`,
        site.id, from, to,
      );

    const referrerRows = db.all<{ referrer: string; count: number }>(
      `SELECT referrer, COUNT(*) AS count FROM sessions
       WHERE site_id = ? AND started_at >= ? AND started_at < ? AND referrer IS NOT NULL GROUP BY referrer`,
      site.id, from, to,
    );
    const referrers = new Map<string, number>();
    for (const row of referrerRows) {
      let host = row.referrer;
      try {
        host = new URL(row.referrer).hostname.replace(/^www\./, '');
      } catch {
        /* keep raw value */
      }
      referrers.set(host, (referrers.get(host) ?? 0) + row.count);
    }

    const feedback = db.get(
      'SELECT COUNT(*) AS count, AVG(rating) AS avg FROM feedback WHERE site_id = ? AND created_at >= ? AND created_at < ?',
      site.id, from, to,
    );

    return {
      days,
      totals,
      previous,
      daily,
      topPages,
      devices: breakdown('device'),
      browsers: breakdown('browser'),
      os: breakdown('os'),
      countries: breakdown('country'),
      referrers: [...referrers.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      feedback,
    };
  });
}
