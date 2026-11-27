import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { actionGhost, usePhoneWidth } from '../../../ui';
import { AnswerDialog, GrantLightbox } from './GrantDialogs';
import { requestRow } from './grantsModel';

/**
 * D987 (#2778) — GR5: every studio's program requests from D983's read, the
 * longest waiting first. An open request is answered in GR5d's dialog; an
 * approved grant request whose draft is not granted yet is finished in GR4's
 * lightbox; any other opens the studio's page. The grid's read gives the
 * licence and the program's defaults the lightbox starts from.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const FIELD = 'rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LINKBTN = 'text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const ALERT = 'flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';
const SLA_TONE = { past: 'text-axal-destructive dark:text-red-400', due_soon: 'text-amber-700 dark:text-amber-300', ok: 'text-axal-muted dark:text-gray-400' };
const STATUS_TONE = { open: 'text-amber-700 dark:text-amber-300', answered: 'text-emerald-700 dark:text-emerald-300' };
const STATUSES = [['all', 'All'], ['open', 'Waiting'], ['answered', 'Answered'], ['declined', 'Declined'], ['withdrawn', 'Withdrawn']];

/** Waiting longest first, then the newest answered. */
function order(a, b) {
  if (a.open !== b.open) return a.open ? -1 : 1;
  return a.open ? String(a.created_at).localeCompare(String(b.created_at)) : String(b.created_at).localeCompare(String(a.created_at));
}

