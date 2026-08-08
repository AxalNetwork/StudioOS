export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function AdvisorConnectPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = "We're building Axal. We'd like your counsel.",
    subheadline = 'Programmable trust for autonomous agents. This page exists so you can decide, on your own time, whether an advisory relationship makes sense — what we are building, what we need, and what we would ask of you. No call required to read it.',
    ctaText = 'Become an advisor',
    themeColor = '#b06a32',
    paletteBg = '#f6f1e7',
    paletteInk = '#33302a',
    paletteSecondary = '#ddd3c0',
    paletteAccent = '#b06a32',
    logoUrl = null,
  } = data;

  const eyebrow = { fontFamily: SANS, fontSize: 8, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: paletteAccent, margin: 0 };
  const body = { fontFamily: SANS, fontSize: 10.5, lineHeight: 1.65, margin: 0, opacity: 0.78 };
  const section = { padding: '24px 32px', borderBottom: `1px solid ${paletteSecondary}` };
  const h2 = { fontFamily: SERIF, fontWeight: 400, fontSize: 21, lineHeight: 1.12, margin: '8px 0 0' };

  const thesis = [
    'Identity and reputation primitives for non-human actors.',
    'Policy enforcement that travels with the request, not the perimeter.',
    'An economic layer where agents can post bonds and resolve disputes without a human escalation path.',
  ];
  const help = [
    ['Go-to-market with platform buyers', 'How to land and expand inside AI-native platforms whose buying process is still forming.'],
    ['Risk and compliance posture', 'A sober view of which regimes to engage now vs. defer, and how to design around them.'],
    ['Hiring the first three engineers', 'Who in your network would consider a pre-seed cryptography-adjacent role, and how to close them.'],
  ];
  const traction = [
    ['7', 'Signed design-partner LOIs'],
    ['$1.4M', 'Pre-seed committed'],
    ['11', 'Production integrations in pilot'],
    ['Q2 2026', 'Targeted GA'],
  ];

  return (
    <div data-testid="template-preview-advisor-connect" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SERIF, overflow: 'hidden' }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          {logoUrl ? <img src={logoUrl} alt="" style={{ height: 15 }} /> : <span aria-hidden style={{ fontSize: 12 }}>△</span>}
          {brandName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: SANS, fontSize: 9.5, opacity: 0.75 }}>
          <span>Thesis</span><span>Why us</span><span>The ask</span>
          <span style={{ border: `1px solid ${paletteInk}33`, borderRadius: 6, padding: '5px 10px', fontWeight: 600, opacity: 1 }}>{ctaText}</span>
        </div>
      </div>

      {/* Hero with meta sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 26, padding: '32px 32px 30px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <div>
          <p style={{ ...eyebrow, marginBottom: 10 }}>An invitation, not a pitch</p>
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 34, lineHeight: 1.06, letterSpacing: '-.01em', margin: 0 }}>
            We're building <span style={{ fontStyle: 'italic' }}>{brandName}</span>.<br />We'd like your counsel.
          </h1>
          <p style={{ ...body, fontSize: 11.5, marginTop: 12, maxWidth: 420 }}>{subheadline}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, fontFamily: SANS }}>
            <span style={{ background: paletteInk, color: paletteBg, borderRadius: 6, padding: '8px 16px', fontSize: 10, fontWeight: 600 }}>{ctaText}</span>
            <span style={{ border: `1px solid ${paletteInk}33`, borderRadius: 6, padding: '8px 16px', fontSize: 10, fontWeight: 600 }}>Read the thesis first</span>
          </div>
        </div>
        <div style={{ borderLeft: `1px solid ${paletteSecondary}`, paddingLeft: 16, display: 'grid', gap: 12, alignContent: 'start' }}>
          {[['Stage', 'Pre-seed, building toward design partners'], ['Focus', 'Agent-native infrastructure'], ['Commitment', 'One 60-min call per month'], ['Recognition', '0.25%–0.50% common']].map(([k, v]) => (
            <div key={k}>
              <p style={eyebrow}>{k}</p>
              <p style={{ ...body, opacity: 0.95, marginTop: 2, fontSize: 9.5 }}>{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 01 Thesis — numbered points */}
      <div style={section}>
        <p style={eyebrow}>01 · Category & Thesis</p>
        <h2 style={h2}>Agent-native infrastructure</h2>
        <p style={{ ...body, marginTop: 8, maxWidth: 500 }}>Within five years, most economically meaningful software will be initiated by autonomous agents. The systems that price risk, enforce policy, and settle disputes between them do not exist yet. We are building them.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 16 }}>
          {thesis.map((t, i) => (
            <div key={t} style={{ borderTop: `1px solid ${paletteSecondary}`, paddingTop: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, opacity: 0.55 }}>{String(i + 1).padStart(2, '0')}</span>
              <p style={{ ...body, marginTop: 5, fontFamily: SERIF, opacity: 0.9 }}>{t}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 03 Help areas + terms card */}
      <div style={section}>
        <p style={eyebrow}>03 · What we'd ask of you</p>
        <h2 style={h2}>The advisory ask, in plain terms.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 14 }}>
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <p style={eyebrow}>Where we'd lean on you</p>
            {help.map(([a, d]) => (
              <div key={a} style={{ borderLeft: `2px solid ${paletteAccent}99`, paddingLeft: 10 }}>
                <p style={{ fontFamily: SERIF, fontSize: 13, margin: 0 }}>{a}</p>
                <p style={{ ...body, fontSize: 9.5, marginTop: 3 }}>{d}</p>
              </div>
            ))}
          </div>
          <div style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 8, background: 'rgba(255,255,255,0.45)', padding: 16 }}>
            <p style={eyebrow}>The arrangement</p>
            {[['Time', 'One 60-minute call per month, plus async questions as they come up.'],
              ['Term', '24-month term, reviewed at 12.'],
              ['Equity', '0.25%–0.50% common, vesting monthly over 24 months. The advisor pool stays small and concentrated.']].map(([k, v], i) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 10, padding: '8px 0', borderTop: i ? `1px solid ${paletteSecondary}` : 0, marginTop: i ? 0 : 8 }}>
                <span style={{ fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.08em', opacity: 0.6, paddingTop: 2 }}>{k}</span>
                <span style={{ ...body, fontSize: 9.5, opacity: 0.85 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 04 Traction stat grid */}
      <div style={section}>
        <p style={eyebrow}>04 · Current traction</p>
        <h2 style={h2}>Where we actually are.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: paletteSecondary, border: `1px solid ${paletteSecondary}`, borderRadius: 8, overflow: 'hidden', marginTop: 14 }}>
          {traction.map(([m, l]) => (
            <div key={l} style={{ background: paletteBg, padding: '14px 12px' }}>
              <div style={{ fontFamily: SERIF, fontSize: 21, letterSpacing: '-.01em' }}>{m}</div>
              <div style={{ ...body, fontSize: 8.5, marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 05 Why you — blockquote */}
      <div style={section}>
        <p style={eyebrow}>05 · Why you</p>
        <div style={{ borderLeft: `3px solid ${paletteAccent}`, paddingLeft: 18, marginTop: 10, maxWidth: 520 }}>
          <p style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.4, margin: 0 }}>
            "We're approaching you specifically — not a list. Your work has shaped how we frame the problem. An advisory relationship would let us pressure-test decisions with someone who has already seen the shape of what we're walking into."
          </p>
          <p style={{ ...body, fontSize: 9.5, marginTop: 8 }}>— Marc Boyron & Priya Anand</p>
        </div>
      </div>

      {/* Dark CTA band */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '28px 32px 26px' }}>
        <p style={{ ...eyebrow, color: paletteSecondary }}>Next step</p>
        <h2 style={{ ...h2, fontSize: 22, maxWidth: 440 }}>If this is a fit, we'd love a single 45-minute conversation.</h2>
        <p style={{ ...body, color: paletteBg, opacity: 0.7, marginTop: 8, maxWidth: 440 }}>One call. No deck. A founder will respond within 48 hours. You walk away with whatever level of involvement feels right — including none. We mean that.</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, fontFamily: SANS, alignItems: 'center' }}>
          <div style={{ flex: '0 1 220px', border: `1px solid ${paletteBg}44`, borderRadius: 6, padding: '8px 12px', fontSize: 10, opacity: 0.6 }}>you@example.com</div>
          <span style={{ background: paletteBg, color: paletteInk, borderRadius: 6, padding: '8px 16px', fontSize: 10, fontWeight: 600 }}>{ctaText}</span>
          <span style={{ fontSize: 9.5, opacity: 0.7, textDecoration: 'underline', textUnderlineOffset: 3 }}>Or: pass, but here's a thought →</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, borderTop: `1px solid ${paletteBg}26`, marginTop: 20, paddingTop: 14, fontFamily: SANS, fontSize: 9 }}>
          {[['Direct', `advisors@${brandName.toLowerCase()}.example`], ['Data room', 'Sent on request, NDA optional.'], ['Who replies', 'A founder directly, within 48 hours.']].map(([k, v]) => (
            <div key={k}><p style={{ margin: 0 }}>{k}</p><p style={{ margin: '2px 0 0', opacity: 0.6 }}>{v}</p></div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 32px', fontFamily: SANS, fontSize: 8.5, opacity: 0.6 }}>
        <span>© 2026 {brandName}, Inc.</span>
        <span>This page is intentionally unindexed. Please don't share without asking.</span>
      </div>
    </div>
  );
}
