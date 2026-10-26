import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandIcon, Pill, Unrecorded, Unreadable } from '../../../ui';
import { HBars } from '../../../ui/Charts';
import { FundActControl } from '../../../lib/fundActs';
import { BTN } from '../../account/AccountCenter';
import { ProofStatement } from '../../../components/ProofOfFunds';
import { CALLS_COMPARE, PILL_TONE, VIEW_NOTE } from '../../../lib/proofOfFunds';
import { reportError } from '../../../lib/log';
import { kycLabel, lineAge, lineStateLabel } from '../../investor/fundCallsModel';
import { refusalText } from './fundAdminModel';
import { Line, NUM, Note, Panel, Table, Tiles } from './parts';
import { useRead } from './useRead';
import { Alert, Busy, FundFrame } from './FundTabs';
import { ChartBlock } from './ChartBlock';
import { CallNoticesDialog, NewCallDialog, ReceiptDialog } from './callDialogs';
import { ageChart, callState, callTiles, figuresMatch, lpName, money } from './callsModel';

/**
 * D1163 (#3070, part 6 of #2388) — Capital calls drawn in place (FND7, FND8).
 *
 * The console no longer sends an admin to `/funds/calls` or `/funds/ledger`
 * for an administered fund (D714.md's departure). The call ledger
 * (`GET /api/funds/:id/capital-calls`) is read here, for the fund in
 * `?fund=`: the six tiles, "Outstanding by age", the latest call with each
 * LP's line (Record receipt, Open LP), the earlier calls, and the proofs of
 * funds as D752 drew them.
 *
 * EVERY ACT IS A DIALOG, AND THE WORKER DECIDES. New capital call previews
 * the split, then Issue (Super Admin, then the step-up the request helper
 * answers); an Admin reads "A Super Admin issues capital calls." where Issue
 * would be. Call notices preview every line's notice, then Issue (Super
 * Admin). Record receipt is any Admin's.
 */

/** D752 (#1890): the proofs of funds Fund I's LPs shared. Nothing is read until Show; each later Show reads again. */
function CallProofs({ apis, fund }) {
  const [state, setState] = useState({ status: 'closed', data: null, error: null });
  const show = async () => {
    setState({ status: 'loading', data: null, error: null });
    try {
      setState({ status: 'ok', data: await apis.capitalAttestations.forFund(fund.id), error: null });
    } catch (e) {
      reportError('proof-of-funds:calls', e);
      setState({ status: e?.status ? 'refused' : 'unreadable', data: null, error: e });
    }
  };
  const items = state.data?.items || [];
  return (
    <Panel label="Proof of funds shared by LPs" testId="calls-proofs">
      <Line a="Proofs of funds" b={VIEW_NOTE}
        action={state.status === 'closed' ? <button type="button" className={BTN.link} onClick={show} data-testid="calls-proofs-show">Show proofs of funds</button> : null} />
      {state.status === 'loading' && <Busy />}
      {state.status === 'unreadable' && <div className="px-4 py-3 sm:px-5"><Unreadable what="The proofs of funds" claim="This is not a claim that none was shared." onRetry={show} /></div>}
      {state.status === 'refused' && <Alert text={refusalText(state.error, 'The proofs of funds could not be read.')} />}
      {state.status === 'ok' && (items.length === 0
        ? <Note><Unrecorded>No LP has shared a proof of funds for this fund.</Unrecorded></Note>
        : items.map((i) => (
          <Line key={i.uid} a={<span className="flex items-center gap-2">{i.state === 'active' && <BrandIcon provider="mercury" name="Mercury" size={20} />}{`${i.investor_name || 'Name not recorded'} · ${i.target_label}`}</span>}
            b={<ProofStatement item={i} mark={false} />}
            chip={<Pill tone={PILL_TONE[i.label] || 'neutral'}>{i.label}</Pill>} />
        )))}
      {state.status !== 'closed' && state.status !== 'loading' && (
        <Line a={state.data?.truncated ? 'Showing the first 500.' : 'What these show'} b={CALLS_COMPARE}
          action={<button type="button" className={BTN.link} onClick={() => setState({ status: 'closed', data: null, error: null })} data-testid="calls-proofs-hide">Hide</button>} />
      )}
    </Panel>
  );
}

const PILL = { paid: 'ok', overdue: 'warn', part_received: 'neutral', pending: 'neutral' };

