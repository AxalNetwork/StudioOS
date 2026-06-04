import React from 'react';
import { Slide16x9, Editable, DeckProps, DeckData, v, BrandProvider, useBrandContext } from '../DeckBase';

// ─────────────────────────────────────────────────────────────────
// Kawasaki 10/20/30 — exactly 10 slides, one question per slide,
// generous whitespace, single accent. Each slide is a Slide16x9
// (1920×1080) so the platform's Thumbnail / PreviewStage / print
// page can scale and stack uniformly. All slides editable via the
// shared DeckBase Editable; data binds to a flat object built
// server-side from project + financials + ai overlays (see
// PitchDeckPrintPage and services/decks/methods.ts for the field-key
// contract).
// ─────────────────────────────────────────────────────────────────

const PAPER = '#FFFFFF';
const INK = '#0A0A0A';
const ACCENT = '#0F62FE';
const SUBTLE = '#6B7280';
const HAIRLINE = '#E5E7EB';
const PAPER_DEEP = '#F4F4F5';
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", Helvetica, Arial, sans-serif';

// Fixed-size typography for 1920×1080 frames (no clamp() — the
// Slide16x9 stage is itself transform-scaled by the viewer/print).
const TYPE = {
  eyebrow: 13,
  headline: 120,
  support: 44,
  detail: 28,
  caption: 20,
} as const;

const fmtUSD = (n?: any): string => {
  const num = typeof n === 'number' ? n : (n ? Number(n) : NaN);
  if (!isFinite(num)) return n ? String(n) : '—';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
};
const fmtNum = (n?: any): string => {
  const num = typeof n === 'number' ? n : (n ? Number(n) : NaN);
  return isFinite(num) ? num.toLocaleString() : (n ? String(n) : '—');
};
const fmtPct = (n?: any): string => {
  const num = typeof n === 'number' ? n : (n ? Number(n) : NaN);
  return isFinite(num) ? `${num}%` : (n ? String(n) : '—');
};

// ─────────────────────────────────────────────────────────────────
// Slide chrome — top marker (slide N + the ONE question), footer
// ─────────────────────────────────────────────────────────────────

