import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, Banknote, Globe, Handshake, Rocket, ArrowRight, ChevronRight,
  Sparkles, GraduationCap, BadgeCheck, LockKeyhole,
  UserPlus, Calendar,
} from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import useForcedLightTheme from '../hooks/useForcedLightTheme';

const THESIS_PILLS = ['AI', 'Blockchain', 'Quantum', 'Digital Infrastructure', 'Frontier Software'];

const LANES = [
  {
    id: 'founder',
    title: 'For Founders',
    bullets: [
      'Idea to incorporated company in the 30-day Spin-Out Lab',
      'Pitch deck → cap table → fundraise for existing companies',
      'Personal Advisor, advisor track, and investor exposure',
    ],
    cta: 'Apply as Founder',
    href: '/register?lane=founder',
    color: '#a66fd2',
    icon: Rocket,
  },
  {
    id: 'lp',
    title: 'For Investors & LPs',
    bullets: [
      'Disciplined, evidence-backed deal flow',
      'Founder numbers verified via Stripe + Plaid',
      'One ledger for commitments, calls, and distributions',
    ],
    cta: 'Open LP Account',
    href: '/register?lane=lp',
    color: '#b771e4',
    icon: Banknote,
  },
  {
    id: 'partner',
    title: 'For Partners',
    bullets: [
      'Source thesis-aligned companies',
      'Offer services to portfolio companies and co-invest',
      'KYB, conflicts, and contracts handled for you',
    ],
    cta: 'Apply as Partner',
    href: '/register?lane=partner',
    color: '#c790e4',
    icon: Handshake,
  },
  {
    id: 'advisor',
    title: 'For Advisors',
    bullets: [
      'Share time on your own schedule',
      'Office Hours and one-off advisor sessions',
      'Pick the sectors and stages you care about',
    ],
    cta: 'Become an Advisor',
    href: '/register?lane=advisor',
    color: '#926dc0',
    icon: GraduationCap,
  },
];

const HOW_IT_WORKS = [
  {
    week: 'Step 1',
    title: 'Join the lane that fits',
    icon: UserPlus,
    desc: 'Founder, investor, partner, advisor, or coach — pick the door that matches what you do.',
  },
  {
    week: 'Step 2',
    title: 'Get matched',
    icon: BadgeCheck,
    desc: 'Browse and match with just your email — verification comes later, only when you invest or sign.',
  },
  {
    week: 'Step 3',
    title: 'Unlock the network',
    icon: LockKeyhole,
    desc: 'Introductions and deal data open up, gated by signed NDAs and evidence-backed scoring.',
  },
];

// Top of the platform, curated. Every link points at a public page or the
// join flow — no card lands a logged-out visitor on a login wall.
const PLATFORM_FEATURES = [
  { icon: Rocket, title: 'Spin-Out Lab', desc: 'A 30-day venture sprint — go from idea to funded company in four weeks.', to: '/spinout-lab' },
  { icon: Globe, title: 'Public Directory', desc: 'Browse founders, partners, and investors already building in the network.', to: '/directory' },
  { icon: Calendar, title: 'Programs & Events', desc: 'Office Hours, demo days, and workshops — open across the network.', to: '/events' },
  { icon: Sparkles, title: 'Personal AI Advisor', desc: 'An always-on advisor with full founder context for strategy, GTM, and fundraising.', to: '/register?lane=founder' },
  { icon: Banknote, title: 'Capital & LP Portal', desc: 'Capital calls, LP ledger, TVPI/DPI by vintage, and distributions in one place.', to: '/register?lane=lp' },
  { icon: Handshake, title: 'Partner Marketplace', desc: 'Services-for-equity or -fee partners, referral tracking, and co-marketing.', to: '/register?lane=partner' },
];

const FALLBACK_STATS = { partners: 200, funds: 4, deals_scored: 1200, spinouts: 38 };

