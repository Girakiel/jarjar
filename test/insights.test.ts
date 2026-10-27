import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { ClickPoint, FormReport } from '../src/shared/protocol';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { Database } from '../src/server/db';
import { ingest, parseCollectPayload, saveFeedback } from '../src/server/ingest';
import { SiteStore, type Site } from '../src/server/sites';

let app: FastifyInstance;
let db: Database;
let site: Site;
let cookie = '';
let clock = Date.now() - 60 * 60 * 1000;
let counter = 0;
const id = (prefix: string) => `${prefix}-${String(++counter).padStart(8, '0')}`;

interface Page {
  path: string;
  clicks?: ClickPoint[];
  errs?: Array<{ m: string; n: number }>;
  forms?: FormReport[];
  tags?: string[];
}

/** Feeds one visit through the real ingestion code, a few seconds per page. */
async function visit(pages: Page[]): Promise<string> {
  const sid = id('session');
  const vid = id('visitor');
  for (const page of pages) {
    clock += 5000;
    const payload = parseCollectPayload({
      site: site.id,
      sid,
      vid,
      pv: { id: id('pageview'), url: `https://shop.test${page.path}`, title: '', ts: clock, vw: 1280, vh: 800, dh: 2400, sy: 800 },
      events: [{ type: 4, timestamp: clock, data: { href: `https://shop.test${page.path}`, width: 1280, height: 800 } }],
      clicks: page.clicks,
      errs: page.errs,
      errors: page.errs?.reduce((sum, e) => sum + e.n, 0),
      forms: page.forms,
      tags: page.tags,
    });
    await ingest(db, site, payload, { userAgent: 'Mozilla/5.0 Chrome/141.0', country: null, now: clock });
  }
  return sid;
}

const click = (selector: string, label: string, extra: Partial<ClickPoint> = {}): ClickPoint => ({ t: clock, s: selector, rx: 0.5, ry: 0.5, x: 200, y: 400, l: label, ...extra });
const PLAN = 'body>main>section:nth-of-type(2)>button';
const PRICE = 'body>main>section:nth-of-type(2)>p';
const SIGNUP_FORM = (submitted: boolean, last: string): FormReport => ({ s: 'body>main>form', label: 'Create account', fields: 2, last, submitted });

function api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, payload: payload as object, headers: { cookie } });
}

before(async () => {
  db = new Database(':memory:');
  ({ app } = await buildApp({ config: loadConfig({ dataDir: '/nonexistent' }), db, logger: false }));
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { email: 'owner@example.com', password: 'correct horse' } });
  cookie = String(res.headers['set-cookie']).split(';')[0];
  site = new SiteStore(db).create('Shop', []);

  // 1: buys
  await visit([
    { path: '/' },
    { path: '/pricing', clicks: [click(PLAN, 'Choose plan')] },
    { path: '/signup', forms: [SIGNUP_FORM(true, 'password')], tags: ['signup_done'] },
    { path: '/thanks' },
  ]);
  // 2: rage-clicks the plan button, dead-clicks the price, leaves
  await visit([
    { path: '/' },
    {
      path: '/pricing',
      clicks: [click(PLAN, 'Choose plan'), click(PLAN, 'Choose plan'), click(PLAN, 'Choose plan', { r: 1 }), click(PLAN, 'Choose plan', { r: 1 }), click(PRICE, '$26/mo', { d: 1 })],
    },
  ]);
  // 3: starts the form, hits an error, gives up at "email"
  await visit([
    { path: '/' },
    { path: '/pricing', clicks: [click(PLAN, 'Choose plan')] },
    { path: '/signup', forms: [SIGNUP_FORM(false, 'email')], errs: [{ m: 'TypeError: plan is undefined', n: 2 }] },
  ]);
  // 4: bounces
  await visit([{ path: '/' }]);
  // 5: dead-clicks the price twice, leaves
  await visit([{ path: '/' }, { path: '/pricing', clicks: [click(PRICE, '$26/mo', { d: 1 }), click(PRICE, '$26/mo', { d: 1 })] }]);
  // 6: looks at pricing, leaves
  await visit([{ path: '/' }, { path: '/pricing' }]);

  for (const comment of ['Too expensive', 'Prices are confusing']) {
    saveFeedback(db, site, { site: site.id, sid: '', vid: '', url: 'https://shop.test/pricing', vw: 1280, rating: 1, comment }, clock);
  }
});

