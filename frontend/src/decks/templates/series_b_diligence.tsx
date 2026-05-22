import React from 'react';
import { Slide16x9, Editable, DeckProps, v, fmtUSD, fmtNum, fmtPct } from '../DeckBase';

export const Deck_series_b_diligence: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const F = '"Source Serif Pro", Georgia, serif';
  const SANS = 'Inter, system-ui, sans-serif';
  const INK = '#0C0A09';
  const ACCENT = '#92400E';
  const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ fontFamily: SANS, fontSize: 20, letterSpacing: 4, color: ACCENT, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
  const Stat: React.FC<{ label: string; path: string; value: string }> = ({ label, path, value }) => (
    <div>
      <div style={{ fontFamily: SANS, fontSize: 18, color: '#78716C', letterSpacing: 2 }}>{label.toUpperCase()}</div>
      <Editable path={path} value={value} editable={editable} onEdit={onEdit}
        style={{ fontSize: 72, fontWeight: 700, fontFamily: SANS }} />
    </div>
  );
  return <>
    <Slide16x9 font={F} ink={INK} bg="#FAFAF7">
      <div style={{ borderTop: `2px solid ${ACCENT}`, width: 240 }} />
      <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
        <div style={{ fontFamily: SANS, fontSize: 20, color: ACCENT, letterSpacing: 6 }}>SERIES B · DILIGENCE PACK</div>
        <Editable path="company" value={v(data,'company')} editable={editable} onEdit={onEdit}
          placeholder="[Company]" style={{ fontSize: 160, fontWeight: 700, marginTop: 24, letterSpacing: -2 }} />
        <div style={{ fontFamily: SANS, fontSize: 20, color: '#78716C', marginTop: 16 }}>
          Strictly confidential. Distribution limited to named recipient.
        </div>
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK} bg="#FAFAF7">
      <Title>Executive summary</Title>
      <Editable path="exec_summary" value={v(data,'exec_summary')} editable={editable} onEdit={onEdit}
        placeholder="[Three-paragraph executive summary]"
        style={{ fontSize: 36, lineHeight: 1.5, marginTop: 48, maxWidth: 1500 }} />
    </Slide16x9>

    {[
      ['Problem', 'problem'],
      ['Solution', 'solution'],
      ['Product', 'product'],
      ['Market', 'market'],
      ['Competition', 'competition'],
      ['Go-to-market', 'gtm'],
    ].map(([label, key]) => (
      <Slide16x9 key={key} font={F} ink={INK} bg="#FAFAF7">
        <Title>{label}</Title>
        <Editable path={key} value={v(data,key)} editable={editable} onEdit={onEdit}
          placeholder={`[${label}]`}
          style={{ fontSize: 44, lineHeight: 1.4, marginTop: 56, maxWidth: 1500 }} />
      </Slide16x9>
    ))}

    <Slide16x9 font={F} ink={INK} bg="#FAFAF7">
      <Title>Traction</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 64, marginTop: 96 }}>
        <Stat label="ARR" path="arr" value={fmtUSD(v(data,'arr'))} />
        <Stat label="MoM" path="mom" value={fmtPct(v(data,'mom'))} />
        <Stat label="NRR" path="nrr" value={fmtPct(v(data,'nrr'))} />
        <Stat label="Logos" path="paying_customers" value={fmtNum(v(data,'paying_customers'))} />
        <Stat label="Magic #" path="magic_number" value={String(v(data,'magic_number','—'))} />
        <Stat label="Rule of 40" path="rule_of_40" value={fmtPct(v(data,'rule_of_40'))} />
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK} bg="#FAFAF7">
      <Title>Unit economics</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 96, marginTop: 96 }}>
        <Stat label="CAC" path="cac" value={fmtUSD(v(data,'cac'))} />
        <Stat label="LTV" path="ltv" value={fmtUSD(v(data,'ltv'))} />
        <Stat label="LTV / CAC" path="ltv_cac" value={String(v(data,'ltv_cac','—'))} />
        <Stat label="Payback (mo)" path="payback" value={fmtNum(v(data,'payback'))} />
      </div>
    </Slide16x9>

    {[
      ['Cohort retention', 'cohort_retention'],
      ['Customer logos', 'customer_logos'],
      ['Customer quote', 'customer_quote'],
      ['Financials', 'financials'],
      ['Roadmap', 'roadmap'],
      ['Team', 'team'],
      ['Risks', 'risks'],
    ].map(([label, key]) => (
      <Slide16x9 key={key} font={F} ink={INK} bg="#FAFAF7">
        <Title>{label}</Title>
        <Editable path={key} value={v(data,key)} editable={editable} onEdit={onEdit}
          placeholder={`[${label}]`}
          style={{ fontSize: 40, lineHeight: 1.4, marginTop: 48, maxWidth: 1500 }} />
      </Slide16x9>
    ))}

    <Slide16x9 font={F} ink={INK} bg="#FAFAF7">
      <Title>The ask · Use of funds</Title>
      <Editable path="ask_amount" value={fmtUSD(v(data,'ask_amount'))} editable={editable} onEdit={onEdit}
        style={{ fontSize: 144, fontWeight: 700, marginTop: 56, fontFamily: SANS }} />
      <Editable path="use_of_funds" value={v(data,'use_of_funds')} editable={editable} onEdit={onEdit}
        placeholder="[Use of funds]"
        style={{ fontSize: 32, marginTop: 24, lineHeight: 1.4, maxWidth: 1500 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink="#FAFAF7" bg="#0C0A09">
      <div style={{ margin: 'auto', textAlign: 'center' }}>
        <div style={{ fontSize: 22, letterSpacing: 8, color: '#A8A29E', fontFamily: SANS }}>APPENDIX</div>
        <div style={{ fontSize: 168, fontWeight: 700, marginTop: 32 }}>Data room</div>
        <div style={{ fontFamily: SANS, fontSize: 22, color: '#A8A29E', marginTop: 24 }}>
          Financials · Cap table · Customer data · Org · Technical · Legal
        </div>
      </div>
    </Slide16x9>

    {['Financials','Cap table','Top customers','Cohort tables','Org chart','Technical architecture','Material contracts'].map((label) => (
      <Slide16x9 key={label} font={F} ink={INK} bg="#FAFAF7">
        <Title>Appendix · {label}</Title>
        <Editable path={`appendix.${label.toLowerCase().replace(/[^a-z]/g,'_')}`}
          value={v(data,`appendix.${label.toLowerCase().replace(/[^a-z]/g,'_')}`)}
          editable={editable} onEdit={onEdit}
          placeholder={`[${label} detail / table]`}
          style={{ fontSize: 28, lineHeight: 1.6, marginTop: 48, maxWidth: 1700, fontFamily: SANS }} />
      </Slide16x9>
    ))}
  </>;
};
