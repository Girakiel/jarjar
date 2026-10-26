// Builds CSS selectors that can be resolved again against an rrweb snapshot of the
// same page. Uses :nth-of-type so siblings that rrweb drops (scripts, comments)
// don't shift the indexes.

const GENERATED_ID = /\d{3,}|^(ember|react|radix|headlessui|mui|rc-|:r)|[:[\]]/i;

function isStableId(id: string): boolean {
  return id.length > 0 && id.length < 64 && !GENERATED_ID.test(id);
}

function escapeIdent(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^\w-]/g, '\\$&');
}

export function selectorFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'html') break;
    if (tag === 'body') {
      parts.unshift('body');
      break;
    }
    if (node.id && isStableId(node.id)) {
      const sel = '#' + escapeIdent(node.id);
      if (document.querySelectorAll(sel).length === 1) {
        parts.unshift(sel);
        break;
      }
    }
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    let index = 0;
    let sameTag = 0;
    for (const child of Array.from(parent.children)) {
      if (child.tagName === node.tagName) {
        sameTag++;
        if (child === node) index = sameTag;
      }
    }
    parts.unshift(sameTag > 1 ? `${tag}:nth-of-type(${index})` : tag);
    node = parent;
  }
  return parts.join('>');
}

/** SVG internals make brittle selectors; attribute clicks to the outer <svg>'s parent element instead. */
export function heatmapTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const svg = target.closest('svg');
  if (svg) return svg.parentElement ?? svg;
  return target;
}
