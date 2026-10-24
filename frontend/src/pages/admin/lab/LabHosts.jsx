import React, { useState } from 'react';
import { api } from '../../../lib/api';
import {
  CAPACITIES, HOSTS_CAP, HOSTS_FOOT, HOSTS_NOTE, HOST_NOTE_LABEL, HOST_NOTE_MAX, HOST_REFUSALS, HOST_SORTS, HOST_STATUSES,
  dataOf, filterHosts, hostCounts, hostDialog, hostRow, pageOf, refusalText,
} from './labDesksModel';
import {
  CARD, Chip, Dialog, Field, INPUT, LINK, MONO, Pager, Pill, ReadState, SUB, Select, TD, TH, hasRows, useRead, useWrite,
} from './labParts';

/**
 * D970 (#2755) — Hosts (SL9): who hosts Lab office hours. The status chips
 * carry the Worker's uncapped counts and read that status; search, Applied
 * as and the sort run over the loaded rows (the newest 500 in a status, which
 * the page says when it reaches them). Approve, Decline and Remove each open
 * a dialog with an optional note the host sees (`lab_hosts.ts`, logged with
 * the acting admin). On a phone each host is a card.
 */

const ACTION_WORD = { approve: 'Approve', reject: 'Decline', revoke: 'Remove' };

function HostDialog({ dialog, onClose, onChanged }) {
  const [note, setNote] = useState('');
  const w = useWrite(onChanged, HOST_REFUSALS, refusalText);
  const copy = hostDialog(dialog.decision, dialog.row);
  return (
    <Dialog title={copy.title} onClose={onClose} w={w} action={copy.action} tone={copy.tone} testId={`lab-host-dialog-${dialog.decision}`}
      onAction={() => w.run(() => api.adminDecideLabHost(dialog.row.uid, dialog.decision, note.trim() || undefined))} done={copy.done}>
      <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100" data-testid="lab-host-dialog-body">{copy.body}</p>
      <Field label={HOST_NOTE_LABEL}>
        <textarea value={note} rows={3} maxLength={HOST_NOTE_MAX} disabled={Boolean(w.reply)} onChange={(e) => setNote(e.target.value.slice(0, HOST_NOTE_MAX))}
          className={`${INPUT} py-2 leading-normal`} data-testid="lab-host-dialog-note" />
      </Field>
    </Dialog>
  );
}

function Actions({ row, onOpen }) {
  if (!row.decisions.length) return null;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-1">
      {row.decisions.map((d) => (
        <button key={d} type="button" className={LINK} onClick={() => onOpen({ decision: d, row })} data-testid={`lab-host-${d}-${row.uid}`}>{ACTION_WORD[d]}</button>
      ))}
    </span>
  );
}

