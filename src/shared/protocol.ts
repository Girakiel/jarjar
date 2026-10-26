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
    let hash = url.hash.startsWith('#/') ? url.hash.split('?')[0] : '';
    if (hash === '#/') hash = ''; // the root route is the page itself
    return path + hash;
  } catch {
    return '/';
  }
}

/**
 * Whether a page path matches a list of patterns such as `/pricing`, `/blog/*` or `*checkout*`.
 * `*` matches anything; an empty list matches every page.
 */
export function matchesPage(patterns: string[], path: string): boolean {
  if (!patterns.length) return true;
  return patterns.some((pattern) => {
    const source = pattern
      .trim()
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return source !== '' && new RegExp(`^${source}$`, 'i').test(path);
  });
}

export type WidgetPosition = 'left' | 'right';

export interface FeedbackTexts {
  tab: string; // the button on the edge of the page
  placeholder: string; // comment box
  send: string;
  thanks: string;
  pick: string; // "point at something" button
  pickHint: string; // banner shown while picking
  picked: string; // shown once an element is picked
}

export const DEFAULT_FEEDBACK_TEXTS: FeedbackTexts = {
  tab: 'Feedback',
  placeholder: 'Tell us more (optional)',
  send: 'Send feedback',
  thanks: 'Thanks for your feedback!',
  pick: 'Point at something on the page',
  pickHint: 'Click the part of the page your feedback is about. Press Esc to cancel.',
  picked: 'Part of the page selected',
};

export interface FeedbackWidgetConfig {
  title: string; // the question
  color: string;
  position: WidgetPosition;
  style: 'emoji' | 'stars';
  allowPick: boolean;
  texts: FeedbackTexts;
  pages: string[]; // patterns; empty = all pages
  devices: Device[];
}

export type QuestionType = 'nps' | 'single' | 'multiple' | 'text';

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  text: string;
  required: boolean;
  options: string[]; // for single / multiple choice
}

export type SurveyTriggerType = 'immediate' | 'delay' | 'scroll' | 'exit';

export interface SurveyTexts {
  next: string;
  submit: string;
  thanks: string;
  low: string; // NPS scale labels
  high: string;
}

export const DEFAULT_SURVEY_TEXTS: SurveyTexts = {
  next: 'Next',
  submit: 'Send',
  thanks: 'Thank you!',
  low: 'Not likely',
  high: 'Very likely',
};

/** Everything the tracker needs to show a survey. */
export interface SurveyDefinition {
  id: string;
  questions: SurveyQuestion[];
  trigger: { type: SurveyTriggerType; value: number }; // seconds for delay, percent for scroll
  pages: string[];
  devices: Device[];
  position: WidgetPosition;
  color: string;
  texts: SurveyTexts;
}

/** Returned by GET /i/config so the tracker knows what to collect. */
export interface TrackerConfig {
  enabled: boolean;
  sampleRate: number; // 0-100, share of sessions to track
  maskAllText: boolean;
  respectDnt: boolean;
  feedback: FeedbackWidgetConfig | null;
  surveys: SurveyDefinition[];
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
  d?: 1; // dead click: nothing on the page changed afterwards
  l?: string; // short visible label of the element ("Choose plan"), for readable insights
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

/** A form the visitor started filling in on the current page. Field values are never sent. */
export interface FormReport {
  s: string; // selector of the <form>
  label: string; // its name, or the text of its submit button
  fields: number; // how many different fields were touched
  last: string; // name of the last field touched
  submitted: boolean;
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
  errs?: Array<{ m: string; n: number }>; // their messages, with counts
  forms?: FormReport[];
  tags?: string[]; // custom event names fired via jarjar('event', name)
  identity?: Identity;
}

/** The element a visitor pointed at, in page coordinates at their viewport width. */
export interface PickedElement {
  s: string; // CSS selector
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FeedbackPayload {
  site: string;
  sid: string;
  vid: string;
  url: string;
  vw: number;
  ts?: number; // client time, to find the moment in the recording
  rating: number; // 1-5
  comment?: string;
  element?: PickedElement;
}

export type SurveyAnswer = number | string | string[];

export interface SurveyResponsePayload {
  site: string;
  survey: string;
  sid: string;
  vid: string;
  url: string;
  vw: number;
  answers: Record<string, SurveyAnswer>; // by question id
  completed: boolean; // false when the visitor closed it part-way
}

/** rrweb event type numbers we care about (mirrors rrweb's EventType enum). */
export const RRWEB_FULL_SNAPSHOT = 2;
export const RRWEB_INCREMENTAL = 3;
export const RRWEB_META = 4;
export const RRWEB_CUSTOM = 5;
