import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import WorkspaceShell from '../workspaces/WorkspaceShell';
import WorkerRail from '../ui/WorkerRail';
import { api } from '../lib/api';
import { readableFund, useFundReport } from '../hooks/useFundReport';
import { fundDraftsApi } from '../lib/api/fundDrafts.js';
import FundDraftBand from './FundDraftBand';
import { EditTermsCard } from './investor/FundTermsForm';
import { fundFactsEditHref } from './admin/fundAdmin/fundAdminModel';
import './fundPage.css';
import FundPageReadings, { PerformanceBand, FundPositionsSummary, LpPosition } from './FundPageReadings';
import { DataState } from '../ui/Honesty';
import { fmtRate } from '../lib/fundAnalytics';

export function fundMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  const value = BigInt(cents);
  return `$${(value / 100n).toLocaleString('en-US')}.${String(value % 100n).padStart(2, '0')}`;
}
export function Recorded({ value, reason }) {
  return value !== null && value !== undefined && value !== '' ? <span>{value}</span>
    : <span><b>Not recorded</b><small>{reason}</small></span>;
}
/** #6247: a period's line says when it was issued, or that it is a draft (only a manager reads drafts). */
export function periodIssue(period) {
  if (period.status === 'draft') return 'Draft · not issued';
  return period.issued_at ? `Issued ${String(period.issued_at).slice(0, 10)}` : 'Issued · date not recorded';
}
/**
 * #6247: where this page hands its reader next. Each link is shown only to a reader its destination admits:
 * a manager (can_manage, so `requireFundGp` passed: the GP of record on the institutional tier, or an admin)
 * gets the fund's working zones, each opened on this fund with `?fund=`; an LP gets their own commitment and
 * statements; everyone who can read the fund gets its performance (#6245, owner answer C: LPs and GPs both).
 * An admin edits fund facts in the admin console's dialog; a GP of record who is not an admin edits the terms
 * here (#6235), with Edit terms.
 */
