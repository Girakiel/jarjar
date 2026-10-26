// Funnels: an ordered list of pages and/or custom events, and how many visits get through each.
import crypto from 'node:crypto';
import { matchesPage } from '../shared/protocol';
import type { Database } from './db';
import { badRequest, str } from './http';

export interface FunnelStep {
  type: 'page' | 'event';
  value: string; // page pattern (`/pricing`, `/blog/*`) or event name
}

export interface FunnelRow {
  id: string;
  site_id: string;
  name: string;
  steps: string;
  created_at: number;
  updated_at: number;
}

export const newFunnelId = () => crypto.randomBytes(6).toString('hex');

const MAX_STEPS = 10;

export function cleanSteps(raw: unknown): FunnelStep[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_STEPS) : [];
  const steps = list.flatMap((s): FunnelStep[] => {
    if (!s || typeof s !== 'object') return [];
    const step = s as Record<string, unknown>;
    const value = str(step.value, 200).trim();
    return value ? [{ type: step.type === 'event' ? 'event' : 'page', value }] : [];
  });
  if (steps.length < 2) throw badRequest('A funnel needs at least two steps');
  return steps;
}

export function parseSteps(json: string): FunnelStep[] {
  try {
    return cleanSteps(JSON.parse(json));
  } catch {
    return [];
  }
}

export function toFunnel(row: FunnelRow) {
  return { id: row.id, siteId: row.site_id, name: row.name, steps: parseSteps(row.steps), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function stepLabel(step: FunnelStep): string {
  return step.type === 'event' ? `event “${step.value}”` : step.value;
}

interface TimelineItem {
  kind: 0 | 1; // page view, custom event
  value: string;
  ts: number;
}

export interface FunnelResult {
  sessions: number; // all visits in the period
  steps: Array<FunnelStep & { count: number; dropped: number; droppedExamples: string[] }>;
  convertedExamples: string[];
}

/** Counts visits (started in [from, to)) that went through the steps in order. */
export function computeFunnel(db: Database, siteId: string, steps: FunnelStep[], from: number, to: number): FunnelResult {
  const range = [siteId, from, to] as const;
  const rows = [
    ...db.all<{ s: string; v: string; t: number }>(
      `SELECT p.session_id AS s, p.path AS v, p.ts AS t FROM pageviews p JOIN sessions s ON s.id = p.session_id
       WHERE s.site_id = ? AND s.started_at >= ? AND s.started_at < ? ORDER BY p.ts, p.client_ts`,
      ...range,
    ).map((r) => ({ ...r, kind: 0 as const })),
    ...db.all<{ s: string; v: string; t: number }>(
      `SELECT e.session_id AS s, e.name AS v, e.ts AS t FROM custom_events e JOIN sessions s ON s.id = e.session_id
       WHERE s.site_id = ? AND s.started_at >= ? AND s.started_at < ?`,
      ...range,
    ).map((r) => ({ ...r, kind: 1 as const })),
  ];
  const recorded = new Set(
    db.all<{ id: string }>('SELECT id FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ? AND recording_bytes > 0', ...range).map((r) => r.id),
  );
  const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ?', ...range)!.n;

  const timelines = new Map<string, TimelineItem[]>();
  for (const r of rows) {
    let list = timelines.get(r.s);
    if (!list) timelines.set(r.s, (list = []));
    list.push({ kind: r.kind, value: r.v, ts: r.t });
  }

  const matches = (step: FunnelStep, item: TimelineItem) =>
    step.type === 'page' ? item.kind === 0 && matchesPage([step.value], item.value) : item.kind === 1 && item.value === step.value;

  // reached[k] = visits that completed steps 0..k
  const reached = new Array(steps.length).fill(0);
  const droppedExamples: string[][] = steps.map(() => []);
  const convertedExamples: string[] = [];
  for (const [session, timeline] of timelines) {
    timeline.sort((a, b) => a.ts - b.ts || a.kind - b.kind);
    let done = 0;
    for (const item of timeline) {
      if (done < steps.length && matches(steps[done], item)) done++;
    }
    for (let k = 0; k < done; k++) reached[k]++;
    if (!recorded.has(session)) continue;
    if (done === steps.length) {
      if (convertedExamples.length < 5) convertedExamples.push(session);
    } else if (done > 0 && droppedExamples[done].length < 5) {
      droppedExamples[done].push(session); // got to step done-1, never reached step done
    }
  }

  return {
    sessions: total,
    steps: steps.map((step, k) => ({
      ...step,
      count: reached[k],
      dropped: k === 0 ? 0 : reached[k - 1] - reached[k],
      droppedExamples: droppedExamples[k],
    })),
    convertedExamples,
  };
}

export function siteFunnels(db: Database, siteId: string) {
  return db.all<FunnelRow>('SELECT * FROM funnels WHERE site_id = ? ORDER BY created_at', siteId).map(toFunnel);
}

