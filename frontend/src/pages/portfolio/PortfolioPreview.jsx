/**
 * D4817 part 8 (#5311, canvas PF-08): each Portfolio board as an administrator
 * previewing the Investor shell sees it — the real frame, its navigation and
 * the real board's section headings, with every investor record withheld.
 *
 * `PortfolioWorkspace` draws this in place of the investor board when
 * `isInvestorPreview` holds, for the six addresses `previewBoardOf` names.
 * It reads nothing: no positions, analytics, reports, chases, health or
 * support, and no rail (Eadwyn would be reading the same records). Each
 * withheld figure and section carries the "Private in preview" chip, so the
 * preview never shows a 0 or an empty book for something it did not read.
 * The writes the real board offers are drawn off, with the reason beside
 * them, so the administrator sees what the investor can do without anything
 * being sent. One banner (`PreviewBanner`) sits in the frame's banner slot.
 */
import React, { useEffect } from 'react';
import { useViewMode } from '../../contexts/ViewModeContext';
import PortfolioFrame, { portfolioTitle } from './PortfolioFrame';
import { SummaryTile } from './PortfolioParts';
import { PreviewBanner, PrivateChip } from './PreviewBanner';
import { PREVIEW_BOARDS, PREVIEW_FIGURES, WRITES_OFF, frameTabOf, previewDocTitle } from './previewModel';
import './preview.css';

function WithheldPerformance() {
  return (
    <section className="pf-perf" aria-labelledby="pf-preview-perf-title" data-testid="portfolio-preview-performance">
      <div className="pf-hero">
        <span className="pf-eyebrow" id="pf-preview-perf-title">Net asset value · gross</span>
        <PrivateChip what="Net asset value" />
        <span className="pf-sub">Withheld: this investor’s figures are private in preview.</span>
      </div>
      <div className="pf-mults">
        {PREVIEW_FIGURES.map((f) => (
          <div className="pf-metric" key={f.key} data-testid={`preview-metric-${f.key}`}>
            <small>{f.label}</small>
            <b><PrivateChip what={f.label} /></b>
            <em>{f.note}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function WithheldSection({ section }) {
  const id = `pf-preview-${section.key}`;
  return (
    <section className="pf-card" aria-labelledby={id} data-testid={`preview-section-${section.key}`}>
      <div className="pf-card-head"><h2 id={id}>{section.title}</h2></div>
      <PrivateChip what={section.title} />
    </section>
  );
}

function OffWrites({ writes }) {
  return (
    <section className="pf-card" aria-labelledby="pf-preview-writes-title" data-testid="portfolio-preview-writes">
      <div className="pf-card-head"><h2 id="pf-preview-writes-title">Actions on this board</h2></div>
      <div className="pf-preview-writes">
        {writes.map((w) => (
          <button key={w.key} type="button" className="pf-btn" disabled aria-describedby="pf-preview-writes-why" data-testid={`button-preview-write-${w.key}`}>
            {w.label}
          </button>
        ))}
      </div>
      <p className="pf-foot" id="pf-preview-writes-why">{WRITES_OFF}</p>
    </section>
  );
}

export default function PortfolioPreview({ board = 'overview' }) {
  const view = useViewMode();
  const spec = PREVIEW_BOARDS[board] || PREVIEW_BOARDS.overview;
  const tab = frameTabOf(board in PREVIEW_BOARDS ? board : 'overview');

  // The frame sets the route's title first (a child's effect runs before its
  // parent's); the preview's title adds "Investor preview" before Axal VC.
  const docTitle = previewDocTitle(portfolioTitle(tab));
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const before = document.title;
    document.title = docTitle;
    return () => { document.title = before; };
  }, [docTitle]);

  return (
    <PortfolioFrame
      tab={tab}
      testid="portfolio-preview"
      description="The Investor shell’s Portfolio, as an investor would see it, with every investor figure withheld."
      banner={<PreviewBanner superAdmin={view?.superAdmin === true} onExit={view?.exitPreview} />}
    >
      {spec.performance ? <WithheldPerformance /> : null}
      {spec.tiles.length ? (
        <section className="pf-preview-tiles" aria-label="This period" data-testid="portfolio-preview-tiles">
          {spec.tiles.map((t) => <SummaryTile key={t} label={t} value={<PrivateChip what={t} />} />)}
        </section>
      ) : null}
      <div className="pf-preview-grid">
        {spec.sections.map((s) => <WithheldSection key={s.key} section={s} />)}
      </div>
      {spec.writes.length ? <OffWrites writes={spec.writes} /> : null}
      <p className="pf-foot" data-testid="portfolio-preview-foot">
        The layout, navigation and sections are shown; every investor figure is withheld. Writes are disabled in preview.
      </p>
    </PortfolioFrame>
  );
}
