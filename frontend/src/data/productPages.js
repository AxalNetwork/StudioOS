/**
 * Audience product pages — single source of truth.
 *
 * Four conversion pages ("For Founders", "For Investors / LPs",
 * "For Service Partners", "For Advisors") all render from this config via
 * `frontend/src/pages/ProductAudiencePage.jsx`. Centralising the copy,
 * feature split and pricing here keeps the four surfaces from drifting and
 * makes them trivial to edit without touching JSX.
 *
 * Honesty rules baked into the data:
 *   - `liveFeatures`  = capabilities that exist on the platform today. Every
 *     item maps to a real route/API in this repo (verified at authoring time).
 *   - `comingSoon`    = on the roadmap, not shipped. Never dressed up as live.
 *   - Pricing plan features can carry `{ soon: true }` to render an inline
 *     "Soon" chip so roadmap items inside a plan stay clearly labelled.
 *
 * Accent theming: each audience gets a distinct accent so the pages read as
 * a family, not clones. Values are COMPLETE Tailwind class strings (never
 * concatenated) so the Tailwind v4 scanner keeps them in the bundle.
 */

import { FOUNDER_TIERS, INVESTOR_TIERS } from './pricing';

// Founder + Investor Starter/Pro plans are DERIVED from the shared pricing
// source (`data/pricing.js`, itself sourced from PaywallModal.TIER_PLANS) so
// the /pricing and /for-* surfaces can never drift on price or the core
// feature list. Enterprise/Custom tiers and the whole Partner/Advisor surface
// are hand-authored below (no backend catalog/paywall equivalent exists yet).
//
// Every quantitative claim is grounded in real enforcement:
//   - Founder free-tier limits: middleware/requireTier.ts (FREE_TIER_LIMITS)
//     and the Growth/Studio feature split in PaywallModal.TIER_PLANS.
//   - Investor quotas: middleware/requireInvestorTier.ts (INVESTOR_QUOTAS —
//     free 3 intros/qtr + 1 dealroom, pro 25 + 5, institutional 100 + ∞ + 4 seats).
//   - Partner/Advisor: there is NO quota table in accountPlans.ts and no
//     per-account offer/session cap enforced anywhere in the worker, so those
//     plans carry NO hard numbers — differentiators are worded as capabilities,
//     never as enforced limits.

const tierById = (tiers, id) => {
  const t = tiers.find((x) => x.id === id);
  if (!t) throw new Error(`productPages: missing pricing tier "${id}"`);
  return t;
};

/**
 * Adapt a shared pricing tier (from FOUNDER_TIERS / INVESTOR_TIERS) into an
 * audience-page plan card. The tier owns price + the canonical feature list;
 * `overrides` layer page-specific positioning on top:
 *   - id / name / blurb / cta / highlight / tagline / badge — plain overrides
 *   - featureMeta: map a feature's text → { limit?, detail?, soon? } to enrich
 *     the shared bullet without duplicating it
 *   - extraFeatures: audience-specific bullets appended after the shared list
 * Feature objects follow the { text, detail?, limit?, soon? } model rendered by
 * PlanCard.
 */
function mapTierToProductPlan(tier, overrides = {}) {
  const { featureMeta = {}, extraFeatures = [], ...rest } = overrides;
  const price = tier.priceMonthly === 0 ? '$0' : `${tier.priceMonthly}`;
  const period = tier.priceMonthly === 0 ? 'forever' : '/ month';
  const features = [
    ...tier.features.map((text) => ({ text, ...(featureMeta[text] || {}) })),
    ...extraFeatures,
  ];
  return {
    id: tier.id,
    name: tier.name,
    price,
    period,
    highlight: tier.highlight || false,
    blurb: tier.tagline,
    cta: tier.cta,
    features,
    ...rest,
  };
}

