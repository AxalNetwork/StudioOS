/**
 * investor_appendix_app.tsx
 *
 * Institutional-grade fundraising presentation.
 *   Part I  — Core Investor Deck     (12 slides)
 *   Part II — Investor Appendix       (30 slides, sections A–I)
 *
 * Self-contained React + TypeScript + Tailwind + Framer Motion + Recharts.
 * SVG-only diagrams (no image assets). 16:9 export-ready.
 *
 * Axal VC binding: SAMPLE_DATA mirrors what heuristicSlides() in
 * cloudflare-worker/src/routes/decks.ts will autofill. Mapping at the
 * bottom of this file.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BrandProvider, useBrandContext } from '../DeckBase';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

/* ───────────────────────────── tokens ───────────────────────────── */

const C = {
  ink: '#0B1B2E',
  inkSoft: '#19314D',
  paper: '#FDFCFA',
  paperWarm: '#F5F2EC',
  paperDim: '#EEEAE0',
  line: '#D9D3C5',
  lineSoft: '#E8E3D5',
  text: '#0B1B2E',
  textSoft: '#445268',
  textMuted: '#8A8475',
  accent: '#7C1F2E', // editorial crimson
  accentSoft: '#F2E3E5',
  navy: '#0F3B6B',
  navySoft: '#DCE6F2',
  emerald: '#0F8A5F',
  emeraldSoft: '#D5EFE5',
  gold: '#A6791E',
  goldSoft: '#F2E5BF',
  amber: '#C8821D',
  amberSoft: '#FBEACD',
  rose: '#B0314A',
  roseSoft: '#F8DBE2',
};
const fontSerif = '"Source Serif Pro","Source Serif 4",Georgia,"Times New Roman",serif';
const fontSans = '"Inter","Helvetica Neue",Arial,system-ui,sans-serif';
const fontMono = '"JetBrains Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace';

/* ───────────────────────────── types ────────────────────────────── */

type ArrPoint = { month: string; arr_usd: number; mrr_usd: number; nrr_pct: number };
type CohortRow = { cohort: string; months: number[] }; // values 0..1
type ChannelPoint = { channel: string; mql: number; sql: number; closed: number };

export type InvestorData = {
  meta: {
    company_name: string;
    mark: string;
    tagline: string;
    round_label: string;
    confidential: string;
    presented_on: string;
    prepared_by: string;
  };
  vision: {
    eyebrow: string;
    future_state: string;
    mission: string;
    category: string;
    sentence: string;
  };
  problem: {
    headline: string;
    sub: string;
    pains: { area: string; pain: string; cost_label: string }[];
  };
  insight: {
    headline: string;
    sub: string;
    bullets: string[];
    why_now: string[];
  };
  solution: {
    headline: string;
    sub: string;
    before: string[];
    after: string[];
  };
  product: {
    headline: string;
    sub: string;
    layers: { name: string; detail: string }[];
    workflow: string[];
  };
  market: {
    headline: string;
    tam_usd: number;
    sam_usd: number;
    som_usd: number;
    sub: string;
    expansion: string[];
    cagr_pct: number;
  };
  traction: {
    headline: string;
    sub: string;
    arr_usd: number;
    arr_growth_pct: number;
    customers: number;
    nrr_pct: number;
    gross_margin_pct: number;
    monthly_arr: ArrPoint[];
    logos: string[];
    milestones: string[];
  };
  business_model: {
    headline: string;
    sub: string;
    streams: { name: string; pct: number; detail: string }[];
    tiers: { name: string; acv_usd: number; ratio_pct: number }[];
    cac_usd: number;
    ltv_usd: number;
    payback_months: number;
    gross_margin_pct: number;
  };
  gtm: {
    headline: string;
    sub: string;
    channels: ChannelPoint[];
    motion_steps: string[];
    expansion_plays: string[];
  };
  moat: {
    headline: string;
    sub: string;
    pillars: { name: string; score: number; note: string }[]; // 0..4
    competitors: string[];
    positioning: { name: string; x: number; y: number }[]; // 0..1
  };
  team: {
    headline: string;
    sub: string;
    members: { name: string; role: string; initials: string; previously: string; bio: string }[];
    advisors: string[];
    investors_existing: string[];
  };
  fundraise: {
    headline: string;
    sub: string;
    amount_usd: number;
    instrument: string;
    valuation_label: string;
    runway_months: number;
    use_of_funds: { label: string; pct: number }[];
    milestones: string[];
    closing_line: string;
    contact_email: string;
  };
  // ─── Appendix A — Market ───
  appendix_market: {
    landscape: { segment: string; size_usd: number; growth_pct: number }[];
    segmentation: { tier: string; share_pct: number; acv_usd: number }[];
    growth_drivers: { driver: string; weight_pct: number; detail: string }[];
    geos: { region: string; tam_usd: number; status: string }[];
  };
  // ─── Appendix B — Product ───
  appendix_product: {
    architecture_layers: { name: string; components: string[] }[];
    tech_stack: { layer: string; tools: string[] }[];
    data_arch: { stage: string; system: string; latency_ms: number }[];
    security_controls: { category: string; controls: string[] }[];
    roadmap: { quarter: string; theme: string; bullets: string[] }[];
  };
  // ─── Appendix C — Traction ───
  appendix_traction: {
    revenue_history: ArrPoint[]; // longer history
    cohorts: CohortRow[]; // dollar retention
    customer_growth: { month: string; new_logos: number; total: number }[];
    customer_seg: { segment: string; share_pct: number; arr_share_pct: number }[];
    pipeline: { stage: string; count: number; value_usd: number }[];
    usage: { metric: string; value: string; delta: string }[];
  };
  // ─── Appendix D — Customer insights ───
  appendix_customers: {
    profiles: { persona: string; segment: string; need: string }[];
    journey: { stage: string; what: string; metric: string }[];
    case_studies: { client: string; sector: string; outcome: string; metric: string; value: string }[];
    testimonials: { quote: string; author: string; role: string; company: string }[];
  };
  // ─── Appendix E — Unit economics ───
  appendix_unit_econ: {
    cac_breakdown: { source: string; cac_usd: number; share_pct: number }[];
    ltv_curve: { month: number; cumulative_usd: number }[];
    payback_by_segment: { segment: string; months: number }[];
    margin_layers: { layer: string; pct: number }[]; // stacked
  };
  // ─── Appendix F — Go-to-market ───
  appendix_gtm: {
    funnel_stages: { stage: string; count: number; conv_pct: number }[];
    channel_mix: { channel: string; share_pct: number; cac_usd: number; payback_months: number }[];
    partnerships: { partner: string; type: string; status: string }[];
  };
  // ─── Appendix G — Defensibility ───
  appendix_defensibility: {
    matrix_competitors: string[];
    matrix_criteria: { name: string; scores: number[] }[]; // first column = us
    moat_descriptions: { name: string; detail: string }[];
  };
  // ─── Appendix H — Team & operations ───
  appendix_team: {
    org_buckets: { name: string; current: number; year1: number; year3: number }[];
    leadership_gaps: string[];
    operating_principles: string[];
  };
  // ─── Appendix I — Financials ───
  appendix_financials: {
    pnl_summary: { line: string; year1_usd: number; year2_usd: number; year3_usd: number }[];
    hiring_plan: { function: string; current: number; year1: number; year2: number; year3: number }[];
    cash_flow: { month: string; cash_usd: number; burn_usd: number }[];
    capital_allocation: { bucket: string; pct: number }[];
  };
};

/* ───────────────────────────── utils ────────────────────────────── */

const usd = (n: number) => {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};

const intShort = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1e3).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `${n}`;
};

const setIn = <T,>(obj: T, path: (string | number)[], v: unknown): T => {
  const next = structuredClone(obj) as Record<string, unknown>;
  let cur: Record<string, unknown> = next as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i] as string] as Record<string, unknown>;
  cur[path[path.length - 1] as string] = v;
  return next as T;
};

/* ───────────────────────────── primitives ───────────────────────── */

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
    className={`outline-none focus:bg-yellow-50/70 rounded-sm px-0.5 ${className ?? ''}`}
    style={style}
  >
    {value}
  </span>
);

const SlideFrame: React.FC<{
  children: React.ReactNode;
  step: number;
  total: number;
  section: string;
  sectionRight?: string;
  bg?: string;
  textColor?: string;
}> = ({ children, step, total, section, sectionRight, bg = C.paper, textColor = C.text }) => (
  <div className="relative w-full h-full overflow-hidden" style={{ background: bg, color: textColor, fontFamily: fontSans }}>
    <div
      className="absolute top-0 left-0 right-0 h-11 flex items-center justify-between px-10 text-[10px] tracking-[0.22em] uppercase"
      style={{ color: C.textMuted, borderBottom: `1px solid ${C.lineSoft}` }}
    >
      <span style={{ fontFamily: fontSerif, fontStyle: 'italic', letterSpacing: '0.1em' }}>{section}</span>
      <span style={{ fontFamily: fontMono }}>{sectionRight ?? `${String(step).padStart(2, '0')} / ${String(total).padStart(2, '0')}`}</span>
    </div>
    <div className="absolute inset-x-0 top-11 bottom-9 px-10 py-6">{children}</div>
    <div
      className="absolute bottom-0 left-0 right-0 h-9 flex items-center justify-between px-10 text-[10px]"
      style={{ color: C.textMuted, borderTop: `1px solid ${C.lineSoft}` }}
    >
      <span>Confidential · Institutional distribution only</span>
      <span style={{ fontFamily: fontMono }}>
        {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
  </div>
);

const SectionLabel: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.accent }) => (
  <div className="flex items-center gap-2 mb-3">
    <div className="h-px w-8" style={{ background: color }} />
    <span className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color }}>
      {children}
    </span>
  </div>
);

const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 36 }) => (
  <h1 className="leading-[1.06] tracking-[-0.015em]" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: `${size}px`, color: C.ink }}>
    {children}
  </h1>
);

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-3 text-[13.5px] leading-snug max-w-[820px]" style={{ color: C.textSoft }}>
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
    <div className={`rounded-md ${className ?? ''}`} style={{ background: bg, border: `1px solid ${border}`, ...style }}>
      {children}
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; delta?: string; tone?: string }> = ({ label, value, delta, tone = C.accent }) => (
  <Card className="p-4 h-full" tone="soft">
    <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
      {label}
    </div>
    <div className="mt-2" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '28px', color: C.ink }}>
      {value}
    </div>
    {delta && (
      <div className="mt-1 text-[11px]" style={{ color: tone, fontFamily: fontMono }}>
        {delta}
      </div>
    )}
  </Card>
);

/* ───────────────────────────── charts ───────────────────────────── */

const ChartTip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md text-xs px-3 py-2" style={{ background: '#fff', border: `1px solid ${C.line}` }}>
      <div className="font-semibold mb-1" style={{ color: C.ink }}>
        {label}
      </div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2" style={{ color: C.textSoft }}>
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span style={{ color: C.ink, fontFamily: fontMono }}>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
};

const ArrAreaChart: React.FC<{ data: ArrPoint[]; height?: number }> = ({ data, height = 240 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
      <defs>
        <linearGradient id="arr-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity={0.35} />
          <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="month" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => usd(v)} />
      <Tooltip content={<ChartTip />} />
      <Area type="monotone" dataKey="arr_usd" name="ARR" stroke={C.accent} strokeWidth={2} fill="url(#arr-grad)" />
    </AreaChart>
  </ResponsiveContainer>
);

const NrrLine: React.FC<{ data: ArrPoint[]; height?: number }> = ({ data, height = 200 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
      <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="month" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} domain={[80, 'auto']} tickFormatter={(v) => `${v}%`} />
      <Tooltip content={<ChartTip />} />
      <Line type="monotone" dataKey="nrr_pct" name="NRR" stroke={C.navy} strokeWidth={2} dot={false} />
    </LineChart>
  </ResponsiveContainer>
);

