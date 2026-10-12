import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import { track } from '../lib/funnel';
import { DOOR_LINKS } from '../lib/siteLinks';
import { openCohortCopy, useCohortPlaces } from '../lib/spinoutLab';
import { numberWordCap } from '../lib/numberWords';
import { DIMENSIONS } from '../lib/scoringViewModel';
import { SLIDE_META } from '../lib/pitchDeckViewModel';
import '../components/site/site.css';

/**
 * The public front page, from the HOME view of the owner's canvas (D674, #1548):
 * `design/canvases/integrated/Axal VC Website.dc.html`.
 *
 * The copy is the owner's. Every figure is read live, never typed:
 *   - the hero's four figures come from `GET /api/public/stats`, and a figure
 *     the endpoint does not return (or returns as 0) is not drawn. D675 (#1549)
 *     adds `tools`, `users` and `companies`;
 *   - the Lab band's cohort number, deadline and places come from the same
 *     cohort rule and record the Lab's own pages use;
 *   - the articles and events are the live published lists.
 * The canvas's own numbers ("488+", "656", "Cohort 5 · September 12") are
 * examples. `landing_home_d674.test.mjs` refuses them in this file.
 */

const HERO_FIGURES = [
  { key: 'tools', label: 'Tools in the platform' },
  { key: 'users', label: 'Users' },
  { key: 'companies', label: 'Companies' },
  { key: 'funds', label: 'Active funds' },
];

// Story ranking, in order: build, collaborate, then capital. Capital takes the
// neutral rule, so nothing violet points at it.
const PILLARS = [
  { eyebrow: 'Build', title: 'Venture tools', capital: false,
    desc: 'Spin-Out Lab, discovery, scoring, cap table, incorporation — the work that makes a company real.' },
  { eyebrow: 'Collaborate', title: 'Global partner network', capital: false,
    desc: 'Verified partners, advisors, and operators working with founders across borders, not a vendor directory.' },
  { eyebrow: 'Capital', title: 'When the record is ready', capital: true,
    desc: 'Fund I and the LP workspace see the same evidence the company was built on.' },
];

// Four doors, every one first-class. Each goes to its door page.
const LANES = [
  { title: 'Founders', img: 'lane-founders', cta: 'Start free',
    desc: 'Enter with an idea or an operating company. Leave with one that survives diligence.',
    items: [
      'The 28-day Spin-Out Lab takes an idea to an incorporated company',
      'Pitch deck, cap table, and fundraise in one workspace for existing companies',
      'Introductions are earned and proceed under a three-way NDA',
    ] },
  { title: 'Investors & LPs', img: 'lane-investors', cta: 'Create an investor account',
    desc: 'Back companies whose formation you can read, on a record the founder built.',
    items: [
      'A curated pipeline instead of cold inbound',
      // D676: ", numbers verified via Stripe and Plaid" is cut, as on the
      // investors' door: there is no Plaid integration.
      'Venture-readiness score with the evidence behind it',
      'Pipeline, relationships, and notes are the CRM',
    ] },
  { title: 'Operating Partners', img: 'lane-partners', cta: 'List your services',
    desc: 'Get in front of funded founders who need what you do.',
    items: [
      'A provider profile in the marketplace and the public directory',
      'Founders post needs; you answer live requests',
      // D676: "KYB, conflicts, and contracts handled; payouts through Stripe
      // Connect" is dropped, as on the partners' door: none of it runs.
    ] },
  { title: 'Advisors', img: 'lane-advisors', cta: 'Create an account',
    desc: 'Work with the founders you were built to help.',
    items: [
      'A public profile with expertise and availability',
      'Matching by sector, expertise, and availability',
      'Office hours and one-off sessions in one workspace',
    ] },
].map((lane, i) => ({ ...lane, to: DOOR_LINKS[i].to }));

// Step two is "get matched", not "get verified": people browse on email first.
const STEPS = [
  { n: '01', title: 'Join', desc: 'A 30-second intake: who you are, what you are building or bringing, where you are.' },
  { n: '02', title: 'Get matched', desc: 'The record routes you to the founders, partners, or advisors your profile actually fits.' },
  { n: '03', title: 'Unlock the network', desc: 'Collaborate from one workspace. Capital reads the same record when the work is ready.' },
];

