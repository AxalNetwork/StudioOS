import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Recruiting an Advisor" },
      {
        name: "description",
        content:
          "We're building Axal. Here's the category, the thesis, what we've shipped, and what we need from an advisor.",
      },
    ],
  }),
  component: Index,
});

/* ---------- Editable content ---------- */

const company = {
  name: "Axal",
  oneLiner: "Programmable trust for autonomous agents.",
  productDescription:
    "Axal is building policy and settlement infrastructure so autonomous agents can transact safely without human escalation.",
  founders: "Marc Boyron & Priya Anand",
  stage: "Pre-seed, building toward design partners.",
  location: "Brooklyn, NY",
};

const category = {
  label: "Category",
  title: "Agent-native infrastructure",
  thesis:
    "Within five years, most economically meaningful software will be initiated by autonomous agents. The systems that price risk, enforce policy, and settle disputes between them do not exist yet. We are building them.",
  bullets: [
    "Identity and reputation primitives for non-human actors.",
    "Policy enforcement that travels with the request, not the perimeter.",
    "An economic layer where agents can post bonds and resolve disputes without a human escalation path.",
  ],
};

const whyThisCompany = [
  {
    title: "The wedge is real, narrow, and underbuilt.",
    body: "Agent payments today are bolted onto consumer rails that assume a human is at the keyboard. The fraud, refund, and authorization patterns don't match agent behavior, and the existing networks aren't motivated to fix it. We start there.",
  },
  {
    title: "Distribution is unusually direct.",
    body: "Our first buyers are agent platforms and AI-native fintechs — a list of maybe 200 companies, all of which we can reach by name. We don't need a marketing flywheel to find them.",
  },
  {
    title: "The team has lived the failure mode.",
    body: "Marc led risk engineering at a payments platform for four years. Priya built one of the first agent runtimes shipped to production. We are not guessing at the problem.",
  },
];

const adviceNeeded = [
  {
    area: "Go-to-market with platform buyers",
    detail:
      "How to land and expand inside AI-native platforms whose buying process is still forming. Pricing, contract shape, who actually signs.",
  },
  {
    area: "Risk and compliance posture",
    detail:
      "We will operate in or adjacent to regulated payments. We need a sober view of which regimes to engage now vs. defer, and how to design around them.",
  },
  {
    area: "Hiring the first three engineers",
    detail:
      "Specifically: who in your network would actually consider a pre-seed cryptography-adjacent role, and how to close them.",
  },
];

const traction = [
  { metric: "7", label: "Signed design-partner LOIs" },
  { metric: "$1.4M", label: "Pre-seed committed" },
  { metric: "11", label: "Production integrations in pilot" },
  { metric: "Q2 2026", label: "Targeted GA" },
];

const whyYou = {
  body: "We're approaching you specifically — not a list. Your work on {{ADVISOR_WORK}} at {{ADVISOR_COMPANY}} and your {{ADVISOR_ESSAY}} have shaped how we frame the problem. {{INTERNAL_REFERENCE_EXAMPLE}} An advisory relationship would let us pressure-test decisions with someone who has already seen the shape of what we're walking into.",
  signature: company.founders,
};

const advisoryAsk = {
  commitment: "One 60-minute call per month, plus async questions as they come up.",
  duration: "24-month term, reviewed at 12.",
  equity: "0.25%–0.50% common, vesting monthly over 24 months, single-trigger acceleration on change of control. We keep the advisor pool small and concentrated — this is one of a handful of slots.",
  expectations: [
    "Respond to async questions within ~3 business days.",
    "Two warm intros per quarter where it's a natural fit — never forced.",
    "Honest, direct feedback. We'd rather hear no than a soft yes.",
  ],
  notExpected: [
    "Public endorsement or use of your name in marketing without your written sign-off.",
    "Operational work or interim roles.",
    "Exclusivity. We assume you advise other companies.",
  ],
  conflicts:
    "We will design the agreement around your employer's policies. No confidential information is expected from your side.",
};

/* ---------- Page ---------- */

function Index() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <Nav />
      <Hero />
      <Category />
      <WhyCompany />
      <AdviceNeeded />
      <Traction />
      <WhyYou />
      <CTA />
      <Footer />
    </main>
  );
}

