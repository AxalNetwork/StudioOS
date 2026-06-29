/**
 * partnership_bd_app.tsx
 *
 * Partnership & Business Development presentation — 12 slides,
 * executive consulting tone (McKinsey / Bain / Accenture / AWS).
 *
 * Self-contained React + TypeScript + Tailwind + Framer Motion app.
 * Every diagram is hand-built SVG — no image assets.
 * Binds to Axal VC platform rows via `heuristicSlides()` in
 * `cloudflare-worker/src/routes/decks.ts` (mapping documented above
 * SAMPLE_DATA at the bottom of this file).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Slide16x9, type DeckProps as RegistryDeckProps, BrandProvider } from '../DeckBase';

/* ───────────────────────────── types ────────────────────────────── */

export type PartnershipData = {
  meta: {
    presenter_org: string;
    partner_org: string;
    presenter_logo_mark: string;
    partner_logo_mark: string;
    document_label: string; // "Strategic Partnership Proposal"
    confidential_label: string;
    prepared_for: string;
    prepared_by: string;
    presented_on: string; // human-readable
  };
  executive_summary: {
    headline: string;
    sub: string;
    three_pillars: { title: string; detail: string }[];
    headline_value_usd: number;
    headline_value_label: string;
    horizon_months: number;
  };
  industry_context: {
    headline: string;
    sub: string;
    shifts: { title: string; detail: string; trend_pct: number }[];
    why_now: string[];
  };
  partner_challenges: {
    headline: string;
    sub: string;
    challenges: { area: string; pain: string; cost_usd: number }[];
  };
  shared_opportunity: {
    headline: string;
    sub: string;
    quadrants: { title: string; partner_gain: string; presenter_gain: string }[];
    addressable_value_usd: number;
  };
  solution_overview: {
    headline: string;
    sub: string;
    partner_responsibilities: string[];
    presenter_responsibilities: string[];
    joint_responsibilities: string[];
  };
  product_platform: {
    headline: string;
    sub: string;
    layers: { name: string; detail: string }[];
    integration_points: { name: string; protocol: string }[];
  };
  business_benefits: {
    headline: string;
    sub: string;
    kpis: { label: string; value: string; delta: string; note: string }[];
    impact_categories: { category: string; year1_usd: number; year3_usd: number }[];
  };
  implementation_roadmap: {
    headline: string;
    sub: string;
    phases: {
      name: string;
      duration_label: string;
      objectives: string[];
      deliverables: string[];
      success_metric: string;
    }[];
  };
  case_studies: {
    headline: string;
    sub: string;
    studies: {
      client: string;
      sector: string;
      outcome: string;
      metric_label: string;
      metric_value: string;
    }[];
    proof_points: { label: string; value: string }[];
  };
  commercial_structure: {
    headline: string;
    sub: string;
    model_label: string;
    economics: { line: string; pct: number; note: string }[];
    pricing_tiers: { tier: string; access: string; annual_usd: number }[];
    terms_summary: string[];
  };
  governance_risk: {
    headline: string;
    sub: string;
    bodies: { name: string; cadence: string; members: string; mandate: string }[];
    risks: { risk: string; severity: 'Low' | 'Med' | 'High'; mitigation: string }[];
    certifications: string[];
  };
  next_steps: {
    headline: string;
    sub: string;
    pilot: { name: string; duration_label: string; investment_usd: number; success_criteria: string[] };
    timeline: { week: string; milestone: string }[];
    cta_line: string;
    contact_name: string;
    contact_email: string;
  };
};

/* ───────────────────────────── tokens ───────────────────────────── */

const C = {
  ink: '#0B1F3A',
  inkSoft: '#1E3A5F',
  navy: '#0E3B6B',
  navyDeep: '#082241',
  paper: '#FFFFFF',
  paperWarm: '#F6F8FB',
  paperDim: '#EDF1F7',
  line: '#D9E0EA',
  lineSoft: '#E8ECF2',
  text: '#0B1F3A',
  textSoft: '#445268',
  textMuted: '#7A879E',
  accent: '#1F6FEB', // executive blue
  accentSoft: '#DBE7FB',
  gold: '#B8862A',
  goldSoft: '#F4E9CC',
  emerald: '#0F8A5F',
  emeraldSoft: '#D5EFE5',
  amber: '#C8821D',
  amberSoft: '#FBEACD',
  rose: '#B0314A',
  roseSoft: '#F8DBE2',
};

const fontSerif = '"Source Serif Pro", "Source Serif 4", Georgia, "Times New Roman", serif';
const fontSans = '"Inter", "Helvetica Neue", Arial, system-ui, sans-serif';
const fontMono = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

/* ───────────────────────────── utils ────────────────────────────── */

const usdShort = (n: number): string => {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
};

const setIn = <T,>(obj: T, path: (string | number)[], value: unknown): T => {
  // Prototype-pollution guard: reject __proto__/constructor/prototype path
  // segments before any nested write (CodeQL js/prototype-polluting-function).
  if (path.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return obj;
  const next = structuredClone(obj) as Record<string, unknown>;
  let cur: Record<string, unknown> = next as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i] as string] as Record<string, unknown>;
  cur[path[path.length - 1] as string] = value;
  return next as T;
};

/* ───────────────────────────── primitives ───────────────────────── */

const SlideFrame: React.FC<{
  children: React.ReactNode;
  step: number;
  total: number;
  section: string;
  bg?: string;
}> = ({ children, step, total, section, bg = C.paper }) => (
  <div
    className="relative w-full h-full overflow-hidden"
    style={{ background: bg, color: C.text, fontFamily: fontSans }}
  >
    {/* top rail */}
    <div
      className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-12 text-[10px] tracking-[0.22em] uppercase"
      style={{ color: C.textMuted, borderBottom: `1px solid ${C.lineSoft}` }}
    >
      <span style={{ fontFamily: fontSerif, fontStyle: 'italic', letterSpacing: '0.1em' }}>
        {section}
      </span>
      <span style={{ fontFamily: fontMono }}>
        {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
    <div className="absolute inset-x-0 top-12 bottom-10 px-12 py-8">{children}</div>
    {/* bottom rail */}
    <div
      className="absolute bottom-0 left-0 right-0 h-10 flex items-center justify-between px-12 text-[10px]"
      style={{ color: C.textMuted, borderTop: `1px solid ${C.lineSoft}` }}
    >
      <span>Confidential · Prepared for executive review</span>
      <span style={{ fontFamily: fontMono }}>{section.toUpperCase()}</span>
    </div>
  </div>
);

const Editable: React.FC<{
  value: string;
  path: (string | number)[];
  onEdit: (p: (string | number)[], v: string) => void;
  multiline?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, path, onEdit, multiline, className, style }) => (
  <span
    contentEditable
    suppressContentEditableWarning
    onBlur={(e) => onEdit(path, (multiline ? e.currentTarget.innerText : e.currentTarget.textContent) || '')}
    className={`outline-none focus:bg-blue-50/60 rounded-sm px-0.5 ${className ?? ''}`}
    style={style}
  >
    {value}
  </span>
);

const SectionLabel: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.accent }) => (
  <div className="flex items-center gap-2 mb-3">
    <div className="h-px w-8" style={{ background: color }} />
    <span className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color }}>
      {children}
    </span>
  </div>
);

const SlideTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1
    className="leading-[1.08] tracking-[-0.015em]"
    style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '36px', color: C.ink }}
  >
    {children}
  </h1>
);

const SlideSub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-3 text-[14px] leading-snug max-w-[760px]" style={{ color: C.textSoft }}>
    {children}
  </p>
);

const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  tone?: 'plain' | 'soft' | 'accent';
  style?: React.CSSProperties;
}> = ({ children, className, tone = 'plain', style }) => {
  const bg = tone === 'soft' ? C.paperWarm : tone === 'accent' ? C.accentSoft : '#fff';
  const border = tone === 'accent' ? C.accentSoft : C.line;
  return (
    <div
      className={`rounded-lg ${className ?? ''}`}
      style={{ background: bg, border: `1px solid ${border}`, ...style }}
    >
      {children}
    </div>
  );
};

const KpiTile: React.FC<{
  label: string;
  value: string;
  delta?: string;
  note?: string;
  tone?: 'accent' | 'emerald' | 'gold' | 'neutral';
}> = ({ label, value, delta, note, tone = 'accent' }) => {
  const accentMap = { accent: C.accent, emerald: C.emerald, gold: C.gold, neutral: C.textSoft };
  const acc = accentMap[tone];
  return (
    <Card className="p-5 h-full flex flex-col justify-between">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
          {label}
        </div>
        <div
          className="mt-2 leading-none"
          style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '32px', color: C.ink }}
        >
          {value}
        </div>
        {delta && (
          <div className="mt-2 text-[11px] font-medium" style={{ color: acc, fontFamily: fontMono }}>
            {delta}
          </div>
        )}
      </div>
      {note && (
        <div className="mt-3 text-[11px]" style={{ color: C.textMuted }}>
          {note}
        </div>
      )}
    </Card>
  );
};

/* ───────────────────────────── SVG diagrams ─────────────────────── */

