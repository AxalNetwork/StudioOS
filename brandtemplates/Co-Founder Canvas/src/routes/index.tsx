import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Looking for a co-founder" },
      {
        name: "description",
        content:
          "A letter from the founder of Axal. We are building autonomous market infrastructure and we are looking for one person to build it with.",
      },
      { property: "og:title", content: "Axal — Looking for a co-founder" },
      {
        property: "og:description",
        content:
          "Not a job listing. A letter to one person — the technical co-founder we are still missing.",
      },
    ],
  }),
  component: Index,
});

function SectionLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
      <span className="text-accent">{n}</span>
      <span className="h-px flex-1 bg-border" />
      <span>{children}</span>
    </div>
  );
}

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 pt-8 md:pt-10">
        <div className="flex items-center gap-2 font-display text-lg font-medium">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          Axal
        </div>
        <nav className="hidden gap-8 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground md:flex">
          <a href="#building" className="hover:text-foreground">Building</a>
          <a href="#why-now" className="hover:text-foreground">Why now</a>
          <a href="#role" className="hover:text-foreground">The role</a>
          <a href="#talk" className="hover:text-foreground">Talk</a>
        </nav>
        <a
          href="#talk"
          className="rounded-full border border-foreground/80 px-4 py-1.5 font-mono text-xs uppercase tracking-[0.18em] transition hover:bg-foreground hover:text-background"
        >
          Talk to me
        </a>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-28 md:pt-32 md:pb-40">
        <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          A letter from the founder · San Francisco · 2026
        </div>
        <h1 className="font-display mt-8 text-5xl leading-[1.02] tracking-tight md:text-7xl lg:text-[88px]">
          I am building the agent layer
          <br />
          for capital markets.
          <br />
          <span className="italic text-accent">I cannot do it alone.</span>
        </h1>
        <p className="mt-8 max-w-2xl text-lg font-medium leading-relaxed text-foreground md:text-xl">
          Axal is a runtime that turns trading strategies — expressed in code or
          natural language — into verifiable, audited execution across exchanges.
        </p>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
          The company is small, serious, and funded. We have a live design partner,
          a shipped v0.4 engine, and runway through Q4 2027. What I am missing is
          the technical co-founder who can turn what we have into infrastructure
          that clears billions a day. This page is for that person.
        </p>

        <div className="mt-14 flex flex-wrap items-center gap-4">
          <a
            href="#talk"
            className="group inline-flex items-center gap-3 rounded-full bg-foreground px-6 py-3.5 text-background transition hover:bg-accent"
          >
            <span className="font-medium">Talk about joining</span>
            <span className="font-mono text-sm transition group-hover:translate-x-1">→</span>
          </a>
          <a
            href="#role"
            className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Read the whole thing first
          </a>
        </div>

        {/* facts strip */}
        <dl className="mt-24 grid grid-cols-2 gap-x-8 gap-y-10 border-t border-border pt-10 font-mono text-xs uppercase tracking-[0.18em] md:grid-cols-4">
          {[
            ["Stage", "Seed, closed"],
            ["Team", "3 → 5"],
            ["Equity", "Real co-founder %"],
            ["Location", "SF, in person"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="mt-2 font-sans text-base normal-case tracking-normal text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* WHAT WE ARE BUILDING */}
      <section id="building" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionLabel n="01">What we are building</SectionLabel>
          <div className="mt-12 grid gap-16 md:grid-cols-12">
            <h2 className="font-display text-4xl leading-tight tracking-tight md:col-span-5 md:text-5xl">
              An execution layer for autonomous financial agents.
            </h2>
            <div className="space-y-6 text-lg leading-relaxed text-muted-foreground md:col-span-7">
              <p>
                Today, anyone can prompt a model to <em className="text-foreground">describe</em> a
                trading strategy. Almost no one can hand a model real capital and
                trust the outcome. The gap between intent and execution is
                where all the risk lives — and where the work is.
              </p>
              <p>
                Axal is the runtime in the middle. We take a strategy expressed
                in natural language or code, compile it into a verifiable
                execution policy, run it across exchanges and venues, and prove
                what happened after. Banks, funds, and protocols plug in.
              </p>
              <p className="text-foreground">
                If LLMs are the brain, we are the hands — and the conscience.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHY NOW */}
      <section id="why-now" className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionLabel n="02">Why now</SectionLabel>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {[
              {
                t: "Models crossed the line",
                b: "Frontier models can now reason about portfolios well enough that the bottleneck moved from intelligence to safe execution. That bottleneck is ours to solve.",
              },
              {
                t: "Regulation is converging",
                b: "MiCA, the SEC's agent guidance, and the EU AI Act are creating the first real demand for verifiable, auditable AI behavior in markets. Incumbents are not ready.",
              },
              {
                t: "Distribution is briefly open",
                b: "Two desks at top-tier funds have already signed letters of intent. That window — where a small team can be picked over a vendor — closes within 18 months.",
              },
            ].map((x, i) => (
              <div key={i} className="border-t border-border pt-6">
                <div className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
                  0{i + 1}
                </div>
                <h3 className="font-display mt-3 text-2xl leading-snug">{x.t}</h3>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">{x.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ALREADY BUILT */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionLabel n="03">What has already been built</SectionLabel>
          <div className="mt-12 grid gap-12 md:grid-cols-12">
            <div className="space-y-6 text-lg leading-relaxed text-muted-foreground md:col-span-6">
              <p>
                I want to be honest about what exists, because I think the
                interesting question is not the pitch — it is the codebase you
                would walk into on a Monday.
              </p>
              <p>
                The runtime is real. The first design partner is live. The
                company has runway through Q4 2027.
              </p>
            </div>
            <ul className="space-y-5 md:col-span-6">
              {[
                ["Execution engine v0.4", "Rust core, deterministic replay, ~14k LOC. Running in production against Coinbase and Binance."],
                ["Policy compiler", "Translates declarative strategy specs into signed, bounded execution policies. Working, ugly."],
                ["First design partner", "A $400M crypto-native fund. Two strategies live, $11M notional this quarter."],
                ["Seed round", "$4.2M closed in March. Lead is a top-tier crypto fund. No board yet."],
                ["Team", "Two engineers and me. Hired carefully. Both staying."],
              ].map(([t, b]) => (
                <li key={t} className="border-l-2 border-accent pl-5">
                  <div className="font-display text-xl text-foreground">{t}</div>
                  <div className="mt-1 text-base text-muted-foreground">{b}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* WHAT'S MISSING */}
      <section className="border-t border-border bg-foreground text-background">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-background/60">
            04 — What is missing
          </div>
          <h2 className="font-display mt-8 max-w-4xl text-4xl leading-tight md:text-6xl">
            The gap is me.
          </h2>
          <div className="mt-12 grid gap-12 text-lg leading-relaxed text-background/75 md:grid-cols-2">
            <div className="space-y-5">
              <p>
                My background is markets. I traded rates at a fund for six years
                and ran a small systematic book. I can write the policy language.
                I can ship a prototype. I cannot architect the distributed
                execution system we will need in two years — one that clears
                billions a day without dropping a message.
              </p>
              <p>
                Right now every architectural decision routes through me. I am
                the slowest part of the company. That is not sustainable past
                the next six months.
              </p>
            </div>
            <div className="space-y-5">
              <p>
                We have shipped the version of Axal that one trader plus two
                strong engineers can ship. The next version requires someone
                who has built low-latency, fault-tolerant infrastructure
                before — and who wants to own it the way only a founder does.
              </p>
              <p className="text-background">
                Not a head of engineering. Not a first hire. A co-founder, on
                the cap table, with veto power on the things they should have
                veto on.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THE ROLE */}
      <section id="role" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionLabel n="05">The role</SectionLabel>
          <h2 className="font-display mt-10 max-w-3xl text-4xl leading-tight md:text-5xl">
            Technical co-founder. CTO in title once you want it.
          </h2>

          <div className="mt-16 grid gap-16 md:grid-cols-2">
            <div>
              <div className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
                You have probably
              </div>
              <ul className="mt-5 space-y-4 text-lg leading-relaxed text-foreground">
                <li>— Built and operated systems where downtime is measured in basis points, not pages.</li>
                <li>— Worked deep in one of: HFT infra, exchange matching, payments rails, or a serious distributed database.</li>
                <li>— Shipped Rust, C++, or Go in production. Opinions about both consensus and GC.</li>
                <li>— Thought about correctness as a product feature, not a tax.</li>
              </ul>
            </div>
            <div>
              <div className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
                You probably do not
              </div>
              <ul className="mt-5 space-y-4 text-lg leading-relaxed text-foreground">
                <li>— Need to know finance. I will teach you. You will be better at it than you expect within a quarter.</li>
                <li>— Want to manage a team of forty. We will stay small on purpose for a long time.</li>
                <li>— Care about the title now. You will care later, and it will be there.</li>
              </ul>
            </div>
          </div>

          <div className="mt-20 rule pt-10">
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
              First 90 days
            </div>
            <ul className="mt-5 space-y-3 text-lg leading-relaxed text-foreground">
              <li>— Audit the architecture and decide what to keep, rewrite, or replace.</li>
              <li>— Harden the execution path for the next design partner (latency, fault tolerance, replay).</li>
              <li>— Own the policy-compiler refactor: make it fast enough and clean enough to open-source.</li>
              <li>— Build the hiring plan for Q3. You will interview every candidate.</li>
            </ul>
          </div>

          <div className="mt-16 rule pt-10">
            <div className="grid gap-6 font-mono text-sm md:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Equity</div>
                <div className="mt-2 font-sans text-2xl">15 – 25%</div>
                <div className="mt-1 text-xs text-muted-foreground normal-case tracking-normal">Honest range. We will talk through the math.</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Salary</div>
                <div className="mt-2 font-sans text-2xl">$180k base</div>
                <div className="mt-1 text-xs text-muted-foreground normal-case tracking-normal">Same as mine. Goes up when the next round closes.</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Where</div>
                <div className="mt-2 font-sans text-2xl">SF, in person</div>
                <div className="mt-1 text-xs text-muted-foreground normal-case tracking-normal">Mission district. Four days minimum. Relocation and visa support available.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHY JOIN */}
      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionLabel n="06">Why join</SectionLabel>
          <div className="mt-12 grid gap-x-12 gap-y-14 md:grid-cols-2">
            {[
              [
                "The problem is unambiguously hard.",
                "You will not run out of interesting work. Verifiable execution under adversarial conditions is one of the few places in software where the bar is set by physics and game theory, not by taste.",
              ],
              [
                "The company is real, not a deck.",
                "Revenue, design partners, runway, a team that has already shipped together. You inherit a working thing, not a promise.",
              ],
              [
                "You will have the keys.",
                "Architecture, hiring, the technical narrative the company tells the market. I want a partner, not a report. I will defend that.",
              ],
              [
                "The upside is concentrated.",
                "Small team, large market, real moat if we become the default runtime. The math on equity at our stage works the way the math is supposed to work.",
              ],
            ].map(([t, b]) => (
              <div key={t}>
                <h3 className="font-display text-2xl leading-snug md:text-3xl">{t}</h3>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="talk" className="border-t border-border">
        <div className="mx-auto max-w-4xl px-6 py-28 text-center md:py-40">
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            If you are still reading
          </div>
          <h2 className="font-display mt-8 text-5xl leading-[1.05] tracking-tight md:text-7xl">
            Let's <span className="italic text-accent">talk</span>.
          </h2>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Write me directly. Not a recruiter, not a form. Send me one hard system
            you have built, one thing you would want to rewrite here, and your
            timeline. I read everything and I reply within 48 hours, even if the
            answer is no.
          </p>

          <div className="mx-auto mt-10 max-w-xl text-left">
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              What happens next
            </div>
            <ol className="mt-4 space-y-3 text-base leading-relaxed text-muted-foreground">
              <li>
                <span className="font-mono text-xs text-accent">01</span>{" "}
                <span className="text-foreground">Intro call</span> — 30 minutes, no prep. We talk about what you care about and what we are actually building.
              </li>
              <li>
                <span className="font-mono text-xs text-accent">02</span>{" "}
                <span className="text-foreground">Deep technical session</span> — You walk us through a system you have built. We walk you through the engine.
              </li>
              <li>
                <span className="font-mono text-xs text-accent">03</span>{" "}
                <span className="text-foreground">References / work sample</span> — A quick check, then a decision. We move fast. Two weeks from first email to yes or no.
              </li>
            </ol>
          </div>

          <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="mailto:founder@axal.vc?subject=Co-founder"
              className="group inline-flex items-center gap-3 rounded-full bg-foreground px-8 py-4 text-background transition hover:bg-accent"
            >
              <span className="font-medium">founder@axal.vc</span>
              <span className="font-mono text-sm transition group-hover:translate-x-1">→</span>
            </a>
            <a
              href="https://cal.com"
              className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Or book 30 minutes
            </a>
          </div>

          <div className="mt-16 font-display text-xl italic text-foreground">
            — Mara
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Founder, Axal
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            Axal Labs, Inc. · 2026
          </div>
          <div>This page is for one person at a time.</div>
        </div>
      </footer>
    </main>
  );
}