function useCountUp(target, durationMs = 600) {
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    if (typeof target !== 'number' || Number.isNaN(target)) return;
    startedRef.current = true;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (0.5 - 0.5 * Math.cos(Math.PI * t))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function StatCard({ value, label, suffix }) {
  const n = useCountUp(value);
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center dark:border-gray-800">
      <div className="text-2xl md:text-3xl font-bold text-violet-600 tabular-nums">
        {n.toLocaleString()}<span className="text-lg">{suffix || ''}</span>
      </div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function StatsBar() {
  const [stats, setStats] = useState(FALLBACK_STATS);
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/public/stats', { signal: ctrl.signal });
        if (!res.ok) throw new Error('non-200');
        const data = await res.json();
        setStats({
          partners: Number(data?.partners ?? FALLBACK_STATS.partners),
          funds: Number(data?.funds ?? FALLBACK_STATS.funds),
          deals_scored: Number(data?.deals_scored ?? FALLBACK_STATS.deals_scored),
          spinouts: Number(data?.spinouts ?? FALLBACK_STATS.spinouts),
        });
      } catch { /* silent */ }
    })();
    return () => ctrl.abort();
  }, []);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 max-w-3xl mx-auto">
      <StatCard value={stats.partners} label="Network Partners" suffix="+" />
      <StatCard value={stats.funds} label="Active Funds" />
      <StatCard value={stats.deals_scored} label="Deals Scored" suffix="+" />
      <StatCard value={stats.spinouts} label="Spin-Outs Completed" />
    </div>
  );
}

