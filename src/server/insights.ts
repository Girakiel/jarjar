// Turns raw behavior data into a ranked list of problems worth fixing, each
// with plain-language advice and evidence (example recordings, heatmap).

import type { Database } from './db';
import { computeFunnel, siteFunnels, stepLabel } from './funnels';
import { loadJourneys } from './journeys';

export type InsightType = 'rage' | 'dead' | 'error' | 'form' | 'unseen' | 'shallow' | 'bounce' | 'exit' | 'rating' | 'funnel';
export type Severity = 'high' | 'medium' | 'low';

export interface Insight {
  key: string; // stable id, used to dismiss it
  type: InsightType;
  severity: Severity;
  score: number;
  title: string;
  detail: string;
  fix: string;
  sessions: number; // visits affected
  share: number | null; // of visits to the page (or site)
  path?: string;
  heatmap?: { device: string; type: 'click' | 'scroll' };
  examples: string[]; // recorded sessions showing the problem
  quotes?: string[];
  funnelId?: string;
  dismissed?: boolean;
}

// How much each kind of problem tends to cost you, relative to the others.
const WEIGHTS: Record<InsightType, number> = {
  rage: 3,
  error: 3,
  funnel: 3,
  dead: 2,
  form: 2,
  rating: 2,
  bounce: 1.5,
  exit: 1.5,
  unseen: 1,
  shallow: 1,
};

// Pages where leaving is the expected outcome.
const END_PAGE = /thank|success|confirm|complete|done|receipt|goodbye|logout|unsubscribe/i;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A big share only counts when there's more than a visit or two behind it. */
function severity(sessions: number, share: number | null): Severity {
  const s = share ?? 0;
  if (sessions >= 20 || (sessions >= 5 && s >= 0.1)) return 'high';
  if (sessions >= 3 || (sessions >= 2 && s >= 0.05)) return 'medium';
  return 'low';
}

/** "“Choose plan”", or a description of the element when there's no visible text. */
export function describeElement(label: string | null, selector: string): string {
  if (label) return `“${label}”`;
  const last = (selector.split('>').pop() ?? selector).replace(/:nth-of-type\(\d+\)/g, '');
  return last.startsWith('#') ? `the ${last} element` : `a <${last}> element`;
}

