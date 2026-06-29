import React, { useMemo } from 'react';
import { Slide16x9, Editable, DeckProps, v, fmtUSD, fmtPct, fmtNum, BrandProvider, useBrandContext } from '../DeckBase';

// ─────────────────────────────────────────────────────────────────
// Sequoia Classic — narrative-driven 12-slide investor deck.
// Each slide is rendered as a Slide16x9 frame (1920×1080) so the
// platform's Thumbnail / PreviewStage / print page can scale + stack
// them uniformly. All slides editable via the standard DeckBase
// Editable component; data binds to a flat object built server-side
// from project + financials + ai overlays (see PitchDeckPrintPage and
// services/decks/methods.ts for the field-key contract).
// ─────────────────────────────────────────────────────────────────

const CRIMSON = '#8C1F28';
const INK = '#0D0D0D';
const PAPER = '#FBFAF7';
const PAPER_DEEP = '#F4ECDD';
const ACCENT = '#B45D3E';
const SUBTLE = '#6E665B';
const HAIRLINE = '#E4DCC9';
const FONT_SERIF = '"Source Serif Pro", "Source Serif 4", Georgia, serif';
const FONT_SANS = '"Inter", system-ui, sans-serif';

// ─────────────────────────────────────────────────────────────────
// Slide chrome
// ─────────────────────────────────────────────────────────────────

