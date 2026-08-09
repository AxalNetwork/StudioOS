// Customer Acquisition Page — miniaturized preview of
// attached_assets/Customer_Acquisition_Landing_Page.dc.html (see
// TEMPLATE_DESIGN_SOURCES). Signature: dark hero slab, the cost of the problem
// in figures, a product-screenshot frame, numbered why-now rows, and TWO
// conversion cards side by side rather than one CTA.
//
// Every section renderCustomerAcquisition builds from content_json reads
// through the same accessor here, so this preview and the published page show
// identical copy.
import { templateContent } from '../../../lib/brand/templateContent.js';

export const NATURAL_WIDTH = 720;

const SERIF = '"Instrument Serif","Iowan Old Style",Georgia,serif';
const SANS = 'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';

export default function CustomerAcquisitionPreview({ data = {} }) {
  const {
    brandName = 'NovaCraft',
    headline = 'Your team already wrote the status update. It is just scattered across four tools.',
    subheadline = 'For operations leads at distributed teams who lose four hours a week reconstructing what changed since yesterday.',
    ctaText = 'Join the waitlist',
    paletteBg = '#ffffff',
    paletteInk = '#141118',
    paletteSecondary = '#e2e8f0',
    paletteAccent = '#6b46c1',
    logoUrl = null,
    productScreenshotUrl = null,
    content = null,
  } = data;
  const c = templateContent(content, 'customer-acquisition');

  const muted = `${paletteInk}99`;
  const label = { fontSize: 7.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.13em', color: `${paletteInk}77` };
  const sec = { padding: '30px 32px 0' };

  const costs = c.list('costs');
  const notes = c.list('feature_notes');
  const whyNow = c.list('why_now');
  const conv = c.list('conversion');
  const faqs = c.list('faqs');

  return (
    <div data-testid="template-preview-customer-acquisition" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* DARK HERO SLAB */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '14px 32px 34px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {logoUrl
              ? <img src={logoUrl} alt="" style={{ width: 17, height: 17, borderRadius: 5, objectFit: 'cover' }} />
              : <span style={{ width: 17, height: 17, borderRadius: 5, background: paletteAccent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>{(brandName || 'A').charAt(0)}</span>}
            <b style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '-.015em' }}>{brandName}</b>
          </div>
          <span style={{ padding: '5px 11px', borderRadius: 7, border: `1px solid ${paletteBg}33`, fontSize: 8.5, fontWeight: 600, opacity: 0.86 }}>{ctaText}</span>
        </div>
        <div style={{ maxWidth: 430 }}>
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 33, lineHeight: 1.06, letterSpacing: '-.015em', margin: 0 }}>{headline}</h1>
          <p style={{ fontSize: 10.5, opacity: 0.62, lineHeight: 1.68, margin: '13px 0 0' }}>{subheadline}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <span style={{ padding: '9px 17px', borderRadius: 8, background: paletteAccent, color: '#fff', fontSize: 10, fontWeight: 800 }}>{ctaText}</span>
            <span style={{ padding: '9px 17px', borderRadius: 8, border: `1px solid ${paletteBg}3d`, fontSize: 10, fontWeight: 700 }}>See both options</span>
          </div>
        </div>
      </div>

      {/* PROBLEM + COSTS */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 14 }}>The problem today</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 28, alignItems: 'start' }}>
          <div style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.28 }}>{c.t('problem_lead')}</div>
          <div>
            {costs.map((x, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 8, marginBottom: 8, borderBottom: `1px solid ${paletteSecondary}` }}>
                <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.02em', color: paletteAccent, flex: 'none', minWidth: 44 }}>{x.value}</div>
                <div style={{ fontSize: 9, color: muted, lineHeight: 1.5 }}>{x.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRODUCT SHOT */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 14 }}>What it does</div>
        <div style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.3, maxWidth: 430 }}>{c.t('product_lead')}</div>
        <div style={{ marginTop: 18, border: `1px solid ${paletteSecondary}`, borderRadius: 11, overflow: 'hidden', background: `${paletteInk}05` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderBottom: `1px solid ${paletteSecondary}`, background: paletteBg }}>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: paletteSecondary }} />)}
          </div>
          <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16 }}>
            {productScreenshotUrl
              ? <img src={productScreenshotUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (
                <div>
                  <div style={{ ...label, color: paletteAccent }}>Product screenshot</div>
                  <div style={{ fontSize: 9, color: muted, marginTop: 6, maxWidth: 260, lineHeight: 1.6 }}>Add a product screenshot in the builder — a real interface capture converts better than an illustration.</div>
                </div>
              )}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, notes.length))},1fr)`, gap: 14, marginTop: 14 }}>
          {notes.map((n, i) => (
            <div key={i}>
              <div style={{ fontSize: 10, fontWeight: 700 }}>{n.title}</div>
              <div style={{ fontSize: 9, color: muted, lineHeight: 1.62, marginTop: 4 }}>{n.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* WHY NOW */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 12 }}>Why now</div>
        {whyNow.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: 18, padding: '14px 0', borderTop: `1px solid ${paletteSecondary}`, maxWidth: 560 }}>
            <div style={{ fontFamily: SERIF, fontSize: 17, color: paletteAccent, flex: 'none', minWidth: 28, lineHeight: 1 }}>{String(i + 1).padStart(2, '0')}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.35 }}>{w.title}</div>
              <div style={{ fontSize: 10, color: muted, lineHeight: 1.72, marginTop: 5 }}>{w.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* QUOTE */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 12 }}>In their words</div>
        <div style={{ borderLeft: `2px solid ${paletteAccent}`, paddingLeft: 16, maxWidth: 480 }}>
          <div style={{ fontFamily: SERIF, fontSize: 15, lineHeight: 1.5 }}>{c.t('quote')}</div>
          <div style={{ fontSize: 9, color: muted, marginTop: 8 }}>{c.t('quote_by')}</div>
        </div>
      </div>

      {/* TWO WAYS IN — the design's signature split */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 12 }}>Two ways in</div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(2, conv.length))},1fr)`, gap: 14 }}>
          {conv.map((x, i) => (
            <div
              key={i}
              style={i === 1
                ? { border: `1px solid ${paletteAccent}55`, background: `${paletteAccent}0d`, borderRadius: 11, padding: '18px 20px' }
                : { border: `1px solid ${paletteSecondary}`, borderRadius: 11, padding: '18px 20px' }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.02em' }}>{x.title}</div>
              <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.68, marginTop: 5 }}>{x.body}</div>
              <div style={{ marginTop: 12, height: 26, borderRadius: 7, border: `1px solid ${paletteSecondary}`, background: `${paletteInk}05`, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 9, color: muted }}>Work email</div>
              <div style={{ marginTop: 8, height: 26, borderRadius: 7, background: paletteAccent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800 }}>{i === 0 ? ctaText : x.title}</div>
              <div style={{ fontSize: 8, color: muted, marginTop: 10 }}>{x.foot}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={sec}>
        <div style={{ ...label, marginBottom: 8 }}>Questions</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 28px' }}>
          {faqs.map((q, i) => (
            <div key={i} style={{ padding: '11px 0', borderTop: `1px solid ${paletteSecondary}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '-.01em' }}>{q.q}</div>
              <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.72, marginTop: 5 }}>{q.a}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FOOTER SLAB */}
      <div style={{ padding: '30px 32px 26px' }}>
        <div style={{ background: paletteInk, color: paletteBg, borderRadius: 14, padding: '26px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.2 }}>{ctaText}</div>
            <div style={{ fontSize: 9, opacity: 0.55, lineHeight: 1.65, marginTop: 6, maxWidth: 320 }}>{subheadline}</div>
          </div>
          <span style={{ flex: 'none', padding: '9px 17px', borderRadius: 8, background: paletteAccent, color: '#fff', fontSize: 10, fontWeight: 800 }}>{ctaText}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, fontSize: 8.5, color: muted }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {logoUrl
              ? <img src={logoUrl} alt="" style={{ width: 13, height: 13, borderRadius: 4, objectFit: 'cover' }} />
              : <span style={{ width: 13, height: 13, borderRadius: 4, background: paletteAccent }} />}
            {brandName}
          </span>
          <span>Built with Axal VC</span>
        </div>
      </div>
    </div>
  );
}
