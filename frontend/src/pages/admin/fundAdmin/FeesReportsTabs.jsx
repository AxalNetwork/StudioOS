import { ReadFailure as Unreadable } from './parts';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Lightbox, Pill, Unrecorded } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { bpsPercent } from '../../../lib/bps';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { Banner } from '../../account/ConnectorSheet';
import { NO_FUND, QUARTER_RE, REJECT_REASON_MIN, money, refusalText, keepFund } from './fundAdminModel';
import { Line, NUM, Note, Panel, Section, Table } from './parts';
import { useRead } from './useRead';

// D1165: the remaining fund tabs, drawn from the approved FND13/FND14 boards.
const amount = (cents) => money(cents) ?? 'Not recorded';
const LABEL = 'text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200';
function Busy() { return <div className="px-4 py-3" aria-busy="true"><LoadingRows lines={3} /></div>; }
function Failed({ read, what, claim }) { return <Note><Unreadable what={what} claim={claim} onRetry={read.reload} /></Note>; }
function Alert({ text }) { return text ? <p role="alert" className="px-4 py-3 text-sm text-red-700 dark:text-red-300">{text}</p> : null; }

function FundFrame({ title, sub, testId, fund, overview, children }) {
  let body = children;
  if (overview.status === 'loading' || overview.status === 'idle') body = <LoadingRows lines={3} />;
  else if (overview.status === 'unreadable' || overview.data?.funds?.state !== 'ok') {
    body = <div data-testid="funds-unreadable"><Unreadable what="The administered funds" claim="This is not a claim that there is none." onRetry={overview.reload} /></div>;
  } else if (!fund) body = <Banner tone="neutral" data-testid="no-administered-fund">{NO_FUND}</Banner>;
  return <Section title={fund ? `${title} · ${fund.name}` : title} sub={sub} testId={testId}>{body}</Section>;
}