const Eyebrow: React.FC<{ index: number; total: number; label: string; ink?: string }> = ({
  index, total, label, ink = INK,
}) => (
  <div className="flex items-center justify-between" style={{ fontFamily: FONT_SANS }}>
    <div className="flex items-center gap-3">
      <span style={{ fontSize: 12, letterSpacing: 6, color: CRIMSON, fontWeight: 700 }}>
        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
      <span style={{ width: 32, height: 1, background: CRIMSON, opacity: 0.5 }} />
      <span style={{ fontSize: 11, letterSpacing: 4, color: ink, opacity: 0.7, textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
    <div style={{ fontSize: 11, letterSpacing: 4, color: ink, opacity: 0.4 }}>SEQUOIA · CLASSIC</div>
  </div>
);

const Footer: React.FC<{ company?: string; ink?: string }> = ({ company, ink = '#B8B0A2' }) => (
  <div
    style={{
      position: 'absolute', left: 96, right: 96, bottom: 48,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: FONT_SANS, fontSize: 12, letterSpacing: 4, color: ink, textTransform: 'uppercase',
    }}
  >
    <span>{company || 'Company'}</span>
    <span>Confidential · Investor Material</span>
  </div>
);

const Frame: React.FC<React.PropsWithChildren<{
  index: number; label: string; company?: string;
  bg?: string; ink?: string;
}>> = ({ index, label, company, bg = PAPER, ink = INK, children }) => (
  <Slide16x9 bg={bg} ink={ink} font={FONT_SERIF}>
    <Eyebrow index={index} total={12} label={label} ink={ink} />
    <div style={{ flex: 1, minHeight: 0, marginTop: 36, display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
    <Footer company={company} ink={ink === PAPER ? '#A89F8F' : '#B8B0A2'} />
  </Slide16x9>
);

// ─────────────────────────────────────────────────────────────────
// SVG illustrations (authored in code; no external assets)
// ─────────────────────────────────────────────────────────────────

const CinematicHorizon: React.FC = () => (
  <svg viewBox="0 0 1000 600" style={{ width: '100%', height: '100%' }} aria-hidden>
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F0E7D8" />
        <stop offset="60%" stopColor="#E8DBC4" />
        <stop offset="100%" stopColor="#D9C6A6" />
      </linearGradient>
      <radialGradient id="sun" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="100%" stopColor={CRIMSON} stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect width="1000" height="600" fill="url(#sky)" />
    <circle cx="500" cy="380" r="180" fill="url(#sun)" />
    <circle cx="500" cy="380" r="80" fill="#FFFFFF" opacity="0.85" />
    {[420, 440, 460, 480, 500, 520, 540, 560].map((y, i) => (
      <line key={y} x1="0" y1={y} x2="1000" y2={y}
        stroke={CRIMSON} strokeOpacity={0.45 - i * 0.05} strokeWidth={0.6} />
    ))}
    <path d="M0 470 L120 410 L210 450 L320 380 L430 430 L540 360 L660 410 L780 350 L900 400 L1000 380 L1000 600 L0 600 Z"
      fill={INK} fillOpacity="0.92" />
    {[[120, 80], [220, 50], [340, 95], [460, 60], [610, 80], [720, 45], [830, 85], [910, 55]].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r={1.6 + (i % 3) * 0.5} fill={CRIMSON} opacity={0.7} />
    ))}
  </svg>
);

const ShiftCurve: React.FC<{ curves: { label: string; from: number; to: number; color?: string }[] }> = ({ curves }) => {
  const W = 900, H = 360, pad = 60;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke={HAIRLINE} />
      <line x1={pad} x2={pad} y1={pad} y2={H - pad} stroke={HAIRLINE} />
      {curves.map((c, i) => {
        const baseY = H - pad - (i * 60 + 40);
        const path = `M${pad} ${baseY + c.from * 1.2} C${W * 0.35} ${baseY + c.from * 1.2}, ${W * 0.55} ${baseY - c.to * 1.4}, ${W - pad} ${baseY - c.to * 1.4}`;
        const color = c.color || (i === 0 ? CRIMSON : i === 1 ? ACCENT : INK);
        return (
          <g key={c.label}>
            <path d={path} stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
            <text x={W - pad + 12} y={baseY - c.to * 1.4 + 4} fontSize="13" fontFamily={FONT_SANS} fontWeight={600} fill={color}>{c.label}</text>
          </g>
        );
      })}
      <line x1={W * 0.55} x2={W * 0.55} y1={pad} y2={H - pad} stroke={CRIMSON} strokeDasharray="4 4" strokeOpacity="0.6" />
      <text x={W * 0.55} y={pad - 8} fontSize="11" fontFamily={FONT_SANS} fill={CRIMSON} textAnchor="middle" fontWeight={700}>Inflection</text>
    </svg>
  );
};

const TornFabric: React.FC = () => (
  <svg viewBox="0 0 600 400" style={{ width: '100%', height: '100%' }} aria-hidden>
    <defs>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke={HAIRLINE} strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="600" height="400" fill="url(#grid)" />
    <polygon points="60,80 220,40 200,180 80,200" fill={PAPER_DEEP} stroke={SUBTLE} />
    <polygon points="260,70 420,90 380,250 240,210" fill={PAPER_DEEP} stroke={SUBTLE} />
    <polygon points="460,60 560,140 540,280 420,260" fill={PAPER_DEEP} stroke={SUBTLE} />
    <polygon points="100,240 220,260 260,340 100,360" fill={PAPER_DEEP} stroke={SUBTLE} />
    <polygon points="300,280 480,300 460,360 300,360" fill={PAPER_DEEP} stroke={SUBTLE} />
    {[[170, 130], [340, 160], [490, 180], [180, 300], [400, 330]].map(([x, y], i) => (
      <g key={i} transform={`translate(${x} ${y})`}>
        <circle r="14" fill="none" stroke={CRIMSON} strokeWidth="1.4" />
        <path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke={CRIMSON} strokeWidth="1.6" />
      </g>
    ))}
  </svg>
);

const InsightCompass: React.FC = () => (
  <svg viewBox="0 0 500 500" style={{ width: '100%', height: '100%' }} aria-hidden>
    <circle cx="250" cy="250" r="200" fill="none" stroke={HAIRLINE} />
    <circle cx="250" cy="250" r="140" fill="none" stroke={HAIRLINE} />
    <circle cx="250" cy="250" r="80" fill="none" stroke={HAIRLINE} />
    {[...Array(24)].map((_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const x1 = 250 + Math.cos(a) * 200;
      const y1 = 250 + Math.sin(a) * 200;
      const x2 = 250 + Math.cos(a) * (i % 6 === 0 ? 180 : 192);
      const y2 = 250 + Math.sin(a) * (i % 6 === 0 ? 180 : 192);
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={SUBTLE} strokeWidth={i % 6 === 0 ? 1.5 : 0.6} />;
    })}
    <polygon points="250,80 240,250 250,260 260,250" fill={CRIMSON} />
    <polygon points="250,420 240,250 250,240 260,250" fill={INK} />
    <circle cx="250" cy="250" r="14" fill={PAPER} stroke={CRIMSON} strokeWidth="3" />
    <circle cx="250" cy="250" r="4" fill={CRIMSON} />
  </svg>
);

const MarketRings: React.FC<{ tam?: number; sam?: number; som?: number }> = ({ tam, sam, som }) => {
  const maxR = 240;
  const tamR = maxR;
  const samR = sam && tam ? maxR * Math.sqrt(sam / tam) : maxR * 0.66;
  const somR = som && tam ? maxR * Math.sqrt(som / tam) : maxR * 0.33;
  return (
    <svg viewBox="0 0 640 540" style={{ width: '100%' }} aria-hidden>
      <circle cx="320" cy="280" r={tamR} fill="none" stroke={CRIMSON} strokeOpacity="0.35" />
      <circle cx="320" cy="280" r={samR} fill="none" stroke={CRIMSON} strokeOpacity="0.6" />
      <circle cx="320" cy="280" r={somR} fill={CRIMSON} fillOpacity="0.9" />
      <text x="320" y="44" textAnchor="middle" fontSize="11" fontFamily={FONT_SANS} letterSpacing="3" fill={SUBTLE}>TOTAL</text>
      <text x="320" y="68" textAnchor="middle" fontSize="22" fontFamily={FONT_SERIF} fontWeight={700} fill={INK}>{fmtUSD(tam)}</text>
      <text x="320" y={280 - samR - 14} textAnchor="middle" fontSize="10" fontFamily={FONT_SANS} letterSpacing="3" fill={SUBTLE}>SERVICEABLE</text>
      <text x="320" y={280 - samR + 8} textAnchor="middle" fontSize="16" fontFamily={FONT_SERIF} fontWeight={700} fill={INK}>{fmtUSD(sam)}</text>
      <text x="320" y="282" textAnchor="middle" fontSize="11" fontFamily={FONT_SANS} letterSpacing="3" fill="#FFFFFF">OBTAINABLE</text>
      <text x="320" y="304" textAnchor="middle" fontSize="16" fontFamily={FONT_SERIF} fontWeight={700} fill="#FFFFFF">{fmtUSD(som)}</text>
    </svg>
  );
};

const MarketCurve: React.FC<{ data: { year: string; v: number }[] }> = ({ data }) => {
  const W = 460, H = 220, pad = 36;
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.v));
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (vl: number) => H - pad - (vl / max) * (H - pad * 2);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.v)}`).join(' ');
  const area = path + ` L${x(data.length - 1)} ${H - pad} L${x(0)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      <path d={area} fill={CRIMSON} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={CRIMSON} strokeWidth="2.5" />
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={H - pad + 16} textAnchor="middle" fontSize="10" fontFamily={FONT_SANS} fill={SUBTLE}>{d.year}</text>
      ))}
    </svg>
  );
};

