export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

function SectionLabel({ n, t, accent, secondary }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, color: accent }}>{n}</span>
      <span style={{ flex: 1, height: 1, background: secondary }} />
      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.55 }}>{t}</span>
    </div>
  );
}

export default function CoFounderCanvasPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'I am building the agent layer for capital markets.',
    subheadline = 'A runtime that turns trading strategies — expressed in code or natural language — into verifiable, audited execution across exchanges.',
    ctaText = 'Talk about joining',
    themeColor = '#cc572a',
    paletteBg = '#f8f5ee',
    paletteInk = '#1d140d',
    paletteSecondary = '#ede7dd',
    paletteAccent = '#cc572a',
    logoUrl = null,
  } = data;
  const lm = { fontFamily: MONO, fontSize: 8, letterSpacing: '.2em', textTransform: 'uppercase', opacity: 0.6 };
  const built = [
    ['Execution engine v0.4', 'Rust core, deterministic replay, ~14k LOC. Running in production.'],
    ['First design partner', 'A $400M crypto-native fund. Two strategies live, $11M notional this quarter.'],
    ['Seed round', '$4.2M closed in March. Lead is a top-tier fund. No board yet.'],
  ];
  const have = [
    'Built and operated systems where downtime is measured in basis points, not pages.',
    'Worked deep in HFT infra, exchange matching, or a serious distributed database.',
    'Shipped Rust, C++, or Go in production.',
  ];
  const not = [
    'Need to know finance. I will teach you.',
    'Want to manage a team of forty. We stay small on purpose.',
    'Care about the title now. It will be there later.',
  ];
  return (
    <div data-testid="template-preview-co-founder-canvas" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden', lineHeight: 1.6 }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 34px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover' }} />
            : <span style={{ width: 7, height: 7, borderRadius: '50%', background: paletteAccent, display: 'inline-block' }} />}
          <b style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 500 }}>{brandName}</b>
        </div>
        <span style={{ fontSize: 10, border: `1px solid ${paletteInk}`, borderRadius: 999, padding: '5px 13px' }}>Talk to me</span>
      </div>
      {/* Hero */}
      <div style={{ padding: '28px 34px 34px' }}>
        <div style={lm}>A letter from the founder · 2026</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 40, lineHeight: 1.02, letterSpacing: '-.02em', margin: '12px 0 16px', maxWidth: '18ch' }}>
          {headline} <em style={{ fontStyle: 'italic', color: paletteAccent }}>I can't do it alone.</em>
        </h1>
        <p style={{ fontSize: 12.5, margin: '0 0 8px', maxWidth: '58ch' }}>{subheadline}</p>
        <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 18px', maxWidth: '60ch' }}>
          The company is small, serious, and funded. What I am missing is the technical co-founder. This page is for that person.
        </p>
        <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 999, padding: '10px 20px' }}>{ctaText}</span>
        <span style={{ marginLeft: 14, fontFamily: MONO, fontSize: 8.5, textDecoration: 'underline', textUnderlineOffset: 3 }}>Read the whole thing first</span>
        {/* Facts strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, borderTop: `1px solid ${paletteSecondary}`, marginTop: 26, paddingTop: 16 }}>
          {[['Stage', 'Seed, closed'], ['Team', '3 → 5'], ['Equity', 'Real co-founder %'], ['Location', 'SF, in person']].map(([k, v]) => (
            <div key={k}>
              <div style={lm}>{k}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      {/* 01 Building */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="01" t="What we are building" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 24 }}>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 21, lineHeight: 1.15, margin: 0 }}>An execution layer for autonomous financial agents.</h2>
          <p style={{ fontSize: 11, opacity: 0.82, margin: 0 }}>
            The gap between intent and execution is where all the risk lives — and where the work is. If LLMs are the brain, we are the hands — and the conscience.
          </p>
        </div>
      </div>
      {/* 03 Already built — left-accent-border list */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="03" t="Already built" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 24 }}>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 21, lineHeight: 1.15, margin: 0 }}>You're not joining an idea.</h2>
          <div>
            {built.map(([t, b]) => (
              <div key={t} style={{ borderLeft: `2px solid ${paletteAccent}`, padding: '2px 0 2px 13px', marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 13.5 }}>{t}</div>
                <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 1 }}>{b}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 04 Dark gap slab */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '30px 34px 32px' }}>
        <div style={{ ...lm, opacity: 1, color: paletteAccent }}>04 — What's missing</div>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 34, lineHeight: 1.05, margin: '10px 0 14px' }}>The gap is me.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, fontSize: 11, opacity: 0.85 }}>
          <p style={{ margin: 0 }}>
            My background is markets. I can write the policy language. I can ship a prototype. I cannot architect the distributed execution system we will need in two years.
          </p>
          <p style={{ margin: 0 }}>
            Not a head of engineering. Not a first hire. A co-founder, on the cap table, with veto power on the things they should have veto on.
          </p>
        </div>
      </div>
      {/* 05 The role: have / do not + offer grid */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="05" t="The role" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {[['You have probably', have], ['You probably do not', not]].map(([h, items]) => (
            <div key={h}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.18em', textTransform: 'uppercase', color: paletteAccent, marginBottom: 8 }}>{h}</div>
              {items.map((t) => (
                <div key={t} style={{ fontSize: 10.5, padding: '4px 0', opacity: 0.82 }}>
                  <span style={{ color: paletteAccent }}>— </span>{t}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: paletteSecondary, border: `1px solid ${paletteSecondary}`, marginTop: 18 }}>
          {[['Equity', '15 – 25%'], ['Salary', '$180k base'], ['Where', 'SF, in person']].map(([k, v]) => (
            <div key={k} style={{ background: paletteBg, padding: '14px 14px' }}>
              <div style={lm}>{k}</div>
              <div style={{ fontSize: 17, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      {/* CTA */}
      <div style={{ textAlign: 'center', padding: '34px 34px 36px', borderTop: `1px solid ${paletteSecondary}` }}>
        <div style={lm}>If you are still reading</div>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 36, letterSpacing: '-.01em', margin: '10px 0 14px' }}>
          Let's <em style={{ fontStyle: 'italic', color: paletteAccent }}>talk</em>.
        </h2>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', maxWidth: 360, margin: '0 auto' }}>
          <div style={{ flex: 1, fontSize: 10.5, padding: '9px 14px', border: `1px solid ${paletteSecondary}`, borderRadius: 999, opacity: 0.6, textAlign: 'left' }}>you@email.com</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 999, padding: '9px 18px', whiteSpace: 'nowrap' }}>{ctaText}</div>
        </div>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, marginTop: 20 }}>— The founder</div>
        <div style={{ ...lm, marginTop: 4 }}>{brandName}</div>
      </div>
    </div>
  );
}
