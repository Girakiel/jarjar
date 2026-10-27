import crypto from 'node:crypto';
import {
  DEFAULT_SURVEY_TEXTS,
  type QuestionType,
  type SurveyAnswer,
  type SurveyDefinition,
  type SurveyQuestion,
  type SurveyTexts,
  type SurveyTriggerType,
} from '../shared/protocol';
import { cleanColor, cleanDevices, cleanPatterns, cleanText, parseJsonObject } from './clean';
import { clamp, int } from './http';

export type SurveyContent = Omit<SurveyDefinition, 'id'>;

const QUESTION_TYPES: QuestionType[] = ['nps', 'single', 'multiple', 'text'];
const TRIGGERS: SurveyTriggerType[] = ['immediate', 'delay', 'scroll', 'exit'];
const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 10;

export const newSurveyId = () => crypto.randomBytes(6).toString('hex');
const newQuestionId = () => crypto.randomBytes(4).toString('hex');

function cleanQuestion(raw: Record<string, unknown>): SurveyQuestion {
  const type = QUESTION_TYPES.includes(raw.type as QuestionType) ? (raw.type as QuestionType) : 'text';
  const id = typeof raw.id === 'string' && /^[a-z0-9]{1,16}$/i.test(raw.id) ? raw.id : newQuestionId();
  let options: string[] = [];
  if (type === 'single' || type === 'multiple') {
    const list = Array.isArray(raw.options) ? raw.options : [];
    options = list.map((o) => String(o).trim().slice(0, 100)).filter(Boolean).slice(0, MAX_OPTIONS);
    while (options.length < 2) options.push(`Option ${options.length + 1}`);
  }
  // Choice and score questions are required unless switched off; text answers are optional by default.
  const required = raw.required === undefined ? type !== 'text' : raw.required === true;
  return { id, type, text: cleanText(raw.text, 'Untitled question', 300), required, options };
}

/** Validates survey content from the editor (or stored JSON), filling in defaults. */
export function cleanSurveyContent(raw: Record<string, unknown>): SurveyContent {
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions.slice(0, MAX_QUESTIONS) : [];
  const questions = rawQuestions.map((q) => cleanQuestion(q && typeof q === 'object' ? (q as Record<string, unknown>) : {}));
  if (!questions.length) questions.push(cleanQuestion({ type: 'text', text: 'What would you like to tell us?' }));
  const ids = new Set<string>();
  for (const q of questions) {
    while (ids.has(q.id)) q.id = newQuestionId();
    ids.add(q.id);
  }

  const trigger = (raw.trigger ?? {}) as Record<string, unknown>;
  const type = TRIGGERS.includes(trigger.type as SurveyTriggerType) ? (trigger.type as SurveyTriggerType) : 'delay';
  const value = type === 'delay' ? clamp(int(trigger.value, 5), 0, 600) : type === 'scroll' ? clamp(int(trigger.value, 50), 1, 100) : 0;

  const texts = (raw.texts ?? {}) as Record<string, unknown>;
  return {
    questions,
    trigger: { type, value },
    pages: cleanPatterns(raw.pages),
    devices: cleanDevices(raw.devices),
    position: raw.position === 'left' ? 'left' : 'right',
    color: cleanColor(raw.color, '#6e56cf'),
    texts: Object.fromEntries(
      Object.entries(DEFAULT_SURVEY_TEXTS).map(([key, fallback]) => [key, cleanText(texts[key], fallback, 100)]),
    ) as unknown as SurveyTexts,
  };
}

export function parseSurveyContent(json: string): SurveyContent {
  return cleanSurveyContent(parseJsonObject(json));
}

export const TEMPLATES: Record<string, { name: string; content: Record<string, unknown> }> = {
  nps: {
    name: 'Net Promoter Score',
    content: {
      questions: [
        { type: 'nps', text: 'How likely are you to recommend us to a friend or colleague?' },
        { type: 'text', text: "What's the main reason for your score?" },
      ],
      trigger: { type: 'delay', value: 10 },
    },
  },
  exit: {
    name: 'Exit survey',
    content: {
      questions: [
        {
          type: 'single',
          text: 'What stopped you from signing up today?',
          options: ["It's too expensive", "It's missing something I need", 'I was just looking around', 'Something else'],
        },
        { type: 'text', text: 'Anything else you would like to tell us?' },
      ],
      trigger: { type: 'exit', value: 0 },
    },
  },
  found: {
    name: 'Did you find it?',
    content: {
      questions: [
        { type: 'single', text: 'Did you find what you were looking for?', options: ['Yes', 'Partly', 'No'] },
        { type: 'text', text: 'What were you looking for?' },
      ],
      trigger: { type: 'scroll', value: 50 },
    },
  },
  blank: {
    name: 'New survey',
    content: { questions: [{ type: 'text', text: 'What would you like to tell us?' }] },
  },
};

export interface SurveyRow {
  id: string;
  site_id: string;
  name: string;
  active: number;
  definition: string;
  views: number;
  created_at: number;
  updated_at: number;
}

export function toSurvey(row: SurveyRow) {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    active: !!row.active,
    definition: parseSurveyContent(row.definition),
    views: row.views,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Per-question aggregates for the results page. Text answers are listed with the responses instead. */
export function summarize(questions: SurveyQuestion[], responses: Array<Record<string, SurveyAnswer>>) {
  return questions.map((q) => {
    const answers = responses
      .map((r) => r[q.id])
      .filter((a) => a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && a.length === 0));
    const base = { id: q.id, type: q.type, text: q.text, answered: answers.length };
    if (q.type === 'nps') {
      const counts: number[] = Array(11).fill(0);
      for (const a of answers) {
        const n = Number(a);
        if (Number.isInteger(n) && n >= 0 && n <= 10) counts[n]++;
      }
      const total = counts.reduce((sum, c) => sum + c, 0);
      const promoters = counts[9] + counts[10];
      const passives = counts[7] + counts[8];
      const detractors = total - promoters - passives;
      return { ...base, answered: total, counts, promoters, passives, detractors, score: total ? Math.round(((promoters - detractors) / total) * 100) : null };
    }
    if (q.type === 'single' || q.type === 'multiple') {
      const counts = new Map(q.options.map((o) => [o, 0]));
      for (const a of answers) {
        for (const value of Array.isArray(a) ? a : [a]) {
          if (counts.has(String(value))) counts.set(String(value), counts.get(String(value))! + 1);
        }
      }
      return { ...base, options: [...counts.entries()].map(([option, count]) => ({ option, count })) };
    }
    return base;
  });
}
