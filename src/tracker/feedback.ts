// A small "rate your experience" tab rendered in a shadow root so the host
// page's CSS can't leak in (and ours can't leak out).

export const WIDGET_HOST_ID = 'jarjar-feedback';

const RATINGS: Array<[number, string, string]> = [
  [1, '😡', 'Hate it'],
  [2, '🙁', 'Dislike it'],
  [3, '😐', 'Neutral'],
  [4, '🙂', 'Like it'],
  [5, '😍', 'Love it'],
];

export interface FeedbackOptions {
  title: string;
  color: string;
  onSubmit: (rating: number, comment: string) => Promise<void>;
}

function safeColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#6e56cf';
}

export function mountFeedbackWidget(opts: FeedbackOptions): void {
  if (document.getElementById(WIDGET_HOST_ID)) return;
  const host = document.createElement('div');
  host.id = WIDGET_HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const color = safeColor(opts.color);

  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .tab { position: fixed; right: 0; top: 50%; transform: translateY(-50%) rotate(180deg); writing-mode: vertical-rl;
    background: ${color}; color: #fff; border: 0; padding: 14px 9px; border-radius: 0 6px 6px 0; cursor: pointer;
    font-size: 13px; font-weight: 600; letter-spacing: .02em; z-index: 2147483646; box-shadow: 0 2px 10px rgba(0,0,0,.18); }
  .panel { position: fixed; right: 16px; bottom: 16px; width: 320px; max-width: calc(100vw - 32px); background: #fff; color: #1c1c1f;
    border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.22); padding: 18px; z-index: 2147483647; display: none; }
  .panel.open { display: block; }
  .head { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
  h2 { font-size: 15px; margin: 0 0 14px; font-weight: 600; line-height: 1.35; }
  .close { background: none; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: #6f6e77; padding: 0; }
  .ratings { display: flex; justify-content: space-between; gap: 4px; }
  .rating { flex: 1; background: #f4f4f6; border: 2px solid transparent; border-radius: 10px; font-size: 26px; padding: 8px 0; cursor: pointer; transition: transform .1s; }
  .rating:hover { transform: scale(1.08); }
  .rating[aria-pressed="true"] { border-color: ${color}; background: #fff; }
  textarea { width: 100%; margin-top: 14px; min-height: 76px; border: 1px solid #d8d8de; border-radius: 8px; padding: 8px 10px; font-size: 14px; resize: vertical; display: none; }
  textarea.show { display: block; }
  .send { margin-top: 12px; width: 100%; background: ${color}; color: #fff; border: 0; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; display: none; }
  .send.show { display: block; }
  .send:disabled { opacity: .6; cursor: default; }
  .thanks { text-align: center; font-size: 14px; padding: 18px 0 6px; }
</style>
<button class="tab" part="tab" type="button">Feedback</button>
<div class="panel" role="dialog" aria-label="Feedback">
  <div class="body">
    <div class="head"><h2></h2><button class="close" type="button" aria-label="Close">×</button></div>
    <div class="ratings">${RATINGS.map(([v, e, label]) => `<button type="button" class="rating" data-v="${v}" title="${label}" aria-label="${label}" aria-pressed="false">${e}</button>`).join('')}</div>
    <textarea maxlength="2000" placeholder="Tell us more (optional)"></textarea>
    <button class="send" type="button">Send feedback</button>
  </div>
</div>`;

  const tab = root.querySelector<HTMLButtonElement>('.tab')!;
  const panel = root.querySelector<HTMLDivElement>('.panel')!;
  const body = root.querySelector<HTMLDivElement>('.body')!;
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!;
  const send = root.querySelector<HTMLButtonElement>('.send')!;
  root.querySelector('h2')!.textContent = opts.title;
  let rating = 0;

  tab.addEventListener('click', () => {
    panel.classList.add('open');
    tab.style.display = 'none';
  });
  root.querySelector('.close')!.addEventListener('click', () => {
    panel.classList.remove('open');
    tab.style.display = '';
  });
  root.querySelectorAll<HTMLButtonElement>('.rating').forEach((btn) => {
    btn.addEventListener('click', () => {
      rating = Number(btn.dataset.v);
      root.querySelectorAll('.rating').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      textarea.classList.add('show');
      send.classList.add('show');
      textarea.focus();
    });
  });
  send.addEventListener('click', async () => {
    if (!rating) return;
    send.disabled = true;
    try {
      await opts.onSubmit(rating, textarea.value.trim());
      body.innerHTML = '<div class="thanks">Thanks for your feedback! 🙏</div>';
      setTimeout(() => host.remove(), 2500);
    } catch {
      send.disabled = false;
      send.textContent = 'Something went wrong — try again';
    }
  });

  document.body.appendChild(host);
}
