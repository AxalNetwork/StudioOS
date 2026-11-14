import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { reportingApi } from '../../lib/api/reporting';
import { WorkerRail } from '../../ui';
import InvestorCapTablePanel from '../raise/captable/InvestorCapTablePanel';
import { NOT_HELD, companyHref, holdingLine, reportRows } from '../cycles/reportingModel';
import { FiguresTab, HoldingNote, TermsCard, Timeline } from './CompanyReports';
import { ROUTE_WORDS, routeOf } from './portfolioReportsModel';
import PortfolioFrame from '../portfolio/PortfolioFrame';
import { usePortfolioReads } from '../portfolio/usePortfolioReads';
import { FinancialMetric, HealthStatus, Skeleton, SourceFailure } from '../portfolio/PortfolioParts';
import { CompanyActivity, CompanyFinancials, CompanySupport } from '../portfolio/CompanyPanels';
import { ReportAsk } from '../portfolio/ReportAsk';
import { accessOf } from '../portfolio/reportAsk';
import {
  COMPANY_SHAPES, COMPANY_TABS, OWNERSHIP_ANCHOR, companyDocTitle, companyHealthOf, companyTabHref, companyTabOfPath, evidenceOf,
  holdingRouteOf, identityOf, keyFactsOf, nextActionsOf,
} from '../portfolio/companyModel';
import '../portfolio/company.css';

/**
 * D1056 (#2427) — the investor's page per portfolio company at
 * `/portfolio/companies/:uid`. D1061 (#2931) gave it the company's duties and
 * periods (`GET /api/reporting/companies/:uid`, D1058): the Reports timeline
 * with Read, Ask and Waive, the terms read only, the holding's route (RPT13)
 * and the frozen figures of the reports received (RPT10).
 *
 * D4817 part 6 (#5311, canvas PF-06; addendum PFA01, PFA02, PFA09, PFA11,
 * PFA16): the company workspace, drawn in the shared Portfolio frame. The
 * company's name, its sector and stage, your holding and its route, its
 * health, six key facts, and five tabs, each its own address:
 *   - Overview (`/portfolio/companies/:uid`): why it reads as it does, next
 *     actions, and the figures it reported (the old Figures);
 *   - Financials (`…/financials`): investment history, return, valuation
 *     marks and distributions (`GET /api/positions/:uid`), then Ownership &
 *     rights — the old Terms and the read-only cap table. The old `…/terms`
 *     address is replaced by `…/financials#ownership-rights`;
 *   - Reports (`…/reports`): the reporting obligation with Ask and Waive
 *     (D4817 part 9, addendum PFA03–PFA05, PFA10: Review, a confirm naming
 *     the act, and a Receipt from the Worker's stored record), the timeline
 *     with Read, and the updates received;
 *   - Support (`…/support`) and Activity (`…/activity`).
 * Each read stands alone (`usePortfolioReads`): a failed one says Unreadable
 * with a Retry for that source, and its neighbours stay. The company's name
 * is drawn only once a read that the caller is authorised for has named it.
 */

const RAIL_NOTE = 'Figures come from your recorded position, its marks, the reports this company sent you and the support ledger. Nothing here changes a mark, a duty or a support entry, and no figure is filled in by a model.';

/** The Worker's reads for one company. A 404 from the reporting read is an answer: it owes the caller nothing. */
const sourcesFor = (uid) => {
  const ok = Boolean(companyHref(uid));
  return {
    positions: { call: () => api.positionsList(), shape: COMPANY_SHAPES.positions },
    owed: {
      call: () => (ok ? reportingApi.company(uid).catch((e) => { if (Number(e?.status) === 404) return { company: null }; throw e; }) : Promise.resolve({ company: null })),
      shape: COMPANY_SHAPES.owed,
    },
    health: { call: () => (ok ? api.portfolioHealthGet(uid) : Promise.resolve({ history: [] })), shape: COMPANY_SHAPES.health },
    support: { call: () => api.portfolioSupportList(), shape: COMPANY_SHAPES.support },
  };
};

const SOURCE_NAMES = { health: 'Health', support: 'The support ledger', positions: 'Your positions', owed: 'The reports owed to you' };
const FACT_SOURCE = { invested: 'positions', ownership: 'positions', fmv: 'positions', multiple: 'positions', report: 'owed', support: 'support' };

