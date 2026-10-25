import React, { useCallback, useEffect, useState } from 'react';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { cyclesApi, cyclesWrite } from '../../../lib/api/cycles';
import { Lightbox, Unreadable, actionGhost, actionPrimary } from '../../../ui';
import { useWrite } from './CapTableDialog';
import { MERCURY_ID, closeView, mercuryView, proposalView, toBps } from './historyModel';

/**
 * D1025 (#2862, CT11a–b) — one proposal, at `/raise/cap-table/proposal/<id>`,
 * in its own variant. Nothing lands until the owner accepts, and each Accept
 * says in one line what it records and who sees it:
 *
 *   - `mercury-<n>`: a SAFE request from the owner's Mercury (D840). Basis is
 *     preset post-money; Mercury sends no discount, so it reads "Not recorded"
 *     until the owner enters the SAFE's own. Accept is D840's.
 *   - a proposal from a close (`origin: 'close'`, D1021): the close's investors
 *     together, signed or "Not signed yet". "Record [n] issuances" accepts the
 *     signed ones; a row not signed waits. The same proposal as the Closing
 *     room's: accepted once, here or there.
 *   - any other proposal (a co-founder's, an import's): its line, Accept or
 *     Dismiss.
 *
 * Eadwyn's draft (CT11c) is drawn by `DraftDrawer`, from Record an issuance.
 */

const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const INPUT = 'w-full rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const PILL = 'rounded-full border px-2 py-0.5 text-[11px] font-bold';
const GOOD = 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300';
const AMBER = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';

