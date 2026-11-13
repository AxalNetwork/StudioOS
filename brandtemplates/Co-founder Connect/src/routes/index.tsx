import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Looking for a technical co-founder" },
      {
        name: "description",
        content:
          "Axal is an early-stage company building the execution layer for autonomous agents. We're looking for one person to build it with.",
      },
      { property: "og:title", content: "Axal — Looking for a technical co-founder" },
      {
        property: "og:description",
        content:
          "An honest letter from the founder. What's built, what's missing, and the role we need to fill.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <Mission />
      <WhyNow />
      <Built />
      <Missing />
      <Role />
      <WhyJoin />
      <CTA />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b hairline bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-ink" />
          <span className="font-serif text-lg leading-none">Axal</span>
        </a>
        <div className="flex items-center gap-6 text-sm">
          <a href="#built" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            What's built
          </a>
          <a href="#role" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            The role
          </a>
          <a
            href="#talk"
            className="rounded-full border hairline px-3.5 py-1.5 text-foreground hover:bg-accent"
          >
            Talk about joining
          </a>
        </div>
      </div>
    </header>
  );
}

function Section({
  id,
  eyebrow,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`border-b hairline ${className}`}>
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        {eyebrow && (
          <div className="mb-10 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-px w-8 bg-hairline" />
            {eyebrow}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b hairline">
      <div className="absolute inset-0 grain opacity-60" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-6 pb-20 pt-24 md:pt-32">
        <div className="mb-10 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <span className="inline-flex h-2 w-2 rounded-full bg-signal" />
          A letter from the founder · June 2026
        </div>
        <h1 className="max-w-4xl font-serif text-5xl leading-[1.02] tracking-tight md:text-7xl">
          I'm looking for one person to build{" "}
          <span className="italic">Axal</span> with me.
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-foreground md:text-xl">
          Axal is a runtime that makes autonomous agents accountable for their actions
          by logging, attributing, and allowing rollback of every operation they take.
        </p>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
          Not a hire. Not a contractor. A co-founder. Someone who wants their name on
          the thing, and is willing to be wrong with me in public for the next ten years.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#talk"
            className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-background transition hover:opacity-90"
          >
            Talk about joining
            <span aria-hidden>→</span>
          </a>
          <a
            href="#mission"
            className="inline-flex items-center gap-2 rounded-full border hairline px-5 py-3 text-sm text-foreground hover:bg-accent"
          >
            Read the whole thing first
          </a>
        </div>
        <dl className="mt-16 grid grid-cols-2 gap-x-8 gap-y-6 border-t hairline pt-8 md:grid-cols-4">
          {[
            ["Stage", "Pre-seed, funded"],
            ["Team", "1 (me)"],
            ["Runway", "18 months"],
            ["Equity", "Co-founder, real"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{k}</dt>
              <dd className="mt-2 font-serif text-xl">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Mission() {
  return (
    <Section id="mission" eyebrow="The mission">
      <div className="grid gap-12 md:grid-cols-12">
        <h2 className="font-serif text-3xl leading-tight md:col-span-5 md:text-4xl">
          Make autonomous software accountable for the work it does.
        </h2>
        <div className="space-y-5 text-lg leading-relaxed text-muted-foreground md:col-span-7">
          <p>
            Agents can already write code, move money, and talk to customers.
          </p>
          <p>
            What they cannot do is be <span className="text-foreground">held to it</span>.
            There is no shared substrate for what an agent promised, what it actually
            did, and who is responsible when the two disagree.
          </p>
          <p>
            Axal is building that substrate: a runtime where every agent action is
            committed, attributable, and reversible — the way a database is for data.
          </p>
        </div>
      </div>
    </Section>
  );
}

function WhyNow() {
  const points = [
    {
      k: "01",
      h: "Agents shipped before guardrails did.",
      p: "The frontier labs solved capability. Nobody solved accountability. Every team deploying agents is bolting together logs, eval suites, and rollback scripts by hand.",
    },
    {
      k: "02",
      h: "Regulation is 12 months out, not 36.",
      p: "EU AI Act enforcement, U.S. liability frameworks, and SOC2-for-agents are all landing inside our build window. Teams will buy the thing that already speaks that language.",
    },
    {
      k: "03",
      h: "The buyers know they have the problem.",
      p: "We've had 31 unsolicited intro calls with platform teams at Series B–D companies. They are not asking us to convince them. They are asking when.",
    },
  ];
  return (
    <Section eyebrow="Why now">
      <h2 className="mb-12 max-w-3xl font-serif text-3xl leading-tight md:text-4xl">
        There is a roughly two-year window where this can become infrastructure.
        After that it becomes a feature inside something else.
      </h2>
      <ol className="grid gap-px overflow-hidden rounded-lg border hairline bg-hairline md:grid-cols-3">
        {points.map((p) => (
          <li key={p.k} className="bg-background p-7">
            <div className="font-mono text-xs text-muted-foreground">{p.k}</div>
            <h3 className="mt-4 font-serif text-xl leading-snug">{p.h}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.p}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Built() {
  const rows: [string, string, string][] = [
    ["Runtime core", "Action commit log with replay. ~14k LOC, Rust.", "Working"],
    ["Policy DSL", "Declarative rules for what agents can do, with diffing.", "Working"],
    ["3 design partners", "Mid-stage fintech, infra co, and an AI-native CRM.", "Paid pilots"],
    ["$1.6M pre-seed", "Led by a fund I trust. Clean cap table, 22% option pool.", "Closed"],
    ["Public benchmark", "Open eval for agent reliability. 400 GitHub stars.", "Live"],
  ];
  return (
    <Section id="built" eyebrow="What I've already built">
      <div className="grid gap-12 md:grid-cols-12">
        <div className="md:col-span-4">
          <h2 className="font-serif text-3xl leading-tight md:text-4xl">
            You are not joining an idea.
          </h2>
          <p className="mt-5 text-muted-foreground">
            Eleven months of work, on the record. Everything below is shippable today
            and has at least one paying user.
          </p>
        </div>
        <div className="md:col-span-8">
          <ul className="divide-y hairline border-y hairline">
            {rows.map(([h, p, s]) => (
              <li key={h} className="grid grid-cols-12 gap-4 py-5">
                <div className="col-span-12 sm:col-span-4">
                  <div className="font-serif text-lg">{h}</div>
                </div>
                <p className="col-span-12 text-sm leading-relaxed text-muted-foreground sm:col-span-6">
                  {p}
                </p>
                <div className="col-span-12 sm:col-span-2 sm:text-right">
                  <span className="inline-block rounded-full border hairline px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground">
                    {s}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Missing() {
  const gaps = [
    {
      h: "A product mind I can argue with.",
      p: "I've been making every product call alone for eleven months. Some of them are wrong. I don't know which ones yet, and that's the problem.",
    },
    {
      h: "Distribution that isn't me on Twitter.",
      p: "Design partners came inbound. That doesn't scale. We have no real go-to-market motion, no content engine, no rep on the team who has sold infra to platform teams before.",
    },
    {
      h: "An engineering partner for the parts I'm slowest at.",
      p: "The runtime is mine. The SDK, the dashboard, the integration surface — I am the bottleneck on all of them, and it shows in pilot feedback.",
    },
    {
      h: "Someone whose judgment I trust at 2am.",
      p: "Hard calls are coming. Pricing, hiring, when to raise the A, whether to kill the open-source benchmark. I want a second signature on those, not a Slack poll.",
    },
  ];
  return (
    <Section eyebrow="What is missing" className="bg-secondary/40">
      <h2 className="mb-3 max-w-3xl font-serif text-3xl leading-tight md:text-4xl">
        Here is the gap, said plainly.
      </h2>
      <p className="mb-12 max-w-2xl text-muted-foreground">
        I'd rather you see the shape of the hole than a polished pitch. If any of these
        sound like the thing you've been waiting to do, keep reading.
      </p>
      <div className="grid gap-px overflow-hidden rounded-lg border hairline bg-hairline md:grid-cols-2">
        {gaps.map((g, i) => (
          <div key={g.h} className="bg-background p-7">
            <div className="font-mono text-xs text-muted-foreground">
              GAP / {String(i + 1).padStart(2, "0")}
            </div>
            <h3 className="mt-4 font-serif text-2xl leading-snug">
              <span className="marker">{g.h}</span>
            </h3>
            <p className="mt-4 leading-relaxed text-muted-foreground">{g.p}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Role() {
  return (
    <Section id="role" eyebrow="The role">
      <div className="grid gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <h2 className="font-serif text-3xl leading-tight md:text-4xl">
            Co-founder, product &amp; engineering.
          </h2>
          <p className="mt-5 text-muted-foreground">
            One title, two halves. You own everything customer-facing and you own enough
            of the codebase that we ship in parallel, not in series.
          </p>
          <div className="mt-8 space-y-2 border-t hairline pt-6 text-sm">
            <Row k="Equity" v="15–25%, four-year vest from day one" />
            <Row k="Salary" v="$120–160k now; market at Series A" />
            <Row k="Location" v="NYC (in-person 3+ days). Relocation + US visa support available." />
            <Row k="Start" v="Within 60 days of saying yes" />
          </div>
        </div>
        <div className="md:col-span-7">
          <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            In your first 90 days
          </h3>
          <ul className="mt-4 space-y-4">
            {[
              "Own the SDK end-to-end. Cut time-to-first-trace from ~45 minutes to under 10, in TypeScript and Python.",
              "Ship v1 of the dashboard: live action log, replay view, and a one-click rollback that design partners actually use in incidents.",
              "Sit in on every design-partner call. Re-write the onboarding doc after the third one — you'll know what's broken.",
              "Make one product call I disagree with, and ship it.",
              "Decide with me whether the open benchmark stays a side-project or becomes the wedge.",
            ].map((t, i) => (
              <li key={i} className="flex gap-4">
                <span className="mt-2 inline-block h-px w-6 shrink-0 bg-ink" />
                <span className="leading-relaxed">{t}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-12 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            What I think you look like
          </h3>
          <ul className="mt-4 space-y-3 text-muted-foreground">
            <li>— You've built and shipped something people use. It doesn't have to have worked.</li>
            <li>— You can hold a strong opinion and drop it in the same hour.</li>
            <li>— You're closer to "founder who can code" than "engineer who wants to found."</li>
            <li>— You've sat across from customers before. You liked it more than you expected to.</li>
          </ul>

          <h3 className="mt-12 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            What I am not looking for
          </h3>
          <ul className="mt-4 space-y-3 text-muted-foreground">
            <li>— A CTO title in exchange for a résumé.</li>
            <li>— Someone who needs the problem to be already de-risked.</li>
            <li>— A second me. I have enough of that.</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b hairline py-2 last:border-0">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function WhyJoin() {
  return (
    <Section eyebrow="Why join">
      <div className="grid gap-12 md:grid-cols-12">
        <h2 className="font-serif text-3xl leading-tight md:col-span-5 md:text-4xl">
          The version of this where it works is very large, and very few people get to
          be early to it.
        </h2>
        <div className="space-y-6 text-lg leading-relaxed text-muted-foreground md:col-span-7">
          <p>
            I'm not going to oversell it. Most companies fail and this one might too.
            What I can promise is that you'll be in every room, your name will be on
            the company from day one, and the work will be unambiguously yours.
          </p>
          <p>
            The bet — and it is a bet — is that the runtime for accountable agents
            becomes one of the three or four pieces of infrastructure the next decade
            is built on. We are nowhere near proving that yet.
          </p>
          <p>
            If we're wrong, you'll have spent two to four years building hard systems
            with a small team that told you the truth. That is a fair trade either way.
          </p>
          <p className="text-foreground">
            I would rather wait six months for the right person than start next week
            with the wrong one.
          </p>
        </div>
      </div>
    </Section>
  );
}

function CTA() {
  return (
    <section id="talk" className="border-b hairline bg-ink text-background">
      <div className="mx-auto max-w-5xl px-6 py-24 md:py-32">
        <div className="mb-10 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-background/60">
          <span className="h-px w-8 bg-background/30" />
          Talk about joining
        </div>
        <h2 className="max-w-3xl font-serif text-4xl leading-[1.05] md:text-6xl">
          Write to me. Tell me what you've built and what you'd want this to look like
          a year in.
        </h2>
        <p className="mt-8 max-w-2xl text-background/70">
          No CV needed. A few paragraphs is better. I read every message and reply
          within 72 hours, even if it's a no.
        </p>
        <div className="mt-10 max-w-2xl border-t border-background/20 pt-8">
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-background/50">
            What happens next
          </div>
          <ol className="mt-4 space-y-2 text-background/80">
            <li><span className="font-mono text-background/50">01 ·</span> 30-min intro call. Mostly me listening.</li>
            <li><span className="font-mono text-background/50">02 ·</span> Half-day working session in NYC (or remote): we whiteboard the SDK redesign together.</li>
            <li><span className="font-mono text-background/50">03 ·</span> Mutual references, a small paid work sample, and a decision within two weeks.</li>
          </ol>
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="mailto:founder@axal.co?subject=Co-founder"
            className="inline-flex items-center gap-2 rounded-full bg-background px-5 py-3 text-sm font-medium text-ink hover:opacity-90"
          >
            founder@axal.co
            <span aria-hidden>→</span>
          </a>
          <a
            href="https://cal.com/"
            className="inline-flex items-center gap-2 rounded-full border border-background/30 px-5 py-3 text-sm text-background hover:bg-background/10"
          >
            Or book 30 minutes
          </a>
        </div>
        <p className="mt-12 font-serif text-lg italic text-background/70">
          — Maya, founder
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-5xl px-6 py-10 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
          <span className="font-serif text-sm text-foreground">Axal</span>
          <span>· New York</span>
        </div>
        <div className="font-mono uppercase tracking-wider">
          This page is the entire pitch. There is no deck.
        </div>
      </div>
    </footer>
  );
}
