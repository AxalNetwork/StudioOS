import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Distribution fit for category-defining founders" },
      {
        name: "description",
        content:
          "A founder-facing brief that maps customer overlap, channel economics, and rollout paths with a named distribution partner.",
      },
      { property: "og:title", content: "Axal — Distribution fit briefing" },
      {
        property: "og:description",
        content:
          "Customer overlap, channel economics, and integration paths — built for founders pitching distribution partners.",
      },
    ],
  }),
  component: Index,
});

// ─────────────────────────────────────────────────────────────
// EDITABLE: swap partner type here (e.g. "Retail Bank", "PLG SaaS",
// "Telco", "Healthcare Network"). All copy adapts to this label.
const PARTNER_TYPE = "Retail Bank";
const PARTNER_TYPE_LOWER = PARTNER_TYPE.toLowerCase();
// ─────────────────────────────────────────────────────────────

function SectionLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <span className="font-mono-tag">{n}</span>
      <span className="h-px w-8 bg-border" />
      <span className="font-mono-tag">{children}</span>
    </div>
  );
}

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-sm bg-foreground text-background">
              <span className="font-display text-base leading-none">A</span>
            </div>
            <span className="font-display text-lg">Axal</span>
            <span className="font-mono-tag ml-3 text-muted-foreground">
              Distribution Brief
            </span>
          </div>
          <nav className="hidden items-center gap-7 text-sm md:flex">
            <a href="#overlap" className="text-muted-foreground hover:text-foreground">Overlap</a>
            <a href="#channel" className="text-muted-foreground hover:text-foreground">Channel</a>
            <a href="#rollout" className="text-muted-foreground hover:text-foreground">Rollout</a>
            <a href="#proof" className="text-muted-foreground hover:text-foreground">Proof</a>
            <a href="#audience" className="text-muted-foreground hover:text-foreground">Audience</a>
          </nav>
          <a
            href="#cta"
            className="rounded-sm bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-foreground/85"
          >
            Discuss fit →
          </a>
        </div>
      </header>

      {/* HERO */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 pb-20 pt-16 md:pt-24">
          <SectionLabel n="00 / Brief">For {PARTNER_TYPE} Distribution</SectionLabel>
          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <h1 className="font-display text-5xl leading-[0.95] tracking-tight md:text-7xl">
                A distribution path to{" "}
                <span className="italic text-accent">12.4M</span> of your{" "}
                {PARTNER_TYPE_LOWER}'s most active customers.
              </h1>
              <p className="mt-8 max-w-2xl text-lg text-foreground/90">
                <span className="font-medium">Axal is a consumer money-movement and rewards product, embedded inside your retail banking app, that turns idle balances and everyday spend into measurable ARPU.</span>
              </p>
              <p className="mt-4 max-w-2xl text-base text-muted-foreground">
                This page is the unvarnished version of the deck — overlap, economics, and the exact integration shapes we're proposing for a {PARTNER_TYPE_LOWER} of your scale. No ecosystem theater.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <a
                  href="#cta"
                  className="rounded-sm bg-foreground px-6 py-3.5 text-sm font-medium text-background transition hover:bg-foreground/85"
                >
                  Discuss distribution fit
                </a>
                <a
                  href="#overlap"
                  className="rounded-sm border border-border px-6 py-3.5 text-sm font-medium text-foreground transition hover:bg-secondary"
                >
                  Read the brief
                </a>
              </div>
            </div>
            <div className="lg:col-span-4">
              <div className="rounded-md border border-border bg-card p-6">
                <div className="font-mono-tag text-muted-foreground">At a glance</div>
                <dl className="mt-5 space-y-4 text-sm">
                  {[
                    ["Partner type", PARTNER_TYPE],
                    ["Addressable overlap", "12.4M users (US + UK)"],
                    ["ARPU lift (modeled, Y1)", "+$38 / activated user"],
                    ["Time to first booked revenue", "~9 weeks"],
                    ["Rev share model", "70 / 30 net new"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between border-b border-dashed border-border pb-3 last:border-0">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-display text-base">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-xs text-muted-foreground">
                  Figures below are labeled <span className="font-mono-tag">measured</span> (live pilots) or <span className="font-mono-tag">modeled</span> (cohort projection). Sources on request.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CUSTOMER OVERLAP */}
      <section id="overlap" className="border-b border-border bg-secondary/40">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <SectionLabel n="01">Customer Overlap</SectionLabel>
          <div className="mt-6 grid grid-cols-1 gap-12 lg:grid-cols-12">
            <h2 className="font-display text-4xl tracking-tight md:text-5xl lg:col-span-7">
              Roughly <span className="text-accent">61%</span> of our active base already holds a primary account with a {PARTNER_TYPE_LOWER} in your tier.
            </h2>
            <p className="text-muted-foreground lg:col-span-5">
              <span className="font-mono-tag text-foreground">Measured —</span> panel of 184k verified Axal users (US + UK, Jun–Nov 2025) matched against published penetration data for top-six retail banks. We'll re-run it against your book in a clean room, under MNDA, before signature.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-4">
            {[
              ["12.4M", "Shared addressable users · US + UK"],
              ["61%", "Already hold an account with you"],
              ["28%", "Acquired by us in last 12 mo"],
              ["3.2×", "Sessions vs. our non-overlap cohort"],
            ].map(([n, l]) => (
              <div key={l} className="bg-card p-7">
                <div className="font-display text-4xl tracking-tight md:text-5xl">{n}</div>
                <div className="mt-2 text-sm text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              { title: "Where they overlap", body: "Mass-affluent, 28–44, tier-1 metros. Same income band as your premium card holders." },
              { title: "Where they don't yet", body: "We under-index in 55+ segments. A co-marketed bundle closes most of that gap inside a quarter." },
              { title: "Channel preference", body: "78% prefer an in-app entry point over a standalone download. Distribution beats paid search for both sides." },
            ].map((c) => (
              <div key={c.title} className="rounded-md border border-border bg-card p-6">
                <div className="font-mono-tag text-accent">{c.title}</div>
                <p className="mt-3 text-sm text-foreground/80">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CHANNEL VALUE */}
      <section id="channel" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <SectionLabel n="02">Channel Value</SectionLabel>
          <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="font-display text-4xl tracking-tight md:text-5xl">
                What the channel is worth, in revenue we can both book.
              </h2>
              <p className="mt-5 text-muted-foreground">
                <span className="font-mono-tag text-foreground">Modeled —</span> a {PARTNER_TYPE_LOWER} cohort of 8M activated mobile users, 22% bundle-qualified, 12-month window. Baseline drawn from your published investor disclosures; Axal column from blended pilot performance (2024–2025).
              </p>
            </div>
            <div className="lg:col-span-7">
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-left">
                    <tr>
                      <th className="px-5 py-3 font-mono-tag text-muted-foreground">Lever</th>
                      <th className="px-5 py-3 font-mono-tag text-muted-foreground">Baseline</th>
                      <th className="px-5 py-3 font-mono-tag text-muted-foreground">With Axal</th>
                      <th className="px-5 py-3 font-mono-tag text-muted-foreground">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {[
                      ["Activation rate", "11%", "34%", "+23 pp"],
                      ["ARPU (annual)", "$142", "$180", "+$38"],
                      ["12-mo retention", "61%", "78%", "+17 pp"],
                      ["CAC payback", "14 mo", "5 mo", "−9 mo"],
                      ["Cross-sell attach", "1.2", "2.4", "+1.2"],
                    ].map((r) => (
                      <tr key={r[0]}>
                        <td className="px-5 py-3.5 font-medium">{r[0]}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{r[1]}</td>
                        <td className="px-5 py-3.5">{r[2]}</td>
                        <td className="px-5 py-3.5 text-accent">{r[3]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Conservative attach (22%, vs. 31% measured in live pilots). Sensitivity table (±50% on each lever) shared under MNDA.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRATION / ROLLOUT */}
      <section id="rollout" className="border-b border-border bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <SectionLabel n="03">Integration & Rollout</SectionLabel>
          <h2 className="mt-6 max-w-3xl font-display text-4xl tracking-tight md:text-5xl">
            Three integration shapes. Pick the one your risk team will actually sign.
          </h2>

          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                tag: "Option A · Lightest",
                title: "Co-branded link-out",
                weeks: "3 wks",
                bullets: [
                  "Single deep link from your app",
                  "No data shared, no SDK",
                  "Rev share on attributed signups",
                ],
              },
              {
                tag: "Option B · Default",
                title: "Embedded module",
                weeks: "8–10 wks",
                bullets: [
                  "Axal renders inside your shell",
                  "OAuth handshake, no PII leaves you",
                  "Joint analytics dashboard",
                ],
                featured: true,
              },
              {
                tag: "Option C · Deepest",
                title: "White-label rail",
                weeks: "16+ wks",
                bullets: [
                  "Your brand, our infrastructure",
                  "Full product surface, your compliance",
                  "Custom economics, exclusivity windows",
                ],
              },
            ].map((o) => (
              <div
                key={o.title}
                className={`rounded-md border p-7 ${
                  o.featured
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-primary-foreground/15 bg-primary-foreground/[0.03]"
                }`}
              >
                <div className="font-mono-tag opacity-70">{o.tag}</div>
                <div className="mt-4 flex items-baseline justify-between">
                  <h3 className="font-display text-2xl">{o.title}</h3>
                  <span className="font-mono-tag">{o.weeks}</span>
                </div>
                <ul className="mt-6 space-y-3 text-sm">
                  {o.bullets.map((b) => (
                    <li key={b} className="flex gap-3">
                      <span className={o.featured ? "text-accent-foreground" : "text-accent"}>→</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* timeline */}
          <div className="mt-16">
            <div className="font-mono-tag text-primary-foreground/60">Rollout milestones — Option B</div>
            <ol className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-md md:grid-cols-5">
              {[
                ["Wk 0", "Term sheet"],
                ["Wk 2", "Tech scoping"],
                ["Wk 5", "Pilot region"],
                ["Wk 9", "First revenue"],
                ["Wk 14", "Full rollout"],
              ].map(([w, l]) => (
                <li key={l} className="bg-primary-foreground/[0.04] p-5">
                  <div className="font-display text-2xl text-accent">{w}</div>
                  <div className="mt-1 text-sm text-primary-foreground/80">{l}</div>
                </li>
              ))}
            </ol>
          </div>

          {/* risk & compliance */}
          <div className="mt-16 rounded-md border border-primary-foreground/15 bg-primary-foreground/[0.04] p-7">
            <div className="font-mono-tag text-accent">Risk & compliance posture</div>
            <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2 text-sm">
              {[
                ["Data boundary", "No customer PII leaves your tenancy under Options A or B. OAuth-scoped tokens only; no bulk export."],
                ["Hosting", "SOC 2 Type II, ISO 27001. EU and US regions, data resident to the partner's jurisdiction."],
                ["Regulatory", "Operating as agent / introducer in pilots. EMI license in UK; US activity routed through bank-sponsored partners."],
                ["Audit & DR", "Quarterly pen tests, 99.95% SLA, BCP/DR runbook shared in vendor onboarding. Reg-ready evidence pack on request."],
              ].map(([k, v]) => (
                <div key={k} className="border-t border-primary-foreground/10 pt-4">
                  <div className="font-mono-tag text-primary-foreground/60">{k}</div>
                  <p className="mt-2 text-primary-foreground/90">{v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PROOF OF DEMAND */}
      <section id="proof" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <SectionLabel n="04">Proof of Demand</SectionLabel>
          <h2 className="mt-6 max-w-3xl font-display text-4xl tracking-tight md:text-5xl">
            We don't have to convince you it works. We have to show you it already is.
          </h2>

          <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <figure className="rounded-md border border-border bg-card p-7 lg:col-span-2">
              <div className="font-mono-tag text-accent">Pilot · Tier-1 European bank</div>
              <blockquote className="mt-5 font-display text-2xl leading-snug tracking-tight md:text-3xl">
                "Activation hit 41% in the first 60 days — above the model Axal gave us at term sheet. The integration cleared our risk committee in one cycle."
              </blockquote>
              <figcaption className="mt-6 text-sm text-muted-foreground">
                — SVP, Digital Channels, Tier-1 European retail bank. Named reference available under mutual NDA; live since Q1 2025.
              </figcaption>
            </figure>
            <div className="grid grid-cols-1 gap-6">
              {[
                ["41%", "60-day activation · live pilot, 1.4M eligible users"],
                ["$11.2M", "Net new revenue · Y1, single partner, audited"],
                ["4.7 / 5", "In-app CSAT · n=18,400 post-integration"],
              ].map(([n, l]) => (
                <div key={l} className="rounded-md border border-border bg-card p-6">
                  <div className="font-display text-3xl tracking-tight">{n}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-14">
            <div className="font-mono-tag text-muted-foreground">Already shipping with — partner names disclosed under NDA</div>
            <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-border py-8 sm:grid-cols-3 md:grid-cols-6">
              {["Northbank", "Helios", "Coral Pay", "Vertex FS", "Lumen", "Atria"].map((b) => (
                <div key={b} className="font-display text-xl text-muted-foreground/80">{b}</div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Indicative codenames. Two of six are tier-1 retail banks; the rest are neobanks and card issuers.</p>
          </div>
        </div>
      </section>

      {/* AUDIENCE FIT */}
      <section id="audience" className="border-b border-border bg-secondary/40">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <SectionLabel n="05">Audience Fit</SectionLabel>
          <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-12">
            <h2 className="font-display text-4xl tracking-tight md:text-5xl lg:col-span-6">
              Who we bring you — described the way your segmentation team would.
            </h2>
            <p className="text-muted-foreground lg:col-span-6">
              No personas with first names. Real spend behavior, geography, and tenure bands you can match against your CRM.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { k: "Income band", v: "$85k–$220k HHI" },
              { k: "Age", v: "28 – 44, median 34" },
              { k: "Geography", v: "Tier-1 metros, 14 markets" },
              { k: "Digital tenure", v: "Mobile-first ≥ 6 yrs" },
              { k: "Spend behavior", v: "Avg. 18 txns/month" },
              { k: "Product literacy", v: "Holds 2.4 fintech apps" },
              { k: "Acquisition cost", v: "$32 blended (your channel: $0)" },
              { k: "Churn risk", v: "Low — 8% annualized" },
            ].map((a) => (
              <div key={a.k} className="rounded-md border border-border bg-card p-5">
                <div className="font-mono-tag text-muted-foreground">{a.k}</div>
                <div className="mt-2 font-display text-xl">{a.v}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-md border border-dashed border-border bg-card/60 p-6 text-sm text-muted-foreground">
            <span className="font-mono-tag text-foreground">Note —</span> We can produce a matched-cohort report against your book in 10 business days, under MNDA, before any commercial conversation.
          </div>

          {/* best fit / not a fit */}
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-md border border-border bg-card p-6">
              <div className="font-mono-tag text-accent">Best fit</div>
              <ul className="mt-4 space-y-3 text-sm">
                {[
                  "≥ 3M mobile MAUs in a tier-1 market (US, UK, DE, FR, NL)",
                  "Retail or mass-affluent book; primary-account relationship",
                  "An owned mobile app shipping fortnightly or faster",
                  "A named channel or partnerships lead with P&L authority",
                ].map((b) => (
                  <li key={b} className="flex gap-3"><span className="text-accent">●</span><span>{b}</span></li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border bg-card p-6">
              <div className="font-mono-tag text-muted-foreground">Not a fit (yet)</div>
              <ul className="mt-4 space-y-3 text-sm text-foreground/80">
                {[
                  "Sub-1M mobile MAU community or regional banks",
                  "Wholesale, custody, or correspondent-only institutions",
                  "Markets outside our current licensing footprint",
                  "Quarterly mobile release trains or fully outsourced app",
                ].map((b) => (
                  <li key={b} className="flex gap-3"><span className="text-muted-foreground">○</span><span>{b}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="cta" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <SectionLabel n="06">Next Step</SectionLabel>
              <h2 className="mt-6 font-display text-5xl leading-[1] tracking-tight md:text-7xl">
                Discuss <span className="italic text-accent">distribution fit</span>.
              </h2>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                A 30-minute working session with our founder and your channel lead. We arrive with a draft economic model against your specific book — not a slide deck.
              </p>
              <div className="mt-8 rounded-md border border-dashed border-border bg-secondary/40 p-5 text-sm">
                <span className="font-mono-tag text-foreground">What to send ahead —</span>
                <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 text-foreground/85">
                  {[
                    "Approx. retail book size",
                    "Active markets",
                    "Mobile MAUs (latest qtr)",
                    "Product lines in scope",
                  ].map((b) => (
                    <li key={b} className="flex gap-2"><span className="text-accent">→</span><span>{b}</span></li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">Five lines in an email is enough. No NDA needed to start.</p>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <a
                  href="mailto:partners@axal.vc?subject=Distribution%20fit%20—%20intro"
                  className="rounded-sm bg-foreground px-6 py-3.5 text-sm font-medium text-background transition hover:bg-foreground/85"
                >
                  Book the 30-min session →
                </a>
                <a
                  href="#"
                  className="rounded-sm border border-border px-6 py-3.5 text-sm font-medium text-foreground transition hover:bg-secondary"
                >
                  Download the 1-pager (PDF)
                </a>
              </div>
            </div>
            <aside className="lg:col-span-5">
              <div className="rounded-md border border-border bg-card p-7">
                <div className="font-mono-tag text-muted-foreground">What you'll leave with</div>
                <ul className="mt-5 space-y-4 text-sm">
                  {[
                    "A redlined term-sheet draft against your book",
                    "Economic model in your spreadsheet format",
                    "Named integration and compliance contacts",
                    "Written go / no-go criteria for a 90-day pilot",
                  ].map((b) => (
                    <li key={b} className="flex gap-3 border-b border-dashed border-border pb-4 last:border-0">
                      <span className="text-accent">●</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-background">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-10 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-sm bg-foreground text-background">
              <span className="font-display text-sm leading-none">A</span>
            </div>
            <span className="font-display">Axal</span>
            <span className="font-mono-tag ml-3 text-muted-foreground">
              Distribution brief · v2.6 · {new Date().getFullYear()}
            </span>
          </div>
          <div className="font-mono-tag text-muted-foreground">
            partners@axal.vc · NYC / LDN
          </div>
        </div>
      </footer>
    </div>
  );
}
