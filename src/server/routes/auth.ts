import type { FastifyInstance } from 'fastify';
import {
  createAuthToken,
  hashPassword,
  RateLimiter,
  revokeAuthToken,
  sessionToken,
  setSessionCookie,
  userForToken,
  verifyPassword,
} from '../auth';
import type { Version } from '../config';
import type { Database } from '../db';
import { badRequest, HttpError, str } from '../http';

const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

function credentials(body: unknown): { email: string; password: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = str(b.email, 254).trim().toLowerCase();
  const password = str(b.password, 512);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');
  return { email, password };
}

export async function authRoutes(app: FastifyInstance, opts: { db: Database; secureCookies: boolean; version: Version | null }): Promise<void> {
  const { db, secureCookies, version } = opts;
  const userCount = () => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;

  app.get('/me', async (request) => {
    const user = userForToken(db, sessionToken(request)) ?? null;
    return { user, needsSetup: userCount() === 0, version: user ? version : null };
  });

  // Creates the first account. Closed as soon as one exists.
  app.post('/setup', async (request, reply) => {
    const { email, password } = credentials(request.body);
    const hash = await hashPassword(password);
    const created = db.transaction(() => {
      if (userCount() > 0) return null;
      return db.run('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)', email, hash, Date.now()).lastInsertRowid;
    });
    if (created === null) throw new HttpError(409, 'Setup has already been completed');
    const { token, expiresAt } = createAuthToken(db, created);
    setSessionCookie(reply, token, expiresAt - Date.now(), secureCookies);
    return { user: { id: created, email } };
  });

  app.post('/login', async (request, reply) => {
    if (!loginLimiter.allow(request.ip)) throw new HttpError(429, 'Too many login attempts, try again later');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const email = str(body.email, 254).trim().toLowerCase();
    const password = str(body.password, 512);
    const user = db.get<{ id: number; email: string; password_hash: string }>('SELECT id, email, password_hash FROM users WHERE email = ?', email);
    // Hash even for unknown emails so response time doesn't reveal which accounts exist.
    const ok = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
    if (!user || !ok) throw new HttpError(401, 'Wrong email or password');
    const { token, expiresAt } = createAuthToken(db, user.id);
    setSessionCookie(reply, token, expiresAt - Date.now(), secureCookies);
    return { user: { id: user.id, email: user.email } };
  });

  app.post('/logout', async (request, reply) => {
    const token = sessionToken(request);
    if (token) revokeAuthToken(db, token);
    setSessionCookie(reply, '', 0, secureCookies);
    return { ok: true };
  });
}
