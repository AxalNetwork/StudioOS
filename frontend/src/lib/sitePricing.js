/**
 * D786 (#2211) part 2 — the copy of /pricing, from the owner's "Pricing"
 * canvas (`design/incoming/StudioOS Pricing.dc.html` and its 2026-10-20
 * revision): the plan cards' names, taglines and feature lists, the
 * comparison tables, the LP band, the no-plan cards and the FAQ.
 *
 * NO FIGURE LIVES HERE that the catalogue owns. A card's price, its yearly
 * price and the AI it includes come from `GET /api/public/plans-and-packs`
 * (`pricingModel.js`); a plan the catalogue does not sell reads "Not offered
 * yet". The counts that are here are the Worker's own limits:
 *   - 1 startup, 5 interviews, 3 OKRs: `FREE_TIER_LIMITS` (middleware/requireTier.ts);
 *   - 3 / 10 / 25 introductions a month: `monthlyAllowanceFor` (services/introductions.ts).
 * A canvas figure the code does not hold was dropped with its number.
 *
 * AI tokens are never "credits" (D785 D-c): "credits" only ever means Perks.
 */
import { SITE_ACTIONS } from './siteLinks';

/** The Models tab's groups in the canvas's order: the Worker's `MODEL_GROUPS` (services/ai/publicModels.ts), which a test holds equal. */
export const MODEL_GROUPS = Object.freeze([
  'Conversation and writing', 'Reasoning', 'Code', 'Reading images and files', 'Search and ranking',
  'Languages', 'Speech to text', 'Voice', 'Images', 'Safety',
]);

/**
 * Each tab's cards, in the canvas's order. `match` is the catalogue plan's
 * `licence_key` (`aiCredits.planOf`); `free` is the tab's free plan; `custom`
 * is priced by our sales team and never shows a figure. `lane` is the
 * register page's `?lane=` for a visitor.
 */
export const PLAN_CARDS = Object.freeze({
  founder: [
    {
      id: 'free', name: 'Free', match: 'founder:free', free: true, lane: 'founder',
      tag: 'Start validating one idea.',
      feats: ['1 active startup', 'Validate: 5 customer interviews and 3 OKRs', 'Apply to the Spin-Out Lab', 'Public profile and referral link', 'Accept up to 3 introductions a month', 'AI runs from AI tokens you top up'],
    },
    {
      id: 'growth', name: 'Validate + Build', match: 'founder:growth', lane: 'founder', highlight: true,
      tag: 'Prove the idea, then build the company.',
      feats: ['Unlimited startups', 'Unlimited interviews and OKRs', 'Venture-readiness scoring', 'Company data for market research', 'Your full archetype card', 'Accept up to 10 introductions a month'],
    },
    {
      id: 'studio', name: 'Raise + Grow', match: 'founder:studio', lane: 'founder',
      tag: 'Raise the money, then grow the company.',
      feats: ['Pitch decks: every template, share links, your branding', 'Cap table scenarios and the dilution simulator', 'Capital, funds and the data room', 'Legal, compliance and the 83(b)', 'Advisor booking and partner office hours', 'Accept up to 25 introductions a month'],
    },
  ],
  investor: [
    {
      id: 'free', name: 'Investor Basic', kick: 'Free plan', match: 'investor:free', free: true, lane: 'investor', cta: 'Start free',
      tag: 'Browse the network.',
      feats: ['Public deal index', 'Watchlists', 'Read-only market pulses', 'AI runs from AI tokens you top up'],
    },
    {
      id: 'plus', name: 'Investor Plus', kick: 'Research subscription', match: 'investor:plus', lane: 'investor', cta: 'Get Investor Plus',
      tag: 'For angel investors, independent investors and investment professionals.',
      feats: ['Investment research workspace', 'Watchlists and opportunity tracking', 'AI-assisted investment research', 'Personal investment notes', 'Deal comparisons', 'Standard research usage limits'],
    },
    {
      id: 'professional', name: 'Investor Pro', kick: 'Research subscription', match: 'investor:professional', lane: 'investor', cta: 'Get Investor Pro', highlight: true,
      tag: 'For professional angels, investment analysts and smaller firms.',
      feats: ['Advanced investment research and screening', 'Portfolio tracking and analytics', 'Investment memo generation', 'Data exports and integrations', 'Higher AI research usage limits', 'More advanced investment workflows'],
    },
    {
      id: 'institutional', name: 'Institutional', kick: 'Research subscription', custom: true, cta: 'Contact Sales',
      tag: 'For institutional investors, family offices and investment teams.',
      feats: ['Shared research workspaces', 'Team access controls and permissions', 'Advanced reporting and analytics', 'Custom integrations and workflows', 'Organization-wide administration', 'Negotiated usage limits and support'],
    },
  ],
  advisor: [
    {
      id: 'free', name: 'Advisor Basic', kick: 'Free plan', free: true, cta: 'Start free',
      tag: 'Publish a profile.',
      feats: ['Public advisor profile', 'Listed in the advisor directory', 'Office hours and session types', 'Booking links', 'AI runs from AI tokens you top up'],
    },
    {
      id: 'pro', name: 'Advisor Pro', kick: 'Practice subscription', match: 'advisor', cta: 'Get Advisor Pro', highlight: true,
      tag: 'More reach, better matches.',
      feats: ['More reach in matching', 'Paid sessions through your booking links', 'Deliverables and the client access log', 'Earnings and payouts'],
    },
    {
      id: 'firm', name: 'Advisory Firm', kick: 'Practice subscription', custom: true, cta: 'Contact Sales',
      tag: 'For advisory firms.',
      feats: ['Several advisors under one practice', 'Team access controls and permissions', 'Shared clients and deliverables', 'Negotiated usage limits and support'],
    },
  ],
  'operating-partner': [
    {
      id: 'free', name: 'Partner Basic', kick: 'Free plan', free: true, lane: 'partner', cta: 'Start free',
      tag: 'Get listed.',
      feats: ['Provider profile and directory listing', 'Live founder requests', 'Verification badges', 'AI runs from AI tokens you top up'],
    },
    {
      // The owner's ruling (2026-10-20): the plan is "Operating Partner Pro".
      id: 'pro', name: 'Operating Partner Pro', kick: 'Delivery subscription', match: 'partner', lane: 'partner', cta: 'Get Operating Partner Pro', highlight: true,
      tag: 'Inbound demand on tap.',
      feats: ['Proposals, pipeline and delivery', 'Partner insights: views, leads and conversion', 'Client status reports', 'Payouts through Stripe Connect'],
    },
    {
      id: 'firm', name: 'Partner Firm', kick: 'Delivery subscription', custom: true, cta: 'Contact Sales',
      tag: 'For firms and agencies.',
      feats: ['One firm account for every delivery team', 'Team access controls and permissions', 'Featured placement, curated by Axal VC', 'Negotiated usage limits and support'],
    },
  ],
});

