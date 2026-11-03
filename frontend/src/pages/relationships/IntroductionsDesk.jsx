import React, { useCallback, useEffect, useState } from 'react';
import { relationshipsApi } from '../../lib/api/relationships.js';
import { mailApi } from '../../lib/api/mail.js';
import { reportError } from '../../lib/log';
import RecordCompose from '../email/RecordCompose.jsx';
import {
  DRAFT_FOLLOW_LATER, DRAFT_INTRO_LATER, INBOX_EMPTY, LOG_EMPTY, LOG_UNREAD, NOT_NOW, OUTCOMES, SENDS_NOTHING, STATUS_FILTERS, STATUS_LABEL, WRITE_INTRO,
  dayAfter, followUps, introSubject, isOpenForMe, logRows, personOf,
} from './relationshipsModel';

/**
 * D1357 (#3572, RI4, RI5, RI6) — Network › Introductions, over D4329's
 * lifecycle (`relationshipsApi`):
 *
 *   RI4  Asked of you: each request to the member, with the asker's reason and
 *        context, Accept or Not now (a note the asker reads). Once accepted,
 *        "Write the intro" opens the Email composer from the member's own
 *        mailbox; the send records the introduction as made (D4329). Axal
 *        sends nothing itself. "Draft with Eadwyn" waits for part 8b.
 *   RI6  Follow-ups: the member's own, due first, with Mark done and Snooze.
 *   RI5  The log: every request sent and received, When, Who for, Team,
 *        Status, Outcome (as recorded, else "Not recorded") and Follow-up,
 *        filtered by the member's own teams and by status; "Follow-ups due".
 *        A made request takes an outcome from either side; the asker
 *        withdraws a pending one.
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
const today = () => new Date().toISOString().slice(0, 10);

export default function IntroductionsDesk({ testId = 'introductions' }) {
  const [filter, setFilter] = useState({ team: '', status: '' });
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [teams, setTeams] = useState([]);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [writing, setWriting] = useState(null);

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

  const act = async (uid, call) => {
    setBusy(uid); setNotice(null);
    try { await call(); load(); }
    catch (e) { setNotice({ uid, text: e?.message || 'That could not be saved. Nothing changed.' }); reportError('relationships:intro-step', e); }
    finally { setBusy(null); }
  };

  const data = read.data;
  const inbox = (data?.received || []).filter(isOpenForMe);
  const rows = logRows(data, teams);
  const due = followUps(data);

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby={`${testId}-inbox-title`} data-testid={`${testId}-inbox`}>
        <h2 id={`${testId}-inbox-title`} className={`m-0 text-[16px] font-extrabold ${INK}`}>Asked of you</h2>
        {read.status === 'ok' && !inbox.length ? <p className={`m-0 ${MUTED}`} data-testid={`${testId}-inbox-empty`}>{INBOX_EMPTY}</p> : null}
        {inbox.map((r) => (
          <article key={r.uid} className="flex flex-col gap-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid={`${testId}-ask-${r.uid}`}>
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
                  <button type="button" className={PRIMARY} onClick={() => setWriting(r)} data-testid={`${testId}-write-${r.uid}`}>{WRITE_INTRO}</button>
                  <button type="button" className={GHOST} disabled title="Eadwyn's drafts come with part 8b">{DRAFT_INTRO_LATER}</button>
                </div>
                <span className={MUTED}>{SENDS_NOTHING}</span>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby={`${testId}-follow-title`} data-testid={`${testId}-follow-ups`}>
        <h2 id={`${testId}-follow-title`} className={`m-0 text-[16px] font-extrabold ${INK}`}>Follow-ups</h2>
        {read.status === 'ok' && !due.length ? <p className={`m-0 ${MUTED}`}>No follow-ups set. Set one on an introduction below.</p> : null}
        {due.map((f) => (
          <div key={f.uid} className="flex flex-wrap items-center gap-3" data-testid={`${testId}-follow-${f.uid}`} data-state={f.state}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={`text-[13px] font-bold ${INK}`}>{f.title}</span>
              <span className={MUTED}>{f.line} · {f.when}</span>
            </span>
            <button type="button" className={GHOST} disabled={busy === f.uid} onClick={() => act(f.uid, () => relationshipsApi.introFollowUpDone(f.uid))} data-testid={`${testId}-follow-done-${f.uid}`}>Mark done</button>
            <button type="button" className={QUIET} disabled={busy === f.uid} onClick={() => act(f.uid, () => relationshipsApi.snoozeIntroFollowUp(f.uid, dayAfter(today(), 7)))} data-testid={`${testId}-follow-snooze-${f.uid}`}>Snooze a week</button>
            <button type="button" className={QUIET} disabled title="Eadwyn's drafts come with part 8b">{DRAFT_FOLLOW_LATER}</button>
          </div>
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
                  <tr key={x.uid} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-700" data-testid={`${testId}-row-${x.uid}`}>
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

      {writing ? <IntroCompose request={writing} onClose={() => setWriting(null)} onSent={() => { setWriting(null); load(); }} testId={`${testId}-compose`} /> : null}
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

/** RI4e: the Email composer, from the member's own mailbox, carrying the request's uid so the send records Made. */
function IntroCompose({ request, onClose, onSent, testId }) {
  const [accounts, setAccounts] = useState({ status: 'loading', list: [] });
  useEffect(() => {
    mailApi.accounts().then((a) => setAccounts({ status: 'ok', list: a?.accounts || [] })).catch(() => setAccounts({ status: 'error', list: [] }));
  }, []);
  if (accounts.status === 'loading') return null;
  const account = accounts.list.find((a) => a.can_send !== false) || accounts.list[0] || null;
  const body = [
    `Hi ${String(request.person?.name || '').split(/\s+/)[0] || 'there'},`, '',
    `I'd like to introduce you to ${request.requester?.name || 'a teammate'}.`,
    request.context_note ? `\n${request.context_note}` : '', '',
    'I’ll let you two take it from here.',
  ].join('\n');
  return (
    <span data-testid={testId}>
      <RecordCompose pack={{ person: { name: request.person?.name || 'them', kind: 'introduction' } }} refs={[]} to="" account={account}
        title={WRITE_INTRO} introUid={request.uid} initialSubject={introSubject(request)} initialBody={body} ask={false}
        onClose={onClose} onSent={onSent} />
    </span>
  );
}
