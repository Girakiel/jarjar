import { lazy, Suspense, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useApi, type FeedbackItem, type FeedbackList } from '../api';
import { DeviceIcon, Icon } from '../components/Icon';
import { useSite } from '../components/Layout';
import { BarList, DaysPicker, Empty, ErrorBox, PageHeader, Segmented, Spinner, useDays } from '../components/ui';
import { formatDateTime, formatNumber, RATING_EMOJI, RATING_LABEL } from '../format';

// Pulls in rrweb's replayer, so it's loaded only when opened.
const ElementModal = lazy(() => import('../components/ElementModal').then((m) => ({ default: m.ElementModal })));

export function FeedbackPage() {
  const { site } = useSite();
  const [days] = useDays();
  const [params, setParams] = useSearchParams();
  const rating = params.get('rating') ?? '';
  const { data, error, reload } = useApi<FeedbackList>(`/sites/${site.id}/feedback?days=${days}${rating ? `&rating=${rating}` : ''}`);
  const search = `?days=${days}`;
  const [shown, setShown] = useState<FeedbackItem | null>(null);

  // Opens the recording a few seconds before the feedback was sent.
  const recordingLink = (item: FeedbackItem) =>
    item.sessionId && item.hasRecording ? `/sites/${site.id}/recordings/${item.sessionId}${search}${item.clientTs ? `&at=${item.clientTs}` : ''}` : null;

  const setRating = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('rating', value);
    else next.delete('rating');
    setParams(next, { replace: true });
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this response?')) return;
    await api(`/feedback/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <>
      <PageHeader title="Feedback" subtitle="What visitors told you through the feedback widget.">
        <DaysPicker />
      </PageHeader>
      {!site.feedback.enabled && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="feedback" />
          <div style={{ flex: 1 }}>
            The feedback widget is turned off for this site. <Link to={`/sites/${site.id}/settings`}>Turn it on in Settings</Link> to start collecting ratings.
          </div>
        </div>
      )}
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="stack">
          <div className="grid grid-2">
            <div className="card">
              <div className="card-body row" style={{ gap: 18 }}>
                <div className="rating-big">{data.stats.avg ? RATING_EMOJI[Math.round(data.stats.avg)] : '—'}</div>
                <div>
                  <div className="muted small">Average rating</div>
                  <div style={{ fontSize: 26, fontWeight: 600 }}>{data.stats.avg ? `${data.stats.avg.toFixed(2)} / 5` : 'No ratings'}</div>
                  <div className="muted small">
                    {formatNumber(data.stats.count)} {data.stats.count === 1 ? 'response' : 'responses'} · {formatNumber(data.stats.comments)} with comments
                  </div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-body">
                <BarList
                  items={[...data.distribution].reverse().map((d) => ({ name: String(d.rating), count: d.count, label: `${RATING_EMOJI[d.rating]} ${RATING_LABEL[d.rating]}` }))}
                  total={Math.max(1, data.stats.count)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Responses</h2>
              <Segmented
                label="Filter by rating"
                value={rating || 'all'}
                onChange={(v) => setRating(v === 'all' ? '' : v)}
                options={[{ value: 'all', label: 'All' }, ...[1, 2, 3, 4, 5].map((r) => ({ value: String(r), label: RATING_EMOJI[r] }))]}
              />
            </div>
            {!data.items.length ? (
              <Empty icon="feedback" title="No feedback yet">
                <p>Responses from the on-page widget will show up here.</p>
              </Empty>
            ) : (
              data.items.map((item) => (
                <div className="feedback-item" key={item.id}>
                  <div className="feedback-emoji" title={RATING_LABEL[item.rating]}>
                    {RATING_EMOJI[item.rating]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="feedback-comment">{item.comment ?? <span className="muted">No comment</span>}</p>
                    <div className="row small muted" style={{ flexWrap: 'wrap' }}>
                      <DeviceIcon device={item.device} />
                      <span className="truncate" title={item.url}>
                        {item.path}
                      </span>
                      <span>·</span>
                      <span>{formatDateTime(item.createdAt)}</span>
                      {recordingLink(item) && (
                        <>
                          <span>·</span>
                          <Link to={recordingLink(item)!}>Watch recording</Link>
                        </>
                      )}
                      {item.element && (
                        <>
                          <span>·</span>
                          <button type="button" className="link-button" onClick={() => setShown(item)}>
                            📍 Show on page
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Delete response" onClick={() => remove(item.id)}>
                    <Icon name="trash" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {shown && (
        <Suspense fallback={null}>
          <ElementModal siteId={site.id} item={shown} recordingLink={recordingLink(shown)} onClose={() => setShown(null)} />
        </Suspense>
      )}
    </>
  );
}