/** The updates this company sent you (`GET /api/portfolio-updates?project_id=`, D889's audience rule). */
function Reports({ projectId }) {
  const [state, setState] = useState({ status: 'loading', rows: [] });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', rows: [] });
    api.portfolioUpdatesList({ project_id: projectId })
      .then((data) => { if (alive) setState({ status: 'ready', rows: reportRows(Array.isArray(data) ? data : data?.items || data?.updates || [], projectId) }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', rows: [] }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  if (state.status === 'loading') return <section className="pf-card" aria-busy="true" data-testid="company-reports-loading"><h2 className="pf-h2">Updates you received</h2><Skeleton rows={1} /></section>;
  if (state.status === 'unreadable') {
    return (
      <section className="pf-card">
        <h2 className="pf-h2">Updates you received</h2>
        <SourceFailure what="This company’s reports" claim="This is not a claim that it sent none." onRetry={() => setReload((n) => n + 1)} testid="company-reports-unreadable" retryTestid="button-retry-company-updates" />
      </section>
    );
  }
  return (
    <section className="pf-card" aria-labelledby="pf-co-updates" data-testid="company-reports">
      <h2 className="pf-h2" id="pf-co-updates">Updates you received</h2>
      {!state.rows.length
        ? <p className="pf-note" data-testid="company-reports-none">This company has sent you no update yet.</p>
        : (
          <ul className="pf-co-list">
            {state.rows.map((r) => (
              <li key={r.key} data-testid="company-report-row">
                {r.href ? <Link to={r.href} className="pf-co">{r.title}</Link> : <span className="pf-co">{r.title}</span>}
                <span className="pf-muted">{r.sent ? `Received ${r.sent}` : 'Not sent'}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** The company's five tabs: links, URL-backed, with `aria-current` (addendum PFA16). */
function CompanyTabs({ uid, name, tab }) {
  return (
    <nav aria-label={`${name} sections`} className="pf-co-tabs" data-testid="company-tabs">
      {COMPANY_TABS.map((t) => (
        <Link key={t.id} to={companyTabHref(uid, t.id)} aria-current={t.id === tab ? 'page' : undefined}
          className={`pf-co-tab min-h-11${t.id === tab ? ' is-current' : ''}`} data-testid={`company-tab-${t.id}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** The six key facts (canvas PF-06), each with its own source's Retry. */
function KeyFacts({ facts, retry }) {
  return (
    <section className="pf-co-facts" aria-label="Key facts" data-testid="company-facts">
      {facts.map((f) => <FinancialMetric key={f.key} metric={f} onRetry={f.state === 'unreadable' ? () => retry(FACT_SOURCE[f.key]) : undefined} />)}
    </section>
  );
}

/** Overview (canvas PF-06 A, addendum PFA01): why it reads as it does, next actions, and the figures it reported. */
function Overview({ uid, reads, retry, company }) {
  const why = evidenceOf(reads, uid);
  const actions = nextActionsOf(reads, uid);
  const state = why.health.state;
  return (
    <>
      <div className="pf-two">
        <section className="pf-card" aria-labelledby="pf-co-why" data-testid="company-why">
          <div className="pf-card-head">
            <h2 className="pf-h2" id="pf-co-why">{['Attention', 'Watch', 'Healthy'].includes(state) ? `Why ${state}` : 'Health and evidence'}</h2>
            <HealthStatus health={why.health} />
          </div>
          {state === 'Unreadable' ? <SourceFailure what="Health" claim="No health is shown in its place." onRetry={() => retry('health')} testid="company-health-unreadable" retryTestid="button-retry-company-health" /> : null}
          {why.lines.length ? (
            <ul className="pf-attn-evidence" aria-label="Evidence">
              {why.lines.filter((l) => !(l.key === 'health' && state === 'Unreadable')).map((l) => (
                <li key={l.key} data-testid={`company-evidence-${l.key}`}><i>{l.label}</i><span className={l.state === 'unreadable' ? 'pf-unreadable' : l.state === 'not_recorded' ? 'pf-not-recorded' : undefined}>{l.text}</span></li>
              ))}
            </ul>
          ) : <Skeleton rows={1} />}
          <p className="pf-foot">Health is the dated snapshot the platform recorded; it is never Healthy for want of evidence.</p>
        </section>
        <section className="pf-card" aria-labelledby="pf-co-next" data-testid="company-next">
          <h2 className="pf-h2" id="pf-co-next">Next actions</h2>
          {actions.length ? (
            <ul className="pf-co-list">
              {actions.map((a) => (
                <li key={a.key} data-testid={`company-next-${a.key}`}>
                  <span><b>{a.title}</b><span className="pf-muted">{a.sub}</span></span>
                  <Link className="pf-btn" to={companyTabHref(uid, a.tab)}>{a.cta}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pf-note" data-testid="company-next-none">
              {reads.owed.state === 'unreadable' || reads.support.state === 'unreadable'
                ? 'Some of what decides the next action could not be read; see the notice above.'
                : 'No report is late or missing and no support you promised is open.'}
            </p>
          )}
          <p className="pf-foot" data-testid="company-next-mark">Asking for a new mark from here is not available yet. A mark is recorded through the authorised investment workflow.</p>
        </section>
      </div>
      <section className="pf-card" aria-labelledby="pf-co-reported">
        <div className="pf-card-head">
          <h2 className="pf-h2" id="pf-co-reported">Company-reported performance</h2>
          <span className="pf-sm">Separate from your investment and its marks</span>
        </div>
        <FiguresTab uid={uid} periods={company?.periods || []} />
      </section>
      <section className="pf-card" aria-labelledby="pf-co-recent">
        <div className="pf-card-head">
          <h2 className="pf-h2" id="pf-co-recent">Recent activity</h2>
          <Link className="pf-btn" to={companyTabHref(uid, 'activity')} data-testid="link-company-activity">Activity</Link>
        </div>
        <p className="pf-foot">Marks, reports and support each keep their own history. Activity lists them side by side, each from its own record.</p>
      </section>
    </>
  );
}

function CompanyWorkspace({ uid, tab }) {
  const location = useLocation();
  const { reads, retry, reload } = usePortfolioReads(useMemo(() => sourcesFor(uid), [uid]));
  const who = identityOf(uid, reads.positions, reads.owed);
  const held = who.state === 'held';
  const position = held ? who.position : null;
  const company = held ? who.company : null;
  const name = held ? who.name || 'Company' : null;
  const route = routeOf(company);
  const holding = holdingRouteOf(reads.owed, position);
  // D4817 part 9: which Ask or Waive is open, and on which period; who may act is the company read's.
  const [act, setAct] = useState(null);
  const access = accessOf(reads.owed.state === 'ok' ? reads.owed.value : null);

  // The old Terms address: replaced by Financials, at Ownership & rights, keeping the query.
  const terms = tab === 'terms';
  const rights = useRef(null);
  useEffect(() => {
    if (tab !== 'financials' || location.hash !== `#${OWNERSHIP_ANCHOR}`) return;
    const el = rights.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  }, [tab, location.hash, held]);
  if (terms) return <Navigate replace to={`${companyTabHref(uid, 'financials') || '/portfolio'}${location.search}#${OWNERSHIP_ANCHOR}`} />;

  const ownedBlock = (draw, what, noneId) => {
    if (reads.owed.state === 'loading') return <section className="pf-card"><Skeleton rows={1} /></section>;
    if (reads.owed.state === 'unreadable') return <section className="pf-card"><SourceFailure what={what} claim="This is not a claim that nothing is owed to you." onRetry={() => retry('owed')} testid="company-owed-unreadable" retryTestid="button-retry-company-owed" /></section>;
    if (!company) return <section className="pf-card" data-testid={noneId}><p className="pf-note">This company owes you no report under a document you signed, so nothing is due here.</p></section>;
    return draw(company);
  };

  let body;
  if (who.state === 'unreadable' && who.source === 'positions') {
    body = <section className="pf-card"><SourceFailure what="Your positions" claim="This is not a claim that you hold nothing here." onRetry={() => retry('positions')} testid="company-positions-unreadable" retryTestid="button-retry-company-positions" /></section>;
  } else if (who.state === 'unreadable') {
    body = <section className="pf-card"><SourceFailure what="This company’s details" claim="A failure is not a company with no holding or reports." onRetry={() => retry('owed')} testid="company-identity-unreadable" retryTestid="button-retry-company-identity" /></section>;
  } else if (who.state === 'loading') {
    body = <section className="pf-card" data-testid="company-loading"><Skeleton rows={3} /></section>;
  } else if (!held) {
    body = (
      <section className="pf-card" data-testid="company-not-held">
        <p className="pf-note">{NOT_HELD}</p>
        <Link to="/portfolio" className="pf-btn is-primary">Back to Portfolio</Link>
      </section>
    );
  } else {
    let tabBody;
    if (tab === 'reports') {
      tabBody = (
        <>
          <p className="pf-co-route" data-testid="company-reports-route">{holding.text}{holding.own ? ` · ${holding.own}` : ''}</p>
          {ownedBlock((c) => (
            <>
              <ReportAsk company={c} access={access} act={act} setAct={setAct} onChanged={() => retry('owed')} />
              <Timeline company={c} onChanged={() => retry('owed')} onAct={(kind, periodUid) => setAct({ kind, uid: periodUid })} canAct={access.can} />
            </>
          ), 'The reports owed to you', 'company-owed-none')}
          {position ? <Reports projectId={position.project_id} /> : null}
        </>
      );
    } else if (tab === 'financials') {
      tabBody = (
        <>
          <CompanyFinancials uid={uid} held={Boolean(position)} />
          {/* D1027 (#2864) and addendum PFA02: Ownership & rights keeps the duties and the investor's read-only Cap table panel (CT15). */}
          <section ref={rights} className="pf-co-rights" id={OWNERSHIP_ANCHOR} tabIndex={-1} aria-labelledby="pf-co-rights" data-testid="company-ownership-rights">
            <div className="pf-card-head">
              <h2 className="pf-h2" id="pf-co-rights">Ownership &amp; rights</h2>
              <span className="pf-sm">Read only · from the documents you signed</span>
            </div>
            {ownedBlock((c) => <TermsCard company={c} />, 'What this company owes you', 'company-terms-none')}
            {position ? <InvestorCapTablePanel projectId={position.project_id} venture={position.project?.name} testId="company-captable" /> : null}
            <p className="pf-foot">If a document or the cap table cannot be read, only that section says so.</p>
          </section>
        </>
      );
    } else if (tab === 'support') {
      tabBody = <CompanySupport uid={uid} name={name} read={reads.support} onRetry={() => retry('support')} />;
    } else if (tab === 'activity') {
      tabBody = <CompanyActivity uid={uid} owed={reads.owed} support={reads.support} retry={retry} />;
    } else {
      tabBody = <Overview uid={uid} reads={reads} retry={retry} company={company} />;
    }
    body = (
      <>
        <KeyFacts facts={keyFactsOf(reads, uid)} retry={retry} />
        {route ? <HoldingNote route={route} /> : null}
        {tabBody}
      </>
    );
  }

  const failed = held ? Object.entries(SOURCE_NAMES).filter(([k]) => reads[k].state === 'unreadable').map(([, n]) => n) : [];
  return (
    <PortfolioFrame
      testid="portfolio-company-page"
      title={name || 'Company'}
      crumb={name || 'Company'}
      docTitle={companyDocTitle(name, tab)}
      description={held ? (
        <span data-testid="company-holding">{[position?.project?.stage, position ? holdingLine(position) : null, route && route !== 'mixed' ? ROUTE_WORDS[route] : null].filter(Boolean).join(' · ') || 'Your holding: not recorded'}</span>
      ) : 'One portfolio company: your holding, its figures, reports and support.'}
      context={held ? `${holding.text || 'Holding route: reading…'}${holding.own ? ` · ${holding.own}` : ''}` : null}
      tools={held ? (
        <>
          <HealthStatus health={companyHealthOf(reads.health)} />
          <button type="button" className="pf-icon-button" onClick={reload} aria-label="Refresh this company" data-testid="button-refresh-company"><RefreshCw size={15} aria-hidden="true" /></button>
        </>
      ) : null}
      nav={held ? <CompanyTabs uid={uid} name={name} tab={tab} /> : null}
      notice={failed.length ? <p className="pf-partial" data-testid="status-company-partial">{failed.join(', ')} could not be read. Each affected figure says so and offers a Retry; the others are current.</p> : null}
      rail={<WorkerRail workspace="Portfolio" role="investor" className="pf-rail" note={RAIL_NOTE} />}
    >
      {body}
      <p className="pf-boundary">Only what this company sent you and what your book records. Figures come from its reports and your positions, not your bank.</p>
    </PortfolioFrame>
  );
}

export default function PortfolioCompanyPage() {
  const { uid } = useParams();
  const location = useLocation();
  const tab = companyTabOfPath(location.pathname);
  return <CompanyWorkspace key={uid} uid={uid} tab={tab} />;
}
