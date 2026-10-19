import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded, Unreadable } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { parseDollarsToCents } from '../../investor/fundCallsModel';
import { bpsPercent } from '../../../lib/bps';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { Banner, Group, Row } from '../../account/ConnectorSheet';
import { BrandIcon } from '../../../ui';
import { ProofStatement } from '../../../components/ProofOfFunds';
import { CALLS_COMPARE, PILL_TONE, VIEW_NOTE } from '../../../lib/proofOfFunds';
import { reportError } from '../../../lib/log';
import { NO_FUND, QUARTER_RE, REJECT_REASON_MIN, money, refusalText } from './fundAdminModel';
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
 */
const amount = (cents) => money(cents) ?? 'Not recorded';

function Failed({ read, what, claim }) {
  return <div className="px-3 py-2"><Unreadable what={what} claim={claim} onRetry={read.reload} /></div>;
}

function Busy() { return <div className="px-3 py-2"><LoadingRows lines={3} /></div>; }

function Alert({ text }) {
  return text ? <p role="alert" className="px-3 pb-2 text-[12px] text-red-700 dark:text-red-300">{text}</p> : null;
}

/** The fund chooser, and the states that leave a per-fund tab with no fund. */
function FundFrame({ funds, fund, overview, onFund, children }) {
  if (overview.status === 'loading' || overview.status === 'idle') return <div className="mx-5 mt-4"><LoadingRows lines={3} /></div>;
  if (overview.status === 'unreadable' || overview.data?.funds?.state !== 'ok') {
    return <div className="mx-5 mt-4" data-testid="funds-unreadable"><Unreadable what="The administered funds" claim="This is not a claim that there is none." onRetry={overview.reload} /></div>;
  }
  if (!fund) return <Banner tone="neutral" data-testid="no-administered-fund">{NO_FUND}</Banner>;
  return (
    <>
      {funds.length > 1 && (
        <div className="mx-5 mt-4">
          <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Fund{' '}
            <select className={`${INPUT} mt-1 sm:w-72`} value={String(fund.id)} onChange={(e) => onFund(e.target.value)} data-testid="fund-select">
              {funds.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {children}
    </>
  );
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
    <Group label="Proof of funds shared by LPs">
      <Row a="Proofs of funds" b={VIEW_NOTE}
        action={state.status === 'closed' ? <button type="button" className={BTN.link} onClick={show} data-testid="calls-proofs-show">Show proofs of funds</button> : null} />
      {state.status === 'loading' && <Busy />}
      {state.status === 'unreadable' && <div className="px-3 py-2"><Unreadable what="The proofs of funds" claim="This is not a claim that none was shared." onRetry={show} /></div>}
      {state.status === 'refused' && <Alert text={refusalText(state.error, 'The proofs of funds could not be read.')} />}
      {state.status === 'ok' && (items.length === 0
        ? <Row a={<Unrecorded>No LP has shared a proof of funds for this fund.</Unrecorded>} />
        : items.map((i) => (
          <Row key={i.uid} a={`${i.investor_name || `Investor #${i.investor_user_id}`} · ${i.target_label}`}
            icon={i.state === 'active' ? <BrandIcon provider="mercury" name="Mercury" size={24} /> : null}
            b={<ProofStatement item={i} mark={false} />}
            pill={<Pill tone={PILL_TONE[i.label] || 'neutral'}>{i.label}</Pill>} />
        )))}
      {state.status !== 'closed' && state.status !== 'loading' && (
        <Row a={state.data?.truncated ? 'Showing the first 500.' : ''} b={CALLS_COMPARE}
          action={<button type="button" className={BTN.link} onClick={() => setState({ status: 'closed', data: null, error: null })} data-testid="calls-proofs-hide">Hide</button>} />
      )}
    </Group>
  );
}

export function CallsTab({ access, funds, fund, overview, onFund, apis }) {
  const f = (overview.data?.funds?.items || []).find((x) => Number(x.fund_id) === Number(fund?.id));
  return (
    <FundFrame funds={funds} fund={fund} overview={overview} onFund={onFund}>
      {fund && <div data-testid="calls">
        <Group label={`${fund.name} · capital calls`}>
          <Row a="Called" b={<>{amount(f?.called_cents)} of {amount(f?.committed_cents)} committed</>} />
          <Row a="Received" b={amount(f?.received_cents)} />
          <Row a="Outstanding" b={amount(f?.outstanding_cents)} pill={f?.overdue_lines > 0 ? <Pill tone="warn">{f.overdue_lines} overdue</Pill> : null} />
          <Row a="Next due" b={f?.next_due_date || <Unrecorded>No line due</Unrecorded>} />
        </Group>
        <Group label="The call ledger">
          <Row a="Preview, Record receipt and every line with its age" b="On the fund's call ledger, where each act is decided by the Worker."
            action={<Link className={BTN.link} to={`/funds/calls?fund=${fund.id}`} data-testid="open-call-ledger">Open the call ledger</Link>} />
          <Row a="Issue a capital call" b={<FundActControl access={access} act="capital_call.issue" testId="calls-issue-refused">
            <span data-testid="calls-issue-allowed">Issue is on the call ledger, after the preview and your step-up.</span>
          </FundActControl>} />
          <Row a="The fund's books" b="Journal entries, statements and reconciled lines."
            action={<Link className={BTN.link} to={`/funds/ledger?fund=${fund.id}`} data-testid="open-fund-ledger">Open the books</Link>} />
        </Group>
        {apis?.capitalAttestations && <CallProofs apis={apis} fund={fund} />}
      </div>}
    </FundFrame>
  );
}

function SplitView({ split }) {
  return (
    <div data-testid="distribution-preview">
      <Row a="Proceeds" b={amount(split.proceeds_cents)} />
      <Row a="Basis returned" b={amount(split.basis_returned_cents)} />
      <Row a="Profit" b={amount(split.profit_cents)} />
      <Row a="Carry withheld" b={<>{amount(split.carry_withheld_cents)} at {(Number(split.carry_rate) * 100).toFixed(2)}%{split.carry_rate_defaulted
        ? <span data-testid="carry-defaulted"> · the job’s 20% default, because the fund records no carry rate</span> : ' · the fund’s recorded carry rate'}</>} />
      <Row a="To the LPs" b={amount(split.distributable_cents)} />
      {!split.distributable && <Row a="Not distributable" b="No LP holds a commitment, so the job would write nothing." tone="danger" />}
      {(split.lines || []).map((l) => <Row key={l.lp_id} a={`LP #${l.lp_id}`} b={amount(l.amount_cents)} />)}
      <Row a="No line received" b={<>{amount(split.unallocated_cents)}{split.dropped_lp_ids?.length ? ` · ${split.dropped_lp_ids.length} LP share rounded to zero and gets no line` : ''}</>} />
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
  return (
    <FundFrame funds={funds} fund={fund} overview={overview} onFund={onFund}>
      {fund && <div data-testid="distributions">
        <Group label={`${fund.name} · preview a distribution`}>
          <form className="flex flex-wrap items-end gap-2 px-3 py-3" onSubmit={preview}>
            <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Proceeds (USD)
              <input className={`${INPUT} mt-1 w-48`} inputMode="decimal" value={proceeds} onChange={(e) => { setProceeds(e.target.value); setSplit(null); }} disabled={busy} data-testid="distribution-proceeds" />
            </label>
            <button type="submit" className={BTN.ghost} disabled={busy} data-testid="distribution-preview-submit">Preview</button>
          </form>
          {split && <SplitView split={split} />}
          {split && split.distributable && (
            <Row a="Execute this split" b="The job pays these lines. Nothing is sent from here: each line is marked paid when the money has gone."
              action={<FundActControl access={access} act="distribution.execute" testId="distribution-execute-refused" className="text-[12px] text-axal-muted">
                <button type="button" className={BTN.primary} disabled={busy} onClick={execute} data-testid="distribution-execute">Execute</button>
              </FundActControl>} />
          )}
          <Alert text={error} />
        </Group>
        <Group label="Distributions">
          {list.status === 'loading' ? <Busy />
            : list.status === 'unreadable' ? <Failed read={list} what="This fund's distributions" claim="This is not a claim that none was made." />
              : items.length === 0 ? <Row a="No distribution yet" b="An executed distribution writes one line per LP." />
                : items.map((d) => (
                  <Row key={d.id} a={`${d.lp_name || `LP #${d.lp_id}`} · ${amount(d.amount_cents)}`} b={`${d.distribution_type || 'type not recorded'} · ${String(d.distributed_at || d.created_at || '').slice(0, 10)}`}
                    pill={<Pill tone={d.status === 'paid' ? 'ok' : 'neutral'}>{d.status}</Pill>}
                    action={d.status === 'pending' && (
                      <FundActControl access={access} act="distribution.mark_paid" testId={`distribution-mark-refused-${d.id}`}>
                        <button type="button" className={BTN.ghost} disabled={busy} data-testid={`distribution-mark-paid-${d.id}`}
                          onClick={() => run(async () => { await apis.funds.markPaid(d.id); await list.reload(); }, 'The line could not be marked paid.')}>Mark paid</button>
                      </FundActControl>
                    )} />
                ))}
        </Group>
      </div>}
    </FundFrame>
  );
}

export function FeesTab({ apis, access, funds, fund, overview, onFund }) {
  const read = useRead(() => (fund ? apis.fees.state(fund.id) : Promise.resolve(null)), [apis, fund?.id]);
  const [quarter, setQuarter] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(refusalText(e, fallback)); } finally { setBusy(false); }
  };
  const s = read.data;
  const missing = (s?.lps || []).filter((l) => l.admission_missing).length;
  return (
    <FundFrame funds={funds} fund={fund} overview={overview} onFund={onFund}>
      {fund && <div data-testid="fees">
        {read.status === 'loading' ? <div className="mx-5 mt-4"><LoadingRows lines={3} /></div>
          : read.status === 'unreadable' ? <div className="mx-5 mt-4"><Unreadable what="This fund's management fee" claim="This is not a claim that no fee is due." onRetry={read.reload} /></div>
            : <>
              <Group label="Fee terms">
                {(s?.terms || []).length === 0 ? <Row a="No terms recorded" b={<Unrecorded>Not recorded</Unrecorded>} />
                  : s.terms.map((t) => (
                    <Row key={t.uid} a={`${bpsPercent(t.annual_bps) ?? 'Rate not recorded'} a year from ${t.effective_from}`} b={t.lpa_reference || 'No LPA reference recorded'}
                      pill={<Pill tone={t.status === 'confirmed' ? 'ok' : 'neutral'}>{t.status}</Pill>}
                      action={t.status === 'draft' && (
                        <FundActControl access={access} act="fee_terms.confirm" testId={`fee-terms-refused-${t.uid}`} className="text-[12px] text-axal-muted">
                          <button type="button" className={BTN.primary} disabled={busy} data-testid={`fee-terms-confirm-${t.uid}`}
                            onClick={() => run(async () => { await apis.fees.confirmTerms(fund.id, t.uid); await read.reload(); }, 'The terms could not be confirmed.')}>Confirm</button>
                        </FundActControl>
                      )} />
                  ))}
                {missing > 0 && <Row a="Admission dates" b={`${missing} LP${missing === 1 ? ' has' : 's have'} no admission date recorded.`} tone="danger" />}
              </Group>
              <Group label="Fee periods">
                {(s?.periods || []).length === 0 ? <Row a="No fee period yet" b={<Unrecorded>Not recorded</Unrecorded>} />
                  : s.periods.map((p) => (
                    <Row key={p.quarter} a={`${p.quarter} · net ${amount(p.net_cents)}`} b={`${p.window_start} to ${p.window_end} · ${p.remittance_reference || 'no reference yet'}`}
                      pill={<Pill tone={p.status === 'paid' ? 'ok' : 'neutral'}>{p.status}</Pill>} />
                  ))}
                <form className="flex flex-wrap items-end gap-2 px-3 py-3" onSubmit={(e) => {
                  e.preventDefault();
                  const q = quarter.trim().toUpperCase();
                  if (!QUARTER_RE.test(q)) { setError('Enter a quarter as 2026Q3.'); return; }
                  run(async () => setPreview(await apis.fees.previewPeriod(fund.id, q)), 'The quarter could not be previewed.');
                }}>
                  <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Quarter
                    <input className={`${INPUT} mt-1 w-32`} placeholder="2026Q3" value={quarter} onChange={(e) => { setQuarter(e.target.value); setPreview(null); }} disabled={busy} data-testid="fee-quarter" />
                  </label>
                  <FundActControl access={access} act="fee.write" testId="fee-preview-refused">
                    <button type="submit" className={BTN.ghost} disabled={busy} data-testid="fee-preview-submit">Preview</button>
                  </FundActControl>
                </form>
                {preview && <div data-testid="fee-preview">
                  <Row a={`${preview.quarter} · net ${amount(preview.totals?.net_cents)}`} b={<>Gross {amount(preview.totals?.gross_cents)} · catch-up {amount(preview.totals?.catch_up_cents)} · offset applied {amount(preview.totals?.applied_cents)}</>} />
                  <Row a="Issue this quarter" b="Issuing records the amounts and reference codes. Nothing moves money."
                    action={<FundActControl access={access} act="fee_period.issue" testId="fee-issue-refused" className="text-[12px] text-axal-muted">
                      <button type="button" className={BTN.primary} disabled={busy} data-testid="fee-issue"
                        onClick={() => run(async () => { await apis.fees.issuePeriod(fund.id, preview.quarter, preview.digest); setPreview(null); await read.reload(); }, 'The quarter could not be issued.')}>Issue</button>
                    </FundActControl>} />
                </div>}
                <Alert text={error} />
              </Group>
            </>}
      </div>}
    </FundFrame>
  );
}

function DraftRow({ d, apis, access, onChanged }) {
  const [opened, setOpened] = useState(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(refusalText(e, fallback)); } finally { setBusy(false); }
  };
  const done = async () => { setMode(null); setText(''); setOpened(null); await onChanged(); };
  const sha = opened?.figures_sha256;
  return (
    <div data-testid={`draft-${d.uid}`}>
      <Row a={`${d.period_label || 'Period not recorded'} · ${String(d.kind || '').replace(/_/g, ' ')}`} b={`Revision ${d.revision ?? 1}${d.prepared_at ? ` · prepared ${String(d.prepared_at).slice(0, 10)}` : ''}`}
        pill={<Pill tone={d.status === 'prepared' ? 'warn' : d.status === 'issued' ? 'ok' : 'neutral'}>{d.status}</Pill>}
        action={<span className="flex flex-wrap justify-end gap-2">
          {d.fund_id && d.report_period_id && <Link className={BTN.link} to={`/funds/${d.fund_id}/reporting/${d.report_period_id}`} data-testid={`draft-period-${d.uid}`}>Report period</Link>}
          <button type="button" className={BTN.ghost} disabled={busy} data-testid={`draft-open-${d.uid}`}
            onClick={() => run(async () => setOpened(await apis.reporting.read(d.uid)), 'The draft could not be opened.')}>Open</button>
          <button type="button" className={BTN.ghost} disabled={busy} data-testid={`draft-export-${d.uid}`}
            onClick={() => run(() => apis.reporting.exportCsv(d.uid), 'The draft could not be exported.')}>Export</button>
        </span>} />
      {opened && (
        <div className="px-3 pb-3" data-testid={`draft-opened-${d.uid}`}>
          <p className="text-[12px] text-axal-muted dark:text-gray-400">Opened, and recorded in the audit log. Figures {String(sha || '').slice(0, 12)}…</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {d.status === 'draft' && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setMode('prepare')} data-testid={`draft-prepare-${d.uid}`}>Prepare</button>}
            {d.status === 'prepared' && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setMode('return')} data-testid={`draft-return-${d.uid}`}>Return</button>}
            {d.status === 'prepared' && (
              <FundActControl access={access} act="fund_report.issue" testId={`draft-issue-refused-${d.uid}`} className="text-[12px] text-axal-muted">
                <button type="button" className={BTN.primary} disabled={busy} onClick={() => setMode('issue')} data-testid={`draft-issue-${d.uid}`}>Issue</button>
              </FundActControl>
            )}
          </div>
          {mode && (
            <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (mode === 'prepare') run(async () => { await apis.reporting.prepare(d.uid, { figures_sha256: sha, note: t || undefined }); await done(); }, 'The draft could not be prepared.');
              if (mode === 'return') run(async () => { await apis.reporting.returnDraft(d.uid, t); await done(); }, 'The draft could not be returned.');
              if (mode === 'issue') run(async () => { await apis.reporting.issue(d.uid, { figures_sha256: sha, acknowledgement: t || undefined }); await done(); }, 'The draft could not be issued.');
            }}>
              <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
                {mode === 'prepare' ? 'A note for the reviewer (optional)' : mode === 'return' ? 'Why it goes back' : 'What you checked (needed when lines are unmatched)'}
                <input className={`${INPUT} mt-1`} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} data-testid={`draft-text-${d.uid}`} />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN.ghost} onClick={() => setMode(null)} disabled={busy}>Cancel</button>
                <button type="submit" className={mode === 'return' ? BTN.danger : BTN.primary} data-testid={`draft-submit-${d.uid}`}
                  disabled={busy || (mode === 'return' && text.trim().length < REJECT_REASON_MIN)}>{mode === 'prepare' ? 'Prepare' : mode === 'return' ? 'Return' : 'Issue'}</button>
              </div>
            </form>
          )}
        </div>
      )}
      <Alert text={error} />
    </div>
  );
}

export function ReportsTab({ apis, access, funds, fund, overview, onFund }) {
  const read = useRead(() => (fund ? apis.reporting.list({ fund_id: fund.id }) : Promise.resolve({ items: [] })), [apis, fund?.id]);
  const items = read.data?.items || [];
  return (
    <FundFrame funds={funds} fund={fund} overview={overview} onFund={onFund}>
      {fund && <div data-testid="reports">
        <Group label={`${fund.name} · reporting queue`}>
          {read.status === 'loading' ? <Busy />
            : read.status === 'unreadable' ? <Failed read={read} what="The reporting queue" claim="This is not a claim that nothing waits for review." />
              : items.length === 0 ? <Row a="No draft yet" b="A draft is built from the fund's ledger; issued periods stay on the fund's report pages." />
                : items.map((d) => <DraftRow key={d.uid} d={d} apis={apis} access={access} onChanged={read.reload} />)}
        </Group>
      </div>}
    </FundFrame>
  );
}
