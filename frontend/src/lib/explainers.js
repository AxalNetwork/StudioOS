// Task #15 — Page header explainers content map.
//
// One entry per primary page. Body copy is capped at 240 chars so the
// banner never overwhelms the page header. `docPath` MUST match the
// slash-format anchors used in `frontend/src/pages/docs/sections/index.js`
// (i.e. `${section.id}/${subsection.id}`) — DocsLayout deep-links via
// `data-anchor`, so a typo here just sends the user to the docs index.

export const EXPLAINERS = {
  assessment_admin: {
    title: 'Author the assessment games',
    body: 'Build the games players take: chapters, decision items and their scoring, archetypes and badges. Preview a run without saving results, then publish — and watch reach, drop-off and outcomes in analytics.',
    docPath: 'getting-started/what-is-studioos',
  },
  dashboard: {
    title: 'Your studio at a glance',
    body: 'Quick stats across startups, capital, compliance and your network — pulled live so you can see what needs attention without opening every tab.',
    docPath: 'getting-started/what-is-studioos',
  },
  my_events: {
    title: 'Host and attend events',
    body: 'Create demo days, workshops and meetups, invite your network, and manage who attends. Tickets you hold show a QR code for fast check-in.',
    docPath: 'network/events',
  },
  event_editor: {
    title: 'Set up your event',
    body: 'Schedule, location, capacity and visibility in one place. Audience rules hand free seats to whole groups; public events go live after a quick admin review.',
    docPath: 'network/events',
  },
  event_manage: {
    title: 'Manage your roster',
    body: 'Approve or decline registrations, promote people off the waitlist, send invites, and check attendees in by scanning their ticket QR with your camera.',
    docPath: 'network/events',
  },
  projects: {
    title: 'Pipeline & playbook tracking',
    body: 'Every venture you run, with stage, owners and the 4-week playbook progress. Add, archive or open one to see its team, financials and decision log.',
    docPath: 'build/projects',
  },
  customer_discovery: {
    title: 'Talk to users, capture what you learn',
    body: 'Log discovery interviews, tag pains and hypotheses, and watch the validation signal slider move as evidence stacks up.',
    docPath: 'build/customer-discovery',
  },
  roadmap: {
    title: 'Quarterly OKRs and bets',
    body: 'Plan the next 1–3 quarters with key results so the team — and capital partners — know what good looks like.',
    docPath: 'build/roadmap',
  },
  brand_builder: {
    title: 'Voice, visuals and a one-pager',
    body: 'Generate a brand brief, palette and starter assets in minutes. Drop the result into your pitch deck and partner outreach.',
    docPath: 'build/brand-builder',
  },
  pitch_deck: {
    title: 'A deck investors actually skim',
    body: 'Outline-driven slides with proof points and metrics pulled from your financial model. Export to PDF or share a private link.',
    docPath: 'build/pitch-deck',
  },
  scoring: {
    title: 'How Axal VC scores readiness',
    body: 'A diligence engine that turns the data you’ve already entered — discovery, market, team, traction — into a ranked readiness score with explanations.',
    docPath: 'validate-grow/scoring',
  },
  advisors: {
    title: 'Operators who’ve done this before',
    body: 'Browse the advisor directory by expertise, request an intro, and track how each engagement is moving the needle.',
    docPath: 'validate-grow/advisors',
  },
  office_hours: {
    title: 'Drop into a working session',
    body: 'Book recurring office hours with advisors and partners. Slots auto-sync to your connected calendar with a private agenda doc.',
    docPath: 'validate-grow/office-hours',
  },
  cofounder_match: {
    title: 'Find a complementary co-founder',
    body: 'Opt into the match pool, signal what you need, and we surface vetted candidates with overlapping conviction and complementary skills.',
    docPath: 'validate-grow/cofounder-match',
  },
  team_building: {
    title: 'Build the team around your company',
    body: 'One workspace to recruit advice from advisors, find a co-founder, and hire for open roles — advisors, founders, and talent in one place.',
    docPath: 'validate-grow/team-building',
  },
  command_center: {
    title: 'Run your venture from one place',
    body: 'Your founder home for the whole lifecycle — submit and score a new startup, run execution, operate the studio, and manage spin-outs, all in one tabbed workspace.',
    docPath: 'studio',
  },
  market_intel: {
    title: 'Market signal, on demand',
    body: 'Comp-set deltas, funding rounds, hiring velocity and news sentiment for the segments you care about — refreshed daily.',
    docPath: 'validate-grow/market-intel',
  },
  capital: {
    title: 'Capital & investment ops',
    body: 'Run the fundraise — pipeline, materials, signed terms — and track allocations across funds and SPVs in one place.',
    docPath: 'capital/fundraise',
  },
  captable: {
    title: 'Cap table, kept honest',
    body: 'A live cap table with grants, SAFEs, options and conversions. Model new rounds and see who gets diluted before you sign.',
    docPath: 'capital/cap-table',
  },
  funds: {
    title: 'Fund management',
    body: 'Commitments, capital calls, distributions and NAV per fund. Generate LP statements and tie every flow to its underlying portfolio company.',
    docPath: 'capital/funds',
  },
  reserves: {
    title: 'Reserve allocation, modelled',
    body: 'Plan follow-on reserves per company and per stage. The model warns when you’re over-committed before you write the check.',
    docPath: 'capital/funds',
  },
  waterfall: {
    title: 'Exit waterfall simulator',
    body: 'Model a sale or IPO across preference stacks, participation and option pools — and see exactly who gets what at each clearing price.',
    docPath: 'capital/funds',
  },
  liquidity: {
    title: 'Liquidity & secondaries',
    body: 'Track tender offers, secondary interest and DPI per fund so you and your LPs always know where realisations stand.',
    docPath: 'capital/liquidity',
  },
  metrics: {
    title: 'Portfolio metrics',
    body: 'Standardised KPIs (ARR, burn, runway, growth) across the portfolio with founder-submitted updates and automated nudges.',
    docPath: 'capital/metrics',
  },
  incorporate: {
    title: 'Spin out, the right way',
    body: 'Guided incorporation by jurisdiction with founders, equity split and the standard compliance calendar seeded automatically.',
    docPath: 'legal/incorporation',
  },
  cofounder_agreement: {
    title: 'Co-founder agreement',
    body: 'Vesting, IP assignment and decision rights on a single page. Generates an NDA-protected draft each side can sign in-product.',
    docPath: 'legal/cofounder-agreement',
  },
  section_83b: {
    title: '83(b) election tracker',
    body: 'A 30-day clock per founder, with the IRS-ready letter, certified-mail tracking and a permanent record once accepted.',
    docPath: 'legal/section-83b',
  },
  compliance: {
    title: 'Compliance calendar',
    body: 'Federal, state and corporate filing dates per entity. Misses turn red 30 days out and email the responsible founder.',
    docPath: 'legal/compliance',
  },
  kyc: {
    title: 'Identity verification',
    body: 'KYC / AML for founders, partners and investors. Optional until critical legal docs require it; results power downstream restrictions.',
    docPath: 'legal/kyc',
  },
  esign: {
    title: 'Sign documents in-product',
    body: 'Open envelopes, view what you’re signing and apply a legally-binding e-signature. Fully audited and exportable.',
    docPath: 'legal/esign',
  },
  legal_templates: {
    title: 'Legal templates library',
    body: 'Vetted starter templates — NDAs, advisory agreements, term sheets — with merge fields auto-filled from your profile and entity.',
    docPath: 'legal/templates',
  },
  marketplace: {
    title: 'Service-provider marketplace',
    body: 'Curated lawyers, accountants, designers and infra providers — with rates Axal VC has pre-negotiated. Submit briefs and compare quotes here.',
    docPath: 'network/marketplace',
  },
  partners: {
    title: 'Partner ecosystem',
    body: 'Discover partners (corporates, LPs, channel) you can co-build with. Mutual interest opens a private workspace.',
    docPath: 'network/partners',
  },
  co_marketing: {
    title: 'Co-marketing campaigns',
    body: 'Run joint launches with partners — shared assets, dual-tracked attribution and a single dashboard both sides can read.',
    docPath: 'network/partners',
  },
  calendar: {
    title: 'Unified calendar',
    body: 'Connect Google or Outlook once and we surface every Axal VC commitment — office hours, board meetings, filings — alongside your personal events.',
    docPath: 'account/notifications',
  },
  financials: {
    title: 'Financial model',
    body: 'A driver-based forecast you can trust. Edit assumptions, see runway shift live, and export the working model for diligence.',
    docPath: 'capital/metrics',
  },
  wellbeing: {
    title: 'Founder wellbeing',
    body: 'Private check-ins, sleep / load tracking and burnout signals. Encrypted at rest — your investors never see this.',
    docPath: 'portals/founder',
  },
  portfolio_health: {
    title: 'Portfolio health score',
    body: 'A composite score per company combining metrics, founder signals and external diligence. Drill in to see what’s driving it.',
    docPath: 'portals/portfolio-health',
  },
  watchlist: {
    title: 'Watchlist & decision journal',
    body: 'Track the deals you’re leaning into and the reasons you bought (or passed). Honest pattern-matching, retrievable later.',
    docPath: 'portals/portfolio-health',
  },
  refer_earn: {
    title: 'Referrals',
    body: 'Share your referral link and earn for every founder, partner or investor who joins and converts, then collect what you earn from the Payouts tab.',
    docPath: 'network/refer-earn',
  },
  spinout_lab: {
    title: 'Spin-Out Lab',
    body: 'A guided 4-week sprint that takes a pre-incorporation founder to ready-to-incorporate. Follow the weekly milestones to stay on track.',
    docPath: 'spin-out-lab/overview',
  },
};

/** True if `pageKey` has any content registered. Pages without content
 * render nothing so PageExplainer is safe to drop in everywhere. */
export function hasExplainer(pageKey) {
  return !!(pageKey && Object.prototype.hasOwnProperty.call(EXPLAINERS, pageKey));
}

/** Read the dismissed-list cache from localStorage. Server-synced on mount. */
const STORAGE_KEY = 'dismissed_explainers';
export function readDismissed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : [];
  } catch { return []; }
}
export function writeDismissed(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list || [])); } catch {}
}
