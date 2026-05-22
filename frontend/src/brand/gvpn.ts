export const BRAND = {
  name: "Global Venture Partner Network",
  short: "GVPN",
  parent: "Axal Management, LLC",
  tagline: "Where venture builders meet capital, globally.",
  subTagline: "One network. Five lanes — partners, capital, founders, mentors, coaches.",
  nicheProduct: { name: "Spin-Out Lab", duration: "30 days", parent: "GVPN" },
} as const;

export const NETWORK_LAYERS = [
  { id: "trust",          name: "Trust",            blurb: "KYC, KYB, accreditation, NDAs, sanctions." },
  { id: "build",          name: "Build",            blurb: "Projects, Pipeline, Studio Ops, Brand, Pitch Deck, Roadmap, Customer Discovery." },
  { id: "validate_grow",  name: "Validate & Grow",  blurb: "Scoring, Mentors, Office Hours, Co-founder Match, Market Intelligence." },
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
    blurb: "30-day Spin-Out Lab to incorporate. Full workflow for existing companies — pitch deck to cap table to fundraise.",
    href: "/register?lane=founder",
  },
  {
    id: "mentor",
    label: "Become a Mentor",
    short: "For Mentors",
    accent: "teal",
    blurb: "Operators sharing time. Office Hours, mentor sessions, advisor grants via the FAST template.",
    href: "/register?lane=mentor",
  },
  {
    id: "coach",
    label: "Join as Coach",
    short: "For Coaches",
    accent: "rose",
    blurb: "Executive, performance, and wellbeing coaches. Founders match by category + rating + availability.",
    href: "/register?lane=coach",
  },
] as const;

export type LaneId = typeof LANES[number]["id"];