const Frame: React.FC<React.PropsWithChildren<{
  index: number; total: number; question: string; company?: string;
}>> = ({ index, total, question, company, children }) => {
  const { accent: brandAccent } = useBrandContext();
  const ac = brandAccent || ACCENT;
  return (
  <Slide16x9 bg={PAPER} ink={INK} font={FONT}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <span style={{ fontSize: TYPE.eyebrow, letterSpacing: 5.2, fontWeight: 700, color: ac }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <span style={{ fontSize: TYPE.eyebrow, letterSpacing: 5.2, color: SUBTLE, textTransform: 'uppercase' }}>
        {question}
      </span>
    </div>
    <div style={{
      flex: 1, minHeight: 0, marginTop: 64,
      display: 'flex', flexDirection: 'column',
      // Clip rather than overflow the 1920×1080 print frame when AI
      // autofill produces longer-than-expected headlines / bullets.
      overflow: 'hidden',
    }}>
      {children}
    </div>
    <div
      style={{
        position: 'absolute', left: 96, right: 96, bottom: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: TYPE.eyebrow, letterSpacing: 3.9, color: '#A3A3A3', textTransform: 'uppercase',
      }}
    >
      <span>{(company || 'Company').toUpperCase()}</span>
      <span>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
    </div>
  </Slide16x9>
  );
};

// ─────────────────────────────────────────────────────────────────
// SVG primitives — bold, one accent.
// ─────────────────────────────────────────────────────────────────

const PainTangle: React.FC = () => (
  <svg viewBox="0 0 600 460" style={{ width: '100%', height: '100%' }} aria-hidden>
    <circle cx="300" cy="230" r="22" fill={ACCENT} />
    {[
      'M40 60 C 150 120, 220 40, 300 230 C 360 360, 460 80, 560 200',
      'M60 380 C 200 240, 90 140, 300 230 C 480 320, 420 400, 540 360',
      'M120 30 C 250 90, 380 360, 300 230 C 240 130, 480 60, 560 100',
      'M40 200 C 200 280, 360 50, 300 230 C 260 360, 480 240, 560 280',
    ].map((d, i) => (
      <path key={i} d={d} stroke={INK} strokeOpacity={0.85 - i * 0.18} fill="none" strokeWidth={2 + (i % 2)} />
    ))}
    {[[120, 110], [490, 130], [180, 320], [430, 320], [330, 90], [260, 360]].map(([x, y], i) => (
      <g key={i} transform={`translate(${x} ${y})`}>
        <circle r={10} fill={ACCENT} opacity={0.18} />
        <path d="M-7 -7 L7 7 M7 -7 L-7 7" stroke={ACCENT} strokeWidth={2} />
      </g>
    ))}
  </svg>
);

const SolutionArrow: React.FC = () => (
  <svg viewBox="0 0 600 360" style={{ width: '100%', height: '100%' }} aria-hidden>
    <g transform="translate(40 80)">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 38} y={i * 14} width={140} height={48} rx={8}
          fill={PAPER_DEEP} stroke={HAIRLINE} />
      ))}
    </g>
    <g transform="translate(290 170)" stroke={ACCENT} strokeWidth={6} strokeLinecap="round" fill="none">
      <path d="M0 0 L80 0" />
      <path d="M64 -16 L80 0 L64 16" />
    </g>
    <g transform="translate(400 100)">
      <rect width="180" height="160" rx="18" fill={ACCENT} />
      <rect x="20" y="30" width="60" height="10" rx="4" fill="#FFFFFF" opacity="0.5" />
      <rect x="20" y="48" width="140" height="14" rx="6" fill="#FFFFFF" />
      <rect x="20" y="72" width="100" height="10" rx="4" fill="#FFFFFF" opacity="0.5" />
      <rect x="20" y="98" width="140" height="42" rx="8" fill="#FFFFFF" opacity="0.15" />
      <path d="M30 130 L60 110 L80 122 L110 96 L140 116" stroke="#FFFFFF" strokeWidth={3} fill="none" />
    </g>
  </svg>
);

