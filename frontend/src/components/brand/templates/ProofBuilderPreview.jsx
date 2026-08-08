// In-house original design — no brandtemplates/ source (see TEMPLATE_SOURCES); ported from the worker's renderProofBuilder.
export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';

export default function ProofBuilderPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'Proof, not promises.',
    subheadline = 'An evidence-first page for early customers: every claim on it is backed by something you can check.',
    ctaText = 'Join the waitlist',
    themeColor = '#1f7a52',
    paletteBg = '#fbfbf9',
    paletteInk = '#1f2630',
    paletteSecondary = '#e2e5e1',
    paletteAccent = '#1f7a52',
    logoUrl = null,
  } = data;
  const soft = { color: paletteInk, opacity: 0.7 };
  const eyebrow = { fontSize: 8, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: paletteAccent };
  const secHead = (e, h) => (
    <div style={{ marginBottom: 12 }}>
      <div style={eyebrow}>{e}</div>
      <div style={{ fontFamily: SERIF, fontSize: 19, marginTop: 4 }}>{h}</div>
    </div>
  );
  const pad = { padding: '0 32px' };
  return (
    <div data-testid="template-preview-proof-builder" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* Nav */}
      <div style={{ ...pad, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 12 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 6, objectFit: 'cover' }} />
            : <span style={{ width: 20, height: 20, borderRadius: 6, background: themeColor }} />}
          <span>{brandName}</span>
        </div>
        <span style={{ fontSize: 9.5, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 6, padding: '5px 10px' }}>{ctaText}</span>
      </div>

      {/* Hero: copy + proof snapshot card */}
      <div style={{ ...pad, display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 26, alignItems: 'center', paddingBottom: 30, paddingTop: 8 }}>
        <div>
          <div style={eyebrow}>Built on evidence</div>
          <div style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.01em', margin: '8px 0 10px' }}>{headline}</div>
          <div style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 14, ...soft }}>{subheadline}</div>
          <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 7, padding: '8px 15px' }}>{ctaText}</span>
          <span style={{ marginLeft: 10, fontSize: 10.5, fontWeight: 600, ...soft }}>See how it works →</span>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${paletteSecondary}`, borderRadius: 12, padding: 14, boxShadow: '0 14px 34px -26px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${paletteSecondary}`, paddingBottom: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: SERIF, fontSize: 12 }}>Proof snapshot</span>
            <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: paletteAccent, background: `${paletteAccent}1a`, borderRadius: 999, padding: '3px 7px' }}>Verified</span>
          </div>
          {[['Status', 'Live in the wild'], ['Signal', 'Growing weekly'], ['Evidence', 'Real customer use'], ['Updated', 'This week']].map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, padding: '7px 0', borderTop: i ? `1px solid ${paletteSecondary}` : 'none' }}>
              <span style={soft}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          <div style={{ fontSize: 8, marginTop: 8, ...soft }}>Every claim on this page is backed by something you can check.</div>
        </div>
      </div>

      {/* How it works */}
      <div style={{ ...pad, borderTop: `1px solid ${paletteSecondary}`, paddingTop: 24, paddingBottom: 24 }}>
        {secHead('How it works', 'Claims you can verify')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {[
            ['Show the problem', 'We name the pain precisely — the way the people living it would.'],
            ['Show the change', "What's different, demonstrated rather than asserted."],
            ['Show the receipts', 'Quotes, usage, and outcomes you can trace back to a source.'],
          ].map(([t, b], i) => (
            <div key={t}>
              <div style={{ fontFamily: SERIF, fontSize: 20, color: paletteAccent }}>{i + 1}</div>
              <div style={{ fontFamily: SERIF, fontSize: 13, margin: '3px 0' }}>{t}</div>
              <div style={{ fontSize: 9.5, lineHeight: 1.55, ...soft }}>{b}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Before & after two-pane */}
      <div style={{ ...pad, borderTop: `1px solid ${paletteSecondary}`, paddingTop: 24, paddingBottom: 24 }}>
        {secHead('Before & after', 'What actually changes')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 10, padding: 14, background: '#fff' }}>
            <div style={{ fontFamily: SERIF, fontSize: 13, marginBottom: 5 }}>Today</div>
            <div style={{ fontSize: 9.5, lineHeight: 1.55, ...soft }}>The work is manual, scattered, and hard to trust. People route around the tools — and the evidence lives in someone's head.</div>
          </div>
          <div style={{ border: `1px solid ${paletteAccent}33`, borderRadius: 10, padding: 14, background: `${paletteAccent}0d` }}>
            <div style={{ fontFamily: SERIF, fontSize: 13, marginBottom: 5 }}>With it</div>
            <div style={{ fontSize: 9.5, lineHeight: 1.55, ...soft }}>One clear flow, less busywork, and a trail of proof at every step — so the next person doesn't have to take your word for it.</div>
          </div>
        </div>
      </div>

      {/* Signal metrics */}
      <div style={{ ...pad, borderTop: `1px solid ${paletteSecondary}`, paddingTop: 22, paddingBottom: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {[['Live', 'In real customer hands'], ['Weekly', 'New signal coming in'], ['Traceable', 'Every claim has a source']].map(([v, l]) => (
            <div key={v}>
              <div style={{ fontFamily: SERIF, fontSize: 24, color: paletteAccent }}>{v}</div>
              <div style={{ fontSize: 9.5, marginTop: 2, ...soft }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Testimonials */}
      <div style={{ ...pad, borderTop: `1px solid ${paletteSecondary}`, paddingTop: 24, paddingBottom: 24 }}>
        {secHead('In their words', 'What people tell us')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {[
            ['"It did in an afternoon what used to take us a week — and we could show our team exactly why."', 'Early customer · operations'],
            ['"The difference is you can actually check the claims. That\'s rare, and it\'s why we stayed."', 'Design partner · founder'],
          ].map(([q, w]) => (
            <div key={w} style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 10, padding: 14, background: '#fff' }}>
              <div style={{ fontFamily: SERIF, fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{q}</div>
              <div style={{ fontSize: 9, ...soft }}>{w}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Waitlist CTA */}
      <div style={{ margin: '0 32px 26px', background: paletteInk, color: paletteBg, borderRadius: 14, padding: '26px 24px', textAlign: 'center' }}>
        <div style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 5 }}>{ctaText}</div>
        <div style={{ fontSize: 10.5, opacity: 0.82, marginBottom: 14 }}>Join the early list. We'll share what we're seeing and bring you in as we open access.</div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          <div style={{ flex: '0 1 200px', fontSize: 10, padding: '8px 10px', borderRadius: 7, border: `1px solid ${paletteBg}33`, background: `${paletteBg}1a`, color: `${paletteBg}99`, textAlign: 'left' }}>you@email.com</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 7, padding: '8px 14px' }}>{ctaText}</div>
        </div>
      </div>

      <div style={{ ...pad, borderTop: `1px solid ${paletteSecondary}`, display: 'flex', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 16, fontSize: 8.5, ...soft }}>
        <span>{brandName}</span>
        <span>Built with Axal VC</span>
      </div>
    </div>
  );
}
