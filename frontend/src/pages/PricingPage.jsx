/**
 * D786 (#2211) part 2 — /pricing, built to the owner's "Pricing" canvas
 * (`design/incoming/StudioOS Pricing.dc.html`, 2026-10-20 revision).
 *
 * One page for visitors and members:
 *   - a visitor reads it inside the public site's frame (`SitePage`: the
 *     site's header, footer and light palette), as the canvas draws it;
 *   - a signed-in member reads it inside the app's own shell, the top bar and
 *     the left sidebar (`App.jsx` mounts it behind `guard`), with their own
 *     plan marked "Current plan".
 *
 * Five tabs (Founder, Investor, Advisors, Operating Partners, Models), the
 * selected one kept in `?for=`. Every figure is read: the plans, their monthly
 * and yearly prices and the AI each includes from `GET /api/public/plans-and-packs`,
 * the models and their billed prices from `GET /api/public/ai/models`
 * (`pricingModel.js`). The copy is the canvas's (`sitePricing.js`).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import SitePage from '../components/site/SitePage';
import { usePageMeta } from '../lib/seo';
import { publicPricingApi } from '../lib/api/publicPricing';
import { useViewMode } from '../contexts/ViewModeContext';
import { TOKEN_PACKS_PATH } from '../lib/aiTokens';
import {
  PRICING_TABS, compareCell, heldCard, initialTab, modelGroups, modelPrices, modelsTab, packCards, planCards,
} from '../lib/pricingModel';
import {
  AI_BAND, CLOSING, COMPARE, FAQ, FAQ_INVESTOR, HERO, LP_ACCESS, MODEL_GROUPS, MODELS_LINE, PACKS, PLAN_CARDS,
} from '../lib/sitePricing';
import './pricing.css';

/**
 * The display face for lines that are not headings (a card's name, a price):
 * the site's `ax-display` for a visitor, nothing for a member, whose shell's
 * own face carries the page (app_typography: no page stylesheet sets a face).
 */
const Face = createContext('');

const TICK = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** One read's state: `loading`, `ready` with its body, or `unreadable`. */
function useRead(fetcher) {
  const [state, setState] = useState({ status: 'loading', body: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', body: null });
    fetcher().then(
      (body) => { if (live) setState({ status: 'ready', body }); },
      () => { if (live) setState({ status: 'unreadable', body: null }); },
    );
    return () => { live = false; };
  }, [fetcher, round]);
  return [state, useCallback(() => setRound((n) => n + 1), [])];
}

