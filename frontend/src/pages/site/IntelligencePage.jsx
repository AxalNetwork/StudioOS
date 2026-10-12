import React, { useEffect, useState } from 'react';
import SitePage from '../../components/site/SitePage';
import { ButtonLink, EmptyNote } from '../../components/site/SiteBlocks';
import { RESEARCH_CARDS } from '../../lib/siteIntelligence';
import './method.css';

/**
 * `/intelligence` (D678, #1552): Eadwyn, from the owner's canvas
 * `design/canvases/integrated/Eadwyn Intelligence Page.dc.html`.
 *
 * Every sentence the canvas states about the product was checked against the
 * code, and only the true ones ship. `lib/siteIntelligence.js` keeps the
 * ledger: what was kept and the code that makes it true, what was dropped and
 * what the code does instead. Of the canvas's six sections, Models and
 * Research ship, renumbered 01 and 02; the backlog, language, persona and
 * architecture sections, the intro line and the Beta badge do not.
 *
 * The model table reads `GET /api/public/ai-models`, the router's own table.
 * This file names no model: while the read is out, after it fails, or when it
 * returns nothing, the table says so in one sentence.
 */

const img = (name) => `/site/${name}.webp`;
const MARK = '/eadwyn-ai.png';

/** The rows of a `/api/public/ai-models` answer the table can draw, or []. */
export function modelRows(payload) {
  const list = Array.isArray(payload?.models) ? payload.models : [];
  return list.filter((m) => m && typeof m.feature === 'string' && m.feature && typeof m.model === 'string' && m.model)
    .map((m) => ({ feature: m.feature, model: m.model, name: typeof m.name === 'string' && m.name ? m.name : m.model }));
}

/** `{ status: 'loading' | 'ok' | 'error', rows }` for the model registry. */
function useModelRegistry() {
  const [state, setState] = useState({ status: 'loading', rows: [] });
  useEffect(() => {
    let alive = true;
    import('../../lib/api')
      .then(({ publicAiModelsApi }) => publicAiModelsApi.list())
      .then((payload) => { if (alive) setState({ status: 'ok', rows: modelRows(payload) }); })
      .catch(() => { if (alive) setState({ status: 'error', rows: [] }); });
    return () => { alive = false; };
  }, []);
  return state;
}

/** The registry as a table, or the one sentence that stands in for it. */
export function ModelTable({ state }) {
  if (state.status === 'loading') return <EmptyNote>Reading the model registry…</EmptyNote>;
  if (state.status === 'error') return <EmptyNote>The model registry could not be read just now.</EmptyNote>;
  if (!state.rows.length) return <EmptyNote>No models are listed right now.</EmptyNote>;
  return (
    <div className="ax-i-tablewrap">
      <table className="ax-i-table">
        <thead>
          <tr><th scope="col">Axal VC function</th><th scope="col">Default model</th></tr>
        </thead>
        <tbody>
          {state.rows.map((r) => (
            <tr key={r.feature}>
              <th scope="row">{r.feature}</th>
              <td>
                <div className="ax-i-model">{r.name}</div>
                {r.name !== r.model && <div className="ax-mono ax-i-model-id">{r.model}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Hero() {
  return (
    <section className="ax-i-hero" aria-labelledby="i-hero-h">
      <img className="ax-i-hero-img" src={img('ead-hero')} alt="" />
      <div className="ax-i-hero-veil" aria-hidden="true" />
      <div className="ax-m-wrap ax-i-hero-body">
        <div className="ax-display ax-i-word">Eadwyn</div>
        <img className="ax-i-mark" src={MARK} width="124" height="124"
          alt="Eadwyn mark: a pixel-art eye holding a landscape, inside a violet compass ring" />
        <h1 id="i-hero-h" className="ax-i-h1">Intelligence</h1>
        <p className="ax-i-hero-copy">Eadwyn is the Personal Assistant inside Axal VC.</p>
        <div className="ax-m-ctas ax-i-ctas">
          <ButtonLink to="/studio" variant="primary">Try Eadwyn</ButtonLink>
          <ButtonLink href="#ei-research" variant="quiet">See Research</ButtonLink>
        </div>
      </div>
    </section>
  );
}

function Models() {
  const registry = useModelRegistry();
  return (
    <section className="ax-i-band" aria-labelledby="i-models-h">
      <div className="ax-m-wrap ax-i-sec">
        <div className="ax-m-eyebrow">01 · Models</div>
        <h2 id="i-models-h" className="ax-i-h2">The model behind each feature.</h2>
        <div className="ax-i-tablebox">
          <ModelTable state={registry} />
        </div>
      </div>
    </section>
  );
}

function Research() {
  return (
    <section id="ei-research" className="ax-i-research" aria-labelledby="i-research-h">
      <img className="ax-i-research-img" src={img('ead-map')} alt="" loading="lazy" />
      <div className="ax-i-research-veil" aria-hidden="true" />
      <div className="ax-m-wrap ax-i-sec">
        <div className="ax-m-eyebrow is-light">02 · Research</div>
        <h2 id="i-research-h" className="ax-i-h2">A research base for the decisions that matter.</h2>
        <p className="ax-m-lede is-light">Intelligence includes Research: a large database of markets, companies, and funds.</p>
        <div className="ax-i-cards">
          {RESEARCH_CARDS.map((r) => (
            <div key={r.t} className="ax-i-card">
              <h3 className="ax-i-card-t">{r.t}</h3>
              <div className="ax-i-card-q">{r.q}</div>
              <p className="ax-i-card-d">{r.d}</p>
            </div>
          ))}
        </div>
        <p className="ax-i-note">
          Ask Research anything in plain language. Answers without a retrievable source are shown as unanswered, not guessed.
        </p>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="ax-m-wrap ax-i-close" aria-labelledby="i-close-h">
      <img className="ax-i-mark-sm" src={MARK} width="44" height="44" alt="" />
      <h2 id="i-close-h" className="ax-i-close-t">
        Eadwyn never acts for you. It drafts, explains and summarises. Sending, signing and voiding are always a human click.
      </h2>
      <ButtonLink to="/studio" variant="primary">Open on axal.vc</ButtonLink>
    </section>
  );
}

export default function IntelligencePage() {
  return (
    <SitePage title="Intelligence" className="ax-i">
      <Hero />
      <Models />
      <Research />
      <Closing />
    </SitePage>
  );
}
