import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Technical Co-founder Wanted" },
      {
        name: "description",
        content:
          "Axal is looking for a technical co-founder. Early stage, real users, hard systems problems. Honest about where we are and what's left to build.",
      },
      { property: "og:title", content: "Axal — Technical Co-founder Wanted" },
      {
        property: "og:description",
        content:
          "Early-stage VC-backed startup recruiting a builder for a high-conviction opportunity. Read the brief.",
      },
    ],
  }),
  component: Index,
});

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-accent">{children}</span>;
}

function Section({
  id,
  index,
  label,
  title,
  children,
}: {
  id: string;
  index: string;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-t border-border py-20 md:py-28">
      <div className="container-prose grid gap-10 md:grid-cols-[200px_1fr]">
        <div className="text-xs text-muted-foreground">
          <div className="text-accent">{index}</div>
          <div className="mt-1 uppercase tracking-widest">{label}</div>
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-foreground mb-6">
            {title}
          </h2>
          <div className="space-y-5 text-[15px] leading-relaxed text-foreground/85 max-w-2xl">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

function Index() {
  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <header className="border-b border-border">
        <div className="container-prose flex items-center justify-between py-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 bg-accent" />
            <span className="font-mono">axal.vc</span>
            <span className="text-muted-foreground hidden sm:inline">
              / co-founder brief
            </span>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
            <span className="hidden sm:inline">last updated 2026-06-20</span>
            <a
              href="#apply"
              className="text-foreground hover:text-accent transition-colors"
            >
              apply →
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border">
        <div className="container-prose py-20 md:py-32">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-6">
            Hiring · Technical co-founder · SF preferred, remote OK (US hours)
          </div>
          <h1 className="text-4xl md:text-6xl font-medium tracking-tight text-foreground leading-[1.05] max-w-4xl">
            We have a wedge, paying users, and a runway problem only a builder
            can fix.
          </h1>
          <p className="mt-8 text-lg text-muted-foreground max-w-2xl leading-relaxed">
            Axal is a pre-seed company building infrastructure for verifiable
            agent execution. We are looking for one engineer to own the system
            end-to-end alongside the founder. This page is the honest version
            of the pitch.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href="#apply"
              className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 py-3 text-sm font-medium hover:opacity-90 transition"
            >
              Join as technical co-founder
              <span aria-hidden>→</span>
            </a>
            <a
              href="#state"
              className="inline-flex items-center gap-2 border border-border px-5 py-3 text-sm hover:bg-surface transition"
            >
              Read where we actually are
            </a>
          </div>

          {/* Quick facts */}
          <dl className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
            {[
              ["Stage", "Pre-seed · $1.4M SAFE"],
              ["Revenue", "~$8k MRR, 40 design partners"],
              ["Runway", "14 months at current burn ($75k/mo)"],
              ["Next round", "Seed in ~12 months"],
            ].map(([k, v]) => (
              <div key={k} className="bg-background p-5">
                <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  {k}
                </dt>
                <dd className="mt-2 text-sm text-foreground">{v}</dd>
              </div>
            ))}
          </dl>

        </div>
      </section>

      <Section
        id="vision"
        index="01"
        label="Product vision"
        title="A trust layer between LLM agents and the systems they touch."
      >
        <p>
          Agents are increasingly executing real actions — moving money, modifying
          infrastructure, sending messages on behalf of people and companies. The
          part nobody has solved well: <Mono>proving what an agent actually did</Mono>,
          to whom, under what policy, with what inputs.
        </p>
        <p>
          We are building a runtime and an attestation protocol so that any agent
          execution can be replayed, audited, and gated by deterministic policy
          before it touches a downstream system. Think of it as the equivalent
          of signed commits and CI — but for agent actions.
        </p>
        <p>
          We are not trying to build "the agent." We are building the substrate
          the agents have to call through.
        </p>
      </Section>

      <Section
        id="state"
        index="02"
        label="Current state"
        title="What exists today — written plainly."
      >
        <ul className="space-y-3 list-none">
          {[
            ["Working", "TypeScript SDK that wraps tool calls and emits signed execution traces. ~6k LOC."],
            ["Working", "Policy DSL (small) with a reference interpreter. Lets a team express 'this agent can spend up to $X on Y kinds of actions.'"],
            ["Working", "Hosted ingestion + replay UI. Customers use it to debug agents in staging."],
            ["Half-working", "Multi-tenant control plane. Auth + orgs are in, billing is duct tape."],
            ["Not built", "Deterministic sandboxed execution layer. This is the hard part."],
            ["Not built", "On-chain anchoring / third-party attestation. Designed, not implemented."],
          ].map(([status, text]) => (
            <li key={text as string} className="grid grid-cols-[110px_1fr] gap-4 border-l-2 border-border pl-4">
              <span
                className={
                  "text-[11px] uppercase tracking-widest pt-1 " +
                  (status === "Working"
                    ? "text-success"
                    : status === "Half-working"
                    ? "text-warning"
                    : "text-danger")
                }
              >
                {status}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm pt-2">
          Revenue is real but small: ~$8k MRR across design partners on
          handshake contracts. We are not pretending this is a Series A company.
        </p>
      </Section>

      <Section
        id="build"
        index="03"
        label="What needs to be built"
        title="The next 12 months of engineering, in order."
      >
        <ol className="space-y-6 list-none counter-reset-[step]">
          {[
            {
              t: "Deterministic execution sandbox",
              d: "A V8 isolate-based runtime that can re-execute a recorded agent trace and produce bit-identical outputs. Needs careful handling of nondeterminism (time, network, model output). This is the technical moat.",
            },
            {
              t: "Attestation pipeline",
              d: "Move from 'we sign traces with our key' to verifiable third-party attestations. Likely TEEs (SEV-SNP or Nitro) for the hot path, with a slower on-chain anchor.",
            },
            {
              t: "Policy compiler",
              d: "Today's policy DSL is interpreted. It needs to compile to a small bytecode and be enforceable inside the sandbox with bounded execution time.",
            },
            {
              t: "Self-serve onboarding",
              d: "Right now I onboard every customer myself. Cut that to zero.",
            },
            {
              t: "Production hardening",
              d: "Observability, multi-region, on-call. Boring and essential.",
            },
          ].map((x, i) => (
            <li key={x.t} className="grid grid-cols-[40px_1fr] gap-4">
              <span className="font-mono text-accent text-sm pt-0.5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div className="text-foreground font-medium">{x.t}</div>
                <div className="text-muted-foreground text-sm mt-1">{x.d}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="pt-6 border-t border-border space-y-5">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-accent mb-2">
              First 90 days — what you own
            </div>
            <ul className="text-sm text-foreground/85 space-y-2 list-none">
              <li>· Take the SDK from ~6k LOC to a v1.0 you'd defend in a code review.</li>
              <li>· Land the first cut of the deterministic sandbox: replay a real customer trace deterministically, even if slow.</li>
              <li>· Pair with the founder on two design-partner integrations so you see the rough edges firsthand.</li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-accent mb-2">
              First 180 days — what we ship together
            </div>
            <ul className="text-sm text-foreground/85 space-y-2 list-none">
              <li>· Sandbox in production behind a feature flag for at least 3 paying customers.</li>
              <li>· Policy compiler emitting bytecode the sandbox enforces with bounded execution.</li>
              <li>· First TEE-backed attestation path running end-to-end (Nitro is the likely bet).</li>
              <li>· Enough self-serve that the founder stops being on every onboarding call — unblocking the seed raise.</li>
            </ul>
          </div>
        </div>

      </Section>

      <Section
        id="why"
        index="04"
        label="Why this is compelling"
        title="The honest case for joining."
      >
        <ul className="space-y-4 list-none">
          <li>
            <span className="text-accent mr-2">→</span>
            The problem is unavoidable. Every serious deployment of agents
            inside a regulated company hits this wall within 90 days. We've
            watched it happen at four of our design partners.
          </li>
          <li>
            <span className="text-accent mr-2">→</span>
            The technical surface is rich and underexplored: deterministic
            replay of non-deterministic systems, verifiable computation,
            policy languages, runtime sandboxing. You will not be bored.
          </li>
          <li>
            <span className="text-accent mr-2">→</span>
            We have customers already willing to pay for v2. The market risk
            is mostly behind us. The remaining risk is execution.
          </li>
          <li>
            <span className="text-accent mr-2">→</span>
            Distribution is straightforward: developer tool, bottom-up,
            sold via integration. You don't need to learn enterprise sales
            to be useful here.
          </li>
        </ul>
      </Section>

      <Section
        id="team"
        index="05"
        label="Team"
        title="Who you'd be building with."
      >
        <div className="space-y-6">
          <div>
            <div className="text-foreground font-medium">
              Founder — full-stack + distributed systems
            </div>
            <div className="text-muted-foreground text-sm mt-1">
              Previously: staff engineer on a payments platform processing
              ~$2B/yr, two years at an LLM infra startup (acquired). Wrote
              the current SDK and policy interpreter. Comfortable selling,
              less comfortable writing isolate code at 2am — which is where
              you come in.
            </div>
          </div>
          <div>
            <div className="text-foreground font-medium">Backers</div>
            <div className="text-muted-foreground text-sm mt-1">
              Axal Ventures (lead) plus operator angels from Stripe, Anthropic,
              and Datadog. <Mono>$1.4M pre-seed SAFE</Mono>, $12M post-money cap,
              closed Q1 2026. No board. Next round is a priced seed in ~12 months,
              gated by sandbox-in-production and ~$30k MRR.
            </div>
          </div>
          <div>
            <div className="text-foreground font-medium">Contractors</div>
            <div className="text-muted-foreground text-sm mt-1">
              Two long-time collaborators on design and DevRel, part-time.
              They will likely stay; they will not be your manager.
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="equity"
        index="06"
        label="Equity & collaboration"
        title="How we want to work together."
      >
        <p>
          <Mono>Co-founder, not first engineer.</Mono> Title, equity, and
          decision-making reflect that.
        </p>
        <div>
          <div className="text-foreground font-medium text-sm">Equity</div>
          <p className="text-muted-foreground text-sm mt-1">
            <Mono>25–40% of common</Mono>, 4-year vest, 1-year cliff. The range
            is set by two things: (1) how much of the roadmap above you'll own
            outright, and (2) what we've shipped together by the time we sign.
            Someone joining today, before the sandbox exists, lands near the
            top of the band. The paid trial counts toward the cliff — if we
            sign after a 6-week trial, your effective cliff is ~10 months from
            day one. Future dilution is shared pro-rata with the founder; we
            do not plan to refresh either of our grants until after Series A.
          </p>
        </div>
        <div>
          <div className="text-foreground font-medium text-sm">Salary</div>
          <p className="text-muted-foreground text-sm mt-1">
            <Mono>$90–130k year one</Mono>, set by what you need to not be
            distracted. Steps to ~$180k at seed close, market for the role at
            Series A. Full health/dental, $2k/mo home-office or co-working.
            This is intentionally below what you'd make as a staff engineer.
            The equity is the compensation.
          </p>
        </div>
        <div>
          <div className="text-foreground font-medium text-sm">Location</div>
          <p className="text-muted-foreground text-sm mt-1">
            SF preferred — we have desks in SoMa and the founder is there 4
            days a week. Fully remote on US hours (PT–ET overlap of 4+ hours)
            is fine; expect <Mono>~1 week per quarter</Mono> on-site plus
            offsites. Relocation budget up to $15k if you move to SF. We
            cannot sponsor a visa at this stage — honest constraint, not a
            preference.
          </p>
        </div>
        <div>
          <div className="text-foreground font-medium text-sm">Working style</div>
          <p className="text-muted-foreground text-sm mt-1">
            Small, written, async-by-default. Decisions in docs, not meetings.
            Disagreement is expected; ambiguity is not. One person, not a team
            — if this works, you are the technical half of the company, not
            someone we manage.
          </p>
        </div>
      </Section>


      {/* CTA */}
      <section id="apply" className="border-t border-border">
        <div className="container-prose py-24 md:py-32">
          <div className="grid gap-10 md:grid-cols-[200px_1fr]">
            <div className="text-xs text-muted-foreground">
              <div className="text-accent">07</div>
              <div className="mt-1 uppercase tracking-widest">Apply</div>
            </div>
            <div className="max-w-2xl">
              <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
                Join as technical co-founder.
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Send a note. No formal CV needed — link to something you built
                and the hardest bug you remember shipping. We reply to every
                serious message within 72 hours.
              </p>

              <div className="mt-10 border border-border bg-surface">
                <div className="border-b border-border px-5 py-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-danger/70" />
                  <span className="h-2 w-2 rounded-full bg-warning/70" />
                  <span className="h-2 w-2 rounded-full bg-success/70" />
                  <span className="ml-2 font-mono">~/apply.sh</span>
                </div>
                <pre className="px-5 py-5 text-sm font-mono leading-relaxed text-foreground/90 overflow-x-auto">
{`$ mail cofounder@axal.vc
Subject: Technical co-founder — <your name>

- something you built (link)
- the hardest bug you remember shipping
- what you want out of the next 4 years
`}
                </pre>
                <div className="border-t border-border px-5 py-4 flex flex-wrap gap-3">
                  <a
                    href="mailto:cofounder@axal.vc?subject=Technical%20co-founder"
                    className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition"
                  >
                    cofounder@axal.vc
                  </a>
                  <a
                    href="#vision"
                    className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:bg-surface-2 transition"
                  >
                    Re-read the brief
                  </a>
                </div>
              </div>

              <div className="mt-10">
                <div className="text-[11px] uppercase tracking-widest text-accent mb-3">
                  What happens after you email
                </div>
                <ol className="space-y-3 text-sm text-foreground/85 list-none">
                  <li className="grid grid-cols-[80px_1fr] gap-3">
                    <span className="font-mono text-muted-foreground">Week 1</span>
                    <span>Intro call with the founder, 45 min. Mutual sniff test — is the problem interesting, are we people you want to work with.</span>
                  </li>
                  <li className="grid grid-cols-[80px_1fr] gap-3">
                    <span className="font-mono text-muted-foreground">Week 2</span>
                    <span>Architecture deep-dive, ~2 hours. We walk you through the codebase and the sandbox design; you push back. No whiteboarding trivia.</span>
                  </li>
                  <li className="grid grid-cols-[80px_1fr] gap-3">
                    <span className="font-mono text-muted-foreground">Wk 3–8</span>
                    <span>Paid trial, 4–6 weeks, <Mono>$12–18k</Mono>. Real work on the sandbox or attestation pipeline, shipped to a design partner. Part-time OK if you have a job; we'll structure around it.</span>
                  </li>
                  <li className="grid grid-cols-[80px_1fr] gap-3">
                    <span className="font-mono text-muted-foreground">End</span>
                    <span>Decision both ways within one week. If yes: term sheet, equity, start date. If no: two-sentence reason and the trial pay is yours.</span>
                  </li>
                </ol>
              </div>

              <p className="mt-8 text-xs text-muted-foreground">
                We will not ghost you. If we don't think it's a fit, we'll
                tell you why in two sentences.
              </p>

            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="container-prose py-8 flex flex-wrap justify-between gap-4 text-xs text-muted-foreground">
          <span>© Axal, Inc. — Brief, not a pitch deck.</span>
          <span className="font-mono">commit 0x9f3a · 2026-06-20</span>
        </div>
      </footer>
    </main>
  );
}
