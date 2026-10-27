// The "rate your experience" tab. Position, style, wording and the element
// picker are configured per site in the dashboard.

import type { FeedbackWidgetConfig, PickedElement } from '../shared/protocol';
import { pickElement } from './picker';
import { BASE_CSS, createHost, el, safeColor } from './widget';

export const WIDGET_HOST_ID = 'jarjar-feedback';

const EMOJI = ['😡', '🙁', '😐', '🙂', '😍'];
const LABELS = ['Hate it', 'Dislike it', 'Neutral', 'Like it', 'Love it'];

export interface FeedbackSubmission {
  rating: number;
  comment: string;
  element?: PickedElement;
}

function css(color: string, position: 'left' | 'right'): string {
  const side = position;
  return `${BASE_CSS}
  .tab { position: fixed; ${side}: 0; top: 50%; transform: translateY(-50%) rotate(180deg); writing-mode: vertical-rl;
    background: ${color}; color: #fff; border: 0; padding: 14px 9px; cursor: pointer; font-size: 13px; font-weight: 600;
    letter-spacing: .02em; z-index: 2147483646; box-shadow: 0 2px 10px rgba(0,0,0,.18);
    border-radius: ${side === 'right' ? '0 6px 6px 0' : '6px 0 0 6px'}; }
  .panel { position: fixed; ${side}: 16px; bottom: 16px; width: 330px; max-width: calc(100vw - 32px); background: #fff; color: #1c1c1f;
    border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.22); padding: 18px; z-index: 2147483647; display: none; }
  .panel.open { display: block; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  h2 { font-size: 15px; margin: 0 0 14px; font-weight: 600; line-height: 1.35; }
  .close { background: none; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: #6f6e77; padding: 0; }
  .ratings { display: flex; justify-content: space-between; gap: 4px; }
  .rating { flex: 1; background: #f4f4f6; border: 2px solid transparent; border-radius: 10px; font-size: 26px; padding: 8px 0; cursor: pointer; transition: transform .1s; }
  .rating:hover { transform: scale(1.08); }
  .rating[aria-pressed="true"] { border-color: ${color}; background: #fff; }
  .stars { display: flex; justify-content: center; gap: 2px; }
  .star { background: none; border: 0; font-size: 34px; line-height: 1; padding: 2px 4px; cursor: pointer; color: #d4d4dc; }
  .star.on, .stars:hover .star { color: ${color}; }
  .stars .star:hover ~ .star { color: #d4d4dc; }
  .more { display: none; }
  .more.show { display: block; }
  textarea { width: 100%; margin-top: 14px; min-height: 76px; border: 1px solid #d8d8de; border-radius: 8px; padding: 8px 10px; font-size: 14px; resize: vertical; color: inherit; }
  .pick { margin-top: 10px; background: none; border: 1px dashed #c8c8d0; border-radius: 8px; width: 100%; padding: 8px 10px; font-size: 13px; cursor: pointer; color: #45454d; text-align: left; }
  .pick:hover { border-color: ${color}; color: ${color}; }
  .picked { margin-top: 10px; display: none; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px;
    background: ${color}14; color: #1c1c1f; border-radius: 8px; padding: 8px 10px; }
  .picked.show { display: flex; }
  .picked button { background: none; border: 0; cursor: pointer; font-size: 16px; color: #6f6e77; padding: 0; }
  .send { margin-top: 12px; width: 100%; background: ${color}; color: #fff; border: 0; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .send:disabled { opacity: .6; cursor: default; }
  .thanks { text-align: center; font-size: 14px; padding: 18px 0 6px; }
`;
}

export class FeedbackWidget {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private rating = 0;
  private element?: PickedElement;

  constructor(
    private readonly config: FeedbackWidgetConfig,
    private readonly onSubmit: (submission: FeedbackSubmission) => Promise<void>,
    private readonly ignoreForPicking: (el: Element) => boolean,
  ) {
    const { host, root } = createHost(WIDGET_HOST_ID);
    this.host = host;
    this.root = root;
    this.render();
  }

  setVisible(visible: boolean): void {
    this.host.style.display = visible ? '' : 'none';
  }

  private render(): void {
    const { config } = this;
    const color = safeColor(config.color);
    const texts = config.texts;
    this.root.innerHTML = `<style>${css(color, config.position)}</style>`;
    this.rating = 0;
    this.element = undefined;

    const tab = el('button', 'tab', texts.tab);
    const panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', texts.tab);
    const head = el('div', 'head');
    const close = el('button', 'close', '×');
    close.setAttribute('aria-label', 'Close');
    head.append(el('h2', '', config.title), close);

    const more = el('div', 'more');
    const ratings = el('div', config.style === 'stars' ? 'stars' : 'ratings');
    const buttons = EMOJI.map((emoji, i) => {
      const b = el('button', config.style === 'stars' ? 'star' : 'rating', config.style === 'stars' ? '★' : emoji);
      b.title = LABELS[i];
      b.setAttribute('aria-label', LABELS[i]);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        this.rating = i + 1;
        buttons.forEach((other, j) => {
          other.setAttribute('aria-pressed', String(j === i));
          other.classList.toggle('on', config.style === 'stars' && j <= i);
        });
        more.classList.add('show');
      });
      return b;
    });
    ratings.append(...buttons);

    const textarea = el('textarea');
    textarea.maxLength = 2000;
    textarea.placeholder = texts.placeholder;
    const picked = el('div', 'picked');
    const removePick = el('button', '', '×');
    removePick.setAttribute('aria-label', 'Remove');
    picked.append(el('span', '', `📍 ${texts.picked}`), removePick);
    const pick = el('button', 'pick', `📍 ${texts.pick}`);
    const send = el('button', 'send', texts.send);
    more.append(textarea);
    if (config.allowPick) more.append(pick, picked);
    more.append(send);

    const body = el('div');
    body.append(head, ratings, more);
    panel.append(body);
    this.root.append(tab, panel);

    const open = (value: boolean) => {
      panel.classList.toggle('open', value);
      tab.style.display = value ? 'none' : '';
    };
    tab.addEventListener('click', () => open(true));
    close.addEventListener('click', () => open(false));

    pick.addEventListener('click', async () => {
      panel.style.visibility = 'hidden';
      const result = await pickElement({ hint: texts.pickHint, color, ignore: this.ignoreForPicking });
      panel.style.visibility = '';
      if (result) {
        this.element = result;
        pick.style.display = 'none';
        picked.classList.add('show');
      }
    });
    removePick.addEventListener('click', () => {
      this.element = undefined;
      picked.classList.remove('show');
      pick.style.display = '';
    });

    send.addEventListener('click', async () => {
      if (!this.rating) return;
      send.disabled = true;
      try {
        await this.onSubmit({ rating: this.rating, comment: textarea.value.trim(), element: this.element });
        body.replaceChildren(el('div', 'thanks', texts.thanks));
        setTimeout(() => this.render(), 2500);
      } catch {
        send.disabled = false;
      }
    });
  }
}
