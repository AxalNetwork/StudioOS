import React, { useState } from 'react';
import { adminIncorporationsApi } from '../../../lib/api/adminIncorporations.js';
import { section83bReviewApi } from '../../../lib/api/section83bReview.js';
import { Unrecorded } from '../../../ui';
import {
  DOCS_CAP, FORMATION_NOTE, LAST_REVIEW_FILTERS, ORDERS_CAP, ORDERS_FOOT, ORDER_REFUSALS, ORDER_SORTS, ORDER_STATUSES, REVIEW_FOOT,
  REVIEW_OUTCOMES, REVIEW_REFUSALS, REVIEW_SORTS, canRecordReview, dataOf, etToday, filedOnProblem, filterOrders, filterReviews,
  orderRow, pageOf, refusalText, reviewRow,
} from './labDesksModel';
import {
  CARD, Dialog, EYE, Field, H2, INPUT, LINK, MONO, Pager, Pill, Radios, ReadState, SUB, Select, TD, TH, hasRows, useRead, useWrite,
} from './labParts';

/**
 * D970 (#2755) — Formation (SL10; SL10d's dialogs): the 83(b) operator review
 * and the formation orders, two desks that also serve startups outside the
 * Lab. The "Lab ventures · All startups" switch waits for part 4 (#2751), so
 * both list every startup, as their reads do, and nothing filters by venture
 * in the browser meanwhile.
 *
 * Every write opens a dialog with nothing preselected: assign the operator,
 * record a review (no outcome chosen, no date), mark the packet ready (no
 * document chosen), record the filing date (no date filled). The Worker's
 * refusal is said inside the dialog. Each desk reads alone, so one failed
 * read never blanks the other. On a phone each row is a card.
 */

/* ------------------------------------------------------------------ *
 * 83(b) operator review
 * ------------------------------------------------------------------ */

function AssignDialog({ row, operators, onClose, onChanged }) {
  const [pick, setPick] = useState('');
  const w = useWrite(onChanged, REVIEW_REFUSALS, refusalText);
  const title = `Assign the 83(b) operator · ${row.name}`;
  const next = operators.find((o) => String(o.id) === pick);
  return (
    <Dialog title={title} onClose={onClose} w={w} action={pick === 'none' ? 'Unassign' : 'Assign'} disabled={!pick} testId="lab-83b-assign"
      onAction={() => w.run(() => section83bReviewApi.adminAssign(row.id, pick === 'none' ? null : Number(pick)))}
      done={pick === 'none' ? `${row.name} has no operator now.` : `${next?.name || next?.email || 'The admin'} is ${row.name}’s operator now.`}>
      <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">
        {row.operator ? `${row.operator.name} is the operator now. ` : 'No operator is assigned. '}The operator records reviews of the startup’s 83(b) filing record, and the founder sees who it is.
      </p>
      <Field label="Operator · nothing is preselected">
        <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={Boolean(w.reply)} className={INPUT} data-testid="lab-83b-assign-pick">
          <option value="" disabled>Choose an admin…</option>
          {operators.map((o) => <option key={o.id} value={String(o.id)}>{o.name || o.email}</option>)}
          {row.operator ? <option value="none">Unassign</option> : null}
        </select>
      </Field>
    </Dialog>
  );
}

function ReviewDialog({ row, onClose, onChanged, now }) {
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  const w = useWrite(onChanged, REVIEW_REFUSALS, refusalText);
  const ok = canRecordReview({ busy: w.busy, outcome, operator: row.operator });
  return (
    <Dialog title={`Record a review · ${row.name}`} sub="Nothing is preselected." onClose={onClose} w={w} action="Record" disabled={!ok} testId="lab-83b-review"
      onAction={() => w.run(() => section83bReviewApi.adminReview(row.id, { outcome, note: note.trim() || null, follow_up_date: followUp || null }))}
      done={`The review of ${row.name} is recorded.`}>
      {!row.operator ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="lab-83b-review-no-operator">{REVIEW_REFUSALS.no_operator_assigned}</p> : null}
      <Radios name={`outcome-${row.id}`} value={outcome} onChange={setOutcome} disabled={Boolean(w.reply)} testId="lab-83b-review-outcome"
        options={REVIEW_OUTCOMES.map((o) => ({ value: o.key, label: o.key === 'complete' ? 'Complete: the filing record is complete' : 'Incomplete: something is missing from the record' }))} />
      <Field label="Note · optional">
        <textarea value={note} rows={2} disabled={Boolean(w.reply)} onChange={(e) => setNote(e.target.value)} className={`${INPUT} py-2`} data-testid="lab-83b-review-note" />
      </Field>
      <Field label="Follow-up date · optional">
        <input type="date" value={followUp} min={etToday(now)} disabled={Boolean(w.reply)} onChange={(e) => setFollowUp(e.target.value)} className={INPUT} data-testid="lab-83b-review-date" />
      </Field>
    </Dialog>
  );
}