function LatestArticles() {
  const [items, setItems] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    import('../lib/api').then(({ articles }) =>
      articles.list({ limit: 3 })
        .then((r) => { if (alive) setItems(r.items || []); })
        .catch(() => { if (alive) setItems([]); }),
    );
    return () => { alive = false; };
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <section className="py-20 px-6 bg-white dark:bg-gray-900">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100">Latest from the network</h2>
            <p className="mt-2 text-sm text-gray-600">Long-form writing from Axal VC founders, investors, partners, and the studio.</p>
          </div>
          <Link to="/articles" className="hidden sm:inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800 font-medium">
            All articles <ChevronRight size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((a) => (
            <Link
              key={a.id}
              to={`/articles/${a.slug}`}
              className="group block rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-violet-400 transition dark:border-gray-800 dark:bg-gray-900"
            >
              {a.cover_url ? (
                <img src={a.cover_url} alt="" className="w-full aspect-[16/9] object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div className="w-full aspect-[16/9] bg-gradient-to-br from-violet-100 to-violet-50" />
              )}
              <div className="p-4">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {a.sector && <span>{a.sector.replace(/_/g, ' ')}</span>}
                  {a.read_minutes ? <><span>·</span><span>{a.read_minutes} min</span></> : null}
                </div>
                <h3 className="font-semibold text-base text-gray-900 group-hover:text-violet-700 line-clamp-2 dark:text-gray-100">{a.title}</h3>
                {a.subtitle && <p className="mt-1 text-sm text-gray-600 line-clamp-2">{a.subtitle}</p>}
                <p className="mt-3 text-xs text-gray-500">by {a.author || '—'}</p>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-6 text-center sm:hidden">
          <Link to="/articles" className="inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800 font-medium">
            All articles <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// Landing "Upcoming events" teaser (public feed). Public surface — renders a
// graceful empty state and never breaks the page on a fetch error.
function UpcomingEventsTeaser() {
  const [events, setEvents] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    import('../lib/api').then(({ eventsPublic }) =>
      eventsPublic.list({ limit: 3 })
        .then((r) => {
          const list = Array.isArray(r) ? r
            : Array.isArray(r?.events) ? r.events
            : Array.isArray(r?.items) ? r.items
            : [];
          if (alive) setEvents(list);
        })
        .catch(() => { if (alive) setEvents([]); }),
    );
    return () => { alive = false; };
  }, []);

  const fmt = (v) => {
    if (!v) return 'Date TBD';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    try { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return v; }
  };

  return (
    <section className="py-20 px-6 bg-gray-50 dark:bg-gray-900/40">
      <div className="max-w-3xl mx-auto">
        {/* Upcoming events */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Upcoming events</h2>
            <Link to="/events" className="inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800 font-medium dark:text-violet-300">
              All events <ChevronRight size={14} />
            </Link>
          </div>
          {events === null ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming events right now — check back soon.</p>
          ) : (
            <ul className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id || ev.slug}>
                  <Link
                    to={`/events/${ev.slug || ev.id}`}
                    className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 hover:border-violet-300 transition-colors dark:border-gray-800 dark:hover:border-violet-700"
                  >
                    <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 dark:bg-violet-900/40">
                      <Calendar size={18} className="text-violet-600 dark:text-violet-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{ev.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {fmt(ev.starts_at)}
                        {ev.location_text ? ` · ${ev.location_text}` : (ev.location_kind ? ` · ${ev.location_kind}` : '')}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  useForcedLightTheme();
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <PublicNav />

      {/* HERO — one clear promise, one primary action. */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-100 border border-violet-300 rounded-full text-xs text-violet-700 mb-8">
              <Zap size={12} /> Axal VC · Global Venture Network
            </div>
            <h1
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              className="text-5xl md:text-7xl font-bold leading-tight mb-6 text-gray-900 dark:text-gray-100"
            >
              Where venture builders meet{' '}
              <span className="text-violet-600">capital</span>
              <br />globally.
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed">
              Axal VC is one verified network for founders, investors, and partners —
              from first idea to funded company. Join the side that fits you.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
              {THESIS_PILLS.map((p) => (
                <span key={p} className="text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700 dark:border-gray-800 dark:text-gray-300">
                  {p}
                </span>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/register"
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20 hover:shadow-violet-600/40"
              >
                Join Axal VC <ArrowRight size={16} />
              </Link>
              <Link
                to="/directory"
                className="flex items-center gap-2 bg-white hover:bg-violet-50 border border-violet-300 text-violet-700 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium dark:bg-gray-900"
              >
                Explore the network <ChevronRight size={16} />
              </Link>
            </div>
          </div>

          <StatsBar />
        </div>
      </section>

      {/* WHO IT'S FOR — five lanes into the network. */}
      <section id="lanes" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Built for every side of venture.
            </h2>
            <p className="text-gray-600">
              Pick the door that fits — every lane is a first-class citizen.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {LANES.map((lane) => {
              const Icon = lane.icon;
              return (
                <div key={lane.id} className="rounded-2xl border p-6 flex flex-col bg-white dark:bg-gray-900" style={{ borderColor: lane.color }}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                      <Icon size={18} className="text-violet-700" />
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{lane.title}</h3>
                  </div>
                  <ul className="space-y-2 mb-6 flex-1">
                    {lane.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={lane.href}
                    className="inline-flex items-center justify-center gap-2 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: lane.color }}
                  >
                    {lane.cta} <ArrowRight size={14} />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW THE NETWORK WORKS */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">How it works.</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Three steps: join, get verified, unlock the network.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={i} className="relative bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-lg hover:border-violet-300 transition-all dark:bg-gray-900 dark:border-gray-800">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-violet-600 rounded-t-2xl" />
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500 font-medium">{step.week}</div>
                  <step.icon size={16} className="text-violet-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">{step.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SPIN-OUT LAB — flagship product highlight.
          Copy aligned 1:1 with /spinout-lab; deep-links into the full Lab page. */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-3xl border-2 border-violet-200 bg-violet-50/40 p-10 md:p-14 grid md:grid-cols-3 gap-10">
            <div className="md:col-span-2 space-y-8">
              <div>
                <span className="inline-block text-[11px] uppercase tracking-wider font-semibold text-violet-700 bg-violet-100 px-2.5 py-1 rounded">
                  Flagship product
                </span>
                <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mt-4 mb-4 dark:text-gray-100">
                  Spin-Out Lab — 30-day venture sprint.
                </h2>
                <p className="text-base text-gray-700 leading-relaxed dark:text-gray-300">
                  For founders with an idea and no incorporated company yet. Four weeks. Four
                  milestones. Ends with a Delaware C-Corp (or alt), cap table, 83(b), pitch deck,
                  and venture-readiness score.
                </p>
              </div>

              <div>
                <h3 className="text-sm uppercase tracking-wider text-violet-700 font-semibold mb-2">
                  What you get
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">
                  A high-touch spin-out program with advisor support, warm intros,
                  advisor matching, and the tooling founders need to move fast.{' '}
                  <Link
                    to="/spinout-lab#what-you-get"
                    className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-900 font-medium"
                  >
                    See full list <ArrowRight size={12} />
                  </Link>
                </p>
              </div>

              <div>
                <h3 className="text-sm uppercase tracking-wider text-violet-700 font-semibold mb-2">
                  What we look for
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">
                  Strong founder-market fit, deep domain insight, customer access,
                  full-time commitment, and clear reasons to say yes or no.{' '}
                  <Link
                    to="/spinout-lab#what-we-look-for"
                    className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-900 font-medium"
                  >
                    See full criteria <ArrowRight size={12} />
                  </Link>
                </p>
              </div>

              <Link
                to="/spinout-lab"
                className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-colors px-6 py-3 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/20"
              >
                See the full Lab <ArrowRight size={16} />
              </Link>
            </div>

            {/* The 4-week playbook — one line per week. */}
            <div className="md:col-span-1">
              <h3 className="text-sm uppercase tracking-wider text-violet-700 font-semibold mb-4">
                The 4-week playbook
              </h3>
              <ol className="space-y-4">
                {[
                  { n: 1, title: 'Idea & Customer', desc: 'Frame the problem, size the market, log ≥5 customer interviews.' },
                  { n: 2, title: 'Solution & Roadmap', desc: 'Scope the MVP, set 90-day OKRs, draft brand v1 + deck v1.' },
                  { n: 3, title: 'Validate & Team', desc: 'First venture-readiness score, advisor cadence, co-founder track.' },
                  { n: 4, title: 'Incorporate & Capital', desc: 'Incorporate, vest, file 83(b), lock the ask, three warm intros.' },
                ].map((w) => (
                  <li key={w.n} className="flex gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">
                      {w.n}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Week {w.n} — {w.title}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">{w.desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT'S INSIDE — top of the platform, curated. */}
      <section id="platform" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">Everything you need, in one place</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              From incorporation to capital — the tools and network behind every venture.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PLATFORM_FEATURES.map((f, i) => (
              <Link
                key={i}
                to={f.to}
                className="flex items-start gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:border-violet-300 hover:shadow-lg transition-all group dark:bg-gray-900 dark:border-gray-800"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                  <f.icon size={18} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-1 text-gray-900 flex items-center gap-1.5 dark:text-gray-100">
                    {f.title}
                    <ChevronRight size={12} className="text-gray-400 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all" />
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{f.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Upcoming-events teaser (public surface). */}
      <UpcomingEventsTeaser />

      {/* Latest from the network (3 most recent published articles).
          Public surface; renders nothing on empty/fetch error so it never breaks the page. */}
      <LatestArticles />

      {/* CTA */}
      <section className="py-20 px-6 bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Join the network building <span className="text-violet-400">what&apos;s next</span>.
          </h2>
          <p className="text-gray-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            Founder, investor, or partner — start with a 30-second intake and
            get matched to the right side of the network.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/register"
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 transition-all px-7 py-3.5 rounded-xl text-sm font-medium text-white shadow-lg shadow-violet-600/30"
            >
              Join Axal VC <ArrowRight size={16} />
            </Link>
            <Link
              to="/contact"
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-white"
            >
              Talk to us <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
