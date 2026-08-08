// Preview: Partner Pipeline Pro — financial-tech distribution brief.
// Faithful miniature of brandtemplates/Partner Pipeline Pro/ as rendered by
// renderPartnerPipelinePro() in cloudflare-worker/src/services/landingTemplates.ts.
export const NATURAL_WIDTH = 720;

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function PartnerPipelineProPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    subheadline = "The unvarnished version of the deck — overlap, economics, and the exact integration shapes we're proposing for a partner of your scale. No ecosystem theater.",
    ctaText = 'Discuss distribution fit',
    themeColor = '#ef852e',
    paletteBg = '#fbfaf8',
    paletteInk = '#15110d',
    paletteSecondary = '#dbd7d0',
    paletteAccent = '#ef852e',
    logoUrl = null,
  } = data;

  const hairline = `1px solid ${paletteSecondary}`;
  const slabel = (n, t) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent, letterSpacing: '0.1em' }}>{n}</span>
      <span style={{ width: 28, height: 1, background: paletteSecondary }} />
      <span style={{ fontFamily: MONO, fontSize: 7, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.55 }}>{t}</span>
    </div>
  );
  const btn = { display: 'inline-block', fontSize: 10, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 5, padding: '8px 15px' };

  const glance = [
    ['Partner type', 'Platform'],
    ['Addressable overlap', 'High'],
    ['ARPU lift', 'Net new'],
    ['Revenue timing', 'Quarter one'],
  ];
  const nums = [
    ['61%', 'Shared ICP'],
    ['High', 'Geographic fit'],
    ['Strong', 'Income match'],
    ['Aligned', 'Buying preference'],
  ];
  const levers = [
    ['ARPU', 'Flat', 'Higher', '+lift'],
    ['Retention', 'Standard', 'Stickier', '+pts'],
    ['CAC', 'Full', 'Shared', '−cost'],
  ];
  const options = [
    ['Lightest', 'Referral', 'Clean handoff, minimal lift.'],
    ['Default', 'Embedded', 'It lives inside your product surface.'],
    ['Deepest', 'Native', 'Fully co-built and co-branded.'],
  ];
  const timeline = [
    ['Wk 0', 'Scoping'],
    ['Wk 4', 'Build'],
    ['Wk 8', 'Pilot'],
    ['Wk 14', 'Scale'],
  ];
  const bestFit = ['You already serve our shared ICP', 'A revenue line you want to grow', 'A team that can ship a pilot this quarter'];
  const notFit = ['Logo hunting, not distribution', 'No room for a partner rev-share', "Can't name the overlap in one sentence"];

  return (
    <div data-testid="template-preview-partner-pipeline-pro" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden', lineHeight: 1.55 }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 28px', borderBottom: hairline }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 17, height: 17, borderRadius: 4, objectFit: 'cover' }} />
            : <span style={{ width: 17, height: 17, borderRadius: 4, background: paletteInk, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: paletteBg, fontSize: 9, fontWeight: 800 }}>{(brandName || 'A').charAt(0)}</span>}
          <b style={{ fontSize: 11, fontWeight: 700 }}>{brandName}</b>
          <span style={{ fontSize: 8.5, opacity: 0.55 }}>Distribution brief</span>
        </div>
        <span style={{ ...btn, fontSize: 9, padding: '5px 11px' }}>{ctaText} →</span>
      </div>
      {/* Hero: italic-em brand headline + glance card */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 26, padding: '36px 28px', borderBottom: hairline, alignItems: 'start' }}>
        <div>
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, lineHeight: 1.04, letterSpacing: '-0.02em', margin: '0 0 12px' }}>
            The <em style={{ fontStyle: 'italic', color: paletteAccent }}>{brandName}</em> distribution case, modelled — not asserted.
          </h1>
          <p style={{ margin: '0 0 14px', fontSize: 11.5, opacity: 0.78 }}>{subheadline}</p>
          <span style={btn}>{ctaText}</span>
        </div>
        <div style={{ border: hairline, borderRadius: 8, padding: '2px 13px' }}>
          {glance.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: i ? hairline : 'none', fontSize: 10 }}>
              <span>{k}</span><span style={{ fontFamily: MONO, fontSize: 9, color: paletteAccent }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 01 Customer overlap — italic serif stat cells */}
      <div style={{ padding: '28px 28px', borderBottom: hairline }}>
        {slabel('01', 'Customer overlap')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 4px', letterSpacing: '-0.01em' }}>The same customers, twice the value</h2>
        <p style={{ margin: '0 0 14px', fontSize: 10.5, opacity: 0.76 }}>We don't have to convince you the market exists — you already serve it. Here's the overlap.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: paletteSecondary, border: hairline, borderRadius: 8, overflow: 'hidden' }}>
          {nums.map(([v, l]) => (
            <div key={l} style={{ background: paletteBg, padding: '14px 12px' }}>
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 19, color: paletteAccent }}>{v}</div>
              <div style={{ fontSize: 9, opacity: 0.7, marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      {/* 02 Channel value table */}
      <div style={{ padding: '28px 28px', borderBottom: hairline }}>
        {slabel('02', 'Channel value')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 10px', letterSpacing: '-0.01em' }}>What changes with {brandName}</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
          <thead>
            <tr>
              {['Lever', 'Baseline', `With ${brandName}`, 'Delta'].map((h) => (
                <th key={h} style={{ fontFamily: MONO, fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55, textAlign: 'left', padding: '7px 8px', borderBottom: `1px dashed ${paletteSecondary}`, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levers.map(([lever, base, w, delta]) => (
              <tr key={lever}>
                <td style={{ padding: '8px 8px', borderBottom: `1px dashed ${paletteSecondary}` }}>{lever}</td>
                <td style={{ padding: '8px 8px', borderBottom: `1px dashed ${paletteSecondary}` }}>{base}</td>
                <td style={{ padding: '8px 8px', borderBottom: `1px dashed ${paletteSecondary}` }}>{w}</td>
                <td style={{ padding: '8px 8px', borderBottom: `1px dashed ${paletteSecondary}`, color: paletteAccent, fontFamily: MONO, fontSize: 9.5 }}>{delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 03 Integration options + timeline strip */}
      <div style={{ padding: '28px 28px', borderBottom: hairline }}>
        {slabel('03', 'Integration & rollout')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 12px', letterSpacing: '-0.01em' }}>Pick the path your risk team will sign</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
          {options.map(([pin, t, b], i) => (
            <div key={t} style={{ border: i === 1 ? `1px solid ${paletteAccent}` : hairline, boxShadow: i === 1 ? `0 0 0 1px ${paletteAccent}` : 'none', background: i === 1 ? `${paletteAccent}0d` : 'transparent', borderRadius: 9, padding: 13 }}>
              <div style={{ fontFamily: MONO, fontSize: 7, color: paletteAccent, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{pin}</div>
              <h3 style={{ margin: '5px 0 3px', fontSize: 12, fontWeight: 700 }}>{t}</h3>
              <p style={{ margin: 0, opacity: 0.72, fontSize: 9.5 }}>{b}</p>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', marginTop: 16 }}>
          {timeline.map(([k, v], i) => (
            <div key={k} style={{ flex: 1, borderLeft: i ? hairline : 'none', padding: i ? '0 10px' : '0 10px 0 0' }}>
              <div style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent }}>{k}</div>
              <div style={{ fontSize: 10, marginTop: 3 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      {/* 05 Audience fit — two-pane */}
      <div style={{ padding: '28px 28px', borderBottom: hairline }}>
        {slabel('05', 'Audience fit')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 12px', letterSpacing: '-0.01em' }}>Where this works — and where it doesn't yet</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: paletteSecondary, border: hairline, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: paletteBg, padding: '14px 13px' }}>
            <h3 style={{ margin: '0 0 7px', fontSize: 11, color: paletteAccent, fontWeight: 700 }}>Best fit</h3>
            <ul style={{ margin: 0, paddingLeft: 13, fontSize: 9.5, opacity: 0.78 }}>{bestFit.map((t) => <li key={t} style={{ marginBottom: 3 }}>{t}</li>)}</ul>
          </div>
          <div style={{ background: paletteBg, padding: '14px 13px' }}>
            <h3 style={{ margin: '0 0 7px', fontSize: 11, fontWeight: 700 }}>Not a fit (yet)</h3>
            <ul style={{ margin: 0, paddingLeft: 13, fontSize: 9.5, opacity: 0.78 }}>{notFit.map((t) => <li key={t} style={{ marginBottom: 3 }}>{t}</li>)}</ul>
          </div>
        </div>
      </div>
      {/* Dashed CTA box */}
      <div style={{ margin: '20px 28px 0', border: `1px dashed ${paletteSecondary}`, borderRadius: 11, padding: 20 }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 5px', letterSpacing: '-0.01em' }}>{ctaText}</h2>
        <p style={{ margin: '0 0 10px', fontSize: 10.5, opacity: 0.76 }}>Send your overlap assumptions ahead and we'll bring a modelled channel plan to a working session.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: '0 1 200px', fontSize: 10, padding: '8px 11px', border: hairline, borderRadius: 6, opacity: 0.6 }}>you@partner.com</div>
          <span style={btn}>{ctaText}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 28px', fontFamily: MONO, fontSize: 7.5, opacity: 0.55 }}>
        <span>{brandName} · Distribution brief</span><span>Built with Axal VC</span>
      </div>
    </div>
  );
}