export function computeInsights(db: Database, siteId: string, from: number, to: number) {
  const range = [siteId, from, to] as const;
  const insights: Insight[] = [];
  const add = (insight: Omit<Insight, 'severity' | 'score'>) => {
    insights.push({
      ...insight,
      severity: severity(insight.sessions, insight.share),
      score: insight.sessions * WEIGHTS[insight.type] * (1 + (insight.share ?? 0)),
    });
  };

  const totals = db.get<{ sessions: number; frustrated: number; rage: number; dead: number; errors: number }>(
    `SELECT COUNT(*) AS sessions,
       COALESCE(SUM(rage_clicks > 0 OR dead_clicks > 0 OR error_count > 0), 0) AS frustrated,
       COALESCE(SUM(rage_clicks), 0) AS rage, COALESCE(SUM(dead_clicks), 0) AS dead, COALESCE(SUM(error_count > 0), 0) AS errors
     FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ?`,
    ...range,
  )!;
  const pageSessions = new Map(
    db
      .all<{ path: string; n: number }>('SELECT path, COUNT(DISTINCT session_id) AS n FROM pageviews WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY path', ...range)
      .map((r) => [r.path, r.n]),
  );
  const shareOfPage = (path: string, sessions: number) => {
    const n = pageSessions.get(path);
    return n ? Math.min(1, sessions / n) : null;
  };

  // --- Rage and dead clicks: elements people click repeatedly, or that don't respond -------------
  const clickProblem = (kind: 'rage' | 'dead') => {
    const column = kind === 'rage' ? 'rage' : 'dead';
    const rows = db.all<{ path: string; selector: string; label: string | null; clicks: number; sessions: number }>(
      `SELECT path, selector, MAX(label) AS label, COUNT(*) AS clicks, COUNT(DISTINCT session_id) AS sessions
       FROM clicks WHERE site_id = ? AND ts >= ? AND ts < ? AND ${column} = 1
       GROUP BY path, selector ORDER BY sessions DESC, clicks DESC LIMIT 10`,
      ...range,
    );
    for (const row of rows) {
      if (kind === 'dead' && row.clicks < 2) continue;
      if (kind === 'dead' && insights.some((i) => i.key === `rage:${row.path}:${row.selector}`)) continue;
      const device = db.get<{ device: string }>(
        `SELECT device FROM clicks WHERE site_id = ? AND ts >= ? AND ts < ? AND path = ? AND selector = ? AND ${column} = 1
         GROUP BY device ORDER BY COUNT(*) DESC LIMIT 1`,
        ...range, row.path, row.selector,
      )!.device;
      const examples = db
        .all<{ id: string }>(
          `SELECT DISTINCT c.session_id AS id FROM clicks c JOIN sessions s ON s.id = c.session_id
           WHERE c.site_id = ? AND c.ts >= ? AND c.ts < ? AND c.path = ? AND c.selector = ? AND c.${column} = 1 AND s.recording_bytes > 0 LIMIT 5`,
          ...range, row.path, row.selector,
        )
        .map((r) => r.id);
      const element = describeElement(row.label, row.selector);
      const share = shareOfPage(row.path, row.sessions);
      add(
        kind === 'rage'
          ? {
              key: `rage:${row.path}:${row.selector}`,
              type: 'rage',
              title: `Visitors rage-click ${element} on ${row.path}`,
              detail: `${row.sessions === 1 ? '1 visitor' : `${row.sessions} visitors`} clicked it rapidly over and over${share !== null ? ` (${pct(share)} of visits to this page)` : ''}.`,
              fix: 'Rapid repeated clicks mean people expect something to happen and it doesn\'t, or it\'s too slow. Check that this element responds, shows that it\'s working (a loading state), and isn\'t covered by something else. Watch a recording to see what they were trying to do.',
              sessions: row.sessions,
              share,
              path: row.path,
              heatmap: { device, type: 'click' },
              examples,
            }
          : {
              key: `dead:${row.path}:${row.selector}`,
              type: 'dead',
              title: `${element[0].toUpperCase()}${element.slice(1)} on ${row.path} doesn't respond to clicks`,
              detail: `Clicked ${plural(row.clicks, 'time')} by ${plural(row.sessions, 'visitor')} without anything happening on the page.`,
              fix: 'People think this is clickable. If it should be, make it do something, such as linking to the details. If it shouldn\'t, make it look less like a button or link (no underline, button-like shape or pointer cursor).',
              sessions: row.sessions,
              share,
              path: row.path,
              heatmap: { device, type: 'click' },
              examples,
            },
      );
    }
  };
  clickProblem('rage');
  clickProblem('dead');

  // --- JavaScript errors --------------------------------------------------------------------------
  for (const row of db.all<{ message: string; total: number; sessions: number; paths: string }>(
    `SELECT message, SUM(count) AS total, COUNT(DISTINCT session_id) AS sessions, GROUP_CONCAT(DISTINCT path) AS paths
     FROM js_errors WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY message ORDER BY sessions DESC, total DESC LIMIT 8`,
    ...range,
  )) {
    const paths = row.paths.split(',');
    const examples = db
      .all<{ id: string }>(
        `SELECT DISTINCT e.session_id AS id FROM js_errors e JOIN sessions s ON s.id = e.session_id
         WHERE e.site_id = ? AND e.ts >= ? AND e.ts < ? AND e.message = ? AND s.recording_bytes > 0 LIMIT 5`,
        ...range, row.message,
      )
      .map((r) => r.id);
    add({
      key: `error:${row.message}`,
      type: 'error',
      title: `JavaScript error: “${row.message}”`,
      detail: `Happened ${plural(row.total, 'time')} for ${plural(row.sessions, 'visitor')}, on ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ` and ${paths.length - 3} more` : ''}.`,
      fix: 'Errors can silently break buttons, forms and checkouts, and visitors rarely report them. Send this message to whoever builds the site; the recordings show exactly what the visitor did right before it happened.',
      sessions: row.sessions,
      share: totals.sessions ? row.sessions / totals.sessions : null,
      path: paths[0],
      examples,
    });
  }

  // --- Forms people start but don't send -----------------------------------------------------------
  for (const row of db.all<{ path: string; form: string; label: string | null; started: number; submitted: number }>(
    `SELECT path, form, MAX(label) AS label, COUNT(*) AS started, SUM(submitted) AS submitted
     FROM form_interactions WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY path, form`,
    ...range,
  )) {
    const abandoned = row.started - row.submitted;
    const rate = abandoned / row.started;
    if (abandoned < 1 || rate < 0.3) continue;
    const last = db.get<{ field: string | null }>(
      `SELECT last_field AS field FROM form_interactions
       WHERE site_id = ? AND ts >= ? AND ts < ? AND path = ? AND form = ? AND submitted = 0
       GROUP BY last_field ORDER BY COUNT(*) DESC LIMIT 1`,
      ...range, row.path, row.form,
    );
    const examples = db
      .all<{ id: string }>(
        `SELECT f.session_id AS id FROM form_interactions f JOIN sessions s ON s.id = f.session_id
         WHERE f.site_id = ? AND f.ts >= ? AND f.ts < ? AND f.path = ? AND f.form = ? AND f.submitted = 0 AND s.recording_bytes > 0 LIMIT 5`,
        ...range, row.path, row.form,
      )
      .map((r) => r.id);
    const name = row.label ? `the “${row.label}” form` : 'a form';
    add({
      key: `form:${row.path}:${row.form}`,
      type: 'form',
      title: `${pct(rate)} of visitors who start ${name} on ${row.path} don't send it`,
      detail: `${row.started} started, ${row.submitted} sent.${last?.field ? ` Most stopped at the “${last.field}” field.` : ''}`,
      fix: 'Long or confusing forms lose people. Look at the field where most give up: is it required, unclear, or asking for something people don\'t want to share? Remove optional fields, explain why you ask, and show errors right next to the field.',
      sessions: abandoned,
      share: rate,
      path: row.path,
      examples,
    });
  }

  // --- Content that gets clicked by those who see it, but most never scroll to ----------------------
  for (const row of db.all<{ path: string; device: string; selector: string; label: string | null; clicks: number; y: number }>(
    `SELECT path, device, selector, MAX(label) AS label, COUNT(*) AS clicks, AVG(page_y) AS y
     FROM clicks WHERE site_id = ? AND ts >= ? AND ts < ? AND rage = 0 AND dead = 0
     GROUP BY path, device, selector HAVING clicks >= 2 ORDER BY clicks DESC LIMIT 40`,
    ...range,
  )) {
    const reach = db.get<{ total: number; reached: number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(max_scroll >= ?), 0) AS reached FROM pageviews
       WHERE site_id = ? AND ts >= ? AND ts < ? AND path = ? AND device = ?`,
      Math.round(row.y) + 40, ...range, row.path, row.device,
    )!;
    if (reach.total < 3) continue;
    const rate = reach.reached / reach.total;
    if (rate >= 0.5 || insights.some((i) => i.type === 'unseen' && i.path === row.path)) continue;
    const element = describeElement(row.label, row.selector);
    add({
      key: `unseen:${row.path}:${row.device}:${row.selector}`,
      type: 'unseen',
      title: `Only ${pct(rate)} of ${row.device} visitors scroll far enough to see ${element} on ${row.path}`,
      detail: `It was clicked ${plural(row.clicks, 'time')} by the visitors who found it, but ${reach.total - reach.reached} of ${reach.total} never got that far down.`,
      fix: 'This works for the people who see it, but most don\'t. Move it higher up the page, or add a link or button to it near the top.',
      sessions: reach.total - reach.reached,
      share: 1 - rate,
      path: row.path,
      heatmap: { device: row.device, type: 'scroll' },
      examples: [],
    });
  }

  for (const row of db.all<{ path: string; device: string; views: number; depth: number; screens: number }>(
    `SELECT path, device, COUNT(*) AS views, AVG(MIN(1.0, max_scroll * 1.0 / doc_h)) AS depth, AVG(doc_h * 1.0 / viewport_h) AS screens
     FROM pageviews WHERE site_id = ? AND ts >= ? AND ts < ? AND doc_h > 0 AND viewport_h > 0
     GROUP BY path, device HAVING views >= 5 AND screens >= 2.5 AND depth < 0.4`,
    ...range,
  )) {
    add({
      key: `shallow:${row.path}:${row.device}`,
      type: 'shallow',
      title: `Most ${row.device} visitors see less than half of ${row.path}`,
      detail: `On average they scroll ${pct(row.depth)} of a page that is about ${Math.round(row.screens)} screens long.`,
      fix: 'Put the most important information and the main call to action in the first screen or two, and make it obvious there\'s more below.',
      sessions: row.views,
      share: 1 - row.depth,
      path: row.path,
      heatmap: { device: row.device, type: 'scroll' },
      examples: [],
    });
  }

  // --- Where visits end: quick bounces and pages people leave from ----------------------------------
  const journeys = loadJourneys(db, siteId, from, to);
  const entries = new Map<string, { n: number; bounced: number; examples: string[] }>();
  const middles = new Map<string, { arrived: number; left: number; examples: string[] }>();
  for (const j of journeys) {
    const entry = entries.get(j.paths[0]) ?? { n: 0, bounced: 0, examples: [] };
    entry.n++;
    if (j.paths.length === 1 && j.duration < 10_000) {
      entry.bounced++;
      if (j.recorded && entry.examples.length < 5) entry.examples.push(j.session);
    }
    entries.set(j.paths[0], entry);
    for (let i = 1; i < j.paths.length; i++) {
      const page = middles.get(j.paths[i]) ?? { arrived: 0, left: 0, examples: [] };
      page.arrived++;
      if (i === j.paths.length - 1) {
        page.left++;
        if (j.recorded && page.examples.length < 5) page.examples.push(j.session);
      }
      middles.set(j.paths[i], page);
    }
  }
  for (const [path, e] of entries) {
    const rate = e.bounced / e.n;
    if (e.n < 5 || rate < 0.6) continue;
    add({
      key: `bounce:${path}`,
      type: 'bounce',
      title: `${pct(rate)} of visitors who land on ${path} leave within 10 seconds`,
      detail: `${e.bounced} of ${e.n} visits that started on this page ended there, almost immediately.`,
      fix: 'Check that this page matches what people expected from the link or ad that brought them, loads quickly, and makes the next step obvious in the first screen.',
      sessions: e.bounced,
      share: rate,
      path,
      examples: e.examples,
    });
  }
  for (const [path, p] of middles) {
    const rate = p.left / p.arrived;
    if (p.arrived < 5 || rate < 0.6 || END_PAGE.test(path)) continue;
    add({
      key: `exit:${path}`,
      type: 'exit',
      title: `Many visitors leave the site from ${path}`,
      detail: `${pct(rate)} of visitors who reached this page from elsewhere on the site ended their visit here (${p.left} of ${p.arrived}).`,
      fix: 'If this isn\'t meant to be the last step, watch recordings of visitors who left here to see what stopped them, and look for errors or a missing next step.',
      sessions: p.left,
      share: rate,
      path,
      examples: p.examples,
    });
  }

  // --- Pages visitors rate badly in the feedback widget ---------------------------------------------
  for (const row of db.all<{ path: string; n: number; avg: number }>(
    `SELECT path, COUNT(*) AS n, AVG(rating) AS avg FROM feedback
     WHERE site_id = ? AND created_at >= ? AND created_at < ? GROUP BY path HAVING n >= 2 AND avg <= 2.5`,
    ...range,
  )) {
    const comments = db.all<{ comment: string; session_id: string | null }>(
      `SELECT comment, session_id FROM feedback WHERE site_id = ? AND created_at >= ? AND created_at < ? AND path = ? AND rating <= 2
       ORDER BY created_at DESC LIMIT 20`,
      ...range, row.path,
    );
    add({
      key: `rating:${row.path}`,
      type: 'rating',
      title: `Visitors rate ${row.path} ${row.avg.toFixed(1)} out of 5`,
      detail: `Average of ${plural(row.n, 'feedback response')} in this period.`,
      fix: 'Read what they wrote and watch the linked recordings to see what disappointed them.',
      sessions: row.n,
      share: null,
      path: row.path,
      examples: [...new Set(comments.map((c) => c.session_id).filter((id): id is string => !!id))].slice(0, 5),
      quotes: comments.map((c) => c.comment).filter(Boolean).slice(0, 3),
    });
  }

  // --- The biggest drop-off in each funnel ----------------------------------------------------------
  for (const funnel of siteFunnels(db, siteId)) {
    if (funnel.steps.length < 2) continue;
    const result = computeFunnel(db, siteId, funnel.steps, from, to);
    let worst = -1;
    let rate = 0;
    for (let k = 1; k < result.steps.length; k++) {
      const reached = result.steps[k - 1].count;
      if (reached && result.steps[k].dropped / reached > rate) {
        worst = k;
        rate = result.steps[k].dropped / reached;
      }
    }
    if (worst < 0) continue;
    const before = result.steps[worst - 1];
    const step = result.steps[worst];
    if (step.dropped < 3 || rate < 0.5) continue;
    add({
      key: `funnel:${funnel.id}:${worst}`,
      type: 'funnel',
      title: `${pct(rate)} drop off in “${funnel.name}” between ${stepLabel(before)} and ${stepLabel(step)}`,
      detail: `${before.count} visitors reached ${stepLabel(before)}; ${step.count} went on to ${stepLabel(step)}.`,
      fix: 'This is the leakiest step of the funnel. Watch recordings of visitors who stopped here, and check the page for errors, confusing choices or a missing call to action.',
      sessions: step.dropped,
      share: rate,
      path: before.type === 'page' ? before.value : undefined,
      examples: step.droppedExamples,
      funnelId: funnel.id,
    });
  }

  const forms = db.get<{ started: number; submitted: number }>(
    'SELECT COUNT(*) AS started, COALESCE(SUM(submitted), 0) AS submitted FROM form_interactions WHERE site_id = ? AND ts >= ? AND ts < ?',
    ...range,
  )!;
  const dismissed = new Set(db.all<{ key: string }>('SELECT key FROM insight_dismissals WHERE site_id = ?', siteId).map((r) => r.key));

  return {
    summary: {
      sessions: totals.sessions,
      frustrated: totals.frustrated,
      rageClicks: totals.rage,
      deadClicks: totals.dead,
      errorSessions: totals.errors,
      formsStarted: forms.started,
      formsAbandoned: forms.started - forms.submitted,
    },
    insights: insights.sort((a, b) => b.score - a.score).map((i) => ({ ...i, dismissed: dismissed.has(i.key) })),
  };
}
