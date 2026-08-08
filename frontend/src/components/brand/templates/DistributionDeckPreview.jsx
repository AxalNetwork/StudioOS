// Preview: Distribution Deck — light blueprint partnership memo.
// Faithful miniature of brandtemplates/Distribution Deck/ as rendered by
// renderDistributionDeck() in cloudflare-worker/src/services/landingTemplates.ts.
export const NATURAL_WIDTH = 720;

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function DistributionDeckPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    subheadline = "The unvarnished version of the deck — overlap, economics, and the exact integration shapes we're proposing. No ecosystem theater.",
    ctaText = 'Discuss distribution fit',
    themeColor = '#0072d5',
    paletteBg = '#f9f8f5',
    paletteInk = '#0e1218',
    paletteSecondary = '#e9e8e2',
    paletteAccent = '#0072d5',
    logoUrl = null,
  } = data;

  const hairline = `1px solid ${paletteSecondary}`;
  const mono = (size = 7) => ({ fontFamily: MONO, fontSize: size, letterSpacing: '0.14em', textTransform: 'uppercase' });
  const eyebrow = (n, t) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ ...mono(8), color: paletteAccent }}>{n}</span>
      <span style={{ width: 32, height: 1, background: paletteSecondary }} />
      <span style={{ ...mono(7), opacity: 0.55 }}>{t}</span>
    </div>
  );

  const sideFacts = [
    ['Partner type', 'Platform'],
    ['Addressable overlap', 'High'],
    ['Revenue model', 'Rev-share'],
    ['Time to value', 'Weeks'],
  ];
  const overlap = [
    ['Enterprise', 'Strong', 72],
    ['Mid-market', 'Core', 58],
    ['SMB', 'Emerging', 34],
  ];
  const cards = [
    ['+ARPU', 'Lift per shared account'],
    ['Lower', 'Blended CAC'],
    ['Higher', 'Retention together'],
    ['Faster', 'Time to revenue'],
  ];
  const opts = [
    ['Referral handoff', 'Lightest lift — a clean handoff between teams.', 'Eng lift: low', '2–4 wks'],
    ['Embedded surface', 'The default — it lives inside your product.', 'Eng lift: med', '6–8 wks'],
    ['Native rebuild', 'Deepest — fully co-built and co-branded.', 'Eng lift: high', '12+ wks'],
  ];

  return (
    <div data-testid="template-preview-distribution-deck" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden', lineHeight: 1.55 }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 28px', borderBottom: hairline }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 17, height: 17, borderRadius: 4, objectFit: 'cover' }} />
            : <span style={{ width: 17, height: 17, borderRadius: 4, background: paletteAccent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>{(brandName || 'A').charAt(0)}</span>}
          <b style={{ fontSize: 11, fontWeight: 700 }}>{brandName}</b>
          <span style={{ ...mono(7), opacity: 0.55 }}>Distribution brief</span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 5, padding: '5px 10px' }}>{ctaText}</span>
      </div>
      {/* Read-me strip */}
      <div style={{ ...mono(6.5), opacity: 0.6, padding: '6px 28px', borderBottom: hairline, background: `${paletteSecondary}55` }}>
        Read-me · A partnership memo — edit the bracketed figures with your real numbers before sending.
      </div>
      {/* Hero + side glance card */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 26, padding: '34px 28px', borderBottom: hairline, alignItems: 'start' }}>
        <div>
          {eyebrow('01', 'Hero')}
          <h1 style={{ margin: '0 0 10px', fontSize: 30, lineHeight: 1.05, letterSpacing: '-0.02em', fontWeight: 700 }}>
            A distribution case for <span style={{ color: paletteAccent }}>{brandName}</span>, written for partners.
          </h1>
          <p style={{ margin: '0 0 14px', fontSize: 11.5, opacity: 0.78 }}>{subheadline}</p>
          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 5, padding: '7px 13px' }}>{ctaText}</span>
        </div>
        <div style={{ border: hairline, borderRadius: 8, padding: '2px 13px' }}>
          {sideFacts.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 0', borderTop: i ? hairline : 'none', fontSize: 10 }}>
              <span>{k}</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: paletteAccent }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 02 Overlap table */}
      <div style={{ padding: '30px 28px', borderBottom: hairline }}>
        {eyebrow('02', 'Overlap')}
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>Where our customers already meet</h2>
        <p style={{ margin: '0 0 14px', fontSize: 10.5, opacity: 0.76 }}>The fastest distribution is the customer you both already serve. Here's the shape of the overlap.</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
          <thead>
            <tr>
              {['Segment', 'Shared base', 'Overlap'].map((h) => (
                <th key={h} style={{ ...mono(7), opacity: 0.55, textAlign: 'left', padding: '7px 8px', borderBottom: hairline, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overlap.map(([seg, base, pct]) => (
              <tr key={seg}>
                <td style={{ padding: '8px 8px', borderBottom: hairline }}>{seg}</td>
                <td style={{ padding: '8px 8px', borderBottom: hairline }}>{base}</td>
                <td style={{ padding: '8px 8px', borderBottom: hairline, width: 180 }}>
                  <div style={{ height: 5, borderRadius: 99, background: paletteSecondary, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: paletteAccent }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 03 Channel value cards */}
      <div style={{ padding: '30px 28px', borderBottom: hairline }}>
        {eyebrow('03', 'Channel value')}
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>The unit economics of the channel</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: paletteSecondary, border: hairline }}>
          {cards.map(([v, l]) => (
            <div key={l} style={{ background: paletteBg, padding: '14px 12px' }}>
              <div style={{ fontFamily: MONO, fontSize: 16, color: paletteAccent }}>{v}</div>
              <div style={{ fontSize: 9.5, opacity: 0.7, marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      {/* 04 Rollout options */}
      <div style={{ padding: '30px 28px', borderBottom: hairline }}>
        {eyebrow('04', 'Rollout')}
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>Three ways to integrate</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: paletteSecondary, border: hairline }}>
          {opts.map(([title, body, lift, time]) => (
            <div key={title} style={{ background: paletteBg, padding: '15px 13px' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700 }}>{title}</h3>
              <p style={{ margin: '0 0 10px', fontSize: 9.5, opacity: 0.72 }}>{body}</p>
              <div style={{ fontFamily: MONO, fontSize: 8, borderTop: hairline, paddingTop: 8, display: 'flex', justifyContent: 'space-between', opacity: 0.7 }}>
                <span>{lift}</span><span>{time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Dark CTA band */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '32px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{ctaText}</h2>
          <p style={{ margin: 0, fontSize: 10.5, opacity: 0.82 }}>Send your overlap assumptions and we'll come back with a modelled channel plan — no slideware.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 250 }}>
          <div style={{ fontSize: 10, padding: '9px 10px', borderBottom: `1px solid ${paletteBg}4d`, opacity: 0.6 }}>you@partner.com</div>
          <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 5, padding: '8px 14px' }}>{ctaText}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 28px', fontFamily: MONO, fontSize: 7.5, opacity: 0.55 }}>
        <span>{brandName} · Distribution brief</span><span>Built with Axal VC</span>
      </div>
    </div>
  );
}