/** Cover hero: two arcs converging on a shared node */
const HeroConvergence: React.FC<{ left: string; right: string }> = ({ left, right }) => (
  <svg viewBox="0 0 600 360" className="w-full h-full">
    <defs>
      <linearGradient id="cov-l" x1="0" x2="1">
        <stop offset="0" stopColor={C.accent} stopOpacity="0.15" />
        <stop offset="1" stopColor={C.accent} stopOpacity="0.6" />
      </linearGradient>
      <linearGradient id="cov-r" x1="1" x2="0">
        <stop offset="0" stopColor={C.gold} stopOpacity="0.6" />
        <stop offset="1" stopColor={C.gold} stopOpacity="0.15" />
      </linearGradient>
    </defs>
    {/* arcs */}
    {[0, 1, 2, 3, 4].map((i) => (
      <path
        key={`l${i}`}
        d={`M40,${80 + i * 36} Q220,${180 + (i - 2) * 10} 300,180`}
        fill="none"
        stroke="url(#cov-l)"
        strokeWidth={1.4}
      />
    ))}
    {[0, 1, 2, 3, 4].map((i) => (
      <path
        key={`r${i}`}
        d={`M560,${80 + i * 36} Q380,${180 + (i - 2) * 10} 300,180`}
        fill="none"
        stroke="url(#cov-r)"
        strokeWidth={1.4}
      />
    ))}
    {/* left node */}
    <circle cx="40" cy="180" r="32" fill={C.accent} />
    <text x="40" y="186" textAnchor="middle" fontFamily={fontSerif} fontWeight={700} fontSize="22" fill="#fff">
      {left}
    </text>
    <text x="40" y="234" textAnchor="middle" fontFamily={fontSans} fontSize="10" fill={C.textMuted}>
      Operator
    </text>
    {/* right node */}
    <circle cx="560" cy="180" r="32" fill={C.gold} />
    <text x="560" y="186" textAnchor="middle" fontFamily={fontSerif} fontWeight={700} fontSize="22" fill="#fff">
      {right}
    </text>
    <text x="560" y="234" textAnchor="middle" fontFamily={fontSans} fontSize="10" fill={C.textMuted}>
      Partner
    </text>
    {/* center value node */}
    <circle cx="300" cy="180" r="56" fill="none" stroke={C.ink} strokeOpacity={0.18} />
    <circle cx="300" cy="180" r="40" fill={C.ink} />
    <text x="300" y="174" textAnchor="middle" fontFamily={fontSerif} fontStyle="italic" fontSize="11" fill="#9CB1CC">
      Joint value
    </text>
    <text x="300" y="194" textAnchor="middle" fontFamily={fontSerif} fontWeight={700} fontSize="20" fill="#fff">
      Created
    </text>
    {/* dashed dividers */}
    <line x1="120" y1="320" x2="480" y2="320" stroke={C.line} strokeDasharray="2 4" />
  </svg>
);

