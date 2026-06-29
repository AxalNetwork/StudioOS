//
// Binds to Axal VC platform data via `data` prop; falls back to
// SAMPLE_DATA when rendered standalone.
//
// Requires: framer-motion (already in StudioOS deps; verify).

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Slide16x9, type DeckProps as RegistryDeckProps } from '../DeckBase';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MinimalSeedData = {
  // Slide 1 — Company
  company?: string;
  one_liner?: string;
  value_prop?: string;
  domain?: string;

  // Slide 2 — Problem
  problem_headline?: string;
  problem_support?: string;
  problem_stat?: { value: string; label: string };
  affected_segment?: string;

  // Slide 3 — Solution
  before_state?: string[];
  after_state?: string[];
  differentiators?: string[];   // 3 short bullets

  // Slide 4 — Traction
  mrr_usd?: number;
  paying_customers?: number;
  growth_mom_pct?: number;
  nrr_pct?: number;
  revenue_series?: { label: string; v: number }[];
  user_series?: { label: string; v: number }[];
  milestones?: { date: string; label: string }[];
  partner_logos?: { name: string; initials?: string }[];

  // Slide 5 — Team
  founders?: { name: string; role: string; bio: string; initials?: string }[];
  expertise_axes?: string[];    // 6 labels for radar
  expertise_values?: number[];  // 6 values 0..100
  achievements?: { year: string; event: string }[];

  // Slide 6 — Ask
  ask_amount_usd?: number;
  runway_months?: number;
  use_of_funds?: { label: string; pct: number }[];
  roadmap?: { quarter: string; goal: string }[];
  closing_line?: string;
  contact?: string;
};

export type DeckProps = {
  data?: MinimalSeedData;
  editable?: boolean;
  onEdit?: (path: string, value: string) => void;
};

// ─────────────────────────────────────────────────────────────────
// Tokens — Linear/Stripe/Figma minimal palette
// ─────────────────────────────────────────────────────────────────

const PAPER = '#FFFFFF';
const INK = '#0A0A0A';
const ACCENT = '#5E6AD2';      // Linear violet
const SUBTLE = '#6B7280';
const FAINT = '#9CA3AF';
const HAIRLINE = '#E5E7EB';
const SURFACE = '#F9FAFB';
const SURFACE_2 = '#F3F4F6';

const FONT =
  '-apple-system, BlinkMacSystemFont, "Inter", "SF Pro Display", Helvetica, sans-serif';
const FONT_MONO =
  '"SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, monospace';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const fmtUSD = (n?: number) => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const fmtNum = (n?: number) => (n == null || isNaN(n) ? '—' : n.toLocaleString());
const fmtPct = (n?: number) => (n == null || isNaN(n) ? '—' : `${n}%`);