export default function RequestsView({ grid, requests, reload }) {
  const phone = usePhoneWidth();
  const [now] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [act, setAct] = useState(null);
  const [done, setDone] = useState('');
  const items = requests.status === 'ready' ? requests.data?.items || [] : [];
  const g = grid.status === 'ready' ? grid.data : null;
  const rows = useMemo(() => [...items].sort(order).map((r) => ({ ...requestRow(r, now), raw: r })), [items, now]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (status === 'all' || r.raw.status === status)
    && (!q || `${r.studio} ${r.ref || ''} ${r.program}`.toLowerCase().includes(q)));
  const licenceOf = (uid) => (g?.licences || []).find((l) => l.uid === uid) || null;
  const defaultsOf = (key) => (g?.programs || []).find((p) => p.program_key === key) || null;
  // Finishing a draft needs the licence and the program's defaults from the grid's read.
  const canFinish = (r) => !!(g && licenceOf(r.licenceUid) && defaultsOf(r.programKey));

  const actionOf = (r) => {
    if (r.action === 'Answer') return <button type="button" className={LINKBTN} onClick={() => setAct({ key: 'answer', row: r })} data-testid={`requests-answer-${r.uid}`}>Answer</button>;
    if (r.action === 'Finish grant' && canFinish(r)) return <button type="button" className={LINKBTN} onClick={() => setAct({ key: 'finish', row: r })} data-testid={`requests-finish-${r.uid}`}>Finish grant</button>;
    return r.licenceUid ? <Link to={`/admin/licences/programs/studio/${encodeURIComponent(r.licenceUid)}`} className={LINKBTN} data-testid={`requests-open-${r.uid}`}>Open</Link> : <span className={SUB}>—</span>;
  };

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Program requests" data-testid="grants-requests-view">
      {done ? <p role="status" className="m-0 rounded-[9px] bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="requests-done">{done}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search studio or program" aria-label="Search studio or program" className={`${FIELD} min-w-[220px] flex-1`} data-testid="requests-search" />
        <span role="group" aria-label="Status" className="inline-flex flex-wrap gap-1">
          {STATUSES.map(([v, w]) => (
            <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} data-testid={`requests-status-${v}`}
              className={`rounded-full border px-2.5 py-1 text-[12px] ${status === v ? 'border-axal-violet bg-axal-lavender font-bold text-axal-violet dark:bg-violet-950/50 dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700'}`}>{w}</button>
          ))}
        </span>
        <span className={SUB}>Sort: waiting longest</span>
      </div>

      {requests.status === 'loading' && !requests.data ? <span className="font-mono text-[13px] text-axal-muted">Reading…</span> : null}
      {requests.status === 'error' ? (
        <div role="alert" className={ALERT} data-testid="requests-unreadable">
          <span>Program requests could not be read. That is not the same as none.</span>
          <button type="button" className={actionGhost} onClick={reload}>Try again</button>
        </div>
      ) : null}
      {requests.status === 'ready' && requests.data?.complete === false ? <p className={`m-0 ${SUB}`} data-testid="requests-partial">Some requests could not be read; the list may be short.</p> : null}
      {requests.status === 'ready' && rows.length === 0 ? <p className="m-0 py-6 text-center text-[14px] font-bold text-axal-ink dark:text-gray-100" data-testid="requests-empty">No requests are waiting.</p> : null}
      {rows.length > 0 && shown.length === 0 ? <p className={`m-0 py-4 text-center ${SUB}`} data-testid="requests-none-match">No request matches. Clear the search or pick another status.</p> : null}

      {shown.length > 0 && !phone ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left text-[13px]" data-testid="requests-table">
            <thead>
              <tr className="border-b border-axal-hairline text-[11px] uppercase tracking-[.06em] text-axal-muted dark:border-gray-700 dark:text-gray-400">
                {['Studio', 'Program', 'Asks for', 'Sent', 'Waiting', 'Their note', 'Status', ''].map((h) => <th key={h} scope="col" className="px-2 py-2 font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.uid} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800" data-testid={`requests-row-${r.uid}`}>
                  <td className="px-2 py-2.5"><b className="text-axal-ink dark:text-gray-100">{r.studio}</b>{r.ref ? <span className={`block ${MONO} text-[11.5px] text-axal-muted`}>{r.ref}</span> : null}</td>
                  <td className="px-2 py-2.5 text-axal-ink dark:text-gray-100">{r.program}{r.raw.lane === 'branch' ? <span className="ml-1.5 rounded-full bg-axal-lavender px-2 py-0.5 text-[11px] font-bold text-axal-violet dark:bg-violet-950/50 dark:text-violet-300" data-testid={`requests-lane-${r.uid}`}>↳ From a branch{r.raw.branch_code ? ` · ${r.raw.branch_code}` : ''}</span> : null}</td>
                  <td className="px-2 py-2.5">{r.asksFor}</td>
                  <td className={`px-2 py-2.5 ${MONO}`}>{r.sent}</td>
                  <td className="px-2 py-2.5"><b className={MONO}>{r.waiting}</b>{r.slaWord ? <span className={`block text-[11.5px] font-bold ${SLA_TONE[r.sla] || ''}`} data-testid={`requests-sla-${r.uid}`}>{r.slaWord}</span> : null}</td>
                  <td className="px-2 py-2.5 text-axal-ink dark:text-gray-100">{r.note}</td>
                  <td className={`px-2 py-2.5 font-bold ${STATUS_TONE[r.raw.status] || 'text-axal-muted'}`}>{r.status}</td>
                  <td className="px-2 py-2.5">{actionOf(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {shown.length > 0 && phone ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="requests-phone-list">
          {shown.map((r) => (
            <li key={r.uid} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`requests-card-${r.uid}`}>
              <span className="flex items-baseline justify-between gap-2"><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{r.studio} · {r.program}</b><span className={`text-[12px] font-bold ${STATUS_TONE[r.raw.status] || 'text-axal-muted'}`}>{r.status}</span></span>
              <span className={SUB}>{r.asksFor} · sent {r.sent}{r.open ? ` · waiting ${r.waiting}` : ''}{r.slaWord ? ` · ${r.slaWord}` : ''}</span>
              {r.note !== '—' ? <span className="text-[13px] text-axal-ink dark:text-gray-100">{r.note}</span> : null}
              <span>{actionOf(r)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length ? <span className={SUB}>{shown.length} of {rows.length} · An approved grant request arrives as a draft: Finish grant sets its terms.</span> : null}

      {act?.key === 'answer' ? (
        <AnswerDialog row={act.row} onClose={() => setAct(null)}
          onDone={(choice) => { setDone(choice === 'decline' ? `Declined. ${act.row.studio} reads your note.` : `Approved. ${act.row.kind === 'program_grant' ? 'Finish the grant with its terms.' : 'Make the change from the studio’s page.'}`); setAct(null); reload(); }} />
      ) : null}
      {act?.key === 'finish' ? (
        <GrantLightbox mode="grant" licence={licenceOf(act.row.licenceUid)} defaults={defaultsOf(act.row.programKey)}
          startTerms={act.row.draft?.terms} request={act.row.raw}
          onClose={() => setAct(null)} onDone={() => { setDone(`${act.row.program} is granted to ${act.row.studio}.`); setAct(null); reload(); }} />
      ) : null}
    </section>
  );
}