export default function LabHosts({ now = Date.now() }) {
  const [status, setStatus] = useState('pending');
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [appliedAs, setAppliedAs] = useState('');
  const [sort, setSort] = useState('waiting');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const reload = () => setTick((t) => t + 1);
  const read = useRead(`hosts:${status}`, tick, () => api.adminLabHosts(status).then((r) => {
    if (!Array.isArray(r?.items)) throw new Error('The host applications did not come back as a list.');
    return r;
  }));
  const counts = hostCounts(read);
  const items = dataOf(read)?.items || [];
  const rows = filterHosts(items.map((a) => hostRow(a, now)), { q, appliedAs, sort });
  const shown = pageOf(rows, page);
  const set = (fn) => (v) => { fn(v); setPage(1); };
  const word = HOST_STATUSES.find((s) => s.key === status).word;

  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-hosts">
      <section className={`${CARD} flex flex-col gap-2.5 px-[18px] py-3.5`}>
        <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{HOSTS_NOTE}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
          {HOST_STATUSES.map((s) => (
            <Chip key={s.key} on={status === s.key} onClick={() => { setStatus(s.key); setPage(1); }} testId={`lab-hosts-chip-${s.key}`}>
              <span aria-hidden="true">{s.glyph}</span>{s.word}
              {counts && counts[s.key] !== null ? <span className="font-mono" data-testid={`lab-hosts-count-${s.key}`}>{counts[s.key].toLocaleString('en-US')}</span> : null}
            </Chip>
          ))}
        </div>
      </section>

      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Hosts">
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder="Search name or company" aria-label="Search name or company" className={`${INPUT} min-w-[14rem] flex-1`} data-testid="lab-hosts-search" />
          <Select label="Applied as" value={appliedAs} onChange={set(setAppliedAs)} testId="lab-hosts-applied-as"
            options={[{ value: '', label: 'Applied as: any' }, ...CAPACITIES.map((c) => ({ value: c.key, label: `Applied as: ${c.word}` }))]} />
          <Select label="Sort" value={sort} onChange={set(setSort)} testId="lab-hosts-sort"
            options={HOST_SORTS.map((s) => ({ value: s.key, label: `Sort: ${s.label}` }))} />
        </div>
        <ReadState read={read} what="The host applications" claim="No host is shown as waiting while they cannot be read." onRetry={reload} testId="lab-hosts-read" />
        {hasRows(read) ? (
          <>
            {items.length >= HOSTS_CAP ? <p className={`m-0 ${SUB}`} data-testid="lab-hosts-cap">{`The newest ${HOSTS_CAP} ${word.toLowerCase()} applications. Search and sort cover only these.`}</p> : null}
            {!rows.length ? (
              <p className={`m-0 ${SUB}`} data-testid="lab-hosts-empty">
                {items.length ? 'No host matches these filters.' : status === 'pending' ? 'No one is waiting for a decision.' : `No ${word.toLowerCase()} applications.`}
              </p>
            ) : (
              <>
                <div className="hidden lg:block">
                  <table className="w-full border-collapse" data-testid="lab-hosts-table">
                    <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                      {['Host', 'Applied as', 'Statement', 'Applied', 'Status', 'Reviewed', ''].map((c, i) => <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>)}
                    </tr></thead>
                    <tbody>
                      {shown.rows.map((r) => (
                        <tr key={r.uid} className="border-b border-axal-hairline last:border-b-0 dark:border-gray-700" data-testid={`lab-host-row-${r.uid}`}>
                          <td className={TD}><span className="block font-bold">{r.name}</span><span className={SUB}>{[r.company, r.email].filter(Boolean).join(' · ')}</span></td>
                          <td className={TD}>{r.appliedAs}</td>
                          <td className={`${TD} max-w-[22rem] text-axal-muted dark:text-gray-400`}>{r.statement || <span className="italic">No statement given</span>}{r.note ? <span className="mt-1 block text-[12px]">{`Note to the host: ${r.note}`}</span> : null}</td>
                          <td className={`${TD} ${MONO}`}>{r.applied}</td>
                          <td className={TD}><Pill tone={r.status.tone} glyph={r.status.glyph}>{r.status.word}</Pill></td>
                          <td className={`${TD} text-[11.5px] ${r.reviewed.muted ? 'text-axal-muted dark:text-gray-400' : ''}`}>{r.reviewed.text}</td>
                          <td className={TD}><Actions row={r} onOpen={setDialog} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden" data-testid="lab-hosts-cards">
                  {shown.rows.map((r) => (
                    <li key={r.uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid={`lab-host-card-${r.uid}`}>
                      <span className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-bold text-axal-ink dark:text-gray-100">{r.name}</span><Pill tone={r.status.tone} glyph={r.status.glyph}>{r.status.word}</Pill></span>
                      <span className={SUB}>{[r.company, r.appliedAs, `applied ${r.applied}`].filter(Boolean).join(' · ')}</span>
                      {r.statement ? <span className="text-[13px] text-axal-muted dark:text-gray-400">{r.statement}</span> : null}
                      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{r.reviewed.text}</span>
                      <Actions row={r} onOpen={setDialog} />
                    </li>
                  ))}
                </ul>
                <Pager shown={shown} onPage={setPage} testId="lab-hosts-pager" />
              </>
            )}
          </>
        ) : null}
        <p className={`m-0 ${SUB}`}>{HOSTS_FOOT}</p>
      </section>
      {dialog ? <HostDialog key={`${dialog.decision}-${dialog.row.uid}`} dialog={dialog} onClose={() => setDialog(null)} onChanged={reload} /> : null}
    </div>
  );
}
