// Co-Founder Canvas — miniaturized preview of brandtemplates/Co-Founder Canvas/.
// facts / building / whynow / built / gap / role_have / role_not / offer / steps
// come from the same accessor renderCoFounderCanvas reads.
import { templateContent } from '../../../lib/brand/templateContent.js';

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
    content = null,
  } = data;
  const c = templateContent(content, 'co-founder-canvas');
  const lm = { fontFamily: MONO, fontSize: 8, letterSpacing: '.2em', textTransform: 'uppercase', opacity: 0.6 };
  const facts = c.list('facts');
  const whynow = c.list('whynow');
  const built = c.list('built');
  const gap = c.list('gap');
  const have = c.list('role_have');
  const not = c.list('role_not');
  const offer = c.list('offer');
  const steps = c.list('steps');
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
          {headline}
        </h1>
        <p style={{ fontSize: 12.5, margin: '0 0 8px', maxWidth: '58ch' }}>{subheadline}</p>
        <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 999, padding: '10px 20px' }}>{ctaText}</span>
        <span style={{ marginLeft: 14, fontFamily: MONO, fontSize: 8.5, textDecoration: 'underline', textUnderlineOffset: 3 }}>Read the whole thing first</span>
        {/* Facts strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, borderTop: `1px solid ${paletteSecondary}`, marginTop: 26, paddingTop: 16 }}>
          {facts.map((f, i) => (
            <div key={i}>
              <div style={lm}>{f.key}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>
      {/* 01 Building */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="01" t="What we are building" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 24 }}>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 21, lineHeight: 1.15, margin: 0 }}>An execution layer for autonomous financial agents.</h2>
          <p style={{ fontSize: 11, opacity: 0.82, margin: 0 }}>{c.t('building')}</p>
        </div>
      </div>
      {/* 02 Why now */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="02" t="Why now" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, whynow.length))},1fr)`, gap: 18 }}>
          {whynow.map((w, i) => (
            <div key={i}>
              <div style={{ fontFamily: SERIF, fontSize: 14 }}>{w.title}</div>
              <p style={{ fontSize: 10.5, opacity: 0.75, margin: '4px 0 0' }}>{w.body}</p>
            </div>
          ))}
        </div>
      </div>
      {/* 03 Already built — left-accent-border list */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="03" t="Already built" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 24 }}>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 21, lineHeight: 1.15, margin: 0 }}>You're not joining an idea.</h2>
          <div>
            {built.map((b, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${paletteAccent}`, padding: '2px 0 2px 13px', marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 13.5 }}>{b.title}</div>
                <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 1 }}>{b.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 04 Dark gap slab */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '30px 34px 32px' }}>
        <div style={{ ...lm, opacity: 1, color: paletteAccent }}>04 — What's missing</div>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 34, lineHeight: 1.05, margin: '10px 0 14px' }}>The gap is me.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(2, gap.length))},1fr)`, gap: 22, fontSize: 11, opacity: 0.85 }}>
          {gap.map((g, i) => <p key={i} style={{ margin: 0 }}>{g.body}</p>)}
        </div>
      </div>
      {/* 05 The role: have / do not + offer grid */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="05" t="The role" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {[['You have probably', have], ['You probably do not', not]].map(([h, items]) => (
            <div key={h}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.18em', textTransform: 'uppercase', color: paletteAccent, marginBottom: 8 }}>{h}</div>
              {items.map((t, i) => (
                <div key={i} style={{ fontSize: 10.5, padding: '4px 0', opacity: 0.82 }}>
                  <span style={{ color: paletteAccent }}>— </span>{t.body}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: paletteSecondary, border: `1px solid ${paletteSecondary}`, marginTop: 18 }}>
          {offer.map((o, i) => (
            <div key={i} style={{ background: paletteBg, padding: '14px 14px' }}>
              <div style={lm}>{o.key}</div>
              <div style={{ fontSize: 17, marginTop: 4 }}>{o.value}</div>
            </div>
          ))}
        </div>
      </div>
      {/* 06 Next steps */}
      <div style={{ padding: '26px 34px', borderTop: `1px solid ${paletteSecondary}` }}>
        <SectionLabel n="06" t="Next steps" accent={paletteAccent} secondary={paletteSecondary} />
        <div style={{ display: 'flex' }}>
          {steps.map((st, i) => (
            <div key={i} style={{ flex: 1, borderLeft: i ? `1px solid ${paletteSecondary}` : 'none', padding: i ? '0 12px' : '0 12px 0 0' }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: paletteAccent }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ fontSize: 10.5, marginTop: 4, opacity: 0.82 }}>{st.body}</div>
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
