import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ArrowRight,
  Circle,
  TrendingUp,
  Activity,
  Users,
  DollarSign,
  Target,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Seed Round | The infrastructure layer for agent commerce" },
      {
        name: "description",
        content:
          "Axal is raising a $6M seed to scale the payments and identity layer powering autonomous AI agents. $1.4M ARR, 18% MoM growth, 142% NDR.",
      },
      { property: "og:title", content: "Axal — Seed Round" },
      {
        property: "og:description",
        content:
          "$1.4M ARR · 18% MoM · 142% NDR. The infrastructure layer for agent commerce.",
      },
    ],
  }),
  component: Index,
});

/* ---------- Editable content ---------- */

const COMPANY = {
  name: "Axal",
  tagline: "The infrastructure layer for agent commerce.",
  oneLiner:
    "Axal gives autonomous AI agents the payments, identity, and policy primitives they need to transact on behalf of real businesses — safely, auditably, and at scale.",
  round: {
    stage: "Seed",
    raising: "$6M",
    leadCommitted: "$3.2M soft-circled",
    valuation: "$32M post",
    use: ["Engineering (60%)", "GTM & design partners (25%)", "SOC 2 + compliance (15%)"],
    timeline: "Closing Q3 2026",
  },
};

const HERO_METRICS = [
  { k: "ARR", v: "$1.4M", d: "+18% MoM" },
  { k: "Paying customers", v: "47", d: "12 Fortune 1000" },
  { k: "Net dollar retention", v: "142%", d: "trailing 6mo" },
  { k: "Gross margin", v: "84%", d: "infra-adjusted" },
];

const PRODUCT_PILLARS = [
  {
    icon: Activity,
    title: "Agent identity",
    body: "Issue scoped, revocable credentials so every transaction maps to a specific agent, principal, and policy.",
    metric: "11M",
    metricLabel: "agent sessions / mo",
  },
  {
    icon: DollarSign,
    title: "Programmable payments",
    body: "Stablecoin and card rails with spend caps, merchant allow-lists, and per-task budgets enforced at the edge.",
    metric: "$94M",
    metricLabel: "annualized GMV",
  },
  {
    icon: Target,
    title: "Policy & audit",
    body: "Deterministic policy engine with immutable logs — every action explainable to risk, finance, and regulators.",
    metric: "99.99%",
    metricLabel: "policy uptime",
  },
];

const MARKET = [
  { label: "Agent-mediated commerce by 2030 (Gartner)", value: "$1.7T" },
  { label: "Enterprises piloting agent workflows in 2026", value: "68%" },
  { label: "B2B SaaS spend reachable from day one", value: "$84B" },
  { label: "Wedge: agent-issued card volume in 2026", value: "$2.1B" },
];

const TRACTION = [
  { month: "Jan", arr: 410 },
  { month: "Feb", arr: 520 },
  { month: "Mar", arr: 640 },
  { month: "Apr", arr: 790 },
  { month: "May", arr: 980 },
  { month: "Jun", arr: 1180 },
  { month: "Jul", arr: 1400 },
];

const COHORTS = [
  { cohort: "Q4 ’25", m0: 100, m1: 118, m2: 131, m3: 144 },
  { cohort: "Q1 ’26", m0: 100, m1: 124, m2: 139, m3: null },
  { cohort: "Q2 ’26", m0: 100, m1: 129, m2: null, m3: null },
];

const USAGE = [
  { k: "DAU / WAU", v: "0.71", d: "stickiness, last 30d" },
  { k: "Median API calls / customer / day", v: "8,420", d: "+34% QoQ" },
  { k: "Time to first transaction", v: "11 min", d: "median, self-serve" },
  { k: "Logo churn (annualized)", v: "1.8%", d: "0 enterprise churn YTD" },
];

const LOGOS = ["Ramp", "Linear", "Notion", "Vercel", "Anthropic", "Mercury", "Brex", "Retool"];

const TEAM = [
  {
    name: "Maya Okafor",
    role: "Co-founder & CEO",
    bio: "Early PM on Stripe Issuing. Shipped programmable cards to 40k+ businesses.",
  },
  {
    name: "Daniel Reiss",
    role: "Co-founder & CTO",
    bio: "Staff eng at Anthropic infra. Led agent runtime work prior to founding Axal.",
  },
  {
    name: "Priya Anand",
    role: "Head of Risk",
    bio: "10y at Plaid and Marqeta on fraud, BSA/AML, and bank partner programs.",
  },
];

const INVESTORS = [
  "Sequoia (scout)",
  "South Park Commons",
  "Operators from Stripe, Anthropic, Ramp",
];

/* ---------- Page ---------- */

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <Logos />
      <Product />
      <Market />
      <Traction />
      <Proof />
      <Team />
      <Round />
      <CTA />
      <Footer />
    </div>
  );
}

