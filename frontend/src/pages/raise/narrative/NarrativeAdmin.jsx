import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { narrativeApi } from '../../../lib/api/narrative';
import { reportError } from '../../../lib/log';
import { Lightbox, Unreadable } from '../../../ui';
import ReasonGate, { AccessBanner, RecordSkeleton } from '../../../ui/ReasonGate';
import { endedLine, grantSpan } from '../../../ui/reasonGate';
import {
  BOUNDARY, HOME_PATH, NOTES_META, NOTES_TITLE, NOTE_ANSWER_PLACEHOLDER, NOTE_MAX, NOTE_PLACEHOLDER, NO_NOTES, NO_READS,
  OTHER_VENTURE, READS_LINE, READS_TITLE, READ_ONLY, REASON_HOURS, REASON_MAX, REASON_MIN, TITLE,
  noteRow, notePosts, isNarrativeAdmin, openedLine, readRow,
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

/** The reasons read: `{ status, reads, mine, viewer, venture }` (`venture` once G2 sends it). */
function useReads(projectId, tick) {
  const [state, setState] = useState({ status: 'loading', reads: [], mine: null, viewer: null, venture: null });
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    narrativeApi.narrativeReads(projectId)
      .then((r) => { if (alive) setState({ status: 'ready', reads: Array.isArray(r?.reads) ? r.reads : [], mine: r?.mine || null, viewer: r?.viewer || null, venture: r?.venture || null }); })
      .catch((e) => { if (alive) { reportError('NarrativeAdmin:reads', e); setState({ status: 'error', reads: [], mine: null, viewer: null, venture: null }); } });
    return () => { alive = false; };
  }, [projectId, tick]);
  return state;
}

/**
 * NAR13's lines under the access banner (D1463, RR04): who opened it, for
 * what, and that the founder sees it; then that notes are the one write.
 */
export function ReadOnlyBanner({ read, viewer }) {
  const line = openedLine(read, viewer);
  return (
    <div className="flex flex-col gap-1 px-0.5" role="status" data-testid="narrative-read-only">
      {line ? <span className={`text-[12.5px] ${MUTED}`} data-testid="narrative-read-reason">{line}</span> : null}
      <span className={`text-[12.5px] ${MUTED}`}>{READ_ONLY}</span>
    </div>
  );
}

/**
 * Before an admin reads the narrative, the reason the founder will see:
 * D1463's one gate (`ui/ReasonGate.jsx`), in grant mode, with the Worker's
 * 3–200 characters. `inline` is #3712's New version dialog (RR13).
 */
export function NarrativeReasonForm({ projectId, onOpened, submitLabel = 'Open read only', inline = false, venture = null, viewer = null, back = null, notice = null, onCancel = null }) {
  return (
    <ReasonGate
      record={TITLE} what="this narrative" venture={venture} viewer={viewer}
      rule={{ kind: 'grant', hours: REASON_HOURS }} min={REASON_MIN} max={REASON_MAX}
      onSubmit={async (reason) => { await narrativeApi.narrativeGiveReason(projectId, reason); onOpened(); }}
      submitLabel={submitLabel} inline={inline} back={back} notice={notice} onCancel={onCancel}
      preview={inline ? null : <RecordSkeleton />} testId="narrative-reason"
    />
  );
}

/** #3712: shared by the cycle's Add/Edit dialogs, outside the page's gate. */
export function narrativeFormAccess(projectId, user) {
  // Use the authenticated role. A shell preview is not a different principal.
  if (!isNarrativeAdmin(user)) return {};
  return {
    readOnly: `${READ_ONLY} Only the venture’s founders create or change versions.`,
    renderReadRecovery: (error, retry) => error?.data?.code === 'read_reason_required'
      ? <NarrativeReasonForm projectId={projectId} onOpened={retry} submitLabel="Continue" inline /> : null,
  };
}

/**
 * The narrative, for an admin: the reason first, then `children` under the
 * access banner. `onOpened` re-reads the page once a reason is given.
 *
 * D1463: the banner counts down to the grant's `expires_at` each minute; at
 * zero the reads are read again, so the gate returns with RR06's line. The
 * venture header reads `venture` from the reads (G2, D1465). End access now
 * (G1, D1465) ends the read early and re-reads, so the gate returns.
 */
export function NarrativeAdminGate({ projectId, onOpened, back = null, children }) {
  const [tick, setTick] = useState(0);
  const [lapsed, setLapsed] = useState(null);
  const reads = useReads(projectId, tick);
  const opened = useCallback(() => { setLapsed(null); setTick((n) => n + 1); onOpened?.(); }, [onOpened]);
  const mine = reads.mine;
  const expire = useCallback(() => { setLapsed(mine?.expires_at || null); setTick((n) => n + 1); }, [mine?.expires_at]);
  // D1465 (G1): End access now ends the caller's own read on the Worker, then
  // the reads are read again, so the gate returns. A refusal stays on the
  // banner (its "could not be ended" line) and the read stands.
  const end = useCallback(async () => { await narrativeApi.narrativeEndRead(projectId); setLapsed(null); setTick((n) => n + 1); }, [projectId]);
  if (!projectId) return children;
  if (reads.status === 'loading' && !mine) return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="narrative-reason-loading" />;
  if (reads.status === 'error') return <Unreadable what="The read log" claim="The narrative stays closed until it can be checked." onRetry={() => setTick((n) => n + 1)} />;
  if (!mine) {
    return (
      <NarrativeReasonForm projectId={projectId} onOpened={opened} venture={reads.venture} viewer={reads.viewer} back={back}
        notice={lapsed ? endedLine(REASON_HOURS, lapsed) : null} />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="narrative-admin">
      <AccessBanner reason={mine.reason} viewer={reads.viewer} endsAt={mine.expires_at} onExpire={expire} onEnd={end} testId="narrative-access" />
      <ReadOnlyBanner read={mine} viewer={reads.viewer} />
      {children}
    </div>
  );
}

/** The founder's list of every admin who opened the narrative, and why. */
export function NarrativeReads({ projectId }) {
  const reads = useReads(projectId, 0);
  return (
    <section className={CARD} data-testid="narrative-reads">
      <div className="flex flex-col gap-0.5 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>{READS_TITLE}</h2>
        <p className={`m-0 text-[12px] ${MUTED}`}>{READS_LINE}</p>
      </div>
      {reads.status === 'error'
        ? <div className="px-4 py-3"><Unreadable what="Who read this narrative" claim="This is not a claim that nobody did." /></div>
        : reads.status === 'loading'
          ? <div className="m-4 h-10 animate-pulse rounded bg-axal-ground dark:bg-gray-800" aria-hidden="true" />
          : reads.reads.length === 0
            ? <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="narrative-reads-none">{NO_READS}</p>
            : (
              <ul className="m-0 list-none p-0">
                {reads.reads.map((raw) => ({ ...readRow(raw), span: grantSpan(raw) })).map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="narrative-read-row">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={EYEBROW}>{r.who} · {r.when}</span>
                      <span className={`text-[13px] ${INK}`}>{r.reason}</span>
                    </span>
                    {r.span ? <span className={`flex-none text-[12px] font-semibold ${MUTED}`} data-testid="narrative-read-span">{r.span}</span> : null}
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