/* ---------- Sections ---------- */

function Nav() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Mark />
          <span className="font-serif text-lg">{company.name}</span>
        </div>
        <nav className="hidden gap-8 text-sm text-muted-foreground md:flex">
          <a href="#thesis" className="hover:text-foreground">Thesis</a>
          <a href="#why-company" className="hover:text-foreground">Why us</a>
          <a href="#advice" className="hover:text-foreground">The ask</a>
          <a href="#traction" className="hover:text-foreground">Traction</a>
        </nav>
        <a
          href="#cta"
          className="rounded-md border border-ink/20 bg-transparent px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper transition-colors"
        >
          Become an advisor
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="border-b border-rule">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-12 md:py-32">
        <div className="md:col-span-8">
          <p className="eyebrow mb-8">An invitation, not a pitch</p>
          <h1 className="font-serif text-5xl leading-[1.05] tracking-tight md:text-7xl">
            We're building <span className="italic">{company.name}</span>.
            <br />
            We'd like your counsel.
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            {company.oneLiner} {company.productDescription} This page exists so you can decide, on your own time, whether an
            advisory relationship makes sense — what we're building, what we need, and what we'd
            ask of you. No call required to read it.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="#cta"
              className="rounded-md bg-ink px-6 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              Become an advisor
            </a>
            <a
              href="#thesis"
              className="rounded-md border border-ink/20 px-6 py-3 text-sm font-medium hover:bg-secondary"
            >
              Read the thesis first
            </a>
          </div>
        </div>
        <aside className="md:col-span-4">
          <dl className="space-y-6 border-l border-rule pl-6 text-sm">
            <Meta label="Founders" value={company.founders} />
            <Meta label="Stage" value={company.stage} />
            <Meta label="Based" value={company.location} />
            <Meta label="Last updated" value="June 2026" />
          </dl>
        </aside>
      </div>
    </section>
  );
}

