// Public endpoints called by the tracker from any origin.
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ingest, parseCollectPayload, parseFeedbackPayload, parseSurveyResponse, saveFeedback, saveSurveyResponse } from '../ingest';
import { badRequest, HttpError, notFound, str } from '../http';
import { parseSurveyContent, type SurveyRow } from '../surveys';
import { originAllowed, trackerConfig, type Site, type SiteStore } from '../sites';
import { parseUserAgent } from '../ua';
import type { Database } from '../db';

const gunzip = promisify(zlib.gunzip);
const MAX_BODY = 10 * 1024 * 1024;
const MAX_INFLATED = 64 * 1024 * 1024;
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country-code'];

function countryOf(request: FastifyRequest): string | null {
  for (const header of COUNTRY_HEADERS) {
    const value = String(request.headers[header] ?? '').toUpperCase();
    if (/^[A-Z]{2}$/.test(value) && value !== 'XX') return value;
  }
  return null;
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

async function readJson(request: FastifyRequest): Promise<unknown> {
  let body = request.body as Buffer | undefined;
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('empty body');
  if ((request.query as Record<string, string>).enc === 'gzip') {
    try {
      body = await gunzip(body, { maxOutputLength: MAX_INFLATED });
    } catch {
      throw badRequest('invalid gzip body');
    }
  }
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw badRequest('invalid JSON');
  }
}

export async function ingestRoutes(app: FastifyInstance, opts: { db: Database; sites: SiteStore }): Promise<void> {
  const { db, sites } = opts;

  // The tracker sends text/plain to avoid CORS preflights; accept any body as raw bytes.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_BODY }, (_req, body, done) => done(null, body));

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Max-Age', '86400');
  });

  app.options('/*', async (_request, reply) => reply.code(204).send());

  function siteFor(request: FastifyRequest, key: string): Site {
    const site = sites.get(key);
    if (!site) throw new HttpError(404, 'unknown site');
    // jarjar's own demo/test page is always allowed to send data, whatever the site's allow-list says.
    // Browsers omit Origin on same-origin GETs, so fall back to Sec-Fetch-Site for those.
    const origin = request.headers.origin;
    const ownOrigin = origin ? originHost(origin) === request.headers.host : request.headers['sec-fetch-site'] === 'same-origin';
    if (!ownOrigin && !originAllowed(site, origin)) throw new HttpError(403, 'origin not allowed');
    return site;
  }

  app.get('/config', async (request, reply) => {
    const key = str((request.query as Record<string, unknown>).site, 64);
    const site = siteFor(request, key);
    reply.header('Cache-Control', 'public, max-age=60');
    return trackerConfig(site, sites.activeSurveys(site.id));
  });

  app.post('/collect', async (request, reply) => {
    const payload = parseCollectPayload(await readJson(request));
    const site = siteFor(request, payload.site);
    const userAgent = String(request.headers['user-agent'] ?? '');
    if (parseUserAgent(payload.meta?.ua || userAgent).bot) return reply.code(204).send();
    await ingest(db, site, payload, { userAgent, country: countryOf(request) });
    return reply.code(204).send();
  });

  app.post('/feedback', async (request, reply) => {
    const feedback = parseFeedbackPayload(await readJson(request));
    const site = siteFor(request, feedback.site);
    saveFeedback(db, site, feedback);
    return reply.code(204).send();
  });

  // A single survey, active or not, for previewing it from the dashboard's test page.
  app.get('/survey', async (request) => {
    const q = request.query as Record<string, unknown>;
    const site = siteFor(request, str(q.site, 64));
    const row = db.get<SurveyRow>('SELECT * FROM surveys WHERE id = ? AND site_id = ?', str(q.id, 32), site.id);
    if (!row) throw notFound('unknown survey');
    return { id: row.id, ...parseSurveyContent(row.definition) };
  });

  app.post('/survey', async (request, reply) => {
    const response = parseSurveyResponse(await readJson(request));
    const site = siteFor(request, response.site);
    saveSurveyResponse(db, site, response);
    return reply.code(204).send();
  });

  app.post('/survey/view', async (request, reply) => {
    const body = (await readJson(request)) as Record<string, unknown>;
    const site = siteFor(request, str(body.site, 64));
    db.run('UPDATE surveys SET views = views + 1 WHERE id = ? AND site_id = ?', str(body.survey, 32), site.id);
    return reply.code(204).send();
  });
}