/** Industry shifts chart — bar + trendline */
const IndustryShiftsChart: React.FC<{ shifts: { title: string; trend_pct: number }[] }> = ({ shifts }) => {
  const w = 540;
  const h = 220;
  const bw = (w - 40) / shifts.length - 20;
  return (
    <svg viewBox={`0 0 ${w} ${h + 60}`} className="w-full h-full">
      <line x1="0" y1={h} x2={w} y2={h} stroke={C.line} />
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1="0" y1={h - (g / 100) * h} x2={w} y2={h - (g / 100) * h} stroke={C.lineSoft} />
          <text x={w} y={h - (g / 100) * h - 2} textAnchor="end" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
            {g}%
          </text>
        </g>
      ))}
      {shifts.map((s, i) => {
        const x = 20 + i * ((w - 40) / shifts.length);
        const bh = (s.trend_pct / 100) * h;
        return (
          <g key={i}>
            <rect x={x} y={h - bh} width={bw} height={bh} rx={3} fill={C.accent} />
            <text
              x={x + bw / 2}
              y={h - bh - 6}
              textAnchor="middle"
              fontFamily={fontMono}
              fontWeight={600}
              fontSize="10"
              fill={C.ink}
            >
              +{s.trend_pct}%
            </text>
            <text
              x={x + bw / 2}
              y={h + 18}
              textAnchor="middle"
              fontFamily={fontSans}
              fontSize="10"
              fill={C.textSoft}
            >
              {((s.title ?? '').length > 22 ? (s.title ?? '').slice(0, 21) + '…' : (s.title ?? ''))}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/** 2x2 opportunity quadrants */
const OpportunityQuadrants: React.FC<{ quadrants: { title: string }[] }> = ({ quadrants }) => (
  <svg viewBox="0 0 520 360" className="w-full h-full">
    <rect x="20" y="20" width="240" height="160" fill={C.accentSoft} rx="6" />
    <rect x="270" y="20" width="240" height="160" fill={C.goldSoft} rx="6" />
    <rect x="20" y="190" width="240" height="160" fill={C.emeraldSoft} rx="6" />
    <rect x="270" y="190" width="240" height="160" fill={C.paperWarm} rx="6" />
    {quadrants.slice(0, 4).map((q, i) => {
      const xs = [40, 290, 40, 290];
      const ys = [50, 50, 220, 220];
      return (
        <g key={i} transform={`translate(${xs[i]}, ${ys[i]})`}>
          <text fontFamily={fontMono} fontSize="9" fill={C.textMuted} letterSpacing="0.14em">
            Q{i + 1}
          </text>
          <text y="22" fontFamily={fontSerif} fontWeight={600} fontSize="14" fill={C.ink}>
            {((q.title ?? '').length > 28 ? (q.title ?? '').slice(0, 27) + '…' : (q.title ?? ''))}
          </text>
        </g>
      );
    })}
    {/* axes */}
    <line x1="265" y1="20" x2="265" y2="350" stroke={C.ink} strokeOpacity="0.25" />
    <line x1="20" y1="185" x2="510" y2="185" stroke={C.ink} strokeOpacity="0.25" />
    <text x="265" y="14" textAnchor="middle" fontFamily={fontSans} fontSize="9" fill={C.textMuted}>
      Strategic value →
    </text>
    <text
      x="14"
      y="185"
      textAnchor="middle"
      fontFamily={fontSans}
      fontSize="9"
      fill={C.textMuted}
      transform="rotate(-90, 14, 185)"
    >
      Ease of execution →
    </text>
  </svg>
);

/** Ecosystem diagram — partner / presenter / customer node graph */
const EcosystemDiagram: React.FC<{ presenter: string; partner: string }> = ({ presenter, partner }) => (
  <svg viewBox="0 0 600 360" className="w-full h-full">
    {/* connections */}
    <line x1="120" y1="180" x2="480" y2="180" stroke={C.accent} strokeWidth={2} />
    <line x1="120" y1="180" x2="300" y2="60" stroke={C.gold} strokeWidth={2} />
    <line x1="480" y1="180" x2="300" y2="60" stroke={C.gold} strokeWidth={2} />
    <line x1="120" y1="180" x2="300" y2="310" stroke={C.emerald} strokeWidth={2} />
    <line x1="480" y1="180" x2="300" y2="310" stroke={C.emerald} strokeWidth={2} />

    {/* labels on connections */}
    <text x="300" y="170" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
      Joint roadmap & IP
    </text>
    <text x="200" y="120" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
      Customer access
    </text>
    <text x="400" y="120" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
      Distribution
    </text>
    <text x="200" y="260" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
      Platform
    </text>
    <text x="400" y="260" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
      Implementation
    </text>

    {/* nodes */}
    {[
      { x: 120, y: 180, fill: C.accent, label: presenter, sub: 'Operator' },
      { x: 480, y: 180, fill: C.gold, label: partner, sub: 'Partner' },
      { x: 300, y: 60, fill: C.ink, label: 'Customers', sub: 'End demand' },
      { x: 300, y: 310, fill: C.emerald, label: 'Delivery', sub: 'Joint ops' },
    ].map((n, i) => (
      <g key={i}>
        <circle cx={n.x} cy={n.y} r="46" fill={n.fill} />
        <text x={n.x} y={n.y - 2} textAnchor="middle" fontFamily={fontSerif} fontWeight={600} fontSize="13" fill="#fff">
          {n.label}
        </text>
        <text x={n.x} y={n.y + 14} textAnchor="middle" fontFamily={fontSans} fontSize="9" fill="#fff" opacity="0.8">
          {n.sub}
        </text>
      </g>
    ))}
  </svg>
);

/** Architecture/integration stack diagram */
const ArchitectureStack: React.FC<{ layers: { name: string; detail: string }[]; integrations: { name: string }[] }> = ({
  layers,
  integrations,
}) => {
  const w = 560;
  const h = 320;
  const rowH = (h - 40) / layers.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
      {layers.map((l, i) => {
        const y = 20 + i * rowH;
        const tone = i === 0 ? C.gold : i === layers.length - 1 ? C.accent : C.ink;
        return (
          <g key={i}>
            <rect x="20" y={y} width={w - 200} height={rowH - 8} rx="6" fill={tone} fillOpacity={i === 0 ? 0.12 : 0.08} stroke={tone} strokeOpacity="0.45" />
            <text x="36" y={y + 22} fontFamily={fontSerif} fontWeight={600} fontSize="13" fill={C.ink}>
              {l.name}
            </text>
            <text x="36" y={y + 38} fontFamily={fontSans} fontSize="10" fill={C.textSoft}>
              {((l.detail ?? '').length > 70 ? (l.detail ?? '').slice(0, 69) + '…' : (l.detail ?? ''))}
            </text>
          </g>
        );
      })}
      {/* integrations rail */}
      <rect x={w - 170} y="20" width="150" height={h - 40} rx="6" fill={C.paperWarm} stroke={C.line} />
      <text x={w - 95} y="40" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
        INTEGRATIONS
      </text>
      {integrations.slice(0, 6).map((ig, i) => (
        <g key={i} transform={`translate(${w - 160}, ${56 + i * 32})`}>
          <rect width="130" height="24" rx="4" fill="#fff" stroke={C.line} />
          <text x="12" y="16" fontFamily={fontSans} fontWeight={500} fontSize="10" fill={C.ink}>
            {ig.name}
          </text>
        </g>
      ))}
    </svg>
  );
};

/** Stacked impact chart — year 1 vs year 3 by category */
const ImpactChart: React.FC<{ categories: { category: string; year1_usd: number; year3_usd: number }[] }> = ({ categories }) => {
  const w = 540;
  const h = 220;
  const max = Math.max(...categories.flatMap((c) => [c.year1_usd, c.year3_usd]));
  const bw = (w - 40) / categories.length / 2 - 8;
  return (
    <svg viewBox={`0 0 ${w} ${h + 50}`} className="w-full h-full">
      <line x1="20" y1={h} x2={w - 20} y2={h} stroke={C.line} />
      {categories.map((c, i) => {
        const groupX = 30 + i * ((w - 40) / categories.length);
        const h1 = (c.year1_usd / max) * h;
        const h3 = (c.year3_usd / max) * h;
        return (
          <g key={i}>
            <rect x={groupX} y={h - h1} width={bw} height={h1} rx={3} fill={C.accent} fillOpacity={0.5} />
            <rect x={groupX + bw + 6} y={h - h3} width={bw} height={h3} rx={3} fill={C.accent} />
            <text x={groupX + bw + 3} y={h + 18} textAnchor="middle" fontFamily={fontSans} fontSize="10" fill={C.textSoft}>
              {c.category}
            </text>
            <text x={groupX + bw / 2} y={h - h1 - 4} textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.ink}>
              {usdShort(c.year1_usd)}
            </text>
            <text x={groupX + bw + 6 + bw / 2} y={h - h3 - 4} textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.ink}>
              {usdShort(c.year3_usd)}
            </text>
          </g>
        );
      })}
      <g transform={`translate(20, ${h + 36})`}>
        <rect width="12" height="10" fill={C.accent} fillOpacity={0.5} />
        <text x="18" y="9" fontFamily={fontSans} fontSize="10" fill={C.textSoft}>
          Year 1
        </text>
        <rect x="70" width="12" height="10" fill={C.accent} />
        <text x="88" y="9" fontFamily={fontSans} fontSize="10" fill={C.textSoft}>
          Year 3
        </text>
      </g>
    </svg>
  );
};

/** Gantt-style roadmap */
const RoadmapGantt: React.FC<{ phases: { name: string; duration_label: string }[] }> = ({ phases }) => {
  const w = 720;
  const h = 60 + phases.length * 56;
  const trackW = w - 200;
  const segW = trackW / phases.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
      {/* axis */}
      <line x1="180" y1="36" x2={w - 20} y2="36" stroke={C.line} />
      {phases.map((p, i) => (
        <g key={`m-${i}`}>
          <line x1={180 + segW * i} y1="30" x2={180 + segW * i} y2={h - 20} stroke={C.lineSoft} />
          <text x={180 + segW * i + segW / 2} y="22" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
            {p.duration_label}
          </text>
        </g>
      ))}
      {phases.map((p, i) => {
        const y = 56 + i * 56;
        return (
          <g key={`b-${i}`}>
            <text x="20" y={y + 16} fontFamily={fontSerif} fontWeight={600} fontSize="13" fill={C.ink}>
              Phase {i + 1}
            </text>
            <text x="20" y={y + 32} fontFamily={fontSans} fontSize="10" fill={C.textSoft}>
              {p.name}
            </text>
            <rect x={180 + segW * i + 4} y={y} width={segW - 8} height={28} rx="4" fill={C.accent} fillOpacity={0.85} />
            <text
              x={180 + segW * i + segW / 2}
              y={y + 18}
              textAnchor="middle"
              fontFamily={fontSans}
              fontWeight={600}
              fontSize="11"
              fill="#fff"
            >
              {p.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/** Revenue flow / waterfall diagram */
const RevenueFlow: React.FC<{ economics: { line: string; pct: number }[] }> = ({ economics }) => {
  const w = 560;
  const h = 240;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
      {/* source bar */}
      <rect x="20" y="40" width="120" height={h - 80} rx="6" fill={C.ink} />
      <text x="80" y={h / 2 - 6} textAnchor="middle" fontFamily={fontSerif} fontWeight={600} fontSize="14" fill="#fff">
        Customer
      </text>
      <text x="80" y={h / 2 + 12} textAnchor="middle" fontFamily={fontSerif} fontWeight={600} fontSize="14" fill="#fff">
        revenue
      </text>
      {/* flows */}
      {economics.map((e, i) => {
        const yStart = 40 + (i * (h - 80)) / economics.length;
        const yEnd = 40 + ((h - 80) / economics.length) * (i + 1);
        const targetY = 40 + i * 50 + 20;
        return (
          <g key={i}>
            <path
              d={`M140,${yStart} C220,${yStart} 260,${targetY - 18} 320,${targetY - 18} L320,${targetY + 18} C260,${targetY + 18} 220,${yEnd} 140,${yEnd} Z`}
              fill={C.accent}
              fillOpacity={0.18 + i * 0.05}
            />
            <rect x="320" y={targetY - 18} width="200" height="36" rx="6" fill={C.paperWarm} stroke={C.line} />
            <text x="332" y={targetY - 4} fontFamily={fontSerif} fontWeight={600} fontSize="12" fill={C.ink}>
              {e.line}
            </text>
            <text x="332" y={targetY + 12} fontFamily={fontMono} fontSize="10" fill={C.textSoft}>
              {e.pct}% of net
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/** Risk register heatmap */
const RiskHeatmap: React.FC<{ risks: { risk: string; severity: 'Low' | 'Med' | 'High' }[] }> = ({ risks }) => {
  const fill = (s: string) => (s === 'High' ? C.rose : s === 'Med' ? C.amber : C.emerald);
  const tone = (s: string) => (s === 'High' ? C.roseSoft : s === 'Med' ? C.amberSoft : C.emeraldSoft);
  return (
    <div className="space-y-2">
      {risks.map((r, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-md"
          style={{ background: tone(r.severity), border: `1px solid ${fill(r.severity)}33` }}
        >
          <span
            className="px-2 py-1 rounded text-[10px] uppercase tracking-[0.16em] font-semibold"
            style={{ background: fill(r.severity), color: '#fff' }}
          >
            {r.severity}
          </span>
          <span className="text-sm font-medium" style={{ color: C.ink }}>
            {r.risk}
          </span>
        </div>
      ))}
    </div>
  );
};

/** Future-state arrow timeline for "next steps" */
const FutureStateArrow: React.FC<{ steps: { week: string; milestone: string }[] }> = ({ steps }) => {
  const w = 720;
  const h = 160;
  const segW = (w - 40) / steps.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
      <defs>
        <linearGradient id="future-arrow" x1="0" x2="1">
          <stop offset="0" stopColor={C.accent} stopOpacity="0.15" />
          <stop offset="1" stopColor={C.accent} />
        </linearGradient>
      </defs>
      <path d={`M20,${h / 2 - 14} L${w - 60},${h / 2 - 14} L${w - 20},${h / 2} L${w - 60},${h / 2 + 14} L20,${h / 2 + 14} Z`} fill="url(#future-arrow)" />
      {steps.map((s, i) => {
        const cx = 30 + i * segW + segW / 2;
        return (
          <g key={i}>
            <circle cx={cx} cy={h / 2} r="7" fill="#fff" stroke={C.ink} strokeWidth={2} />
            <text x={cx} y={h / 2 - 22} textAnchor="middle" fontFamily={fontMono} fontSize="10" fill={C.ink}>
              {s.week}
            </text>
            <text x={cx} y={h / 2 + 36} textAnchor="middle" fontFamily={fontSans} fontSize="10" fill={C.textSoft}>
              {s.milestone}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/* ───────────────────────────── slides ───────────────────────────── */

type Edit = (p: (string | number)[], v: string) => void;

const Slide1Exec: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Executive Summary">
    <div className="grid grid-cols-12 gap-8 h-full">
      <div className="col-span-7 flex flex-col">
        <SectionLabel>Strategic Partnership Proposal</SectionLabel>
        <SlideTitle>
          <Editable value={data.executive_summary.headline} path={['executive_summary', 'headline']} onEdit={e} />
        </SlideTitle>
        <SlideSub>
          <Editable value={data.executive_summary.sub} path={['executive_summary', 'sub']} onEdit={e} multiline />
        </SlideSub>
        <div className="mt-6 grid grid-cols-3 gap-4">
          {data.executive_summary.three_pillars.map((p, i) => (
            <Card key={i} className="p-4" tone="soft">
              <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
                Pillar 0{i + 1}
              </div>
              <div className="mt-2 font-semibold text-sm" style={{ color: C.ink }}>
                <Editable value={p.title} path={['executive_summary', 'three_pillars', i, 'title']} onEdit={e} />
              </div>
              <div className="mt-2 text-xs" style={{ color: C.textSoft }}>
                <Editable value={p.detail} path={['executive_summary', 'three_pillars', i, 'detail']} onEdit={e} multiline />
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-auto pt-6">
          <div className="flex items-baseline gap-4">
            <div style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '48px', color: C.ink }}>
              {usdShort(data.executive_summary.headline_value_usd)}
            </div>
            <div className="text-sm" style={{ color: C.textSoft }}>
              <Editable
                value={data.executive_summary.headline_value_label}
                path={['executive_summary', 'headline_value_label']}
                onEdit={e}
              />
              {' · '}
              <span style={{ fontFamily: fontMono, color: C.textMuted }}>
                {data.executive_summary.horizon_months}-month horizon
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="col-span-5">
        <Card className="h-full p-6 flex flex-col" tone="soft">
          <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: C.textMuted }}>
            Prepared for
          </div>
          <div className="mt-1 text-base font-semibold" style={{ color: C.ink }}>
            <Editable value={data.meta.prepared_for} path={['meta', 'prepared_for']} onEdit={e} />
          </div>
          <div className="mt-6 flex-1">
            <HeroConvergence left={data.meta.presenter_logo_mark} right={data.meta.partner_logo_mark} />
          </div>
          <div
            className="mt-4 pt-4 border-t flex items-center justify-between text-[11px]"
            style={{ borderColor: C.line, color: C.textMuted }}
          >
            <span>
              <Editable value={data.meta.prepared_by} path={['meta', 'prepared_by']} onEdit={e} />
            </span>
            <span style={{ fontFamily: fontMono }}>
              <Editable value={data.meta.presented_on} path={['meta', 'presented_on']} onEdit={e} />
            </span>
          </div>
        </Card>
      </div>
    </div>
  </SlideFrame>
);

const Slide2Context: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Industry Context">
    <div className="grid grid-cols-12 gap-8 h-full">
      <div className="col-span-5 flex flex-col">
        <SectionLabel color={C.gold}>Industry context</SectionLabel>
        <SlideTitle>
          <Editable value={data.industry_context.headline} path={['industry_context', 'headline']} onEdit={e} />
        </SlideTitle>
        <SlideSub>
          <Editable value={data.industry_context.sub} path={['industry_context', 'sub']} onEdit={e} multiline />
        </SlideSub>
        <div className="mt-6 space-y-3 flex-1">
          {data.industry_context.shifts.map((s, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span
                className="shrink-0 mt-1 w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold"
                style={{ background: C.accentSoft, color: C.accent, fontFamily: fontMono }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <div className="font-semibold text-sm" style={{ color: C.ink }}>
                  <Editable value={s.title} path={['industry_context', 'shifts', i, 'title']} onEdit={e} />
                </div>
                <div className="text-xs" style={{ color: C.textSoft }}>
                  <Editable value={s.detail} path={['industry_context', 'shifts', i, 'detail']} onEdit={e} multiline />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-7 flex flex-col">
        <Card className="p-6 flex-1" tone="plain">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: C.textMuted }}>
              Cross-industry growth rates · 3-yr CAGR
            </div>
            <div className="text-[10px]" style={{ color: C.textMuted, fontFamily: fontMono }}>
              Source: industry analysts, normalized
            </div>
          </div>
          <div className="h-[280px]">
            <IndustryShiftsChart shifts={data.industry_context.shifts} />
          </div>
        </Card>
        <Card className="mt-4 p-4" tone="accent">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            Why now
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {data.industry_context.why_now.map((w, i) => (
              <div key={i} style={{ color: C.ink }}>
                <Editable value={w} path={['industry_context', 'why_now', i]} onEdit={e} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  </SlideFrame>
);

const Slide3Challenges: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Partner Challenges">
    <SectionLabel color={C.rose}>Current state</SectionLabel>
    <SlideTitle>
      <Editable value={data.partner_challenges.headline} path={['partner_challenges', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.partner_challenges.sub} path={['partner_challenges', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <div className="mt-6 grid grid-cols-4 gap-4">
      {data.partner_challenges.challenges.map((c, i) => (
        <Card key={i} className="p-5 h-full" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
            <Editable value={c.area} path={['partner_challenges', 'challenges', i, 'area']} onEdit={e} />
          </div>
          <div className="mt-2 text-sm font-medium leading-snug" style={{ color: C.ink }}>
            <Editable value={c.pain} path={['partner_challenges', 'challenges', i, 'pain']} onEdit={e} multiline />
          </div>
          <div className="mt-4 pt-4 border-t" style={{ borderColor: C.line }}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
              Est. annual cost
            </div>
            <div className="mt-1 font-semibold text-lg" style={{ color: C.rose, fontFamily: fontSerif }}>
              {usdShort(c.cost_usd)}
            </div>
          </div>
        </Card>
      ))}
    </div>
    <Card className="mt-6 p-5" tone="soft">
      <div className="grid grid-cols-2 gap-6 items-center">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
            Compounded annual cost of inaction
          </div>
          <div className="mt-1" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '40px', color: C.ink }}>
            {usdShort(data.partner_challenges.challenges.reduce((a, c) => a + c.cost_usd, 0))}
          </div>
          <div className="text-xs" style={{ color: C.textSoft }}>
            Across the four challenge areas above.
          </div>
        </div>
        <div className="text-sm leading-snug" style={{ color: C.textSoft }}>
          Without a structural change, these costs compound year-over-year and erode competitive position in
          adjacent markets. A coordinated partnership materially shifts the trajectory.
        </div>
      </div>
    </Card>
  </SlideFrame>
);

const Slide4Shared: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Shared Opportunity">
    <div className="grid grid-cols-12 gap-8 h-full">
      <div className="col-span-5 flex flex-col">
        <SectionLabel>Shared opportunity</SectionLabel>
        <SlideTitle>
          <Editable value={data.shared_opportunity.headline} path={['shared_opportunity', 'headline']} onEdit={e} />
        </SlideTitle>
        <SlideSub>
          <Editable value={data.shared_opportunity.sub} path={['shared_opportunity', 'sub']} onEdit={e} multiline />
        </SlideSub>
        <div className="mt-6 space-y-3 flex-1">
          {data.shared_opportunity.quadrants.map((q, i) => (
            <Card key={i} className="p-4" tone="plain">
              <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
                Q{i + 1} · <Editable value={q.title} path={['shared_opportunity', 'quadrants', i, 'title']} onEdit={e} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
                    Partner gain
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: C.ink }}>
                    <Editable value={q.partner_gain} path={['shared_opportunity', 'quadrants', i, 'partner_gain']} onEdit={e} />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
                    Our gain
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: C.ink }}>
                    <Editable value={q.presenter_gain} path={['shared_opportunity', 'quadrants', i, 'presenter_gain']} onEdit={e} />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
        <Card className="mt-4 p-4" tone="accent">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
              Addressable joint value
            </div>
            <div style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '28px', color: C.ink }}>
              {usdShort(data.shared_opportunity.addressable_value_usd)}
            </div>
          </div>
        </Card>
      </div>
      <div className="col-span-7">
        <Card className="h-full p-6" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: C.textMuted }}>
            Opportunity prioritization · 2×2
          </div>
          <div className="h-[420px]">
            <OpportunityQuadrants quadrants={data.shared_opportunity.quadrants} />
          </div>
        </Card>
      </div>
    </div>
  </SlideFrame>
);

const Slide5Solution: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Solution Overview">
    <SectionLabel>Solution overview</SectionLabel>
    <SlideTitle>
      <Editable value={data.solution_overview.headline} path={['solution_overview', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.solution_overview.sub} path={['solution_overview', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <div className="mt-6 grid grid-cols-12 gap-8">
      <Card className="col-span-7 p-6" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: C.textMuted }}>
          Partnership operating model
        </div>
        <div className="h-[360px]">
          <EcosystemDiagram presenter={data.meta.presenter_logo_mark} partner={data.meta.partner_logo_mark} />
        </div>
      </Card>
      <div className="col-span-5 space-y-3">
        {[
          { title: 'Partner responsibilities', items: data.solution_overview.partner_responsibilities, color: C.gold, key: 'partner_responsibilities' as const },
          { title: 'Our responsibilities', items: data.solution_overview.presenter_responsibilities, color: C.accent, key: 'presenter_responsibilities' as const },
          { title: 'Joint responsibilities', items: data.solution_overview.joint_responsibilities, color: C.emerald, key: 'joint_responsibilities' as const },
        ].map((b, bi) => (
          <Card key={bi} className="p-4" tone="plain">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />
              <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: b.color }}>
                {b.title}
              </div>
            </div>
            <ul className="space-y-1 text-[12px]">
              {b.items.map((it, ii) => (
                <li key={ii} className="flex gap-2" style={{ color: C.ink }}>
                  <span style={{ color: C.textMuted }}>·</span>
                  <Editable value={it} path={['solution_overview', b.key, ii]} onEdit={e} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  </SlideFrame>
);

const Slide6Platform: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Product & Platform">
    <SectionLabel>Product & platform</SectionLabel>
    <SlideTitle>
      <Editable value={data.product_platform.headline} path={['product_platform', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.product_platform.sub} path={['product_platform', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <div className="mt-6 grid grid-cols-12 gap-8">
      <Card className="col-span-8 p-6" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: C.textMuted }}>
          Reference architecture
        </div>
        <div className="h-[380px]">
          <ArchitectureStack layers={data.product_platform.layers} integrations={data.product_platform.integration_points} />
        </div>
      </Card>
      <div className="col-span-4 space-y-3">
        <Card className="p-4" tone="soft">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            Integration patterns
          </div>
          <div className="mt-3 space-y-2">
            {data.product_platform.integration_points.map((ig, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span style={{ color: C.ink }}>
                  <Editable value={ig.name} path={['product_platform', 'integration_points', i, 'name']} onEdit={e} />
                </span>
                <span style={{ color: C.textSoft, fontFamily: fontMono }}>
                  <Editable value={ig.protocol} path={['product_platform', 'integration_points', i, 'protocol']} onEdit={e} />
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4" tone="accent">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            Designed for enterprise
          </div>
          <div className="text-xs leading-snug" style={{ color: C.ink }}>
            Multi-region · SOC 2 Type II · audit logs · role-based access · single-tenant isolation
            optional per workspace.
          </div>
        </Card>
      </div>
    </div>
  </SlideFrame>
);

const Slide7Benefits: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Business Benefits">
    <SectionLabel color={C.emerald}>Quantified outcomes</SectionLabel>
    <SlideTitle>
      <Editable value={data.business_benefits.headline} path={['business_benefits', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.business_benefits.sub} path={['business_benefits', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <div className="mt-6 grid grid-cols-4 gap-4">
      {data.business_benefits.kpis.map((k, i) => (
        <KpiTile key={i} label={k.label} value={k.value} delta={k.delta} note={k.note} tone={i % 2 === 0 ? 'accent' : 'emerald'} />
      ))}
    </div>
    <Card className="mt-6 p-6" tone="plain">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: C.textMuted }}>
          Impact by category · Year 1 vs Year 3
        </div>
        <div className="text-[10px]" style={{ color: C.textMuted, fontFamily: fontMono }}>
          $ value created · attributable to partnership
        </div>
      </div>
      <div className="h-[240px]">
        <ImpactChart categories={data.business_benefits.impact_categories} />
      </div>
    </Card>
  </SlideFrame>
);

const Slide8Roadmap: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Implementation Roadmap">
    <SectionLabel>Implementation roadmap</SectionLabel>
    <SlideTitle>
      <Editable value={data.implementation_roadmap.headline} path={['implementation_roadmap', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.implementation_roadmap.sub} path={['implementation_roadmap', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <Card className="mt-6 p-6" tone="plain">
      <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: C.textMuted }}>
        Phased delivery
      </div>
      <div className="h-[200px]">
        <RoadmapGantt phases={data.implementation_roadmap.phases} />
      </div>
    </Card>
    <div className="mt-4 grid grid-cols-3 gap-4">
      {data.implementation_roadmap.phases.map((p, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
              Phase {i + 1}
            </div>
            <span className="text-[10px]" style={{ color: C.textMuted, fontFamily: fontMono }}>
              {p.duration_label}
            </span>
          </div>
          <div className="mt-1 font-semibold text-sm" style={{ color: C.ink }}>
            <Editable value={p.name} path={['implementation_roadmap', 'phases', i, 'name']} onEdit={e} />
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
              Objectives
            </div>
            <ul className="text-xs mt-1 space-y-0.5">
              {(p.objectives ?? []).slice(0, 3).map((o, oi) => (
                <li key={oi} style={{ color: C.ink }}>
                  · <Editable value={o} path={['implementation_roadmap', 'phases', i, 'objectives', oi]} onEdit={e} />
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 pt-3 border-t" style={{ borderColor: C.line }}>
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
              Success metric
            </div>
            <div className="text-xs mt-1 font-medium" style={{ color: C.emerald }}>
              <Editable value={p.success_metric} path={['implementation_roadmap', 'phases', i, 'success_metric']} onEdit={e} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  </SlideFrame>
);

const Slide9Cases: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Validation">
    <SectionLabel>Proof in market</SectionLabel>
    <SlideTitle>
      <Editable value={data.case_studies.headline} path={['case_studies', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.case_studies.sub} path={['case_studies', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <div className="mt-6 grid grid-cols-3 gap-4">
      {data.case_studies.studies.map((s, i) => (
        <Card key={i} className="p-5" tone="plain">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
              <Editable value={s.sector} path={['case_studies', 'studies', i, 'sector']} onEdit={e} />
            </div>
            <div className="text-[10px]" style={{ color: C.textMuted, fontFamily: fontMono }}>
              CASE {String(i + 1).padStart(2, '0')}
            </div>
          </div>
          <div className="mt-2 font-semibold" style={{ color: C.ink, fontFamily: fontSerif, fontSize: '18px' }}>
            <Editable value={s.client} path={['case_studies', 'studies', i, 'client']} onEdit={e} />
          </div>
          <div className="mt-3 text-xs" style={{ color: C.textSoft }}>
            <Editable value={s.outcome} path={['case_studies', 'studies', i, 'outcome']} onEdit={e} multiline />
          </div>
          <div className="mt-4 pt-4 border-t flex items-baseline justify-between" style={{ borderColor: C.line }}>
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
              <Editable value={s.metric_label} path={['case_studies', 'studies', i, 'metric_label']} onEdit={e} />
            </div>
            <div className="font-semibold" style={{ color: C.emerald, fontFamily: fontSerif, fontSize: '22px' }}>
              <Editable value={s.metric_value} path={['case_studies', 'studies', i, 'metric_value']} onEdit={e} />
            </div>
          </div>
        </Card>
      ))}
    </div>
    <Card className="mt-6 p-4" tone="soft">
      <div className="grid grid-cols-4 gap-4">
        {data.case_studies.proof_points.map((p, i) => (
          <div key={i} className="text-center">
            <div style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '28px', color: C.ink }}>
              <Editable value={p.value} path={['case_studies', 'proof_points', i, 'value']} onEdit={e} />
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
              <Editable value={p.label} path={['case_studies', 'proof_points', i, 'label']} onEdit={e} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  </SlideFrame>
);

const Slide10Commercial: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Commercial Structure">
    <SectionLabel color={C.gold}>Commercial structure</SectionLabel>
    <SlideTitle>
      <Editable value={data.commercial_structure.headline} path={['commercial_structure', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.commercial_structure.sub} path={['commercial_structure', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <Card className="col-span-7 p-6" tone="plain">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: C.textMuted }}>
            Revenue flow
          </div>
          <span
            className="px-2 py-1 rounded text-[10px] uppercase tracking-[0.16em] font-semibold"
            style={{ background: C.goldSoft, color: C.gold }}
          >
            <Editable value={data.commercial_structure.model_label} path={['commercial_structure', 'model_label']} onEdit={e} />
          </span>
        </div>
        <div className="h-[260px]">
          <RevenueFlow economics={data.commercial_structure.economics} />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px]" style={{ color: C.textSoft }}>
          {data.commercial_structure.economics.map((eco, i) => (
            <div key={i}>
              <span style={{ color: C.ink, fontWeight: 600 }}>
                <Editable value={eco.line} path={['commercial_structure', 'economics', i, 'line']} onEdit={e} />:
              </span>{' '}
              <Editable value={eco.note} path={['commercial_structure', 'economics', i, 'note']} onEdit={e} />
            </div>
          ))}
        </div>
      </Card>
      <div className="col-span-5 space-y-3">
        <Card className="p-4" tone="soft">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: C.accent }}>
            Pricing tiers
          </div>
          <div className="space-y-2">
            {data.commercial_structure.pricing_tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 items-center pb-2 border-b last:border-b-0" style={{ borderColor: C.line }}>
                <div className="text-xs font-semibold" style={{ color: C.ink }}>
                  <Editable value={t.tier} path={['commercial_structure', 'pricing_tiers', i, 'tier']} onEdit={e} />
                </div>
                <div className="text-xs" style={{ color: C.textSoft }}>
                  <Editable value={t.access} path={['commercial_structure', 'pricing_tiers', i, 'access']} onEdit={e} />
                </div>
                <div className="text-xs text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {usdShort(t.annual_usd)}/yr
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            Key terms
          </div>
          <ul className="space-y-1 text-xs">
            {data.commercial_structure.terms_summary.map((tm, i) => (
              <li key={i} className="flex gap-2" style={{ color: C.ink }}>
                <span style={{ color: C.textMuted }}>·</span>
                <Editable value={tm} path={['commercial_structure', 'terms_summary', i]} onEdit={e} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  </SlideFrame>
);

const Slide11Governance: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="Governance & Risk">
    <SectionLabel color={C.rose}>Governance & risk</SectionLabel>
    <SlideTitle>
      <Editable value={data.governance_risk.headline} path={['governance_risk', 'headline']} onEdit={e} />
    </SlideTitle>
    <SlideSub>
      <Editable value={data.governance_risk.sub} path={['governance_risk', 'sub']} onEdit={e} multiline />
    </SlideSub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <div className="col-span-7">
        <Card className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: C.accent }}>
            Governance bodies
          </div>
          <div className="grid grid-cols-1 gap-2">
            {data.governance_risk.bodies.map((b, i) => (
              <div
                key={i}
                className="grid grid-cols-12 gap-3 py-2 border-b last:border-b-0 text-xs items-center"
                style={{ borderColor: C.line }}
              >
                <div className="col-span-3 font-semibold" style={{ color: C.ink }}>
                  <Editable value={b.name} path={['governance_risk', 'bodies', i, 'name']} onEdit={e} />
                </div>
                <div className="col-span-2" style={{ color: C.textSoft, fontFamily: fontMono }}>
                  <Editable value={b.cadence} path={['governance_risk', 'bodies', i, 'cadence']} onEdit={e} />
                </div>
                <div className="col-span-3" style={{ color: C.textSoft }}>
                  <Editable value={b.members} path={['governance_risk', 'bodies', i, 'members']} onEdit={e} />
                </div>
                <div className="col-span-4" style={{ color: C.ink }}>
                  <Editable value={b.mandate} path={['governance_risk', 'bodies', i, 'mandate']} onEdit={e} multiline />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 mt-3" tone="soft">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            Compliance & certifications
          </div>
          <div className="flex flex-wrap gap-2">
            {data.governance_risk.certifications.map((c, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded text-[10px] uppercase tracking-[0.14em] font-semibold"
                style={{ background: '#fff', color: C.ink, border: `1px solid ${C.line}`, fontFamily: fontMono }}
              >
                <Editable value={c} path={['governance_risk', 'certifications', i]} onEdit={e} />
              </span>
            ))}
          </div>
        </Card>
      </div>
      <div className="col-span-5">
        <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: C.textMuted }}>
          Risk register
        </div>
        <RiskHeatmap risks={data.governance_risk.risks} />
        <div className="mt-3 space-y-2 text-[11px]" style={{ color: C.textSoft }}>
          {data.governance_risk.risks.map((r, i) => (
            <div key={i}>
              <span style={{ color: C.ink, fontWeight: 600 }}>{r.risk}:</span>{' '}
              <Editable value={r.mitigation} path={['governance_risk', 'risks', i, 'mitigation']} onEdit={e} multiline />
            </div>
          ))}
        </div>
      </div>
    </div>
  </SlideFrame>
);

const Slide12Next: React.FC<{ data: PartnershipData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <div
    className="relative w-full h-full overflow-hidden"
    style={{ background: C.navyDeep, color: '#fff', fontFamily: fontSans }}
  >
    <div
      className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-12 text-[10px] tracking-[0.22em] uppercase opacity-60"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
    >
      <span style={{ fontFamily: fontSerif, fontStyle: 'italic' }}>Next Steps</span>
      <span style={{ fontFamily: fontMono }}>
        {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
    <div className="absolute inset-x-0 top-12 bottom-10 px-12 py-8">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px w-8" style={{ background: C.gold }} />
        <span className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: C.gold }}>
          Recommended actions
        </span>
      </div>
      <h1 className="leading-[1.06] tracking-[-0.015em]" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '40px' }}>
        <Editable value={data.next_steps.headline} path={['next_steps', 'headline']} onEdit={e} />
      </h1>
      <p className="mt-3 text-[14px] max-w-[820px]" style={{ color: '#A9BBD6' }}>
        <Editable value={data.next_steps.sub} path={['next_steps', 'sub']} onEdit={e} multiline />
      </p>

      <div className="mt-6 grid grid-cols-12 gap-6">
        <div
          className="col-span-7 p-6 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: '#7E92B3' }}>
            Recommended pilot
          </div>
          <div className="font-semibold" style={{ fontFamily: fontSerif, fontSize: '24px' }}>
            <Editable value={data.next_steps.pilot.name} path={['next_steps', 'pilot', 'name']} onEdit={e} />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7E92B3' }}>
                Duration
              </div>
              <div className="mt-1 font-medium">
                <Editable value={data.next_steps.pilot.duration_label} path={['next_steps', 'pilot', 'duration_label']} onEdit={e} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7E92B3' }}>
                Investment
              </div>
              <div className="mt-1 font-medium" style={{ fontFamily: fontMono }}>
                {usdShort(data.next_steps.pilot.investment_usd)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7E92B3' }}>
                Sponsor
              </div>
              <div className="mt-1 font-medium">
                <Editable value={data.next_steps.contact_name} path={['next_steps', 'contact_name']} onEdit={e} />
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-[10px] uppercase tracking-[0.18em] mb-2" style={{ color: '#7E92B3' }}>
              Success criteria
            </div>
            <ul className="text-sm space-y-1">
              {data.next_steps.pilot.success_criteria.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span style={{ color: C.gold }}>·</span>
                  <Editable value={s} path={['next_steps', 'pilot', 'success_criteria', i]} onEdit={e} />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div
          className="col-span-5 p-6 rounded-lg flex flex-col justify-between"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: '#7E92B3' }}>
              Decision timeline
            </div>
            <div className="h-[160px]">
              <FutureStateArrow steps={data.next_steps.timeline} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-[18px] leading-snug" style={{ fontFamily: fontSerif, fontStyle: 'italic', color: '#FFE4B0' }}>
              <Editable value={data.next_steps.cta_line} path={['next_steps', 'cta_line']} onEdit={e} multiline />
            </div>
            <div className="mt-4 text-sm" style={{ color: '#A9BBD6' }}>
              <Editable value={data.next_steps.contact_name} path={['next_steps', 'contact_name']} onEdit={e} />
              {' · '}
              <Editable value={data.next_steps.contact_email} path={['next_steps', 'contact_email']} onEdit={e} />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      className="absolute bottom-0 left-0 right-0 h-10 flex items-center justify-between px-12 text-[10px] opacity-60"
      style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      <span>Confidential · Prepared for executive review</span>
      <span style={{ fontFamily: fontMono }}>NEXT STEPS</span>
    </div>
  </div>
);

/* ───────────────────────────── deck shell ───────────────────────── */

export const PartnershipBdDeckApp: React.FC<{ initial?: PartnershipData }> = ({ initial = SAMPLE_DATA }) => {
  const [data, setData] = useState<PartnershipData>(initial);
  const [idx, setIdx] = useState(0);
  const onEdit = useCallback((p: (string | number)[], v: string) => setData((prev) => setIn(prev, p, v)), []);

  const slides = useMemo(
    () => [
      (p: { step: number; total: number }) => <Slide1Exec data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide2Context data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide3Challenges data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide4Shared data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide5Solution data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide6Platform data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide7Benefits data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide8Roadmap data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide9Cases data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide10Commercial data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide11Governance data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide12Next data={data} e={onEdit} {...p} />,
    ],
    [data, onEdit]
  );
  const total = slides.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setIdx((i) => Math.min(total - 1, i + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'Home') setIdx(0);
      else if (e.key === 'End') setIdx(total - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  return (
    <div className="w-screen h-screen flex items-center justify-center" style={{ background: '#D9E0EA' }}>
      <div
        className="relative shadow-2xl"
        style={{
          width: 'min(96vw, calc(96vh * 16 / 9))',
          aspectRatio: '16 / 9',
          background: '#fff',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0"
          >
            {slides[idx]({ step: idx + 1, total })}
          </motion.div>
        </AnimatePresence>
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 18px rgba(0,0,0,0.08)' }}
        >
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} className="px-2 py-1 text-sm rounded hover:bg-slate-100" aria-label="Previous">
            ◀
          </button>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className="w-2 h-2 rounded-full transition-all"
              style={{ background: i === idx ? C.accent : C.line, transform: i === idx ? 'scale(1.4)' : 'scale(1)' }}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
          <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))} className="px-2 py-1 text-sm rounded hover:bg-slate-100" aria-label="Next">
            ▶
          </button>
        </div>
      </div>
    </div>
  );
};

export default PartnershipBdDeckApp;

/* ──────────────────── sample data + Axal VC binding ────────────────── */
/*
 * Field names mirror what heuristicSlides() in
 * cloudflare-worker/src/routes/decks.ts writes after Replit Prompt MD's
 * additive migration (00xx_deck_autofill_fields.sql). For partnership
 * decks the worker also reads from `partnerships`, `partnership_terms`,
 * `case_studies` and `compliance_certs` rows (added in Prompt MD
 * extension).
 *
 * Mapping:
 *   organizations.name (presenter)              → meta.presenter_org
 *   partnerships.partner_org_name              → meta.partner_org
 *   partnerships.proposal_label                → meta.document_label
 *   partnerships.prepared_for                  → meta.prepared_for
 *   partnerships.prepared_by_user              → meta.prepared_by
 *   partnerships.presented_on                  → meta.presented_on
 *   partnerships.headline_value_usd            → executive_summary.headline_value_usd
 *   partnerships.horizon_months                → executive_summary.horizon_months
 *   partnerships.three_pillars_json            → executive_summary.three_pillars
 *
 *   industry_signals.market_shifts_json        → industry_context.shifts
 *   industry_signals.why_now_bullets_json      → industry_context.why_now
 *
 *   partner_pain_points_json (partner profile) → partner_challenges.challenges
 *
 *   shared_opportunity_quadrants_json          → shared_opportunity.quadrants
 *   shared_opportunity.addressable_usd         → shared_opportunity.addressable_value_usd
 *
 *   partnership_terms.partner_responsibilities → solution_overview.partner_responsibilities
 *   partnership_terms.our_responsibilities     → solution_overview.presenter_responsibilities
 *   partnership_terms.joint_responsibilities   → solution_overview.joint_responsibilities
 *
 *   projects.tech_stack_json (layers)          → product_platform.layers
 *   projects.integration_points_json           → product_platform.integration_points
 *
 *   financial_models.* + projects.outcomes     → business_benefits.kpis
 *   impact_categories_json                     → business_benefits.impact_categories
 *
 *   partnerships.phases_json                   → implementation_roadmap.phases
 *
 *   case_studies.* (filtered by sector)        → case_studies.studies
 *   case_studies_proof_points_json             → case_studies.proof_points
 *
 *   partnership_terms.commercial_model         → commercial_structure.model_label
 *   partnership_terms.revenue_share_json       → commercial_structure.economics
 *   pricing_tiers (existing)                   → commercial_structure.pricing_tiers
 *   partnership_terms.terms_summary_json       → commercial_structure.terms_summary
 *
 *   governance_bodies_json                     → governance_risk.bodies
 *   risk_register (existing)                   → governance_risk.risks
 *   compliance_certs                           → governance_risk.certifications
 *
 *   partnerships.pilot_proposal_json           → next_steps.pilot
 *   partnerships.decision_timeline_json        → next_steps.timeline
 *   users.email (proposal owner)               → next_steps.contact_email
 *
 * Empty fields fall through to "—" per heuristicSlides() convention.
 */

export const SAMPLE_DATA: PartnershipData = {
  meta: {
    presenter_org: 'Axal VC',
    partner_org: 'Northbridge Industries',
    presenter_logo_mark: 'A',
    partner_logo_mark: 'N',
    document_label: 'Strategic Partnership Proposal',
    confidential_label: 'CONFIDENTIAL · Executive Distribution',
    prepared_for: 'Northbridge Industries — Office of the COO',
    prepared_by: 'Axal VC Partnerships Team',
    presented_on: 'May 2026',
  },
  executive_summary: {
    headline:
      'A joint operating model that unlocks $180M of value over three years across distribution, innovation, and operating leverage.',
    sub: 'A defined partnership between Axal VC and Northbridge to combine Axal VC\'s technology platform with Northbridge\'s enterprise distribution. Built to compound, governed for accountability, structured for clear economics on both sides.',
    three_pillars: [
      {
        title: 'Combined market access',
        detail: 'Northbridge channel + Axal VC product reaches 6× more enterprise buyers in the same fiscal year.',
      },
      {
        title: 'Operating leverage',
        detail: 'Shared platform reduces per-deal delivery cost by 38% within twelve months.',
      },
      {
        title: 'Defensible IP',
        detail: 'Co-developed reference architecture creates a category position neither party can match alone.',
      },
    ],
    headline_value_usd: 180_000_000,
    headline_value_label: 'three-year joint value creation',
    horizon_months: 36,
  },
  industry_context: {
    headline: 'The buyer is consolidating. The window to lead is 18 months.',
    sub: 'Across enterprise IT, three structural shifts are converging. Buyers expect fewer, deeper vendor relationships; AI is reshaping operating models; and regulators are codifying data-handling standards that favour integrated providers.',
    shifts: [
      { title: 'Vendor consolidation', detail: 'CIOs cutting 40% of vendors by 2027.', trend_pct: 78 },
      { title: 'AI-native procurement', detail: 'AI capability now a top-3 RFP requirement.', trend_pct: 64 },
      { title: 'Outcome-based pricing', detail: 'Buyers pay for measurable lift, not seats.', trend_pct: 52 },
      { title: 'Regulatory tightening', detail: 'New data residency rules in 14 markets.', trend_pct: 41 },
    ],
    why_now: [
      'Buying cycles align with FY-27 budget planning starting Q4-26.',
      'Competitive set has not yet productised a joint offering.',
      'Both organizations have available capacity in 2026 to execute.',
    ],
  },
  partner_challenges: {
    headline: 'Northbridge faces four structural challenges with quantifiable cost.',
    sub: 'These are the constraints we hear repeatedly from Northbridge field leadership and recent customer interviews.',
    challenges: [
      {
        area: 'Distribution',
        pain: 'Enterprise reps spend 64% of cycles on integration scoping, not selling.',
        cost_usd: 42_000_000,
      },
      {
        area: 'Innovation',
        pain: 'Average 18-month product cycle vs. 6-month buyer expectation.',
        cost_usd: 28_000_000,
      },
      {
        area: 'Delivery',
        pain: 'Fragmented implementation partners drive 22% project overrun.',
        cost_usd: 36_000_000,
      },
      {
        area: 'Retention',
        pain: 'Lack of platform telemetry leaves churn signals invisible until renewal.',
        cost_usd: 19_000_000,
      },
    ],
  },
  shared_opportunity: {
    headline: 'Four prioritized opportunities map to immediate, joint-executable plays.',
    sub: 'Plotted on strategic value × ease of execution. Q1 and Q2 are the high-conviction starting points.',
    quadrants: [
      {
        title: 'Bundled enterprise offer',
        partner_gain: 'Larger ACVs, fewer escalations.',
        presenter_gain: 'Channel coverage in regulated industries.',
      },
      {
        title: 'Joint reference architecture',
        partner_gain: 'Differentiated buyer narrative.',
        presenter_gain: 'Reference proof-points across 6 sectors.',
      },
      {
        title: 'Co-delivered implementation',
        partner_gain: 'Lower delivery cost, higher NPS.',
        presenter_gain: 'Faster customer time-to-value.',
      },
      {
        title: 'Shared insight & telemetry',
        partner_gain: 'Earlier renewal signals.',
        presenter_gain: 'Better product roadmap signal loop.',
      },
    ],
    addressable_value_usd: 425_000_000,
  },
  solution_overview: {
    headline: 'A two-party operating model with a clearly defined joint surface.',
    sub: 'Each party owns what it does best. The joint surface is governed by a steering committee with quarterly review.',
    partner_responsibilities: [
      'Enterprise account ownership',
      'First-line implementation delivery',
      'Customer success motion',
      'Regional regulatory liaison',
    ],
    presenter_responsibilities: [
      'Platform & product roadmap',
      'Reference architecture & integration kits',
      'Tier-2 technical support',
      'Joint analytics & customer health',
    ],
    joint_responsibilities: [
      'Quarterly roadmap & joint OKRs',
      'Co-marketing & analyst briefings',
      'Pricing & packaging committee',
      'Executive sponsor governance',
    ],
  },
  product_platform: {
    headline: 'A composable platform with documented integration points into Northbridge systems.',
    sub: 'Five-layer reference architecture, deployable in single-tenant or shared-tenant modes, designed for joint extensibility.',
    layers: [
      { name: 'Experience layer', detail: 'Co-branded portals, embeddable widgets, mobile.' },
      { name: 'Workflow & automation', detail: 'BPMN runtime, approval chains, SLA orchestration.' },
      { name: 'AI & decision', detail: 'Dedicated AI gateway, retrieval, evaluations, audit.' },
      { name: 'Data & integration', detail: 'CDC pipelines into Northbridge data lake, event streams.' },
      { name: 'Identity & governance', detail: 'SSO, RBAC, audit log, data residency by tenant.' },
    ],
    integration_points: [
      { name: 'Salesforce CRM', protocol: 'REST + Connect' },
      { name: 'SAP S/4HANA', protocol: 'IDoc + OData' },
      { name: 'ServiceNow', protocol: 'REST + Webhook' },
      { name: 'Workday', protocol: 'REST + SCIM' },
      { name: 'Snowflake', protocol: 'JDBC + share' },
      { name: 'Microsoft 365', protocol: 'Graph API' },
    ],
  },
  business_benefits: {
    headline: 'Quantified outcomes across four executive KPIs over a three-year horizon.',
    sub: 'Numbers grounded in comparable deployments (see Case Studies). Conservative assumptions in the base case.',
    kpis: [
      { label: 'Annual joint revenue', value: '$92M', delta: '+38% vs. baseline', note: 'New + expand across 3 verticals.' },
      { label: 'Delivery cost', value: '−38%', delta: 'per implementation', note: 'Shared playbooks & tooling.' },
      { label: 'Win rate', value: '+24pt', delta: 'vs. solo bids', note: 'On joint enterprise opportunities.' },
      { label: 'NRR', value: '128%', delta: '+18pt YoY', note: 'Cross-sell of joint modules.' },
    ],
    impact_categories: [
      { category: 'New revenue', year1_usd: 18_000_000, year3_usd: 92_000_000 },
      { category: 'Cost-out', year1_usd: 8_000_000, year3_usd: 36_000_000 },
      { category: 'Risk reduction', year1_usd: 4_000_000, year3_usd: 22_000_000 },
      { category: 'Retention uplift', year1_usd: 6_000_000, year3_usd: 30_000_000 },
    ],
  },
  implementation_roadmap: {
    headline: 'A three-phase, 18-month delivery plan with measurable exit criteria.',
    sub: 'Phase 1 is a contained, low-risk pilot. Phase 2 productizes. Phase 3 scales globally.',
    phases: [
      {
        name: 'Pilot',
        duration_label: 'Months 1–4',
        objectives: ['Stand up joint architecture', 'Win 3 lighthouse accounts', 'Validate delivery playbook'],
        deliverables: ['Reference architecture v1', 'Joint pricing', '3 signed customers'],
        success_metric: '3 lighthouse customers live',
      },
      {
        name: 'Productize',
        duration_label: 'Months 5–10',
        objectives: ['Codify offering', 'Train channel', 'Launch co-marketing'],
        deliverables: ['Channel enablement', 'GA launch', '20 partners certified'],
        success_metric: '$15M qualified pipeline',
      },
      {
        name: 'Scale',
        duration_label: 'Months 11–18',
        objectives: ['Expand to 3 regions', 'Reach 50 customers', 'Cross-sell modules'],
        deliverables: ['Regional rollout', 'Module 2 launched', 'Customer council'],
        success_metric: '$92M ARR run-rate',
      },
    ],
  },
  case_studies: {
    headline: 'Comparable partnerships have delivered the outcomes we model.',
    sub: 'Selected from operating deployments across financial services, healthcare, and the public sector.',
    studies: [
      {
        client: 'Continental Bank',
        sector: 'Financial services',
        outcome: 'Migrated 4 in-house systems onto the joint platform in 9 months; cut compliance cycle time by 62%.',
        metric_label: 'Compliance cycle',
        metric_value: '−62%',
      },
      {
        client: 'Atlas Health Group',
        sector: 'Healthcare',
        outcome: 'Deployed across 14 hospitals; reduced clinician admin by 4.2 hours/week; NPS 71.',
        metric_label: 'Clinician hours saved',
        metric_value: '4.2/wk',
      },
      {
        client: 'Ministry of Transport',
        sector: 'Public sector',
        outcome: 'Replaced 11 legacy systems on a single platform under Cloud-First mandate; 100% on-shore data residency.',
        metric_label: 'Systems consolidated',
        metric_value: '11 → 1',
      },
    ],
    proof_points: [
      { label: 'Enterprise customers', value: '180+' },
      { label: 'Countries deployed', value: '24' },
      { label: 'Avg. customer NPS', value: '68' },
      { label: 'Joint go-live SLA', value: '< 90d' },
    ],
  },
  commercial_structure: {
    headline: 'A revenue-share model with predictable economics and aligned incentives.',
    sub: 'Designed so each party invests where it controls outcomes — and shares upside on the joint surface.',
    model_label: 'Revenue share + co-sell',
    economics: [
      { line: 'Northbridge — channel', pct: 45, note: 'Recognized at deal-close, monthly settlement.' },
      { line: 'Axal VC — platform', pct: 35, note: 'Subscription license, billed quarterly.' },
      { line: 'Joint — services', pct: 15, note: 'Shared delivery margin, 50/50 split.' },
      { line: 'Joint marketing fund', pct: 5, note: 'Reinvested in demand generation.' },
    ],
    pricing_tiers: [
      { tier: 'Essential', access: 'Core platform · 1 region', annual_usd: 180_000 },
      { tier: 'Professional', access: 'Full platform · 2 regions', annual_usd: 420_000 },
      { tier: 'Enterprise', access: 'All modules · global', annual_usd: 950_000 },
      { tier: 'Strategic', access: 'Custom · single-tenant', annual_usd: 1_800_000 },
    ],
    terms_summary: [
      '3-year initial term, 2-year auto-renew with 12-month notice.',
      'Exclusivity by named vertical, not geography.',
      'Joint IP held in escrow; revert rights on termination.',
      'Annual MDF: 5% of joint net revenue.',
    ],
  },
  governance_risk: {
    headline: 'Governance and risk frameworks adapted from Northbridge operating standards.',
    sub: 'Decision rights are explicit. Escalation paths are short. Risk is reviewed quarterly against a shared register.',
    bodies: [
      {
        name: 'Executive Steering',
        cadence: 'Quarterly',
        members: 'COO (NB) · CEO (Axal VC) · GC each side',
        mandate: 'Strategy, P&L review, escalations, scope changes.',
      },
      {
        name: 'Joint Operating Council',
        cadence: 'Monthly',
        members: 'VP Channel · VP Product · VP Delivery',
        mandate: 'Roadmap, pipeline, customer health, pricing.',
      },
      {
        name: 'Customer Council',
        cadence: 'Semi-annual',
        members: '8 customer execs · both teams',
        mandate: 'Voice-of-customer, feature priorities.',
      },
      {
        name: 'Risk & Compliance Committee',
        cadence: 'Monthly',
        members: 'CISO each side · DPO · Legal',
        mandate: 'Data, security, regulatory, incidents.',
      },
    ],
    risks: [
      {
        risk: 'Channel conflict with existing Northbridge partners',
        severity: 'Med',
        mitigation: 'Named accounts list ratified at quarterly steering; conflict-resolution SLA of 5 business days.',
      },
      {
        risk: 'Data residency divergence across regions',
        severity: 'Med',
        mitigation: 'Region-locked tenants; pre-approved residency matrix maintained jointly by both DPOs.',
      },
      {
        risk: 'Joint IP attribution disputes',
        severity: 'Low',
        mitigation: 'Joint IP escrow; per-contribution attribution log; mediation clause before arbitration.',
      },
      {
        risk: 'Margin compression on co-delivered services',
        severity: 'Low',
        mitigation: 'Floor margin set in MSA; semi-annual margin review with rebalancing mechanism.',
      },
    ],
    certifications: ['SOC 2 Type II', 'ISO 27001', 'ISO 27701', 'HIPAA', 'PCI DSS', 'GDPR', 'Cloud-First (PS)'],
  },
  next_steps: {
    headline: 'A 90-day path to a signed pilot, with three clear decisions in the next 14 days.',
    sub: 'We propose moving immediately to a contained pilot, with the option to expand based on documented success criteria.',
    pilot: {
      name: 'Northbridge × Axal VC — Financial Services Pilot',
      duration_label: '120 days',
      investment_usd: 1_400_000,
      success_criteria: [
        'Three lighthouse customers live and reference-able.',
        '$15M qualified joint pipeline at end of pilot.',
        'Delivery NPS ≥ 65 across pilot customers.',
        'Joint operating playbook documented and ratified.',
      ],
    },
    timeline: [
      { week: 'W1', milestone: 'NDA + scope' },
      { week: 'W2', milestone: 'Steering kickoff' },
      { week: 'W4', milestone: 'Pilot SOW signed' },
      { week: 'W6', milestone: 'First customer live' },
      { week: 'W10', milestone: 'Mid-pilot review' },
      { week: 'W14', milestone: 'Go/no-go on Phase 2' },
    ],
    cta_line: 'Let\'s convert a $180M opportunity into a 90-day pilot — and a decade of joint advantage.',
    contact_name: 'Guillaume Lauzier — CEO, Axal VC',
    contact_email: 'guillaume@axal.vc',
  },
};
// ─────────────────────────────────────────────────────────────────
// Registry adapter — `Deck_partnership_bd_app`
//
// Wraps each of the 12 slides in <Slide16x9> so the platform print
// pipeline (PitchDeckPrintPage.jsx) can find each slide via the
// `[data-slide-frame]` hook and so per-slide page breaks fire
// during window.print(). Mirrors the pattern from
// series_a_growth_app + series_b_diligence_app + demo_day_app.
// ─────────────────────────────────────────────────────────────────

// Shape-safe merge: arrays in `incoming` only replace when non-empty,
// objects merge field-by-field, primitives override. Lets the
// platform pass partial DeckData (whatever fields autofill produced)
// without nuking the SAMPLE_DATA defaults the slide internals rely on.
function mergeShape<T>(base: T, incoming: any): T {
  if (incoming == null) return base;
  if (Array.isArray(base)) {
    return (Array.isArray(incoming) && incoming.length > 0 ? incoming : base) as unknown as T;
  }
  if (typeof base === 'object' && base !== null) {
    // Type-mismatch guard: a typed object base must never be replaced
    // by a non-object incoming (the editor's flat-field blob can produce
    // primitives at nested object paths, which used to clobber the entire
    // nested shape and crash slide internals).
    if (typeof incoming !== 'object' || Array.isArray(incoming)) return base;
    const out: any = { ...(base as any) };
    for (const k of Object.keys(incoming)) {
      const bv = (base as any)[k];
      const iv = incoming[k];
      if (iv === undefined || iv === null || iv === '') continue;
      if (bv !== undefined && bv !== null) {
        out[k] = mergeShape(bv, iv);
      } else {
        out[k] = iv;
      }
    }
    return out;
  }
  return (incoming as T) ?? base;
}

export const Deck_partnership_bd_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => (
  <BrandProvider data={data || {}} fallbackAccent="#0A84FF">
    <Deck_partnership_bd_app_inner data={data} editable={editable} onEdit={onEdit} />
  </BrandProvider>
);

const Deck_partnership_bd_app_inner: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const merged = useMemo(
    () => mergeShape(SAMPLE_DATA, data || {}) as PartnershipData,
    [data],
  );
  // Bridge the partnership_bd array-path onEdit signature to the
  // registry's dot-string signature. No-op when not editable.
  const handleEdit = useCallback(
    (path: (string | number)[], value: string) => {
      if (!editable || !onEdit) return;
      onEdit(path.join('.'), value);
    },
    [editable, onEdit],
  );

  const total = 12;
  const slides: React.ReactNode[] = [
    <Slide1Exec        data={merged} e={handleEdit} step={1}  total={total} />,
    <Slide2Context     data={merged} e={handleEdit} step={2}  total={total} />,
    <Slide3Challenges  data={merged} e={handleEdit} step={3}  total={total} />,
    <Slide4Shared      data={merged} e={handleEdit} step={4}  total={total} />,
    <Slide5Solution    data={merged} e={handleEdit} step={5}  total={total} />,
    <Slide6Platform    data={merged} e={handleEdit} step={6}  total={total} />,
    <Slide7Benefits    data={merged} e={handleEdit} step={7}  total={total} />,
    <Slide8Roadmap     data={merged} e={handleEdit} step={8}  total={total} />,
    <Slide9Cases       data={merged} e={handleEdit} step={9}  total={total} />,
    <Slide10Commercial data={merged} e={handleEdit} step={10} total={total} />,
    <Slide11Governance data={merged} e={handleEdit} step={11} total={total} />,
    <Slide12Next       data={merged} e={handleEdit} step={12} total={total} />,
  ];

  return (
    <>
      {slides.map((slide, i) => (
        <Slide16x9 key={i}>{slide}</Slide16x9>
      ))}
    </>
  );
};
