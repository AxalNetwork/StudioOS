export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';

export default function CoFounderQuestPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = 'We are building the runtime that makes AI agents reliable enough to run real operations work.',
    subheadline = 'An orchestration layer that lets ops and revenue teams run multi-step agent workflows on top of their existing CRM, data warehouse, and internal tools. We need a technical co-founder to own the product surface end-to-end.',
    ctaText = 'Talk about the role',
    themeColor = '#ad524d',
    paletteBg = '#f9f8f6',
    paletteInk = '#0d1016',
    paletteSecondary = '#d4d7de',
    paletteAccent = '#ad524d',
    logoUrl = null,
  } = data;

  const label = { fontSize: 8, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: paletteAccent };
  const h2 = { fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.15, margin: '6px 0 0' };
  const body = { fontSize: 11, lineHeight: 1.6, opacity: 0.78, margin: 0 };
  const hr = { height: 1, background: paletteSecondary, border: 0, margin: '0 32px' };
  const twoCol = { display: 'grid', gridTemplateColumns: '190px 1fr', gap: 28, padding: '26px 32px' };
  const btn = { display: 'inline-block', fontSize: 10, fontWeight: 600, borderRadius: 10, padding: '9px 16px' };
  const softBox = { border: `1px solid ${paletteSecondary}`, background: 'rgba(0,0,0,0.025)', borderRadius: 8, padding: 14 };

  const built = [
    ['Product', 'Agent orchestration runtime in production. Workflow builder, eval harness, and connectors to Salesforce, Snowflake, and Slack.'],
    ['Traction', '6 paying pilots with mid-market ops and RevOps teams over the last 4 months. One customer expanded from 2 to 12 seats in 60 days. No churn yet.'],
    ['Team', 'Two founders: one technical (systems, infra), one GTM (enterprise sales, pricing).'],
    ['Runway', '18 months at current burn on a pre-seed round. Revenue covers ~30% of burn.'],
  ];
  const needCards = [
    ['Product architecture', 'Own the workflow model, the eval loop, and how agent outputs become trusted writes.'],
    ['Technical leadership', 'Make tradeoffs in hours, not weeks. Ship to production weekly. Hire the first 2–3 engineers.'],
    ['Founder energy', 'Not a CTO hire. A co-founder in the room every day, on customer calls, in the codebase.'],
  ];

  return (
    <div data-testid="template-preview-co-founder-quest" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden' }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
          {logoUrl ? <img src={logoUrl} alt="" style={{ height: 16 }} /> : null}
          {brandName}
        </div>
        <span style={{ fontSize: 10, opacity: 0.6 }}>The role</span>
      </div>

      {/* Hero — deliberately no stats strip */}
      <div style={{ padding: '20px 32px 34px', maxWidth: 560 }}>
        <p style={{ ...label, margin: 0 }}>Co-founder search</p>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 33, lineHeight: 1.08, letterSpacing: '-.01em', margin: '10px 0 12px' }}>{headline}</h1>
        <p style={{ ...body, fontSize: 12, maxWidth: 460 }}>{subheadline}</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <span style={{ ...btn, background: paletteInk, color: paletteBg }}>Read the full brief</span>
          <span style={{ ...btn, border: `1px solid ${paletteSecondary}`, color: paletteInk }}>{ctaText}</span>
        </div>
      </div>

      {/* Timing */}
      <div style={twoCol}>
        <div><p style={{ ...label, margin: 0 }}>Timing</p><h2 style={h2}>Why this matters now</h2></div>
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={body}>The models are good enough. What is still broken is the layer between "smart model" and "system an ops lead trusts to touch production data." That gap is the opportunity.</p>
          <p style={body}>We have a shipped product, paying customers, and a clear sense of what the next 12 months need to look like. The window is open.</p>
        </div>
      </div>
      <hr style={hr} />

      {/* Progress — plain unbordered built list */}
      <div style={twoCol}>
        <div><p style={{ ...label, margin: 0 }}>Progress</p><h2 style={h2}>What we have built</h2></div>
        <div style={{ display: 'grid', gap: 10 }}>
          {built.map(([k, v]) => (
            <div key={k}>
              <p style={{ fontSize: 10.5, fontWeight: 600, margin: 0 }}>{k}</p>
              <p style={{ ...body, marginTop: 2 }}>{v}</p>
            </div>
          ))}
        </div>
      </div>
      <hr style={hr} />

      {/* The gap — what we need */}
      <div style={{ padding: '26px 32px' }}>
        <p style={{ ...label, margin: 0 }}>The gap</p>
        <h2 style={{ ...h2, fontSize: 24 }}>What we need</h2>
        <p style={{ ...body, marginTop: 8, maxWidth: 480 }}>The honest part. We are strong on infra and GTM. We need someone who owns product end-to-end: what we build, how it feels, and how fast it improves.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 16 }}>
          {needCards.map(([t, d]) => (
            <div key={t} style={{ border: `1px solid ${paletteSecondary}`, borderRadius: 8, padding: 12, background: paletteBg }}>
              <p style={{ fontFamily: SERIF, fontSize: 13, margin: 0 }}>{t}</p>
              <p style={{ ...body, fontSize: 10, marginTop: 6 }}>{d}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, border: `1px solid ${paletteAccent}33`, background: `${paletteAccent}0d`, borderRadius: 8, padding: 14 }}>
          <p style={{ fontFamily: SERIF, fontSize: 14, margin: 0 }}>The ideal profile</p>
          {['You have shipped a 0→1 product to paying customers before, ideally at a seed/Series A startup.',
            'You can write production TypeScript or Python, design distributed systems, and argue strategy in the same afternoon.',
            'You care about reliability and evals more than the latest model release.'].map((t) => (
            <p key={t} style={{ ...body, marginTop: 6, paddingLeft: 12, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 0, top: 6, width: 4, height: 4, borderRadius: 999, background: paletteAccent }} />{t}
            </p>
          ))}
        </div>
        <div style={{ marginTop: 10, ...softBox, background: paletteBg }}>
          <p style={{ fontFamily: SERIF, fontSize: 14, margin: 0 }}>Your first 90 days</p>
          {['Weeks 1–4: ship alongside us on a live customer workflow. Name on a production deploy in week one.',
            'Weeks 5–8: own the eval and reliability stack end-to-end.',
            'Weeks 9–12: lead the architecture for workflow authoring and co-write the seed deck.'].map((t) => (
            <p key={t} style={{ ...body, marginTop: 6, paddingLeft: 12, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 0, top: 6, width: 4, height: 4, borderRadius: 999, background: paletteAccent }} />{t}
            </p>
          ))}
        </div>
      </div>
      <hr style={hr} />

      {/* Equity */}
      <div style={twoCol}>
        <div><p style={{ ...label, margin: 0 }}>How we work</p><h2 style={h2}>Equity and collaboration</h2></div>
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={body}>No cofounder tiers. Open conversation about numbers from the first call — no games, no "we'll figure it out later."</p>
          <div style={softBox}>
            <p style={{ fontSize: 10.5, fontWeight: 600, margin: 0 }}>Equity: 15–22% of common, depending on timing and scope.</p>
            <p style={{ ...body, fontSize: 10, marginTop: 4 }}>Vesting: 4 years, 1-year cliff, standard double-trigger acceleration.</p>
            <p style={{ ...body, fontSize: 10, marginTop: 4 }}>Cash: $140–180k base today, stepping to market rate at seed and again at Series A.</p>
          </div>
        </div>
      </div>
      <hr style={hr} />

      {/* Team */}
      <div style={twoCol}>
        <div><p style={{ ...label, margin: 0 }}>Who we are</p><h2 style={h2}>The team so far</h2></div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Alex — CEO</p>
            <p style={{ ...body, marginTop: 2 }}>Previously led platform engineering at a growth-stage AI company. Deep systems thinker. Obsessed with reliability.</p>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Jordan — GTM / Operations</p>
            <p style={{ ...body, marginTop: 2 }}>Built and closed enterprise deals at two previous startups, one exit. Knows the buyer. Knows the pain.</p>
          </div>
        </div>
      </div>
      <hr style={hr} />

      {/* CTA */}
      <div style={{ padding: '26px 32px 30px', maxWidth: 520 }}>
        <p style={{ ...label, margin: 0 }}>Next step</p>
        <h2 style={h2}>Join the build</h2>
        <p style={{ ...body, marginTop: 8 }}>If this resonates, send us a note. No résumé required. Tell us what you have built, what you want to build next, and why {brandName}.</p>
        <div style={{ ...softBox, marginTop: 12 }}>
          <p style={{ fontSize: 10.5, fontWeight: 600, margin: 0 }}>What happens next</p>
          <p style={{ ...body, fontSize: 10, marginTop: 4 }}>1. 30-min intro call with both founders within a week.</p>
          <p style={{ ...body, fontSize: 10, marginTop: 3 }}>2. A 3–4 hour working session on a real problem from our backlog.</p>
          <p style={{ ...body, fontSize: 10, marginTop: 3 }}>3. References both ways, plus a paid 1–2 week trial if useful.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <div style={{ flex: 1, border: `1px solid ${paletteSecondary}`, borderRadius: 10, padding: '9px 12px', fontSize: 10, opacity: 0.55 }}>you@example.com</div>
          <span style={{ ...btn, background: themeColor, color: '#fff' }}>{ctaText}</span>
        </div>
      </div>

      <div style={{ padding: '14px 32px 20px', borderTop: `1px solid ${paletteSecondary}`, display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.6 }}>
        <span>{brandName}, Inc. — 2026</span><span>Built with conviction.</span>
      </div>
    </div>
  );
}