export function FeesTab({ apis, access, funds, fund, overview, onFund }) {
  const read = useRead(() => (fund ? apis.fees.state(fund.id) : Promise.resolve(null)), [apis, fund?.id]);
  const [quarter, setQuarter] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [selected, setSelected] = useState('');
  const [lpQuery, setLpQuery] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(refusalText(e, fallback)); } finally { setBusy(false); }
  };
  const s = read.data;
  const admissions = (s?.lps || []).filter(l => String(l.id).includes(lpQuery.trim()));
  const missing = (s?.lps || []).filter((l) => l.admission_missing).length;
  const termCols = [
    { key: 'rate', label: 'Terms', cell: (t) => `${bpsPercent(t.annual_bps) ?? 'Rate not recorded'} a year from ${t.effective_from}` },
    { key: 'lpa', label: 'LPA', cell: (t) => t.lpa_reference || 'No LPA reference recorded' },
    { key: 'status', label: 'Status', cell: (t) => <Pill tone={t.status === 'confirmed' ? 'ok' : 'neutral'}>{t.status}</Pill> },
    { key: 'action', label: 'Action', align: 'right', cell: (t) => (t.status === 'draft' ? (
      <FundActControl access={access} act="fee_terms.confirm" testId={`fee-terms-refused-${t.uid}`} className="text-[12px] text-axal-muted">
        <button type="button" className={BTN.primary} disabled={busy} data-testid={`fee-terms-confirm-${t.uid}`}
          onClick={() => setConfirmation({ terms: t.uid })}>Confirm</button>
      </FundActControl>) : <span className="text-axal-muted">—</span>) },
  ];
  const periodCols = [
    { key: 'quarter', label: 'Period', mono: true, cell: (p) => `${p.quarter} · net ${amount(p.net_cents)}` },
    { key: 'window', label: 'Window', mono: true, cell: (p) => p.window_start && p.window_end ? `${p.window_start} to ${p.window_end}` : 'Not recorded: no complete period window.' },
    { key: 'ref', label: 'Reference', mono: true, cell: (p) => p.remittance_reference || 'no reference yet' },
    { key: 'status', label: 'Status', cell: (p) => <Pill tone={p.status === 'paid' ? 'ok' : 'neutral'}>{p.status}</Pill> },
    { key: 'open', label: 'Lines', cell: (p) => <button type="button" className={BTN.link} data-testid={`fee-period-open-${p.quarter}`} onClick={() => setSelected(p.quarter)}>Open</button> },
  ];
  return (
    <FundFrame title="Management fees" testId="fees-section" funds={funds} fund={fund} overview={overview} onFund={onFund}
      sub="The fee terms, the LPs' admission dates and each quarter's period. A Super Admin confirms terms and issues a period; any Admin prepares and previews.">
      {fund && <div className="flex flex-col gap-4" data-testid="fees">
        {read.status === 'loading' ? <LoadingRows lines={3} />
          : read.status === 'unreadable' ? <Unreadable what="This fund's management fee" claim="This is not a claim that no fee is due." onRetry={read.reload} />
            : <div className="grid gap-4 lg:grid-cols-2">
              <Panel label="Fee terms" testId="fee-terms">
                {(s?.terms || []).length === 0 ? <Note><Unrecorded>No terms recorded</Unrecorded></Note>
                  : <Table cols={termCols} rows={s.terms} rowKey={(t) => t.uid} template="1.6fr 1fr .8fr 1.2fr" rowTestId={(t) => `fee-terms-${t.uid}`} />}
                {missing > 0 && <Line a="Admission dates" b={`${missing} LP${missing === 1 ? ' has' : 's have'} no admission date recorded.`} tone="danger" />}
              </Panel>
              <Panel label="Fee periods" testId="fee-periods">
                {(s?.periods || []).length === 0 ? <Note><Unrecorded>No fee period yet</Unrecorded></Note>
                  : <Table cols={periodCols} rows={s.periods} rowKey={(p) => p.quarter} template="1.4fr 1.4fr 1fr .8fr .5fr" rowTestId={(p) => `fee-period-${p.quarter}`} />}
              </Panel>
              <Panel label="Admission and net invested" testId="fee-admissions">
                <div className="p-4"><input className={INPUT} aria-label="Search admission LP ids" placeholder="Search LP ids" value={lpQuery} onChange={e => setLpQuery(e.target.value)} /></div>
                <Note>Net invested: {amount(s?.net_invested?.[0]?.net_invested_cents)}{s?.net_invested?.[0]?.as_of ? ` · as of ${s.net_invested[0].as_of}` : ' · No dated net invested capital is recorded.'}</Note>
                {admissions.length ? <Table cols={[
                  { key: 'lp', label: 'LP', cell: l => `LP #${l.id}` },
                  { key: 'admitted', label: 'Admitted', cell: l => l.admitted_on || <Unrecorded>No admission date recorded</Unrecorded> },
                  { key: 'commitment', label: 'Commitment', mono: true, cell: l => l.commitment_amount == null ? 'Not recorded' : amount(Math.round(Number(l.commitment_amount) * 100)) },
                ]} rows={admissions} rowKey={l => l.id} template="1fr 1fr 1fr" /> : <Note>{lpQuery ? 'No LP id matches this search.' : 'No LP admission recorded.'}</Note>}
                <Note>Net invested capital is recorded for the fund. The read does not attribute it to individual LPs.</Note>
              </Panel>
              <FeeLines key={selected || s?.periods?.[0]?.quarter || 'empty'} apis={apis} access={access} fund={fund} quarter={selected || s?.periods?.[0]?.quarter} />
              <div className="lg:col-span-2" id="fee-prepare">
              <Panel label="Prepare a quarter" testId="fee-prepare">
                <form className="flex flex-wrap items-end gap-2 px-4 py-3 sm:px-5" onSubmit={(e) => {
                  e.preventDefault();
                  const q = quarter.trim().toUpperCase();
                  if (!QUARTER_RE.test(q)) { setError('Enter a quarter as 2026Q3.'); return; }
                  run(async () => { setPreview(await apis.fees.previewPeriod(fund.id, q)); setSelected(q); await read.reload(); }, 'The quarter could not be previewed.');
                }}>
                  <label className={LABEL}>Quarter
                    <input className={`${INPUT} mt-1 w-32 ${NUM}`} placeholder="2026Q3" value={quarter} onChange={(e) => { setQuarter(e.target.value); setPreview(null); }} disabled={busy} data-testid="fee-quarter" />
                  </label>
                  <FundActControl access={access} act="fee.write" testId="fee-preview-refused">
                    <button type="submit" className={BTN.ghost} disabled={busy} data-testid="fee-preview-submit">Preview</button>
                  </FundActControl>
                </form>
                {preview && <div data-testid="fee-preview">
                  <Line a={`${preview.quarter} · net ${amount(preview.totals?.net_cents)}`} b={<span className={NUM}>Gross {amount(preview.totals?.gross_cents)} · catch-up {amount(preview.totals?.catch_up_cents)} · offset applied {amount(preview.totals?.applied_cents)}</span>} />
                  <Line a="Issue this quarter" b="Issuing records the amounts and reference codes. Nothing moves money."
                    action={<FundActControl access={access} act="fee_period.issue" testId="fee-issue-refused" className="text-[12px] text-axal-muted">
                      <button type="button" className={BTN.primary} disabled={busy} data-testid="fee-issue"
                        onClick={() => setConfirmation({ preview })}>Issue</button>
                    </FundActControl>} />
                </div>}
                <Alert text={error} />
              </Panel>
              </div>
            </div>}
        {confirmation && <Lightbox phone="sheet" title={confirmation.terms ? 'Confirm fee terms?' : 'Issue fee period?'} label="Confirm fee change" testId="fee-confirmation" onClose={() => { if (!busy) setConfirmation(null); }}>
          <Note>{confirmation.terms ? 'Confirms these terms for the fund. Your authenticator check follows if needed.' : `Issues ${confirmation.preview.quarter} from the preview above, recording the amounts and reference codes. Nothing moves money. Your authenticator check follows if needed.`}</Note>
          <Alert text={error} />
          <div className="flex justify-end gap-2 p-4"><button type="button" className={BTN.ghost} disabled={busy} onClick={() => setConfirmation(null)}>Back</button>
            <FundActControl access={access} act={confirmation.terms ? 'fee_terms.confirm' : 'fee_period.issue'}>
              <button type="button" className={BTN.primary} disabled={busy} data-testid="fee-confirm-submit" onClick={() => run(async () => {
                if (confirmation.terms) await apis.fees.confirmTerms(fund.id, confirmation.terms);
                else { await apis.fees.issuePeriod(fund.id, confirmation.preview.quarter, confirmation.preview.digest); setPreview(null); }
                setConfirmation(null); await read.reload();
              }, 'The fee change could not be recorded.')}>{busy ? 'Recording…' : 'Confirm'}</button>
            </FundActControl>
          </div>
        </Lightbox>}
      </div>}
    </FundFrame>
  );
}

