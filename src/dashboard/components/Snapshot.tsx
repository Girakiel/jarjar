// Rebuilds a page in a sandboxed frame, scaled to fit: either the stored snapshot of the page
// (an rrweb full snapshot taken as it loaded), or the page at a moment of a recording, which
// can show pop-ups and menus that were open then. Heatmaps draw on top of it; feedback uses it
// to show the element a visitor pointed at.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
import { api, ApiError, type Device } from '../api';
import { Icon } from './Icon';
import { attachReplayFixes } from './replayFixes';
import { ErrorBox } from './ui';

export type SnapshotStatus = 'loading' | 'ready' | 'missing' | 'error';

const HIGHLIGHT_ID = '__jarjar_highlight';

export function docSize(doc: Document) {
  const el = doc.documentElement;
  const body = doc.body;
  return {
    width: Math.max(el.scrollWidth, body?.scrollWidth ?? 0, el.clientWidth),
    height: Math.max(el.scrollHeight, body?.scrollHeight ?? 0, el.clientHeight),
  };
}

/** An absolutely positioned element covering the snapshot document, created once. */
export function overlayEl<T extends HTMLElement>(doc: Document, id: string, tag: string): T {
  let el = doc.getElementById(id) as T | null;
  if (!el) {
    el = doc.createElement(tag) as T;
    el.id = id;
    el.style.cssText =
      'position:absolute;left:0;top:0;right:auto;bottom:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;';
    // A child of <html> is positioned against the document, regardless of body styles.
    doc.documentElement.appendChild(el);
  }
  keepAboveTopLayer(doc, el);
  return el;
}

/**
 * Open modal dialogs and popovers sit in the browser's top layer, above any z-index. When the page
 * has one, put the overlay in the top layer too, after it, so it's drawn on top.
 */
function keepAboveTopLayer(doc: Document, el: HTMLElement): void {
  try {
    const open = doc.querySelector('dialog:modal, :popover-open:not([id^="__jarjar"])');
    if (el.matches(':popover-open')) el.hidePopover();
    if (!open) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
  } catch {
    /* no top layer support */
  }
}

/** A moment of a recording to show instead of the page's stored snapshot. */
export interface Moment {
  session: string;
  ts: number; // client timestamp
  /** Show the page just before the visitor's click nearest to `ts` (which may be an estimate). */
  click?: boolean;
}

// rrweb: an incremental event (3) from mouse interactions (source 2) of type click (2).
const isClick = (e: { type: number; data: { source?: number; type?: number } }) => e.type === 3 && e.data.source === 2 && e.data.type === 2;

