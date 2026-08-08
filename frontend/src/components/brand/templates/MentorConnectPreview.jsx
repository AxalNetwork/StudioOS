// Ported from brandtemplates/Mentor Connect/ — minimal single-column mentor note.
export const NATURAL_WIDTH = 720;

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function MentorConnectPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = "We'd value 30 minutes of your perspective.",
    subheadline = "We're the founders. Below is a quick overview of what we're building, the two questions we're stuck on, and why your experience would help us think more clearly.",
    ctaText = 'Become a mentor',
    themeColor = '#c56a3e',
    paletteBg = '#fbfaf8',
    paletteInk = '#16100c',
    paletteSecondary = '#e2ddd7',
    paletteAccent = '#c56a3e',
    logoUrl = null,
  } = data;
  const muted = { color: paletteInk, opacity: 0.6 };
  const eyebrow = { fontSize: 8, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: paletteAccent };
  const secTitle = (n, t) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 8, color: paletteAccent }}>{n}</span>
      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{t}</span>
    </div>
  );
  const dot = <span style={{ width: 4, height: 4, borderRadius: 999, background: paletteAccent, display: 'inline-block', marginRight: 6, flexShrink: 0, marginTop: 5 }} />;
  const stat = (k, v) => (
    <div key={k}>
      <div style={{ fontSize: 7.5, textTransform: 'uppercase', letterSpacing: '0.1em', ...muted }}>{k}</div>
      <div style={{ fontSize: 10.5, marginTop: 2 }}>{v}</div>
    </div>
  );
  return (
    <div data-testid="template-preview-mentor-connect" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      <div style={{ width: 560, margin: '0 auto', padding: '28px 0 36px' }}>
        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {logoUrl
              ? <img src={logoUrl} alt="" style={{ width: 14, height: 14, borderRadius: 4, objectFit: 'cover' }} />
              : <span style={{ width: 6, height: 6, borderRadius: 999, background: paletteAccent }} />}
            <span style={{ fontSize: 11, fontWeight: 600 }}>{brandName}</span>
            <span style={{ fontSize: 11, ...muted }}>· a note for a mentor</span>
          </div>
          <span style={{ fontSize: 10, textDecoration: 'underline', textUnderlineOffset: 3, ...muted }}>Skip to the ask</span>
        </div>

        {/* Hero */}
        <div style={{ marginTop: 34, paddingBottom: 26, borderBottom: `1px solid ${paletteSecondary}` }}>
          <div style={eyebrow}>A short note · 3 min read</div>
          <div style={{ fontSize: 29, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', marginTop: 10 }}>{headline}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: 12, ...muted }}>{subheadline}</div>
          <div style={{ fontSize: 10.5, marginTop: 8, ...muted }}>No pitch, no follow-up loop. Just one conversation, on your time — 30 minutes of your perspective.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 18 }}>
            {["What we're building", 'Where we need help', 'Experience that matters', 'Progress so far', 'Why you', 'Offer guidance'].map((s) => (
              <span key={s} style={{ fontSize: 9.5, textDecoration: 'underline', textUnderlineOffset: 3, ...muted }}>{s}</span>
            ))}
          </div>
        </div>

        {/* 01 */}
        <div style={{ padding: '22px 0', borderBottom: `1px solid ${paletteSecondary}` }}>
          {secTitle('01', "What we're building")}
          <div style={{ fontSize: 11, lineHeight: 1.6, ...muted }}>
            A verification layer for AI agents acting on a user's behalf — payments, scheduling, account changes. We confirm intent and produce a signed receipt.
          </div>
          <div style={{ fontSize: 11, marginTop: 6, ...muted }}>One line: <span style={{ color: paletteInk, opacity: 1 }}>a trust rail for agent-initiated transactions</span>.</div>
        </div>

        {/* 02 */}
        <div style={{ padding: '22px 0', borderBottom: `1px solid ${paletteSecondary}` }}>
          {secTitle('02', 'Where we need help')}
          <div style={{ borderLeft: `1px solid ${paletteSecondary}`, paddingLeft: 14, display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11 }}>1. How do enterprise security teams actually evaluate a new authorization vendor?</div>
              <div style={{ fontSize: 10, lineHeight: 1.55, marginTop: 3, ...muted }}>CISOs ask for proof-of-intent signing, then procurement says "Q3." Is the real gate technical, legal, or just who gets fired if this breaks?</div>
            </div>
            <div>
              <div style={{ fontSize: 11 }}>2. Is the right first wedge consumer fintech, or internal enterprise agents?</div>
              <div style={{ fontSize: 10, lineHeight: 1.55, marginTop: 3, ...muted }}>Fintech moves faster but compliance is stricter; enterprise pays more but sales cycles run 6–12 months.</div>
            </div>
          </div>
        </div>

        {/* 03 */}
        <div style={{ padding: '22px 0', borderBottom: `1px solid ${paletteSecondary}` }}>
          {secTitle('03', 'What kind of experience matters')}
          <div style={{ display: 'grid', gap: 5 }}>
            {['Sold infra or security into the F500.', 'Built a developer API that became a standard.', 'Picked a wedge wrong once and remembers why.'].map((t) => (
              <div key={t} style={{ display: 'flex', fontSize: 11, ...muted }}>{dot}{t}</div>
            ))}
          </div>
          <div style={{ fontSize: 10, marginTop: 8, ...muted }}>You don't need all of these. One is plenty.</div>
        </div>

        {/* 04 */}
        <div style={{ padding: '22px 0' }}>
          {secTitle('04', 'Progress so far')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 18px' }}>
            {stat('Team', '3 founders, ex-Stripe')}
            {stat('Product', 'Private beta, 4 design partners')}
            {stat('Traction', '~12k verified intents / wk')}
            {stat('Funding', 'Pre-seed closed')}
            {stat('Built', 'SDK + dashboard + audit log')}
            {stat('Next', 'First paid contract')}
          </div>
        </div>

        {/* CTA ask-card */}
        <div style={{ marginTop: 14, border: `1px solid ${paletteSecondary}`, borderRadius: 14, background: '#fff', padding: 22, boxShadow: '0 6px 18px -14px rgba(0,0,0,0.3)' }}>
          <div style={eyebrow}>The ask</div>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 6 }}>Offer 30 minutes of guidance.</div>
          <div style={{ fontSize: 10.5, lineHeight: 1.55, marginTop: 6, ...muted }}>We'll send a short pre-read 24 hours ahead, keep the call confidential, and follow up with a brief summary if you'd like.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 6, padding: '7px 14px' }}>{ctaText}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, border: `1px solid ${paletteSecondary}`, borderRadius: 6, padding: '7px 14px' }}>Book a 30-min slot</span>
          </div>
          <div style={{ fontSize: 9, marginTop: 10, ...muted }}>If now isn't the right time, a one-line "not this quarter" is a complete reply. Truly — thank you for reading this far.</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, fontSize: 8.5, ...muted }}>
          <span>{brandName} · 2026</span>
          <span>Back to top ↑</span>
        </div>
      </div>
    </div>
  );
}