function DraftRow({ d, apis, access, onChanged, compact = false }) {
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
    <div data-testid={compact ? undefined : `draft-${d.uid}`}>
      {!compact && <Line a={`${d.period_label || 'Period not recorded'} · ${String(d.kind || '').replace(/_/g, ' ')}`} chip={<Pill>{d.status}</Pill>} />}
      <div className="flex flex-wrap gap-2">
          {d.fund_id && d.report_period_id && <Link className={BTN.link} to={`/funds/${d.fund_id}/reporting/${d.report_period_id}`} data-testid={`draft-period-${d.uid}`}>Report period</Link>}
          <button type="button" className={BTN.ghost} disabled={busy} data-testid={`draft-open-${d.uid}`}
            onClick={() => run(async () => setOpened(await apis.reporting.read(d.uid)), 'The draft could not be opened.')}>Open</button>
          <button type="button" className={BTN.ghost} disabled={busy} data-testid={`draft-export-${d.uid}`}
            onClick={() => run(() => apis.reporting.exportCsv(d.uid), 'The draft could not be exported.')}>Export</button>
      </div>
      {opened && (
        <Lightbox phone="sheet" width={760} title={d.period_label || 'Report pack'} label="Report pack" testId={`draft-opened-${d.uid}`} onClose={() => { if (!busy) { setOpened(null); setMode(null); } }}>
        <div className="px-5 py-4">
          <PackFigures figures={opened.figures} />
          <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Opened, and recorded in the audit log. Figures <span className={NUM}>{String(sha || '').slice(0, 12)}…</span></p>
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
              <p className="text-xs text-axal-muted dark:text-gray-400">{mode === 'issue' ? 'Issuing freezes these figures for the LPs. Your authenticator check follows if needed; a correction needs a new issue.' : mode === 'return' ? 'Returns this prepared pack to draft with your reason.' : 'Marks these figures prepared for a different reviewer to issue.'}</p>
              <label className={LABEL}>
                {mode === 'prepare' ? 'A note for the reviewer (optional)' : mode === 'return' ? 'Why it goes back' : 'What you checked (needed when lines are unmatched)'}
                <input className={`${INPUT} mt-1`} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} data-testid={`draft-text-${d.uid}`} />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN.ghost} onClick={() => setMode(null)} disabled={busy}>Cancel</button>
                <FundActControl access={mode === 'issue' ? access : null} act="fund_report.issue">
                  <button type="submit" className={mode === 'return' ? BTN.danger : BTN.primary} data-testid={`draft-submit-${d.uid}`}
                    disabled={busy || (mode === 'return' && text.trim().length < REJECT_REASON_MIN)}>{mode === 'prepare' ? 'Prepare' : mode === 'return' ? 'Return' : 'Issue'}</button>
                </FundActControl>
              </div>
            </form>
          )}
          <Alert text={error} />
        </div></Lightbox>
      )}
      {!opened && <Alert text={error} />}
    </div>
  );
}

