import React, { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { useAuth } from '../../hooks/useAuthSync';
import { WorkerRail } from '../../ui';
import RailFrame from '../../ui/RailFrame';
import { CycleHeader } from '../cycles/CycleOverview';
import { MODULES } from '../cycles/modules';
import RoundCallSheet from './RoundCallSheet';
import { useCallRead, CallReadState } from './roundCallParts';
import { AnswerDialog, CloseDialog, ExtendDialog } from './CallDialogs';
import CallRecipientDrawer, { toldLine } from './CallRecipientDrawer';
import {
  ADMIN_REFUSED, FILTERS, FOOT_LINE, HIDDEN, NOT_RECORDED, OWNER_ONLY, PAGE_SIZE, SORTS, STATE_TONE, callLine,
  funnelOf, funnelSentence, furthestOf, isNamed, lastActivity, money, notTold, originLine, pageLabel, shortDay, stateNote,
  stateOf, stripOf, visibleRows,
} from './raiseCallModel';

/**
 * D686 §5.6 (#1598) — the founder's view of a Call for Capital, inside the
 * Raise shell at `/raise/calls/:uid`: Raise's header and tabs, and the rail.
 * An investor or counsel opening this address is sent to `/round-calls/:uid`,
 * where their own views are; a founder there is sent here.
 *
 * D1225 (#3224, Calls part 4) draws it to the owner's canvas:
 *   · CLS8, an open call: the state chip and line, the strip (Indicated of the
 *     target, recipients, opened, data room, questions waiting, not told), the
 *     funnel, the responses table and the questions, and Extend and Close;
 *   · CLS9, its other states: Draft (Continue draft), Awaiting counsel,
 *     Expired (Open a new call) and Closed, each read-only;
 *   · CLS10, the Extend, Close and Answer dialogs, each in the page;
 *   · CLS11, one recipient in a drawer, with delivery;
 *   · CLS14, a co-founder's view (draft and answer, D1222's `can`) and an
 *     admin's refusal.
 *
 * AN AMOUNT IS INDICATED, NEVER COMMITTED (D653). A matching investor stays
 * nameless until they respond. Nothing is invented: what the read lacks is
 * "Not recorded".
 */

const BTN = 'inline-flex min-h-[36px] items-center rounded-lg border border-axal-hairline bg-white px-3.5 text-sm font-semibold text-axal-ink disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-lg bg-axal-violet px-3.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-violet-600';
const DANGER = 'inline-flex min-h-[36px] items-center rounded-lg border border-red-300 bg-white px-3.5 text-sm font-semibold text-red-700 disabled:opacity-40 dark:border-red-800 dark:bg-gray-900 dark:text-red-300';
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-xs text-axal-muted dark:text-gray-400';
const INPUT = 'rounded-lg border border-axal-hairline bg-white px-3 py-2 text-sm text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const TONES = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  muted: 'border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
const pill = (tone) => `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONES[tone] || TONES.muted}`;

export function StateChip({ state }) {
  return <span className={pill(STATE_TONE[state])} data-testid="call-state">{state}</span>;
}

function Tile({ label, value, sub, testId, children }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1`} data-testid={testId}>
      <span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{label}</span>
      <span className="font-mono text-[22px] font-semibold text-axal-ink dark:text-gray-100">{value == null ? NOT_RECORDED : value}</span>
      {sub ? <span className={MUTED}>{sub}</span> : null}
      {children}
    </div>
  );
}

/** CLS8's strip. A value the read lacks says Not recorded, never 0. */
function Strip({ d, onSeeNotTold }) {
  const s = stripOf(d);
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="call-strip">
      <Tile label="Indicated" value={s.indicated.value} sub={s.indicated.sub} testId="call-tile-indicated">
        {s.indicated.pct != null ? <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-full rounded-full bg-axal-violet dark:bg-violet-500" style={{ width: `${s.indicated.pct}%` }} /></span> : null}
      </Tile>
      <Tile label="Recipients" value={s.recipients.value} sub={s.recipients.sub} testId="call-tile-recipients" />
      <Tile label="Opened" value={s.opened.value} testId="call-tile-opened" />
      <Tile label="Data room" value={s.dataRoom.value} sub={s.dataRoom.sub} testId="call-tile-data-room" />
      <Tile label="Questions waiting" value={s.waiting.value} testId="call-tile-waiting" />
      <Tile label="Not told" value={s.notTold.value} sub={s.notTold.value == null ? 'A draft has told no one.' : null} testId="call-tile-not-told">
        {s.notTold.value > 0 ? <button type="button" className="self-start text-xs font-semibold text-axal-violet underline dark:text-violet-300" onClick={onSeeNotTold} data-testid="call-see-not-told">See who</button> : null}
      </Tile>
    </div>
  );
}

/** CLS8's funnel, with its table view. */
function Funnel({ d }) {
  const [table, setTable] = useState(false);
  const rows = funnelOf(d);
  const max = rows[0][1] || 0;
  const sentence = funnelSentence(rows);
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="call-funnel">
      <div className="flex items-center gap-3">
        <h2 className="m-0 text-base font-bold">From recipients to amounts</h2>
        <span className="flex-1" />
        <button type="button" className="text-xs font-semibold text-axal-violet underline dark:text-violet-300" onClick={() => setTable(!table)} data-testid="call-funnel-toggle">{table ? 'View as chart' : 'View as table'}</button>
      </div>
      {sentence ? <p className={`m-0 ${MUTED}`}>{sentence}</p> : null}
      {table ? (
        <table className="w-full text-sm" data-testid="call-funnel-table"><tbody>
          {rows.map(([label, n]) => <tr key={label} className="border-t border-axal-hairline dark:border-gray-700"><td className="py-1.5">{label}</td><td className="py-1.5 text-right font-mono">{n == null ? NOT_RECORDED : n}</td></tr>)}
        </tbody></table>
      ) : (
        <div role="img" aria-label={rows.map(([l, n]) => `${l} ${n == null ? NOT_RECORDED : n}`).join(', ')} className="flex flex-col gap-2">
          {rows.map(([label, n], i) => (
            <div key={label} className="grid grid-cols-[minmax(0,190px)_minmax(0,1fr)_40px] items-center gap-3">
              <span className="text-xs font-semibold">{i ? `→ ${label}` : label}</span>
              <span className="block h-[18px] overflow-hidden rounded bg-gray-100 dark:bg-gray-800"><span className="block h-full rounded bg-axal-violet dark:bg-violet-500" style={{ width: `${max && n != null ? (n / max) * 100 : 0}%` }} /></span>
              <span className="text-right font-mono text-xs font-bold">{n == null ? '—' : n}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** CLS8's responses table: search, filters, sort and pages; a row opens its recipient. */
function Responses({ d, s, on }) {
  const rows = useMemo(() => visibleRows(d.recipients, { q: s.q, filter: s.filter, sort: s.sort }), [d.recipients, s.q, s.filter, s.sort]);
  const page = rows.slice(s.page * PAGE_SIZE, s.page * PAGE_SIZE + PAGE_SIZE);
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid="call-responses">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="m-0 text-base font-bold">Responses</h2>
        <span className="font-mono text-xs text-axal-muted dark:text-gray-400">{d.recipients.length}</span>
        <span className="flex-1" />
        <select aria-label="Sort responses" className={INPUT} value={s.sort} onChange={(e) => on.sort(e.target.value)} data-testid="call-sort">
          {SORTS.map(([key, label]) => <option key={key} value={key}>{`Sort: ${label}`}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search investors" placeholder="Search investors" className={`${INPUT} w-48`} value={s.q} onChange={(e) => on.q(e.target.value)} data-testid="call-search" />
        <div role="group" aria-label="Filter responses" className="flex flex-wrap gap-1">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={s.filter === key} onClick={() => on.filter(key)} data-testid={`call-filter-${key}`}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${s.filter === key ? 'border-violet-700 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>{label}</button>
          ))}
        </div>
      </div>
      {!d.recipients.length ? <p className={`m-0 ${MUTED}`} data-testid="call-responses-empty">No recipients are recorded yet.</p>
        : !rows.length ? <p className={`m-0 ${MUTED}`} data-testid="call-responses-none">No response matches.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">
                <th className="py-2 pr-2">Investor</th><th className="py-2 pr-2">Furthest response</th><th className="py-2 pr-2">Amount indicated</th><th className="py-2 pr-2">Last activity</th><th className="py-2">On Axal</th>
              </tr></thead>
              <tbody>{page.map((r, i) => {
                const named = isNamed(r);
                const key = r.investor_user_id || `match-${s.page}-${i}`;
                return (
                  <tr key={key} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`call-row-${named ? r.investor_user_id : `hidden-${i}`}`}>
                    <td className="py-2 pr-2">
                      <button type="button" className="text-left" onClick={() => on.open(r)} data-testid={`call-open-${named ? r.investor_user_id : `hidden-${i}`}`}>
                        <span className="block font-semibold text-axal-ink dark:text-gray-100">{named ? r.name : 'Matching investor'}</span>
                        <span className={`block ${MUTED}`}>{originLine(r)}</span>
                      </button>
                    </td>
                    <td className="py-2 pr-2">{furthestOf(r).label}</td>
                    <td className="py-2 pr-2">{named && r.commitment_cents != null
                      ? <span className="flex flex-col"><span className="font-mono font-semibold">{money(r.commitment_cents)}</span><span className={MUTED}>Recorded</span></span>
                      : <span className={MUTED}>{named ? '—' : HIDDEN}</span>}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{named ? (shortDay(lastActivity(r)) || '—') : <span className={MUTED}>Not shown</span>}</td>
                    <td className="py-2">{notTold(r) ? <span className={pill('amber')}>Not told</span> : <span className={MUTED}>{toldLine(r)}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={MUTED}>Every response is also an entry in Capital relationships.</span>
        <span className="flex-1" />
        <span className="font-mono text-xs text-axal-muted dark:text-gray-400" data-testid="call-page-label">{pageLabel(s.page, rows.length)}</span>
        <button type="button" className={BTN} disabled={s.page === 0} onClick={() => on.page(s.page - 1)}>Previous page</button>
        <button type="button" className={BTN} disabled={(s.page + 1) * PAGE_SIZE >= rows.length} onClick={() => on.page(s.page + 1)}>Next page</button>
      </div>
    </section>
  );
}

/** CLS8's questions: waiting first in their order; Answer opens CLS10's dialog. */
function Questions({ d, canAnswer, on }) {
  const qs = d.questions || [];
  const waiting = qs.filter((q) => !q.answer && !q.update_uid).length;
  return (
    <section className={`${CARD} flex flex-col gap-0`} data-testid="call-questions">
      <div className="flex items-baseline gap-2 pb-3">
        <h2 className="m-0 text-base font-bold">Questions</h2>
        {waiting ? <span className={pill('amber')} data-testid="call-questions-waiting">{`${waiting} waiting`}</span> : null}
      </div>
      {qs.length ? qs.map((q) => (
        <article key={q.uid} className="flex flex-col gap-2 border-t border-axal-hairline py-3 dark:border-gray-700" data-testid={`call-question-${q.uid}`}>
          <div className="flex items-center gap-2"><span className="flex-1 text-xs font-semibold">{q.name || NOT_RECORDED}</span><span className="font-mono text-xs text-axal-muted dark:text-gray-400">{shortDay(q.asked_at) || NOT_RECORDED}</span></div>
          <p className="m-0 text-sm font-semibold">“{q.question}”</p>
          {q.answer ? (
            <div className="flex flex-col gap-1 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
              <span className={MUTED}>{q.answered_at ? `Answered ${shortDay(q.answered_at)}` : 'Answered'}</span>
              <span className="text-sm">{q.answer}</span>
            </div>
          ) : q.update_uid ? <Link className="text-sm text-axal-violet underline dark:text-violet-300" to={`/updates/${q.update_uid}`}>Reply on the source update</Link>
            : canAnswer ? <button type="button" className={`${BTN} self-start`} onClick={() => on.answer(q)} data-testid={`call-answer-${q.uid}`}>Answer</button>
              : <span className={MUTED}>Not answered</span>}
        </article>
      )) : <p className={`m-0 border-t border-axal-hairline pt-3 dark:border-gray-700 ${MUTED}`}>No questions yet.</p>}
    </section>
  );
}

export function RaiseCallView({ state: s, on }) {
  const d = s.data; const c = d.call;
  const can = d.can || {};
  const state = stateOf(c);
  const note = stateNote(c, d.progress || {});
  const writable = state === 'Open' && !d.read_only;
  const member = d.relation === 'member';
  const head = (
    <div className="flex flex-col gap-2" data-testid="call-head">
      <Link to="/raise/calls" className="text-sm font-semibold text-axal-violet dark:text-violet-300">‹ Calls</Link>
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{c.name}</h1>
        <StateChip state={state} />
      </div>
      <p className="m-0 text-sm text-axal-muted dark:text-gray-400" data-testid="call-line">{note?.kind === 'awaiting' ? note.line : note?.kind === 'draft' ? note.line : callLine(c)}</p>
    </div>
  );

  if (state === 'Draft') {
    return (
      <div className="flex flex-col gap-4" data-testid="raise-call-page">
        {head}
        {can.draft ? <div className="flex gap-2"><button type="button" className={PRIMARY} onClick={on.continueDraft} data-testid="call-continue-draft">Continue draft</button></div> : null}
        {member ? <p className={`m-0 ${MUTED}`} data-testid="call-owner-only">{OWNER_ONLY}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="raise-call-page">
      {head}
      {note?.kind === 'awaiting' ? <p role="status" className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="call-state-note">{note.note}</p> : null}
      {note && (note.kind === 'expired' || note.kind === 'closed') ? (
        <div className="flex flex-col gap-2" data-testid="call-state-note">
          <p role="status" className="m-0 text-sm">{note.line}</p>
          {note.kind === 'expired' && can.draft ? <button type="button" className={`${BTN} self-start`} onClick={on.newCall} data-testid="call-new">Open a new call</button> : null}
        </div>
      ) : null}
      <Strip d={d} onSeeNotTold={() => on.filter('not_told')} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4"><Funnel d={d} /><Responses d={d} s={s} on={on} /></div>
        <Questions d={d} canAnswer={writable && can.answer} on={on} />
      </div>
      <footer className="flex flex-wrap items-center gap-2.5 border-t border-axal-hairline pt-4 dark:border-gray-800" data-testid="call-foot">
        {member ? <span className={`mr-auto ${MUTED}`} data-testid="call-owner-only">{OWNER_ONLY}</span> : <span className={`mr-auto ${MUTED}`}>{FOOT_LINE}</span>}
        {writable && can.extend ? <button type="button" className={BTN} onClick={on.extend} data-testid="call-extend">Extend the date</button> : null}
        {(writable || state === 'Awaiting counsel') && can.close ? <button type="button" className={DANGER} onClick={on.close} data-testid="call-close">Close the call</button> : null}
      </footer>
    </div>
  );
}

/** CLS14: an admin refused by the Worker. */
export function NoPermission({ admin, message }) {
  return (
    <section className={`${CARD} mt-6 flex max-w-[420px] flex-col gap-3`} data-testid="call-no-permission">
      <span aria-hidden="true" className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><Lock size={16} /></span>
      <h2 className="m-0 text-base font-bold">{admin ? ADMIN_REFUSED : 'You cannot open this call.'}</h2>
      {admin ? <Link to="/admin" className={`${BTN} self-start`}>Go to Studio</Link> : <p className={`m-0 ${MUTED}`}>{message || 'Calls belong to the venture’s founders.'}</p>}
    </section>
  );
}

export default function RaiseCallPage() {
  const { uid } = useParams();
  const user = useAuth()?.user ?? null;
  const read = useCallRead(() => roundCallsApi.page(uid), [uid]);
  const [q, setQ] = useState(''); const [filter, setFilter] = useState('all'); const [page, setPage] = useState(0); const [sort, setSort] = useState('furthest');
  const [dialog, setDialog] = useState(null);
  const [sheet, setSheet] = useState(null);
  const close = () => setDialog(null);
  const done = () => { setDialog(null); read.retry(); };
  const reload = () => { setDialog(null); read.retry(); };
  const on = {
    q: (v) => { setQ(v); setPage(0); }, filter: (v) => { setFilter(v); setPage(0); }, sort: (v) => { setSort(v); setPage(0); }, page: setPage,
    open: (r) => setDialog({ kind: 'recipient', recipient: r }),
    answer: (question) => setDialog({ kind: 'answer', question }),
    extend: () => setDialog({ kind: 'extend' }),
    close: () => setDialog({ kind: 'close' }),
    newCall: () => setSheet({ initialCall: null }),
    continueDraft: () => setSheet({ initialCall: read.data?.call || null }),
  };
  const d = read.data;
  if (d && d.viewer !== 'founder') return <Navigate to={`/round-calls/${encodeURIComponent(uid)}`} replace />;
  const cards = MODULES.raise.map((m) => ({ slug: m.slug, name: m.name }));
  const rail = <WorkerRail workspace="Raise" role="founder" stance="Evidence-led view" coverage={[d ? `Venture #${d.call.project_id} selected` : 'No venture selected']} footer="Traceable surface · no unsupported automated actions" />;
  return (
    <RailFrame rail={rail} data-testid="raise-call-route">
      <main className="space-y-4 p-5 text-axal-ink dark:text-gray-100">
        <CycleHeader cycle="raise" cards={cards} active="capital-relationships" title={d ? `Call for Capital · ${d.call.name}` : 'Call for Capital'}
          search={d ? `?project_id=${d.call.project_id}` : ''} />
        {read.error?.status === 403 ? <NoPermission admin={user?.role === 'admin'} message={read.error.message} />
          : <CallReadState read={read}>{d && <RaiseCallView state={{ data: d, q, filter, sort, page }} on={on} />}</CallReadState>}
        {d && dialog?.kind === 'recipient' ? <CallRecipientDrawer recipient={dialog.recipient} questions={d.questions} projectId={d.call.project_id} onClose={close} /> : null}
        {d && dialog?.kind === 'extend' ? <ExtendDialog call={d.call} onClose={close} onDone={done} onReload={reload}
          extend={(date) => roundCallsApi.manage(uid, { action: 'extend', target_close: date })} /> : null}
        {d && dialog?.kind === 'close' ? <CloseDialog call={d.call} onClose={close} onDone={done} onReload={reload}
          close={() => roundCallsApi.manage(uid, { action: 'close' })} /> : null}
        {d && dialog?.kind === 'answer' ? <AnswerDialog question={dialog.question} onClose={close} onDone={done} onReload={reload}
          answer={(text) => roundCallsApi.answer(uid, dialog.question.uid, text)} /> : null}
        {sheet && d && <RoundCallSheet projectId={d.call.project_id} initialCall={sheet.initialCall} onClose={() => { setSheet(null); read.retry(); }} />}
      </main>
    </RailFrame>
  );
}