const Editable: React.FC<{
  value?: string;
  path: string;
  editable?: boolean;
  onEdit?: (p: string, v: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  as?: keyof JSX.IntrinsicElements;
}> = ({ value, path, editable, onEdit, placeholder, className, style, as = 'div' }) => {
  const Tag: any = as;
  return (
    <Tag
      contentEditable={!!editable}
      suppressContentEditableWarning
      onBlur={(e: any) => onEdit?.(path, e.currentTarget.textContent || '')}
      className={className}
      style={{
        outline: 'none',
        minHeight: '1em',
        color: !value ? '#A3A3A3' : style?.color,
        ...style,
      }}
    >
      {value || placeholder || ''}
    </Tag>
  );
};

// ─────────────────────────────────────────────────────────────────
// Slide frame — generous whitespace, one accent, soft hairline corner
// ─────────────────────────────────────────────────────────────────

const SlideFrame: React.FC<
  React.PropsWithChildren<{
    index: number;
    total: number;
    label: string;
    question: string;
    company?: string;
  }>
> = ({ index, total, label, question, company, children }) => (
  <div
    className="relative"
    style={{
      aspectRatio: '16 / 9',
      width: '100%',
      maxHeight: '100vh',
      background: PAPER,
      color: INK,
      fontFamily: FONT,
      padding: 'clamp(40px, 6vw, 96px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}
  >
    {/* Eyebrow */}
    <div className="flex items-center gap-6">
      <span
        style={{
          fontSize: 11,
          letterSpacing: '0.36em',
          fontWeight: 700,
          color: ACCENT,
          fontFamily: FONT_MONO,
        }}
      >
        {String(index + 1).padStart(2, '0')}
      </span>
      <span className="block w-12 h-px" style={{ background: ACCENT, opacity: 0.5 }} />
      <span
        style={{
          fontSize: 11,
          letterSpacing: '0.36em',
          color: SUBTLE,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        className="ml-auto"
        style={{
          fontSize: 11,
          letterSpacing: '0.36em',
          color: FAINT,
          fontFamily: FONT_MONO,
        }}
      >
        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>

    {/* Question */}
    <div
      style={{
        fontSize: 13,
        color: FAINT,
        marginTop: 12,
        fontStyle: 'italic',
        letterSpacing: '0.02em',
      }}
    >
      {question}
    </div>

    {/* Content */}
    <div className="flex-1 min-h-0 flex flex-col mt-8">{children}</div>

    {/* Footer */}
    <div
      className="absolute left-0 right-0 bottom-0 flex items-center justify-between"
      style={{ padding: '0 clamp(40px, 6vw, 96px) clamp(20px, 2.5vw, 32px)' }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: '0.24em',
          color: FAINT,
          fontFamily: FONT_MONO,
        }}
      >
        {(company || 'Company').toUpperCase()}
      </span>
      <span style={{ fontSize: 11, letterSpacing: '0.24em', color: FAINT }}>
        Confidential
      </span>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// SVG primitives
// ─────────────────────────────────────────────────────────────────

const Logo: React.FC<{ size?: number }> = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
    <defs>
      <linearGradient id="ms-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={ACCENT} />
        <stop offset="100%" stopColor="#3B4AB5" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="58" height="58" rx="14" fill="url(#ms-grad)" />
    <path
      d="M16 44 L32 18 L48 44 M22 36 H42"
      stroke="#FFFFFF"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ProductMockup: React.FC = () => (
  <svg viewBox="0 0 600 380" className="w-full h-full" aria-hidden>
    <defs>
      <linearGradient id="screen-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="100%" stopColor="#FAFAFB" />
      </linearGradient>
      <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="20" stdDeviation="20" floodColor="#0A0A0A" floodOpacity="0.06" />
      </filter>
    </defs>

    {/* Window */}
    <g filter="url(#card-shadow)">
      <rect x="20" y="20" width="560" height="340" rx="16" fill="url(#screen-bg)" stroke={HAIRLINE} />
      {/* Title bar */}
      <rect x="20" y="20" width="560" height="44" rx="16" fill={SURFACE} />
      <rect x="20" y="62" width="560" height="2" fill={HAIRLINE} />
      <circle cx="44" cy="42" r="5" fill="#FF6B6B" />
      <circle cx="64" cy="42" r="5" fill="#FFD93D" />
      <circle cx="84" cy="42" r="5" fill="#6BCB77" />
      <rect x="220" y="32" width="160" height="20" rx="6" fill={SURFACE_2} />
    </g>

    {/* Sidebar */}
    <rect x="36" y="80" width="140" height="264" rx="10" fill={SURFACE} />
    {[0, 1, 2, 3, 4].map((i) => (
      <g key={i}>
        <rect
          x={48}
          y={96 + i * 40}
          width={i === 1 ? 116 : 96}
          height={20}
          rx={6}
          fill={i === 1 ? ACCENT : '#E5E7EB'}
          opacity={i === 1 ? 1 : 0.6}
        />
      </g>
    ))}

    {/* Main canvas */}
    <rect x="192" y="80" width="396" height="64" rx="10" fill={SURFACE} />
    <rect x="208" y="96" width="160" height="14" rx="4" fill="#D1D5DB" />
    <rect x="208" y="118" width="100" height="10" rx="4" fill="#E5E7EB" />

    {/* Chart card */}
    <g>
      <rect x="192" y="160" width="240" height="184" rx="12" fill={SURFACE} />
      <rect x="208" y="180" width="80" height="10" rx="4" fill="#D1D5DB" />
      <rect x="208" y="196" width="48" height="22" rx="6" fill={INK} />
      <text x="232" y="212" textAnchor="middle" fontSize="11" fontWeight="700" fill="#FFFFFF" fontFamily={FONT}>+41%</text>
      {/* curve */}
      <path
        d="M210 312 L240 290 L268 296 L298 270 L328 280 L358 246 L390 254 L418 226"
        stroke={ACCENT}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      {[210,240,268,298,328,358,390,418].map((x,i)=>(<circle key={i} cx={x} cy={[312,290,296,270,280,246,254,226][i]} r={2.5} fill={ACCENT} />))}
    </g>

    {/* Stat cards */}
    <g>
      <rect x="448" y="160" width="140" height="88" rx="12" fill={ACCENT} />
      <text x="468" y="190" fontSize="11" fontFamily={FONT} fill="#FFFFFF" opacity="0.85" letterSpacing="2">MRR</text>
      <text x="468" y="222" fontSize="26" fontWeight="800" fontFamily={FONT} fill="#FFFFFF">$34K</text>
    </g>
    <g>
      <rect x="448" y="256" width="140" height="88" rx="12" fill={SURFACE} />
      <text x="468" y="284" fontSize="11" fontFamily={FONT} fill={SUBTLE} letterSpacing="2">CUSTOMERS</text>
      <text x="468" y="316" fontSize="26" fontWeight="800" fontFamily={FONT} fill={INK}>64</text>
    </g>
  </svg>
);

const FrictionIllustration: React.FC = () => (
  <svg viewBox="0 0 600 460" className="w-full h-full" aria-hidden>
    <defs>
      <pattern id="grid-ms" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke={HAIRLINE} strokeWidth="0.8" />
      </pattern>
    </defs>
    <rect width="600" height="460" fill="url(#grid-ms)" opacity="0.6" />

    {/* Disconnected tool cards */}
    {[
      { x: 60, y: 80, label: 'CRM' },
      { x: 240, y: 50, label: 'Sheets' },
      { x: 420, y: 90, label: 'Email' },
      { x: 90, y: 240, label: 'Slack' },
      { x: 270, y: 270, label: 'Drive' },
      { x: 440, y: 240, label: 'PDF' },
      { x: 170, y: 380, label: 'DB' },
      { x: 360, y: 380, label: 'BI' },
    ].map((t, i) => (
      <g key={i} transform={`translate(${t.x} ${t.y})`}>
        <rect width="110" height="56" rx="10" fill={PAPER} stroke={HAIRLINE} />
        <text x="55" y="34" textAnchor="middle" fontSize="14" fontFamily={FONT} fontWeight={600} fill={INK}>
          {t.label}
        </text>
      </g>
    ))}

    {/* Tangled lines between */}
    {[
      'M115,108 C 200,160 220,90 295,78',
      'M295,78 C 360,160 380,80 475,118',
      'M115,108 C 80,200 130,240 145,268',
      'M295,78 C 220,200 300,260 325,298',
      'M475,118 C 540,220 460,260 495,268',
      'M145,268 C 200,360 240,360 225,408',
      'M325,298 C 310,360 380,360 415,408',
    ].map((d, i) => (
      <path
        key={i}
        d={d}
        stroke={ACCENT}
        strokeOpacity={0.4 - i * 0.03}
        strokeWidth={2}
        fill="none"
        strokeDasharray="4 4"
      />
    ))}

    {/* Friction sparks */}
    {[
      [195, 130], [380, 130], [200, 290], [400, 290], [275, 380],
    ].map(([x, y], i) => (
      <g key={i} transform={`translate(${x} ${y})`}>
        <circle r="12" fill={ACCENT} opacity="0.12" />
        <path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke={ACCENT} strokeWidth="2" />
      </g>
    ))}
  </svg>
);

const BeforeAfterFlow: React.FC = () => (
  <svg viewBox="0 0 720 200" className="w-full" aria-hidden>
    {/* Before nodes */}
    {[0, 1, 2, 3].map((i) => (
      <g key={`b${i}`}>
        <rect x={20 + i * 60} y={70} width={44} height={44} rx={8} fill={SURFACE} stroke={HAIRLINE} />
        <text x={42 + i * 60} y={97} textAnchor="middle" fontSize="13" fontWeight={700} fontFamily={FONT_MONO} fill={SUBTLE}>
          {i + 1}
        </text>
        {i < 3 && (
          <path
            d={`M${64 + i * 60} 92 L${80 + i * 60} 92`}
            stroke={FAINT}
            strokeWidth={1.5}
          />
        )}
      </g>
    ))}

    {/* Arrow */}
    <g transform="translate(290 70)">
      <path d="M0 22 L80 22" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <path d="M68 10 L80 22 L68 34" stroke={ACCENT} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>

    {/* After: one node */}
    <g transform="translate(420 50)">
      <rect width="280" height="100" rx="14" fill={ACCENT} />
      <rect x="20" y="20" width="80" height="10" rx="4" fill="#FFFFFF" opacity="0.5" />
      <rect x="20" y="36" width="160" height="16" rx="6" fill="#FFFFFF" />
      <rect x="20" y="62" width="120" height="22" rx="6" fill="#FFFFFF" opacity="0.2" />
      <path
        d="M28 78 L48 70 L66 74 L86 64 L106 70"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <text x="240" y="76" textAnchor="middle" fontSize="34" fontWeight="900" fill="#FFFFFF" fontFamily={FONT}>
        ✓
      </text>
    </g>
  </svg>
);

const AreaChart: React.FC<{ data: { label: string; v: number }[]; color?: string; height?: number }> = ({
  data,
  color = ACCENT,
  height = 200,
}) => {
  if (!data?.length) return null;
  const W = 460;
  const H = height;
  const padL = 40;
  const padR = 24;
  const padT = 24;
  const padB = 36;
  const max = Math.max(...data.map((d) => d.v));
  const x = (i: number) => padL + (i / (data.length - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / max) * (H - padT - padB);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.v)}`).join(' ');
  const area = path + ` L${x(data.length - 1)} ${H - padB} L${x(0)} ${H - padB} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((t, i) => (
        <line
          key={i}
          x1={padL}
          x2={W - padR}
          y1={H - padB - t * (H - padT - padB)}
          y2={H - padB - t * (H - padT - padB)}
          stroke={HAIRLINE}
          strokeDasharray="2 3"
        />
      ))}
      <path d={area} fill={`url(#grad-${color})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.v)} r="3.5" fill={color} />
          <text x={x(i)} y={H - padB + 18} textAnchor="middle" fontSize="10" fontFamily={FONT_MONO} fill={FAINT}>
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
};

const LogoChip: React.FC<{ name: string; initials?: string }> = ({ name, initials }) => {
  const text = initials || name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
      style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
    >
      <div
        className="rounded-md flex items-center justify-center font-bold"
        style={{
          width: 24,
          height: 24,
          background: ACCENT,
          color: '#FFFFFF',
          fontSize: 10,
          fontFamily: FONT_MONO,
        }}
      >
        {text.toUpperCase()}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{name}</span>
    </div>
  );
};

const TimelineDots: React.FC<{ items: { date: string; label: string }[]; activeIdx?: number }> = ({
  items,
  activeIdx = -1,
}) => (
  <div className="relative w-full">
    <div className="absolute left-0 right-0 top-3 h-px" style={{ background: HAIRLINE }} />
    <div
      className="grid w-full"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 16 }}
    >
      {items.map((m, i) => (
        <div key={i} className="relative pt-9">
          <span
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: 0,
              width: i === activeIdx ? 14 : 10,
              height: i === activeIdx ? 14 : 10,
              borderRadius: 999,
              background: ACCENT,
              boxShadow: i === activeIdx ? `0 0 0 4px ${PAPER}, 0 0 0 5px ${ACCENT}40` : undefined,
            }}
          />
          <div
            style={{
              fontSize: 10,
              letterSpacing: 2,
              color: ACCENT,
              fontWeight: 700,
              fontFamily: FONT_MONO,
              textAlign: 'center',
            }}
          >
            {(m.date || '').toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: INK, marginTop: 6, lineHeight: 1.35, textAlign: 'center' }}>
            {m.label}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ExpertiseRadar: React.FC<{ axes: string[]; values: number[] }> = ({ axes, values }) => {
  const W = 320;
  const H = 320;
  const cx = W / 2;
  const cy = H / 2;
  const R = 110;
  const points = axes.map((_, i) => {
    const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
    const v = Math.max(0, Math.min(100, values[i] ?? 0)) / 100;
    return {
      x: cx + Math.cos(a) * R * v,
      y: cy + Math.sin(a) * R * v,
      labelX: cx + Math.cos(a) * (R + 28),
      labelY: cy + Math.sin(a) * (R + 28),
    };
  });
  const grid = [0.33, 0.66, 1].map((r) =>
    axes
      .map((_, i) => {
        const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
        return `${cx + Math.cos(a) * R * r},${cy + Math.sin(a) * R * r}`;
      })
      .join(' ')
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" aria-hidden>
      {grid.map((p, i) => (
        <polygon key={i} points={p} fill="none" stroke={HAIRLINE} />
      ))}
      {axes.map((_, i) => {
        const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(a) * R}
            y2={cy + Math.sin(a) * R}
            stroke={HAIRLINE}
          />
        );
      })}
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill={ACCENT}
        fillOpacity="0.18"
        stroke={ACCENT}
        strokeWidth="2"
      />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" fill={ACCENT} />
          <text
            x={p.labelX}
            y={p.labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fontFamily={FONT}
            fontWeight={600}
            fill={INK}
          >
            {axes[i]}
          </text>
        </g>
      ))}
    </svg>
  );
};

const Donut: React.FC<{ data: { label: string; pct: number }[] }> = ({ data }) => {
  if (!data?.length) return null;
  const palette = [ACCENT, '#7C8CE0', '#A2AEEA', '#C5CCEF', '#E2E5F6'];
  const r = 90;
  const cx = 110;
  const cy = 110;
  let acc = 0;
  return (
    <div className="flex items-center gap-8 w-full">
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
            <path
              key={i}
              d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
              fill={palette[i % palette.length]}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={56} fill={PAPER} />
      </svg>
      <div className="space-y-2.5 flex-1">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: palette[i % palette.length] }}
            />
            <span style={{ color: INK, fontWeight: 500 }}>{d.label}</span>
            <span style={{ color: INK, fontWeight: 700, marginLeft: 'auto', fontFamily: FONT_MONO }}>
              {d.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Slides — exactly 6, one investor question each
// ─────────────────────────────────────────────────────────────────

const Slide1Company: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => (
  <SlideFrame index={0} total={6} label="Company" question="What are you building?" company={data.company}>
    <div className="grid grid-cols-12 gap-10 h-full items-center">
      <div className="col-span-6 flex flex-col justify-center">
        <div className="flex items-center gap-4">
          <Logo size={64} />
          <div>
            <Editable
              as="div"
              value={data.company}
              path="company"
              editable={editable}
              onEdit={onEdit}
              placeholder="[Company]"
              style={{
                fontSize: 'clamp(36px, 4vw, 64px)',
                fontWeight: 800,
                letterSpacing: -2,
                lineHeight: 1,
                color: INK,
              }}
            />
            <Editable
              value={data.domain}
              path="domain"
              editable={editable}
              onEdit={onEdit}
              placeholder="company.com"
              style={{
                fontSize: 13,
                color: FAINT,
                marginTop: 4,
                fontFamily: FONT_MONO,
                letterSpacing: 1,
              }}
            />
          </div>
        </div>

        <Editable
          as="h1"
          value={data.one_liner}
          path="one_liner"
          editable={editable}
          onEdit={onEdit}
          placeholder="One sentence that says what the company does."
          style={{
            fontSize: 'clamp(28px, 3.4vw, 56px)',
            fontWeight: 700,
            letterSpacing: -1.5,
            lineHeight: 1.1,
            color: INK,
            marginTop: 40,
            maxWidth: 620,
          }}
        />

        <Editable
          value={data.value_prop}
          path="value_prop"
          editable={editable}
          onEdit={onEdit}
          placeholder="A short, sharp value proposition. Why this matters to the customer in one breath."
          style={{
            fontSize: 'clamp(15px, 1.3vw, 20px)',
            color: SUBTLE,
            marginTop: 20,
            maxWidth: 560,
            lineHeight: 1.5,
          }}
        />

        <div className="mt-10 flex items-center gap-3">
          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />
            <span style={{ fontSize: 11, fontFamily: FONT_MONO, fontWeight: 600, color: INK, letterSpacing: 1 }}>
              SEED · {new Date().getFullYear()}
            </span>
          </span>
        </div>
      </div>
      <div className="col-span-6 h-full max-h-[62vh]">
        <ProductMockup />
      </div>
    </div>
  </SlideFrame>
);

const Slide2Problem: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => (
  <SlideFrame index={1} total={6} label="Problem" question="What painful problem exists?" company={data.company}>
    <div className="grid grid-cols-12 gap-10 h-full items-center">
      <div className="col-span-6 h-full max-h-[64vh]">
        <FrictionIllustration />
      </div>
      <div className="col-span-6 flex flex-col justify-center">
        <Editable
          as="h2"
          value={data.problem_headline}
          path="problem_headline"
          editable={editable}
          onEdit={onEdit}
          placeholder="Teams stitch six tools to ship one workflow."
          style={{
            fontSize: 'clamp(30px, 3.6vw, 60px)',
            fontWeight: 800,
            letterSpacing: -1.8,
            lineHeight: 1.05,
            color: INK,
          }}
        />
        <Editable
          value={data.problem_support}
          path="problem_support"
          editable={editable}
          onEdit={onEdit}
          placeholder="Every cycle ends in a fire drill. The cost is enormous, hidden, and ignored."
          style={{
            fontSize: 'clamp(15px, 1.3vw, 20px)',
            color: SUBTLE,
            marginTop: 18,
            lineHeight: 1.5,
            maxWidth: 580,
          }}
        />

        <div className="mt-10 grid grid-cols-2 gap-5">
          <div
            className="p-5 rounded-2xl"
            style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
          >
            <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
              QUANTIFIED IMPACT
            </div>
            <Editable
              value={data.problem_stat?.value}
              path="problem_stat.value"
              editable={editable}
              onEdit={onEdit}
              placeholder="$1.2T"
              style={{
                fontSize: 'clamp(36px, 4vw, 56px)',
                fontWeight: 900,
                letterSpacing: -2,
                color: ACCENT,
                marginTop: 6,
                lineHeight: 1,
              }}
            />
            <Editable
              value={data.problem_stat?.label}
              path="problem_stat.label"
              editable={editable}
              onEdit={onEdit}
              placeholder="lost annually to fragmented workflow."
              style={{ fontSize: 13, color: SUBTLE, marginTop: 8, lineHeight: 1.4 }}
            />
          </div>
          <div
            className="p-5 rounded-2xl"
            style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
          >
            <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
              AFFECTED SEGMENT
            </div>
            <Editable
              value={data.affected_segment}
              path="affected_segment"
              editable={editable}
              onEdit={onEdit}
              placeholder="Operations & finance teams at $5M–$500M companies."
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: INK,
                marginTop: 10,
                lineHeight: 1.4,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  </SlideFrame>
);

const Slide3Solution: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const before = data.before_state?.length
    ? data.before_state
    : ['Six tools', 'Manual sync', 'Reconciled by hand', 'Filed late'];
  const diffs = data.differentiators?.length
    ? data.differentiators
    : [
        'One source of truth',
        'Audit trail by design',
        'Open to the stack you already use',
      ];
  return (
    <SlideFrame index={2} total={6} label="Solution" question="Why is your solution better?" company={data.company}>
      <h2
        style={{
          fontSize: 'clamp(30px, 3.4vw, 56px)',
          fontWeight: 800,
          letterSpacing: -1.8,
          lineHeight: 1.05,
          color: INK,
          maxWidth: 1200,
        }}
      >
        Replace the patchwork with one workflow.
      </h2>

      <div className="mt-10">
        <BeforeAfterFlow />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6 flex-1 min-h-0">
        <div
          className="p-5 rounded-2xl"
          style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
        >
          <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 3, fontFamily: FONT_MONO }}>BEFORE</div>
          <ul className="mt-3 space-y-2">
            {before.map((b, i) => (
              <li key={i} className="flex items-center gap-3" style={{ fontSize: 15 }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: FAINT }} />
                <Editable
                  value={b}
                  path={`before_state.${i}`}
                  editable={editable}
                  onEdit={onEdit}
                  style={{
                    color: SUBTLE,
                    textDecoration: 'line-through',
                    textDecorationColor: '#D4D4D8',
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
        <div
          className="p-5 rounded-2xl"
          style={{
            background: PAPER,
            border: `1.5px solid ${ACCENT}`,
            boxShadow: '0 18px 40px -22px rgba(94,106,210,0.4)',
          }}
        >
          <div style={{ fontSize: 10, color: ACCENT, letterSpacing: 3, fontFamily: FONT_MONO, fontWeight: 700 }}>
            AFTER · DIFFERENTIATORS
          </div>
          <ul className="mt-3 space-y-2">
            {diffs.slice(0, 3).map((d, i) => (
              <li key={i} className="flex items-start gap-3" style={{ fontSize: 16 }}>
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
                  style={{ background: ACCENT, color: '#FFFFFF', fontSize: 11, fontWeight: 700 }}
                >
                  ✓
                </span>
                <Editable
                  value={d}
                  path={`differentiators.${i}`}
                  editable={editable}
                  onEdit={onEdit}
                  style={{ color: INK, fontWeight: 600, lineHeight: 1.4 }}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide4Traction: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const rev = data.revenue_series?.length
    ? data.revenue_series
    : [
        { label: 'Jan', v: 4 }, { label: 'Feb', v: 7 }, { label: 'Mar', v: 11 },
        { label: 'Apr', v: 16 }, { label: 'May', v: 24 }, { label: 'Jun', v: 34 },
      ];
  const users = data.user_series?.length
    ? data.user_series
    : [
        { label: 'Jan', v: 120 }, { label: 'Feb', v: 240 }, { label: 'Mar', v: 410 },
        { label: 'Apr', v: 680 }, { label: 'May', v: 1050 }, { label: 'Jun', v: 1640 },
      ];
  const milestones = data.milestones?.length
    ? data.milestones
    : [
        { date: 'Q1', label: '10 design partners' },
        { date: 'Q2', label: '$10K MRR' },
        { date: 'Q3', label: 'Enterprise tier shipped' },
        { date: 'Q4', label: 'First six-figure logo' },
      ];
  const logos = data.partner_logos?.length
    ? data.partner_logos
    : [
        { name: 'Acme Co.' }, { name: 'Nimbus' }, { name: 'Lattice' },
        { name: 'Northwind' },
      ];
  return (
    <SlideFrame index={3} total={6} label="Traction" question="What evidence exists?" company={data.company}>
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'MRR', value: fmtUSD(data.mrr_usd) },
          { label: 'Paying customers', value: fmtNum(data.paying_customers) },
          { label: 'MoM growth', value: fmtPct(data.growth_mom_pct), highlight: true },
          { label: 'NRR', value: fmtPct(data.nrr_pct) },
        ].map((s, i) => (
          <div
            key={i}
            className="p-4 rounded-xl"
            style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
          >
            <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
              {s.label.toUpperCase()}
            </div>
            <div
              style={{
                fontSize: 'clamp(26px, 2.6vw, 40px)',
                fontWeight: 900,
                letterSpacing: -1.5,
                marginTop: 6,
                color: s.highlight ? ACCENT : INK,
                lineHeight: 1,
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6 flex-1 min-h-0">
        <div
          className="p-5 rounded-2xl"
          style={{ background: PAPER, border: `1px solid ${HAIRLINE}` }}
        >
          <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
            REVENUE (K USD)
          </div>
          <div className="mt-3">
            <AreaChart data={rev} />
          </div>
        </div>
        <div
          className="p-5 rounded-2xl"
          style={{ background: PAPER, border: `1px solid ${HAIRLINE}` }}
        >
          <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
            ACTIVE USERS
          </div>
          <div className="mt-3">
            <AreaChart data={users} color={INK} />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 3, fontFamily: FONT_MONO, marginBottom: 12 }}>
          MILESTONES
        </div>
        <TimelineDots items={milestones} activeIdx={milestones.length - 1} />
      </div>

      <div className="mt-5">
        <div
          style={{
            fontSize: 10,
            color: SUBTLE,
            letterSpacing: 3,
            fontFamily: FONT_MONO,
            marginBottom: 10,
          }}
        >
          PARTNERS & CUSTOMERS
        </div>
        <div className="flex flex-wrap gap-2.5">
          {logos.slice(0, 6).map((l, i) => (
            <LogoChip key={i} name={l.name} initials={l.initials} />
          ))}
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide5Team: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const founders = data.founders?.length
    ? data.founders
    : [
        { name: '[Founder One]', role: 'CEO · Co-founder', bio: 'Prior: led product at [Co]. Shipped to N+ users.', initials: 'F1' },
        { name: '[Founder Two]', role: 'CTO · Co-founder', bio: 'Prior: principal eng at [Co]. ICPC world finalist.', initials: 'F2' },
      ];
  const axes = data.expertise_axes?.length ? data.expertise_axes : ['Product', 'Engineering', 'GTM', 'Design', 'Capital', 'Ops'];
  const values = data.expertise_values?.length ? data.expertise_values : [90, 95, 70, 65, 55, 80];
  const achievements = data.achievements?.length
    ? data.achievements
    : [
        { year: '2014', event: 'Met building open-source infra' },
        { year: '2020', event: 'Shipped category-defining product' },
        { year: '2025', event: 'Founded this company' },
      ];
  return (
    <SlideFrame index={4} total={6} label="Team" question="Why this team?" company={data.company}>
      <h2
        style={{
          fontSize: 'clamp(28px, 3.2vw, 52px)',
          fontWeight: 800,
          letterSpacing: -1.5,
          lineHeight: 1.05,
          color: INK,
        }}
      >
        Founder–market fit you can underwrite.
      </h2>

      <div className="mt-8 grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-7 grid grid-cols-2 gap-4">
          {founders.slice(0, 2).map((f, i) => (
            <div
              key={i}
              className="p-5 rounded-2xl"
              style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="rounded-2xl flex items-center justify-center font-extrabold"
                  style={{
                    width: 64,
                    height: 64,
                    background: ACCENT,
                    color: '#FFFFFF',
                    fontSize: 22,
                  }}
                >
                  {f.initials || f.name?.slice(0, 2)?.toUpperCase()}
                </div>
                <div>
                  <Editable
                    as="div"
                    value={f.name}
                    path={`founders.${i}.name`}
                    editable={editable}
                    onEdit={onEdit}
                    style={{ fontSize: 18, fontWeight: 700, color: INK, lineHeight: 1.1 }}
                  />
                  <Editable
                    value={f.role}
                    path={`founders.${i}.role`}
                    editable={editable}
                    onEdit={onEdit}
                    style={{ fontSize: 12, color: ACCENT, marginTop: 4, fontWeight: 600, letterSpacing: 1 }}
                  />
                </div>
              </div>
              <Editable
                value={f.bio}
                path={`founders.${i}.bio`}
                editable={editable}
                onEdit={onEdit}
                style={{ fontSize: 14, color: SUBTLE, marginTop: 14, lineHeight: 1.55 }}
              />
            </div>
          ))}
        </div>
        <div className="col-span-5 p-5 rounded-2xl flex flex-col" style={{ background: PAPER, border: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 3, fontFamily: FONT_MONO }}>
            EXPERTISE MAP
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0 mt-2">
            <ExpertiseRadar axes={axes} values={values} />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 3, fontFamily: FONT_MONO, marginBottom: 12 }}>
          JOURNEY
        </div>
        <TimelineDots items={achievements} activeIdx={achievements.length - 1} />
      </div>
    </SlideFrame>
  );
};

const Slide6Ask: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const uof = data.use_of_funds?.length
    ? data.use_of_funds
    : [
        { label: 'Engineering', pct: 45 },
        { label: 'GTM', pct: 30 },
        { label: 'Operations + Infra', pct: 15 },
        { label: 'Reserve', pct: 10 },
      ];
  const roadmap = data.roadmap?.length
    ? data.roadmap
    : [
        { quarter: 'Now', goal: 'Live · 60+ paying logos' },
        { quarter: '+6mo', goal: '$1M ARR' },
        { quarter: '+12mo', goal: 'Adjacent workflow live' },
        { quarter: '+24mo', goal: 'Category leader' },
      ];
  return (
    <SlideFrame index={5} total={6} label="The Ask" question="Why invest now?" company={data.company}>
      <div className="grid grid-cols-12 gap-10 h-full">
        <div className="col-span-7 flex flex-col">
          <div style={{ fontSize: 11, color: ACCENT, letterSpacing: 6, fontWeight: 700, fontFamily: FONT_MONO }}>
            RAISING
          </div>
          <Editable
            value={fmtUSD(data.ask_amount_usd)}
            path="ask_amount_usd"
            editable={editable}
            onEdit={onEdit}
            style={{
              fontSize: 'clamp(80px, 10vw, 184px)',
              fontWeight: 900,
              letterSpacing: -5,
              lineHeight: 0.95,
              color: ACCENT,
              marginTop: 16,
            }}
          />

          <Editable
            value={data.closing_line}
            path="closing_line"
            editable={editable}
            onEdit={onEdit}
            placeholder="A single memorable closing — what becomes true if this works."
            style={{
              fontSize: 'clamp(18px, 1.8vw, 28px)',
              color: INK,
              marginTop: 32,
              maxWidth: 720,
              lineHeight: 1.3,
              fontWeight: 600,
            }}
          />

          <div className="mt-auto grid grid-cols-3 gap-4 pt-10">
            <div
              className="p-4 rounded-xl"
              style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
            >
              <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
                RUNWAY
              </div>
              <div
                style={{
                  fontSize: 'clamp(28px, 3vw, 44px)',
                  fontWeight: 900,
                  marginTop: 6,
                  color: INK,
                  letterSpacing: -1,
                  lineHeight: 1,
                }}
              >
                {data.runway_months ?? '—'}
                <span style={{ fontSize: 14, color: SUBTLE, fontWeight: 600, marginLeft: 8 }}>
                  months
                </span>
              </div>
            </div>
            <div
              className="p-4 rounded-xl"
              style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
            >
              <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
                MOMENTUM
              </div>
              <div
                style={{
                  fontSize: 'clamp(28px, 3vw, 44px)',
                  fontWeight: 900,
                  marginTop: 6,
                  color: ACCENT,
                  letterSpacing: -1,
                  lineHeight: 1,
                }}
              >
                {fmtPct(data.growth_mom_pct)}
                <span style={{ fontSize: 12, color: SUBTLE, fontWeight: 600, marginLeft: 8 }}>
                  MoM
                </span>
              </div>
            </div>
            <div
              className="p-4 rounded-xl"
              style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
            >
              <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>
                CONTACT
              </div>
              <Editable
                value={data.contact}
                path="contact"
                editable={editable}
                onEdit={onEdit}
                placeholder="founders@company.com"
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  marginTop: 8,
                  color: INK,
                  fontFamily: FONT_MONO,
                }}
              />
            </div>
          </div>
        </div>
        <div className="col-span-5 flex flex-col gap-6">
          <div className="p-5 rounded-2xl" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
            <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 3, fontFamily: FONT_MONO }}>
              USE OF FUNDS
            </div>
            <div className="mt-4">
              <Donut data={uof} />
            </div>
          </div>
          <div className="p-5 rounded-2xl flex-1" style={{ background: PAPER, border: `1px solid ${HAIRLINE}` }}>
            <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 3, fontFamily: FONT_MONO, marginBottom: 16 }}>
              ROADMAP
            </div>
            <div className="space-y-4">
              {roadmap.slice(0, 4).map((r, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div
                    className="flex-shrink-0 rounded-md flex items-center justify-center"
                    style={{
                      width: 52,
                      height: 28,
                      background: i === 0 ? ACCENT : SURFACE_2,
                      color: i === 0 ? '#FFFFFF' : INK,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      fontFamily: FONT_MONO,
                    }}
                  >
                    {(r.quarter ?? '—').toString().toUpperCase() || '—'}
                  </div>
                  <Editable
                    value={r.goal}
                    path={`roadmap.${i}.goal`}
                    editable={editable}
                    onEdit={onEdit}
                    style={{ fontSize: 15, color: INK, lineHeight: 1.4, fontWeight: 500, paddingTop: 3 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SlideFrame>
  );
};

// ─────────────────────────────────────────────────────────────────
// Deck shell — keyboard nav, dot pagination, motion transitions
// ─────────────────────────────────────────────────────────────────

const SLIDES: React.FC<DeckProps>[] = [
  Slide1Company,
  Slide2Problem,
  Slide3Solution,
  Slide4Traction,
  Slide5Team,
  Slide6Ask,
];

export const MinimalSeedDeckApp: React.FC<{
  initialData?: MinimalSeedData;
  editable?: boolean;
}> = ({ initialData = SAMPLE_DATA, editable = true }) => {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<MinimalSeedData>(initialData);
  const reduced = useReducedMotion();

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, SLIDES.length - 1)), []);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  const onEdit = useCallback((path: string, value: string) => {
    setData((prev) => {
      const next = structuredClone(prev) as any;
      const parts = path.split('.');
      if (parts.some(p => p === '__proto__' || p === 'constructor' || p === 'prototype')) return prev;
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        const isArrKey = !isNaN(Number(parts[i + 1]));
        if (cur[k] == null) cur[k] = isArrKey ? [] : {};
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  }, []);

  const Slide = SLIDES[index];

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 lg:p-10"
      style={{ background: '#F4F4F6', fontFamily: FONT }}
    >
      <div
        className="w-full max-w-[1400px] rounded-3xl overflow-hidden border bg-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.18)]"
        style={{ borderColor: HAIRLINE }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={reduced ? false : { opacity: 0, y: 20, scale: 0.99 }}
            animate={reduced ? {} : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? {} : { opacity: 0, y: -20, scale: 0.99 }}
            transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Slide data={data} editable={editable} onEdit={onEdit} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Nav */}
      <div className="w-full max-w-[1400px] mt-6 flex items-center justify-between" style={{ color: INK }}>
        <button
          onClick={prev}
          disabled={index === 0}
          className="px-5 py-2.5 rounded-full border bg-white hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm font-semibold"
          style={{ borderColor: HAIRLINE }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 18 L9 12 L15 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Previous
        </button>

        <div className="flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className="transition-all"
              style={{
                width: i === index ? 32 : 8,
                height: 8,
                borderRadius: 999,
                background: i === index ? ACCENT : '#D4D4D4',
              }}
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={index === SLIDES.length - 1}
          className="px-5 py-2.5 rounded-full border bg-white hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm font-semibold"
          style={{ borderColor: HAIRLINE }}
        >
          Next
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M9 6 L15 12 L9 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// SAMPLE_DATA — replace at runtime with the merged Axal VC row shape:
//   { ...projects, ...financial_models, ...metrics_snapshots,
//     ...rounds, founders: [...], milestones: [...] }
// produced by cloudflare-worker/src/routes/decks.ts heuristicSlides().
// Several JSON columns below depend on the migration in earlier
// Prompt MD (DECK_AUTOFILL_AUDIT.md + 00xx_deck_autofill_fields.sql).
// ─────────────────────────────────────────────────────────────────

export const SAMPLE_DATA: MinimalSeedData = {
  company: '[Company]',
  domain: 'company.com',
  one_liner: 'The default way operations teams ship cross-system workflows.',
  value_prop:
    'Collapse six tools into one workflow with a built-in audit trail — without changing the systems you already run.',

  problem_headline: 'Teams stitch six tools to ship one workflow.',
  problem_support:
    'Every cycle ends in a fire drill across systems. The cost is enormous, hidden, and almost universally ignored.',
  problem_stat: { value: '$1.2T', label: 'lost annually to fragmented workflow.' },
  affected_segment: 'Operations & finance teams at $5M–$500M companies.',

  before_state: ['Six tools', 'Manual sync', 'Reconciled by hand', 'Filed late'],
  after_state: ['One workflow', 'Auto-synced', 'Audited live', 'Done in seconds'],
  differentiators: [
    'One source of truth',
    'Audit trail by design',
    'Open to the systems you already use',
  ],

  mrr_usd: 34_000,
  paying_customers: 64,
  growth_mom_pct: 41,
  nrr_pct: 122,
  revenue_series: [
    { label: 'Jan', v: 4 }, { label: 'Feb', v: 7 }, { label: 'Mar', v: 11 },
    { label: 'Apr', v: 16 }, { label: 'May', v: 24 }, { label: 'Jun', v: 34 },
  ],
  user_series: [
    { label: 'Jan', v: 120 }, { label: 'Feb', v: 240 }, { label: 'Mar', v: 410 },
    { label: 'Apr', v: 680 }, { label: 'May', v: 1050 }, { label: 'Jun', v: 1640 },
  ],
  milestones: [
    { date: 'Q1', label: '10 design partners signed' },
    { date: 'Q2', label: 'Crossed $10K MRR' },
    { date: 'Q3', label: 'Enterprise tier shipped' },
    { date: 'Q4', label: 'First six-figure logo' },
  ],
  partner_logos: [
    { name: 'Acme Co.' }, { name: 'Nimbus' }, { name: 'Lattice' },
    { name: 'Northwind' }, { name: 'Atlas Labs' }, { name: 'Verdant' },
  ],

  founders: [
    {
      name: 'Founder One',
      role: 'CEO · Co-founder',
      bio: 'Prior: led product at Stripe. Shipped infrastructure used by 4M+ businesses. Forbes 30 Under 30.',
      initials: 'F1',
    },
    {
      name: 'Founder Two',
      role: 'CTO · Co-founder',
      bio: 'Prior: principal engineer at Linear. Designed systems shipping to 50K+ teams. ICPC world finalist.',
      initials: 'F2',
    },
  ],
  expertise_axes: ['Product', 'Engineering', 'GTM', 'Design', 'Capital', 'Ops'],
  expertise_values: [90, 95, 70, 65, 55, 80],
  achievements: [
    { year: '2014', event: 'Met building open-source infra' },
    { year: '2020', event: 'Shipped a category-defining product' },
    { year: '2025', event: 'Founded this company' },
  ],

  ask_amount_usd: 3_500_000,
  runway_months: 24,
  use_of_funds: [
    { label: 'Engineering', pct: 45 },
    { label: 'GTM', pct: 30 },
    { label: 'Operations + Infra', pct: 15 },
    { label: 'Reserve', pct: 10 },
  ],
  roadmap: [
    { quarter: 'Now', goal: 'Live · 60+ paying logos' },
    { quarter: '+6mo', goal: '$1M ARR' },
    { quarter: '+12mo', goal: 'Adjacent workflow live' },
    { quarter: '+24mo', goal: 'Category leader' },
  ],
  closing_line:
    'If we get this right, the next generation of operating teams stops fighting their tools and starts shipping outcomes.',
  contact: 'founders@company.com',
};

export default MinimalSeedDeckApp;

// ─────────────────────────────────────────────────────────────────
// Registry adapter — exposes `MinimalSeedDeckApp` as a
// `DeckProps`-compatible component for `frontend/src/decks/templates/
// index.ts`. Accepts the registry's `data: DeckData` (Record<string,
// any>) and casts to the standalone's typed `MinimalSeedData`; falls
// back to SAMPLE_DATA when the row is empty so the picker preview
// always has content.
//
// Note: the standalone shell owns its own slide nav (prev/next +
// keyboard) and renders one slide at a time, so this wrapper is
// intended for the live builder/picker preview. Print/PDF export
// continues to use the `minimal_seed` registry entry, which renders
// all six slides as fixed 1920×1080 `data-slide-frame=""` panels for
// `PitchDeckPrintPage.jsx`.
// ─────────────────────────────────────────────────────────────────

// Multi-slide adapter — renders all 6 slides inside `<Slide16x9>`
// frames (each 1920×1080 with `data-slide-frame=""` + `pageBreakAfter`)
// so `PitchDeckPrintPage`'s keyboard nav, fullscreen viewer, and
// `window.print()` PDF export work the same way they do for every
// other template in the registry. The single-screen viewer experience
// (prev/next + dot pagination + motion) stays available via the
// `MinimalSeedDeckApp` default export for any caller that wants it
// directly.
// Shape-aware merge — the slides call `.map` on `team`, `milestones`,
// `roadmap`, `use_of_funds` and read `.value` / `.label` off
// `problem_stat`. If Axal VC's `buildTemplateData` (or any legacy
// caller) passes a string where the slide expects an array, the
// adapter would otherwise crash inside the ThumbnailBoundary. Drop
// any incoming field whose runtime type doesn't match the sample
// (array-vs-non-array, object-vs-non-object) — the sample default
// then wins for that field only.
function mergeShape(sample: MinimalSeedData, input: Record<string, any>): MinimalSeedData {
  const out: any = { ...sample };
  for (const k of Object.keys(input)) {
    const sv = (sample as any)[k];
    const iv = input[k];
    if (iv == null) continue;
    if (typeof iv === 'string' && iv.trim() === '') continue;
    if (Array.isArray(iv) && iv.length === 0) continue;
    if (Array.isArray(sv) && !Array.isArray(iv)) continue;
    if (sv != null && typeof sv === 'object' && !Array.isArray(sv) &&
        (typeof iv !== 'object' || Array.isArray(iv))) continue;
    out[k] = iv;
  }
  return out;
}

export const Deck_minimal_seed_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const seed: MinimalSeedData = (data && Object.keys(data).length > 0)
    ? mergeShape(SAMPLE_DATA, data as Record<string, any>)
    : SAMPLE_DATA;
  return (
    <>
      {SLIDES.map((Slide, i) => (
        <Slide16x9 key={i} bg="#FFFFFF" ink="#0F172A">
          <Slide data={seed} editable={editable} onEdit={onEdit} />
        </Slide16x9>
      ))}
    </>
  );
};
