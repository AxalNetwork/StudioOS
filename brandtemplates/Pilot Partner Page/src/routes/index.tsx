import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal VC — Apply for a Pilot" },
      {
        name: "description",
        content:
          "A six-week pilot with Axal VC: one hypothesis, real customers, $50K on a SAFE. Rolling applications, small intake.",
      },
      { property: "og:title", content: "Axal VC — Apply for a Pilot" },
      {
        property: "og:description",
        content:
          "Six weeks, one hypothesis, $50K on a SAFE. For founders with a working product and a question worth answering.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PilotLanding,
});

// ─── Editable pilot details ────────────────────────────────────────────────
const PILOT = {
  brand: "Axal",
  brandSuffix: "VC",
  cohort: "Rolling intake · up to 6 teams per quarter",
  applyUrl: "#apply",
  applyWindow: "Next kickoff: rolling — we onboard within 2 weeks of a yes",
  hero: {
    eyebrow: "Pilot program — accepting applications",
    title: "Run a focused pilot with Axal.",
    subtitle:
      "Six weeks. One hypothesis. Real customers. We work with a small number of founders at a time to answer the single question that is currently in the way.",
  },
  what: {
    title: "What we are piloting",
    body:
      "A six-week engagement built to test one concrete product or go-to-market hypothesis with real customers. You bring the question. We bring structure, capital, and operators who have shipped the same problem.",
    points: [
      "One hypothesis, scoped together in week one.",
      "A measurable outcome agreed in writing up front.",
      "Weekly two-hour working sessions — not status updates.",
      "A written closing memo at week six, yours to keep or share.",
    ],
  },
  examples: {
    title: "What a pilot hypothesis looks like",
    intro:
      "These are illustrative. Yours should be this specific — a single question with a measurable answer in six weeks.",
    items: [
      "Can we sign 3 mid-market design partners at ≥$30K ACV by sourcing through procurement-led channels instead of bottoms-up?",
      "Does replacing our manual onboarding with an agentic flow lift week-1 activation from 28% to 45% without raising support load?",
      "Will lab directors pay a per-seat price for the inference tool, or does the buying center sit one level up with the CIO?",
    ],
  },
  who: {
    title: "Who it is for",
    items: [
      {
        kind: "Founders",
        body: "Pre-seed to Series A teams with a working product and at least one paying or active design-partner customer.",
      },
      {
        kind: "Operators",
        body: "Functional leads inside companies launching a new line of business or internal venture with real budget.",
      },
      {
        kind: "Technical teams",
        body: "Engineering-led teams shipping in infra, applied AI, fintech, or industrial software.",
      },
    ],
  },
  notFor: {
    title: "Who this is not for",
    items: [
      "Pre-product teams still deciding what to build.",
      "Founders looking for a brand, a logo, or a demo-day stage.",
      "Companies whose primary question is fundraising, not customers.",
      "Teams that cannot commit a founder to the weekly working session.",
    ],
  },
  includes: {
    title: "What the pilot includes",
    items: [
      { label: "01", title: "Scoping week", body: "We define the hypothesis, the metric, and the customer set together — in writing." },
      { label: "02", title: "$50K on a SAFE", body: "Wired on signing. Post-money, MFN, no board seat, no information rights, no side letters." },
      { label: "03", title: "Weekly working sessions", body: "Two hours, every week, with a partner and a relevant operator from our network." },
      { label: "04", title: "Customer introductions", body: "Warm intros into the design partners, buyers, and operators we already work with." },
      { label: "05", title: "Closing memo", body: "A written assessment at week six. Shared with you, and no one else unless you say so." },
      { label: "06", title: "Optional follow-on", body: "If the pilot clears the bar, we typically lead or co-lead the next round at $1.5–3M." },
    ],
  },
  safe: {
    title: "About the SAFE",
    points: [
      "$50K, post-money, MFN — you get the better of our terms or your next round's.",
      "No board seat, no observer, no information rights, no pro-rata side letter.",
      "Standard YC paperwork. Signed in days, not weeks. No lawyers required on your side.",
    ],
  },
  benefits: {
    title: "Why founders do this",
    items: [
      "Get to a real answer in six weeks instead of six months.",
      "Work alongside operators who have already solved the same problem.",
      "Keep full control — no governance, no reporting overhead.",
      "Leave with a written memo you can share with future investors.",
    ],
  },
  requirements: {
    title: "What we ask of you",
    items: [
      "A founder or co-founder present for every weekly session.",
      "A live product or working prototype customers can actually use.",
      "One specific question — narrow enough to answer in six weeks.",
      "Willingness to share weekly progress against the agreed metric.",
    ],
  },
  strong: {
    title: "What a strong application looks like",
    items: [
      "One question, written in a single sentence, with a number attached.",
      "Evidence you have already tried to answer it and where it got stuck.",
      "The customer or buyer you would test it against, named.",
      "What a clear yes and a clear no would each mean for the next six months.",
    ],
  },
  process: {
    title: "What happens after you apply",
    items: [
      { label: "Day 0", title: "You apply", body: "Five short questions. No deck. Most strong applications take twenty minutes." },
      { label: "Within 7 days", title: "We respond", body: "Every application gets a written reply — yes, no, or a question back." },
      { label: "Week 1–2", title: "30-minute call", body: "A working call with a partner to pressure-test the hypothesis together." },
      { label: "Week 2–3", title: "Decision & kickoff", body: "If it's a fit, we sign the SAFE, wire the capital, and start the scoping week." },
    ],
  },
  cta: {
    title: "Apply for the pilot.",
    body:
      "Five short questions. We read every application and reply within seven days.",
    button: "Apply for pilot",
    note: "No deck required.",
  },
} as const;
// ───────────────────────────────────────────────────────────────────────────