function ReviewDesk({ now }) {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [operator, setOperator] = useState('');
  const [last, setLast] = useState('');
  const [sort, setSort] = useState('follow');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const reload = () => setTick((t) => t + 1);
  const read = useRead('83b', tick, () => section83bReviewApi.adminList().then((r) => {
    if (!Array.isArray(r?.startups) || !Array.isArray(r?.operators)) throw new Error('The 83(b) review list did not come back as a list.');
    return r;
  }));
  const data = dataOf(read);
  const operators = data?.operators || [];
  const rows = filterReviews((data?.startups || []).map((s) => reviewRow(s, now)), { q, operator, last, sort });
  const shown = pageOf(rows, page);
  const set = (fn) => (v) => { fn(v); setPage(1); };
  const operatorCell = (r) => (
    <span className="flex flex-col items-start gap-0.5">
      {r.operator ? <span>{r.operator.name}</span> : <span className="text-axal-muted dark:text-gray-400">Unassigned</span>}
      <button type="button" className={LINK} onClick={() => setDialog({ kind: 'assign', row: r })} data-testid={`lab-83b-assign-${r.id}`}>{r.operator ? 'Change' : 'Assign'}</button>
    </span>
  );
  const lastCell = (r) => (r.last ? (
    <span className="flex flex-col items-start gap-0.5">
      {r.last.outcome ? <Pill tone={r.last.outcome.tone}>{r.last.outcome.word}</Pill> : <Pill>Another outcome</Pill>}
      <span className={SUB}>{[r.last.day, 'an admin'].filter(Boolean).join(' · ')}</span>
    </span>
  ) : <Unrecorded reason="No review of this startup’s filing record yet." />);
  const followCell = (r) => (r.followUp ? <span className={MONO}>{r.followUp}</span> : <Unrecorded reason={r.followUpReason}>Not set</Unrecorded>);

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="lab-h-83b" data-testid="lab-83b">
      <h2 id="lab-h-83b" className={H2}>83(b) operator review</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder="Search startup" aria-label="Search startup" className={`${INPUT} min-w-[12rem] flex-1`} data-testid="lab-83b-search" />
        <Select label="Operator" value={operator} onChange={set(setOperator)} testId="lab-83b-operator"
          options={[{ value: '', label: 'Operator: any' }, { value: 'unassigned', label: 'Operator: unassigned' }, ...operators.map((o) => ({ value: String(o.id), label: `Operator: ${o.name || o.email}` }))]} />
        <Select label="Last review" value={last} onChange={set(setLast)} testId="lab-83b-last"
          options={[{ value: '', label: 'Last review: any' }, ...LAST_REVIEW_FILTERS.map((f) => ({ value: f.key, label: `Last review: ${f.word}` }))]} />
        <Select label="Sort" value={sort} onChange={set(setSort)} testId="lab-83b-sort" options={REVIEW_SORTS.map((s) => ({ value: s.key, label: `Sort: ${s.label}` }))} />
      </div>
      <ReadState read={read} what="The 83(b) review list" claim="No startup is shown as unassigned while it cannot be read." onRetry={reload} testId="lab-83b-read" />
      {hasRows(read) ? (!rows.length ? (
        <p className={`m-0 ${SUB}`} data-testid="lab-83b-empty">{data.startups.length ? 'No startup matches these filters.' : 'No startup has an 83(b) tracker yet.'}</p>
      ) : (
        <>
          <div className="hidden lg:block">
            <table className="w-full border-collapse" data-testid="lab-83b-table">
              <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                {['Startup', 'Operator', 'Last review', 'Next follow-up', ''].map((c, i) => <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>)}
              </tr></thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={r.id} className="border-b border-axal-hairline last:border-b-0 dark:border-gray-700" data-testid={`lab-83b-row-${r.id}`}>
                    <td className={`${TD} font-bold`}>{r.name}</td>
                    <td className={TD}>{operatorCell(r)}</td>
                    <td className={TD}>{lastCell(r)}</td>
                    <td className={TD}>{followCell(r)}</td>
                    <td className={TD}><button type="button" className={LINK} onClick={() => setDialog({ kind: 'review', row: r })} data-testid={`lab-83b-record-${r.id}`}>Record a review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden">
            {shown.rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid={`lab-83b-card-${r.id}`}>
                <span className="font-bold text-axal-ink dark:text-gray-100">{r.name}</span>
                <span className="grid grid-cols-2 gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                  <span><span className={`block ${EYE}`}>Operator</span>{operatorCell(r)}</span>
                  <span><span className={`block ${EYE}`}>Next follow-up</span>{followCell(r)}</span>
                </span>
                <span><span className={`block ${EYE}`}>Last review</span>{lastCell(r)}</span>
                <button type="button" className={`${LINK} self-start`} onClick={() => setDialog({ kind: 'review', row: r })}>Record a review</button>
              </li>
            ))}
          </ul>
          <Pager shown={shown} onPage={setPage} testId="lab-83b-pager" />
        </>
      )) : null}
      <p className={`m-0 ${SUB}`}>{REVIEW_FOOT}</p>
      {dialog?.kind === 'assign' ? <AssignDialog key={`a-${dialog.row.id}`} row={dialog.row} operators={operators} onClose={() => setDialog(null)} onChanged={reload} /> : null}
      {dialog?.kind === 'review' ? <ReviewDialog key={`r-${dialog.row.id}`} row={dialog.row} now={now} onClose={() => setDialog(null)} onChanged={reload} /> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Formation orders
 * ------------------------------------------------------------------ */

function PacketDialog({ row, onClose, onChanged }) {
  const [doc, setDoc] = useState('');
  const w = useWrite(onChanged, ORDER_REFUSALS, refusalText);
  const chosen = row.documents.find((d) => String(d.id) === doc);
  return (
    <Dialog title={`Mark the packet ready · ${row.company}`} sub="Choose one of the company’s documents. None is preselected." onClose={onClose} w={w} action="Mark ready"
      disabled={!doc} testId="lab-order-packet" onAction={() => w.run(() => adminIncorporationsApi.packetReady(row.id, Number(doc)))}
      done={`${chosen?.title || 'The document'} is ${row.company}’s packet. The order now waits for its filing date.`}>
      {row.documents.length ? (
        <>
          <Radios name={`packet-${row.id}`} value={doc} onChange={setDoc} disabled={Boolean(w.reply)} testId="lab-order-packet-doc"
            options={row.documents.map((d) => ({ value: String(d.id), label: d.title }))} />
          {row.docsCapped ? <p className={`m-0 ${SUB}`}>{`The newest ${DOCS_CAP} of the project’s documents.`}</p> : null}
        </>
      ) : <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="lab-order-packet-none">The project has no documents to choose from. Generate the formation documents first.</p>}
    </Dialog>
  );
}

function FiledDialog({ row, onClose, onChanged, now }) {
  const [filedOn, setFiledOn] = useState('');
  const w = useWrite(onChanged, ORDER_REFUSALS, refusalText);
  const problem = filedOn ? filedOnProblem(filedOn, { paidDay: row.paidDay, now }) : null;
  return (
    <Dialog title={`Record the filing date · ${row.company}`} sub="No date is prefilled." onClose={onClose} w={w} action="Record" disabled={!filedOn || Boolean(problem)}
      testId="lab-order-filed" onAction={() => w.run(() => adminIncorporationsApi.filed(row.id, filedOn))} done={`${row.company}’s filing is recorded. This records what happened; nothing was filed from here.`}>
      <Field label="Filed on">
        <input type="date" value={filedOn} max={etToday(now)} min={row.paidDay || undefined} disabled={Boolean(w.reply)} onChange={(e) => setFiledOn(e.target.value)} className={INPUT} data-testid="lab-order-filed-date" />
      </Field>
      {problem ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="lab-order-filed-problem">{problem}</p> : null}
    </Dialog>
  );
}

function OrdersDesk({ now }) {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [sort, setSort] = useState('paid');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const reload = () => setTick((t) => t + 1);
  const read = useRead('orders', tick, () => adminIncorporationsApi.list().then((r) => {
    if (!Array.isArray(r?.orders)) throw new Error('The formation orders did not come back as a list.');
    return r;
  }));
  const orders = dataOf(read)?.orders || [];
  const all = orders.map((o) => orderRow(o, now));
  const places = [...new Map(all.filter((r) => r.jurisdictionKey).map((r) => [r.jurisdictionKey, r.jurisdiction])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const rows = filterOrders(all, { q, status, jurisdiction, sort });
  const shown = pageOf(rows, page);
  const set = (fn) => (v) => { fn(v); setPage(1); };
  const step = (r) => {
    if (r.step === 'packet') return <button type="button" className={LINK} onClick={() => setDialog({ kind: 'packet', row: r })} data-testid={`lab-order-packet-${r.id}`}>Mark packet ready</button>;
    if (r.step === 'filed') return <button type="button" className={LINK} onClick={() => setDialog({ kind: 'filed', row: r })} data-testid={`lab-order-filed-${r.id}`}>Record filing date</button>;
    return <span className="text-axal-muted dark:text-gray-400">No step left</span>;
  };
  const packet = (r) => (r.packet ? <span>{r.packet.title}</span> : <Unrecorded reason="No packet has been attached yet.">None yet</Unrecorded>);
  const filed = (r) => (r.filedOn ? <span className={MONO}>{r.filedOn}</span> : <Unrecorded reason="No filing has been recorded yet.">Not filed</Unrecorded>);

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="lab-h-orders" data-testid="lab-orders">
      <h2 id="lab-h-orders" className={H2}>Formation orders</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder="Search company" aria-label="Search company" className={`${INPUT} min-w-[12rem] flex-1`} data-testid="lab-orders-search" />
        <Select label="Status" value={status} onChange={set(setStatus)} testId="lab-orders-status"
          options={[{ value: '', label: 'Status: any' }, ...ORDER_STATUSES.map((s) => ({ value: s.key, label: `Status: ${s.word}` }))]} />
        <Select label="Jurisdiction" value={jurisdiction} onChange={set(setJurisdiction)} testId="lab-orders-jurisdiction"
          options={[{ value: '', label: 'Jurisdiction: any' }, ...places.map(([k, w]) => ({ value: k, label: `Jurisdiction: ${w}` }))]} />
        <Select label="Sort" value={sort} onChange={set(setSort)} testId="lab-orders-sort" options={ORDER_SORTS.map((s) => ({ value: s.key, label: `Sort: ${s.label}` }))} />
      </div>
      <ReadState read={read} what="The formation orders" claim="No order is shown as waiting while they cannot be read." onRetry={reload} testId="lab-orders-read" />
      {hasRows(read) ? (
        <>
          {orders.length >= ORDERS_CAP ? <p className={`m-0 ${SUB}`} data-testid="lab-orders-cap">{`The newest ${ORDERS_CAP} paid orders. Search and filters cover only these.`}</p> : null}
          {!rows.length ? (
            <p className={`m-0 ${SUB}`} data-testid="lab-orders-empty">{orders.length ? 'No order matches these filters.' : 'No formation order has been paid yet.'}</p>
          ) : (
            <>
              <div className="hidden lg:block">
                <table className="w-full border-collapse" data-testid="lab-orders-table">
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                    {['Company', 'Jurisdiction', 'Status', 'Paid', 'Packet', 'Filed on', 'Next step'].map((c) => <th key={c} scope="col" className={TH}>{c}</th>)}
                  </tr></thead>
                  <tbody>
                    {shown.rows.map((r) => (
                      <tr key={r.id} className="border-b border-axal-hairline last:border-b-0 dark:border-gray-700" data-testid={`lab-order-row-${r.id}`}>
                        <td className={TD}><span className="block font-bold">{r.company}</span>{r.project ? <span className={SUB}>{r.project}</span> : null}</td>
                        <td className={TD}>{r.jurisdiction}</td>
                        <td className={TD}><Pill tone={r.status.tone}>{r.status.word}</Pill></td>
                        <td className={`${TD} ${MONO}`}>{r.paid}</td>
                        <td className={TD}>{packet(r)}</td>
                        <td className={TD}>{filed(r)}</td>
                        <td className={TD}>{step(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden">
                {shown.rows.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`lab-order-card-${r.id}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-bold">{r.company}</span><Pill tone={r.status.tone}>{r.status.word}</Pill></span>
                    <span className={SUB}>{`${r.jurisdiction} · paid ${r.paid}`}</span>
                    <span>Packet: {packet(r)}</span>
                    <span>Filed on: {filed(r)}</span>
                    {step(r)}
                  </li>
                ))}
              </ul>
              <Pager shown={shown} onPage={setPage} testId="lab-orders-pager" />
            </>
          )}
        </>
      ) : null}
      <p className={`m-0 ${SUB}`}>{ORDERS_FOOT}</p>
      {dialog?.kind === 'packet' ? <PacketDialog key={`p-${dialog.row.id}`} row={dialog.row} onClose={() => setDialog(null)} onChanged={reload} /> : null}
      {dialog?.kind === 'filed' ? <FiledDialog key={`f-${dialog.row.id}`} row={dialog.row} now={now} onClose={() => setDialog(null)} onChanged={reload} /> : null}
    </section>
  );
}

export default function LabFormation({ now = Date.now() }) {
  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-formation">
      <p className={`m-0 rounded-[12px] border border-axal-hairline bg-white px-[18px] py-3 text-[13px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`} data-testid="lab-formation-note">
        {`${FORMATION_NOTE} Showing Lab ventures only waits for the venture filter (part 4).`}
      </p>
      <ReviewDesk now={now} />
      <OrdersDesk now={now} />
    </div>
  );
}
