// Canvas heatmap rendering: accumulate soft alpha "stamps" per point, then map
// the accumulated alpha through a color ramp.

import type { PointData } from '../api';

// Keep canvases well under browser limits (Safari caps at ~16.7M pixels).
const MAX_PIXELS = 6_000_000;

const RAMP: Array<[number, string]> = [
  [0, '#2b59ff'],
  [0.35, '#00d68f'],
  [0.65, '#ffe600'],
  [1, '#ff2a2a'],
];

let palette: Uint8ClampedArray | null = null;

function getPalette(): Uint8ClampedArray {
  if (palette) return palette;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const ctx = c.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [stop, color] of RAMP) gradient.addColorStop(stop, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);
  palette = ctx.getImageData(0, 0, 256, 1).data;
  return palette;
}

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): number {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  return scale;
}

function stamp(radius: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(radius * 2);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Whether an element (from the snapshot frame) is actually shown: rendered, not hidden and not transparent. */
function isShown(el: Element, r: DOMRect): boolean {
  if (r.width === 0 && r.height === 0) return false;
  const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  return check ? check.call(el, { opacityProperty: true, visibilityProperty: true }) : true;
}

/**
 * Where each selector's element is on the rebuilt page, in page coordinates. Null when the element
 * isn't there or isn't shown, such as a closed pop-up or menu.
 */
export function locateSelectors(doc: Document, selectors: string[]): Array<Box | null> {
  const win = doc.defaultView;
  const sx = win?.scrollX ?? 0;
  const sy = win?.scrollY ?? 0;
  return selectors.map((selector) => {
    try {
      const el = doc.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!isShown(el, r)) return null;
      return { left: r.left + sx, top: r.top + sy, width: r.width, height: r.height };
    } catch {
      return null;
    }
  });
}

/**
 * Places stored points relative to their element. Points on elements that aren't shown are left out:
 * drawn at their raw coordinates they'd land on whatever is underneath.
 */
export function resolvePoints(data: PointData, boxes: Array<Box | null>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [i, rx, ry] of data.points) {
    const r = boxes[i];
    if (r) out.push([r.left + rx * r.width, r.top + ry * r.height]);
  }
  return out;
}

export interface HiddenGroup {
  /** The outermost part of the page, shared by these elements, that isn't shown (like the pop-up itself). */
  container: string;
  selectors: string[];
  count: number;
}

/** Splits a selector built by the tracker (`body>div:nth-of-type(2)>a`) into its steps. */
function steps(selector: string): string[] {
  return selector.split(/(?<!\\)>/);
}

/**
 * Clicks on elements that aren't shown on the rebuilt page, grouped by the closed part of the page
 * they're in, so one pop-up is one group. Biggest first.
 */
export function hiddenGroups(doc: Document, data: PointData, boxes: Array<Box | null>): HiddenGroup[] {
  const counts = new Map<number, number>();
  for (const [i] of data.points) if (!boxes[i]) counts.set(i, (counts.get(i) ?? 0) + 1);
  const groups = new Map<string, HiddenGroup>();
  for (const [i, count] of counts) {
    const selector = data.selectors[i];
    const parts = steps(selector);
    let container = selector;
    for (let n = 1; n <= parts.length; n++) {
      const prefix = parts.slice(0, n).join('>');
      let el: Element | null = null;
      try {
        el = doc.querySelector(prefix);
      } catch {
        break;
      }
      if (!el || !isShown(el, el.getBoundingClientRect())) {
        container = prefix;
        break;
      }
    }
    const group = groups.get(container) ?? { container, selectors: [], count: 0 };
    group.selectors.push(selector);
    group.count += count;
    groups.set(container, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function drawHeat(
  canvas: HTMLCanvasElement,
  points: Array<[number, number]>,
  opts: { width: number; height: number; radius: number; dim: number },
): void {
  const scale = sizeCanvas(canvas, opts.width, opts.height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (opts.dim > 0) {
    ctx.fillStyle = `rgba(10, 10, 20, ${opts.dim})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (!points.length) return;

  const r = Math.max(4, opts.radius * scale);
  const cell = Math.max(1, r / 3);
  const bins = new Map<string, { x: number; y: number; n: number }>();
  for (const [x, y] of points) {
    const bx = Math.floor((x * scale) / cell);
    const by = Math.floor((y * scale) / cell);
    const key = `${bx}:${by}`;
    const bin = bins.get(key);
    if (bin) bin.n++;
    else bins.set(key, { x: (bx + 0.5) * cell, y: (by + 0.5) * cell, n: 1 });
  }
  let max = 1;
  for (const b of bins.values()) if (b.n > max) max = b.n;

  const shadow = document.createElement('canvas');
  shadow.width = w;
  shadow.height = h;
  const sctx = shadow.getContext('2d')!;
  const s = stamp(r);
  for (const b of bins.values()) {
    // Sub-linear so isolated clicks stay visible next to hotspots.
    sctx.globalAlpha = Math.min(1, Math.max(0.12, Math.pow(b.n / max, 0.6)));
    sctx.drawImage(s, b.x - r, b.y - r);
  }

  const pal = getPalette();
  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 4) {
      d[i + 3] = 0;
      continue;
    }
    const p = a * 4;
    d[i] = pal[p];
    d[i + 1] = pal[p + 1];
    d[i + 2] = pal[p + 2];
    d[i + 3] = Math.min(235, 40 + a);
  }
  sctx.putImageData(img, 0, 0);
  ctx.drawImage(shadow, 0, 0);
}

/** Share of page views that reached each vertical position, from per-view reach fractions (0-1). */
export function reachAt(sortedReach: number[], fraction: number): number {
  if (!sortedReach.length) return 0;
  // First index with reach >= fraction.
  let lo = 0;
  let hi = sortedReach.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedReach[mid] < fraction) lo = mid + 1;
    else hi = mid;
  }
  return (sortedReach.length - lo) / sortedReach.length;
}

export function drawScroll(canvas: HTMLCanvasElement, sortedReach: number[], opts: { width: number; height: number; fold: number }): void {
  const scale = sizeCanvas(canvas, opts.width, opts.height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (!sortedReach.length) return;
  const pal = getPalette();
  const step = Math.max(1, Math.round(4 * scale));
  for (let y = 0; y < h; y += step) {
    const pct = reachAt(sortedReach, y / h);
    const p = Math.round(pct * 255) * 4;
    ctx.fillStyle = `rgba(${pal[p]}, ${pal[p + 1]}, ${pal[p + 2]}, ${0.18 + pct * 0.32})`;
    ctx.fillRect(0, y, w, step);
  }

  const line = (fraction: number, label: string, color: string) => {
    const y = Math.round(fraction * h);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.setLineDash([8 * scale, 6 * scale]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const font = Math.max(10, Math.round(13 * scale));
    ctx.font = `600 ${font}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const padX = 8 * scale;
    const boxH = font + 10 * scale;
    const x = w / 2 - tw / 2 - padX;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y - boxH / 2, tw + padX * 2, boxH, 6 * scale);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX, y + 1);
    ctx.restore();
  };

  // Mark where 75 / 50 / 25 % of visitors stopped.
  for (const target of [0.75, 0.5, 0.25]) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (reachAt(sortedReach, mid) >= target) lo = mid;
      else hi = mid;
    }
    if (lo < 0.995) line(lo, `${target * 100}% of visitors reached this point`, 'rgba(20, 20, 30, 0.85)');
  }
  if (opts.fold > 0 && opts.fold < 1) line(opts.fold, 'Average fold', 'rgba(110, 86, 207, 0.95)');
}
