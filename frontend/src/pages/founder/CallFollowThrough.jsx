// D6863 (#6863, canvas D6053) — following through on a call, below the call's
// own page (`RaiseCallPage`): who has not acted and Remind (RAC16, RAC17), the
// export and its dated log (RAC18, RAC19), Start a new call from a closed one
// (RAC20, RAC21), and each response's line with Record a commitment (RAC22,
// RAC23), with the states of RAC24, the phone cards and sticky bar of RAC25 to
// RAC27 and the dark tokens of RAC28.
//
// Remind and Export are the owner's (Q1); a co-founder sees them off with the
// reason and can record a commitment and start a new call. With calls switched
// off none of it is drawn (RAC27). Every count is the Worker's; a failed read
// says Unavailable, never zero. Eadwyn proposes nothing here yet.
//
// D7513 (#7513, RAC22C): a recorded commitment opens Capital relationships ›
// Commitments on the moved line (`?recorded=<prospect>`), not its Overview.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { roundCallFollowThroughApi } from '../../lib/api/roundCallFollowThrough';
import { Unreadable } from '../../ui/Honesty.jsx';
import { useCallRead } from './roundCallParts';
import { longDay, shortDay } from './raiseCallModel';
import {
  DEFAULT_FILTER, FT_FILTERS, INDICATED_HEADER, NOT_RECORDED, OWNER_ONLY_FT, blockGlyph, blockLine, chipCount, commitmentsHref, exportRow, lastRemindedLabel,
  lineConflict, lineLabel, nothingToRemind, originLabel, recipientLabel, remindResult, selectable, startNewState, toggleFilter, usd, visibleRecipients,
} from './callFollowThroughModel';
import { ExportSheet, NewCallSheet, RecordSheet, RemindSheet } from './CallFollowThroughSheets';

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3.5 text-sm font-semibold text-axal-ink disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 md:min-h-[36px]';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-axal-violet px-3.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-violet-600 md:min-h-[36px]';
const MUTED = 'text-xs text-axal-muted dark:text-gray-400';
const TH = 'py-2 pr-2 text-left text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const TONES = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  partial: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  draft: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  muted: 'border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
const pill = (tone) => `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONES[tone] || TONES.muted}`;
const day = (v) => shortDay(v) || '—';
const todayIso = () => new Date().toISOString().slice(0, 10);

/** RAC24's loading: the panel's own shape, its primaries off. */
function Skeleton() {
  return (
    <section className={`${CARD} flex flex-col gap-3`} role="status" aria-label="Loading the follow-through" data-testid="ft-loading">
      {[40, 80, 65].map((w) => <span key={w} className="block h-3 rounded bg-gray-100 dark:bg-gray-800" style={{ width: `${w}%` }} />)}
    </section>
  );
}

function Check({ r, checked, onChange }) {
  const why = blockLine(r);
  const id = `ft-why-${r.recipient_id}`;
  return (
    <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center md:min-h-0 md:min-w-0">
      <input type="checkbox" className="h-4 w-4" checked={checked} disabled={!selectable(r)} onChange={onChange}
        aria-label={`Select ${recipientLabel(r)}`} aria-describedby={why ? id : undefined} data-testid={`ft-check-${r.recipient_id}`} />
    </label>
  );
}
function Why({ r }) {
  const why = blockLine(r);
  return why ? <span id={`ft-why-${r.recipient_id}`} className={`block ${MUTED}`} data-testid={`ft-why-${r.recipient_id}`}><span aria-hidden="true">{blockGlyph(r)} </span>{why}</span> : null;
}

