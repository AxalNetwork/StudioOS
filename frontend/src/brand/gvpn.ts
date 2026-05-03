export const BRAND = {
  name: "Global Venture Partner Network",
  short: "GVPN",
  parent: "Axal Management, LLC",
  tagline: "Where venture builders meet capital, globally.",
  subTagline: "One network. Three lanes — partners, capital, founders.",
  nicheProduct: { name: "Spin-Out Lab", duration: "30 days", parent: "GVPN" },
} as const;

export const NETWORK_LAYERS = [
  { id: "partners",     name: "Partner Network",       blurb: "Matchmaking, referrals, weighted community voting." },
  { id: "capital",      name: "Capital Network",       blurb: "LP portal, capital calls, fund LPAs, secondary liquidity." },
  { id: "deals",        name: "Deal Network",          blurb: "Pipeline, scoring, AI memos, real-time updates." },
  { id: "intelligence", name: "Intelligence Network",  blurb: "Market pulse, sector signals, semantic search." },
  { id: "legal",        name: "Legal & Compliance",    blurb: "18 templates, e-sign, HMAC-secured contracts." },
] as const;

export const LANES = [
  {
    id: "partner",
    label: "Apply as Partner",
    short: "For Partners & Operators",
    accent: "violet",
    blurb: "Join 200+ co-investors and operators across 14 countries.",
    href: "/register?lane=partner",
  },
  {
    id: "lp",
    label: "Open an LP Account",
    short: "For LPs & Funds",
    accent: "mint",
    blurb: "Track commitments, calls, distributions, TVPI/DPI in one ledger.",
    href: "/register?lane=lp",
  },
  {
    id: "founder",
    label: "Pitch to the Network",
    short: "For Founders",
    accent: "amber",
    blurb: "Get scored, funded, and incorporated — Spin-Out Lab in 30 days.",
    href: "/register?lane=founder",
  },
] as const;

export type LaneId = typeof LANES[number]["id"];