export function ReportsTab({ apis, access, funds, fund, overview, onFund }) {
  const location = useLocation();
  const part = location.pathname.endsWith('/periods') ? 'periods' : location.pathname.endsWith('/notices') ? 'notices' : 'packs';
  const filtered = Boolean(keepFund(location.search));
  const Frame = part === 'packs' ? Section : FundFrame;
  const read = useRead(async () => { const data = await apis.reporting.list(filtered ? { fund_id: fund.id } : {}); if (!Array.isArray(data?.items)) throw new Error('The reporting queue could not be read.'); return data; }, [apis, fund?.id], { enabled: part === 'packs' && (!filtered || Boolean(fund)) });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('');
  const items = (read.data?.items || []).filter(d => (!status || d.status === status) && (!period || d.period_label === period) && `${d.period_label || ''} ${d.kind || ''} ${d.entity_key || ''}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Frame title="Reports" testId="reports-section" funds={funds} fund={fund} overview={overview} onFund={onFund}
      sub="The review queue: each draft built from the fund's records. Opening a draft is recorded. Any Admin prepares, returns and exports; a Super Admin who did not prepare it issues.">
      <nav aria-label="Reports" className="flex flex-wrap gap-2" data-testid="fund-admin-reports-parts">
        {[['packs', 'Packs'], ['periods', 'Report periods'], ['notices', 'Notices']].map(([key, label]) => <Link key={key} className={part === key ? BTN.primary : BTN.ghost} aria-current={part === key ? 'page' : undefined} data-testid={`reports-part-${key}`} to={`/admin/fund-admin/reports${key === 'packs' ? '' : `/${key}`}${keepFund(location.search)}`}>{label}</Link>)}
      </nav>
      {fund && part === 'periods' && <ReportPeriods apis={apis} fund={fund} />}
      {fund && part === 'notices' && <Notices apis={apis} fund={fund} />}
      {part === 'packs' && <div data-testid="reports">
        <Panel label="Packs · review queue" sub={read.status === 'ready' ? `${items.length} draft${items.length === 1 ? '' : 's'}` : null}>
          <div className="flex flex-wrap gap-2 p-4">
            <input className={INPUT} aria-label="Search packs" placeholder="Search packs" value={query} onChange={e => setQuery(e.target.value)} />
            <select className={INPUT} aria-label="Pack period" value={period} onChange={e => setPeriod(e.target.value)}><option value="">Every period</option>{[...new Set((read.data?.items || []).map(d => d.period_label).filter(Boolean))].map(v => <option key={v} value={v}>{v}</option>)}</select>
            <select className={INPUT} aria-label="Pack status" value={status} onChange={e => setStatus(e.target.value)}><option value="">Every status</option>{['draft', 'prepared', 'issued', 'superseded'].map(v => <option key={v} value={v}>{v}</option>)}</select>
          </div>
          {read.status === 'loading' ? <Busy />
            : read.status === 'unreadable' ? <Failed read={read} what="The reporting queue" claim="This is not a claim that nothing waits for review." />
              : items.length === 0 ? <Note>{query || status || period ? 'No pack matches these filters. Clear the search or status to see the queue.' : 'No draft yet. A draft is built from the fund’s ledger; issued periods stay on the fund’s report pages.'}</Note>
                : <Table cols={[
                  { key: 'pack', label: 'Pack', cell: d => `${d.period_label || 'Period not recorded'} · ${String(d.kind || '').replaceAll('_', ' ')}` },
                  { key: 'fund', label: 'Fund or entity', cell: d => d.entity_key || funds.find(f => Number(f.id) === Number(d.fund_id))?.name || (d.fund_id ? `Fund #${d.fund_id}` : 'Not recorded: no fund or entity.') },
                  { key: 'quarter', label: 'Quarter', mono: true, cell: d => d.period_label || 'Not recorded: no period label.' },
                  { key: 'status', label: 'Status', cell: d => <Pill tone={d.status === 'issued' ? 'ok' : d.status === 'prepared' ? 'warn' : 'neutral'}>{d.status}</Pill> },
                  { key: 'prepared', label: 'Prepared by', cell: d => d.prepared_by == null ? 'Not recorded: no preparer.' : `Admin #${d.prepared_by}` },
                  { key: 'date', label: 'Date', mono: true, cell: d => d.prepared_at || d.created_at || 'Not recorded: no date.' },
                  { key: 'actions', label: 'Actions', cell: d => <DraftRow compact d={d} apis={apis} access={access} onChanged={read.reload} /> },
                ]} rows={items} rowKey={d => d.uid} rowTestId={d => `draft-${d.uid}`} template="1.6fr 1fr .9fr .8fr 1fr 1.1fr 1.3fr" />}
        </Panel>
      </div>}
    </Frame>
  );
}

