import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuthSync';
import { showsProof } from './investor/proofOfFundsModel';
import { useProofTargets } from './investor/ProofOfFunds';
import { useLocation } from 'react-router-dom';
import { api, spinoutLab } from '../lib/api';
import { lpAccessState, lpHasReports, SPINOUT_FUND_SLUG, fundTerms, LP_STATES } from '../lib/spinoutFundModel';
import { GATE, PROFILE_CHIP, EXTERNAL_DOCS, LBL, MONO, Chip } from './investor/fund/FundWorkspaceSupport';
import { programFigures, fundFigures } from '../lib/spinoutFundFigures';
import { selectHolding, fmtDate, quarterOf, lastClosedQuarter } from '../lib/quarterlyReportViewModel';
import { Landmark, Lock, AlertCircle, RefreshCw } from 'lucide-react';
import LpSkeleton from './investor/fund/LpSkeleton';
import { WorkspaceHeader } from '../components/WorkspaceTabs';
import FundOverviewSection from './investor/fund/FundOverviewSection';
import FundParticipationSection from './investor/fund/FundParticipationSection';
import FundReportsSection from './investor/fund/FundReportsSection';
import FundOnboardingSection from './investor/fund/FundOnboardingSection';
import FundWorkspaceNavigation, { FUND_SECTION_HASHES } from './investor/fund/FundWorkspaceNavigation';

/** D8731 (#8731): focus the section's own heading (`data-section-heading`), without scrolling it again. */
export function focusSectionHeading(target) {
  const heading = target?.querySelector?.('[data-section-heading]');
  if (!heading || typeof heading.focus !== 'function') return false;
  heading.focus({ preventScroll: true });
  return true;
}

