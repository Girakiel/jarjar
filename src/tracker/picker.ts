// Lets a visitor point at the part of the page their feedback is about.

import type { PickedElement } from '../shared/protocol';
import { heatmapTarget, selectorFor } from './selector';
import { BASE_CSS, createHost, el, safeColor } from './widget';

export const PICKER_HOST_ID = 'jarjar-picker';

export function pickElement(opts: { hint: string; color: string; ignore: (el: Element) => boolean }): Promise<PickedElement | null> {
  return new Promise((resolve) => {
    const { host, root } = createHost(PICKER_HOST_ID);
    const color = safeColor(opts.color);
    root.innerHTML = `<style>${BASE_CSS}
      .banner { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: flex; gap: 12px;
        align-items: center; max-width: calc(100vw - 32px); background: #1c1c1f; color: #fff; font-size: 14px; line-height: 1.4;
        padding: 10px 12px 10px 16px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.3); }
      .cancel { border: 0; cursor: pointer; background: rgba(255,255,255,.16); color: #fff; padding: 6px 10px; border-radius: 6px; font-weight: 600; }
      .box { position: fixed; pointer-events: none; z-index: 2147483646; display: none; border: 3px solid ${color};
        border-radius: 4px; background: ${color}22; }
    </style>`;
    const box = el('div', 'box');
    const banner = el('div', 'banner');
    const cancel = el('button', 'cancel', '✕');
    cancel.setAttribute('aria-label', 'Cancel');
    banner.append(el('span', '', opts.hint), cancel);
    root.append(box, banner);

    let current: Element | null = null;
    const targetAt = (x: number, y: number): Element | null => {
      const found = document.elementFromPoint(x, y);
      if (!found || found === host || opts.ignore(found)) return null;
      return heatmapTarget(found);
    };
    const outline = (target: Element | null) => {
      current = target;
      if (!target) {
        box.style.display = 'none';
        return;
      }
      const r = target.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    };
    const ours = (e: Event) => e.composedPath().includes(host);
    // Keep the page from reacting (links, buttons, menus) while picking.
    const block = (e: Event) => {
      if (ours(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onMove = (e: MouseEvent) => outline(targetAt(e.clientX, e.clientY));
    const onClick = (e: MouseEvent) => {
      if (ours(e)) return;
      block(e);
      const target = targetAt(e.clientX, e.clientY);
      if (!target) return;
      const r = target.getBoundingClientRect();
      finish({
        s: selectorFor(target),
        x: Math.round(r.left + window.scrollX),
        y: Math.round(r.top + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      block(e);
      finish(null);
    };
    const onScroll = () => current && outline(current);
    const blocked = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'submit'];

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    for (const type of blocked) window.addEventListener(type, block, true);
    cancel.addEventListener('click', () => finish(null));

    function finish(result: PickedElement | null) {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      for (const type of blocked) window.removeEventListener(type, block, true);
      host.remove();
      resolve(result);
    }
  });
}
