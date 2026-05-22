import React from 'react';
import { Slide16x9, Editable, DeckProps, v, fmtUSD, fmtNum } from '../DeckBase';

export const Deck_yc_seed: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const F = 'Inter, system-ui, sans-serif';
  const INK = '#0A0A0A';
  const ACCENT = '#FF6600'; // YC orange
  return <>
    <Slide16x9 font={F} ink={INK}>
      <div className="absolute" style={{ top: 96, left: 96, width: 64, height: 64, background: ACCENT }} />
      <div style={{ marginTop: 'auto', marginBottom: 'auto' }}>
        <Editable as="h1" path="company" value={v(data,'company')} editable={editable} onEdit={onEdit}
          placeholder="[Company]" style={{ fontSize: 184, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }} />
        <Editable path="tagline" value={v(data,'tagline')} editable={editable} onEdit={onEdit}
          placeholder="[One-line tagline]" style={{ fontSize: 52, marginTop: 32, color: '#374151' }} />
      </div>
      <div style={{ fontSize: 22, color: '#9CA3AF' }}>Seed · {new Date().getFullYear()}</div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>PROBLEM</div>
      <Editable path="problem" value={v(data,'problem')} editable={editable} onEdit={onEdit}
        placeholder="[The pain]" style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.15, marginTop: 64 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>SOLUTION</div>
      <Editable path="solution" value={v(data,'solution')} editable={editable} onEdit={onEdit}
        placeholder="[What you built]" style={{ fontSize: 80, fontWeight: 600, lineHeight: 1.2, marginTop: 64 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>MARKET</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, marginTop: 80 }}>
        <div>
          <div style={{ fontSize: 24, color: '#6B7280' }}>TAM</div>
          <Editable path="tam" value={fmtUSD(v(data,'tam'))} editable={editable} onEdit={onEdit}
            style={{ fontSize: 128, fontWeight: 700 }} />
        </div>
        <div>
          <div style={{ fontSize: 24, color: '#6B7280' }}>SAM</div>
          <Editable path="sam" value={fmtUSD(v(data,'sam'))} editable={editable} onEdit={onEdit}
            style={{ fontSize: 128, fontWeight: 700 }} />
        </div>
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>PRODUCT</div>
      <Editable path="product" value={v(data,'product')} editable={editable} onEdit={onEdit}
        placeholder="[Two-sentence product description]"
        style={{ fontSize: 64, fontWeight: 500, lineHeight: 1.25, marginTop: 64 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>BUSINESS MODEL</div>
      <Editable path="business_model" value={v(data,'business_model')} editable={editable} onEdit={onEdit}
        placeholder="[How you make money]"
        style={{ fontSize: 64, fontWeight: 500, lineHeight: 1.25, marginTop: 64 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>TRACTION</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, marginTop: 80 }}>
        <div>
          <div style={{ fontSize: 24, color: '#6B7280' }}>MRR</div>
          <Editable path="mrr" value={fmtUSD(v(data,'mrr'))} editable={editable} onEdit={onEdit}
            style={{ fontSize: 144, fontWeight: 800 }} />
        </div>
        <div>
          <div style={{ fontSize: 24, color: '#6B7280' }}>Paying customers</div>
          <Editable path="paying_customers" value={fmtNum(v(data,'paying_customers'))}
            editable={editable} onEdit={onEdit}
            style={{ fontSize: 144, fontWeight: 800 }} />
        </div>
      </div>
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>TEAM</div>
      <Editable path="team" value={v(data,'team')} editable={editable} onEdit={onEdit}
        placeholder="[Founders + relevant background]"
        style={{ fontSize: 56, fontWeight: 500, lineHeight: 1.3, marginTop: 64 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>WHY NOW</div>
      <Editable path="why_now" value={v(data,'why_now')} editable={editable} onEdit={onEdit}
        placeholder="[What just changed?]"
        style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.2, marginTop: 64 }} />
    </Slide16x9>

    <Slide16x9 font={F} ink={INK}>
      <div style={{ fontSize: 28, color: ACCENT, fontWeight: 600 }}>THE ASK</div>
      <Editable path="ask_amount" value={fmtUSD(v(data,'ask_amount'))} editable={editable} onEdit={onEdit}
        placeholder="$ —" style={{ fontSize: 176, fontWeight: 800, marginTop: 48 }} />
      <Editable path="use_of_funds" value={v(data,'use_of_funds')} editable={editable} onEdit={onEdit}
        placeholder="[Use of funds]"
        style={{ fontSize: 44, fontWeight: 500, marginTop: 32, color: '#374151' }} />
      <div style={{ marginTop: 'auto', fontSize: 24, color: '#9CA3AF' }}>
        {v(data,'contact','contact@axal.vc')}
      </div>
    </Slide16x9>
  </>;
};
