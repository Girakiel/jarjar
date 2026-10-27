import type { FastifyInstance } from 'fastify';
import type { Database } from '../db';
import { int, notFound, rangeFromQuery } from '../http';

export async function feedbackRoutes(app: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  app.get<{ Params: { siteId: string } }>('/sites/:siteId/feedback', async (request) => {
    const q = request.query as Record<string, unknown>;
    const { from, to } = rangeFromQuery(q);
    const siteId = request.params.siteId;
    const rating = int(q.rating);

    const distribution = db.all<{ rating: number; count: number }>(
      'SELECT rating, COUNT(*) AS count FROM feedback WHERE site_id = ? AND created_at >= ? AND created_at < ? GROUP BY rating',
      siteId, from, to,
    );
    const stats = db.get<{ count: number; avg: number | null; comments: number }>(
      `SELECT COUNT(*) AS count, AVG(rating) AS avg, SUM(comment IS NOT NULL) AS comments
       FROM feedback WHERE site_id = ? AND created_at >= ? AND created_at < ?`,
      siteId, from, to,
    )!;
    const items = db
      .all<Record<string, unknown> & { element: string | null }>(
        `SELECT f.id, f.session_id AS sessionId, f.url, f.path, f.device, f.rating, f.comment, f.created_at AS createdAt,
           f.element, f.viewport_w AS viewportW, f.client_ts AS clientTs, (s.recording_bytes > 0) AS hasRecording
         FROM feedback f LEFT JOIN sessions s ON s.id = f.session_id
         WHERE f.site_id = ? AND f.created_at >= ? AND f.created_at < ? AND (? = 0 OR f.rating = ?)
         ORDER BY f.created_at DESC LIMIT 500`,
        siteId, from, to, rating, rating,
      )
      .map((item) => ({ ...item, element: item.element ? JSON.parse(item.element) : null }));
    return {
      stats: { count: stats.count, avg: stats.avg, comments: stats.comments ?? 0 },
      distribution: [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: distribution.find((d) => d.rating === r)?.count ?? 0 })),
      items,
    };
  });

  app.delete<{ Params: { id: string } }>('/feedback/:id', async (request) => {
    const { changes } = db.run('DELETE FROM feedback WHERE id = ?', int(request.params.id));
    if (!changes) throw notFound('Feedback not found');
    return { ok: true };
  });
}
