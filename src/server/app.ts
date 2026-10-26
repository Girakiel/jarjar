import fs from 'node:fs';
import path from 'node:path';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { sessionToken, userForToken, type AuthUser } from './auth';
import type { Config } from './config';
import { Database } from './db';
import { HttpError } from './http';
import { authRoutes } from './routes/auth';
import { feedbackRoutes } from './routes/feedback';
import { heatmapRoutes } from './routes/heatmaps';
import { insightRoutes } from './routes/insights';
import { ingestRoutes } from './routes/ingest';
import { sessionRoutes } from './routes/sessions';
import { siteRoutes } from './routes/sites';
import { surveyRoutes } from './routes/surveys';
import { SiteStore } from './sites';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export interface AppOptions {
  config: Config;
  db?: Database;
  logger?: boolean;
}

export async function buildApp({ config, db: providedDb, logger = true }: AppOptions): Promise<{ app: FastifyInstance; db: Database }> {
  const db = providedDb ?? new Database(path.join(config.dataDir, 'jarjar.db'));
  const sites = new SiteStore(db);

  const app = Fastify({
    logger: logger ? { level: process.env.LOG_LEVEL || 'info' } : false,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });
  app.decorateRequest('user', null);
  app.addHook('onClose', async () => db.close());

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error instanceof HttpError ? error.statusCode : error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) request.log.error(error);
    reply.code(status).send({ error: status >= 500 ? 'Internal server error' : error.message });
  });

  await app.register(ingestRoutes, { prefix: '/i', db, sites });

  await app.register(
    async (api) => {
      api.addHook('onRequest', async (request) => {
        // CSRF: state-changing requests must come from our own origin.
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          const origin = request.headers.origin;
          if (origin && originHost(origin) !== request.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
        }
        request.user = userForToken(db, sessionToken(request)) ?? null;
        if (!request.user && !request.url.startsWith('/api/auth/')) throw new HttpError(401, 'Not signed in');
      });
      await api.register(authRoutes, { prefix: '/auth', db, secureCookies: config.secureCookies });
      await api.register(siteRoutes, { db, sites });
      await api.register(sessionRoutes, { db });
      await api.register(heatmapRoutes, { db });
      await api.register(feedbackRoutes, { db });
      await api.register(surveyRoutes, { db, sites });
      await api.register(insightRoutes, { db, sites });
    },
    { prefix: '/api' },
  );

  app.get('/health', async () => ({ ok: true }));

  // Tracker script. Served with a short cache so updates roll out quickly.
  for (const file of ['t.js', 't.js.map']) {
    app.get(`/${file}`, async (_request, reply) => {
      const full = path.join(config.publicDir, file);
      if (!fs.existsSync(full)) return reply.code(404).type('text/plain').send('Tracker not built. Run `npm run build`.');
      reply
        .type(file.endsWith('.map') ? 'application/json' : 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .header('Access-Control-Allow-Origin', '*');
      return reply.send(fs.createReadStream(full));
    });
  }

  // A sample page with the tracker installed, handy for trying things out: /demo?site=SITE_KEY
  app.get('/demo', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(fs.createReadStream(path.join(config.staticDir, 'demo.html')));
  });

  const hasDashboard = fs.existsSync(path.join(config.dashboardDir, 'index.html'));
  if (hasDashboard) {
    await app.register(fastifyStatic, { root: config.dashboardDir, index: false });
    app.get('/', (_request, reply) => reply.header('Cache-Control', 'no-cache').sendFile('index.html'));
  }
  // Single-page app fallback for dashboard routes.
  app.setNotFoundHandler((request, reply) => {
    const url = request.url;
    if (request.method !== 'GET' || url.startsWith('/api/') || url.startsWith('/i/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!hasDashboard) {
      return reply.type('text/plain').send('Dashboard not built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173.');
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  return { app, db };
}
