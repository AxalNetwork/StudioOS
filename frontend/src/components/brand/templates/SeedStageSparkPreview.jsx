// Seed Stage Spark — miniaturized preview of brandtemplates/Seed Stage Spark/
// High-energy dark seed teaser: grid-line hero, mono metrics, logo strip, ARR bar chart.
export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function SeedStageSparkPreview({ data = {} }) {
  const {
    brandName = 'axal',
    headline = 'The infrastructure layer for agent commerce.',
    subheadline = 'Axal gives autonomous AI agents the payments, identity, and policy primitives they need to transact on behalf of real businesses — safely, auditably, and at scale.',
    ctaText = 'Schedule call',
    paletteBg = '#0b0e0f',
    paletteInk = '#f2f6f8',
    paletteSecondary = '#25292c',
    paletteAccent = '#abf051',
    logoUrl = null,
  } = data;

  const border = paletteSecondary;
  const muted = `${paletteInk}8c`;
  const card = `${paletteInk}08`;
  const mono = { fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.16em', color: muted };
  const eyebrow = (txt) => (
    <div style={{ ...mono, marginBottom: 6 }}>{txt}</div>
  );
  const dot = <span style={{ width: 5, height: 5, borderRadius: '50%', background: paletteAccent, display: 'inline-block' }} />;
  const cell = (k, v, d, large) => (
    <div key={k} style={{ background: paletteBg, padding: 12 }}>
      <div style={mono}>{k}</div>
      <div style={{ fontFamily: MONO, fontSize: large ? 20 : 15, marginTop: 5 }}>{v}</div>
      {d && <div style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent, marginTop: 3 }}>{d}</div>}
    </div>
  );

  const bars = [
    ['Jan', 410], ['Feb', 520], ['Mar', 640], ['Apr', 790], ['May', 980], ['Jun', 1180], ['Jul', 1400],
  ];
  const max = 1400;
  const pillars = [
    ['Agent identity', '11M', 'agent sessions / mo', 'Scoped, revocable credentials mapping every transaction to an agent, principal, and policy.'],
    ['Programmable payments', '$94M', 'annualized GMV', 'Stablecoin and card rails with spend caps and per-task budgets enforced at the edge.'],
    ['Policy & audit', '99.99%', 'policy uptime', 'Deterministic policy engine with immutable logs — every action explainable.'],
  ];
  const team = [
    ['Maya Okafor', 'Co-founder & CEO', 'Early PM on Stripe Issuing. Shipped programmable cards to 40k+ businesses.'],
    ['Daniel Reiss', 'Co-founder & CTO', 'Staff eng at Anthropic infra. Led agent runtime work prior to Axal.'],
    ['Priya Anand', 'Head of Risk', '10y at Plaid and Marqeta on fraud, BSA/AML, and bank partner programs.'],
  ];

  return (
    <div data-testid="template-preview-seed-stage-spark" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 28px', borderBottom: `1px solid ${border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 17, height: 17, objectFit: 'contain' }} />
            : <div style={{ width: 17, height: 17, borderRadius: 2, background: paletteAccent, color: paletteBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10, fontWeight: 700 }}>{brandName.charAt(0).toUpperCase()}</div>}
          <span style={{ fontFamily: MONO, fontSize: 10 }}>{brandName.toLowerCase()}</span>
          <span style={{ ...mono, marginLeft: 4 }}>/ Seed memo</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...mono, display: 'flex', alignItems: 'center', gap: 5, textTransform: 'none', letterSpacing: 0, fontSize: 8.5 }}>{dot} Round open · Closing Q3 2026</span>
          <span style={{ background: paletteAccent, color: paletteBg, padding: '5px 10px', fontFamily: MONO, fontSize: 9, fontWeight: 600, borderRadius: 2 }}>{ctaText} →</span>
        </div>
      </div>

      {/* HERO with grid-line backdrop */}
      <div style={{
        position: 'relative', padding: '30px 28px 26px', borderBottom: `1px solid ${border}`,
        backgroundImage: `linear-gradient(${paletteInk}0d 1px, transparent 1px), linear-gradient(90deg, ${paletteInk}0d 1px, transparent 1px)`,
        backgroundSize: '36px 36px',
      }}>
        <div style={{ ...mono, display: 'flex', alignItems: 'center', gap: 6 }}>{dot} Seed · $6M · $3.2M soft-circled</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 34, lineHeight: 1.05, margin: '12px 0 0', maxWidth: 520 }}>{headline}</h1>
        <p style={{ marginTop: 12, maxWidth: 460, fontSize: 11, lineHeight: 1.6, color: muted }}>{subheadline}</p>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ background: paletteAccent, color: paletteBg, padding: '7px 14px', fontFamily: MONO, fontSize: 10, fontWeight: 600, borderRadius: 2 }}>See the deck ↗</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: muted, textDecoration: 'underline', textUnderlineOffset: 3 }}>Round details ↓</span>
        </div>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
          {cell('ARR', '$1.4M', '+18% MoM', true)}
          {cell('Paying customers', '47', '12 Fortune 1000', true)}
          {cell('Net dollar retention', '142%', 'trailing 6mo', true)}
          {cell('Gross margin', '84%', 'infra-adjusted', true)}
        </div>
      </div>

      {/* LOGO STRIP */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '12px 28px', borderBottom: `1px solid ${border}`, background: card }}>
        <span style={mono}>Powering agents at</span>
        <div style={{ display: 'flex', gap: 16, fontFamily: MONO, fontSize: 9.5, color: muted }}>
          {['Ramp', 'Linear', 'Notion', 'Vercel', 'Mercury', 'Brex'].map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>

      {/* PRODUCT PILLARS */}
      <div style={{ padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
        {eyebrow('01 / Product')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 14px' }}>Three primitives. One agent transaction stack.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
          {pillars.map(([t, m, ml, b]) => (
            <div key={t} style={{ background: card, padding: 13 }}>
              <div style={mono}>{ml}</div>
              <div style={{ fontFamily: MONO, fontSize: 19, color: paletteAccent, marginTop: 8 }}>{m}</div>
              <div style={{ fontSize: 11, fontWeight: 500, marginTop: 8 }}>{t}</div>
              <p style={{ marginTop: 4, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{b}</p>
            </div>
          ))}
        </div>
      </div>

      {/* TRACTION BAR CHART */}
      <div style={{ padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
        {eyebrow('03 / Traction')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 14px' }}>ARR up 3.4× in seven months.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14 }}>
          <div style={{ border: `1px solid ${border}`, borderRadius: 2, background: card, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <div style={mono}>Monthly recurring revenue (K)</div>
                <div style={{ fontFamily: MONO, fontSize: 18, marginTop: 3 }}>$1,400K</div>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 9, color: paletteAccent }}>▲ +18% MoM</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
              {bars.map(([m, v]) => (
                <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${(v / max) * 100}%`, background: paletteAccent, opacity: 0.9 }} />
                  <div style={{ fontFamily: MONO, fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.12em', color: muted }}>{m}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
            {cell('New logos (Q2)', '19', 'vs. 7 in Q1')}
            {cell('Pipeline coverage', '4.1×', 'next quarter quota')}
            {cell('Avg ACV', '$38K', '+62% YoY')}
          </div>
        </div>
      </div>

      {/* TEAM + ROUND */}
      <div style={{ padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
        {eyebrow('05 / Team')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
          {team.map(([n, r, b]) => (
            <div key={n} style={{ background: card, padding: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 2, border: `1px solid ${border}`, background: `${paletteInk}0d`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10 }}>
                {n.split(' ').map((x) => x[0]).join('')}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, marginTop: 8 }}>{n}</div>
              <div style={{ ...mono, marginTop: 2 }}>{r}</div>
              <p style={{ marginTop: 5, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{b}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          {eyebrow('06 / Round — Raising $6M Seed')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
            {cell('Target', '$6M')}
            {cell('Committed', '$3.2M')}
            {cell('Valuation', '$32M post')}
            {cell('Timeline', 'Q3 2026')}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '28px 28px 32px', background: card, textAlign: 'center' }}>
        <div style={{ ...mono, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{dot} Investor access · Closing Q3 2026</div>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 24, lineHeight: 1.1, margin: '10px auto 0', maxWidth: 400 }}>
          See the deck or schedule an investor call.
        </h2>
        <p style={{ margin: '8px auto 0', maxWidth: 360, fontSize: 9.5, color: muted }}>
          Full data room — cohort exports, contracts, financial model — after a 30-minute intro call.
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <div style={{ width: 190, border: `1px solid ${border}`, borderRadius: 2, padding: '7px 9px', fontFamily: MONO, fontSize: 9, color: muted, textAlign: 'left', background: paletteBg }}>you@fund.com</div>
          <div style={{ background: paletteAccent, color: paletteBg, padding: '8px 14px', fontFamily: MONO, fontSize: 9, fontWeight: 600, borderRadius: 2 }}>{ctaText} ↗</div>
        </div>
        <div style={{ marginTop: 14, ...mono }}>{brandName.toLowerCase()} · seed memo · 2026 · Confidential — do not distribute</div>
      </div>
    </div>
  );
}
