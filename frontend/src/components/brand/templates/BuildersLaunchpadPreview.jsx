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
  } = data;

  const ok = '#7bbf5a', warn = paletteAccent, danger = '#d9544e';
  const um = { fontSize: 8, letterSpacing: '.14em', textTransform: 'uppercase' };
  const muted = { color: paletteInk, opacity: 0.6 };
  const body = { fontSize: 10.5, lineHeight: 1.65, margin: 0, opacity: 0.85 };
  const rail = { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 20, padding: '26px 28px', borderTop: `1px solid ${paletteSecondary}` };
  const h2 = { fontSize: 17, fontWeight: 500, letterSpacing: '-.01em', margin: '0 0 10px', lineHeight: 1.25 };

  const facts = [
    ['Stage', 'Pre-seed · $1.4M SAFE'],
    ['Revenue', '~$8k MRR, 40 design partners'],
    ['Runway', '14 months at current burn'],
    ['Next round', 'Seed in ~12 months'],
  ];
  const status = [
    ['Working', ok, 'TypeScript SDK that wraps tool calls and emits signed execution traces. ~6k LOC.'],
    ['Working', ok, 'Hosted ingestion + replay UI. Customers use it to debug agents in staging.'],
    ['Half-working', warn, 'Multi-tenant control plane. Auth + orgs are in, billing is duct tape.'],
    ['Not built', danger, 'Deterministic sandboxed execution layer. This is the hard part.'],
  ];
  const roadmap = [
    ['01', 'Deterministic execution sandbox', 'A V8 isolate-based runtime that can re-execute a recorded agent trace and produce bit-identical outputs. This is the technical moat.'],
    ['02', 'Attestation pipeline', "Move from 'we sign traces with our key' to verifiable third-party attestations. Likely TEEs for the hot path."],
    ['03', 'Policy compiler', 'Compile the policy DSL to a small bytecode enforceable inside the sandbox with bounded execution time.'],
  ];

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
          <span style={muted}>last updated 2026-06-20</span>
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
          {facts.map(([k, v]) => (
            <div key={k} style={{ background: paletteBg, padding: 10 }}>
              <div style={{ ...um, ...muted }}>{k}</div>
              <div style={{ fontSize: 9.5, marginTop: 5 }}>{v}</div>
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
          <h2 style={h2}>A trust layer between LLM agents and the systems they touch.</h2>
          <p style={body}>The part nobody has solved well: <span style={{ color: paletteAccent }}>proving what an agent actually did</span>, to whom, under what policy, with what inputs. We are building the substrate the agents have to call through — signed commits and CI, but for agent actions.</p>
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
            {status.map(([s, c, t]) => (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10, borderLeft: `2px solid ${paletteSecondary}`, paddingLeft: 10 }}>
                <span style={{ ...um, color: c, paddingTop: 2 }}>{s}</span>
                <span style={{ ...body, fontSize: 10 }}>{t}</span>
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
            {roadmap.map(([n, t, d]) => (
              <div key={n} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10 }}>
                <span style={{ color: paletteAccent, fontSize: 10 }}>{n}</span>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 600 }}>{t}</div>
                  <div style={{ ...body, ...muted, fontSize: 9.5, marginTop: 2 }}>{d}</div>
                </div>
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
            <p style={{ ...body, ...muted, fontSize: 9.5 }}><span style={{ color: paletteInk, opacity: 1, fontWeight: 600 }}>Equity — </span><span style={{ color: paletteAccent }}>25–40% of common</span>, 4-year vest, 1-year cliff. The paid trial counts toward the cliff.</p>
            <p style={{ ...body, ...muted, fontSize: 9.5 }}><span style={{ color: paletteInk, opacity: 1, fontWeight: 600 }}>Salary — </span><span style={{ color: paletteAccent }}>$90–130k year one</span>, steps to ~$180k at seed close. The equity is the compensation.</p>
            <p style={{ ...body, ...muted, fontSize: 9.5 }}><span style={{ color: paletteInk, opacity: 1, fontWeight: 600 }}>Location — </span>SF preferred; fully remote on US hours is fine. ~1 week per quarter on-site.</p>
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
          <h2 style={h2}>Join as technical co-founder.</h2>
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
        <span>commit 0x9f3a · 2026-06-20</span>
      </div>
    </div>
  );
}