const BarCompare: React.FC<{ data: ChannelPoint[]; height?: number }> = ({ data, height = 220 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
      <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="channel" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
      <Tooltip content={<ChartTip />} />
      <Bar dataKey="mql" name="MQL" fill={C.navySoft} radius={[2, 2, 0, 0]} />
      <Bar dataKey="sql" name="SQL" fill={C.navy} radius={[2, 2, 0, 0]} />
      <Bar dataKey="closed" name="Closed" fill={C.accent} radius={[2, 2, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
);

const MarketRings: React.FC<{ tam: number; sam: number; som: number }> = ({ tam, sam, som }) => {
  const tamR = 110;
  const samR = (Math.sqrt(sam / tam) || 0.6) * tamR;
  const somR = (Math.sqrt(som / tam) || 0.2) * tamR;
  return (
    <svg viewBox="-150 -150 300 300" className="w-full h-full">
      <circle cx="0" cy="0" r={tamR} fill={C.accent} fillOpacity={0.06} stroke={C.accent} strokeOpacity={0.4} />
      <circle cx="0" cy="0" r={samR} fill={C.accent} fillOpacity={0.18} stroke={C.accent} strokeOpacity={0.6} />
      <circle cx="0" cy="0" r={somR} fill={C.accent} stroke={C.accent} />
      <text y={-tamR - 8} textAnchor="middle" fontFamily={fontMono} fontSize="10" fill={C.textMuted}>
        TAM · {usd(tam)}
      </text>
      <text x={samR + 6} y="-4" fontFamily={fontMono} fontSize="10" fill={C.accent}>
        SAM · {usd(sam)}
      </text>
      <text x={somR + 4} y="4" fontFamily={fontMono} fontSize="10" fill="#fff">
        SOM · {usd(som)}
      </text>
    </svg>
  );
};

const CohortGrid: React.FC<{ rows: CohortRow[]; tone?: string }> = ({ rows, tone = C.accent }) => {
  const months = Math.max(...rows.map((r) => r.months.length));
  const cell = 22;
  const w = 80 + months * cell;
  const h = rows.length * cell + 30;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
      {Array.from({ length: months }).map((_, m) => (
        <text key={m} x={80 + m * cell + cell / 2} y="14" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
          M{m}
        </text>
      ))}
      {rows.map((r, ri) => (
        <g key={r.cohort}>
          <text x="70" y={30 + ri * cell + 13} textAnchor="end" fontFamily={fontMono} fontSize="9" fill={C.textSoft}>
            {r.cohort}
          </text>
          {r.months.map((v, ci) => (
            <g key={ci}>
              <rect
                x={80 + ci * cell + 1}
                y={26 + ri * cell + 1}
                width={cell - 2}
                height={cell - 2}
                rx="2"
                fill={tone}
                fillOpacity={Math.max(0.06, Math.min(1, v))}
              />
              <text
                x={80 + ci * cell + cell / 2}
                y={26 + ri * cell + cell / 2 + 3}
                textAnchor="middle"
                fontFamily={fontMono}
                fontSize="8"
                fill={v > 0.5 ? '#fff' : C.textSoft}
              >
                {Math.round(v * 100)}
              </text>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
};

const MoatPentagon: React.FC<{ pillars: { name: string; score: number }[] }> = ({ pillars }) => {
  const n = pillars.length;
  const cx = 160;
  const cy = 160;
  const R = 110;
  const pt = (i: number, mag: number) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + R * mag * Math.cos(ang), cy + R * mag * Math.sin(ang)];
  };
  const polyPts = pillars.map((p, i) => pt(i, p.score / 4).join(',')).join(' ');
  return (
    <svg viewBox="0 0 320 320" className="w-full h-full">
      {[0.25, 0.5, 0.75, 1].map((m, i) => {
        const pts = Array.from({ length: n })
          .map((_, j) => pt(j, m).join(','))
          .join(' ');
        return <polygon key={i} points={pts} fill="none" stroke={C.lineSoft} />;
      })}
      <polygon points={polyPts} fill={C.accent} fillOpacity={0.22} stroke={C.accent} strokeWidth={2} />
      {pillars.map((p, i) => {
        const [x, y] = pt(i, 1.18);
        return (
          <g key={p.name}>
            <text x={x} y={y} textAnchor="middle" fontFamily={fontSans} fontSize="11" fontWeight={600} fill={C.ink}>
              {p.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const PositioningMap: React.FC<{ points: { name: string; x: number; y: number }[] }> = ({ points }) => (
  <svg viewBox="0 0 360 320" className="w-full h-full">
    <rect x="20" y="20" width="320" height="280" fill={C.paperWarm} stroke={C.line} />
    <line x1="180" y1="20" x2="180" y2="300" stroke={C.line} />
    <line x1="20" y1="160" x2="340" y2="160" stroke={C.line} />
    <text x="180" y="14" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
      Breadth →
    </text>
    <text x="14" y="160" textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.textMuted} transform="rotate(-90, 14, 160)">
      Depth →
    </text>
    {points.map((p, i) => {
      const x = 30 + p.x * 300;
      const y = 290 - p.y * 270;
      const us = p.name === 'Us';
      return (
        <g key={i}>
          <circle cx={x} cy={y} r={us ? 12 : 8} fill={us ? C.accent : '#fff'} stroke={us ? C.accent : C.textMuted} strokeWidth={us ? 2 : 1.5} />
          <text x={x + 16} y={y + 4} fontFamily={fontSans} fontSize="10" fontWeight={us ? 700 : 500} fill={C.ink}>
            {p.name}
          </text>
        </g>
      );
    })}
  </svg>
);

const Flywheel: React.FC<{ spokes: string[] }> = ({ spokes }) => {
  const cx = 180;
  const cy = 180;
  return (
    <svg viewBox="0 0 360 360" className="w-full h-full">
      <circle cx={cx} cy={cy} r="100" fill="none" stroke={C.line} />
      <circle cx={cx} cy={cy} r="40" fill={C.accent} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontFamily={fontSerif} fontWeight={700} fontSize="13" fill="#fff">
        Flywheel
      </text>
      {spokes.map((s, i) => {
        const ang = (i / spokes.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + 100 * Math.cos(ang);
        const y = cy + 100 * Math.sin(ang);
        const lx = cx + 142 * Math.cos(ang);
        const ly = cy + 142 * Math.sin(ang);
        return (
          <g key={s}>
            <circle cx={x} cy={y} r="18" fill="#fff" stroke={C.accent} strokeWidth={2} />
            <text x={x} y={y + 4} textAnchor="middle" fontFamily={fontMono} fontWeight={700} fontSize="10" fill={C.accent}>
              {i + 1}
            </text>
            <text x={lx} y={ly} textAnchor="middle" fontFamily={fontSans} fontSize="10" fill={C.ink}>
              {s}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const Funnel: React.FC<{ stages: { stage: string; count: number; conv_pct: number }[] }> = ({ stages }) => {
  const max = Math.max(...stages.map((s) => s.count));
  const w = 540;
  const rowH = 38;
  return (
    <svg viewBox={`0 0 ${w} ${stages.length * rowH + 20}`} className="w-full h-full">
      {stages.map((s, i) => {
        const ratio = s.count / max;
        const bw = ratio * (w - 200);
        const y = 10 + i * rowH;
        return (
          <g key={s.stage}>
            <rect x={(w - 200 - bw) / 2 + 100} y={y} width={bw} height={rowH - 8} rx="4" fill={C.accent} fillOpacity={0.85 - i * 0.12} />
            <text x="14" y={y + 22} fontFamily={fontSans} fontSize="11" fill={C.ink}>
              {s.stage}
            </text>
            <text x={w - 100} y={y + 22} fontFamily={fontMono} fontSize="10" fill={C.textSoft}>
              {intShort(s.count)} · {s.conv_pct}%
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const DonutChart: React.FC<{ slices: { label: string; pct: number; color?: string }[] }> = ({ slices }) => {
  const cx = 110;
  const cy = 110;
  const r = 80;
  const ir = 50;
  let acc = 0;
  const palette = [C.accent, C.navy, C.gold, C.emerald, C.amber, C.rose];
  return (
    <svg viewBox="0 0 220 220" className="w-full h-full">
      {slices.map((s, i) => {
        const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
        acc += s.pct;
        const end = (acc / 100) * Math.PI * 2 - Math.PI / 2;
        const large = s.pct > 50 ? 1 : 0;
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const xi1 = cx + ir * Math.cos(end);
        const yi1 = cy + ir * Math.sin(end);
        const xi2 = cx + ir * Math.cos(start);
        const yi2 = cy + ir * Math.sin(start);
        const fill = s.color || palette[i % palette.length];
        return (
          <path
            key={i}
            d={`M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${xi1},${yi1} A${ir},${ir} 0 ${large},0 ${xi2},${yi2} Z`}
            fill={fill}
          />
        );
      })}
    </svg>
  );
};

/* ───────────────────────────── Part I — Core deck ────────────────── */

type Edit = (p: (string | number)[], v: string) => void;

const S1Vision: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Vision">
    <div className="grid grid-cols-12 gap-8 h-full">
      <div className="col-span-7 flex flex-col">
        <SectionLabel>
          <Editable value={d.vision.eyebrow} path={['vision', 'eyebrow']} onEdit={e} />
        </SectionLabel>
        <Title size={42}>
          <Editable value={d.vision.future_state} path={['vision', 'future_state']} onEdit={e} />
        </Title>
        <Sub>
          <Editable value={d.vision.mission} path={['vision', 'mission']} onEdit={e} multiline />
        </Sub>
        <Card className="mt-auto p-5" tone="accent">
          <div className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: C.accent }}>
            Category we are creating
          </div>
          <div className="mt-1 font-semibold" style={{ fontFamily: fontSerif, fontSize: '22px', color: C.ink }}>
            <Editable value={d.vision.category} path={['vision', 'category']} onEdit={e} />
          </div>
          <div className="mt-3 text-[14px] leading-snug" style={{ color: C.ink }}>
            <Editable value={d.vision.sentence} path={['vision', 'sentence']} onEdit={e} multiline />
          </div>
        </Card>
      </div>
      <Card className="col-span-5 p-6 flex flex-col justify-between" tone="soft">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: C.textMuted }}>
            <Editable value={d.meta.round_label} path={['meta', 'round_label']} onEdit={e} />
          </div>
          <div className="mt-2" style={{ fontFamily: fontSerif, fontSize: '40px', fontWeight: 600, color: C.ink }}>
            <Editable value={d.meta.company_name} path={['meta', 'company_name']} onEdit={e} />
          </div>
          <div className="mt-1 text-[13px]" style={{ color: C.textSoft }}>
            <Editable value={d.meta.tagline} path={['meta', 'tagline']} onEdit={e} />
          </div>
        </div>
        <svg viewBox="0 0 320 240" className="my-4">
          <defs>
            <radialGradient id="vision-g" cx="50%" cy="50%">
              <stop offset="0" stopColor={C.accent} stopOpacity={0.7} />
              <stop offset="1" stopColor={C.accent} stopOpacity={0.05} />
            </radialGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} cx="160" cy="120" r={40 + i * 30} fill="none" stroke={C.accent} strokeOpacity={0.5 - i * 0.1} />
          ))}
          <circle cx="160" cy="120" r="36" fill="url(#vision-g)" />
          <text x="160" y="125" textAnchor="middle" fontFamily={fontSerif} fontWeight={700} fontSize="28" fill="#fff">
            {d.meta.mark}
          </text>
        </svg>
        <div className="text-[10px] flex justify-between" style={{ color: C.textMuted }}>
          <span>
            <Editable value={d.meta.prepared_by} path={['meta', 'prepared_by']} onEdit={e} />
          </span>
          <span style={{ fontFamily: fontMono }}>
            <Editable value={d.meta.presented_on} path={['meta', 'presented_on']} onEdit={e} />
          </span>
        </div>
      </Card>
    </div>
  </SlideFrame>
);

const S2Problem: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Problem">
    <SectionLabel color={C.rose}>The problem</SectionLabel>
    <Title>
      <Editable value={d.problem.headline} path={['problem', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.problem.sub} path={['problem', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-3 gap-4">
      {d.problem.pains.map((p, i) => (
        <Card key={i} className="p-5" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.rose }}>
            <Editable value={p.area} path={['problem', 'pains', i, 'area']} onEdit={e} />
          </div>
          <div className="mt-2 text-[14px] font-semibold leading-snug" style={{ color: C.ink }}>
            <Editable value={p.pain} path={['problem', 'pains', i, 'pain']} onEdit={e} multiline />
          </div>
          <div className="mt-4 pt-3 border-t text-[11px]" style={{ borderColor: C.line, color: C.textMuted }}>
            <Editable value={p.cost_label} path={['problem', 'pains', i, 'cost_label']} onEdit={e} />
          </div>
        </Card>
      ))}
    </div>
  </SlideFrame>
);

const S3Insight: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Insight">
    <SectionLabel color={C.gold}>Our non-consensus insight</SectionLabel>
    <Title>
      <Editable value={d.insight.headline} path={['insight', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.insight.sub} path={['insight', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <div className="col-span-7 space-y-3">
        {d.insight.bullets.map((b, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div
              className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold mt-0.5"
              style={{ background: C.goldSoft, color: C.gold, fontFamily: fontMono }}
            >
              {String(i + 1).padStart(2, '0')}
            </div>
            <div className="text-[14px] leading-snug" style={{ color: C.ink }}>
              <Editable value={b} path={['insight', 'bullets', i]} onEdit={e} multiline />
            </div>
          </div>
        ))}
      </div>
      <Card className="col-span-5 p-5" tone="accent">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: C.accent }}>
          Why now
        </div>
        <ul className="space-y-2 text-[12px]">
          {d.insight.why_now.map((w, i) => (
            <li key={i} className="flex gap-2" style={{ color: C.ink }}>
              <span style={{ color: C.accent }}>·</span>
              <Editable value={w} path={['insight', 'why_now', i]} onEdit={e} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  </SlideFrame>
);

const S4Solution: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Solution">
    <SectionLabel>Our solution</SectionLabel>
    <Title>
      <Editable value={d.solution.headline} path={['solution', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.solution.sub} path={['solution', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-2 gap-6">
      {[
        { title: 'Before', items: d.solution.before, color: C.rose, key: 'before' as const },
        { title: 'After', items: d.solution.after, color: C.emerald, key: 'after' as const },
      ].map((b) => (
        <Card key={b.key} className="p-5" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: b.color }}>
            {b.title}
          </div>
          <ul className="space-y-2">
            {b.items.map((it, ii) => (
              <li key={ii} className="flex gap-2 text-[13px]" style={{ color: b.title === 'Before' ? C.textSoft : C.ink }}>
                <span style={{ color: b.color }}>{b.title === 'Before' ? '·' : '✓'}</span>
                <Editable value={it} path={['solution', b.key, ii]} onEdit={e} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  </SlideFrame>
);

const S5Product: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Product">
    <SectionLabel>Product architecture</SectionLabel>
    <Title>
      <Editable value={d.product.headline} path={['product', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.product.sub} path={['product', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <div className="col-span-7 space-y-2">
        {d.product.layers.map((l, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded" style={{ background: C.paperWarm, border: `1px solid ${C.line}` }}>
            <div
              className="shrink-0 w-9 h-9 rounded flex items-center justify-center text-[11px] font-bold"
              style={{ background: i === 0 ? C.accent : C.accentSoft, color: i === 0 ? '#fff' : C.accent, fontFamily: fontMono }}
            >
              L{i + 1}
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold" style={{ color: C.ink }}>
                <Editable value={l.name} path={['product', 'layers', i, 'name']} onEdit={e} />
              </div>
              <div className="text-[11px]" style={{ color: C.textSoft }}>
                <Editable value={l.detail} path={['product', 'layers', i, 'detail']} onEdit={e} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <Card className="col-span-5 p-5" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: C.accent }}>
          Workflow
        </div>
        <ol className="space-y-2 text-[12px]">
          {d.product.workflow.map((w, i) => (
            <li key={i} className="flex gap-2" style={{ color: C.ink }}>
              <span className="font-bold" style={{ color: C.accent, fontFamily: fontMono }}>
                {i + 1}.
              </span>
              <Editable value={w} path={['product', 'workflow', i]} onEdit={e} />
            </li>
          ))}
        </ol>
      </Card>
    </div>
  </SlideFrame>
);

const S6Market: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Market">
    <div className="grid grid-cols-12 gap-8 h-full">
      <div className="col-span-6 flex flex-col">
        <SectionLabel>Market opportunity</SectionLabel>
        <Title>
          <Editable value={d.market.headline} path={['market', 'headline']} onEdit={e} />
        </Title>
        <Sub>
          <Editable value={d.market.sub} path={['market', 'sub']} onEdit={e} multiline />
        </Sub>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Kpi label="TAM" value={usd(d.market.tam_usd)} />
          <Kpi label="SAM" value={usd(d.market.sam_usd)} />
          <Kpi label="SOM" value={usd(d.market.som_usd)} delta={`CAGR ${d.market.cagr_pct}%`} tone={C.emerald} />
        </div>
        <Card className="mt-4 p-4" tone="accent">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            Expansion paths
          </div>
          <div className="text-[12px] mt-1" style={{ color: C.ink }}>
            {d.market.expansion.join(' · ')}
          </div>
        </Card>
      </div>
      <div className="col-span-6 flex items-center justify-center">
        <div className="w-full h-[80%]">
          <MarketRings tam={d.market.tam_usd} sam={d.market.sam_usd} som={d.market.som_usd} />
        </div>
      </div>
    </div>
  </SlideFrame>
);

const S7Traction: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Traction">
    <SectionLabel color={C.emerald}>Traction</SectionLabel>
    <Title>
      <Editable value={d.traction.headline} path={['traction', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.traction.sub} path={['traction', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-12 gap-4">
      <div className="col-span-4 space-y-3">
        <Kpi label="ARR" value={usd(d.traction.arr_usd)} delta={`+${d.traction.arr_growth_pct}% YoY`} tone={C.emerald} />
        <Kpi label="Customers" value={intShort(d.traction.customers)} />
        <Kpi label="NRR" value={`${d.traction.nrr_pct}%`} delta="best-in-class" tone={C.emerald} />
        <Kpi label="Gross margin" value={`${d.traction.gross_margin_pct}%`} />
      </div>
      <Card className="col-span-8 p-4" tone="plain">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold" style={{ color: C.ink }}>
            ARR — last {d.traction.monthly_arr.length} months
          </div>
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold px-2 py-1 rounded" style={{ background: C.emeraldSoft, color: C.emerald }}>
            ▲ {d.traction.arr_growth_pct}% YoY
          </span>
        </div>
        <ArrAreaChart data={d.traction.monthly_arr} height={220} />
        <div className="mt-2 pt-2 border-t flex items-center flex-wrap gap-2" style={{ borderColor: C.line }}>
          <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
            Customers
          </span>
          {d.traction.logos.map((l, i) => (
            <span key={i} className="px-2 py-0.5 rounded text-[11px] font-semibold" style={{ background: C.paperWarm, color: C.textSoft, fontFamily: fontSerif }}>
              <Editable value={l} path={['traction', 'logos', i]} onEdit={e} />
            </span>
          ))}
        </div>
      </Card>
    </div>
  </SlideFrame>
);

const S8BusinessModel: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Business Model">
    <SectionLabel>Business model</SectionLabel>
    <Title>
      <Editable value={d.business_model.headline} path={['business_model', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.business_model.sub} path={['business_model', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-12 gap-6">
      <Card className="col-span-5 p-5" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: C.accent }}>
          Revenue streams
        </div>
        <div className="h-[180px] flex">
          <div className="w-1/2">
            <DonutChart slices={d.business_model.streams.map((s) => ({ label: s.name, pct: s.pct }))} />
          </div>
          <div className="w-1/2 flex flex-col justify-center space-y-1.5">
            {d.business_model.streams.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full" style={{ background: [C.accent, C.navy, C.gold, C.emerald, C.amber][i] }} />
                <span style={{ color: C.ink, fontWeight: 500 }}>
                  <Editable value={s.name} path={['business_model', 'streams', i, 'name']} onEdit={e} />
                </span>
                <span className="ml-auto" style={{ color: C.textSoft, fontFamily: fontMono }}>
                  {s.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Card className="col-span-4 p-5" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: C.accent }}>
          Tiers · avg ACV
        </div>
        <table className="w-full text-[12px]">
          <tbody>
            {d.business_model.tiers.map((t, i) => (
              <tr key={i} className="border-b last:border-b-0" style={{ borderColor: C.line }}>
                <td className="py-2 font-medium" style={{ color: C.ink }}>
                  <Editable value={t.name} path={['business_model', 'tiers', i, 'name']} onEdit={e} />
                </td>
                <td className="py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {usd(t.acv_usd)}
                </td>
                <td className="py-2 text-right" style={{ color: C.textMuted, fontFamily: fontMono }}>
                  {t.ratio_pct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="col-span-3 grid grid-cols-1 gap-2">
        <Kpi label="CAC" value={usd(d.business_model.cac_usd)} />
        <Kpi label="LTV" value={usd(d.business_model.ltv_usd)} delta={`${(d.business_model.ltv_usd / d.business_model.cac_usd).toFixed(1)}× CAC`} tone={C.emerald} />
        <Kpi label="Payback" value={`${d.business_model.payback_months}mo`} />
      </div>
    </div>
  </SlideFrame>
);

const S9Gtm: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Go-to-market">
    <SectionLabel>Go-to-market</SectionLabel>
    <Title>
      <Editable value={d.gtm.headline} path={['gtm', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.gtm.sub} path={['gtm', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-12 gap-6">
      <Card className="col-span-7 p-4" tone="plain">
        <div className="text-[11px] font-semibold mb-2" style={{ color: C.ink }}>
          Channel performance
        </div>
        <BarCompare data={d.gtm.channels} height={220} />
      </Card>
      <div className="col-span-5 space-y-3">
        <Card className="p-4" tone="soft">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            Sales motion
          </div>
          <ol className="space-y-1 text-[12px]">
            {d.gtm.motion_steps.map((s, i) => (
              <li key={i} className="flex gap-2" style={{ color: C.ink }}>
                <span style={{ color: C.accent, fontFamily: fontMono, fontWeight: 700 }}>{i + 1}.</span>
                <Editable value={s} path={['gtm', 'motion_steps', i]} onEdit={e} />
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-4" tone="accent">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            Expansion plays
          </div>
          <ul className="space-y-1 text-[12px]">
            {d.gtm.expansion_plays.map((p, i) => (
              <li key={i} className="flex gap-2" style={{ color: C.ink }}>
                <span style={{ color: C.accent }}>·</span>
                <Editable value={p} path={['gtm', 'expansion_plays', i]} onEdit={e} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  </SlideFrame>
);

const S10Moat: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Competition & Moat">
    <SectionLabel>Competition & moat</SectionLabel>
    <Title>
      <Editable value={d.moat.headline} path={['moat', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.moat.sub} path={['moat', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-12 gap-6">
      <Card className="col-span-5 p-3" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2 px-2 pt-2" style={{ color: C.accent }}>
          Moat pillars
        </div>
        <div className="h-[260px]">
          <MoatPentagon pillars={d.moat.pillars} />
        </div>
      </Card>
      <Card className="col-span-4 p-3" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2 px-2 pt-2" style={{ color: C.accent }}>
          Positioning
        </div>
        <div className="h-[260px]">
          <PositioningMap points={d.moat.positioning} />
        </div>
      </Card>
      <div className="col-span-3 space-y-2">
        {d.moat.pillars.map((p, i) => (
          <Card key={i} className="p-3" tone="plain">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold" style={{ color: C.ink }}>
                <Editable value={p.name} path={['moat', 'pillars', i, 'name']} onEdit={e} />
              </span>
              <span className="text-[10px] font-bold" style={{ color: C.accent, fontFamily: fontMono }}>
                {p.score}/4
              </span>
            </div>
            <div className="text-[10px]" style={{ color: C.textSoft }}>
              <Editable value={p.note} path={['moat', 'pillars', i, 'note']} onEdit={e} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  </SlideFrame>
);

const S11Team: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Team">
    <SectionLabel>Team</SectionLabel>
    <Title>
      <Editable value={d.team.headline} path={['team', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={d.team.sub} path={['team', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-3 gap-4">
      {d.team.members.map((m, i) => (
        <Card key={i} className="p-5" tone="plain">
          <div
            className="w-16 h-16 rounded flex items-center justify-center mb-3"
            style={{
              background: `linear-gradient(135deg, ${C.accent} 0%, ${[C.navy, C.gold, C.emerald][i % 3]} 100%)`,
              color: '#fff',
              fontFamily: fontSerif,
              fontWeight: 700,
              fontSize: 24,
            }}
          >
            {m.initials}
          </div>
          <div className="text-[16px] font-semibold" style={{ color: C.ink, fontFamily: fontSerif }}>
            <Editable value={m.name} path={['team', 'members', i, 'name']} onEdit={e} />
          </div>
          <div className="text-[11px] font-medium" style={{ color: C.accent }}>
            <Editable value={m.role} path={['team', 'members', i, 'role']} onEdit={e} />
          </div>
          <div className="text-[11px] mt-2" style={{ color: C.textSoft }}>
            <Editable value={m.bio} path={['team', 'members', i, 'bio']} onEdit={e} multiline />
          </div>
          <div className="mt-3 pt-3 border-t text-[10px] uppercase tracking-[0.14em]" style={{ borderColor: C.line, color: C.textMuted }}>
            Previously
          </div>
          <div className="text-[11px] font-medium" style={{ color: C.ink }}>
            <Editable value={m.previously} path={['team', 'members', i, 'previously']} onEdit={e} />
          </div>
        </Card>
      ))}
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Card className="p-3" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-1" style={{ color: C.accent }}>
          Advisors
        </div>
        <div className="text-[12px]" style={{ color: C.ink }}>
          {d.team.advisors.join(' · ')}
        </div>
      </Card>
      <Card className="p-3" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-1" style={{ color: C.accent }}>
          Existing investors
        </div>
        <div className="text-[12px]" style={{ color: C.ink }}>
          {d.team.investors_existing.join(' · ')}
        </div>
      </Card>
    </div>
  </SlideFrame>
);

const S12Fundraise: React.FC<{ d: InvestorData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Fundraise" bg={C.ink} textColor="#fff">
    <div className="grid grid-cols-12 gap-8 h-full">
      <div className="col-span-7 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px w-8" style={{ background: C.goldSoft }} />
          <span className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: C.goldSoft }}>
            We are raising
          </span>
        </div>
        <div style={{ fontFamily: fontSerif, fontSize: '88px', fontWeight: 600, lineHeight: 1, color: '#fff' }}>
          {usd(d.fundraise.amount_usd)}
        </div>
        <div className="mt-3 text-[16px]" style={{ color: '#C7D3E8' }}>
          <Editable value={d.fundraise.instrument} path={['fundraise', 'instrument']} onEdit={e} /> ·{' '}
          <Editable value={d.fundraise.valuation_label} path={['fundraise', 'valuation_label']} onEdit={e} /> · {d.fundraise.runway_months}-month
          runway
        </div>
        <h2 className="mt-10 leading-[1.06]" style={{ fontFamily: fontSerif, fontSize: '28px', fontWeight: 600 }}>
          <Editable value={d.fundraise.headline} path={['fundraise', 'headline']} onEdit={e} />
        </h2>
        <p className="mt-3 text-[13px]" style={{ color: '#A9BBD6' }}>
          <Editable value={d.fundraise.sub} path={['fundraise', 'sub']} onEdit={e} multiline />
        </p>
        <div className="mt-auto pt-6 text-[16px]" style={{ fontFamily: fontSerif, fontStyle: 'italic', color: '#FFE4B0' }}>
          <Editable value={d.fundraise.closing_line} path={['fundraise', 'closing_line']} onEdit={e} multiline />
        </div>
        <div className="mt-2 text-[12px]" style={{ color: '#A9BBD6' }}>
          <Editable value={d.fundraise.contact_email} path={['fundraise', 'contact_email']} onEdit={e} />
        </div>
      </div>
      <div className="col-span-5 grid grid-rows-2 gap-4">
        <div className="rounded p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: '#7E92B3' }}>
            Use of funds
          </div>
          <div className="space-y-2">
            {d.fundraise.use_of_funds.map((u, i) => (
              <div key={i}>
                <div className="flex justify-between text-[12px]">
                  <span>
                    <Editable value={u.label} path={['fundraise', 'use_of_funds', i, 'label']} onEdit={e} />
                  </span>
                  <span style={{ fontFamily: fontMono, color: '#C7D3E8' }}>{u.pct}%</span>
                </div>
                <div className="h-1.5 mt-1 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded" style={{ width: `${u.pct}%`, background: C.gold }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: '#7E92B3' }}>
            Milestones
          </div>
          <ul className="space-y-1.5 text-[12px]">
            {d.fundraise.milestones.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: C.gold }}>·</span>
                <Editable value={m} path={['fundraise', 'milestones', i]} onEdit={e} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </SlideFrame>
);

/* ───────────────────── Appendix shells ─────────────────────────── */

const AppendixDivider: React.FC<{ letter: string; title: string; step: number; total: number }> = ({ letter, title, step, total }) => (
  <SlideFrame step={step} total={total} section="Appendix" bg={C.paperWarm}>
    <div className="h-full flex flex-col justify-center">
      <div className="text-[10px] uppercase tracking-[0.32em] font-semibold" style={{ color: C.accent }}>
        Section {letter}
      </div>
      <div style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '64px', color: C.ink, lineHeight: 1.06 }}>{title}</div>
      <div className="h-px w-24 mt-6" style={{ background: C.accent }} />
    </div>
  </SlideFrame>
);

const AppendixSlide: React.FC<{
  step: number;
  total: number;
  letter: string;
  title: string;
  children: React.ReactNode;
}> = ({ step, total, letter, title, children }) => (
  <SlideFrame step={step} total={total} section={`Appendix · ${letter}`} sectionRight={letter}>
    <div className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: C.accent }}>
      {letter}
    </div>
    <Title size={28}>{title}</Title>
    <div className="mt-4">{children}</div>
  </SlideFrame>
);

/* ─── A1–A4 Market ─── */

const A1Landscape: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A1" title="Industry landscape">
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-7 p-4" tone="plain">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={d.appendix_market.landscape}>
            <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="segment" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => usd(v)} />
            <Tooltip content={<ChartTip />} />
            <Bar dataKey="size_usd" name="Segment size" fill={C.accent} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card className="col-span-5 p-4" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
          Growth by segment
        </div>
        <div className="space-y-1.5 text-[12px]">
          {d.appendix_market.landscape.map((l, i) => (
            <div key={i} className="flex justify-between border-b last:border-b-0 py-1" style={{ borderColor: C.line }}>
              <span style={{ color: C.ink }}>{l.segment}</span>
              <span style={{ color: C.emerald, fontFamily: fontMono }}>+{l.growth_pct}%</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  </AppendixSlide>
);

const A2Segmentation: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A2" title="Market segmentation">
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-5 p-4" tone="plain">
        <div className="h-[240px]">
          <DonutChart slices={d.appendix_market.segmentation.map((s) => ({ label: s.tier, pct: s.share_pct }))} />
        </div>
      </Card>
      <Card className="col-span-7 p-4" tone="plain">
        <table className="w-full text-[12px]">
          <thead style={{ background: C.paperWarm }}>
            <tr>
              <th className="text-left px-3 py-2" style={{ color: C.textMuted }}>
                Tier
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Share
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Avg ACV
              </th>
            </tr>
          </thead>
          <tbody>
            {d.appendix_market.segmentation.map((s, i) => (
              <tr key={i} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-3 py-2 font-medium" style={{ color: C.ink }}>
                  {s.tier}
                </td>
                <td className="px-3 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {s.share_pct}%
                </td>
                <td className="px-3 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {usd(s.acv_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  </AppendixSlide>
);

const A3Drivers: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A3" title="Market growth drivers">
    <div className="grid grid-cols-2 gap-3">
      {d.appendix_market.growth_drivers.map((g, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold" style={{ color: C.ink }}>
              {g.driver}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: C.accentSoft, color: C.accent, fontFamily: fontMono }}>
              {g.weight_pct}%
            </span>
          </div>
          <div className="h-1.5 rounded mb-2" style={{ background: C.paperDim }}>
            <div className="h-full rounded" style={{ width: `${g.weight_pct}%`, background: C.accent }} />
          </div>
          <div className="text-[11px]" style={{ color: C.textSoft }}>
            {g.detail}
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

const A4Geo: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A4" title="Geographic expansion opportunities">
    <Card className="p-0" tone="plain">
      <table className="w-full text-[12px]">
        <thead style={{ background: C.paperWarm }}>
          <tr>
            <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
              Region
            </th>
            <th className="text-right px-4 py-2" style={{ color: C.textMuted }}>
              TAM
            </th>
            <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {d.appendix_market.geos.map((g, i) => (
            <tr key={i} className="border-t" style={{ borderColor: C.line }}>
              <td className="px-4 py-2 font-medium" style={{ color: C.ink }}>
                {g.region}
              </td>
              <td className="px-4 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                {usd(g.tam_usd)}
              </td>
              <td className="px-4 py-2">
                <span
                  className="px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.14em] font-semibold"
                  style={{
                    background:
                      g.status === 'Live' ? C.emeraldSoft : g.status === 'Scaling' ? C.amberSoft : C.paperWarm,
                    color:
                      g.status === 'Live' ? C.emerald : g.status === 'Scaling' ? C.amber : C.textSoft,
                  }}
                >
                  {g.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </AppendixSlide>
);

/* ─── A5–A9 Product ─── */

const A5Arch: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A5" title="Detailed product architecture">
    <div className="space-y-2">
      {d.appendix_product.architecture_layers.map((l, i) => (
        <Card key={i} className="p-3" tone="plain">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded flex items-center justify-center text-[11px] font-bold"
              style={{ background: C.accent + (i === 0 ? '' : '22'), color: i === 0 ? '#fff' : C.accent, fontFamily: fontMono }}
            >
              L{i + 1}
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold" style={{ color: C.ink }}>
                {l.name}
              </div>
              <div className="text-[11px]" style={{ color: C.textSoft }}>
                {l.components.join(' · ')}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

const A6Tech: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A6" title="Technology stack">
    <div className="grid grid-cols-2 gap-3">
      {d.appendix_product.tech_stack.map((s, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            {s.layer}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.tools.map((t, ti) => (
              <span
                key={ti}
                className="px-2 py-0.5 rounded text-[11px] font-medium"
                style={{ background: C.paperWarm, color: C.ink, border: `1px solid ${C.line}`, fontFamily: fontMono }}
              >
                {t}
              </span>
            ))}
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

const A7Data: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A7" title="Data architecture">
    <Card className="p-4" tone="plain">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${d.appendix_product.data_arch.length}, 1fr)` }}>
        {d.appendix_product.data_arch.map((s, i, arr) => (
          <div key={i} className="relative flex flex-col items-center text-center px-2">
            <div
              className="w-14 h-14 rounded flex items-center justify-center text-[11px] font-bold mb-2"
              style={{ background: C.accentSoft, color: C.accent, fontFamily: fontMono }}
            >
              {i + 1}
            </div>
            <div className="text-[12px] font-semibold" style={{ color: C.ink }}>
              {s.stage}
            </div>
            <div className="text-[10px] mt-1" style={{ color: C.textSoft }}>
              {s.system}
            </div>
            <div className="text-[10px] mt-1" style={{ color: C.emerald, fontFamily: fontMono }}>
              {s.latency_ms} ms
            </div>
            {i < arr.length - 1 && (
              <div className="absolute top-7 right-0 w-2 h-px" style={{ background: C.accent }} />
            )}
          </div>
        ))}
      </div>
    </Card>
  </AppendixSlide>
);

const A8Sec: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A8" title="Security architecture">
    <div className="grid grid-cols-2 gap-3">
      {d.appendix_product.security_controls.map((c, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
            {c.category}
          </div>
          <ul className="space-y-1 text-[11px]">
            {c.controls.map((ct, ci) => (
              <li key={ci} className="flex gap-2" style={{ color: C.ink }}>
                <span style={{ color: C.emerald }}>✓</span>
                {ct}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

const A9Roadmap: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A9" title="Product roadmap">
    <div className="grid grid-cols-4 gap-3">
      {d.appendix_product.roadmap.map((r, i) => (
        <div key={i} className="rounded overflow-hidden border" style={{ borderColor: C.line }}>
          <div
            className="px-3 py-2 text-[11px] font-semibold text-white"
            style={{ background: [C.accent, C.navy, C.gold, C.emerald][i % 4] }}
          >
            {r.quarter} · {r.theme}
          </div>
          <div className="p-3" style={{ background: '#fff' }}>
            <ul className="text-[11px] space-y-1">
              {r.bullets.map((b, bi) => (
                <li key={bi} style={{ color: C.ink }}>
                  · {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  </AppendixSlide>
);

/* ─── A10–A15 Traction ─── */

const A10RevHistory: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A10" title="Revenue history">
    <Card className="p-4" tone="plain">
      <ArrAreaChart data={d.appendix_traction.revenue_history} height={300} />
    </Card>
  </AppendixSlide>
);

const A11Cohorts: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A11" title="Revenue retention cohorts">
    <Card className="p-4" tone="plain">
      <div className="h-[300px]">
        <CohortGrid rows={d.appendix_traction.cohorts} />
      </div>
      <div className="text-[10px] uppercase tracking-[0.18em] mt-2" style={{ color: C.textMuted }}>
        % of M0 dollar value retained · darker = stronger retention
      </div>
    </Card>
  </AppendixSlide>
);

const A12CustomerGrowth: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A12" title="Customer growth">
    <Card className="p-4" tone="plain">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={d.appendix_traction.customer_growth}>
          <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="r" orientation="right" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip />} />
          <Bar yAxisId="l" dataKey="new_logos" name="New logos" fill={C.navy} radius={[2, 2, 0, 0]} />
          <Line yAxisId="r" type="monotone" dataKey="total" name="Total customers" stroke={C.accent} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  </AppendixSlide>
);

const A13Seg: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A13" title="Customer segmentation">
    <Card className="p-4" tone="plain">
      <div className="space-y-3">
        {d.appendix_traction.customer_seg.map((s, i) => (
          <div key={i}>
            <div className="flex justify-between text-[12px] mb-1">
              <span style={{ color: C.ink, fontWeight: 600 }}>{s.segment}</span>
              <span style={{ color: C.textSoft, fontFamily: fontMono }}>
                {s.share_pct}% of logos · {s.arr_share_pct}% of ARR
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="h-2 rounded" style={{ background: C.paperDim }}>
                <div className="h-full rounded" style={{ width: `${s.share_pct}%`, background: C.navy }} />
              </div>
              <div className="h-2 rounded" style={{ background: C.paperDim }}>
                <div className="h-full rounded" style={{ width: `${s.arr_share_pct}%`, background: C.accent }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  </AppendixSlide>
);

const A14Pipeline: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A14" title="Pipeline development">
    <Card className="p-0" tone="plain">
      <table className="w-full text-[12px]">
        <thead style={{ background: C.paperWarm }}>
          <tr>
            <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
              Stage
            </th>
            <th className="text-right px-4 py-2" style={{ color: C.textMuted }}>
              Count
            </th>
            <th className="text-right px-4 py-2" style={{ color: C.textMuted }}>
              Value
            </th>
            <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
              Shape
            </th>
          </tr>
        </thead>
        <tbody>
          {d.appendix_traction.pipeline.map((p, i) => {
            const maxV = Math.max(...d.appendix_traction.pipeline.map((r) => r.value_usd));
            return (
              <tr key={i} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-4 py-2 font-medium" style={{ color: C.ink }}>
                  {p.stage}
                </td>
                <td className="px-4 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {p.count}
                </td>
                <td className="px-4 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {usd(p.value_usd)}
                </td>
                <td className="px-4 py-2">
                  <div className="h-2 rounded" style={{ background: C.paperDim }}>
                    <div className="h-full rounded" style={{ width: `${(p.value_usd / maxV) * 100}%`, background: C.accent }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  </AppendixSlide>
);

const A15Usage: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A15" title="Product usage analytics">
    <div className="grid grid-cols-3 gap-3">
      {d.appendix_traction.usage.map((u, i) => (
        <Card key={i} className="p-4" tone="soft">
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
            {u.metric}
          </div>
          <div className="mt-2" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '32px', color: C.ink }}>
            {u.value}
          </div>
          <div className="text-[11px] mt-1" style={{ color: C.emerald, fontFamily: fontMono }}>
            {u.delta}
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

/* ─── A16–A19 Customer insights ─── */

const A16Profiles: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A16" title="Customer profiles">
    <div className="grid grid-cols-3 gap-3">
      {d.appendix_customers.profiles.map((p, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            {p.segment}
          </div>
          <div className="mt-1 text-[14px] font-semibold" style={{ color: C.ink, fontFamily: fontSerif }}>
            {p.persona}
          </div>
          <div className="mt-2 text-[12px]" style={{ color: C.textSoft }}>
            {p.need}
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

const A17Journey: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A17" title="Customer journey">
    <Card className="p-4" tone="plain">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${d.appendix_customers.journey.length}, 1fr)` }}>
        {d.appendix_customers.journey.map((j, i) => (
          <div key={i} className="px-2 text-center border-r last:border-r-0" style={{ borderColor: C.line }}>
            <div
              className="w-10 h-10 mx-auto rounded-full flex items-center justify-center text-[11px] font-bold mb-2"
              style={{ background: C.accentSoft, color: C.accent, fontFamily: fontMono }}
            >
              {i + 1}
            </div>
            <div className="text-[12px] font-semibold" style={{ color: C.ink }}>
              {j.stage}
            </div>
            <div className="text-[11px] mt-1" style={{ color: C.textSoft }}>
              {j.what}
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: C.emerald }}>
              {j.metric}
            </div>
          </div>
        ))}
      </div>
    </Card>
  </AppendixSlide>
);

const A18Cases: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A18" title="Case studies">
    <div className="grid grid-cols-3 gap-3">
      {d.appendix_customers.case_studies.map((c, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            {c.sector}
          </div>
          <div className="mt-1 text-[15px] font-semibold" style={{ color: C.ink, fontFamily: fontSerif }}>
            {c.client}
          </div>
          <div className="mt-2 text-[11px]" style={{ color: C.textSoft }}>
            {c.outcome}
          </div>
          <div className="mt-3 pt-3 border-t flex justify-between items-baseline" style={{ borderColor: C.line }}>
            <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
              {c.metric}
            </span>
            <span style={{ color: C.emerald, fontFamily: fontSerif, fontSize: '20px', fontWeight: 600 }}>{c.value}</span>
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

const A19Testimonials: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A19" title="Testimonials & references">
    <div className="grid grid-cols-2 gap-3">
      {d.appendix_customers.testimonials.map((t, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="text-2xl leading-none mb-1" style={{ color: C.accent, fontFamily: fontSerif }}>
            "
          </div>
          <div className="text-[13px]" style={{ color: C.ink }}>
            {t.quote}
          </div>
          <div className="mt-3 text-[11px] font-semibold" style={{ color: C.ink }}>
            {t.author}
          </div>
          <div className="text-[10px]" style={{ color: C.textMuted }}>
            {t.role} · {t.company}
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

/* ─── A20–A23 Unit economics ─── */

const A20Cac: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A20" title="CAC analysis">
    <div className="grid grid-cols-12 gap-3">
      <Card className="col-span-7 p-4" tone="plain">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={d.appendix_unit_econ.cac_breakdown}>
            <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="source" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => usd(v)} />
            <Tooltip content={<ChartTip />} />
            <Bar dataKey="cac_usd" name="CAC" fill={C.accent} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card className="col-span-5 p-4" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
          Share of acquisition
        </div>
        <div className="space-y-1.5 text-[12px]">
          {d.appendix_unit_econ.cac_breakdown.map((c, i) => (
            <div key={i} className="flex justify-between">
              <span style={{ color: C.ink }}>{c.source}</span>
              <span style={{ color: C.textSoft, fontFamily: fontMono }}>{c.share_pct}%</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  </AppendixSlide>
);

const A21Ltv: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A21" title="LTV analysis">
    <Card className="p-4" tone="plain">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={d.appendix_unit_econ.ltv_curve}>
          <defs>
            <linearGradient id="ltv-g" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={C.emerald} stopOpacity={0.35} />
              <stop offset="100%" stopColor={C.emerald} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(m) => `M${m}`} />
          <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => usd(v)} />
          <Tooltip content={<ChartTip />} />
          <Area type="monotone" dataKey="cumulative_usd" name="Cumulative LTV" stroke={C.emerald} strokeWidth={2} fill="url(#ltv-g)" />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  </AppendixSlide>
);

const A22Payback: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A22" title="Payback analysis">
    <Card className="p-4" tone="plain">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={d.appendix_unit_econ.payback_by_segment} layout="vertical">
          <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} unit="mo" />
          <YAxis type="category" dataKey="segment" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} width={120} />
          <Tooltip content={<ChartTip />} />
          <Bar dataKey="months" name="Payback (mo)" fill={C.accent} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  </AppendixSlide>
);

const A23Margin: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A23" title="Margin analysis">
    <div className="grid grid-cols-12 gap-3">
      <Card className="col-span-5 p-4" tone="plain">
        <div className="h-[240px]">
          <DonutChart slices={d.appendix_unit_econ.margin_layers.map((m) => ({ label: m.layer, pct: m.pct }))} />
        </div>
      </Card>
      <Card className="col-span-7 p-4" tone="plain">
        <table className="w-full text-[12px]">
          <thead style={{ background: C.paperWarm }}>
            <tr>
              <th className="text-left px-3 py-2" style={{ color: C.textMuted }}>
                Layer
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Share of revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {d.appendix_unit_econ.margin_layers.map((m, i) => (
              <tr key={i} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-3 py-2" style={{ color: C.ink }}>
                  {m.layer}
                </td>
                <td className="px-3 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {m.pct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  </AppendixSlide>
);

/* ─── A24–A26 GTM ─── */

const A24Funnel: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A24" title="Sales funnel">
    <Card className="p-4" tone="plain">
      <div className="h-[280px]">
        <Funnel stages={d.appendix_gtm.funnel_stages} />
      </div>
    </Card>
  </AppendixSlide>
);

const A25Channels: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A25" title="Channel strategy">
    <Card className="p-0" tone="plain">
      <table className="w-full text-[12px]">
        <thead style={{ background: C.paperWarm }}>
          <tr>
            <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
              Channel
            </th>
            <th className="text-right px-4 py-2" style={{ color: C.textMuted }}>
              Share
            </th>
            <th className="text-right px-4 py-2" style={{ color: C.textMuted }}>
              CAC
            </th>
            <th className="text-right px-4 py-2" style={{ color: C.textMuted }}>
              Payback
            </th>
          </tr>
        </thead>
        <tbody>
          {d.appendix_gtm.channel_mix.map((c, i) => (
            <tr key={i} className="border-t" style={{ borderColor: C.line }}>
              <td className="px-4 py-2 font-medium" style={{ color: C.ink }}>
                {c.channel}
              </td>
              <td className="px-4 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                {c.share_pct}%
              </td>
              <td className="px-4 py-2 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                {usd(c.cac_usd)}
              </td>
              <td className="px-4 py-2 text-right" style={{ color: C.emerald, fontFamily: fontMono }}>
                {c.payback_months}mo
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </AppendixSlide>
);

const A26Partners: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A26" title="Partnership strategy">
    <div className="grid grid-cols-3 gap-3">
      {d.appendix_gtm.partnerships.map((p, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            {p.type}
          </div>
          <div className="mt-1 text-[14px] font-semibold" style={{ color: C.ink, fontFamily: fontSerif }}>
            {p.partner}
          </div>
          <div className="mt-3">
            <span
              className="text-[10px] uppercase tracking-[0.16em] font-semibold px-2 py-0.5 rounded"
              style={{
                background: p.status === 'Live' ? C.emeraldSoft : p.status === 'In flight' ? C.amberSoft : C.paperWarm,
                color: p.status === 'Live' ? C.emerald : p.status === 'In flight' ? C.amber : C.textSoft,
              }}
            >
              {p.status}
            </span>
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

/* ─── A27–A28 Defensibility ─── */

const A27Matrix: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A27" title="Competitive matrix">
    <Card className="p-0" tone="plain">
      <table className="w-full text-[12px]">
        <thead style={{ background: C.paperWarm }}>
          <tr>
            <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
              Capability
            </th>
            <th className="text-center px-3 py-2" style={{ color: C.accent, background: C.accentSoft }}>
              Us
            </th>
            {d.appendix_defensibility.matrix_competitors.map((c, i) => (
              <th key={i} className="text-center px-3 py-2" style={{ color: C.textMuted }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.appendix_defensibility.matrix_criteria.map((cr, i) => (
            <tr key={i} className="border-t" style={{ borderColor: C.line }}>
              <td className="px-4 py-2 font-medium" style={{ color: C.ink }}>
                {cr.name}
              </td>
              {cr.scores.map((s, si) => (
                <td key={si} className="text-center px-3 py-2" style={si === 0 ? { background: C.accentSoft } : undefined}>
                  <div className="flex justify-center gap-0.5">
                    {[0, 1, 2, 3].map((n) => (
                      <span
                        key={n}
                        className="w-2 h-2 rounded-full"
                        style={{ background: n < s ? (si === 0 ? C.accent : C.textSoft) : C.line }}
                      />
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </AppendixSlide>
);

const A28Moat: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A28" title="Moat analysis">
    <div className="grid grid-cols-2 gap-3">
      {d.appendix_defensibility.moat_descriptions.map((m, i) => (
        <Card key={i} className="p-4" tone="plain">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            Pillar 0{i + 1}
          </div>
          <div className="mt-1 text-[14px] font-semibold" style={{ color: C.ink }}>
            {m.name}
          </div>
          <div className="mt-2 text-[11px]" style={{ color: C.textSoft }}>
            {m.detail}
          </div>
        </Card>
      ))}
    </div>
  </AppendixSlide>
);

/* ─── A29 Team & ops ─── */

const A29Org: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A29" title="Organization plan">
    <div className="grid grid-cols-12 gap-3">
      <Card className="col-span-7 p-4" tone="plain">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={d.appendix_team.org_buckets}>
            <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTip />} />
            <Bar dataKey="current" name="Today" fill={C.paperDim} radius={[2, 2, 0, 0]} />
            <Bar dataKey="year1" name="Year 1" fill={C.navy} radius={[2, 2, 0, 0]} />
            <Bar dataKey="year3" name="Year 3" fill={C.accent} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card className="col-span-5 p-4" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
          Leadership gaps to close
        </div>
        <ul className="space-y-1 text-[12px]">
          {d.appendix_team.leadership_gaps.map((g, i) => (
            <li key={i} className="flex gap-2" style={{ color: C.ink }}>
              <span style={{ color: C.accent }}>·</span>
              {g}
            </li>
          ))}
        </ul>
        <div className="mt-3 pt-3 border-t text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ borderColor: C.line, color: C.accent }}>
          Operating principles
        </div>
        <ul className="mt-2 text-[11px] space-y-1">
          {d.appendix_team.operating_principles.map((p, i) => (
            <li key={i} className="flex gap-2" style={{ color: C.ink }}>
              <span style={{ color: C.textMuted }}>{i + 1}.</span>
              {p}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  </AppendixSlide>
);

/* ─── A30 Financials ─── */

const A30Financials: React.FC<{ d: InvestorData; step: number; total: number }> = ({ d, step, total }) => (
  <AppendixSlide step={step} total={total} letter="A30" title="Three-year financial model">
    <div className="grid grid-cols-12 gap-3">
      <Card className="col-span-7 p-0" tone="plain">
        <div className="px-4 pt-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
          P&L summary
        </div>
        <table className="w-full text-[11.5px]">
          <thead style={{ background: C.paperWarm }}>
            <tr>
              <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
                Line
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Y1
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Y2
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Y3
              </th>
            </tr>
          </thead>
          <tbody>
            {d.appendix_financials.pnl_summary.map((p, i) => (
              <tr key={i} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-4 py-1.5 font-medium" style={{ color: C.ink }}>
                  {p.line}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {usd(p.year1_usd)}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {usd(p.year2_usd)}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {usd(p.year3_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="col-span-5 p-4" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
          Cash & burn
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={d.appendix_financials.cash_flow}>
            <CartesianGrid stroke={C.lineSoft} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => usd(v)} />
            <Tooltip content={<ChartTip />} />
            <Area type="monotone" dataKey="cash_usd" name="Cash" fill={C.emeraldSoft} stroke={C.emerald} />
            <Bar dataKey="burn_usd" name="Burn" fill={C.accent} radius={[2, 2, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="mt-3 text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
          Capital allocation
        </div>
        <div className="mt-2 space-y-1.5">
          {d.appendix_financials.capital_allocation.map((c, i) => (
            <div key={i}>
              <div className="flex justify-between text-[11px]">
                <span style={{ color: C.ink }}>{c.bucket}</span>
                <span style={{ color: C.textSoft, fontFamily: fontMono }}>{c.pct}%</span>
              </div>
              <div className="h-1.5 rounded mt-0.5" style={{ background: C.paperDim }}>
                <div className="h-full rounded" style={{ width: `${c.pct}%`, background: C.accent }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="col-span-12 p-0" tone="plain">
        <div className="px-4 pt-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
          Hiring plan
        </div>
        <table className="w-full text-[11.5px]">
          <thead style={{ background: C.paperWarm }}>
            <tr>
              <th className="text-left px-4 py-2" style={{ color: C.textMuted }}>
                Function
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Now
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Y1
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Y2
              </th>
              <th className="text-right px-3 py-2" style={{ color: C.textMuted }}>
                Y3
              </th>
            </tr>
          </thead>
          <tbody>
            {d.appendix_financials.hiring_plan.map((h, i) => (
              <tr key={i} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-4 py-1.5" style={{ color: C.ink }}>
                  {h.function}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {h.current}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {h.year1}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {h.year2}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: C.ink, fontFamily: fontMono }}>
                  {h.year3}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  </AppendixSlide>
);

/* ───────────────────── deck shell ─────────────────────────── */

export const InvestorAppendixDeckApp: React.FC<{ initial?: InvestorData }> = ({ initial = SAMPLE_DATA }) => {
  const [data, setData] = useState<InvestorData>(initial);
  const [idx, setIdx] = useState(0);
  const onEdit = useCallback((p: (string | number)[], v: string) => setData((prev) => setIn(prev, p, v)), []);

  const slides = useMemo(() => {
    const arr: Array<(p: { step: number; total: number }) => React.ReactNode> = [];
    // Part I
    arr.push((p) => <S1Vision d={data} e={onEdit} {...p} />);
    arr.push((p) => <S2Problem d={data} e={onEdit} {...p} />);
    arr.push((p) => <S3Insight d={data} e={onEdit} {...p} />);
    arr.push((p) => <S4Solution d={data} e={onEdit} {...p} />);
    arr.push((p) => <S5Product d={data} e={onEdit} {...p} />);
    arr.push((p) => <S6Market d={data} e={onEdit} {...p} />);
    arr.push((p) => <S7Traction d={data} e={onEdit} {...p} />);
    arr.push((p) => <S8BusinessModel d={data} e={onEdit} {...p} />);
    arr.push((p) => <S9Gtm d={data} e={onEdit} {...p} />);
    arr.push((p) => <S10Moat d={data} e={onEdit} {...p} />);
    arr.push((p) => <S11Team d={data} e={onEdit} {...p} />);
    arr.push((p) => <S12Fundraise d={data} e={onEdit} {...p} />);
    // Appendix
    arr.push((p) => <AppendixDivider letter="A" title="Market" {...p} />);
    arr.push((p) => <A1Landscape d={data} {...p} />);
    arr.push((p) => <A2Segmentation d={data} {...p} />);
    arr.push((p) => <A3Drivers d={data} {...p} />);
    arr.push((p) => <A4Geo d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="B" title="Product" {...p} />);
    arr.push((p) => <A5Arch d={data} {...p} />);
    arr.push((p) => <A6Tech d={data} {...p} />);
    arr.push((p) => <A7Data d={data} {...p} />);
    arr.push((p) => <A8Sec d={data} {...p} />);
    arr.push((p) => <A9Roadmap d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="C" title="Traction" {...p} />);
    arr.push((p) => <A10RevHistory d={data} {...p} />);
    arr.push((p) => <A11Cohorts d={data} {...p} />);
    arr.push((p) => <A12CustomerGrowth d={data} {...p} />);
    arr.push((p) => <A13Seg d={data} {...p} />);
    arr.push((p) => <A14Pipeline d={data} {...p} />);
    arr.push((p) => <A15Usage d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="D" title="Customer insights" {...p} />);
    arr.push((p) => <A16Profiles d={data} {...p} />);
    arr.push((p) => <A17Journey d={data} {...p} />);
    arr.push((p) => <A18Cases d={data} {...p} />);
    arr.push((p) => <A19Testimonials d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="E" title="Unit economics" {...p} />);
    arr.push((p) => <A20Cac d={data} {...p} />);
    arr.push((p) => <A21Ltv d={data} {...p} />);
    arr.push((p) => <A22Payback d={data} {...p} />);
    arr.push((p) => <A23Margin d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="F" title="Go-to-market" {...p} />);
    arr.push((p) => <A24Funnel d={data} {...p} />);
    arr.push((p) => <A25Channels d={data} {...p} />);
    arr.push((p) => <A26Partners d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="G" title="Defensibility" {...p} />);
    arr.push((p) => <A27Matrix d={data} {...p} />);
    arr.push((p) => <A28Moat d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="H" title="Team & operations" {...p} />);
    arr.push((p) => <A29Org d={data} {...p} />);
    arr.push((p) => <AppendixDivider letter="I" title="Financials" {...p} />);
    arr.push((p) => <A30Financials d={data} {...p} />);
    return arr;
  }, [data, onEdit]);

  const total = slides.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setIdx((i) => Math.min(total - 1, i + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'Home') setIdx(0);
      else if (e.key === 'End') setIdx(total - 1);
      else if (e.key === 'a' || e.key === 'A') setIdx(12); // jump to appendix
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  return (
    <div className="w-screen h-screen flex items-center justify-center" style={{ background: '#D9D3C5' }}>
      <div
        className="relative shadow-2xl"
        style={{
          width: 'min(96vw, calc(96vh * 16 / 9))',
          aspectRatio: '16 / 9',
          background: C.paper,
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
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0"
          >
            {slides[idx]({ step: idx + 1, total })}
          </motion.div>
        </AnimatePresence>
        {/* navigation */}
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 18px rgba(0,0,0,0.1)' }}
        >
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} className="px-2 py-1 text-sm rounded hover:bg-slate-100">
            ◀
          </button>
          <button
            onClick={() => setIdx(0)}
            className="px-2 py-1 text-[10px] font-semibold rounded uppercase tracking-[0.18em]"
            style={{ background: idx < 12 ? C.accent : C.paperWarm, color: idx < 12 ? '#fff' : C.textSoft }}
          >
            Deck
          </button>
          <button
            onClick={() => setIdx(12)}
            className="px-2 py-1 text-[10px] font-semibold rounded uppercase tracking-[0.18em]"
            style={{ background: idx >= 12 ? C.accent : C.paperWarm, color: idx >= 12 ? '#fff' : C.textSoft }}
          >
            Appendix
          </button>
          <span className="text-[10px]" style={{ color: C.textMuted, fontFamily: fontMono }}>
            {String(idx + 1).padStart(2, '0')}/{String(total).padStart(2, '0')}
          </span>
          <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))} className="px-2 py-1 text-sm rounded hover:bg-slate-100">
            ▶
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvestorAppendixDeckApp;

/* ──────────────────── sample data + Axal VC binding ────────────────── */
/*
 * Mirrors field names heuristicSlides() in cloudflare-worker/src/routes/decks.ts
 * writes after Replit Prompt MD's additive migration plus the investor-deck
 * supporting tables (cohort_grids, pipeline_snapshots, financial_plans,
 * hiring_plans, capital_allocation_plans, partnerships, case_studies,
 * compliance_certs). Empty fields fall through to "—".
 *
 * High-level mapping:
 *   projects.{name,one_liner,vision,sentence,mission,sector,...}     → meta + vision
 *   projects.{problem_statement,solution,wedge,...}                  → problem/insight/solution
 *   projects.tech_stack_json / integration_points_json               → product / appendix B
 *   projects.{tam_usd,sam_usd,som_usd,market_curve,...}              → market / appendix A
 *   financial_models.* (arr, mrr, cac, ltv, gross_margin, nrr, etc.) → traction / business_model / appendix E
 *   metrics_snapshots.* (dau, wau, activation, retention)            → appendix C, D
 *   rounds.{target_amount_usd, instrument, valuation_cap_usd,
 *           use_of_funds, milestones}                                → fundraise
 *   captable.* (option_pool_pct, outstanding_safes_usd)              → fundraise context
 *   users.* (founders / leadership)                                  → team / appendix H
 *   cohort_grids                                                      → appendix C (A11)
 *   pipeline_snapshots                                                → appendix C (A14)
 *   customer_success_stories                                          → appendix D (A18)
 *   advisor_answers (testimonials tag)                                → appendix D (A19)
 *   competitive_matrix                                                → moat / appendix G
 *   financial_plans (Y1/Y2/Y3 P&L)                                    → appendix I (A30)
 *   hiring_plans                                                      → appendix I hiring
 *   capital_allocation_plans                                          → appendix I capital
 *   partnerships                                                      → appendix F (A26)
 *   compliance_certs / security_controls                              → appendix B (A8)
 */

const arrSeries = (start: number, monthsBack: number, growth = 0.18): ArrPoint[] => {
  const out: ArrPoint[] = [];
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let cur = start;
  for (let i = 0; i < monthsBack; i++) {
    out.push({
      month: labels[i % 12] + (i >= 12 ? ` '${String(26 + Math.floor(i / 12)).slice(-2)}` : ''),
      arr_usd: Math.round(cur),
      mrr_usd: Math.round(cur / 12),
      nrr_pct: 112 + Math.min(26, i),
    });
    cur *= 1 + growth;
  }
  return out;
};

export const SAMPLE_DATA: InvestorData = {
  meta: {
    company_name: 'Loopline',
    mark: 'L',
    tagline: 'The operating system for revenue teams.',
    round_label: 'Series A · May 2026',
    confidential: 'CONFIDENTIAL — Institutional distribution only',
    presented_on: 'May 2026',
    prepared_by: 'Loopline, Inc.',
  },
  vision: {
    eyebrow: 'Series A · category creation',
    future_state: 'Every revenue team in the world will operate like the best one.',
    mission:
      'We build the operating layer that turns scattered tools, dashboards and meetings into a single system of action — so every revenue team can compound performance the way category leaders do.',
    category: 'Revenue operating systems',
    sentence:
      'The CRM was the system of record. We are the system of action.',
  },
  problem: {
    headline: 'Today\'s revenue teams ship more tools than they ship deals.',
    sub: 'The average B2B seller spans 17 SaaS tools, switches context 1,200×/day, and spends 64% of working time on administration. Leaders manage their teams from dashboards that lag reality by 24–48 hours.',
    pains: [
      { area: 'Visibility', pain: 'Pipeline truth lives in spreadsheets and Slack, not in the CRM.', cost_label: '24–48h lag · slipped deals surface in QBR' },
      { area: 'Execution', pain: 'Top reps win on hustle; the middle 60% forget to follow up.', cost_label: '~ 32% of qualified pipeline ages out' },
      { area: 'Coaching', pain: 'Leaders coach the top 20%; everyone else is invisible.', cost_label: '~ 42% longer ramp · uneven quota attainment' },
    ],
  },
  insight: {
    headline: 'The next platform shift is from system of record to system of action.',
    sub: 'CRMs were built when sellers logged data. Today\'s sellers expect the platform to do the next action for them — and AI now makes that economical.',
    bullets: [
      'AI quality has crossed the threshold where every revenue team will adopt a copilot — not optional, not a tool, but the operating layer.',
      'Buyers consolidated 40% of vendors since 2023. The winners absorb 4–6 tools into one workspace.',
      'Outcome-priced commercials now align incentives: we win when forecast accuracy lifts.',
      'Distribution is converging on a single platform per company; the operating layer wins the strategic seat.',
    ],
    why_now: [
      'AI quality finally cleared the production bar.',
      'Buyers consolidating 40% of vendors.',
      'Two incumbents distracted by post-IPO repricing.',
      'Outcome-priced procurement validated.',
    ],
  },
  solution: {
    headline: 'Loopline replaces the revenue tool stack with one operating layer.',
    sub: 'We unify pipeline, communication, content and coaching into a single system that drafts the next action — and learns from every call, every email, every deal.',
    before: ['17 SaaS tools, no truth', 'Reps forget to follow up', 'Forecast = vibes', 'Top-rep-only coaching', 'CRM as a logging chore'],
    after: ['One workspace', 'Drafts queued, one click', 'Forecast = math + signal', 'Every rep coached on every call', 'CRM that does the next action'],
  },
  product: {
    headline: 'A composable architecture that drops in around your CRM, not on top of it.',
    sub: 'Five layers, deployable in 14 days. Open APIs, transparent AI evaluations, audit posture from day one.',
    layers: [
      { name: 'Experience', detail: 'Workspaces, mobile, embeds, partner portals.' },
      { name: 'Workflow', detail: 'Playbooks, motions, SLA enforcement.' },
      { name: 'AI & decision', detail: 'Copilot, retrieval, evaluations, audit log.' },
      { name: 'Data & integration', detail: 'CDC pipelines, event streams, CRM-in/out.' },
      { name: 'Identity & governance', detail: 'SSO, RBAC, tenant-grade isolation.' },
    ],
    workflow: [
      'Capture signals from calls, email, intent, usage.',
      'Synthesize the deal story in one paragraph.',
      'Draft the next move (email / agenda / clip).',
      'Rep approves; system fires action + logs evidence.',
      'Coach loop: every call scored against your playbook.',
    ],
  },
  market: {
    headline: '$84B market, fragmented, ready for a platform shift.',
    sub: 'The combined revenue, sales-engagement, intelligence and enablement markets total $84B; we believe a single operating layer is in a position to absorb 12–15% of that pie within 8 years.',
    tam_usd: 84_000_000_000,
    sam_usd: 18_000_000_000,
    som_usd: 1_400_000_000,
    cagr_pct: 22,
    expansion: ['Customer Success', 'Marketing Ops', 'Partner Ops', 'International'],
  },
  traction: {
    headline: '$3.2M ARR, 38% MoM growth, 138% NRR — the fastest cohort we have ever seen at this stage.',
    sub: '142 paying customers in 14 months. 92% gross retention. 74 NPS.',
    arr_usd: 3_200_000,
    arr_growth_pct: 580,
    customers: 142,
    nrr_pct: 138,
    gross_margin_pct: 84,
    monthly_arr: arrSeries(180_000, 14, 0.22),
    logos: ['Northwind', 'Acme', 'Globex', 'Initech', 'Hooli', 'Stark', 'Wonka', 'Soylent'],
    milestones: [
      '$10M ARR by Q4 2026',
      '500 customers across 3 verticals',
      'EU launch (UK, DE, FR)',
      'Two adjacent product surfaces live',
    ],
  },
  business_model: {
    headline: 'Per-seat subscription with usage upside; gross margin 84%, payback 8 months.',
    sub: 'Three tiers; consumption-priced AI usage above tier limit. Outcome credits available for enterprise buyers seeking guaranteed lift.',
    streams: [
      { name: 'Subscription', pct: 78, detail: 'Per-seat tiers.' },
      { name: 'Usage', pct: 14, detail: 'AI tokens above tier.' },
      { name: 'Services', pct: 5, detail: 'Onboarding, training.' },
      { name: 'Partner', pct: 3, detail: 'Ecosystem fees.' },
    ],
    tiers: [
      { name: 'Team', acv_usd: 24_000, ratio_pct: 38 },
      { name: 'Business', acv_usd: 72_000, ratio_pct: 41 },
      { name: 'Enterprise', acv_usd: 220_000, ratio_pct: 21 },
    ],
    cac_usd: 18_000,
    ltv_usd: 168_000,
    payback_months: 8,
    gross_margin_pct: 84,
  },
  gtm: {
    headline: 'Product-led entry, sales-led expansion, partner-led enterprise.',
    sub: 'Bottoms-up adoption inside revenue teams; AE motion expands to the org chart; partners unlock regulated enterprise.',
    channels: [
      { channel: 'Self-serve', mql: 4200, sql: 1800, closed: 540 },
      { channel: 'Outbound', mql: 1200, sql: 720, closed: 220 },
      { channel: 'Partner', mql: 380, sql: 280, closed: 130 },
      { channel: 'Events', mql: 640, sql: 320, closed: 90 },
    ],
    motion_steps: [
      'Free workspace, real value in 10 min.',
      'Usage signal triggers team upgrade.',
      'AE engages on second team or +25 seats.',
      'CSM expands across the org chart.',
      'Partner overlay closes regulated enterprise.',
    ],
    expansion_plays: [
      'Adjacent surface (Customer Success).',
      'Geographic expansion (UK / DE / FR).',
      'Marketplace + ecosystem fees.',
      'Outcome-priced enterprise tier.',
    ],
  },
  moat: {
    headline: 'Compounding moats: data network, workflow lock-in, distribution, AI-evaluation flywheel.',
    sub: 'Every customer makes the product better. Every workflow embedded creates switching cost. Every channel deepens our edge.',
    pillars: [
      { name: 'Data network', score: 4, note: 'Every call, deal, email improves models.' },
      { name: 'Workflow', score: 4, note: 'Embedded motions = high switching cost.' },
      { name: 'Distribution', score: 3, note: 'Self-serve + AE + partner overlay.' },
      { name: 'AI evals', score: 3, note: 'Proprietary evaluation harness.' },
      { name: 'Brand', score: 2, note: 'Top of mind in revenue-leader Slack.' },
    ],
    competitors: ['Incumbent A', 'Incumbent B', 'Point tool C', 'Build in-house'],
    positioning: [
      { name: 'Us', x: 0.78, y: 0.86 },
      { name: 'Incumbent A', x: 0.55, y: 0.45 },
      { name: 'Incumbent B', x: 0.68, y: 0.32 },
      { name: 'Point tool C', x: 0.32, y: 0.6 },
      { name: 'Build in-house', x: 0.2, y: 0.3 },
    ],
  },
  team: {
    headline: 'Operators who have done this once — building it the way it should be done.',
    sub: 'Two co-founders with 18 years combined building and running revenue teams at category-defining companies.',
    members: [
      {
        name: 'Sofia Marquez',
        role: 'CEO & Co-founder',
        initials: 'SM',
        previously: 'VP Revenue · Plaid',
        bio: 'Ran a 120-person revenue org through IPO. Built playbooks her industry now copies.',
      },
      {
        name: 'Daniel Okafor',
        role: 'CTO & Co-founder',
        initials: 'DO',
        previously: 'Staff Eng · Stripe',
        bio: 'Shipped AI products to 40M users. First engineer at a unicorn; rebuilt Stripe pipeline ML.',
      },
      {
        name: 'Hana Ito',
        role: 'Head of Design',
        initials: 'HI',
        previously: 'Design Lead · Linear',
        bio: 'Designed the product surfaces investors keep showing other founders as the bar.',
      },
    ],
    advisors: ['Jeff Lawson (Twilio)', 'Tracy Young (PlanGrid)', 'Lenny Rachitsky'],
    investors_existing: ['Seed: Initialized Capital', 'Angels: Lawson, Young, Buchheit'],
  },
  fundraise: {
    headline: 'A $12M Series A to win the operating layer for revenue.',
    sub: '24 months runway. Capital deployed against engineering quality, GTM scale, and one adjacent product surface live in Year 1.',
    amount_usd: 12_000_000,
    instrument: 'Series A Preferred',
    valuation_label: '$80M pre-money',
    runway_months: 24,
    use_of_funds: [
      { label: 'Engineering & AI', pct: 55 },
      { label: 'GTM & Customer Success', pct: 30 },
      { label: 'Brand, marketing, ops', pct: 15 },
    ],
    milestones: [
      '$10M ARR by Q4 2026',
      '500 customers, 3 verticals',
      'EU launch live',
      'Adjacent surface (CS) GA',
    ],
    closing_line:
      'The CRM was built when sellers logged data. We are built for what comes next. Come build it with us.',
    contact_email: 'sofia@loopline.ai',
  },
  appendix_market: {
    landscape: [
      { segment: 'CRM core', size_usd: 24_000_000_000, growth_pct: 9 },
      { segment: 'Engagement', size_usd: 14_000_000_000, growth_pct: 22 },
      { segment: 'Intelligence', size_usd: 18_000_000_000, growth_pct: 26 },
      { segment: 'Enablement', size_usd: 12_000_000_000, growth_pct: 19 },
      { segment: 'AI copilots', size_usd: 16_000_000_000, growth_pct: 64 },
    ],
    segmentation: [
      { tier: 'SMB (< 50)', share_pct: 48, acv_usd: 14_000 },
      { tier: 'Mid-market (50–500)', share_pct: 34, acv_usd: 72_000 },
      { tier: 'Enterprise (500+)', share_pct: 18, acv_usd: 240_000 },
    ],
    growth_drivers: [
      { driver: 'AI quality crossing threshold', weight_pct: 38, detail: 'Production-grade reasoning at sub-$0.01 per request.' },
      { driver: 'Vendor consolidation', weight_pct: 24, detail: 'CIOs cutting 40% of vendors by 2027.' },
      { driver: 'Outcome-priced procurement', weight_pct: 18, detail: 'Buyers pay for measurable lift.' },
      { driver: 'Distributed teams default', weight_pct: 12, detail: 'Async revenue motion is the new normal.' },
      { driver: 'Regulatory data localization', weight_pct: 8, detail: 'Drives single-tenant deployments.' },
    ],
    geos: [
      { region: 'North America', tam_usd: 38_000_000_000, status: 'Live' },
      { region: 'EU', tam_usd: 24_000_000_000, status: 'Scaling' },
      { region: 'UK', tam_usd: 6_000_000_000, status: 'Live' },
      { region: 'APAC', tam_usd: 14_000_000_000, status: 'Roadmap' },
      { region: 'LatAm', tam_usd: 2_000_000_000, status: 'Roadmap' },
    ],
  },
  appendix_product: {
    architecture_layers: [
      { name: 'Experience', components: ['Workspaces', 'Mobile', 'Embeds', 'Partner portal'] },
      { name: 'Workflow', components: ['Playbooks', 'Motions', 'SLA engine'] },
      { name: 'AI & decision', components: ['Copilot', 'Retrieval', 'Evals', 'Audit log'] },
      { name: 'Data & integration', components: ['CDC', 'Streams', 'CRM-in/out', 'Webhooks'] },
      { name: 'Identity & governance', components: ['SSO', 'RBAC', 'Audit', 'Residency'] },
    ],
    tech_stack: [
      { layer: 'Edge & runtime', tools: ['Cloudflare Workers', 'Durable Objects', 'Hono'] },
      { layer: 'Data', tools: ['D1', 'R2', 'Vectorize', 'Snowflake share'] },
      { layer: 'AI', tools: ['Workers AI', 'AI Gateway', 'Llama 3.3 70B', 'Llama Guard'] },
      { layer: 'Frontend', tools: ['React', 'TypeScript', 'Tailwind', 'Framer Motion'] },
      { layer: 'Ops & sec', tools: ['Cloudflare Access', 'WAF', 'Turnstile', 'SOC 2'] },
      { layer: 'Comms', tools: ['Workers Email', 'Twilio (fallback)'] },
    ],
    data_arch: [
      { stage: 'Ingest', system: 'Workers + Queues', latency_ms: 80 },
      { stage: 'Enrich', system: 'AI Gateway', latency_ms: 220 },
      { stage: 'Store', system: 'D1 / Vectorize', latency_ms: 18 },
      { stage: 'Serve', system: 'Cache + Workers', latency_ms: 35 },
      { stage: 'Audit', system: 'R2 + ledger', latency_ms: 90 },
    ],
    security_controls: [
      {
        category: 'Data protection',
        controls: ['AES-256 at rest', 'TLS 1.3 in transit', 'Per-tenant keys', 'Field-level redaction'],
      },
      { category: 'Identity & access', controls: ['SSO (SAML, OIDC)', 'RBAC + ABAC', 'JIT access', 'Privileged action approvals'] },
      { category: 'Audit & monitoring', controls: ['Immutable log', 'SIEM export', 'Anomaly detection'] },
      { category: 'Resilience', controls: ['Multi-region', 'Daily encrypted backups', 'Quarterly DR tests'] },
    ],
    roadmap: [
      { quarter: 'Q2 2026', theme: 'Foundations', bullets: ['Workspaces GA', 'Auto-handoff', 'Mobile beta'] },
      { quarter: 'Q3 2026', theme: 'Coaching', bullets: ['Call scoring', 'Cohort coaching dashboards'] },
      { quarter: 'Q4 2026', theme: 'CS surface', bullets: ['Health scoring', 'Renewal copilots', 'EU launch'] },
      { quarter: 'Q1 2027', theme: 'Ecosystem', bullets: ['Marketplace', 'Partner APIs', 'Outcome credits'] },
    ],
  },
  appendix_traction: {
    revenue_history: arrSeries(120_000, 18, 0.2),
    cohorts: [
      { cohort: '25-Q1', months: [1, 1.02, 1.06, 1.12, 1.18, 1.22, 1.28, 1.34, 1.38, 1.42] },
      { cohort: '25-Q2', months: [1, 1.04, 1.1, 1.16, 1.22, 1.28, 1.34, 1.4, 1.44, 0] },
      { cohort: '25-Q3', months: [1, 1.06, 1.12, 1.2, 1.28, 1.34, 1.4, 1.46, 0, 0] },
      { cohort: '25-Q4', months: [1, 1.08, 1.16, 1.24, 1.32, 1.4, 1.48, 0, 0, 0] },
      { cohort: '26-Q1', months: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 0, 0, 0, 0] },
      { cohort: '26-Q2', months: [1, 1.12, 1.22, 1.34, 1.46, 0, 0, 0, 0, 0] },
    ],
    customer_growth: [
      { month: 'Jan', new_logos: 8, total: 28 },
      { month: 'Feb', new_logos: 11, total: 39 },
      { month: 'Mar', new_logos: 14, total: 53 },
      { month: 'Apr', new_logos: 16, total: 69 },
      { month: 'May', new_logos: 18, total: 87 },
      { month: 'Jun', new_logos: 22, total: 109 },
      { month: 'Jul', new_logos: 26, total: 135 },
      { month: 'Aug', new_logos: 28, total: 163 },
      { month: 'Sep', new_logos: 32, total: 195 },
      { month: 'Oct', new_logos: 38, total: 233 },
      { month: 'Nov', new_logos: 44, total: 277 },
      { month: 'Dec', new_logos: 52, total: 329 },
    ],
    customer_seg: [
      { segment: 'SMB', share_pct: 56, arr_share_pct: 28 },
      { segment: 'Mid-market', share_pct: 32, arr_share_pct: 44 },
      { segment: 'Enterprise', share_pct: 12, arr_share_pct: 28 },
    ],
    pipeline: [
      { stage: 'New', count: 240, value_usd: 12_400_000 },
      { stage: 'Qualified', count: 142, value_usd: 8_600_000 },
      { stage: 'Demo', count: 86, value_usd: 5_400_000 },
      { stage: 'Proposal', count: 48, value_usd: 3_200_000 },
      { stage: 'Negotiation', count: 22, value_usd: 1_800_000 },
      { stage: 'Closing', count: 11, value_usd: 980_000 },
    ],
    usage: [
      { metric: 'Weekly active users', value: '12,840', delta: '+24% MoM' },
      { metric: 'AI actions / user / wk', value: '184', delta: '+38% MoM' },
      { metric: 'Time-to-value', value: '4.2 min', delta: '−18%' },
      { metric: 'DAU / WAU', value: '0.61', delta: '+0.04' },
      { metric: 'Activation @ D7', value: '78%', delta: '+9pt' },
      { metric: 'M6 retention', value: '92%', delta: '+3pt' },
    ],
  },
  appendix_customers: {
    profiles: [
      { persona: 'Revenue leader', segment: 'Mid-market', need: 'Predictable forecast, every quarter.' },
      { persona: 'Frontline AE', segment: 'SMB / MM', need: 'Less admin, more selling time.' },
      { persona: 'CRO', segment: 'Enterprise', need: 'Operating leverage across the GTM org.' },
    ],
    journey: [
      { stage: 'Discover', what: 'Founder sees us in a peer\'s tool stack.', metric: '< 2 weeks to evaluation' },
      { stage: 'Try', what: 'Self-serve workspace, real value in 10 min.', metric: '78% D7 activation' },
      { stage: 'Adopt', what: 'Team upgrade, AE engages on second team.', metric: 'NPS 74 at 30d' },
      { stage: 'Expand', what: 'CSM expands org-wide.', metric: 'NRR 138%' },
      { stage: 'Advocate', what: 'Referrals drive 38% of new sign-ups.', metric: '$3.2M ARR, no paid ads' },
    ],
    case_studies: [
      { client: 'Northwind', sector: 'SaaS · MM', outcome: '+28pt forecast accuracy in 90 days.', metric: 'Forecast accuracy', value: '+28pt' },
      { client: 'Acme', sector: 'Industrial · ENT', outcome: 'Replaced 4 tools + 2 spreadsheets + 1 FTE hire.', metric: 'Tools replaced', value: '4 → 1' },
      { client: 'Globex', sector: 'Logistics · MM', outcome: 'Ramp time for new reps cut from 7 months to 4.', metric: 'Ramp', value: '−42%' },
    ],
    testimonials: [
      { quote: 'Loopline is the first tool my reps actually open without being told.', author: 'Mia Chen', role: 'VP Sales', company: 'Northwind' },
      { quote: 'Replaced 4 tools, 2 spreadsheets, and one full-time ops hire.', author: 'Jonas Becker', role: 'CRO', company: 'Acme' },
      { quote: 'My reps thank me for it. That has never happened with any sales tool.', author: 'Priya Patel', role: 'Head of Revenue', company: 'Globex' },
      { quote: 'I would pay 5× what they charge. Do not tell them.', author: 'Wei Zhang', role: 'Founder', company: 'Initech' },
    ],
  },
  appendix_unit_econ: {
    cac_breakdown: [
      { source: 'Self-serve', cac_usd: 4_800, share_pct: 42 },
      { source: 'Outbound', cac_usd: 22_000, share_pct: 28 },
      { source: 'Partner', cac_usd: 12_000, share_pct: 18 },
      { source: 'Events', cac_usd: 28_000, share_pct: 12 },
    ],
    ltv_curve: Array.from({ length: 36 }).map((_, i) => ({
      month: i,
      cumulative_usd: Math.round(2400 * (1 - Math.exp(-i / 8)) * 70),
    })),
    payback_by_segment: [
      { segment: 'SMB', months: 5 },
      { segment: 'Mid-market', months: 9 },
      { segment: 'Enterprise', months: 14 },
      { segment: 'Blended', months: 8 },
    ],
    margin_layers: [
      { layer: 'Gross margin (84%)', pct: 84 },
      { layer: 'Hosting & AI', pct: 9 },
      { layer: 'Support', pct: 4 },
      { layer: 'Other COGS', pct: 3 },
    ],
  },
  appendix_gtm: {
    funnel_stages: [
      { stage: 'Visits', count: 320_000, conv_pct: 100 },
      { stage: 'Trials', count: 28_000, conv_pct: 8.8 },
      { stage: 'Activated', count: 21_800, conv_pct: 78 },
      { stage: 'Paid', count: 4_200, conv_pct: 19 },
      { stage: 'Expanded', count: 1_400, conv_pct: 33 },
    ],
    channel_mix: [
      { channel: 'Self-serve', share_pct: 42, cac_usd: 4_800, payback_months: 5 },
      { channel: 'Outbound', share_pct: 28, cac_usd: 22_000, payback_months: 9 },
      { channel: 'Partner', share_pct: 18, cac_usd: 12_000, payback_months: 7 },
      { channel: 'Events', share_pct: 12, cac_usd: 28_000, payback_months: 12 },
    ],
    partnerships: [
      { partner: 'Stripe', type: 'Distribution', status: 'Live' },
      { partner: 'Salesforce ISV', type: 'Marketplace', status: 'In flight' },
      { partner: 'Deloitte', type: 'Implementation', status: 'In flight' },
      { partner: 'AWS Marketplace', type: 'Distribution', status: 'Roadmap' },
      { partner: 'HubSpot', type: 'Integration', status: 'Live' },
      { partner: 'Notion', type: 'Integration', status: 'Live' },
    ],
  },
  appendix_defensibility: {
    matrix_competitors: ['Incumbent A', 'Incumbent B', 'Point tool C', 'Build'],
    matrix_criteria: [
      { name: 'AI quality', scores: [4, 2, 2, 2, 1] },
      { name: 'Time-to-value', scores: [4, 2, 2, 3, 1] },
      { name: 'Workflow depth', scores: [4, 3, 3, 2, 1] },
      { name: 'Self-serve PLG', scores: [4, 1, 1, 3, 1] },
      { name: 'Enterprise posture', scores: [3, 4, 3, 2, 2] },
      { name: 'Pricing alignment', scores: [4, 2, 2, 2, 1] },
      { name: 'Ecosystem leverage', scores: [3, 4, 3, 2, 1] },
      { name: 'Switching cost', scores: [4, 3, 3, 2, 2] },
    ],
    moat_descriptions: [
      { name: 'Data network', detail: 'Every customer\'s workflows improve every other customer\'s evaluations — a true network effect, not a marketing claim.' },
      { name: 'Workflow lock-in', detail: 'Embedded motions create operational dependency. Customers tell us "we couldn\'t leave if we wanted to."' },
      { name: 'Distribution', detail: 'Self-serve + AE + partner overlay covers the entire SMB → enterprise spectrum.' },
      { name: 'AI evaluations', detail: 'Proprietary harness that grades every model output against your playbook. Competitors are a year behind.' },
    ],
  },
  appendix_team: {
    org_buckets: [
      { name: 'Engineering', current: 16, year1: 38, year3: 92 },
      { name: 'GTM', current: 12, year1: 32, year3: 84 },
      { name: 'Customer Success', current: 6, year1: 18, year3: 48 },
      { name: 'Design', current: 4, year1: 9, year3: 18 },
      { name: 'Ops / G&A', current: 4, year1: 10, year3: 22 },
    ],
    leadership_gaps: ['VP Engineering (close Q3)', 'VP Marketing (close Q4)', 'CFO (close Q2)', 'Head of Security (close Q3)'],
    operating_principles: [
      'Customer obsession beats product obsession.',
      'Default to evidence, not opinion.',
      'Velocity is a feature; ship weekly.',
      'Write to think, not to memo.',
      'The org chart is a graph, not a tree.',
    ],
  },
  appendix_financials: {
    pnl_summary: [
      { line: 'Revenue', year1_usd: 9_800_000, year2_usd: 28_000_000, year3_usd: 72_000_000 },
      { line: 'Gross profit', year1_usd: 8_200_000, year2_usd: 23_500_000, year3_usd: 61_200_000 },
      { line: 'S&M', year1_usd: 5_200_000, year2_usd: 12_000_000, year3_usd: 26_000_000 },
      { line: 'R&D', year1_usd: 6_200_000, year2_usd: 11_000_000, year3_usd: 22_000_000 },
      { line: 'G&A', year1_usd: 1_400_000, year2_usd: 3_200_000, year3_usd: 7_400_000 },
      { line: 'Operating income', year1_usd: -4_600_000, year2_usd: -2_700_000, year3_usd: 5_800_000 },
    ],
    hiring_plan: [
      { function: 'Engineering', current: 16, year1: 38, year2: 64, year3: 92 },
      { function: 'GTM', current: 12, year1: 32, year2: 56, year3: 84 },
      { function: 'CS', current: 6, year1: 18, year2: 32, year3: 48 },
      { function: 'Design', current: 4, year1: 9, year2: 14, year3: 18 },
      { function: 'G&A', current: 4, year1: 10, year2: 16, year3: 22 },
    ],
    cash_flow: Array.from({ length: 24 }).map((_, i) => ({
      month: `M${i + 1}`,
      cash_usd: Math.max(0, 14_000_000 - i * 480_000 + (i > 18 ? (i - 18) * 320_000 : 0)),
      burn_usd: Math.max(0, 480_000 - (i > 18 ? (i - 18) * 60_000 : 0)),
    })),
    capital_allocation: [
      { bucket: 'Engineering & AI', pct: 55 },
      { bucket: 'GTM & CS', pct: 30 },
      { bucket: 'Brand & ops', pct: 15 },
    ],
  },
};
// ─────────────────────────────────────────────────────────────────
// Registry adapter — `Deck_investor_appendix_app`
//
// Wraps each of the 42 slides (12 core + 30 appendix A–I) in
// <Slide16x9> so the platform print pipeline (PitchDeckPrintPage.jsx)
// can find each slide via the `[data-slide-frame]` hook and so
// per-slide page breaks fire during window.print(). Mirrors the
// pattern from series_a_growth_app / series_b_diligence_app /
// demo_day_app / partnership_bd_app / sales_commercial_app.
// ─────────────────────────────────────────────────────────────────
import { Slide16x9, type DeckProps as RegistryDeckProps } from '../DeckBase';

// Shape-safe merge: arrays in `incoming` only replace when non-empty,
// objects merge field-by-field, primitives override. Lets the
// platform pass partial InvestorData (whatever fields autofill
// produced) without nuking the SAMPLE_DATA defaults the slide
// internals rely on.
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

export const Deck_investor_appendix_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => (
  <BrandProvider data={data || {}} fallbackAccent="#0A84FF">
    <Deck_investor_appendix_app_inner data={data} editable={editable} onEdit={onEdit} />
  </BrandProvider>
);

const Deck_investor_appendix_app_inner: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const { accent: brandAccent } = useBrandContext();
  const ac = brandAccent || C.accent;
  const merged = useMemo(
    () => mergeShape(SAMPLE_DATA, data || {}) as InvestorData,
    [data],
  );
  // Bridge the template's array-path onEdit signature to the
  // registry's dot-string signature. No-op when not editable.
  const handleEdit = useCallback(
    (path: (string | number)[], value: string) => {
      if (!editable || !onEdit) return;
      onEdit(path.join('.'), value);
    },
    [editable, onEdit],
  );

  const total = 42;
  let step = 0;
  const next = () => ++step;
  const slides: React.ReactNode[] = [
    // Part I — Core Deck (12)
    <S1Vision        d={merged} e={handleEdit} step={next()} total={total} />,
    <S2Problem       d={merged} e={handleEdit} step={next()} total={total} />,
    <S3Insight       d={merged} e={handleEdit} step={next()} total={total} />,
    <S4Solution      d={merged} e={handleEdit} step={next()} total={total} />,
    <S5Product       d={merged} e={handleEdit} step={next()} total={total} />,
    <S6Market        d={merged} e={handleEdit} step={next()} total={total} />,
    <S7Traction      d={merged} e={handleEdit} step={next()} total={total} />,
    <S8BusinessModel d={merged} e={handleEdit} step={next()} total={total} />,
    <S9Gtm           d={merged} e={handleEdit} step={next()} total={total} />,
    <S10Moat         d={merged} e={handleEdit} step={next()} total={total} />,
    <S11Team         d={merged} e={handleEdit} step={next()} total={total} />,
    <S12Fundraise    d={merged} e={handleEdit} step={next()} total={total} />,
    // Appendix A — Market
    <AppendixDivider letter="A" title="Market" step={next()} total={total} />,
    <A1Landscape     d={merged} step={next()} total={total} />,
    <A2Segmentation  d={merged} step={next()} total={total} />,
    <A3Drivers       d={merged} step={next()} total={total} />,
    <A4Geo           d={merged} step={next()} total={total} />,
    // Appendix B — Product
    <AppendixDivider letter="B" title="Product" step={next()} total={total} />,
    <A5Arch          d={merged} step={next()} total={total} />,
    <A6Tech          d={merged} step={next()} total={total} />,
    <A7Data          d={merged} step={next()} total={total} />,
    <A8Sec           d={merged} step={next()} total={total} />,
    <A9Roadmap       d={merged} step={next()} total={total} />,
    // Appendix C — Traction
    <AppendixDivider letter="C" title="Traction" step={next()} total={total} />,
    <A10RevHistory   d={merged} step={next()} total={total} />,
    <A11Cohorts      d={merged} step={next()} total={total} />,
    <A12CustomerGrowth d={merged} step={next()} total={total} />,
    <A13Seg          d={merged} step={next()} total={total} />,
    <A14Pipeline     d={merged} step={next()} total={total} />,
    <A15Usage        d={merged} step={next()} total={total} />,
    // Appendix D — Customer insights
    <AppendixDivider letter="D" title="Customer insights" step={next()} total={total} />,
    <A16Profiles     d={merged} step={next()} total={total} />,
    <A17Journey      d={merged} step={next()} total={total} />,
    <A18Cases        d={merged} step={next()} total={total} />,
    <A19Testimonials d={merged} step={next()} total={total} />,
    // Appendix E — Unit economics
    <AppendixDivider letter="E" title="Unit economics" step={next()} total={total} />,
    <A20Cac          d={merged} step={next()} total={total} />,
    <A21Ltv          d={merged} step={next()} total={total} />,
    <A22Payback      d={merged} step={next()} total={total} />,
    <A23Margin       d={merged} step={next()} total={total} />,
    // Appendix F — Go-to-market
    <AppendixDivider letter="F" title="Go-to-market" step={next()} total={total} />,
    <A24Funnel       d={merged} step={next()} total={total} />,
    <A25Channels     d={merged} step={next()} total={total} />,
    <A26Partners     d={merged} step={next()} total={total} />,
    // Appendix G — Defensibility
    <AppendixDivider letter="G" title="Defensibility" step={next()} total={total} />,
    <A27Matrix       d={merged} step={next()} total={total} />,
    <A28Moat         d={merged} step={next()} total={total} />,
    // Appendix H — Team & operations
    <AppendixDivider letter="H" title="Team & operations" step={next()} total={total} />,
    <A29Org          d={merged} step={next()} total={total} />,
    // Appendix I — Financials
    <AppendixDivider letter="I" title="Financials" step={next()} total={total} />,
    <A30Financials   d={merged} step={next()} total={total} />,
  ];

  return (
    <>
      {slides.map((slide, i) => (
        <Slide16x9 key={i}>{slide}</Slide16x9>
      ))}
    </>
  );
};
