import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Device, FeedbackItem } from '../api';
import { RATING_EMOJI } from '../format';
import { Icon } from './Icon';
import { highlightElement, SnapshotStage, useSnapshotFrame } from './Snapshot';

/** Shows the page a piece of feedback was left on, with the element the visitor pointed at outlined. */
export function ElementModal({ siteId, item, recordingLink, onClose }: { siteId: string; item: FeedbackItem; recordingLink: string | null; onClose: () => void }) {
  const device = (['desktop', 'tablet', 'mobile'].includes(item.device) ? item.device : 'desktop') as Device;
  const frame = useSnapshotFrame(siteId, item.path, device);
  const [placed, setPlaced] = useState<'element' | 'position' | null>(null);
  const { status, doc, layoutTick } = frame;
  const element = item.element;

  useEffect(() => {
    const d = doc();
    if (status !== 'ready' || !d || !element) return;
    setPlaced(highlightElement(d, element.s, { x: element.x, y: element.y, w: element.w, h: element.h }));
  }, [status, layoutTick, doc, element]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Feedback on the page" onClick={(e) => e.stopPropagation()}>
        <div className="card-header">
          <div className="row" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 22 }}>{RATING_EMOJI[item.rating]}</span>
            <div style={{ minWidth: 0 }}>
              <div className="truncate">{item.comment ?? <span className="muted">No comment</span>}</div>
              <div className="small muted truncate">
                {item.path}
                {status === 'ready' && placed === 'position' && ' · The page has changed since; the outline shows where the element was.'}
                {status === 'ready' && placed === null && " · The element isn't on the current snapshot of this page."}
              </div>
            </div>
          </div>
          <div className="row">
            {recordingLink && (
              <Link className="btn btn-sm" to={recordingLink}>
                <Icon name="recordings" /> Watch this moment
              </Link>
            )}
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="modal-body">
          <SnapshotStage frame={frame} path={item.path} device={device} />
        </div>
      </div>
    </div>
  );
}
