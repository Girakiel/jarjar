// jarjar tracker: records sessions with rrweb and collects heatmap data.
//
// Install with:
//   <script async src="https://YOUR_JARJAR_HOST/t.js" data-site="SITE_KEY"></script>
//
// Optional API (calls made before the script loads are queued):
//   window.jarjar = window.jarjar || function () { (jarjar.q = jarjar.q || []).push(arguments) };
//   jarjar('identify', 'user-42', { plan: 'pro' });
//   jarjar('event', 'checkout_started');
//   jarjar('optOut');

import { record } from '@rrweb/record';
import {
  pageKey,
  type ClickPoint,
  type CollectPayload,
  type Identity,
  type MovePoint,
  type PageviewInfo,
  type TrackerConfig,
} from '../shared/protocol';
import { mountFeedbackWidget, WIDGET_HOST_ID } from './feedback';
import { isOptedOut, loadSession, saveSession, setOptOut, uuid, visitorId, SESSION_TIMEOUT_MS, type SessionState } from './identity';
import { heatmapTarget, selectorFor } from './selector';

const FIRST_FLUSH_MS = 1000;
const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFERED_EVENTS = 400;
const MAX_MOVES_PER_PAGE = 1500;
const MAX_ERRORS_PER_PAGE = 50;
const RAGE_WINDOW_MS = 1000;
const RAGE_RADIUS_PX = 30;
const RAGE_CLICKS = 3;
const BEACON_LIMIT = 60_000;

type Attrs = Identity['attrs'];

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : Math.round(n * 1000) / 1000);

function docHeight(): number {
  return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
}

function inWidget(e: Event): boolean {
  const target = e.target;
  return target instanceof Element && target.id === WIDGET_HOST_ID;
}

function sanitizeAttrs(value: unknown): Attrs {
  if (!value || typeof value !== 'object') return undefined;
  const out: NonNullable<Attrs> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k.slice(0, 64)] = v;
    else if (v !== undefined) out[k.slice(0, 64)] = String(v).slice(0, 256);
  }
  return out;
}

class Tracker {
  private config?: TrackerConfig;
  private session?: SessionState;
  private readonly vid = visitorId();
  private pv!: PageviewInfo;
  private active = false;
  private stopRecording?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<void> = Promise.resolve();

  // Buffered until the next flush.
  private events: unknown[] = [];
  private clicks: ClickPoint[] = [];
  private moves: MovePoint[] = [];
  private errors = 0;
  private pendingTags: string[] = [];
  private identity?: Identity;
  private identityDirty = false;
  private sendMeta = true;
  private lastPvState = '';

  // Per-page counters and interaction state.
  private movesThisPage = 0;
  private errorsThisPage = 0;
  private recentClicks: Array<{ t: number; x: number; y: number }> = [];
  private lastMove = { t: 0, x: -1e6, y: -1e6 };
  private moveSelectors = new WeakMap<Element, string>();
  private scrollQueued = false;

  constructor(
    private readonly site: string,
    private readonly host: string,
    // jarjar's own test page wants settings changes to apply on the next reload, not after the cache expires.
    private readonly freshConfig = false,
  ) {}

  async start(): Promise<void> {
    if (isOptedOut()) return;
    let config: TrackerConfig;
    try {
      const res = await fetch(`${this.host}/i/config?site=${encodeURIComponent(this.site)}`, {
        credentials: 'omit',
        cache: this.freshConfig ? 'no-cache' : 'default',
      });
      if (!res.ok) return;
      config = await res.json();
    } catch {
      return;
    }
    if (!config.enabled) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (config.respectDnt && (nav.doNotTrack === '1' || nav.globalPrivacyControl === true)) return;

    this.config = config;
    this.session = loadSession(config.sampleRate);
    if (!this.session.sampled || isOptedOut()) return;

    this.active = true;
    this.newPageview();
    this.listen();
    this.startRecording();
    if (config.feedback?.enabled) this.whenBodyReady(() => this.mountFeedback());
    this.timer = setTimeout(() => this.tick(), FIRST_FLUSH_MS);
  }

