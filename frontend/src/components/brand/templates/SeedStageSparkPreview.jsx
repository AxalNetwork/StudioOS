// Seed Stage Spark — miniaturized preview of brandtemplates/Seed Stage Spark/
// High-energy dark seed teaser: grid-line hero, mono metrics, traction bar chart.
// metrics / pillars / traction_bars / team / round_details all read through the
// same accessor renderSeedStageSpark uses, so preview == published page.
import { templateContent, pct as toPct } from '../../../lib/brand/templateContent.js';

export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function SeedStageSparkPreview({ data = {} }) {
  const {
    brandName = 'axal',
    headline = 'The infrastructure layer for agent commerce.',
    subheadline = 'Axal gives autonomous AI agents the payments, identity, and policy primitives they need to transact on behalf of real businesses — safely, auditably, and at scale.',
    ctaText = 'Schedule call',
    paletteBg = '#0b0e0f',
    paletteInk = '#f2f6f8',
    paletteSecondary = '#25292c',
    paletteAccent = '#abf051',
    logoUrl = null,
    content = null,
  } = data;
  const c = templateContent(content, 'seed-stage-spark');

  const border = paletteSecondary;
  const muted = `${paletteInk}8c`;
  const card = `${paletteInk}08`;
  const mono = { fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.16em', color: muted };
  const eyebrow = (txt) => (
    <div style={{ ...mono, marginBottom: 6 }}>{txt}</div>
  );
  const dot = <span style={{ width: 5, height: 5, borderRadius: '50%', background: paletteAccent, display: 'inline-block' }} />;
  const cell = (key, k, v, large) => (
    <div key={key} style={{ background: paletteBg, padding: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: large ? 20 : 15, color: paletteAccent }}>{v}</div>
      <div style={{ ...mono, marginTop: 5 }}>{k}</div>
    </div>
  );

  const metrics = c.list('metrics');
  const pillars = c.list('pillars');
  const bars = c.list('traction_bars');
  const team = c.list('team');
  const round = c.list('round_details');

  return (
    <div data-testid="template-preview-seed-stage-spark" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 28px', borderBottom: `1px solid ${border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 17, height: 17, objectFit: 'contain' }} />
            : <div style={{ width: 17, height: 17, borderRadius: 2, background: paletteAccent, color: paletteBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10, fontWeight: 700 }}>{brandName.charAt(0).toUpperCase()}</div>}
          <span style={{ fontFamily: MONO, fontSize: 10 }}>{brandName.toLowerCase()}</span>
          <span style={{ ...mono, marginLeft: 4 }}>/ Seed memo</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...mono, display: 'flex', alignItems: 'center', gap: 5, textTransform: 'none', letterSpacing: 0, fontSize: 8.5 }}>{dot} Round open</span>
          <span style={{ background: paletteAccent, color: paletteBg, padding: '5px 10px', fontFamily: MONO, fontSize: 9, fontWeight: 600, borderRadius: 2 }}>{ctaText} →</span>
        </div>
      </div>

      {/* HERO with grid-line backdrop */}
      <div style={{
        position: 'relative', padding: '30px 28px 26px', borderBottom: `1px solid ${border}`,
        backgroundImage: `linear-gradient(${paletteInk}0d 1px, transparent 1px), linear-gradient(90deg, ${paletteInk}0d 1px, transparent 1px)`,
        backgroundSize: '36px 36px',
      }}>
        <div style={{ ...mono, display: 'flex', alignItems: 'center', gap: 6 }}>{dot} Seed memo · raising now</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 34, lineHeight: 1.05, margin: '12px 0 0', maxWidth: 520 }}>{headline}</h1>
        <p style={{ marginTop: 12, maxWidth: 460, fontSize: 11, lineHeight: 1.6, color: muted }}>{subheadline}</p>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ background: paletteAccent, color: paletteBg, padding: '7px 14px', fontFamily: MONO, fontSize: 10, fontWeight: 600, borderRadius: 2 }}>{ctaText} ↗</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: muted, textDecoration: 'underline', textUnderlineOffset: 3 }}>Round details ↓</span>
        </div>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, metrics.length))},1fr)`, gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
          {metrics.map((m, i) => cell(i, m.label, m.value, true))}
        </div>
      </div>

      {/* PRODUCT PILLARS */}
      <div style={{ padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
        {eyebrow('01 / Product')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 14px' }}>What makes {brandName} work</h2>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, pillars.length))},1fr)`, gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
          {pillars.map((p, i) => (
            <div key={i} style={{ background: card, padding: 13 }}>
              <div style={{ fontFamily: MONO, fontSize: 15, color: paletteAccent }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ fontSize: 11, fontWeight: 500, marginTop: 8 }}>{p.title}</div>
              <p style={{ marginTop: 4, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{p.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* TRACTION BAR CHART */}
      <div style={{ padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
        {eyebrow('03 / Traction')}
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, margin: '0 0 14px' }}>The line is going up.</h2>
        <div style={{ border: `1px solid ${border}`, borderRadius: 2, background: card, padding: 14 }}>
          <div style={mono}>Growth by period</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96, marginTop: 12 }}>
            {bars.map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', height: `${Math.max(4, toPct(b.pct))}%`, background: paletteAccent, opacity: 0.9 }} />
                <div style={{ fontFamily: MONO, fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.12em', color: muted }}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TEAM + ROUND */}
      <div style={{ padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
        {eyebrow('05 / Team')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
          {team.map((p, i) => (
            <div key={i} style={{ background: card, padding: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 2, border: `1px solid ${border}`, background: `${paletteInk}0d`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10 }}>
                {String(p.name || '').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2)}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, marginTop: 8 }}>{p.name}</div>
              <div style={{ ...mono, marginTop: 2 }}>{p.role}</div>
              <p style={{ marginTop: 5, fontSize: 8.5, lineHeight: 1.55, color: muted }}>{p.bio}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          {eyebrow('06 / Round')}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, round.length))},1fr)`, gap: 1, background: border, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
            {round.map((r, i) => cell(i, r.label, r.value))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '28px 28px 32px', background: card, textAlign: 'center' }}>
        <div style={{ ...mono, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{dot} Investor access</div>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 24, lineHeight: 1.1, margin: '10px auto 0', maxWidth: 400 }}>{ctaText}</h2>
        <p style={{ margin: '8px auto 0', maxWidth: 360, fontSize: 9.5, color: muted }}>
          Leave your email and we'll send the deck and set up a 30-minute intro.
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <div style={{ width: 190, border: `1px solid ${border}`, borderRadius: 2, padding: '7px 9px', fontFamily: MONO, fontSize: 9, color: muted, textAlign: 'left', background: paletteBg }}>you@fund.com</div>
          <div style={{ background: paletteAccent, color: paletteBg, padding: '8px 14px', fontFamily: MONO, fontSize: 9, fontWeight: 600, borderRadius: 2 }}>{ctaText} ↗</div>
        </div>
        <div style={{ marginTop: 14, ...mono }}>{brandName.toLowerCase()} · seed memo · 2026 · Confidential — do not distribute</div>
      </div>
    </div>
  );
}
