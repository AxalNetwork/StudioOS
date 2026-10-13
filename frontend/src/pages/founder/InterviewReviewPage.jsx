import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api as mainApi } from '../../lib/api';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { ReviewStep, TranscriptReview } from './InterviewSessionPage';
import SessionSummary from './SessionSummary';
import { REVIEWABLE, pickSession, sessionLabel, statusWord, whoLine } from './interviewReviewModel';
import { FOCUSABLE, tabTarget } from '../../ui/lightboxFocus.js';

/**
 * Validate › an interview (D685 §5.11, #1589), at `/validate/interviews/:id`:
 * the interview, its sessions, and the findings proposed from them, with the
 * summary on top (§5.10). `/validate/session/:id` stays as the per-session
 * deep link; this is where the processing view lands and where the Customer
 * research rows and the interview log link.
 *
 * WHICH SESSION. `?session=` when it names one of this interview's; else the
 * newest with a transcript (`interviewReviewModel.pickSession`), because the
 * Worker lists drafts and recordings too. A switcher appears when there are
 * several.
 *
 * PLACEMENTS STAY BUTTONS. Accept, Edit and Discard call D658's POSTs through
 * `ReviewStep`; none of them is a link, because a link must not change state.
 *
 * EDIT DETAILS sends the whole interview row back. `PUT
 * /progress/discovery/interview/:id` writes every field it is not given as
 * empty (role, notes, hypotheses, pains), so the row is read fresh from the
 * project's list first, and a row that cannot be read is never saved over.
 *
 * DELETE removes the interview with its sessions' audio, transcripts and
 * pending placements: the Worker deletes each session first (`progress.ts`,
 * #1591). The confirm says so.
 */

const STAGES = { lead: 'Lead', invited: 'Invited', booked: 'Booked', done: 'Held', held: 'Held' };
// While the job runs, it writes the summary itself: Summarise is not offered then.
const RUNNING = new Set(['uploading', 'transcribing', 'summarising', 'placing']);

/** The PUT body for Edit details: the fresh row, with only the name and company changed. */
export function detailsPayload(row, { name, company }) {
  return {
    interviewee_name: String(name || '').trim(),
    interviewee_role: row.interviewee_role || '',
    interview_date: row.interview_date,
    notes: row.notes || '',
    hypotheses: Array.isArray(row.hypotheses) ? row.hypotheses : [],
    pains: Array.isArray(row.pains) ? row.pains : [],
    interviewee_company: String(company || '').trim() || null,
  };
}

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

