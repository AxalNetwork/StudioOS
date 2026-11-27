// Co-Founder Builder — miniaturized preview of brandtemplates/Co-Founder Builder/.
// data / vision / shipped / weak / roadmap / equity come from the same accessor
// renderCoFounderBuilder reads, so preview == published page.
import { templateContent } from '../../../lib/brand/templateContent.js';

export const NATURAL_WIDTH = 720;

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
const DANGER = '#c2452f';

function Eyebrow({ n, t, accent, secondary, ink }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, color: accent }}>{n}</span>
      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '.16em', textTransform: 'uppercase', color: ink, opacity: 0.55 }}>{t}</span>
      <span style={{ flex: 1, height: 1, background: secondary }} />
    </div>
  );
}

export default function CoFounderBuilderPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'We have a working product and paying users. We need one engineer to build the hard part.',
    subheadline = 'Reliability infrastructure for autonomous agents: a control plane that verifies, sandboxes, and replays what agents do before it reaches production.',
    ctaText = "Apply — and share something you've built",
    themeColor = '#5bbe62',
    paletteBg = '#fbfaf6',
    paletteInk = '#14171d',
    paletteSecondary = '#dfded8',
    paletteAccent = '#5bbe62',
    logoUrl = null,
    content = null,
  } = data;
  const c = templateContent(content, 'co-founder-builder');
  const lm = { fontFamily: MONO, fontSize: 8, letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.55 };
  const gridPaper = {
    backgroundImage: `linear-gradient(${paletteSecondary} 1px,transparent 1px),linear-gradient(90deg,${paletteSecondary} 1px,transparent 1px)`,
    backgroundSize: '42px 42px',
  };
  const heroData = c.list('data');
  const shipped = c.list('shipped');
  const weak = c.list('weak');
  const roadmap = c.list('roadmap');
  const equity = c.list('equity');
  return (
    <div data-testid="template-preview-co-founder-builder" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden', lineHeight: 1.55 }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 32px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover' }} />
            : <span style={{ width: 10, height: 10, borderRadius: 2, background: paletteAccent, display: 'inline-block' }} />}
          <b style={{ fontFamily: MONO, fontSize: 11 }}>{brandName}</b>
          <span style={{ fontFamily: MONO, fontSize: 11, opacity: 0.5 }}>/founding-eng</span>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 5, padding: '5px 11px' }}>Apply</span>
      </div>
      {/* Hero */}
      <div style={{ position: 'relative', padding: '38px 32px 30px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <div style={{ position: 'absolute', inset: 0, ...gridPaper, opacity: 0.35, WebkitMaskImage: 'radial-gradient(ellipse at 25% 15%,#000,transparent 70%)', maskImage: 'radial-gradient(ellipse at 25% 15%,#000,transparent 70%)' }} />
        <div style={{ position: 'relative' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', textTransform: 'uppercase', border: `1px solid ${paletteSecondary}`, borderRadius: 999, padding: '4px 10px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: paletteAccent, boxShadow: `0 0 0 3px ${paletteAccent}33` }} />
            Pre-seed · Founding engineer · Equity-led
          </span>
          <h1 style={{ fontSize: 30, lineHeight: 1.08, letterSpacing: '-.02em', margin: '16px 0 10px', fontWeight: 600 }}>{headline}</h1>
          <p style={{ fontSize: 12, opacity: 0.74, maxWidth: '58ch', margin: '0 0 16px' }}>{subheadline}</p>
          <span style={{ display: 'inline-block', fontFamily: MONO, fontSize: 9, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 6, padding: '9px 15px' }}>{ctaText}</span>
          <span style={{ display: 'inline-block', marginLeft: 8, fontFamily: MONO, fontSize: 9, border: `1px solid ${paletteSecondary}`, borderRadius: 6, padding: '8px 12px' }}>Where we actually are</span>
          {/* Hero data grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: paletteSecondary, border: `1px solid ${paletteSecondary}`, marginTop: 24 }}>
            {heroData.map((d, i) => (
              <div key={i} style={{ background: paletteBg, padding: '12px 12px' }}>
                <div style={lm}>{d.key}</div>
                <div style={{ fontFamily: MONO, fontSize: 12, marginTop: 4, color: paletteAccent }}>{d.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 01 Vision */}
      <div style={{ padding: '28px 32px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <Eyebrow n="01" t="Vision" accent={paletteAccent} secondary={paletteSecondary} ink={paletteInk} />
        <h2 style={{ fontSize: 19, margin: '0 0 8px', fontWeight: 600, letterSpacing: '-.01em' }}>What {brandName} is really building</h2>
        <p style={{ fontSize: 11, opacity: 0.78, maxWidth: '62ch', margin: 0 }}>{c.t('vision')}</p>
      </div>
      {/* 02 Shipped vs weak — signature two-pane */}
      <div style={{ padding: '28px 32px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <Eyebrow n="02" t="Current state" accent={paletteAccent} secondary={paletteSecondary} ink={paletteInk} />
        <h2 style={{ fontSize: 19, margin: '0 0 14px', fontWeight: 600 }}>Honest, not polished</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: paletteSecondary, border: `1px solid ${paletteSecondary}` }}>
          <div style={{ background: paletteBg, padding: '16px 15px' }}>
            <div style={{ ...lm, opacity: 1, color: paletteAccent, marginBottom: 10 }}>Shipped &amp; in use</div>
            {shipped.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, fontSize: 10.5, marginBottom: 7, opacity: 0.85 }}>
                <span style={{ fontFamily: MONO, fontWeight: 700, color: paletteAccent }}>+</span><span>{t.body}</span>
              </div>
            ))}
          </div>
          <div style={{ background: paletteBg, padding: '16px 15px' }}>
            <div style={{ ...lm, marginBottom: 10 }}>Known weak points</div>
            {weak.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, fontSize: 10.5, marginBottom: 7, opacity: 0.8 }}>
                <span style={{ fontFamily: MONO, fontWeight: 700, color: DANGER }}>!</span><span>{t.body}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 03 Roadmap */}
      <div style={{ padding: '28px 32px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <Eyebrow n="03" t="Roadmap" accent={paletteAccent} secondary={paletteSecondary} ink={paletteInk} />
        <h2 style={{ fontSize: 19, margin: '0 0 10px', fontWeight: 600 }}>Your first 90 days</h2>
        {roadmap.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: i ? `1px solid ${paletteSecondary}` : 'none', fontSize: 11 }}>
            <span style={{ fontFamily: MONO, color: paletteAccent, fontSize: 10 }}>{String(i + 1).padStart(2, '0')}</span>
            <span style={{ opacity: 0.85 }}>{t.body}</span>
          </div>
        ))}
      </div>
      {/* 04 Equity arrow list */}
      <div style={{ padding: '28px 32px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <Eyebrow n="04" t="Equity" accent={paletteAccent} secondary={paletteSecondary} ink={paletteInk} />
        <h2 style={{ fontSize: 19, margin: '0 0 12px', fontWeight: 600 }}>The offer, plainly</h2>
        <div style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 10, padding: '14px 16px' }}>
          {equity.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, padding: '8px 0', borderTop: i ? `1px solid ${paletteSecondary}` : 'none', fontSize: 10.5, opacity: 0.85 }}>
              <span style={{ fontFamily: MONO, color: paletteAccent }}>→</span><span>{t.body}</span>
            </div>
          ))}
        </div>
      </div>
      {/* CTA */}
      <div style={{ position: 'relative', padding: '36px 32px 34px', textAlign: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, ...gridPaper, opacity: 0.3, WebkitMaskImage: 'radial-gradient(ellipse at 50% 50%,#000,transparent 70%)', maskImage: 'radial-gradient(ellipse at 50% 50%,#000,transparent 70%)' }} />
        <div style={{ position: 'relative' }}>
          <div style={lm}>Open seat — one founding engineer</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: '10px auto 8px', maxWidth: '26ch' }}>If the hard part is what excites you, let's talk.</h2>
          <p style={{ fontSize: 10.5, opacity: 0.76, maxWidth: '48ch', margin: '0 auto 16px' }}>No CV theater — we'd rather read your code. Drop your email and we'll send the brief and a time.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', maxWidth: 360, margin: '0 auto' }}>
            <div style={{ flex: 1, fontFamily: MONO, fontSize: 10, padding: '9px 12px', border: `1px solid ${paletteSecondary}`, borderRadius: 6, background: paletteBg, color: paletteInk, opacity: 0.6, textAlign: 'left' }}>you@email.com</div>
            <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 6, padding: '9px 14px', whiteSpace: 'nowrap' }}>{ctaText}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