/** One call's LP lines (FND7's table): owed, received, outstanding, state, days overdue, and each line's acts. */
function CallLines({ call, fund, access, onReceipt }) {
  const cols = [
    { key: 'lp', label: 'LP', cell: (l) => <span><span className="font-semibold">{lpName(l)}</span><span className="block text-[10.5px] text-axal-muted dark:text-gray-400">{kycLabel(l)}</span></span> },
    { key: 'owed', label: 'Owed', align: 'right', mono: true, cell: (l) => money(l.owed_cents) },
    { key: 'received', label: 'Received', align: 'right', mono: true, cell: (l) => money(l.received_cents) },
    { key: 'outstanding', label: 'Outstanding', align: 'right', mono: true, cell: (l) => money(l.outstanding_cents) },
    { key: 'state', label: 'State', cell: (l) => <Pill tone={PILL[l.state] || 'neutral'}>{lineStateLabel(l)}</Pill> },
    { key: 'age', label: 'Age', cell: (l) => <span className={l.state === 'overdue' ? `${NUM} font-bold text-amber-700 dark:text-amber-300` : ''}>{lineAge(l)}</span> },
    { key: 'act', label: '', align: 'right', cell: (l) => (
      <span className="inline-flex flex-wrap justify-end gap-2">
        {l.state !== 'paid' && Number(l.outstanding_cents) > 0 && (
          <FundActControl access={access} act="capital_call.receipt" testId={`call-receipt-refused-${l.id}`} className="text-[11px] text-axal-muted">
            <button type="button" className={BTN.ghost} onClick={() => onReceipt(l, call)} data-testid={`call-receipt-${l.id}`}>Record receipt</button>
          </FundActControl>
        )}
        <Link className={BTN.link} to={`/admin/fund-admin/lps/${l.limited_partner_id}?fund=${fund.id}`} data-testid={`call-open-lp-${l.id}`}>Open LP</Link>
      </span>) },
  ];
  return <Table cols={cols} rows={call.lines || []} rowKey={(l) => l.id} template="1.5fr 1fr 1fr 1fr 1.1fr 1fr 1.4fr" wide rowTestId={(l) => `call-line-${l.id}`} />;
}

function residualSentence(call) {
  if (!call.residual_cents) return 'Each line is the LP’s share by commitment, in whole cents. The split came out exact.';
  return `Each line is the LP’s share by commitment, in whole cents. The ${call.residual_cents}-cent residual sits on ${call.residual_lp_name ? `${call.residual_lp_name}’s line` : 'one named line'}.`;
}

/** The latest call, drawn whole: its header line, its LP lines and its notices. */
function LatestCall({ call, fund, access, onReceipt, onNotices }) {
  return (
    <Panel testId={`call-${call.call_number}`}
      label={`Call ${call.call_number} · ${money(call.amount_cents)} · ${call.due_date ? `due ${call.due_date}` : 'no due date recorded'}`}
      sub={`Received ${money(call.received_cents)} · Outstanding ${money(call.outstanding_cents)}`}
      aside={call.uid ? <button type="button" className={BTN.ghost} onClick={() => onNotices(call)} data-testid={`call-notices-${call.call_number}`}>Call notices</button> : null}>
      <Line a={call.purpose ? `Purpose: ${call.purpose}` : 'No purpose recorded'} b={`${residualSentence(call)}${call.issued_by_name ? ` Issued by ${call.issued_by_name}` : ''} · ${String(call.created_at || '').slice(0, 10)}`} />
      <CallLines call={call} fund={fund} access={access} onReceipt={onReceipt} />
    </Panel>
  );
}

/** Earlier calls (FND7): one line each, opened in place. */
function EarlierCalls({ calls, fund, access, onReceipt, onNotices }) {
  const [open, setOpen] = useState(null);
  return (
    <Panel label="Earlier calls" testId="calls-earlier">
      {calls.map((c) => (
        <div key={c.id}>
          <Line a={`Call ${c.call_number} · ${money(c.amount_cents)} · ${c.due_date ? `due ${c.due_date}` : 'no due date recorded'}`}
            b={<span className={NUM}>{`Received ${money(c.received_cents)} · Outstanding ${money(c.outstanding_cents)} · ${callState(c)}`}</span>}
            action={<button type="button" className={BTN.link} aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} data-testid={`call-expand-${c.call_number}`}>{open === c.id ? 'Close ▴' : 'Expand ▾'}</button>} />
          {open === c.id && <div className="border-b border-axal-hairline dark:border-gray-800" data-testid={`call-expanded-${c.call_number}`}>
            <div className="flex justify-end px-4 pt-2 sm:px-5">{c.uid && <button type="button" className={BTN.ghost} onClick={() => onNotices(c)} data-testid={`call-notices-${c.call_number}`}>Call notices</button>}</div>
            <CallLines call={c} fund={fund} access={access} onReceipt={onReceipt} />
          </div>}
        </div>
      ))}
    </Panel>
  );
}

