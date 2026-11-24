import { useRef, useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles.js';
import FeedbackSheet from '../cycles/FeedbackSheet.jsx';
import { consentWord, interviewValues, selectedWithin } from '../cycles/feedbackTabModel.js';

/**
 * D6865 part 2 (#6891, the #6099 canvas GR-25) — Save as feedback from a
 * Validate interview: the passage selected in the interview (else an empty box
 * to fill), or one session mark's label, saved to Grow › Feedback with origin
 * Interview through `POST /api/cycles/grow/feedback`. Quote consent is shown
 * beside it as the interview records it (Yes, No or Not recorded). The
 * interviewee is linked only when exactly one of the venture's records has
 * that name; otherwise the sheet reads Not linked, offers Link, and still saves
 * with the typed name. Drawn in the interview's writer-only tools.
 */
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-11 items-center rounded-[7px] border border-violet-200 bg-white px-[9px] text-[11.5px] font-bold text-violet-800 hover:border-violet-300 sm:min-h-8 dark:border-violet-800 dark:bg-gray-900 dark:text-violet-200';
const at = (ms) => `${Math.floor(Number(ms) / 60000)}:${String(Math.floor((Number(ms) % 60000) / 1000)).padStart(2, '0')}`;

export default function InterviewSaveFeedback({ projectId, interview, marks = [], api = cyclesWrite }) {
  const box = useRef(null);
  const [open, setOpen] = useState(null);
  const [options, setOptions] = useState(null);
  const consent = consentWord(interview?.quote_consent);
  const list = (Array.isArray(marks) ? marks : []).filter((m) => m && Number.isFinite(Number(m.offset_ms)));
  const start = (passage, key) => {
    setOptions(null);
    setOpen({ key, passage });
    api.formOptions('grow', projectId, 'product-improvement')
      .then((o) => { setOptions(o || {}); setOpen((cur) => (cur && cur.key === key ? { ...cur, initial: interviewValues({ interview, passage, contacts: o?.contacts }) } : cur)); })
      .catch(() => setOptions('unreadable'));
  };
  const opened = useRef(0);
  const fromSelection = () => { opened.current += 1; start(selectedWithin(box.current?.closest?.('[data-testid="interview-record"]') || null), `passage-${opened.current}`); };
  const initial = open?.initial || interviewValues({ interview, passage: open?.passage });
  return (
    <div ref={box} className="flex flex-col gap-2 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="interview-save-feedback">
      <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
        <b>Save as feedback</b>
        <span className={`rounded-full border px-2 py-0.5 text-[11.5px] ${consent === 'Yes' ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}
          data-testid="interview-quote-consent">Quote consent: {consent}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onMouseDown={(e) => e.preventDefault()} onClick={fromSelection} data-testid="interview-save-passage">Save as feedback</button>
        <span className={`text-[12px] ${MUTED}`}>From the passage you select in the transcript or notes, else an empty box</span>
      </div>
      {list.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Session marks">
          {list.map((m, i) => (
            <li key={m.id ?? i} className="flex min-h-11 flex-wrap items-center gap-2 text-[12.5px] sm:min-h-8">
              <span className={`font-mono ${MUTED}`}>{at(m.offset_ms)}</span>
              {m.label ? <b className="text-axal-ink dark:text-gray-100">{m.label}</b> : <span className={MUTED}>No label</span>}
              <button type="button" className={BTN} onClick={() => start(m.label || '', `mark-${m.id ?? i}`)}>Save as feedback</button>
            </li>
          ))}
        </ul>
      ) : null}
      {list.some((m) => !m.label) ? <p className={`m-0 text-[12px] ${MUTED}`}>A mark without a label saves with an empty text box for you to fill.</p> : null}
      {open ? (
        <FeedbackSheet key={`${open.key}-${open.initial ? 'matched' : 'typed'}`} title="Save as feedback"
          from={`From the interview · ${interview?.interviewee_name || 'Interviewee not recorded'}`} initial={initial} origin="interview" options={options}
          consent={<p className="m-0 flex flex-wrap items-center gap-2 text-[12px]" data-testid="interview-sheet-consent">
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>Quote consent</span>
            <b className="text-axal-ink dark:text-gray-100">{consent}</b><span className={MUTED}>recorded on the interview</span></p>}
          itemHref={(uid) => `/grow/product-improvement/${encodeURIComponent(uid)}?project_id=${encodeURIComponent(projectId)}`}
          onSave={(body) => api.grow.feedback(projectId, body)} onClose={() => setOpen(null)} testId="interview-feedback-sheet" />
      ) : null}
    </div>
  );
}
