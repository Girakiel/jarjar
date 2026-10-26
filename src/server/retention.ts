import type { Database } from './db';

const BATCH = 500;

/** Deletes sessions (and, via cascades, their recordings and heatmap points) older than the retention window. */
export function purgeExpired(db: Database, retentionDays: number, now = Date.now()): number {
  const cutoff = now - retentionDays * 86_400_000;
  let deleted = 0;
  for (;;) {
    const { changes } = db.run(`DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE started_at < ? LIMIT ${BATCH})`, cutoff);
    deleted += changes;
    if (changes < BATCH) break;
  }
  db.run('DELETE FROM snapshots WHERE ts < ?', cutoff);
  db.run('DELETE FROM auth_tokens WHERE expires_at < ?', now);
  db.raw.exec('PRAGMA incremental_vacuum');
  return deleted;
}

export function scheduleRetention(db: Database, retentionDays: number, log: (msg: string) => void): () => void {
  const run = () => {
    try {
      const n = purgeExpired(db, retentionDays);
      if (n > 0) log(`retention: deleted ${n} sessions older than ${retentionDays} days`);
    } catch (err) {
      log(`retention failed: ${(err as Error).message}`);
    }
  };
  const first = setTimeout(run, 10_000);
  const timer = setInterval(run, 60 * 60 * 1000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
