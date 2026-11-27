import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Raising Seed" },
      { name: "description", content: "Axal is raising a seed round. The investor brief, in one page." },
    ],
  }),
  component: Index,
});

function Index() {
  const [raise, setRaise] = useState(6);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav raise={raise} />
      <Hero raise={raise} setRaise={setRaise} />
      <Divider label="01 — What we do" />
      <WhatWeDo />
      <Divider label="02 — Why now" />
      <WhyNow />
      <Divider label="03 — Traction" />
      <Traction />
      <Divider label="04 — Round" />
      <Round raise={raise} setRaise={setRaise} />
      <Divider label="05 — Use of funds" />
      <UseOfFunds raise={raise} />
      <Divider label="06 — Team" />
      <Team />
      <Divider label="07 — Next" />
      <CTA />
      <Footer />
    </div>
  );
}

function Nav({ raise }: { raise: number }) {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="font-display text-xl">Axal</span>
        </div>
        <div className="hidden items-center gap-8 md:flex">
          <span className="label-mono live-dot">Round open · ${raise}M seed</span>
        </div>
        <a href="#cta" className="rounded-sm border border-foreground bg-foreground px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-accent hover:border-accent hover:text-accent-foreground">
          Request intro →
        </a>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="flex h-7 w-7 items-center justify-center border border-foreground">
      <div className="h-2 w-2 rotate-45 bg-accent" />
    </div>
  );
}

function Hero({ raise, setRaise }: { raise: number; setRaise: (n: number) => void }) {
  return (
    <section className="relative overflow-hidden border-b border-hairline">
      <div className="absolute inset-0 grid-bg opacity-50" />
      <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-20">
        <div className="mb-12 flex items-center gap-3">
          <span className="label-mono">Confidential investor brief</span>
          <span className="h-px w-12 bg-hairline" />
          <span className="label-mono">v.2026.06</span>
        </div>

        <h1 className="max-w-5xl text-6xl leading-[1.02] md:text-8xl">
          The agent runtime <br />
          <span className="italic text-muted-foreground">enterprises</span> ship to production.
        </h1>

        <p className="mt-8 max-w-2xl text-lg text-muted-foreground">
          Axal turns prototype agents into governed, observable systems. Deployed by 14 Fortune 500s in the last 9 months.
        </p>

        <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden border border-hairline bg-hairline md:grid-cols-4">
          <Stat label="Raising" value={<EditableRaise value={raise} onChange={setRaise} />} />
          <Stat label="Stage" value="Seed" />
          <Stat label="Lead" value="In conversation" />
          <Stat label="Close" value="Q3 2026" />
        </div>
      </div>
    </section>
  );
}

function EditableRaise({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-baseline">
      <span className="text-muted-foreground">$</span>
      <input
        type="number"
        min={0.5}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-[3.5ch] bg-transparent text-foreground outline-none focus:text-accent"
        aria-label="Raise amount"
      />
      <span>M</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-background p-6">
      <div className="label-mono">{label}</div>
      <div className="mt-3 font-display text-3xl">{value}</div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-4">
        <span className="label-mono">{label}</span>
      </div>
    </div>
  );
}

function Section({ children, title, kicker }: { children: React.ReactNode; title: string; kicker?: string }) {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 md:grid-cols-12">
        <div className="md:col-span-4">
          {kicker && <div className="label-mono mb-3">{kicker}</div>}
          <h2 className="text-4xl md:text-5xl">{title}</h2>
        </div>
        <div className="md:col-span-8">{children}</div>
      </div>
    </section>
  );
}