/** One read, answering alone. */
function useRead(load, key) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (key == null) return undefined;
    let live = true;
    setState({ status: 'loading', data: null });
    load().then((data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { if (live) setState({ status: e?.status === 403 || e?.status === 404 ? 'refused' : 'error', data: null, error: e }); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  return { ...state, retry: () => setN((x) => x + 1) };
}

function Facts({ rows, testId }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1.5 text-[13px]" data-testid={testId}>
      {rows.map(([k, v]) => (
        <React.Fragment key={k}><dt className={MUTED}>{k}</dt><dd className={`m-0 font-semibold ${INK}`}>{v}</dd></React.Fragment>
      ))}
    </dl>
  );
}

function Shell({ eyebrow, title, onClose, write, confirm, buttons, children, testId }) {
  return (
    <Lightbox label={title} eyebrow={eyebrow} title={title} width={600} onClose={() => !write?.busy && onClose()} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          {confirm ? <p className={`m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] font-semibold ${INK} dark:border-gray-700 dark:bg-gray-800`} data-testid={`${testId}-confirm`}>{confirm}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">{buttons}</div>
          {write?.refusal ? <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-refusal`}>{write.refusal}</p> : null}
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">{children}</div>
    </Lightbox>
  );
}

const refusalOf = (e) => {
  const missing = Array.isArray(e?.data?.missing) && e.data.missing.length ? ` It still needs: ${e.data.missing.join(', ')}.` : '';
  return `${e?.message || 'That did not go through. Nothing changed.'}${missing}`;
};

/** CT11a: a SAFE request from Mercury. */
function MercuryProposal({ projectId, id, role, onClose, onDone }) {
  const mod = useRead(() => cyclesApi.module('raise', projectId, 'cap-table'), `${projectId}:mercury`);
  const [discount, setDiscount] = useState('');
  const write = useWrite(onDone);
  const p = mod.status === 'ready' ? (mod.data?.parts?.mercury?.proposals || []).find((x) => Number(x.id) === id && x.kind !== 'fund_mapping' && 'investor_name' in x) : null;
  const code = mod.data?.parts?.mercury?.currency || 'USD';
  const v = p ? mercuryView(p, code) : null;
  const owner = role === 'owner';
  const accept = () => {
    const bps = toBps(discount);
    if (Number.isNaN(bps)) { write.setRefusal('The discount is a percent, such as 20.'); return; }
    write.run(() => cyclesWrite.raise.acceptMercuryProposal(projectId, id, bps != null ? { discount_bps: bps } : {}).catch((e) => { throw new Error(refusalOf(e)); }));
  };
  const dismiss = () => write.run(() => cyclesWrite.raise.dismissMercuryProposal(projectId, id));
  let body;
  if (mod.status === 'loading') body = <p className={MUTED} aria-busy="true">Reading…</p>;
  else if (mod.status !== 'ready') body = <Unreadable what="Your Mercury SAFE requests" claim="This is not a claim that there are none." onRetry={mod.retry} />;
  else if (!mod.data?.parts?.mercury) body = <p className={INK} data-testid="captable-proposal-mercury-owner">Mercury’s SAFE requests come from the owner’s own Mercury, and only the owner sees them.</p>;
  else if (!p) body = <p className={INK} data-testid="captable-proposal-gone">This request is no longer waiting: it was accepted or dismissed.</p>;
  else {
    body = (
      <>
        <Facts rows={v.facts} testId="captable-proposal-mercury-facts" />
        <section className="flex flex-col gap-2" aria-label="Before you accept">
          <h3 className={`m-0 text-[10.5px] font-extrabold uppercase tracking-[.07em] ${MUTED}`}>Before you accept</h3>
          <Facts rows={[['Holder', v.facts[0][1]], ['Basis', 'Post-money · preset from Mercury']]} />
          <label className={`flex flex-col gap-1 text-[12px] ${MUTED}`}>
            Discount (%)
            <input className={INPUT} inputMode="decimal" value={discount} placeholder="Not recorded" disabled={!owner} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount" data-testid="captable-proposal-discount" />
            <span>Mercury sends none. Enter it if the SAFE has one.</span>
          </label>
        </section>
      </>
    );
  }
  return (
    <Shell eyebrow="Proposal" title={v?.title || 'SAFE request'} onClose={onClose} write={write} testId="captable-proposal-mercury"
      confirm={v && owner ? v.confirm : null}
      buttons={v && owner ? [
        <button key="d" type="button" className={actionGhost} onClick={dismiss} disabled={write.busy} data-testid="captable-proposal-dismiss">Dismiss</button>,
        <button key="a" type="button" className={actionPrimary} onClick={accept} disabled={write.busy} data-testid="captable-proposal-accept">Accept as an instrument</button>,
      ] : [<button key="c" type="button" className={actionGhost} onClick={onClose}>Close</button>]}>
      {body}
    </Shell>
  );
}

/** CT11b: a close, its investors together. */
function CloseProposal({ projectId, closeUid, record, role, onClose, onDone }) {
  const read = useRead(() => capTableRecordApi.close(projectId, closeUid), `${projectId}:${closeUid}`);
  const write = useWrite(onDone);
  const v = read.status === 'ready' ? closeView(read.data, record) : null;
  const owner = role === 'owner';
  const recordAll = () => write.run(async () => {
    for (const r of v.ready) {
      try { await capTableRecordApi.accept(projectId, r.uid, {}); } catch (e) { throw new Error(`${r.holder}: ${refusalOf(e)}`); }
    }
    return { recorded: v.ready.length };
  });
  return (
    <Shell eyebrow="Proposal · from the closing room" title={v?.title || 'A close'} onClose={onClose} write={write} testId="captable-proposal-close"
      confirm={v && owner && v.ready.length ? v.confirm : null}
      buttons={[
        <button key="n" type="button" className={actionGhost} onClick={onClose} disabled={write.busy}>Not now</button>,
        ...(v && owner && v.ready.length ? [<button key="a" type="button" className={actionPrimary} onClick={recordAll} disabled={write.busy} data-testid="captable-proposal-accept">{v.action}</button>] : []),
      ]}>
      {read.status === 'loading' ? <p className={MUTED} aria-busy="true">Reading…</p>
        : read.status !== 'ready' ? <Unreadable what="This close" claim="This is not a claim that it proposed nothing." onRetry={read.retry} />
          : (
            <>
              {v.closed !== 'Not recorded' ? <p className={`m-0 ${MUTED}`}>Closed {v.closed}</p> : null}
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="captable-proposal-close-rows">
                {v.rows.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground pb-2 last:border-b-0 dark:border-gray-800" data-testid="captable-proposal-close-row">
                    <span className="flex min-w-0 flex-col">
                      <span className={`font-semibold ${INK}`}>{r.holder} · {r.amount}</span>
                      <span className={`text-[12px] ${MUTED}`}>{r.sub}{r.status && r.status !== 'proposed' ? ` · ${r.status}` : ''}{r.skipped ? ` · not proposed (${r.skipped})` : ''}</span>
                    </span>
                    <span className={`${PILL} ${r.signed ? GOOD : AMBER}`}>{r.label}</span>
                  </li>
                ))}
              </ul>
              <p className={`m-0 text-[12px] ${MUTED}`} data-testid="captable-proposal-close-foot">{v.foot}</p>
              {!owner ? <p className={`m-0 ${INK}`}>Only the owner records a close’s issuances. They change nothing until then.</p> : null}
            </>
          )}
    </Shell>
  );
}

/** A proposal from a person or an import. */
function RecordProposal({ projectId, row, record, role, onClose, onDone }) {
  const write = useWrite(onDone);
  const [reason, setReason] = useState('');
  const v = proposalView(row, record);
  const owner = role === 'owner';
  const accept = () => write.run(() => capTableRecordApi.accept(projectId, row.uid, {}).catch((e) => { throw new Error(refusalOf(e)); }));
  const dismiss = () => write.run(() => capTableRecordApi.dismiss(projectId, row.uid, reason.trim() ? { reason: reason.trim() } : {}));
  return (
    <Shell eyebrow="Proposal" title={v.title} onClose={onClose} write={write} testId="captable-proposal-record"
      confirm={owner ? v.confirm : null}
      buttons={owner ? [
        <button key="d" type="button" className={actionGhost} onClick={dismiss} disabled={write.busy} data-testid="captable-proposal-dismiss">Dismiss</button>,
        <button key="a" type="button" className={actionPrimary} onClick={accept} disabled={write.busy} data-testid="captable-proposal-accept">Accept</button>,
      ] : [<button key="c" type="button" className={actionGhost} onClick={onClose}>Close</button>]}>
      <p className={`m-0 ${INK}`} data-testid="captable-proposal-line">{v.line}</p>
      {row.correction_reason ? <p className={`m-0 ${MUTED}`}>Reason given: {row.correction_reason}</p> : null}
      {owner
        ? <input className={INPUT} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why you dismiss it (optional)" aria-label="Reason to dismiss" />
        : <p className={`m-0 ${INK}`} data-testid="captable-proposal-owner-only">Only the owner records or dismisses a proposal. It changes nothing until then.</p>}
    </Shell>
  );
}

/** The drawer for `/raise/cap-table/proposal/<id>`, over the tool. */
export default function ProposalDrawer({ projectId, id, role, record, onClose, onDone }) {
  const m = MERCURY_ID.exec(String(id || ''));
  const done = useCallback((out) => onDone?.(out), [onDone]);
  if (m) return <MercuryProposal projectId={projectId} id={Number(m[1])} role={role} onClose={onClose} onDone={done} />;
  if (record.status === 'loading') return <Shell title="Proposal" onClose={onClose} testId="captable-proposal-reading" buttons={[]}><p className={MUTED} aria-busy="true">Reading…</p></Shell>;
  if (record.status !== 'ready') {
    return (
      <Shell title="Proposal" onClose={onClose} testId="captable-proposal-unreadable" buttons={[<button key="c" type="button" className={actionGhost} onClick={onClose}>Close</button>]}>
        <Unreadable what="This proposal" claim="This is not a claim that nothing waits." onRetry={record.retry} />
      </Shell>
    );
  }
  const row = (record.data?.proposals?.rows || []).find((r) => r.uid === id);
  if (!row) {
    return (
      <Shell title="Proposal" onClose={onClose} testId="captable-proposal-none" buttons={[<button key="c" type="button" className={actionGhost} onClick={onClose}>Close</button>]}>
        <p className={`m-0 ${INK}`} data-testid="captable-proposal-gone">This proposal is no longer waiting: it was recorded or dismissed. History shows which.</p>
      </Shell>
    );
  }
  if (row.origin === 'close' && row.close_uid) return <CloseProposal projectId={projectId} closeUid={row.close_uid} record={record.data} role={role} onClose={onClose} onDone={done} />;
  return <RecordProposal projectId={projectId} row={row} record={record.data} role={role} onClose={onClose} onDone={done} />;
}
