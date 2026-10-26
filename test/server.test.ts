import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { Database } from '../src/server/db';
import { purgeExpired } from '../src/server/retention';
import { pageKey } from '../src/shared/protocol';

const SID = '11111111-1111-4111-8111-111111111111';
const VID = '22222222-2222-4222-8222-222222222222';
const PVID = '33333333-3333-4333-8333-333333333333';

let app: FastifyInstance;
let db: Database;
let cookie = '';

function api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, payload: payload as object, headers: { cookie } });
}

function collect(body: unknown, opts: { gzip?: boolean; origin?: string } = {}) {
  const json = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: opts.gzip ? '/i/collect?enc=gzip' : '/i/collect',
    payload: opts.gzip ? zlib.gzipSync(json) : json,
    headers: {
      'content-type': 'text/plain',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
  });
}

function batch(site: string, extra: Record<string, unknown> = {}) {
  const t = Date.now();
  return {
    site,
    sid: SID,
    vid: VID,
    pv: { id: PVID, url: 'https://shop.example.com/pricing/?ref=ad', title: 'Pricing', ts: t, vw: 1280, vh: 800, dh: 3200, sy: 800 },
    ...extra,
  };
}

before(async () => {
  db = new Database(':memory:');
  ({ app } = await buildApp({ config: loadConfig({ dataDir: '/nonexistent' }), db, logger: false }));
});

after(async () => {
  await app.close();
});

describe('auth', () => {
  it('rejects API calls before signing in', async () => {
    const res = await api('GET', '/api/sites');
    assert.equal(res.statusCode, 401);
  });

  it('reports that setup is needed, then creates the first account once', async () => {
    const me = await api('GET', '/api/auth/me');
    assert.deepEqual(me.json(), { user: null, needsSetup: true });

    const res = await api('POST', '/api/auth/setup', { email: 'Owner@Example.com', password: 'correct horse' });
    assert.equal(res.statusCode, 200);
    cookie = String(res.headers['set-cookie']).split(';')[0];
    assert.match(cookie, /^jj_session=/);

    const again = await api('POST', '/api/auth/setup', { email: 'other@example.com', password: 'another password' });
    assert.equal(again.statusCode, 409);

    const after = await api('GET', '/api/auth/me');
    assert.equal(after.json().user.email, 'owner@example.com');
  });

  it('logs in with the right password only', async () => {
    const bad = await api('POST', '/api/auth/login', { email: 'owner@example.com', password: 'wrong password' });
    assert.equal(bad.statusCode, 401);
    const good = await api('POST', '/api/auth/login', { email: 'owner@example.com', password: 'correct horse' });
    assert.equal(good.statusCode, 200);
  });

  it('blocks cross-origin state changes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sites',
      payload: { name: 'Evil' },
      headers: { cookie, origin: 'https://evil.example', host: 'jarjar.local' },
    });
    assert.equal(res.statusCode, 403);
  });
});

