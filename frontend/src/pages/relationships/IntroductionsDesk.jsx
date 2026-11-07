import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { relationshipsApi } from '../../lib/api/relationships.js';
import { mailApi } from '../../lib/api/mail.js';
import { reportError } from '../../lib/log';
import RecordCompose from '../email/RecordCompose.jsx';
import DraftFlow, { useDraftFlow } from './DraftFlow.jsx';
import {
  ASK_DRAFT_FOLLOW_UP, ASK_DRAFT_INTRO, INBOX_EMPTY, INTRO_GONE, LOG_EMPTY, LOG_UNREAD, NOT_NOW, OUTCOMES, SENDS_NOTHING, STATUS_FILTERS, STATUS_LABEL, SUMMARY_TITLE, SUMMARY_UNREAD, WRITE_INTRO,
  dayAfter, followUps, introSubject, isOpenForMe, logRows, personOf, summaryField,
} from './relationshipsModel';

/**
 * D1357 (#3572, RI4, RI5, RI6) — Network › Introductions, over D4329's
 * lifecycle (`relationshipsApi`):
 *
 *   RI4  Asked of you: each request to the member, with the asker's reason and
 *        context, Accept or Not now (a note the asker reads). Once accepted,
 *        "Write the intro" opens the Email composer from the member's own
 *        mailbox; the send records the introduction as made (D4329). Axal
 *        sends nothing itself. "Ask Eadwyn to draft the intro" (D4330, part
 *        8b) quotes the run first and opens the drafted subject and body in
 *        that same composer once the member confirms it.
 *   RI6  Follow-ups: the member's own, due first, with Mark done, Snooze and
 *        "Ask Eadwyn to draft a follow-up" (D4330), the same quote-then-run.
 *   RI5  The log: every request sent and received, When, Who for, Team,
 *        Status, Outcome (as recorded, else "Not recorded") and Follow-up,
 *        filtered by the member's own teams and by status; "Follow-ups due".
 *        A made request takes an outcome from either side; the asker
 *        withdraws a pending one.
 *
 * D4464: a summary card over `relationshipsApi.summary()` — the caller's own
 * sharing, how many teammates share with them, and introductions made in the
 * last 90 days. A field the read could not record is "Not recorded", never a
 * 0 standing in for it; the whole card is "Unreadable" on a failed read.
 *
 * A notification's introLink (`cloudflare-worker/src/services/relationships.ts`,
 * D4329) is `/network/introductions?intro=<uid>`: `intro` scrolls, focuses
 * and highlights that request's row, in the inbox or the log, whichever has
 * it; a uid no longer on the desk says so rather than staying silent.
 *
 * A teammate who never shared is in no request, so in no row and no count.
 */
const CARD = 'rounded-[12px] border border-axal-hairline bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] px-3 text-[12px] font-bold disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const QUIET = `${BTN} text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100`;
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const SELECT = 'min-h-[32px] rounded-[9px] border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
const HIGHLIGHT = 'ring-2 ring-axal-violet ring-offset-1';
const today = () => new Date().toISOString().slice(0, 10);

