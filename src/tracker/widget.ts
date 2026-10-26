// Helpers shared by the on-page UI (feedback widget, element picker, surveys).
// Each piece lives in its own shadow root so host-page CSS can't affect it.

export function createHost(id: string): { host: HTMLElement; root: ShadowRoot } {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  const root = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  return { host, root };
}

export function safeColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#6e56cf';
}

/** Creates an element with optional class and text. Text is never parsed as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (node instanceof HTMLButtonElement) node.type = 'button';
  return node;
}

export const BASE_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  button { font: inherit; }
`;
