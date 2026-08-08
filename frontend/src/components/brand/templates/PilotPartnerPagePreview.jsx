// Preview: Pilot Partner Page — Swiss 4/8-col label-left pilot recruiter.
// Faithful miniature of brandtemplates/Pilot Partner Page/ as rendered by
// renderPilotPartnerPage() in cloudflare-worker/src/services/landingTemplates.ts.
export const NATURAL_WIDTH = 720;

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function PilotPartnerPagePreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'Run a focused pilot with Axal.',
    subheadline = 'Six weeks. One hypothesis. Real customers. We work with a small number of founders at a time to answer the single question that is currently in the way.',
    ctaText = 'Start a pilot',
    themeColor = '#25984d',
    paletteBg = '#f6f5f1',
    paletteInk = '#1b150f',
    paletteSecondary = '#e7e4dd',
    paletteAccent = '#25984d',
    logoUrl = null,
  } = data;

  const hairline = `1px solid ${paletteSecondary}`;
  const label = { fontFamily: MONO, fontSize: 7.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: paletteAccent };
  const pill = { display: 'inline-block', fontSize: 10, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 999, padding: '7px 15px' };
  const Sec = ({ lbl, title, children }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 24, padding: '26px 28px', borderTop: hairline }}>
      <div>
        <div style={label}>{lbl}</div>
        {title && <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 16, marginTop: 6, letterSpacing: '-0.01em' }}>{title}</div>}
      </div>
      <div>{children}</div>
    </div>
  );

  const glance = [
    ['Commitment', '~2 hrs / week'],
    ['Length', '6 weeks'],
    ['Cost', 'No fee'],
    ['Output', 'Joint findings memo'],
  ];
  const who = [
    ['Has the pain', 'Lives the problem we solve, today.'],
    ['Can decide', 'One owner who can say yes within the team.'],
    ['Will engage', 'Shows up weekly and tells us the truth.'],
  ];
  const notFor = [
    ['Needs it finished', 'Looking for a polished product — not a working pilot.'],
    ["Can't give the time", "Won't have someone showing up weekly with real feedback."],
    ['No path to a yes', "Can't say yes internally within the pilot window."],
  ];
  const includes = [
    ['Hands-on setup', 'We configure the product around your real workflow.'],
    ['Weekly sessions', 'Direct line to the founders, every week.'],
    ['Priority shaping', 'Your feedback steers what we build next.'],
    ['Closing memo', 'A written read-out you can act on.'],
  ];
  const steps = [
    ['Day 0', 'Fit call'],
    ['Wk 1', 'Setup'],
    ['Wk 2–5', 'Run & learn'],
    ['Wk 6', 'Memo & next steps'],
  ];

  return (
    <div data-testid="template-preview-pilot-partner-page" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden', lineHeight: 1.55 }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 28px', borderBottom: hairline }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 17, height: 17, borderRadius: 4, objectFit: 'cover' }} />
            : <span style={{ width: 17, height: 17, borderRadius: 4, background: paletteAccent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>{(brandName || 'A').charAt(0)}</span>}
          <b style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 14 }}>{brandName}</b>
          <span style={{ fontFamily: MONO, fontSize: 7, letterSpacing: '0.14em', opacity: 0.55 }}>/ pilot</span>
        </div>
        <span style={{ ...pill, fontSize: 9, padding: '5px 12px' }}>{ctaText}</span>
      </div>
      {/* Hero — label left, serif h1 right */}
      <div style={{ display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 24, padding: '34px 28px 30px' }}>
        <div><div style={label}>Pilot cohort · rolling intake</div></div>
        <div>
          <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, lineHeight: 1.04, letterSpacing: '-0.02em', margin: '0 0 10px' }}>{headline}</div>
          <p style={{ margin: '0 0 14px', fontSize: 11.5, opacity: 0.78 }}>{subheadline}</p>
          <span style={pill}>{ctaText}</span>
          <div style={{ ...label, opacity: 0.6, color: paletteInk, marginTop: 12 }}>Next kickoff — within 2 weeks of fit call</div>
        </div>
      </div>
      {/* At a glance — dashed-row card */}
      <Sec lbl="At a glance" title="The shape of the pilot">
        <div style={{ border: hairline, borderRadius: 9, padding: '2px 14px' }}>
          {glance.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 0', borderTop: i ? `1px dashed ${paletteSecondary}` : 'none', fontSize: 10.5 }}>
              <span>{k}</span><span style={{ fontFamily: MONO, fontSize: 9.5, color: paletteAccent }}>{v}</span>
            </div>
          ))}
        </div>
      </Sec>
      {/* 01 Who it's for */}
      <Sec lbl="01 — Who it's for" title="A good pilot partner">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
          {who.map(([t, b]) => (
            <div key={t} style={{ border: hairline, borderRadius: 8, padding: 12, background: `${paletteSecondary}33` }}>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 12.5, margin: '0 0 4px' }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 9.5, opacity: 0.72 }}>{b}</p>
            </div>
          ))}
        </div>
      </Sec>
      {/* 02 Who this isn't for */}
      <Sec lbl="02 — Who this isn't for" title="Save us both the time">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
          {notFor.map(([t, b]) => (
            <div key={t} style={{ border: hairline, borderRadius: 8, padding: 12, background: `${paletteSecondary}33` }}>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 12.5, margin: '0 0 4px' }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 9.5, opacity: 0.72 }}>{b}</p>
            </div>
          ))}
        </div>
      </Sec>
      {/* 03 Numbered includes grid */}
      <Sec lbl="03 — What it includes" title="What you get">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: paletteSecondary, border: hairline, borderRadius: 8, overflow: 'hidden' }}>
          {includes.map(([t, b], i) => (
            <div key={t} style={{ background: paletteBg, padding: '13px 12px' }}>
              <div style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent }}>{String(i + 1).padStart(2, '0')}</div>
              <h3 style={{ fontSize: 11, margin: '5px 0 3px', fontWeight: 600 }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 9.5, opacity: 0.72 }}>{b}</p>
            </div>
          ))}
        </div>
      </Sec>
      {/* 04 Process step strip */}
      <Sec lbl="04 — Process" title="From hello to results">
        <div style={{ display: 'flex' }}>
          {steps.map(([k, v], i) => (
            <div key={k} style={{ flex: 1, borderLeft: i ? hairline : 'none', padding: i ? '0 10px' : '0 10px 0 0' }}>
              <div style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent }}>{k}</div>
              <div style={{ fontSize: 10, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </Sec>
      {/* Dark inverted CTA band */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '32px 28px', display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 24, alignItems: 'center' }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, margin: 0, letterSpacing: '-0.01em' }}>{ctaText}</h2>
        <div>
          <p style={{ margin: '0 0 12px', fontSize: 10.5, opacity: 0.82 }}>Tell us where it hurts. If there's a fit, we'll set up a 30-minute call this week.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: '0 1 190px', fontSize: 10, padding: '8px 12px', border: `1px solid ${paletteBg}40`, borderRadius: 999, opacity: 0.7 }}>you@company.com</div>
            <span style={pill}>{ctaText}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 28px', fontFamily: MONO, fontSize: 7.5, opacity: 0.55 }}>
        <span>{brandName} · Pilot</span><span>Built with Axal VC</span>
      </div>
    </div>
  );
}
