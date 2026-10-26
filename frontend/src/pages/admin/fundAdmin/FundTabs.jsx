import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded, Unreadable } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { parseDollarsToCents } from '../../investor/fundCallsModel';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { Banner } from '../../account/ConnectorSheet';
import { BrandIcon } from '../../../ui';
import { ProofStatement } from '../../../components/ProofOfFunds';
import { CALLS_COMPARE, PILL_TONE, VIEW_NOTE } from '../../../lib/proofOfFunds';
import { reportError } from '../../../lib/log';
import { NO_FUND, money, refusalText } from './fundAdminModel';
import { Line, NUM, Note, Panel, Section, TH, Table, Tiles } from './parts';
import { useRead } from './useRead';

/**
 * The per-fund tabs (decision 8): Capital calls, Distributions, Management
 * fees and Reports, each on one administered fund (`?fund=`).
 *
 * REUSE, NEVER FORK. The call ledger (preview, Issue, Record receipt, aging)
 * is `InvestorFundCalls.jsx` at `/funds/calls`, the books are
 * `FundLedgerPanel.jsx` at `/funds/ledger`, and a report period's pack is
 * `FundReportPeriodPage.jsx`: this console opens them for the chosen fund
 * rather than drawing a second copy. What has no screen yet (the
 * distribution preview, #1774's fees, #1777's queue) is drawn here.
 *
 * THE CANVAS PR lays each tab out to the brief, in the August canvas's
 * parts: the tracking tiles and the call ledger's door on Capital calls; the
 * proceeds card beside "where every cent goes" on Distributions; the terms
 * and periods tables on Management fees; the review queue on Reports.
 */
const amount = (cents) => money(cents) ?? 'Not recorded';

function Failed({ read, what, claim }) {
  return <div className="px-4 py-3 sm:px-5"><Unreadable what={what} claim={claim} onRetry={read.reload} /></div>;
}

function Busy() { return <div className="px-4 py-3 sm:px-5"><LoadingRows lines={3} /></div>; }

function Alert({ text }) {
  return text ? <p role="alert" className="px-4 pb-2.5 text-[12px] text-red-700 sm:px-5 dark:text-red-300">{text}</p> : null;
}

const LABEL = 'text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200';

/**
 * The fund chooser, and the states that leave a per-fund tab with no fund.
 * The tab's Section carries the chooser in its heading, as the canvas's
 * segmented control sits beside a tab's title.
 */
// D1160 (FND2): the fund is chosen in the header's fund filter, kept across tabs as `?fund=`.
function FundFrame({ title, sub, testId, fund, overview, children }) {
  let body = children;
  if (overview.status === 'loading' || overview.status === 'idle') body = <LoadingRows lines={3} />;
  else if (overview.status === 'unreadable' || overview.data?.funds?.state !== 'ok') {
    body = <div data-testid="funds-unreadable"><Unreadable what="The administered funds" claim="This is not a claim that there is none." onRetry={overview.reload} /></div>;
  } else if (!fund) body = <Banner tone="neutral" data-testid="no-administered-fund">{NO_FUND}</Banner>;
  return <Section title={fund ? `${title} · ${fund.name}` : title} sub={sub} testId={testId}>{body}</Section>;
}

