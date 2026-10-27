// The replayer rebuilds pages in a frame without scripts, which loses page state that isn't part of
// the DOM. This puts it back while a recording or heatmap snapshot is shown:
// - popovers the tracker marked as open are shown again (they live in the browser's top layer);
// - CSS `:target` rules apply to the element the tracker marked as the target;
// - while paused, CSS animations are finished instead of frozen on their first frame, where a
//   pop-up that fades or zooms in is still invisible.

import type { Replayer } from '@rrweb/replay';
import { POPOVER_OPEN_ATTR, TARGET_ATTR } from '../../shared/protocol';

const TARGET_STYLE_ID = '__jarjar_target_rules';

function syncPopovers(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[popover]'))) {
    if (el.id.startsWith('__jarjar')) continue; // our own overlays
    try {
      const open = el.matches(':popover-open');
      const wanted = el.hasAttribute(POPOVER_OPEN_ATTR);
      if (wanted && !open) el.showPopover();
      else if (!wanted && open) el.hidePopover();
    } catch {
      /* no popover support, or not a valid popover */
    }
  }
}

// How many rules of each stylesheet have been checked for :target already.
const scanned = new WeakMap<CSSStyleSheet, number>();

/** Copies of the `:target` rules in `rules` (from index `start`), aimed at the marked element instead. */
function targetCopies(rules: CSSRuleList, start = 0): string[] {
  const out: string[] = [];
  for (let i = start; i < rules.length; i++) {
    const rule = rules[i];
    // Rules belong to the frame's window, so compare by constructor name rather than instanceof.
    const kind = rule.constructor.name;
    if (kind === 'CSSStyleRule') {
      if ((rule as CSSStyleRule).selectorText.includes(':target')) out.push(rule.cssText.replace(/:target\b/g, `[${TARGET_ATTR}]`));
    } else if (kind === 'CSSMediaRule' || kind === 'CSSSupportsRule') {
      const inner = targetCopies((rule as CSSGroupingRule).cssRules);
      const at = kind === 'CSSMediaRule' ? '@media' : '@supports';
      if (inner.length) out.push(`${at} ${(rule as CSSConditionRule).conditionText} { ${inner.join(' ')} }`);
    } else if ('cssRules' in rule) {
      out.push(...targetCopies((rule as CSSGroupingRule).cssRules)); // layers and the like
    }
  }
  return out;
}

/**
 * A replayed page isn't at the visitor's URL, so `:target` never matches. Once the page has a marked
 * target, every `:target` rule gets a copy that matches the marked element instead.
 */
function syncTargetRules(doc: Document): void {
  if (!doc.querySelector(`[${TARGET_ATTR}]`)) return;
  let style = doc.getElementById(TARGET_STYLE_ID);
  // Seeking can replace the page, taking our copies with it; then every sheet needs scanning again.
  const fresh = !style;
  if (!style) {
    style = doc.createElement('style');
    style.id = TARGET_STYLE_ID;
    // A child of <html> stays out of the way of the replayer, which manages <head> and <body>.
    doc.documentElement.appendChild(style);
  }
  const copies: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    if (sheet.ownerNode === style) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's stylesheet: its rules can't be read
    }
    const done = fresh ? 0 : (scanned.get(sheet) ?? 0);
    if (done === rules.length && !fresh) continue;
    copies.push(...targetCopies(rules, done < rules.length ? done : 0));
    scanned.set(sheet, rules.length);
  }
  if (copies.length) style.textContent += copies.join('\n') + '\n';
}

function finishAnimations(doc: Document): void {
  for (const animation of doc.getAnimations?.() ?? []) {
    if (animation.constructor.name !== 'CSSAnimation') continue;
    const end = animation.effect?.getComputedTiming().endTime;
    if (typeof end !== 'number' || !Number.isFinite(end)) continue; // spinners and other endless loops
    try {
      animation.finish();
    } catch {
      /* already finished or removed */
    }
  }
}

/**
 * Keeps a replayer's frame in step with the state above. `apply` runs the fixes right away;
 * otherwise they run once per frame after the replayer changes the page.
 */
export function attachReplayFixes(replayer: Replayer, { playing = false } = {}): { apply: () => void; detach: () => void } {
  let paused = !playing;
  let frame = 0;
  const apply = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    const doc = replayer.iframe.contentDocument;
    if (!doc?.documentElement) return;
    syncPopovers(doc);
    syncTargetRules(doc);
    if (paused) finishAnimations(doc);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };
  const setPaused = (value: boolean) => () => {
    paused = value;
    schedule();
  };
  const handlers: Record<string, () => void> = {
    'event-cast': schedule,
    'fullsnapshot-rebuilded': schedule,
    flush: schedule,
    pause: setPaused(true),
    finish: setPaused(true),
    start: setPaused(false),
    resume: setPaused(false),
  };
  for (const [name, handler] of Object.entries(handlers)) replayer.on(name, handler);
  schedule();
  return {
    apply,
    detach: () => {
      cancelAnimationFrame(frame);
      for (const [name, handler] of Object.entries(handlers)) replayer.off(name, handler);
    },
  };
}
