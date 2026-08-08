// Capital Ready Kit — miniaturized preview of brandtemplates/Capital Ready Kit/
// Mirrors renderCapitalReadyKit palette substitution: accent = signal, secondary = fills.
export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function CapitalReadyKitPreview({ data = {} }) {
  const {
    brandName = 'AXAL',
    headline = 'Autonomous execution infrastructure for capital markets.',
    subheadline = 'Axal is the agent runtime that takes institutional trading strategies from research to live capital — with the routing, risk, and audit layer funds would otherwise build in-house.',
    ctaText = 'Request intro',
    paletteBg = '#1b1a16',
    paletteInk = '#f4f1e6',
    paletteSecondary = '#3a382f',
    paletteAccent = '#c7e83f',
    logoUrl = null,
  } = data;

  const hairline = paletteSecondary;
  const muted = `${paletteInk}99`;
  const label = { fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.18em', color: muted };
  const sectionHead = (idx, title) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18 }}>
      <span style={{ fontSize: 9, color: muted }}>{idx}</span>
      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em' }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: hairline }} />
    </div>
  );

  const heroStats = [
    { k: 'Raising', v: '$4,000,000', s: 'Seed · priced' },
    { k: 'Committed', v: '62%', s: '$2,480,000 soft-circled' },
    { k: 'Lead', v: 'Soft-circled', s: 'Tier-1, named at close' },
    { k: 'Close', v: 'Aug 29, 2026', s: 'Final allocation' },
  ];
  const whyNow = [
    { n: '01', t: 'Models now reason inside the loop', d: 'Frontier models clear sub-100ms inference — fast enough to sit on the order path.' },
    { n: '02', t: 'Funds are unbundling the platform team', d: '47% of sub-$5B funds plan to retire an internal execution platform within 24 months.' },
    { n: '03', t: 'Execution-quality rules force an audit layer', d: 'SEC Rule 605 expansion makes hand-rolled logging uneconomic below $5B AUM.' },
  ];
  const traction = [
    { k: 'ARR', v: '$2.4M', s: '+38% MoM' },
    { k: 'Paying funds', v: '11', s: '3 added in Q2' },
    { k: 'Notional / mo', v: '$420M', s: 'Trailing 30d' },
    { k: 'Net retention', v: '164%', s: 'TTM, cohort-weighted' },
  ];
  const funds = [
    { pct: 50, l: 'Engineering', n: '8 hires — runtime, execution, infra.' },
    { pct: 25, l: 'Go-to-market', n: 'Enterprise AE + solutions engineering.' },
    { pct: 15, l: 'Research', n: 'Strategy library + model fine-tunes.' },
    { pct: 10, l: 'Compliance & ops', n: 'SOC 2 Type II, FINRA prep.' },
  ];
  const team = [
    { n: 'Maya Okafor', r: 'Co-founder, CEO', b: '7 yrs Citadel Securities — execution. Led order-routing for a $40B equities book.' },
    { n: 'Daniel Reiss', r: 'Co-founder, CTO', b: 'Jane Street (5 yrs) → Anthropic (inference infra). Co-author, 2 NeurIPS papers.' },
    { n: 'Priya Anand', r: 'Head of Research', b: 'PhD Statistics, Stanford. 9 yrs Two Sigma — systematic equities.' },
  ];

  return (
    <div data-testid="template-preview-capital-ready-kit" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: MONO, overflow: 'hidden' }}>
      {/* NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
            : <div style={{ width: 18, height: 18, background: paletteAccent, color: paletteBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontSize: 11 }}>{brandName.charAt(0)}</div>}
          <span style={{ fontSize: 10, letterSpacing: '0.12em' }}>{brandName.toUpperCase()}</span>
          <span style={{ fontSize: 8, color: muted }}>/ SEED · H2 2026</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 8, color: muted }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: paletteAccent }} />
            Final allocation · 38% remaining
          </span>
          <span style={{ background: paletteAccent, color: paletteBg, padding: '5px 9px', fontSize: 8, fontWeight: 600, letterSpacing: '0.05em' }}>{ctaText} →</span>
        </div>
      </div>

      {/* HERO */}
      <div style={{ padding: '34px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, ...label }}>
          <span>01 / Hero</span>
          <div style={{ flex: 1, height: 1, background: hairline }} />
          <span>Updated Jun 18, 2026</span>
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 36, lineHeight: 0.98, letterSpacing: '-0.01em', margin: 0 }}>
          {headline.replace(/\.\s*$/, '')}<em style={{ color: paletteAccent }}>.</em>
        </h1>
        <p style={{ marginTop: 14, maxWidth: 460, fontSize: 11, lineHeight: 1.6, color: muted }}>{subheadline}</p>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {heroStats.map((s) => (
            <div key={s.k} style={{ background: paletteBg, padding: '12px 12px 14px' }}>
              <div style={label}>{s.k}</div>
              <div style={{ fontFamily: SERIF, fontSize: 17, marginTop: 6 }}>{s.v}</div>
              <div style={{ fontSize: 8, color: muted, marginTop: 3 }}>{s.s}</div>
            </div>
          ))}
        </div>
      </div>

      {/* WHY NOW */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('03', 'Why now')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {whyNow.map((x) => (
            <div key={x.n} style={{ background: paletteBg, padding: 14 }}>
              <div style={{ fontSize: 9, color: muted }}>{x.n}</div>
              <div style={{ fontFamily: SERIF, fontSize: 14, marginTop: 8, lineHeight: 1.2 }}>{x.t}</div>
              <p style={{ marginTop: 6, fontSize: 9, lineHeight: 1.55, color: muted }}>{x.d}</p>
            </div>
          ))}
        </div>
      </div>

      {/* TRACTION */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('04', 'Traction')}
        <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 18 }}>
          <p style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1.25, margin: 0 }}>$1.2B notional executed through the platform in the last 90 days.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
            {traction.map((s) => (
              <div key={s.k} style={{ background: paletteBg, padding: 11 }}>
                <div style={label}>{s.k}</div>
                <div style={{ fontFamily: SERIF, fontSize: 16, marginTop: 5 }}>{s.v}</div>
                <div style={{ fontSize: 8, color: paletteAccent, marginTop: 3 }}>{s.s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ROUND DETAILS + USE OF FUNDS */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('05', 'Round details')}
        <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 14 }}>
          <div style={{ border: `1px solid ${hairline}`, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={label}>Target raise</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: muted }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: paletteAccent }} />Status · Final allocation
              </span>
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 30, marginTop: 8 }}>$4,000,000</div>
            <div style={{ marginTop: 12, height: 5, background: paletteSecondary }}>
              <div style={{ height: '100%', width: '62%', background: paletteAccent }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 8, color: muted }}>
              <span>$2,480,000 soft-circled</span><span>$1,520,000 remaining (38%)</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
            {[['Stage', 'Seed · priced'], ['Instrument', 'Series Seed'], ['Pre-money', '$28M'], ['Min check', '$250K']].map(([k, v]) => (
              <div key={k} style={{ background: paletteBg, padding: 10 }}>
                <div style={label}>{k}</div>
                <div style={{ fontFamily: SERIF, fontSize: 12, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ ...label, marginBottom: 8 }}>06 · Use of funds</div>
          <div style={{ display: 'grid', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
            {funds.map((r) => (
              <div key={r.l} style={{ display: 'grid', gridTemplateColumns: '50px 110px 1fr 110px', alignItems: 'center', gap: 10, background: paletteBg, padding: '9px 12px' }}>
                <div style={{ fontFamily: SERIF, fontSize: 15 }}>{r.pct}%</div>
                <div style={{ fontSize: 9, letterSpacing: '0.04em' }}>{r.l}</div>
                <div style={{ fontSize: 8.5, color: muted }}>{r.n}</div>
                <div style={{ height: 3, background: paletteSecondary }}>
                  <div style={{ height: '100%', width: `${r.pct}%`, background: paletteAccent }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TEAM */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('07', 'Team')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {team.map((p) => (
            <div key={p.n} style={{ background: paletteBg, padding: 12 }}>
              <div style={{ width: 34, height: 34, background: paletteSecondary }} />
              <div style={{ fontFamily: SERIF, fontSize: 13, marginTop: 8 }}>{p.n}</div>
              <div style={{ ...label, marginTop: 2 }}>{p.r}</div>
              <p style={{ marginTop: 6, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{p.b}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '30px 28px 34px' }}>
        <div style={{ margin: '0 auto', maxWidth: 460, textAlign: 'center', border: `1px solid ${paletteAccent}55`, background: `${paletteAccent}0f`, padding: '24px 26px' }}>
          <div style={{ ...label, color: paletteAccent }}>08 / Get in</div>
          <div style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1.05, marginTop: 10 }}>Warm intros first. Qualified inbound second.</div>
          <p style={{ marginTop: 8, fontSize: 9, color: muted }}>Funds writing $250K+ — we reply within 2 business days.</p>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <div style={{ flex: 1, maxWidth: 210, borderBottom: `1px solid ${hairline}`, padding: '7px 4px', fontSize: 9, color: muted, textAlign: 'left' }}>you@fund.com</div>
            <div style={{ background: paletteAccent, color: paletteBg, padding: '8px 14px', fontSize: 9, fontWeight: 600 }}>{ctaText} →</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 8, color: muted }}>invest@axal.co · Dataroom shared after first call</div>
        </div>
      </div>
    </div>
  );
}