/* ---------- Sections ---------- */

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-mono text-sm tracking-tight">{COMPANY.name.toLowerCase()}</span>
          <span className="ml-3 hidden font-mono text-[11px] uppercase tracking-widest text-muted-foreground md:inline">
            / {COMPANY.round.stage} memo
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
            <Pulse /> Round open · {COMPANY.round.timeline}
          </span>
          <a
            href="#cta"
            className="ml-3 inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Schedule call <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="absolute inset-0 bg-grid bg-grid-fade opacity-60" />
      <div className="relative mx-auto max-w-7xl px-6 pt-20 pb-16">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <Pulse /> {COMPANY.round.stage} · {COMPANY.round.raising} · {COMPANY.round.leadCommitted}
        </div>
        <h1 className="mt-6 max-w-4xl font-display text-5xl leading-[1.05] md:text-7xl">
          {COMPANY.tagline}
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{COMPANY.oneLiner}</p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="#cta"
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-3 font-mono text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            See the deck <ArrowUpRight className="h-4 w-4" />
          </a>
          <a
            href="#round"
            className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Round details ↓
          </a>
        </div>

        <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-4">
          {HERO_METRICS.map((m) => (
            <MetricCell key={m.k} k={m.k} v={m.v} d={m.d} large />
          ))}
        </div>
      </div>
    </section>
  );
}

