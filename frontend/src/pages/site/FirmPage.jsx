import React from 'react';
import { Link } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { ButtonLink, PageHero, Section, SectionHead } from '../../components/site/SiteBlocks';
import { CRITERIA, PHILOSOPHY } from '../../lib/siteFirm';
import './firm.css';

/**
 * The Firm page, `/about`, from the FIRM view of the owner's canvas (D677,
 * #1551): the hero, the mission beside the investment philosophy, what we
 * look for, and the Fund I band. The team page it replaces moves to `/team`,
 * and this page links there.
 *
 * Fund I's terms wait on the owner (#1551). This is option B: the band keeps
 * "Fund I is open to qualified LPs." and its link to the investor overview,
 * without the target, the hard cap or the vintage line, and the philosophy
 * leaves out the canvas's item 04, whose check sizes and reserve share are
 * Fund I terms (`lib/siteFirm.js`). `firm_platform_admin_d677.test.mjs` pins it.
 */
export default function FirmPage() {
  return (
    <SitePage title="Firm">
      <PageHero
        id="fx-firm-h"
        eyebrow="The firm"
        title="We are early because that is where the outcome is decided."
        copy="Axal VC is a Geneva-based venture firm investing at pre-seed in technology companies with durable, systemic problems to solve. We built an operating platform because writing checks earlier only works if you can see more."
      >
        <Link to="/team" className="ax-link fx-hero-link">Meet the team →</Link>
      </PageHero>

      <Section id="fx-mission" labelledBy="fx-mission-h">
        <div className="fx-two">
          <div>
            <h2 id="fx-mission-h" className="ax-lbl-q fx-label-h">Mission</h2>
            <p className="fx-mission-t">Make the earliest stage of company-building legible — to founders first, and to capital second.</p>
            <p className="fx-mission-p">Founders are asked to make irreversible decisions — equity splits, entity structure, IP assignment, pricing — usually before anyone has told them what good looks like. Most of the damage in a company&apos;s first year is structural, not strategic.</p>
            <p className="fx-mission-p">We put those decisions inside a system with defaults, evidence requirements, and expert review. The founder keeps every decision. They just stop making them blind.</p>
          </div>
          <div>
            <h2 id="fx-philosophy-h" className="ax-lbl-q fx-label-h">Investment philosophy</h2>
            <ol className="fx-phil" aria-labelledby="fx-philosophy-h">
              {PHILOSOPHY.map((p) => (
                <li key={p.n}>
                  <span className="ax-mono fx-phil-n">{p.n}</span>
                  <div>
                    <h3 className="fx-phil-t">{p.t}</h3>
                    <p className="fx-phil-d">{p.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      <Section id="fx-criteria" labelledBy="fx-criteria-h" band>
        <SectionHead id="fx-criteria-h" eyebrow="What we look for" title="Four things, weighted in this order." />
        <ol className="ax-grid-4 fx-criteria">
          {CRITERIA.map((c) => (
            <li key={c.w} className="fx-crit">
              <div className="ax-mono fx-crit-w">{c.w}</div>
              <h3 className="fx-crit-t">{c.t}</h3>
              <p className="fx-crit-d">{c.d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="fx-fund" labelledBy="fx-fund-h">
        <div className="fx-fund">
          <h2 id="fx-fund-h">Fund I is open to qualified LPs.</h2>
          <ButtonLink to="/for-investors">Investor overview →</ButtonLink>
        </div>
      </Section>
    </SitePage>
  );
}
