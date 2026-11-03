import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { deckQaApi } from '../../../lib/api/deckQa.js';
import { reportError } from '../../../lib/log';
import {
  ADD_QUESTION, ASK_FOR_ANSWERS, ASK_NONE, ASK_NOTE, CARD_CHOICES, NO_DECK_QUESTIONS, QUESTIONS_UNREAD, READER_NOTE,
  STATE_PILL, WRITE_YOUR_ANSWER, WRITTEN_UNREAD, answerShown, askPlacements, cardPill, questionState, questionsLine, saveBody,
} from './scriptTileModel';

/**
 * D4270 (#4270, ps4b) — Likely questions under Script & rehearsal: the deck's
 * questions (D1559's ranking, the investors' own objections first, then the
 * deck check's), each with the founder's answer or "Write your answer.", and
 * Answered or Not answered yet. Never shown to investors.
 *
 * Ask places each bound draft (the answer the records carry, D1559) into the
 * questions with no answer; a placed draft reads "Not saved" until Save, and
 * Discard drops it. Nothing is written until Save. The founder adds a question
 * by hand. A reader (an HQ admin) reads and writes nothing.
 */

const BTN = 'inline-flex min-h-[32px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[12px] font-bold disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const QUIET = `${BTN} text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILLS = {
  placed: `${PILL} border-violet-200 bg-violet-50 text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`,
  answered: `${PILL} border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`,
  open: `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`,
  card: `${PILL} border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200`,
};
const BOX = 'w-full rounded-[9px] border px-3 py-2 text-[13px] leading-[1.55]';
const BOX_PLACED = `${BOX} border-violet-200 bg-violet-50 text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100`;
const BOX_PLAIN = `${BOX} border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;

const refusalOf = (e) => e?.detail || e?.message || 'That could not be saved. Try again.';

export default function QuestionsTab({ deckId, deckTitle, version, readOnly }) {
  const [read, setRead] = useState({ status: deckId == null ? 'none' : 'loading', data: null });
  const [placed, setPlaced] = useState({});
  const [editing, setEditing] = useState({});
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(null);

  const load = useCallback(() => {
    if (deckId == null) { setRead({ status: 'none', data: null }); return () => {}; }
    let live = true;
    setRead((s) => (s.status === 'ok' ? { ...s, reading: true } : { status: 'loading', data: null }));
    deckQaApi.questions(deckId)
      .then((data) => { if (live) setRead({ status: 'ok', data }); })
      .catch((e) => { if (live) setRead({ status: 'error', data: null }); reportError('pitch-script:questions', e); });
    return () => { live = false; };
  }, [deckId]);
  useEffect(() => load(), [load]);

  const questions = read.data?.questions || [];

  const save = async (q) => {
    const entry = placed[q.key] ?? editing[q.key];
    const body = saveBody(entry);
    if (!body.answer) { setNotice({ key: q.key, text: 'Write an answer before saving.' }); return; }
    setBusy(q.key); setNotice(null);
    try {
      const res = await deckQaApi.saveAnswer(deckId, q.key, body);
      setRead((s) => ({ ...s, data: { ...s.data, ...recount(s.data, q.key, res.written) } }));
      setPlaced(({ [q.key]: _, ...rest }) => rest);
      setEditing(({ [q.key]: _, ...rest }) => rest);
    } catch (e) { setNotice({ key: q.key, text: refusalOf(e) }); }
    finally { setBusy(null); }
  };

  const remove = async (q) => {
    setBusy(q.key); setNotice(null);
    try { await deckQaApi.removeAnswer(deckId, q.key); load(); }
    catch (e) { setNotice({ key: q.key, text: refusalOf(e) }); }
    finally { setBusy(null); }
  };

  const ask = () => {
    const next = askPlacements(questions, placed);
    if (Object.keys(next).length === Object.keys(placed).length) setNotice({ key: null, text: ASK_NONE });
    else { setNotice(null); setPlaced(next); }
  };

  const add = async () => {
    if (!adding?.question?.trim()) { setNotice({ key: 'add', text: 'Write the question.' }); return; }
    setBusy('add'); setNotice(null);
    try {
      await deckQaApi.addQuestion(deckId, { question: adding.question.trim(), card: adding.card || null });
      setAdding(null); load();
    } catch (e) { setNotice({ key: 'add', text: refusalOf(e) }); }
    finally { setBusy(null); }
  };

  if (read.status === 'none') return <div className={`${CARD} p-6 ${MUTED}`} data-testid="pitch-questions-no-deck">{NO_DECK_QUESTIONS}</div>;
  if (read.status === 'loading') return <div className="h-40 w-full animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" data-testid="pitch-questions-loading" />;
  if (read.status === 'error') {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} data-testid="pitch-questions-error">
        <span className={`text-[13.5px] font-bold ${INK}`}>{QUESTIONS_UNREAD}</span>
        <button type="button" className={GHOST} onClick={load}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </div>
    );
  }

  return (
    <section className={`${CARD} flex flex-col gap-1 p-5`} aria-labelledby="pitch-questions-title" data-testid="pitch-questions">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="pitch-questions-title" className={`m-0 text-[16px] font-extrabold ${INK}`}>
            Likely questions about {deckTitle || 'your deck'}{version != null ? ` v${version}` : ''}
          </h2>
          <span className={MUTED} data-testid="pitch-questions-line">{questionsLine(read.data)}</span>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={GHOST} onClick={() => setAdding({ question: '', card: '' })} data-testid="pitch-questions-add">{ADD_QUESTION}</button>
            <button type="button" className={PRIMARY} onClick={ask} data-testid="pitch-questions-ask">{ASK_FOR_ANSWERS}</button>
          </div>
        )}
      </div>
      {readOnly ? <p className={`m-0 ${MUTED}`} data-testid="pitch-questions-reader">{READER_NOTE}</p> : <p className={`m-0 ${MUTED}`} data-testid="pitch-questions-ask-note">{ASK_NOTE}</p>}
      {read.data?.reads?.written === 'unreadable' ? <p className={`m-0 ${MUTED}`} role="status" data-testid="pitch-questions-written-unread">{WRITTEN_UNREAD}</p> : null}
      {notice && notice.key == null ? <p className={`m-0 ${MUTED}`} role="status" data-testid="pitch-questions-notice">{notice.text}</p> : null}

      {adding ? (
        <div className="flex flex-col gap-2 border-t border-axal-hairline py-3.5 dark:border-gray-700" data-testid="pitch-questions-add-form">
          <label className={`text-[12px] font-bold ${INK}`} htmlFor="pitch-questions-add-text">Question</label>
          <input id="pitch-questions-add-text" className={BOX_PLAIN} maxLength={400} value={adding.question}
            onChange={(e) => setAdding((a) => ({ ...a, question: e.target.value }))} />
          <label className={`text-[12px] font-bold ${INK}`} htmlFor="pitch-questions-add-card">Card it relates to</label>
          <select id="pitch-questions-add-card" className={BOX_PLAIN} value={adding.card} onChange={(e) => setAdding((a) => ({ ...a, card: e.target.value }))}>
            <option value="">No card</option>
            {CARD_CHOICES.map((c) => <option key={c} value={c}>{cardPill(c).replace('Card · ', '')}</option>)}
          </select>
          {notice?.key === 'add' ? <p className="m-0 text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert">{notice.text}</p> : null}
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} disabled={busy === 'add'} onClick={add} data-testid="pitch-questions-add-save">Add</button>
            <button type="button" className={QUIET} onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <ol className="m-0 flex list-none flex-col p-0" data-testid="pitch-questions-list">
        {questions.map((q) => {
          const state = questionState(q, placed);
          const shown = answerShown(q, placed);
          const draft = editing[q.key];
          const card = cardPill(q.cards?.[0]);
          return (
            <li key={q.key} className="flex flex-col gap-2 border-t border-axal-hairline py-3.5 dark:border-gray-700" data-testid={`pitch-question-${q.key}`} data-state={state}>
              <div className="flex flex-wrap items-start gap-2">
                <span className={`min-w-0 flex-1 text-[14px] font-bold leading-[1.4] ${INK}`}>{q.question}</span>
                {card ? <span className={PILLS.card}>{card}</span> : null}
                <span className={PILLS[state]} data-testid={`pitch-question-state-${q.key}`}>{STATE_PILL[state]}</span>
              </div>
              {draft !== undefined ? (
                <textarea className={BOX_PLAIN} rows={3} maxLength={2000} aria-label={`Your answer to: ${q.question}`} value={draft.text}
                  onChange={(e) => setEditing((m) => ({ ...m, [q.key]: { ...m[q.key], text: e.target.value } }))} data-testid={`pitch-question-input-${q.key}`} />
              ) : shown ? (
                <div role="textbox" aria-readonly="true" aria-multiline="true" className={state === 'placed' ? BOX_PLACED : BOX_PLAIN} data-testid={`pitch-question-answer-${q.key}`}>{shown}</div>
              ) : (
                <span className={`${MUTED} italic`} data-testid={`pitch-question-empty-${q.key}`}>{WRITE_YOUR_ANSWER}</span>
              )}
              {notice?.key === q.key ? <p className="m-0 text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert">{notice.text}</p> : null}
              {readOnly ? null : (
                <div className="flex flex-wrap gap-2">
                  {state === 'placed' || draft !== undefined ? (
                    <>
                      <button type="button" className={PRIMARY} disabled={busy === q.key} onClick={() => save(q)} data-testid={`pitch-question-save-${q.key}`}>Save</button>
                      {draft === undefined ? (
                        <button type="button" className={GHOST} onClick={() => { setEditing((m) => ({ ...m, [q.key]: { ...placed[q.key] } })); setPlaced(({ [q.key]: _, ...rest }) => rest); }} data-testid={`pitch-question-edit-${q.key}`}>Edit</button>
                      ) : null}
                      <button type="button" className={QUIET} onClick={() => { setPlaced(({ [q.key]: _, ...rest }) => rest); setEditing(({ [q.key]: _, ...rest }) => rest); }} data-testid={`pitch-question-discard-${q.key}`}>Discard</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={GHOST} onClick={() => setEditing((m) => ({ ...m, [q.key]: { text: q.written?.text ?? '', from_ask: false } }))} data-testid={`pitch-question-write-${q.key}`}>
                        {q.written ? 'Edit' : 'Write'}
                      </button>
                      {q.written || q.kind === 'typed' ? (
                        <button type="button" className={QUIET} disabled={busy === q.key} onClick={() => remove(q)} data-testid={`pitch-question-remove-${q.key}`}>
                          {q.kind === 'typed' ? 'Remove question' : 'Clear answer'}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The read after one save: that question's written answer, answered, and the count again. */
export function recount(data, key, written) {
  const questions = (data?.questions || []).map((q) => (q.key === key ? { ...q, written, answered: !!written || !!q.kept } : q));
  const known = Number.isFinite(data?.answered_count);
  return { questions, answered_count: known ? questions.filter((q) => q.answered).length : data?.answered_count ?? null };
}