const ArchitectureMap: React.FC<{ modules?: { name: string; nodes: string[] }[] }> = ({
  modules = [
    { name: 'Capture', nodes: ['Web', 'API', 'Mobile'] },
    { name: 'Reason', nodes: ['Workflow', 'Policy', 'LLM'] },
    { name: 'Act', nodes: ['Integrations', 'Records', 'Audit'] },
  ],
}) => {
  const W = 720, H = 320, colWidth = W / modules.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      <defs>
        <marker id="arrowS" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={CRIMSON} />
        </marker>
      </defs>
      {modules.map((m, ci) => {
        const cx = colWidth * ci + colWidth / 2;
        return (
          <g key={ci}>
            <rect x={cx - colWidth * 0.4} y={20} width={colWidth * 0.8} height={H - 40} rx={10} fill={PAPER_DEEP} stroke={HAIRLINE} />
            <text x={cx} y={50} textAnchor="middle" fontSize="14" fontFamily={FONT_SANS} fontWeight={700} fill={CRIMSON} letterSpacing="2">
              {m.name.toUpperCase()}
            </text>
            {m.nodes.map((n, ni) => (
              <g key={ni} transform={`translate(${cx} ${90 + ni * 56})`}>
                <rect x="-72" y="-18" width="144" height="36" rx="6" fill={PAPER} stroke={CRIMSON} strokeOpacity="0.3" />
                <text x="0" y="4" textAnchor="middle" fontSize="13" fontFamily={FONT_SANS} fill={INK}>{n}</text>
              </g>
            ))}
            {ci < modules.length - 1 && (
              <path d={`M${colWidth * (ci + 1) - colWidth * 0.1} ${H / 2} L${colWidth * (ci + 1) + colWidth * 0.1} ${H / 2}`}
                stroke={CRIMSON} strokeWidth="1.6" markerEnd="url(#arrowS)" />
            )}
          </g>
        );
      })}
    </svg>
  );
};

const PositioningMap: React.FC<{
  competitors?: { name: string; x: number; y: number }[]; axis_x?: string; axis_y?: string;
}> = ({ competitors = [], axis_x = 'Reach', axis_y = 'Depth' }) => {
  const W = 520, H = 420;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      <line x1="60" x2={W - 30} y1={H - 50} y2={H - 50} stroke={HAIRLINE} />
      <line x1="60" x2="60" y1="30" y2={H - 50} stroke={HAIRLINE} />
      <text x={W - 30} y={H - 30} textAnchor="end" fontSize="11" fontFamily={FONT_SANS} fill={SUBTLE} letterSpacing="2">{axis_x.toUpperCase()} →</text>
      <g transform={`translate(40, ${H / 2}) rotate(-90)`}>
        <text fontSize="11" fontFamily={FONT_SANS} fill={SUBTLE} letterSpacing="2">{axis_y.toUpperCase()} →</text>
      </g>
      {[['Niche', 100, 70], ['Leader', W - 130, 70], ['Generic', 100, H - 70], ['Wedge', W - 130, H - 70]].map(([label, x, y], i) => (
        <text key={i} x={x as number} y={y as number} fontSize="10" fontFamily={FONT_SANS} fill="#B8B0A2" letterSpacing="2">
          {String(label).toUpperCase()}
        </text>
      ))}
      {competitors.map((c, i) => {
        const cx = 60 + (c.x / 100) * (W - 90);
        const cy = H - 50 - (c.y / 100) * (H - 80);
        const us = (c.name || '').toLowerCase() === 'us' || (c.name || '').toLowerCase() === 'we';
        return (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <circle r={us ? 16 : 10} fill={us ? CRIMSON : PAPER_DEEP} stroke={us ? CRIMSON : SUBTLE} />
            <text y={us ? 38 : 28} textAnchor="middle" fontSize={us ? 14 : 11} fontFamily={FONT_SERIF} fontWeight={us ? 700 : 500} fill={us ? CRIMSON : INK}>
              {c.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const RevenueArea: React.FC<{ data: { month: string; v: number }[]; color?: string }> = ({ data, color = CRIMSON }) => {
  const W = 460, H = 220, pad = 36;
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.v));
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (vl: number) => H - pad - (vl / max) * (H - pad * 2);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.v)}`).join(' ');
  const area = path + ` L${x(data.length - 1)} ${H - pad} L${x(0)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={H - pad + 16} fontSize="10" textAnchor="middle" fontFamily={FONT_SANS} fill={SUBTLE}>{d.month}</text>
      ))}
    </svg>
  );
};

const RetentionCurve: React.FC<{ data: { m: string; v: number }[] }> = ({ data }) => {
  const W = 460, H = 220, pad = 40;
  if (!data?.length) return null;
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (vl: number) => H - pad - (vl / 100) * (H - pad * 2);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      {[0, 25, 50, 75, 100].map((t) => (
        <g key={t}>
          <line x1={pad} x2={W - pad} y1={y(t)} y2={y(t)} stroke={HAIRLINE} strokeDasharray="2 3" />
          <text x={pad - 8} y={y(t) + 4} fontSize="10" fontFamily={FONT_SANS} fill={SUBTLE} textAnchor="end">{t}%</text>
        </g>
      ))}
      <path d={path} fill="none" stroke={CRIMSON} strokeWidth="2.5" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.v)} r={3.2} fill={CRIMSON} />
          <text x={x(i)} y={H - pad + 16} fontSize="10" textAnchor="middle" fontFamily={FONT_SANS} fill={SUBTLE}>{d.m}</text>
        </g>
      ))}
    </svg>
  );
};

const LogoBadge: React.FC<{ name: string; initials?: string }> = ({ name, initials }) => {
  const text = initials || (name || '').split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 8,
      background: PAPER, border: `1px solid ${HAIRLINE}`,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: CRIMSON, color: '#FFFFFF', fontFamily: FONT_SANS, fontSize: 13, fontWeight: 700,
      }}>
        {(text || '?').toUpperCase()}
      </div>
      <span style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 600, color: INK }}>{name}</span>
    </div>
  );
};