const CALLS_SUB = 'What this fund has called and received, each call with its LP lines. Any Admin previews, records receipts and previews notices; a Super Admin issues.';

export function CallsTab({ apis, access, fund, overview }) {
  const ledger = useRead(() => (fund ? apis.calls.ledger(fund.id) : Promise.resolve(null)), [apis, fund?.id]);
  const [dialog, setDialog] = useState(null);
  const [issued, setIssued] = useState(null);
  const data = ledger.status === 'ready' ? ledger.data : null;
  const calls = Array.isArray(data?.calls) ? data.calls : [];
  const tiles = useMemo(() => callTiles(data), [data]);
  const age = useMemo(() => (data ? ageChart(data) : null), [data]);
  const [latest, ...earlier] = calls;
  // After Issue the ledger is read again, and the issued call is checked against the preview it showed.
  const check = issued && latest && latest.call_number === issued.preview.next_call_number ? figuresMatch(issued.preview, latest) : null;
  const onReceipt = (line, call) => setDialog({ kind: 'receipt', line, call });
  const onNotices = (call) => setDialog({ kind: 'notices', call });

  return (
    <FundFrame title="Capital calls" sub={CALLS_SUB} testId="calls-section" fund={fund} overview={overview}
      aside={<button type="button" className={BTN.primary} onClick={() => setDialog({ kind: 'new' })} data-testid="calls-new">New capital call</button>}>
      {fund && <div className="flex flex-col gap-4" data-testid="calls">
        {ledger.status === 'loading' && <Busy />}
        {ledger.status === 'unreadable' && <div data-testid="calls-unreadable"><Unreadable what="This fund's call ledger" claim="This is not a claim that the fund has no calls." onRetry={ledger.reload} /></div>}
        {data && <>
          <Tiles testId="calls-tiles" cols="lg:grid-cols-3" items={tiles.map((t) => ({ ...t, testId: `calls-tile-${t.key}` }))} />
          <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="calls-issue-line">
            <FundActControl access={access} act="capital_call.issue" testId="calls-issue-refused">
              <span data-testid="calls-issue-allowed">New capital call previews the split; you issue it after the preview and your step-up.</span>
            </FundActControl>
          </p>
          {check && <p role="status" className={`m-0 text-[12px] ${check.same ? 'text-axal-positive dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`} data-testid="calls-issued-check">
            {check.same ? `Call ${latest.call_number} is issued, with the figures its preview showed.` : `Call ${latest.call_number} is issued, but its figures differ from the preview for ${check.differs.join(', ') || 'the total'}. Check the call before sending notices.`}
          </p>}
          {age && (
            <ChartBlock title="Outstanding by age" testId="calls-age" note={age.note} alt={age.alt} table={age.table}>
              {age.empty ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{age.note}</p>
                : <HBars rows={age.rows} testIdPrefix="calls-age-bar" />}
            </ChartBlock>
          )}
          {apis?.capitalAttestations && <CallProofs apis={apis} fund={fund} />}
          {latest ? <LatestCall call={latest} fund={fund} access={access} onReceipt={onReceipt} onNotices={onNotices} />
            : <Panel label="Capital calls" testId="calls-none"><Note>No numbered call has been issued on this fund. New capital call previews the split before anything is written.</Note></Panel>}
          {earlier.length > 0 && <EarlierCalls calls={earlier} fund={fund} access={access} onReceipt={onReceipt} onNotices={onNotices} />}
          {data.unnumbered?.length > 0 && (
            <Panel label="Issued before calls were numbered" sub="Their amounts were stored in dollars and are shown rounded to the cent." testId="calls-unnumbered">
              <CallLines call={{ lines: data.unnumbered }} fund={fund} access={access} onReceipt={onReceipt} />
            </Panel>
          )}
          {data.truncated && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">This fund has more calls or lines than one read returns; the oldest are not shown, and the totals cover only what was read.</p>}
        </>}
      </div>}
      {dialog?.kind === 'new' && <NewCallDialog apis={apis} access={access} fund={fund}
        onClose={() => setDialog(null)} onIssued={async (preview) => { setDialog(null); setIssued({ preview }); await ledger.reload(); }} />}
      {dialog?.kind === 'receipt' && <ReceiptDialog apis={apis} fund={fund} line={dialog.line} call={dialog.call}
        onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await ledger.reload(); }} />}
      {dialog?.kind === 'notices' && <CallNoticesDialog apis={apis} access={access} call={dialog.call} onClose={() => setDialog(null)} />}
    </FundFrame>
  );
}
