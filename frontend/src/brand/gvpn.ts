export const BRAND = {
  name: "Global Venture Partner Network",
  short: "GVPN",
  parent: "Axal VC Management LLC",
  tagline: "Where venture builders meet capital, globally.",
  subTagline: "One network. Four lanes — partners, capital, founders, advisors.",
  nicheProduct: { name: "Spin-Out Lab", duration: "28 days", parent: "GVPN" },
} as const;

export const LEGAL_ENTITIES = {
  holdings: {
    name: "Axal VC Holdings LLC",
    short: "Holdings",
    jurisdiction: "Delaware",
    type: "LLC",
    role: "Passive holding company. Owns brand/platform IP, domains (axal.vc), trademarks, copyrighted content, equity in subsidiaries and SPVs, and treasury/reserve assets. Licenses IP to Axal VC Management LLC.",
  },
  management: {
    name: "Axal VC Management LLC",
    short: "Management",
    jurisdiction: "Delaware",
    type: "LLC",
    role: "Operating company. Operates the Axal VC StudioOS platform, employs personnel and contractors, signs customer/vendor/partner contracts, and is data controller under the privacy policy. Counterparty under Terms of Service and platform-level agreements.",
  },
  gp: {
    name: "Axal VC GP LLC",
    short: "GP",
    jurisdiction: "Delaware",
    type: "LLC",
    role: "General Partner of Axal VC Fund I, LP. Manages the Fund, makes investment decisions, approves exits, owes fiduciary duties to LPs, and carries fund-level carry economics. Does not sign platform terms or customer contracts.",
  },
  fund: {
    name: "Axal VC Fund I, LP",
    short: "Fund I",
    jurisdiction: "Delaware",
    type: "LP",
    role: "Limited partnership pooling LP capital. Managed exclusively by Axal VC GP LLC as general partner.",
  },
} as const;

export const NETWORK_LAYERS = [
  { id: "trust",          name: "Trust",            blurb: "KYC, KYB, accreditation, NDAs, sanctions." },
  { id: "build",          name: "Build",            blurb: "Projects, Pipeline, Studio Ops, Brand, Pitch Deck, Roadmap, Customer Discovery." },
  { id: "validate_grow",  name: "Validate & Grow",  blurb: "Scoring, Advisors, Office Hours, Co-founder Match, Market Intelligence." },
  { id: "capital",        name: "Capital",          blurb: "Capital, Investors, Cap Table, Funds, Reserves, Waterfall, Liquidity." },
  { id: "legal",          name: "Legal",            blurb: "Incorporation, 83(b), Cofounder Agreement, Compliance, E-Sign." },
  { id: "network",        name: "Network",          blurb: "Marketplace, Partners, Co-marketing, Public Directory, Refer & Earn." },
] as const;

export const LANES = [
  {
    id: "partner",
    label: "Apply as Partner",
    short: "For Partners",
    accent: "violet",
    blurb: "Source thesis-aligned companies; monetise services; co-invest. KYB, conflicts, and contractual scaffolding handled.",
    href: "/register?lane=partner",
  },
  {
    id: "lp",
    label: "Open an LP Account",
    short: "For Capital",
    accent: "mint",
    blurb: "Disciplined, evidence-backed deal flow. Founder numbers verified via Stripe + Plaid. Sanctions-screened parties.",
    href: "/register?lane=lp",
  },
  {
    id: "founder",
    label: "Pitch to the Network",
    short: "For Founders",
    accent: "amber",
    blurb: "28-day Spin-Out Lab to incorporate. Full workflow for existing companies — pitch deck to cap table to fundraise.",
    href: "/register?lane=founder",
  },
  {
    id: "advisor",
    label: "Become an Advisor",
    short: "For Advisors",
    accent: "teal",
    blurb: "Operators sharing time. Office Hours, advisor sessions, advisor grants via the FAST template.",
    href: "/register?lane=advisor",
  },
] as const;

export type LaneId = typeof LANES[number]["id"];