const Flywheel: React.FC<{ nodes: { label: string; body?: string }[] }> = ({ nodes }) => {
  const R = 180, cx = 250, cy = 240;
  return (
    <svg viewBox="0 0 500 500" style={{ width: '100%', height: '100%' }} aria-hidden>
      <defs>
        <marker id="arrowF" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={CRIMSON} />
        </marker>
      </defs>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={HAIRLINE} />
      <circle cx={cx} cy={cy} r={R + 30} fill="none" stroke={CRIMSON} strokeOpacity="0.15" />
      {nodes.map((n, i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * R;
        const y = cy + Math.sin(a) * R;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={48} fill={PAPER_DEEP} stroke={CRIMSON} />
            <text x={x} y={y - 4} textAnchor="middle" fontSize="12" fontFamily={FONT_SANS} fontWeight={700} fill={CRIMSON}>{n.label}</text>
            {n.body && (
              <text x={x} y={y + 14} textAnchor="middle" fontSize="10" fontFamily={FONT_SANS} fill={INK}>{n.body}</text>
            )}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={60} fill={CRIMSON} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" letterSpacing="3" fontFamily={FONT_SANS} fill="#FFFFFF">FLYWHEEL</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="14" fontFamily={FONT_SERIF} fontWeight={700} fill="#FFFFFF">compounds</text>
      {nodes.map((_, i) => {
        const a1 = (i / nodes.length) * Math.PI * 2 - Math.PI / 2 + 0.18;
        const a2 = ((i + 1) / nodes.length) * Math.PI * 2 - Math.PI / 2 - 0.18;
        const x1 = cx + Math.cos(a1) * (R - 6);
        const y1 = cy + Math.sin(a1) * (R - 6);
        const x2 = cx + Math.cos(a2) * (R - 6);
        const y2 = cy + Math.sin(a2) * (R - 6);
        return (
          <path key={'arc' + i} d={`M${x1} ${y1} A${R - 6} ${R - 6} 0 0 1 ${x2} ${y2}`}
            stroke={CRIMSON} strokeWidth="1.6" fill="none" markerEnd="url(#arrowF)" />
        );
      })}
    </svg>
  );
};

const Donut: React.FC<{ data: { label: string; pct: number }[] }> = ({ data }) => {
  if (!data?.length) return null;
  const palette = [CRIMSON, ACCENT, '#C46B45', '#D9A06B', '#E8C99B'];
  const r = 92, cx = 110, cy = 110;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
      <svg viewBox="0 0 220 220" width={220} height={220} aria-hidden>
        {data.map((d, i) => {
          const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          acc += d.pct;
          const end = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          const large = d.pct > 50 ? 1 : 0;
          const x1 = cx + r * Math.cos(start);
          const y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end);
          const y2 = cy + r * Math.sin(end);
          return (
            <path key={i} d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={palette[i % palette.length]} />
          );
        })}
        <circle cx={cx} cy={cy} r={50} fill={PAPER} />
      </svg>
      <div style={{ fontFamily: FONT_SANS, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: palette[i % palette.length] }} />
            <span style={{ color: PAPER, fontWeight: 500 }}>{d.label}</span>
            <span style={{ color: PAPER, fontWeight: 700, marginLeft: 12 }}>{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div style={{ padding: 16, borderRadius: 12, background: PAPER_DEEP, border: `1px solid ${HAIRLINE}` }}>
    <div style={{ fontSize: 10, letterSpacing: 3, color: SUBTLE, fontFamily: FONT_SANS }}>{label.toUpperCase()}</div>
    <div style={{ fontFamily: FONT_SERIF, fontSize: 28, fontWeight: 700, marginTop: 6, color: highlight ? CRIMSON : INK }}>{value}</div>
  </div>
);

const Card: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div style={{ padding: 20, borderRadius: 16, background: PAPER, border: `1px solid ${HAIRLINE}` }}>
    <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 4, color: SUBTLE }}>{title.toUpperCase()}</div>
    <div style={{ marginTop: 12 }}>{children}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// Slide components
// ─────────────────────────────────────────────────────────────────

type SP = DeckProps;

const Slide1Future: React.FC<SP> = ({ data, editable, onEdit }) => (
  <Frame index={0} label="The Future" company={v(data, 'company')}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
      <div style={{ gridColumn: 'span 6', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 40 }}>
        <Editable value={v(data, 'future_year')} path="future_year" editable={editable} onEdit={onEdit}
          placeholder="2035" style={{ fontFamily: FONT_SANS, fontSize: 16, letterSpacing: 8, color: CRIMSON, fontWeight: 700 }} />
        <Editable as="h1" value={v(data, 'future_headline')} path="future_headline" editable={editable} onEdit={onEdit}
          placeholder="The future world that will exist in ten years."
          style={{ fontFamily: FONT_SERIF, fontSize: 80, lineHeight: 1.05, fontWeight: 700, letterSpacing: -1, color: INK, marginTop: 16 }} />
        <Editable value={v(data, 'future_subline')} path="future_subline" editable={editable} onEdit={onEdit}
          placeholder="A single, declarative line that sets the horizon."
          style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 22, color: SUBTLE, marginTop: 18, maxWidth: 560, lineHeight: 1.4 }} />
      </div>
      <div style={{ gridColumn: 'span 6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CinematicHorizon />
      </div>
    </div>
  </Frame>
);

const Slide2Shift: React.FC<SP> = ({ data, editable, onEdit }) => {
  const curves = (data?.shift_curves?.length ? data.shift_curves : [
    { label: 'Compute / $', from: 10, to: 80, color: CRIMSON },
    { label: 'Cost of friction', from: 60, to: 14, color: ACCENT },
    { label: 'Available capital', from: 20, to: 55, color: INK },
  ]);
  return (
    <Frame index={1} label="The Shift" company={v(data, 'company')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 5' }}>
          <Editable as="h2" value={v(data, 'shift_title')} path="shift_title" editable={editable} onEdit={onEdit}
            placeholder="Three forces converging now."
            style={{ fontFamily: FONT_SERIF, fontSize: 56, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1, color: INK }} />
          <Editable value={v(data, 'shift_body')} path="shift_body" editable={editable} onEdit={onEdit}
            placeholder="What was impossible last decade is now economical. What was acceptable last decade is now intolerable. The inflection point is here."
            style={{ fontFamily: FONT_SERIF, fontSize: 19, lineHeight: 1.55, color: '#3a3a3a', marginTop: 24, maxWidth: 480 }} />
          <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONT_SANS }}>
            {curves.slice(0, 3).map((c: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
                <span style={{ display: 'inline-block', width: 32, height: 1, background: c.color || CRIMSON }} />
                <span style={{ color: INK, fontWeight: 600 }}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: 'span 7', display: 'flex', alignItems: 'center' }}>
          <ShiftCurve curves={curves} />
        </div>
      </div>
    </Frame>
  );
};

const Slide3Broken: React.FC<SP> = ({ data, editable, onEdit }) => {
  const pillars = (data?.broken_pillars?.length ? data.broken_pillars : [
    { title: 'Fragmented stacks', body: 'Teams stitch six or more tools to ship a single workflow.', cost: '40% time lost' },
    { title: 'Spreadsheet truth', body: 'The most important records still live in inboxes.', cost: 'Trust eroded' },
    { title: 'Manual reconciliation', body: 'Every cycle ends in a fire drill.', cost: '2× errors' },
  ]);
  return (
    <Frame index={2} label="The Broken Reality" company={v(data, 'company')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 6', display: 'flex', alignItems: 'center' }}><TornFabric /></div>
        <div style={{ gridColumn: 'span 6', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable as="h2" value={v(data, 'broken_title')} path="broken_title" editable={editable} onEdit={onEdit}
            placeholder="Today, this work is done by hand."
            style={{ fontFamily: FONT_SERIF, fontSize: 56, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1, color: INK }} />
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
            {pillars.slice(0, 3).map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 20 }}>
                <div style={{
                  flexShrink: 0, width: 48, height: 48, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1.5px solid ${CRIMSON}`, color: CRIMSON, fontFamily: FONT_SERIF, fontWeight: 700,
                }}>{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <Editable as="div" value={p.title} path={`broken_pillars.${i}.title`} editable={editable} onEdit={onEdit}
                    style={{ fontFamily: FONT_SERIF, fontSize: 20, fontWeight: 700, color: INK }} />
                  <Editable value={p.body} path={`broken_pillars.${i}.body`} editable={editable} onEdit={onEdit}
                    style={{ fontFamily: FONT_SERIF, fontSize: 15, color: '#525252', marginTop: 4, lineHeight: 1.5 }} />
                  <Editable value={p.cost} path={`broken_pillars.${i}.cost`} editable={editable} onEdit={onEdit}
                    style={{ fontFamily: FONT_SANS, fontSize: 11, letterSpacing: 3, color: CRIMSON, fontWeight: 700, marginTop: 6 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

const Slide4Insight: React.FC<SP> = ({ data, editable, onEdit }) => {
  const proofs = (data?.insight_proofs?.length ? data.insight_proofs : [
    'The pattern is hiding in plain sight.',
    'Every incumbent assumes it cannot change.',
    'We have evidence it already has.',
  ]);
  return (
    <Frame index={3} label="The Insight" company={v(data, 'company')} bg={PAPER_DEEP}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable value={v(data, 'insight_label')} path="insight_label" editable={editable} onEdit={onEdit}
            placeholder="WHAT EVERYONE ELSE MISSES"
            style={{ fontFamily: FONT_SANS, fontSize: 12, letterSpacing: 6, color: CRIMSON, fontWeight: 700 }} />
          <Editable as="h2" value={v(data, 'insight_headline')} path="insight_headline" editable={editable} onEdit={onEdit}
            placeholder="The work itself is the data. The data itself becomes the moat."
            style={{ fontFamily: FONT_SERIF, fontSize: 64, lineHeight: 1.08, fontWeight: 700, letterSpacing: -1.2, color: INK, marginTop: 18, fontStyle: 'italic' }} />
          <Editable value={v(data, 'insight_body')} path="insight_body" editable={editable} onEdit={onEdit}
            placeholder="A short paragraph that articulates a non-obvious truth — one investors will recognize only after they hear it."
            style={{ fontFamily: FONT_SERIF, fontSize: 19, lineHeight: 1.5, color: '#3a3a3a', marginTop: 24, maxWidth: 600 }} />
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {proofs.slice(0, 3).map((p: string, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ marginTop: 8, display: 'inline-block', width: 24, height: 1, background: CRIMSON }} />
                <Editable value={p} path={`insight_proofs.${i}`} editable={editable} onEdit={onEdit}
                  style={{ fontFamily: FONT_SERIF, fontSize: 16, color: INK, lineHeight: 1.5 }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: 'span 5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <InsightCompass />
        </div>
      </div>
    </Frame>
  );
};

const Slide5Opportunity: React.FC<SP> = ({ data, editable, onEdit }) => {
  const curve = data?.market_curve?.length ? data.market_curve : null;
  return (
    <Frame index={4} label="The Opportunity" company={v(data, 'company')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 7', display: 'flex', alignItems: 'center' }}>
          <MarketRings tam={data?.tam_usd} sam={data?.sam_usd} som={data?.som_usd} />
        </div>
        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable as="h2" value={v(data, 'opportunity_headline')} path="opportunity_headline" editable={editable} onEdit={onEdit}
            placeholder="A category measured in tens of billions."
            style={{ fontFamily: FONT_SERIF, fontSize: 52, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1, color: INK }} />
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, fontFamily: FONT_SANS }}>
            {[['TAM', data?.tam_usd], ['SAM', data?.sam_usd], ['SOM', data?.som_usd]].map(([lbl, val], i) => (
              <div key={i}>
                <div style={{ fontSize: 10, letterSpacing: 3, color: SUBTLE }}>{lbl as string}</div>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 700, marginTop: 4, color: i === 2 ? CRIMSON : INK }}>
                  {fmtUSD(val)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32 }}>
            <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 3, color: SUBTLE }}>CAGR</div>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 36, fontWeight: 700, color: CRIMSON, marginTop: 4 }}>
              {fmtPct(data?.market_cagr_pct)}
            </div>
            {curve && <div style={{ marginTop: 12 }}><MarketCurve data={curve} /></div>}
          </div>
        </div>
      </div>
    </Frame>
  );
};

const Slide6Solution: React.FC<SP> = ({ data, editable, onEdit }) => {
  const before = data?.before_state?.length ? data.before_state : ['Six tools', 'Manual sync', 'Reconciled by hand', 'Filed late'];
  const after = data?.after_state?.length ? data.after_state : ['One workflow', 'Auto-synced', 'Audited live', 'Done in seconds'];
  return (
    <Frame index={5} label="The Solution" company={v(data, 'company')} bg={PAPER}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable as="h2" value={v(data, 'company')} path="company" editable={editable} onEdit={onEdit}
            placeholder="[Company]"
            style={{ fontFamily: FONT_SERIF, fontSize: 64, lineHeight: 1.05, fontWeight: 700, letterSpacing: -1.5, color: INK }} />
          <Editable value={v(data, 'solution_one_liner')} path="solution_one_liner" editable={editable} onEdit={onEdit}
            placeholder="One sentence that compresses the entire product into a single, memorable promise."
            style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 24, lineHeight: 1.4, color: SUBTLE, marginTop: 18, maxWidth: 540 }} />
          <div style={{ marginTop: 32, fontFamily: FONT_SANS }}>
            <div style={{ fontSize: 11, letterSpacing: 6, color: SUBTLE }}>CATEGORY</div>
            <Editable value={v(data, 'category')} path="category" editable={editable} onEdit={onEdit}
              placeholder="[Category]" style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 600, marginTop: 6 }} />
          </div>
        </div>
        <div style={{ gridColumn: 'span 7', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 24 }}>
          <div style={{ padding: 24, borderRadius: 16, background: PAPER_DEEP, border: `1px solid ${HAIRLINE}` }}>
            <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 4, color: SUBTLE }}>BEFORE</div>
            <ul style={{ marginTop: 16, listStyle: 'none', padding: 0, fontFamily: FONT_SERIF, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {before.map((b: string, i: number) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: 999, background: SUBTLE }} />
                  <Editable value={b} path={`before_state.${i}`} editable={editable} onEdit={onEdit}
                    style={{ fontSize: 17, color: SUBTLE, textDecoration: 'line-through', textDecorationColor: '#C6BFB1' }} />
                </li>
              ))}
            </ul>
          </div>
          <div style={{ padding: 24, borderRadius: 16, background: '#FFFFFF', border: `1.5px solid ${CRIMSON}`, boxShadow: '0 18px 40px -22px rgba(140,31,40,0.4)' }}>
            <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 4, color: CRIMSON, fontWeight: 700 }}>AFTER</div>
            <ul style={{ marginTop: 16, listStyle: 'none', padding: 0, fontFamily: FONT_SERIF, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {after.map((b: string, i: number) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: CRIMSON }} />
                  <Editable value={b} path={`after_state.${i}`} editable={editable} onEdit={onEdit}
                    style={{ fontSize: 17, color: INK, fontWeight: 600 }} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Frame>
  );
};

const Slide7Product: React.FC<SP> = ({ data, editable, onEdit }) => {
  const pillars = data?.product_pillars?.length ? data.product_pillars : [
    { title: 'One source of truth', body: 'Every record reconciled in real time.' },
    { title: 'Reasoning layer', body: 'Decisions explainable, audit-trailed.' },
    { title: 'Open by design', body: 'Plugs into the systems teams already use.' },
  ];
  return (
    <Frame index={6} label="The Product" company={v(data, 'company')} bg={PAPER}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 32, height: '100%' }}>
        <div style={{ gridColumn: 'span 7', display: 'flex', alignItems: 'center' }}>
          <ArchitectureMap modules={data?.product_modules} />
        </div>
        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable as="h2" value={v(data, 'product_headline')} path="product_headline" editable={editable} onEdit={onEdit}
            placeholder="Three layers. One platform."
            style={{ fontFamily: FONT_SERIF, fontSize: 48, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1, color: INK }} />
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {pillars.slice(0, 3).map((p: any, i: number) => (
              <div key={i} style={{ borderLeft: `2px solid ${CRIMSON}`, paddingLeft: 16 }}>
                <Editable as="div" value={p.title} path={`product_pillars.${i}.title`} editable={editable} onEdit={onEdit}
                  style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 700, color: INK }} />
                <Editable value={p.body} path={`product_pillars.${i}.body`} editable={editable} onEdit={onEdit}
                  style={{ fontFamily: FONT_SERIF, fontSize: 14, color: '#525252', marginTop: 4, lineHeight: 1.5 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

const Slide8WhyWeWin: React.FC<SP> = ({ data, editable, onEdit }) => {
  const competitors = data?.competitors?.length ? data.competitors : [
    { name: 'Legacy A', x: 80, y: 25 }, { name: 'Legacy B', x: 60, y: 35 },
    { name: 'Point Tool', x: 25, y: 70 }, { name: 'Us', x: 78, y: 85 },
  ];
  const moats = data?.moats?.length ? data.moats : [
    { title: 'Data', body: 'Every customer makes the model smarter.' },
    { title: 'Distribution', body: 'Partner channels into the ICP, not around it.' },
    { title: 'Switching cost', body: 'Embedded in the daily workflow of the team.' },
  ];
  return (
    <Frame index={7} label="Why We Win" company={v(data, 'company')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 7', display: 'flex', alignItems: 'center' }}>
          <PositioningMap competitors={competitors} axis_x={data?.axis_x} axis_y={data?.axis_y} />
        </div>
        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable as="h2" value={v(data, 'why_we_win_headline')} path="why_we_win_headline" editable={editable} onEdit={onEdit}
            placeholder="The moats compound."
            style={{ fontFamily: FONT_SERIF, fontSize: 48, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1, color: INK }} />
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {moats.slice(0, 3).map((m: any, i: number) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, borderRadius: 999, background: CRIMSON, color: '#FFFFFF',
                    fontFamily: FONT_SANS, fontSize: 12, fontWeight: 700,
                  }}>{i + 1}</span>
                  <Editable value={m.title} path={`moats.${i}.title`} editable={editable} onEdit={onEdit}
                    style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 700, color: INK }} />
                </div>
                <Editable value={m.body} path={`moats.${i}.body`} editable={editable} onEdit={onEdit}
                  style={{ fontFamily: FONT_SERIF, fontSize: 14, color: '#525252', marginTop: 6, lineHeight: 1.55, paddingLeft: 44 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

const Slide9Traction: React.FC<SP> = ({ data, editable, onEdit }) => {
  const rev = data?.revenue_curve?.length ? data.revenue_curve : null;
  const users = data?.user_curve?.length ? data.user_curve : null;
  const retention = data?.retention_curve?.length ? data.retention_curve : null;
  const logos = data?.customer_logos?.length ? data.customer_logos : [];
  // When no chart series is available, we collapse to a stats-only
  // layout so the slide never shows fabricated curves.
  const hasAnyChart = !!(rev || users || retention);
  return (
    <Frame index={8} label="Traction" company={v(data, 'company')}>
      <Editable value={v(data, 'traction_headline')} path="traction_headline" editable={editable} onEdit={onEdit}
        placeholder="The numbers"
        style={{ fontFamily: FONT_SERIF, fontSize: 32, fontWeight: 700, color: INK, marginBottom: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 32, flex: 1, minHeight: 0 }}>
        <div style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, fontFamily: FONT_SANS }}>
            <Stat label="MRR" value={fmtUSD(data?.mrr_usd)} />
            <Stat label="Paying customers" value={fmtNum(data?.paying_customers)} />
            <Stat label="MoM growth" value={fmtPct(data?.growth_mom_pct)} highlight />
            <Stat label="NRR" value={fmtPct(data?.nrr_pct)} />
          </div>
          {hasAnyChart && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 24 }}>
              {rev && <Card title="Revenue (k USD)"><RevenueArea data={rev} /></Card>}
              {users && <Card title="Active users"><RevenueArea data={users} color={INK} /></Card>}
            </div>
          )}
          {retention && <Card title="Retention by cohort"><RetentionCurve data={retention} /></Card>}
        </div>
        <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 4, color: SUBTLE }}>SELECTED CUSTOMERS</div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
            {logos.slice(0, 6).map((l: any, i: number) => (
              <LogoBadge key={i} name={l.name || l} initials={l.initials} />
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

const Slide10Flywheel: React.FC<SP> = ({ data, editable, onEdit }) => {
  const nodes = data?.flywheel_nodes?.length ? data.flywheel_nodes : [
    { label: 'Customers', body: 'use product' },
    { label: 'Product', body: 'learns from use' },
    { label: 'Data', body: 'compounds' },
    { label: 'Network', body: 'expands reach' },
    { label: 'Revenue', body: 'funds invention' },
  ];
  return (
    <Frame index={9} label="The Flywheel" company={v(data, 'company')} bg={PAPER_DEEP}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable as="h2" value={v(data, 'flywheel_headline')} path="flywheel_headline" editable={editable} onEdit={onEdit}
            placeholder="Each turn makes the next one easier."
            style={{ fontFamily: FONT_SERIF, fontSize: 50, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1, color: INK }} />
          <p style={{ fontFamily: FONT_SERIF, fontSize: 17, color: '#3a3a3a', marginTop: 18, lineHeight: 1.5, maxWidth: 480 }}>
            Every customer generates the data that improves the product, which expands the network,
            which acquires the next customer at lower cost.
          </p>
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, fontFamily: FONT_SANS }}>
            {nodes.slice(0, 5).map((n: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
                <span style={{
                  width: 24, height: 24, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, background: CRIMSON, color: '#FFFFFF',
                }}>{i + 1}</span>
                <span style={{ color: INK }}>{n.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: 'span 7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Flywheel nodes={nodes} />
        </div>
      </div>
    </Frame>
  );
};

const Slide11Team: React.FC<SP> = ({ data, editable, onEdit }) => {
  const founders = data?.founders?.length ? data.founders : [
    { name: '[Founder One]', role: 'CEO · Co-founder', bio: 'Prior: [notable role]. Built [notable product] used by [scale].', initials: 'F1' },
    { name: '[Founder Two]', role: 'CTO · Co-founder', bio: 'Prior: [notable role]. Led [notable system] at [scale].', initials: 'F2' },
  ];
  const timeline = data?.team_timeline?.length ? data.team_timeline : [
    { year: '2014', event: 'Met building [project]' },
    { year: '2020', event: 'Shipped [notable product]' },
    { year: '2025', event: 'Founded this company' },
  ];
  return (
    <Frame index={10} label="The Team" company={v(data, 'company')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column' }}>
          <Editable as="h2" value={v(data, 'team_headline')} path="team_headline" editable={editable} onEdit={onEdit}
            placeholder="Operators with scar tissue."
            style={{ fontFamily: FONT_SERIF, fontSize: 56, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1, color: INK }} />
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 24, flex: 1 }}>
            {founders.slice(0, 2).map((f: any, i: number) => (
              <div key={i} style={{ padding: 20, borderRadius: 16, background: PAPER, border: `1px solid ${HAIRLINE}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: CRIMSON, color: '#FFFFFF', fontFamily: FONT_SANS, fontSize: 18, fontWeight: 800,
                  }}>{f.initials || (f.name || '').slice(0, 2).toUpperCase()}</div>
                  <div>
                    <Editable as="div" value={f.name} path={`founders.${i}.name`} editable={editable} onEdit={onEdit}
                      style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 700, color: INK }} />
                    <Editable value={f.role} path={`founders.${i}.role`} editable={editable} onEdit={onEdit}
                      style={{ fontFamily: FONT_SANS, fontSize: 12, color: CRIMSON, marginTop: 2, letterSpacing: 1 }} />
                  </div>
                </div>
                <Editable value={f.bio} path={`founders.${i}.bio`} editable={editable} onEdit={onEdit}
                  style={{ fontFamily: FONT_SERIF, fontSize: 14, color: '#525252', marginTop: 14, lineHeight: 1.55 }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: 'span 5' }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 4, color: SUBTLE }}>JOURNEY</div>
          <div style={{ marginTop: 24, paddingLeft: 24, position: 'relative', display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ position: 'absolute', left: 8, top: 8, bottom: 8, width: 1, background: HAIRLINE }} />
            {timeline.slice(0, 5).map((t: any, i: number) => (
              <div key={i} style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: -19, top: 8, width: 12, height: 12, borderRadius: 999,
                  background: CRIMSON, boxShadow: `0 0 0 4px ${PAPER}`,
                }} />
                <div style={{ fontFamily: FONT_SANS, fontSize: 11, letterSpacing: 3, color: CRIMSON, fontWeight: 700 }}>{t.year}</div>
                <Editable value={t.event} path={`team_timeline.${i}.event`} editable={editable} onEdit={onEdit}
                  style={{ fontFamily: FONT_SERIF, fontSize: 16, color: INK, marginTop: 4 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

const Slide12Vision: React.FC<SP> = ({ data, editable, onEdit }) => {
  const roadmap = data?.roadmap?.length ? data.roadmap : [
    { quarter: 'Now', goal: 'Live in production · 60+ paying logos' },
    { quarter: '+6 mo', goal: '$1M ARR' },
    { quarter: '+12 mo', goal: 'Adjacent workflow live' },
    { quarter: '+24 mo', goal: 'Category leader' },
  ];
  const uof = data?.use_of_funds?.length && typeof data.use_of_funds[0] === 'object' ? data.use_of_funds : [
    { label: 'Engineering', pct: 45 }, { label: 'GTM', pct: 30 },
    { label: 'Operations + Infra', pct: 15 }, { label: 'Reserve', pct: 10 },
  ];
  return (
    <Frame index={11} label="The Vision" company={v(data, 'company')} bg={INK} ink={PAPER}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 40, height: '100%' }}>
        <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Editable as="h2" value={v(data, 'vision_headline')} path="vision_headline" editable={editable} onEdit={onEdit}
            placeholder="Raising $— to build the company that defines this decade."
            style={{ fontFamily: FONT_SERIF, fontSize: 72, lineHeight: 1.05, fontWeight: 700, letterSpacing: -1.5, color: PAPER }} />
          <Editable value={v(data, 'vision_body')} path="vision_body" editable={editable} onEdit={onEdit}
            placeholder="Two sentences describing the world that exists once this company succeeds — concrete, specific, ambitious."
            style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 22, lineHeight: 1.45, color: '#D4CFC2', marginTop: 20, maxWidth: 680 }} />
          <div style={{ marginTop: 40 }}>
            <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 4, color: '#A89F8F' }}>ROADMAP</div>
            <div style={{ marginTop: 24, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 1, background: '#3a3a3a' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
                {roadmap.slice(0, 4).map((r: any, i: number) => (
                  <div key={i} style={{ position: 'relative', paddingTop: 32 }}>
                    <span style={{
                      position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 4,
                      width: 12, height: 12, borderRadius: 999, background: CRIMSON,
                    }} />
                    <div style={{ fontFamily: FONT_SANS, fontSize: 11, letterSpacing: 3, color: CRIMSON, fontWeight: 700, textAlign: 'center' }}>
                      {(r.quarter || '').toUpperCase()}
                    </div>
                    <Editable value={r.goal} path={`roadmap.${i}.goal`} editable={editable} onEdit={onEdit}
                      style={{ fontFamily: FONT_SERIF, fontSize: 14, color: PAPER, marginTop: 6, textAlign: 'center', lineHeight: 1.4 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, fontFamily: FONT_SANS }}>
            <div style={{ padding: 16, borderRadius: 12, background: CRIMSON }}>
              <div style={{ fontSize: 10, letterSpacing: 4, color: '#F5C9CC' }}>RAISING</div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: 700, marginTop: 4, color: '#FFFFFF' }}>{fmtUSD(data?.ask_amount_usd)}</div>
            </div>
            <div style={{ padding: 16, borderRadius: 12, background: '#1a1a1a', border: '1px solid #2b2b2b' }}>
              <div style={{ fontSize: 10, letterSpacing: 4, color: '#A89F8F' }}>RUNWAY</div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: 700, marginTop: 4, color: PAPER }}>
                {data?.runway_months ?? '—'} <span style={{ fontSize: 14, color: '#A89F8F' }}>mo</span>
              </div>
            </div>
            <div style={{ padding: 16, borderRadius: 12, background: '#1a1a1a', border: '1px solid #2b2b2b' }}>
              <div style={{ fontSize: 10, letterSpacing: 4, color: '#A89F8F' }}>CONTACT</div>
              <Editable value={v(data, 'contact')} path="contact" editable={editable} onEdit={onEdit}
                placeholder="founders@company.com" style={{ fontFamily: FONT_SERIF, fontSize: 16, marginTop: 4, color: PAPER }} />
            </div>
          </div>
        </div>
        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 4, color: '#A89F8F' }}>USE OF FUNDS</div>
            <div style={{ marginTop: 24 }}><Donut data={uof} /></div>
          </div>
          <Editable value={v(data, 'closing_line')} path="closing_line" editable={editable} onEdit={onEdit}
            placeholder="The decade that follows depends on whether this company exists."
            style={{
              fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 26, lineHeight: 1.3,
              color: PAPER, borderTop: '1px solid #2b2b2b', paddingTop: 22, marginTop: 32,
            }} />
        </div>
      </div>
    </Frame>
  );
};