/** When to stop a recording to show `moment`. */
function momentTime(events: Array<{ type: number; timestamp: number; data: { source?: number; type?: number } }>, moment: Moment): number {
  if (!moment.click) return moment.ts;
  let best: number | null = null;
  for (const e of events) {
    if (isClick(e) && Math.abs(e.timestamp - moment.ts) < 8000 && (best === null || Math.abs(e.timestamp - moment.ts) < Math.abs(best - moment.ts))) best = e.timestamp;
  }
  // Just before the click, while whatever was clicked (say, a pop-up) is still open.
  return (best ?? moment.ts) - 100;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Outlines an element (dimming the rest of the page) and scrolls it into view.
 * Falls back to a stored rectangle when the selector no longer matches.
 * Returns how the highlight was placed, or null if nothing was shown.
 */
export function highlightElement(doc: Document, selector: string | null, fallback?: Rect): 'element' | 'position' | null {
  const box = overlayEl<HTMLDivElement>(doc, HIGHLIGHT_ID, 'div');
  const win = doc.defaultView;
  if (!win || (!selector && !fallback)) {
    box.style.display = 'none';
    return null;
  }
  let rect: Rect | null = null;
  let how: 'element' | 'position' = 'position';
  try {
    const target = selector ? doc.querySelector(selector) : null;
    const r = target?.getBoundingClientRect();
    if (r && (r.width || r.height)) {
      rect = { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height };
      how = 'element';
    }
  } catch {
    /* invalid selector */
  }
  rect ??= fallback ?? null;
  if (!rect) {
    box.style.display = 'none';
    return null;
  }
  Object.assign(box.style, {
    display: 'block',
    left: `${rect.x - 3}px`,
    top: `${rect.y - 3}px`,
    width: `${rect.w + 6}px`,
    height: `${rect.h + 6}px`,
    border: '3px solid #8b74ff',
    borderRadius: '6px',
    boxShadow: '0 0 0 9999px rgba(10,10,20,0.35)',
  });
  const top = rect.y - win.scrollY;
  if (top < 0 || top + rect.h > win.innerHeight) win.scrollTo({ top: Math.max(0, rect.y - win.innerHeight / 2 + rect.h / 2) });
  return how;
}

export function useSnapshotFrame(siteId: string, path: string, device: Device, moment?: Moment | null) {
  const stageRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const snapWidth = useRef(1280);
  const scaleRef = useRef(1);
  const [status, setStatus] = useState<SnapshotStatus>('loading');
  const [message, setMessage] = useState('');
  // Bumped whenever the layout may have changed, so overlays redraw.
  const [layoutTick, setLayoutTick] = useState(0);

  const doc = useCallback(() => replayerRef.current?.iframe.contentDocument ?? null, []);

  // Fit the snapshot's width into the stage and let the page scroll inside the frame.
  const layout = useCallback(() => {
    const stage = stageRef.current;
    const scaler = scalerRef.current;
    const iframe = replayerRef.current?.iframe;
    if (!stage || !scaler || !iframe) return;
    const width = snapWidth.current;
    const scale = Math.min(1, (stage.clientWidth - 32) / width);
    scaleRef.current = scale;
    const height = Math.floor(stage.clientHeight / scale);
    scaler.style.width = `${width}px`;
    scaler.style.height = `${height}px`;
    scaler.style.transform = `scale(${scale})`;
    scaler.style.left = `${Math.max(0, (stage.clientWidth - width * scale) / 2)}px`;
    iframe.width = String(width);
    iframe.height = String(height);
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    setLayoutTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const scaler = scalerRef.current;
    if (!scaler) return;
    let cancelled = false;
    let fixes: ReturnType<typeof attachReplayFixes> | undefined;
    setStatus('loading');
    const url = moment ? `/sessions/${moment.session}/events` : `/sites/${siteId}/heatmaps/snapshot?path=${encodeURIComponent(path)}&device=${device}`;
    api<Array<{ type: number; timestamp: number; data: { width?: number; source?: number; type?: number } }>>(url)
      .then((events) => {
        if (cancelled) return;
        const at = moment ? momentTime(events, moment) : 0;
        if (moment && !events.some((e) => e.type === 2 && e.timestamp <= at)) throw new Error('This moment is no longer in the recording.');
        // The visitor's window width at that moment (meta events carry it).
        const meta = events.filter((e) => e.type === 4 && (!moment || e.timestamp <= at)).pop();
        snapWidth.current = meta?.data?.width || 1280;
        const replayer = new Replayer(events as never, {
          root: scaler,
          showWarning: false,
          mouseTail: false,
          triggerFocus: false,
          UNSAFE_replayCanvas: false,
          insertStyleRules: ['html, body { scroll-behavior: auto !important; }'],
        });
        replayerRef.current = replayer;
        fixes = attachReplayFixes(replayer);
        let shown = false;
        replayer.on('fullsnapshot-rebuilded', () => {
          // A recording can hold several pages; wait for the one at the moment.
          if (cancelled || shown) return;
          replayer.enableInteract();
          const d = replayer.iframe.contentDocument;
          if (d) {
            // The snapshot is a picture, not a working page.
            const block = (e: Event) => e.preventDefault();
            d.addEventListener('click', block, true);
            d.addEventListener('submit', block, true);
            // Late-loading images and fonts move things around; redraw when they settle.
            let timer: ReturnType<typeof setTimeout>;
            d.addEventListener(
              'load',
              () => {
                clearTimeout(timer);
                timer = setTimeout(() => setLayoutTick((t) => t + 1), 250);
              },
              true,
            );
          }
          if (moment) return;
          show();
        });
        const show = () => {
          shown = true;
          fixes?.apply();
          layout();
          setStatus('ready');
          setTimeout(() => !cancelled && setLayoutTick((t) => t + 1), 1200);
        };
        if (moment) {
          // Applies every event up to the moment, then stops there.
          replayer.pause(Math.max(0, at - events[0].timestamp));
          // After the replayer's own deferred resize to the recording's first window size.
          setTimeout(() => !cancelled && show(), 10);
        }
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        setStatus(err.status === 404 ? 'missing' : 'error');
        setMessage(err.message);
      });
    return () => {
      cancelled = true;
      fixes?.detach();
      replayerRef.current?.destroy();
      replayerRef.current = null;
      scaler.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, path, device, layout, moment?.session, moment?.ts, moment?.click]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => layout());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [layout]);

  return { stageRef, scalerRef, status, message, doc, layoutTick, scale: () => scaleRef.current };
}

export function SnapshotStage({
  frame,
  path,
  device,
  children,
}: {
  frame: ReturnType<typeof useSnapshotFrame>;
  path: string;
  device: Device;
  children?: ReactNode;
}) {
  return (
    <div className="heatmap-stage" ref={frame.stageRef}>
      <div className="scaler" ref={frame.scalerRef} />
      {frame.status === 'loading' && (
        <div className="heatmap-overlay-msg">
          <div className="spinner" />
        </div>
      )}
      {frame.status === 'missing' && (
        <div className="heatmap-overlay-msg">
          <div>
            <Icon name={device} />
            <p>
              No {device} snapshot of <strong>{path}</strong> yet.
              <br />
              It's captured automatically the next time someone visits this page on a {device}.
            </p>
          </div>
        </div>
      )}
      {frame.status === 'error' && (
        <div className="heatmap-overlay-msg">
          <ErrorBox error={frame.message} />
        </div>
      )}
      {children}
    </div>
  );
}
