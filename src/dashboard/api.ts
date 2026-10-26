import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackWidgetConfig, PickedElement, QuestionType, SurveyAnswer, SurveyDefinition } from '../shared/protocol';

export type { FeedbackWidgetConfig, PickedElement, QuestionType, SurveyAnswer, SurveyQuestion } from '../shared/protocol';

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
  feedback: FeedbackWidgetConfig & { enabled: boolean };
  createdAt: number;
  lastSeenAt: number | null;
  stats?: SiteStats; // included in the sites list
}

export interface SiteStats {
  sessions: number; // last 30 days
  visitors: number;
  pageviews: number;
  pages: number;
  storageBytes: number; // all recordings kept
  activeSurveys: number;
  daily: number[]; // visits per day, last 14 days, oldest first
}

export interface PageStats {
  path: string;
  title: string | null;
  views: number;
  visitors: number;
  avgTime: number | null;
  avgScroll: number | null;
  entries: number;
  bounceRate: number | null;
  exitRate: number;
  clicks: number;
  rageClicks: number;
  deadClicks: number;
  errors: number;
  rating: number | null;
  ratings: number;
  devices: Device[];
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
  deadClicks: number;
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
  element: PickedElement | null;
  viewportW: number | null;
  clientTs: number | null;
}

export interface FeedbackList {
  stats: { count: number; avg: number | null; comments: number };
  distribution: Array<{ rating: number; count: number }>;
  items: FeedbackItem[];
}

export type SurveyContent = Omit<SurveyDefinition, 'id'>;

export interface Survey {
  id: string;
  siteId: string;
  name: string;
  active: boolean;
  definition: SurveyContent;
  views: number;
  createdAt: number;
  updatedAt: number;
  responses?: number;
  lastResponseAt?: number | null;
}

export interface QuestionSummary {
  id: string;
  type: QuestionType;
  text: string;
  answered: number;
  // NPS
  counts?: number[];
  promoters?: number;
  passives?: number;
  detractors?: number;
  score?: number | null;
  // Choice questions
  options?: Array<{ option: string; count: number }>;
}

export interface SurveyResponseItem {
  id: number;
  sessionId: string | null;
  hasRecording: boolean;
  path: string;
  device: string;
  completed: boolean;
  answers: Record<string, SurveyAnswer>;
  createdAt: number;
}

export interface SurveyResults {
  survey: Survey;
  allTime: { views: number; responses: number };
  total: number;
  completed: number;
  questions: QuestionSummary[];
  responses: SurveyResponseItem[];
}

export type InsightType = 'rage' | 'dead' | 'error' | 'form' | 'unseen' | 'shallow' | 'bounce' | 'exit' | 'rating' | 'funnel';

export interface Insight {
  key: string;
  type: InsightType;
  severity: 'high' | 'medium' | 'low';
  score: number;
  title: string;
  detail: string;
  fix: string;
  sessions: number;
  share: number | null;
  path?: string;
  heatmap?: { device: Device; type: 'click' | 'scroll' };
  examples: string[];
  quotes?: string[];
  funnelId?: string;
  dismissed: boolean;
}

export interface InsightsResponse {
  summary: {
    sessions: number;
    frustrated: number;
    rageClicks: number;
    deadClicks: number;
    errorSessions: number;
    formsStarted: number;
    formsAbandoned: number;
  };
  insights: Insight[];
}

export interface NextStep {
  path: string; // '(exit)' when the visit ended
  count: number;
  examples: string[];
}

export interface JourneysResponse {
  sessions: number;
  prefix: string[];
  matching: number;
  next: NextStep[];
  topPaths: Array<{ steps: string[]; more: boolean; count: number; examples: string[] }>;
}

export interface FunnelStep {
  type: 'page' | 'event';
  value: string;
}

export interface Funnel {
  id: string;
  siteId: string;
  name: string;
  steps: FunnelStep[];
  createdAt: number;
  updatedAt: number;
  entered?: number;
  converted?: number;
}

export interface FunnelResult {
  sessions: number;
  steps: Array<FunnelStep & { count: number; dropped: number; droppedExamples: string[] }>;
  convertedExamples: string[];
}
