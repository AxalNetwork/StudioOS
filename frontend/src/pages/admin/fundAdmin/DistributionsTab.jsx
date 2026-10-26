import { useMemo, useState } from 'react';
import { Lightbox, Pill } from '../../../ui';
import { RunningTotal } from '../../../ui/Charts';
import { FundActControl } from '../../../lib/fundActs';
import { parseDollarsToCents } from '../../investor/fundCallsModel';
import { BTN, INPUT } from '../../account/AccountCenter';
import { refusalText } from './fundAdminModel';
import { Line, NUM, Note, Panel, TH, Table } from './parts';
import { useRead } from './useRead';
import { Busy, Failed, FundFrame, LABEL } from './FundTabs';
import { ChartBlock } from './ChartBlock';
import {
  EXECUTE_FOOT, MARK_PAID_INFO, NOTICE_FINAL, NOT_RECORDED, PAGE_SIZES, TAX_CHARACTERS,
  cumulativeDistributions, distributionRows, lpName, money, refusedNotice,
} from './callsModel';

/**
 * D1163 (#3070, part 6 of #2388) — Distributions drawn in place (FND9).
 *
 * The proceeds and "Where every cent goes" are the job's own arithmetic
 * (`POST /api/fund-admin/funds/:id/distribution-preview`); the per-LP preview
 * names each LP (D1159's `lp_name`) with its share, and its total is the sum
 * of its lines. Execute is the Super Admin's, after the step-up; an Admin
 * reads "A Super Admin executes distributions." Mark paid asks first and
 * records; it moves no money. A paid line's notice is previewed by any Admin
 * and issued by a Super Admin.
 */
const INFO = 'm-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100';

/** "Where every cent goes": each figure the job would write, and what no line received. */
function SplitView({ split }) {
  const r = Number(split.carry_rate);
  const rate = split.carry_rate != null && Number.isFinite(r) ? `${(r * 100).toFixed(2)}%` : null;
  const rows = [
    ['Proceeds', money(split.proceeds_cents), null],
    ['Basis returned', money(split.basis_returned_cents), null],
    ['Profit', money(split.profit_cents), null],
    ['Carry withheld', money(split.carry_withheld_cents), !rate ? 'The rate is not recorded in this preview.' : split.carry_rate_defaulted
      ? <span data-testid="carry-defaulted">{`at ${rate}, the job’s 20% default, because the fund records no carry rate`}</span> : `at ${rate}, the fund’s recorded carry rate`],
    ['To the LPs', money(split.distributable_cents), null],
  ];
  return (
    <Panel label="Where every cent goes" sub={split.proceeds_cents != null ? `${money(split.proceeds_cents)} in proceeds` : null} testId="distribution-where">
      {rows.map(([k, v, note]) => <Line key={k} a={k} b={note} figure={v} />)}
      {!split.distributable && <Line a="Not distributable" b="No LP holds a commitment, so the job would write nothing." tone="danger" />}
      <Line a="Cents no line received" b={split.dropped_lp_ids?.length ? `${split.dropped_lp_ids.length} LP share rounded to zero and gets no line` : 'Every LP share is at least a cent'}
        figure={money(split.unallocated_cents)} />
    </Panel>
  );
}

/** The per-LP preview: each LP by name, its share, its amount, and a total that is the sum of the lines. */
function PerLp({ split }) {
  const d = distributionRows(split);
  if (!d.rows.length) return null;
  return (
    <Panel label="Per-LP preview" sub={`${d.rows.length} limited partner${d.rows.length === 1 ? '' : 's'}`} testId="distribution-preview">
      <Table cols={[
        { key: 'lp', label: 'LP', cell: (l) => l.name },
        { key: 'share', label: 'Share', align: 'right', mono: true, cell: (l) => l.pct },
        { key: 'amount', label: 'Amount', align: 'right', mono: true, cell: (l) => money(l.amount_cents) },
      ]} rows={d.rows} rowKey={(l) => l.lp_id} template="1.6fr .8fr 1fr" rowTestId={(l) => `distribution-line-${l.lp_id}`}
      foot={<div className="grid grid-cols-[1fr_auto] items-center bg-[#faf9fc] px-4 py-3 sm:grid-cols-[1.6fr_.8fr_1fr] sm:px-5 dark:bg-gray-950/40">
        <div className="text-[11.5px] font-extrabold text-axal-ink dark:text-gray-100">Total</div>
        <div className="hidden sm:block" />
        <div className={`text-right text-[12px] font-extrabold text-axal-ink dark:text-gray-100 ${NUM}`} data-testid="distribution-preview-total">{d.totalText}</div>
      </div>} />
      <Note testId="distribution-preview-balance">{d.balances === false
        ? 'The lines and the cents no line received do not add up to what goes to the LPs. Do not execute; preview again.'
        : 'The total equals the sum of its lines.'}</Note>
    </Panel>
  );
}