const LAB_WEEKS = [
  { n: 'Week 1', title: 'Idea & Customer', desc: 'Problem definition, ICP, market sizing, ≥5 logged interviews' },
  { n: 'Week 2', title: 'Solution & Roadmap', desc: 'MVP scope, 90-day OKRs, brand v1, pitch deck v1' },
  { n: 'Week 3', title: 'Validate & Team', desc: 'Readiness score, advisor cadence, co-founder decision, revenue proof' },
  { n: 'Week 4', title: 'Incorporate & Capital', desc: 'Entity, founder stock, 83(b), use of funds, investor intros' },
];

// The canvas's card copy, corrected where the code says otherwise (D677's
// checks on the Platform page): the scoring engine's dimension count and the
// deck's slide count are read from the engines, not typed, and the capital
// card names only what runs (no warm-intro routing, no SAFE generation).
const TOOLS = [
  { img: 'tool-profiling', title: 'Profiling', desc: 'Skills, values, and archetype assessment that drives every downstream match.' },
  { img: 'tool-discovery', title: 'Customer Discovery', desc: 'Structured interview logs, pain severity, ICP fit, deck-eligible quotes.' },
  { img: 'tool-scoring', title: 'Scoring Engine', desc: `${numberWordCap(DIMENSIONS.length)} weighted dimensions, each with the evidence behind its score.` },
  { img: 'tool-market', title: 'Market Intel', desc: 'TAM/SAM/SOM with methodology, sources, and competitive positioning.' },
  { img: 'tool-captable', title: 'Cap Table', desc: 'Founder stock, vesting, SAFEs, option pool, and dilution modelling.' },
  { img: 'tool-incorporate', title: 'Incorporate', desc: 'Entity recommendation with rationale, formation docs, filing tracker, EIN.' },
  { img: 'tool-capital', title: 'Capital', desc: 'Investor pipeline and data room.' },
  { img: 'tool-pitch', title: 'Pitch Deck Builder', desc: `${numberWordCap(SLIDE_META.length)} slides assembled from your own recorded data, not a template.` },
];

const img = (name) => `/site/${name}.webp`;

/** The figures `/api/public/stats` returns, or null while loading or on failure. */
function useSiteStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/public/stats', { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStats(data && typeof data === 'object' ? data : null))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  return stats;
}

