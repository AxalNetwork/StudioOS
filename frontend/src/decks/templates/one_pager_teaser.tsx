import React from 'react';
import { Slide16x9, Editable, DeckProps, v, fmtUSD, BrandProvider, useBrandContext } from '../DeckBase';

export const Deck_one_pager_teaser: React.FC<DeckProps> = ({ data, editable, onEdit }) => (
  <BrandProvider data={data || {}} fallbackAccent="#DC2626" fallbackBg="#FFFFFF" fallbackInk="#0F172A" fallbackFont="Inter, system-ui, sans-serif">
    <Deck_one_pager_teaser_inner data={data} editable={editable} onEdit={onEdit} />
  </BrandProvider>
);

const Deck_one_pager_teaser_inner: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const { accent, bg, ink, font } = useBrandContext();
  const F = font || 'Inter, system-ui, sans-serif';
  const INK = ink || '#0F172A';
  const ACCENT = accent || '#DC2626';
  return <Slide16x9 font={F} ink={INK} bg={bg || '#FFFFFF'}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Editable path="company" value={v(data,'company')} editable={editable} onEdit={onEdit}
        placeholder="[Company]" style={{ fontSize: 112, fontWeight: 800, letterSpacing: -2 }} />
      <div style={{ fontSize: 22, color: '#64748B', textAlign: 'right' }}>
        <div>Teaser · {new Date().getFullYear()}</div>
        <div style={{ color: ACCENT, fontWeight: 700, marginTop: 4 }}>CONFIDENTIAL</div>
      </div>
    </div>

    <Editable path="one_liner" value={v(data,'one_liner')} editable={editable} onEdit={onEdit}
      placeholder="[Irresistible one-line hook]"
      style={{ fontSize: 64, fontWeight: 600, lineHeight: 1.2, marginTop: 48, color: ACCENT, maxWidth: 1700 }} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 64, marginTop: 64 }}>
      <div>
        <div style={{ fontSize: 22, color: '#64748B', letterSpacing: 3 }}>THE OPPORTUNITY</div>
        <Editable path="opportunity" value={v(data,'opportunity')} editable={editable} onEdit={onEdit}
          placeholder="[Market shift in one sentence]"
          style={{ fontSize: 32, fontWeight: 500, lineHeight: 1.3, marginTop: 16 }} />
      </div>
      <div>
        <div style={{ fontSize: 22, color: '#64748B', letterSpacing: 3 }}>WHY US</div>
        <Editable path="team_line" value={v(data,'team_line')} editable={editable} onEdit={onEdit}
          placeholder="[Team line]"
          style={{ fontSize: 32, fontWeight: 500, lineHeight: 1.3, marginTop: 16 }} />
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 48, marginTop: 80 }}>
      <div>
        <div style={{ fontSize: 18, color: '#64748B', letterSpacing: 3 }}>TRACTION</div>
        <Editable path="traction" value={v(data,'traction')} editable={editable} onEdit={onEdit}
          placeholder="$ MRR"
          style={{ fontSize: 56, fontWeight: 800, marginTop: 8 }} />
      </div>
      <div>
        <div style={{ fontSize: 18, color: '#64748B', letterSpacing: 3 }}>RAISING</div>
        <Editable path="ask_amount" value={fmtUSD(v(data,'ask_amount'))} editable={editable} onEdit={onEdit}
          style={{ fontSize: 56, fontWeight: 800, marginTop: 8 }} />
      </div>
      <div>
        <div style={{ fontSize: 18, color: '#64748B', letterSpacing: 3 }}>STAGE</div>
        <Editable path="stage" value={v(data,'stage')} editable={editable} onEdit={onEdit}
          placeholder="Seed"
          style={{ fontSize: 56, fontWeight: 800, marginTop: 8 }} />
      </div>
    </div>

    <div style={{ marginTop: 'auto', borderTop: '1px solid #E2E8F0', paddingTop: 24,
                   display: 'flex', justifyContent: 'space-between', fontSize: 26 }}>
      <Editable path="contact" value={v(data,'contact')} editable={editable} onEdit={onEdit}
        placeholder="founders@example.com"
        style={{ fontWeight: 600 }} />
      <Editable path="deck_link" value={v(data,'deck_link')} editable={editable} onEdit={onEdit}
        placeholder="Full deck on request"
        style={{ color: ACCENT, fontWeight: 600 }} />
    </div>
  </Slide16x9>;
};