export function fundHandoffs(page, role) {
  const id = page.fund.id;
  const links = page.can_manage ? [
    { to: `/funds/${id}/reporting/new`, label: 'New reporting period', testid: 'link-fund-new-period' },
    { to: `/funds/reporting?fund=${id}`, label: 'Reporting archive', testid: 'link-fund-reporting' },
    { to: `/funds/lps?fund=${id}`, label: 'Open LPs', testid: 'link-fund-lps' },
    { to: `/funds/calls?fund=${id}`, label: 'Capital calls', testid: 'link-fund-calls' },
    { to: `/funds/ledger?fund=${id}`, label: 'Ledger and distributions', testid: 'link-fund-ledger' },
  ] : [{ to: '/spinout-lab/investor-workspace', label: 'My commitment and statements', testid: 'link-fund-my-commitment' }];
  links.push({ to: '/funds/performance', label: 'Fund performance', testid: 'link-fund-performance' });
  const edit = !page.can_manage ? null : role === 'admin'
    ? { to: fundFactsEditHref(id), label: 'Edit fund facts', testid: 'link-fund-edit-facts' }
    : { action: 'Edit terms', testid: 'button-fund-edit-terms' };
  return { links, edit };
}
export function FundReadState({ reading }) {
  if (reading.loading) return <div className="fd-card" aria-busy="true">Loading fund records…</div>;
  if ([403, 404].includes(reading.error?.status)) return <div className="fd-card"><DataState state="refused" reason="Fund not available. This account cannot read that fund or reporting period." /></div>;
  return <div className="fd-card"><DataState state="unavailable" reason="The fund records could not be read." onRetry={reading.reload} retryLabel="Try again" size="block" /></div>;
}
export function FundNextAction({ page }) {
  const draft = page.periods.find(p => p.status === 'draft');
  const issued = page.periods.find(p => p.status === 'issued');
  const id = page.fund.id;
  const next = !page.can_manage ? issued ? { label: `Read ${issued.period}`, to: `/funds/${id}/reporting/${issued.id}`, note: 'The latest issued report available to you.' } : null
    : page.fund.lp_count === 0 ? { label: 'Add the first LP', to: `/funds/lps?fund=${id}`, note: 'No LP is recorded for this fund yet.' }
      : draft ? { label: `Open ${draft.period} draft`, to: `/funds/${id}/reporting/${draft.id}`, note: `${draft.period} is a draft: finish and issue.` }
        : { label: 'New reporting period', to: `/funds/${id}/reporting/new`, note: 'Record the next reporting period.' };
  return next ? <section className="fd-card fd-next" data-testid="fund-page-next"><p>{next.note}</p><Link className="fd-inline-link" to={next.to}>{next.label}</Link></section> : null;
}
export function LpaReadFailure({ kind, retry }) {
  return <DataState state={kind} reason={kind === 'refused' ? 'This account cannot download the LPA. The rest of the fund page remains available.' : kind === 'not_recorded' ? 'No LPA body is stored for this fund.' : 'The LPA could not be downloaded.'} onRetry={kind === 'unavailable' ? retry : undefined} />;
}
export default function FundPage({ role = 'investor', reading: supplied }) {
  const { fundId } = useParams();
  const resource = useFundReport(fundId);
  const reading = supplied || resource;
  const page = !reading.loading && !reading.error && readableFund(reading.data) ? reading.data : null;
  const [download, setDownload] = useState({ busy: false, error: null });
  // #6235: Edit terms is open, and the line after a save (the page read again).
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // #6252 (D6252, Q1 answer A): the newest kept brief, read for whoever can manage the fund.
  const [note, setNote] = useState({ loading: false, note: null, error: null });
  const manageId = page?.can_manage ? page.fund.id : null;
  useEffect(() => {
    if (!manageId) return undefined;
    let live = true;
    setNote({ loading: true, note: null, error: null });
    fundDraftsApi.briefNote(manageId).then(
      (r) => { if (live) setNote({ loading: false, note: r?.note ?? null, error: null }); },
      () => { if (live) setNote({ loading: false, note: null, error: 'Unreadable: the fund note could not be read.' }); },
    );
    return () => { live = false; };
  }, [manageId]);
  const keepBrief = async (_text, draft) => {
    try {
      const r = await fundDraftsApi.keepBrief(page.fund.id, draft);
      setNote({ loading: false, note: r?.note ?? null, error: null });
      return null;
    } catch (failure) {
      return [403, 404, 409, 422, 503].includes(failure?.status) && failure?.message ? failure.message : 'The brief could not be kept. Nothing was written. Try again.';
    }
  };
  const openLpa = async () => {
    setDownload({ busy: true, error: null });
    try { await api.downloadFundLpa(page.fund.id); setDownload({ busy: false, error: null }); }
    catch (error) { setDownload({ busy: false, error: error?.status === 403 ? 'refused' : error?.status === 404 ? 'not_recorded' : 'unavailable' }); }
  };
  return <div className="fd-surface"><WorkspaceShell role={role} activeSlug={null} sectionNav={page?.can_manage ? undefined : null} title={page?.fund.name || 'Fund page'}
    intro="Recorded fund facts, the general partner of record and service providers."
    rail={<WorkerRail role="investor" workspace="Fund" stance="Recorded fund facts" coverage={page ? ['Fund record and live totals read'] : []}
      note="Missing providers are shown as Not recorded. Failed reads are Unavailable." />}>
    {reading.loading || reading.error || !page ? <FundReadState reading={reading} /> : <>
      <FundNextAction page={page} />
      <section className="fd-facts" aria-label="Fund facts">
        <Fact label="Size · USD" value={fundMoney(page.fund.size_cents)} reason="The fund size has not been recorded." />
        <Fact label="Status" value={page.fund.status} pill reason="The fund status has not been recorded." />
        <Fact label="LPs · live count" value={page.fund.lp_count} />
        <Fact label="Vintage" value={page.fund.vintage_year} reason="The vintage year has not been recorded." />
      </section>
      {page.fund.lp_count === 0 && <p className="fd-empty" data-testid="text-fund-no-lp">No LP has committed yet.{page.can_manage && <> <Link to={`/funds/lps?fund=${page.fund.id}`} data-testid="link-fund-empty-lps">Open LPs</Link></>}</p>}
      <section className="fd-two" aria-label="Fund totals">
        <Fact label="Committed · USD" value={fundMoney(page.totals.committed_cents)} reason={page.totals.committed_reason} note="Sum of this fund’s recorded LP commitments." />
        <Fact label="Invested · USD" value={fundMoney(page.totals.invested_cents)} reason={page.totals.invested_reason} note="Original invested amounts on positions attributed to this fund." />
      </section>
      <FundPageReadings key={`${page.fund.id}:${page.can_manage}`} page={page}>{({ performance, positions, lp }) => <>
        <PerformanceBand reading={performance} />
        {page.can_manage ? <div className="fd-three">
          <div><FundGpFacts fund={page.fund} /><FundProviders fund={page.fund} /></div>
          <div><FundLpa page={page} download={download} open={openLpa} /><FundTerms page={page} /><OtherFundDocuments page={page} /></div>
          <div><FundPeriods page={page} /><FundPositionsSummary reading={positions} /></div>
        </div> : <div className="fd-two fd-reader-grid">
          <div><LpPosition reading={lp} fundId={page.fund.id} /><FundPeriods page={page} /><article className="fd-card"><h2>Positions and history</h2><p>Positions remain GP-only. Quarterly history is not available in this view yet; your issued reports remain available above.</p></article></div>
          <div><FundLpa page={page} download={download} open={openLpa} /><FundGpFacts fund={page.fund} /><FundProviders fund={page.fund} /><FundTerms page={page} /><OtherFundDocuments page={page} /></div>
        </div>}
      </>}</FundPageReadings>
      {page.can_manage && <FundDraftBand testId="fund-brief-band" title="Fund brief" run="Draft the brief"
        body="Draft a one-paragraph description of this fund from its recorded facts."
        writes="Accept writes a note. It changes no fund record."
        onRun={() => fundDraftsApi.brief(page.fund.id)} onAccept={keepBrief} />}
      {page.can_manage && <FundNote reading={note} />}
      {editing && <EditTermsCard fundId={page.fund.id} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); setSaved(true); reading.reload?.(); }} />}
      {saved && !editing && <p className="fd-saved" role="status" data-testid="text-fund-terms-saved">Terms saved. The page shows them as recorded.</p>}
      <FundHandoffs page={page} role={role} onEdit={() => { setSaved(false); setEditing(true); }} editing={editing} />
    </>}
  </WorkspaceShell></div>;
}
function FundNote({ reading }) {
  if (reading.loading) return null;
  if (reading.error) return <article className="fd-card" data-testid="fund-note"><h2>Fund brief · kept</h2><p role="alert">{reading.error}</p></article>;
  const n = reading.note;
  if (!n) return null;
  return <article className="fd-card" data-testid="fund-note"><h2>Fund brief · kept</h2>
    <p className="fd-draft-body">{n.body}</p>
    <small>Kept by <Recorded value={n.author?.name} reason="The author's name is not recorded." /> · <Recorded value={n.created_at} reason="The date is not recorded." /></small>
    {Array.isArray(n.sources) ? n.sources.length > 0 && <><h3>Drawn from</h3><ol className="fd-draft-sources">{n.sources.map((s) => <li key={s.n} value={s.n}>{s.label}{s.date ? ` · ${s.date}` : ''}</li>)}</ol></> : <p><b>Not recorded</b><small>The note's sources could not be read.</small></p>}
  </article>;
}
export function FundTerms({ page }) {
  return <article className="fd-card" data-testid="fund-page-terms"><h2>Terms</h2><dl>
    {[['management_fee', 'Management fee'], ['carried_interest', 'Carried interest']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Recorded value={page.terms?.[key] == null ? null : fmtRate(page.terms[key])} reason={page.terms?.[`${key}_reason`] || `${label} was not returned by this page read.`} /></dd></div>)}
  </dl><p className="fd-source">Recorded fund terms. These are terms, not a calculation of fees due.</p></article>;
}
function FundGpFacts({ fund }) {
  return <article className="fd-card"><h2>General partner of record</h2><dl>{[['name', 'Name'], ['title', 'Title'], ['entity', 'Entity'], ['email', 'Email']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Recorded value={fund.gp[key]} reason={`The GP ${label.toLowerCase()} has not been recorded.`} /></dd></div>)}</dl></article>;
}
function FundProviders({ fund }) {
  return <article className="fd-card"><h2>Service providers</h2><dl>{[['fund_admin', 'Fund administrator'], ['auditor', 'Auditor'], ['legal_counsel', 'Legal counsel'], ['custodian', 'Custodian'], ['valuation_policy', 'Valuation policy']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Recorded value={fund.providers[key]} reason={`${label} has not been recorded for this fund.`} /></dd></div>)}</dl></article>;
}
function FundLpa({ page, download, open }) {
  const lpa = page.documents?.find(d => d.kind === 'lpa') || page.lpa;
  return <article className="fd-card"><h2>Limited partnership agreement</h2>{lpa ? <>
    <dl>{[['status', 'Status'], ['version', 'Version'], ['updated_at', 'Updated']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Recorded value={lpa[key]} reason={`The LPA ${label.toLowerCase()} has not been recorded.`} /></dd></div>)}</dl>
    <button type="button" disabled={download.busy} onClick={open}>{download.busy ? 'Opening…' : 'Open LPA'}</button>
    {download.error && <LpaReadFailure kind={download.error} retry={open} />}
  </> : <DataState state="not_recorded" reason="No LPA is attached to this fund." />}</article>;
}
function OtherFundDocuments({ page }) {
  return <article className="fd-card" data-testid="fund-page-documents"><h2>Other fund documents</h2><DataState state="not_recorded" reason={page.documents_reason || 'Other fund documents have not been recorded here.'} /></article>;
}
function FundPeriods({ page }) {
  return <article className="fd-card"><h2>{page.can_manage ? 'Reporting periods' : 'Issued reports'}</h2>{page.periods.length ? <ul>{page.periods.map(period => <li key={period.id} data-testid={`row-fund-period-${period.id}`}><Link className="fd-inline-link" to={`/funds/${page.fund.id}/reporting/${period.id}`}>{period.period}</Link> · <span className={period.status === 'draft' ? 'fd-pill fd-pill-draft' : 'fd-pill'}>{periodIssue(period)}</span></li>)}</ul> : <p>{page.can_manage ? 'No reporting period has been recorded.' : 'No issued reporting period is recorded.'}</p>}</article>;
}
function FundHandoffs({ page, role, onEdit, editing = false }) {
  const { links, edit } = fundHandoffs(page, role);
  return <nav className="fd-actions" aria-label="Next steps for this fund">
    {links.map(link => <Link key={link.testid} to={link.to} data-testid={link.testid}>{link.label}</Link>)}
    {edit?.to && <Link to={edit.to} data-testid={edit.testid}>{edit.label}</Link>}
    {edit?.action && <button type="button" onClick={onEdit} disabled={editing} data-testid={edit.testid}>{edit.action}</button>}
  </nav>;
}
// #6247: the status is drawn as a pill, as the canvas draws it (fd-page, ops-data.js); a missing one stays Not recorded.
function Fact({ label, value, reason, note, pill = false }) {
  const recorded = value !== null && value !== undefined && value !== '';
  return <article className="fd-card"><h2>{label}</h2><div className={pill && recorded ? undefined : 'fd-number'}>{pill && recorded
    ? <span className="fd-pill fd-pill-status" data-testid="pill-fund-status">{value}</span>
    : <Recorded value={value} reason={reason} />}</div>{note && <small>{note}</small>}</article>;
}
