import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Co-Founder Opportunity" },
      { name: "description", content: "We're building something ambitious. We need a co-founder who wants to own the outcome." },
      { property: "og:title", content: "Axal — Co-Founder Opportunity" },
      { property: "og:description", content: "We're building something ambitious. We need a co-founder who wants to own the outcome." },
    ],
  }),
  component: Index,
});

function Index() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6 md:px-8">
        <div className="text-lg font-semibold tracking-tight text-foreground">
          Axal
        </div>
        <a
          href="#role"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          The role
        </a>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-12 md:px-8 md:pb-28 md:pt-20">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            Co-founder search
          </p>
          <h1 className="mt-6 font-serif text-4xl leading-[1.15] font-medium tracking-tight text-foreground md:text-6xl lg:text-7xl">
            We are building the runtime that makes AI agents reliable enough to run real operations work.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Axal is an orchestration layer that lets ops and revenue teams run
            multi-step agent workflows on top of their existing CRM, data
            warehouse, and internal tools. We need a technical co-founder to
            own the product surface end-to-end.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href="#role"
              className="inline-flex items-center rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Read the full brief
            </a>
            <a
              href="#contact"
              className="inline-flex items-center rounded-md border border-border bg-background px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Talk about the role
            </a>
          </div>
        </div>
      </section>

      {/* Why this matters now */}
      <section className="mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-24">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-accent">
              Timing
            </p>
            <h2 className="mt-4 font-serif text-3xl leading-tight font-medium tracking-tight text-foreground md:text-4xl">
              Why this matters now
            </h2>
          </div>
          <div className="space-y-5">
            <p className="text-base leading-relaxed text-muted-foreground">
              The models are good enough. What is still broken is the layer
              between "smart model" and "system an ops lead trusts to touch
              production data." That gap is the opportunity.
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              We have a shipped product, paying customers, and a clear sense of
              what the next 12 months need to look like. The window is open. We
              need someone to run through it with us.
            </p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <div className="h-px bg-border" />
      </div>

      {/* What we have built */}
      <section className="mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-24">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-accent">
              Progress
            </p>
            <h2 className="mt-4 font-serif text-3xl leading-tight font-medium tracking-tight text-foreground md:text-4xl">
              What we have built
            </h2>
          </div>
          <div className="space-y-6">
            {[
              {
                label: "Product",
                text: "Agent orchestration runtime in production. Workflow builder, eval harness, and connectors to Salesforce, Snowflake, and Slack. Used daily inside customer accounts.",
              },
              {
                label: "Traction",
                text: "6 paying pilots with mid-market ops and RevOps teams over the last 4 months. One customer expanded from 2 to 12 analyst seats (one seat = one operator running workflows) in 60 days. No churn yet.",
              },
              {
                label: "Team",
                text: "Two founders: one technical (systems, infra), one GTM (enterprise sales, pricing).",
              },
              {
                label: "Runway",
                text: "18 months at current burn on a pre-seed round. Revenue covers ~30% of burn. We do not need the next round to survive.",
              },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-sm font-semibold text-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-base leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <div className="h-px bg-border" />
      </div>

      {/* What is missing — prominent */}
      <section id="role" className="mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-24">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          The gap
        </p>
        <h2 className="mt-4 max-w-2xl font-serif text-3xl leading-tight font-medium tracking-tight text-foreground md:text-4xl lg:text-5xl">
          What we need
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          The honest part. We are strong on infra and GTM. We need someone who
          owns product end-to-end: what we build, how it feels, and how fast it
          improves.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Product architecture",
              desc: "Own the workflow model, the eval loop, and how agent outputs become trusted writes back to customer systems.",
            },
            {
              title: "Technical leadership",
              desc: "Make tradeoffs in hours, not weeks. Ship to production weekly. Hire the first 2–3 engineers when we raise.",
            },
            {
              title: "Founder energy",
              desc: "Not a CTO hire at a funded startup. A co-founder in the room every day, on customer calls, in the codebase.",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-border bg-card p-6 transition-shadow hover:shadow-sm"
            >
              <h3 className="font-serif text-lg font-medium text-card-foreground">
                {card.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {card.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-lg border border-accent/20 bg-accent/5 p-6 md:p-8">
          <h3 className="font-serif text-xl font-medium text-foreground">
            The ideal profile
          </h3>
          <ul className="mt-4 space-y-3">
            {[
              "You have shipped a 0→1 product to paying customers before, ideally at a seed/Series A startup.",
              "You can write production TypeScript or Python, design distributed systems, and argue strategy in the same afternoon.",
              "You care about reliability and evals more than the latest model release.",
              "You live in SF or will relocate within 60 days. We work in person 5 days a week. Relocation support yes; visa sponsorship case by case.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-card p-6 md:p-8">
          <h3 className="font-serif text-xl font-medium text-card-foreground">
            Your first 90 days
          </h3>
          <ul className="mt-4 space-y-3">
            {[
              "Weeks 1–4: ship alongside us on a live customer workflow. Get your name on a production deploy in week one.",
              "Weeks 5–8: own the eval and reliability stack end-to-end. Define what 'good' means for agent output and instrument it.",
              "Weeks 9–12: lead the architecture for our next product surface (workflow authoring) and co-write the seed deck and technical narrative.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <div className="h-px bg-border" />
      </div>

      {/* Why join now */}
      <section className="mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-24">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-accent">
              Conviction
            </p>
            <h2 className="mt-4 font-serif text-3xl leading-tight font-medium tracking-tight text-foreground md:text-4xl">
              Why join now
            </h2>
          </div>
          <div className="space-y-5">
            <p className="text-base leading-relaxed text-muted-foreground">
              Because the next 12 months will define the product, the culture,
              and the trajectory. Joining later means inheriting choices. Joining
              now means making them.
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              We have de-risked the market. We have not de-risked the execution.
              That is exactly where a co-founder thrives.
            </p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <div className="h-px bg-border" />
      </div>

      {/* Equity / collaboration philosophy */}
      <section className="mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-24">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-accent">
              How we work
            </p>
            <h2 className="mt-4 font-serif text-3xl leading-tight font-medium tracking-tight text-foreground md:text-4xl">
              Equity and collaboration
            </h2>
          </div>
          <div className="space-y-6">
            <p className="text-base leading-relaxed text-muted-foreground">
              No cofounder tiers. Open conversation about numbers from the
              first call — no games, no "we'll figure it out later."
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              In person in SF, five days a week. We argue well, ship fast,
              and do not waste each other's time.
            </p>
            <div className="rounded-lg border border-border bg-secondary/50 p-5 space-y-2">
              <p className="text-sm font-medium text-foreground">
                Equity: 15–22% of common, depending on timing and scope.
              </p>
              <p className="text-sm text-muted-foreground">
                Vesting: 4 years, 1-year cliff, standard double-trigger acceleration.
              </p>
              <p className="text-sm text-muted-foreground">
                Cash: $140–180k base today, stepping to market rate at seed
                ($180–220k) and again at Series A. You set comp for your
                hires inside an agreed envelope.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <div className="h-px bg-border" />
      </div>

      {/* Team story */}
      <section className="mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-24">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-accent">
              Who we are
            </p>
            <h2 className="mt-4 font-serif text-3xl leading-tight font-medium tracking-tight text-foreground md:text-4xl">
              The team so far
            </h2>
          </div>
          <div className="space-y-6">
            <div>
              <p className="text-base font-medium text-foreground">Alex — CEO</p>
              <p className="mt-1 text-base leading-relaxed text-muted-foreground">
                Previously led platform engineering at a growth-stage AI
                company. Deep systems thinker. Has shipped products used by
                millions. Obsessed with reliability.
              </p>
            </div>
            <div>
              <p className="text-base font-medium text-foreground">
                Jordan — GTM / Operations
              </p>
              <p className="mt-1 text-base leading-relaxed text-muted-foreground">
                Built and closed enterprise deals at two previous startups,
                one exit. Knows the buyer. Knows the pain. Knows how to price
                and position.
              </p>
            </div>
            <p className="text-base leading-relaxed text-muted-foreground">
              We met working on a failed project in 2021. We trust each other
              because we have seen each other under pressure. We are looking for
              someone who operates the same way.
            </p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <div className="h-px bg-border" />
      </div>

      {/* CTA */}
      <section id="contact" className="mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            Next step
          </p>
          <h2 className="mt-4 font-serif text-3xl leading-tight font-medium tracking-tight text-foreground md:text-4xl">
            Join the build
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            If this resonates, send us a note. No résumé required. Tell us what
            you have built, what you want to build next, and why Axal.
          </p>

          <div className="mt-8 rounded-lg border border-border bg-secondary/50 p-5">
            <p className="text-sm font-medium text-foreground">What happens next</p>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>1. 30-min intro call with both founders within a week.</li>
              <li>2. A 3–4 hour working session on a real problem from our backlog.</li>
              <li>3. References both ways, plus a paid 1–2 week trial if useful.</li>
              <li>4. Decision within roughly two weeks of the first call.</li>
            </ol>
          </div>

          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="mt-6 inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Talk about the role
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                alert("Thanks for your interest! This is a demo form.");
              }}
              className="mt-8 space-y-4"
            >
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-foreground">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-foreground">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="note" className="block text-sm font-medium text-foreground">
                  Tell us about yourself
                </label>
                <textarea
                  id="note"
                  rows={4}
                  required
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="What have you built? What do you want to build next? Why Axal?"
                />
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Send message
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="inline-flex items-center rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-4xl px-6 py-12 md:px-8">
        <div className="h-px bg-border" />
        <div className="mt-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            Axal, Inc. — 2026
          </p>
          <p className="text-sm text-muted-foreground">
            Built with conviction.
          </p>
        </div>
      </footer>
    </div>
  );
}