function Logos() {
  return (
    <section className="border-b border-border bg-card/30">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Powering agents at
          </span>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-sm text-muted-foreground">
            {LOGOS.map((l) => (
              <span key={l} className="tracking-tight">
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Product() {
  return (
    <Section id="product" eyebrow="01 / Product" title="Three primitives. One agent transaction stack.">
      <p className="max-w-2xl text-muted-foreground">
        Every team building agents rebuilds the same three layers. We ship them as a single
        SDK and managed backend so customers go from prototype to production-grade spend in
        a weekend.
      </p>
      <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-3">
        {PRODUCT_PILLARS.map(({ icon: Icon, title, body, metric, metricLabel }) => (
          <div key={title} className="flex flex-col gap-6 bg-card p-6">
            <div className="flex items-center justify-between">
              <Icon className="h-4 w-4 text-primary" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {metricLabel}
              </span>
            </div>
            <div className="font-mono text-3xl tabular text-primary">{metric}</div>
            <div>
              <h3 className="text-base font-medium">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Market() {
  return (
    <Section id="market" eyebrow="02 / Market" title="Agents become buyers. The rails don’t exist yet.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <p className="max-w-xl text-muted-foreground">
          By 2030, more than a trillion dollars of B2B spend will originate from autonomous
          agents rather than humans clicking checkout. Today none of the existing payment,
          identity, or compliance stacks were built for a non-human principal. That’s our wedge.
        </p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border">
          {MARKET.map((m) => (
            <div key={m.label} className="bg-card p-5">
              <div className="font-mono text-2xl tabular text-primary">{m.value}</div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Traction() {
  const max = Math.max(...TRACTION.map((t) => t.arr));
  return (
    <Section id="traction" eyebrow="03 / Traction" title="ARR up 3.4× in seven months.">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-sm border border-border bg-card p-6">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Monthly recurring revenue (K)
              </div>
              <div className="mt-1 font-mono text-3xl tabular">
                ${TRACTION[TRACTION.length - 1].arr.toLocaleString()}K
              </div>
            </div>
            <div className="flex items-center gap-1 font-mono text-xs text-primary">
              <TrendingUp className="h-3.5 w-3.5" /> +18% MoM
            </div>
          </div>
          <div className="flex h-56 items-end gap-3">
            {TRACTION.map((t) => (
              <div key={t.month} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full bg-primary/90"
                  style={{ height: `${(t.arr / max) * 100}%` }}
                />
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t.month}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-2 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border">
          {[
            { k: "New logos (Q2)", v: "19", d: "vs. 7 in Q1" },
            { k: "Pipeline coverage", v: "4.1×", d: "next quarter quota" },
            { k: "Avg ACV", v: "$38K", d: "+62% YoY" },
            { k: "Sales cycle", v: "21 days", d: "self-serve to paid" },
          ].map((m) => (
            <MetricCell key={m.k} {...m} />
          ))}
        </div>
      </div>
    </Section>
  );
}

function Proof() {
  return (
    <Section
      id="proof"
      eyebrow="04 / Retention & usage"
      title="Customers expand. They don’t leave."
    >
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-sm border border-border bg-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Net revenue retention by cohort (indexed to 100)
            </div>
            <span className="font-mono text-xs text-primary">142% blended</span>
          </div>
          <div className="overflow-hidden rounded-sm border border-border">
            <table className="w-full font-mono text-sm tabular">
              <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-normal">Cohort</th>
                  <th className="px-4 py-2 font-normal">M0</th>
                  <th className="px-4 py-2 font-normal">M1</th>
                  <th className="px-4 py-2 font-normal">M2</th>
                  <th className="px-4 py-2 font-normal">M3</th>
                </tr>
              </thead>
              <tbody>
                {COHORTS.map((c) => (
                  <tr key={c.cohort} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground">{c.cohort}</td>
                    {[c.m0, c.m1, c.m2, c.m3].map((v, i) => (
                      <td key={i} className="px-4 py-3">
                        {v ? (
                          <span className={v > 100 ? "text-primary" : ""}>{v}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-lg text-xs text-muted-foreground">
            Every cohort since launch is net-expanding by M1. Expansion is usage-driven —
            customers grow as their agent fleets grow.
          </p>
        </div>

        <div className="lg:col-span-2 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border">
          {USAGE.map((m) => (
            <MetricCell key={m.k} {...m} />
          ))}
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-2">
        <Quote
          quote="We replaced six internal services with Axal in a week. Our agent spend went from a compliance fire drill to a dashboard."
          name="VP Platform"
          org="Fortune 500 fintech"
        />
        <Quote
          quote="The policy engine is the reason our risk team signed off. Nothing else on the market is this auditable."
          name="Head of AI"
          org="Public SaaS company"
        />
      </div>
    </Section>
  );
}

function Team() {
  return (
    <Section id="team" eyebrow="05 / Team" title="Built by operators who shipped this problem before.">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-3">
        {TEAM.map((p) => (
          <div key={p.name} className="bg-card p-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-sm border border-border bg-muted font-mono text-lg">
              {p.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            <div className="mt-5 font-medium">{p.name}</div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {p.role}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{p.bio}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>Existing backers:</span>
        {INVESTORS.map((i) => (
          <span key={i}>{i}</span>
        ))}
      </div>
    </Section>
  );
}

function Round() {
  return (
    <Section id="round" eyebrow="06 / Round" title={`Raising ${COMPANY.round.raising} ${COMPANY.round.stage}`}>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border lg:grid-cols-3">
        <div className="bg-card p-8 lg:col-span-1">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Terms
          </div>
          <div className="mt-4 space-y-3 font-mono text-sm">
            <Row k="Stage" v={COMPANY.round.stage} />
            <Row k="Target" v={COMPANY.round.raising} />
            <Row k="Committed" v={COMPANY.round.leadCommitted} />
            <Row k="Valuation" v={COMPANY.round.valuation} />
            <Row k="Timeline" v={COMPANY.round.timeline} />
          </div>
        </div>
        <div className="bg-card p-8 lg:col-span-2">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Use of funds — 18 month runway to Series A
          </div>
          <ul className="mt-6 space-y-4">
            {COMPANY.round.use.map((u) => (
              <li key={u} className="flex items-start gap-3 border-b border-border pb-4 last:border-0">
                <Circle className="mt-1 h-2 w-2 fill-primary text-primary" />
                <span className="font-mono text-sm">{u}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-xl text-sm text-muted-foreground">
            Plan gets us to $5M ARR, SOC 2 Type II, and three production deployments at named
            enterprise logos — the milestones our Series A leads have already underwritten.
          </p>
        </div>
      </div>
    </Section>
  );
}

function CTA() {
  return (
    <section id="cta" className="border-y border-border bg-card">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-6 py-20 md:grid-cols-2">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <Pulse /> Investor access · {COMPANY.round.timeline}
          </div>
          <h2 className="mt-4 font-display text-4xl leading-tight md:text-5xl">
            See the deck or schedule an investor call.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            We share the full data room — cohort exports, contracts, financial model — after
            a 30-minute intro call.
          </p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <a
            href="mailto:invest@axal.example?subject=Axal%20seed%20—%20investor%20call"
            className="inline-flex items-center justify-between gap-6 rounded-sm bg-primary px-6 py-4 font-mono text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Schedule investor call
            <ArrowUpRight className="h-4 w-4" />
          </a>
          <span className="font-mono text-[11px] text-muted-foreground">
            or email invest@axal.example
          </span>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex flex-col items-start justify-between gap-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <Logo />
          <span>{COMPANY.name.toLowerCase()} · {COMPANY.round.stage.toLowerCase()} memo · 2026</span>
        </div>
        <div>Confidential — do not distribute</div>
      </div>
    </footer>
  );
}

/* ---------- Primitives ---------- */

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b border-border">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-10 flex flex-col gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </span>
          <h2 className="font-display text-4xl leading-tight md:text-5xl">{title}</h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function MetricCell({
  k,
  v,
  d,
  large = false,
}: {
  k: string;
  v: string;
  d?: string;
  large?: boolean;
}) {
  return (
    <div className="bg-card p-5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {k}
      </div>
      <div className={`mt-2 font-mono tabular ${large ? "text-4xl" : "text-2xl"}`}>{v}</div>
      {d && <div className="mt-1 font-mono text-[11px] text-primary/90">{d}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Quote({ quote, name, org }: { quote: string; name: string; org: string }) {
  return (
    <figure className="bg-card p-8">
      <blockquote className="font-display text-2xl leading-snug">“{quote}”</blockquote>
      <figcaption className="mt-5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {name} · {org}
      </figcaption>
    </figure>
  );
}

function Logo() {
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-foreground">
      <span className="font-mono text-xs font-bold leading-none">A</span>
    </div>
  );
}

function Pulse() {
  return (
    <span className="relative mr-1 inline-flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
    </span>
  );
}
