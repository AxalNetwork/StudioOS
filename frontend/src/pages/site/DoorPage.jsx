import React from 'react';
import { Link } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { ButtonLink } from '../../components/site/SiteBlocks';
import { DOORS } from '../../lib/siteDoors';
import { PRODUCT_PAGES } from '../../data/productPages';
import { FOUNDER_TIERS, INVESTOR_TIERS } from '../../data/pricing';
import NotFoundPage from '../NotFoundPage';
import './doors.css';

/**
 * One door page — Founders, Investors & LPs, Operating Partners or Advisors —
 * from the DOORS view of the owner's canvas (D676, #1550). The copy is
 * `lib/siteDoors.js`; this file is the canvas's layout and its per-door logic
 * (`doorFor()`: the accent, the flow chips, the chapter and plan helpers).
 *
 * The sections, in the canvas's order: the hero; the problem and what you get;
 * how it works, with the Eadwyn note; in the product; plans (only when a plan
 * resolves in the catalogue), with how AI use is paid in tokens under them
 * (owner, 2026-10-13); the aside (when the door has one); questions; the
 * closing band.
 *
 * Plans are read from the price catalogue `/pricing` reads (`data/pricing.js`)
 * — the price AND the feature list. A canvas plan names its tier; one the
 * catalogue does not have does not render, and a door left with none shows no
 * plans section, as the canvas's own `hasPlans` would.
 */

/** The catalogue `/pricing` reads, by audience. */
export const CATALOGUE = { founder: FOUNDER_TIERS, investor: INVESTOR_TIERS };

/** A catalogue tier's monthly price, as the page prints it. */
export function formatPrice(tier) {
  return `$${Number(tier.priceMonthly).toLocaleString('en-US')}`;
}

function tierFor(door, id, catalogue) {
  if (!id || !door.catalogue) return null;
  return (catalogue[door.catalogue] || []).find((t) => t.id === id) || null;
}

/**
 * The plans that render: each canvas plan whose tier the catalogue has, with
 * the catalogue's price and features. The rest are left out.
 */
export function resolvePlans(door, catalogue = CATALOGUE) {
  return (door.plans || []).flatMap((p) => {
    const tier = tierFor(door, p.tier, catalogue);
    if (!tier) return [];
    return [{ ...p, price: formatPrice(tier), period: '/ month', features: tier.features.slice() }];
  });
}

/** A chapter's list, with any `{price}` filled from the catalogue (or the line left out). */
export function chapterList(door, list = [], catalogue = CATALOGUE) {
  return list.flatMap((li) => {
    if (typeof li === 'string') return [li];
    const tier = tierFor(door, li.tier, catalogue);
    return tier ? [li.t.replace('{price}', formatPrice(tier))] : [];
  });
}

const nn = (i) => String(i + 1).padStart(2, '0');

function Lbl({ children }) {
  return <div className="ax-lbl ax-door-lbl">{children}</div>;
}

function Flow({ steps }) {
  return (
    <ol className="ax-door-flow">
      {steps.map((t, i) => (
        <li key={t}>
          {i > 0 && <span className="ax-door-arrow" aria-hidden="true">→</span>}
          <span className={`ax-door-chip${i === steps.length - 1 ? ' is-last' : ''}`}>{t}</span>
        </li>
      ))}
    </ol>
  );
}

function Chapter({ door, c, n }) {
  const list = chapterList(door, c.list);
  return (
    <li className="ax-door-chap">
      <div className="ax-door-chap-head">
        <div className="ax-display ax-door-chap-n" aria-hidden="true">{n}</div>
        <div className="ax-lbl-q">{c.k}</div>
      </div>
      <div>
        <h3 className="ax-door-chap-t">{c.t}</h3>
        <p className="ax-door-chap-d">{c.d}</p>
        {c.flow?.length > 0 && <Flow steps={c.flow} />}
        {list.length > 0 && (
          <ul className="ax-door-list">
            {list.map((li) => <li key={li} className="ax-door-li"><span className="ax-door-dot" aria-hidden="true" />{li}</li>)}
          </ul>
        )}
        {c.soon && <div className="ax-door-soon">Coming soon · {c.soon}</div>}
      </div>
    </li>
  );
}

