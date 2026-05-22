import React from 'react';
import { Slide16x9, Editable, DeckProps, v, fmtUSD } from '../DeckBase';

export const Deck_investor_appendix: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const F = '"Source Serif Pro", Georgia, serif';
  const SANS = 'Inter, system-ui, sans-serif';
  const INK = '#0F172A';
  const ACCENT = '#1E40AF';
  const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ fontFamily: SANS, fontSize: 22, color: ACCENT, letterSpacing: 4, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
  return <>
    <Slide16x9 font={F} ink={INK} bg="#FAFAF9">
      <div style={{ borderTop: `4px solid ${ACCENT}`, width: 240 }} />
      <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
        <Editable path="company" value={v(data,'company')} editable={editable} onEdit={onEdit}
          placeholder="[Company]" style={{ fontSize: 152, fontWeight: 700, letterSpacing: -2 }} />
        <Editable path="tagline" value={v(data,'tagline')} editable={editable} onEdit={onEdit}
          placeholder="[Tagline]"
          style={{ fontFamily: SANS, fontSize: 36, marginTop: 24, color: '#475569' }} />
      </div>
    </Slide16x9>

    {[
      ['Problem', 'problem'],
      ['Solution', 'solution'],
      ['Product', 'product'],
      ['Market', 'market'],
      ['Business model', 'business_model'],
      ['Traction', 'traction'],
      ['Unit economics', 'unit_economics'],
      ['Competition', 'competition'],
      ['Team', 'team'],
    ].map(([label, key]) => (
      <Slide16x9 key={key} font={F} ink={INK} bg="#FAFAF9">
        <Title>{label}</Title>
        <Editable path={key} value={v(data,key)} editable={editable} onEdit={onEdit}
          placeholder={`[${label}]`}
          style={{ fontSize: 48, lineHeight: 1.35, marginTop: 56, maxWidth: 1500 }} />
      </Slide16x9>
    ))}

    <Slide16x9 font={F} ink={INK} bg="#FAFAF9">
      <Title>The ask</Title>
      <Editable path="ask_amount" value={fmtUSD(v(data,'ask_amount'))} editable={editable} onEdit={onEdit}
        style={{ fontFamily: SANS, fontSize: 144, fontWeight: 700, marginTop: 56 }} />
      <Editable path="use_of_funds" value={v(data,'use_of_funds')} editable={editable} onEdit={onEdit}
        placeholder="[Use of funds]"
        style={{ fontFamily: SANS, fontSize: 32, marginTop: 24, color: '#475569', maxWidth: 1500 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK} bg="#FAFAF9">
      <Title>Data room</Title>
      <Editable path="data_room_link" value={v(data,'data_room_link')} editable={editable} onEdit={onEdit}
        placeholder="https://"
        style={{ fontFamily: SANS, fontSize: 48, color: ACCENT, marginTop: 64, textDecoration: 'underline' }} />
      <div style={{ fontFamily: SANS, fontSize: 24, color: '#64748B', marginTop: 24, maxWidth: 1500 }}>
        Access by request. NDA required. Documents and exhibits below mirror the live data room.
      </div>
    </Slide16x9>

    {/* Appendix divider */}
    <Slide16x9 font={F} ink="#FAFAF9" bg={ACCENT}>
      <div style={{ margin: 'auto', textAlign: 'center' }}>
        <div style={{ fontFamily: SANS, fontSize: 26, letterSpacing: 12 }}>APPENDIX</div>
        <div style={{ fontSize: 168, fontWeight: 700, marginTop: 32 }}>{v(data,'company','Company')}</div>
      </div>
    </Slide16x9>

    {/* 10 appendix pages */}
    {[
      'Financials — 5-year plan',
      'Cap table',
      'Metrics — DAU/WAU/MAU',
      'Cohort tables',
      'Top-20 customers',
      'Material contracts',
      'Security & compliance',
      'Team — full bios',
      'Roadmap — 24 months',
      'References',
    ].map((label) => {
      const key = `appendix.${label.toLowerCase().replace(/[^a-z]/g,'_')}`;
      return (
        <Slide16x9 key={key} font={F} ink={INK} bg="#FAFAF9">
          <Title>Appendix · {label}</Title>
          <Editable path={key} value={v(data,key)} editable={editable} onEdit={onEdit}
            placeholder={`[${label} — table or narrative]`}
            style={{ fontFamily: SANS, fontSize: 28, lineHeight: 1.5, marginTop: 48, maxWidth: 1700 }} />
        </Slide16x9>
      );
    })}
  </>;
};
