// Ported from brandtemplates/Mentor Connect Page/ — narrative serif mentor letter.
// building / stuck / why / ask_options / timeline come from the same accessor
// renderMentorConnectPage reads, so preview == published page.
import { templateContent } from '../../../lib/brand/templateContent.js';

export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function MentorConnectPagePreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'Thank you for reading this.',
    subheadline = "We're a small team. This page is a short, honest summary of what we're working on, where we're stuck, and where a few minutes of your time could go a long way. No pitch — just context.",
    ctaText = 'Become a mentor',
    themeColor = '#b05139',
    paletteBg = '#fcfaf6',
    paletteInk = '#221811',
    paletteSecondary = '#e2ddd5',
    paletteAccent = '#b05139',
    logoUrl = null,
    content = null,
  } = data;
  const c = templateContent(content, 'mentor-connect-page');
  const soft = { color: paletteInk, opacity: 0.65 };
  const monoLabel = { fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.18em', ...soft };
  const Section = ({ label, title, children }) => (
    <div style={{ borderTop: `1px solid ${paletteSecondary}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 20, padding: '24px 40px' }}>
        <div style={{ ...monoLabel, paddingTop: 3 }}>{label}</div>
        <div>
          <div style={{ fontFamily: SERIF, fontSize: 17 }}>{title}</div>
          <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.65, ...soft }}>{children}</div>
        </div>
      </div>
    </div>
  );
  const arrow = (key, text) => (
    <div key={key} style={{ display: 'flex', gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, color: paletteAccent, paddingTop: 2 }}>→</span>
      <span>{text}</span>
    </div>
  );
  const stuck = c.list('stuck');
  const askOptions = c.list('ask_options');
  const timeline = c.list('timeline');

  return (
    <div data-testid="template-preview-mentor-connect-page" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 40px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 18, height: 18, borderRadius: 3, objectFit: 'cover' }} />
            : <span style={{ width: 18, height: 18, borderRadius: 3, background: paletteInk, color: paletteBg, fontFamily: MONO, fontSize: 9, display: 'grid', placeItems: 'center' }}>{(brandName || 'A').slice(0, 1)}</span>}
          <span style={{ fontFamily: SERIF, fontSize: 13 }}>{brandName}</span>
        </div>
        <span style={monoLabel}>A note for mentors</span>
      </div>

      {/* Hero */}
      <div style={{ padding: '36px 40px 30px' }}>
        <div style={{ fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.18em', color: paletteAccent }}>For — Mentor · Private link</div>
        <div style={{ fontFamily: SERIF, fontSize: 34, lineHeight: 1.1, marginTop: 14 }}>
          {headline}
          <span style={{ display: 'block', fontStyle: 'italic', ...soft }}>We could use your perspective.</span>
        </div>
        <div style={{ marginTop: 14, maxWidth: 440, fontSize: 12, lineHeight: 1.65, ...soft }}>{subheadline}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20 }}>
          <span style={{ background: paletteInk, color: paletteBg, borderRadius: 6, fontSize: 10.5, fontWeight: 600, padding: '7px 14px' }}>Offer guidance</span>
          <span style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 6, fontSize: 10.5, fontWeight: 600, padding: '7px 14px' }}>Schedule a short call →</span>
          <span style={{ fontFamily: MONO, fontSize: 8.5, ...soft }}>~3 min read</span>
        </div>
      </div>

      <Section label="01 — Building" title="What we're building">
        <p style={{ margin: 0 }}>{c.t('building')}</p>
      </Section>

      <Section label="02 — Stuck" title="Where we're stuck">
        <div style={{ display: 'grid', gap: 8 }}>
          {stuck.map((st, i) => arrow(i, <><span style={{ color: paletteInk, opacity: 1 }}>{st.label}.</span> {st.body}</>))}
        </div>
      </Section>

      <Section label="03 — Why you" title="Why we're asking you">
        <p style={{ margin: 0 }}>{c.t('why')}</p>
      </Section>

      <Section label="04 — Ask" title="What help would be most useful">
        <div style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 6, background: '#fff', padding: 14 }}>
          <div style={monoLabel}>Pick whichever is easiest</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {askOptions.map((o, i) => (
              <div key={i}><span style={{ color: paletteInk, opacity: 1 }}>{o.key}.</span> {o.body}</div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 10 }}>Any one of these is more than enough. No prep needed on your side.</div>
      </Section>

      <Section label="05 — Context" title="Background and progress">
        <div style={{ display: 'grid', gap: 6 }}>
          {timeline.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, width: 46, flexShrink: 0, paddingTop: 2, ...soft }}>{t.year}</span>
              <span>{t.body}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <div style={{ borderTop: `1px solid ${paletteSecondary}`, padding: '34px 40px 36px' }}>
        <div style={{ fontFamily: MONO, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.18em', color: paletteAccent }}>06 — Next</div>
        <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.15, marginTop: 8 }}>If you have a few minutes, we'd be grateful.</div>
        <div style={{ marginTop: 10, maxWidth: 440, fontSize: 11, lineHeight: 1.6, ...soft }}>
          If you say yes, we'll send a 1-page brief with our two open questions, keep the call to 20 minutes, and send a short summary back if you'd like.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <span style={{ background: themeColor, color: '#fff', borderRadius: 6, fontSize: 10.5, fontWeight: 600, padding: '7px 14px' }}>{ctaText}</span>
          <span style={{ border: `1px solid ${paletteInk}`, borderRadius: 6, fontSize: 10.5, fontWeight: 600, padding: '7px 14px' }}>Schedule a short call →</span>
        </div>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12, marginTop: 22, ...soft }}>Thank you, truly. — The {brandName} team</div>
      </div>

      <div style={{ borderTop: `1px solid ${paletteSecondary}`, display: 'flex', justifyContent: 'space-between', padding: '14px 40px', ...monoLabel }}>
        <span>{brandName} · 2026</span>
        <span>Private link — please don't share</span>
      </div>
    </div>
  );
}
