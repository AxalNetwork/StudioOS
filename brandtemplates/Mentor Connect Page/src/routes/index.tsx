import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Section({
  label,
  title,
  children,
  id,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-rule">
      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6 px-6 py-12 md:grid-cols-[140px_1fr] md:gap-10 md:py-16">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground md:pt-1.5">
          {label}
        </div>
        <div>
          <h2 className="text-2xl text-ink md:text-[28px]">{title}</h2>
          <div className="mt-4 space-y-4 text-[16px] leading-[1.7] text-ink-soft text-pretty">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pt-8">
        <a href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-sm bg-ink text-background font-mono text-[12px]">A</span>
          <span className="font-serif text-lg text-ink">Axal</span>
        </a>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          A note for mentors
        </span>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-14 pt-16 md:pb-20 md:pt-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          For — Mentor · Private link
        </p>
        <h1 className="mt-6 font-serif text-[42px] leading-[1.08] text-ink text-balance md:text-[56px]">
          Thank you for reading this.
          <span className="block italic text-ink-soft">
            We could use your perspective.
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-[17px] leading-[1.65] text-ink-soft text-pretty">
          We're a small team building Axal. This page is a short, honest summary of
          what we're working on, where we're stuck, and where a few minutes of your
          time could go a long way. No pitch — just context.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="#cta"
            className="inline-flex items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-background transition hover:bg-ink/90"
          >
            Offer guidance
          </a>
          <a
            href="#cta"
            className="inline-flex items-center justify-center rounded-md border border-rule px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-muted"
          >
            Schedule a short call →
          </a>
          <span className="font-mono text-[11px] text-muted-foreground">
            ~3 min read
          </span>
        </div>
      </section>

      <Section label="01 — Building" title="What we're building">
        <p>
          Axal turns messy, recurring decisions into simple, trustworthy workflows
          for small ops teams. Instead of a Slack thread and a spreadsheet to
          approve a vendor change, a team sets up a lightweight Axal workflow in
          minutes and gets a clear audit trail.
        </p>
      </Section>

      <Section label="02 — Stuck" title="Where we're stuck">
        <ul className="space-y-3">
          <li className="flex gap-3">
            <span className="font-mono text-[11px] pt-1.5 text-accent">→</span>
            <span>
              Pricing. Pilots love the product, but we can't tell if a seat-based
              or usage-based plan would actually convert. No one has paid yet — all
              feedback is hypothetical.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-[11px] pt-1.5 text-accent">→</span>
            <span>
              Positioning. "Workflow engine" gets nods from engineers; "decision
              tool" resonates with ops leads. Both feel half-right, and we need to
              pick one before rewriting the site.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-[11px] pt-1.5 text-accent">→</span>
            <span>
              First-ten-customers playbook. Warm intros and a small campaign show
              decent conversion but low volume. We're unsure whether to double down
              or test a new channel.
            </span>
          </li>
        </ul>
      </Section>

      <Section label="03 — You" title="Why your perspective matters">
        <p>
          You built {'{{MENTOR_PRODUCT}}'} and made the call we're wrestling with now —{" "}
          {'{{MENTOR_DECISION}}'}. {'{{HOW_IT_INSPIRED_US}}'}
        </p>
        <p>
          We're not looking for validation. We'd rather hear what you'd push back
          on, and what you'd do differently in our position.
        </p>
      </Section>

      <Section label="04 — Ask" title="What help would be most useful">
        <div className="rounded-md border border-rule bg-card p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Pick whichever is easiest
          </p>
          <ul className="mt-4 space-y-3">
            <li>
              <span className="text-ink">A.</span> A 20-minute call where we walk
              through the two open questions above.
            </li>
            <li>
              <span className="text-ink">B.</span> A short written reaction — even
              one paragraph on pricing or positioning would help.
            </li>
            <li>
              <span className="text-ink">C.</span> One intro to a founder or
              operator who's solved a similar problem.
            </li>
          </ul>
        </div>
        <p className="text-sm">
          Any one of these is more than enough. No prep needed on your side.
        </p>
      </Section>

      <Section label="05 — Context" title="Background and progress">
        <ul className="space-y-3">
          <li className="flex gap-4">
            <span className="font-mono text-[11px] w-16 shrink-0 pt-1.5 text-muted-foreground">2024 Q3</span>
            <span>Started building with two design partners.</span>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[11px] w-16 shrink-0 pt-1.5 text-muted-foreground">2024 Q4</span>
            <span>First paid pilots. Three signed LOIs.</span>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[11px] w-16 shrink-0 pt-1.5 text-muted-foreground">2025 Q1</span>
            <span>Rewrote the core flow after week-three data showed we were wrong.</span>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[11px] w-16 shrink-0 pt-1.5 text-muted-foreground">Now</span>
            <span>
              {'{{TEAMS_COUNT}}'} teams active, ~{'{{WEEKLY_VOLUME}}'} workflows weekly. Two engineers, one designer, mostly self-funded. (As of {'{{AS_OF_DATE}}'})
            </span>
          </li>
        </ul>
      </Section>

      <section id="cta" className="border-t border-rule">
        <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
            06 — Next
          </p>
          <h2 className="mt-4 font-serif text-[36px] leading-[1.1] text-ink text-balance md:text-[44px]">
            If you have a few minutes, we'd be grateful.
          </h2>
          <p className="mt-5 max-w-xl text-[16px] leading-[1.65] text-ink-soft">
            If you say yes, we'll send a 1-page brief with our two open questions,
            keep the call to 20 minutes, and send a short summary back if you'd like.
            No prep needed.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="mailto:hello@axal.example?subject=Guidance%20for%20Axal"
              className="inline-flex items-center justify-center rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              Offer guidance
            </a>
            <a
              href="https://cal.com/axal"
              className="inline-flex items-center justify-center rounded-md border border-ink px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-ink hover:text-background"
            >
              Schedule a short call →
            </a>
          </div>

          <p className="mt-10 font-serif italic text-ink-soft">
            Thank you, truly. — The Axal team
          </p>
        </div>
      </section>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Axal · 2026</span>
          <span>Private link — please don't share</span>
        </div>
      </footer>
    </main>
  );
}
