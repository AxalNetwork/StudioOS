import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api as mainApi } from '../../lib/api';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { ReviewStep, TranscriptReview } from './InterviewSessionPage';
import SessionSummary from './SessionSummary';
import { REVIEWABLE, afterDelete, findPassages, pickSession, recordParts, sessionLabel, statusWord } from './interviewReviewModel';
import { FOCUSABLE, tabTarget } from '../../ui/lightboxFocus.js';
import { useRailOption } from '../../ui/railCrumbs';
import { RecordActions, RecordActivity, RecordFacts, RecordSection } from '../cycles/RecordView';
import { declaredActions, pillView, recordActionBody, recordFormFor, toneOf } from '../cycles/recordModel';
import FormLightbox from '../cycles/FormLightbox';
import { InterviewEvidenceFields, PainSeverity } from './validatePieces';
import InterviewRecording from '../../workspaces/founder/InterviewRecording';
import useAssistMode from '../../hooks/useAssistMode';
import { useSessionPlayer } from './sessionPlayer.js';

/**
 * Validate › Customer research › an interview (D697, #1659): Customer
 * research's record (CO:363), at `/validate/customer-research/:id`, drawn by
 * `CycleRoute` in its record mode (D696) inside the cycle, so the cycle header
 * and its "‹ Back to Customer research" tab replace the old inset and
 * breadcrumb.
 *
 * THE READ DECIDES WHAT IS DRAWN (decision 14). The header, the four facts,
 * What it fed, Session and Activity are the record read's (#1692). Transcript,
 * Eadwyn's placements, Cost and Session are writer-only sections there, so a
 * partner's read has none of them and an empty `actions`: the page then makes
 * no call to the session routes, which answer only the venture's own, and none
 * to `listInterviews`.
 *
 * INSIDE THE READ'S SECTIONS, TODAY'S WORKING PARTS.
 *   - Transcript: the session switcher (`?session=`, `pickSession`, checked to
 *     be this interview's), `SessionSummary`, the processing note,
 *     `TranscriptReview` with each passage's start, Search (a text find over the
 *     loaded passages; it calls nothing) and the player.
 *   - Eadwyn's placements: `ReviewStep`, with the receipt's items.
 *   - Cost: the read's frame, with the chosen session's receipt lines, so Cost
 *     follows the switcher.
 *   The read's "→ <target>" marks are not drawn on the passages: the rows
 *   cannot carry the switcher and the speaker chips, and the placements list
 *   each target.
 *
 * THE ACTIONS. Edit details is #1656's `FormLightbox` over the read's two
 * fields, saved through `recordAction`, which writes the name and the company
 * and nothing else (#1692's decision 18). Delete keeps `DeleteConfirm`'s words
 * and lands on Customer research. Open recording plays the chosen session's
 * audio. Every dialog goes through `openDialog`, which `CycleRoute` draws
 * after its size container (decision 21).
 *
 * THE PLAYER is `useSessionPlayer` (`sessionPlayer.js`): #1692's audio route,
 * one blob per part, played in `seq` order; the session page plays a chat's
 * voice notes with the same hook (D754, #1980).
 */

// While the job runs, it writes the summary itself: Summarise is not offered then.
const RUNNING = new Set(['uploading', 'transcribing', 'summarising', 'placing']);

const CARD = 'scroll-mt-4 overflow-hidden rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const HEAD = 'flex flex-wrap items-center justify-between gap-3 border-b border-axal-hairline px-4 py-3 dark:border-gray-700';
const H2 = 'm-0 text-sm font-bold text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PILL = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  v1: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  v2: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
};
const PILL_DEFAULT = 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
const usd = (micro) => `$${(Number(micro || 0) / 1e6).toFixed(4)}`;