/**
 * D752 (#1890): the proofs of funds Fund I's LPs shared. Nothing is read until
 * Show: each read is audited and counts a view for every LP shown, so opening
 * the tab for its calls counts none. Hide folds it; each later Show reads again.
 */
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
          <Line key={i.uid} a={<span className="flex items-center gap-2">{i.state === 'active' && <BrandIcon provider="mercury" name="Mercury" size={20} />}{`${i.investor_name || `Investor #${i.investor_user_id}`} · ${i.target_label}`}</span>}
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

const CALLS_SUB = 'What this fund has called and received, and the doors to its call ledger and books. A Super Admin issues; any Admin previews and records receipts.';

export function CallsTab({ access, funds, fund, overview, onFund, apis }) {
  const f = (overview.data?.funds?.items || []).find((x) => Number(x.fund_id) === Number(fund?.id));
  return (
    <FundFrame title="Capital calls" sub={CALLS_SUB} testId="calls-section" funds={funds} fund={fund} overview={overview} onFund={onFund}>
      {fund && <div className="flex flex-col gap-4" data-testid="calls">
        <Tiles testId="calls-tiles" items={[
          { k: 'Committed', v: amount(f?.committed_cents), note: `${fund.name} · capital calls` },
          { k: 'Called', v: amount(f?.called_cents), note: <>{amount(f?.called_cents)} of {amount(f?.committed_cents)} committed</> },
          { k: 'Received', v: amount(f?.received_cents), tone: 'ok', note: 'Recorded receipts' },
          { k: 'Outstanding', v: amount(f?.outstanding_cents), tone: f?.overdue_lines > 0 ? 'warn' : null,
            note: f?.overdue_lines > 0 ? <Pill tone="warn">{f.overdue_lines} overdue</Pill> : <>Next due {f?.next_due_date || <Unrecorded>No line due</Unrecorded>}</> },
        ]} />
        {f?.overdue_lines > 0 && <p className="-mt-1 text-[11.5px] text-axal-muted dark:text-gray-400">Next due {f?.next_due_date || <Unrecorded>No line due</Unrecorded>}</p>}
        <Panel label="The call ledger" sub="Preview, issue, record receipts and age every line" testId="calls-ledger">
          <Line a="Preview, Record receipt and every line with its age" b="On the fund's call ledger, where each act is decided by the Worker."
            action={<Link className={BTN.link} to={`/funds/calls?fund=${fund.id}`} data-testid="open-call-ledger">Open the call ledger</Link>} />
          <Line a="Issue a capital call" b={<FundActControl access={access} act="capital_call.issue" testId="calls-issue-refused">
            <span data-testid="calls-issue-allowed">Issue is on the call ledger, after the preview and your step-up.</span>
          </FundActControl>} />
          <Line a="The fund's books" b="Journal entries, statements and reconciled lines."
            action={<Link className={BTN.link} to={`/funds/ledger?fund=${fund.id}`} data-testid="open-fund-ledger">Open the books</Link>} />
        </Panel>
        {apis?.capitalAttestations && <CallProofs apis={apis} fund={fund} />}
      </div>}
    </FundFrame>
  );
}

/** "Where every cent goes" (decision 3): each figure the job would write, and what no line received. */
function SplitView({ split }) {
  const r = Number(split.carry_rate);
  const rate = split.carry_rate != null && Number.isFinite(r) ? `${(r * 100).toFixed(2)}%` : null;
  const rows = [
    ['Proceeds', amount(split.proceeds_cents), null],
    ['Basis returned', amount(split.basis_returned_cents), null],
    ['Profit', amount(split.profit_cents), null],
    ['Carry withheld', amount(split.carry_withheld_cents), !rate ? 'The rate is not recorded in this preview.' : split.carry_rate_defaulted
      ? <span data-testid="carry-defaulted">{`at ${rate}, the job’s 20% default, because the fund records no carry rate`}</span> : `at ${rate}, the fund’s recorded carry rate`],
    ['To the LPs', amount(split.distributable_cents), null],
  ];
  const lines = split.lines || [];
  return (
    <div data-testid="distribution-preview">
      <Panel label="Where every cent goes" sub={money(split.proceeds_cents) ? `${money(split.proceeds_cents)} in proceeds` : null}>
        {rows.map(([k, v, note]) => <Line key={k} a={k} b={note} figure={v} />)}
        {!split.distributable && <Line a="Not distributable" b="No LP holds a commitment, so the job would write nothing." tone="danger" />}
        <Line a="No line received" b={split.dropped_lp_ids?.length ? `${split.dropped_lp_ids.length} LP share rounded to zero and gets no line` : 'Every LP share is at least a cent'}
          figure={amount(split.unallocated_cents)} />
      </Panel>
      {lines.length > 0 && (
        <div className="mt-4">
          <Panel label="Per-LP distribution preview" sub={`${lines.length} limited partner${lines.length === 1 ? '' : 's'}`}>
            <Table cols={[
              { key: 'lp', label: 'Limited partner', cell: (l) => `LP #${l.lp_id}` },
              { key: 'amount', label: 'This distribution', align: 'right', mono: true, cell: (l) => amount(l.amount_cents) },
            ]} rows={lines} rowKey={(l) => l.lp_id} template="1fr 12rem" rowTestId={(l) => `distribution-line-${l.lp_id}`}
            foot={<div className="grid grid-cols-[1fr_auto] items-center bg-[#faf9fc] px-4 py-3 sm:grid-cols-[1fr_12rem] sm:px-5 dark:bg-gray-950/40">
              <div className="text-[11.5px] font-extrabold text-axal-ink dark:text-gray-100">Total</div>
              <div className={`text-right text-[12px] font-extrabold text-axal-ink dark:text-gray-100 ${NUM}`}>{amount(lines.reduce((n, l) => n + Number(l.amount_cents || 0), 0))}</div>
            </div>} />
          </Panel>
        </div>
      )}
    </div>
  );
}

export function DistributionsTab({ apis, access, funds, fund, overview, onFund }) {
  const list = useRead(() => (fund ? apis.funds.distributions(fund.id) : Promise.resolve({ items: [] })), [apis, fund?.id]);
  const [proceeds, setProceeds] = useState('');
  const [split, setSplit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(refusalText(e, fallback)); } finally { setBusy(false); }
  };
  const preview = (e) => {
    e.preventDefault();
    const cents = parseDollarsToCents(proceeds);
    if (cents == null) { setError('Enter the proceeds in dollars, above zero, with at most two decimals.'); setSplit(null); return; }
    run(async () => setSplit(await apis.fundAdmin.distributionPreview(fund.id, cents)), 'The split could not be previewed.');
  };
  const execute = () => run(async () => {
    await apis.funds.execute({ fund_id: fund.id, proceeds_cents: split.proceeds_cents });
    setSplit(null); setProceeds(''); await list.reload();
  }, 'The distribution could not be executed.');
  const items = list.data?.items || [];
  const cols = [
    { key: 'lp', label: 'Limited partner', cell: (d) => d.lp_name || `LP #${d.lp_id}` },
    { key: 'type', label: 'Type', cell: (d) => d.distribution_type || 'type not recorded' },
    { key: 'date', label: 'Date', mono: true, cell: (d) => String(d.distributed_at || d.created_at || '').slice(0, 10) || 'Not recorded' },
    { key: 'amount', label: 'Amount', align: 'right', mono: true, cell: (d) => amount(d.amount_cents) },
    { key: 'status', label: 'Status', cell: (d) => <Pill tone={d.status === 'paid' ? 'ok' : 'neutral'}>{d.status}</Pill> },
    { key: 'action', label: 'Action', align: 'right', cell: (d) => (d.status === 'pending' ? (
      <FundActControl access={access} act="distribution.mark_paid" testId={`distribution-mark-refused-${d.id}`}>
        <button type="button" className={BTN.ghost} disabled={busy} data-testid={`distribution-mark-paid-${d.id}`}
          onClick={() => run(async () => { await apis.funds.markPaid(d.id); await list.reload(); }, 'The line could not be marked paid.')}>Mark paid</button>
      </FundActControl>) : <span className="text-axal-muted">—</span>) },
  ];
  return (
    <FundFrame title="Distributions" testId="distributions-section" funds={funds} fund={fund} overview={overview} onFund={onFund}
      sub="Preview a split before it is executed: where every cent goes, at the rate the job uses. A Super Admin executes; any Admin previews and marks a line paid.">
      {fund && <div className="flex flex-col gap-4" data-testid="distributions">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_1fr]">
          <div className="rounded-axal-xl border border-axal-hairline bg-white px-4 py-4 sm:px-5 dark:border-gray-800 dark:bg-gray-900">
            <div className={TH}>Net proceeds</div>
            <form id="distribution-form" className="mt-3 flex flex-col gap-2.5" onSubmit={preview}>
              <label className={LABEL}>Proceeds (USD)
                <input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={proceeds} onChange={(e) => { setProceeds(e.target.value); setSplit(null); }} disabled={busy} data-testid="distribution-proceeds" />
              </label>
              <button type="submit" className={BTN.ghost} disabled={busy} data-testid="distribution-preview-submit">Preview</button>
            </form>
            {split && split.distributable && (
              <div className="mt-4 border-t border-axal-hairline pt-3.5 dark:border-gray-800">
                <p className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">The job pays these lines. Nothing is sent from here: each line is marked paid when the money has gone.</p>
                <div className="mt-2.5">
                  <FundActControl access={access} act="distribution.execute" testId="distribution-execute-refused" className="text-[12px] text-axal-muted">
                    <button type="button" className={`${BTN.primary} w-full`} disabled={busy} onClick={execute} data-testid="distribution-execute">Execute</button>
                  </FundActControl>
                </div>
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
          </div>
          {split ? <SplitView split={split} />
            : <Panel label="Where every cent goes"><Note>Enter the proceeds and Preview. The split is the job’s own arithmetic: basis returned, profit, carry withheld and each LP’s line.</Note></Panel>}
        </div>
        <Panel label="Distributions" testId="distributions-list">
          {list.status === 'loading' ? <Busy />
            : list.status === 'unreadable' ? <Failed read={list} what="This fund's distributions" claim="This is not a claim that none was made." />
              : items.length === 0 ? <Note>No distribution yet. An executed distribution writes one line per LP.</Note>
                : <Table cols={cols} rows={items} rowKey={(d) => d.id} template="1.6fr 1.1fr .9fr 1fr .8fr 1.1fr" rowTestId={(d) => `distribution-${d.id}`} />}
        </Panel>
      </div>}
    </FundFrame>
  );
}

// D1165: these tabs have their own layout module; existing imports keep working.
export { FeesTab, ReportsTab } from './FeesReportsTabs';
