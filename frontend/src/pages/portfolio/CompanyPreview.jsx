/**
 * D4817 part 10 (#5311): one portfolio company's workspace as an administrator
 * previewing the Investor shell sees it — the frame, the company's five tabs
 * and each tab's section headings, with every investor record withheld.
 *
 * `PortfolioCompanyPage` draws this in place of the company workspace when
 * `isInvestorPreview` holds (PF-08's rule: an administrator, not in a support
 * session, browsing as `investor`). It reads nothing: not the positions, the
 * reports owed, health, the support ledger, the company's rounds and marks,
 * its updates, its cap table or its activity, and it draws no rail (Eadwyn
 * would read the same records). The company's name, stage and holding come
 * only from those reads, so the heading says "Company withheld in preview"
 * instead. Each key fact and section carries the "Private in preview" chip,
 * never a 0 or an empty list, and the writes the real tab offers (Ask for this
 * report, Waive this period, Record support…, Ask for access) are drawn off
 * with the reason beside them. One banner (`PreviewBanner`) sits in the
 * frame's banner slot; the shell's strip stands down here too
 * (`pageOwnsPreviewBanner`).
 */
import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useViewMode } from '../../contexts/ViewModeContext';
import PortfolioFrame from './PortfolioFrame';
import { PreviewBanner, PrivateChip } from './PreviewBanner';
import { OffWrites, WithheldSection } from './PortfolioPreview';
import { COMPANY_TABS, OWNERSHIP_ANCHOR, companyDocTitle, companyTabHref } from './companyModel';
import { COMPANY_WITHHELD, PREVIEW_COMPANY_FACTS, PREVIEW_COMPANY_TABS, previewDocTitle } from './previewModel';
import './company.css';
import './preview.css';

/** The five tabs, as the real workspace draws them: links, URL-backed, with `aria-current`. */
function PreviewTabs({ uid, tab }) {
  return (
    <nav aria-label="Company sections" className="pf-co-tabs" data-testid="company-tabs">
      {COMPANY_TABS.map((t) => (
        <Link key={t.id} to={companyTabHref(uid, t.id) || '/portfolio'} aria-current={t.id === tab ? 'page' : undefined}
          className={`pf-co-tab min-h-11${t.id === tab ? ' is-current' : ''}`} data-testid={`company-tab-${t.id}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export default function CompanyPreview({ uid, tab = 'overview' }) {
  const view = useViewMode();
  const location = useLocation();
  // The old Terms address lands on Financials, as it does outside preview. Nothing is read to send it there.
  if (tab === 'terms') return <Navigate replace to={`${companyTabHref(uid, 'financials') || '/portfolio'}${location.search}#${OWNERSHIP_ANCHOR}`} />;
  const spec = PREVIEW_COMPANY_TABS[tab] || PREVIEW_COMPANY_TABS.overview;
  const current = tab in PREVIEW_COMPANY_TABS ? tab : 'overview';

  return (
    <PortfolioFrame
      testid="portfolio-company-preview"
      title={COMPANY_WITHHELD}
      crumb="Company"
      docTitle={previewDocTitle(companyDocTitle('Company', current))}
      description={<span data-testid="company-preview-holding">The company’s name, stage and your holding: <PrivateChip what="The company and your holding" /></span>}
      tools={<span className="pf-preview-health" data-testid="company-preview-health">Health <PrivateChip what="Health" /></span>}
      nav={<PreviewTabs uid={uid} tab={current} />}
      banner={<PreviewBanner superAdmin={view?.superAdmin === true} onExit={view?.exitPreview} />}
    >
      <section className="pf-co-facts" aria-label="Key facts" data-testid="company-preview-facts">
        {PREVIEW_COMPANY_FACTS.map((f) => (
          <div className="pf-metric" key={f.key} data-testid={`preview-fact-${f.key}`}>
            <small>{f.label}</small>
            <b><PrivateChip what={f.label} /></b>
          </div>
        ))}
      </section>
      <div className="pf-preview-grid">
        {spec.sections.map((s) => <WithheldSection key={s.key} section={s} />)}
      </div>
      {spec.writes.length ? <OffWrites writes={spec.writes} title="Actions on this tab" /> : null}
      <p className="pf-foot" data-testid="portfolio-preview-foot">
        The layout, tabs and sections are shown; the company and every investor record are withheld. Writes are disabled in preview.
      </p>
    </PortfolioFrame>
  );
}