function useDarkTheme() {
  const read = () => typeof document !== 'undefined' && !!document.documentElement?.classList?.contains('dark');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const o = new MutationObserver(() => setDark(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return dark ? 'dark' : 'light';
}

/** "Delete this interview?": modal, Cancel focused first, Escape cancels. */
export function DeleteConfirm({ name, busy, error, onCancel, onDelete }) {
  const box = useRef(null);
  const cancel = useRef(null);
  useEffect(() => { cancel.current?.focus?.(); }, []);
  useEffect(() => {
    const el = box.current;
    if (!el?.addEventListener) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault?.(); onCancel?.(); return; }
      if (e.key !== 'Tab') return;
      const items = [...(el.querySelectorAll?.(FOCUSABLE) || [])];
      const next = tabTarget(items, document.activeElement, !!e.shiftKey);
      if (next) { e.preventDefault?.(); next.focus?.(); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="delete-interview-title" aria-describedby="delete-interview-body" data-testid="delete-interview-confirm"
        className="w-full max-w-[420px] rounded-2xl bg-white p-5 text-axal-ink shadow-xl dark:bg-gray-900 dark:text-gray-100">
        <h2 id="delete-interview-title" className="m-0 text-[16px] font-bold">{`Delete the interview with ${name}?`}</h2>
        <p id="delete-interview-body" className="mt-2 text-[13px] text-axal-muted dark:text-gray-300">Its recordings, transcripts and summaries go too, with any findings still waiting for review. Findings you already accepted stay in their Validate modules. This cannot be undone.</p>
        {error && <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="delete-interview-error">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={onCancel} data-testid="button-cancel-delete" className="rounded-md border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold dark:border-gray-700">Cancel</button>
          <button type="button" onClick={onDelete} disabled={busy} data-testid="button-confirm-delete" className="rounded-md bg-red-600 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600">{busy ? 'Deleting…' : 'Delete the interview'}</button>
        </div>
      </div>
    </div>
  );
}

/** Delete's confirm with its own busy and error state; the record hands it to `openDialog` once. */
function DeleteDialog({ name, onCancel, onDelete }) {
  const [state, setState] = useState({ busy: false, error: null });
  const run = async () => {
    setState({ busy: true, error: null });
    try { await onDelete(); } catch (e) { setState({ busy: false, error: e?.message || 'The interview could not be deleted.' }); }
  };
  return <DeleteConfirm name={name} busy={state.busy} error={state.error} onCancel={onCancel} onDelete={run} />;
}

/** A section's frame from the read: its title, then what the record draws inside it. */
function Frame({ section, testid, extra = null, children }) {
  return (
    <section className={CARD} data-testid={testid}>
      <header className={HEAD}>
        <h2 className={H2}>{section.title}</h2>
        {extra}
      </header>
      <div className="space-y-3 px-4 py-3">{children}</div>
    </section>
  );
}

/**
 * The interview's tools (step 8), writers only: its evidence, how badly each
 * pain was needed, the recording, and Record a session. The row they edit is
 * read fresh from the venture's interviews and found by id; an id that is not
 * there draws no control.
 */
function InterviewTools({ projectId, interviewId, api, onChanged }) {
  const location = useLocation();
  const [fillsOn] = useAssistMode('Validate');
  const [row, setRow] = useState(undefined);
  const load = useCallback(() => api.listInterviews(projectId)
    .then((res) => setRow((Array.isArray(res?.interviews) ? res.interviews : []).find((r) => String(r.id) === String(interviewId)) || null))
    .catch(() => setRow(null)), [api, projectId, interviewId]);
  useEffect(() => { void load(); }, [load]);
  const changed = () => { void load(); onChanged?.(); };
  const pains = row ? (row.pain_points || row.pains || []) : [];
  return (
    <section className={CARD} data-testid="interview-tools">
      <header className={HEAD}><h2 className={H2}>This interview</h2></header>
      <div className="space-y-3 px-4 py-3">
        {row === undefined ? <p className={MUTED} aria-busy="true">Reading the interview…</p>
          : row === null ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-400" data-testid="interview-tools-unreadable">This interview could not be read.</p>
            : (
              <>
                <Link to={`/validate/record?interview=${encodeURIComponent(row.id)}&project_id=${encodeURIComponent(projectId)}`}
                  state={{ under: `${location.pathname}${location.search}` }} data-testid="link-record-session"
                  className="inline-flex w-fit rounded-[7px] border border-violet-200 px-[9px] py-1 text-[11.5px] font-bold text-violet-800 hover:border-violet-300 dark:border-violet-800 dark:text-violet-200">
                  Record a session
                </Link>
                <InterviewEvidenceFields fit={row.icp_fit} consent={row.quote_consent} company={row.interviewee_company}
                  onSave={(patch) => api.updateInterviewEvidence(row.id, patch).then(changed)} />
                {pains.length > 0 && <PainSeverity interviewId={row.id} pains={pains} onChanged={changed} />}
                <InterviewRecording interview={row} fillsOn={fillsOn} onChanged={changed} />
              </>
            )}
      </div>
    </section>
  );
}

export default function InterviewRecord({
  read, projectId, id, sessions = interviewSessionsApi, api = mainApi, openDialog = () => {}, act, reload,
  activity, onShowAll, onLink, onForm, onWrite, onClient, cycleName = 'Validate', moduleName = 'Customer research',
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const theme = useDarkTheme();
  const parts = recordParts(read);
  const declarations = declaredActions(read);
  const [list, setList] = useState(undefined);
  const [detail, setDetail] = useState(undefined);
  const [receipt, setReceipt] = useState(undefined);
  const [summarising, setSummarising] = useState({ busy: false, error: null });
  // D771 (#2097): while the summary is written, the rail is that option's.
  useRailOption(summarising.busy ? 'summarise:session' : null, 'Summarise');
  const [search, setSearch] = useState('');

  // The session routes answer only the venture's own: read them only when the read sends Transcript.
  const loadList = useCallback(() => (parts.sessions ? sessions.list(id).then(setList).catch(() => setList(null)) : undefined), [parts.sessions, sessions, id]);
  useEffect(() => { void loadList(); }, [loadList]);
  const chosen = pickSession(list?.items, params.get('session'));
  const chosenId = chosen?.id ?? null;
  const { player, held, audioError, setAudioError, open: openRecording } = useSessionPlayer(sessions, chosenId);
  const loadDetail = useCallback(() => (chosenId == null ? undefined : sessions.get(chosenId).then(setDetail).catch(() => setDetail(null))), [sessions, chosenId]);
  const loadReceipt = useCallback(() => (chosenId == null ? undefined : sessions.receipt(chosenId).then(setReceipt).catch(() => setReceipt(null))), [sessions, chosenId]);
  useEffect(() => {
    setDetail(undefined); setReceipt(undefined); setSummarising({ busy: false, error: null }); setAudioError('');
    void loadDetail(); void loadReceipt();
  }, [loadDetail, loadReceipt]);

  const items = Array.isArray(list?.items) ? list.items : [];
  const session = detail?.session || chosen;
  const reviewable = !!session && REVIEWABLE.has(session.status);
  const segments = Array.isArray(detail?.segments) ? detail.segments : [];
  const hasFinal = segments.some((s) => s.source === 'final');
  const shown = findPassages(segments, search);

  const summarise = async () => {
    setSummarising({ busy: true, error: null });
    try {
      await sessions.summarise(session.id);
      setSummarising({ busy: false, error: null });
      loadDetail(); loadReceipt();
    } catch (e) {
      setSummarising({ busy: false, error: e?.message || 'The summary could not be written.' });
    }
  };
  const assign = async (segId, label) => {
    await sessions.setSpeaker(session.id, segId, label);
    setDetail((d) => ({ ...d, segments: d.segments.map((s) => (s.id === segId ? { ...s, speaker_label: label } : s)) }));
  };

  // ---- The record's own actions -------------------------------------------
  const done = () => { reload?.(); };
  const openEdit = (action) => {
    const spec = recordFormFor(action, read, null);
    if (!spec) return;
    openDialog(
      <FormLightbox key={`edit-details-${id}`} form={spec.form} current={spec.current} cycle="validate" slug="customer-research" moduleName={moduleName}
        onSubmit={(values) => act(action.key, recordActionBody(action, values))} onSaved={done} onClose={() => openDialog(null)} />,
      { page: true },
    );
  };
  const openDelete = (action) => openDialog(
    <DeleteDialog name={read?.title || 'this person'} onCancel={() => openDialog(null)}
      onDelete={async () => { await act(action.key, {}); openDialog(null); navigate(afterDelete(projectId), { replace: true }); }} />,
  );
  const handlers = {
    onLink,
    onForm: (action) => (action.key === 'edit-details' ? openEdit(action) : onForm?.(action)),
    onWrite: (action) => (action.key === 'delete' ? openDelete(action)
      : action.key === 'open-recording' ? openRecording() : onWrite?.(action)),
    onClient,
  };
  const context = { cycleName, moduleName, declarations, ...handlers };

  const transcriptCard = (section) => (
    <Frame key={section.key || 'transcript'} section={section} testid="record-transcript"
      extra={hasFinal ? (
        <label className="flex items-center gap-2 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Search
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="transcript-search" placeholder="Find in the transcript"
            className="rounded-md border border-axal-hairline px-2 py-1 text-[12.5px] font-normal text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        </label>
      ) : null}>
      {list === undefined ? <p className={MUTED} aria-busy="true">Reading the sessions…</p>
        : list === null ? <p role="alert" className="m-0 text-[13px] text-red-700 dark:text-red-400" data-testid="interview-review-unreadable">Unreadable: this interview could not be read.</p>
          : items.length === 0 ? (
            <div data-testid="interview-no-sessions">
              <p className={MUTED}>No session recorded for this interview yet.</p>
              <Link to={`/validate/record?interview=${encodeURIComponent(id)}&project_id=${encodeURIComponent(projectId)}`} className="mt-2 inline-block text-[12.5px] font-semibold text-violet-700 underline dark:text-violet-300">Record a session</Link>
            </div>
          ) : (
            <>
              {items.length > 1 && (
                <label className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Session
                  <select value={String(chosenId)} onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); n.set('session', e.target.value); return n; }, { replace: true })} data-testid="session-switcher"
                    className="rounded-md border border-axal-hairline px-2 py-1 text-[12.5px] font-normal dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                    {items.map((s) => <option key={s.id} value={String(s.id)}>{sessionLabel(s)}</option>)}
                  </select>
                </label>
              )}
              {detail === null && <p role="alert" className="m-0 text-[13px] text-red-700 dark:text-red-400">Unreadable: this session could not be read.</p>}
              {detail !== undefined && detail !== null && (
                <SessionSummary summary={detail.summary || null} segments={segments} canSummarise={reviewable && hasFinal && !RUNNING.has(detail.processing?.stage)}
                  busy={summarising.busy} error={summarising.error} onSummarise={summarise} />
              )}
              {detail?.processing?.stage === 'done' && detail.processing.error && <p role="status" className="m-0 text-[13px] font-semibold text-amber-800 dark:text-amber-300" data-testid="processing-note">{detail.processing.error}</p>}
              {detail && hasFinal && (shown.length
                ? <TranscriptReview segments={shown} intervieweeName={read?.title} onAssign={assign} time />
                : <p className={MUTED} data-testid="transcript-no-match">No passage holds “{search.trim()}”.</p>)}
              {session && !reviewable && (
                <div data-testid="interview-session-not-reviewable">
                  <p className={MUTED}>{`This session is ${statusWord(session.status).toLowerCase()}: nothing to review yet.`}</p>
                  <Link to={`/validate/session/${encodeURIComponent(session.id)}`} className="mt-2 inline-block text-[12.5px] font-semibold text-violet-700 underline dark:text-violet-300" data-testid="link-open-session">Open the session</Link>
                </div>
              )}
            </>
          )}
      <audio ref={player} controls className={held.current.urls.length ? 'w-full' : 'hidden'} data-testid="record-player" />
      {audioError && <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="record-audio-error">{audioError}</p>}
    </Frame>
  );
  const placementsCard = (section) => (
    <Frame key={section.key || 'placements'} section={section} testid="interview-review-findings">
      {reviewable
        ? <ReviewStep api={sessions} sessionId={session.id} theme={theme} receiptItems={receipt === null ? null : receipt?.items} onSpent={loadReceipt} />
        : <p className={MUTED}>{session ? 'Nothing is proposed until the session has a transcript.' : 'No session recorded for this interview yet.'}</p>}
    </Frame>
  );
  const costCard = (section) => (
    <Frame key={section.key || 'cost'} section={section} testid="record-cost">
      {chosenId == null ? <p className={MUTED}>No session recorded for this interview yet.</p>
        : receipt === undefined ? <p className={MUTED} aria-busy="true">Reading…</p>
          : receipt === null ? <p className={MUTED}>Unreadable: the receipt could not be read.</p>
            : !receipt.items?.length ? <p className={MUTED}>Not recorded</p>
              : (
                <ul className="m-0 list-none space-y-1 p-0 text-[12.5px] text-axal-ink dark:text-gray-200">
                  {receipt.items.map((r, i) => (
                    <li key={i} className="flex justify-between gap-2" data-testid="record-cost-line">
                      <span>{r.kind} · {r.model}{r.fallback_used ? ' (fallback)' : ''}{r.outcome !== 'ok' && r.outcome ? ` · ${r.outcome}` : ''}</span>
                      <span className="tabular-nums">{usd(r.cost_microusd)}</span>
                    </li>
                  ))}
                </ul>
              )}
    </Frame>
  );
  const sectionOf = (section, side) => {
    const kind = parts.kind(section);
    if (kind === 'transcript') return transcriptCard(section);
    if (kind === 'placements') return placementsCard(section);
    if (kind === 'cost') return costCard(section);
    return <RecordSection key={section.key || section.title} section={section} side={side} {...context} />;
  };

  return (
    <div className="space-y-3" data-testid="interview-record">
      <div className="flex flex-wrap items-center justify-between gap-3.5">
        <div className="flex flex-wrap items-center gap-2">{(read?.pills ?? []).map((pill, index) => {
          const view = pillView(pill);
          return <span key={index} className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${PILL[toneOf(view.tone)] || PILL_DEFAULT}`}>{view.text}</span>;
        })}</div>
        <RecordActions actions={read?.actions} {...handlers} />
      </div>
      <RecordFacts facts={read?.facts} />
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          {(read?.main ?? []).map((section) => sectionOf(section, false))}
          {parts.tools && <InterviewTools projectId={projectId} interviewId={id} api={api} onChanged={reload} />}
        </div>
        <div className="min-w-0 space-y-3">
          {(read?.side ?? []).map((section) => sectionOf(section, true))}
          <RecordActivity rows={activity ?? read?.activity} total={read?.activity_total} cycleName={cycleName} moduleName={moduleName} onShowAll={onShowAll} />
        </div>
      </div>
    </div>
  );
}
