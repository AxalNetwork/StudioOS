/**
 * ProductAudiencePage — one data-driven marketing page rendered for each of
 * the four audiences (Founders / Investors & LPs / Service Partners /
 * Advisors). All copy, pricing, feature split and accent theming come from
 * `frontend/src/data/productPages.js`; this file is pure presentation so the
 * four surfaces stay in lockstep and are edited in one place.
 *
 * Reuses the public marketing chrome (PublicNav + PublicFooter) and the same
 * design language as SpinoutLabMarketingPage / PricingPage: Space Grotesk
 * headings, violet-family accents, rounded cards and <details> FAQ.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import {
  Rocket, FileText, Gauge, Handshake, Search, Kanban, PieChart, Store, Inbox,
  BadgeCheck, BarChart3, UserCircle, Sparkles, Calendar, Star,
  Check, Clock, ArrowRight,
} from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import { usePageMeta } from '../lib/seo';
import { PRODUCT_PAGES } from '../data/productPages';
import NotFoundPage from './NotFoundPage';

// Icon names in the config resolve through this map — keeps the data file
// free of JSX/imports while still type-safe-ish (an unknown name falls back
// to a neutral glyph rather than crashing the render).
const ICONS = {
  Rocket, FileText, Gauge, Handshake, Search, Kanban, PieChart, Store, Inbox,
  BadgeCheck, BarChart3, UserCircle, Sparkles, Calendar, Star,
};

function Benefit({ icon, title, body, accent }) {
  const Glyph = ICONS[icon] || Sparkles;
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-lg transition-shadow">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${accent.chip}`}>
        <Glyph size={18} />
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-1.5">{title}</h3>
      <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
    </div>
  );
}

function PlanCard({ plan, accent }) {
  const featured = !!plan.highlight;
  return (
    <div
      className={`relative rounded-2xl border p-6 flex flex-col bg-white ${
        featured ? accent.featuredCard : 'border-gray-200'
      }`}
    >
      {featured && (
        <div className={`absolute -top-3 left-6 px-3 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${accent.popularBadge}`}>
          <Sparkles size={11} aria-hidden="true" /> Most popular
        </div>
      )}
      <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
      <p className="mt-1 text-sm text-gray-600 min-h-[40px]">{plan.blurb}</p>
      <div className="mt-4 flex items-baseline gap-1 flex-wrap">
        <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
        {plan.period && <span className="text-sm text-gray-500">{plan.period}</span>}
      </div>
      <Link
        to={plan.cta.to}
        className={`mt-5 inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-medium transition-colors ${
          featured ? accent.button : accent.buttonSoft
        }`}
      >
        {plan.cta.label}
      </Link>
      <ul className="mt-6 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f.text} className="flex items-start gap-2 text-sm text-gray-700">
            <Check size={16} className={`${accent.check} mt-0.5 shrink-0`} aria-hidden="true" />
            <span>
              {f.text}
              {f.soon && (
                <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">
                  Soon
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProductAudiencePage({ slug }) {
  const cfg = PRODUCT_PAGES[slug];

  // Keep SEO hook order stable even on the (unreachable) miss path.
  usePageMeta({
    title: cfg?.meta.title || 'Products',
    description: cfg?.meta.description || '',
    path: cfg?.path || '/',
  });

  if (!cfg) return <NotFoundPage />;

  const { accent, hero } = cfg;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* HERO */}
      <section className="pt-32 pb-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 border rounded-full text-xs mb-6 ${accent.badge}`}>
            <Sparkles size={12} /> {cfg.eyebrow}
          </div>
          <h1
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            className="text-4xl md:text-6xl font-bold leading-tight tracking-tight text-gray-900 mb-5"
          >
            {hero.headlinePre}
            <span className={accent.highlight}>{hero.headlineHi}</span>
            {hero.headlinePost}
          </h1>
          <p className="text-lg md:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            {hero.sub}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 items-center justify-center">
            <Link
              to={cfg.primaryCta.to}
              className={`inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-medium transition-colors ${accent.button}`}
            >
              {cfg.primaryCta.label} <ArrowRight size={16} />
            </Link>
            <Link
              to={cfg.secondaryCta.to}
              className="inline-flex items-center gap-2 border border-gray-300 hover:border-gray-400 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-gray-800"
            >
              {cfg.secondaryCta.label}
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-500 max-w-2xl mx-auto">
            <span className="font-semibold text-gray-700">Who it's for:</span> {cfg.forWho}
          </p>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="pb-4 px-6">
        <div className={`max-w-3xl mx-auto rounded-2xl border p-6 md:p-8 text-center ${accent.sectionTint}`}>
          <h2 className="text-sm uppercase tracking-wider font-semibold text-gray-500 mb-2">
            The problem
          </h2>
          <p className="text-base md:text-lg text-gray-800 leading-relaxed">{cfg.problem}</p>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              Why {cfg.navLabel.replace(/^For /, '')} choose Axal VC.
            </h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              The value in four moves — not a feature dump.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {cfg.benefits.map((b) => (
              <Benefit key={b.title} {...b} accent={accent} />
            ))}
          </div>
        </div>
      </section>

      {/* LIVE vs COMING SOON */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              What's live now — and what's next.
            </h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              We ship honestly. Live features work today; roadmap items are labelled, not hidden.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                  <Check size={12} /> Live now
                </span>
              </div>
              <ul className="space-y-3">
                {cfg.liveFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                    <Check size={16} className={`${accent.check} mt-0.5 shrink-0`} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-gray-200 text-gray-600">
                  <Clock size={12} /> Coming soon
                </span>
              </div>
              <ul className="space-y-3">
                {cfg.comingSoon.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
                    <Clock size={16} className="text-gray-400 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-20 px-6 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">Pricing.</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Three plans. Start free, upgrade when it pays off.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3 items-start">
            {cfg.plans.map((p) => (
              <PlanCard key={p.name} plan={p} accent={accent} />
            ))}
          </div>
          <p className="text-center text-xs text-gray-500 mt-8">
            Prices in USD, billed monthly, cancel anytime. Items marked{' '}
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">Soon</span>{' '}
            are on the roadmap. Questions?{' '}
            <a href="mailto:hello@axal.vc" className={`${accent.link} underline-offset-2 hover:underline`}>hello@axal.vc</a>
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-10 text-center">FAQ.</h2>
          <div className="space-y-3">
            {cfg.faq.map((f, i) => (
              <details
                key={i}
                className="group bg-white border border-gray-200 rounded-xl p-5 open:border-gray-300"
              >
                <summary className="cursor-pointer text-sm font-semibold text-gray-900 list-none flex items-center justify-between">
                  {f.q}
                  <span className={`${accent.highlight} text-xs group-open:rotate-180 transition-transform`}>
                    ▾
                  </span>
                </summary>
                <p className="text-sm text-gray-700 leading-relaxed mt-3">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="py-20 px-6">
        <div className={`max-w-3xl mx-auto rounded-3xl border-2 p-8 md:p-12 text-center ${accent.sectionTint}`}>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">{cfg.closing.headline}</h2>
          <p className="text-base text-gray-700 mb-8">{cfg.closing.sub}</p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <Link
              to={cfg.primaryCta.to}
              className={`inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-medium transition-colors ${accent.button}`}
            >
              {cfg.primaryCta.label} <ArrowRight size={16} />
            </Link>
            <Link
              to={cfg.secondaryCta.to}
              className="inline-flex items-center gap-2 border border-gray-300 hover:border-gray-400 transition-colors px-7 py-3.5 rounded-xl text-sm font-medium text-gray-800"
            >
              {cfg.secondaryCta.label}
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