function Category() {
  return (
    <Section id="thesis" eyebrow="01 · Category & Thesis" title={category.title}>
      <p className="max-w-3xl text-lg leading-relaxed text-foreground/85">
        {category.thesis}
      </p>
      <ul className="mt-12 grid gap-8 md:grid-cols-3">
        {category.bullets.map((b, i) => (
          <li key={i} className="border-t border-rule pt-5">
            <span className="font-mono text-xs text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
            <p className="mt-3 text-base leading-relaxed">{b}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function WhyCompany() {
  return (
    <Section id="why-company" eyebrow="02 · Why this company" title="Three reasons we think we'll win this — and the honest version of each.">
      <div className="mt-12 space-y-px">
        {whyThisCompany.map((item, i) => (
          <article
            key={i}
            className="grid gap-6 border-t border-rule py-10 md:grid-cols-12"
          >
            <div className="md:col-span-1">
              <span className="font-mono text-sm text-accent">0{i + 1}</span>
            </div>
            <div className="md:col-span-4">
              <h3 className="font-serif text-2xl leading-tight">{item.title}</h3>
            </div>
            <p className="text-base leading-relaxed text-foreground/80 md:col-span-7">
              {item.body}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}

function AdviceNeeded() {
  return (
    <Section
      id="advice"
      eyebrow="03 · What we'd ask of you"
      title="The advisory ask, in plain terms."
    >
      <p className="max-w-3xl text-lg leading-relaxed text-foreground/85">
        We'd rather be specific about what we need than vague about what we'd offer in return.
        Here's the shape of the relationship we're proposing.
      </p>

      <div className="mt-12 grid gap-12 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-6">Where we'd lean on you</p>
          <ul className="space-y-8">
            {adviceNeeded.map((a) => (
              <li key={a.area} className="border-l-2 border-accent/60 pl-5">
                <h4 className="font-serif text-xl">{a.area}</h4>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {a.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-rule bg-card p-8">
          <p className="eyebrow mb-6">Terms</p>
          <Term label="Time" value={advisoryAsk.commitment} />
          <Term label="Term" value={advisoryAsk.duration} />
          <Term label="Equity" value={advisoryAsk.equity} />

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-foreground">
                What we'd ask
              </p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {advisoryAsk.expectations.map((e) => (
                  <li key={e} className="flex gap-2">
                    <span className="text-accent">+</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-foreground">
                What we wouldn't
              </p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {advisoryAsk.notExpected.map((e) => (
                  <li key={e} className="flex gap-2">
                    <span className="text-muted-foreground/60">−</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-8 border-t border-rule pt-5 text-sm leading-relaxed text-muted-foreground">
            {advisoryAsk.conflicts}
          </p>
        </div>
      </div>
    </Section>
  );
}

function Traction() {
  return (
    <Section id="traction" eyebrow="04 · Current traction" title="Where we actually are.">
      <p className="max-w-3xl text-lg leading-relaxed text-foreground/85">
        Pre-seed, June 2026. We'd rather show you the boring numbers than the flattering ones. This is everything material right now.
      </p>
      <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-4">
        {traction.map((t) => (
          <div key={t.label} className="bg-card p-8">
            <div className="font-serif text-4xl tracking-tight md:text-5xl">
              {t.metric}
            </div>
            <div className="mt-3 text-sm text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Design-partner LOIs are non-binding. Production integrations are running on shared
        infrastructure and have not yet processed live customer funds. We'll share the data room
        on request.
      </p>
    </Section>
  );
}

function WhyYou() {
  return (
    <Section id="why-you" eyebrow="05 · Why you" title="Why we're writing to you, specifically.">
      <figure className="mt-4 max-w-3xl border-l-4 border-accent pl-8">
        <blockquote className="font-serif text-2xl leading-snug md:text-3xl">
          "<TokenizedText text={whyYou.body} />"
        </blockquote>
        <figcaption className="mt-6 text-sm text-muted-foreground">
          — {whyYou.signature}
        </figcaption>
      </figure>
    </Section>
  );
}

function CTA() {
  return (
    <section id="cta" className="border-t border-rule bg-ink text-paper">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <p className="eyebrow mb-6" style={{ color: "oklch(0.7 0.05 80)" }}>
          Next step
        </p>
        <h2 className="max-w-3xl font-serif text-4xl leading-tight md:text-6xl">
          If this is a fit, we'd love a single 45-minute conversation.
        </h2>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-paper/70">
          One call. No deck. In your first reply, tell us what you're interested in, any constraints, and whether you prefer an intro call or to review materials first. A founder will respond within 48 hours. You walk away with whatever level of involvement feels right — including none. We mean that.
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <a
            href="mailto:advisors@axal.example?subject=Advisor%20conversation"
            className="rounded-md bg-paper px-6 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
          >
            Become an advisor
          </a>
          <a
            href="mailto:advisors@axal.example?subject=Pass%2C%20but%20here%27s%20a%20thought"
            className="text-sm text-paper/70 underline-offset-4 hover:text-paper hover:underline"
          >
            Or: pass, but here's a thought →
          </a>
        </div>

        <div className="mt-16 grid gap-8 border-t border-paper/15 pt-10 text-sm text-paper/60 md:grid-cols-3">
          <div>
            <p className="text-paper">Direct</p>
            <p className="mt-1">advisors@axal.example</p>
          </div>
          <div>
            <p className="text-paper">Data room</p>
            <p className="mt-1">Sent on request, NDA optional.</p>
          </div>
          <div>
            <p className="text-paper">Who replies</p>
            <p className="mt-1">Marc or Priya directly, within 48 hours.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 text-xs text-muted-foreground md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <Mark small />
          <span>© {new Date().getFullYear()} {company.name}, Inc.</span>
        </div>
        <p>This page is intentionally unindexed. Please don't share without asking.</p>
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
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b border-rule">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <p className="eyebrow mb-6">{eyebrow}</p>
        <h2 className="max-w-3xl font-serif text-4xl leading-[1.1] md:text-5xl">
          {title}
        </h2>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-4 border-t border-rule py-4 first:border-t-0 first:pt-0">
      <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm leading-relaxed">{value}</div>
    </div>
  );
}

function TokenizedText({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span
            key={i}
            className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function Mark({ small = false }: { small?: boolean }) {
  const size = small ? 14 : 18;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 1 L17 17 L1 17 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M5.5 13 H12.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