after(async () => {
  await app.close();
});

describe('journeys', () => {
  it('shows entry pages, then where visitors went next', async () => {
    const entry = (await api('GET', `/api/sites/${site.id}/journeys`)).json();
    assert.equal(entry.sessions, 6);
    assert.deepEqual(entry.next.map((s: { path: string; count: number }) => [s.path, s.count]), [['/', 6]]);

    const afterHome = (await api('GET', `/api/sites/${site.id}/journeys?prefix=${encodeURIComponent('["/"]')}`)).json();
    assert.deepEqual(afterHome.next.map((s: { path: string; count: number }) => [s.path, s.count]), [['/pricing', 5], ['(exit)', 1]]);

    const afterPricing = (await api('GET', `/api/sites/${site.id}/journeys?anchor=any&prefix=${encodeURIComponent('["/pricing"]')}`)).json();
    assert.equal(afterPricing.matching, 5);
    assert.deepEqual(afterPricing.next.map((s: { path: string; count: number }) => [s.path, s.count]), [['(exit)', 3], ['/signup', 2]]);
    assert.equal(afterPricing.next[0].examples.length, 3);

    assert.deepEqual(afterHome.topPaths[0], { steps: ['/', '/pricing'], more: false, count: 3, examples: afterHome.topPaths[0].examples });
  });

  it('rejects a malformed prefix', async () => {
    const res = await api('GET', `/api/sites/${site.id}/journeys?prefix=nope`);
    assert.equal(res.statusCode, 400);
  });
});

describe('funnels', () => {
  let funnelId = '';

  it('needs at least two steps', async () => {
    const res = await api('POST', `/api/sites/${site.id}/funnels`, { name: 'Bad', steps: [{ type: 'page', value: '/' }] });
    assert.equal(res.statusCode, 400);
  });

  it('counts visits through page and event steps in order', async () => {
    const created = await api('POST', `/api/sites/${site.id}/funnels`, {
      name: 'Sign-up',
      steps: [
        { type: 'page', value: '/' },
        { type: 'page', value: '/pricing' },
        { type: 'page', value: '/sign*' },
        { type: 'event', value: 'signup_done' },
      ],
    });
    assert.equal(created.statusCode, 200, created.body);
    funnelId = created.json().id;
    const { result } = (await api('GET', `/api/funnels/${funnelId}`)).json();
    assert.deepEqual(result.steps.map((s: { count: number }) => s.count), [6, 5, 2, 1]);
    assert.deepEqual(result.steps.map((s: { dropped: number }) => s.dropped), [0, 1, 3, 1]);
    assert.equal(result.steps[2].droppedExamples.length, 3);
    assert.equal(result.convertedExamples.length, 1);

    const list = (await api('GET', `/api/sites/${site.id}/funnels`)).json();
    assert.equal(list[0].entered, 6);
    assert.equal(list[0].converted, 1);
  });

  it('can be renamed', async () => {
    const res = await api('PATCH', `/api/funnels/${funnelId}`, { name: 'Sign-up flow' });
    assert.equal(res.json().name, 'Sign-up flow');
  });
});

