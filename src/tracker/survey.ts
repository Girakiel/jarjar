// On-page surveys: one question at a time in a small card in the corner.

import type { SurveyAnswer, SurveyDefinition } from '../shared/protocol';
import { BASE_CSS, createHost, el, safeColor } from './widget';

export const SURVEY_HOST_ID = 'jarjar-survey';

const EXIT_ARM_DELAY_MS = 3000;
const EXIT_FALLBACK_MS = 30_000; // touch devices have no "mouse leaves the window"

/** Waits for the survey's trigger, then calls `fire` once. Returns a function that cancels the wait. */
export function armTrigger(trigger: SurveyDefinition['trigger'], fire: () => void): () => void {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const listeners: Array<() => void> = [];
  const cancel = () => {
    timers.forEach(clearTimeout);
    listeners.forEach((off) => off());
  };
  const once = () => {
    cancel();
    fire();
  };

  if (trigger.type === 'immediate' || trigger.type === 'delay') {
    timers.push(setTimeout(once, trigger.type === 'immediate' ? 1500 : Math.max(1, trigger.value) * 1000));
  } else if (trigger.type === 'scroll') {
    const check = () => {
      const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
      if (((window.scrollY + window.innerHeight) / docHeight) * 100 >= trigger.value) once();
    };
    window.addEventListener('scroll', check, { passive: true });
    listeners.push(() => window.removeEventListener('scroll', check));
    timers.push(setTimeout(check, 1500)); // short pages may never scroll
  } else if (window.matchMedia?.('(hover: hover)').matches) {
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget && e.clientY <= 0) once();
    };
    timers.push(
      setTimeout(() => {
        document.addEventListener('mouseout', onOut);
        listeners.push(() => document.removeEventListener('mouseout', onOut));
      }, EXIT_ARM_DELAY_MS),
    );
  } else {
    timers.push(setTimeout(once, EXIT_FALLBACK_MS));
  }
  return cancel;
}

function css(color: string, position: 'left' | 'right'): string {
  return `${BASE_CSS}
  .card { position: fixed; ${position}: 16px; bottom: 16px; width: 340px; max-width: calc(100vw - 32px); background: #fff; color: #1c1c1f;
    border-radius: 14px; box-shadow: 0 12px 44px rgba(0,0,0,.24); padding: 18px; z-index: 2147483647; animation: rise .25s ease-out; }
  @keyframes rise { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
  .close { position: absolute; top: 10px; right: 12px; background: none; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: #6f6e77; padding: 0; }
  .q { font-size: 15px; font-weight: 600; line-height: 1.4; margin: 0 22px 14px 0; }
  .nps { display: grid; grid-template-columns: repeat(11, 1fr); gap: 3px; }
  .score { border: 1px solid #d8d8de; background: #fff; border-radius: 6px; padding: 7px 0; font-size: 13px; cursor: pointer; color: inherit; }
  .score:hover { border-color: ${color}; }
  .labels { display: flex; justify-content: space-between; font-size: 11.5px; color: #6f6e77; margin-top: 6px; }
  .options { display: flex; flex-direction: column; gap: 6px; }
  .option { text-align: left; border: 1px solid #d8d8de; background: #fff; border-radius: 8px; padding: 9px 12px; font-size: 14px; cursor: pointer; color: inherit; }
  .option:hover { border-color: ${color}; }
  [aria-pressed="true"] { border-color: ${color}; background: ${color}; color: #fff; }
  .option[aria-pressed="true"] { background: ${color}18; color: inherit; box-shadow: inset 0 0 0 1px ${color}; }
  textarea { width: 100%; min-height: 84px; border: 1px solid #d8d8de; border-radius: 8px; padding: 8px 10px; font-size: 14px; resize: vertical; color: inherit; }
  .foot { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; }
  .progress { font-size: 12px; color: #6f6e77; }
  .next { background: ${color}; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .next:disabled { opacity: .45; cursor: default; }
  .thanks { font-size: 15px; font-weight: 600; text-align: center; margin: 8px 0; }
`;
}