function PilotLanding() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        <Divider />
        <What />
        <Divider />
        <Examples />
        <Divider />
        <Who />
        <Divider />
        <NotFor />
        <Divider />
        <Includes />
        <Divider />
        <SAFENote />
        <Divider />
        <Benefits />
        <Divider />
        <Requirements />
        <Divider />
        <Strong />
        <Divider />
        <Process />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-5xl px-6 md:px-10 ${className}`}>{children}</div>;
}

function Divider() {
  return (
    <Container>
      <hr className="border-t border-border" />
    </Container>
  );
}

function Header() {
  return (
    <Container className="flex items-center justify-between py-6">
      <a href="/" className="flex items-baseline gap-1">
        <span className="font-serif text-2xl leading-none">{PILOT.brand}</span>
        <span className="label !text-foreground/70">{PILOT.brandSuffix}</span>
      </a>
      <div className="hidden md:block label">{PILOT.cohort}</div>
      <a
        href={PILOT.applyUrl}
        className="rounded-sm border border-foreground bg-foreground px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-background hover:text-foreground"
      >
        Apply
      </a>
    </Container>
  );
}

function Hero() {
  return (
    <Container className="grid gap-10 py-20 md:grid-cols-12 md:py-28">
      <div className="md:col-span-8">
        <p className="label">{PILOT.hero.eyebrow}</p>
        <h1 className="mt-6 text-4xl leading-[1.05] md:text-6xl">
          {PILOT.hero.title}
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">{PILOT.hero.subtitle}</p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href={PILOT.applyUrl}
            className="inline-flex items-center gap-2 rounded-sm bg-foreground px-5 py-3 text-sm font-medium text-background transition-transform hover:-translate-y-px"
          >
            {PILOT.cta.button}
            <span aria-hidden>→</span>
          </a>
          <span className="label">{PILOT.applyWindow}</span>
        </div>
      </div>
      <aside className="md:col-span-4 md:border-l md:border-border md:pl-8">
        <p className="label">At a glance</p>
        <dl className="mt-4 space-y-4 text-sm">
          <Stat k="Duration" v="6 weeks" />
          <Stat k="Capital" v="$50K SAFE" />
          <Stat k="Commitment" v="2 hrs / week" />
          <Stat k="Intake" v="≤6 teams / qtr" />
          <Stat k="Follow-on" v="$1.5–3M" />
        </dl>
      </aside>
    </Container>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-border pb-3 last:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono text-foreground">{v}</dd>
    </div>
  );
}

function Section({
  id,
  label,
  title,
  children,
}: {
  id?: string;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Container className="py-20 md:py-24">
      <div id={id} className="grid gap-10 md:grid-cols-12">
        <div className="md:col-span-4">
          <p className="label">{label}</p>
          <h2 className="mt-4 text-3xl md:text-4xl">{title}</h2>
        </div>
        <div className="md:col-span-8">{children}</div>
      </div>
    </Container>
  );
}

function What() {
  return (
    <Section label="01 — The pilot" title={PILOT.what.title}>
      <p className="text-lg leading-relaxed text-foreground/90">{PILOT.what.body}</p>
      <ul className="mt-8 space-y-3">
        {PILOT.what.points.map((p) => (
          <li key={p} className="flex gap-3 text-foreground/90">
            <span className="mt-2 inline-block h-px w-6 bg-accent" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Examples() {
  return (
    <Section label="02 — Examples" title={PILOT.examples.title}>
      <p className="text-foreground/80">{PILOT.examples.intro}</p>
      <ol className="mt-8 space-y-5">
        {PILOT.examples.items.map((h, i) => (
          <li key={h} className="flex gap-4 border-l-2 border-accent pl-4">
            <span className="font-mono text-xs text-muted-foreground">H{i + 1}</span>
            <span className="text-foreground/90">{h}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Who() {
  return (
    <Section label="03 — Fit" title={PILOT.who.title}>
      <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-3">
        {PILOT.who.items.map((i) => (
          <div key={i.kind} className="bg-background p-6">
            <p className="label">{i.kind}</p>
            <p className="mt-3 text-sm leading-relaxed text-foreground/90">{i.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function NotFor() {
  return (
    <Section label="04 — Filter" title={PILOT.notFor.title}>
      <ul className="space-y-3">
        {PILOT.notFor.items.map((n) => (
          <li key={n} className="flex gap-3 text-foreground/80">
            <span aria-hidden className="mt-3 inline-block h-px w-4 bg-muted-foreground" />
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Includes() {
  return (
    <Section label="05 — Included" title={PILOT.includes.title}>
      <ol className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2">
        {PILOT.includes.items.map((i) => (
          <li key={i.label} className="bg-background p-6">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-accent">{i.label}</span>
              <h3 className="text-lg">{i.title}</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{i.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function SAFENote() {
  return (
    <Section label="06 — Terms" title={PILOT.safe.title}>
      <ul className="space-y-4">
        {PILOT.safe.points.map((p) => (
          <li key={p} className="flex gap-4 text-foreground/90">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">
        Follow-on is a separate decision on both sides at week six. No obligation either way — that is the point of the pilot.
      </p>
    </Section>
  );
}

function Benefits() {
  return (
    <Section label="07 — Benefits" title={PILOT.benefits.title}>
      <ul className="divide-y divide-border border-y border-border">
        {PILOT.benefits.items.map((b, idx) => (
          <li key={b} className="flex gap-6 py-5">
            <span className="font-mono text-xs text-muted-foreground">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <span className="text-foreground/90">{b}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Requirements() {
  return (
    <Section label="08 — Requirements" title={PILOT.requirements.title}>
      <ul className="space-y-4">
        {PILOT.requirements.items.map((r) => (
          <li key={r} className="flex gap-4 text-foreground/90">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Strong() {
  return (
    <Section label="09 — Signal" title={PILOT.strong.title}>
      <ul className="space-y-4">
        {PILOT.strong.items.map((s, i) => (
          <li key={s} className="flex gap-4 text-foreground/90">
            <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Process() {
  return (
    <Section label="10 — Process" title={PILOT.process.title}>
      <ol className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2">
        {PILOT.process.items.map((i) => (
          <li key={i.label} className="bg-background p-6">
            <p className="label !text-accent">{i.label}</p>
            <h3 className="mt-2 text-lg">{i.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{i.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function CTA() {
  return (
    <section id="apply" className="border-t border-border bg-foreground text-background">
      <Container className="grid gap-10 py-24 md:grid-cols-12 md:py-32">
        <div className="md:col-span-7">
          <p className="label !text-background/60">Next step</p>
          <h2 className="mt-4 text-4xl md:text-5xl">{PILOT.cta.title}</h2>
          <p className="mt-4 max-w-md text-background/70">{PILOT.cta.body}</p>
        </div>
        <div className="flex flex-col items-start justify-end gap-4 md:col-span-5 md:items-end">
          <a
            href={PILOT.applyUrl}
            className="inline-flex items-center gap-2 rounded-sm bg-background px-6 py-4 text-base font-medium text-foreground transition-transform hover:-translate-y-px"
          >
            {PILOT.cta.button}
            <span aria-hidden>→</span>
          </a>
          <p className="label !text-background/60">{PILOT.cta.note}</p>
        </div>
      </Container>
    </section>
  );
}

function Footer() {
  return (
    <Container className="flex flex-wrap items-center justify-between gap-4 py-10 text-sm text-muted-foreground">
      <p>© {new Date().getFullYear()} {PILOT.brand} {PILOT.brandSuffix}</p>
      <p className="label">{PILOT.cohort}</p>
    </Container>
  );
}
