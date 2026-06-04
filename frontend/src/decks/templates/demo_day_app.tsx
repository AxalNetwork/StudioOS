/**
 * demo_day_app.tsx
 *
 * Demo Day fundraising deck — 12 slides, product-first, YC-stage energy.
 *
 * Self-contained React + TypeScript + Tailwind + Framer Motion app.
 * No image assets — every product screen is a hand-built SVG mockup.
 * Designed to be bound to Axal platform rows via `heuristicSlides()`
 * (see `cloudflare-worker/src/routes/decks.ts`); the SAMPLE_DATA at the
 * bottom mirrors the exact field names the autofill layer writes.
 *
 * Stack assumed (already in StudioOS):
 *   react ^18, react-dom ^18, framer-motion ^11, tailwindcss ^3
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Slide16x9, type DeckProps as RegistryDeckProps, BrandProvider, useBrandContext } from '../DeckBase';

/* ───────────────────────────── types ────────────────────────────── */

export type DemoDayData = {
  company: {
    name: string;
    tagline: string;
    vision: string;
    sector: string;
    stage: string;
    location: string;
    founded_year: number;
    logo_mark: string; // single character/glyph
  };
  cover: {
    headline: string;
    sub: string;
    eyebrow: string;
    metric_strip: { label: string; value: string }[];
  };
  problem: {
    headline: string;
    sub: string;
    pain_points: { title: string; detail: string }[];
    workflow_today: string[];
  };
  solution: {
    headline: string;
    sub: string;
    transformation: { before: string; after: string }[];
  };
  walkthrough: {
    headline: string;
    sub: string;
    steps: { title: string; detail: string }[];
  };
  features: {
    name: string;
    headline: string;
    sub: string;
    bullets: string[];
    metric_label: string;
    metric_value: string;
  }[];
  love: {
    headline: string;
    sub: string;
    testimonials: { quote: string; author: string; role: string; company: string }[];
    engagement: { dau_wau_pct: number; nps: number; m6_retention_pct: number; weekly_active_actions: number };
  };
  traction: {
    headline: string;
    sub: string;
    arr_usd: number;
    arr_growth_pct: number;
    customers: number;
    customer_growth_pct: number;
    nrr_pct: number;
    gross_margin_pct: number;
    monthly_arr_series: { month: string; arr_usd: number }[];
    logos: string[];
  };
  market: {
    headline: string;
    sub: string;
    tam_usd: number;
    sam_usd: number;
    som_usd: number;
    trends: { label: string; detail: string }[];
    expansion: string[];
  };
  team: {
    headline: string;
    sub: string;
    members: { name: string; role: string; bio: string; previously: string; initials: string }[];
    advisors: string[];
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
};

/* ───────────────────────────── tokens ───────────────────────────── */

const C = {
  ink: '#0B1020',
  inkSoft: '#1A2238',
  paper: '#FFFFFF',
  paperWarm: '#F8FAFC',
  paperDim: '#EEF2F7',
  line: '#E5E9F2',
  text: '#0B1020',
  textSoft: '#475467',
  textMuted: '#98A2B3',
  accent: '#FF5A1F', // warm Demo-Day orange
  accentSoft: '#FFE6D9',
  electric: '#3B82F6',
  electricSoft: '#DBEAFE',
  emerald: '#10B981',
  emeraldSoft: '#D1FAE5',
  violet: '#7C3AED',
  violetSoft: '#EDE9FE',
  amber: '#F59E0B',
  rose: '#F43F5E',
};

const fontSans =
  '"Inter", "SF Pro Text", "Helvetica Neue", Arial, system-ui, sans-serif';
const fontDisplay =
  '"Inter", "SF Pro Display", "Helvetica Neue", Arial, system-ui, sans-serif';
const fontMono =
  '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

/* ───────────────────────────── utils ────────────────────────────── */

const usdShort = (n: number): string => {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
};

const intShort = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `${n}`;
};

const setIn = <T,>(obj: T, path: (string | number)[], value: unknown): T => {
  const next = structuredClone(obj) as Record<string, unknown>;
  let cur: Record<string, unknown> = next as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i] as string;
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path[path.length - 1] as string] = value;
  return next as T;
};

/* ───────────────────────────── primitives ───────────────────────── */

type SlideFrameProps = {
  children: React.ReactNode;
  bg?: string;
  pad?: string;
  step?: number;
  total?: number;
  section?: string;
};

const SlideFrame: React.FC<SlideFrameProps> = ({
  children,
  bg = C.paper,
  pad = 'px-20 py-14',
  step,
  total,
  section,
}) => (
  <div
    className={`relative w-full h-full overflow-hidden ${pad}`}
    style={{ background: bg, color: C.text, fontFamily: fontSans }}
  >
    {(section || step) && (
      <div
        className="absolute top-6 left-20 right-20 flex items-center justify-between text-[11px] tracking-[0.18em] uppercase"
        style={{ color: C.textMuted }}
      >
        <span>{section}</span>
        {step && total && (
          <span>
            {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        )}
      </div>
    )}
    <div className="w-full h-full flex flex-col justify-center">{children}</div>
  </div>
);

type EditableProps = {
  value: string;
  path: (string | number)[];
  onEdit: (path: (string | number)[], value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
};

const Editable: React.FC<EditableProps> = ({ value, path, onEdit, className, style, multiline }) => (
  <span
    contentEditable
    suppressContentEditableWarning
    onBlur={(e) => onEdit(path, (multiline ? e.currentTarget.innerText : e.currentTarget.textContent) || '')}
    className={`outline-none focus:bg-orange-50 rounded px-0.5 ${className ?? ''}`}
    style={style}
  >
    {value}
  </span>
);

type PillTone = 'accent' | 'electric' | 'emerald' | 'violet' | 'amber' | 'rose' | 'neutral';

const Pill: React.FC<{ children: React.ReactNode; tone?: PillTone }> = ({
  children,
  tone = 'neutral',
}) => {
  const palette = ({
    accent: { bg: C.accentSoft, fg: C.accent },
    electric: { bg: C.electricSoft, fg: C.electric },
    emerald: { bg: C.emeraldSoft, fg: C.emerald },
    violet: { bg: C.violetSoft, fg: C.violet },
    amber: { bg: '#FEF3C7', fg: C.amber },
    rose: { bg: '#FFE4E6', fg: C.rose },
    neutral: { bg: C.paperDim, fg: C.textSoft },
  } as const)[tone] ?? { bg: C.paperDim, fg: C.textSoft };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] tracking-[0.18em] uppercase font-medium"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {children}
    </span>
  );
};

const LogoMark: React.FC<{ mark: string; size?: number }> = ({ mark, size = 44 }) => (
  <div
    className="flex items-center justify-center rounded-2xl shadow-sm"
    style={{
      width: size,
      height: size,
      background: `linear-gradient(135deg, ${C.accent} 0%, #FF8A4C 100%)`,
      color: '#fff',
      fontFamily: fontDisplay,
      fontWeight: 700,
      fontSize: size * 0.5,
      letterSpacing: '-0.04em',
    }}
  >
    {mark}
  </div>
);

/* ───────────────────────────── SVG mockups ──────────────────────── */

/** Browser-style chrome that wraps any product screen */
const BrowserChrome: React.FC<{ url: string; children: React.ReactNode; height?: number | string }> = ({
  url,
  children,
  height = '100%',
}) => (
  <div
    className="w-full rounded-2xl overflow-hidden shadow-2xl border"
    style={{ borderColor: C.line, background: '#fff', height }}
  >
    <div className="flex items-center gap-2 px-4 h-10 border-b" style={{ borderColor: C.line, background: C.paperWarm }}>
      <div className="flex gap-1.5">
        <span className="w-3 h-3 rounded-full" style={{ background: '#FF5F57' }} />
        <span className="w-3 h-3 rounded-full" style={{ background: '#FEBC2E' }} />
        <span className="w-3 h-3 rounded-full" style={{ background: '#28C840' }} />
      </div>
      <div
        className="flex-1 mx-4 h-6 rounded-md flex items-center px-3 text-[11px]"
        style={{ background: '#fff', border: `1px solid ${C.line}`, color: C.textMuted, fontFamily: fontMono }}
      >
        {url}
      </div>
    </div>
    <div className="w-full" style={{ height: 'calc(100% - 2.5rem)' }}>
      {children}
    </div>
  </div>
);