function isAnswered(answer: SurveyAnswer | undefined): boolean {
  return answer !== undefined && answer !== '' && !(Array.isArray(answer) && answer.length === 0);
}

/**
 * Shows the survey. `onDone` gets the answers when it's submitted, or when it's
 * closed part-way with at least one answer; `onClose` runs when the card goes away.
 */
export function showSurvey(
  def: SurveyDefinition,
  handlers: { onDone: (answers: Record<string, SurveyAnswer>, completed: boolean) => void; onClose: () => void },
): void {
  const { host, root } = createHost(SURVEY_HOST_ID);
  const color = safeColor(def.color);
  const answers: Record<string, SurveyAnswer> = {};
  let index = 0;
  let finished = false;

  root.innerHTML = `<style>${css(color, def.position)}</style>`;
  const card = el('div', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Survey');
  const close = el('button', 'close', '×');
  close.setAttribute('aria-label', 'Close');
  const body = el('div');
  const foot = el('div', 'foot');
  const progress = el('span', 'progress');
  const next = el('button', 'next');
  foot.append(progress, next);
  card.append(close, body, foot);
  root.append(card);

  const answered = () => {
    const out: Record<string, SurveyAnswer> = {};
    for (const [id, a] of Object.entries(answers)) if (isAnswered(a)) out[id] = a;
    return out;
  };
  const remove = () => {
    host.remove();
    handlers.onClose();
  };

  const render = () => {
    const q = def.questions[index];
    const last = index === def.questions.length - 1;
    const update = () => {
      next.disabled = q.required && !isAnswered(answers[q.id]);
    };
    body.replaceChildren(el('p', 'q', q.text));

    if (q.type === 'nps') {
      const scale = el('div', 'nps');
      const labels = el('div', 'labels');
      labels.append(el('span', '', def.texts.low), el('span', '', def.texts.high));
      for (let n = 0; n <= 10; n++) {
        const b = el('button', 'score', String(n));
        b.setAttribute('aria-pressed', String(answers[q.id] === n));
        b.addEventListener('click', () => {
          answers[q.id] = n;
          scale.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          update();
        });
        scale.append(b);
      }
      body.append(scale, labels);
    } else if (q.type === 'single' || q.type === 'multiple') {
      const list = el('div', 'options');
      const isSelected = (option: string) =>
        q.type === 'single' ? answers[q.id] === option : ((answers[q.id] as string[] | undefined) ?? []).includes(option);
      const buttons = q.options.map((option) => {
        const b = el('button', 'option', option);
        b.addEventListener('click', () => {
          if (q.type === 'single') {
            answers[q.id] = option;
          } else {
            const current = (answers[q.id] as string[] | undefined) ?? [];
            answers[q.id] = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
          }
          refresh();
          update();
        });
        return [b, option] as const;
      });
      const refresh = () => buttons.forEach(([b, option]) => b.setAttribute('aria-pressed', String(isSelected(option))));
      refresh();
      list.append(...buttons.map(([b]) => b));
      body.append(list);
    } else {
      const text = el('textarea');
      text.maxLength = 2000;
      text.value = typeof answers[q.id] === 'string' ? (answers[q.id] as string) : '';
      text.addEventListener('input', () => {
        answers[q.id] = text.value.trim();
        update();
      });
      body.append(text);
    }

    progress.textContent = def.questions.length > 1 ? `${index + 1} / ${def.questions.length}` : '';
    next.textContent = last ? def.texts.submit : def.texts.next;
    update();
  };

  next.addEventListener('click', () => {
    if (index < def.questions.length - 1) {
      index++;
      render();
      return;
    }
    finished = true;
    handlers.onDone(answered(), true);
    body.replaceChildren(el('p', 'thanks', def.texts.thanks));
    foot.remove();
    setTimeout(remove, 3000);
  });
  close.addEventListener('click', () => {
    if (!finished && Object.keys(answered()).length) handlers.onDone(answered(), false);
    remove();
  });

  render();
}