describe('tracking', () => {
  let siteId = '';

  it('creates a site and serves its tracker config', async () => {
    const res = await api('POST', '/api/sites', { name: 'Shop', domains: 'https://www.Shop.example.com/' });
    assert.equal(res.statusCode, 200);
    siteId = res.json().id;
    assert.deepEqual(res.json().domains, ['www.shop.example.com']);

    // Widen the allow-list to the apex domain (covers subdomains).
    await api('PATCH', `/api/sites/${siteId}`, { domains: ['example.com'], feedback: { enabled: true } });
    const config = await app.inject({ method: 'GET', url: `/i/config?site=${siteId}`, headers: { origin: 'https://shop.example.com' } });
    assert.equal(config.statusCode, 200);
    assert.equal(config.headers['access-control-allow-origin'], '*');
    assert.equal(config.json().enabled, true);
    assert.equal(config.json().feedback.enabled, true);
  });

  it('rejects unknown sites and disallowed origins', async () => {
    assert.equal((await collect(batch('nope'))).statusCode, 404);
    assert.equal((await collect(batch(siteId), { origin: 'https://attacker.test' })).statusCode, 403);
  });

  it('ingests a gzipped batch with recording, clicks and moves', async () => {
    const t = Date.now();
    const events = [
      { type: 4, timestamp: t, data: { href: 'https://shop.example.com/pricing/?ref=ad', width: 1280, height: 800 } },
      { type: 2, timestamp: t + 1, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } } },
      { type: 3, timestamp: t + 500, data: { source: 1, positions: [] } },
      { type: 5, timestamp: t + 900, data: { tag: 'rage-click', payload: { selector: 'body>button' } } },
    ];
    const res = await collect(
      batch(siteId, {
        meta: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1', sw: 390, sh: 844, lang: 'en-US', ref: 'https://www.google.com/' },
        events,
        clicks: [
          { t: t + 800, s: 'body>button', rx: 0.5, ry: 0.5, x: 100, y: 200 },
          { t: t + 900, s: 'body>button', rx: 0.52, ry: 0.48, x: 101, y: 199, r: 1 },
        ],
        moves: [{ s: 'body>main', rx: 0.1, ry: 0.2, x: 50, y: 60 }],
        errors: 1,
        tags: ['checkout_started'],
        identity: { id: 'user-42', attrs: { plan: 'pro' } },
      }),
      { gzip: true, origin: 'https://shop.example.com' },
    );
    assert.equal(res.statusCode, 204, res.body);

    // A follow-up batch for the same page view only updates it.
    const res2 = await collect(batch(siteId, { pv: { ...batch(siteId).pv, sy: 2400, dh: 3300 } }), { origin: 'https://shop.example.com' });
    assert.equal(res2.statusCode, 204);
  });

  it('lists the session with derived stats', async () => {
    const res = await api('GET', `/api/sites/${siteId}/sessions`);
    const { total, sessions } = res.json();
    assert.equal(total, 1);
    const s = sessions[0];
    assert.equal(s.id, SID);
    assert.equal(s.browser, 'Safari');
    assert.equal(s.os, 'iOS');
    assert.equal(s.pageCount, 1);
    assert.equal(s.clickCount, 2);
    assert.equal(s.rageClicks, 1);
    assert.equal(s.errorCount, 1);
    assert.equal(s.userId, 'user-42');
    assert.deepEqual(s.tags, ['checkout_started']);
    assert.equal(s.referrer, 'https://www.google.com/');
    assert.equal(s.duration, 900);

    const filtered = await api('GET', `/api/sites/${siteId}/sessions?tag=checkout_started&rage=1&page=pricing`);
    assert.equal(filtered.json().total, 1);
    const none = await api('GET', `/api/sites/${siteId}/sessions?device=mobile`);
    assert.equal(none.json().total, 0);
  });

  it('returns the recording events and session details', async () => {
    const events = await api('GET', `/api/sessions/${SID}/events`);
    assert.equal(events.statusCode, 200);
    assert.deepEqual(
      events.json().map((e: { type: number }) => e.type),
      [4, 2, 3, 5],
    );
    const detail = await api('GET', `/api/sessions/${SID}`);
    assert.equal(detail.json().pageviews[0].path, '/pricing');
    assert.equal(detail.json().pageviews[0].maxScroll, 2400);
    assert.equal(detail.json().session.viewed, true);
  });

  it('serves heatmap pages, snapshot and points', async () => {
    const pages = (await api('GET', `/api/sites/${siteId}/heatmaps/pages`)).json();
    assert.equal(pages[0].path, '/pricing');
    assert.equal(pages[0].devices.desktop.clicks, 2);
    assert.ok(pages[0].devices.desktop.snapshotAt);

    const snap = await api('GET', `/api/sites/${siteId}/heatmaps/snapshot?path=/pricing&device=desktop`);
    assert.equal(snap.statusCode, 200);
    assert.deepEqual(
      snap.json().map((e: { type: number }) => e.type),
      [4, 2],
    );

    const clicks = (await api('GET', `/api/sites/${siteId}/heatmaps/data?path=/pricing&device=desktop&type=click`)).json();
    assert.equal(clicks.total, 2);
    assert.deepEqual(clicks.selectors, ['body>button']);
    assert.equal(clicks.top[0].count, 2);
    assert.equal(clicks.top[0].rage, 1);

    const scroll = (await api('GET', `/api/sites/${siteId}/heatmaps/data?path=/pricing&device=desktop&type=scroll`)).json();
    assert.deepEqual(scroll.reach, [[2400, 3300, 800]]);
  });

  it('summarises the site on the overview', async () => {
    const res = (await api('GET', `/api/sites/${siteId}/overview?days=7&tz=-60`)).json();
    assert.equal(res.totals.sessions, 1);
    assert.equal(res.totals.pageviews, 1);
    assert.equal(res.topPages[0].path, '/pricing');
    assert.deepEqual(res.referrers, [{ name: 'google.com', count: 1 }]);
  });

  it('collects feedback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/i/feedback',
      payload: JSON.stringify({ site: siteId, sid: SID, vid: VID, url: 'https://shop.example.com/pricing', vw: 1280, rating: 2, comment: 'Too pricey' }),
      headers: { 'content-type': 'text/plain', origin: 'https://shop.example.com' },
    });
    assert.equal(res.statusCode, 204);
    const list = (await api('GET', `/api/sites/${siteId}/feedback`)).json();
    assert.equal(list.stats.count, 1);
    assert.equal(list.items[0].comment, 'Too pricey');
    assert.equal(list.items[0].hasRecording, 1);
    assert.equal(list.distribution[1].count, 1);
  });

  it('purges sessions past the retention window', () => {
    assert.equal(purgeExpired(db, 30), 0);
    const deleted = purgeExpired(db, 30, Date.now() + 31 * 86_400_000);
    assert.equal(deleted, 1);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM clicks')!.n, 0);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recording_chunks')!.n, 0);
  });
});

describe('pageKey', () => {
  it('normalizes URLs into heatmap page keys', () => {
    assert.equal(pageKey('https://a.com/'), '/');
    assert.equal(pageKey('https://a.com/pricing/?x=1#top'), '/pricing');
    assert.equal(pageKey('https://a.com/app#/settings?tab=2'), '/app#/settings');
  });
});
