// Page-to-page paths through the site, built from page views.
import type { Database } from './db';

export const EXIT = '(exit)';

export interface Journey {
  session: string;
  paths: string[]; // in order, consecutive repeats collapsed
  recorded: boolean;
  duration: number;
}

/** Journeys of sessions that started in [from, to). */
export function loadJourneys(db: Database, siteId: string, from: number, to: number): Journey[] {
  const rows = db.all<{ session_id: string; path: string; recorded: number; duration: number }>(
    `SELECT p.session_id, p.path, (s.recording_bytes > 0) AS recorded, (s.last_ts - s.first_ts) AS duration
     FROM pageviews p JOIN sessions s ON s.id = p.session_id
     WHERE s.site_id = ? AND s.started_at >= ? AND s.started_at < ?
     ORDER BY s.started_at, p.session_id, p.client_ts
     LIMIT 500000`,
    siteId, from, to,
  );
  const journeys: Journey[] = [];
  let current: Journey | null = null;
  for (const row of rows) {
    if (!current || current.session !== row.session_id) {
      current = { session: row.session_id, paths: [], recorded: !!row.recorded, duration: row.duration };
      journeys.push(current);
    }
    if (current.paths[current.paths.length - 1] !== row.path) current.paths.push(row.path);
  }
  return journeys;
}

function startOf(paths: string[], prefix: string[], anywhere: boolean): number {
  const matchesAt = (i: number) => prefix.every((p, k) => paths[i + k] === p);
  if (!anywhere || prefix.length === 0) return matchesAt(0) ? 0 : -1;
  for (let i = 0; i + prefix.length <= paths.length; i++) if (matchesAt(i)) return i;
  return -1;
}

export interface NextStep {
  path: string; // or EXIT
  count: number;
  examples: string[]; // recorded sessions that went this way
}

/**
 * Where visitors went after following `prefix` (from the start of their visit,
 * or from anywhere in it). With an empty prefix this is the entry pages.
 */
export function exploreNext(journeys: Journey[], prefix: string[], anywhere: boolean): { matching: number; next: NextStep[] } {
  const next = new Map<string, NextStep>();
  let matching = 0;
  for (const j of journeys) {
    const start = startOf(j.paths, prefix, anywhere);
    if (start < 0) continue;
    matching++;
    const path = j.paths[start + prefix.length] ?? EXIT;
    const step = next.get(path) ?? { path, count: 0, examples: [] };
    step.count++;
    if (j.recorded && step.examples.length < 5) step.examples.push(j.session);
    next.set(path, step);
  }
  return { matching, next: [...next.values()].sort((a, b) => b.count - a.count) };
}

/** The most common page sequences, looking at the first `depth` pages of each visit. */
export function topPaths(journeys: Journey[], depth = 4, limit = 15) {
  const counts = new Map<string, { steps: string[]; more: boolean; count: number; examples: string[] }>();
  for (const j of journeys) {
    const steps = j.paths.slice(0, depth);
    const more = j.paths.length > depth;
    const key = steps.join('\u0001') + (more ? '\u0001…' : '');
    const entry = counts.get(key) ?? { steps, more, count: 0, examples: [] };
    entry.count++;
    if (j.recorded && entry.examples.length < 3) entry.examples.push(j.session);
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
