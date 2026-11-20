import React, { useEffect, useState } from 'react';
import { interviewGuideApi } from '../../lib/api/interviewGuide.js';
import { COPY_NOTE, UNAVAILABLE_LINE, askedLine, sentenceOf } from '../cycles/interviewGuideModel.js';

/**
 * D6008 (#6008) — the interview guide while recording (D5995 V27 A, V29 H):
 * the copy taken onto this interview, one question per card, Mark asked and
 * Skip, a pager. Opening it takes the copy once (`POST /copy/:interview`); a
 * second open answers the first copy. Marking a question asked changes the
 * copy only. A guide that cannot be read says so; the recording goes on.
 * Targets are 44px or more (52px for Mark asked).
 */
export default function RecordingGuide({ projectId, interviewId, onClose, api = interviewGuideApi }) {
  const [copy, setCopy] = useState(undefined); // undefined loading · null unavailable
  const [at, setAt] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    if (!projectId || !interviewId) { setCopy(null); return undefined; }
    api.takeCopy(projectId, interviewId).then((r) => { if (live) setCopy(r.copy); }).catch(() => { if (live) setCopy(null); });
    return () => { live = false; };
  }, [api, projectId, interviewId]);

  const qs = copy?.questions || [];
  const q = qs[Math.min(at, Math.max(qs.length - 1, 0))];
  const asked = new Set(copy?.asked || []);

  async function mark(on) {
    if (!q) return;
    setError(null);
    try { const r = await api.markAsked(projectId, interviewId, q.id, on); setCopy(r.copy); if (on && at < qs.length - 1) setAt(at + 1); }
    catch (e) { setError(sentenceOf(e, 'Couldn’t mark it. Try again.')); }
  }

  return (
    <section role="dialog" aria-modal="false" aria-label="Interview guide" data-testid="recording-guide"
      className="absolute inset-x-0 bottom-0 z-10 max-h-[70vh] overflow-y-auto rounded-t-[20px] border-t border-gray-200 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-gray-900 shadow-2xl dark:border-[#2a2140] dark:bg-[#130b22] dark:text-gray-100">
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-[#3a2f52]" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-bold">Interview guide</h2>
        <button type="button" onClick={onClose} className="min-h-11 rounded-md px-3 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#1c1230]" data-testid="guide-close">Close</button>
      </div>
      {copy === undefined && <p role="status" className="mt-2 text-[13px] text-gray-500">Loading the guide</p>}
      {copy === null && <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400" data-testid="recording-guide-unavailable"><b>Unavailable.</b> {UNAVAILABLE_LINE}</p>}
      {copy && !qs.length && <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400" data-testid="recording-guide-empty">No question on this interview’s guide. Prepare questions from Customer research.</p>}
      {copy && q && (
        <div className="mt-2 space-y-3">
          <div className="flex gap-1" aria-label={`Question ${at + 1} of ${qs.length}`}>
            {qs.map((x, i) => <i key={x.id} className={`h-1.5 flex-1 rounded-full ${i === at ? 'bg-violet-600' : asked.has(x.id) ? 'bg-violet-300' : 'bg-gray-200 dark:bg-[#2a2140]'}`} />)}
          </div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[.08em] text-gray-500" aria-live="polite" data-testid="recording-guide-count">Question {at + 1} of {qs.length} · {askedLine(copy)}</p>
          <p className="m-0 text-[18px] font-semibold leading-snug" data-testid="recording-guide-question">{q.text}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {asked.has(q.id)
              ? <button type="button" className="min-h-[52px] flex-1 rounded-md border border-violet-300 px-3 text-[14px] font-bold text-violet-700 dark:text-violet-300" onClick={() => mark(false)} data-testid="recording-guide-unmark">✓ Asked · undo</button>
              : <button type="button" className="min-h-[52px] flex-1 rounded-md bg-violet-700 px-3 text-[14px] font-bold text-white hover:bg-violet-800" onClick={() => mark(true)} data-testid="recording-guide-mark">Mark asked</button>}
            <button type="button" className="min-h-11 flex-1 rounded-md border border-gray-200 px-3 text-[13px] font-semibold dark:border-[#2a2140]" disabled={at >= qs.length - 1} onClick={() => setAt(at + 1)} data-testid="recording-guide-skip">Skip</button>
            <button type="button" className="min-h-11 rounded-md border border-gray-200 px-3 text-[13px] font-semibold dark:border-[#2a2140]" disabled={at === 0} onClick={() => setAt(at - 1)} aria-label="Previous question">‹</button>
          </div>
          {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
          <p className="m-0 text-[11.5px] text-gray-500 dark:text-gray-400">{COPY_NOTE}</p>
        </div>
      )}
    </section>
  );
}
