import React, { useEffect, useState } from 'react';
import { Sheet, Unrecorded } from '../../ui';
import { reportError } from '../../lib/log';
import { readItemAnalytics } from './studioActions';
import { CURVE_NOTE, CURVE_TITLE, SHEET_SUB, analyticsView } from './videoAnalyticsModel';

/**
 * D4181 (#4181, lr17) — "[The video] · analytics", the studio's right Sheet:
 * views, completion rate and median watch time, then the drop-off over the
 * video with its chapter markers and the biggest drop. Under five viewers it
 * says "Not enough views to show" and nothing else. It reads only.
 */
export default function VideoAnalyticsSheet({ uid, fallbackTitle = '', onClose, read = readItemAnalytics }) {
  const [state, setState] = useState({ status: 'loading', view: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', view: null });
    Promise.resolve(read(uid)).then(
      (reply) => { if (live) setState({ status: 'ready', view: analyticsView(reply) }); },
      (e) => { reportError('learning-analytics:read', e); if (live) setState({ status: 'error', view: null, message: e?.message || null }); },
    );
    return () => { live = false; };
  }, [uid, tick, read]);
  const v = state.view;
  const title = `${v?.title || fallbackTitle || 'This video'} · analytics`;
  return (
    <Sheet label={title} title={title} sub={SHEET_SUB} width={480} onClose={onClose} testId="studio-analytics">
      <div className="flex flex-col gap-3">
        {state.status === 'loading' ? <p className="text-[12.5px] text-axal-muted dark:text-gray-400" role="status" data-testid="studio-analytics-loading">Reading the views…</p> : null}
        {state.status === 'error' ? (
          <div className="flex flex-col items-start gap-2" role="alert" data-testid="studio-analytics-error">
            <span className="text-[12.5px] text-axal-ink dark:text-gray-100">The analytics could not be read. This is not a claim that nobody watched.</span>
            <button type="button" className="rounded-[9px] border border-axal-hairline px-3 py-1.5 text-[12.5px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100" onClick={() => setTick((t) => t + 1)}>Try again</button>
          </div>
        ) : null}
        {v && !v.enough ? <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="studio-analytics-not-enough">{v.line}</p> : null}
        {v && v.enough ? (
          <>
            <div className="grid grid-cols-3 gap-2.5" data-testid="studio-analytics-tiles">
              {v.tiles.map((t) => (
                <div key={t.key} className="flex flex-col gap-1 rounded-[12px] border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900" data-testid={`studio-analytics-${t.key}`}>
                  <span className="text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">{t.label}</span>
                  {t.value != null
                    ? <span className="text-[18px] font-extrabold tabular-nums text-axal-ink dark:text-gray-100">{t.value}</span>
                    : <Unrecorded>{t.reason}</Unrecorded>}
                </div>
              ))}
            </div>
            <section className="flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900" aria-label={CURVE_TITLE} data-testid="studio-analytics-curve">
              <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{CURVE_TITLE}</span>
              <span className="text-[12px] text-axal-muted dark:text-gray-400">{CURVE_NOTE}</span>
              {v.curve ? (
                <>
                  <ol className="m-0 flex list-none flex-col gap-[3px] p-0" data-testid="studio-analytics-bars">
                    {v.curve.bars.map((b) => (
                      <li key={b.start_seconds} className="flex items-center gap-2" aria-label={b.label} title={b.label}>
                        <span className="w-20 shrink-0 text-[10.5px] tabular-nums text-axal-muted dark:text-gray-400" aria-hidden="true">{b.from}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
                          <span className="block h-full rounded-full bg-violet-500 dark:bg-violet-400" style={{ width: `${b.still_watching_pct}%` }} />
                        </span>
                        <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-axal-muted dark:text-gray-400" aria-hidden="true">{b.still_watching_pct}%</span>
                      </li>
                    ))}
                  </ol>
                  {v.curve.markers.length ? (
                    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11.5px] text-axal-muted dark:text-gray-400" aria-label="Chapters" data-testid="studio-analytics-chapters">
                      {v.curve.markers.map((m) => <li key={`${m.at}-${m.title}`}><span className="tabular-nums">{m.at}</span> {m.title}</li>)}
                    </ul>
                  ) : null}
                  <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" data-testid="studio-analytics-biggest">{v.curve.biggest}</span>
                  {v.curve.unrecorded ? <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="studio-analytics-unrecorded">{v.curve.unrecorded}</span> : null}
                </>
              ) : <span data-testid="studio-analytics-curve-reason"><Unrecorded>{v.curveReason}</Unrecorded></span>}
            </section>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