/** Hero dashboard screen — shown on cover + a few others */
const DashboardScreen: React.FC<{ accent?: string; companyName: string }> = ({ accent = C.accent, companyName }) => (
  <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="720" fill="#fff" />
    {/* sidebar */}
    <rect x="0" y="0" width="220" height="720" fill={C.paperWarm} />
    <rect x="20" y="24" width="32" height="32" rx="8" fill={accent} />
    <text x="62" y="46" fontFamily={fontDisplay} fontWeight={700} fontSize="14" fill={C.ink}>
      {companyName}
    </text>
    {['Overview', 'Projects', 'Pipeline', 'Analytics', 'Customers', 'Settings'].map((label, i) => (
      <g key={label} transform={`translate(20, ${88 + i * 44})`}>
        <rect width="180" height="32" rx="8" fill={i === 0 ? '#fff' : 'transparent'} stroke={i === 0 ? C.line : 'none'} />
        <circle cx="16" cy="16" r="3" fill={i === 0 ? accent : C.textMuted} />
        <text x="30" y="20" fontFamily={fontSans} fontWeight={i === 0 ? 600 : 500} fontSize="12" fill={i === 0 ? C.ink : C.textSoft}>
          {label}
        </text>
      </g>
    ))}
    {/* topbar */}
    <rect x="220" y="0" width="980" height="64" fill="#fff" />
    <line x1="220" y1="64" x2="1200" y2="64" stroke={C.line} />
    <rect x="244" y="20" width="240" height="24" rx="6" fill={C.paperWarm} />
    <text x="256" y="36" fontFamily={fontSans} fontSize="11" fill={C.textMuted}>
      Search…
    </text>
    <circle cx="1160" cy="32" r="14" fill={accent} />
    <text x="1160" y="36" textAnchor="middle" fontFamily={fontSans} fontWeight={700} fontSize="11" fill="#fff">
      G
    </text>
    {/* KPI tiles */}
    {[
      { label: 'ARR', value: '$3.2M', delta: '+38%' },
      { label: 'Active users', value: '12,840', delta: '+22%' },
      { label: 'NRR', value: '138%', delta: '+6pt' },
      { label: 'NPS', value: '74', delta: '+8' },
    ].map((k, i) => (
      <g key={k.label} transform={`translate(${244 + i * 232}, 88)`}>
        <rect width="216" height="92" rx="12" fill="#fff" stroke={C.line} />
        <text x="16" y="28" fontFamily={fontSans} fontSize="11" fill={C.textMuted}>
          {k.label}
        </text>
        <text x="16" y="58" fontFamily={fontDisplay} fontWeight={700} fontSize="24" fill={C.ink}>
          {k.value}
        </text>
        <text x="16" y="78" fontFamily={fontMono} fontSize="11" fill={C.emerald}>
          ▲ {k.delta}
        </text>
      </g>
    ))}
    {/* chart card */}
    <g transform="translate(244, 204)">
      <rect width="680" height="280" rx="12" fill="#fff" stroke={C.line} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
        ARR — last 12 months
      </text>
      <text x="20" y="50" fontFamily={fontSans} fontSize="11" fill={C.textMuted}>
        Monthly recurring × 12, normalized
      </text>
      <defs>
        <linearGradient id="arr-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {(() => {
        const vals = [40, 48, 55, 58, 70, 78, 88, 100, 118, 138, 162, 195];
        const w = 640;
        const h = 180;
        const ox = 20;
        const oy = 72;
        const max = 200;
        const pts = vals.map((v, i) => `${ox + (i * w) / 11},${oy + h - (v / max) * h}`);
        const area = `M${ox},${oy + h} L${pts.join(' L')} L${ox + w},${oy + h} Z`;
        const line = `M${pts.join(' L')}`;
        return (
          <>
            <path d={area} fill="url(#arr-grad)" />
            <path d={line} fill="none" stroke={accent} strokeWidth={2.5} />
            {pts.map((p, i) => {
              const [x, y] = p.split(',').map(Number);
              return <circle key={i} cx={x} cy={y} r={3} fill="#fff" stroke={accent} strokeWidth={2} />;
            })}
          </>
        );
      })()}
    </g>
    {/* activity feed */}
    <g transform="translate(944, 204)">
      <rect width="232" height="280" rx="12" fill="#fff" stroke={C.line} />
      <text x="16" y="28" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
        Activity
      </text>
      {[
        { who: 'Mia', what: 'closed Acme — $48K' },
        { who: 'Jonas', what: 'shipped v2.4' },
        { who: 'Priya', what: 'invited 3 teammates' },
        { who: 'Wei', what: 'completed onboarding' },
        { who: 'Aria', what: 'approved a contract' },
      ].map((a, i) => (
        <g key={i} transform={`translate(16, ${48 + i * 42})`}>
          <circle cx="12" cy="12" r="12" fill={C.paperDim} />
          <text x="12" y="16" textAnchor="middle" fontFamily={fontSans} fontWeight={700} fontSize="10" fill={C.textSoft}>
            {a.who[0]}
          </text>
          <text x="34" y="11" fontFamily={fontSans} fontWeight={600} fontSize="11" fill={C.ink}>
            {a.who}
          </text>
          <text x="34" y="24" fontFamily={fontSans} fontSize="11" fill={C.textSoft}>
            {a.what}
          </text>
        </g>
      ))}
    </g>
    {/* table */}
    <g transform="translate(244, 504)">
      <rect width="932" height="180" rx="12" fill="#fff" stroke={C.line} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
        Pipeline
      </text>
      {['Account', 'Stage', 'Owner', 'Value', 'Close'].map((h, i) => (
        <text key={h} x={20 + i * 180} y="60" fontFamily={fontSans} fontWeight={600} fontSize="10" fill={C.textMuted}>
          {h.toUpperCase()}
        </text>
      ))}
      {[
        ['Acme Corp', 'Negotiation', 'Mia', '$48K', 'Jun 12'],
        ['Northwind', 'Proposal', 'Jonas', '$32K', 'Jun 18'],
        ['Globex', 'Discovery', 'Priya', '$72K', 'Jul 02'],
      ].map((row, ri) => (
        <g key={ri} transform={`translate(0, ${78 + ri * 34})`}>
          {row.map((cell, ci) => (
            <text key={ci} x={20 + ci * 180} y="20" fontFamily={fontSans} fontSize="12" fill={C.ink}>
              {cell}
            </text>
          ))}
        </g>
      ))}
    </g>
  </svg>
);

/** Workflow/before-after pipeline screen */
const WorkflowScreen: React.FC<{ accent?: string; before?: boolean }> = ({ accent = C.accent, before }) => (
  <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="720" fill={before ? '#FFF7F2' : '#fff'} />
    <text x="80" y="92" fontFamily={fontDisplay} fontWeight={700} fontSize="28" fill={C.ink}>
      {before ? 'Today — 17 tools, no view' : 'With the platform — one connected surface'}
    </text>
    <text x="80" y="124" fontFamily={fontSans} fontSize="14" fill={C.textSoft}>
      {before ? 'Copy / paste between products. Manual handoffs. Lost context.' : 'Every step, one workflow. Auto-handoffs. Full context.'}
    </text>
    {(before
      ? ['CRM', 'Sheets', 'Email', 'Slack', 'Notion', 'Linear', 'Docs', 'Drive']
      : ['Capture', 'Enrich', 'Decide', 'Hand off', 'Sign', 'Track']
    ).map((label, i, arr) => {
      const x = 80 + i * (1040 / arr.length);
      const w = 1040 / arr.length - 16;
      return (
        <g key={label}>
          <rect
            x={x}
            y={200}
            width={w}
            height={100}
            rx={14}
            fill={before ? '#fff' : accent}
            stroke={before ? C.line : 'none'}
          />
          <text
            x={x + w / 2}
            y={258}
            textAnchor="middle"
            fontFamily={fontSans}
            fontWeight={600}
            fontSize={before ? 14 : 16}
            fill={before ? C.ink : '#fff'}
          >
            {label}
          </text>
          {!before && i < arr.length - 1 && (
            <path
              d={`M${x + w + 2},250 L${x + w + 12},250`}
              stroke={accent}
              strokeWidth={2}
              fill="none"
              markerEnd="url(#arrow)"
            />
          )}
        </g>
      );
    })}
    {before ? (
      <g>
        {Array.from({ length: 14 }).map((_, i) => {
          const x1 = 80 + Math.random() * 1040;
          const y1 = 320 + Math.random() * 280;
          const x2 = 80 + Math.random() * 1040;
          const y2 = 320 + Math.random() * 280;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.amber} strokeOpacity={0.4} strokeWidth={1.2} />;
        })}
      </g>
    ) : (
      <g transform="translate(80, 360)">
        <rect width="1040" height="280" rx="14" fill="#fff" stroke={C.line} />
        <text x="24" y="36" fontFamily={fontSans} fontWeight={600} fontSize="14" fill={C.ink}>
          Live workspace
        </text>
        {[0, 1, 2].map((row) => (
          <g key={row} transform={`translate(24, ${64 + row * 64})`}>
            <rect width="992" height="48" rx="10" fill={C.paperWarm} />
            <circle cx="24" cy="24" r="10" fill={accent} />
            <rect x="48" y="14" width="220" height="10" rx="3" fill={C.ink} />
            <rect x="48" y="30" width="380" height="8" rx="3" fill={C.textMuted} />
            <rect x="820" y="14" width="148" height="20" rx="6" fill={C.emeraldSoft} />
            <text x="894" y="29" textAnchor="middle" fontFamily={fontSans} fontWeight={600} fontSize="11" fill={C.emerald}>
              Auto-handoff
            </text>
          </g>
        ))}
      </g>
    )}
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill={accent} />
      </marker>
    </defs>
  </svg>
);