/** A count the endpoint returned, as a positive integer, or null. */
export function figure(stats, key) {
  const n = Number(stats?.[key]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** The hero's figures that have a real value, in the canvas's order. */
export function heroFigures(stats) {
  return HERO_FIGURES
    .map((f) => ({ ...f, value: figure(stats, f.key) }))
    .filter((f) => f.value != null);
}

function useLiveList(load) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    load().then((list) => { if (alive) setItems(list); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [load]);
  return items;
}

const loadArticles = () => import('../lib/api').then(({ articles }) => articles.list({ limit: 3 }))
  .then((r) => (Array.isArray(r?.items) ? r.items : []));
const loadEvents = () => import('../lib/api').then(({ eventsPublic }) => eventsPublic.list({ limit: 3 }))
  .then((r) => (Array.isArray(r) ? r : Array.isArray(r?.events) ? r.events : Array.isArray(r?.items) ? r.items : []));

const words = (s) => String(s || '').replace(/_/g, ' ');

function dateParts(iso, timeZone) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const fmt = (opts) => {
    try { return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timeZone || 'UTC' }).format(d); } catch {
      return new Intl.DateTimeFormat('en-US', opts).format(d);
    }
  };
  return {
    day: fmt({ day: '2-digit' }),
    mon: fmt({ month: 'short' }),
    time: fmt({ hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
    long: fmt({ month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

function Hero({ stats }) {
  const figures = heroFigures(stats);
  return (
    <section className="ax-hero" aria-labelledby="ax-hero-h">
      <img className="ax-hero-img" src={img('home-hero')} alt="" />
      <div className="ax-hero-veil" aria-hidden="true" />
      <div className="ax-wrap ax-hero-body">
        <div className="ax-lbl">The global venture creation network</div>
        <h1 id="ax-hero-h" className="ax-h1">Where we <em>build</em> the rails for the next generation of ventures</h1>
        <p className="ax-hero-copy">
          Axal VC is the operating platform for venture creation: venture tools, a verified global partner network,
          and capital when you’re ready to scale, all in one system for turning an idea into an organization.
        </p>
        <div className="ax-row-btns" style={{ marginTop: 34 }}>
          <Link to="/register" className="ax-btn ax-btn-lg ax-btn-primary">Join Axal VC →</Link>
          <Link to="/directory" className="ax-btn ax-btn-lg ax-btn-quiet">Explore the network</Link>
        </div>
        {figures.length > 0 && (
          <ul className="ax-stats" style={{ listStyle: 'none', paddingLeft: 0, paddingRight: 0, marginBottom: 0 }}>
            {figures.map((f) => (
              <li key={f.key}>
                <div className="ax-mono ax-stat-v">{f.value.toLocaleString('en-US')}</div>
                <div className="ax-lbl-q ax-stat-k">{f.label}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Pillars() {
  return (
    <section className="ax-wrap ax-section" aria-labelledby="ax-pillars-h">
      <div className="ax-lbl">What Axal VC is</div>
      <h2 id="ax-pillars-h" className="ax-h2" style={{ margin: '16px 0 10px' }}>Build. Collaborate. Scale.</h2>
      <p className="ax-lede" style={{ margin: 0 }}>Make the earliest stage of company-building legible — to founders first, and to capital second.</p>
      <div className="ax-pillars">
        {PILLARS.map((p) => (
          <div key={p.eyebrow} className={`ax-pillar${p.capital ? ' is-capital' : ''}`}>
            <div className="ax-lbl-q">{p.eyebrow}</div>
            <h3 className="ax-pillar-t">{p.title}</h3>
            <p className="ax-pillar-d" style={{ marginBottom: 0 }}>{p.desc}</p>
          </div>
        ))}
      </div>
      <p className="ax-aside">
        Axal VC is a venture firm and an operating platform. The firm’s underwriting view is on
        the <Link to="/about" className="ax-link">Firm</Link> and <Link to="/for-investors" className="ax-link">Investors</Link> pages.
      </p>
    </section>
  );
}

function Lanes() {
  return (
    <section className="ax-band" aria-labelledby="ax-lanes-h">
      <div className="ax-wrap" style={{ paddingTop: 88, paddingBottom: 88 }}>
        <div className="ax-lbl">Where you fit</div>
        <h2 id="ax-lanes-h" className="ax-h2" style={{ margin: '16px 0 8px', maxWidth: 620 }}>Four doors into the same system.</h2>
        <p className="ax-lede" style={{ margin: 0, maxWidth: 560 }}>
          Each door has a defined entry point, a defined decision, and a defined outcome. Nothing here is a mailing list.
        </p>
        <div className="ax-lanes">
          {LANES.map((l) => (
            <Link key={l.title} to={l.to} className="ax-card ax-lane">
              <div className="ax-lane-img" role="img" aria-hidden="true" style={{ backgroundImage: `url("${img(l.img)}")` }} />
              <h3 className="ax-lane-t">{l.title}</h3>
              <p className="ax-lane-d" style={{ marginBottom: 0 }}>{l.desc}</p>
              <ul className="ax-lane-items">
                {l.items.map((it) => <li key={it}>{it}</li>)}
              </ul>
              <span className="ax-lane-cta">{l.cta} →</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="ax-wrap" style={{ paddingTop: 88, paddingBottom: 88 }} aria-labelledby="ax-how-h">
      <div className="ax-split">
        <div>
          <div className="ax-lbl">How it works</div>
          <h2 id="ax-how-h" className="ax-h2" style={{ marginTop: 16, fontSize: 31 }}>Three steps: join, get matched, unlock the network.</h2>
        </div>
        <ol className="ax-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="ax-card ax-step">
              <div className="ax-mono ax-step-n">{s.n}</div>
              <h3 className="ax-step-t">{s.title}</h3>
              <p className="ax-step-d" style={{ marginBottom: 0 }}>{s.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * The cohort strip under the Lab band. The cohort number and deadline come from
 * the Lab's cohort rule (`openCohortCopy`), the places from the cohort record
 * (`useCohortPlaces`). A value it could not read is left out, never guessed.
 */
function CohortStrip() {
  const cohort = openCohortCopy();
  const places = useCohortPlaces();
  const parts = [];
  if (places.status === 'ok' && places.places > 0) parts.push(`${numberWordCap(places.places)} places.`);
  if (cohort?.deadlineLabel) parts.push(`Applications close ${cohort.deadlineLabel}.`);
  return (
    <div className="ax-cohort">
      <div className="ax-cohort-text">
        <div className="ax-cohort-k">{cohort ? `Cohort ${cohort.cohortNum} · Open` : 'Next cohort · Open'}</div>
        {parts.length > 0 && <div className="ax-cohort-v">{parts.join(' ')}</div>}
        <div className="ax-cohort-n">No equity for access.</div>
      </div>
      <div className="ax-row-btns" style={{ gap: 10 }}>
        <Link to="/spinout-lab/apply" className="ax-btn ax-btn-md ax-btn-bright">
          {cohort ? `Apply to Cohort ${cohort.cohortNum} →` : 'Apply to the next cohort →'}
        </Link>
        <Link to="/for-founders" className="ax-btn ax-btn-md ax-btn-ghost">Founder overview</Link>
      </div>
    </div>
  );
}

function LabBand() {
  return (
    <section className="ax-lab" aria-labelledby="ax-lab-h">
      <img className="ax-lab-img" src={img('lab-band')} alt="" loading="lazy" />
      <div className="ax-lab-veil" aria-hidden="true" />
      <div className="ax-lab-glow" aria-hidden="true" />
      <div className="ax-wrap ax-lab-body">
        <div className="ax-lab-split">
          <div>
            <div className="ax-lab-eyebrow">Flagship · The Spin-Out Lab</div>
            <h2 id="ax-lab-h">Spin-Out Lab<br />28-day venture sprint.</h2>
            <p className="ax-lab-copy">
              Founders arrive with a thesis and leave with an incorporated entity, clean cap table, filed 83(b),
              evidenced discovery, revenue proof, and a deck built from their own data.
            </p>
            <div className="ax-row-btns" style={{ marginTop: 22 }}>
              <Link to="/spinout-lab" className="ax-btn ax-btn-md ax-btn-bright">See the full Lab →</Link>
            </div>
          </div>
          <ol className="ax-weeks">
            {LAB_WEEKS.map((w) => (
              <li key={w.n} className="ax-week">
                <div className="ax-mono ax-week-n">{w.n}</div>
                <div className="ax-week-t">{w.title}</div>
                <div className="ax-week-d">{w.desc}</div>
              </li>
            ))}
          </ol>
        </div>
        <CohortStrip />
      </div>
    </section>
  );
}

function Platform({ stats }) {
  const tools = figure(stats, 'tools');
  return (
    <section className="ax-wrap ax-section" aria-labelledby="ax-platform-h">
      <div style={{ maxWidth: 640 }}>
        <div className="ax-lbl">The platform</div>
        <h2 id="ax-platform-h" className="ax-h2" style={{ margin: '16px 0 8px' }}>Everything you need, in one place</h2>
        <p className="ax-lede" style={{ margin: 0, maxWidth: 'none' }}>
          The tools to form a company, the network to build it with, capital when you’re ready. The data model is the
          product: every tool writes into one shared record, nothing is re-entered.
        </p>
      </div>
      <div className="ax-tools-k">
        {tools ? `A sample of the ${tools.toLocaleString('en-US')} tools inside` : 'A sample of the tools inside'}
      </div>
      <div className="ax-tools">
        {TOOLS.map((t) => (
          <Link key={t.title} to="/platform" className="ax-card ax-tool">
            <div className="ax-tool-art"><img src={img(t.img)} alt="" loading="lazy" /></div>
            <h3 className="ax-tool-t">{t.title}</h3>
            <p className="ax-tool-d" style={{ marginBottom: 0 }}>{t.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function NetworkTeaser() {
  const articles = useLiveList(loadArticles);
  const events = useLiveList(loadEvents);
  return (
    <section className="ax-band" aria-labelledby="ax-net-h">
      <div className="ax-wrap" style={{ paddingTop: 84, paddingBottom: 84 }}>
        <div className="ax-net-head">
          <div>
            <div className="ax-lbl">The network</div>
            <h2 id="ax-net-h" className="ax-h2" style={{ marginTop: 14, fontSize: 34 }}>What we are writing, and what is on the calendar.</h2>
          </div>
          <Link to="/articles" className="ax-link" style={{ fontSize: 13.5 }}>All articles →</Link>
        </div>
        <div className="ax-net-grid">
          <div className="ax-articles">
            {articles === null && <p className="ax-meta">Loading the latest writing…</p>}
            {articles !== null && articles.length === 0 && (
              <p className="ax-meta">No articles are published yet.</p>
            )}
            {(articles || []).map((a) => {
              const when = dateParts(a.published_at, 'UTC');
              const meta = [when?.long, a.read_minutes ? `${a.read_minutes} min read` : null].filter(Boolean).join(' · ');
              return (
                <Link key={a.id || a.slug} to={`/articles/${a.slug}`} className="ax-card ax-article">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {a.sector && <span className="ax-chip">{words(a.sector)}</span>}
                    {meta && <span className="ax-meta">{meta}</span>}
                  </div>
                  <h3 className="ax-article-t">{a.title}</h3>
                  {a.subtitle && <p className="ax-article-d" style={{ marginBottom: 0 }}>{a.subtitle}</p>}
                </Link>
              );
            })}
          </div>
          <div className="ax-cal">
            <div className="ax-cal-head">
              <div className="ax-cal-k">Next on the calendar</div>
              <Link to="/events" className="ax-link" style={{ fontSize: 12 }}>All events →</Link>
            </div>
            {events === null && <div className="ax-cal-empty">Loading the calendar…</div>}
            {events !== null && events.length === 0 && (
              <div className="ax-cal-empty">Nothing is scheduled right now. Check back soon.</div>
            )}
            {(events || []).map((ev) => {
              const when = dateParts(ev.starts_at, ev.timezone);
              return (
                <Link key={ev.id || ev.slug} to={`/events/${ev.slug || ev.id}`} className="ax-cal-row">
                  <div className="ax-cal-date">
                    <div className="ax-cal-day">{when?.day || '—'}</div>
                    <div className="ax-cal-mon">{when?.mon || ''}</div>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ax-cal-t">{ev.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 5 }}>
                      {ev.type && <span className="ax-chip ax-chip-quiet">{words(ev.type)}</span>}
                      {when?.time && <span className="ax-meta">{when.time}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
            <div className="ax-cal-foot">
              <div className="ax-meta" style={{ fontSize: 12.5, color: 'var(--ax-body)', maxWidth: 240, lineHeight: 1.55 }}>
                Circles meet on a fixed cadence, capped so the room stays useful.
              </div>
              <Link to="/circles" className="ax-link" style={{ fontSize: 12.5 }}>Circles →</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="ax-wrap" style={{ paddingTop: 64, paddingBottom: 96 }} aria-labelledby="ax-close-h">
      <div className="ax-close" style={{ backgroundImage: `url("${img('door-founders')}")` }}>
        <div className="ax-close-veil" aria-hidden="true" />
        <div style={{ position: 'relative', maxWidth: 560 }}>
          <h2 id="ax-close-h">Join the network building what’s next.</h2>
          <p className="ax-close-copy" style={{ margin: 0 }}>
            Founder, partner, investor, or advisor — start with a 30-second intake and get matched to the right side of the network.
          </p>
        </div>
        <div className="ax-row-btns" style={{ position: 'relative' }}>
          <Link to="/register" className="ax-btn ax-btn-lg ax-btn-bright">Join Axal VC →</Link>
          <Link to="/contact" className="ax-btn ax-btn-lg ax-btn-ghost">Talk to us</Link>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  useForcedLightTheme();
  const stats = useSiteStats();
  // Task #2 — funnel: top of the signup funnel. First-touch attribution
  // (utm_*, ref, lane…) is captured by the tracker itself on page load.
  useEffect(() => {
    track('landing_view');
  }, []);
  return (
    <div className="ax-site">
      <PublicNav />
      <main className="ax-home ax-in">
        <Hero stats={stats} />
        <Pillars />
        <Lanes />
        <HowItWorks />
        <LabBand />
        <Platform stats={stats} />
        <NetworkTeaser />
        <ClosingCta />
      </main>
      <PublicFooter />
    </div>
  );
}