function PlanCard({ p, to }) {
  return (
    <div className={`ax-door-plan${p.highlight ? ' is-hi' : ''}`} data-tier={p.tier}>
      {p.tag && <span className="ax-door-plan-tag">{p.tag}</span>}
      <div className="ax-door-plan-head">
        {p.step && <span className="ax-mono ax-door-plan-step">{p.step}</span>}
        <h3 className="ax-door-plan-name">{p.name}</h3>
        {p.desc && <span className="ax-door-plan-desc">{p.desc}</span>}
      </div>
      <div className="ax-door-plan-price">
        <div className="ax-display ax-door-plan-amt">{p.price}</div>
        <div className="ax-door-plan-per">{p.period}</div>
      </div>
      <ul className="ax-door-plan-feats">
        {p.features.map((f) => <li key={f}><span className="ax-door-tick" aria-hidden="true">✓</span>{f}</li>)}
      </ul>
      <Link to={to} className="ax-btn ax-door-plan-cta">{p.cta}</Link>
    </div>
  );
}

/** How AI use is paid, under the plans: the plan for the workspace, tokens for the AI. */
function Tokens({ tokens }) {
  return (
    <div className="ax-door-tokens" role="group" aria-labelledby="ax-door-tokens-h">
      <div>
        <div className="ax-lbl-q">{tokens.k}</div>
        <h3 id="ax-door-tokens-h" className="ax-door-tokens-t">{tokens.t}</h3>
        <p className="ax-door-note">{tokens.d}</p>
        {tokens.link && <a className="ax-door-tokens-link" href={tokens.link.href} data-testid="door-token-packs">{tokens.link.label}</a>}
      </div>
      <ul className="ax-door-tokens-list">
        {tokens.points.map((t) => (
          <li key={t} className="ax-door-aside-item"><span className="ax-door-dot" aria-hidden="true" />{t}</li>
        ))}
      </ul>
    </div>
  );
}

