import React, { useEffect, useState } from 'react';
import { deckQaApi } from '../../../lib/api/deckQa.js';
import { SURFACES, through } from './deckV2Adapter.js';
import {
  ALL_BOUND, EVERY_INVESTOR, NOT_SAVED, NO_QUESTIONS, OBJECTIONS_UNREAD, PRACTISE, QUESTIONS_LATER, QUESTIONS_TITLE,
  answerLine, drillLine, figureCheckLine, prospectLabel, questionMeta,
} from './rehearseModel.js';

/**
 * D1582 F3 (#3829) — pd39's "LIKELY QUESTIONS · REAL OBJECTIONS FIRST", inside
 * the Rehearsal report (`RehearsePanel.jsx`), with "Practise answers".
 *
 * The questions are D1559's (`GET /api/decks/:id/qa`): the investors' own
 * objections first, then the deck check's. Pick a prospect and THAT
 * investor's objections rank first (`?prospect=`). The read goes through the
 * adapter's `rehearse` row (`through`, its issue), so a Worker without the
 * route draws "Likely questions are coming later." and nothing else.
 *
 * THE DRILL IS NOT A CHAT. One question at a time: the founder types an
 * answer, then checks it against what the records say (the bound answer, the
 * kept answer, their own recorded words), and each figure they typed that no
 * binding carries is named. Then the next question. There is no thread, no
 * reply and no model: nothing is written or sent, and every figure shown is a
 * binding's.
 */
const BOX = 'flex flex-col gap-2 rounded-[10px] bg-[#111827] p-3.5';
const LABEL = 'font-mono text-[11px] font-bold tracking-[.07em] text-gray-400';
const BUTTON = 'inline-flex min-h-[32px] items-center justify-center rounded-[8px] px-3 text-[12.5px] font-bold';
const PRIMARY = `${BUTTON} bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50`;
const QUIET = `${BUTTON} border border-gray-700 text-gray-200 hover:bg-gray-800 disabled:opacity-50`;

export default function LikelyQuestions({ deckId }) {
  const [prospect, setProspect] = useState('');
  const [read, setRead] = useState(null);
  const [at, setAt] = useState(null);
  const [typed, setTyped] = useState({});
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!deckId) return undefined;
    let live = true;
    setRead(null);
    setAt(null);
    through(() => deckQaApi.questions(deckId, prospect ? { prospect } : undefined), SURFACES.rehearse.issue)
      .then((r) => { if (live) setRead(r); });
    return () => { live = false; };
  }, [deckId, prospect]);

  const value = read?.available ? read.value : null;
  const questions = value?.questions || [];
  const chosen = value?.prospect || null;
  const go = (i) => { setAt(i); setChecked(false); };

  let body;
  if (read == null) body = <span className="text-[12.5px] text-gray-400">Reading…</span>;
  else if (!read.available && !read.unreadable) body = <span className="text-[13px] text-gray-400" data-testid="rehearse-questions-later">{QUESTIONS_LATER}</span>;
  else if (!read.available) body = <span className="text-[13px] text-amber-300" data-testid="rehearse-questions-unread">{read.reason || 'Could not be read'}</span>;
  else if (at != null && questions[at]) {
    const q = questions[at];
    const text = typed[q.key] || '';
    const check = checked ? figureCheckLine(text, q) : null;
    body = (
      <div className="flex flex-col gap-2" data-testid="rehearse-drill">
        <span className="font-mono text-[11px] text-gray-400" data-testid="rehearse-drill-step">{drillLine(at, questions.length)}</span>
        <span className="text-[15px] font-bold text-gray-100" data-testid="rehearse-drill-question">{q.question}</span>
        <span className="text-[12px] text-gray-400">{questionMeta(q, chosen)}</span>
        <label className="flex flex-col gap-1 text-[12px] font-bold text-gray-300">
          Your answer
          <textarea rows={3} value={text} data-testid="rehearse-drill-answer"
            onChange={(e) => { const v = e.target.value; setTyped((t) => ({ ...t, [q.key]: v })); setChecked(false); }}
            className="rounded-[8px] border border-gray-700 bg-gray-900 p-2 text-[13.5px] font-normal text-gray-100" />
        </label>
        <span className="text-[11.5px] text-gray-500">{NOT_SAVED}</span>
        {checked ? (
          <div className="flex flex-col gap-1.5 rounded-[8px] border border-gray-700 p-2.5" data-testid="rehearse-drill-check">
            <span className={LABEL}>WHAT THE RECORDS SAY</span>
            <span className="text-[13px] text-gray-100" data-testid="rehearse-drill-bound">{answerLine(q)}</span>
            {q.kept?.text ? <span className="text-[12.5px] text-gray-300">Your kept answer: {q.kept.text}</span> : null}
            {q.said ? <span className="text-[12.5px] text-gray-300">Your answer in Capital relationships: {q.said}</span> : null}
            {check ? (
              <span className={`text-[12.5px] ${check === ALL_BOUND ? 'text-emerald-300' : 'text-amber-300'}`} data-testid="rehearse-drill-figures">{check}</span>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={QUIET} onClick={() => go(at - 1)} disabled={at === 0} data-testid="rehearse-drill-back">← Previous</button>
          <button type="button" className={PRIMARY} onClick={() => setChecked(true)} disabled={checked} data-testid="rehearse-drill-reveal">Check against the records</button>
          <button type="button" className={QUIET} onClick={() => go(at + 1)} disabled={at === questions.length - 1} data-testid="rehearse-drill-next">Next question →</button>
          <button type="button" className={QUIET} onClick={() => setAt(null)} data-testid="rehearse-drill-end">End practice</button>
        </div>
      </div>
    );
  } else {
    const prospects = value.prospects || [];
    body = (
      <>
        {prospects.length ? (
          <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-gray-300">
            For
            <select value={prospect} onChange={(e) => setProspect(e.target.value)} data-testid="rehearse-questions-prospect"
              className="min-h-[32px] rounded-[8px] border border-gray-700 bg-gray-900 px-2 text-[12.5px] text-gray-100">
              <option value="">{EVERY_INVESTOR}</option>
              {prospects.map((p) => <option key={p.id} value={String(p.id)}>{prospectLabel(p)}</option>)}
            </select>
          </label>
        ) : null}
        {value.reads?.objections === 'unreadable' ? <span className="text-[12.5px] text-amber-300">{OBJECTIONS_UNREAD}</span> : null}
        {!questions.length ? <span className="text-[13px] text-gray-400">{NO_QUESTIONS}</span> : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="rehearse-questions-list">
            {questions.map((q, i) => (
              <li key={q.key} className="flex flex-wrap items-start justify-between gap-2 border-t border-gray-800 pt-2 first:border-t-0 first:pt-0">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13.5px] text-gray-100">{q.rank}. {q.question}</span>
                  <span className="text-[11.5px] text-gray-400">{questionMeta(q, chosen)}</span>
                </span>
                <button type="button" className={QUIET} onClick={() => go(i)} data-testid={`rehearse-practise-${i}`}>{PRACTISE}</button>
              </li>
            ))}
          </ol>
        )}
      </>
    );
  }

  return (
    <div className={BOX} data-testid="rehearse-questions">
      <span className={LABEL}>{QUESTIONS_TITLE}</span>
      {body}
    </div>
  );
}
