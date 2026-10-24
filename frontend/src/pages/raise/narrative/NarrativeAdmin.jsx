import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { narrativeApi } from '../../../lib/api/narrative';
import { reportError } from '../../../lib/log';
import { Lightbox, Unreadable } from '../../../ui';
import {
  BOUNDARY, HOME_PATH, NOTES_META, NOTES_TITLE, NOTE_ANSWER_PLACEHOLDER, NOTE_MAX, NOTE_PLACEHOLDER, NO_NOTES, NO_READS,
  OTHER_VENTURE, READS_TITLE, READ_ONLY, REASON_HELP, REASON_MAX, REASON_PLACEHOLDER, REASON_TITLE, TITLE,
  noteRow, notePosts, openedLine, readRow, reasonProblem,
} from './narrativeModel';

/**
 * D914 (#2698), part 8 of #2454 — the Investor narrative for an admin, and
 * the panels for everyone it is not for.
 *
 *   NarrativeAdminGate  an Admin (or the Super Admin on HQ) gives a reason
 *                       before anything of the narrative is drawn; then the
 *                       NAR13 banner heads every page, read only.
 *   NarrativeNotes      the notes thread the founder sees: an admin posts,
 *                       the founder answers. Each post opens a dialog first.
 *   NarrativeReads      the founder's list of who read the narrative, and why.
 *   NarrativeBoundary   NAR14a: Investors, Advisors, Operating Partners and
 *                       Explorers read the boundary, never a bounce (drawn by
 *                       App.jsx's RoleGuard where it would have redirected).
 *   NarrativeOtherVenture  NAR14b: a founder who opened another venture's narrative.
 *
 * The Worker enforces all of it (`services/narrative/adminRead.ts`); these
 * draw what it answers.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const ALERT = 'm-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400';

/** The reasons read: `{ status, reads, mine, viewer }`. */
function useReads(projectId, tick) {
  const [state, setState] = useState({ status: 'loading', reads: [], mine: null, viewer: null });
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    narrativeApi.narrativeReads(projectId)
      .then((r) => { if (alive) setState({ status: 'ready', reads: Array.isArray(r?.reads) ? r.reads : [], mine: r?.mine || null, viewer: r?.viewer || null }); })
      .catch((e) => { if (alive) { reportError('NarrativeAdmin:reads', e); setState({ status: 'error', reads: [], mine: null, viewer: null }); } });
    return () => { alive = false; };
  }, [projectId, tick]);
  return state;
}

/** NAR13's banner: read only, and the reason the founder sees. */
export function ReadOnlyBanner({ read, viewer }) {
  const line = openedLine(read, viewer);
  return (
    <div className={`${CARD} flex items-start gap-2.5 px-4 py-3`} role="status" data-testid="narrative-read-only">
      <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-axal-lavender text-[11px] font-extrabold text-axal-violet dark:bg-violet-950/50 dark:text-violet-300">i</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-[13px] font-bold ${INK}`}>{READ_ONLY}</span>
        {line ? <span className={`text-[12px] ${MUTED}`} data-testid="narrative-read-reason">{line}</span> : null}
      </div>
    </div>
  );
}

/** Before an admin reads the narrative, the reason the founder will see. */
function ReasonForm({ projectId, onOpened }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const problem = reasonProblem(text);
  const submit = async (e) => {
    e.preventDefault();
    if (problem || busy) { setFailed(problem); return; }
    setBusy(true); setFailed(null);
    try {
      await narrativeApi.narrativeGiveReason(projectId, text.trim());
      onOpened();
    } catch (err) {
      reportError('NarrativeAdmin:reason', err);
      setFailed(err?.message || 'The reason could not be saved. Try again.');
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className={`${CARD} flex max-w-[620px] flex-col gap-3 p-5`} data-testid="narrative-reason">
      <span className={EYEBROW}>{TITLE} · read only</span>
      <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{REASON_TITLE}</h2>
      <p className={`m-0 text-[12.5px] leading-relaxed ${MUTED}`}>{REASON_HELP}</p>
      <label className="flex flex-col gap-1">
        <span className={`text-[12px] font-semibold ${INK}`}>Reason</span>
        <input className={FIELD} value={text} maxLength={REASON_MAX} placeholder={REASON_PLACEHOLDER}
          onChange={(e) => setText(e.target.value)} data-testid="narrative-reason-input" />
      </label>
      {failed ? <p role="alert" className={ALERT} data-testid="narrative-reason-failed">{failed}</p> : null}
      <button type="submit" className={BTN} disabled={busy} data-testid="narrative-reason-open">{busy ? 'Opening…' : 'Open read only'}</button>
    </form>
  );
}

/**
 * The narrative, for an admin: the reason first, then `children` under the
 * read-only banner. `onOpened` re-reads the page once a reason is given.
 */
export function NarrativeAdminGate({ projectId, onOpened, children }) {
  const [tick, setTick] = useState(0);
  const reads = useReads(projectId, tick);
  const opened = useCallback(() => { setTick((n) => n + 1); onOpened?.(); }, [onOpened]);
  if (!projectId) return children;
  if (reads.status === 'loading' && !reads.mine) return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="narrative-reason-loading" />;
  if (reads.status === 'error') return <Unreadable what="The read log" claim="The narrative stays closed until it can be checked." onRetry={() => setTick((n) => n + 1)} />;
  if (!reads.mine) return <ReasonForm projectId={projectId} onOpened={opened} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="narrative-admin">
      <ReadOnlyBanner read={reads.mine} viewer={reads.viewer} />
      {children}
    </div>
  );
}

