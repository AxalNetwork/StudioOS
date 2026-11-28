/**
 * D6225 (#6225) — questions about a sent report, on both sides (canvas D6096,
 * GRQ22–GRQ26), over `/api/report-questions` (`reportQuestionsApi`).
 *
 *   InvestorQuestions (GRQ22a, GRQ22b): the reader's "Your questions": the
 *   investor's own thread with each question's pill and the founders' answer,
 *   Withdraw on an unanswered one (reviewed in the page first), and the
 *   composer, for the whole report or for the figure the reader's "Question
 *   about this figure" chose.
 *
 *   FounderQuestions (GRQ23, GRQ23b): the sent report's Questions section: one
 *   card per question with the investor, what it is about, the pill, the
 *   answer, and Reply (primary) opening a 1,200-character box. An admin or an
 *   advisor reads the cards with "Read only".
 *
 * Nothing posts before a press. A failed send keeps the text and says why in
 * the Worker's own sentence. Who may write is the Worker's `can_ask` and
 * `can_reply`, never the role.
 */
import { useEffect, useRef, useState } from 'react';
import { reportQuestionsApi } from '../../../lib/api/reportQuestions.js';
import { Unreadable } from '../../../ui';
import {
  QUESTION_MAX, REPLY_MAX, aboutLine, counter, countsLine, isOpenQuestion, questionDay, questionPill, sendable,
} from './questionsModel.js';

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const BLOCK = 'flex min-w-0 flex-col gap-2';
const H = 'm-0 text-[13px] font-bold text-axal-ink dark:text-gray-100';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const SMALL = 'm-0 text-[11.5px] text-axal-muted dark:text-gray-400';
const TEXT = 'm-0 whitespace-pre-wrap text-[13px] text-axal-ink dark:text-gray-100';
const FIELD = 'min-h-[96px] w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60 max-sm:min-h-11 max-sm:flex-1 dark:hover:bg-violet-500';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-60 max-sm:min-h-11 max-sm:flex-1 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const ITEM = 'flex min-w-0 flex-col gap-1.5 rounded-lg border border-axal-hairline bg-axal-ground/40 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/40';
const ANSWER = 'flex flex-col gap-0.5 border-l-2 border-axal-violet/40 pl-3 dark:border-violet-400/50';
const LAV = 'm-0 rounded-lg border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200';
const ALERT = 'm-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';

const sentenceOf = (e, fallback) => (typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : fallback);

