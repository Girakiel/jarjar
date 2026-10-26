import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domains TEXT NOT NULL DEFAULT '',
    sample_rate INTEGER NOT NULL DEFAULT 100,
    mask_all_text INTEGER NOT NULL DEFAULT 0,
    respect_dnt INTEGER NOT NULL DEFAULT 1,
    feedback_enabled INTEGER NOT NULL DEFAULT 0,
    feedback_title TEXT NOT NULL DEFAULT 'How would you rate your experience?',
    feedback_color TEXT NOT NULL DEFAULT '#6e56cf',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    visitor_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,      -- server time
    last_seen_at INTEGER NOT NULL,    -- server time
    first_ts INTEGER NOT NULL,        -- client time of the first event (for duration)
    last_ts INTEGER NOT NULL,
    entry_url TEXT,
    referrer TEXT,
    user_agent TEXT,
    browser TEXT,
    os TEXT,
    device TEXT,
    screen_w INTEGER,
    screen_h INTEGER,
    language TEXT,
    country TEXT,
    page_count INTEGER NOT NULL DEFAULT 0,
    click_count INTEGER NOT NULL DEFAULT 0,
    rage_clicks INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    recording_bytes INTEGER NOT NULL DEFAULT 0,
    user_id TEXT,
    user_attrs TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    viewed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_site_started ON sessions(site_id, started_at);

  CREATE TABLE pageviews (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    site_id TEXT NOT NULL,
    url TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    ts INTEGER NOT NULL,              -- server time
    client_ts INTEGER NOT NULL,
    device TEXT NOT NULL,
    viewport_w INTEGER NOT NULL,
    viewport_h INTEGER NOT NULL,
    doc_h INTEGER NOT NULL DEFAULT 0,
    max_scroll INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX pageviews_site_path ON pageviews(site_id, path, device, ts);
  CREATE INDEX pageviews_site_ts ON pageviews(site_id, ts);
  CREATE INDEX pageviews_session ON pageviews(session_id);

  CREATE TABLE clicks (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    site_id TEXT NOT NULL,
    path TEXT NOT NULL,
    device TEXT NOT NULL,
    ts INTEGER NOT NULL,
    selector TEXT NOT NULL,
    rel_x REAL NOT NULL,
    rel_y REAL NOT NULL,
    page_x INTEGER NOT NULL,
    page_y INTEGER NOT NULL,
    rage INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX clicks_lookup ON clicks(site_id, path, device, ts);
  CREATE INDEX clicks_session ON clicks(session_id);

  CREATE TABLE moves (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    site_id TEXT NOT NULL,
    path TEXT NOT NULL,
    device TEXT NOT NULL,
    ts INTEGER NOT NULL,
    selector TEXT NOT NULL,
    rel_x REAL NOT NULL,
    rel_y REAL NOT NULL,
    page_x INTEGER NOT NULL,
    page_y INTEGER NOT NULL
  );
  CREATE INDEX moves_lookup ON moves(site_id, path, device, ts);
  CREATE INDEX moves_session ON moves(session_id);

  -- rrweb events, gzipped JSON arrays in arrival order.
  CREATE TABLE recording_chunks (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_start INTEGER NOT NULL,
    ts_end INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    data BLOB NOT NULL
  );
  CREATE INDEX chunks_session ON recording_chunks(session_id, id);

  -- Latest rrweb full snapshot per page and device: the backdrop heatmaps are drawn on.
  CREATE TABLE snapshots (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    device TEXT NOT NULL,
    ts INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (site_id, path, device)
  );

  CREATE TABLE feedback (
    id INTEGER PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    session_id TEXT,
    visitor_id TEXT,
    url TEXT,
    path TEXT,
    device TEXT,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX feedback_site ON feedback(site_id, created_at);
  `,
  `
  -- Widget appearance and targeting (position, style, texts, pages, devices) as JSON.
  ALTER TABLE sites ADD COLUMN feedback_config TEXT NOT NULL DEFAULT '{}';

  -- The element a visitor pointed at ({s, x, y, w, h}) and when, for linking to the recording.
  ALTER TABLE feedback ADD COLUMN element TEXT;
  ALTER TABLE feedback ADD COLUMN viewport_w INTEGER;
  ALTER TABLE feedback ADD COLUMN client_ts INTEGER;

  CREATE TABLE surveys (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    definition TEXT NOT NULL,         -- questions, trigger, targeting, look (JSON)
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX surveys_site ON surveys(site_id);

  CREATE TABLE survey_responses (
    id INTEGER PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    site_id TEXT NOT NULL,
    session_id TEXT,
    visitor_id TEXT,
    url TEXT,
    path TEXT,
    device TEXT,
    answers TEXT NOT NULL,            -- {questionId: answer}
    completed INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX survey_responses_survey ON survey_responses(survey_id, created_at);
  `,
  `
  -- Clicks after which nothing on the page changed, and a short visible label of the clicked element.
  ALTER TABLE clicks ADD COLUMN dead INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE clicks ADD COLUMN label TEXT;
  ALTER TABLE sessions ADD COLUMN dead_clicks INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE js_errors (
    site_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    message TEXT NOT NULL,
    count INTEGER NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX js_errors_site ON js_errors(site_id, ts);
  CREATE INDEX js_errors_session ON js_errors(session_id);

  -- One row per form a visitor started on a page; values are never stored.
  CREATE TABLE form_interactions (
    site_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    form TEXT NOT NULL,
    label TEXT,
    fields INTEGER NOT NULL,
    last_field TEXT,
    submitted INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX forms_unique ON form_interactions(session_id, path, form);
  CREATE INDEX forms_site ON form_interactions(site_id, ts);

  -- jarjar('event', name) calls with their time, for funnels.
  CREATE TABLE custom_events (
    site_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX custom_events_site ON custom_events(site_id, ts);
  CREATE INDEX custom_events_session ON custom_events(session_id);

  CREATE TABLE funnels (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    steps TEXT NOT NULL,              -- [{type: 'page' | 'event', value}]
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX funnels_site ON funnels(site_id);

  -- Insights the owner marked as handled.
  CREATE TABLE insight_dismissals (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (site_id, key)
  );
  `,
];

export type Row = Record<string, SQLInputValue>;

export class Database {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    const { user_version: version } = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version === 0) this.raw.exec('PRAGMA auto_vacuum = INCREMENTAL; VACUUM;');
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}
