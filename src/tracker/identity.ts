// Visitor and session identifiers. Storage access can throw (privacy modes,
// sandboxed iframes), so every call is guarded and falls back to in-memory ids.

const VISITOR_KEY = '_jj_v';
const SESSION_KEY = '_jj_s';
const OPT_OUT_KEY = '_jj_optout';
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export function visitorId(): string {
  let id = read(local, VISITOR_KEY);
  if (!id) {
    id = uuid();
    write(local, VISITOR_KEY, id);
  }
  return id;
}

export interface SessionState {
  id: string;
  sampled: boolean;
  lastActivity: number;
}

/** Session ids live in sessionStorage, so each tab gets its own recording. */
export function loadSession(sampleRate: number, now = Date.now()): SessionState {
  const raw = read(session, SESSION_KEY);
  if (raw) {
    const [id, sampled, last] = raw.split('|');
    const lastActivity = Number(last);
    if (id && now - lastActivity < SESSION_TIMEOUT_MS) {
      return { id, sampled: sampled === '1', lastActivity };
    }
  }
  const state: SessionState = { id: uuid(), sampled: Math.random() * 100 < sampleRate, lastActivity: now };
  saveSession(state);
  return state;
}

export function saveSession(state: SessionState): void {
  write(session, SESSION_KEY, `${state.id}|${state.sampled ? 1 : 0}|${state.lastActivity}`);
}

export function isOptedOut(): boolean {
  return read(local, OPT_OUT_KEY) === '1';
}

export function setOptOut(value: boolean): void {
  write(local, OPT_OUT_KEY, value ? '1' : null);
}

/** Persistent per-visitor flags, e.g. which surveys were already shown. */
export function getLocal(key: string): string | null {
  return read(local, key);
}

export function setLocal(key: string, value: string): void {
  write(local, key, value);
}
