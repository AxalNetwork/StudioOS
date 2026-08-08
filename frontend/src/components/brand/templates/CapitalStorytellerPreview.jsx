// Capital Storyteller — miniaturized preview of brandtemplates/Capital Storyteller/
// Numbered confidential memo: diamond-bullet eyebrow, "01 — ..." hairline rules, bento stats.
export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function CapitalStorytellerPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'The agent runtime enterprises ship to production.',
    subheadline = 'Axal turns prototype agents into governed, observable systems. Deployed by 14 Fortune 500s in the last 9 months.',
    ctaText = 'Request intro',
    paletteBg = '#07090b',
    paletteInk = '#f2f6f8',
    paletteSecondary = '#26292c',
    paletteAccent = '#f2a618',
    logoUrl = null,
  } = data;

  const hairline = paletteSecondary;
  const muted = `${paletteInk}8c`;
  const mono = { fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.16em', color: muted };
  const rule = (labelTxt) => (
    <div style={{ borderTop: `1px solid ${hairline}`, borderBottom: `1px solid ${hairline}`, padding: '8px 28px' }}>
      <span style={mono}>{labelTxt}</span>
    </div>
  );
  const stat = (k, v) => (
    <div key={k} style={{ background: paletteBg, padding: 12 }}>
      <div style={mono}>{k}</div>
      <div style={{ fontFamily: SERIF, fontSize: 17, marginTop: 6 }}>{v}</div>
    </div>
  );

  const team = [
    ['Maya Okafor', 'CEO', "Built Stripe Issuing's policy engine (now $9B GMV/yr). MIT."],
    ['Daniel Reyes', 'CTO', "Led Anthropic's internal eval infra — the suite gating Claude releases. Stanford."],
    ['Priya Shah', 'Head of Eng', "Built Datadog APM's distributed-trace pipeline (1M+ spans/sec). CMU."],
  ];

  return (
    <div data-testid="template-preview-capital-storyteller" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
            : <div style={{ width: 18, height: 18, border: `1px solid ${paletteInk}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 6, height: 6, transform: 'rotate(45deg)', background: paletteAccent }} /></div>}
          <span style={{ fontFamily: SERIF, fontSize: 13 }}>{brandName}</span>
          <span style={{ ...mono, marginLeft: 4 }}>· Confidential</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...mono, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: paletteAccent }} />Round open · $6M seed
          </span>
          <span style={{ border: `1px solid ${paletteInk}`, background: paletteInk, color: paletteBg, padding: '5px 10px', fontSize: 9, fontWeight: 500, borderRadius: 2 }}>{ctaText} →</span>
        </div>
      </div>

      {/* HERO */}
      <div style={{ padding: '34px 28px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <span style={{ width: 6, height: 6, transform: 'rotate(45deg)', background: paletteAccent, display: 'inline-block' }} />
          <span style={mono}>Confidential investor brief</span>
          <span style={{ width: 32, height: 1, background: hairline }} />
          <span style={mono}>v.2026.06</span>
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 38, lineHeight: 1.02, margin: 0, maxWidth: 560 }}>
          {headline.includes('enterprises')
            ? <>The agent runtime <em style={{ color: muted }}>enterprises</em> ship to production.</>
            : headline}
        </h1>
        <p style={{ marginTop: 14, maxWidth: 440, fontSize: 11, lineHeight: 1.6, color: muted }}>{subheadline}</p>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {stat('Raising', '$6M')}{stat('Stage', 'Seed')}{stat('Lead', 'In conversation')}{stat('Close', 'Q3 2026')}
        </div>
      </div>

      {/* 02 — WHY NOW */}
      {rule('02 — Why now')}
      <div style={{ display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 20, padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div>
          <div style={{ ...mono, marginBottom: 6 }}>Timing</div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.15, margin: 0 }}>Agents moved from demo to budget line.</h2>
        </div>
        <div>
          {[
            ['$47B', 'projected enterprise agent spend by 2027 (Gartner forecast, Mar 2026).'],
            ['73%', 'of enterprise agent pilots stall on governance, not capability (a16z survey, n=412).'],
          ].map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '8px 0', borderBottom: i === 0 ? `1px solid ${hairline}` : 'none' }}>
              <span style={{ fontFamily: SERIF, fontSize: 26, color: paletteAccent }}>{k}</span>
              <span style={{ fontSize: 10, color: muted }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 03 — TRACTION */}
      {rule('03 — Traction')}
      <div style={{ display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 20, padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div>
          <div style={{ ...mono, marginBottom: 6 }}>Numbers</div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.15, margin: 0 }}>Compounding, not coasting.</h2>
        </div>
        <div style={{ border: `1px solid ${hairline}` }}>
          {[
            ['ARR', '$2.1M', '+38% MoM (trailing 3mo)'],
            ['Logos', '14', 'incl. 3 of top 10 US banks'],
            ['Net retention', '164%', 'trailing 6 months'],
          ].map(([k, v, n], i, a) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '90px 80px 1fr', alignItems: 'center', padding: '8px 12px', borderBottom: i < a.length - 1 ? `1px solid ${hairline}` : 'none' }}>
              <span style={mono}>{k}</span>
              <span style={{ fontFamily: SERIF, fontSize: 15 }}>{v}</span>
              <span style={{ fontSize: 9, color: muted, textAlign: 'right' }}>{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 04 — ROUND / 05 — USE OF FUNDS */}
      {rule('04 — Round · 05 — Use of funds')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div>
          <div style={{ ...mono, marginBottom: 8 }}>Terms — clean priced seed</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
            {stat('Raise', '$6M')}{stat('Post-money cap', '$30M')}{stat('Lead committed', '$2.5M')}{stat('Allocation left', '$1.8M')}
          </div>
        </div>
        <div>
          <div style={{ ...mono, marginBottom: 8 }}>Allocation — 24 months of runway</div>
          {[['Engineering', 55], ['Go-to-market', 30], ['Infra & R&D', 15]].map(([name, pct]) => (
            <div key={name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: SERIF, fontSize: 13 }}>{name}</span>
                <span style={mono}>{pct}%</span>
              </div>
              <div style={{ marginTop: 4, height: 2, background: hairline }}>
                <div style={{ height: '100%', width: `${pct}%`, background: paletteAccent }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 06 — TEAM */}
      {rule('06 — Team')}
      <div style={{ padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {team.map(([n, r, b]) => (
            <div key={n} style={{ background: paletteBg, padding: 12 }}>
              <div style={{ width: 28, height: 28, border: `1px solid ${hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontSize: 11 }}>
                {n.split(' ').map((x) => x[0]).join('')}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 13, marginTop: 8 }}>{n}</div>
              <div style={{ ...mono, marginTop: 2 }}>{r}</div>
              <p style={{ marginTop: 6, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{b}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 07 — NEXT / CTA */}
      {rule('07 — Next')}
      <div style={{ padding: '28px 28px 32px', textAlign: 'center' }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, lineHeight: 1.05, margin: '0 auto', maxWidth: 420 }}>
          Warm intro <em style={{ color: muted }}>is the fastest path</em>.
        </h2>
        <p style={{ margin: '10px auto 0', maxWidth: 380, fontSize: 9.5, color: muted }}>
          Best fit: B2B / AI infra funds writing $500K–$3M seed checks.
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <div style={{ width: 190, borderBottom: `1px solid ${hairline}`, padding: '7px 4px', fontFamily: MONO, fontSize: 9, color: muted, textAlign: 'left' }}>you@fund.com</div>
          <div style={{ background: paletteAccent, color: paletteBg, padding: '8px 14px', fontSize: 9, fontWeight: 600, borderRadius: 2 }}>{ctaText} →</div>
        </div>
        <div style={{ marginTop: 14, ...mono }}>{brandName} Inc. · Confidential · Not an offer to sell securities</div>
      </div>
    </div>
  );
}
