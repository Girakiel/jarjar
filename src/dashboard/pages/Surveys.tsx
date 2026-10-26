import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi, type QuestionSummary, type Survey, type SurveyAnswer, type SurveyResults } from '../api';
import { DeviceIcon, Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { BarList, DaysPicker, Empty, ErrorBox, PageHeader, Spinner, Stat, useDays } from '../components/ui';
import { formatDateTime, formatNumber, formatPercent, timeAgo } from '../format';

const TEMPLATES = [
  { id: 'nps', title: 'Net Promoter Score', text: '“How likely are you to recommend us?” on a 0–10 scale, plus why.' },
  { id: 'exit', title: 'Exit survey', text: 'Asks visitors who are about to leave what stopped them.' },
  { id: 'found', title: 'Did you find it?', text: 'Checks whether visitors found what they came for.' },
  { id: 'blank', title: 'Start from scratch', text: 'One open question, ready for you to edit.' },
];

export function triggerLabel(trigger: Survey['definition']['trigger']): string {
  switch (trigger.type) {
    case 'immediate':
      return 'As soon as the page loads';
    case 'delay':
      return `After ${trigger.value} s on the page`;
    case 'scroll':
      return `After scrolling ${trigger.value}% of the page`;
    default:
      return 'When the visitor is about to leave';
  }
}

export function SurveysPage() {
  const { site } = useSite();
  const navigate = useNavigate();
  const { data: surveys, error, reload } = useApi<Survey[]>(`/sites/${site.id}/surveys`);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async (template: string) => {
    setBusy(true);
    try {
      const survey = await api<Survey>(`/sites/${site.id}/surveys`, { method: 'POST', body: { template } });
      navigate(`/sites/${site.id}/surveys/${survey.id}/edit`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (survey: Survey) => {
    await api(`/surveys/${survey.id}`, { method: 'PATCH', body: { active: !survey.active } });
    reload();
  };

  const remove = async (survey: Survey) => {
    if (!confirm(`Delete "${survey.name}" and all of its responses?`)) return;
    await api(`/surveys/${survey.id}`, { method: 'DELETE' });
    reload();
  };

  const templates = (
    <div className="template-grid">
      {TEMPLATES.map((t) => (
        <button type="button" key={t.id} className="template" disabled={busy} onClick={() => create(t.id)}>
          <strong>{t.title}</strong>
          <span className="small muted">{t.text}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="Surveys" subtitle="Ask visitors questions on your pages, from a quick NPS score to an exit survey.">
        {!!surveys?.length && (
          <button type="button" className="btn btn-primary" onClick={() => setPicking((p) => !p)}>
            <Icon name="plus" /> New survey
          </button>
        )}
      </PageHeader>
      {error ? (
        <ErrorBox error={error} />
      ) : !surveys ? (
        <Spinner />
      ) : !surveys.length ? (
        <div className="card">
          <Empty icon="survey" title="Create your first survey">
            <p>Pick a starting point. You can change every question, who sees it and when before switching it on.</p>
          </Empty>
          <div className="card-body" style={{ paddingTop: 0 }}>
            {templates}
          </div>
        </div>
      ) : (
        <div className="stack">
          {picking && (
            <div className="card">
              <div className="card-header">
                <h2>Start from</h2>
              </div>
              <div className="card-body">{templates}</div>
            </div>
          )}
          <div className="card table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Survey</th>
                  <th>Status</th>
                  <th className="num">Responses</th>
                  <th className="num">Response rate</th>
                  <th>Last response</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {surveys.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/sites/${site.id}/surveys/${s.id}`}>
                        <strong>{s.name}</strong>
                      </Link>
                      <div className="small muted">
                        {s.definition.questions.length} question{s.definition.questions.length === 1 ? '' : 's'} · {triggerLabel(s.definition.trigger)}
                      </div>
                    </td>
                    <td>
                      <label className="toggle small">
                        <input type="checkbox" checked={s.active} onChange={() => toggle(s)} />
                        <span className="track" />
                        {s.active ? 'Live' : 'Off'}
                      </label>
                    </td>
                    <td className="num">{formatNumber(s.responses ?? 0)}</td>
                    <td className="num">{s.views ? formatPercent((s.responses ?? 0) / s.views) : '—'}</td>
                    <td>{s.lastResponseAt ? timeAgo(s.lastResponseAt) : <span className="muted">—</span>}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Link className="btn btn-sm" to={`/sites/${site.id}/surveys/${s.id}`}>
                          Results
                        </Link>
                        <Link className="btn btn-sm" to={`/sites/${site.id}/surveys/${s.id}/edit`}>
                          Edit
                        </Link>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Delete survey" onClick={() => remove(s)}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function npsTone(score: number): string {
  if (score >= 30) return 'var(--success)';
  if (score >= 0) return 'var(--warning)';
  return 'var(--danger)';
}

function NpsSummary({ q }: { q: QuestionSummary }) {
  const counts = q.counts ?? [];
  const max = Math.max(1, ...counts);
  const total = q.answered || 1;
  return (
    <div className="nps-summary">
      <div>
        <div className="nps-score" style={{ color: q.score === null || q.score === undefined ? undefined : npsTone(q.score) }}>
          {q.score ?? '—'}
        </div>
        <div className="small muted">NPS, from −100 to 100</div>
        <div className="nps-groups small">
          <span style={{ color: 'var(--success)' }}>Promoters {formatPercent((q.promoters ?? 0) / total)}</span>
          <span className="muted">Passives {formatPercent((q.passives ?? 0) / total)}</span>
          <span style={{ color: 'var(--danger)' }}>Detractors {formatPercent((q.detractors ?? 0) / total)}</span>
        </div>
      </div>
      <div className="nps-bars" role="img" aria-label="Score distribution">
        {counts.map((c, n) => (
          <div key={n} className="nps-bar" title={`${n}: ${c}`}>
            <div className="small muted">{c || ''}</div>
            <div className={`fill ${n >= 9 ? 'promoter' : n >= 7 ? 'passive' : 'detractor'}`} style={{ height: `${(c / max) * 100}%` }} />
            <div className="small">{n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function answerText(answer: SurveyAnswer | undefined): string {
  if (answer === undefined) return '—';
  return Array.isArray(answer) ? answer.join(', ') : String(answer);
}

export function SurveyResultsPage() {
  const { site } = useSite();
  const { surveyId } = useParams();
  const [days] = useDays();
  const { data, error, reload } = useApi<SurveyResults>(`/surveys/${surveyId}/results?days=${days}`);
  const search = `?days=${days}`;

  const removeResponse = async (id: number) => {
    if (!confirm('Delete this response?')) return;
    await api(`/survey-responses/${id}`, { method: 'DELETE' });
    reload();
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const { survey } = data;
  const questions = survey.definition.questions;

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            <Link to={`/sites/${site.id}/surveys${search}`} className="btn btn-ghost btn-sm btn-icon" aria-label="Back to surveys">
              <Icon name="left" />
            </Link>
            {survey.name}
          </span>
        }
        subtitle={`${survey.active ? 'Live' : 'Off'} · ${triggerLabel(survey.definition.trigger)}`}
      >
        <DaysPicker />
        <Link className="btn btn-sm" to={`/sites/${site.id}/surveys/${survey.id}/edit`}>
          Edit survey
        </Link>
      </PageHeader>

      <div className="stack">
        <div className="stats">
          <Stat label="Responses" value={formatNumber(data.total)} />
          <Stat label="Completed" value={formatNumber(data.completed)} />
          <Stat label="Shown (all time)" value={formatNumber(data.allTime.views)} />
          <Stat label="Response rate (all time)" value={data.allTime.views ? formatPercent(data.allTime.responses / data.allTime.views) : '—'} />
        </div>

        {!data.total ? (
          <div className="card">
            <Empty icon="survey" title="No responses in this period">
              <p>
                {survey.active
                  ? 'Responses appear here as visitors answer.'
                  : 'This survey is off. Switch it on in the editor, or preview it on the Test page.'}
              </p>
              <Link className="btn" to={`/sites/${site.id}/test?survey=${survey.id}`}>
                Preview on the Test page
              </Link>
            </Empty>
          </div>
        ) : (
          data.questions.map((q, i) => (
            <div className="card" key={q.id}>
              <div className="card-header">
                <h2>
                  {i + 1}. {q.text}
                </h2>
                <span className="small muted">{formatNumber(q.answered)} answered</span>
              </div>
              <div className="card-body">
                {q.type === 'nps' ? (
                  <NpsSummary q={q} />
                ) : q.options ? (
                  <BarList
                    items={q.options.map((o) => ({ name: o.option, count: o.count }))}
                    total={Math.max(1, q.answered)}
                    format={(n) => `${formatNumber(n)} · ${formatPercent(n / Math.max(1, q.answered))}`}
                  />
                ) : (
                  <div className="text-answers">
                    {data.responses
                      .filter((r) => typeof r.answers[q.id] === 'string')
                      .slice(0, 50)
                      .map((r) => (
                        <div key={r.id} className="text-answer">
                          <p>{String(r.answers[q.id])}</p>
                          <span className="small muted">
                            {formatDateTime(r.createdAt)} · {r.path}
                            {r.sessionId && r.hasRecording && (
                              <>
                                {' · '}
                                <Link to={`/sites/${site.id}/recordings/${r.sessionId}${search}`}>Watch recording</Link>
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    {!q.answered && <p className="muted small">No written answers yet.</p>}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {!!data.responses.length && (
          <div className="card table-scroll">
            <div className="card-header">
              <h2>All responses</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  {questions.map((q, i) => (
                    <th key={q.id} title={q.text}>
                      Q{i + 1}
                    </th>
                  ))}
                  <th>Page</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.responses.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(r.createdAt)}
                      {!r.completed && <span className="badge" style={{ marginLeft: 6 }}>partial</span>}
                    </td>
                    {questions.map((q) => (
                      <td key={q.id} className="truncate" style={{ maxWidth: 260 }} title={answerText(r.answers[q.id])}>
                        {answerText(r.answers[q.id])}
                      </td>
                    ))}
                    <td>
                      <span className="row small">
                        <DeviceIcon device={r.device} /> {r.path}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {r.sessionId && r.hasRecording && (
                          <Link className="btn btn-sm" to={`/sites/${site.id}/recordings/${r.sessionId}${search}`}>
                            <Icon name="recordings" /> Recording
                          </Link>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Delete response" onClick={() => removeResponse(r.id)}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