describe('insights', () => {
  type Insight = { key: string; type: string; title: string; detail: string; sessions: number; examples: string[]; quotes?: string[]; severity: string; dismissed: boolean };
  let insights: Insight[] = [];
  const find = (type: string) => insights.find((i) => i.type === type);

  it('summarises frustration across all visits', async () => {
    const res = (await api('GET', `/api/sites/${site.id}/insights`)).json();
    insights = res.insights;
    assert.equal(res.summary.sessions, 6);
    assert.equal(res.summary.frustrated, 3); // rage + dead, error, dead
    assert.equal(res.summary.deadClicks, 3);
    assert.equal(res.summary.formsStarted, 2);
    assert.equal(res.summary.formsAbandoned, 1);
  });

  it('finds the rage-clicked button by its label', () => {
    const rage = find('rage')!;
    assert.equal(rage.title, 'Visitors rage-click “Choose plan” on /pricing');
    assert.equal(rage.detail, '1 visitor clicked it rapidly over and over (20% of visits to this page).');
    assert.equal(rage.examples.length, 1);
  });

  it('finds elements that do nothing when clicked', () => {
    const dead = find('dead')!;
    assert.equal(dead.title, '“$26/mo” on /pricing doesn\'t respond to clicks');
    assert.equal(dead.sessions, 2);
  });

  it('groups JavaScript errors', () => {
    const error = find('error')!;
    assert.equal(error.title, 'JavaScript error: “TypeError: plan is undefined”');
    assert.match(error.detail, /2 times for 1 visitor, on \/signup/);
  });

  it('spots the abandoned form and where people stop', () => {
    const form = find('form')!;
    assert.equal(form.title, '50% of visitors who start the “Create account” form on /signup don\'t send it');
    assert.match(form.detail, /Most stopped at the “email” field/);
  });

  it('flags pages people leave from, but not the thank-you page', () => {
    const exits = insights.filter((i) => i.type === 'exit');
    assert.deepEqual(exits.map((i) => i.key), ['exit:/pricing']);
  });

  it('flags the leakiest funnel step', () => {
    const funnel = find('funnel')!;
    assert.match(funnel.title, /60% drop off in “Sign-up flow” between \/pricing and \/sign\*/);
    assert.equal(funnel.examples.length, 3);
  });

  it('surfaces badly rated pages with what people said', () => {
    const rating = find('rating')!;
    assert.equal(rating.title, 'Visitors rate /pricing 1.0 out of 5');
    assert.deepEqual(rating.quotes?.sort(), ['Prices are confusing', 'Too expensive']);
  });

  it('ranks the most costly problems first', () => {
    const scores = insights.map((i) => (i as unknown as { score: number }).score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it('can dismiss and restore an insight', async () => {
    const key = find('dead')!.key;
    await api('POST', `/api/sites/${site.id}/insights/dismiss`, { key });
    let res = (await api('GET', `/api/sites/${site.id}/insights`)).json();
    assert.equal(res.insights.find((i: Insight) => i.key === key).dismissed, true);
    await api('DELETE', `/api/sites/${site.id}/insights/dismiss?key=${encodeURIComponent(key)}`);
    res = (await api('GET', `/api/sites/${site.id}/insights`)).json();
    assert.equal(res.insights.find((i: Insight) => i.key === key).dismissed, false);
  });
});

describe('site management', () => {
  it('summarises every site for the Sites page', async () => {
    const list = (await api('GET', '/api/sites')).json();
    const shop = list.find((s: { id: string }) => s.id === site.id);
    assert.equal(shop.stats.sessions, 6);
    assert.equal(shop.stats.visitors, 6);
    assert.equal(shop.stats.pageviews, 14);
    assert.equal(shop.stats.pages, 4);
    assert.equal(shop.stats.daily.length, 14);
    assert.equal(shop.stats.daily.reduce((a: number, b: number) => a + b, 0), 6);
    assert.ok(shop.stats.storageBytes > 0);
    assert.ok(shop.lastSeenAt);
  });

  it('reports per-page metrics', async () => {
    const pages = (await api('GET', `/api/sites/${site.id}/pages`)).json();
    assert.deepEqual(pages.map((p: { path: string }) => p.path), ['/', '/pricing', '/signup', '/thanks']);
    const home = pages[0];
    assert.equal(home.views, 6);
    assert.equal(home.entries, 6);
    assert.equal(home.bounceRate, 1 / 6);
    assert.equal(home.exitRate, 1 / 6);
    const pricing = pages[1];
    assert.equal(pricing.visitors, 5);
    assert.equal(pricing.exitRate, 3 / 5);
    assert.equal(pricing.clicks, 9);
    assert.equal(pricing.rageClicks, 2);
    assert.equal(pricing.deadClicks, 3);
    assert.equal(pricing.avgTime, 2000);
    assert.equal(pricing.rating, 1);
    assert.equal(pricing.ratings, 2);
    assert.deepEqual(pricing.devices, []); // these test visits carry no full page snapshots
    assert.equal(pages[2].errors, 2);
  });
});