function WhatWeDo() {
  return (
    <Section kicker="Product" title="One control plane for production agents.">
      <p className="text-lg leading-relaxed">
        Axal sits between your LLM provider and your application. Routing, evals, guardrails, audit, and rollback — in one runtime.
      </p>
      <div className="mt-10 grid gap-px overflow-hidden border border-hairline bg-hairline sm:grid-cols-3">
        {[
          ["Runtime", "Model-agnostic orchestration with sub-100ms overhead."],
          ["Governance", "Policy enforcement, PII redaction, full audit trail."],
          ["Observability", "Per-step traces, replays, automated regression suites."],
        ].map(([t, d]) => (
          <div key={t} className="bg-background p-6">
            <div className="label-mono">{t}</div>
            <p className="mt-3 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function WhyNow() {
  return (
    <Section kicker="Timing" title="Agents moved from demo to budget line.">
      <ul className="space-y-6">
        {[
          ["$47B", "projected enterprise agent spend by 2027 (Gartner forecast, Mar 2026)."],
          ["73%", "of enterprise agent pilots stall on governance, not capability (a16z practitioner survey, n=412)."],
          ["~0", "pure-play runtime incumbents today — observability and orchestration vendors are adjacent, not native. Window likely closes inside 18 months."],
        ].map(([k, v]) => (
          <li key={k} className="flex items-baseline gap-6 border-b border-hairline pb-6 last:border-0">
            <span className="font-display text-5xl text-accent">{k}</span>
            <span className="text-muted-foreground">{v}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Traction() {
  const rows = [
    ["ARR", "$2.1M", "as of May 2026 · +38% MoM (trailing 3mo)"],
    ["Logos", "14", "incl. 3 of top 10 US banks"],
    ["Net retention", "164%", "trailing 6 months"],
    ["Gross margin", "82%", "Q1 2026, at current scale"],
    ["Pipeline", "$11.4M", "weighted, 90-day · as of Jun 1, 2026"],
  ];
  return (
    <Section kicker="Numbers" title="Compounding, not coasting.">
      <div className="overflow-hidden border border-hairline">
        <table className="w-full text-left">
          <tbody>
            {rows.map(([k, v, n]) => (
              <tr key={k} className="border-b border-hairline last:border-0">
                <td className="label-mono p-5 align-middle">{k}</td>
                <td className="p-5 font-display text-2xl">{v}</td>
                <td className="p-5 text-right text-sm text-muted-foreground">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Round({ raise, setRaise }: { raise: number; setRaise: (n: number) => void }) {
  const valuation = useMemo(() => (raise * 5).toFixed(0), [raise]);
  const leadCommitted = 2.5;
  const otherCommitted = 1.7;
  const allocationLeft = useMemo(
    () => Math.max(0, raise - leadCommitted - otherCommitted).toFixed(1),
    [raise]
  );
  return (
    <Section kicker="Terms" title="Clean priced seed.">
      <div className="grid gap-px overflow-hidden border border-hairline bg-hairline sm:grid-cols-2">
        <Stat label="Raise" value={<EditableRaise value={raise} onChange={setRaise} />} />
        <Stat label="Post-money cap" value={`$${valuation}M`} />
        <Stat label="Instrument" value="Priced equity" />
        <Stat label="Lead committed" value={`$${leadCommitted.toFixed(1)}M`} />
        <Stat label="Other commitments" value={`$${otherCommitted.toFixed(1)}M`} />
        <Stat label="Allocation left" value={`$${allocationLeft}M`} />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Close target: Sept 30, 2026. Adjust raise inline above; cap scales 5x and allocation rebalances against committed capital. Full terms in the dataroom after intro.
      </p>
    </Section>
  );
}

function UseOfFunds({ raise }: { raise: number }) {
  const buckets = [
    ["Engineering", 55, "Runtime + governance team to 18. Ship on-prem deploy, multi-region failover, SOC 2 Type II."],
    ["Go-to-market", 30, "Two enterprise AEs, one SE. Land 25 Fortune 500 logos, expand 3 design partners to 7-figure ACVs."],
    ["Infra & R&D", 15, "Eval suite v2, agent-replay tooling, red-team automation."],
  ] as const;

  return (
    <Section kicker="Allocation" title="24 months of runway. Built for the next milestone, not the next round.">
      <div className="space-y-6">
        {buckets.map(([name, pct, note]) => (
          <div key={name}>
            <div className="flex items-baseline justify-between">
              <div>
                <span className="font-display text-2xl">{name}</span>
                <span className="ml-3 label-mono">${((raise * pct) / 100).toFixed(2)}M</span>
              </div>
              <span className="label-mono">{pct}%</span>
            </div>
            <div className="mt-3 h-px w-full bg-hairline">
              <div className="h-px bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{note}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 border-t border-hairline pt-6 text-sm text-muted-foreground">
        Target end state at month 24: $12M ARR, 35+ enterprise logos in production, default-alive at Series A.
      </p>
    </Section>
  );
}

function Team() {
  const people = [
    [
      "Maya Okafor",
      "CEO",
      "Built Stripe Issuing's policy engine (now $9B GMV/yr). Shipped the controls layer banks actually approve. MIT.",
    ],
    [
      "Daniel Reyes",
      "CTO",
      "Led Anthropic's internal eval infra — the regression suite gating Claude releases. Now powering Axal's eval runtime. Stanford.",
    ],
    [
      "Priya Shah",
      "Head of Eng",
      "Built Datadog APM's distributed-trace pipeline (1M+ spans/sec). Same trace primitives underpin our per-step agent observability. CMU.",
    ],
  ];
  return (
    <Section kicker="Founders" title="Built it before. Building it again.">
      <div className="grid gap-px overflow-hidden border border-hairline bg-hairline sm:grid-cols-3">
        {people.map(([n, r, b]) => (
          <div key={n} className="bg-background p-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center border border-hairline font-display text-lg">
              {n.split(" ").map((x) => x[0]).join("")}
            </div>
            <div className="font-display text-xl">{n}</div>
            <div className="label-mono mt-1">{r}</div>
            <p className="mt-3 text-sm text-muted-foreground">{b}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function CTA() {
  return (
    <section id="cta" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <h2 className="max-w-3xl text-5xl md:text-7xl">
          Warm intro <span className="italic text-muted-foreground">is the fastest path</span>.
        </h2>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          Best fit: B2B / AI infra funds writing $500K–$3M seed checks, comfortable with enterprise GTM and design-partner motions.
        </p>
        <ol className="mt-8 grid max-w-3xl gap-px overflow-hidden border border-hairline bg-hairline sm:grid-cols-4">
          {[
            ["Step 1", "20-min intro call"],
            ["Step 2", "Dataroom + deep dive"],
            ["Step 3", "Partner meeting"],
            ["Step 4", "Decision in 10 days"],
          ].map(([s, d]) => (
            <li key={s} className="bg-background p-5">
              <div className="label-mono">{s}</div>
              <div className="mt-2 text-sm">{d}</div>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="mailto:invest@axal.vc?subject=Intro%20request%20%E2%80%94%20Axal%20seed"
            className="rounded-sm bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
          >
            Request intro →
          </a>
          <a
            href="mailto:invest@axal.vc"
            className="rounded-sm border border-hairline px-6 py-3 text-sm text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            invest@axal.vc
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="label-mono">Axal Inc. · Confidential</span>
        </div>
        <span className="label-mono">Not an offer to sell securities.</span>
      </div>
    </footer>
  );
}
