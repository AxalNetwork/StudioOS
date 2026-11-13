import React from 'react';
import { Link } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { PageHero, Section } from '../../components/site/SiteBlocks';
import { COMPOUNDS_COPY, DATA_FLOWS, PLATFORM_LAYERS } from '../../lib/siteFirm';
import './firm.css';

/**
 * The Platform page, `/platform`, from the PLATFORM view of the owner's canvas
 * (D677, #1551): the four layers with their modules, then "Why it compounds".
 *
 * Every module card is a link to the route of a tool that runs today, and a
 * data flow is drawn only where the code makes that link. What the canvas says
 * and the code does not do is dropped, not softened; `lib/siteFirm.js` lists
 * each drop, and `firm_platform_admin_d677.test.mjs` holds every card to a
 * route `App.jsx` serves and every flow to the code that makes it.
 */
export default function PlatformPage() {
  return (
    <SitePage title="Platform">
      <PageHero
        id="fx-plat-h"
        eyebrow="The platform"
        title="One system. Founders, partners, and capital — working from the same record."
        copy="Every tool writes into a shared model. Nothing is re-entered, nothing drifts, and no one is reading a stale version of the truth."
      />

      <section id="fx-layers" className="ax-wrap ax-section">
        <ol className="fx-layers">
          {PLATFORM_LAYERS.map((l) => (
            <li key={l.n} className="fx-layer">
              <div className="fx-layer-grid">
                <div>
                  <div className="ax-mono fx-layer-n">{l.n}</div>
                  <h2 className="fx-layer-t">{l.t}</h2>
                  <p className="fx-layer-d">{l.d}</p>
                </div>
                <ul className="fx-mods">
                  {l.mods.map((m) => (
                    <li key={m.t}>
                      <Link to={m.to} className="fx-mod">
                        <h3 className="fx-mod-t">{m.t}</h3>
                        <p className="fx-mod-d">{m.d}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Section id="fx-compounds" labelledBy="fx-flows-h" dark>
        <div className="fx-compounds">
          <div>
            <div className="ax-lbl">Why it compounds</div>
            <h2 id="fx-flows-h">The data model is the product.</h2>
            <p className="fx-compounds-p">{COMPOUNDS_COPY}</p>
          </div>
          <ul className="fx-flows" aria-labelledby="fx-flows-h">
            {DATA_FLOWS.map((d) => (
              <li key={d.from} className="fx-flow">
                <span className="fx-flow-from">{d.from}</span>
                <span className="fx-flow-line" aria-hidden="true" />
                <span className="sr-only"> feeds </span>
                <span className="fx-flow-to">{d.to}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </SitePage>
  );
}
