import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_SURVEY_TEXTS, DEVICES, type Device, type SurveyTexts, type SurveyTriggerType } from '../../shared/protocol';
import { api, useApi, type QuestionType, type Survey, type SurveyContent, type SurveyQuestion } from '../api';
import { Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { ErrorBox, PageHeader, Segmented, Spinner, Toggle } from '../components/ui';

const TYPE_LABELS: Record<QuestionType, string> = {
  nps: 'Score 0–10 (NPS)',
  single: 'Single choice',
  multiple: 'Multiple choice',
  text: 'Written answer',
};

const TRIGGER_LABELS: Record<SurveyTriggerType, string> = {
  immediate: 'As soon as the page loads',
  delay: 'After some time on the page',
  scroll: 'After scrolling part of the page',
  exit: 'When the visitor is about to leave',
};

const TEXT_FIELDS: Array<[keyof SurveyTexts, string]> = [
  ['next', 'Next button'],
  ['submit', 'Send button'],
  ['thanks', 'Thank-you message'],
  ['low', 'Score scale, low end'],
  ['high', 'Score scale, high end'],
];

const DEVICE_LABELS: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 10;

const newId = () => Math.random().toString(36).slice(2, 10);

function withType(q: SurveyQuestion, type: QuestionType): SurveyQuestion {
  const choice = type === 'single' || type === 'multiple';
  const options = choice ? (q.options.length >= 2 ? q.options : ['Option 1', 'Option 2']) : [];
  return { ...q, type, options, required: type === 'text' ? false : q.required };
}

export function SurveyEditorPage() {
  const { site } = useSite();
  const { surveyId } = useParams();
  const navigate = useNavigate();
  const { data: survey, error } = useApi<Survey>(`/surveys/${surveyId}`);
  const [name, setName] = useState('');
  const [active, setActive] = useState(false);
  const [def, setDef] = useState<SurveyContent | null>(null);
  const [pages, setPages] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!survey) return;
    setName(survey.name);
    setActive(survey.active);
    setDef(survey.definition);
    setPages(survey.definition.pages.join('\n'));
  }, [survey]);

  if (error) return <ErrorBox error={error} />;
  if (!survey || !def) return <Spinner />;

  const change = (patch: Partial<SurveyContent>) => {
    setDef({ ...def, ...patch });
    setStatus(null);
  };
  const setQuestion = (i: number, q: SurveyQuestion) => change({ questions: def.questions.map((x, j) => (j === i ? q : x)) });
  const moveQuestion = (i: number, by: number) => {
    const list = [...def.questions];
    const [q] = list.splice(i, 1);
    list.splice(i + by, 0, q);
    change({ questions: list });
  };
  const addQuestion = () =>
    change({ questions: [...def.questions, { id: newId(), type: 'text', text: '', required: false, options: [] }] });
  const toggleDevice = (device: Device, on: boolean) =>
    change({ devices: on ? DEVICES.filter((d) => d === device || def.devices.includes(d)) : def.devices.filter((d) => d !== device) });

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setStatus(null);
    try {
      const saved = await api<Survey>(`/surveys/${survey.id}`, { method: 'PATCH', body: { name, active, definition: { ...def, pages } } });
      setDef(saved.definition);
      setPages(saved.definition.pages.join('\n'));
      setStatus({ ok: true, text: active ? 'Saved. Visitors start seeing it within a minute.' : 'Saved. The survey is off until you switch it on.' });
      return true;
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (await save()) navigate(`/sites/${site.id}/test?survey=${survey.id}`);
  };

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            <Link to={`/sites/${site.id}/surveys`} className="btn btn-ghost btn-sm btn-icon" aria-label="Back to surveys">
              <Icon name="left" />
            </Link>
            Edit survey
          </span>
        }
      >
        <Link className="btn btn-sm" to={`/sites/${site.id}/surveys/${survey.id}`}>
          Results
        </Link>
        <button type="button" className="btn btn-sm" onClick={preview} disabled={saving}>
          <Icon name="click" /> Preview on Test page
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || !def.devices.length}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </PageHeader>

      <div className="stack" style={{ maxWidth: 820 }}>
        {status && (status.ok ? <div className="notice">{status.text}</div> : <ErrorBox error={status.text} />)}

        <div className="card">
          <div className="card-body form-grid">
            <div className="field">
              <label htmlFor="survey-name">Survey name</label>
              <input id="survey-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
              <span className="hint">Only you see this.</span>
            </div>
            <Toggle checked={active} onChange={(v) => { setActive(v); setStatus(null); }} label="Live" hint="When on, visitors who match the targeting below see the survey (once each)." />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Questions</h2>
            <span className="small muted">Shown one at a time</span>
          </div>
          <div className="card-body stack">
            {def.questions.map((q, i) => (
              <div className="question-card" key={q.id}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <strong>Question {i + 1}</strong>
                  <div className="row">
                    <select aria-label="Question type" value={q.type} onChange={(e) => setQuestion(i, withType(q, e.target.value as QuestionType))}>
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Move up" disabled={i === 0} onClick={() => moveQuestion(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Move down" disabled={i === def.questions.length - 1} onClick={() => moveQuestion(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Delete question" disabled={def.questions.length === 1} onClick={() => change({ questions: def.questions.filter((_, j) => j !== i) })}>
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
                <input type="text" aria-label="Question" placeholder="Type your question" value={q.text} onChange={(e) => setQuestion(i, { ...q, text: e.target.value })} />
                {(q.type === 'single' || q.type === 'multiple') && (
                  <div className="options-editor">
                    {q.options.map((option, k) => (
                      <div className="row" key={k}>
                        <span className="faint">{q.type === 'single' ? '○' : '☐'}</span>
                        <input
                          type="text"
                          aria-label={`Option ${k + 1}`}
                          value={option}
                          onChange={(e) => setQuestion(i, { ...q, options: q.options.map((o, m) => (m === k ? e.target.value : o)) })}
                          style={{ flex: 1 }}
                        />
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remove option" disabled={q.options.length <= 2} onClick={() => setQuestion(i, { ...q, options: q.options.filter((_, m) => m !== k) })}>
                          ×
                        </button>
                      </div>
                    ))}
                    {q.options.length < MAX_OPTIONS && (
                      <button type="button" className="link-button small" onClick={() => setQuestion(i, { ...q, options: [...q.options, `Option ${q.options.length + 1}`] })}>
                        + Add option
                      </button>
                    )}
                  </div>
                )}
                {q.type === 'nps' && (
                  <p className="small muted" style={{ margin: 0 }}>
                    Visitors pick a number from 0 to 10. 9–10 count as promoters, 0–6 as detractors.
                  </p>
                )}
                <label className="check">
                  <input type="checkbox" checked={q.required} onChange={(e) => setQuestion(i, { ...q, required: e.target.checked })} />
                  Answer required to continue
                </label>
              </div>
            ))}
            {def.questions.length < MAX_QUESTIONS && (
              <button type="button" className="btn" onClick={addQuestion} style={{ alignSelf: 'flex-start' }}>
                <Icon name="plus" /> Add question
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Who sees it, and when</h2>
          </div>
          <div className="card-body form-grid">
            <div className="field">
              <label htmlFor="survey-trigger">Show it</label>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <select
                  id="survey-trigger"
                  value={def.trigger.type}
                  onChange={(e) => {
                    const type = e.target.value as SurveyTriggerType;
                    change({ trigger: { type, value: type === 'delay' ? 10 : type === 'scroll' ? 50 : 0 } });
                  }}
                >
                  {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {(def.trigger.type === 'delay' || def.trigger.type === 'scroll') && (
                  <span className="row">
                    <input
                      type="number"
                      aria-label={def.trigger.type === 'delay' ? 'Seconds' : 'Percent'}
                      min={def.trigger.type === 'delay' ? 0 : 1}
                      max={def.trigger.type === 'delay' ? 600 : 100}
                      value={def.trigger.value}
                      onChange={(e) => change({ trigger: { ...def.trigger, value: Number(e.target.value) } })}
                      style={{ width: 90 }}
                    />
                    <span className="muted">{def.trigger.type === 'delay' ? 'seconds' : '% of the page'}</span>
                  </span>
                )}
              </div>
              {def.trigger.type === 'exit' && <span className="hint">On phones and tablets, which can't tell when someone is leaving, it shows after 30 seconds instead.</span>}
              <span className="hint">Each visitor sees a survey at most once.</span>
            </div>
            <div className="field">
              <label htmlFor="survey-pages">On pages</label>
              <textarea id="survey-pages" rows={3} placeholder={'/pricing\n/blog/*'} value={pages} onChange={(e) => { setPages(e.target.value); setStatus(null); }} />
              <span className="hint">One path per line; * matches anything (e.g. /blog/*). Leave empty for every page.</span>
            </div>
            <div className="field">
              <span className="label">On devices</span>
              <div className="row" style={{ gap: 16 }}>
                {DEVICES.map((d) => (
                  <label key={d} className="check">
                    <input type="checkbox" checked={def.devices.includes(d)} onChange={(e) => toggleDevice(d, e.target.checked)} />
                    {DEVICE_LABELS[d]}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Look and wording</h2>
          </div>
          <div className="card-body form-grid">
            <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
              <div className="field">
                <span className="label">Corner</span>
                <Segmented
                  label="Corner"
                  value={def.position}
                  onChange={(v) => change({ position: v })}
                  options={[
                    { value: 'left', label: 'Bottom left' },
                    { value: 'right', label: 'Bottom right' },
                  ]}
                />
              </div>
              <div className="field">
                <label htmlFor="survey-color">Color</label>
                <div className="color-input">
                  <input id="survey-color" type="color" value={def.color} onChange={(e) => change({ color: e.target.value })} />
                  <code>{def.color}</code>
                </div>
              </div>
            </div>
            <div className="wording-grid">
              {TEXT_FIELDS.map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={`survey-text-${key}`}>{label}</label>
                  <input
                    id={`survey-text-${key}`}
                    type="text"
                    value={def.texts[key]}
                    placeholder={DEFAULT_SURVEY_TEXTS[key]}
                    onChange={(e) => change({ texts: { ...def.texts, [key]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
