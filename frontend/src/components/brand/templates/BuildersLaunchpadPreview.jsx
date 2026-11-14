// Builder's Launchpad — miniaturized preview of brandtemplates/Builder's Launchpad/.
// facts / vision / state / road / equity come from the same accessor
// renderBuildersLaunchpad reads, so preview == published page.
import { templateContent } from '../../../lib/brand/templateContent.js';

export const NATURAL_WIDTH = 720;

const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function BuildersLaunchpadPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'We have a wedge, paying users, and a runway problem only a builder can fix.',
    subheadline = 'A pre-seed company building infrastructure for verifiable agent execution. We are looking for one engineer to own the system end-to-end alongside the founder. This page is the honest version of the pitch.',
    ctaText = 'Join as technical co-founder',
    themeColor = '#dcb400',
    paletteBg = '#090e11',
    paletteInk = '#e8ecee',
    paletteSecondary = '#2c343a',
    paletteAccent = '#dcb400',
    logoUrl = null,
    content = null,
  } = data;
  const c = templateContent(content, 'builders-launchpad');

  const ok = '#7bbf5a', warn = paletteAccent, danger = '#d9544e';
  const um = { fontSize: 8, letterSpacing: '.14em', textTransform: 'uppercase' };
  const muted = { color: paletteInk, opacity: 0.6 };
  const body = { fontSize: 10.5, lineHeight: 1.65, margin: 0, opacity: 0.85 };
  const rail = { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 20, padding: '26px 28px', borderTop: `1px solid ${paletteSecondary}` };
  const h2 = { fontSize: 17, fontWeight: 500, letterSpacing: '-.01em', margin: '0 0 10px', lineHeight: 1.25 };

  const facts = c.list('facts');
  const status = c.list('state');
  const roadmap = c.list('road');
  const equity = c.list('equity');
  const toneColor = (t) => ({ ok, warn, dn: danger }[String(t || '').trim().toLowerCase()] || warn);

  return (
    <div data-testid="template-preview-builders-launchpad" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: MONO, overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 28px', borderBottom: `1px solid ${paletteSecondary}`, fontSize: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {logoUrl ? <img src={logoUrl} alt="" style={{ height: 12 }} /> : <span style={{ width: 8, height: 8, background: paletteAccent, borderRadius: 2 }} />}
          <span>{brandName.toLowerCase()}</span>
          <span style={muted}>/ co-founder brief</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span>apply →</span>
        </div>
      </div>

      {/* Hero + facts grid */}
      <div style={{ padding: '30px 28px 28px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <p style={{ ...um, ...muted, margin: '0 0 10px' }}>Hiring · Technical co-founder · SF preferred, remote OK</p>
        <h1 style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-.01em', margin: 0, maxWidth: 560 }}>{headline}</h1>
        <p style={{ ...body, marginTop: 12, maxWidth: 480 }}>{subheadline}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <span style={{ background: paletteAccent, color: '#090e11', fontSize: 10, fontWeight: 600, padding: '8px 14px' }}>{ctaText} →</span>
          <span style={{ border: `1px solid ${paletteSecondary}`, fontSize: 10, padding: '8px 14px' }}>Read where we actually are</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: paletteSecondary, border: `1px solid ${paletteSecondary}`, marginTop: 22 }}>
          {facts.map((f, i) => (
            <div key={i} style={{ background: paletteBg, padding: 10 }}>
              <div style={{ ...um, ...muted }}>{f.key}</div>
              <div style={{ fontSize: 9.5, marginTop: 5 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 01 Vision */}
      <div style={rail}>
        <div style={{ fontSize: 9 }}>
          <div style={{ color: paletteAccent }}>01</div>
          <div style={{ ...um, ...muted, marginTop: 2 }}>Product vision</div>
        </div>
        <div>
          <h2 style={h2}>What {brandName} is building.</h2>
          <p style={body}>{c.t('vision')}</p>
        </div>
      </div>

      {/* 02 Current state — status badges */}
      <div style={rail}>
        <div style={{ fontSize: 9 }}>
          <div style={{ color: paletteAccent }}>02</div>
          <div style={{ ...um, ...muted, marginTop: 2 }}>Current state</div>
        </div>
        <div>
          <h2 style={h2}>What exists today — written plainly.</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {status.map((st, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10, borderLeft: `2px solid ${paletteSecondary}`, paddingLeft: 10 }}>
                <span style={{ ...um, color: toneColor(st.tone), paddingTop: 2 }}>{st.badge}</span>
                <span style={{ ...body, fontSize: 10 }}>{st.body}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 03 Roadmap counters */}
      <div style={rail}>
        <div style={{ fontSize: 9 }}>
          <div style={{ color: paletteAccent }}>03</div>
          <div style={{ ...um, ...muted, marginTop: 2 }}>What needs to be built</div>
        </div>
        <div>
          <h2 style={h2}>The next 12 months of engineering, in order.</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {roadmap.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10 }}>
                <span style={{ color: paletteAccent, fontSize: 10 }}>{String(i + 1).padStart(2, '0')}</span>
                <div style={{ ...body, fontSize: 10 }}>{r.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 06 Equity */}
      <div style={rail}>
        <div style={{ fontSize: 9 }}>
          <div style={{ color: paletteAccent }}>06</div>
          <div style={{ ...um, ...muted, marginTop: 2 }}>Equity & collaboration</div>
        </div>
        <div>
          <h2 style={h2}>How we want to work together.</h2>
          <p style={{ ...body, marginBottom: 8 }}><span style={{ color: paletteAccent }}>Co-founder, not first engineer.</span> Title, equity, and decision-making reflect that.</p>
          <div style={{ display: 'grid', gap: 6 }}>
            {equity.map((e, i) => (
              <p key={i} style={{ ...body, ...muted, fontSize: 9.5 }}>
                <span style={{ color: paletteAccent }}>— </span>{e.body}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* 07 Apply — terminal window CTA */}
      <div style={rail}>
        <div style={{ fontSize: 9 }}>
          <div style={{ color: paletteAccent }}>07</div>
          <div style={{ ...um, ...muted, marginTop: 2 }}>Apply</div>
        </div>
        <div>
          <h2 style={h2}>{ctaText}</h2>
          <p style={{ ...body, ...muted }}>Send a note. No formal CV needed — link to something you built and the hardest bug you remember shipping.</p>
          <div style={{ border: `1px solid ${paletteSecondary}`, marginTop: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ borderBottom: `1px solid ${paletteSecondary}`, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 5, fontSize: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: danger, opacity: 0.7 }} />
              <span style={{ width: 7, height: 7, borderRadius: 999, background: warn, opacity: 0.7 }} />
              <span style={{ width: 7, height: 7, borderRadius: 999, background: ok, opacity: 0.7 }} />
              <span style={{ marginLeft: 6, ...muted }}>~/apply.sh</span>
            </div>
            <div style={{ padding: '12px 14px', fontSize: 10, lineHeight: 1.7, opacity: 0.9, whiteSpace: 'pre' }}>
              {'$ request access --product ' + brandName.toLowerCase() + '\n- something you built (link)\n- the hardest bug you remember shipping\n- what you want out of the next 4 years'}
            </div>
            <div style={{ borderTop: `1px solid ${paletteSecondary}`, padding: '10px 12px', display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, border: `1px solid ${paletteSecondary}`, padding: '7px 10px', fontSize: 9.5, ...muted }}>you@example.com</div>
              <span style={{ background: themeColor, color: '#090e11', fontSize: 9.5, fontWeight: 600, padding: '7px 12px' }}>{ctaText}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${paletteSecondary}`, padding: '12px 28px', display: 'flex', justifyContent: 'space-between', fontSize: 8.5, ...muted }}>
        <span>© {brandName}, Inc. — Brief, not a pitch deck.</span>
        <span>Built with Axal VC</span>
      </div>
    </div>
  );
}
