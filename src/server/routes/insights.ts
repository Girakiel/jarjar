import type { FastifyInstance } from 'fastify';
import type { Database } from '../db';
import { cleanSteps, computeFunnel, newFunnelId, toFunnel, type FunnelRow } from '../funnels';
import { badRequest, notFound, rangeFromQuery, str } from '../http';
import { computeInsights } from '../insights';
import { exploreNext, loadJourneys, topPaths } from '../journeys';
import type { SiteStore } from '../sites';

type SiteParams = { siteId: string };
type IdParams = { id: string };

export async function insightRoutes(app: FastifyInstance, opts: { db: Database; sites: SiteStore }): Promise<void> {
  const { db, sites } = opts;

  const requireSite = (id: string) => {
    if (!sites.get(id)) throw notFound('Site not found');
  };
  const requireFunnel = (id: string) => {
    const row = db.get<FunnelRow>('SELECT * FROM funnels WHERE id = ?', id);
    if (!row) throw notFound('Funnel not found');
    return row;
  };

  app.get<{ Params: SiteParams }>('/sites/:siteId/insights', async (request) => {
    requireSite(request.params.siteId);
    const { from, to } = rangeFromQuery(request.query as Record<string, unknown>);
    return computeInsights(db, request.params.siteId, from, to);
  });

  app.post<{ Params: SiteParams }>('/sites/:siteId/insights/dismiss', async (request) => {
    requireSite(request.params.siteId);
    const key = str((request.body as Record<string, unknown> | undefined)?.key, 1500);
    if (!key) throw badRequest('key is required');
    db.run('INSERT OR REPLACE INTO insight_dismissals (site_id, key, created_at) VALUES (?, ?, ?)', request.params.siteId, key, Date.now());
    return { ok: true };
  });

  app.delete<{ Params: SiteParams }>('/sites/:siteId/insights/dismiss', async (request) => {
    const key = str((request.query as Record<string, unknown>).key, 1500);
    db.run('DELETE FROM insight_dismissals WHERE site_id = ? AND key = ?', request.params.siteId, key);
    return { ok: true };
  });

  // Path explorer: ?prefix=["/","/pricing"] (JSON) &anchor=entry|any
  app.get<{ Params: SiteParams }>('/sites/:siteId/journeys', async (request) => {
    requireSite(request.params.siteId);
    const q = request.query as Record<string, unknown>;
    const { from, to } = rangeFromQuery(q);
    let prefix: string[] = [];
    try {
      const parsed = JSON.parse(str(q.prefix, 5000) || '[]');
      if (Array.isArray(parsed)) prefix = parsed.map(String).slice(0, 20);
    } catch {
      throw badRequest('prefix must be a JSON array of paths');
    }
    const journeys = loadJourneys(db, request.params.siteId, from, to);
    return {
      sessions: journeys.length,
      prefix,
      ...exploreNext(journeys, prefix, q.anchor === 'any'),
      topPaths: topPaths(journeys),
    };
  });

  app.get<{ Params: SiteParams }>('/sites/:siteId/funnels', async (request) => {
    requireSite(request.params.siteId);
    const { from, to } = rangeFromQuery(request.query as Record<string, unknown>);
    return db
      .all<FunnelRow>('SELECT * FROM funnels WHERE site_id = ? ORDER BY created_at', request.params.siteId)
      .map((row) => {
        const funnel = toFunnel(row);
        const result = computeFunnel(db, row.site_id, funnel.steps, from, to);
        const first = result.steps[0]?.count ?? 0;
        const last = result.steps[result.steps.length - 1]?.count ?? 0;
        return { ...funnel, entered: first, converted: last };
      });
  });

  app.post<{ Params: SiteParams }>('/sites/:siteId/funnels', async (request) => {
    requireSite(request.params.siteId);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(body.name, 100).trim();
    if (!name) throw badRequest('Name is required');
    const steps = cleanSteps(body.steps);
    const id = newFunnelId();
    const now = Date.now();
    db.run('INSERT INTO funnels (id, site_id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, request.params.siteId, name, JSON.stringify(steps), now, now);
    return toFunnel(requireFunnel(id));
  });

  app.get<{ Params: IdParams }>('/funnels/:id', async (request) => {
    const funnel = toFunnel(requireFunnel(request.params.id));
    const { from, to } = rangeFromQuery(request.query as Record<string, unknown>);
    return { funnel, result: computeFunnel(db, funnel.siteId, funnel.steps, from, to) };
  });

  app.patch<{ Params: IdParams }>('/funnels/:id', async (request) => {
    const row = requireFunnel(request.params.id);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = body.name !== undefined ? str(body.name, 100).trim() : row.name;
    if (!name) throw badRequest('Name is required');
    const steps = body.steps !== undefined ? JSON.stringify(cleanSteps(body.steps)) : row.steps;
    db.run('UPDATE funnels SET name = ?, steps = ?, updated_at = ? WHERE id = ?', name, steps, Date.now(), row.id);
    return toFunnel(requireFunnel(row.id));
  });

  app.delete<{ Params: IdParams }>('/funnels/:id', async (request) => {
    const row = requireFunnel(request.params.id);
    db.run('DELETE FROM funnels WHERE id = ?', row.id);
    return { ok: true };
  });
}