/** The Investor tab's LP band: not a subscription, free with an investment in an Axal VC fund. */
export const LP_ACCESS = Object.freeze({
  kick: 'For investors in Axal VC funds',
  name: 'LP Access',
  text: 'Not a subscription. Your fund investments, documents and updates, free with your investment.',
  note: 'Free access for eligible investors in Axal VC funds. Access is subject to investor verification and fund-specific permissions.',
  link: { label: SITE_ACTIONS.lpLabel, to: SITE_ACTIONS.lpLogin },
  feats: ['Access to relevant fund documents and reports', 'Fund updates and announcements', 'Available capital account and investment information', 'Secure document access', 'Fund-related communications', 'Information for your authorized fund investments'],
});

/**
 * "Compare plans": each group's rows, one cell per card in PLAN_CARDS order.
 * 1 is a tick, 0 a dash, a string is the cell's words.
 */
export const COMPARE = Object.freeze({
  founder: [
    ['Validate', [['Customer interviews', '5', 'Unlimited', 'Unlimited'], ['Pain map and themes', 1, 1, 1], ['Hypotheses and the verdict', 1, 1, 1], ['Market intelligence', 0, 1, 1], ['Venture-readiness scoring', 0, 1, 1]]],
    ['Build', [['OKRs', '3', 'Unlimited', 'Unlimited'], ['Roadmap and This week', 1, 1, 1], ['Founding team', 1, 1, 1], ['Company creation and filings', 0, 1, 1]]],
    ['Raise', [['Pitch deck: every template and share links', 0, 0, 1], ['Cap table scenarios and dilution', 0, 0, 1], ['Data room', 0, 0, 1], ['Legal, compliance and the 83(b)', 0, 0, 1], ['Introductions a month', '3', '10', '25']]],
    ['Grow', [['Revenue and traction', 0, 0, 1], ['Distribution and co-marketing', 0, 0, 1], ['Team expansion', 0, 0, 1], ['Partner network', 0, 0, 1]]],
  ],
  investor: [
    ['Browse', [['Public deal index', 1, 1, 1, 1], ['Market pulses', 'Read-only', 1, 1, 1]]],
    ['Research', [['Research workspace', 0, 1, 1, 1], ['Watchlists and opportunity tracking', 1, 1, 1, 1], ['AI-assisted research', 0, 'Standard limits', 'Higher limits', 'Negotiated'], ['Personal notes and deal comparisons', 0, 1, 1, 1], ['Advanced research and screening', 0, 0, 1, 1], ['Portfolio tracking and analytics', 0, 0, 1, 1], ['Investment memo generation', 0, 0, 1, 1], ['Data exports and integrations', 0, 0, 1, 1]]],
    ['Teams', [['Shared research workspaces', 0, 0, 0, 1], ['Team access controls and permissions', 0, 0, 0, 1], ['Advanced reporting and analytics', 0, 0, 0, 1], ['Custom integrations and workflows', 0, 0, 0, 1], ['Organization-wide administration', 0, 0, 0, 1]]],
  ],
  advisor: [
    ['Profile and reach', [['Public advisor profile', 1, 1, 1], ['Advisor directory listing', 1, 1, 1], ['Reach in matching', 'Standard', 'More', 'More']]],
    ['Practice', [['Office hours and session types', 1, 1, 1], ['Booking links', 1, 1, 1], ['Paid sessions', 0, 1, 1], ['Deliverables and the client access log', 0, 1, 1], ['Earnings and payouts', 0, 1, 1]]],
    ['Firm', [['Several advisors under one practice', 0, 0, 1], ['Team access controls and permissions', 0, 0, 1], ['Negotiated usage limits and support', 0, 0, 1]]],
  ],
  'operating-partner': [
    ['Listing', [['Provider profile and directory listing', 1, 1, 1], ['Verification badges', 1, 1, 1], ['Live founder requests', 1, 1, 1]]],
    ['Delivery', [['Proposals, pipeline and delivery', 0, 1, 1], ['Partner insights', 0, 1, 1], ['Client status reports', 0, 1, 1], ['Payouts through Stripe Connect', 0, 1, 1]]],
    ['Firm', [['One firm account for every delivery team', 0, 0, 1], ['Team access controls and permissions', 0, 0, 1], ['Featured placement, curated by Axal VC', 0, 0, 1]]],
  ],
});

