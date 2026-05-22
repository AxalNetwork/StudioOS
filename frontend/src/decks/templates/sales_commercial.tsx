import React from 'react';
import { Slide16x9, Editable, DeckProps, v } from '../DeckBase';

export const Deck_sales_commercial: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const F = 'Inter, system-ui, sans-serif';
  const INK = '#0F172A';
  const ACCENT = '#059669';
  const Header: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ fontSize: 22, color: ACCENT, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
  const Body = (path: string, ph: string, size = 56) => (
    <Editable path={path} value={v(data,path)} editable={editable} onEdit={onEdit}
      placeholder={ph}
      style={{ fontSize: size, fontWeight: 500, lineHeight: 1.3, marginTop: 48, maxWidth: 1500 }} />
  );
  return <>
    <Slide16x9 font={F} ink={INK}>
      <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
        <div style={{ fontSize: 22, color: ACCENT, letterSpacing: 6 }}>PREPARED FOR · {v(data,'audience_name','[Customer]')}</div>
        <Editable path="company" value={v(data,'company')} editable={editable} onEdit={onEdit}
          placeholder="[Your company]" style={{ fontSize: 168, fontWeight: 800, marginTop: 16 }} />
        <Editable path="tagline" value={v(data,'tagline')} editable={editable} onEdit={onEdit}
          placeholder="[Tagline]"
          style={{ fontSize: 44, color: '#475569', marginTop: 24 }} />
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <Header>Who we are</Header>
      {Body('who_we_are', '[About us, 2 sentences]')}
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <Header>The cost of the status quo</Header>
      <Editable path="cost_of_status_quo" value={v(data,'cost_of_status_quo')} editable={editable} onEdit={onEdit}
        placeholder="[$X / year in lost revenue, hours, etc.]"
        style={{ fontSize: 120, fontWeight: 800, marginTop: 64, color: ACCENT }} />
      <Editable path="cost_explanation" value={v(data,'cost_explanation')} editable={editable} onEdit={onEdit}
        placeholder="[Why this number is real]"
        style={{ fontSize: 36, marginTop: 32, color: '#475569', maxWidth: 1500 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <Header>Our approach</Header>
      {Body('our_approach', '[Solution paragraph]')}
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <Header>How it works</Header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 48, marginTop: 80 }}>
        {[1,2,3].map((n) => (
          <div key={n} style={{ background: '#F1F5F9', padding: 32, borderRadius: 16 }}>
            <div style={{ fontSize: 64, fontWeight: 800, color: ACCENT }}>{n}</div>
            <Editable path={`step_${n}`} value={v(data,`step_${n}`)} editable={editable} onEdit={onEdit}
              placeholder={`[Step ${n}]`} style={{ fontSize: 28, fontWeight: 500, marginTop: 16, lineHeight: 1.3 }} />
          </div>
        ))}
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <Header>Benefits</Header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 48, marginTop: 64 }}>
        {[1,2,3,4].map((n) => (
          <Editable key={n} path={`benefit_${n}`} value={v(data,`benefit_${n}`)} editable={editable} onEdit={onEdit}
            placeholder={`[Benefit ${n}]`} style={{ fontSize: 40, fontWeight: 500, lineHeight: 1.3,
              borderLeft: `4px solid ${ACCENT}`, paddingLeft: 24 }} />
        ))}
      </div>
    </Slide16x9>

    {[1,2].map((n) => (
      <Slide16x9 key={n} font={F} ink={INK}>
        <Header>Case study {n}</Header>
        <Editable path={`case_${n}_quote`} value={v(data,`case_${n}_quote`)} editable={editable} onEdit={onEdit}
          placeholder={`[Customer quote ${n}]`}
          style={{ fontSize: 52, fontStyle: 'italic', fontWeight: 400, marginTop: 48, lineHeight: 1.3, maxWidth: 1500 }} />
        <Editable path={`case_${n}_attribution`} value={v(data,`case_${n}_attribution`)}
          editable={editable} onEdit={onEdit}
          placeholder="— Title, Company"
          style={{ fontSize: 28, marginTop: 32, color: '#64748B' }} />
      </Slide16x9>
    ))}

    {[
      ['Customer logos',  'customer_logos'],
      ['Integration',     'integration'],
      ['Security & trust','security'],
      ['Pricing',         'pricing'],
      ['Onboarding',      'onboarding'],
      ['Support',         'support'],
    ].map(([label, key]) => (
      <Slide16x9 key={key} font={F} ink={INK}>
        <Header>{label}</Header>
        {Body(key, `[${label}]`, 48)}
      </Slide16x9>
    ))}

    <Slide16x9 font={F} ink={INK}>
      <Header>Next steps</Header>
      <Editable path="next_steps" value={v(data,'next_steps')} editable={editable} onEdit={onEdit}
        placeholder="[Proposed pilot + timeline]"
        style={{ fontSize: 52, fontWeight: 500, lineHeight: 1.3, marginTop: 48, maxWidth: 1500 }} />
      <Editable path="contact" value={v(data,'contact')} editable={editable} onEdit={onEdit}
        placeholder="sales@example.com"
        style={{ fontSize: 28, color: '#64748B', marginTop: 'auto' }} />
    </Slide16x9>
  </>;
};
