export const NATURAL_WIDTH = 720;

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

export default function CofounderConnectPreview({ data = {} }) {
  const {
    brandName = 'Axal',
    headline = "I'm looking for one person to build Axal with me.",
    subheadline = 'A runtime that makes autonomous agents accountable for their actions by logging, attributing, and allowing rollback of every operation they take.',
    ctaText = 'Talk about joining',
    themeColor = '#bf4500',
    paletteBg = '#fbfaf7',
    paletteInk = '#15110d',
    paletteSecondary = '#cac3ba',
    paletteAccent = '#bf4500',
    logoUrl = null,
  } = data;
  const lm = { fontFamily: MONO, fontSize: 8.5, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.6 };
  const built = [
    ['Runtime core', 'Action commit log with replay. ~14k LOC, Rust.', 'Working', true],
    ['3 design partners', 'Mid-stage fintech, infra co, and an AI-native CRM.', 'Paid pilots', true],
    ['$1.6M pre-seed', 'Led by a fund I trust. Clean cap table.', 'Closed', false],
    ['Public benchmark', 'Open eval for agent reliability. 400 GitHub stars.', 'Live', false],
  ];
  const missing = [
    ['A product mind I can argue with.', "I've been making every product call alone for eleven months. Some of them are wrong."],
    ["Distribution that isn't me on Twitter.", 'Design partners came inbound. That doesn’t scale. No real go-to-market motion yet.'],
  ];
  const cols3 = [
    ['First 90 days', ['Own the SDK end-to-end', 'Ship v1 of the dashboard', 'Sit in on every partner call']],
    ['You look like', ['Built something people use', 'Strong opinions, held loosely', '"Founder who can code"']],
    ['Not looking for', ['A CTO title for a résumé', 'A de-risked problem', 'A second me']],
  ];
  return (
    <div data-testid="template-preview-cofounder-connect" style={{ width: 720, background: paletteBg, color: paletteInk, fontFamily: SANS, overflow: 'hidden', lineHeight: 1.6 }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 34px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover' }} />
            : <span style={{ width: 7, height: 7, borderRadius: '50%', background: paletteAccent, display: 'inline-block' }} />}
          <b style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 500 }}>{brandName}</b>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 999, padding: '6px 14px' }}>{ctaText}</span>
      </div>
      {/* Hero with dot-grain */}
      <div style={{ position: 'relative', padding: '34px 34px 30px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(${paletteInk}0d 1px, transparent 1px)`, backgroundSize: '5px 5px', opacity: 0.5, pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ ...lm, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: paletteAccent, boxShadow: `0 0 0 3px ${paletteAccent}33` }} />
            A letter from the founder · June 2026
          </div>
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 38, lineHeight: 1.04, letterSpacing: '-.02em', margin: '14px 0 14px', maxWidth: '22ch' }}>
            {headline.includes(brandName)
              ? <>{headline.split(brandName)[0]}<em style={{ fontStyle: 'italic', color: paletteAccent }}>{brandName}</em>{headline.split(brandName)[1]}</>
              : headline}
          </h1>
          <p style={{ fontSize: 12.5, maxWidth: '58ch', margin: '0 0 8px' }}>{subheadline}</p>
          <p style={{ fontSize: 11, opacity: 0.72, maxWidth: '58ch', margin: '0 0 16px' }}>
            Not a hire. Not a contractor. A co-founder. Someone who wants their name on the thing.
          </p>
          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 999, padding: '10px 20px' }}>{ctaText}</span>
          <span style={{ display: 'inline-block', marginLeft: 10, fontSize: 10, border: `1px solid ${paletteInk}`, borderRadius: 999, padding: '9px 16px' }}>See what's built</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, borderTop: `1px solid ${paletteSecondary}`, marginTop: 24, paddingTop: 14 }}>
            {[['Stage', 'Pre-seed, funded'], ['Team', '1 (me)'], ['Runway', '18 months'], ['Equity', 'Co-founder, real']].map(([k, v]) => (
              <div key={k}>
                <div style={lm}>{k}</div>
                <div style={{ fontFamily: SERIF, fontSize: 15, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Mission */}
      <div style={{ padding: '24px 34px', borderBottom: `1px solid ${paletteSecondary}`, display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 22 }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.15, margin: 0 }}>The mission, in one line</h2>
        <p style={{ fontSize: 11, opacity: 0.82, margin: 0 }}>
          Make autonomous software accountable for the work it does — a runtime where every agent action is committed, attributable, and reversible, the way a database is for data.
        </p>
      </div>
      {/* Why now — boxed hairline 3-col */}
      <div style={{ padding: '24px 34px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, margin: '0 0 14px' }}>Why now</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: paletteSecondary, border: `1px solid ${paletteSecondary}` }}>
          {[
            ['01', 'Agents shipped before guardrails did.', 'Frontier labs solved capability. Nobody solved accountability.'],
            ['02', 'Regulation is 12 months out.', 'EU AI Act enforcement and SOC2-for-agents land inside our build window.'],
            ['03', 'Buyers know they have the problem.', '31 unsolicited intro calls with platform teams. They are asking when.'],
          ].map(([n, h, p]) => (
            <div key={n} style={{ background: paletteBg, padding: '15px 14px' }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: paletteAccent }}>{n}</div>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 13.5, lineHeight: 1.25, margin: '7px 0 5px' }}>{h}</h3>
              <p style={{ margin: 0, opacity: 0.76, fontSize: 10 }}>{p}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Built rows with status pills — signature */}
      <div style={{ padding: '24px 34px', borderBottom: `1px solid ${paletteSecondary}` }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>You are not joining an idea</h2>
        {built.map(([nm, ds, pill, on], i) => (
          <div key={nm} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 12, alignItems: 'center', padding: '9px 0', borderTop: i ? `1px solid ${paletteSecondary}` : 'none' }}>
            <span style={{ fontFamily: SERIF, fontSize: 12.5 }}>{nm}</span>
            <span style={{ opacity: 0.74, fontSize: 10.5 }}>{ds}</span>
            <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '.1em', textTransform: 'uppercase', border: `1px solid ${on ? paletteAccent : paletteSecondary}`, color: on ? paletteAccent : paletteInk, borderRadius: 999, padding: '3px 9px' }}>{pill}</span>
          </div>
        ))}
      </div>
      {/* Missing — marker highlight */}
      <div style={{ padding: '24px 34px', borderBottom: `1px solid ${paletteSecondary}`, background: `${paletteSecondary}40` }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, margin: '0 0 14px' }}>What's missing, said plainly</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {missing.map(([h, p]) => (
            <div key={h}>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 14.5, margin: '0 0 5px', display: 'inline', backgroundImage: `linear-gradient(transparent 65%, ${paletteAccent}40 65%)` }}>{h}</h3>
              <p style={{ margin: '5px 0 0', opacity: 0.8, fontSize: 10.5 }}>{p}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Role: terms + 3 cols */}
      <div style={{ padding: '24px 34px', borderBottom: `1px solid ${paletteSecondary}`, display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 22 }}>
        <div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>The role</h2>
          {[['Equity', '15–25%'], ['Salary', '$120–160k'], ['Location', 'NYC, 3+ days'], ['Start', 'Within 60 days']].map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: i ? `1px solid ${paletteSecondary}` : 'none', fontSize: 10.5 }}>
              <span>{k}</span>
              <span style={{ fontFamily: MONO, color: paletteAccent, fontSize: 10 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {cols3.map(([h, items]) => (
            <div key={h}>
              <h4 style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', margin: '0 0 7px' }}>{h}</h4>
              {items.map((t) => (
                <div key={t} style={{ padding: '3px 0', opacity: 0.82, fontSize: 10 }}>
                  <span style={{ color: paletteAccent }}>— </span>{t}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Dark CTA */}
      <div style={{ background: paletteInk, color: paletteBg, padding: '30px 34px 32px' }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, lineHeight: 1.1, margin: '0 0 12px', maxWidth: '26ch' }}>
          Let's <em style={{ fontStyle: 'italic', color: paletteAccent }}>talk</em> about building this together.
        </h2>
        {['30-min intro call. Mostly me listening.', 'Half-day working session: we whiteboard the SDK redesign together.', 'Mutual references, then a decision within two weeks.'].map((t, i) => (
          <div key={t} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i ? `1px solid ${paletteBg}26` : 'none', fontSize: 10.5, opacity: 0.9, maxWidth: 420 }}>
            <span style={{ fontFamily: MONO, color: paletteAccent, fontSize: 9 }}>{`0${i + 1}`}</span>
            <span>{t}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, maxWidth: 360, marginTop: 16 }}>
          <div style={{ flex: 1, fontSize: 10.5, padding: '9px 14px', border: `1px solid ${paletteBg}40`, borderRadius: 999, color: paletteBg, opacity: 0.6 }}>you@email.com</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, background: themeColor, color: '#fff', borderRadius: 999, padding: '9px 18px', whiteSpace: 'nowrap' }}>{ctaText}</div>
        </div>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, marginTop: 18, opacity: 0.85 }}>— The founder, {brandName}</div>
      </div>
    </div>
  );
}