function FeeLines({ apis, access, fund, quarter }) {
  const read = useRead(async () => { const data = await apis.fees.period(fund.id, quarter); if (!Array.isArray(data?.lines)) throw new Error('The fee lines could not be read.'); return data; }, [apis, fund.id, quarter], { enabled: Boolean(quarter) });
  const [statement, setStatement] = useState(null);
  const [lpQuery, setLpQuery] = useState('');
  const [sort, setSort] = useState('lp');
  const [statementLp, setStatementLp] = useState(null);
  const [linking, setLinking] = useState(false);
  const [callUid, setCallUid] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lines = (read.data?.lines || []).filter(l => String(l.limited_partner_id).includes(lpQuery.trim())).slice().sort((a, b) => sort === 'fee' ? (b.net_fee_cents ?? -Infinity) - (a.net_fee_cents ?? -Infinity) : a.limited_partner_id - b.limited_partner_id);
  const open = async (lp) => {
    setStatementLp(lp);
    setBusy(true); setError('');
    try { setStatement({ lp, data: await apis.fees.statement(fund.id, quarter, lp) }); }
    catch { setError('Unreadable: the fee statement could not be read. Try again.'); }
    finally { setBusy(false); }
  };
  return <Panel label={`${quarter || 'Period'} · lines and statements`} testId="fee-lines" aside={quarter ? <FundActControl access={access} act="fee.write"><button type="button" className={BTN.ghost} data-testid="fee-funding-link" onClick={() => setLinking(true)}>Funding call link</button></FundActControl> : null}>
    <div className="flex flex-wrap gap-2 p-4"><input className={INPUT} aria-label="Search fee-line LP ids" placeholder="Search LP ids" value={lpQuery} onChange={e => setLpQuery(e.target.value)} />
      <select className={INPUT} aria-label="Sort fee lines" value={sort} onChange={e => setSort(e.target.value)}><option value="lp">LP id</option><option value="fee">Net fee · highest first</option></select></div>
    {!quarter ? <Note>No fee period yet. Preview a quarter to record its draft lines.</Note>
      : read.status === 'loading' ? <Busy /> : read.status === 'unreadable' ? <Failed read={read} what="The fee lines" claim="The terms and periods remain above." />
        : <Table cols={[
          { key: 'lp', label: 'LP', cell: l => `LP #${l.limited_partner_id}` },
          ...[['commitment_cents', 'Commitment'], ['gross_fee_cents', 'Fee'], ['offset_cents', 'Offset'], ['net_fee_cents', 'Net fee']].map(([key, label]) => ({ key, label, mono: true, align: 'right', cell: l => amount(l[key]) })),
          { key: 'statement', label: 'Statement', cell: l => <button type="button" className={BTN.link} disabled={busy} data-testid={`fee-statement-${l.limited_partner_id}`} onClick={() => open(l.limited_partner_id)}>{l.status === 'draft' ? 'Draft · preview' : 'Open statement'}</button> },
        ]} rows={lines} rowKey={l => l.limited_partner_id} template="1fr 1fr 1fr 1fr 1fr 1fr" />}
    {read.status === 'ready' && !lines.length && <Note>{lpQuery ? 'No LP id matches this search.' : 'No fee line recorded for this period.'}</Note>}
    {!linking && <><Alert text={error} />{error && statementLp && <button type="button" className={BTN.link} onClick={() => open(statementLp)}>Try again</button>}</>}
    {linking && <Lightbox phone="sheet" title="Link a funding call" label="Link a funding call" testId="fee-funding-dialog" onClose={() => { if (!busy) setLinking(false); }}>
      <Note>Links this fee period to an already recorded capital call. It records paid lines only where the received call amount covers the fee. It moves no money.</Note>
      <form className="flex flex-col gap-3 p-4" data-testid="fee-funding-form" onSubmit={async e => {
        e.preventDefault(); if (!callUid.trim() || busy) return; setBusy(true); setError('');
        try { await apis.fees.linkFundingCall(fund.id, quarter, callUid.trim()); setLinking(false); setCallUid(''); await read.reload(); }
        catch { setError('The funding call could not be linked. Check the recorded call and try again.'); }
        finally { setBusy(false); }
      }}>
        <label className={LABEL}>Capital call UID<input className={INPUT} value={callUid} onChange={e => setCallUid(e.target.value)} data-testid="fee-funding-uid" /></label>
        <Alert text={error} />
        <FundActControl access={access} act="fee.write"><button type="submit" className={BTN.primary} disabled={busy || !callUid.trim()}>Link funding call</button></FundActControl>
      </form>
    </Lightbox>}
    {statement && <Lightbox phone="sheet" title={`${quarter} · LP #${statement.lp}`} label="Fee statement" testId="fee-statement" onClose={() => setStatement(null)}>
      <Line a="Gross fee" figure={amount(statement.data.gross_fee_cents)} />
      <Line a="Offset" figure={amount(statement.data.offset_cents)} />
      <Line a="Net fee" figure={amount(statement.data.net_fee_cents)} />
      <Line a="Reference" b={statement.data.reference_code || 'Not recorded: no statement reference is recorded.'} />
      <Note>{statement.data.pay_to?.sentence || 'This statement records fees. It does not move money.'}</Note>
    </Lightbox>}
  </Panel>;
}

