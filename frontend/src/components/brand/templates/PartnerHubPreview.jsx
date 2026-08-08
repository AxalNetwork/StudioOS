// Preview: Partner Hub — calm teal serif BD landing.
// Faithful miniature of brandtemplates/Partner Hub/ as rendered by
// renderPartnerHub() in cloudflare-worker/src/services/landingTemplates.ts.
export const NATURAL_WIDTH = 720;

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function PartnerHubPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'Partner with Axal where the same customer wins twice.',
    subheadline = 'We run a small number of commercial, technical, and distribution partnerships. Named owners on both sides, written success criteria, and a 90-day pilot before anything gets larger.',
    ctaText = 'Explore partnership',
    themeColor = '#429595',
    paletteBg = '#fbfaf6',
    paletteInk = '#121c23',
    paletteSecondary = '#dad7cf',
    paletteAccent = '#429595',
    logoUrl = null,
  } = data;

  const hairline = `1px solid ${paletteSecondary}`;
  const eyebrow = (t) => (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', color: paletteAccent, fontWeight: 600 }}>
      <span style={{ width: 16, height: 1, background: paletteAccent }} />{t}
    </div>
  );
  const btn = { display: 'inline-block', fontSize: 10, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 7, padding: '8px 15px' };

  const stats = [
    ['Pilot', '90-day model'],
    ['Named', 'Owners both sides'],
    ['Shared', 'Success criteria'],
    ['On date', 'We ship'],
  ];
  const why = [
    ['Shared accountability', 'Named owners on both sides, and a plan we both sign.'],
    ['Productized surfaces', 'Real integration points, not a one-off favour.'],
    ['We ship on date', 'A 90-day pilot with criteria agreed up front.'],
  ];
  const value = [
    ['Account coverage', 'We show up inside accounts you already own.'],
    ['Faster cycles', 'Shared context means faster yes or no.'],
    ['Lower lift', 'We do the integration work; you keep the relationship.'],
    ['Co-branded proof', 'Joint case studies you can take to your team.'],
  ];
  const models = [
    ['Commercial', 'Co-sell', ['Joint pipeline', 'Shared targets', 'Rev-share']],
    ['Technical', 'Integrate', ['Embedded surface', 'Shared data model', 'Co-built roadmap']],
    ['Distribution', 'Channel', ['Bundled offer', 'Referral motion', 'Co-marketing']],
  ];

  return (
    <div data-testid="template-preview-partner-hub" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden', lineHeight: 1.6 }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 28px', borderBottom: hairline }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 18, height: 18, borderRadius: 5, objectFit: 'cover' }} />
            : <span style={{ width: 18, height: 18, borderRadius: 5, background: paletteInk, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: paletteBg, fontSize: 9, fontWeight: 800 }}>{(brandName || 'A').charAt(0)}</span>}
          <b style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 14 }}>{brandName}</b>
        </div>
        <span style={{ ...btn, fontSize: 9, padding: '6px 12px' }}>{ctaText} →</span>
      </div>
      {/* Gradient-tinted hero + stat row */}
      <div style={{ padding: '40px 28px 30px', background: `linear-gradient(180deg, ${paletteAccent}14, transparent)` }}>
        {eyebrow('Partnerships')}
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 33, lineHeight: 1.05, letterSpacing: '-0.02em', margin: '10px 0', maxWidth: 560 }}>{headline}</h1>
        <p style={{ fontSize: 12, opacity: 0.78, maxWidth: 480, margin: '0 0 16px' }}>{subheadline}</p>
        <span style={btn}>{ctaText}</span>
        <span style={{ display: 'inline-block', marginLeft: 7, fontSize: 10, border: hairline, borderRadius: 7, padding: '7px 13px' }}>See models</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, borderTop: hairline, marginTop: 26, paddingTop: 16 }}>
          {stats.map(([v, l]) => (
            <div key={l}>
              <div style={{ fontFamily: SERIF, fontSize: 19, color: paletteAccent }}>{v}</div>
              <div style={{ fontSize: 7.5, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.6, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Why partner — numbered tri-grid */}
      <div style={{ padding: '28px 28px', borderTop: hairline, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 22, alignItems: 'start' }}>
        <div>{eyebrow('Why partner')}<h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 17, margin: '8px 0 0', letterSpacing: '-0.01em' }}>Serious collaboration, not logos</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: paletteSecondary, border: hairline, borderRadius: 10, overflow: 'hidden' }}>
          {why.map(([t, b], i) => (
            <div key={t} style={{ background: paletteBg, padding: '14px 12px' }}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, color: paletteAccent }}>{String(i + 1).padStart(2, '0')}</div>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 12.5, margin: '6px 0 3px' }}>{t}</h3>
              <p style={{ margin: 0, opacity: 0.74, fontSize: 9 }}>{b}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Shared fit split */}
      <div style={{ padding: '26px 28px', borderTop: hairline, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 22 }}>
        <div>{eyebrow('Shared fit')}<h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 17, margin: '8px 0 0', letterSpacing: '-0.01em' }}>The same customer wins twice</h2></div>
        <p style={{ opacity: 0.76, fontSize: 11, margin: '4px 0 0' }}>We start where our ideal customers already overlap — so the pilot proves value fast and the economics are obvious to both teams.</p>
      </div>
      {/* Value to partner — 4-col strip */}
      <div style={{ padding: '26px 28px', borderTop: hairline }}>
        {eyebrow('Value to partner')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 17, margin: '8px 0 14px', letterSpacing: '-0.01em' }}>What's in it for you</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: paletteSecondary, border: hairline, borderRadius: 10, overflow: 'hidden' }}>
          {value.map(([t, b]) => (
            <div key={t} style={{ background: paletteBg, padding: '13px 11px' }}>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 11.5, margin: '0 0 3px' }}>{t}</h3>
              <p style={{ margin: 0, opacity: 0.74, fontSize: 8.5 }}>{b}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Models — tag + bullets cards */}
      <div style={{ padding: '26px 28px', borderTop: hairline }}>
        {eyebrow('Models')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 17, margin: '8px 0 14px', letterSpacing: '-0.01em' }}>Three ways to work together</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {models.map(([tag, t, lis]) => (
            <div key={t} style={{ border: hairline, borderRadius: 10, padding: 14, boxShadow: `0 6px 18px ${paletteInk}0d` }}>
              <div style={{ fontSize: 7.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: paletteAccent, fontWeight: 700 }}>{tag}</div>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 14, margin: '6px 0 7px' }}>{t}</h3>
              <ul style={{ margin: 0, paddingLeft: 13, fontSize: 9.5, opacity: 0.78 }}>
                {lis.map((li) => <li key={li} style={{ marginBottom: 3 }}>{li}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
      {/* Quote card */}
      <div style={{ padding: '24px 28px', borderTop: hairline, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 22, alignItems: 'start' }}>
        <div>{eyebrow('Traction')}<h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 17, margin: '8px 0 0' }}>What partners say</h2></div>
        <div style={{ border: hairline, borderRadius: 12, padding: 18, background: `${paletteSecondary}33` }}>
          <p style={{ fontFamily: SERIF, fontSize: 14, margin: '0 0 8px', lineHeight: 1.35 }}>"The pilot paid for itself before it ended — and our customers noticed."</p>
          <div style={{ fontSize: 9.5, opacity: 0.6 }}>Head of Partnerships</div>
        </div>
      </div>
      {/* Dark CTA band with checklist + boxed form card */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '30px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        <div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 18, margin: '0 0 8px', letterSpacing: '-0.01em' }}>{ctaText}</h2>
          <p style={{ margin: '0 0 8px', fontSize: 10.5, opacity: 0.82 }}>Tell us about your customers and we'll come back with a concrete partnership shape.</p>
          <ul style={{ margin: 0, paddingLeft: 14, opacity: 0.82, fontSize: 9.5 }}>
            <li>Who your customers are</li><li>The overlap you see</li><li>What a win looks like</li>
          </ul>
        </div>
        <div style={{ background: paletteBg, color: paletteInk, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, padding: '8px 10px', border: hairline, borderRadius: 7, opacity: 0.6 }}>you@partner.com</div>
          <span style={{ ...btn, alignSelf: 'flex-start' }}>{ctaText}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 28px', fontSize: 8.5, opacity: 0.55 }}>
        <span>{brandName}</span><span>Built with Axal VC</span>
      </div>
    </div>
  );
}