  command(cmd: string, args: unknown[]): void {
    switch (cmd) {
      case 'identify': {
        if (args[0] === undefined || args[0] === null || args[0] === '') return;
        this.identity = { id: String(args[0]).slice(0, 200), attrs: sanitizeAttrs(args[1]) };
        this.identityDirty = true;
        break;
      }
      case 'event': {
        const name = String(args[0] ?? '').trim().slice(0, 100);
        if (!name) return;
        if (!this.pendingTags.includes(name)) this.pendingTags.push(name);
        this.custom('event', { name });
        break;
      }
      case 'optOut':
        setOptOut(true);
        this.stop();
        break;
      case 'optIn':
        setOptOut(false);
        break;
      case 'stop':
        this.stop();
        break;
      default:
        console.warn(`[jarjar] unknown command "${cmd}"`);
    }
  }

  private stop(): void {
    if (!this.active) return;
    this.flush(true);
    this.active = false;
    this.stopRecording?.();
    clearTimeout(this.timer);
    document.getElementById(WIDGET_HOST_ID)?.remove();
  }

  private startRecording(): void {
    const maskAllText = this.config?.maskAllText;
    this.stopRecording =
      record({
        emit: (event) => {
          this.events.push(event);
          if (this.events.length >= MAX_BUFFERED_EVENTS) this.flush();
        },
        maskAllInputs: true,
        maskTextSelector: maskAllText ? '*' : '[data-jj-mask],.jj-mask',
        blockSelector: '[data-jj-block],.jj-block',
        ignoreClass: 'jj-ignore',
        sampling: { mousemove: 50, scroll: 150, media: 800, input: 'last' },
        slimDOMOptions: 'all',
        inlineStylesheet: true,
        recordCanvas: false,
        collectFonts: false,
      }) ?? undefined;
  }

  /** rrweb throws if a custom event is added before recording has started. */
  private custom(tag: string, payload: unknown): void {
    if (!this.active) return;
    try {
      record.addCustomEvent(tag, payload);
    } catch {
      /* not recording yet */
    }
  }

  private newPageview(): void {
    this.pv = {
      id: uuid(),
      url: location.href,
      title: document.title.slice(0, 200),
      ts: Date.now(),
      vw: window.innerWidth,
      vh: window.innerHeight,
      dh: docHeight(),
      sy: Math.round(window.scrollY + window.innerHeight),
    };
    this.movesThisPage = 0;
    this.errorsThisPage = 0;
    this.recentClicks = [];
    this.lastPvState = '';
  }

