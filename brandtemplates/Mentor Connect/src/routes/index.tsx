import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — A short note for a mentor" },
      { name: "description", content: "A concise overview of what we're building, where we need guidance, and why your perspective would matter." },
      { property: "og:title", content: "Axal — A short note for a mentor" },
      { property: "og:description", content: "What we're building, where we need help, and the specific guidance we're asking for." },
    ],
  }),
  component: Index,
});

const sections = [
  { id: "building", label: "What we're building" },
  { id: "help", label: "Where we need help" },
  { id: "experience", label: "Experience that matters" },
  { id: "progress", label: "Progress so far" },
  { id: "why-you", label: "Why you" },
  { id: "cta", label: "Offer guidance" },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          <span className="text-sm font-medium tracking-tight">Axal</span>
          <span className="text-sm text-muted-foreground">· a note for a mentor</span>
        </div>
        <a
          href="#cta"
          className="hidden text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline"
        >
          Skip to the ask
        </a>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-16">
        {/* Hero */}
        <section className="border-b border-border pb-14">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-accent">
            A short note · 3 min read
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            We'd value 30 minutes of your perspective.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            We're the founders of Axal. Below is a quick overview of what
            we're building, the two questions we're stuck on, and why your
            experience would help us think more clearly.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            No pitch, no follow-up loop. Just one conversation, on your time.
          </p>

          <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </section>

        {/* What we're building */}
        <Section id="building" eyebrow="01" title="What we're building">
          <p>
            Axal is a verification layer for AI agents acting on a user's
            behalf — payments, scheduling, account changes. We sit between
            the agent and the destination system, confirm intent, and produce
            a signed receipt.
          </p>
          <p>
            One line: <span className="text-foreground">a trust rail for
            agent-initiated transactions</span>.
          </p>
        </Section>

        {/* Where we need help */}
        <Section id="help" eyebrow="02" title="Where we need help">
          <p>Two questions grounded in what we're seeing right now:</p>
          <ol className="mt-4 space-y-4 border-l border-border pl-5">
            <li>
              <p className="text-foreground">
                1. How do enterprise security teams actually evaluate a new
                authorization vendor?
              </p>
              <p className="mt-1 text-sm">
                CISOs ask for proof-of-intent signing, then procurement says
                "Q3." We're trying to learn whether the real gate is technical,
                legal, or just who gets fired if this breaks. The tradeoff: slow
                down for a full enterprise cycle, or find a design partner willing
                to run a 30-day pilot without a procurement committee.
              </p>
            </li>
            <li>
              <p className="text-foreground">
                2. Is the right first wedge consumer fintech, or internal
                enterprise agents?
              </p>
              <p className="mt-1 text-sm">
                Consumer fintech teams want user-verified payments. Enterprise IT
                teams want audit trails for internal agents. Both are real. The
                tradeoff: fintech moves faster but compliance is stricter;
                enterprise pays more but sales cycles are 6–12 months. We're
                trying to figure out which path teaches us more in the next 90 days.
              </p>
            </li>
          </ol>
        </Section>

        {/* Experience that matters */}
        <Section id="experience" eyebrow="03" title="What kind of experience matters">
          <ul className="space-y-2">
            <li className="flex gap-3">
              <Dot /> Sold infra or security into the F500.
            </li>
            <li className="flex gap-3">
              <Dot /> Built a developer API that became a standard.
            </li>
            <li className="flex gap-3">
              <Dot /> Worked in payments, identity, or trust &amp; safety.
            </li>
            <li className="flex gap-3">
              <Dot /> Picked a wedge wrong once and remembers why.
            </li>
          </ul>
          <p className="mt-4 text-sm">
            You don't need all four. One is plenty.
          </p>
        </Section>

        {/* Progress so far */}
        <Section id="progress" eyebrow="04" title="Progress so far">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
            <Stat k="Team" v="3 founders, ex-Stripe and ex-Anthropic" />
            <Stat k="Product" v="Private beta, 4 design partners" />
            <Stat k="Traction" v="$0 ARR, ~12k verified intents / wk" />
            <Stat k="Funding" v="Pre-seed closed, building toward seed" />
            <Stat k="Built" v="SDK + dashboard + audit log" />
            <Stat k="Next" v="Pricing model & first paid contract" />
          </dl>
        </Section>

        {/* Why this mentor */}
        <Section id="why-you" eyebrow="05" title="Why you">
          <p>
            We've followed your work on{" "}
            <span className="text-foreground">{"{{MENTOR_PROJECT}}"}</span>{" "}
            at{" "}
            <span className="text-foreground">{"{{MENTOR_COMPANY}}"}</span>, and the
            way you framed{" "}
            <span className="text-foreground">{"{{MENTOR_DECISION_EXAMPLE}}"}</span>{" "}
            changed how we think about{" "}
            <span className="text-foreground">{"{{HOW_IT_SHAPED_US}}"}</span>.
          </p>
          <p>
            Our hope is a single 30-minute call. If it's useful on both sides,
            we'd love to send a short update once a quarter — opt-in, never a
            calendar push.
          </p>
        </Section>

        {/* CTA */}
        <section
          id="cta"
          className="mt-20 rounded-2xl border border-border bg-card p-8 shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            The ask
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Offer 30 minutes of guidance.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Pick whatever's easiest. We'll send a short pre-read 24 hours ahead,
            keep the call confidential, and follow up with a brief summary if
            you'd like.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href="mailto:founders@axal.vc?subject=Happy%20to%20offer%2030%20minutes"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Email us
            </a>
            <a
              href="https://cal.com/axal/mentor"
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Book a 30-min slot
            </a>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            When you email, feel free to flag preferred times and the topic you're
            most comfortable with. A founder will reply within 48 hours.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            If now isn't the right time, a one-line "not this quarter" is a
            complete reply. Truly — thank you for reading this far.
          </p>
        </section>

        <footer className="mt-16 flex items-center justify-between text-xs text-muted-foreground">
          <span>Axal · 2026</span>
          <a href="#" className="hover:text-foreground">Back to top ↑</a>
        </footer>
      </main>
    </div>
  );
}

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
    <section id={id} className="border-b border-border py-12">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="font-mono text-xs text-accent">{eyebrow}</span>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      <div className="space-y-3 leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className="mt-1 text-sm text-foreground">{v}</dd>
    </div>
  );
}

function Dot() {
  return (
    <span
      className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
      aria-hidden
    />
  );
}