/** The founder's list of every admin who opened the narrative, and why. */
export function NarrativeReads({ projectId }) {
  const reads = useReads(projectId, 0);
  return (
    <section className={CARD} data-testid="narrative-reads">
      <h2 className={`m-0 border-b border-axal-hairline px-4 py-3 text-[13.5px] font-extrabold dark:border-gray-800 ${INK}`}>{READS_TITLE}</h2>
      {reads.status === 'error'
        ? <div className="px-4 py-3"><Unreadable what="Who read this narrative" claim="This is not a claim that nobody did." /></div>
        : reads.status === 'loading'
          ? <div className="m-4 h-10 animate-pulse rounded bg-axal-ground dark:bg-gray-800" aria-hidden="true" />
          : reads.reads.length === 0
            ? <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="narrative-reads-none">{NO_READS}</p>
            : (
              <ul className="m-0 list-none p-0">
                {reads.reads.map(readRow).map((r) => (
                  <li key={r.id} className="flex flex-col gap-0.5 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="narrative-read-row">
                    <span className={EYEBROW}>{r.who} · {r.when}</span>
                    <span className={`text-[13px] ${INK}`}>{r.reason}</span>
                  </li>
                ))}
              </ul>
            )}
    </section>
  );
}

/** The notes thread. An admin (with a reason) posts; the founder answers; every post opens a dialog first. */
export function NarrativeNotes({ projectId, version = null, admin = false }) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ status: 'loading', notes: [] });
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    narrativeApi.narrativeNotes(projectId)
      .then((r) => { if (alive) setState({ status: 'ready', notes: Array.isArray(r?.notes) ? r.notes : [] }); })
      .catch((e) => { if (alive) { reportError('NarrativeAdmin:notes', e); setState({ status: 'error', notes: [] }); } });
    return () => { alive = false; };
  }, [projectId, tick]);

  const post = async () => {
    setBusy(true); setFailed(null);
    try {
      await narrativeApi.narrativePostNote(projectId, text.trim(), version);
      setText(''); setConfirm(false); setTick((n) => n + 1);
    } catch (e) {
      reportError('NarrativeAdmin:post', e);
      setFailed(e?.message || 'The note could not be posted. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <section className={CARD} data-testid="narrative-notes">
      <div className="flex items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>{NOTES_TITLE}</h2>
        <span className={`text-[11px] ${MUTED}`}>{NOTES_META}</span>
      </div>
      {state.status === 'error'
        ? <div className="px-4 py-3"><Unreadable what="The notes" claim="This is not a claim that there are none." onRetry={() => setTick((n) => n + 1)} /></div>
        : state.status === 'loading'
          ? <div className="m-4 h-10 animate-pulse rounded bg-axal-ground dark:bg-gray-800" aria-hidden="true" />
          : state.notes.length === 0
            ? <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="narrative-notes-none">{NO_NOTES}</p>
            : (
              <ul className="m-0 list-none p-0">
                {state.notes.map(noteRow).map((n) => (
                  <li key={n.id} className="flex flex-col gap-1 border-b border-axal-ground px-4 py-2.5 dark:border-gray-800" data-testid="narrative-note">
                    <span className={EYEBROW}>{n.eye}</span>
                    <span className={`whitespace-pre-line text-[13px] leading-relaxed ${INK}`}>{n.body}</span>
                  </li>
                ))}
              </ul>
            )}
      <div className="flex flex-col gap-2 px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>{admin ? 'Add a note' : 'Answer'}</span>
          <textarea className={`${FIELD} min-h-[72px]`} value={text} maxLength={NOTE_MAX} placeholder={admin ? NOTE_PLACEHOLDER : NOTE_ANSWER_PLACEHOLDER}
            onChange={(e) => setText(e.target.value)} data-testid="narrative-note-input" />
        </label>
        <button type="button" className={BTN} disabled={!text.trim()} onClick={() => { setFailed(null); setConfirm(true); }} data-testid="narrative-note-add">
          {admin ? 'Add note' : 'Answer'}
        </button>
      </div>
      {confirm ? (
        <Lightbox
          label="Post this note"
          title="Post this note?"
          width={480}
          onClose={() => !busy && setConfirm(false)}
          testId="narrative-note-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              <button type="button" className={BTN} onClick={post} disabled={busy} data-testid="narrative-note-confirm">{busy ? 'Posting…' : 'Post note'}</button>
            </div>
          )}
        >
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`} data-testid="narrative-note-what">{notePosts(version)}</p>
          {failed ? <p role="alert" className={`${ALERT} mt-2`}>{failed}</p> : null}
        </Lightbox>
      ) : null}
    </section>
  );
}

function Panel({ label, words, to, testId }) {
  return (
    <section className={`${CARD} mx-auto mt-6 flex max-w-[560px] flex-col items-start gap-2.5 p-6`} data-testid={testId}>
      <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{label}</span>
      <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>⊘</span>
      <h1 className={`m-0 text-[16px] font-extrabold leading-snug tracking-[-.02em] ${INK}`}>{words.title}</h1>
      <p className={`m-0 text-[12.5px] leading-[1.5] ${MUTED}`}>{words.line}</p>
      <Link className={BTN} to={to}>{words.action}</Link>
    </section>
  );
}

/** NAR14a: the narrative is for the venture's founders. Nothing of any narrative is read. */
export function NarrativeBoundary() {
  return <Panel label={TITLE} words={BOUNDARY} to="/" testId="narrative-boundary" />;
}

/** NAR14b: a founder of another venture. */
export function NarrativeOtherVenture() {
  return <Panel label={TITLE} words={OTHER_VENTURE} to={HOME_PATH} testId="narrative-other-venture" />;
}
