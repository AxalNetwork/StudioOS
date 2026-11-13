// Capital Ready Kit — miniaturized preview of brandtemplates/Capital Ready Kit/
// Mirrors renderCapitalReadyKit palette substitution: accent = signal, secondary = fills.
// Every section that renderer builds from content_json (raise_summary / why_now
// / traction / round_details / use_of_funds / team) reads through the same
// accessor here, so this preview and the published page show identical copy.
import { templateContent, pct } from '../../../lib/brand/templateContent.js';

export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function CapitalReadyKitPreview({ data = {} }) {
  const {
    brandName = 'AXAL',
    headline = 'Autonomous execution infrastructure for capital markets.',
    subheadline = 'Axal is the agent runtime that takes institutional trading strategies from research to live capital — with the routing, risk, and audit layer funds would otherwise build in-house.',
    ctaText = 'Request intro',
    paletteBg = '#1b1a16',
    paletteInk = '#f4f1e6',
    paletteSecondary = '#3a382f',
    paletteAccent = '#c7e83f',
    logoUrl = null,
    content = null,
  } = data;
  const c = templateContent(content, 'capital-ready-kit');

  const hairline = paletteSecondary;
  const muted = `${paletteInk}99`;
  const label = { fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.18em', color: muted };
  const sectionHead = (idx, title) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18 }}>
      <span style={{ fontSize: 9, color: muted }}>{idx}</span>
      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em' }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: hairline }} />
    </div>
  );

  const heroStats = c.list('raise_summary');
  const whyNow = c.list('why_now');
  const traction = c.list('traction');
  const roundDetails = c.list('round_details');
  const funds = c.list('use_of_funds');
  const team = c.list('team');

  return (
    <div data-testid="template-preview-capital-ready-kit" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: MONO, overflow: 'hidden' }}>
      {/* NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
            : <div style={{ width: 18, height: 18, background: paletteAccent, color: paletteBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontSize: 11 }}>{brandName.charAt(0)}</div>}
          <span style={{ fontSize: 10, letterSpacing: '0.12em' }}>{brandName.toUpperCase()}</span>
          <span style={{ fontSize: 8, color: muted }}>/ INVESTOR BRIEF</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: paletteAccent, color: paletteBg, padding: '5px 9px', fontSize: 8, fontWeight: 600, letterSpacing: '0.05em' }}>{ctaText} →</span>
        </div>
      </div>

      {/* HERO */}
      <div style={{ padding: '34px 28px', borderBottom: `1px solid ${hairline}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, ...label }}>
          <span>01 / Investor brief · raising now</span>
          <div style={{ flex: 1, height: 1, background: hairline }} />
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 36, lineHeight: 0.98, letterSpacing: '-0.01em', margin: 0 }}>
          {headline.replace(/\.\s*$/, '')}<em style={{ color: paletteAccent }}>.</em>
        </h1>
        <p style={{ marginTop: 14, maxWidth: 460, fontSize: 11, lineHeight: 1.6, color: muted }}>{subheadline}</p>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, heroStats.length))},1fr)`, gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {heroStats.map((s, i) => (
            <div key={i} style={{ background: paletteBg, padding: '12px 12px 14px' }}>
              <div style={label}>{s.label}</div>
              <div style={{ fontFamily: SERIF, fontSize: 17, marginTop: 6, color: paletteAccent }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* WHY NOW */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('03', 'Why now')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {whyNow.map((x, i) => (
            <div key={i} style={{ background: paletteBg, padding: 14 }}>
              <div style={{ fontSize: 9, color: paletteAccent }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ fontFamily: SERIF, fontSize: 14, marginTop: 8, lineHeight: 1.2 }}>{x.title}</div>
              <p style={{ marginTop: 6, fontSize: 9, lineHeight: 1.55, color: muted }}>{x.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* TRACTION */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('04', 'Traction')}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, traction.length))},1fr)`, gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {traction.map((s, i) => (
            <div key={i} style={{ background: paletteBg, padding: '13px 12px' }}>
              <div style={{ fontFamily: SERIF, fontSize: 20, color: paletteAccent }}>{s.value}</div>
              <div style={{ ...label, marginTop: 5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ROUND DETAILS + USE OF FUNDS */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('05', 'Round details')}
        <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 14 }}>
          <div style={{ border: `1px solid ${hairline}`, padding: 16 }}>
            <div style={{ fontFamily: SERIF, fontSize: 16, marginBottom: 4 }}>Round details</div>
            {roundDetails.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? `1px solid ${hairline}` : 0, fontSize: 9.5 }}>
                <span style={{ color: muted }}>{r.label}</span>
                <span style={{ color: paletteAccent }}>{r.value}</span>
              </div>
            ))}
          </div>
          <div style={{ border: `1px solid ${hairline}`, padding: 16 }}>
            <div style={{ fontFamily: SERIF, fontSize: 16, marginBottom: 10 }}>Use of funds</div>
            {funds.map((r, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 4 }}>
                  <span>{r.label}</span><span style={{ color: muted }}>{pct(r.pct)}%</span>
                </div>
                <div style={{ height: 4, background: paletteSecondary, borderRadius: 999 }}>
                  <div style={{ height: '100%', width: `${pct(r.pct)}%`, background: paletteAccent, borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TEAM */}
      <div style={{ padding: '26px 28px', borderBottom: `1px solid ${hairline}` }}>
        {sectionHead('07', 'Team')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: hairline, border: `1px solid ${hairline}` }}>
          {team.map((p, i) => (
            <div key={i} style={{ background: paletteBg, padding: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: `${paletteAccent}26`, border: `1px solid ${paletteAccent}55` }} />
              <div style={{ fontFamily: SERIF, fontSize: 13, marginTop: 8 }}>{p.name}</div>
              <div style={{ ...label, marginTop: 2 }}>{p.role}</div>
              <p style={{ marginTop: 6, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{p.bio}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '30px 28px 34px' }}>
        <div style={{ margin: '0 auto', maxWidth: 460, textAlign: 'center', border: `1px solid ${paletteAccent}55`, background: `${paletteAccent}0f`, padding: '24px 26px' }}>
          <div style={{ ...label, color: paletteAccent }}>08 / Get in</div>
          <div style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1.05, marginTop: 10 }}>{ctaText}</div>
          <p style={{ marginTop: 8, fontSize: 9, color: muted }}>Leave your email for the data room and a 30-minute intro with the founders.</p>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <div style={{ flex: 1, maxWidth: 210, borderBottom: `1px solid ${hairline}`, padding: '7px 4px', fontSize: 9, color: muted, textAlign: 'left' }}>you@fund.com</div>
            <div style={{ background: paletteAccent, color: paletteBg, padding: '8px 14px', fontSize: 9, fontWeight: 600 }}>{ctaText} →</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 8, color: muted }}>{brandName} · Built with Axal VC</div>
        </div>
      </div>
    </div>
  );
}
