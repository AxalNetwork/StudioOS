// D1225 (#3224) — CLS10's three dialogs on the founder's call, each in the
// page (`Lightbox`), never a browser pop-up. Each says what it changes, and a
// refusal stays in the dialog with Reload where the call changed (CLS12).
//   · Extend: a new closing date. The Worker pauses responses until counsel
//     approves the new terms (`awaiting_counsel`).
//   · Close: the call takes no more responses; nothing indicated is lost.
//   · Answer: one investor question; investors who asked see the answer.
import React, { useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import {
  ANSWER_TOLD, CLOSE_LINE, CLOSE_TOLD, EXTEND_NOTE, EXTEND_TOLD, extensionValid, longDay, refusalOf, shortDay,
} from './raiseCallModel';

const BTN = 'inline-flex min-h-[36px] items-center rounded-lg border border-axal-hairline bg-white px-3.5 text-sm font-semibold text-axal-ink disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-lg bg-axal-violet px-3.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-violet-600';
const DANGER = 'inline-flex min-h-[36px] items-center rounded-lg bg-red-700 px-3.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-red-600';
const NOTE = 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const MUTED = 'text-xs text-axal-muted dark:text-gray-400';
const INPUT = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-sm text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** A refusal in place, with Reload when the call changed under it. */
function Refused({ refusal, onReload, testId }) {
  if (!refusal) return null;
  return (
    <div role="alert" className="flex flex-col gap-2" data-testid={testId}>
      <p className="m-0 text-sm font-semibold text-red-700 dark:text-red-300">{refusal.text}</p>
      {refusal.reload ? <button type="button" className={`${BTN} self-start`} onClick={onReload} data-testid={`${testId}-reload`}>Reload</button> : null}
      <p className={`m-0 ${MUTED}`}>Nothing you entered was saved.</p>
    </div>
  );
}

/** Runs a write: busy while it runs, the refusal in place if it is refused. */
function useWrite(onDone) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  async function run(write) {
    setBusy(true); setRefusal(null);
    try { await write(); onDone(); } catch (e) { setRefusal(refusalOf(e)); } finally { setBusy(false); }
  }
  return { busy, refusal, run };
}

export function ExtendDialog({ call, onClose, onDone, onReload, extend }) {
  const [date, setDate] = useState('');
  const w = useWrite(onDone);
  const ok = extensionValid(call, date);
  const title = `Extend ${call.name}`;
  return (
    <Lightbox label={title} title={title} sub={`It closes on ${longDay(call.target_close) || 'Not recorded'} today.`} onClose={onClose} width={440} testId="call-extend-dialog">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">New closing date
          <input type="date" min={call.target_close} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} data-testid="call-extend-date" />
        </label>
        {date && !ok ? <p className={`m-0 ${MUTED}`} data-testid="call-extend-invalid">Choose a date after the current closing date.</p> : null}
        <p className={`m-0 ${NOTE}`}>{EXTEND_NOTE}</p>
        <p className={`m-0 ${MUTED}`}>{EXTEND_TOLD}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} data-testid="call-extend-back">Back</button>
          <button type="button" className={PRIMARY} disabled={!ok || w.busy} onClick={() => w.run(() => extend(date))} data-testid="call-extend-confirm">Extend and ask counsel</button>
        </div>
        <Refused refusal={w.refusal} onReload={onReload} testId="call-extend-refusal" />
      </div>
    </Lightbox>
  );
}

export function CloseDialog({ call, onClose, onDone, onReload, close }) {
  const w = useWrite(onDone);
  const title = `Close ${call.name}?`;
  return (
    <Lightbox label={title} title={title} onClose={onClose} width={440} testId="call-close-dialog">
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-axal-ink dark:text-gray-100">{CLOSE_LINE}</p>
        <p className={`m-0 ${MUTED}`}>{CLOSE_TOLD}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} data-testid="call-close-keep">Keep it open</button>
          <button type="button" className={DANGER} disabled={w.busy} onClick={() => w.run(close)} data-testid="call-close-confirm">Close the call</button>
        </div>
        <Refused refusal={w.refusal} onReload={onReload} testId="call-close-refusal" />
      </div>
    </Lightbox>
  );
}

export function AnswerDialog({ question, onClose, onDone, onReload, answer }) {
  const [text, setText] = useState('');
  const w = useWrite(onDone);
  return (
    <Lightbox label="Answer a question" title="Answer a question" onClose={onClose} width={480} testId="call-answer-dialog">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800">
          <span className={MUTED}>{[question.name, shortDay(question.asked_at)].filter(Boolean).join(' · ')}</span>
          <span className="text-sm font-semibold text-axal-ink dark:text-gray-100">“{question.question}”</span>
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">Your answer
          <textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} className={INPUT} data-testid="call-answer-text" />
        </label>
        <p className={`m-0 ${MUTED}`}>{ANSWER_TOLD}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} data-testid="call-answer-cancel">Cancel</button>
          <button type="button" className={PRIMARY} disabled={!text.trim() || w.busy} onClick={() => w.run(() => answer(text.trim()))} data-testid="call-answer-send">Send answer</button>
        </div>
        <Refused refusal={w.refusal} onReload={onReload} testId="call-answer-refusal" />
      </div>
    </Lightbox>
  );
}