function Tabs({ tab, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const on = el?.querySelector('[aria-selected="true"]');
    if (on && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, on.offsetLeft - 8);
  }, [tab]);
  return (
    <div className="axp-tabwrap">
      <div className="axp-tabs" role="tablist" aria-label="Pricing for" ref={ref}>
        {PRICING_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === tab} data-testid={`pricing-tab-${t.key}`}
            className={`axp-tab${t.key === tab ? ' is-on' : ''}`} onClick={() => onPick(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanCard({ card }) {
  const D = useContext(Face);
  const cls = `axp-card${card.highlight ? ' is-hi' : ''}${card.current ? ' is-current' : ''}`;
  return (
    <div className={cls} data-testid={`pricing-card-${card.id}`}>
      {card.kick && <div className="axp-kick">{card.kick}</div>}
      <div className="axp-card-head">
        <span className={`axp-card-name${D}`}>{card.name}</span>
        {card.current && <span className="axp-pill axp-pill-plan">Your plan</span>}
      </div>
      <div className="axp-card-tag">{card.tag}</div>
      {card.offered ? (
        <>
          <div className="axp-price">
            <span className={`axp-price-n${D}`} data-testid={`pricing-price-${card.id}`}>{card.price}</span>
            {card.unit && <span className="axp-price-u">{card.unit}</span>}
          </div>
          <div className="axp-price-note">{card.note}</div>
        </>
      ) : (
        <div className="axp-notoffered"><span className="axp-pill axp-pill-dash">Not offered yet</span></div>
      )}
      {card.button.to && !card.button.disabled ? (
        <Link to={card.button.to} className={`axp-btn${card.highlight ? ' is-primary' : ''}`}>{card.button.label}</Link>
      ) : (
        <button type="button" className="axp-btn" disabled>{card.button.label}</button>
      )}
      <div className="axp-rule" />
      {card.lead && <div className="axp-lead">{card.lead}</div>}
      <ul className="axp-feats">
        {card.feats.map((f) => <li key={f}><span className="axp-tick">{TICK}</span><span>{f}</span></li>)}
      </ul>
    </div>
  );
}

function Compare({ tab, cards }) {
  const D = useContext(Face);
  const groups = COMPARE[tab] || [];
  // The phone shows one plan: the member's own, else the second (the canvas's default).
  const [pick, setPick] = useState(() => {
    const own = cards.findIndex((c) => c.current);
    return own >= 0 ? own : Math.min(1, cards.length - 1);
  });
  const at = Math.min(pick, cards.length - 1);
  const cell = (v, key) => {
    const c = compareCell(v);
    return (
      <span key={key} className="axp-cell">
        {c.tick && <span className="axp-tick" aria-label="Included">{TICK}</span>}
        {c.dash && <span className="axp-dash" aria-label="Not included">—</span>}
        {c.text}
      </span>
    );
  };
  const cols = { gridTemplateColumns: `minmax(0,1.6fr) repeat(${cards.length},minmax(0,1fr))` };
  return (
    <section className="axp-sec axp-compare" aria-labelledby="axp-compare-h">
      <h2 id="axp-compare-h" className="axp-h2">Compare plans</h2>
      <div className="axp-desk axp-table">
        <div className="axp-thead" style={cols}><span />{cards.map((c) => <span key={c.id} className={`axp-th${D}`}>{c.name}</span>)}</div>
        {groups.map(([t, rows]) => (
          <React.Fragment key={t}>
            <div className="axp-group">{t}</div>
            {rows.map((r) => (
              <div key={r[0]} className="axp-row" style={cols}>
                <span className="axp-row-l">{r[0]}</span>
                {r.slice(1).map((v, i) => cell(v, i))}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div className="axp-phone">
        <div className="axp-chips" role="tablist" aria-label="Plan">
          {cards.map((c, i) => (
            <button key={c.id} type="button" role="tab" aria-selected={i === at} className={`axp-chip${i === at ? ' is-on' : ''}`} onClick={() => setPick(i)}>{c.name}</button>
          ))}
        </div>
        <div className="axp-table">
          {groups.map(([t, rows]) => (
            <React.Fragment key={t}>
              <div className="axp-group">{t}</div>
              {rows.map((r) => (
                <div key={r[0]} className="axp-row axp-row-phone"><span className="axp-row-l">{r[0]}</span>{cell(r[1 + at], 'v')}</div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function Unavailable({ onRetry }) {
  const D = useContext(Face);
  return (
    <div className="axp-unavail" role="alert">
      <div>
        <div className={`axp-unavail-t${D}`}>Prices unavailable. Try again.</div>
        <div className="axp-unavail-s">The price list could not be read just now.</div>
      </div>
      <button type="button" className="axp-btn axp-btn-err" onClick={onRetry}>Try again</button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="axp-grid axp-grid-3" aria-busy="true" aria-label="Loading prices">
      {[0, 1, 2].map((k) => (
        <div key={k} className="axp-card axp-skel">
          <i style={{ width: '40%', height: 18 }} /><i style={{ width: '75%' }} /><i style={{ width: '45%', height: 38 }} />
          <i style={{ height: 44 }} /><i style={{ width: '85%' }} /><i style={{ width: '70%' }} /><i style={{ width: '80%' }} />
        </div>
      ))}
    </div>
  );
}

function usedFor(pages) {
  if (!pages?.length) return 'Not used on a page yet';
  const named = pages.slice(0, 2).map((p) => p.split(' · ').join(' › '));
  return pages.length > 2 ? `${named.join(' · ')} and ${pages.length - 2} more` : named.join(' · ');
}

function Models({ read, onRetry }) {
  if (read.status === 'loading') return <Skeleton />;
  const tab = read.status === 'ready' ? modelsTab(read.body) : { unreadable: true };
  if (tab.unreadable) return <Unavailable onRetry={onRetry} />;
  return modelGroups(tab.models, MODEL_GROUPS).map((g) => {
    const units = [];
    for (const m of g.rows) for (const p of modelPrices(m)) if (!units.some((u) => u.unit === p.unit)) units.push(p);
    const cols = { gridTemplateColumns: `minmax(0,1.3fr) minmax(0,1.7fr) repeat(${units.length},minmax(110px,150px))` };
    return (
      <div key={g.t} className="axp-mgroup">
        <h3 className="axp-mgroup-t">{g.t}</h3>
        <div className="axp-desk axp-table">
          <div className="axp-mhead" style={cols}>
            <span>Model</span><span>Used for</span>
            {units.map((u) => <span key={u.unit} className="axp-num">{u.label}</span>)}
          </div>
          {g.rows.map((m) => {
            const prices = modelPrices(m);
            return (
              <div key={m.id} className="axp-mrow" style={cols} data-testid={`pricing-model-${m.id}`}>
                <span className="axp-mname"><b>{m.name}</b>{m.is_new && <span className="axp-pill axp-pill-new">New</span>}{m.paid_only && <span className="axp-pill">Paid plans</span>}</span>
                <span className="axp-mused">{usedFor(m.pages)}</span>
                {units.map((u) => <span key={u.unit} className="axp-num axp-mono">{prices.find((p) => p.unit === u.unit)?.value ?? '—'}</span>)}
              </div>
            );
          })}
        </div>
        <div className="axp-phone axp-mcards">
          {g.rows.map((m) => (
            <div key={m.id} className="axp-mcard">
              <span className="axp-mname"><b>{m.name}</b>{m.is_new && <span className="axp-pill axp-pill-new">New</span>}{m.paid_only && <span className="axp-pill">Paid plans</span>}</span>
              <span className="axp-mused">{usedFor(m.pages)}</span>
              {modelPrices(m).map((p) => <span key={p.unit} className="axp-mprice"><span className="axp-mono">{p.value}</span> {p.label}</span>)}
            </div>
          ))}
        </div>
      </div>
    );
  });
}

function Packs({ read }) {
  const D = useContext(Face);
  const packs = read.status === 'ready' ? packCards(read.body) : [];
  if (read.status !== 'ready') return null;
  return (
    <section className="axp-sec" aria-labelledby="axp-packs-h">
      <div className="axp-kick">{PACKS.kick}</div>
      <h2 id="axp-packs-h" className="axp-h2 axp-h2-s">{PACKS.title}</h2>
      <p className="axp-p">{PACKS.text}</p>
      {packs.length ? (
        <div className="axp-packs">
          {packs.map((p) => (
            <div key={p.uid} className="axp-pack">
              {p.offers.map((o) => <span key={o} className="axp-pill axp-pill-offer">{o}</span>)}
              <span className={`axp-pack-n${D}`}>{p.price}</span>
              <span className="axp-mono axp-muted">{p.use}</span>
              <Link to={TOKEN_PACKS_PATH} className="axp-btn">Buy</Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="axp-p axp-muted">No token packs are on sale right now.</p>
      )}
    </section>
  );
}

function Faq({ tab }) {
  const items = tab === 'investor' ? [...FAQ_INVESTOR, ...FAQ] : FAQ;
  const [open, setOpen] = useState(0);
  return (
    <section className="axp-sec axp-faq" aria-labelledby="axp-faq-h">
      <h2 id="axp-faq-h" className="axp-h2">Questions</h2>
      <div className="axp-faq-list">
        {items.map(([q, a], i) => (
          <div key={q} className="axp-faq-item">
            <button type="button" aria-expanded={i === open} onClick={() => setOpen(i === open ? -1 : i)}>
              <span>{q}</span><span className="axp-faq-chev" aria-hidden="true">{i === open ? '−' : '+'}</span>
            </button>
            {i === open && <p>{a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The page's body: the same in both frames. `user` is the signed-in member, or null for a visitor. */
export function PricingBody({ user = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const role = useViewMode()?.shellRole ?? null;
  const tab = initialTab(location.search, user ? role : null);
  const [billing, setBilling] = useState('monthly');
  const [plans, retryPlans] = useRead(publicPricingApi.plansAndPacks);
  const [models, retryModels] = useRead(publicPricingApi.aiModels);

  const pickTab = (key) => {
    const q = new URLSearchParams(location.search);
    q.set('for', key);
    navigate({ pathname: location.pathname, search: `?${q}`, hash: location.hash }, { replace: true });
  };

  const roleTab = tab !== 'models';
  const specs = PLAN_CARDS[tab] || [];
  const built = roleTab && plans.status === 'ready'
    ? planCards(plans.body, specs, { billing, held: heldCard(user, role, tab), signedIn: !!user })
    : null;
  const ready = built && !built.unreadable;
  const D = user ? '' : ' ax-display';

  return (
    <Face.Provider value={D}>
    <div className={`axp${user ? ' axp-app' : ''}`} data-testid="pricing-page">
      <section className="axp-hero">
        <h1 className="axp-h1">{HERO.title}</h1>
        <p className="axp-hero-p">{HERO.line}</p>
        <Tabs tab={tab} onPick={pickTab} />
        {ready && built.sells && (
          <div className="axp-bill">
            <div className="axp-bill-sw" role="group" aria-label="Billing">
              {[['monthly', 'Monthly'], ['yearly', 'Yearly']].map(([k, t]) => (
                <button key={k} type="button" aria-pressed={billing === k} className={billing === k ? 'is-on' : ''} onClick={() => setBilling(k)}>{t}</button>
              ))}
            </div>
            {built.saving && <span className="axp-save">{built.saving}</span>}
          </div>
        )}
      </section>

      {roleTab && (
        <section className="axp-sec axp-plans">
          {plans.status === 'loading' && <Skeleton />}
          {(plans.status === 'unreadable' || built?.unreadable) && <Unavailable onRetry={retryPlans} />}
          {ready && tab === 'investor' && (
            <div className="axp-lp">
              <div className="axp-lp-main">
                <div className="axp-kick">{LP_ACCESS.kick}</div>
                <div className="axp-lp-head"><span className={`axp-lp-name${D}`}>{LP_ACCESS.name}</span><span className={`axp-lp-name${D}`}>$0</span><span className="axp-price-u">/ month</span></div>
                <div className="axp-p">{LP_ACCESS.text}</div>
                <div className="axp-small">{LP_ACCESS.note}</div>
                <Link to={LP_ACCESS.link.to} className="axp-btn axp-btn-inline">{LP_ACCESS.link.label}</Link>
              </div>
              <ul className="axp-lp-feats">
                {LP_ACCESS.feats.map((f) => <li key={f}><span className="axp-tick">{TICK}</span>{f}</li>)}
              </ul>
            </div>
          )}
          {ready && (
            <div className={`axp-grid axp-grid-${built.cards.length}`}>
              {built.cards.map((c) => <PlanCard key={c.id} card={c} />)}
            </div>
          )}
        </section>
      )}

      {ready && (
        <section className="axp-sec">
          <div className="axp-band">
            <div>
              <div className="axp-kick">{AI_BAND.kick}</div>
              <p className="axp-band-p">{AI_BAND.text}</p>
            </div>
            <button type="button" className="axp-btn axp-btn-band" onClick={() => pickTab('models')}>{AI_BAND.link}</button>
          </div>
        </section>
      )}

      {ready && <Compare key={`${tab}`} tab={tab} cards={built.cards} />}

      {!roleTab && (
        <section className="axp-sec axp-models">
          <p className="axp-p">{MODELS_LINE}</p>
          <Models read={models} onRetry={retryModels} />
        </section>
      )}
      {!roleTab && <Packs read={plans} />}

      <Faq key={tab} tab={tab} />

      {!user && (
        <section className="axp-sec">
          <div className="axp-closing">
            <div>
              <div className={`axp-closing-t${D}`}>{CLOSING.title}</div>
              <div className="axp-closing-s">{CLOSING.line}</div>
            </div>
            <div className="axp-closing-a">
              <Link to="/register" className="axp-btn axp-btn-white">Get started</Link>
              <Link to="/contact" className="axp-btn axp-btn-ghost">Talk to us</Link>
            </div>
          </div>
        </section>
      )}
    </div>
    </Face.Provider>
  );
}

/** A member's /pricing: inside the app shell, so the page sets its own title. */
function MemberPricing({ user }) {
  usePageMeta({ title: 'Pricing' });
  return <PricingBody user={user} />;
}

/**
 * `/pricing`. `App.jsx` passes `user` for a signed-in member and mounts it
 * behind `guard`, inside the app's top bar and left sidebar; a visitor gets
 * the public site's frame.
 */
export default function PricingPage({ user = null }) {
  if (user) return <MemberPricing user={user} />;
  return (
    <SitePage title="Pricing">
      <PricingBody />
    </SitePage>
  );
}
