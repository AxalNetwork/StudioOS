import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Technical Co-Founder Opportunity" },
      {
        name: "description",
        content:
          "Axal is hiring its founding technical co-founder. Working prototype, real users, hard distributed-systems problems ahead, and meaningful equity.",
      },
      { property: "og:title", content: "Axal — Technical Co-Founder Opportunity" },
      {
        property: "og:description",
        content:
          "Working prototype, real users, and a hard technical roadmap. Looking for one founding engineer to build it with us.",
      },
    ],
  }),
  component: Index,
});

const CTA_HREF = "mailto:founders@axal.dev?subject=Technical%20co-founder";
const PROTOTYPE_HREF = "https://github.com";

function Eyebrow({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="label-mono text-signal">{index}</span>
      <span className="label-mono">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Section({
  id,
  index,
  eyebrow,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-6 py-20 md:py-24">
      <Eyebrow index={index}>{eyebrow}</Eyebrow>
      <div className="mt-10">{children}</div>
    </section>
  );
}

function Index() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <Nav />
      <Hero />
      <Vision />
      <CurrentState />
      <ToBuild />
      <WhyCompelling />
      <Team />
      <Logistics />
      <Equity />
      <Process />
      <FinalCTA />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2 font-mono text-sm font-semibold">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-signal" />
          axal
          <span className="text-muted-foreground">/founding-eng</span>
        </a>
        <nav className="hidden items-center gap-6 md:flex">
          <a href="#vision" className="label-mono hover:text-foreground">
            Vision
          </a>
          <a href="#state" className="label-mono hover:text-foreground">
            State
          </a>
          <a href="#build" className="label-mono hover:text-foreground">
            Roadmap
          </a>
          <a href="#team" className="label-mono hover:text-foreground">
            Team
          </a>
          <a href="#logistics" className="label-mono hover:text-foreground">
            Working
          </a>
          <a href="#process" className="label-mono hover:text-foreground">
            Process
          </a>
        </nav>
        <Button asChild variant="signal" size="sm">
          <a href={CTA_HREF}>Apply</a>
        </Button>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-border">
      <div className="pointer-events-none absolute inset-0 grid-paper opacity-60" aria-hidden />
      <div className="relative mx-auto w-full max-w-5xl px-6 pb-20 pt-20 md:pb-28 md:pt-28">
        <div className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-card px-3 py-1">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-signal" />
          <span className="label-mono">Pre-seed · Founding engineer · Equity-led</span>
        </div>

        <h1 className="mt-8 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
          We have a working product and paying users.
          <span className="text-muted-foreground"> We need one engineer to build the hard part.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Axal is reliability infrastructure for autonomous agents: a control plane that verifies,
          sandboxes, and replays what agents do before it reaches production. The prototype works
          and is in real use. Turning it into trustworthy infrastructure is the systems problem,
          and that&apos;s the role.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Button asChild variant="signal" size="lg">
            <a href={CTA_HREF}>Apply &mdash; and share something you&apos;ve built</a>
          </Button>
          <Button asChild variant="outlineStrong" size="lg">
            <a href={PROTOTYPE_HREF} target="_blank" rel="noreferrer">
              See the prototype (new tab)
            </a>
          </Button>
        </div>

        <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border md:grid-cols-4">
          {[
            { k: "Stage", v: "Pre-seed (closing)" },
            { k: "Users", v: "11 design partners" },
            { k: "Working", v: "Remote · EU/US" },
            { k: "Equity", v: "Co-founder level" },
          ].map((s) => (
            <div key={s.k} className="bg-card px-5 py-5">
              <dt className="label-mono">{s.k}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold">{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Vision() {
  return (
    <Section id="vision" index="01" eyebrow="Product vision">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        Teams are shipping agents into production without a way to know what they&apos;ll do.
      </h2>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <p className="text-base leading-relaxed text-muted-foreground">
          Every company adopting LLM agents hits the same wall: the agent works in a demo, then
          does something unexpected with real data, real money, or real customer accounts. There
          is no equivalent of CI, staging, or rollback for non-deterministic systems.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground">
          Axal is the layer that makes agent behavior inspectable and reversible. Define policies,
          run agents in a recorded sandbox, diff their decisions against expectations, and gate
          production actions behind verifiable checks. We want to be the runtime teams trust
          before an agent is allowed to act.
        </p>
      </div>
    </Section>
  );
}

function CurrentState() {
  const shipped = [
    "Policy DSL + evaluator for gating agent actions",
    "Recorded sandbox that captures every tool call and state mutation",
    "Web dashboard for reviewing and approving runs",
    "Python + TypeScript SDKs used by 11 design partners",
  ];
  const rough = [
    "Single-tenant; no real multi-tenant isolation yet",
    "Replay engine is in-memory and breaks past ~a few thousand events",
    "No durable queue — runs are lost if the worker restarts",
    "Auth is hand-rolled and needs to be torn out",
  ];
  return (
    <Section id="state" index="02" eyebrow="Where the product is today">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        Honest snapshot: it works, and it&apos;s held together with intent.
      </h2>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
        This is an early prototype with real usage, not a finished platform. We&apos;re telling you
        exactly what&apos;s solid and what&apos;s duct tape so there are no surprises in week one.
      </p>
      <div className="mt-10 grid gap-px overflow-hidden rounded border border-border bg-border md:grid-cols-2">
        <div className="bg-card p-7">
          <div className="label-mono text-signal">Shipped &amp; in use</div>
          <ul className="mt-5 space-y-3">
            {shipped.map((t) => (
              <li key={t} className="flex gap-3 text-sm leading-relaxed">
                <span className="mt-1 font-mono text-signal">+</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-card p-7">
          <div className="label-mono">Known weak points</div>
          <ul className="mt-5 space-y-3">
            {rough.map((t) => (
              <li key={t} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                <span className="mt-1 font-mono text-destructive">!</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function ToBuild() {
  const items = [
    {
      tag: "core",
      title: "A durable, deterministic replay engine",
      body: "Move replay off in-memory state to an append-only event log with snapshotting, so a run of millions of events can be reconstructed exactly and stepped through. This is the heart of the product.",
    },
    {
      tag: "infra",
      title: "Multi-tenant execution & isolation",
      body: "Run untrusted agent workloads in isolated sandboxes (gVisor / Firecracker-style) with strict resource and network boundaries. Tenancy, quotas, and noisy-neighbor protection from the ground up.",
    },
    {
      tag: "infra",
      title: "Durable job orchestration",
      body: "Replace the fragile worker with a real queue and scheduler — exactly-once-ish semantics, retries, backpressure, and observability — so runs survive restarts and scale horizontally.",
    },
    {
      tag: "product",
      title: "Policy engine v2",
      body: "Evolve the policy DSL into something expressive and fast: typed conditions, simulation, and sub-millisecond evaluation in the request path of an agent action.",
    },
  ];
  const first90 = [
    "Weeks 1–4: read the codebase end to end, pair with design partners, and write the architecture decision record for the durable replay engine.",
    "Weeks 4–8: ship the append-only event log + snapshotting that replaces in-memory replay; get one partner workload running on it.",
    "Weeks 8–12: stand up real job orchestration (queue, retries, backpressure) so runs survive restarts, and scope the multi-tenant isolation work.",
  ];
  return (
    <Section id="build" index="03" eyebrow="What needs to be built">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        The interesting problems are still open.
      </h2>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
        This is a systems role. If event-sourcing, sandboxing, and reliable distributed
        infrastructure is the work you want to own, here&apos;s where it starts and where it goes.
      </p>

      <div className="mt-10 rounded border border-border-strong bg-card p-7">
        <div className="label-mono text-signal">First 90 days</div>
        <ol className="mt-5 space-y-3">
          {first90.map((t, i) => (
            <li key={t} className="flex gap-3 text-sm leading-relaxed">
              <span className="mt-0.5 font-mono text-signal">{String(i + 1).padStart(2, "0")}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-10 label-mono">The 12-month surface</p>
      <div className="mt-4 grid gap-px overflow-hidden rounded border border-border bg-border md:grid-cols-2">
        {items.map((it, i) => (
          <article key={it.title} className="bg-card p-7">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="label-mono rounded-sm border border-border px-2 py-0.5">
                {it.tag}
              </span>
            </div>
            <h3 className="mt-4 text-lg font-semibold">{it.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{it.body}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

function WhyCompelling() {
  const reasons = [
    {
      t: "Real workloads, today",
      d: "11 design partners run agents through Axal now. You build against production traffic and direct feedback, not a roadmap deck.",
    },
    {
      t: "A hard technical core",
      d: "Deterministic replay, sandbox isolation, and sub-ms policy evaluation in the hot path. The moat is the engineering, and you own it.",
    },
    {
      t: "A problem that already hurts",
      d: "Teams deploy agents and get burned by unexpected actions. The need for verification and rollback is concrete, not a future bet.",
    },
    {
      t: "Founder-level ownership",
      d: "You set the architecture, the stack, and the engineering bar from line one. No legacy, no committee.",
    },
  ];
  return (
    <Section id="why" index="04" eyebrow="Why this is compelling">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        Four concrete reasons, no hype.
      </h2>
      <div className="mt-10 grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2">
        {reasons.map((r) => (
          <div key={r.t} className="bg-card p-7">
            <h3 className="text-base font-semibold">{r.t}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Team() {
  const people = [
    {
      name: "Founder, CEO",
      role: "Product & GTM",
      bio: "Former PM on developer infrastructure; spent the last two years shipping LLM features into a regulated product and living the reliability problem firsthand. Drives partners, roadmap, and fundraising.",
    },
    {
      name: "Founding advisor",
      role: "Distributed systems",
      bio: "Built and operated large-scale event-streaming infrastructure. Helps with architecture reviews and the replay-engine design; not full-time.",
    },
  ];
  return (
    <Section id="team" index="05" eyebrow="Who you'd build with">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        A small team that respects engineering.
      </h2>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
        Today it&apos;s a non-technical founder carrying product and customers, plus a part-time
        systems advisor. The technical seat is open on purpose — we want a true partner, not a
        first hire.
      </p>
      <div className="mt-10 grid gap-px overflow-hidden rounded border border-border bg-border md:grid-cols-2">
        {people.map((p) => (
          <div key={p.name} className="bg-card p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded border border-border-strong bg-secondary font-mono text-sm font-semibold">
                {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
              </span>
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="label-mono">{p.role}</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{p.bio}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Logistics() {
  const rows = [
    { k: "Location", v: "Remote-first. We meet in person ~1 week per quarter." },
    { k: "Time zones", v: "Anywhere with 4+ hours of overlap with 09:00–13:00 ET." },
    { k: "Core hours", v: "Two fixed overlap hours/day; the rest is async and written." },
    { k: "Visa", v: "No relocation or sponsorship today; we contract globally instead." },
  ];
  return (
    <Section id="logistics" index="06" eyebrow="Location & way of working">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        Remote, async, and honest about logistics.
      </h2>
      <div className="mt-10 grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.k} className="bg-card p-7">
            <div className="label-mono text-signal">{r.k}</div>
            <p className="mt-3 text-sm leading-relaxed">{r.v}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Equity() {
  const points = [
    {
      h: "Equity",
      d: "Co-founder level (meaningful single-digit to low-double-digit %), standard 4-year vest with a 1-year cliff. You see the full cap table before you commit.",
    },
    {
      h: "Funding status",
      d: "Pre-seed is in progress: a lead is committed and we're closing the round now. Revenue from design partners extends current runway to ~9 months.",
    },
    {
      h: "Salary",
      d: "Below-market until close, then a founder salary in the ~$120k–$160k range depending on round size and location. If the close slips, equity goes up and we agree a date to revisit cash — in writing.",
    },
    {
      h: "How we work",
      d: "Async-first, written-first, low-meeting. Decisions live in docs, not calls. You own all engineering choices: stack, architecture, hiring, and process.",
    },
  ];
  return (
    <Section id="equity" index="07" eyebrow="Equity & collaboration philosophy">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        Partner terms, written down, no games.
      </h2>
      <div className="mt-10 rounded border border-border bg-card p-8">
        <ul className="space-y-5">
          {points.map((p) => (
            <li key={p.h} className="border-b border-border pb-5 last:border-0 last:pb-0">
              <div className="flex items-start gap-4">
                <span className="font-mono text-sm text-signal">&rarr;</span>
                <div>
                  <div className="font-semibold">{p.h}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.d}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Process() {
  const steps = [
    {
      n: "01",
      h: "You apply",
      d: "Email us and link one thing you've built — a repo, a design doc, a postmortem, or a writeup of a hard system you shipped. No CV required.",
    },
    {
      n: "02",
      h: "Intro call (45 min)",
      d: "Founder + advisor. We walk the architecture, the weak points, and the roadmap, and you pressure-test the opportunity. Within ~3 days of applying.",
    },
    {
      n: "03",
      h: "Technical deep-dive (~2 hrs)",
      d: "Read the real codebase with us and sketch how you'd build the durable replay engine. Paid as a short consulting day if you'd prefer.",
    },
    {
      n: "04",
      h: "Decision & terms",
      d: "References both ways, then equity and terms in writing. Whole process is 2–3 weeks, not months.",
    },
  ];
  return (
    <Section id="process" index="08" eyebrow="Process">
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-4xl">
        What happens after you apply.
      </h2>
      <div className="mt-10 grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2">
        {steps.map((s) => (
          <div key={s.n} className="bg-card p-7">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-signal">{s.n}</span>
              <span className="font-semibold">{s.h}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FinalCTA() {
  return (
    <section className="border-t border-border-strong">
      <div className="relative mx-auto w-full max-w-5xl px-6 py-24 text-center">
        <div className="pointer-events-none absolute inset-0 grid-paper opacity-50" aria-hidden />
        <div className="relative">
          <span className="label-mono">Open seat — one founding engineer</span>
          <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-bold tracking-tight md:text-5xl">
            If the hard part is what excites you, let&apos;s talk.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
            Send a note about something hard you&apos;ve built. No cover letter, no CV theater —
            we&apos;d rather read your code or your writing.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button asChild variant="signal" size="lg">
              <a href={CTA_HREF}>Apply &mdash; and share something you&apos;ve built</a>
            </Button>
            <Button asChild variant="outlineStrong" size="lg">
              <a href={PROTOTYPE_HREF} target="_blank" rel="noreferrer">
                See the prototype (new tab)
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 md:flex-row">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-signal" />
          axal
        </div>
        <p className="label-mono">Pre-seed · Building agent reliability infrastructure</p>
      </div>
    </footer>
  );
}