function QPill({ q, side, testId }) {
  const p = questionPill(q, side);
  return <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${p.className}`} data-testid={testId}><span aria-hidden="true">{p.glyph}</span>{p.text}</span>;
}

/** The founders' answer under a question. */
function Answer({ q, testId }) {
  if (!q.answer) return null;
  return (
    <div className={ANSWER} data-testid={testId}>
      <span className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{q.answer.by || 'A founder'} <span className="font-normal text-axal-muted dark:text-gray-400">· founder · {questionDay(q.answer.at)}</span></span>
      <p className={TEXT}>{q.answer.body}</p>
    </div>
  );
}

/** One text box with its counter, a line under it, and Cancel and the send press. Keeps its text on a failure. */
function Composer({ label, hint, max, privacy, note, sendWord, busyWord, onSend, onCancel, testId, autoFocus = true }) {
  const [text, setText] = useState('');
  const [state, setState] = useState({ busy: false, error: '' });
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && typeof ref.current?.focus === 'function') ref.current.focus(); }, [autoFocus]);
  const ok = sendable(text, max);
  const send = async () => {
    if (!ok || state.busy) return;
    setState({ busy: true, error: '' });
    try { await onSend(ok); } catch (e) { setState({ busy: false, error: sentenceOf(e, 'It was not sent. Try again.') }); return; }
    setState({ busy: false, error: '' });
    setText('');
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{label} <span className="font-normal text-axal-muted dark:text-gray-400">{hint}</span></span>
        <textarea ref={ref} className={FIELD} value={text} maxLength={max} onChange={(e) => setText(e.target.value)} disabled={state.busy} data-testid={`${testId}-text`} />
      </label>
      <div className="flex flex-wrap justify-between gap-2"><span className={SMALL}>{note}</span><span className={`${SMALL} tabular-nums`} data-testid={`${testId}-count`}>{counter(text, max)}</span></div>
      {privacy ? <p className={SMALL}>{privacy}</p> : null}
      {state.error ? <p role="alert" className={ALERT} data-testid={`${testId}-error`}><b>✕ Not sent.</b> {state.error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 max-sm:flex-nowrap">
        <button type="button" className={GHOST} onClick={onCancel} disabled={state.busy} data-testid={`${testId}-cancel`}>Cancel</button>
        <button type="button" className={PRIMARY} onClick={send} disabled={!ok || state.busy} data-testid={`${testId}-send`}>{state.busy ? busyWord : sendWord}</button>
      </div>
    </div>
  );
}

/** Reads one report's questions; `null` uid reads nothing. */
function useQuestions(reportUid) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!reportUid) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    reportQuestionsApi.list(reportUid).then(
      (d) => { if (alive) setState({ status: 'ready', data: d }); },
      () => { if (alive) setState({ status: 'unreadable', data: null }); },
    );
    return () => { alive = false; };
  }, [reportUid, tick]);
  const replace = (q) => setState((s) => ({ ...s, data: { ...s.data, questions: (s.data?.questions || []).map((x) => (x.uid === q.uid ? q : x)) } }));
  const add = (q) => setState((s) => ({ ...s, data: { ...s.data, questions: [...(s.data?.questions || []), q] } }));
  return { ...state, retry: () => setTick((n) => n + 1), replace, add };
}

// ───────────────────────────────────────────────────────────── the investor (GRQ22a, GRQ22b)

/** The in-page review before a withdraw: what changes, what stays, no undo. */
function WithdrawReview({ q, about, onKeep, onDone }) {
  const [state, setState] = useState({ busy: false, error: '' });
  const go = async () => {
    setState({ busy: true, error: '' });
    try { onDone((await reportQuestionsApi.withdraw(q.uid)).question); } catch (e) { setState({ busy: false, error: sentenceOf(e, 'It was not withdrawn. Try again.') }); }
  };
  return (
    <div role="group" aria-label="Withdraw your question?" className="flex flex-col gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid={`question-withdraw-review-${q.uid}`}>
      <p className={H}>Withdraw your question?</p>
      <p className={SMALL}>About: {about}</p>
      <p className={MUTED}><b className="text-axal-ink dark:text-gray-100">What changes:</b> the question shows as Withdrawn. The founders can no longer reply to it.</p>
      <p className={MUTED}><b className="text-axal-ink dark:text-gray-100">What stays:</b> the founders see that you withdrew it. The text stays in the record.</p>
      <p className={MUTED}><b className="text-axal-ink dark:text-gray-100">Undo:</b> none. You can ask a new question.</p>
      {state.error ? <p role="alert" className={ALERT}>{state.error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 max-sm:flex-nowrap">
        <button type="button" className={GHOST} onClick={onKeep} disabled={state.busy}>Keep the question</button>
        <button type="button" className={PRIMARY} onClick={go} disabled={state.busy} data-testid={`question-withdraw-confirm-${q.uid}`}>{state.busy ? 'Withdrawing…' : 'Withdraw question'}</button>
      </div>
    </div>
  );
}

/**
 * The reader's "Your questions". `figures` maps a figure key to `{ label, value }`;
 * `asking` is the figure the reader's link chose (`{ key }`), or `{ key: null }`
 * for the whole report; `onAsking` opens or closes the composer.
 */
export function InvestorQuestions({ reportUid, company = 'the company', period = null, figures = {}, asking = null, onAsking = () => {}, onQuestions = () => {} }) {
  const q = useQuestions(reportUid);
  const [reviewing, setReviewing] = useState(null);
  const [done, setDone] = useState('');
  const list = q.data?.questions || [];
  useEffect(() => { onQuestions(list, !!q.data?.can_ask); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const co = company || 'the company';
  const canAsk = !!q.data?.can_ask;
  const composer = asking && canAsk ? (
    <div className={ITEM} id="report-question-composer">
      <p className={SMALL}>About: <b className="text-axal-ink dark:text-gray-100" data-testid="question-composer-about">{aboutLine({ figure_key: asking.key }, figures, period)}</b></p>
      <Composer key={asking.key || 'whole'} testId="question-composer" label="Your question" hint={`· to ${co}’s founders`} max={QUESTION_MAX}
        note={`Up to ${QUESTION_MAX} characters. Nothing is posted until you press Send question.`}
        privacy={`🔒 Only ${co}’s founders see your question and their answer. Other investors do not.`}
        sendWord="Send question" busyWord="Sending…" onCancel={() => onAsking(null)}
        onSend={async (text) => { const res = await reportQuestionsApi.ask(reportUid, text, asking.key); q.add(res.question); setDone(''); onAsking(null); }} />
    </div>
  ) : null;
  return (
    <section className={BLOCK} id="questions" data-testid="company-reader-questions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H}>Your questions{list.length ? ` · ${list.length}` : ''}</h3>
        {canAsk && !asking ? <button type="button" className={GHOST} onClick={() => onAsking({ key: null })} data-testid="question-ask-whole">Ask about the whole report</button> : null}
      </div>
      {q.status === 'loading' ? <p className={MUTED} aria-busy="true" data-testid="questions-loading">Reading…</p> : null}
      {q.status === 'unreadable' ? <Unreadable what="Your questions" claim="This is not a claim that nobody asked. The report, its figures and statements still work." onRetry={q.retry} /> : null}
      {q.status === 'ready' ? (
        <>
          {list.length ? <p className={SMALL}>Only you and {co}’s founders see these.</p> : (
            <div className="flex flex-col gap-1" data-testid="questions-none">
              <p className={TEXT}>You have not asked about this report.</p>
              <p className={MUTED}>Ask about one figure with its link above, or about the report as a whole. Only {co}’s founders see what you ask.</p>
            </div>
          )}
          {composer}
          {done ? <p role="status" className={LAV} data-testid="question-withdrawn-note">✓ {done}</p> : null}
          {list.map((x) => {
            const about = aboutLine(x, figures, period);
            return (
              <article key={x.uid} className={ITEM} data-testid={`question-${x.uid}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={SMALL}>About: <b className="text-axal-ink dark:text-gray-100">{about}</b> · Asked {questionDay(x.asked_at)}</span>
                  <QPill q={x} side="investor" testId={`question-pill-${x.uid}`} />
                </div>
                <p className={TEXT}>{x.body}</p>
                <Answer q={x} testId={`question-answer-${x.uid}`} />
                {x.state === 'withdrawn' ? <p className={SMALL}>You withdrew this on {questionDay(x.withdrawn_at)}. The founders see that; the text stays in the record.</p> : null}
                {reviewing === x.uid ? (
                  <WithdrawReview q={x} about={about} onKeep={() => setReviewing(null)}
                    onDone={(nq) => { q.replace(nq); setReviewing(null); setDone(`Withdrawn. ${co}’s founders see it as withdrawn.`); }} />
                ) : isOpenQuestion(x) && canAsk ? (
                  <button type="button" className={`${GHOST} w-fit`} onClick={() => setReviewing(x.uid)} data-testid={`question-withdraw-${x.uid}`}>Withdraw…</button>
                ) : null}
              </article>
            );
          })}
          {!canAsk && q.data?.write_refusal ? <p className={MUTED} data-testid="questions-write-refusal">{q.data.write_refusal}</p> : null}
        </>
      ) : null}
    </section>
  );
}