const RevenueFlow: React.FC<{ flow: { from?: string; to: string; label?: string }[] }> = ({ flow }) => {
  const safe = (flow || []).filter((f) => f && f.to);
  if (!safe.length) return null;
  const nodes = ['Customer', ...safe.map((f) => f.to)];
  const W = 1500;
  const H = 260;
  const cx = (i: number) => 140 + i * ((W - 280) / Math.max(nodes.length - 1, 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      {nodes.map((n, i) => (
        <g key={i}>
          <rect
            x={cx(i) - 120} y={H / 2 - 55} width={240} height={110} rx={14}
            fill={i === 0 ? PAPER : i === nodes.length - 1 ? ACCENT : PAPER_DEEP}
            stroke={i === 0 ? INK : i === nodes.length - 1 ? ACCENT : HAIRLINE}
            strokeWidth={i === 0 ? 2 : 1}
          />
          <text x={cx(i)} y={H / 2 + 10} textAnchor="middle" fontSize="26" fontFamily={FONT}
            fontWeight={i === nodes.length - 1 ? 700 : 600}
            fill={i === nodes.length - 1 ? '#FFFFFF' : INK}>
            {n}
          </text>
        </g>
      ))}
      {nodes.slice(0, -1).map((_, i) => (
        <g key={'arr' + i}>
          <line x1={cx(i) + 122} x2={cx(i + 1) - 122} y1={H / 2} y2={H / 2}
            stroke={ACCENT} strokeWidth={3} />
          <path d={`M${cx(i + 1) - 134} ${H / 2 - 10} L${cx(i + 1) - 122} ${H / 2} L${cx(i + 1) - 134} ${H / 2 + 10}`}
            fill="none" stroke={ACCENT} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          {safe[i]?.label && (
            <text x={(cx(i) + cx(i + 1)) / 2} y={H / 2 - 22} textAnchor="middle"
              fontSize="20" fontFamily={FONT} fontWeight={600} fill={ACCENT}>
              {safe[i].label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

const MagicArchitecture: React.FC<{ capabilities: string[] }> = ({ capabilities }) => {
  const items = (capabilities || []).slice(0, 3);
  if (!items.length) return null;
  return (
    <svg viewBox="0 0 560 460" style={{ width: '100%', height: '100%' }} aria-hidden>
      <circle cx="280" cy="230" r="100" fill={ACCENT} />
      <text x="280" y="225" textAnchor="middle" fontSize="20" letterSpacing="3" fontFamily={FONT} fill="#FFFFFF">CORE</text>
      <text x="280" y="252" textAnchor="middle" fontSize="26" fontWeight={800} fontFamily={FONT} fill="#FFFFFF">Engine</text>
      {items.map((label, i) => {
        const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
        const cx = 280 + Math.cos(a) * 180;
        const cy = 230 + Math.sin(a) * 180;
        return (
          <g key={i}>
            <line x1="280" y1="230" x2={cx} y2={cy} stroke={ACCENT} strokeOpacity="0.35" strokeWidth={2} />
            <circle cx={cx} cy={cy} r={62} fill={PAPER} stroke={ACCENT} strokeWidth={2} />
            <text x={cx} y={cy + 7} textAnchor="middle" fontSize="18" fontWeight={700} fontFamily={FONT} fill={INK}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const Funnel: React.FC<{ stages: { stage: string; v: number }[] }> = ({ stages }) => {
  if (!stages?.length) return null;
  const max = Math.max(...stages.map((s) => s.v || 0)) || 1;
  const W = 1500;
  const rowH = 96;
  return (
    <svg viewBox={`0 0 ${W} ${stages.length * rowH + 20}`} style={{ width: '100%' }} aria-hidden>
      {stages.map((s, i) => {
        const w = ((s.v || 0) / max) * (W - 420);
        const y = i * rowH + 10;
        return (
          <g key={i}>
            <rect x={220} y={y} width={w} height={rowH - 28} rx={10}
              fill={ACCENT} fillOpacity={1 - i * 0.13} />
            <text x={210} y={y + (rowH - 28) / 2 + 9} fontSize="24" fill={INK}
              textAnchor="end" fontFamily={FONT} fontWeight={600}>
              {s.stage}
            </text>
            <text x={220 + w + 18} y={y + (rowH - 28) / 2 + 9} fontSize="24" fill={INK}
              fontFamily={FONT} fontWeight={800}>
              {fmtNum(s.v)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const PositioningMap: React.FC<{
  competitors: { name: string; x: number; y: number }[]; axis_x?: string; axis_y?: string;
}> = ({ competitors, axis_x = 'Reach', axis_y = 'Depth' }) => {
  const safe = (competitors || []).filter((c) => c && c.name);
  if (!safe.length) return null;
  const W = 1500;
  const H = 600;
  const padL = 120; const padR = 80; const padT = 50; const padB = 90;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke={INK} strokeWidth={1.5} />
      <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke={INK} strokeWidth={1.5} />
      <text x={W - padR} y={H - padB + 34} textAnchor="end" fontSize="24"
        fontFamily={FONT} fill={INK} letterSpacing="2">
        {axis_x.toUpperCase()} →
      </text>
      <g transform={`translate(${padL - 56}, ${H / 2}) rotate(-90)`}>
        <text fontSize="24" fontFamily={FONT} fill={INK} letterSpacing="2">{axis_y.toUpperCase()} →</text>
      </g>
      <text x={padL + 28} y={padT + 32} fontSize="16" letterSpacing="3" fill="#B5B5B5" fontFamily={FONT}>NICHE</text>
      <text x={W - padR - 28} y={padT + 32} textAnchor="end" fontSize="16" letterSpacing="3" fill="#B5B5B5" fontFamily={FONT}>LEADER</text>
      <text x={padL + 28} y={H - padB - 16} fontSize="16" letterSpacing="3" fill="#B5B5B5" fontFamily={FONT}>GENERIC</text>
      <text x={W - padR - 28} y={H - padB - 16} textAnchor="end" fontSize="16" letterSpacing="3" fill="#B5B5B5" fontFamily={FONT}>WEDGE</text>
      {safe.map((c, i) => {
        const x = Math.max(0, Math.min(100, Number(c.x) || 50));
        const y = Math.max(0, Math.min(100, Number(c.y) || 50));
        const cx = padL + (x / 100) * (W - padL - padR);
        const cy = H - padB - (y / 100) * (H - padT - padB);
        const us = /^(us|we)$/i.test(c.name);
        return (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <circle r={us ? 28 : 18} fill={us ? ACCENT : PAPER_DEEP}
              stroke={us ? ACCENT : INK} strokeWidth={us ? 2 : 1.5} />
            <text y={us ? 56 : 42} textAnchor="middle" fontSize={us ? 28 : 22}
              fontFamily={FONT} fontWeight={us ? 800 : 600} fill={us ? ACCENT : INK}>
              {c.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const RevenueChart: React.FC<{ data: { label: string; v: number }[]; color?: string }> = ({
  data, color = ACCENT,
}) => {
  const safe = (data || []).filter((d) => d && (typeof d.v === 'number'));
  if (safe.length < 2) return null;
  const W = 1500;
  const H = 400;
  const padL = 80; const padR = 60; const padT = 40; const padB = 70;
  const max = Math.max(...safe.map((d) => d.v)) || 1;
  const x = (i: number) => padL + (i / (safe.length - 1)) * (W - padL - padR);
  const y = (val: number) => H - padB - (val / max) * (H - padT - padB);
  const path = safe.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.v)}`).join(' ');
  const area = path + ` L${x(safe.length - 1)} ${H - padB} L${x(0)} ${H - padB} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} aria-hidden>
      {[0.25, 0.5, 0.75, 1].map((t, i) => (
        <line key={i} x1={padL} x2={W - padR}
          y1={H - padB - t * (H - padT - padB)} y2={H - padB - t * (H - padT - padB)}
          stroke={HAIRLINE} strokeDasharray="4 4" />
      ))}
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth={4}
        strokeLinecap="round" strokeLinejoin="round" />
      {safe.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.v)} r={7} fill={color} />
          <text x={x(i)} y={H - padB + 34} textAnchor="middle" fontSize="22"
            fontFamily={FONT} fill={SUBTLE}>
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
};

const BigStatRow: React.FC<{ stats: { label: string; value: string; highlight?: boolean }[] }> = ({ stats }) => (
  <div style={{
    display: 'grid', width: '100%',
    gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`, gap: 48,
  }}>
    {stats.map((s, i) => (
      <div key={i}>
        <div style={{ fontSize: TYPE.detail, color: SUBTLE, fontWeight: 500 }}>{s.label}</div>
        <div style={{
          fontSize: 96, fontWeight: 900, letterSpacing: -2,
          color: s.highlight ? ACCENT : INK, marginTop: 8, lineHeight: 1,
        }}>
          {s.value}
        </div>
      </div>
    ))}
  </div>
);

const TimelineDots: React.FC<{
  items: ({ date?: string; label?: string; year?: string; event?: string })[];
  highlightIdx?: number;
}> = ({ items, highlightIdx = -1 }) => {
  // Accept both Kawasaki-native {date,label} (milestones) and the
  // {year,event} shape returned by normalizeBullets('team_timeline')
  // + the team-timeline overlay. Normalise to {date,label} here so the
  // two callers stay symmetric.
  const safe = (items || [])
    .filter((m: any) => m && (m.date || m.label || m.year || m.event))
    .map((m: any) => ({
      date: String(m.date ?? m.year ?? ''),
      label: String(m.label ?? m.event ?? ''),
    }));
  if (!safe.length) return null;
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 1, background: HAIRLINE }} />
      <div style={{
        display: 'grid', width: '100%',
        gridTemplateColumns: `repeat(${safe.length}, minmax(0, 1fr))`, gap: 24,
      }}>
        {safe.map((m, i) => (
          <div key={i} style={{ position: 'relative', paddingTop: 48, textAlign: 'center' }}>
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 4,
              width: i === highlightIdx ? 16 : 12, height: i === highlightIdx ? 16 : 12,
              borderRadius: 999, background: ACCENT,
            }} />
            <div style={{ fontSize: TYPE.eyebrow, letterSpacing: 3.9, color: ACCENT, fontWeight: 700 }}>
              {String(m.date || '').toUpperCase()}
            </div>
            <div style={{ fontSize: TYPE.caption, color: INK, marginTop: 8, lineHeight: 1.35 }}>
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Donut: React.FC<{ data: { label: string; pct: number }[] }> = ({ data }) => {
  const safe = (data || []).filter((d) => d && typeof d.pct === 'number' && d.pct > 0);
  if (!safe.length) return null;
  const palette = [ACCENT, '#3D87FF', '#7CA9FF', '#B6CCFF', '#DBE6FF'];
  const r = 130;
  const cx = 150; const cy = 150;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 48, width: '100%' }}>
      <svg viewBox="0 0 300 300" width={300} height={300} aria-hidden>
        {safe.map((d, i) => {
          const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          acc += d.pct;
          const end = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          const large = d.pct > 50 ? 1 : 0;
          const x1 = cx + r * Math.cos(start); const y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end); const y2 = cy + r * Math.sin(end);
          return (
            <path key={i}
              d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
              fill={palette[i % palette.length]} />
          );
        })}
        <circle cx={cx} cy={cy} r={70} fill={PAPER} />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {safe.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 16, height: 16, borderRadius: 4,
              background: palette[i % palette.length],
            }} />
            <span style={{ fontSize: TYPE.caption, color: INK, fontWeight: 600 }}>{d.label}</span>
            <span style={{ fontSize: TYPE.caption, color: SUBTLE, marginLeft: 8 }}>{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// 10 slides — one question each.
// ─────────────────────────────────────────────────────────────────

const headlineStyle: React.CSSProperties = {
  fontSize: TYPE.headline, fontWeight: 900, letterSpacing: -3, lineHeight: 1.02, color: INK,
};
const supportStyle: React.CSSProperties = {
  fontSize: TYPE.support, color: SUBTLE, marginTop: 32, maxWidth: 1280, lineHeight: 1.25, fontWeight: 500,
};

const Slide1: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => (
  <Frame index={0} total={10} question="What is broken?" company={v(data, 'company', 'Company')}>
    <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 96, height: '100%', alignItems: 'center' }}>
      <div>
        <Editable as="h1" value={v(data, 'problem_headline')} path="problem_headline"
          editable={editable} onEdit={onEdit}
          placeholder="Teams stitch six tools to ship one workflow."
          style={headlineStyle} />
        <Editable value={v(data, 'problem_support')} path="problem_support"
          editable={editable} onEdit={onEdit}
          placeholder="The cost is enormous, hidden, and ignored."
          style={supportStyle} />
        {(() => {
          const stat = data.problem_stat;
          if (!stat || !stat.value) return null;
          return (
            <div style={{ marginTop: 56 }}>
              <div style={{
                fontSize: 144, fontWeight: 900, letterSpacing: -3,
                color: ACCENT, lineHeight: 1,
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: TYPE.detail, color: SUBTLE, marginTop: 12,
                fontWeight: 500, maxWidth: 560, lineHeight: 1.3,
              }}>
                {stat.label}
              </div>
            </div>
          );
        })()}
      </div>
      <div style={{ height: 520 }}><PainTangle /></div>
    </div>
  </Frame>
);

const Slide2: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const pillars = (data.solution_pillar_words || []).slice(0, 3);
  return (
    <Frame index={1} total={10} question="What is the fix?" company={v(data, 'company', 'Company')}>
      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 96, height: '100%', alignItems: 'center' }}>
        <div>
          <Editable as="h1" value={v(data, 'solution_headline')} path="solution_headline"
            editable={editable} onEdit={onEdit}
            placeholder="One workflow. Done."
            style={headlineStyle} />
          <Editable value={v(data, 'solution_support')} path="solution_support"
            editable={editable} onEdit={onEdit}
            placeholder="A single source of truth that replaces the patchwork."
            style={supportStyle} />
          {pillars.length > 0 && (
            <div style={{ display: 'flex', gap: 64, marginTop: 64, flexWrap: 'wrap' }}>
              {pillars.map((w: string, i: number) => (
                <div key={i} style={{
                  fontSize: 64, fontWeight: 900, color: i === pillars.length - 1 ? ACCENT : INK,
                  letterSpacing: -2,
                }}>
                  {w}.
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ height: 460 }}><SolutionArrow /></div>
      </div>
    </Frame>
  );
};

const Slide3: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const unit = data.bm_unit || {};
  const flow = Array.isArray(data.revenue_flow) ? data.revenue_flow : [];
  return (
    <Frame index={2} total={10} question="How do we earn?" company={v(data, 'company', 'Company')}>
      <Editable as="h1" value={v(data, 'bm_headline')} path="bm_headline"
        editable={editable} onEdit={onEdit}
        placeholder="Subscription. Per seat. Annual contracts."
        style={headlineStyle} />
      <div style={{ marginTop: 56, flex: 1, minHeight: 0,
        display: 'grid', gridTemplateRows: '1fr auto', gap: 56 }}>
        <RevenueFlow flow={flow} />
        {(unit.acv || unit.gross_margin || unit.payback) && (
          <BigStatRow stats={[
            { label: 'ACV',          value: String(unit.acv || '—') },
            { label: 'Gross margin', value: String(unit.gross_margin || '—'), highlight: true },
            { label: 'Payback',      value: String(unit.payback || '—') },
          ]} />
        )}
      </div>
    </Frame>
  );
};

const Slide4: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const caps = Array.isArray(data.magic_capabilities) ? data.magic_capabilities : [];
  return (
    <Frame index={3} total={10} question="Why us, not them?" company={v(data, 'company', 'Company')}>
      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 96, height: '100%', alignItems: 'center' }}>
        <div>
          <Editable as="h1" value={v(data, 'magic_headline')} path="magic_headline"
            editable={editable} onEdit={onEdit}
            placeholder="A reasoning engine the incumbents can't copy."
            style={headlineStyle} />
          <Editable value={v(data, 'magic_support')} path="magic_support"
            editable={editable} onEdit={onEdit}
            placeholder="Every customer's daily work trains the next decision."
            style={supportStyle} />
        </div>
        <div style={{ height: 520 }}>
          {caps.length > 0 ? <MagicArchitecture capabilities={caps} /> : null}
        </div>
      </div>
    </Frame>
  );
};

const Slide5: React.FC<DeckProps> = ({ data = {} }) => {
  const funnel = Array.isArray(data.funnel) ? data.funnel : [];
  return (
    <Frame index={4} total={10} question="How do we reach them?" company={v(data, 'company', 'Company')}>
      <div style={{
        fontSize: TYPE.headline, fontWeight: 900, letterSpacing: -3,
        lineHeight: 1.02, color: INK,
      }}>
        Inbound that compounds.
      </div>
      <div style={{ marginTop: 64, flex: 1, minHeight: 0 }}>
        {funnel.length > 0 ? <Funnel stages={funnel} /> : null}
      </div>
    </Frame>
  );
};

const Slide6: React.FC<DeckProps> = ({ data = {} }) => (
  <Frame index={5} total={10} question="Who else is here?" company={v(data, 'company', 'Company')}>
    <div style={headlineStyle}>One axis wins. We pick the right one.</div>
    <div style={{ marginTop: 56, flex: 1, minHeight: 0 }}>
      <PositioningMap
        competitors={Array.isArray(data.competitors) ? data.competitors : []}
        axis_x={data.axis_x} axis_y={data.axis_y}
      />
    </div>
  </Frame>
);

const Slide7: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const founders = Array.isArray(data.founders) ? data.founders : [];
  const timeline = Array.isArray(data.team_timeline) ? data.team_timeline : [];
  return (
    <Frame index={6} total={10} question="Who is shipping this?" company={v(data, 'company', 'Company')}>
      <div style={headlineStyle}>Operators with scar tissue.</div>
      <div style={{
        marginTop: 56, display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(founders.length, 1)}, minmax(0, 1fr))`,
        gap: 48,
      }}>
        {founders.map((f: any, i: number) => (
          <div key={i} style={{ display: 'flex', gap: 24 }}>
            <div style={{
              width: 120, height: 120, borderRadius: 999,
              background: PAPER_DEEP, color: ACCENT,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 36, fontWeight: 900, letterSpacing: -1, flexShrink: 0,
            }}>
              {String(f.initials || (f.name || '').split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2) || '?').toUpperCase()}
            </div>
            <div>
              <Editable value={f.name} path={`founders.${i}.name`}
                editable={editable} onEdit={onEdit}
                style={{ fontSize: TYPE.support, fontWeight: 800, color: INK }} />
              <Editable value={f.role} path={`founders.${i}.role`}
                editable={editable} onEdit={onEdit}
                style={{ fontSize: TYPE.detail, color: ACCENT, marginTop: 6, fontWeight: 600 }} />
              <Editable value={f.bio} path={`founders.${i}.bio`}
                editable={editable} onEdit={onEdit}
                style={{ fontSize: TYPE.detail, color: SUBTLE, marginTop: 8, lineHeight: 1.35 }} />
            </div>
          </div>
        ))}
      </div>
      {timeline.length > 0 && (
        <div style={{ marginTop: 'auto', paddingTop: 48 }}>
          <TimelineDots items={timeline} highlightIdx={timeline.length - 1} />
        </div>
      )}
    </Frame>
  );
};

const Slide8: React.FC<DeckProps> = ({ data = {} }) => {
  const rev = Array.isArray(data.revenue_series) ? data.revenue_series : [];
  const ms = Array.isArray(data.milestones) ? data.milestones : [];
  return (
    <Frame index={7} total={10} question="Where are we going?" company={v(data, 'company', 'Company')}>
      <div style={headlineStyle}>
        {rev.length > 0 ? `$${fmtNum(rev[rev.length - 1].v)}M ARR by ${rev[rev.length - 1].label}.` : 'Projected category leader.'}
      </div>
      <div style={{
        marginTop: 56, flex: 1, minHeight: 0,
        display: 'grid', gridTemplateRows: '1fr auto', gap: 56,
      }}>
        {rev.length > 0 ? <RevenueChart data={rev} /> : <div />}
        {ms.length > 0 && <TimelineDots items={ms} highlightIdx={Math.max(ms.length - 2, 0)} />}
      </div>
    </Frame>
  );
};

const Slide9: React.FC<DeckProps> = ({ data = {} }) => {
  const users = Array.isArray(data.user_series) ? data.user_series : [];
  return (
    <Frame index={8} total={10} question="What evidence exists?" company={v(data, 'company', 'Company')}>
      <div style={headlineStyle}>
        {typeof data.growth_mom_pct === 'number'
          ? `Live. Growing ${data.growth_mom_pct}% MoM.`
          : 'Live and growing.'}
      </div>
      <div style={{ marginTop: 64 }}>
        <BigStatRow stats={[
          { label: 'MRR',    value: fmtUSD(data.mrr_usd) },
          { label: 'Paying', value: fmtNum(data.paying_customers) },
          { label: 'MoM',    value: fmtPct(data.growth_mom_pct), highlight: true },
          { label: 'NRR',    value: fmtPct(data.nrr_pct) },
        ]} />
      </div>
      <div style={{ marginTop: 56, flex: 1, minHeight: 0 }}>
        {users.length > 0 ? <RevenueChart data={users} /> : null}
      </div>
    </Frame>
  );
};

const Slide10: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const uof = Array.isArray(data.use_of_funds) ? data.use_of_funds : [];
  return (
    <Frame index={9} total={10} question="Why invest now?" company={v(data, 'company', 'Company')}>
      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 96, height: '100%', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: TYPE.eyebrow, letterSpacing: 7.8, color: ACCENT, fontWeight: 700 }}>
            RAISING
          </div>
          <Editable as="h1" value={fmtUSD(data.ask_amount_usd)} path="ask_amount_usd"
            editable={editable} onEdit={onEdit}
            style={{
              fontSize: 192, fontWeight: 900, letterSpacing: -6,
              lineHeight: 0.95, color: ACCENT, marginTop: 16,
            }} />
          <Editable value={v(data, 'closing_line')} path="closing_line"
            editable={editable} onEdit={onEdit}
            placeholder="One memorable closing line — what becomes true if this works."
            style={{
              fontSize: TYPE.support, color: INK, marginTop: 40,
              maxWidth: 1100, lineHeight: 1.25, fontWeight: 600,
            }} />
          <div style={{ marginTop: 56, display: 'flex', alignItems: 'flex-end', gap: 64 }}>
            <div>
              <div style={{ fontSize: TYPE.detail, color: SUBTLE }}>Runway</div>
              <div style={{ fontSize: 64, fontWeight: 800, marginTop: 4 }}>
                {data.runway_months ?? '—'}
                <span style={{ fontSize: TYPE.detail, color: SUBTLE, marginLeft: 8 }}>months</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: TYPE.detail, color: SUBTLE }}>Contact</div>
              <Editable value={v(data, 'contact')} path="contact"
                editable={editable} onEdit={onEdit}
                placeholder="founders@company.com"
                style={{ fontSize: TYPE.support, fontWeight: 700, marginTop: 4 }} />
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: TYPE.eyebrow, letterSpacing: 7.8, color: SUBTLE, fontWeight: 700 }}>
            USE OF FUNDS
          </div>
          <div style={{ marginTop: 40 }}>
            {uof.length > 0 ? <Donut data={uof} /> : null}
          </div>
        </div>
      </div>
    </Frame>
  );
};

export const Deck_kawasaki_10_20_30: React.FC<DeckProps> = (props) => (
  <BrandProvider data={props.data ?? {}} fallbackAccent={ACCENT}>
    <Deck_kawasaki_10_20_30_inner {...props} />
  </BrandProvider>
);

const Deck_kawasaki_10_20_30_inner: React.FC<DeckProps> = (props) => {
  // Normalise a null `data` prop to `{}` so the per-slide `data = {}`
  // default (which only fires for `undefined`) can't be bypassed — a
  // null payload otherwise throws on the first `data.problem_stat` read.
  const safe = { ...props, data: props.data ?? {} };
  return (
  <>
    <Slide1 {...safe} />
    <Slide2 {...safe} />
    <Slide3 {...safe} />
    <Slide4 {...safe} />
    <Slide5 {...safe} />
    <Slide6 {...safe} />
    <Slide7 {...safe} />
    <Slide8 {...safe} />
    <Slide9 {...safe} />
    <Slide10 {...safe} />
  </>
  );
};