export default function DoorPage({ door: key }) {
  const door = DOORS[key];
  if (!door) return <NotFoundPage />;
  const meta = PRODUCT_PAGES[door.meta]?.meta || {};
  const plans = resolvePlans(door);
  const status = [
    ...door.live.map((s) => ({ t: s.t, route: s.route, soon: false })),
    ...door.soon.map((t) => ({ t, soon: true })),
  ];
  const ctas = (
    <>
      <ButtonLink to={door.primary.to} variant="primary">{door.primary.t}</ButtonLink>
      <ButtonLink to={door.secondary.to} variant="ghost">{door.secondary.t}</ButtonLink>
    </>
  );

  return (
    <SitePage title={meta.title} description={meta.description}>
      <div className="ax-door" data-door={key} style={{ '--door-accent': door.accent, '--door-soft': door.soft }}>

        <section className="ax-door-hero" aria-labelledby="ax-door-h">
          <img className="ax-door-hero-img" src={door.img} alt={door.imgAlt} style={{ objectPosition: door.imgPos }} />
          <div className="ax-door-hero-veil" aria-hidden="true" />
          <div className="ax-door-wrap ax-door-hero-body">
            <div className="ax-door-hero-text">
              <div className="ax-door-badge">{door.label}</div>
              <h1 id="ax-door-h" className="ax-h1">{door.h1}</h1>
              <p className="ax-door-who">{door.who}</p>
              <div className="ax-row-btns">{ctas}</div>
            </div>
          </div>
        </section>

        <section className="ax-door-problem" aria-labelledby="ax-door-problem-h">
          <div className="ax-door-wrap ax-door-2">
            <div>
              <h2 id="ax-door-problem-h" className="ax-lbl ax-door-lbl ax-door-lblh">The problem</h2>
              <p className="ax-display ax-door-problem-t">{door.problem}</p>
            </div>
            <div>
              <div className="ax-lbl-q">What you get</div>
              <ul className="ax-door-facts">
                {door.facts.map((t, i) => (
                  <li key={t} className="ax-door-fact">
                    <div className="ax-mono ax-door-fact-n">{nn(i)}</div>
                    <div className="ax-door-fact-t">{t}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="ax-door-wrap ax-door-how" aria-labelledby="ax-door-how-h">
          <Lbl>How it works</Lbl>
          <h2 id="ax-door-how-h" className="ax-door-h2">{door.chaptersTitle}</h2>
          <ol className="ax-door-chapters">
            {door.chapters.map((c, i) => <Chapter key={c.k} door={door} c={c} n={nn(i)} />)}
          </ol>
          <aside id="ax-door-eadwyn" className="ax-door-eadwyn" aria-label="Eadwyn">
            <div className="ax-door-eadwyn-mark" aria-hidden="true">E</div>
            <div>
              <div className="ax-door-eadwyn-t">{door.eadwynT}</div>
              <p className="ax-door-eadwyn-d">{door.eadwynD}</p>
            </div>
          </aside>
        </section>

        <section className="ax-door-wrap ax-door-status" aria-labelledby="ax-door-status-h">
          <div className="ax-door-split">
            <div>
              <Lbl>In the product</Lbl>
              <h2 id="ax-door-status-h" className="ax-door-h2-sm">{door.statusTitle}</h2>
              <p className="ax-door-note">{door.statusNote}</p>
            </div>
            <ul className="ax-door-status-list">
              {status.map((s) => (
                <li key={s.t} className={`ax-door-status-row${s.soon ? ' is-soon' : ''}`} data-route={s.route}>
                  <span>{s.t}</span>
                  <span className={`ax-door-pill${s.soon ? ' is-soon' : ''}`}>{s.soon ? 'Coming soon' : 'Live'}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {plans.length > 0 && (
          <section id="door-pricing" className="ax-door-plans" aria-labelledby="ax-door-plans-h">
            <div className="ax-door-wrap ax-door-plans-in">
              <Lbl>Plans</Lbl>
              <h2 id="ax-door-plans-h" className="ax-door-h2">{door.plansTitle}</h2>
              {door.plansSub && <p className="ax-door-lede">{door.plansSub}</p>}
              <div className="ax-door-plan-grid" style={{ '--plan-cols': plans.length }}>
                {plans.map((p) => <PlanCard key={p.name} p={p} to={door.primary.to} />)}
              </div>
              {door.planNote && <p className="ax-door-plan-note">{door.planNote}</p>}
              {door.tokens && <Tokens tokens={door.tokens} />}
            </div>
          </section>
        )}

        {door.aside && (
          <section className="ax-door-wrap ax-door-aside" aria-labelledby="ax-door-aside-h">
            <div className="ax-door-aside-box">
              <div>
                <h2 id="ax-door-aside-h" className="ax-door-h2-sm ax-door-aside-t">{door.aside.t}</h2>
                <p className="ax-door-note">{door.aside.d}</p>
                <div className="ax-door-aside-cta">
                  <ButtonLink to={door.aside.to} variant="primary">{door.aside.cta}</ButtonLink>
                </div>
              </div>
              <ul className="ax-door-aside-items">
                {door.aside.items.map((t) => (
                  <li key={t} className="ax-door-aside-item"><span className="ax-door-dot" aria-hidden="true" />{t}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="ax-door-faq" aria-labelledby="ax-door-faq-h">
          <div className="ax-door-wrap ax-door-split ax-door-faq-in">
            <div>
              <Lbl>Questions</Lbl>
              <h2 id="ax-door-faq-h" className="ax-door-h2-sm">Answered in plain terms.</h2>
            </div>
            <ol className="ax-door-faq-list">
              {door.faq.map((q, i) => (
                <li key={q.q} className="ax-door-faq-row">
                  <div className="ax-mono ax-door-faq-n" aria-hidden="true">{nn(i)}</div>
                  <div>
                    <h3 className="ax-door-faq-q">{q.q}</h3>
                    <p className="ax-door-faq-a">{q.a}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="ax-door-close" aria-labelledby="ax-door-close-h">
          <div className="ax-door-close-img" aria-hidden="true" style={{ backgroundImage: `url("${door.img}")`, backgroundPosition: door.closePos }} />
          <div className="ax-door-close-veil" aria-hidden="true" />
          <div className="ax-door-wrap ax-door-close-body">
            <h2 id="ax-door-close-h">{door.closing}</h2>
            {door.closeNote && <p className="ax-door-close-note">{door.closeNote}</p>}
            <div className="ax-row-btns">{ctas}</div>
          </div>
        </section>

      </div>
    </SitePage>
  );
}
