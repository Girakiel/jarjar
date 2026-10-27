import type { FastifyInstance } from 'fastify';
import type { SurveyAnswer } from '../../shared/protocol';
import { parseJsonObject } from '../clean';
import type { Database } from '../db';
import { badRequest, int, notFound, rangeFromQuery, str } from '../http';
import type { SiteStore } from '../sites';
import { cleanSurveyContent, newSurveyId, summarize, TEMPLATES, toSurvey, type SurveyRow } from '../surveys';

type IdParams = { id: string };
type SiteParams = { siteId: string };

export async function surveyRoutes(app: FastifyInstance, opts: { db: Database; sites: SiteStore }): Promise<void> {
  const { db, sites } = opts;

  const requireSurvey = (id: string) => {
    const row = db.get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', id);
    if (!row) throw notFound('Survey not found');
    return row;
  };

  app.get<{ Params: SiteParams }>('/sites/:siteId/surveys', async (request) => {
    const rows = db.all<SurveyRow & { responses: number; last_response: number | null }>(
      `SELECT s.*,
         (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS responses,
         (SELECT MAX(created_at) FROM survey_responses r WHERE r.survey_id = s.id) AS last_response
       FROM surveys s WHERE s.site_id = ? ORDER BY s.created_at DESC`,
      request.params.siteId,
    );
    return rows.map((row) => ({ ...toSurvey(row), responses: row.responses, lastResponseAt: row.last_response }));
  });

  app.post<{ Params: SiteParams }>('/sites/:siteId/surveys', async (request) => {
    const siteId = request.params.siteId;
    if (!sites.get(siteId)) throw notFound('Site not found');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const template = TEMPLATES[str(body.template, 20)] ?? TEMPLATES.blank;
    const id = newSurveyId();
    const now = Date.now();
    db.run(
      'INSERT INTO surveys (id, site_id, name, active, definition, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
      id, siteId, str(body.name, 100).trim() || template.name, JSON.stringify(cleanSurveyContent(template.content)), now, now,
    );
    return toSurvey(requireSurvey(id));
  });

  app.get<{ Params: IdParams }>('/surveys/:id', async (request) => toSurvey(requireSurvey(request.params.id)));

  app.patch<{ Params: IdParams }>('/surveys/:id', async (request) => {
    const row = requireSurvey(request.params.id);
    const body = (request.body ?? {}) as Record<string, unknown>;
    let name = row.name;
    if (body.name !== undefined) {
      name = str(body.name, 100).trim();
      if (!name) throw badRequest('Name is required');
    }
    const active = body.active !== undefined ? (body.active ? 1 : 0) : row.active;
    const definition =
      body.definition && typeof body.definition === 'object'
        ? JSON.stringify(cleanSurveyContent(body.definition as Record<string, unknown>))
        : row.definition;
    db.run('UPDATE surveys SET name = ?, active = ?, definition = ?, updated_at = ? WHERE id = ?', name, active, definition, Date.now(), row.id);
    sites.invalidate(row.site_id);
    return toSurvey(requireSurvey(row.id));
  });

  app.delete<{ Params: IdParams }>('/surveys/:id', async (request) => {
    const row = requireSurvey(request.params.id);
    db.run('DELETE FROM surveys WHERE id = ?', row.id);
    sites.invalidate(row.site_id);
    return { ok: true };
  });

  app.get<{ Params: IdParams }>('/surveys/:id/results', async (request) => {
    const survey = toSurvey(requireSurvey(request.params.id));
    const { from, to } = rangeFromQuery(request.query as Record<string, unknown>);
    const rows = db.all<{
      id: number;
      session_id: string | null;
      path: string;
      device: string;
      answers: string;
      completed: number;
      created_at: number;
      has_recording: number | null;
    }>(
      `SELECT r.id, r.session_id, r.path, r.device, r.answers, r.completed, r.created_at, (s.recording_bytes > 0) AS has_recording
       FROM survey_responses r LEFT JOIN sessions s ON s.id = r.session_id
       WHERE r.survey_id = ? AND r.created_at >= ? AND r.created_at < ?
       ORDER BY r.created_at DESC`,
      survey.id, from, to,
    );
    const responses = rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      hasRecording: !!r.has_recording,
      path: r.path,
      device: r.device,
      completed: !!r.completed,
      answers: parseJsonObject(r.answers) as Record<string, SurveyAnswer>,
      createdAt: r.created_at,
    }));
    const allTime = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM survey_responses WHERE survey_id = ?', survey.id)!.n;
    return {
      survey,
      allTime: { views: survey.views, responses: allTime },
      total: responses.length,
      completed: responses.filter((r) => r.completed).length,
      questions: summarize(survey.definition.questions, responses.map((r) => r.answers)),
      responses: responses.slice(0, 500),
    };
  });

  app.delete<{ Params: IdParams }>('/survey-responses/:id', async (request) => {
    const { changes } = db.run('DELETE FROM survey_responses WHERE id = ?', int(request.params.id));
    if (!changes) throw notFound('Response not found');
    return { ok: true };
  });
}
