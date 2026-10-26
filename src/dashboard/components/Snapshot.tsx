// Rebuilds a stored page snapshot (rrweb full snapshot) in a sandboxed frame,
// scaled to fit. Heatmaps draw on top of it; feedback uses it to show the
// element a visitor pointed at.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
import { api, ApiError, type Device } from '../api';
import { Icon } from './Icon';
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
    el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:2147483647;';
    // A child of <html> is positioned against the document, regardless of body styles.
    doc.documentElement.appendChild(el);
  }
  return el;
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

export function useSnapshotFrame(siteId: string, path: string, device: Device) {
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
    setStatus('loading');
    api<Array<{ type: number; data: { width?: number } }>>(`/sites/${siteId}/heatmaps/snapshot?path=${encodeURIComponent(path)}&device=${device}`)
      .then((events) => {
        if (cancelled) return;
        snapWidth.current = events[0]?.data?.width || 1280;
        const replayer = new Replayer(events as never, {
          root: scaler,
          showWarning: false,
          mouseTail: false,
          triggerFocus: false,
          UNSAFE_replayCanvas: false,
          insertStyleRules: ['html, body { scroll-behavior: auto !important; }'],
        });
        replayerRef.current = replayer;
        replayer.on('fullsnapshot-rebuilded', () => {
          if (cancelled) return;
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
          layout();
          setStatus('ready');
          setTimeout(() => !cancelled && setLayoutTick((t) => t + 1), 1200);
        });
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        setStatus(err.status === 404 ? 'missing' : 'error');
        setMessage(err.message);
      });
    return () => {
      cancelled = true;
      replayerRef.current?.destroy();
      replayerRef.current = null;
      scaler.innerHTML = '';
    };
  }, [siteId, path, device, layout]);

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