/** Feature deep-screen #1 — split panel editor */
const FeatureSplitScreen: React.FC<{ accent?: string; title: string }> = ({ accent = C.accent, title }) => (
  <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="720" fill="#fff" />
    <rect x="0" y="0" width="1200" height="56" fill={C.paperWarm} />
    <line x1="0" y1="56" x2="1200" y2="56" stroke={C.line} />
    <rect x="24" y="16" width="24" height="24" rx="6" fill={accent} />
    <text x="58" y="34" fontFamily={fontDisplay} fontWeight={700} fontSize="14" fill={C.ink}>
      {title}
    </text>
    {/* left list */}
    <rect x="0" y="56" width="320" height="664" fill={C.paperWarm} />
    {Array.from({ length: 7 }).map((_, i) => (
      <g key={i} transform={`translate(20, ${80 + i * 80})`}>
        <rect width="280" height="68" rx="10" fill={i === 1 ? '#fff' : 'transparent'} stroke={i === 1 ? C.line : 'none'} />
        <circle cx="22" cy="34" r="10" fill={i === 1 ? accent : C.textMuted} />
        <rect x="44" y="20" width="200" height="10" rx="3" fill={C.ink} />
        <rect x="44" y="38" width="160" height="8" rx="3" fill={C.textMuted} />
      </g>
    ))}
    {/* right editor */}
    <g transform="translate(320, 56)">
      <rect width="880" height="664" fill="#fff" />
      <text x="40" y="60" fontFamily={fontDisplay} fontWeight={700} fontSize="22" fill={C.ink}>
        Q3 GTM brief — final
      </text>
      <text x="40" y="86" fontFamily={fontSans} fontSize="12" fill={C.textMuted}>
        Updated 4 min ago · 3 collaborators
      </text>
      {Array.from({ length: 14 }).map((_, i) => (
        <rect
          key={i}
          x={40}
          y={120 + i * 26}
          width={i % 4 === 3 ? 540 : 800 - Math.random() * 200}
          height={10}
          rx={3}
          fill={i === 2 ? accent : C.paperDim}
        />
      ))}
      {/* AI suggestion card */}
      <g transform="translate(40, 520)">
        <rect width="800" height="120" rx="12" fill={C.accentSoft} />
        <circle cx="32" cy="32" r="14" fill={accent} />
        <text x="32" y="36" textAnchor="middle" fontFamily={fontSans} fontWeight={700} fontSize="12" fill="#fff">
          AI
        </text>
        <text x="60" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
          Suggested edit
        </text>
        <text x="60" y="56" fontFamily={fontSans} fontSize="12" fill={C.textSoft}>
          "Tighten the lead with the customer outcome before the feature list."
        </text>
        <rect x="60" y="72" width="100" height="28" rx="8" fill={accent} />
        <text x="110" y="90" textAnchor="middle" fontFamily={fontSans} fontWeight={600} fontSize="12" fill="#fff">
          Apply
        </text>
        <rect x="170" y="72" width="100" height="28" rx="8" fill="#fff" stroke={C.line} />
        <text x="220" y="90" textAnchor="middle" fontFamily={fontSans} fontWeight={600} fontSize="12" fill={C.ink}>
          Dismiss
        </text>
      </g>
    </g>
  </svg>
);