export default function SpinoutLabLpWorkspacePage({ embedded = false }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // D752 (#1891): an investor on HQ only; never enabled for an admin, so a preview reads nothing.
  const proofOn = showsProof(user);
  const proofTargets = useProofTargets({ enabled: proofOn });
  const [proofSheet, setProofSheet] = useState(null);
  const [proofKey, setProofKey] = useState(0);
  const openProof = (target) => setProofSheet(target);
  const lpApplicationTarget = proofTargets.status === 'ready'
    ? (proofTargets.read?.targets || []).find((t) => t.purpose === 'lp_application') ?? null
    : null;

  const [portal, setPortal] = useState(null);
  // GET /spinout-lab/fund-metrics — live program track record and the fund
  // block (D6137). Every fund figure carries `available`; one with no record
  // is drawn "Not recorded", never a figure from lib/spinoutFundModel.js.
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const { hash } = useLocation();
  const workspaceContent = useRef(null);
  useEffect(() => {
    if (loading || !FUND_SECTION_HASHES.includes(hash)) return undefined;
    const form = hash === '#apply' ? document.getElementById('lp-application-entry') : null;
    const target = form || document.getElementById(hash.slice(1));
    if (!target) return undefined;
    const scroll = () => target.scrollIntoView?.({ block: 'start' });
    scroll();
    // D8731 (#8731): a section with a heading (My commitment, Fund and terms) hands focus to it on arrival.
    focusSectionHeading(target);
    if (typeof ResizeObserver !== 'function' || !workspaceContent.current) return undefined;
    // The booklet and notices settle independently. Keep the anchor in view
    // through layout changes until the reader starts interacting.
    const observer = new ResizeObserver(scroll);
    observer.observe(workspaceContent.current);
    const stop = () => observer.disconnect();
    const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    for (const event of inputs) window.addEventListener(event, stop, { once: true, passive: true });
    return () => {
      stop();
      for (const event of inputs) window.removeEventListener(event, stop);
    };
  }, [hash, loading]);
  const [err, setErr] = useState('');
  // Admin-only preview override. Never consulted for a non-admin, so it cannot
  // be used to self-grant access; see the file header.
  const [preview, setPreview] = useState(null);
  const [archiveFilter, setArchiveFilter] = useState('all');
  // The caller's own LP application (null = never applied). `applicationLoaded`
  // separates "no application" from "could not tell", so a failed read never
  // renders a fresh form to someone who has already applied.
  const [application, setApplication] = useState(null);
  const [applicationPrefill, setApplicationPrefill] = useState(null);
  const [applicationLoaded, setApplicationLoaded] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState('');
  const [reportBusy, setReportBusy] = useState('');
  // The caller's KYC record from Trust (D372). `loaded: false` is "could not
  // read", which the onboarding table says rather than guessing a status.
  const [kyc, setKyc] = useState({ loaded: false, status: null });
  const [reportErr, setReportErr] = useState('');

  const load = async () => {
    setLoading(true);
    setErr('');
    // The portal (the viewer's own position) and the fund metrics (program +
    // raise aggregates) fail independently: a metrics outage must not blank
    // the viewer's standing, and vice versa. A metrics failure draws its fund
    // figures "Unreadable", never a stand-in.
    const [portalRes, metricsRes, appRes, kycRes] = await Promise.allSettled([
      api.fundsLpPortal(),
      spinoutLab.fundMetrics(),
      spinoutLab.lpApplication(),
      api.kycStatus(),
    ]);
    setKyc(kycRes.status === 'fulfilled'
      ? { loaded: true, status: kycRes.value?.kyc_status ?? null }
      : { loaded: false, status: null });
    if (portalRes.status === 'fulfilled') {
      setPortal(portalRes.value);
    } else {
      // A failure must not silently look like "no commitments" — that would
      // read as a downgrade of the viewer's real standing.
      setErr(portalRes.reason?.message || 'Could not load your LP position.');
      setPortal(null);
    }
    setLive(metricsRes.status === 'fulfilled' ? metricsRes.value : null);
    // An application that cannot be READ must not read as "never applied" —
    // that would show the form to someone who already used it. Null means
    // unknown, and the form stays hidden behind the same `applicationLoaded`
    // flag the submit path uses.
    setApplication(appRes.status === 'fulfilled' ? (appRes.value?.application ?? null) : null);
    setApplicationPrefill(appRes.status === 'fulfilled' ? (appRes.value?.prefill ?? null) : null);
    setApplicationLoaded(appRes.status === 'fulfilled');
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const derived = useMemo(() => lpAccessState(portal, application), [portal, application]);
  useEffect(() => {
    if (hash === '#my-commitment' && (derived.holdings > 0 || err)) {
      document.getElementById('my-commitment')?.scrollIntoView?.();
    }
  }, [hash, derived.holdings, err]);

  const state = isAdmin && preview ? preview : derived.state;

  const gate = GATE[state] || GATE.visitor;
  const GateIcon = gate.icon;
  const [chipTone, chipText] = PROFILE_CHIP[state] || PROFILE_CHIP.visitor;
  const hasReports = lpHasReports(state);
  const showApply = !err && state === 'visitor';
  const showPending = !err && state === 'pending';

  const commitLabel = derived.commitmentK > 0 ? `$${derived.commitmentK}K` : '—';

  // D6137: every figure below is a string from the read, the same strings the
  // fund brief prints (lib/spinoutFundFigures.js). The program block keeps its
  // operator-maintained fallback with its caption; the fund block has none: a
  // figure with no record reads "Not recorded". `F.raise` and `F.portfolio` are
  // null unless the read carried the LP-only keys, so a visitor's page has
  // nothing reserved for LPs to draw.
  const P = programFigures(live);
  const F = fundFigures(live);

  // Which of the viewer's holdings this workspace reports on. The slug first
  // (stable across a rename); a viewer with exactly one holding resolves without
  // it. A viewer with several and no slug set is ambiguous, and the reporting
  // section says so — issuing a statement under the wrong fund's letterhead is
  // worse than issuing none.
  const holding = useMemo(
    () => selectHolding(portal, { fundSlug: SPINOUT_FUND_SLUG }) || selectHolding(portal, {}),
    [portal],
  );
  const ambiguousFund = !holding && (portal?.performance?.length ?? 0) > 1;

  // The archive: periods the GP has actually issued, an always-available interim
  // statement of the viewer's own account, then the documents that come from
  // outside the platform.
  const reportRows = useMemo(() => {
    const issued = (Array.isArray(portal?.report_periods) ? portal.report_periods : [])
      .filter((p) => !holding || p.fund_id === holding.fund_id)
      .map((p) => ({
        key: `period-${p.id}`,
        title: `${p.period} quarterly LP report`,
        period: p.period,
        issued: fmtDate(p.issued_at),
        type: 'Quarterly',
        kind: 'issued',
        readHref: `/funds/${p.fund_id}/reporting/${p.id}`,
        periodRow: p,
      }));
    const now = new Date();
    const interim = {
      key: 'interim',
      title: 'Interim capital account statement',
      period: quarterOf(now).label,
      issued: 'On demand',
      type: 'Statement',
      kind: 'interim',
    };
    return [...issued, interim, ...EXTERNAL_DOCS.map((d) => ({ ...d, kind: 'external', issued: '—' }))];
  }, [portal, holding]);

  const archive = archiveFilter === 'all'
    ? reportRows
    : reportRows.filter((r) => r.type === archiveFilter);
  const ARCHIVE_FILTERS = ['all', ...new Set(reportRows.map((r) => r.type))];

  /**
   * Render one LP statement. The document is built from `portal` — the viewer's
   * own rows — so an LP can only ever produce their own. An issued period also
   * carries the GP's letter; the interim statement has none, so it comes out
   * stamped DRAFT, which is exactly what it is.
   */
  const generateReport = async (row) => {
    if (!holding) {
      setReportErr(ambiguousFund
        ? 'You hold more than one fund and this fund has no slug set, so the statement cannot be attributed. Ask the GP to set the fund slug.'
        : 'No limited-partner position was found for your account in this fund.');
      return;
    }
    setReportBusy(row.key);
    setReportErr('');
    try {
      const { exportQuarterlyReportPdf } = await import('../lib/quarterlyReportPdf');
      const isIssued = row.kind === 'issued';
      // D712: an issued period prints the date it was issued, never today's, and
      // the LP's own frozen statement when the reporting queue issued it.
      const issuedStamp = isIssued ? new Date(row.periodRow.issued_at) : null;
      const statement = isIssued
        ? (portal?.capital_statements || []).find((st) => Number(st.report_period_id) === Number(row.periodRow.id)
          && Number(st.limited_partner_id) === Number(holding.lp_id))
        : null;
      await exportQuarterlyReportPdf({
        payload: portal,
        fundId: holding.fund_id,
        period: isIssued
          ? { ...quarterOf(new Date(`${row.periodRow.period_end}T12:00:00`)), label: row.periodRow.period }
          : lastClosedQuarter(new Date()),
        issuedAt: issuedStamp && !Number.isNaN(issuedStamp.getTime()) ? issuedStamp : new Date(),
        narrative: isIssued ? row.periodRow.narrative : null,
        issued: isIssued,
        statement: statement?.figures || null,
        figures: isIssued ? row.periodRow.figures || null : null,
      });
    } catch (e) {
      setReportErr(e?.message || 'Could not generate the statement.');
    } finally {
      setReportBusy('');
    }
  };

  // The underwriting block, for a committed LP's read only (F.portfolio is null
  // for a visitor). Each value is the read's figure or "Not recorded".
  const kpis = F.portfolio
    ? [
      ['Gross MOIC', F.portfolio.moic, 'Held ÷ invested'],
      ['Capital deployed', F.portfolio.invested, `Positions: ${F.portfolio.positions}`],
      ['Portfolio value', F.portfolio.held, 'At latest marks'],
      ['Follow-ons', F.portfolio.followOns, `Drawn: ${F.portfolio.followOnAmount}`],
      ['Reserve remaining', F.portfolio.reserve, 'No store records the reserve'],
    ]
    : [];

  // The eight rows flagged `page`; the brief prints the twelve flagged `brief`
  // off the same list, so neither can be edited without the other following.
  // The target row is the read's target (D6137): no hard cap is recorded.
  const econ = useMemo(() => fundTerms().filter((t) => t.page)
    .map((t) => (t.k === 'Target / hard cap' ? { ...t, k: 'Target', v: F.target.text } : t)), [F.target.text]);

  // The brief is built at click time from the same read the page drew plus the
  // viewer's own derived standing — never `state`, which an admin can preview.
  // A previewed state must not be stamped into a document as though it were real.
  const downloadBrief = async () => {
    setBriefBusy(true);
    setBriefErr('');
    try {
      const { exportFundBriefPdf } = await import('../lib/fundBriefPdf');
      await exportFundBriefPdf({
        generatedAt: new Date(),
        recipient: {
          name: user?.name,
          email: user?.email,
          standing: derived.commitmentK > 0
            ? `${PROFILE_CHIP[derived.state]?.[1] || 'Investor'} · $${derived.commitmentK}K committed`
            : PROFILE_CHIP[derived.state]?.[1],
        },
        metrics: live,
      });
    } catch (e) {
      setBriefErr(e?.message || 'Could not generate the fund brief.');
    } finally {
      setBriefBusy(false);
    }
  };

  const body = (
    <div ref={workspaceContent} className="space-y-6">
      {/* confidentiality */}
      <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
        <Lock size={12} />
        Confidential — prepared for curated investors only. Contents are indicative and qualified in
        their entirety by the fund&apos;s legal documents.
      </div>

      {err && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={16} className="flex-none" />
          <span className="flex-1">{err}</span>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 px-2.5 py-1 text-xs font-semibold">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* admin preview — inert, admin-only */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-violet-300 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 px-3 py-2">
          <span className={LBL}>Admin preview</span>
          {[null, ...LP_STATES].map((s) => (
            <button
              key={s || 'live'}
              type="button"
              onClick={() => setPreview(s)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                (preview || null) === s
                  ? 'border-violet-600 bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-200'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {s || `Live (${derived.state})`}
            </button>
          ))}
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Preview only — changes nothing and is never applied for non-admins.
          </span>
        </div>
      )}

      <FundWorkspaceNavigation hasPosition={derived.holdings > 0 || (!portal && !!err)} showReports={state !== 'visitor'} />

      {err ? <p role="status" id="overview">LP position unavailable</p> : (
      <div id="overview" tabIndex={-1} className={`flex scroll-mt-6 flex-wrap items-center gap-4 rounded-2xl border px-5 py-4 ${gate.wrap}`}>
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <GateIcon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {gate.title}
            {(state === 'committed' || state === 'voting') && derived.commitmentK > 0 && ` (${commitLabel})`}
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">{gate.body}</div>
        </div>
      </div>
      )}

      <FundOverviewSection
        F={F}
        P={P}
        downloadBrief={downloadBrief}
        briefBusy={briefBusy}
        briefErr={briefErr}
        econ={econ}
      />
      <FundParticipationSection
        showApply={showApply}
        applicationLoaded={applicationLoaded}
        application={application}
        prefill={applicationPrefill}
        setApplication={setApplication}
        showPending={showPending}
        derived={derived}
        proofOn={proofOn}
        lpApplicationTarget={lpApplicationTarget}
        openProof={openProof}
        portal={portal}
        err={err}
        load={load}
        proofTargets={proofTargets}
        proofKey={proofKey}
        proofSheet={proofSheet}
        setProofSheet={setProofSheet}
        setProofKey={setProofKey}
      />
      <FundReportsSection
        F={F}
        kpis={kpis}
        ARCHIVE_FILTERS={ARCHIVE_FILTERS}
        setArchiveFilter={setArchiveFilter}
        archiveFilter={archiveFilter}
        archive={archive}
        hasReports={hasReports}
        holding={holding}
        generateReport={generateReport}
        reportBusy={reportBusy}
        reportErr={reportErr}
        ambiguousFund={ambiguousFund}
        portal={portal}
        state={state}
        chipTone={chipTone}
        chipText={chipText}
        derived={derived}
        commitLabel={commitLabel}
        isAdmin={isAdmin}
      />
      <FundOnboardingSection
        kyc={kyc}
        application={application}
        applicationLoaded={applicationLoaded}
        portal={portal}
      />

    </div>
  );

  if (embedded) {
    return loading ? <LpSkeleton /> : body;
  }
  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Titled as the design titles it — "Spin-Out Lab ·" leads, because this
          page IS an LP's Spin-Out Lab. Standalone at /spinout-lab there is no
          Fund Ops tab strip overhead to say where you are, and an LP who
          clicked "Spin-Out Lab" needs to see that word to know they landed
          right. Inside Fund Ops the tab strip already says it, so the embedded
          arm above renders no header at all. */}
      <WorkspaceHeader
        icon={Landmark}
        title="Spin-Out Lab &middot; LP &amp; Investor Workspace"
        description="Curated capital participation in Axal VC Spin-Out Fund I — thesis, key terms, underwriting data, reporting, and participation."
      />
      {/* Standing, stated up front — as the design does. The same fact appears
          under "Participation rights" further down, but an LP arriving here
          from their own sidebar should not have to scroll to learn whether they
          are a visitor or a $250K LP: it decides what the rest of the page will
          even show them. Rendered only when the position has loaded, so it can
          never flash a lower standing than the viewer actually holds. */}
      {!loading && !err && (
        <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2.5" data-testid="lp-standing">
          <Chip tone={chipTone}>{chipText}</Chip>
          {derived.commitmentK > 0 && (
            <span className={`text-[12px] font-semibold text-gray-600 dark:text-gray-300 ${MONO}`}>
              {commitLabel} committed
            </span>
          )}
          {user?.name && (
            <span className="text-[12px] text-gray-500 dark:text-gray-400">{user.name}</span>
          )}
        </div>
      )}
      {loading ? <LpSkeleton /> : body}
    </div>
  );
}

export { lpAccessState, ALLOC_THRESHOLD_K } from '../lib/spinoutFundModel';
