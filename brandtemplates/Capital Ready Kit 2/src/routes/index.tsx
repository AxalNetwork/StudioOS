import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Seed Round" },
      { name: "description", content: "Axal is raising a seed round. Autonomous execution infrastructure for capital markets." },
      { property: "og:title", content: "Axal — Seed Round" },
      { property: "og:description", content: "Autonomous execution infrastructure for capital markets. Live fundraise." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Page,
});

function SectionLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="mb-10 flex items-baseline justify-between gap-6">
      <div className="flex items-baseline gap-4">
        <span className="text-xs text-muted-foreground">{index}</span>
        <h2 className="text-xs uppercase tracking-[0.2em] text-foreground">{title}</h2>
      </div>
      <div className="hidden h-px flex-1 bg-hairline md:block" />
    </div>
  );
}

function Cite({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 align-middle font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
      [{children}]
    </span>
  );
}

function Page() {
  const [raise, setRaise] = useState(4_000_000);
  const [editing, setEditing] = useState(false);

  const raiseFmt = useMemo(
    () => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(raise),
    [raise],
  );

  const committedPct = 62;
  const remainingPct = 100 - committedPct;
  const remainingFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(raise * (remainingPct / 100)),
  );
  const committedFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(raise * (committedPct / 100)),
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-signal text-signal-foreground">
              <span className="font-display text-sm leading-none">A</span>
            </div>
            <span className="text-sm tracking-wider">AXAL</span>
            <span className="ml-3 hidden text-xs text-muted-foreground sm:inline">/ SEED · H2 2026</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-signal opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
              </span>
              Final allocation · {remainingPct}% remaining
            </span>
            <a href="#intro" className="bg-signal px-3 py-2 text-xs font-medium tracking-wide text-signal-foreground hover:opacity-90">
              Request intro →
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="mb-10 flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <span>01 / Hero</span>
            <span className="h-px flex-1 bg-hairline" />
            <span>Updated Jun 18, 2026</span>
          </div>
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight md:text-7xl lg:text-8xl">
            Autonomous execution<br />
            infrastructure for <em className="text-signal">capital markets</em>.
          </h1>
          <p className="mt-8 max-w-2xl text-base text-muted-foreground md:text-lg">
            Axal is the agent runtime that takes institutional trading strategies from research to live capital — with the routing, risk, and audit layer funds would otherwise build in-house.
          </p>

          <div className="mt-14 grid grid-cols-2 gap-px border border-hairline bg-hairline md:grid-cols-4">
            {[
              { k: "Raising", v: raiseFmt, sub: "Seed · priced" },
              { k: "Committed", v: `${committedPct}%`, sub: `${committedFmt} soft-circled` },
              { k: "Lead", v: "Soft-circled", sub: "Tier-1, named at close" },
              { k: "Close", v: "Aug 29, 2026", sub: "Final allocation" },
            ].map((s) => (
              <div key={s.k} className="bg-background px-5 py-6">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.k}</div>
                <div className="mt-2 font-display text-2xl md:text-3xl">{s.v}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a href="#intro" className="bg-signal px-5 py-3 text-sm font-medium text-signal-foreground hover:opacity-90">
              Request intro
            </a>
            <a href="#round" className="border border-border px-5 py-3 text-sm text-foreground hover:bg-accent">
              Round details
            </a>
          </div>
        </div>
      </section>

      {/* WHAT WE DO */}
      <Section index="02" title="What we do">
        <div className="grid gap-10 md:grid-cols-12">
          <p className="font-display text-3xl leading-tight md:col-span-7 md:text-4xl">
            We turn quantitative strategies into production trading systems in days, not quarters.
          </p>
          <div className="space-y-6 text-sm text-muted-foreground md:col-span-5">
            <p>One runtime. Backtest, simulate, deploy. Funds bring the alpha; we replace the platform team, the broker integrations, and the compliance plumbing in between.</p>
            <ul className="space-y-3">
              {[
                { t: "Strategy DSL with deterministic, bit-reproducible replay", c: "Independently audited by Trail of Bits, Apr 2026" },
                { t: "Median 740µs order-to-wire across 14 venues", c: "Internal exec logs, 30d rolling, May 2026" },
                { t: "Pre-trade risk + MiFID II / Reg NMS audit log in the kernel", c: "Reviewed by ACA Group, Q1 2026" },
              ].map((x) => (
                <li key={x.t} className="flex gap-3">
                  <span className="text-signal">▸</span>
                  <span>
                    <span className="text-foreground">{x.t}</span>
                    <Cite>{x.c}</Cite>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* WHY NOW */}
      <Section index="03" title="Why now">
        <div className="grid gap-px border border-hairline bg-hairline md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Models now reason inside the loop",
              d: "Frontier models clear sub-100ms inference on quantized weights — fast enough to sit on the order path, not just on overnight research.",
              c: "MLPerf Inference v4.1, Mar 2026",
            },
            {
              n: "02",
              t: "Funds are unbundling the platform team",
              d: "47% of sub-$5B funds plan to retire an internal execution platform within 24 months. Build-vs-buy has flipped.",
              c: "Coalition Greenwich, Buy-Side Tech Survey 2026",
            },
            {
              n: "03",
              t: "Execution-quality rules force an audit layer",
              d: "SEC Rule 605 expansion (effective Dec 2025) and ESMA RTS 27 revival make hand-rolled logging uneconomic below $5B AUM.",
              c: "SEC Release No. 34-99679",
            },
          ].map((x) => (
            <div key={x.n} className="bg-background p-6">
              <div className="text-xs text-muted-foreground">{x.n}</div>
              <div className="mt-4 font-display text-xl">{x.t}</div>
              <p className="mt-3 text-sm text-muted-foreground">{x.d}</p>
              <div className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Source · {x.c}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* TRACTION */}
      <Section index="04" title="Traction">
        <div className="grid gap-8 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="font-display text-3xl leading-tight md:text-4xl">
              $1.2B notional executed through the platform in the last 90 days.
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Source · Internal execution ledger, Mar–May 2026. Reconciled monthly against customer prime-broker statements.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px border border-hairline bg-hairline md:col-span-7">
            {[
              { k: "ARR", v: "$2.4M", sub: "+38% MoM", c: "Stripe-billed, May 2026" },
              { k: "Paying funds", v: "11", sub: "3 added in Q2", c: "Signed MSAs" },
              { k: "Notional / mo", v: "$420M", sub: "Trailing 30d", c: "Exec ledger" },
              { k: "Net retention", v: "164%", sub: "TTM, cohort-weighted", c: "Cohort: Q2 2025 customers" },
            ].map((s) => (
              <div key={s.k} className="bg-background p-5">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.k}</div>
                <div className="mt-2 font-display text-2xl">{s.v}</div>
                <div className="mt-1 text-xs text-signal">{s.sub}</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  {s.c}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12">
          <div className="mb-4 flex items-baseline justify-between text-xs uppercase tracking-widest text-muted-foreground">
            <span>Customers</span>
            <span className="font-mono text-[10px] normal-case tracking-wider">Logos used with written permission · 2 additional under NDA</span>
          </div>
          <div className="grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-3 md:grid-cols-6">
            {["Helix Capital", "Northbeam", "Vega Partners", "Quanta", "Meridian", "Orca Asset Mgmt"].map((c) => (
              <div key={c} className="bg-background px-4 py-6 text-center text-xs tracking-wider text-muted-foreground">
                {c.toUpperCase()}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ROUND DETAILS */}
      <Section index="05" title="Round details" id="round">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-7">
            <div className="border border-border p-8">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Target raise</div>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                  Status · Final allocation
                </div>
              </div>
              <div className="mt-4 flex items-end gap-4">
                {editing ? (
                  <input
                    autoFocus
                    type="number"
                    value={raise}
                    onChange={(e) => setRaise(Number(e.target.value) || 0)}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
                    className="w-full bg-transparent font-display text-5xl outline-none md:text-6xl"
                  />
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="group text-left font-display text-5xl tracking-tight hover:text-signal md:text-6xl"
                    title="Click to edit"
                  >
                    {raiseFmt}
                    <span className="ml-3 align-middle text-xs uppercase tracking-widest text-muted-foreground opacity-0 transition group-hover:opacity-100">
                      ✎ edit
                    </span>
                  </button>
                )}
              </div>
              <div className="mt-8 h-2 w-full overflow-hidden bg-secondary">
                <div className="h-full bg-signal" style={{ width: `${committedPct}%` }} />
              </div>
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <span>{committedFmt} soft-circled</span>
                <span>{remainingFmt} remaining ({remainingPct}%)</span>
              </div>
              <p className="mt-6 border-t border-hairline pt-4 text-xs text-muted-foreground">
                Lead is soft-circled at $2.0M and will be named at close. Remaining allocation prioritized for fund-of-funds, strategic LPs in quant funds, and operators from execution / market-structure backgrounds. Pro-rata reserved for existing seed investors.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px border border-hairline bg-hairline md:col-span-5">
            {[
              ["Stage", "Seed · priced"],
              ["Instrument", "Series Seed preferred"],
              ["Pre-money", "$28M"],
              ["Post-money", "$32M"],
              ["Min check", "$250K"],
              ["Close", "Aug 29, 2026"],
            ].map(([k, v]) => (
              <div key={k} className="bg-background p-5">
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</dt>
                <dd className="mt-2 font-display text-lg">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Allocation figures updated weekly · Last updated Jun 18, 2026
        </p>
      </Section>

      {/* USE OF FUNDS */}
      <Section index="06" title="Use of funds">
        <div className="space-y-px bg-hairline">
          {[
            { pct: 50, label: "Engineering", note: "8 hires — runtime, execution, infra. ~22 month runway." },
            { pct: 25, label: "Go-to-market", note: "Enterprise AE + solutions engineering. Target: 18 paying funds by close." },
            { pct: 15, label: "Research", note: "Strategy library + model fine-tunes on execution data." },
            { pct: 10, label: "Compliance & ops", note: "SOC 2 Type II (in audit, Q3 2026), FINRA membership prep." },
          ].map((r) => (
            <div key={r.label} className="grid grid-cols-12 items-center gap-4 bg-background px-5 py-5">
              <div className="col-span-12 md:col-span-3">
                <div className="font-display text-2xl">{r.pct}%</div>
              </div>
              <div className="col-span-12 md:col-span-3">
                <div className="text-sm tracking-wide">{r.label}</div>
              </div>
              <div className="col-span-12 text-sm text-muted-foreground md:col-span-4">{r.note}</div>
              <div className="col-span-12 md:col-span-2">
                <div className="h-1 w-full bg-secondary">
                  <div className="h-full bg-signal" style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* TEAM */}
      <Section index="07" title="Team">
        <div className="grid gap-px border border-hairline bg-hairline md:grid-cols-3">
          {[
            { n: "Maya Okafor", r: "Co-founder, CEO", b: "7 yrs Citadel Securities — execution. Led order-routing for a $40B equities book; shipped the smart-order-router rewrite (2023)." },
            { n: "Daniel Reiss", r: "Co-founder, CTO", b: "Jane Street (5 yrs, core dev) → Anthropic (inference infra, 2 yrs). Co-author, 2 NeurIPS papers on low-latency model serving." },
            { n: "Priya Anand", r: "Head of Research", b: "PhD Statistics, Stanford (2017). 9 yrs Two Sigma — systematic equities. 4 published papers on execution-cost modeling." },
          ].map((p) => (
            <div key={p.n} className="bg-background p-6">
              <div className="aspect-square w-full bg-secondary" />
              <div className="mt-4 font-display text-xl">{p.n}</div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{p.r}</div>
              <p className="mt-3 text-sm text-muted-foreground">{p.b}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Backed at pre-seed by operators from Anthropic, Stripe, Two Sigma, and Citadel Securities. Full cap table and references available in the dataroom on request.
        </p>
      </Section>

      {/* CTA */}
      <section id="intro" className="border-t border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="grid gap-12 md:grid-cols-12">
            <div className="md:col-span-7">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">08 / Get in</div>
              <h2 className="mt-6 font-display text-5xl leading-[0.95] tracking-tight md:text-6xl">
                Warm intros first. Qualified inbound second.
              </h2>
              <div className="mt-8 space-y-6 text-sm text-muted-foreground">
                <div>
                  <div className="text-xs uppercase tracking-widest text-foreground">Preferred — warm intro</div>
                  <p className="mt-2 max-w-lg">
                    A one-line intro from a current investor, customer, or operator we've worked with gets a same-week meeting. Our investor list is in the dataroom.
                  </p>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-foreground">Direct — qualified funds</div>
                  <p className="mt-2 max-w-lg">
                    No mutual? If you're a fund writing $250K+ with prior fintech / infra investments, use the form. We reply within 2 business days with either a meeting or a clear pass.
                  </p>
                </div>
                <div className="pt-2">
                  <div className="text-xs uppercase tracking-widest text-foreground">Direct contact</div>
                  <p className="mt-2 font-mono text-sm text-foreground">invest@axal.co</p>
                </div>
              </div>
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); alert("Request received. We'll respond within 2 business days."); }}
              className="space-y-4 border border-border p-6 md:col-span-5"
            >
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Name</label>
                <input className="mt-2 w-full border-b border-hairline bg-transparent py-2 text-sm outline-none focus:border-signal" required />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Firm</label>
                <input className="mt-2 w-full border-b border-hairline bg-transparent py-2 text-sm outline-none focus:border-signal" required />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Check size</label>
                <select className="mt-2 w-full border-b border-hairline bg-transparent py-2 text-sm outline-none focus:border-signal" required defaultValue="">
                  <option value="" disabled className="bg-background">Select range</option>
                  <option className="bg-background">$250K – $500K</option>
                  <option className="bg-background">$500K – $1M</option>
                  <option className="bg-background">$1M – $2M</option>
                  <option className="bg-background">$2M+ (lead consideration)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Mutual connection <span className="normal-case tracking-normal text-muted-foreground/70">(optional)</span></label>
                <input placeholder="Who can intro you?" className="mt-2 w-full border-b border-hairline bg-transparent py-2 text-sm outline-none focus:border-signal" />
              </div>
              <button type="submit" className="mt-4 w-full bg-signal py-3 text-sm font-medium text-signal-foreground hover:opacity-90">
                Request intro →
              </button>
              <p className="text-xs text-muted-foreground">Reply within 2 business days. Dataroom shared after first call.</p>
            </form>
          </div>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs text-muted-foreground">
          <div>© 2026 Axal Labs, Inc.</div>
          <div className="flex flex-wrap gap-6">
            <span>Confidential — for prospective investors. Do not forward.</span>
            <span className="font-mono">Rev. 2026.06.18</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Section({ index, title, id, children }: { index: string; title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-b border-hairline">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <SectionLabel index={index} title={title} />
        {children}
      </div>
    </section>
  );
}