  private listen(): void {
    document.addEventListener('click', (e) => this.onClick(e), true);
    document.addEventListener('mousemove', (e) => this.onMove(e), { capture: true, passive: true });
    document.addEventListener('keydown', () => this.touch(), { capture: true, passive: true });
    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    window.addEventListener('error', (e) => this.onError(e.message || 'Script error'));
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
      this.onError(`Unhandled rejection: ${reason}`);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
    window.addEventListener('pagehide', () => this.flush(true));

    // Single-page apps: treat route changes as new page views.
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('jarjar:locationchange'));
        return result;
      };
    }
    const onLocation = () => this.onLocationChange();
    window.addEventListener('jarjar:locationchange', onLocation);
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
  }

  private onLocationChange(): void {
    if (!this.active) return;
    if (pageKey(location.href) === pageKey(this.pv.url)) {
      this.pv.url = location.href;
      return;
    }
    this.flush();
    this.newPageview();
    // A fresh snapshot of the new route gives heatmaps something to draw on.
    setTimeout(() => {
      if (!this.active) return;
      try {
        record.takeFullSnapshot(true);
      } catch {
        /* not recording */
      }
      this.pv.title = document.title.slice(0, 200);
    }, 600);
  }

  /** Starts a new session when the visitor comes back after a long break on the same page. */
  private touch(now = Date.now()): void {
    const session = this.session;
    if (!session || !this.active) return;
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      this.flush();
      this.session = { id: uuid(), sampled: true, lastActivity: now };
      this.sendMeta = true;
      this.newPageview();
      try {
        record.takeFullSnapshot(true);
      } catch {
        /* not recording */
      }
    }
    this.session!.lastActivity = now;
  }

  private onClick(e: MouseEvent): void {
    if (!this.active || inWidget(e)) return;
    // Keyboard-activated clicks have no pointer position.
    if (e.detail === 0 && e.clientX === 0 && e.clientY === 0) return;
    const el = heatmapTarget(e.target);
    if (!el) return;
    const now = Date.now();
    this.touch(now);
    const rect = el.getBoundingClientRect();
    const x = Math.round(e.pageX);
    const y = Math.round(e.pageY);
    const point: ClickPoint = {
      t: now,
      s: selectorFor(el),
      rx: clamp01((e.clientX - rect.left) / (rect.width || 1)),
      ry: clamp01((e.clientY - rect.top) / (rect.height || 1)),
      x,
      y,
    };

    this.recentClicks = this.recentClicks.filter(
      (c) => now - c.t < RAGE_WINDOW_MS && Math.abs(c.x - x) < RAGE_RADIUS_PX && Math.abs(c.y - y) < RAGE_RADIUS_PX,
    );
    this.recentClicks.push({ t: now, x, y });
    if (this.recentClicks.length >= RAGE_CLICKS) {
      point.r = 1;
      if (this.recentClicks.length === RAGE_CLICKS) this.custom('rage-click', { selector: point.s });
    }
    this.clicks.push(point);
  }

  private onMove(e: MouseEvent): void {
    if (!this.active || this.movesThisPage >= MAX_MOVES_PER_PAGE || inWidget(e)) return;
    const now = Date.now();
    if (now - this.lastMove.t < 100) return;
    const x = Math.round(e.pageX);
    const y = Math.round(e.pageY);
    if (Math.abs(x - this.lastMove.x) + Math.abs(y - this.lastMove.y) < 24) return;
    const el = heatmapTarget(e.target);
    if (!el) return;
    this.touch(now);
    this.lastMove = { t: now, x, y };
    let selector = this.moveSelectors.get(el);
    if (!selector) {
      selector = selectorFor(el);
      this.moveSelectors.set(el, selector);
    }
    const rect = el.getBoundingClientRect();
    this.moves.push({
      s: selector,
      rx: clamp01((e.clientX - rect.left) / (rect.width || 1)),
      ry: clamp01((e.clientY - rect.top) / (rect.height || 1)),
      x,
      y,
    });
    this.movesThisPage++;
  }

  private onScroll(): void {
    if (!this.active || this.scrollQueued) return;
    this.scrollQueued = true;
    requestAnimationFrame(() => {
      this.scrollQueued = false;
      this.touch();
      this.pv.sy = Math.max(this.pv.sy, Math.round(window.scrollY + window.innerHeight));
    });
  }

  private onError(message: string): void {
    if (!this.active || this.errorsThisPage >= MAX_ERRORS_PER_PAGE) return;
    this.errorsThisPage++;
    this.errors++;
    this.custom('error', { message: message.slice(0, 300) });
  }

  private tick(): void {
    this.flush();
    this.timer = setTimeout(() => this.tick(), FLUSH_INTERVAL_MS);
  }

  /** Builds the payload synchronously (so it reflects the state right now) and sends it. */
  private flush(final = false): void {
    const session = this.session;
    if (!this.active || !session) return;
    this.pv.dh = docHeight();
    const pvState = `${this.pv.url}|${this.pv.dh}|${this.pv.sy}`;
    const hasData =
      this.events.length > 0 ||
      this.clicks.length > 0 ||
      this.moves.length > 0 ||
      this.errors > 0 ||
      this.pendingTags.length > 0 ||
      this.identityDirty ||
      this.sendMeta ||
      pvState !== this.lastPvState;
    if (!hasData) return;

    const payload: CollectPayload = { site: this.site, sid: session.id, vid: this.vid, pv: { ...this.pv } };
    if (this.sendMeta) {
      payload.meta = {
        ua: navigator.userAgent,
        sw: screen.width,
        sh: screen.height,
        lang: navigator.language,
        ref: document.referrer,
      };
    }
    if (this.events.length) payload.events = this.events;
    if (this.clicks.length) payload.clicks = this.clicks;
    if (this.moves.length) payload.moves = this.moves;
    if (this.errors) payload.errors = this.errors;
    if (this.pendingTags.length) payload.tags = this.pendingTags;
    if (this.identityDirty && this.identity) payload.identity = this.identity;

    this.events = [];
    this.clicks = [];
    this.moves = [];
    this.errors = 0;
    this.pendingTags = [];
    this.identityDirty = false;
    this.sendMeta = false;
    this.lastPvState = pvState;
    saveSession(session);

    const body = JSON.stringify(payload);
    if (final) this.sendBeacon(body);
    else this.queue = this.queue.then(() => this.send(body)).catch(() => undefined);
  }

  private async send(body: string, attempt = 0): Promise<void> {
    let data: Blob | string = body;
    let url = `${this.host}/i/collect`;
    if (body.length > 1024 && typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
        data = await new Response(stream).blob();
        url += '?enc=gzip';
      } catch {
        data = body;
      }
    }
    try {
      // text/plain keeps this a CORS "simple request" (no preflight).
      const res = await fetch(url, {
        method: 'POST',
        body: data,
        headers: { 'Content-Type': 'text/plain' },
        credentials: 'omit',
      });
      if (res.status === 403 || res.status === 404) this.stop();
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        return this.send(body, attempt + 1);
      }
    }
  }

  /** Used while the page is being hidden or unloaded, when async compression may never finish. */
  private sendBeacon(body: string): void {
    const url = `${this.host}/i/collect`;
    if (body.length < BEACON_LIMIT && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
    fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain' },
      credentials: 'omit',
      keepalive: body.length < BEACON_LIMIT,
    }).catch(() => undefined);
  }

  private whenBodyReady(fn: () => void): void {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  private mountFeedback(): void {
    const fb = this.config?.feedback;
    if (!fb) return;
    mountFeedbackWidget({
      title: fb.title,
      color: fb.color,
      onSubmit: async (rating, comment) => {
        const res = await fetch(`${this.host}/i/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          credentials: 'omit',
          body: JSON.stringify({
            site: this.site,
            sid: this.session?.id ?? '',
            vid: this.vid,
            url: location.href,
            vw: window.innerWidth,
            rating,
            comment,
          }),
        });
        if (!res.ok) throw new Error(`feedback failed: ${res.status}`);
        this.custom('feedback', { rating });
      },
    });
  }
}

type QueuedCall = ArrayLike<unknown>;
interface JarjarWindow extends Window {
  __jarjarLoaded?: boolean;
  jarjar?: ((cmd: string, ...args: unknown[]) => void) & { q?: QueuedCall[] };
  jarjarSettings?: { site?: string; host?: string };
}

(function boot() {
  const w = window as JarjarWindow;
  if (w.__jarjarLoaded) return;
  w.__jarjarLoaded = true;

  const script = document.currentScript as HTMLScriptElement | null;
  const site = script?.dataset.site || w.jarjarSettings?.site;
  const host = (script?.dataset.host || w.jarjarSettings?.host || (script?.src ? new URL(script.src).origin : '')).replace(/\/$/, '');
  if (!site || !host) {
    console.warn('[jarjar] missing data-site attribute on the tracking script');
    return;
  }

  const tracker = new Tracker(site, host, script?.dataset.freshConfig !== undefined);
  const queued = w.jarjar?.q ?? [];
  w.jarjar = (cmd: string, ...args: unknown[]) => tracker.command(cmd, args);
  for (const call of queued) {
    const [cmd, ...args] = Array.from(call);
    tracker.command(String(cmd), args);
  }
  void tracker.start();
})();