// ─────────────────────────────────────────────────────────────────
// Public export — renders the 12 slides stacked. Thumbnail/PreviewStage
// scale the whole thing; PitchDeckPrintPage stacks for print.
// ─────────────────────────────────────────────────────────────────

const SLIDES: Array<React.FC<DeckProps>> = [
  Slide1Future, Slide2Shift, Slide3Broken, Slide4Insight,
  Slide5Opportunity, Slide6Solution, Slide7Product, Slide8WhyWeWin,
  Slide9Traction, Slide10Flywheel, Slide11Team, Slide12Vision,
];

const Deck_sequoia_classic_inner: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const { logoUrl, logoSvg } = useBrandContext();
  // Task #6 — brandTheme: 'off' keeps the editorial palette; logo only
  const enriched = useMemo(() => ({ ...data, brandkit_logo_url: logoUrl, brandkit_logo_svg: logoSvg }), [data, logoUrl, logoSvg]);
  return (
    <>
      {SLIDES.map((S, i) => (
        <S key={i} data={enriched} editable={editable} onEdit={onEdit} />
      ))}
    </>
  );
};

export const Deck_sequoia_classic: React.FC<DeckProps> = (props) => (
  <BrandProvider data={props.data || {}} fallbackAccent={ACCENT}>
    <Deck_sequoia_classic_inner {...props} />
  </BrandProvider>
);

export default Deck_sequoia_classic;
