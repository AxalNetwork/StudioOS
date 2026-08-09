// Capital Storyteller — miniaturized preview of brandtemplates/Capital Storyteller/
// Numbered confidential memo: diamond-bullet eyebrow, "01 — ..." hairline rules, bento stats.
// Section content (raise_summary / thesis / market / traction / round_details /
// use_of_funds / team) comes from the same accessor renderCapitalStoryteller
// reads, so this preview matches the published page.
import { templateContent, pct as toPct } from '../../../lib/brand/templateContent.js';

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
    content = null,
  } = data;
  const c = templateContent(content, 'capital-storyteller');

  const hairline = paletteSecondary;
  const muted = `${paletteInk}8c`;
  const mono = { fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.16em', color: muted };
  const rule = (labelTxt) => (
    <div style={{ borderTop: `1px solid ${hairline}`, borderBottom: `1px solid ${hairline}`, padding: '8px 28px' }}>
      <span style={mono}>{labelTxt}</span>
    </div>
  );
  const stat = (key, k, v) => (
    <div key={key} style={{ background: paletteBg, padding: 12 }}>
      <div style={mono}>{k}</div>
      <div style={{ fontFamily: SERIF, fontSize: 17, marginTop: 6, color: paletteAccent }}>{v}</div>
    </div>
  );

  const raise = c.list('raise_summary');
  const market = c.list('market');
  const traction = c.list('traction');
  const roundDetails = c.list('round_details');
  const funds = c.list('use_of_funds');
  const team = c.list('team');

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
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: paletteAccent }} />Round open
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
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 38, lineHeight: 1.02, margin: 0, maxWidth: 560 }}>{headline}</h1>
        <p style={{ marginTop: 14, maxWidth: 440, fontSize: 11, lineHeight: 1.6, color: muted }}>{subheadline}</p>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, raise.length))},1fr)`, gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {raise.map((it, i) => stat(i, it.label, it.value))}
        </div>
      </div>

      {/* 01 — THE STORY */}
      {rule('01 — The story')}
      <div style={{ display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 20, padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div>
          <div style={{ ...mono, marginBottom: 6 }}>Thesis</div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.15, margin: 0 }}>The story behind {brandName}</h2>
        </div>
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: muted }}>{c.t('thesis')}</p>
      </div>

      {/* 02 — WHY NOW */}
      {rule('02 — Why now')}
      <div style={{ display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 20, padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div>
          <div style={{ ...mono, marginBottom: 6 }}>Timing</div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.15, margin: 0 }}>Why the window is open now</h2>
        </div>
        <div>
          {market.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '8px 0', borderBottom: i < market.length - 1 ? `1px solid ${hairline}` : 'none' }}>
              <span style={{ fontFamily: SERIF, fontSize: 22, color: paletteAccent, flex: '0 0 auto' }}>{it.value}</span>
              <span style={{ fontSize: 10, color: muted }}>{it.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 03 — TRACTION */}
      {rule('03 — Traction')}
      <div style={{ display: 'grid', gridTemplateColumns: '4fr 8fr', gap: 20, padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div>
          <div style={{ ...mono, marginBottom: 6 }}>Numbers</div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.15, margin: 0 }}>Signal so far</h2>
        </div>
        <div style={{ border: `1px solid ${hairline}` }}>
          {traction.map((it, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', padding: '8px 12px', borderBottom: i < traction.length - 1 ? `1px solid ${hairline}` : 'none' }}>
              <span style={{ fontFamily: SERIF, fontSize: 15, color: paletteAccent }}>{it.value}</span>
              <span style={{ fontSize: 9.5, color: muted }}>{it.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 04 — ROUND / 05 — USE OF FUNDS */}
      {rule('04 — Round · 05 — Use of funds')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div>
          <div style={{ ...mono, marginBottom: 8 }}>Round details</div>
          <div style={{ border: `1px solid ${hairline}` }}>
            {roundDetails.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 12px', borderTop: i ? `1px solid ${hairline}` : 'none', fontSize: 10 }}>
                <span style={{ color: muted }}>{it.label}</span>
                <span style={{ fontFamily: SERIF, fontSize: 12, color: paletteAccent }}>{it.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ ...mono, marginBottom: 8 }}>Use of funds</div>
          {funds.map((it, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: SERIF, fontSize: 13 }}>{it.label}</span>
                <span style={mono}>{toPct(it.pct)}%</span>
              </div>
              <div style={{ marginTop: 4, height: 2, background: hairline }}>
                <div style={{ height: '100%', width: `${toPct(it.pct)}%`, background: paletteAccent }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 06 — TEAM */}
      {rule('06 — Team')}
      <div style={{ padding: '22px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {team.map((p, i) => (
            <div key={i} style={{ background: paletteBg, padding: 12 }}>
              <div style={{ width: 28, height: 28, border: `1px solid ${hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontSize: 11 }}>
                {String(p.name || '').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2)}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 13, marginTop: 8 }}>{p.name}</div>
              <div style={{ ...mono, marginTop: 2 }}>{p.role}</div>
              <p style={{ marginTop: 6, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{p.bio}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 07 — NEXT / CTA */}
      {rule('07 — Next')}
      <div style={{ padding: '28px 28px 32px', textAlign: 'center' }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, lineHeight: 1.05, margin: '0 auto', maxWidth: 420 }}>
          {ctaText}
        </h2>
        <p style={{ margin: '10px auto 0', maxWidth: 380, fontSize: 9.5, color: muted }}>
          Leave your email — we'll send the memo and the data room.
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
