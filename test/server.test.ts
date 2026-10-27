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
const TEST_SID = '44444444-4444-4444-8444-444444444444';
const TEST_PVID = '55555555-5555-4555-8555-555555555555';

let app: FastifyInstance;
let db: Database;
let cookie = '';

function api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, payload: payload as object, headers: { cookie } });
}

function collect(body: unknown, opts: { gzip?: boolean; origin?: string; host?: string } = {}) {
  const json = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: opts.gzip ? '/i/collect?enc=gzip' : '/i/collect',
    payload: opts.gzip ? zlib.gzipSync(json) : json,
    headers: {
      'content-type': 'text/plain',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.host ? { host: opts.host } : {}),
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
  const version = { commit: 'abc1234', date: '2026-10-26T12:00:00+01:00' };
  ({ app } = await buildApp({ config: loadConfig({ dataDir: '/nonexistent', version }), db, logger: false }));
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
    // The running version is only shown to signed-in users.
    assert.deepEqual(me.json(), { user: null, needsSetup: true, version: null });

    const res = await api('POST', '/api/auth/setup', { email: 'Owner@Example.com', password: 'correct horse' });
    assert.equal(res.statusCode, 200);
    cookie = String(res.headers['set-cookie']).split(';')[0];
    assert.match(cookie, /^jj_session=/);

    const again = await api('POST', '/api/auth/setup', { email: 'other@example.com', password: 'another password' });
    assert.equal(again.statusCode, 409);

    const after = await api('GET', '/api/auth/me');
    assert.equal(after.json().user.email, 'owner@example.com');
    assert.deepEqual(after.json().version, { commit: 'abc1234', date: '2026-10-26T12:00:00+01:00' });
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
    assert.equal(config.json().feedback.title, 'How would you rate your experience?');
  });

  it('rejects unknown sites and disallowed origins', async () => {
    assert.equal((await collect(batch('nope'))).statusCode, 404);
    assert.equal((await collect(batch(siteId), { origin: 'https://attacker.test' })).statusCode, 403);
  });

  it("accepts data from jarjar's own origin (the demo/test page) whatever the allow-list says", async () => {
    const config = await app.inject({
      method: 'GET',
      url: `/i/config?site=${siteId}`,
      headers: { host: 'jarjar.local', 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(config.statusCode, 200);
    const t = Date.now();
    const res = await collect(
      {
        site: siteId,
        sid: TEST_SID,
        vid: VID,
        pv: { id: TEST_PVID, url: 'https://jarjar.local/demo?site=x', title: 'Demo', ts: t, vw: 1280, vh: 800, dh: 2000, sy: 800 },
        events: [{ type: 4, timestamp: t, data: { href: 'https://jarjar.local/demo', width: 1280, height: 800 } }],
        tags: ['jarjar_test'],
      },
      { origin: 'https://jarjar.local', host: 'jarjar.local' },
    );
    assert.equal(res.statusCode, 204, res.body);
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

  it('deletes test-page sessions only', async () => {
    const res = await api('DELETE', `/api/sites/${siteId}/test-data`);
    assert.deepEqual(res.json(), { sessions: 1 });
    assert.equal(db.get('SELECT 1 AS x FROM sessions WHERE id = ?', TEST_SID), undefined);
    assert.ok(db.get('SELECT 1 AS x FROM sessions WHERE id = ?', SID));
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

  it('finds a recorded moment for clicks on elements the snapshot may not show', async () => {
    const moments = (selectors: string[]) => api('POST', `/api/sites/${siteId}/heatmaps/moments`, { path: '/pricing', device: 'desktop', selectors });
    const res = await moments(['body>button', 'body>nowhere']);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().length, 1);
    const [m] = res.json();
    assert.equal(m.selector, 'body>button');
    assert.equal(m.count, 2);
    // The latest click, on the visitor's clock so it lines up with the recording.
    const latest = db.get<{ t: number }>("SELECT MAX(client_ts) AS t FROM clicks WHERE session_id = ? AND selector = 'body>button'", SID)!.t;
    assert.deepEqual(m.moment, { session: SID, ts: latest });

    // Clicks stored before the visitor's clock was kept: estimated from the session's clock offset.
    db.run('UPDATE clicks SET client_ts = NULL WHERE session_id = ?', SID);
    const s = db.get<{ offset: number }>('SELECT started_at - first_ts AS offset FROM sessions WHERE id = ?', SID)!;
    const serverTs = db.get<{ t: number }>('SELECT MAX(ts) AS t FROM clicks WHERE session_id = ?', SID)!.t;
    assert.equal((await moments(['body>button'])).json()[0].moment.ts, serverTs - s.offset);

    assert.deepEqual((await moments([])).json(), []);
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

describe('feedback widget and surveys', () => {
  let siteId = '';
  const ORIGIN = { 'content-type': 'text/plain', origin: 'https://www.acme.test' };
  const post = (url: string, body: unknown) => app.inject({ method: 'POST', url, payload: JSON.stringify(body), headers: ORIGIN });
  const trackerConfig = async () => (await app.inject({ method: 'GET', url: `/i/config?site=${siteId}`, headers: { origin: 'https://www.acme.test' } })).json();

  before(async () => {
    // The retention test above expires every login token, so sign in again.
    const res = await api('POST', '/api/auth/login', { email: 'owner@example.com', password: 'correct horse' });
    cookie = String(res.headers['set-cookie']).split(';')[0];
  });

  it('saves widget appearance and targeting, keeping defaults for the rest', async () => {
    siteId = (await api('POST', '/api/sites', { name: 'Acme', domains: 'acme.test' })).json().id;
    const res = await api('PATCH', `/api/sites/${siteId}`, {
      feedback: { enabled: true, position: 'left', style: 'stars', texts: { tab: 'Visszajelzés' }, pages: '/pricing\n/blog/*', devices: ['desktop', 'nope'] },
    });
    assert.equal(res.statusCode, 200, res.body);
    const fb = res.json().feedback;
    assert.equal(fb.position, 'left');
    assert.equal(fb.style, 'stars');
    assert.equal(fb.texts.tab, 'Visszajelzés');
    assert.equal(fb.texts.send, 'Send feedback');
    assert.deepEqual(fb.pages, ['/pricing', '/blog/*']);
    assert.deepEqual(fb.devices, ['desktop']);

    // A later partial update keeps earlier choices.
    const again = (await api('PATCH', `/api/sites/${siteId}`, { feedback: { texts: { send: 'Küldés' } } })).json().feedback;
    assert.equal(again.texts.tab, 'Visszajelzés');
    assert.equal(again.texts.send, 'Küldés');
    assert.equal(again.position, 'left');

    const config = await trackerConfig();
    assert.equal(config.feedback.position, 'left');
    assert.equal(config.feedback.enabled, undefined);
    assert.deepEqual(config.surveys, []);
  });

  it('stores the element a visitor pointed at', async () => {
    const res = await post('/i/feedback', {
      site: siteId, sid: SID, vid: VID, url: 'https://www.acme.test/pricing', vw: 1280, ts: 1700000000000, rating: 2,
      comment: 'This button does nothing', element: { s: 'body>main>button', x: 100, y: 840, w: 220, h: 48 },
    });
    assert.equal(res.statusCode, 204, res.body);
    const item = (await api('GET', `/api/sites/${siteId}/feedback`)).json().items[0];
    assert.deepEqual(item.element, { s: 'body>main>button', x: 100, y: 840, w: 220, h: 48 });
    assert.equal(item.clientTs, 1700000000000);
    assert.equal(item.viewportW, 1280);
  });

  let survey: { id: string; definition: { questions: Array<{ id: string; type: string; options: string[] }> } };

  it('creates surveys from templates, inactive until switched on', async () => {
    const res = await api('POST', `/api/sites/${siteId}/surveys`, { template: 'nps' });
    survey = res.json();
    assert.equal(res.json().name, 'Net Promoter Score');
    assert.equal(res.json().active, false);
    assert.deepEqual(survey.definition.questions.map((q) => q.type), ['nps', 'text']);
    assert.deepEqual((await trackerConfig()).surveys, []);

    // Previewing works for inactive surveys.
    const preview = await app.inject({ method: 'GET', url: `/i/survey?site=${siteId}&id=${survey.id}`, headers: { origin: 'https://www.acme.test' } });
    assert.equal(preview.json().id, survey.id);

    const on = await api('PATCH', `/api/surveys/${survey.id}`, { active: true, definition: { ...survey.definition, pages: ['/pricing'] } });
    assert.equal(on.json().active, true);
    const live = (await trackerConfig()).surveys;
    assert.equal(live.length, 1);
    assert.deepEqual(live[0].pages, ['/pricing']);
  });

  it('cleans up invalid survey definitions', async () => {
    const res = await api('PATCH', `/api/surveys/${survey.id}`, {
      definition: {
        questions: [...survey.definition.questions, { type: 'weird', text: '' }, { type: 'single', text: 'Pick one', options: ['Only'] }],
        trigger: { type: 'scroll', value: 500 },
      },
    });
    const def = res.json().definition;
    assert.deepEqual(def.questions.map((q: { type: string }) => q.type), ['nps', 'text', 'text', 'single']);
    assert.equal(def.questions[2].text, 'Untitled question');
    assert.deepEqual(def.questions[3].options, ['Only', 'Option 2']);
    assert.deepEqual(def.trigger, { type: 'scroll', value: 100 });
    assert.equal(def.questions[0].id, survey.definition.questions[0].id);
  });

  it('collects responses and views, and summarises them', async () => {
    const [nps, text] = survey.definition.questions;
    const base = { site: siteId, survey: survey.id, sid: SID, vid: VID, url: 'https://www.acme.test/pricing', vw: 1280 };
    assert.equal((await post('/i/survey', { ...base, answers: { [nps.id]: 10, [text.id]: 'Fast and simple' } })).statusCode, 204);
    assert.equal((await post('/i/survey', { ...base, answers: { [nps.id]: 3 }, completed: false })).statusCode, 204);
    assert.equal((await post('/i/survey', { ...base, answers: { [nps.id]: 8 } })).statusCode, 204);
    await post('/i/survey/view', { site: siteId, survey: survey.id });
    await post('/i/survey/view', { site: siteId, survey: survey.id });
    assert.equal((await post('/i/survey', { ...base, survey: 'aaaaaaaaaaaa', answers: { x: 1 } })).statusCode, 404);

    const results = (await api('GET', `/api/surveys/${survey.id}/results`)).json();
    assert.equal(results.total, 3);
    assert.equal(results.completed, 2);
    assert.deepEqual(results.allTime, { views: 2, responses: 3 });
    const npsSummary = results.questions[0];
    assert.equal(npsSummary.answered, 3);
    assert.equal(npsSummary.promoters, 1);
    assert.equal(npsSummary.passives, 1);
    assert.equal(npsSummary.detractors, 1);
    assert.equal(npsSummary.score, 0);
    assert.equal(results.responses.find((r: { answers: Record<string, unknown> }) => r.answers[text.id]).answers[text.id], 'Fast and simple');

    const list = (await api('GET', `/api/sites/${siteId}/surveys`)).json();
    assert.equal(list[0].responses, 3);
  });

  it('removes a deleted survey from the tracker config', async () => {
    assert.equal((await api('DELETE', `/api/surveys/${survey.id}`)).statusCode, 200);
    assert.deepEqual((await trackerConfig()).surveys, []);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM survey_responses')!.n, 0);
  });
});

describe('pageKey', () => {
  it('normalizes URLs into heatmap page keys', () => {
    assert.equal(pageKey('https://a.com/'), '/');
    assert.equal(pageKey('https://a.com/pricing/?x=1#top'), '/pricing');
    assert.equal(pageKey('https://a.com/app#/settings?tab=2'), '/app#/settings');
  });
});
