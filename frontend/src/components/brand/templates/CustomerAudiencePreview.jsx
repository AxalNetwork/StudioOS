// Customer Audience Page — miniaturized preview of
// attached_assets/Customer_Audience_Landing_Page.dc.html (see
// TEMPLATE_DESIGN_SOURCES). Signature: the audience switcher — one page whose
// headline, week-one outcomes and headline stat retarget per buyer segment,
// over a light hero band.
//
// The published page drives the switcher with CSS `:checked` rules (no JS,
// CSP-safe). A static preview can't be interactive, so it renders the FIRST
// segment's panel with the remaining tabs shown inactive — the same thing a
// visitor sees before they click.
//
// Every section renderCustomerAudience builds from content_json reads through
// the same accessor here, so this preview and the published page agree.
import { templateContent } from '../../../lib/brand/templateContent.js';

export const NATURAL_WIDTH = 720;

const SERIF = '"Instrument Serif","Iowan Old Style",Georgia,serif';
const SANS = 'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';

export default function CustomerAudiencePreview({ data = {} }) {
  const {
    brandName = 'NovaCraft',
    headline = '',
    subheadline = '',
    ctaText = 'Join the waitlist',
    paletteBg = '#ffffff',
    paletteInk = '#1a202c',
    paletteSecondary = '#e2e8f0',
    paletteAccent = '#6b46c1',
    logoUrl = null,
    content = null,
  } = data;
  const c = templateContent(content, 'customer-audience');

  const muted = `${paletteInk}99`;
  const label = { fontSize: 7.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.13em', color: `${paletteInk}77` };
  const sec = { padding: '28px 32px 0' };

  const segs = c.list('segments');
  const active = segs[0] || {};
  const pains = c.list('pains');
  const steps = c.list('steps');
  const metrics = c.list('metrics');
  const faqs = c.list('faqs');

  return (
    <div data-testid="template-preview-customer-audience" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* LIGHT HERO BAND + AUDIENCE SWITCHER */}
      <div style={{ background: `${paletteInk}05`, borderBottom: `1px solid ${paletteSecondary}`, padding: '14px 32px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {logoUrl
              ? <img src={logoUrl} alt="" style={{ width: 17, height: 17, borderRadius: 5, objectFit: 'cover' }} />
              : <span style={{ width: 17, height: 17, borderRadius: 5, background: paletteAccent, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>{(brandName || 'A').charAt(0)}</span>}
            <b style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '-.015em' }}>{brandName}</b>
          </div>
          <span style={{ padding: '5px 11px', borderRadius: 7, background: paletteAccent, color: '#fff', fontSize: 8.5, fontWeight: 700 }}>{ctaText}</span>
        </div>

        <div style={{ ...label, marginBottom: 8 }}>Built for</div>
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: paletteBg, border: `1px solid ${paletteSecondary}`, borderRadius: 9, marginBottom: 20 }}>
          {segs.map((s, i) => (
            <span
              key={i}
              style={{
                padding: '6px 12px', borderRadius: 7, fontSize: 9.5,
                fontWeight: i === 0 ? 700 : 600,
                background: i === 0 ? paletteAccent : 'transparent',
                color: i === 0 ? '#fff' : muted,
              }}
            >
              {s.label}
            </span>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 32, alignItems: 'start' }}>
          <div>
            <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, lineHeight: 1.08, letterSpacing: '-.015em', margin: 0 }}>{active.headline || headline}</h1>
            <p style={{ fontSize: 10.5, color: muted, lineHeight: 1.7, margin: '12px 0 0', maxWidth: 340 }}>{active.subhead || subheadline}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <span style={{ padding: '9px 17px', borderRadius: 8, background: paletteAccent, color: '#fff', fontSize: 10, fontWeight: 800 }}>{ctaText}</span>
              <span style={{ padding: '9px 17px', borderRadius: 8, border: `1px solid ${paletteSecondary}`, background: paletteBg, fontSize: 10, fontWeight: 700 }}>See how it works</span>
            </div>
          </div>
          <div style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 11, background: paletteBg, padding: '16px 18px' }}>
            <div style={{ ...label, marginBottom: 10 }}>What you get in week one</div>
            {[active.o1, active.o2, active.o3].filter(Boolean).map((o, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 9 }}>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: `${paletteAccent}22`, color: paletteAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 8, fontWeight: 800, marginTop: 1 }}>✓</span>
                <span style={{ fontSize: 9.5, color: muted, lineHeight: 1.62 }}>{o}</span>
              </div>
            ))}
            <div style={{ marginTop: 13, paddingTop: 11, borderTop: `1px solid ${paletteSecondary}`, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.025em', color: paletteAccent }}>{active.stat_value}</span>
              <span style={{ fontSize: 9, color: muted, lineHeight: 1.5 }}>{active.stat_label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* WHAT BREAKS TODAY */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 12 }}>What breaks today</div>
        <div style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.28, maxWidth: 460 }}>{c.t('problem_lead')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, pains.length))},1fr)`, gap: 15, marginTop: 18 }}>
          {pains.map((p, i) => (
            <div key={i} style={{ borderTop: `2px solid ${paletteAccent}`, paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '-.01em' }}>{p.title}</div>
              <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.68, marginTop: 5 }}>{p.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 12 }}>How it works</div>
        <div style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.3, maxWidth: 400 }}>{c.t('how_lead')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, steps.length))},1fr)`, gap: 14, marginTop: 16 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 10, overflow: 'hidden', background: paletteBg }}>
              <div style={{ height: 64, background: `${paletteInk}08`, borderBottom: `1px solid ${paletteSecondary}`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...label, color: paletteAccent }}>{s.shot}</div>
              <div style={{ padding: '12px 13px' }}>
                <span style={{ fontFamily: SERIF, fontSize: 14, color: paletteAccent, marginRight: 7 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '-.01em' }}>{s.title}</span>
                <div style={{ fontSize: 9, color: muted, lineHeight: 1.65, marginTop: 6 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PROOF */}
      <div style={sec}>
        <div style={{ background: `${paletteInk}05`, border: `1px solid ${paletteSecondary}`, borderRadius: 13, padding: '24px 26px', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 28, alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.44 }}>{c.t('quote')}</div>
            <div style={{ fontSize: 9, color: muted, marginTop: 10 }}>{c.t('quote_by')}</div>
          </div>
          <div>
            {metrics.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 9, paddingBottom: 8, marginBottom: 9, borderBottom: `1px solid ${paletteSecondary}` }}>
                <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.025em', color: paletteAccent, flex: 'none', minWidth: 42 }}>{m.value}</div>
                <div style={{ fontSize: 9, color: muted, lineHeight: 1.5 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CONVERSION */}
      <div style={sec}>
        <div style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 13, padding: '24px 28px', display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 28, alignItems: 'center' }}>
          <div>
            <div style={{ ...label, marginBottom: 8 }}>Get early access</div>
            <div style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.26, maxWidth: 260 }}>{c.t('conv_lead')}</div>
            <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.7, marginTop: 8, maxWidth: 280 }}>{c.t('conv_body')}</div>
          </div>
          <div>
            <div style={{ height: 28, borderRadius: 8, border: `1px solid ${paletteSecondary}`, background: `${paletteInk}05`, display: 'flex', alignItems: 'center', padding: '0 11px', fontSize: 9.5, color: muted }}>Work email</div>
            <div style={{ marginTop: 9, height: 28, borderRadius: 8, background: paletteAccent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>{ctaText}</div>
            <div style={{ fontSize: 8, color: muted, marginTop: 9, lineHeight: 1.55 }}>No credit card, no sales call. Unsubscribe in one click.</div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 8 }}>Questions</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 28px' }}>
          {faqs.map((q, i) => (
            <div key={i} style={{ padding: '11px 0', borderTop: `1px solid ${paletteSecondary}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '-.01em' }}>{q.q}</div>
              <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.72, marginTop: 5 }}>{q.a}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ margin: '26px 32px 0', borderTop: `1px solid ${paletteSecondary}`, padding: '14px 0 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 8.5, color: muted }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 13, height: 13, borderRadius: 4, objectFit: 'cover' }} />
            : <span style={{ width: 13, height: 13, borderRadius: 4, background: paletteAccent }} />}
          {brandName}
        </span>
        <span>Built with Axal VC</span>
      </div>
    </div>
  );
}