/** Mark paid asks first: it records that this payment was made. */
function MarkPaidDialog({ apis, row, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setBusy(true); setError('');
    try { await apis.funds.markPaid(row.id); await onDone(); } catch (e) { setError(refusalText(e, 'The line could not be marked paid.')); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Mark paid" title={`Mark paid · ${lpName(row)}`} sub={`${money(row.amount_cents)} · ${row.distribution_type || 'type not recorded'}`}
      testId="distribution-mark-dialog" onClose={onClose} width={440}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className={INFO}>{MARK_PAID_INFO}</p>
        {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN.primary} onClick={confirm} disabled={busy} data-testid="distribution-mark-confirm">Mark paid</button>
        </div>
      </div>
    </Lightbox>
  );
}

/**
 * A paid line's distribution notice: its tax character and page size, the
 * draft as the Worker renders it, then Issue by the figures it showed. A
 * refusal is L6: "This notice can't issue: …", and Issue is replaced by it.
 */
function DistributionNoticeDialog({ apis, access, row, onClose }) {
  const [tax, setTax] = useState('');
  const [page, setPage] = useState('letter');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const body = () => ({ type: 'distribution_notice', source: { distribution_id: row.id }, inputs: { tax_character: tax }, page_size: page });
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(refusalText(e, fallback)); } finally { setBusy(false); }
  };
  const doPreview = () => {
    if (!tax) { setError('Pick the distribution’s tax character.'); return; }
    run(async () => setPreview(await apis.notices.preview(body())), 'The notice could not be previewed.');
  };
  const issue = () => run(async () => setDone(await apis.notices.issue({ ...body(), figures_sha256: preview.figures_sha256 })), 'The notice could not be issued.');
  const change = (fn) => (e) => { fn(e.target.value); setPreview(null); setDone(null); };
  return (
    <Lightbox label="Distribution notice" title={`Distribution notice · ${lpName(row)}`} sub={`${money(row.amount_cents)} · paid ${String(row.distributed_at || '').slice(0, 10) || 'date not recorded'}`}
      testId="distribution-notice-dialog" onClose={onClose} width={640}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <label className={LABEL}>Tax character
          <select className={`${INPUT} mt-1`} value={tax} onChange={change(setTax)} disabled={busy} data-testid="distribution-notice-tax">
            <option value="">Choose one</option>
            {TAX_CHARACTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className={LABEL}>Page size
          <select className={`${INPUT} mt-1`} value={page} onChange={change(setPage)} disabled={busy} data-testid="distribution-notice-page">
            {PAGE_SIZES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {preview && <>
          {preview.refusal && <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="distribution-notice-refused">{refusedNotice(preview.refusal)}</p>}
          {/* The Worker's own HTML, drawn in a frame that runs no script: the printed page, white in both themes. */}
          <iframe title="Notice preview" sandbox="" srcDoc={preview.html} className="h-[420px] w-full rounded-axal-sm border border-axal-hairline bg-white dark:border-gray-800 dark:bg-white" data-testid="distribution-notice-frame" />
        </>}
        <p className={INFO}>{NOTICE_FINAL}</p>
        {done && <p role="status" className="m-0 text-[12.5px] text-axal-positive dark:text-emerald-300" data-testid="distribution-notice-done">{done.already_issued ? 'This notice was already issued, with these figures.' : 'The notice is issued.'}</p>}
        {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="distribution-notice-error">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={doPreview} disabled={busy} data-testid="distribution-notice-preview">Preview notice</button>
          {preview && !preview.refusal && !done && (
            <FundActControl access={access} act="fund_notice.issue" testId="distribution-notice-issue-refused" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">
              <button type="button" className={BTN.primary} onClick={issue} disabled={busy} data-testid="distribution-notice-issue">Issue notice</button>
            </FundActControl>
          )}
        </div>
      </div>
    </Lightbox>
  );
}

const DIST_SUB = 'Preview a split before it is executed: where every cent goes, at the rate the job uses. Any Admin previews, marks a line paid and previews its notice; a Super Admin executes and issues.';

export function DistributionsTab({ apis, access, fund, overview }) {
  const list = useRead(() => (fund ? apis.funds.distributions(fund.id) : Promise.resolve({ items: [] })), [apis, fund?.id]);
  const [proceeds, setProceeds] = useState('');
  const [split, setSplit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
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
  // Exactly the proceeds whose split is on screen.
  const execute = () => run(async () => {
    await apis.funds.execute({ fund_id: fund.id, proceeds_cents: split.proceeds_cents });
    setSplit(null); setProceeds(''); await list.reload();
  }, 'The distribution could not be executed.');
  const items = list.data?.items || [];
  const cum = useMemo(() => cumulativeDistributions(items), [items]);
  const cols = [
    { key: 'date', label: 'Date', mono: true, cell: (d) => String(d.distributed_at || d.created_at || '').slice(0, 10) || NOT_RECORDED },
    { key: 'lp', label: 'LP', cell: (d) => lpName(d) },
    { key: 'type', label: 'Type', cell: (d) => d.distribution_type || 'type not recorded' },
    { key: 'amount', label: 'Amount', align: 'right', mono: true, cell: (d) => money(d.amount_cents) },
    { key: 'status', label: 'Status', cell: (d) => <Pill tone={d.status === 'paid' ? 'ok' : 'neutral'}>{d.status === 'paid' ? 'Paid' : 'Pending'}</Pill> },
    { key: 'action', label: '', align: 'right', cell: (d) => (d.status === 'pending' ? (
      <FundActControl access={access} act="distribution.mark_paid" testId={`distribution-mark-refused-${d.id}`}>
        <button type="button" className={BTN.ghost} disabled={busy} data-testid={`distribution-mark-paid-${d.id}`} onClick={() => setDialog({ kind: 'mark', row: d })}>Mark paid</button>
      </FundActControl>
    ) : d.status === 'paid' ? (
      <button type="button" className={BTN.ghost} data-testid={`distribution-notice-${d.id}`} onClick={() => setDialog({ kind: 'notice', row: d })}>Notice</button>
    ) : <span className="text-axal-muted">—</span>) },
  ];
  return (
    <FundFrame title="Distributions" testId="distributions-section" fund={fund} overview={overview} sub={DIST_SUB}>
      {fund && <div className="flex flex-col gap-4" data-testid="distributions">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_1fr]">
          <div className="rounded-axal-xl border border-axal-hairline bg-white px-4 py-4 sm:px-5 dark:border-gray-800 dark:bg-gray-900">
            <div className={TH}>Proceeds</div>
            <form id="distribution-form" className="mt-3 flex flex-col gap-2.5" onSubmit={preview}>
              <label className={LABEL}>Proceeds ($)
                <input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={proceeds} onChange={(e) => { setProceeds(e.target.value); setSplit(null); }} disabled={busy} data-testid="distribution-proceeds" />
              </label>
              <button type="submit" className={BTN.ghost} disabled={busy} data-testid="distribution-preview-submit">Preview</button>
            </form>
            {split && split.distributable && (
              <div className="mt-4 border-t border-axal-hairline pt-3.5 dark:border-gray-800">
                <p className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">The job pays these lines. Nothing is sent from here: each line is marked paid when the money has gone.</p>
                <div className="mt-2.5">
                  <FundActControl access={access} act="distribution.execute" testId="distribution-execute-refused" className="text-[12px] text-axal-muted">
                    <button type="button" className={`${BTN.primary} w-full`} disabled={busy} onClick={execute} data-testid="distribution-execute">Execute distribution</button>
                    <p className="mt-2 text-[11px] text-axal-muted dark:text-gray-400" data-testid="distribution-execute-foot">{EXECUTE_FOOT}</p>
                  </FundActControl>
                </div>
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
          </div>
          {split ? <SplitView split={split} />
            : <Panel label="Where every cent goes"><Note>Enter the proceeds and Preview. The split is the job’s own arithmetic: basis returned, profit, carry withheld and each LP’s line.</Note></Panel>}
        </div>
        {split && <PerLp split={split} />}
        <Panel label="Distribution notices" testId="distribution-notices">
          <Note>Preview one notice per LP from a paid line’s Notice, then issue. {NOTICE_FINAL}</Note>
          <Line a="Issue a distribution notice" b={<FundActControl access={access} act="fund_notice.issue" testId="distribution-notices-refused">
            <span data-testid="distribution-notices-allowed">You issue each notice after its preview and your step-up.</span>
          </FundActControl>} />
        </Panel>
        <Panel label="Distributions" testId="distributions-list">
          {list.status === 'loading' ? <Busy />
            : list.status === 'unreadable' ? <Failed read={list} what="This fund's distributions" claim="This is not a claim that none was made." />
              : items.length === 0 ? <Note>No distribution yet. An executed distribution writes one line per LP.</Note>
                : <Table cols={cols} rows={items} rowKey={(d) => d.id} template="1fr 1.4fr 1.2fr 1fr .9fr .9fr" rowTestId={(d) => `distribution-${d.id}`} />}
          {items.some((d) => d.status === 'pending') && <Note>Mark paid asks first: it marks this payment as made. It records; it moves no money.</Note>}
        </Panel>
        {list.status === 'ready' && (
          <ChartBlock title="Cumulative distributions" testId="distribution-cumulative" note={cum.note} alt={cum.alt} table={cum.table}>
            {cum.empty ? null : <RunningTotal points={cum.points} />}
          </ChartBlock>
        )}
      </div>}
      {dialog?.kind === 'mark' && <MarkPaidDialog apis={apis} row={dialog.row} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await list.reload(); }} />}
      {dialog?.kind === 'notice' && <DistributionNoticeDialog apis={apis} access={access} row={dialog.row} onClose={() => setDialog(null)} />}
    </FundFrame>
  );
}
