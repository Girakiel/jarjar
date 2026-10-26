// Wire format shared by the browser tracker and the ingestion server.

export type Device = 'desktop' | 'tablet' | 'mobile';

export const DEVICES: Device[] = ['desktop', 'tablet', 'mobile'];

/** Buckets a viewport width the same way on both ends. */
export function deviceForWidth(width: number): Device {
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/**
 * The key heatmaps and page stats are grouped by: the path without query string,
 * plus the hash when it's used for routing (`#/settings`).
 */
export function pageKey(href: string): string {
  try {
    const url = new URL(href);
    let path = url.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const hash = url.hash.startsWith('#/') ? url.hash.split('?')[0] : '';
    return path + hash;
  } catch {
    return '/';
  }
}

/** Returned by GET /i/config so the tracker knows what to collect. */
export interface TrackerConfig {
  enabled: boolean;
  sampleRate: number; // 0-100, share of sessions to track
  maskAllText: boolean;
  respectDnt: boolean;
  feedback: {
    enabled: boolean;
    title: string;
    color: string;
  } | null;
}

/** Sent with the first batch of every page load. */
export interface SessionMeta {
  ua: string;
  sw: number; // screen width
  sh: number; // screen height
  lang: string;
  ref: string; // document.referrer
}

/** Current state of the page view; resent with every batch so the server can upsert it. */
export interface PageviewInfo {
  id: string;
  url: string;
  title: string;
  ts: number; // client time the page view started
  vw: number; // viewport width
  vh: number; // viewport height
  dh: number; // document height
  sy: number; // deepest scroll position reached (bottom edge of the viewport, px)
}

/**
 * A click, stored relative to the clicked element so heatmaps line up even when
 * the page is rendered at a different width than the visitor's.
 */
export interface ClickPoint {
  t: number; // client time
  s: string; // CSS selector of the element
  rx: number; // 0-1 offset inside the element
  ry: number;
  x: number; // page coordinates, used as a fallback
  y: number;
  r?: 1; // part of a rage-click burst
}

export interface MovePoint {
  s: string;
  rx: number;
  ry: number;
  x: number;
  y: number;
}

export interface Identity {
  id: string;
  attrs?: Record<string, string | number | boolean | null>;
}

export interface CollectPayload {
  site: string;
  sid: string; // session id (per tab, expires after 30 min of inactivity)
  vid: string; // visitor id (persistent)
  pv: PageviewInfo;
  meta?: SessionMeta;
  events?: unknown[]; // rrweb events
  clicks?: ClickPoint[];
  moves?: MovePoint[];
  errors?: number; // JS errors since the previous batch
  tags?: string[]; // custom event names fired via jarjar('event', name)
  identity?: Identity;
}

export interface FeedbackPayload {
  site: string;
  sid: string;
  vid: string;
  url: string;
  vw: number;
  rating: number; // 1-5
  comment?: string;
}

/** rrweb event type numbers we care about (mirrors rrweb's EventType enum). */
export const RRWEB_FULL_SNAPSHOT = 2;
export const RRWEB_INCREMENTAL = 3;
export const RRWEB_META = 4;
export const RRWEB_CUSTOM = 5;