export const HERO = Object.freeze({
  title: 'Pricing',
  line: 'Pay for the cycles you are in. AI is included with every plan, and you can top up as you go.',
});

export const AI_BAND = Object.freeze({
  kick: 'AI on every plan',
  text: "Each plan includes 25% of its price as AI tokens every month. Past that, top up AI tokens as you go. You don't need a plan to top up.",
  link: 'See model prices',
});

export const MODELS_LINE = "Prices are Cloudflare's published Workers AI rates plus 25%. Runs are paid from your plan's monthly AI allowance first, then from your AI tokens.";

export const PACKS = Object.freeze({
  kick: 'AI token packs',
  title: 'Top up as you go',
  text: 'Each pack buys its price in AI use at the rates above. Tokens you buy never expire.',
});

/** The FAQ. "Can I set a spending limit?" names D788's monthly spend limit (Account › Usage › Limits). */
export const FAQ = Object.freeze([
  ['What are AI tokens?', 'AI tokens pay for AI runs in StudioOS. Each run is priced on the model that ran it, at the rates on the Models tab. Your plan includes some every month, and you can top up at any time.'],
  ['Are AI tokens the same as Perks credits?', 'No. Perks credits are claimed for perks from partners. AI tokens pay for AI runs. Neither can be spent as the other.'],
  ['What happens when my allowance runs out?', 'Runs draw on the AI tokens you have bought. If you have none, AI runs wait until you top up or your allowance resets on the 1st. Everything else keeps working.'],
  ['Can I set a spending limit?', 'Yes. Set a monthly spend limit in Account › Usage › Limits. AI never spends more than your monthly allowance and the tokens you have bought, and Account › Usage shows your allowance, your use and your balance, run by run.'],
  ['Do unused tokens expire?', 'Tokens you buy never expire. Your plan’s monthly allowance resets on the 1st and does not carry over.'],
  ['How do refunds work?', 'Plan payments and token purchases follow the terms shown at checkout. Ask us through Contact if a purchase went wrong.'],
]);

/** The Investor tab's three questions, asked first. */
export const FAQ_INVESTOR = Object.freeze([
  ['Who qualifies for free LP access?', 'Eligible investors in Axal VC funds receive access to their relevant fund information without a separate platform subscription.'],
  ['Do I need to subscribe to access my fund documents?', 'No. Eligible LPs can access their authorized fund information for free.'],
  ['Can I use Axal VC without investing in an Axal VC fund?', 'Yes. Independent investors can choose a paid research plan based on their needs. A research plan does not make you eligible to invest in a fund, and does not open restricted fund information.'],
]);

export const CLOSING = Object.freeze({
  title: 'Start free. Pay for the cycles you are in.',
  line: 'Every plan includes AI. Top up only when you need more.',
});