export const PRODUCT_PAGES = {
  founders: {
    slug: 'founders',
    path: '/for-founders',
    navLabel: 'For Founders',
    meta: {
      title: 'For Founders',
      description:
        'Everything you need to go from idea to funded — a startup workspace, pitch deck builder, venture-readiness scoring, and warm investor intros on the Axal VC network.',
    },
    accent: {
      badge: 'bg-violet-100 border-violet-300 text-violet-700',
      highlight: 'text-violet-600',
      button:
        'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-600/30',
      buttonSoft:
        'border border-violet-200 text-violet-700 hover:bg-violet-50',
      featuredCard: 'border-violet-500 shadow-lg ring-1 ring-violet-500/30',
      popularBadge: 'bg-violet-600 text-white',
      check: 'text-violet-600',
      link: 'text-violet-700 hover:text-violet-900',
      sectionTint: 'bg-violet-50/40 border-violet-200',
      chip: 'bg-violet-100 text-violet-700',
    },
    eyebrow: 'For Founders · product-led growth',
    hero: {
      headlinePre: 'Go from idea to ',
      headlineHi: 'funded',
      headlinePost: ' — on one operating platform.',
      sub:
        'Build your startup in a real workspace, sharpen your raise, and get in front of investors on the Axal VC network. The same engine our Spin-Out Lab founders use — self-serve, from day one.',
    },
    forWho:
      'Early-stage founders who want product, fundraising and network access in one place — whether you are validating a first idea or gearing up for a priced round.',
    problem:
      'Founders lose weeks stitching together a deck tool, a CRM, a data room and cold outreach — then still struggle to reach investors who will actually take the meeting. Axal VC collapses that stack and plugs you into a warm network.',
    primaryCta: { label: 'Start free', to: '/register?lane=founder&product=founders' },
    secondaryCta: { label: 'See Spin-Out Lab', to: '/spinout-lab' },
    benefits: [
      {
        icon: 'Rocket',
        title: 'One startup workspace',
        body: 'Startups, roadmap, brand and cap table in a single place — no more tab sprawl across half a dozen tools.',
      },
      {
        icon: 'FileText',
        title: 'Pitch deck builder',
        body: 'Draft an investor-ready deck in-product from proven templates, then export or share a live link.',
      },
      {
        icon: 'Gauge',
        title: 'Venture-readiness scoring',
        body: 'Score your venture against the same diligence rubric investors use, with evidence-confidence on every dimension.',
      },
      {
        icon: 'Handshake',
        title: 'Warm investor intros',
        body: 'Qualified founders get introduced to investors on the network under a three-way NDA — not cold email.',
      },
    ],
    liveFeatures: [
      'Startup workspace — Startups, 90-day roadmap, brand builder and cap table',
      'Pitch deck builder with shareable links and export',
      'Venture-readiness scoring with evidence-confidence',
      'Customer discovery + Market Intelligence dashboards',
      'Fundraising tools — the raise pipeline, cap table and use-of-funds',
      'Warm founder → investor introductions (three-way NDA gated)',
      'Public profile + directory visibility to the network',
      'Refer & earn credits for bringing founders into the network',
      'Incorporation, 83(b) and cofounder agreement generation with e-sign',
    ],
    comingSoon: [
      'AI pitch deck reviewer — automated slide-by-slide scoring and feedback',
      'Perks marketplace — redeem credits for partner tools and services',
      'Auto-matched investor intros ranked by thesis fit',
    ],
    plans: [
      mapTierToProductPlan(tierById(FOUNDER_TIERS, 'free'), {
        id: 'free',
        name: 'Starter',
        tagline: 'Validate an idea, free',
        blurb: 'Validate one idea end-to-end and build your public profile.',
        cta: { label: 'Start free', to: '/register?lane=founder&plan=free' },
        featureMeta: {
          '1 active startup': {
            limit: '1 workspace',
            detail: 'Free accounts run one active startup workspace at a time.',
          },
        },
      }),
      mapTierToProductPlan(tierById(FOUNDER_TIERS, 'growth'), {
        id: 'pro',
        name: 'Pro',
        tagline: 'For founders raising now',
        badge: 'Raise-ready toolkit',
        blurb: 'For founders actively building toward a raise.',
        cta: { label: 'Start 14-day trial', to: '/register?lane=founder&plan=growth' },
        featureMeta: {
          'Unlimited projects': { detail: 'No cap on active startup workspaces.' },
          'Cap-table scenarios + simulator': {
            detail: 'Model dilution and round outcomes before you raise.',
          },
        },
        extraFeatures: [
          { text: 'AI pitch deck reviewer', soon: true },
        ],
      }),
      {
        id: 'enterprise',
        name: 'Enterprise / Custom',
        price: 'Custom',
        period: '',
        tagline: 'For studios & accelerators',
        blurb: 'Studios, accelerators and programs supporting many founders.',
        cta: { label: 'Talk to us', to: '/contact' },
        features: [
          { text: 'Everything in Pro for every founder in your program' },
          { text: 'Cohort onboarding + Spin-Out Lab sprints' },
          { text: 'Shared portfolio visibility' },
          { text: 'Priority intros + dedicated support' },
          { text: 'Volume pricing' },
        ],
      },
    ],
    faq: [
      {
        q: 'Do I need to pay to start?',
        a: 'No. Starter is free forever and lets you build a workspace, a deck and a public profile. Upgrade to Pro when you are actively raising.',
      },
      {
        q: 'How do investor introductions work?',
        a: 'Introductions are earned, not bought, and are not gated by plan — any founder on the network is eligible. An investor requests the intro, and it proceeds under a three-way NDA once you accept — never cold outreach or a paid list.',
      },
      {
        q: 'Is the AI pitch deck reviewer available today?',
        a: 'The pitch deck builder is live now. The AI reviewer that scores and critiques your slides is on the roadmap and marked "Coming soon" throughout.',
      },
      {
        q: 'Can I bring an existing startup?',
        a: 'Yes. Import where you are and fast-forward through the steps you have already completed — nothing is locked to a "start from zero" flow.',
      },
    ],
    closing: {
      headline: 'Build your startup where the investors already are.',
      sub: 'Start free today. Upgrade when you raise.',
    },
  },

  investors: {
    slug: 'investors',
    path: '/for-investors',
    navLabel: 'For Investors / LPs',
    meta: {
      title: 'For Investors & LPs',
      description:
        'Source, screen and diligence better deals in less time. AI scoring, a built-in CRM, warm founder intros and portfolio visibility for angels, funds and LPs.',
    },
    accent: {
      badge: 'bg-indigo-100 border-indigo-300 text-indigo-700',
      highlight: 'text-indigo-600',
      button:
        'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30',
      buttonSoft:
        'border border-indigo-200 text-indigo-700 hover:bg-indigo-50',
      featuredCard: 'border-indigo-500 shadow-lg ring-1 ring-indigo-500/30',
      popularBadge: 'bg-indigo-600 text-white',
      check: 'text-indigo-600',
      link: 'text-indigo-700 hover:text-indigo-900',
      sectionTint: 'bg-indigo-50/40 border-indigo-200',
      chip: 'bg-indigo-100 text-indigo-700',
    },
    eyebrow: 'For Investors / LPs · deal quality & efficiency',
    hero: {
      headlinePre: 'Better deals, ',
      headlineHi: 'less noise',
      headlinePost: '. From first look to portfolio.',
      sub:
        'Source from a curated pipeline, screen with AI diligence, and run your whole funnel in one CRM. Built for angels, emerging managers, funds and the LPs who back them.',
    },
    forWho:
      'Angels, syndicates, emerging managers, institutional funds and LPs who want higher-signal deal flow and a lighter diligence lift.',
    problem:
      'Deal flow is either a firehose of cold inbound or a black box you can only reach through relationships. Screening and diligence live in spreadsheets. Axal VC gives you a curated pipeline, AI screening and a CRM that already knows the founders.',
    primaryCta: { label: 'Create an investor account', to: '/register?lane=investor' },
    secondaryCta: { label: 'Compare investor plans', to: '/pricing/investor' },
    benefits: [
      {
        icon: 'Search',
        title: 'Curated deal sourcing',
        body: 'Browse a live pipeline of network-vetted startups instead of drowning in cold inbound.',
      },
      {
        icon: 'Gauge',
        title: 'AI screening & diligence',
        body: 'Every company carries a venture-readiness score with evidence — triage in minutes, not evenings.',
      },
      {
        icon: 'Kanban',
        title: 'Built-in CRM & pipeline',
        body: 'Track every deal, relationship and note in one funnel — no separate CRM to reconcile.',
      },
      {
        icon: 'PieChart',
        title: 'Portfolio visibility',
        body: 'Health, positions and risk across your book, with founder updates flowing straight in.',
      },
    ],
    liveFeatures: [
      'Deal sourcing — curated pipeline + public deal index',
      'AI screening — venture-readiness scoring with evidence',
      'Diligence — reference checks, KYC and scoring breakdowns',
      'CRM & pipeline — relationships, contacts and deal stages',
      'Warm intros to founders, calendar bookings included',
      'Portfolio visibility — health, positions and risk matrix',
      'Market Intelligence — sector signals and thesis-fit matching',
      'LP reporting with peer benchmarks (Institutional)',
    ],
    comingSoon: [
      'Thesis tracking — save a thesis and get auto-alerts on new matching deals',
      'LP self-serve portal — data room and capital-account access for your LPs',
      'Automated co-invest & syndicate discovery across the network',
    ],
    plans: [
      mapTierToProductPlan(tierById(INVESTOR_TIERS, 'free'), {
        id: 'free',
        name: 'Starter',
        tagline: 'Browse the network, free',
        blurb: 'Browse deals and follow founders across the network.',
        cta: { label: 'Sign up free', to: '/register?lane=investor' },
        featureMeta: {
          'Watch up to 10 companies': { limit: '10 companies' },
        },
        extraFeatures: [
          {
            text: 'Warm intros to founders',
            limit: '3 / quarter',
            detail: 'Free accounts can request up to 3 warm introductions each quarter.',
          },
        ],
      }),
      mapTierToProductPlan(tierById(INVESTOR_TIERS, 'professional'), {
        id: 'pro',
        name: 'Pro',
        tagline: 'Full deal flow',
        badge: 'Full pipeline access',
        blurb: 'For active investors who want full deal flow.',
        cta: { label: 'Start 14-day trial', to: '/register?lane=investor&plan=professional' },
        featureMeta: {
          '25 warm intros / quarter': { limit: '25 / quarter' },
          'Up to 5 active deal rooms': {
            limit: '5 rooms',
            detail: 'Run up to 5 concurrent deal rooms with founders.',
          },
        },
        extraFeatures: [
          { text: 'Thesis tracking with auto-alerts', soon: true },
        ],
      }),
      {
        id: 'enterprise',
        name: 'Enterprise / Custom',
        price: 'Custom',
        period: '',
        tagline: 'For funds investing at scale',
        blurb: 'Funds, family offices and LPs investing at scale.',
        cta: { label: 'Talk to sales', to: '/demo?topic=investor' },
        features: [
          {
            text: 'Unlimited deal rooms',
            detail: 'Matches the Institutional tier — no concurrent deal-room cap.',
          },
          { text: 'Warm intros', limit: '100 / quarter' },
          { text: 'Colleague seats included', limit: 'up to 4' },
          { text: 'LP reporting + peer benchmarks' },
          { text: 'Co-invest discovery' },
          { text: 'Priority support + onboarding' },
        ],
      },
    ],
    faq: [
      {
        q: 'How is the deal flow curated?',
        a: 'Companies in the pipeline come through the Axal VC network and carry a venture-readiness score with the evidence behind it, so you are triaging signal rather than raw inbound.',
      },
      {
        q: 'I invest as an LP, not a GP. Is this for me?',
        a: 'Yes. LPs use the platform for portfolio visibility and reporting today; the dedicated LP self-serve portal (data room and capital-account access) is on the roadmap and marked "Coming soon".',
      },
      {
        q: 'Can I try it before paying?',
        a: 'Every account starts with a 14-day Professional trial — no card required — and Starter is free forever.',
      },
      {
        q: 'Does it replace my CRM?',
        a: 'For deal flow, yes — pipeline, relationships and contacts are built in, so your funnel and your notes live in one place instead of a separate CRM.',
      },
    ],
    closing: {
      headline: 'Spend your time on the deals that matter.',
      sub: 'Start free, or take a 14-day Professional trial.',
    },
  },

  'service-partners': {
    slug: 'service-partners',
    path: '/for-service-partners',
    navLabel: 'For Service Partners',
    meta: {
      title: 'For Service Partners',
      description:
        'List your services in the Axal VC marketplace, get in front of funded founders, and turn network trust into inbound leads. Distribution for legal, design, GTM and technical partners.',
    },
    accent: {
      badge: 'bg-emerald-100 border-emerald-300 text-emerald-700',
      highlight: 'text-emerald-600',
      button:
        'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30',
      buttonSoft:
        'border border-emerald-200 text-emerald-700 hover:bg-emerald-50',
      featuredCard: 'border-emerald-500 shadow-lg ring-1 ring-emerald-500/30',
      popularBadge: 'bg-emerald-600 text-white',
      check: 'text-emerald-600',
      link: 'text-emerald-700 hover:text-emerald-900',
      sectionTint: 'bg-emerald-50/40 border-emerald-200',
      chip: 'bg-emerald-100 text-emerald-700',
    },
    eyebrow: 'For Service Partners · distribution & inbound',
    hero: {
      headlinePre: 'Get in front of ',
      headlineHi: 'funded founders',
      headlinePost: ' who need what you do.',
      sub:
        'List your services in the marketplace, answer real posted needs, and let network trust do the selling. Distribution for legal, design, GTM, recruiting, finance and technical partners.',
    },
    forWho:
      'Service providers who sell into startups — law firms, design studios, GTM and recruiting shops, fractional operators, dev shops and technical-diligence partners.',
    problem:
      'Winning startup clients means endless outbound and referral roulette. Meanwhile founders on the platform are actively posting what they need. Axal VC puts your offer where that demand already is — with trust signals that shorten the sale.',
    primaryCta: { label: 'List your services', to: '/register?lane=partner' },
    secondaryCta: { label: 'Browse the marketplace', to: '/directory' },
    benefits: [
      {
        icon: 'Store',
        title: 'Marketplace listing',
        body: 'A rich provider profile in the Axal VC marketplace and public directory, discoverable by every founder on the network.',
      },
      {
        icon: 'Inbox',
        title: 'Inbound demand',
        body: 'Founders post what they need on the Needs Board — respond to live, qualified requests instead of cold outreach.',
      },
      {
        icon: 'BadgeCheck',
        title: 'Trust & verification',
        body: 'Verification and trust badges tell founders you are vetted, so conversations start warmer and close faster.',
      },
      {
        icon: 'BarChart3',
        title: 'Partner analytics',
        body: 'See profile views, leads and conversion in your partner insights dashboard.',
      },
    ],
    liveFeatures: [
      'Marketplace listing + public partner profile in the directory',
      'Service offer management — create, edit and publish your offerings',
      'Inbound demand — respond to founder posts on the Needs Board',
      'Lead & deal flow through the partner deal portal',
      'Trust & verification badges on your profile',
      'Featured placement in the marketplace (curated)',
      'Partner analytics — views, leads and conversion insights',
      'Stripe Connect payouts for services delivered',
    ],
    comingSoon: [
      'Self-serve featured placement — buy premium slots without waiting on curation',
      'Automated lead matching & alerts when a posted need fits your offer',
      'Reviews & ratings from founders on your partner profile',
    ],
    plans: [
      {
        id: 'free',
        name: 'Starter',
        price: '$0',
        period: 'forever',
        tagline: 'Get listed, free',
        blurb: 'Get listed and start answering posted needs.',
        cta: { label: 'List for free', to: '/register?lane=partner' },
        features: [
          { text: 'Marketplace + directory listing' },
          { text: 'Publish and manage your service offers' },
          { text: 'Respond to Needs Board posts' },
          { text: 'Basic trust badge on verification' },
          { text: 'Stripe Connect payouts' },
        ],
      },
      {
        id: 'pro',
        name: 'Pro',
        price: '$99',
        period: '/ month',
        highlight: true,
        tagline: 'Inbound demand on tap',
        badge: 'More reach & insight',
        blurb: 'For partners who want inbound demand on tap.',
        cta: { label: 'Start 14-day trial', to: '/register?lane=partner&plan=pro' },
        features: [
          {
            text: 'Priority placement in search + directory',
            detail: 'Rank higher when founders browse the marketplace.',
          },
          { text: 'Full partner analytics dashboard' },
          { text: 'Verified partner badge' },
          { text: 'Partner deal portal access' },
          { text: 'Automated lead alerts', soon: true },
        ],
      },
      {
        id: 'enterprise',
        name: 'Enterprise / Custom',
        price: 'Custom',
        period: '',
        tagline: 'For firms & agencies',
        blurb: 'Firms and agencies scaling across the network.',
        cta: { label: 'Talk to us', to: '/contact' },
        features: [
          { text: 'Featured marketplace placement' },
          { text: 'Multiple seats + team profiles' },
          { text: 'Co-marketing slots across the network' },
          { text: 'Custom offer packaging' },
          { text: 'Dedicated partner manager' },
        ],
      },
    ],
    faq: [
      {
        q: 'What can I list?',
        a: 'Any service startups buy — legal, design, GTM, recruiting, finance, data, technical diligence and more. You control your offers and can publish or unpublish them anytime.',
      },
      {
        q: 'How do leads reach me?',
        a: 'Two ways today: founders discover you in the marketplace and directory, and you respond to live requests founders post on the Needs Board. Automated lead alerts are on the roadmap.',
      },
      {
        q: 'How does featured placement work?',
        a: 'Featured slots in the marketplace are live but currently curated by the Axal VC team. Self-serve featured placement you can buy directly is marked "Coming soon".',
      },
      {
        q: 'How do I get paid?',
        a: 'Payouts for services delivered through the platform run on Stripe Connect, so funds settle straight to your connected account.',
      },
    ],
    closing: {
      headline: 'Put your services where the demand already is.',
      sub: 'List for free. Upgrade when the inbound picks up.',
    },
  },

  advisors: {
    slug: 'advisors',
    path: '/for-advisors',
    navLabel: 'For Advisors',
    meta: {
      title: 'For Advisors',
      description:
        'Build a credible advisor profile, get matched with founders who need your expertise, and run sessions through structured office hours on the Axal VC network.',
    },
    accent: {
      badge: 'bg-amber-100 border-amber-300 text-amber-700',
      highlight: 'text-amber-600',
      button:
        'bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-600/30',
      buttonSoft:
        'border border-amber-200 text-amber-700 hover:bg-amber-50',
      featuredCard: 'border-amber-500 shadow-lg ring-1 ring-amber-500/30',
      popularBadge: 'bg-amber-600 text-white',
      check: 'text-amber-600',
      link: 'text-amber-700 hover:text-amber-900',
      sectionTint: 'bg-amber-50/40 border-amber-200',
      chip: 'bg-amber-100 text-amber-700',
    },
    eyebrow: 'For Advisors · reputation & founder matching',
    hero: {
      headlinePre: 'Advise the founders ',
      headlineHi: 'you were built to help',
      headlinePost: '.',
      sub:
        'Build a credible advisor profile, get matched to founders who need your exact expertise, and run sessions through structured office hours. Great advisors compound their reputation here.',
    },
    forWho:
      'Operators, domain experts and seasoned founders who want to advise — whether you think of yourself as an advisor, a mentor, or a fractional expert.',
    problem:
      'The best advisors are matched by word of mouth and end up giving away scattered coffee-chat advice with nothing to show for it. Axal VC matches you to the right founders by expertise and turns each engagement into visible, credible track record.',
    primaryCta: { label: 'Apply to advise', to: '/contact' },
    secondaryCta: { label: 'Create an account', to: '/register' },
    benefits: [
      {
        icon: 'UserCircle',
        title: 'A credible advisor profile',
        body: 'Expertise tags, availability and a public profile that shows founders exactly where you add value.',
      },
      {
        icon: 'Sparkles',
        title: 'Founder matching',
        body: 'Get matched to founders by sector, expertise and availability — not random inbound.',
      },
      {
        icon: 'Calendar',
        title: 'Structured office hours',
        body: 'Run sessions and intros in a purpose-built workspace instead of a tangle of calendar links.',
      },
      {
        icon: 'Star',
        title: 'Reputation that compounds',
        body: 'Ratings and trust badges turn every good session into visible credibility across the network.',
      },
    ],
    liveFeatures: [
      'Advisor / expert profile with expertise tags and availability',
      'Founder matching by sector, expertise and availability',
      'Office Hours workspace for sessions and intros',
      'Directory visibility to founders across the network',
      'Reputation — ratings and trust badges on your profile',
      'Refer & earn credits for bringing people into the network',
    ],
    comingSoon: [
      'Engagement analytics — track sessions, outcomes and impact over time',
      'In-product advisory agreements — equity-for-advice or fee, e-signed',
      'Self-serve advisor onboarding (today advisor access is application-based)',
    ],
    plans: [
      {
        id: 'free',
        name: 'Starter',
        price: '$0',
        period: 'forever',
        tagline: 'Publish a profile, free',
        blurb: 'Publish a profile and take founder matches.',
        cta: { label: 'Apply to advise', to: '/contact' },
        features: [
          { text: 'Public advisor profile + expertise tags' },
          { text: 'Founder matching' },
          { text: 'Office Hours workspace' },
          { text: 'Ratings + trust badge' },
          { text: 'Community support' },
        ],
      },
      {
        id: 'pro',
        name: 'Pro',
        price: '$29',
        period: '/ month',
        highlight: true,
        tagline: 'More reach, better matches',
        badge: 'Priority matching',
        blurb: 'For advisors who want more reach and better matches.',
        cta: { label: 'Talk to us', to: '/contact' },
        features: [
          {
            text: 'Priority founder matching',
            detail: 'Surface ahead of Starter advisors when founders search for expertise.',
          },
          { text: 'Boosted directory visibility' },
          { text: 'Featured advisor placement' },
          { text: 'Engagement analytics', soon: true },
          { text: 'In-product advisory agreements', soon: true },
        ],
      },
      {
        id: 'enterprise',
        name: 'Enterprise / Custom',
        price: 'Custom',
        period: '',
        tagline: 'For advisory firms',
        blurb: 'Advisory firms and expert networks.',
        cta: { label: 'Talk to us', to: '/contact' },
        features: [
          { text: 'Multiple advisor seats + team profiles' },
          { text: 'Programmatic founder matching' },
          { text: 'Co-branded office hours' },
          { text: 'Custom engagement terms' },
          { text: 'Dedicated relationship manager' },
        ],
      },
    ],
    faq: [
      {
        q: 'Advisor or mentor — what is the difference here?',
        a: 'We use "advisor" as the primary term, but it is the same role. If you think of yourself as a mentor or a fractional expert, this is for you too — the matching works the same way.',
      },
      {
        q: 'How do founders find me?',
        a: 'You are matched to founders by sector, expertise and availability, and you are discoverable in the directory. Sessions run through the Office Hours workspace.',
      },
      {
        q: 'Can I get paid or take equity for advising?',
        a: 'Structured in-product advisory agreements — equity-for-advice or fee, e-signed — are on the roadmap and marked "Coming soon". Today, engagements are arranged directly between you and the founder.',
      },
      {
        q: 'How do I join?',
        a: 'Advisor access is application-based today, so start by applying to advise. A self-serve advisor onboarding lane is on the roadmap.',
      },
    ],
    closing: {
      headline: 'Turn your expertise into visible track record.',
      sub: 'Apply to advise and get matched to founders who need you.',
    },
  },
};

// Stable render order for nav/footer and any "all pages" listing.
export const PRODUCT_PAGE_ORDER = ['founders', 'investors', 'service-partners', 'advisors'];

export const PRODUCT_FOOTER_LINKS = PRODUCT_PAGE_ORDER.map((slug) => ({
  label: PRODUCT_PAGES[slug].navLabel,
  to: PRODUCT_PAGES[slug].path,
}));
