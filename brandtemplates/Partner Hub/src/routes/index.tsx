import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Partnership Opportunities" },
      { name: "description", content: "Axal builds with strategic partners across commercial, technical, and distribution channels. Explore where we fit together." },
      { property: "og:title", content: "Axal — Partnership Opportunities" },
      { property: "og:description", content: "Explore commercial, technical, and distribution partnerships with Axal." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
      <Nav />
      <Hero />
      <WhyPartner />
      <SharedFit />
      <Models />
      <ValueToPartner />
      <Traction />
      <NextStep />
      <FinalCTA />
      <Footer />
    </div>
  );
}

const display = { fontFamily: "var(--font-display)" } as const;

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-sm bg-primary text-primary-foreground text-xs font-semibold tracking-tight">A</span>
          <span className="text-sm font-medium tracking-tight">Axal</span>
        </a>
        <nav className="hidden gap-8 md:flex">
          {[
            ["Why partner", "#why"],
            ["Fit", "#fit"],
            ["Models", "#models"],
            ["Traction", "#traction"],
          ].map(([label, href]) => (
            <a key={href} href={href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{label}</a>
          ))}
        </nav>
        <a href="#cta" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          Explore partnership <span aria-hidden>→</span>
        </a>
      </div>
    </header>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
      <span className="h-px w-6 bg-[var(--hairline)]" />
      {children}
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-[var(--hairline)]" style={{ background: "var(--gradient-soft)" }}>
      <div className="mx-auto max-w-6xl px-6 pt-24 pb-28">
        <Eyebrow>Partnerships at Axal</Eyebrow>
        <h1 style={display} className="max-w-3xl text-5xl font-normal leading-[1.05] tracking-tight text-foreground md:text-6xl">
          Partner with Axal where the same customer wins twice.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          We run a small number of commercial, technical, and distribution
          partnerships with growth-stage B2B companies. Named owners on both
          sides, written success criteria, and a 90-day pilot before anything
          gets larger.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a href="#cta" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-[var(--shadow-elegant)] transition-opacity hover:opacity-90">
            Explore partnership <span aria-hidden>→</span>
          </a>
          <a href="#models" className="inline-flex items-center gap-2 rounded-md border border-[var(--hairline)] bg-card px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
            See collaboration models
          </a>
        </div>

        <dl className="mt-16 grid grid-cols-2 gap-x-10 gap-y-6 border-t border-[var(--hairline)] pt-8 md:grid-cols-4">
          {[
            ["Active partners", "24", "as of Q2 2026"],
            ["Joint customers", "180+", "live in production"],
            ["Avg. integration time", "3 wks", "last 12 partnerships"],
            ["Partner-sourced revenue", "38%", "trailing 12 months"],
          ].map(([k, v, note]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">{k}</dt>
              <dd style={display} className="mt-1 text-2xl text-foreground">{v}</dd>
              <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function WhyPartner() {
  const reasons = [
    {
      n: "01",
      title: "Shared accountability",
      body: "Named operators on both sides, a written joint plan, and a monthly pipeline review. No logo swaps.",
    },
    {
      n: "02",
      title: "Productized surface",
      body: "Documented APIs, co-sell motion, and joint pricing — versioned and stable, so partners can plan around them.",
    },
    {
      n: "03",
      title: "Integrations that ship on date",
      body: "Of the last 12 integrations, 11 shipped on the agreed date. We move dates in writing, not silently.",
    },
  ];
  return (
    <section id="why" className="border-b border-[var(--hairline)] bg-background">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-12 md:grid-cols-[1fr_2fr]">
          <div>
            <Eyebrow>Why partner with us</Eyebrow>
            <h2 style={display} className="text-4xl font-normal leading-tight tracking-tight">A small number of partnerships, run seriously.</h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              We add three to five new partners a year. Each one is run by a named
              GM on our side with a written 90-day plan.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--hairline)] sm:grid-cols-3">
            {reasons.map((r) => (
              <div key={r.n} className="bg-card p-7">
                <div className="text-xs font-medium tracking-wider text-accent">{r.n}</div>
                <h3 className="mt-4 text-base font-medium text-foreground">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SharedFit() {
  const segments = [
    "Series B–D vertical SaaS",
    "Mid-market fintech infra",
    "RevOps and data platforms",
    "Embedded workflow tools",
    "Regional systems integrators",
    "Industry analyst networks",
  ];
  const bestFit = [
    "$10M+ ARR, selling into RevOps, Finance, or Ops at growth-stage B2B",
    "A live product with at least 50 production customers",
    "A named partnerships or BD owner who can commit a weekly hour",
  ];
  const notFit = [
    "Pre-revenue or pre-PMF tools looking for a logo or distribution lift",
    "Agencies or services-led firms without a productized surface",
    "Broad ecosystem programs with no shared named-account list",
  ];
  return (
    <section id="fit" className="border-b border-[var(--hairline)]" style={{ background: "var(--gradient-soft)" }}>
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Eyebrow>Shared audience & fit</Eyebrow>
        <div className="grid gap-12 md:grid-cols-[2fr_1fr]">
          <div>
            <h2 style={display} className="max-w-2xl text-4xl font-normal leading-tight tracking-tight">
              Our buyer is likely already on your roadmap.
            </h2>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              Axal sells to RevOps, Finance, and Operations leaders at
              growth-stage B2B companies. We share named-account lists in the
              first call and only move forward when overlap is meaningful.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {segments.map((s) => (
                <span key={s} className="rounded-full border border-[var(--hairline)] bg-card px-3 py-1.5 text-xs font-medium text-foreground">{s}</span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--hairline)] bg-card p-7 shadow-[var(--shadow-elegant)]">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Typical ICP overlap</div>
            <div style={display} className="mt-2 text-5xl text-foreground">62%</div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Median across the last twelve partnerships at kickoff, measured by named-account list intersection (n=12, 2024–2026).
            </p>
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--hairline)] bg-card p-7">
            <div className="text-xs font-medium uppercase tracking-wider text-accent">Best fit</div>
            <ul className="mt-4 space-y-3">
              {bestFit.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-foreground">
                  <span className="mt-2 h-1 w-1 rounded-full bg-accent" aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-[var(--hairline)] bg-card p-7">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Not a fit (yet)</div>
            <ul className="mt-4 space-y-3">
              {notFit.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="mt-2 h-1 w-1 rounded-full bg-[var(--hairline)]" aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Models() {
  const models = [
    {
      tag: "Commercial",
      title: "Co-sell & referral",
      points: ["Mutual referral SLAs", "Joint named-account plans", "Quarterly pipeline reviews"],
      example: "Example: a vertical SaaS platform refers Axal into 40 shared accounts; we close two and they attach as a paid add-on.",
    },
    {
      tag: "Technical",
      title: "Integration & embed",
      points: ["Open API + sandbox", "Co-built reference apps", "Shared roadmap input"],
      example: "Example: a data platform embeds Axal via API; the joint workflow becomes one of their top-five attached modules within two quarters.",
    },
    {
      tag: "Distribution",
      title: "Channel & marketplace",
      points: ["Marketplace listings", "Reseller-friendly pricing", "Co-marketed launches"],
      example: "Example: a regional SI resells Axal into mid-market finance teams under a tiered margin and a co-branded launch.",
    },
  ];
  return (
    <section id="models" className="border-b border-[var(--hairline)] bg-background">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow>Collaboration models</Eyebrow>
            <h2 style={display} className="max-w-2xl text-4xl font-normal leading-tight tracking-tight">Three shapes. All editable to your motion.</h2>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            These are starting points, not menus. Most partnerships blend two of the three within the first quarter.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {models.map((m) => (
            <article key={m.title} className="group relative flex flex-col rounded-lg border border-[var(--hairline)] bg-card p-7 transition-shadow hover:shadow-[var(--shadow-elegant)]">
              <div className="text-xs font-medium uppercase tracking-wider text-accent">{m.tag}</div>
              <h3 style={display} className="mt-3 text-2xl text-foreground">{m.title}</h3>
              <ul className="mt-6 space-y-3 border-t border-[var(--hairline)] pt-5">
                {m.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm text-foreground">
                    <span className="mt-2 h-1 w-1 rounded-full bg-accent" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-[var(--hairline)] pt-5 text-xs leading-relaxed text-muted-foreground">
                {m.example}
              </p>
              <a href="#cta" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline">
                Discuss this model <span aria-hidden>→</span>
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ValueToPartner() {
  const rows = [
    ["Account coverage", "Warm intros into 1,200+ active customers across adjacent buying centers."],
    ["Faster cycles", "Joint deals close in 41 days median vs. 78 standalone (last 4 quarters, n=46)."],
    ["Lower lift", "Reference architectures + a staffed integration pod — most partners ship in 3 weeks."],
    ["Co-branded proof", "Shared case studies, analyst briefings, and one named launch moment per year."],
  ];
  return (
    <section className="border-b border-[var(--hairline)]" style={{ background: "var(--gradient-soft)" }}>
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Eyebrow>Value to partner</Eyebrow>
        <h2 style={display} className="max-w-2xl text-4xl font-normal leading-tight tracking-tight">What you get, plainly.</h2>

        <div className="mt-12 overflow-hidden rounded-lg border border-[var(--hairline)] bg-card">
          {rows.map(([k, v], i) => (
            <div key={k} className={`grid grid-cols-1 gap-2 px-6 py-5 md:grid-cols-[200px_1fr] md:gap-6 ${i !== 0 ? "border-t border-[var(--hairline)]" : ""}`}>
              <div className="text-sm font-medium text-foreground">{k}</div>
              <div className="text-sm leading-relaxed text-muted-foreground">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Traction() {
  return (
    <section id="traction" className="border-b border-[var(--hairline)] bg-background">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Eyebrow>Current traction</Eyebrow>
        <div className="grid gap-12 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 style={display} className="text-4xl font-normal leading-tight tracking-tight">
              The numbers a partner usually asks about.
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              All figures are as of Q2 2026. Methodology available on request.
            </p>
            <div className="mt-10 grid grid-cols-2 gap-6">
              {[
                ["3.1×", "YoY revenue growth, FY2025 vs FY2024"],
                ["97%", "Gross revenue retention, trailing 12 months"],
                ["1,200+", "Active paying customers"],
                ["42 NPS", "Partner-sourced accounts (n=180, last survey Q1 2026)"],
              ].map(([v, k]) => (
                <div key={k} className="rounded-lg border border-[var(--hairline)] bg-card p-6">
                  <div style={display} className="text-3xl text-foreground">{v}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{k}</div>
                </div>
              ))}
            </div>
          </div>

          <figure className="flex flex-col justify-between rounded-lg border border-[var(--hairline)] bg-card p-8 shadow-[var(--shadow-elegant)]">
            <blockquote style={display} className="text-xl leading-snug text-foreground">
              “The integration shipped on the week they said it would. Six months in, it's one of our most-attached add-ons.”
            </blockquote>
            <figcaption className="mt-8 border-t border-[var(--hairline)] pt-5">
              <div className="text-sm font-medium text-foreground">Head of Partnerships</div>
              <div className="text-xs text-muted-foreground">Public mid-market SaaS platform</div>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function NextStep() {
  const steps = [
    ["01", "Intro call", "30 minutes. We map overlap on accounts, motion, and timing."],
    ["02", "Joint working session", "A focused workshop to draft the model and identify two anchor opportunities."],
    ["03", "90-day pilot", "Named owners, weekly cadence, written success criteria. Renew or close cleanly."],
  ];
  return (
    <section className="border-b border-[var(--hairline)]" style={{ background: "var(--gradient-soft)" }}>
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Eyebrow>Next step</Eyebrow>
        <h2 style={display} className="max-w-2xl text-4xl font-normal leading-tight tracking-tight">A short, deliberate path to a real pilot.</h2>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--hairline)] md:grid-cols-3">
          {steps.map(([n, t, d]) => (
            <li key={n} className="bg-card p-7">
              <div className="flex items-baseline gap-3">
                <span className="text-xs font-medium tracking-wider text-accent">{n}</span>
                <h3 className="text-base font-medium text-foreground">{t}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section id="cta" className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-10 md:grid-cols-[2fr_1fr] md:items-end">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-primary-foreground/70">
              <span className="h-px w-6 bg-primary-foreground/30" />
              Explore partnership
            </div>
            <h2 style={display} className="max-w-2xl text-4xl font-normal leading-tight tracking-tight md:text-5xl">
              Tell us where you'd like to find each other in a customer.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-primary-foreground/75">
              We reply within two business days with a candid view on overlap,
              the right model to start with, and a draft agenda for an intro
              call.
            </p>
            <ul className="mt-6 max-w-xl space-y-2 text-sm text-primary-foreground/80">
              <li className="flex items-start gap-3"><span className="mt-2 h-1 w-1 rounded-full bg-accent" aria-hidden />Your company, product, and primary motion (PLG, sales-led, channel)</li>
              <li className="flex items-start gap-3"><span className="mt-2 h-1 w-1 rounded-full bg-accent" aria-hidden />Target segment and region (e.g., NA mid-market fintech)</li>
              <li className="flex items-start gap-3"><span className="mt-2 h-1 w-1 rounded-full bg-accent" aria-hidden />Which model interests you most: commercial, technical, or distribution</li>
              <li className="flex items-start gap-3"><span className="mt-2 h-1 w-1 rounded-full bg-accent" aria-hidden />Two or three named accounts where you'd want to land together</li>
            </ul>
          </div>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col gap-3 rounded-lg border border-primary-foreground/15 bg-primary-foreground/5 p-5 backdrop-blur"
          >
            <label className="text-xs font-medium uppercase tracking-wider text-primary-foreground/70">Work email</label>
            <input
              type="email"
              required
              placeholder="you@company.com"
              className="rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-3.5 py-2.5 text-sm text-primary-foreground placeholder:text-primary-foreground/50 outline-none focus:border-accent"
            />
            <label className="mt-2 text-xs font-medium uppercase tracking-wider text-primary-foreground/70">Context</label>
            <textarea
              rows={4}
              placeholder="Company, product, motion, target segment, region, and 2–3 named accounts."
              className="rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-3.5 py-2.5 text-sm text-primary-foreground placeholder:text-primary-foreground/50 outline-none focus:border-accent"
            />
            <button type="submit" className="mt-1 inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90">
              Explore partnership <span aria-hidden>→</span>
            </button>
            <p className="text-[11px] leading-relaxed text-primary-foreground/60">
              Or write directly to <span className="text-primary-foreground">partnerships@axal.co</span>.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 text-xs text-muted-foreground md:flex-row md:items-center">
        <div>© {new Date().getFullYear()} Axal, Inc. All rights reserved.</div>
        <div className="flex gap-6">
          <a href="#" className="hover:text-foreground">Privacy</a>
          <a href="#" className="hover:text-foreground">Terms</a>
          <a href="#cta" className="hover:text-foreground">Partnerships</a>
        </div>
      </div>
    </footer>
  );
}
