/**
 * D4817 part 1 (#5311, PF-01): the one Portfolio frame every Portfolio v2
 * board draws in (canvas PF-01 to PF-08, addendum PFA10–PFA16).
 *
 * What the frame owns, so no board draws its own copy:
 *   - a visible-on-focus skip link to the Portfolio content;
 *   - the content as a NAMED SECTION, never a second `<main>`: the
 *     application owns the one main landmark (addendum PFA10);
 *   - the crumb (Account › Portfolio, #4473 owns the menu move), the heading,
 *     the one line under it, and the basis context on the right;
 *   - the one local navigation — Overview · Positions · Reports · Performance
 *     · Value-add — as the shell's own zone row (`ZoneNav`), whose targets
 *     come from `shellConfig`, plus Performance, a route of the bucket that is
 *     not a sidebar zone. It scrolls sideways on a phone rather than hiding a
 *     destination behind the rail;
 *   - the route-aware document title (`Portfolio · Axal VC`,
 *     `Positions · Portfolio · Axal VC`, …);
 *   - the rail slot. The rail itself is the board's own `WorkerRail`: its
 *     structure is #5130's, and the frame only places it.
 *
 * Props: `tab` (null for the Overview, else a nav slug), `description`,
 * `context` (the basis line beside the heading), `tools` (header buttons),
 * `notice` (a partial-failure line under the nav), `rail`, `children`, and
 * `banner` (D4817 part 8: the one Admin Investor preview banner, above the
 * crumb; null otherwise).
 *
 * D4817 part 6 (PF-06) draws one company's workspace in this same frame, so
 * four optional props let a board below Portfolio say where it is: `title`
 * (the heading, default Portfolio), `crumb` (what follows Portfolio in the
 * crumb, which then links back to `/portfolio`), `nav` (the board's own local
 * navigation in place of Portfolio's) and `docTitle` (the document title in
 * place of `portfolioTitle(tab)`).
 */
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import './portfolio.css';

/** The canvas's local navigation, in its order. Performance is the one non-zone item. */
export const PORTFOLIO_NAV = {
  overview: 'Overview',
  order: ['overview', 'positions', 'updates', 'performance', 'value-add'],
  scroll: true,
  extra: [{ slug: 'performance', label: 'Performance', to: '/portfolio/performance' }],
};

const TAB_TITLES = { positions: 'Positions', updates: 'Reports', performance: 'Performance', 'value-add': 'Value-add' };

/** The route-aware document title the addendum hands this build. */
export function portfolioTitle(tab) {
  return TAB_TITLES[tab] ? `${TAB_TITLES[tab]} · Portfolio · Axal VC` : 'Portfolio · Axal VC';
}

export default function PortfolioFrame({
  tab = null,
  description = 'How the investments are doing, what needs attention, and who owes what.',
  context = null,
  tools = null,
  notice = null,
  rail = null,
  children,
  testid,
  title = 'Portfolio',
  crumb = null,
  nav,
  docTitle: ownTitle,
  banner = null,
}) {
  const docTitle = ownTitle || portfolioTitle(tab);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const before = document.title;
    document.title = docTitle;
    return () => { document.title = before; };
  }, [docTitle]);

  return (
    <div className="pf-shell">
      <a className="pf-skip" href="#portfolio-content">Skip to Portfolio content</a>
      <section className="pf-frame" id="portfolio-content" tabIndex={-1} aria-labelledby="portfolio-title" data-testid={testid}>
        {banner}
        <nav className="pf-crumb" aria-label="Breadcrumb">
          <span>Account</span><span aria-hidden="true">›</span>
          {crumb ? <><Link to="/portfolio" className="pf-crumb-link">Portfolio</Link><span aria-hidden="true">›</span><b>{crumb}</b></> : <b>Portfolio</b>}
        </nav>
        <header className="pf-head">
          <div>
            <h1 id="portfolio-title">{title}</h1>
            <p>{description}</p>
          </div>
          <div className="pf-head-tools">
            {context ? <span className="pf-context" data-testid="portfolio-context">{context}</span> : null}
            {tools}
          </div>
        </header>
        {nav === undefined ? <ZoneNav bucket={bucketForPath('investor', '/portfolio')} role="investor" activeSlug={tab} row={PORTFOLIO_NAV} className="pf-nav" /> : nav}
        {notice}
        <div className="pf-body">{children}</div>
      </section>
      {rail}
    </div>
  );
}