function PackFigures({ figures }) {
  const rows = [
    ['Committed', figures?.totals?.commitments], ['Called to date', figures?.totals?.called_to_date],
    ['Contributed this quarter', figures?.totals?.contributed_in_quarter],
    ...Object.entries(figures?.fund_figures || {}).filter(([, v]) => v && typeof v === 'object' && ('cents' in v || 'reason' in v)),
  ];
  return <div>{rows.map(([label, value]) => <Line key={label} a={label.replaceAll('_', ' ')} figure={amount(value?.cents)} b={value?.cents == null ? value?.reason || 'No figure is recorded in this pack.' : null} />)}</div>;
}

function ReportPeriods({ apis, fund }) {
  const read = useRead(async () => { const data = await apis.reports.periods(fund.id); if (!Array.isArray(data?.items)) throw new Error('The report periods could not be read.'); return data; }, [apis, fund.id]);
  return <Panel label="Report periods" testId="reports-periods" aside={<Link className={BTN.ghost} to={`/funds/${fund.id}/reporting/new`}>New report period</Link>}>
    <Note>Save the quarterly letter as a draft on its report period page. A Super Admin issues through the reviewed pack.</Note>
    {read.status === 'loading' ? <Busy /> : read.status === 'unreadable' ? <Failed read={read} what="The report periods" claim="Packs and notices can still be opened." />
      : !read.data?.items?.length ? <Note>No report period recorded yet.</Note> : read.data.items.map(p => <Line key={p.id} a={p.period} b={p.issued_at ? `Issued ${p.issued_at}` : 'Not issued yet'} chip={<Pill tone={p.status === 'issued' ? 'ok' : 'neutral'}>{p.status || 'Not recorded'}</Pill>} action={<Link className={BTN.link} to={`/funds/${fund.id}/reporting/${p.id}`}>Open report period</Link>} />)}
  </Panel>;
}