/** Feature deep-screen #2 — kanban */
const FeatureKanbanScreen: React.FC<{ accent?: string; title: string }> = ({ accent = C.accent, title }) => {
  const cols = [
    { name: 'Backlog', cards: 6, hue: C.paperDim },
    { name: 'In progress', cards: 4, hue: C.electricSoft },
    { name: 'In review', cards: 3, hue: C.accentSoft },
    { name: 'Shipped', cards: 5, hue: C.emeraldSoft },
  ];
  return (
    <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
      <rect width="1200" height="720" fill="#fff" />
      <text x="40" y="56" fontFamily={fontDisplay} fontWeight={700} fontSize="22" fill={C.ink}>
        {title}
      </text>
      <text x="40" y="80" fontFamily={fontSans} fontSize="12" fill={C.textMuted}>
        Drag, drop, automate.
      </text>
      {cols.map((col, ci) => (
        <g key={col.name} transform={`translate(${40 + ci * 290}, 110)`}>
          <rect width="270" height="580" rx="14" fill={C.paperWarm} />
          <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
            {col.name}
          </text>
          <text x="20" y="50" fontFamily={fontMono} fontSize="11" fill={C.textMuted}>
            {col.cards}
          </text>
          {Array.from({ length: col.cards }).map((_, i) => (
            <g key={i} transform={`translate(16, ${72 + i * 88})`}>
              <rect width="238" height="76" rx="10" fill="#fff" stroke={C.line} />
              <rect x="14" y="14" width="40" height="6" rx="3" fill={col.hue} />
              <rect x="14" y="28" width="180" height="10" rx="3" fill={C.ink} />
              <rect x="14" y="46" width="140" height="8" rx="3" fill={C.textMuted} />
              <circle cx="222" cy="62" r="10" fill={accent} />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
};

/** Feature deep-screen #3 — analytics */
const FeatureAnalyticsScreen: React.FC<{ accent?: string; title: string }> = ({ accent = C.accent, title }) => (
  <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="720" fill="#fff" />
    <text x="40" y="56" fontFamily={fontDisplay} fontWeight={700} fontSize="22" fill={C.ink}>
      {title}
    </text>
    <text x="40" y="80" fontFamily={fontSans} fontSize="12" fill={C.textMuted}>
      Insights — cohort 2026-Q1
    </text>
    {/* big line chart */}
    <g transform="translate(40, 110)">
      <rect width="760" height="320" rx="14" fill={C.paperWarm} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
        Activation — by cohort
      </text>
      {(() => {
        const lines = [
          { c: accent, v: [10, 22, 35, 48, 60, 70, 78, 84, 88, 90] },
          { c: C.electric, v: [8, 18, 28, 38, 48, 55, 62, 68, 72, 75] },
          { c: C.violet, v: [6, 14, 22, 30, 38, 44, 50, 56, 60, 64] },
        ];
        return lines.map((l, li) => {
          const w = 720;
          const h = 240;
          const ox = 20;
          const oy = 48;
          const pts = l.v.map((vv, i) => `${ox + (i * w) / 9},${oy + h - (vv / 100) * h}`);
          return <path key={li} d={`M${pts.join(' L')}`} fill="none" stroke={l.c} strokeWidth={2.5} />;
        });
      })()}
    </g>
    {/* cohort grid */}
    <g transform="translate(820, 110)">
      <rect width="340" height="320" rx="14" fill={C.paperWarm} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
        Retention heatmap
      </text>
      {Array.from({ length: 6 }).map((_, r) =>
        Array.from({ length: 8 }).map((_, c) => {
          if (c < r) return null;
          const val = Math.max(0.1, 1 - r * 0.1 - c * 0.05 + Math.random() * 0.08);
          return (
            <rect
              key={`${r}-${c}`}
              x={20 + c * 38}
              y={56 + r * 38}
              width={34}
              height={34}
              rx={4}
              fill={accent}
              fillOpacity={val}
            />
          );
        })
      )}
    </g>
    {/* bottom KPI strip */}
    {[
      { label: 'Time-to-value', value: '4.2 min' },
      { label: 'M3 retention', value: '78%' },
      { label: 'DAU/WAU', value: '0.61' },
      { label: 'NPS', value: '74' },
    ].map((k, i) => (
      <g key={k.label} transform={`translate(${40 + i * 280}, 460)`}>
        <rect width="260" height="220" rx="14" fill="#fff" stroke={C.line} />
        <text x="20" y="40" fontFamily={fontSans} fontSize="11" fill={C.textMuted}>
          {k.label.toUpperCase()}
        </text>
        <text x="20" y="120" fontFamily={fontDisplay} fontWeight={700} fontSize="56" fill={C.ink}>
          {k.value}
        </text>
        <rect x="20" y="160" width="220" height="6" rx="3" fill={C.paperDim} />
        <rect x="20" y="160" width={120 + i * 25} height="6" rx="3" fill={accent} />
        <text x="20" y="190" fontFamily={fontSans} fontSize="11" fill={C.textSoft}>
          vs. benchmark
        </text>
      </g>
    ))}
  </svg>
);

/** Mobile app mockup — for "users love it" */
const MobileScreen: React.FC<{ accent?: string }> = ({ accent = C.accent }) => (
  <svg viewBox="0 0 300 600" className="block h-full" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="300" height="600" rx="40" fill={C.ink} />
    <rect x="10" y="10" width="280" height="580" rx="32" fill="#fff" />
    <rect x="118" y="20" width="64" height="14" rx="7" fill={C.ink} />
    <g transform="translate(24, 60)">
      <text fontFamily={fontDisplay} fontWeight={700} fontSize="14" fill={C.ink}>
        Good morning, Mia
      </text>
      <text y="18" fontFamily={fontSans} fontSize="10" fill={C.textMuted}>
        2 things waiting on you
      </text>
    </g>
    <g transform="translate(24, 110)">
      <rect width="252" height="84" rx="14" fill={accent} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={700} fontSize="11" fill="#fff">
        Today's brief
      </text>
      <text x="20" y="52" fontFamily={fontSans} fontSize="10" fill="#FFE6D9">
        3 deals to review · 1 sign-off
      </text>
      <rect x="20" y="60" width="80" height="14" rx="7" fill="#fff" />
      <text x="60" y="70" textAnchor="middle" fontFamily={fontSans} fontWeight={600} fontSize="9" fill={accent}>
        Open
      </text>
    </g>
    {[0, 1, 2, 3].map((i) => (
      <g key={i} transform={`translate(24, ${210 + i * 76})`}>
        <rect width="252" height="64" rx="12" fill={C.paperWarm} />
        <circle cx="28" cy="32" r="14" fill={accent} fillOpacity={0.2} />
        <circle cx="28" cy="32" r="6" fill={accent} />
        <rect x="52" y="20" width="120" height="8" rx="3" fill={C.ink} />
        <rect x="52" y="36" width="160" height="6" rx="3" fill={C.textMuted} />
        <text x="232" y="36" textAnchor="end" fontFamily={fontMono} fontSize="9" fill={C.textMuted}>
          09:{30 + i * 5}
        </text>
      </g>
    ))}
    <g transform="translate(24, 540)">
      <rect width="252" height="40" rx="20" fill={C.ink} />
      {['Home', 'Inbox', 'Search', 'You'].map((t, i) => (
        <text
          key={t}
          x={32 + i * 64}
          y="24"
          fontFamily={fontSans}
          fontWeight={i === 0 ? 700 : 500}
          fontSize="10"
          fill={i === 0 ? accent : '#9AA0AC'}
          textAnchor="middle"
        >
          {t}
        </text>
      ))}
    </g>
  </svg>
);

/* ───────────────────────────── slides ───────────────────────────── */

type SlideProps<K extends keyof DemoDayData> = {
  data: DemoDayData;
  onEdit: (path: (string | number)[], value: string) => void;
  step: number;
  total: number;
  _section?: K;
};

const Slide1Cover: React.FC<SlideProps<'cover'>> = ({ data, onEdit, step, total }) => (
  <SlideFrame step={step} total={total} section={data.company.name} pad="px-16 py-12">
    <div className="grid grid-cols-12 gap-10 h-full items-center">
      <div className="col-span-5">
        <div className="flex items-center gap-3 mb-8">
          <LogoMark mark={data.company.logo_mark} />
          <div>
            <div className="font-bold text-xl" style={{ fontFamily: fontDisplay }}>
              <Editable value={data.company.name} path={['company', 'name']} onEdit={onEdit} />
            </div>
            <div className="text-xs uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
              <Editable value={data.cover.eyebrow} path={['cover', 'eyebrow']} onEdit={onEdit} />
            </div>
          </div>
        </div>
        <h1
          className="font-bold leading-[1.02] tracking-[-0.025em]"
          style={{ fontFamily: fontDisplay, fontSize: '72px' }}
        >
          <Editable value={data.cover.headline} path={['cover', 'headline']} onEdit={onEdit} />
        </h1>
        <p className="mt-6 text-xl leading-snug" style={{ color: C.textSoft, maxWidth: 520 }}>
          <Editable value={data.cover.sub} path={['cover', 'sub']} onEdit={onEdit} multiline />
        </p>
        <div className="mt-10 grid grid-cols-2 gap-4 max-w-md">
          {data.cover.metric_strip.map((m, i) => (
            <div key={i} className="rounded-2xl p-5" style={{ background: C.paperWarm }}>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
                <Editable value={m.label} path={['cover', 'metric_strip', i, 'label']} onEdit={onEdit} />
              </div>
              <div className="font-bold mt-1" style={{ fontFamily: fontDisplay, fontSize: '28px' }}>
                <Editable value={m.value} path={['cover', 'metric_strip', i, 'value']} onEdit={onEdit} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-7 h-[78%]">
        <BrowserChrome url={`app.${data.company.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/dashboard`}>
          <DashboardScreen companyName={data.company.name} />
        </BrowserChrome>
      </div>
    </div>
  </SlideFrame>
);

const Slide2Problem: React.FC<SlideProps<'problem'>> = ({ data, onEdit, step, total }) => (
  <SlideFrame step={step} total={total} section="The problem">
    <div className="grid grid-cols-12 gap-10 h-full items-center">
      <div className="col-span-5">
        <Pill tone="accent">Problem</Pill>
        <h2
          className="font-bold mt-5 tracking-[-0.022em] leading-[1.05]"
          style={{ fontFamily: fontDisplay, fontSize: '56px' }}
        >
          <Editable value={data.problem.headline} path={['problem', 'headline']} onEdit={onEdit} />
        </h2>
        <p className="mt-5 text-lg" style={{ color: C.textSoft }}>
          <Editable value={data.problem.sub} path={['problem', 'sub']} onEdit={onEdit} multiline />
        </p>
        <div className="mt-8 space-y-4">
          {data.problem.pain_points.map((p, i) => (
            <div key={i} className="flex gap-4">
              <div
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-bold"
                style={{ background: C.accentSoft, color: C.accent, fontFamily: fontMono }}
              >
                {i + 1}
              </div>
              <div>
                <div className="font-semibold text-base">
                  <Editable value={p.title} path={['problem', 'pain_points', i, 'title']} onEdit={onEdit} />
                </div>
                <div className="text-sm" style={{ color: C.textSoft }}>
                  <Editable value={p.detail} path={['problem', 'pain_points', i, 'detail']} onEdit={onEdit} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-7 h-[78%]">
        <BrowserChrome url="status quo · 17 tools · 0 view">
          <WorkflowScreen before />
        </BrowserChrome>
      </div>
    </div>
  </SlideFrame>
);

const Slide3Solution: React.FC<SlideProps<'solution'>> = ({ data, onEdit, step, total }) => (
  <SlideFrame step={step} total={total} section="The solution">
    <div className="grid grid-cols-12 gap-10 h-full items-center">
      <div className="col-span-5">
        <Pill tone="emerald">Solution</Pill>
        <h2
          className="font-bold mt-5 tracking-[-0.022em] leading-[1.05]"
          style={{ fontFamily: fontDisplay, fontSize: '56px' }}
        >
          <Editable value={data.solution.headline} path={['solution', 'headline']} onEdit={onEdit} />
        </h2>
        <p className="mt-5 text-lg" style={{ color: C.textSoft }}>
          <Editable value={data.solution.sub} path={['solution', 'sub']} onEdit={onEdit} multiline />
        </p>
        <div className="mt-8 space-y-4">
          {data.solution.transformation.map((t, i) => (
            <div key={i} className="rounded-2xl p-4 grid grid-cols-2 gap-3" style={{ background: C.paperWarm }}>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
                  Before
                </div>
                <div className="text-sm font-medium mt-1 line-through decoration-2" style={{ color: C.textSoft }}>
                  <Editable value={t.before} path={['solution', 'transformation', i, 'before']} onEdit={onEdit} />
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.accent }}>
                  After
                </div>
                <div className="text-sm font-semibold mt-1" style={{ color: C.ink }}>
                  <Editable value={t.after} path={['solution', 'transformation', i, 'after']} onEdit={onEdit} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-7 h-[78%]">
        <BrowserChrome url="one workflow · all your work">
          <WorkflowScreen />
        </BrowserChrome>
      </div>
    </div>
  </SlideFrame>
);

const Slide4Walkthrough: React.FC<SlideProps<'walkthrough'>> = ({ data, onEdit, step, total }) => (
  <SlideFrame step={step} total={total} section="Live walkthrough">
    <div className="mb-6">
      <Pill tone="electric">Demo</Pill>
      <h2 className="font-bold mt-4 tracking-[-0.022em]" style={{ fontFamily: fontDisplay, fontSize: '48px' }}>
        <Editable value={data.walkthrough.headline} path={['walkthrough', 'headline']} onEdit={onEdit} />
      </h2>
      <p className="text-base mt-2" style={{ color: C.textSoft }}>
        <Editable value={data.walkthrough.sub} path={['walkthrough', 'sub']} onEdit={onEdit} multiline />
      </p>
    </div>
    <div className="grid grid-cols-12 gap-6 flex-1">
      <div className="col-span-8 h-[78%]">
        <BrowserChrome url={`app.${data.company.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`}>
          <DashboardScreen companyName={data.company.name} />
        </BrowserChrome>
      </div>
      <div className="col-span-4 space-y-3">
        {data.walkthrough.steps.map((s, i) => (
          <div
            key={i}
            className="rounded-2xl p-4 border"
            style={{ borderColor: i === 0 ? C.accent : C.line, background: i === 0 ? C.accentSoft : '#fff' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm"
                style={{ background: i === 0 ? C.accent : C.paperDim, color: i === 0 ? '#fff' : C.textSoft }}
              >
                {i + 1}
              </div>
              <div className="font-semibold">
                <Editable value={s.title} path={['walkthrough', 'steps', i, 'title']} onEdit={onEdit} />
              </div>
            </div>
            <div className="text-sm mt-2" style={{ color: C.textSoft }}>
              <Editable value={s.detail} path={['walkthrough', 'steps', i, 'detail']} onEdit={onEdit} />
            </div>
          </div>
        ))}
      </div>
    </div>
  </SlideFrame>
);

const FeatureSlide: React.FC<SlideProps<'features'> & { idx: number; screen: React.ReactNode }> = ({
  data,
  onEdit,
  step,
  total,
  idx,
  screen,
}) => {
  // Defensive fallback: autofill may supply a partial features[]
  // (mergeShape replaces arrays wholesale when incoming is non-empty),
  // so an under-populated payload would otherwise null-deref. Fall
  // back to an empty-shape stub that renders gracefully.
  // Defensive against both a missing index AND a partial object — autofill
  // may write {name} only, in which case `bullets.map` / `name.toLowerCase`
  // would otherwise throw at render time.
  const raw = data.features[idx] ?? {};
  const f = {
    name: raw.name ?? `Feature 0${idx + 1}`,
    headline: raw.headline ?? '—',
    sub: raw.sub ?? '—',
    bullets: Array.isArray(raw.bullets) ? raw.bullets : [],
    metric_label: raw.metric_label ?? '',
    metric_value: raw.metric_value ?? '—',
  };
  return (
    <SlideFrame step={step} total={total} section={`Feature 0${idx + 1}`}>
      <div className="grid grid-cols-12 gap-10 h-full items-center">
        <div className="col-span-5">
          <Pill tone="accent">
            <Editable value={f.name} path={['features', idx, 'name']} onEdit={onEdit} />
          </Pill>
          <h2 className="font-bold mt-5 tracking-[-0.022em] leading-[1.05]" style={{ fontFamily: fontDisplay, fontSize: '54px' }}>
            <Editable value={f.headline} path={['features', idx, 'headline']} onEdit={onEdit} />
          </h2>
          <p className="mt-5 text-lg" style={{ color: C.textSoft }}>
            <Editable value={f.sub} path={['features', idx, 'sub']} onEdit={onEdit} multiline />
          </p>
          <ul className="mt-6 space-y-2.5">
            {f.bullets.map((b, bi) => (
              <li key={bi} className="flex gap-3 items-start text-base">
                <span
                  className="mt-2 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: C.accent }}
                />
                <Editable value={b} path={['features', idx, 'bullets', bi]} onEdit={onEdit} />
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl p-5 inline-flex items-baseline gap-3" style={{ background: C.ink, color: '#fff' }}>
            <span className="font-bold" style={{ fontFamily: fontDisplay, fontSize: '40px' }}>
              <Editable value={f.metric_value} path={['features', idx, 'metric_value']} onEdit={onEdit} />
            </span>
            <span className="text-sm opacity-80">
              <Editable value={f.metric_label} path={['features', idx, 'metric_label']} onEdit={onEdit} />
            </span>
          </div>
        </div>
        <div className="col-span-7 h-[78%]">
          <BrowserChrome url={`app.${data.company.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/${f.name.toLowerCase().replace(/\s+/g, '-')}`}>
            {screen}
          </BrowserChrome>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide8Love: React.FC<SlideProps<'love'>> = ({ data, onEdit, step, total }) => (
  <SlideFrame step={step} total={total} section="Why users love it">
    <div className="grid grid-cols-12 gap-10 h-full items-center">
      <div className="col-span-7">
        <Pill tone="emerald">Customer love</Pill>
        <h2 className="font-bold mt-5 tracking-[-0.022em] leading-[1.05]" style={{ fontFamily: fontDisplay, fontSize: '54px' }}>
          <Editable value={data.love.headline} path={['love', 'headline']} onEdit={onEdit} />
        </h2>
        <p className="mt-4 text-lg" style={{ color: C.textSoft }}>
          <Editable value={data.love.sub} path={['love', 'sub']} onEdit={onEdit} multiline />
        </p>
        <div className="mt-8 grid grid-cols-2 gap-5">
          {data.love.testimonials.map((t, i) => (
            <div key={i} className="rounded-2xl p-5 border" style={{ borderColor: C.line, background: '#fff' }}>
              <div className="text-3xl leading-none mb-2" style={{ color: C.accent, fontFamily: fontDisplay }}>
                "
              </div>
              <p className="text-[15px] leading-snug" style={{ color: C.ink }}>
                <Editable value={t.quote} path={['love', 'testimonials', i, 'quote']} onEdit={onEdit} multiline />
              </p>
              <div className="mt-4 flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs"
                  style={{ background: C.paperDim, color: C.textSoft }}
                >
                  {(t.author ?? '—')
                    .split(' ')
                    .map((w) => w[0] ?? '')
                    .slice(0, 2)
                    .join('')}
                </div>
                <div className="text-xs">
                  <div className="font-semibold" style={{ color: C.ink }}>
                    <Editable value={t.author} path={['love', 'testimonials', i, 'author']} onEdit={onEdit} />
                  </div>
                  <div style={{ color: C.textMuted }}>
                    <Editable value={t.role} path={['love', 'testimonials', i, 'role']} onEdit={onEdit} />
                    {' · '}
                    <Editable value={t.company} path={['love', 'testimonials', i, 'company']} onEdit={onEdit} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-4 gap-3">
          {[
            { l: 'DAU / WAU', v: `${data.love.engagement.dau_wau_pct}%` },
            { l: 'NPS', v: data.love.engagement.nps },
            { l: 'M6 retention', v: `${data.love.engagement.m6_retention_pct}%` },
            { l: 'Weekly actions', v: intShort(data.love.engagement.weekly_active_actions) },
          ].map((k) => (
            <div key={k.l} className="rounded-xl p-4" style={{ background: C.paperWarm }}>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
                {k.l}
              </div>
              <div className="font-bold mt-1" style={{ fontFamily: fontDisplay, fontSize: '24px' }}>
                {k.v}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-5 flex items-center justify-center h-full">
        <div className="h-[80%]">
          <MobileScreen />
        </div>
      </div>
    </div>
  </SlideFrame>
);

const Slide9Traction: React.FC<SlideProps<'traction'>> = ({ data, onEdit, step, total }) => {
  const series = data.traction.monthly_arr_series;
  const max = Math.max(...series.map((s) => s.arr_usd));
  const w = 760;
  const h = 280;
  const pts = series.map((s, i) => `${(i * w) / (series.length - 1)},${h - (s.arr_usd / max) * h}`);
  return (
    <SlideFrame step={step} total={total} section="Traction">
      <div className="mb-8">
        <Pill tone="accent">Traction</Pill>
        <h2 className="font-bold mt-4 tracking-[-0.022em]" style={{ fontFamily: fontDisplay, fontSize: '52px' }}>
          <Editable value={data.traction.headline} path={['traction', 'headline']} onEdit={onEdit} />
        </h2>
        <p className="mt-3 text-base" style={{ color: C.textSoft }}>
          <Editable value={data.traction.sub} path={['traction', 'sub']} onEdit={onEdit} multiline />
        </p>
      </div>
      <div className="grid grid-cols-12 gap-6 flex-1 items-stretch">
        <div className="col-span-4 space-y-4">
          {[
            { l: 'ARR', v: usdShort(data.traction.arr_usd), d: `+${data.traction.arr_growth_pct}% YoY`, t: 'accent' as const },
            { l: 'Customers', v: intShort(data.traction.customers), d: `+${data.traction.customer_growth_pct}% YoY`, t: 'electric' as const },
            { l: 'NRR', v: `${data.traction.nrr_pct}%`, d: 'best-in-class', t: 'emerald' as const },
            { l: 'Gross margin', v: `${data.traction.gross_margin_pct}%`, d: 'SaaS gold', t: 'emerald' as const },
          ].map((k) => (
            <div key={k.l} className="rounded-2xl p-5" style={{ background: C.paperWarm }}>
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
                  {k.l}
                </div>
                <Pill tone={k.t}>{k.d}</Pill>
              </div>
              <div className="font-bold mt-2" style={{ fontFamily: fontDisplay, fontSize: '38px' }}>
                {k.v}
              </div>
            </div>
          ))}
        </div>
        <div className="col-span-8 rounded-2xl border p-6" style={{ borderColor: C.line }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="font-semibold">ARR — last {series.length} months</div>
              <div className="text-xs" style={{ color: C.textMuted }}>
                Monthly recurring revenue × 12
              </div>
            </div>
            <Pill tone="emerald">▲ {data.traction.arr_growth_pct}% YoY</Pill>
          </div>
          <svg viewBox={`0 0 ${w} ${h + 40}`} className="w-full h-[280px]">
            <defs>
              <linearGradient id="t-grad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={C.accent} stopOpacity="0.35" />
                <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`M0,${h} L${pts.join(' L')} L${w},${h} Z`} fill="url(#t-grad)" />
            <path d={`M${pts.join(' L')}`} fill="none" stroke={C.accent} strokeWidth={2.5} />
            {pts.map((p, i) => {
              const [x, y] = p.split(',').map(Number);
              return <circle key={i} cx={x} cy={y} r={3.5} fill="#fff" stroke={C.accent} strokeWidth={2} />;
            })}
            {series.map((s, i) =>
              i % Math.ceil(series.length / 6) === 0 ? (
                <text
                  key={i}
                  x={(i * w) / (series.length - 1)}
                  y={h + 20}
                  textAnchor="middle"
                  fontFamily={fontMono}
                  fontSize="10"
                  fill={C.textMuted}
                >
                  {s.month}
                </text>
              ) : null
            )}
          </svg>
          <div className="mt-4 pt-4 border-t flex items-center gap-3 flex-wrap" style={{ borderColor: C.line }}>
            <span className="text-xs uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
              Customers
            </span>
            {data.traction.logos.map((l, i) => (
              <span
                key={i}
                className="px-3 py-1 rounded-md text-xs font-semibold"
                style={{ background: C.paperWarm, color: C.textSoft, fontFamily: fontDisplay }}
              >
                <Editable value={l} path={['traction', 'logos', i]} onEdit={onEdit} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide10Market: React.FC<SlideProps<'market'>> = ({ data, onEdit, step, total }) => {
  const tam = data.market.tam_usd;
  const sam = data.market.sam_usd;
  const som = data.market.som_usd;
  const tamR = 220;
  const samR = (Math.sqrt(sam / tam) * tamR) || 120;
  const somR = (Math.sqrt(som / tam) * tamR) || 40;
  return (
    <SlideFrame step={step} total={total} section="Market opportunity">
      <div className="grid grid-cols-12 gap-10 h-full items-center">
        <div className="col-span-5">
          <Pill tone="violet">Market</Pill>
          <h2 className="font-bold mt-5 tracking-[-0.022em] leading-[1.05]" style={{ fontFamily: fontDisplay, fontSize: '54px' }}>
            <Editable value={data.market.headline} path={['market', 'headline']} onEdit={onEdit} />
          </h2>
          <p className="mt-5 text-lg" style={{ color: C.textSoft }}>
            <Editable value={data.market.sub} path={['market', 'sub']} onEdit={onEdit} multiline />
          </p>
          <div className="mt-6 space-y-3">
            {data.market.trends.map((t, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span className="w-1.5 h-1.5 rounded-full mt-2.5 shrink-0" style={{ background: C.violet }} />
                <div>
                  <div className="font-semibold">
                    <Editable value={t.label} path={['market', 'trends', i, 'label']} onEdit={onEdit} />
                  </div>
                  <div className="text-sm" style={{ color: C.textSoft }}>
                    <Editable value={t.detail} path={['market', 'trends', i, 'detail']} onEdit={onEdit} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl p-4" style={{ background: C.violetSoft }}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.violet }}>
              Expansion paths
            </div>
            <div className="text-sm mt-1" style={{ color: C.ink }}>
              {data.market.expansion.join(' · ')}
            </div>
          </div>
        </div>
        <div className="col-span-7 flex items-center justify-center h-full">
          <svg viewBox="-280 -260 560 520" className="w-full max-w-[600px]">
            <circle cx="0" cy="0" r={tamR} fill={C.violet} fillOpacity={0.08} stroke={C.violet} strokeOpacity={0.4} />
            <circle cx="0" cy="0" r={samR} fill={C.violet} fillOpacity={0.18} stroke={C.violet} strokeOpacity={0.6} />
            <circle cx="0" cy="0" r={somR} fill={C.violet} stroke={C.violet} />
            <text y={-tamR - 14} textAnchor="middle" fontFamily={fontMono} fontSize="11" fill={C.textMuted}>
              TAM
            </text>
            <text y={-tamR + 14} textAnchor="middle" fontFamily={fontDisplay} fontWeight={700} fontSize="20" fill={C.ink}>
              {usdShort(tam)}
            </text>
            <text x={samR + 8} y={-4} fontFamily={fontMono} fontSize="11" fill={C.violet}>
              SAM · {usdShort(sam)}
            </text>
            <text x={somR + 6} y={4} fontFamily={fontMono} fontSize="11" fill="#fff">
              SOM · {usdShort(som)}
            </text>
          </svg>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide11Team: React.FC<SlideProps<'team'>> = ({ data, onEdit, step, total }) => (
  <SlideFrame step={step} total={total} section="Team">
    <div className="mb-8">
      <Pill tone="electric">Team</Pill>
      <h2 className="font-bold mt-4 tracking-[-0.022em]" style={{ fontFamily: fontDisplay, fontSize: '52px' }}>
        <Editable value={data.team.headline} path={['team', 'headline']} onEdit={onEdit} />
      </h2>
      <p className="mt-3 text-base" style={{ color: C.textSoft }}>
        <Editable value={data.team.sub} path={['team', 'sub']} onEdit={onEdit} multiline />
      </p>
    </div>
    <div className="grid grid-cols-3 gap-6 flex-1">
      {data.team.members.map((m, i) => (
        <div key={i} className="rounded-2xl border p-6 flex flex-col" style={{ borderColor: C.line }}>
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5"
            style={{
              background: `linear-gradient(135deg, ${C.accent} 0%, ${i === 0 ? '#FF8A4C' : i === 1 ? C.electric : C.violet} 100%)`,
              color: '#fff',
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: 32,
            }}
          >
            {m.initials}
          </div>
          <div className="font-bold text-xl" style={{ fontFamily: fontDisplay }}>
            <Editable value={m.name} path={['team', 'members', i, 'name']} onEdit={onEdit} />
          </div>
          <div className="text-sm font-medium" style={{ color: C.accent }}>
            <Editable value={m.role} path={['team', 'members', i, 'role']} onEdit={onEdit} />
          </div>
          <p className="text-sm mt-3 leading-snug flex-1" style={{ color: C.textSoft }}>
            <Editable value={m.bio} path={['team', 'members', i, 'bio']} onEdit={onEdit} multiline />
          </p>
          <div
            className="mt-4 pt-4 border-t text-xs uppercase tracking-[0.16em]"
            style={{ borderColor: C.line, color: C.textMuted }}
          >
            Previously
          </div>
          <div className="text-sm font-medium" style={{ color: C.ink }}>
            <Editable value={m.previously} path={['team', 'members', i, 'previously']} onEdit={onEdit} />
          </div>
        </div>
      ))}
    </div>
    {data.team.advisors.length > 0 && (
      <div className="mt-6 rounded-2xl p-4 flex items-center gap-4 flex-wrap" style={{ background: C.paperWarm }}>
        <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.textMuted }}>
          Advisors
        </span>
        {data.team.advisors.map((a, i) => (
          <span key={i} className="text-sm font-medium" style={{ color: C.ink }}>
            <Editable value={a} path={['team', 'advisors', i]} onEdit={onEdit} />
          </span>
        ))}
      </div>
    )}
  </SlideFrame>
);

const Slide12Fundraise: React.FC<SlideProps<'fundraise'>> = ({ data, onEdit, step, total }) => (
  <div
    className="relative w-full h-full overflow-hidden px-20 py-14"
    style={{ background: C.ink, color: '#fff', fontFamily: fontSans }}
  >
    <div className="absolute top-6 left-20 right-20 flex items-center justify-between text-[11px] tracking-[0.18em] uppercase opacity-60">
      <span>Fundraise · Vision</span>
      <span>
        {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
    <div className="grid grid-cols-12 gap-10 h-full items-center">
      <div className="col-span-7">
        <span
          className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] tracking-[0.18em] uppercase font-medium"
          style={{ background: 'rgba(255,90,31,0.18)', color: '#FFB58D' }}
        >
          We're raising
        </span>
        <h2 className="font-bold mt-5 tracking-[-0.025em] leading-[1.02]" style={{ fontFamily: fontDisplay, fontSize: '92px' }}>
          {usdShort(data.fundraise.amount_usd)}
        </h2>
        <div className="mt-3 text-xl opacity-80">
          <Editable
            value={`${data.fundraise.instrument} · ${data.fundraise.valuation_label} · ${data.fundraise.runway_months} months runway`}
            path={['fundraise', 'sub']}
            onEdit={onEdit}
          />
        </div>
        <h3 className="mt-12 font-bold tracking-[-0.018em]" style={{ fontFamily: fontDisplay, fontSize: '34px' }}>
          <Editable value={data.fundraise.headline} path={['fundraise', 'headline']} onEdit={onEdit} />
        </h3>
        <div className="mt-8 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">Use of funds</div>
            <div className="mt-3 space-y-2">
              {data.fundraise.use_of_funds.map((u, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      <Editable value={u.label} path={['fundraise', 'use_of_funds', i, 'label']} onEdit={onEdit} />
                    </span>
                    <span className="font-mono opacity-80">{u.pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full" style={{ width: `${u.pct}%`, background: C.accent }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">12-month milestones</div>
            <ul className="mt-3 space-y-2">
              {data.fundraise.milestones.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: C.accent }} />
                  <Editable value={m} path={['fundraise', 'milestones', i]} onEdit={onEdit} />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-10 text-2xl font-medium leading-snug" style={{ fontFamily: fontDisplay, color: '#FFB58D' }}>
          <Editable value={data.fundraise.closing_line} path={['fundraise', 'closing_line']} onEdit={onEdit} multiline />
        </div>
        <div className="mt-4 text-sm opacity-70">
          <Editable value={data.fundraise.contact_email} path={['fundraise', 'contact_email']} onEdit={onEdit} />
        </div>
      </div>
      <div className="col-span-5 h-[78%]">
        <BrowserChrome url={`${data.company.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`}>
          <DashboardScreen companyName={data.company.name} accent={C.accent} />
        </BrowserChrome>
      </div>
    </div>
  </div>
);

/* ───────────────────────────── deck shell ───────────────────────── */

export const DemoDayDeckApp: React.FC<{ initial?: DemoDayData }> = ({ initial = SAMPLE_DATA }) => {
  const [data, setData] = useState<DemoDayData>(initial);
  const [idx, setIdx] = useState(0);

  const onEdit = useCallback((path: (string | number)[], value: string) => {
    setData((prev) => setIn(prev, path, value));
  }, []);

  const slides = useMemo(
    () => [
      (p: { step: number; total: number }) => <Slide1Cover data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide2Problem data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide3Solution data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide4Walkthrough data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => (
        <FeatureSlide data={data} onEdit={onEdit} {...p} idx={0} screen={<FeatureSplitScreen title={data.features[0]?.name ?? ''} />} />
      ),
      (p: { step: number; total: number }) => (
        <FeatureSlide data={data} onEdit={onEdit} {...p} idx={1} screen={<FeatureKanbanScreen title={data.features[1]?.name ?? ''} />} />
      ),
      (p: { step: number; total: number }) => (
        <FeatureSlide data={data} onEdit={onEdit} {...p} idx={2} screen={<FeatureAnalyticsScreen title={data.features[2]?.name ?? ''} />} />
      ),
      (p: { step: number; total: number }) => <Slide8Love data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide9Traction data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide10Market data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide11Team data={data} onEdit={onEdit} {...p} />,
      (p: { step: number; total: number }) => <Slide12Fundraise data={data} onEdit={onEdit} {...p} />,
    ],
    [data, onEdit]
  );

  const total = slides.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        setIdx((i) => Math.min(total - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Home') setIdx(0);
      else if (e.key === 'End') setIdx(total - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  return (
    <div className="w-screen h-screen flex items-center justify-center" style={{ background: '#E5E9F2' }}>
      <div
        className="relative shadow-2xl"
        style={{
          width: 'min(96vw, calc(96vh * 16 / 9))',
          aspectRatio: '16 / 9',
          background: '#fff',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0"
          >
            {slides[idx]({ step: idx + 1, total })}
          </motion.div>
        </AnimatePresence>

        {/* nav controls */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', boxShadow: '0 4px 18px rgba(0,0,0,0.08)' }}>
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            className="px-2 py-1 text-sm rounded-md hover:bg-slate-100"
            aria-label="Previous"
          >
            ◀
          </button>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              className="w-2 h-2 rounded-full transition-all"
              style={{
                background: i === idx ? C.accent : C.line,
                transform: i === idx ? 'scale(1.4)' : 'scale(1)',
              }}
            />
          ))}
          <button
            onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
            className="px-2 py-1 text-sm rounded-md hover:bg-slate-100"
            aria-label="Next"
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
};

export default DemoDayDeckApp;

/* ───────────────────────── sample data (Axal bind) ──────────────── */
/*
 * The exact field names below mirror the columns the autofill layer
 * writes from `cloudflare-worker/src/routes/decks.ts heuristicSlides()`
 * after the migration in Replit Prompt MD (`00xx_deck_autofill_fields.sql`).
 *
 * Mapping summary (Axal row → DemoDayData path):
 *   projects.name              → company.name
 *   projects.one_liner         → cover.headline / company.tagline
 *   projects.tagline           → cover.eyebrow
 *   projects.vision            → company.vision
 *   projects.problem_statement → problem.headline
 *   projects.solution          → solution.headline
 *   projects.wedge             → features[0].headline
 *   projects.business_model    → solution.transformation[*].after
 *   projects.sector            → company.sector
 *   projects.subsector         → market.sub
 *   projects.tam_usd / sam_usd / som_usd  → market.tam_usd / sam_usd / som_usd
 *   projects.tam_source_url    → footnote on market slide (rendered as caption)
 *   projects.team_one_line     → team.sub
 *   projects.competitors_json  → walkthrough.steps (pain-mitigation framing)
 *   financial_models.arr_usd / mrr_usd       → traction.arr_usd
 *   financial_models.gross_margin_pct        → traction.gross_margin_pct
 *   financial_models.nrr_pct                 → traction.nrr_pct, love.engagement
 *   financial_models.paying_customers        → traction.customers
 *   financial_models.runway_months           → fundraise.runway_months
 *   metrics_snapshots.dau / wau              → love.engagement.dau_wau_pct
 *   metrics_snapshots.m6_retention            → love.engagement.m6_retention_pct
 *   metrics_snapshots.activation_pct          → walkthrough success rate
 *   rounds.target_amount_usd                  → fundraise.amount_usd
 *   rounds.instrument                         → fundraise.instrument
 *   rounds.valuation_cap_usd                  → fundraise.valuation_label
 *   rounds.use_of_funds (JSON [{label,pct}])  → fundraise.use_of_funds
 *   users.full_name / role / bio (founders)   → team.members[*]
 *   users.email (primary founder)             → fundraise.contact_email
 *   advisor_answers.* (testimonials tag)      → love.testimonials
 *   metrics_snapshots monthly_arr_series      → traction.monthly_arr_series
 *
 * Empty fields fall through to `"—"` per heuristicSlides() convention.
 */

export const SAMPLE_DATA: DemoDayData = {
  company: {
    name: 'Loopline',
    tagline: 'The operating system for revenue teams',
    vision: 'Make every revenue team operate like the best team in the world.',
    sector: 'B2B SaaS',
    stage: 'Seed',
    location: 'San Francisco, CA',
    founded_year: 2025,
    logo_mark: 'L',
  },
  cover: {
    headline: 'Close 3× more deals — without adding reps.',
    sub: 'Loopline is the AI workspace that runs your pipeline, drafts your follow-ups, and tells your team what to do next.',
    eyebrow: 'YC Demo Day · S26',
    metric_strip: [
      { label: 'ARR', value: '$3.2M' },
      { label: 'Customers', value: '142' },
      { label: 'Growth', value: '38% MoM' },
      { label: 'NRR', value: '138%' },
    ],
  },
  problem: {
    headline: 'Revenue teams ship more tools than they ship deals.',
    sub: 'The average B2B seller works across 17 tools, switches context 1,200×/day, and spends 64% of their week on admin — not selling.',
    pain_points: [
      { title: 'Pipeline is opaque.', detail: 'Forecasts are guesses. Slipped deals surface in QBRs, not in time to save.' },
      { title: 'Follow-up is manual.', detail: 'The best reps win on hustle. The rest forget to follow up.' },
      { title: 'Coaching does not scale.', detail: 'Leaders coach the top 20% and lose the middle 60%.' },
    ],
    workflow_today: ['CRM', 'Sheets', 'Email', 'Slack', 'Notion', 'Linear', 'Docs', 'Drive'],
  },
  solution: {
    headline: 'One workspace. Every deal, surfaced. Every action, drafted.',
    sub: 'Loopline reads your pipeline, drafts the next move, and auto-routes the work — so every rep operates like your top rep.',
    transformation: [
      { before: '17 tools, 0 view', after: 'One connected workspace' },
      { before: 'Reps forget follow-ups', after: 'Drafts ready, one click to send' },
      { before: 'Forecast = vibes', after: 'Forecast = math + signal' },
      { before: 'Top-rep coaching only', after: 'Every rep coached on every call' },
    ],
  },
  walkthrough: {
    headline: 'The flow we built for the world\'s best revenue teams.',
    sub: 'Three taps from new lead to closed deal.',
    steps: [
      { title: 'See the deal', detail: 'Loopline pulls every signal — calls, emails, intent, usage — into one card.' },
      { title: 'Get the next move', detail: 'AI drafts the email, the call plan, the demo agenda. You approve.' },
      { title: 'Close the loop', detail: 'When the deal closes, onboarding fires automatically into your CS tool.' },
      { title: 'Coach the rep', detail: 'Every call scored against your playbook. Coaching surfaced in 1:1s.' },
    ],
  },
  features: [
    {
      name: 'Pipeline AI',
      headline: 'Your pipeline, but explained.',
      sub: 'Loopline reads every signal in the deal and writes a one-sentence story — what changed, why, what to do.',
      bullets: [
        'Auto-summary on every account, every day.',
        'Slipping-deal alerts 14 days before quarter close.',
        'Forecast accuracy +28pt vs. CRM-only baseline.',
      ],
      metric_label: 'avg. forecast accuracy lift',
      metric_value: '+28pt',
    },
    {
      name: 'Workflow Studio',
      headline: 'Move work like Linear moves issues.',
      sub: 'A kanban that knows your sales motion. Drop a deal into "negotiation" and the contract, redlines, and approval workflow fire automatically.',
      bullets: [
        'Templated motions for SMB, mid-market, enterprise.',
        'Auto-handoff between sales, CS, finance.',
        'Zero-config integrations with your existing CRM.',
      ],
      metric_label: 'hours saved per rep per week',
      metric_value: '11h',
    },
    {
      name: 'Coaching Insights',
      headline: 'Coach every call. Not just the deals you lost.',
      sub: 'Loopline scores every call against your playbook and surfaces the 3 moments a rep can improve, with the clip and the script.',
      bullets: [
        'Trained on your top 10% of calls, not generic models.',
        'Cohort heatmaps show where reps level up — and stall.',
        'Used by 80% of managers weekly in pilot accounts.',
      ],
      metric_label: 'ramp time reduction',
      metric_value: '−42%',
    },
  ],
  love: {
    headline: 'The teams who use Loopline daily are growing 3× faster.',
    sub: '74 NPS, 92% weekly retention, and word-of-mouth referrals drive 38% of new sign-ups.',
    testimonials: [
      {
        quote: 'Loopline is the first tool my reps actually open without being told. Forecast accuracy jumped 30 points in a quarter.',
        author: 'Mia Chen',
        role: 'VP Sales',
        company: 'Northwind',
      },
      {
        quote: 'It replaced four tools, two spreadsheets, and one full-time ops hire.',
        author: 'Jonas Becker',
        role: 'CRO',
        company: 'Acme',
      },
      {
        quote: 'My reps thank me for it. That has never happened with any sales tool, ever.',
        author: 'Priya Patel',
        role: 'Head of Revenue',
        company: 'Globex',
      },
      {
        quote: 'I would pay 5× what they charge. Do not tell them.',
        author: 'Wei Zhang',
        role: 'Founder & CEO',
        company: 'Initech',
      },
    ],
    engagement: { dau_wau_pct: 61, nps: 74, m6_retention_pct: 92, weekly_active_actions: 184000 },
  },
  traction: {
    headline: '$3.2M ARR, growing 38% MoM, with 138% net revenue retention.',
    sub: '142 paying customers in 14 months. 92% gross retention. The fastest-growing cohort we have ever seen at this stage.',
    arr_usd: 3_200_000,
    arr_growth_pct: 580,
    customers: 142,
    customer_growth_pct: 320,
    nrr_pct: 138,
    gross_margin_pct: 84,
    monthly_arr_series: [
      { month: 'Apr', arr_usd: 180_000 },
      { month: 'May', arr_usd: 240_000 },
      { month: 'Jun', arr_usd: 320_000 },
      { month: 'Jul', arr_usd: 420_000 },
      { month: 'Aug', arr_usd: 560_000 },
      { month: 'Sep', arr_usd: 740_000 },
      { month: 'Oct', arr_usd: 980_000 },
      { month: 'Nov', arr_usd: 1_280_000 },
      { month: 'Dec', arr_usd: 1_640_000 },
      { month: 'Jan', arr_usd: 2_080_000 },
      { month: 'Feb', arr_usd: 2_620_000 },
      { month: 'Mar', arr_usd: 3_200_000 },
    ],
    logos: ['Northwind', 'Acme', 'Globex', 'Initech', 'Hooli', 'Stark', 'Wonka', 'Soylent'],
  },
  market: {
    headline: '$84B and the entire revenue stack is up for rebuild.',
    sub: 'Sales tech is fragmented across 1,200 tools. AI is collapsing the stack into a single workspace — and the buyer is ready.',
    tam_usd: 84_000_000_000,
    sam_usd: 18_000_000_000,
    som_usd: 1_400_000_000,
    trends: [
      { label: 'Stack consolidation.', detail: 'CROs are cutting tool count 40% in 2026. Loopline replaces 4–6 tools per customer.' },
      { label: 'AI-native buyers.', detail: 'New leadership is hired specifically to deploy AI in revenue. They write the cheques.' },
      { label: 'Outcome-priced motion.', detail: 'Buyers want guaranteed lift. Our pricing maps to forecast accuracy gain.' },
    ],
    expansion: ['Customer Success', 'Marketing Ops', 'Partner Ops', 'International (UK/DE/FR)'],
  },
  team: {
    headline: 'Built by the operators who already did this once.',
    sub: 'Two co-founders, 18 years combined building and running revenue teams at category-defining companies.',
    members: [
      {
        name: 'Sofia Marquez',
        role: 'CEO & Co-founder',
        bio: 'Ran a 120-person revenue org through IPO. Built three of the top-five sales playbooks her industry now copies.',
        previously: 'VP Revenue · Plaid',
        initials: 'SM',
      },
      {
        name: 'Daniel Okafor',
        role: 'CTO & Co-founder',
        bio: 'Shipped AI products to 40M users. First engineer at a unicorn; rebuilt Stripe\'s pipeline ML from scratch.',
        previously: 'Staff Eng · Stripe',
        initials: 'DO',
      },
      {
        name: 'Hana Ito',
        role: 'Head of Design',
        bio: 'Designed the product surfaces investors keep showing other founders as the bar. Linear, Notion, now Loopline.',
        previously: 'Design Lead · Linear',
        initials: 'HI',
      },
    ],
    advisors: ['Jeff Lawson (Twilio)', 'Tracy Young (PlanGrid)', 'Lenny Rachitsky (Lenny\'s Newsletter)'],
  },
  fundraise: {
    headline: 'We are raising a $12M Series A to win the revenue stack — for good.',
    sub: '24 months runway · Series A · target close June 2026',
    amount_usd: 12_000_000,
    instrument: 'Series A Preferred',
    valuation_label: '$80M pre',
    runway_months: 24,
    use_of_funds: [
      { label: 'Engineering & AI', pct: 55 },
      { label: 'GTM & Customer Success', pct: 30 },
      { label: 'Brand, marketing, ops', pct: 15 },
    ],
    milestones: [
      '$12M ARR by Q4 2026',
      '500 customers across 3 verticals',
      'Two new product surfaces (CS, MarketingOps)',
      'EU expansion: UK + DE launched',
    ],
    closing_line: 'The revenue team you wish you had — built into one product. Come build it with us.',
    contact_email: 'sofia@loopline.ai',
  },
};
// ─────────────────────────────────────────────────────────────────
// Registry adapter — `Deck_demo_day_app`
//
// Wraps each of the 12 slides in <Slide16x9> so the platform print
// pipeline (PitchDeckPrintPage.jsx) can find each slide via the
// `[data-slide-frame]` hook and so per-slide page breaks fire
// during window.print(). Mirrors the pattern from
// series_a_growth_app + series_b_diligence_app.
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

export const Deck_demo_day_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => (
  <BrandProvider data={data || {}} fallbackAccent="#FF6600">
    <Deck_demo_day_app_inner data={data} editable={editable} onEdit={onEdit} />
  </BrandProvider>
);

const Deck_demo_day_app_inner: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const { accent: brandAccent } = useBrandContext();
  const merged = useMemo(
    () => mergeShape(SAMPLE_DATA, data || {}) as DemoDayData,
    [data],
  );
  // Bridge demo_day's array-path onEdit signature to the registry's
  // dot-string signature. No-op when not editable.
  const handleEdit = useCallback(
    (path: (string | number)[], value: string) => {
      if (!editable || !onEdit) return;
      onEdit(path.join('.'), value);
    },
    [editable, onEdit],
  );
  // Task #6 — brand accent override for accent_only templates
  const brandAccentOrDefault = brandAccent || C.accent;
  const ac = brandAccentOrDefault;

  const total = 12;
  const slides: React.ReactNode[] = [
    <Slide1Cover       data={merged} onEdit={handleEdit} step={1}  total={total} />,
    <Slide2Problem     data={merged} onEdit={handleEdit} step={2}  total={total} />,
    <Slide3Solution    data={merged} onEdit={handleEdit} step={3}  total={total} />,
    <Slide4Walkthrough data={merged} onEdit={handleEdit} step={4}  total={total} />,
    <FeatureSlide      data={merged} onEdit={handleEdit} step={5}  total={total} idx={0} screen={<FeatureSplitScreen    title={merged.features[0]?.name ?? ''} />} />,
    <FeatureSlide      data={merged} onEdit={handleEdit} step={6}  total={total} idx={1} screen={<FeatureKanbanScreen   title={merged.features[1]?.name ?? ''} />} />,
    <FeatureSlide      data={merged} onEdit={handleEdit} step={7}  total={total} idx={2} screen={<FeatureAnalyticsScreen title={merged.features[2]?.name ?? ''} />} />,
    <Slide8Love        data={merged} onEdit={handleEdit} step={8}  total={total} />,
    <Slide9Traction    data={merged} onEdit={handleEdit} step={9}  total={total} />,
    <Slide10Market     data={merged} onEdit={handleEdit} step={10} total={total} />,
    <Slide11Team       data={merged} onEdit={handleEdit} step={11} total={total} />,
    <Slide12Fundraise  data={merged} onEdit={handleEdit} step={12} total={total} />,
  ];

  return (
    <>
      {slides.map((slide, i) => (
        <Slide16x9 key={i}>{slide}</Slide16x9>
      ))}
    </>
  );
};
