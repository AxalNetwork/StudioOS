import React from 'react';
import { Slide16x9, Editable, DeckProps, v, fmtUSD, fmtNum, fmtPct } from '../DeckBase';

export const Deck_series_a_growth: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const F = 'Inter, system-ui, sans-serif';
  const INK = '#0F172A';
  const ACCENT = '#7C3AED';
  const Stat: React.FC<{ label: string; path: string; value: string; col?: number }> = ({ label, path, value }) => (
    <div>
      <div style={{ fontSize: 22, color: '#64748B' }}>{label}</div>
      <Editable path={path} value={value} editable={editable} onEdit={onEdit}
        style={{ fontSize: 96, fontWeight: 700 }} />
    </div>
  );
  const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ fontSize: 24, color: ACCENT, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' }}>{children}</div>
  );
  return <>
    <Slide16x9 font={F} ink={INK}>
      <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
        <div style={{ fontSize: 22, color: ACCENT, letterSpacing: 4 }}>SERIES A · {new Date().getFullYear()}</div>
        <Editable path="company" value={v(data,'company')} editable={editable} onEdit={onEdit}
          placeholder="[Company]" style={{ fontSize: 168, fontWeight: 800, letterSpacing: -3, marginTop: 16 }} />
        <Editable path="tagline" value={v(data,'tagline')} editable={editable} onEdit={onEdit}
          placeholder="[Tagline]"
          style={{ fontSize: 44, marginTop: 24, color: '#475569' }} />
      </div>
    </Slide16x9>

    {[
      ['Problem',  'problem'],
      ['Solution', 'solution'],
      ['Product',  'product'],
    ].map(([label, key]) => (
      <Slide16x9 key={key} font={F} ink={INK}>
        <Title>{label}</Title>
        <Editable path={key} value={v(data,key)} editable={editable} onEdit={onEdit}
          placeholder={`[${label}]`}
          style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.2, marginTop: 64, maxWidth: 1500 }} />
      </Slide16x9>
    ))}

    <Slide16x9 font={F} ink={INK}>
      <Title>Traction</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 64, marginTop: 96 }}>
        <Stat label="MRR" path="mrr" value={fmtUSD(v(data,'mrr'))} />
        <Stat label="ARR" path="arr" value={fmtUSD(v(data,'arr'))} />
        <Stat label="Paying logos" path="paying_customers" value={fmtNum(v(data,'paying_customers'))} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 64, marginTop: 80 }}>
        <Stat label="MoM growth" path="mom_growth" value={fmtPct(v(data,'mom_growth'))} />
        <Stat label="Gross margin" path="gross_margin" value={fmtPct(v(data,'gross_margin'))} />
        <Stat label="NRR" path="nrr" value={fmtPct(v(data,'nrr'))} />
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <Title>Unit Economics</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 96, marginTop: 96 }}>
        <Stat label="CAC" path="cac" value={fmtUSD(v(data,'cac'))} />
        <Stat label="LTV" path="ltv" value={fmtUSD(v(data,'ltv'))} />
        <Stat label="LTV / CAC" path="ltv_cac" value={String(v(data,'ltv_cac','—'))} />
        <Stat label="Payback (months)" path="payback" value={fmtNum(v(data,'payback'))} />
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <Title>Cohort retention</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 48, marginTop: 96 }}>
        {['m1','m3','m6','m12'].map((m) => (
          <Stat key={m} label={`${m.toUpperCase()} retention`} path={m} value={fmtPct(v(data,m))} />
        ))}
      </div>
    </Slide16x9>

    {[
      ['Go-to-Market',  'gtm'],
      ['Competition',   'competition'],
      ['Market',        'market'],
      ['Roadmap',       'roadmap'],
      ['Hiring plan',   'hiring_plan'],
      ['Financials',    'financials'],
      ['Team',          'team'],
    ].map(([label, key]) => (
      <Slide16x9 key={key} font={F} ink={INK}>
        <Title>{label}</Title>
        <Editable path={key} value={v(data,key)} editable={editable} onEdit={onEdit}
          placeholder={`[${label}]`}
          style={{ fontSize: 56, fontWeight: 500, lineHeight: 1.3, marginTop: 64, maxWidth: 1500 }} />
      </Slide16x9>
    ))}

    <Slide16x9 font={F} ink={INK}>
      <Title>The ask · Use of funds</Title>
      <Editable path="ask_amount" value={fmtUSD(v(data,'ask_amount'))} editable={editable} onEdit={onEdit}
        style={{ fontSize: 168, fontWeight: 800, marginTop: 48 }} />
      <Editable path="use_of_funds" value={v(data,'use_of_funds')} editable={editable} onEdit={onEdit}
        placeholder="[40% team · 30% GTM · 20% product · 10% reserve]"
        style={{ fontSize: 36, marginTop: 32, color: '#475569', maxWidth: 1500 }} />
    </Slide16x9>
  </>;
};