export default function InterviewReviewPage({ sessions = interviewSessionsApi, api = mainApi }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const theme = useDarkTheme();
  const [list, setList] = useState(undefined);
  const [detail, setDetail] = useState(undefined);
  const [receipt, setReceipt] = useState(undefined);
  const [summarising, setSummarising] = useState({ busy: false, error: null });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const loadList = useCallback(() => sessions.list(id).then(setList).catch(() => setList(null)), [sessions, id]);
  useEffect(() => { loadList(); }, [loadList]);
  const chosen = pickSession(list?.items, params.get('session'));
  const chosenId = chosen?.id ?? null;
  const loadDetail = useCallback(() => {
    if (chosenId == null) return undefined;
    return sessions.get(chosenId).then(setDetail).catch(() => setDetail(null));
  }, [sessions, chosenId]);
  const loadReceipt = useCallback(() => {
    if (chosenId == null) return undefined;
    return sessions.receipt(chosenId).then(setReceipt).catch(() => setReceipt(null));
  }, [sessions, chosenId]);
  useEffect(() => { setDetail(undefined); setReceipt(undefined); setSummarising({ busy: false, error: null }); loadDetail(); loadReceipt(); }, [loadDetail, loadReceipt]);

  if (list === undefined) return <div className="p-6 text-[13px] text-axal-faint">Reading the interview…</div>;
  if (list === null) return <div role="alert" className="p-6 text-[13px] text-red-700 dark:text-red-400" data-testid="interview-review-unreadable">Unreadable: this interview could not be read.</div>;

  const interview = list.interview || {};
  const items = Array.isArray(list.items) ? list.items : [];
  const { name, company } = whoLine(interview);
  const session = detail?.session || chosen;
  const reviewable = !!session && REVIEWABLE.has(session.status);
  const segments = Array.isArray(detail?.segments) ? detail.segments : [];
  const hasFinal = segments.some((s) => s.source === 'final');

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

  const saveDetails = async () => {
    setEditing((x) => ({ ...x, busy: true, error: null }));
    try {
      const rows = await api.listInterviews(interview.project_id);
      // `GET /progress/discovery/:projectId` answers `{ project_id, interviews }`.
      const row = (Array.isArray(rows?.interviews) ? rows.interviews : []).find((r) => String(r.id) === String(interview.id));
      if (!row) throw new Error('This interview could not be read, so nothing was saved.');
      if (!String(editing.name || '').trim()) throw new Error('Name the person you talked to.');
      await api.updateInterview(interview.id, detailsPayload(row, editing));
      setEditing(null);
      loadList();
    } catch (e) {
      setEditing((x) => ({ ...x, busy: false, error: e?.message || 'The details could not be saved.' }));
    }
  };

  const remove = async () => {
    setDeleting((x) => ({ ...x, busy: true, error: null }));
    try {
      await api.deleteInterview(interview.id ?? id);
      navigate('/validate/interviews', { replace: true });
    } catch (e) {
      setDeleting({ busy: false, error: e?.message || 'The interview could not be deleted.' });
    }
  };

  const assign = async (segId, label) => {
    await sessions.setSpeaker(session.id, segId, label);
    setDetail((d) => ({ ...d, segments: d.segments.map((s) => (s.id === segId ? { ...s, speaker_label: label } : s)) }));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6" data-testid="interview-review-page">
      <nav className="text-[12px]"><Link to="/validate/interviews" className="text-axal-muted underline dark:text-gray-400">Interviews</Link></nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[20px] font-bold text-axal-ink dark:text-gray-100" data-testid="interview-review-who">
            {name} · <span className={company === 'Not recorded' ? 'font-semibold text-axal-muted dark:text-gray-400' : ''}>{company}</span>
          </h1>
          <p className="m-0 mt-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="interview-review-meta">
            {STAGES[interview.stage] || 'Stage not recorded'} · {items.length === 1 ? '1 session' : `${items.length} sessions`}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing({ name: interview.interviewee_name || '', company: interview.interviewee_company || '', busy: false, error: null })} data-testid="button-edit-details"
            className="rounded-md border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100">Edit details</button>
          <button type="button" onClick={() => setDeleting({ busy: false, error: null })} data-testid="button-delete-interview"
            className="rounded-md border border-red-200 px-3 py-1.5 text-[12.5px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">Delete</button>
        </div>
      </header>

      {editing && (
        <form className="space-y-2 rounded-2xl border border-axal-hairline p-4 dark:border-gray-800" data-testid="edit-details" onSubmit={(e) => { e.preventDefault(); saveDetails(); }}>
          <label className="block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Name
            <input value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} data-testid="edit-name" maxLength={120}
              className="mt-1 block w-full rounded-md border border-axal-hairline px-2 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          </label>
          <label className="block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Company
            <input value={editing.company} onChange={(e) => setEditing((x) => ({ ...x, company: e.target.value }))} data-testid="edit-company" maxLength={160}
              className="mt-1 block w-full rounded-md border border-axal-hairline px-2 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          </label>
          {editing.error && <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="edit-error">{editing.error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={editing.busy} data-testid="button-save-details" className="rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">{editing.busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold text-axal-muted dark:text-gray-300">Cancel</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <section className="rounded-2xl border border-axal-hairline p-5 text-[13px] dark:border-gray-800" data-testid="interview-no-sessions">
          <p className="m-0 text-axal-muted dark:text-gray-400">No session recorded for this interview yet.</p>
          <Link to="/validate/record" className="mt-2 inline-block font-semibold text-violet-700 underline dark:text-violet-300">Record a session</Link>
        </section>
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
          {detail === null && <p role="alert" className="text-[13px] text-red-700 dark:text-red-400">Unreadable: this session could not be read.</p>}
          {detail !== undefined && detail !== null && (
            <SessionSummary summary={detail.summary || null} segments={segments} canSummarise={reviewable && hasFinal && !RUNNING.has(detail.processing?.stage)}
              busy={summarising.busy} error={summarising.error} onSummarise={summarise} />
          )}
          {detail?.processing?.stage === 'done' && detail.processing.error && <p role="status" className="text-[13px] font-semibold text-amber-800 dark:text-amber-300" data-testid="processing-note">{detail.processing.error}</p>}
          {reviewable ? (
            <section className="space-y-2" data-testid="interview-review-findings">
              <h2 className="text-[16px] font-bold text-axal-ink dark:text-gray-100">Findings</h2>
              <ReviewStep api={sessions} sessionId={session.id} theme={theme} receiptItems={receipt === null ? null : receipt?.items} onSpent={loadReceipt} />
            </section>
          ) : session && (
            <section className="rounded-2xl border border-axal-hairline p-5 text-[13px] dark:border-gray-800" data-testid="interview-session-not-reviewable">
              <p className="m-0 text-axal-muted dark:text-gray-400">{`This session is ${statusWord(session.status).toLowerCase()}: nothing to review yet.`}</p>
              <Link to={`/validate/session/${encodeURIComponent(session.id)}`} className="mt-2 inline-block font-semibold text-violet-700 underline dark:text-violet-300" data-testid="link-open-session">Open the session</Link>
            </section>
          )}
          {detail && hasFinal && (
            <section className="space-y-2">
              <h2 className="text-[16px] font-bold text-axal-ink dark:text-gray-100">Transcript</h2>
              <TranscriptReview segments={segments} intervieweeName={interview.interviewee_name} onAssign={assign} />
            </section>
          )}
        </>
      )}

      {deleting && <DeleteConfirm name={name} busy={deleting.busy} error={deleting.error} onCancel={() => setDeleting(null)} onDelete={remove} />}
    </div>
  );
}
