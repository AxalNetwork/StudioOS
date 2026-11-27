// Preview: Pilot Partner Page — Swiss 4/8-col label-left pilot recruiter.
// Faithful miniature of brandtemplates/Pilot Partner Page/ as rendered by
// renderPilotPartnerPage() in cloudflare-worker/src/services/landingTemplates.ts,
// including its content_json sections (glance / who / not_for / includes /
// steps), which read through the same accessor that renderer uses.
import { templateContent } from '../../../lib/brand/templateContent.js';

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
    content = null,
  } = data;
  const c = templateContent(content, 'pilot-partner-page');

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

  const glance = c.list('glance');
  const who = c.list('who');
  const notFor = c.list('not_for');
  const includes = c.list('includes');
  const steps = c.list('steps');

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
          <div style={{ ...label, opacity: 0.6, color: paletteInk, marginTop: 12 }}>Rolling intake — we reply within 2 business days</div>
        </div>
      </div>
      {/* At a glance — dashed-row card */}
      <Sec lbl="At a glance" title="The shape of the pilot">
        <div style={{ border: hairline, borderRadius: 9, padding: '2px 14px' }}>
          {glance.map((g, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 0', borderTop: i ? `1px dashed ${paletteSecondary}` : 'none', fontSize: 10.5 }}>
              <span>{g.label}</span><span style={{ fontFamily: MONO, fontSize: 9.5, color: paletteAccent }}>{g.value}</span>
            </div>
          ))}
        </div>
      </Sec>
      {/* 01 Who it's for */}
      <Sec lbl="01 — Who it's for" title="A good pilot partner">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
          {who.map((x, i) => (
            <div key={i} style={{ border: hairline, borderRadius: 8, padding: 12, background: `${paletteSecondary}33` }}>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 12.5, margin: '0 0 4px' }}>{x.title}</h3>
              <p style={{ margin: 0, fontSize: 9.5, opacity: 0.72 }}>{x.body}</p>
            </div>
          ))}
        </div>
      </Sec>
      {/* 02 Who this isn't for */}
      <Sec lbl="02 — Who this isn't for" title="Save us both the time">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
          {notFor.map((x, i) => (
            <div key={i} style={{ border: hairline, borderRadius: 8, padding: 12, background: `${paletteSecondary}33` }}>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 12.5, margin: '0 0 4px' }}>{x.title}</h3>
              <p style={{ margin: 0, fontSize: 9.5, opacity: 0.72 }}>{x.body}</p>
            </div>
          ))}
        </div>
      </Sec>
      {/* 03 Numbered includes grid */}
      <Sec lbl="03 — What it includes" title="What you get">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: paletteSecondary, border: hairline, borderRadius: 8, overflow: 'hidden' }}>
          {includes.map((x, i) => (
            <div key={i} style={{ background: paletteBg, padding: '13px 12px' }}>
              <div style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent }}>{String(i + 1).padStart(2, '0')}</div>
              <h3 style={{ fontSize: 11, margin: '5px 0 3px', fontWeight: 600 }}>{x.title}</h3>
              <p style={{ margin: 0, fontSize: 9.5, opacity: 0.72 }}>{x.body}</p>
            </div>
          ))}
        </div>
      </Sec>
      {/* 04 Process step strip */}
      <Sec lbl="04 — Process" title="From hello to results">
        <div style={{ display: 'flex' }}>
          {steps.map((st, i) => (
            <div key={i} style={{ flex: 1, borderLeft: i ? hairline : 'none', padding: i ? '0 10px' : '0 10px 0 0' }}>
              <div style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent }}>{st.label}</div>
              <div style={{ fontSize: 10, marginTop: 4 }}>{st.value}</div>
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