function Notices({ apis, fund }) {
  const read = useRead(async () => { const data = await apis.notices.list({ fundId: fund.id }); if (!Array.isArray(data?.notices)) throw new Error('The notices could not be read.'); return data; }, [apis, fund.id]);
  const [opened, setOpened] = useState(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [lp, setLp] = useState('');
  const notices = read.data?.notices || [];
  const visible = notices.filter(n => (!type || n.type === type) && (!lp || String(n.limited_partner_id) === lp) && `${n.title || n.type} ${n.reference || ''}`.toLowerCase().includes(query.toLowerCase()));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch { setError('Unreadable: the notice could not be read. Try again.'); } finally { setBusy(false); } };
  const download = (uid) => run(async () => {
    const { blob, filename } = await apis.notices.pdfBlob(uid);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  return <Panel label="Notices" testId="reports-notices">
    <div className="flex flex-wrap gap-2 p-4">
      <input className={INPUT} aria-label="Search notices" placeholder="Search notices" value={query} onChange={e => setQuery(e.target.value)} />
      <select className={INPUT} aria-label="Notice type" value={type} onChange={e => setType(e.target.value)}><option value="">Every type</option>{[...new Set(notices.map(n => n.type))].map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select>
      <select className={INPUT} aria-label="Notice LP" value={lp} onChange={e => setLp(e.target.value)}><option value="">Every LP</option>{[...new Set(notices.map(n => n.limited_partner_id).filter(v => v != null))].map(v => <option key={v} value={v}>LP #{v}</option>)}</select>
    </div>
    {read.status === 'loading' ? <Busy /> : read.status === 'unreadable' ? <Failed read={read} what="The notices" claim="Packs and report periods can still be opened." />
      : !visible.length ? <Note>{notices.length ? 'No notice matches these filters. Clear the filters to see the list.' : 'No notice recorded yet. Issued notices appear here.'}</Note> : <Table cols={[
        { key: 'type', label: 'Type', cell: n => n.title || n.type },
        { key: 'lp', label: 'LP or fund', cell: n => n.limited_partner_id ? `LP #${n.limited_partner_id}` : fund.name },
        { key: 'reference', label: 'Reference', mono: true, cell: n => n.reference || 'Not recorded: no reference was recorded.' },
        { key: 'amount', label: 'Amount', mono: true, cell: n => n.amount_cents == null ? <Unrecorded reason="No amount is recorded for this notice." /> : amount(n.amount_cents) },
        { key: 'date', label: 'Date', mono: true, cell: n => n.notice_date || 'Not recorded: no notice date was recorded.' },
        { key: 'open', label: 'Figures', cell: n => <button type="button" className={BTN.link} disabled={busy} data-testid={`notice-open-${n.uid}`} onClick={() => run(async () => setOpened(await apis.notices.one(n.uid)))}>Open</button> },
      ]} rows={visible} rowKey={n => n.uid} template="1.2fr 1fr 1.3fr 1fr 1fr .5fr" />}
    {!opened && <Alert text={error} />}
    {opened && <Lightbox phone="sheet" title={opened.title || 'Notice'} label="Notice figures" testId="notice-figures" onClose={() => { if (!busy) setOpened(null); }}>
      <Line a="Amount" figure={amount(opened.figures?.amount_cents)} />
      <Line a="Reference" b={opened.reference || 'Not recorded: no reference was recorded.'} />
      <Line a="Date" b={opened.notice_date || 'Not recorded: no notice date was recorded.'} />
      <Note>{opened.superseded ? 'Superseded. A later notice corrects this one.' : 'Issued notice. Its figures are kept as issued.'}</Note>
      <Alert text={error} />
      <div className="p-4"><button type="button" className={BTN.ghost} disabled={busy} data-testid="notice-pdf" onClick={() => download(opened.uid)}>PDF</button></div>
    </Lightbox>}
  </Panel>;
}