/** RAC16, RAC17, RAC25a: the chips, the rows with their checkboxes and Last reminded, and Remind (N). */
function RemindSection({ d, owner, onOpen, result }) {
  const [active, setActive] = useState([...DEFAULT_FILTER]);
  const [selected, setSelected] = useState([]);
  const rows = useMemo(() => visibleRecipients(d, active).filter((r) => r.group !== 'responded'), [d, active]);
  const remindOn = owner && d.remind.on;
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const res = remindResult(result);
  const since = shortDay(d.call.sent_at);
  const button = (cls) => (
    <button type="button" className={cls} disabled={!remindOn || !selected.length} onClick={() => onOpen(selected, () => setSelected([]))}
      aria-describedby={!owner ? 'ft-export-off' : !remindOn ? 'ft-remind-off' : undefined} data-testid="ft-remind">{`Remind (${selected.length})`}</button>
  );
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid="ft-remind-section">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="m-0 text-base font-bold">Who has not acted</h2>
        <span className={MUTED}>{`${since ? `since ${since} · ` : ''}out of ${d.counts.recipients} recipients`}</span>
        <span className="flex-1" />
        <span className="hidden md:inline">{button(PRIMARY)}</span>
      </div>
      {owner && !d.remind.on ? <p className={`m-0 ${MUTED}`} id="ft-remind-off" data-testid="ft-remind-off">{d.remind.sentence}</p> : null}
      {res ? (
        <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${TONES[res.tone]}`} data-testid="ft-remind-result">
          <p className="m-0 font-semibold"><span aria-hidden="true">✓ </span>{res.head}</p>
          {res.rest.map((t) => <p key={t} className="m-0">{t}</p>)}
          {!res.rest.length ? <p className="m-0">Nothing else was sent.</p> : null}
        </div>
      ) : null}
      <div role="group" aria-label="Filter recipients" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="ft-chips">
        {FT_FILTERS.map(([key, label]) => {
          const n = chipCount(d, key);
          const on = active.includes(key);
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => setActive((a) => toggleFilter(a, key))} data-testid={`ft-chip-${key}`}
              className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-semibold md:min-h-[32px] ${on ? 'border-violet-700 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>
              {`${label} ${n == null ? NOT_RECORDED : n}`}
            </button>
          );
        })}
      </div>
      {nothingToRemind(d) ? (
        <p role="status" className="m-0 text-sm" data-testid="ft-nothing">{`0 · Everyone you asked has answered. Nothing to remind. ${d.counts.responded} of ${d.counts.recipients} recipients responded.`}</p>
      ) : !rows.length ? <p className={`m-0 ${MUTED}`} data-testid="ft-none">No recipient matches these filters.</p> : (
        <>
          <div className="hidden md:block">
            <table className="w-full border-collapse text-sm" data-testid="ft-table">
              <thead><tr><th className={TH}>Select</th><th className={TH}>Recipient</th><th className={TH}>Delivery</th><th className={TH}>Opened</th><th className={TH}>Data room</th><th className={TH}>Last reminded</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.recipient_id} className={`border-t border-axal-hairline align-top dark:border-gray-700 ${selectable(r) ? '' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`ft-row-${r.recipient_id}`}>
                  <td className="py-2 pr-2"><Check r={r} checked={selected.includes(r.recipient_id)} onChange={() => toggle(r.recipient_id)} /></td>
                  <td className="py-2 pr-2"><span className="block font-semibold text-axal-ink dark:text-gray-100">{recipientLabel(r)}</span><span className={`block ${MUTED}`}>{originLabel(r)}</span><Why r={r} /></td>
                  <td className="py-2 pr-2">{r.delivery_state === 'not_delivered' ? <span className={pill('partial')}>Not delivered</span> : r.delivery_state === 'notified' ? <span className={pill('ok')}>Told on Axal</span> : <span className={MUTED}>{NOT_RECORDED}</span>}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{r.opened_at ? day(r.opened_at) : <span className={MUTED}>Not opened</span>}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{day(r.data_room_requested_at)}</td>
                  <td className="py-2 font-mono text-xs" data-testid={`ft-last-${r.recipient_id}`}>{lastRemindedLabel(r, d.remind.limit)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden" data-testid="ft-cards">
            {rows.map((r) => (
              <li key={r.recipient_id} className="flex items-start gap-2 rounded-lg border border-axal-hairline p-2 dark:border-gray-700">
                <Check r={r} checked={selected.includes(r.recipient_id)} onChange={() => toggle(r.recipient_id)} />
                <span className="min-w-0 flex-1 text-sm">
                  <b className="block">{recipientLabel(r)}</b>
                  <span className={`block ${MUTED}`}>{`${r.opened_at ? `Opened ${day(r.opened_at)} · not answered` : 'Not opened'} · ${r.last_reminded_at ? `reminded ${day(r.last_reminded_at)}` : 'never reminded'}`}</span>
                  <Why r={r} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={`m-0 ${MUTED}`}>Matching investors stay “Matching investor” until they respond, here and in the reminder.</p>
      {remindOn ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950 md:hidden" data-testid="ft-sticky">
          <span className="flex-1 text-sm font-semibold">{`${selected.length} selected`}</span>
          {button(`${PRIMARY} min-h-[48px]`)}
        </div>
      ) : null}
    </section>
  );
}

/** RAC22, RAC23: each named response, its indicated amount and its pipeline line, with Record a commitment. */
function Responses({ d, onRecord }) {
  const rows = (d.recipients || []).filter((r) => r.named && r.responded_at);
  const unnamed = (d.recipients || []).filter((r) => !r.named).length;
  if (!rows.length) return null;
  const action = (r) => {
    const c = lineConflict(r);
    if (c.kind === 'no_line') return <Link className="text-xs font-semibold text-axal-violet underline dark:text-violet-300" to={`/raise/capital-relationships?project_id=${d.call.project_id}`}>Add to Capital relationships</Link>;
    return <button type="button" className={BTN} disabled={!d.can.record || c.off} onClick={() => onRecord(r)} aria-label={`Record a commitment for ${recipientLabel(r)}`} data-testid={`ft-record-${r.recipient_id}`}>Record a commitment</button>;
  };
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid="ft-responses">
      <div className="flex flex-wrap items-baseline gap-2"><h2 className="m-0 text-base font-bold">From response to commitment</h2><span className={MUTED}>Only what you record as Signed or Wired counts.</span></div>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead><tr><th className={TH}>Responder</th><th className={TH}>Opened</th><th className={TH}>Data room</th><th className={TH}>Responded</th><th className={TH}>{INDICATED_HEADER}</th><th className={TH}>In Capital relationships</th><th className={TH}><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{rows.map((r) => {
            const l = lineLabel(r);
            return (
              <tr key={r.recipient_id} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`ft-response-${r.recipient_id}`}>
                <td className="py-2 pr-2 font-semibold">{r.name}</td>
                <td className="py-2 pr-2 font-mono text-xs">{day(r.opened_at)}</td>
                <td className="py-2 pr-2 font-mono text-xs">{day(r.data_room_requested_at)}</td>
                <td className="py-2 pr-2 font-mono text-xs">{day(r.responded_at)}</td>
                <td className="py-2 pr-2 font-mono">{r.commitment_cents == null ? <span className={MUTED}>— {NOT_RECORDED}</span> : usd(r.commitment_cents)}</td>
                <td className="py-2 pr-2"><span className={pill(l.tone)}>{l.text}</span></td>
                <td className="py-2">{action(r)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden">
        {rows.map((r) => {
          const l = lineLabel(r);
          return (
            <li key={r.recipient_id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 text-sm dark:border-gray-700">
              <b>{r.name}</b>
              <span className={MUTED}>{`Indicated ${r.commitment_cents == null ? NOT_RECORDED : usd(r.commitment_cents)}, not counted · responded ${day(r.responded_at)}`}</span>
              <span className={pill(l.tone)}>{l.text}</span>
              <span>{action(r)}</span>
            </li>
          );
        })}
      </ul>
      {unnamed ? <p className={`m-0 ${MUTED}`}>{`${unnamed} matching investor${unnamed === 1 ? '' : 's'} never responded and ${unnamed === 1 ? 'is' : 'are'} not named.`}</p> : null}
    </section>
  );
}

/** RAC18B: the dated export rows. No file is kept, so a row is a record, not a download. */
function ExportLog({ d }) {
  if (!d.exports?.length) return null;
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="ft-exports">
      <div className="flex items-baseline gap-2"><h2 className="m-0 text-base font-bold">Exports</h2><span className={MUTED}>Logged on this call</span></div>
      <ul className="m-0 flex list-none flex-col p-0">
        {d.exports.map((e) => {
          const row = exportRow(e, d.call.name);
          return (
            <li key={e.uid} className="grid gap-1 border-t border-axal-hairline py-2 text-sm dark:border-gray-700 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-center md:gap-3" data-testid={`ft-export-${e.uid}`}>
              <span className="font-semibold">{row.file}</span><span className={MUTED}>{row.format}</span><span className={MUTED}>{row.by}</span>
              <span className="font-mono text-xs">{row.when}</span><span className={pill(row.marked.tone)}>{row.marked.text}</span>
            </li>
          );
        })}
      </ul>
      <p className={`m-0 ${MUTED}`}>The file itself is not kept. Export again for a fresh copy; each export adds a row.</p>
    </section>
  );
}

export function FollowThroughView({ d, result, on }) {
  const owner = d.relation === 'owner';
  const start = startNewState(d);
  const exportOff = !d.can.export;
  return (
    <div className="flex flex-col gap-4 pb-20 md:pb-0" data-testid="ft-panel">
      <div className="flex flex-wrap items-center gap-2" data-testid="ft-actions">
        {d.source ? <span className={`mr-auto ${MUTED}`} data-testid="ft-started-from">{`Started from ${d.source.name}${d.source.closed_at ? `, closed ${longDay(d.source.closed_at)}` : ''}`}</span> : <span className="mr-auto" />}
        {d.call.state !== 'draft' ? (
          <button type="button" className={BTN} disabled={exportOff} onClick={on.export} aria-describedby={exportOff ? 'ft-export-off' : undefined} data-testid="ft-export">Export responses</button>
        ) : null}
        {start.show ? (
          <button type="button" className={PRIMARY} disabled={!start.on} onClick={on.startNew} aria-describedby={start.on ? undefined : 'ft-start-off'} data-testid="ft-start-new">Start a new call from this</button>
        ) : null}
      </div>
      {!owner && d.call.state !== 'draft' ? <p id="ft-export-off" className={`m-0 ${MUTED}`} data-testid="ft-owner-only"><span aria-hidden="true">⦸ </span>{OWNER_ONLY_FT}</p> : null}
      {start.show && !start.on ? <p id="ft-start-off" className={`m-0 ${MUTED}`} data-testid="ft-start-off">{`Start a new call is off: ${start.reason}`}</p> : null}
      {d.call.state === 'sent' ? <RemindSection d={d} owner={owner} result={result} onOpen={on.remind} /> : null}
      <Responses d={d} onRecord={on.record} />
      <ExportLog d={d} />
    </div>
  );
}

/** The follow-through below a founder's call. `onOpenDraft` opens the new-call sheet on a draft just made. */
export default function CallFollowThrough({ uid, call, onOpenDraft }) {
  const read = useCallRead(() => roundCallFollowThroughApi.read(uid), [uid]);
  const [sheet, setSheet] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const d = read.data;
  if (read.loading) return <Skeleton />;
  if (read.error) {
    const { code, status } = read.error;
    // RAC27: switched off, nothing is drawn; a refusal belongs to the call page above.
    if (code === 'round_calls_disabled' || status === 403 || status === 404) return null;
    return <Unreadable what="This call’s follow-through" claim="Remind, Export and Start a new call are off until it can be read. Nothing was sent." onRetry={read.retry} size="block" />;
  }
  const close = () => setSheet(null);
  const on = {
    remind: (ids, clear) => setSheet({ kind: 'remind', ids, clear }),
    export: () => setSheet({ kind: 'export' }),
    startNew: () => setSheet({ kind: 'new' }),
    record: (r) => { setSaved(null); setSheet({ kind: 'record', r }); },
  };
  const label = sheet?.r ? (sheet.r.name || 'Matching investor') : '';
  return (
    <>
      {saved ? (
        <p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" data-testid="ft-recorded">
          <span aria-hidden="true">✓ </span>{`Recorded as ${saved.status === 'wired' ? 'Wired' : 'Signed'} · ${usd(saved.amount_cents)} · ${saved.name}. `}
          <Link className="font-semibold underline" to={commitmentsHref(d.call.project_id, saved.prospect_id)} data-testid="ft-recorded-open">Open in Capital relationships →</Link>
        </p>
      ) : null}
      <FollowThroughView d={d} result={result} on={on} />
      {sheet?.kind === 'remind' ? <RemindSheet d={d} venture={d.venture?.name} selected={sheet.ids} onClose={close}
        onRemind={async (ids) => { const res = await roundCallFollowThroughApi.remind(uid, ids); setResult(res); sheet.clear(); close(); read.retry(); }} /> : null}
      {sheet?.kind === 'export' ? <ExportSheet d={d} onClose={close}
        onExport={async (format, scope) => { await (format === 'pdf' ? roundCallFollowThroughApi.exportPdf(uid, scope) : roundCallFollowThroughApi.exportCsv(uid, scope)); close(); read.retry(); }} /> : null}
      {sheet?.kind === 'new' ? <NewCallSheet source={call} today={todayIso()} onClose={close}
        onStart={async (body) => { const made = await roundCallFollowThroughApi.startFromClosed(uid, body); close(); onOpenDraft?.(made.call); }} /> : null}
      {sheet?.kind === 'record' ? <RecordSheet r={sheet.r} callName={d.call.name} label={label} onClose={close}
        onRecord={async (b) => { const out = await roundCallFollowThroughApi.recordCommitment(uid, b); setSaved({ ...out.recorded, name: label }); close(); read.retry(); }} /> : null}
    </>
  );
}
