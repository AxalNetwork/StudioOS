import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Axal — Distribution Partnerships for Founders" },
      { name: "description", content: "A reusable partnership-memo template for founders pitching distribution partners. Quantify overlap, channel economics, and integration paths — replace the sample numbers with your own." },
    ],
  }),
  component: Index,
});

const PARTNER_TYPES = ["Retail chain", "SaaS platform", "Marketplace", "Carrier", "Bank", "Telco"];

function Index() {
  const [partner, setPartner] = useState("SaaS platform");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <UsageStrip />
      <Hero partner={partner} setPartner={setPartner} />
      <Overlap partner={partner} />
      <ChannelValue />
      <Integration />
      <Demand />
      <Audience />
      <CTA partner={partner} />
      <Footer />
    </div>
  );
}

function TopBar() {
  return (
    <header className="border-b hairline">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 bg-accent" />
          <span className="text-sm font-semibold tracking-tight">AXAL</span>
          <span className="mono ml-3 text-[10px] text-muted-foreground">DISTRIBUTION / V3.2</span>
        </div>
        <nav className="hidden gap-8 text-sm text-muted-foreground md:flex">
          <a href="#overlap" className="hover:text-foreground">Overlap</a>
          <a href="#channel" className="hover:text-foreground">Channel</a>
          <a href="#integration" className="hover:text-foreground">Integration</a>
          <a href="#demand" className="hover:text-foreground">Demand</a>
        </nav>
        <a href="#cta" className="border border-foreground bg-foreground px-4 py-2 text-xs font-medium text-background transition-colors hover:bg-transparent hover:text-foreground">
          Discuss distribution fit →
        </a>
      </div>
    </header>
  );
}

function UsageStrip() {
  return (
    <div className="border-b hairline bg-surface">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-3 text-[11px] text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="mono">
          TEMPLATE / READ-ME — Replace every <span className="text-foreground">[bracketed hint]</span> and any value tagged <span className="text-foreground">SAMPLE</span> with your own data. Structural copy (section titles, framing lines) is meant to stay.
        </div>
        <div className="mono hidden md:block">EDIT IN PLACE · ~30 MIN FIRST PASS</div>
      </div>
    </div>
  );
}

function Hero({ partner, setPartner }: { partner: string; setPartner: (p: string) => void }) {
  return (
    <section className="border-b hairline">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-0 px-6 py-20 lg:grid-cols-12 lg:py-28">
        <div className="lg:col-span-7 lg:pr-12">
          <div className="flex items-center gap-3 eyebrow">
            <span>01 / Hero</span>
            <span className="h-px w-12 bg-rule" />
            <span>Partnership memo template</span>
          </div>
          <h1 className="mt-8 text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
            Distribution is a<br />
            <span className="text-accent">numbers conversation.</span>
          </h1>
          <p className="mt-8 max-w-xl text-lg text-muted-foreground">
            Axal gives founders a reusable brief — and helps size the overlap behind it — for pitching{" "}
            <PartnerSelect value={partner} onChange={setPartner} /> partners. You bring the product and the
            target; the template gives you the structure their BD team can defend internally.
          </p>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground">
            <span className="mono text-[10px] uppercase tracking-[0.14em] text-foreground">Customize:</span>{" "}
            partner type, all metrics, segment table, integration timelines, quotes, and form copy.{" "}
            <span className="mono text-[10px] uppercase tracking-[0.14em] text-foreground">Keep:</span>{" "}
            section order, headings, and the framing sentences above each block.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a href="#cta" className="border border-foreground bg-foreground px-5 py-3 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-foreground">
              Discuss distribution fit
            </a>
            <a href="#overlap" className="border hairline px-5 py-3 text-sm text-foreground hover:bg-surface">
              See the model →
            </a>
          </div>
        </div>
        <div className="mt-16 border-l hairline lg:col-span-5 lg:mt-0 lg:pl-12">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Live brief — sample</div>
            <span className="mono text-[10px] text-accent">SAMPLE</span>
          </div>
          <dl className="mt-6 divide-y hairline border-y hairline">
            <Stat k="Addressable overlap" v="2.4M users" sub="62% of partner base · [your sizing]" />
            <Stat k="Conversion lift (pilot)" v="+18.7%" sub="vs partner baseline, 12-wk pilot" />
            <Stat k="Revenue per integrated user" v="$31.20 / yr" sub="net of rev-share · [your unit econ]" />
            <Stat k="Time to first revenue" v="42 days" sub="from signed term sheet" />
          </dl>
          <p className="mono mt-4 text-[10px] text-muted-foreground">
            ← FIGURES ARE SAMPLE / PLACEHOLDER. REPLACE WITH YOUR OWN, AND KEEP A ONE-LINE COHORT NOTE BELOW EACH.
          </p>
        </div>
      </div>
    </section>
  );
}

function PartnerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none border-b border-dashed border-foreground bg-transparent pr-5 font-medium text-foreground focus:outline-none"
      >
        {PARTNER_TYPES.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-xs">▾</span>
    </span>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="flex items-baseline justify-between py-4">
      <div>
        <div className="eyebrow">{k}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="mono text-2xl font-medium tabular-nums">{v}</div>
    </div>
  );
}

function SectionHead({ n, title, lede, howTo }: { n: string; title: string; lede: string; howTo?: string }) {
  return (
    <div className="grid grid-cols-1 gap-6 border-b hairline pb-10 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <div className="eyebrow">{n}</div>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
      </div>
      <div className="lg:col-span-7 lg:col-start-6">
        <p className="text-base text-muted-foreground">{lede}</p>
        {howTo && (
          <p className="mt-4 border-l-2 border-accent pl-3 text-xs text-foreground">
            <span className="mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">How to adapt — </span>
            {howTo}
          </p>
        )}
      </div>
    </div>
  );
}

function Overlap({ partner }: { partner: string }) {
  const rows = [
    { seg: "Enterprise > 1k seats", you: 38, them: 71, shared: 34 },
    { seg: "Mid-market 100–1k", you: 44, them: 22, shared: 19 },
    { seg: "SMB < 100", you: 18, them: 7, shared: 4 },
  ];
  return (
    <section id="overlap" className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          n="02 / Customer overlap"
          title="Where your book and theirs meet."
          lede={`Size the shared accounts inside the ${partner.toLowerCase()}'s installed base — by segment, geography, or contract value — so BD can see the deal before the first meeting.`}
          howTo="Replace the three segments with the cuts that matter for your category (seats, GMV, regulated vs. not, region). Use the partner's own segmentation language where you can — it shortens the internal sell."
        />
        <div className="mt-12 grid grid-cols-1 gap-0 lg:grid-cols-12">
          <div className="lg:col-span-7 lg:pr-10">
            <div className="mb-3 flex items-center justify-between">
              <span className="mono text-[10px] text-muted-foreground">[YOUR SEGMENTS · YOUR % · PARTNER % · SHARED %]</span>
              <span className="mono text-[10px] text-accent">SAMPLE</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className="eyebrow pb-3 font-normal">Segment</th>
                  <th className="eyebrow pb-3 text-right font-normal">You %</th>
                  <th className="eyebrow pb-3 text-right font-normal">Partner %</th>
                  <th className="eyebrow pb-3 text-right font-normal">Shared</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.seg} className="border-b hairline">
                    <td className="py-5">{r.seg}</td>
                    <td className="mono py-5 text-right tabular-nums">{r.you}%</td>
                    <td className="mono py-5 text-right tabular-nums">{r.them}%</td>
                    <td className="py-5 text-right">
                      <div className="ml-auto flex w-40 items-center justify-end gap-3">
                        <div className="h-1.5 flex-1 bg-surface">
                          <div className="h-full bg-accent" style={{ width: `${r.shared * 2.5}%` }} />
                        </div>
                        <span className="mono w-8 text-right tabular-nums">{r.shared}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="mt-10 border-t hairline pt-8 lg:col-span-4 lg:col-start-9 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <div className="eyebrow">Takeaway — sample</div>
            <p className="mt-4 text-sm leading-relaxed">
              [Write one sentence that turns the table into a deal. Example: "57k joint enterprise accounts already
              buy from both sides — a native handoff captures the majority without new acquisition spend."]
            </p>
            <div className="mt-8 border hairline p-4">
              <div className="eyebrow">Method</div>
              <p className="mt-2 text-xs text-muted-foreground">
                [Describe how you sized overlap — e.g. domain match against the partner's customer registry,
                deduplicated by parent entity, weighted by ACV. Be specific; their data team will check.]
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function ChannelValue() {
  const items = [
    { k: "Reach", v: "4.1M", sub: "Monthly active end-users routed through the channel. [your MAU base]" },
    { k: "Conversion", v: "9.4%", sub: "Trial-to-paid in a 90-day pilot vs. 3.1% on direct paid acquisition." },
    { k: "CAC delta", v: "−68%", sub: "Blended CAC vs. paid channels, pilot cohort (n≈1.2k). Not a steady-state claim." },
    { k: "Net revenue / acct", v: "$1,840", sub: "Year-one, after 20% partner rev-share. [your unit economics]" },
  ];
  return (
    <section id="channel" className="border-b hairline bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          n="03 / Channel value"
          title="What the channel is worth — to them, in their units."
          lede="Reach, conversion, and unit economics. Each number should be something the partner's RevOps team can verify in their own dashboard within a week."
          howTo="Pick four metrics the partner already tracks. Always pair the number with a one-line cohort note (n, time window, comparison baseline) so it reads as evidence, not marketing."
        />
        <div className="mt-6 flex items-center justify-between">
          <span className="mono text-[10px] text-muted-foreground">[REPLACE WITH YOUR FOUR HEADLINE METRICS]</span>
          <span className="mono text-[10px] text-accent">SAMPLE VALUES</span>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {items.map((i) => (
            <div key={i.k} className="bg-background p-8">
              <div className="eyebrow">{i.k}</div>
              <div className="mono mt-6 text-4xl font-medium tabular-nums">{i.v}</div>
              <p className="mt-4 text-sm text-muted-foreground">{i.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Integration() {
  const options = [
    {
      tag: "Option A",
      title: "Referral handoff",
      time: "2–4 weeks",
      lift: "Low",
      desc: "Co-branded link, attribution via UTM + server postback. No engineering on the partner side.",
      best: "Pilots and proof-of-fit phase.",
    },
    {
      tag: "Option B",
      title: "Embedded module",
      time: "6–10 weeks",
      lift: "Medium",
      desc: "iFrame or SDK inside the partner's product surface. Shared session, single billing event.",
      best: "When the partner owns the daily surface.",
    },
    {
      tag: "Option C",
      title: "Native rebuild",
      time: "12–20 weeks",
      lift: "High",
      desc: "First-party experience built against your API. Partner controls the UI; you run the engine.",
      best: "Strategic tier-one partners with a shared roadmap.",
    },
  ];
  return (
    <section id="integration" className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          n="04 / Integration & rollout"
          title="Three paths. Pick by ambition, not by capacity."
          lede="Each option is sized so the partner's product, legal, and security teams can sign off without rewriting their roadmap. Start narrow, expand as the numbers compound."
          howTo="Keep three tiers, but rewrite the titles and timelines to match what your stack actually supports. If you don't have a 'native' option ready, replace Option C with a deeper co-marketing tier — never invent capability."
        />
        <div className="mt-6 flex items-center justify-between">
          <span className="mono text-[10px] text-muted-foreground">[YOUR THREE ROLLOUT OPTIONS · ENG LIFT · TIMELINE]</span>
          <span className="mono text-[10px] text-accent">SAMPLE</span>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-0 border hairline md:grid-cols-3">
          {options.map((o, idx) => (
            <div key={o.title} className={`p-8 ${idx < 2 ? "border-b hairline md:border-b-0 md:border-r hairline" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="eyebrow">{o.tag}</span>
                <span className="mono text-[10px] text-muted-foreground">{o.time}</span>
              </div>
              <h3 className="mt-4 text-xl font-semibold">{o.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground">{o.desc}</p>
              <dl className="mt-6 space-y-2 border-t hairline pt-4 text-xs">
                <div className="flex justify-between"><dt className="text-muted-foreground">Eng lift</dt><dd>{o.lift}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Best for</dt><dd className="text-right">{o.best}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Demand() {
  const quotes = [
    { q: "We hit $400k ARR through the pilot channel in the first 90 days — no paid spend.", who: "Series A founder, fintech infra · sample cohort" },
    { q: "Three of the partner's top-10 accounts asked them to formalize the integration.", who: "Head of BD, vertical SaaS · sample cohort" },
  ];
  const proof = [
    { k: "Signed LOIs", v: "11", sub: "Across pilot cohort, last 2 quarters." },
    { k: "Pilots in market", v: "4", sub: "Live as of [date]." },
    { k: "Waitlisted partners", v: "27", sub: "Inbound, not outbound." },
    { k: "Pipeline coverage", v: "3.6×", sub: "Qualified pipe vs. quarter target." },
  ];
  return (
    <section id="demand" className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          n="05 / Proof of demand"
          title="Pull from the market, not a pitch."
          lede="Signed letters of intent, pilots already producing revenue, and inbound from partners who heard about it from their own customers."
          howTo="Use real artifacts only — LOI counts, named pilots, inbound logs. If you have one strong quote and no numbers yet, cut the grid and keep the quote. Empty boxes hurt more than fewer claims."
        />
        <div className="mt-6 flex items-center justify-between">
          <span className="mono text-[10px] text-muted-foreground">[YOUR QUOTES · YOUR COUNTS · TIME WINDOW]</span>
          <span className="mono text-[10px] text-accent">SAMPLE</span>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-0 lg:grid-cols-12">
          <div className="space-y-px bg-rule lg:col-span-7">
            {quotes.map((q) => (
              <figure key={q.who} className="bg-background p-8">
                <blockquote className="text-xl font-medium leading-snug tracking-tight md:text-2xl">
                  <span className="text-accent">“</span>{q.q}<span className="text-accent">”</span>
                </blockquote>
                <figcaption className="mono mt-4 text-xs text-muted-foreground">— {q.who}</figcaption>
              </figure>
            ))}
          </div>
          <div className="mt-px grid grid-cols-2 gap-px bg-rule lg:col-span-5 lg:mt-0 lg:ml-px">
            {proof.map((p) => (
              <div key={p.k} className="bg-background p-8">
                <div className="eyebrow">{p.k}</div>
                <div className="mono mt-4 text-4xl font-medium tabular-nums">{p.v}</div>
                <p className="mt-2 text-xs text-muted-foreground">{p.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Audience() {
  const fits = [
    { yes: true, txt: "Partner's customers buy in your category in the next 12 months — you can name the buying trigger." },
    { yes: true, txt: "Partner has a measurable revenue line (or retention metric) they want to defend or grow." },
    { yes: true, txt: "You can ship a pilot integration inside one quarter with current engineering capacity." },
    { yes: true, txt: "Your direct funnel already converts; the partner adds reach, not a fix for PMF." },
    { yes: false, txt: "You need the partner's brand more than their customers — this is a logo hunt, not distribution." },
    { yes: false, txt: "Your product still depends on heavy hand-holding or services to convert." },
    { yes: false, txt: "Your pricing only works at full direct margin (no room for a 15–25% partner share)." },
    { yes: false, txt: "You can't yet describe the ICP overlap with the partner in one sentence." },
  ];
  return (
    <section className="border-b hairline bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          n="06 / Audience fit"
          title="Who this brief is for — and who it isn't."
          lede="Distribution rewards companies with a clear wedge and a working funnel. If three or more of the right-column items describe you today, customize a different document — partnerships will magnify the gap, not close it."
          howTo="Treat this as a go / no-go gate before you invest a week customizing the rest. Edit the bullets to match the failure modes you've seen in your own category, but keep the four-and-four shape."
        />
        <ul className="mt-12 grid grid-cols-1 gap-0 border hairline bg-background md:grid-cols-2">
          {fits.map((f, i) => (
            <li
              key={f.txt}
              className={`flex items-start gap-4 p-6 ${i % 2 === 0 ? "md:border-r hairline" : ""} ${i < fits.length - 2 ? "border-b hairline" : ""}`}
            >
              <span
                className={`mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-xs font-medium ${
                  f.yes ? "bg-foreground text-background" : "border hairline text-muted-foreground"
                }`}
              >
                {f.yes ? "✓" : "—"}
              </span>
              <span className={`text-sm ${f.yes ? "text-foreground" : "text-muted-foreground"}`}>
                {f.txt}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CTA({ partner }: { partner: string }) {
  return (
    <section id="cta" className="border-b hairline bg-foreground text-background">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-background/60">
              07 / Next step
            </div>
            <h2 className="mt-6 text-4xl font-semibold tracking-tight md:text-6xl">
              Discuss distribution fit.
            </h2>
            <p className="mt-6 max-w-xl text-base text-background/70">
              Send the partner you're targeting and a one-line description of your product. We come back
              within 48 hours with overlap sizing and the integration option that matches the relationship's stage.
            </p>
            <div className="mt-8 max-w-xl border border-background/20 p-5">
              <div className="mono text-[10px] uppercase tracking-[0.14em] text-background/60">What makes a strong submission</div>
              <ul className="mt-3 space-y-2 text-sm text-background/80">
                <li>— One named target partner (not a category).</li>
                <li>— A product line readable by a non-expert in 12 words.</li>
                <li>— Current stage + one traction number you'd defend on a call.</li>
                <li>— Your ICP in one sentence, so we can sanity-check overlap fast.</li>
              </ul>
            </div>
          </div>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-4 lg:col-span-5">
            <Field label="Your name" name="name" placeholder="e.g. Jordan Reyes" />
            <Field label="Work email" name="email" type="email" placeholder="e.g. jordan@yourco.com" />
            <Field
              label="Target partner (named, not a category)"
              name="partner"
              placeholder={`e.g. Shopify, Chase, Verizon Business — not just "${partner}"`}
              defaultValue=""
            />
            <Field
              label="What you sell, in one line"
              name="pitch"
              placeholder="e.g. Real-time fraud scoring API for card issuers."
            />
            <Field
              label="Stage · traction · main ICP (one line)"
              name="context"
              placeholder="e.g. Seed · $42k MRR, 9% MoM · Series A/B fintechs in NA."
            />
            <button
              type="submit"
              className="w-full border border-background bg-background px-5 py-4 text-sm font-medium text-foreground transition-colors hover:bg-transparent hover:text-background"
            >
              Request distribution review →
            </button>
            <p className="mono text-[10px] text-background/50">
              NDA AVAILABLE ON REQUEST. NO MAILING LIST. NO DRIP CAMPAIGN.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}

function Field({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mono text-[10px] uppercase tracking-[0.14em] text-background/60">{label}</span>
      <input
        name={name}
        {...rest}
        className="mt-2 w-full border-b border-background/30 bg-transparent py-3 text-sm text-background placeholder:text-background/40 focus:border-background focus:outline-none"
      />
    </label>
  );
}

function Footer() {
  return (
    <footer className="bg-background">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-6 py-10 text-xs text-muted-foreground md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 bg-accent" />
          <span className="mono">AXAL / DISTRIBUTION TEMPLATE</span>
        </div>
        <div className="mono">© {new Date().getFullYear()} — Built for founders pursuing channel deals.</div>
      </div>
    </footer>
  );
}
