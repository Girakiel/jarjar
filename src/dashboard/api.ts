import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function api<T>(path: string, options: { method?: Method; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('jarjar:unauthorized'));
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

/** Fetches `path` whenever it changes; pass null to skip. Stale responses are dropped. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const id = ++latest.current;
    setLoading(true);
    setError(undefined);
    api<T>(path)
      .then((result) => {
        if (id === latest.current) setData(result);
      })
      .catch((err: ApiError) => {
        if (id === latest.current) setError(err);
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

// ---------- response types ----------

export interface User {
  id: number;
  email: string;
}

export interface Site {
  id: string;
  name: string;
  domains: string[];
  sampleRate: number;
  maskAllText: boolean;
  respectDnt: boolean;
  feedback: { enabled: boolean; title: string; color: string };
  createdAt: number;
  lastSeenAt: number | null;
  sessions30d?: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface Totals {
  sessions: number;
  visitors: number;
  pageviews: number;
  avgDuration: number;
  avgPages: number;
  rageSessions: number;
  errorSessions: number;
}

export interface Overview {
  days: number;
  totals: Totals;
  previous: Totals;
  daily: Array<{ date: string; sessions: number; pageviews: number }>;
  topPages: Array<{ path: string; views: number; avgScroll: number | null }>;
  devices: NameCount[];
  browsers: NameCount[];
  os: NameCount[];
  countries: NameCount[];
  referrers: NameCount[];
  feedback: { count: number; avg: number | null };
}

export interface Session {
  id: string;
  siteId: string;
  visitorId: string;
  startedAt: number;
  lastSeenAt: number;
  duration: number;
  entryUrl: string | null;
  referrer: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: 'desktop' | 'tablet' | 'mobile' | null;
  screen: string | null;
  language: string | null;
  country: string | null;
  pageCount: number;
  clickCount: number;
  rageClicks: number;
  errorCount: number;
  recordingBytes: number;
  userId: string | null;
  userAttrs: Record<string, unknown> | null;
  tags: string[];
  viewed: boolean;
  live: boolean;
}

export interface Pageview {
  id: string;
  url: string;
  path: string;
  title: string | null;
  ts: number;
  device: string;
  viewportW: number;
  viewportH: number;
  docH: number;
  maxScroll: number;
}

export interface SessionDetail {
  session: Session;
  pageviews: Pageview[];
  feedback: Array<{ rating: number; comment: string | null; createdAt: number }>;
  newer: string | null;
  older: string | null;
}

export type Device = 'desktop' | 'tablet' | 'mobile';

export interface HeatmapPage {
  path: string;
  views: number;
  clicks: number;
  devices: Record<Device, { views: number; clicks: number; snapshotAt: number | null }>;
}

export interface PointData {
  type: 'click' | 'move';
  pageviews: number;
  total: number;
  selectors: string[];
  points: Array<[number, number, number, number, number]>;
  top: Array<{ selector: string; count: number; rage: number }>;
}

export interface ScrollData {
  type: 'scroll';
  pageviews: number;
  total: number;
  reach: Array<[number, number, number]>;
}

export interface FeedbackItem {
  id: number;
  sessionId: string | null;
  url: string;
  path: string;
  device: string;
  rating: number;
  comment: string | null;
  createdAt: number;
  hasRecording: number | null;
}

export interface FeedbackList {
  stats: { count: number; avg: number | null; comments: number };
  distribution: Array<{ rating: number; count: number }>;
  items: FeedbackItem[];
}