export default function IntroductionsDesk({ testId = 'introductions' }) {
  const [params] = useSearchParams();
  const introUid = params.get('intro') || '';
  const [filter, setFilter] = useState({ team: '', status: '' });
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [teams, setTeams] = useState([]);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [writing, setWriting] = useState(null); // { request, draft: { subject, body } | null }
  const [summary, setSummary] = useState({ status: 'loading', data: null });
  const highlightRefs = useRef(new Map());

  const load = useCallback(() => {
    let live = true;
    setRead((s) => (s.status === 'ok' ? { ...s, reading: true } : { status: 'loading', data: null }));
    relationshipsApi.introRequests({ team: filter.team || undefined, status: filter.status || undefined })
      .then((data) => { if (live) setRead({ status: 'ok', data }); })
      .catch((e) => { if (live) setRead({ status: 'error', data: null }); reportError('relationships:intro-requests', e); });
    return () => { live = false; };
  }, [filter.team, filter.status]);
  useEffect(() => load(), [load]);
  // The member's own teams, for the Team column and filter. Never another team's.
  useEffect(() => { relationshipsApi.sharing().then((d) => setTeams(d?.teams || [])).catch(() => setTeams([])); }, []);

  const loadSummary = useCallback(() => {
    setSummary((s) => (s.status === 'ok' ? s : { status: 'loading', data: null }));
    relationshipsApi.summary()
      .then((data) => setSummary({ status: 'ok', data }))
      .catch((e) => { setSummary({ status: 'error', data: null }); reportError('relationships:summary', e); });
  }, []);
  useEffect(() => loadSummary(), [loadSummary]);

  const act = async (uid, call) => {
    setBusy(uid); setNotice(null);
    try { await call(); load(); }
    catch (e) { setNotice({ uid, text: e?.data?.message || 'That could not be saved. Nothing changed.' }); reportError('relationships:intro-step', e); }
    finally { setBusy(null); }
  };

  const data = read.data;
  const inbox = (data?.received || []).filter(isOpenForMe);
  const rows = logRows(data, teams);
  const due = followUps(data);

  // D4329's introLink: `intro` names a request's uid, present in the inbox, the
  // log, or both — never a count or a presence hint for one the caller cannot see.
  const introPresent = introUid ? inbox.some((r) => r.uid === introUid) || rows.some((x) => x.uid === introUid) : false;
  const introMissing = read.status === 'ok' && !!introUid && !introPresent;
  const setHighlightRef = (uid) => (el) => {
    if (el) highlightRefs.current.set(uid, el); else highlightRefs.current.delete(uid);
  };
  useEffect(() => {
    if (!introUid || !introPresent) return;
    const el = highlightRefs.current.get(introUid);
    el?.scrollIntoView?.({ block: 'center' });
    el?.focus?.();
  }, [introUid, introPresent]);

  const draftIntro = async (r, body) => relationshipsApi.draftIntro(r.uid, body);
  const draftFollowUp = async (f, body) => relationshipsApi.draftFollowUp(f.uid, body);

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby={`${testId}-summary-title`} data-testid={`${testId}-summary`}>
        <h2 id={`${testId}-summary-title`} className={`m-0 text-[16px] font-extrabold ${INK}`}>{SUMMARY_TITLE}</h2>
        {summary.status === 'loading' ? <div className="h-6 w-48 animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" /> : null}
        {summary.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-summary-error`}>
            <span className={MUTED} role="alert">{SUMMARY_UNREAD}</span>
            <button type="button" className={GHOST} onClick={loadSummary}>Try again</button>
          </div>
        ) : null}
        {summary.status === 'ok' ? (
          <dl className="m-0 flex flex-wrap gap-5">
            <SummaryStat label="Sharing with your teams" testId={`${testId}-summary-sharing`}
              value={summaryField(summary.data, 'sharing.teams_shared', summary.data?.sharing?.teams_shared)}
              of={summaryField(summary.data, 'sharing.teams_total', summary.data?.sharing?.teams_total)} />
            <SummaryStat label="Teammates sharing with you" testId={`${testId}-summary-teammates`}
              value={summaryField(summary.data, 'teammates_sharing', summary.data?.teammates_sharing)} />
            <SummaryStat label="Introductions made (90d)" testId={`${testId}-summary-made`}
              value={summaryField(summary.data, 'requests.made_90d', summary.data?.requests?.made_90d)} />
          </dl>
        ) : null}
      </section>

      {introMissing ? (
        <p className={`m-0 ${MUTED}`} role="status" data-testid={`${testId}-intro-missing`}>{INTRO_GONE}</p>
      ) : null}

      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby={`${testId}-inbox-title`} data-testid={`${testId}-inbox`}>
        <h2 id={`${testId}-inbox-title`} className={`m-0 text-[16px] font-extrabold ${INK}`}>Asked of you</h2>
        {read.status === 'ok' && !inbox.length ? <p className={`m-0 ${MUTED}`} data-testid={`${testId}-inbox-empty`}>{INBOX_EMPTY}</p> : null}
        {inbox.map((r) => (
          <AskCard key={r.uid} r={r} highlighted={r.uid === introUid} setHighlightRef={setHighlightRef} busy={busy} notice={notice} declining={declining}
            setDeclining={setDeclining} act={act} setWriting={setWriting} draftIntro={draftIntro} testId={testId} />
        ))}
      </section>

      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby={`${testId}-follow-title`} data-testid={`${testId}-follow-ups`}>
        <h2 id={`${testId}-follow-title`} className={`m-0 text-[16px] font-extrabold ${INK}`}>Follow-ups</h2>
        {read.status === 'ok' && !due.length ? <p className={`m-0 ${MUTED}`}>No follow-ups set. Set one on an introduction below.</p> : null}
        {due.map((f) => (
          <FollowUpRow key={f.uid} f={f} busy={busy} act={act} draftFollowUp={draftFollowUp} testId={testId} />
        ))}
      </section>

      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby={`${testId}-log-title`} data-testid={`${testId}-log`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${testId}-log-title`} className={`m-0 text-[16px] font-extrabold ${INK}`}>Introductions</h2>
          {Number.isFinite(data?.follow_ups_due) ? <span className={PILL} data-testid={`${testId}-due`}>Follow-ups due · {data.follow_ups_due}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-[12px] font-bold text-axal-muted dark:text-gray-400">Team
            <select className={SELECT} value={filter.team} onChange={(e) => setFilter((f) => ({ ...f, team: e.target.value }))} data-testid={`${testId}-filter-team`}>
              <option value="">All your teams</option>
              {teams.map((t) => <option key={t.key} value={t.key}>{t.label || t.key}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px] font-bold text-axal-muted dark:text-gray-400">Status
            <select className={SELECT} value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} data-testid={`${testId}-filter-status`}>
              <option value="">Any status</option>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        </div>
        {read.status === 'loading' ? <div className="h-24 animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" /> : null}
        {read.status === 'error' ? (
          <div className="flex flex-col items-start gap-2" data-testid={`${testId}-error`}>
            <span className={`text-[13px] font-bold ${INK}`}>{LOG_UNREAD}</span>
            <button type="button" className={GHOST} onClick={load}>Try again</button>
          </div>
        ) : null}
        {read.status === 'ok' && !rows.length ? <p className={`m-0 ${MUTED}`} data-testid={`${testId}-empty`}>{LOG_EMPTY}</p> : null}
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-axal-hairline dark:border-gray-700">
                  {['When', 'Who for', 'Team', 'Status', 'Outcome', 'Follow-up', ''].map((h) => <th key={h} scope="col" className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-[.04em] text-axal-muted dark:text-gray-400">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.uid} ref={setHighlightRef(x.uid)} tabIndex={-1} aria-current={x.uid === introUid ? 'true' : undefined}
                    className={`border-b border-axal-hairline align-top last:border-0 dark:border-gray-700 ${x.uid === introUid ? HIGHLIGHT : ''}`} data-testid={`${testId}-row-${x.uid}`}>
                    <td className={`px-2 py-2 text-[12.5px] tabular-nums ${INK}`}>{x.when}</td>
                    <td className="px-2 py-2"><span className={`block text-[12.5px] font-bold ${INK}`}>{x.who}</span><span className={MUTED}>{x.person}</span></td>
                    <td className={`px-2 py-2 text-[12.5px] ${INK}`}>{x.team}</td>
                    <td className="px-2 py-2"><span className={PILL}>{x.status}</span></td>
                    <td className={`px-2 py-2 text-[12.5px] ${INK}`} data-testid={`${testId}-outcome-${x.uid}`}>{x.outcome}</td>
                    <td className={`px-2 py-2 text-[12.5px] ${INK}`}>{x.followUp}</td>
                    <td className="px-2 py-2">
                      <RowActions row={x.row} side={x.side} busy={busy === x.uid} act={act} testId={`${testId}-row-${x.uid}`} />
                      {notice?.uid === x.uid ? <p className="m-0 text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert">{notice.text}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {writing ? (
        <IntroCompose request={writing.request} draft={writing.draft} onClose={() => setWriting(null)} onSent={() => { setWriting(null); load(); }} testId={`${testId}-compose`} />
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value, of, testId }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-axal-muted dark:text-gray-400">{label}</dt>
      <dd className={`m-0 text-[15px] font-bold ${INK}`} data-testid={`${testId}-value`}>{of != null ? `${value} of ${of}` : value}</dd>
    </div>
  );
}

/** RI4: one accepted-or-pending request in "Asked of you", with its own draft-intro flow. */
function AskCard({ r, highlighted, setHighlightRef, busy, notice, declining, setDeclining, act, setWriting, draftIntro, testId }) {
  const { state, ask, confirm, cancel } = useDraftFlow((body) => draftIntro(r, body));
  const onConfirm = async () => {
    const draft = await confirm();
    if (draft) setWriting({ request: r, draft: { subject: draft.subject, body: draft.body } });
  };
  return (
    <article ref={setHighlightRef(r.uid)} tabIndex={-1} aria-current={highlighted ? 'true' : undefined}
      className={`flex flex-col gap-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700 ${highlighted ? HIGHLIGHT : ''}`} data-testid={`${testId}-ask-${r.uid}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[13.5px] font-bold ${INK}`}>{r.requester?.name || 'A teammate'} asks you to introduce them to {personOf(r)}</span>
        <span className={PILL}>{STATUS_LABEL[r.status]}</span>
      </div>
      {r.note ? <p className={`m-0 text-[13px] ${INK}`}>“{r.note}”</p> : null}
      {r.context_note ? <p className={`m-0 ${MUTED}`}>Context for {r.person?.name || 'them'}: “{r.context_note}”</p> : null}
      {notice?.uid === r.uid ? <p className="m-0 text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert">{notice.text}</p> : null}
      {r.status === 'pending' ? (
        declining === r.uid ? (
          <DeclineForm busy={busy === r.uid} onCancel={() => setDeclining(null)} testId={`${testId}-decline-${r.uid}`}
            onSend={(note) => act(r.uid, async () => { await relationshipsApi.decideIntro(r.uid, 'declined', note); setDeclining(null); })} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy === r.uid} onClick={() => act(r.uid, () => relationshipsApi.decideIntro(r.uid, 'accepted'))} data-testid={`${testId}-accept-${r.uid}`}>Accept</button>
            <button type="button" className={GHOST} disabled={busy === r.uid} onClick={() => setDeclining(r.uid)} data-testid={`${testId}-notnow-${r.uid}`}>{NOT_NOW}</button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={() => setWriting({ request: r, draft: null })} data-testid={`${testId}-write-${r.uid}`}>{WRITE_INTRO}</button>
            <button type="button" className={GHOST} disabled={state.status === 'estimating' || state.status === 'running'} onClick={ask} data-testid={`${testId}-draft-intro-${r.uid}`}>{ASK_DRAFT_INTRO}</button>
          </div>
          <DraftFlow state={state} onConfirm={onConfirm} onCancel={cancel} testId={`${testId}-draft-intro-${r.uid}`} confirmLabel="Draft the intro" />
          <span className={MUTED}>{SENDS_NOTHING}</span>
        </div>
      )}
    </article>
  );
}

/** RI6: one follow-up card, with its own draft-follow-up flow. */
function FollowUpRow({ f, busy, act, draftFollowUp, testId }) {
  const { state, ask, confirm, cancel } = useDraftFlow((body) => draftFollowUp(f, body));
  const [drafted, setDrafted] = useState(null);
  const onConfirm = async () => {
    const draft = await confirm();
    if (draft) setDrafted({ subject: draft.subject, body: draft.body });
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid={`${testId}-follow-${f.uid}`} data-state={f.state}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`text-[13px] font-bold ${INK}`}>{f.title}</span>
          <span className={MUTED}>{f.line} · {f.when}</span>
        </span>
        <button type="button" className={GHOST} disabled={busy === f.uid} onClick={() => act(f.uid, () => relationshipsApi.introFollowUpDone(f.uid))} data-testid={`${testId}-follow-done-${f.uid}`}>Mark done</button>
        <button type="button" className={QUIET} disabled={busy === f.uid} onClick={() => act(f.uid, () => relationshipsApi.snoozeIntroFollowUp(f.uid, dayAfter(today(), 7)))} data-testid={`${testId}-follow-snooze-${f.uid}`}>Snooze a week</button>
        <button type="button" className={QUIET} disabled={state.status === 'estimating' || state.status === 'running'} onClick={ask} data-testid={`${testId}-draft-follow-${f.uid}`}>{ASK_DRAFT_FOLLOW_UP}</button>
      </div>
      <DraftFlow state={state} onConfirm={onConfirm} onCancel={cancel} testId={`${testId}-draft-follow-${f.uid}`} confirmLabel="Draft the follow-up" />
      {drafted ? (
        <div className="flex flex-col gap-1 rounded-[9px] border border-axal-hairline p-2 dark:border-gray-700" data-testid={`${testId}-draft-follow-${f.uid}-text`}>
          <span className={`text-[12px] font-bold ${INK}`}>{drafted.subject}</span>
          <p className={`m-0 whitespace-pre-wrap ${MUTED}`}>{drafted.body}</p>
        </div>
      ) : null}
    </div>
  );
}

function DeclineForm({ busy, onSend, onCancel, testId }) {
  const [note, setNote] = useState('');
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-bold text-axal-ink dark:text-gray-100">A note they will read (optional)</span>
        <textarea className={`${FIELD} min-h-[64px]`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`${testId}-note`} />
      </label>
      <div className="flex gap-2">
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => onSend(note.trim() || undefined)} data-testid={`${testId}-send`}>{NOT_NOW}</button>
        <button type="button" className={QUIET} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** A row's own steps: withdraw a pending ask, record an outcome once made, set a follow-up. */
function RowActions({ row, side, busy, act, testId }) {
  const [outcome, setOutcome] = useState('');
  return (
    <div className="flex flex-col items-start gap-1.5">
      {side === 'sent' && row.status === 'pending' ? (
        <button type="button" className={QUIET} disabled={busy} onClick={() => act(row.uid, () => relationshipsApi.withdrawIntro(row.uid))} data-testid={`${testId}-withdraw`}>Withdraw</button>
      ) : null}
      {row.status === 'made' ? (
        <span className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`${testId}-outcome-pick`}>Record the outcome</label>
          <select id={`${testId}-outcome-pick`} className={SELECT} value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid={`${testId}-outcome-pick`}>
            <option value="">Record the outcome</option>
            {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" className={GHOST} disabled={busy || !outcome} onClick={() => act(row.uid, () => relationshipsApi.recordIntroOutcome(row.uid, outcome))} data-testid={`${testId}-outcome-save`}>Save</button>
        </span>
      ) : null}
      {(row.status === 'accepted' || row.status === 'made') && !row.follow_up ? (
        <button type="button" className={QUIET} disabled={busy} onClick={() => act(row.uid, () => relationshipsApi.setIntroFollowUp(row.uid, dayAfter(today(), 7)))} data-testid={`${testId}-follow-set`}>Follow up in a week</button>
      ) : null}
    </div>
  );
}

/** RI4e: the Email composer, from the member's own mailbox, carrying the request's uid so the send records Made.
 *  `draft`, when Eadwyn's run returned one, opens the composer already filled with its subject and body. */
function IntroCompose({ request, draft = null, onClose, onSent, testId }) {
  const [accounts, setAccounts] = useState({ status: 'loading', list: [] });
  const readAccounts = useCallback(() => {
    setAccounts((s) => (s.status === 'ok' ? s : { status: 'loading', list: [] }));
    mailApi.accounts().then((a) => setAccounts({ status: 'ok', list: a?.accounts || [] })).catch(() => setAccounts({ status: 'error', list: [] }));
  }, []);
  useEffect(() => readAccounts(), [readAccounts]);
  if (accounts.status === 'loading') return null;
  if (accounts.status === 'error') {
    return (
      <span data-testid={testId}>
        <div className="flex flex-col items-start gap-2 p-4" role="alert" data-testid={`${testId}-mailboxes-unreadable`}>
          <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Your mailboxes could not be read</span>
          <button type="button" className={GHOST} onClick={readAccounts} data-testid={`${testId}-mailboxes-retry`}>Try again</button>
        </div>
      </span>
    );
  }
  const account = accounts.list.find((a) => a.can_send !== false) || accounts.list[0] || null;
  const body = draft?.body ?? [
    `Hi ${String(request.person?.name || '').split(/\s+/)[0] || 'there'},`, '',
    `I'd like to introduce you to ${request.requester?.name || 'a teammate'}.`,
    request.context_note ? `\n${request.context_note}` : '', '',
    'I’ll let you two take it from here.',
  ].join('\n');
  const subject = draft?.subject ?? introSubject(request);
  return (
    <span data-testid={testId}>
      <RecordCompose pack={{ person: { name: request.person?.name || 'them', kind: 'introduction' } }} refs={[]} to="" account={account}
        title={WRITE_INTRO} introUid={request.uid} initialSubject={subject} initialBody={body} ask={false}
        onClose={onClose} onSent={onSent} />
    </span>
  );
}