// ───────────────────────────────────────────────────────────── the founders (GRQ23, GRQ23b)

/** The sent report's Questions section, above the frozen report. `figures` maps a key to `{ label, value }`. */
export function FounderQuestions({ reportUid, period = null, figures = {} }) {
  const q = useQuestions(reportUid);
  const [replying, setReplying] = useState(null);
  const list = q.data?.questions || [];
  const canReply = !!q.data?.can_reply;
  const readOnly = q.data && q.data.view !== 'team';
  return (
    <section className={CARD} id="questions" data-testid="reporting-questions">
      <h2 className={H2}>Questions{list.length ? ` · ${list.length}` : ''}</h2>
      {q.status === 'loading' ? <p className={MUTED} aria-busy="true" data-testid="questions-loading">Reading…</p> : null}
      {q.status === 'unreadable' ? <Unreadable what="Questions" claim="This is not a claim that nobody asked. The sent report still works." onRetry={q.retry} /> : null}
      {q.status === 'ready' && !list.length ? (
        <div className="flex flex-col gap-1" data-testid="questions-none">
          <p className={TEXT}>No investor has asked about this report.</p>
          <p className={MUTED}>Questions come from the investors who received it. There is nothing to do here.</p>
        </div>
      ) : null}
      {q.status === 'ready' && list.length ? (
        <>
          <p className={MUTED} data-testid="questions-counts">{countsLine(list)}</p>
          <p className={SMALL}>From investors who received this report. Each investor sees only their own questions and your answers.</p>
          {readOnly ? <p className={LAV} data-testid="questions-read-only">◉ Read only. Only the founders reply. You see the threads as you read the sent report.</p> : null}
          {!readOnly && !canReply && q.data?.write_refusal ? <p className={MUTED} data-testid="questions-write-refusal">{q.data.write_refusal}</p> : null}
          {list.map((x) => {
            const who = x.asker?.name || 'An investor';
            return (
              <article key={x.uid} className={ITEM} data-testid={`founder-question-${x.uid}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{who}</span>
                  <QPill q={x} side="team" testId={`founder-question-pill-${x.uid}`} />
                </div>
                <span className={SMALL}>About: <b className="text-axal-ink dark:text-gray-100">{aboutLine(x, figures, period)}</b> · Asked {questionDay(x.asked_at)}</span>
                <p className={TEXT}>{x.body}</p>
                <Answer q={x} testId={`founder-question-answer-${x.uid}`} />
                {x.state === 'withdrawn' ? <p className={SMALL}>{who} withdrew this on {questionDay(x.withdrawn_at)}, before an answer. The text stays in the record.</p> : null}
                {replying === x.uid ? (
                  <Composer testId={`founder-reply-${x.uid}`} label="Your reply" hint={`· only ${who} and your co-founders see it`} max={REPLY_MAX}
                    note="A sent reply is not edited." sendWord="Send reply" busyWord="Sending…" onCancel={() => setReplying(null)}
                    onSend={async (text) => {
                      try { const res = await reportQuestionsApi.reply(x.uid, text); q.replace(res.question); setReplying(null); } catch (e) {
                        // Withdrawn or answered meanwhile: show the question as it now is, and keep the box's text with the sentence.
                        if (e?.status === 409) reportQuestionsApi.list(reportUid).then((d) => { const now = (d?.questions || []).find((y) => y.uid === x.uid); if (now) q.replace(now); }, () => {});
                        throw e;
                      }
                    }} />
                ) : canReply && isOpenQuestion(x) ? (
                  <button type="button" className={`${PRIMARY} w-fit`} onClick={() => setReplying(x.uid)} data-testid={`founder-question-reply-${x.uid}`}>Reply</button>
                ) : null}
              </article>
            );
          })}
        </>
      ) : null}
    </section>
  );
}
