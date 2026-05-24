// frontend/src/decks/templates/series_a_growth_app.tsx
//
// Series A — 15 slides. Metrics + GTM heavy. Datadog/Snowflake/
// Figma/Stripe/Notion/Linear visual quality. Executive, data-centric.
// SVG + Recharts (already in StudioOS deps). Framer Motion transitions.
//
// Binds to Axal platform data via `data` prop; falls back to
// SAMPLE_DATA. Cloudflare Browser Rendering captures 16:9 for PDF.
//
// Requires: framer-motion + recharts (verify both in package.json).

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Legend,
  ComposedChart,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type SeriesAData = {
  // Identity
  company?: string;
  domain?: string;
  category?: string;

  // 1 — Vision
  vision_headline?: string;
  vision_subline?: string;
  vision_category?: string;

  // 2 — Market shift
  shift_pillars?: { kind: 'tech' | 'reg' | 'econ' | 'social'; title: string; body: string }[];
  shift_curve?: { year: string; baseline: number; new_world: number }[];

  // 3 — Problem
  problem_headline?: string;
  problem_quant?: { value: string; label: string }[];
  pain_points?: string[];

  // 4 — Solution
  solution_headline?: string;
  workflow_before?: string[];
  workflow_after?: string[];

  // 5 — Product
  product_modules?: { name: string; capabilities: string[] }[];
  user_journey?: string[];

  // 6 — Market
  tam_usd?: number;
  sam_usd?: number;
  som_usd?: number;
  market_cagr_pct?: number;
  market_curve?: { year: string; v: number }[];
  expansion_vectors?: string[];

  // 7 — Traction overview (KPI dashboard)
  arr_usd?: number;
  mrr_usd?: number;
  paying_customers?: number;
  active_users?: number;
  growth_mom_pct?: number;
  growth_yoy_pct?: number;
  nrr_pct?: number;
  gross_margin_pct?: number;
  monthly_churn_pct?: number;
  magic_number?: number;
  rule_of_40?: number;
  payback_months?: number;

  // 8 — Revenue growth
  arr_series?: { month: string; v: number }[];
  mrr_series?: { month: string; v: number }[];
  arr_forecast?: { month: string; v: number; forecast?: number }[];

  // 9 — Customer adoption
  customer_logos?: { name: string; initials?: string; tier?: 'enterprise' | 'mid' | 'smb' }[];
  retention_cohort?: { m: string; v: number }[]; // M0..M12 percentages
  weekly_usage?: { week: string; v: number }[];
  expansion_layers?: { label: string; v: number }[]; // gross, net, expansion

  // 10 — Unit economics
  cac_usd?: number;
  ltv_usd?: number;
  ltv_cac?: number;
  contribution_margin_pct?: number;
  cac_payback_curve?: { month: string; recovered_pct: number }[];

  // 11 — GTM
  funnel?: { stage: string; v: number; conversion_pct?: number }[];
  channels?: { name: string; share_pct: number; cac_usd?: number }[];
  sales_motion?: string[];

  // 12 — Growth engine
  flywheel_nodes?: { label: string; body?: string }[];
  network_effects?: string[];

  // 13 — Competition & moat
  competitors?: { name: string; x: number; y: number; is_us?: boolean }[];
  axis_x?: string;
  axis_y?: string;
  moats?: { title: string; body: string }[];

  // 14 — Team
  founders?: { name: string; role: string; bio: string; initials?: string }[];
  leaders?: { name: string; role: string; initials?: string }[];
  key_hires_planned?: string[];

  // 15 — Fundraise
  ask_amount_usd?: number;
  prior_round_usd?: number;
  current_runway_months?: number;
  post_raise_runway_months?: number;
  use_of_funds?: { label: string; pct: number }[];
  hiring_plan?: { role: string; count: number }[];
  milestones?: { quarter: string; goal: string; metric?: string }[];
  closing_line?: string;
  contact?: string;
};

export type DeckProps = {
  data?: SeriesAData;
  editable?: boolean;
  onEdit?: (path: string, value: string) => void;
};

// ─────────────────────────────────────────────────────────────────
// Tokens — executive, data-centric, premium
// ─────────────────────────────────────────────────────────────────

const PAPER = '#FFFFFF';
const INK = '#0B1220';
const ACCENT = '#4F46E5';        // primary (indigo)
const ACCENT_2 = '#0EA5E9';       // secondary (sky)
const POSITIVE = '#10B981';       // emerald
const ALERT = '#F59E0B';          // amber
const SUBTLE = '#475569';
const FAINT = '#94A3B8';
const HAIRLINE = '#E2E8F0';
const SURFACE = '#F8FAFC';
const SURFACE_2 = '#F1F5F9';
const PANEL = '#FAFBFC';

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
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
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
// Slide frame — executive header strip + footer + page index
// ─────────────────────────────────────────────────────────────────

const SECTION_LABELS = [
  'Vision', 'Market Shift', 'Problem', 'Solution', 'Product',
  'Market Opportunity', 'Traction', 'Revenue Growth', 'Customer Adoption',
  'Unit Economics', 'Go-To-Market', 'Growth Engine', 'Competition & Moat',
  'Team', 'Fundraise',
];

const SlideFrame: React.FC<
  React.PropsWithChildren<{
    index: number;
    total: number;
    question: string;
    company?: string;
    accent?: string;
    bg?: string;
    ink?: string;
  }>
> = ({ index, total, question, company, accent = ACCENT, bg = PAPER, ink = INK, children }) => (
  <div
    className="relative"
    style={{
      aspectRatio: '16 / 9',
      width: '100%',
      maxHeight: '100vh',
      background: bg,
      color: ink,
      fontFamily: FONT,
      padding: 'clamp(28px, 4vw, 64px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}
  >
    {/* Header strip */}
    <div className="flex items-center justify-between" style={{ marginBottom: 'clamp(16px, 2vw, 32px)' }}>
      <div className="flex items-center gap-3">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 8,
            background: accent,
            color: '#FFFFFF',
            fontSize: 12,
            fontWeight: 800,
            fontFamily: FONT_MONO,
            letterSpacing: 1,
          }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <span
          style={{
            fontSize: 11,
            letterSpacing: '0.32em',
            fontWeight: 700,
            color: SUBTLE,
            textTransform: 'uppercase',
          }}
        >
          {SECTION_LABELS[index]}
        </span>
      </div>
      <div className="flex items-center gap-6">
        <span style={{ fontSize: 12, color: FAINT, fontStyle: 'italic' }}>
          {question}
        </span>
        <span style={{ fontSize: 11, color: FAINT, letterSpacing: 2, fontFamily: FONT_MONO }}>
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>
    </div>

    {/* Content */}
    <div className="flex-1 min-h-0 flex flex-col">{children}</div>

    {/* Footer */}
    <div
      className="flex items-center justify-between"
      style={{
        marginTop: 'clamp(12px, 1.5vw, 24px)',
        paddingTop: 12,
        borderTop: `1px solid ${HAIRLINE}`,
      }}
    >
      <span style={{ fontSize: 10, color: FAINT, letterSpacing: 2.5, fontFamily: FONT_MONO }}>
        {(company || 'Company').toUpperCase()} · SERIES A · CONFIDENTIAL
      </span>
      <span style={{ fontSize: 10, color: FAINT, letterSpacing: 2.5, fontFamily: FONT_MONO }}>
        {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </span>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// Layout primitives
// ─────────────────────────────────────────────────────────────────

const Card: React.FC<React.PropsWithChildren<{
  title?: string;
  subtitle?: string;
  className?: string;
  style?: React.CSSProperties;
  accent?: boolean;
}>> = ({ title, subtitle, className = '', style, accent, children }) => (
  <div
    className={`rounded-2xl p-5 ${className}`}
    style={{
      background: accent ? ACCENT : PANEL,
      border: `1px solid ${accent ? ACCENT : HAIRLINE}`,
      color: accent ? '#FFFFFF' : INK,
      ...style,
    }}
  >
    {(title || subtitle) && (
      <div style={{ marginBottom: 12 }}>
        {title && (
          <div
            style={{
              fontSize: 10,
              letterSpacing: 2.5,
              fontWeight: 700,
              color: accent ? 'rgba(255,255,255,0.85)' : SUBTLE,
              fontFamily: FONT_MONO,
              textTransform: 'uppercase',
            }}
          >
            {title}
          </div>
        )}
        {subtitle && (
          <div
            style={{
              fontSize: 13,
              color: accent ? 'rgba(255,255,255,0.85)' : FAINT,
              marginTop: 4,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    )}
    {children}
  </div>
);

const KpiTile: React.FC<{
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  spark?: { v: number }[];
}> = ({ label, value, delta, positive, spark }) => (
  <Card>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: SUBTLE, fontFamily: FONT_MONO }}>
          {label.toUpperCase()}
        </div>
        <div
          style={{
            fontSize: 'clamp(24px, 2.4vw, 36px)',
            fontWeight: 800,
            letterSpacing: -1,
            marginTop: 6,
            color: INK,
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        {delta && (
          <div
            style={{
              fontSize: 12,
              color: positive ? POSITIVE : ALERT,
              fontWeight: 600,
              marginTop: 6,
              fontFamily: FONT_MONO,
            }}
          >
            {positive ? '▲' : '▼'} {delta}
          </div>
        )}
      </div>
      {spark && spark.length > 0 && (
        <div style={{ width: 72, height: 36 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark}>
              <defs>
                <linearGradient id={`s${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={1.5} fill={`url(#s${label})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  </Card>
);

const ChartTooltip = ({ active, payload, label, suffix = '', prefix = '' }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        fontFamily: FONT,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ fontSize: 11, color: SUBTLE, letterSpacing: 1.5, fontFamily: FONT_MONO }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ marginTop: 2, color: p.color || INK, fontWeight: 600 }}>
          {p.name}: {prefix}{fmtNum(p.value)}{suffix}
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// SVG primitives unique to this deck
// ─────────────────────────────────────────────────────────────────

const VisionHero: React.FC = () => (
  <svg viewBox="0 0 800 540" className="w-full h-full" aria-hidden>
    <defs>
      <radialGradient id="vh" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor={ACCENT_2} stopOpacity="0.25" />
        <stop offset="60%" stopColor={ACCENT} stopOpacity="0.18" />
        <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
      </radialGradient>
      <linearGradient id="vh-line" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={ACCENT} stopOpacity="0" />
        <stop offset="50%" stopColor={ACCENT} stopOpacity="0.6" />
        <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
      </linearGradient>
    </defs>
    <rect width="800" height="540" fill="url(#vh)" />
    {/* Concentric orbits */}
    {[80, 140, 220, 320, 440].map((r, i) => (
      <circle key={i} cx="400" cy="280" r={r} fill="none" stroke={ACCENT} strokeOpacity={0.4 - i * 0.06} strokeDasharray={i % 2 ? '4 6' : 'none'} />
    ))}
    {/* Constellation nodes */}
    {[
      [400, 280, 14], [320, 200, 8], [500, 220, 7], [560, 320, 9],
      [340, 360, 7], [240, 280, 6], [600, 180, 6], [180, 200, 6],
    ].map(([cx, cy, r], i) => (
      <g key={i}>
        <circle cx={cx} cy={cy} r={r + 4} fill={ACCENT} opacity="0.15" />
        <circle cx={cx} cy={cy} r={r} fill={ACCENT} />
      </g>
    ))}
    {/* Connecting lines */}
    {[
      [400, 280, 320, 200], [400, 280, 500, 220], [400, 280, 560, 320],
      [400, 280, 340, 360], [400, 280, 240, 280], [320, 200, 240, 280],
      [500, 220, 600, 180], [340, 360, 180, 200],
    ].map(([x1, y1, x2, y2], i) => (
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ACCENT} strokeOpacity="0.35" strokeWidth="1" />
    ))}
    {/* Horizon */}
    <line x1="40" y1="480" x2="760" y2="480" stroke="url(#vh-line)" strokeWidth="2" />
    <text x="400" y="510" textAnchor="middle" fontSize="11" letterSpacing="4" fill={SUBTLE} fontFamily={FONT_MONO}>
      THE NEW DEFAULT
    </text>
  </svg>
);

const MarketRings: React.FC<{ tam?: number; sam?: number; som?: number }> = ({ tam, sam, som }) => {
  const maxR = 220;
  const tamR = maxR;
  const samR = sam && tam ? maxR * Math.sqrt(sam / tam) : maxR * 0.66;
  const somR = som && tam ? maxR * Math.sqrt(som / tam) : maxR * 0.33;
  return (
    <svg viewBox="0 0 600 500" className="w-full" aria-hidden>
      <defs>
        <radialGradient id="m-tam" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.05" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.18" />
        </radialGradient>
      </defs>
      <circle cx="300" cy="260" r={tamR} fill="url(#m-tam)" stroke={ACCENT} strokeOpacity="0.35" />
      <circle cx="300" cy="260" r={samR} fill={ACCENT} fillOpacity="0.18" stroke={ACCENT} strokeOpacity="0.6" />
      <circle cx="300" cy="260" r={somR} fill={ACCENT} fillOpacity="0.9" />
      {/* TAM label */}
      <text x="300" y="40" textAnchor="middle" fontSize="11" letterSpacing="3" fill={SUBTLE} fontFamily={FONT_MONO}>TAM</text>
      <text x="300" y="64" textAnchor="middle" fontSize="22" fontWeight={800} fill={INK} fontFamily={FONT}>{fmtUSD(tam)}</text>
      {/* SAM label */}
      <text x="300" y={260 - samR - 14} textAnchor="middle" fontSize="10" letterSpacing="3" fill={SUBTLE} fontFamily={FONT_MONO}>SAM</text>
      <text x="300" y={260 - samR + 8} textAnchor="middle" fontSize="17" fontWeight={800} fill={INK} fontFamily={FONT}>{fmtUSD(sam)}</text>
      {/* SOM label */}
      <text x="300" y="262" textAnchor="middle" fontSize="10" letterSpacing="3" fill="#FFFFFF" fontFamily={FONT_MONO}>SOM</text>
      <text x="300" y="284" textAnchor="middle" fontSize="16" fontWeight={800} fill="#FFFFFF" fontFamily={FONT}>{fmtUSD(som)}</text>
    </svg>
  );
};

const PlatformDiagram: React.FC<{ modules: { name: string; capabilities: string[] }[] }> = ({ modules }) => {
  const W = 720;
  const H = 380;
  const colW = (W - 80) / Math.max(modules.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      <defs>
        <linearGradient id="pd-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.08" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Base infra layer */}
      <rect x="40" y={H - 60} width={W - 80} height="40" rx="10" fill={SURFACE_2} stroke={HAIRLINE} />
      <text x="56" y={H - 35} fontSize="11" fontFamily={FONT_MONO} fill={SUBTLE} letterSpacing="3">PLATFORM · API · INTEGRATIONS · SECURITY</text>
      {/* Modules */}
      {modules.map((m, ci) => {
        const cx = 40 + colW * ci + colW / 2;
        return (
          <g key={ci}>
            <rect x={cx - colW * 0.42} y="30" width={colW * 0.84} height={H - 110} rx="14" fill="url(#pd-h)" stroke={ACCENT} strokeOpacity="0.45" />
            <text x={cx} y="56" textAnchor="middle" fontSize="13" fontFamily={FONT_MONO} letterSpacing="2.5" fill={ACCENT} fontWeight={700}>
              {m.name.toUpperCase()}
            </text>
            {m.capabilities.slice(0, 4).map((c, i) => (
              <g key={i} transform={`translate(${cx} ${94 + i * 48})`}>
                <rect x={-colW * 0.36} y={-16} width={colW * 0.72} height={36} rx={8} fill={PAPER} stroke={HAIRLINE} />
                <text x="0" y="6" textAnchor="middle" fontSize="13" fontFamily={FONT} fill={INK}>{c}</text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
};

const WorkflowTransform: React.FC<{ before: string[]; after: string[] }> = ({ before, after }) => (
  <svg viewBox="0 0 720 180" className="w-full" aria-hidden>
    {before.slice(0, 5).map((label, i) => (
      <g key={`b${i}`}>
        <rect x={10 + i * 56} y="60" width={44} height={44} rx={8} fill={SURFACE} stroke={HAIRLINE} />
        <text x={32 + i * 56} y="87" textAnchor="middle" fontSize="11" fontFamily={FONT_MONO} fill={SUBTLE} fontWeight={700}>{i + 1}</text>
        {i < before.slice(0, 5).length - 1 && (
          <line x1={54 + i * 56} y1="82" x2={66 + i * 56} y2="82" stroke={FAINT} strokeWidth={1.5} />
        )}
      </g>
    ))}
    <g transform="translate(310 65)">
      <path d="M0 18 L70 18" stroke={ACCENT} strokeWidth={3} strokeLinecap="round" />
      <path d="M58 6 L70 18 L58 30" stroke={ACCENT} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g transform="translate(420 40)">
      <rect width="280" height="100" rx="14" fill={ACCENT} />
      <text x="20" y="36" fontSize="12" fontFamily={FONT_MONO} fill="#FFFFFF" opacity="0.7" letterSpacing="2">UNIFIED WORKFLOW</text>
      <text x="20" y="64" fontSize="22" fontWeight={800} fill="#FFFFFF" fontFamily={FONT}>{after[0] || 'One platform'}</text>
      <text x="20" y="88" fontSize="13" fill="#FFFFFF" opacity="0.85" fontFamily={FONT}>{(after.slice(1).join(' · ') || 'Audited · Reversible · Auto-synced')}</text>
    </g>
  </svg>
);

const FlywheelDiagram: React.FC<{ nodes: { label: string; body?: string }[] }> = ({ nodes }) => {
  const R = 160;
  const cx = 250;
  const cy = 220;
  return (
    <svg viewBox="0 0 500 440" className="w-full h-full" aria-hidden>
      <circle cx={cx} cy={cy} r={R + 30} fill="none" stroke={ACCENT} strokeOpacity="0.12" />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={HAIRLINE} />
      {nodes.map((n, i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * R;
        const y = cy + Math.sin(a) * R;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={48} fill={PAPER} stroke={ACCENT} strokeWidth={1.5} />
            <text x={x} y={y - 4} textAnchor="middle" fontSize="12" fontFamily={FONT_MONO} fontWeight={700} fill={ACCENT} letterSpacing="1.5">
              {n.label.toUpperCase()}
            </text>
            {n.body && (
              <text x={x} y={y + 14} textAnchor="middle" fontSize="10" fontFamily={FONT} fill={SUBTLE}>{n.body}</text>
            )}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={64} fill={ACCENT} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" letterSpacing="3" fill="#FFFFFF" fontFamily={FONT_MONO}>FLYWHEEL</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="13" fontWeight={700} fill="#FFFFFF" fontFamily={FONT}>compounds</text>
      {nodes.map((_, i) => {
        const a1 = (i / nodes.length) * Math.PI * 2 - Math.PI / 2 + 0.2;
        const a2 = ((i + 1) / nodes.length) * Math.PI * 2 - Math.PI / 2 - 0.2;
        const x1 = cx + Math.cos(a1) * (R - 4);
        const y1 = cy + Math.sin(a1) * (R - 4);
        const x2 = cx + Math.cos(a2) * (R - 4);
        const y2 = cy + Math.sin(a2) * (R - 4);
        return (
          <path
            key={`arc${i}`}
            d={`M${x1} ${y1} A${R - 4} ${R - 4} 0 0 1 ${x2} ${y2}`}
            stroke={ACCENT} strokeWidth={1.5} fill="none"
            markerEnd="url(#fw-arrow)"
          />
        );
      })}
      <defs>
        <marker id="fw-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={ACCENT} />
        </marker>
      </defs>
    </svg>
  );
};

const PositioningMap: React.FC<{
  competitors: { name: string; x: number; y: number; is_us?: boolean }[];
  axis_x?: string;
  axis_y?: string;
}> = ({ competitors, axis_x = 'Reach', axis_y = 'Depth' }) => {
  const W = 540;
  const H = 440;
  const padL = 70;
  const padR = 30;
  const padT = 30;
  const padB = 60;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" aria-hidden>
      {/* quadrants background */}
      <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="url(#pos-bg)" />
      <defs>
        <linearGradient id="pos-bg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor={SURFACE} />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {/* axes */}
      <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke={INK} strokeWidth={1.5} />
      <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke={INK} strokeWidth={1.5} />
      <text x={W - padR} y={H - padB + 30} textAnchor="end" fontSize="12" letterSpacing="2" fontFamily={FONT_MONO} fill={SUBTLE}>{axis_x.toUpperCase()} →</text>
      <g transform={`translate(${padL - 40}, ${H / 2}) rotate(-90)`}>
        <text fontSize="12" letterSpacing="2" fontFamily={FONT_MONO} fill={SUBTLE}>{axis_y.toUpperCase()} →</text>
      </g>
      {/* gridlines */}
      {[0.5].map((p, i) => (
        <g key={i}>
          <line x1={padL + (W - padL - padR) * p} x2={padL + (W - padL - padR) * p} y1={padT} y2={H - padB} stroke={HAIRLINE} strokeDasharray="3 5" />
          <line x1={padL} x2={W - padR} y1={H - padB - (H - padT - padB) * p} y2={H - padB - (H - padT - padB) * p} stroke={HAIRLINE} strokeDasharray="3 5" />
        </g>
      ))}
      {competitors.map((c, i) => {
        const cx = padL + (c.x / 100) * (W - padL - padR);
        const cy = H - padB - (c.y / 100) * (H - padT - padB);
        const us = c.is_us || /^(us|we)$/i.test(c.name);
        return (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            {us && <circle r={26} fill={ACCENT} opacity="0.15" />}
            <circle r={us ? 12 : 8} fill={us ? ACCENT : '#FFFFFF'} stroke={us ? ACCENT : INK} strokeWidth={us ? 0 : 1.5} />
            <text y={us ? 32 : 24} textAnchor="middle" fontSize={us ? 14 : 12} fontFamily={FONT} fontWeight={us ? 700 : 600} fill={us ? ACCENT : INK}>{c.name}</text>
          </g>
        );
      })}
    </svg>
  );
};

const FunnelBars: React.FC<{ stages: { stage: string; v: number; conversion_pct?: number }[] }> = ({ stages }) => {
  if (!stages?.length) return null;
  const max = Math.max(...stages.map((s) => s.v));
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const w = (s.v / max) * 100;
        return (
          <div key={i}>
            <div className="flex items-baseline justify-between" style={{ fontSize: 12, color: SUBTLE, fontFamily: FONT_MONO }}>
              <span style={{ fontWeight: 700, color: INK, fontFamily: FONT, fontSize: 13 }}>{s.stage}</span>
              <span>{fmtNum(s.v)}{s.conversion_pct != null && <span style={{ color: ACCENT, marginLeft: 8 }}>· {s.conversion_pct}%</span>}</span>
            </div>
            <div className="mt-1.5 h-3 rounded-full" style={{ background: SURFACE_2 }}>
              <div className="h-3 rounded-full" style={{ width: `${w}%`, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_2})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const HiringPlanChart: React.FC<{ data: { role: string; count: number }[] }> = ({ data }) => (
  <ResponsiveContainer width="100%" height={220}>
    <BarChart data={data} layout="vertical" margin={{ left: 10, right: 24, top: 4, bottom: 4 }}>
      <CartesianGrid horizontal={false} stroke={HAIRLINE} />
      <XAxis type="number" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
      <YAxis type="category" dataKey="role" tick={{ fontSize: 12, fill: INK, fontFamily: FONT }} stroke={HAIRLINE} width={120} />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: SURFACE_2 }} />
      <Bar dataKey="count" fill={ACCENT} radius={[0, 6, 6, 0]} />
    </BarChart>
  </ResponsiveContainer>
);

// ─────────────────────────────────────────────────────────────────
// Slides — 15 total
// ─────────────────────────────────────────────────────────────────

const Slide1Vision: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => (
  <SlideFrame index={0} total={15} question="What future are we building?" company={data.company}>
    <div className="grid grid-cols-12 gap-8 h-full items-center">
      <div className="col-span-6 flex flex-col">
        <Editable
          value={data.vision_category || data.category}
          path="vision_category"
          editable={editable}
          onEdit={onEdit}
          placeholder="THE CATEGORY"
          style={{ fontSize: 11, letterSpacing: 4, fontFamily: FONT_MONO, color: ACCENT, fontWeight: 700 }}
        />
        <Editable
          as="h1"
          value={data.vision_headline}
          path="vision_headline"
          editable={editable}
          onEdit={onEdit}
          placeholder="The default platform every operating team will route their work through."
          style={{ fontSize: 'clamp(36px, 4.4vw, 76px)', fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: 16, color: INK, maxWidth: 620 }}
        />
        <Editable
          value={data.vision_subline}
          path="vision_subline"
          editable={editable}
          onEdit={onEdit}
          placeholder="One sentence that defines the category — concrete, specific, ambitious."
          style={{ fontSize: 'clamp(15px, 1.3vw, 20px)', color: SUBTLE, marginTop: 18, lineHeight: 1.5, maxWidth: 560 }}
        />
        <div className="mt-10 flex items-center gap-3">
          <span style={{ background: SURFACE, border: `1px solid ${HAIRLINE}`, borderRadius: 999, padding: '6px 12px', fontSize: 11, color: INK, fontFamily: FONT_MONO, letterSpacing: 1 }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-2" style={{ background: ACCENT, verticalAlign: 'middle' }} />
            SERIES A · {new Date().getFullYear()}
          </span>
        </div>
      </div>
      <div className="col-span-6 h-full max-h-[64vh]">
        <VisionHero />
      </div>
    </div>
  </SlideFrame>
);

const Slide2Shift: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const pillars = data.shift_pillars?.length
    ? data.shift_pillars
    : [
        { kind: 'tech', title: 'Compute · 100×', body: 'LLM cost down 1000× in 24 months.' },
        { kind: 'reg', title: 'Regulation', body: 'New audit rules force traceability.' },
        { kind: 'econ', title: 'Economics', body: 'Capital wants efficient growth.' },
        { kind: 'social', title: 'Behavior', body: 'Teams expect software to act for them.' },
      ];
  const curve = data.shift_curve?.length
    ? data.shift_curve
    : [
        { year: '2020', baseline: 100, new_world: 5 },
        { year: '2022', baseline: 95, new_world: 14 },
        { year: '2024', baseline: 82, new_world: 38 },
        { year: '2026', baseline: 60, new_world: 78 },
        { year: '2028', baseline: 35, new_world: 142 },
        { year: '2030', baseline: 18, new_world: 220 },
      ];
  const icon = (k: string) => k === 'tech' ? '◆' : k === 'reg' ? '§' : k === 'econ' ? '$' : '◯';
  return (
    <SlideFrame index={1} total={15} question="Why now?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(28px, 3vw, 48px)', fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, color: INK }}>
        Three macro shifts collide. The window is now.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-5 grid grid-cols-1 gap-3">
          {pillars.slice(0, 4).map((p, i) => (
            <div key={i} className="p-4 rounded-xl flex items-start gap-3" style={{ background: PANEL, border: `1px solid ${HAIRLINE}` }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: ACCENT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, fontFamily: FONT_MONO, flexShrink: 0 }}>
                {icon(p.kind)}
              </span>
              <div>
                <Editable as="div" value={p.title} path={`shift_pillars.${i}.title`} editable={editable} onEdit={onEdit} style={{ fontSize: 15, fontWeight: 700, color: INK }} />
                <Editable value={p.body} path={`shift_pillars.${i}.body`} editable={editable} onEdit={onEdit} style={{ fontSize: 13, color: SUBTLE, marginTop: 4, lineHeight: 1.4 }} />
              </div>
            </div>
          ))}
        </div>
        <div className="col-span-7">
          <Card title="OLD WORLD VS NEW WORLD" subtitle="Capability per dollar of investment">
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={curve}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="baseline" stroke={FAINT} strokeWidth={2.5} dot={false} name="Old world" />
                  <Line type="monotone" dataKey="new_world" stroke={ACCENT} strokeWidth={3} dot={{ r: 3, fill: ACCENT }} name="New world" />
                  <ReferenceLine x="2024" stroke={ALERT} strokeDasharray="4 4" label={{ value: 'Inflection', position: 'top', fill: ALERT, fontSize: 11, fontFamily: FONT_MONO }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide3Problem: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const stats = data.problem_quant?.length
    ? data.problem_quant
    : [
        { value: '$1.2T', label: 'wasted globally on duplicated work.' },
        { value: '63%', label: 'of operating teams report tool sprawl as #1 pain.' },
        { value: '7.4', label: 'avg. tools used to ship one cross-system workflow.' },
      ];
  const pains = data.pain_points?.length
    ? data.pain_points
    : ['Reconciliation eats 2 days/week', 'No audit trail across systems', 'Errors caught at month-end', 'Manual data entry as a job'];
  return (
    <SlideFrame index={2} total={15} question="What pain exists?" company={data.company}>
      <Editable as="h2" value={data.problem_headline} path="problem_headline" editable={editable} onEdit={onEdit}
        placeholder="The cost of fragmented workflow is measured in trillions — and operators feel it daily."
        style={{ fontSize: 'clamp(28px, 3vw, 48px)', fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, color: INK, maxWidth: 1200 }} />
      <div className="mt-8 grid grid-cols-3 gap-4">
        {stats.slice(0, 3).map((s, i) => (
          <Card key={i}>
            <div style={{ fontSize: 'clamp(40px, 4.4vw, 68px)', fontWeight: 900, letterSpacing: -2, color: ACCENT, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 14, color: SUBTLE, marginTop: 10, lineHeight: 1.4 }}>{s.label}</div>
          </Card>
        ))}
      </div>
      <div className="mt-6 flex-1 min-h-0">
        <Card title="WHAT OPERATORS ACTUALLY TELL US">
          <div className="grid grid-cols-2 gap-3 mt-2">
            {pains.slice(0, 6).map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: SURFACE }}>
                <span style={{ color: ACCENT, fontSize: 18, fontWeight: 700, lineHeight: 1 }}>"</span>
                <Editable value={p} path={`pain_points.${i}`} editable={editable} onEdit={onEdit} style={{ fontSize: 14, color: INK, lineHeight: 1.4, fontStyle: 'italic' }} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </SlideFrame>
  );
};

const Slide4Solution: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const before = data.workflow_before?.length ? data.workflow_before : ['Source', 'Transform', 'Sync', 'Reconcile', 'File'];
  const after = data.workflow_after?.length ? data.workflow_after : ['One platform', 'Audited', 'Reversible', 'Auto-synced'];
  return (
    <SlideFrame index={3} total={15} question="How do we solve it?" company={data.company}>
      <Editable as="h2" value={data.solution_headline} path="solution_headline" editable={editable} onEdit={onEdit}
        placeholder="One unified workflow. End to end. Built for audit by default."
        style={{ fontSize: 'clamp(28px, 3vw, 48px)', fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, color: INK, maxWidth: 1200 }} />
      <div className="mt-10">
        <WorkflowTransform before={before} after={after} />
      </div>
      <div className="mt-10 grid grid-cols-3 gap-4 flex-1 min-h-0">
        {[
          { title: 'Capture everything', body: 'Every source of truth feeds one canonical record.' },
          { title: 'Reason in place', body: 'Policy + LLM + deterministic rules co-located.' },
          { title: 'Act with audit', body: 'Each action signed, replayable, reversible.' },
        ].map((b, i) => (
          <Card key={i}>
            <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{b.title}</div>
            <div style={{ fontSize: 13, color: SUBTLE, marginTop: 6, lineHeight: 1.45 }}>{b.body}</div>
          </Card>
        ))}
      </div>
    </SlideFrame>
  );
};

const Slide5Product: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const modules = data.product_modules?.length
    ? data.product_modules
    : [
        { name: 'Capture', capabilities: ['Web', 'API', 'Mobile', 'Webhook'] },
        { name: 'Reason', capabilities: ['Workflow', 'Policy', 'LLM', 'Tests'] },
        { name: 'Act', capabilities: ['Integrations', 'Records', 'Audit', 'Replay'] },
      ];
  const journey = data.user_journey?.length
    ? data.user_journey
    : ['Connect', 'Map workflow', 'Run', 'Observe', 'Scale'];
  return (
    <SlideFrame index={4} total={15} question="What exactly have we built?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(28px, 3vw, 48px)', fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, color: INK }}>
        Three layers. One platform.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-8">
          <Card title="PLATFORM ARCHITECTURE">
            <div className="mt-2">
              <PlatformDiagram modules={modules} />
            </div>
          </Card>
        </div>
        <div className="col-span-4">
          <Card title="USER JOURNEY">
            <div className="space-y-3 mt-2">
              {journey.slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: ACCENT, color: '#FFFFFF', fontSize: 12, fontWeight: 800, fontFamily: FONT_MONO }}>{i + 1}</span>
                  <Editable value={s} path={`user_journey.${i}`} editable={editable} onEdit={onEdit} style={{ fontSize: 14, fontWeight: 600, color: INK }} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide6Market: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const curve = data.market_curve?.length
    ? data.market_curve
    : [
        { year: '2022', v: 22 }, { year: '2024', v: 38 }, { year: '2026', v: 64 },
        { year: '2028', v: 105 }, { year: '2030', v: 168 },
      ];
  const expansion = data.expansion_vectors?.length
    ? data.expansion_vectors
    : ['Adjacent workflow (CRM)', 'Vertical playbook (Healthcare)', 'Geo (EU, JP)', 'Platform / Marketplace'];
  return (
    <SlideFrame index={5} total={15} question="How large can this become?" company={data.company}>
      <div className="grid grid-cols-12 gap-6 h-full">
        <div className="col-span-7 flex items-center">
          <MarketRings tam={data.tam_usd} sam={data.sam_usd} som={data.som_usd} />
        </div>
        <div className="col-span-5 flex flex-col justify-center">
          <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.1, color: INK }}>
            A category measured in <span style={{ color: ACCENT }}>tens of billions</span>.
          </h2>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {[
              { l: 'TAM', v: fmtUSD(data.tam_usd) },
              { l: 'SAM', v: fmtUSD(data.sam_usd) },
              { l: 'SOM', v: fmtUSD(data.som_usd) },
            ].map((s, i) => (
              <div key={i} className="p-3 rounded-xl" style={{ background: PANEL, border: `1px solid ${HAIRLINE}` }}>
                <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>{s.l}</div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: i === 2 ? ACCENT : INK }}>{s.v}</div>
              </div>
            ))}
          </div>
          <Card className="mt-4" title={`CAGR · ${fmtPct(data.market_cagr_pct)}`}>
            <div style={{ width: '100%', height: 120 }}>
              <ResponsiveContainer>
                <AreaChart data={curve}>
                  <defs>
                    <linearGradient id="mc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity="0.3" />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="year" tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip suffix="B" prefix="$" />} />
                  <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={2} fill="url(#mc)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="mt-4" title="EXPANSION VECTORS">
            <ul className="mt-2 space-y-1.5">
              {expansion.slice(0, 5).map((e, i) => (
                <li key={i} className="flex items-center gap-2" style={{ fontSize: 13 }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />
                  <Editable value={e} path={`expansion_vectors.${i}`} editable={editable} onEdit={onEdit} style={{ color: INK }} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide7Traction: React.FC<DeckProps> = ({ data = {} }) => {
  const spark = (base: number, n = 8) => Array.from({ length: n }, (_, i) => ({ v: base * (0.4 + i * 0.1 + Math.random() * 0.05) }));
  return (
    <SlideFrame index={6} total={15} question="What proof exists?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Investor KPI dashboard.
      </h2>
      <div className="mt-6 grid grid-cols-4 gap-3 flex-1 min-h-0">
        <KpiTile label="ARR"               value={fmtUSD(data.arr_usd)}               delta={`${data.growth_yoy_pct ?? '—'}% YoY`}  positive spark={spark(8)} />
        <KpiTile label="MRR"               value={fmtUSD(data.mrr_usd)}               delta={`${data.growth_mom_pct ?? '—'}% MoM`}  positive spark={spark(6)} />
        <KpiTile label="Paying customers"  value={fmtNum(data.paying_customers)}      delta="+12 this q"                           positive spark={spark(5)} />
        <KpiTile label="Active users"      value={fmtNum(data.active_users)}          delta="+38% QoQ"                              positive spark={spark(7)} />
        <KpiTile label="NRR"               value={fmtPct(data.nrr_pct)}               delta="best-in-class"                         positive />
        <KpiTile label="Gross margin"      value={fmtPct(data.gross_margin_pct)}      delta="+4 pts"                                positive />
        <KpiTile label="Monthly churn"     value={fmtPct(data.monthly_churn_pct)}     delta="-0.3 pts"                              positive />
        <KpiTile label="Magic number"      value={String(data.magic_number ?? '—')}    delta="payback < 12 mo"                       positive />
        <KpiTile label="Rule of 40"        value={String(data.rule_of_40 ?? '—')}      delta="growth + margin"                       positive />
        <KpiTile label="Payback (mo)"      value={String(data.payback_months ?? '—')}  delta="trending down"                         positive />
        <KpiTile label="LTV / CAC"         value={String(data.ltv_cac ?? '—')}         delta="3.0+ healthy"                          positive />
        <KpiTile label="Logo retention"    value="98%"                                 delta="last 12 months"                        positive />
      </div>
    </SlideFrame>
  );
};

const Slide8RevenueGrowth: React.FC<DeckProps> = ({ data = {} }) => {
  const arr = data.arr_series?.length
    ? data.arr_series
    : [
        { month: 'Jan', v: 240 }, { month: 'Feb', v: 320 }, { month: 'Mar', v: 410 },
        { month: 'Apr', v: 520 }, { month: 'May', v: 680 }, { month: 'Jun', v: 880 },
        { month: 'Jul', v: 1140 }, { month: 'Aug', v: 1480 }, { month: 'Sep', v: 1900 },
        { month: 'Oct', v: 2480 }, { month: 'Nov', v: 3210 }, { month: 'Dec', v: 4180 },
      ];
  const mrr = data.mrr_series?.length
    ? data.mrr_series
    : arr.map((p) => ({ month: p.month, v: Math.round(p.v / 12) }));
  const forecast = data.arr_forecast?.length
    ? data.arr_forecast
    : [
        ...arr.map((p) => ({ ...p, forecast: null as any })),
        { month: 'Jan+1', v: null as any, forecast: 5400 },
        { month: 'Apr+1', v: null as any, forecast: 7800 },
        { month: 'Jul+1', v: null as any, forecast: 11200 },
        { month: 'Oct+1', v: null as any, forecast: 16000 },
      ];
  return (
    <SlideFrame index={7} total={15} question="Is growth accelerating?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Twelve consecutive months of acceleration.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="ARR (THOUSANDS USD)" subtitle={`${data.growth_mom_pct ?? '—'}% MoM compounding`}>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={arr}>
                  <defs>
                    <linearGradient id="arr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity="0.5" />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={3} fill="url(#arr)" name="ARR" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-5 grid grid-rows-2 gap-4">
          <Card title="MRR (THOUSANDS USD)">
            <div style={{ width: '100%', height: 100 }}>
              <ResponsiveContainer>
                <BarChart data={mrr}>
                  <XAxis dataKey="month" hide />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Bar dataKey="v" fill={ACCENT_2} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="FORECAST · NEXT 12 MO" subtitle="Conservative band">
            <div style={{ width: '100%', height: 100 }}>
              <ResponsiveContainer>
                <ComposedChart data={forecast}>
                  <XAxis dataKey="month" hide />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Line type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={2.5} dot={false} name="Actual" />
                  <Line type="monotone" dataKey="forecast" stroke={ACCENT_2} strokeWidth={2.5} strokeDasharray="4 4" dot={false} name="Forecast" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide9Adoption: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const logos = data.customer_logos?.length
    ? data.customer_logos
    : Array.from({ length: 12 }, (_, i) => ({ name: ['Acme', 'Nimbus', 'Lattice', 'Northwind', 'Atlas', 'Verdant', 'Helio', 'Cobalt', 'Quanta', 'Apex', 'Prism', 'Vector'][i] || `Logo ${i+1}` }));
  const retention = data.retention_cohort?.length
    ? data.retention_cohort
    : [
        { m: 'M0', v: 100 }, { m: 'M1', v: 92 }, { m: 'M2', v: 89 }, { m: 'M3', v: 86 },
        { m: 'M6', v: 82 }, { m: 'M9', v: 79 }, { m: 'M12', v: 78 },
      ];
  const usage = data.weekly_usage?.length
    ? data.weekly_usage
    : Array.from({ length: 12 }, (_, i) => ({ week: `W${i + 1}`, v: 1200 + i * 380 + Math.round(Math.random() * 200) }));
  const expansion = data.expansion_layers?.length
    ? data.expansion_layers
    : [
        { label: 'Gross retention', v: 95 },
        { label: 'Expansion', v: 27 },
        { label: 'Net retention', v: 122 },
      ];
  return (
    <SlideFrame index={8} total={15} question="Do customers love the product?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Customers stay. They use more. They bring more.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-7 grid grid-rows-2 gap-4">
          <Card title="LOGO RETENTION COHORT">
            <div style={{ width: '100%', height: 140 }}>
              <ResponsiveContainer>
                <LineChart data={retention}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="m" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <ReferenceLine y={80} stroke={ALERT} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={3} dot={{ r: 4, fill: ACCENT }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="WEEKLY ACTIVE USAGE">
            <div style={{ width: '100%', height: 140 }}>
              <ResponsiveContainer>
                <AreaChart data={usage}>
                  <defs>
                    <linearGradient id="usage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT_2} stopOpacity="0.4" />
                      <stop offset="100%" stopColor={ACCENT_2} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="v" stroke={ACCENT_2} strokeWidth={2.5} fill="url(#usage)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-5 grid grid-rows-2 gap-4">
          <Card title="CUSTOMERS">
            <div className="grid grid-cols-3 gap-2 mt-1">
              {logos.slice(0, 12).map((l, i) => (
                <div key={i} className="flex items-center justify-center rounded-lg" style={{ height: 44, background: SURFACE, border: `1px solid ${HAIRLINE}`, fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color: INK, letterSpacing: 1 }}>
                  {l.initials || l.name.toUpperCase().slice(0, 6)}
                </div>
              ))}
            </div>
          </Card>
          <Card title="NET REVENUE RETENTION" subtitle="Gross + expansion">
            <div className="space-y-3 mt-2">
              {expansion.map((e, i) => (
                <div key={i}>
                  <div className="flex justify-between" style={{ fontSize: 12, color: SUBTLE, fontFamily: FONT_MONO }}>
                    <span style={{ color: INK, fontWeight: 700, fontFamily: FONT, fontSize: 13 }}>{e.label}</span>
                    <span style={{ color: i === 2 ? ACCENT : INK, fontWeight: 700 }}>{e.v}%</span>
                  </div>
                  <div className="mt-1 h-2.5 rounded-full" style={{ background: SURFACE_2 }}>
                    <div className="h-2.5 rounded-full" style={{ width: `${Math.min(e.v, 150) / 1.5}%`, background: i === 2 ? `linear-gradient(90deg, ${ACCENT}, ${POSITIVE})` : ACCENT }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide10UnitEcon: React.FC<DeckProps> = ({ data = {} }) => {
  const payback = data.cac_payback_curve?.length
    ? data.cac_payback_curve
    : [
        { month: 'M1', recovered_pct: 12 }, { month: 'M3', recovered_pct: 32 },
        { month: 'M6', recovered_pct: 62 }, { month: 'M9', recovered_pct: 88 },
        { month: 'M12', recovered_pct: 110 },
      ];
  return (
    <SlideFrame index={9} total={15} question="Is growth efficient?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Healthy economics. Improving every quarter.
      </h2>
      <div className="mt-6 grid grid-cols-5 gap-3">
        {[
          { label: 'CAC', value: fmtUSD(data.cac_usd), delta: '-12% QoQ', positive: true },
          { label: 'LTV', value: fmtUSD(data.ltv_usd), delta: '+28% YoY', positive: true },
          { label: 'LTV / CAC', value: String(data.ltv_cac ?? '—'), delta: 'target 3.0+', positive: true },
          { label: 'Contribution margin', value: fmtPct(data.contribution_margin_pct), delta: '+4 pts', positive: true },
          { label: 'Gross margin', value: fmtPct(data.gross_margin_pct), delta: 'best in class', positive: true },
        ].map((s, i) => (
          <KpiTile key={i} label={s.label} value={s.value} delta={s.delta} positive={s.positive} />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="CAC PAYBACK CURVE" subtitle={`${data.payback_months ?? '—'} months to recovery`}>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={payback}>
                  <defs>
                    <linearGradient id="pay" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={POSITIVE} stopOpacity="0.4" />
                      <stop offset="100%" stopColor={POSITIVE} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <ReferenceLine y={100} stroke={ALERT} strokeDasharray="4 4" label={{ value: 'Payback', position: 'right', fill: ALERT, fontSize: 11 }} />
                  <Area type="monotone" dataKey="recovered_pct" stroke={POSITIVE} strokeWidth={3} fill="url(#pay)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-5">
          <Card title="EFFICIENCY DASHBOARD">
            <div className="space-y-4 mt-2">
              {[
                { l: 'Magic number',   v: data.magic_number,    target: 1,   suffix: '' },
                { l: 'Rule of 40',     v: data.rule_of_40,      target: 40,  suffix: '' },
                { l: 'NRR',            v: data.nrr_pct,         target: 110, suffix: '%' },
                { l: 'Monthly churn',  v: data.monthly_churn_pct, target: 2, suffix: '%', invert: true },
              ].map((m, i) => {
                const v = m.v ?? 0;
                const ratio = m.invert ? Math.max(0, 1 - v / (m.target * 2)) : Math.min(1, v / (m.target * 2));
                const ok = m.invert ? v <= m.target : v >= m.target;
                return (
                  <div key={i}>
                    <div className="flex justify-between items-baseline">
                      <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{m.l}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: ok ? POSITIVE : ALERT, fontFamily: FONT_MONO }}>
                        {fmtNum(v)}{m.suffix} <span style={{ color: SUBTLE, fontWeight: 500 }}> · target {m.target}{m.suffix}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full" style={{ background: SURFACE_2 }}>
                      <div className="h-2 rounded-full" style={{ width: `${ratio * 100}%`, background: ok ? POSITIVE : ALERT }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide11GTM: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const funnel = data.funnel?.length
    ? data.funnel
    : [
        { stage: 'Visitors', v: 24000, conversion_pct: 100 },
        { stage: 'Signups', v: 4800, conversion_pct: 20 },
        { stage: 'Activated', v: 1920, conversion_pct: 40 },
        { stage: 'Qualified', v: 720, conversion_pct: 38 },
        { stage: 'Paying', v: 240, conversion_pct: 33 },
        { stage: 'Expanded', v: 96, conversion_pct: 40 },
      ];
  const channels = data.channels?.length
    ? data.channels
    : [
        { name: 'Inbound / SEO', share_pct: 35, cac_usd: 520 },
        { name: 'Founder network', share_pct: 22, cac_usd: 0 },
        { name: 'Partnerships', share_pct: 18, cac_usd: 380 },
        { name: 'Outbound', share_pct: 15, cac_usd: 1480 },
        { name: 'Community', share_pct: 10, cac_usd: 220 },
      ];
  const motion = data.sales_motion?.length
    ? data.sales_motion
    : ['Self-serve to $20K ARR', 'Inside sales to $100K ARR', 'Enterprise AE > $100K ARR'];
  return (
    <SlideFrame index={10} total={15} question="How do customers arrive?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Multi-channel motion. Increasing efficiency.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-5">
          <Card title="ACQUISITION FUNNEL · LAST 90 DAYS">
            <FunnelBars stages={funnel} />
          </Card>
        </div>
        <div className="col-span-4">
          <Card title="CHANNEL MIX & EFFICIENCY">
            <div className="space-y-3 mt-2">
              {channels.map((c, i) => (
                <div key={i}>
                  <div className="flex justify-between items-baseline" style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: INK, fontSize: 13 }}>{c.name}</span>
                    <span style={{ color: SUBTLE, fontFamily: FONT_MONO }}>{c.share_pct}% · CAC {fmtUSD(c.cac_usd)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full" style={{ background: SURFACE_2 }}>
                    <div className="h-2 rounded-full" style={{ width: `${c.share_pct}%`, background: ACCENT, opacity: 1 - i * 0.1 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-3">
          <Card title="SALES MOTION">
            <ol className="space-y-3 mt-2">
              {motion.slice(0, 5).map((m, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ width: 24, height: 24, borderRadius: 6, background: ACCENT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, fontFamily: FONT_MONO, flexShrink: 0 }}>{i + 1}</span>
                  <Editable value={m} path={`sales_motion.${i}`} editable={editable} onEdit={onEdit} style={{ fontSize: 13, color: INK, lineHeight: 1.4, fontWeight: 500 }} />
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide12Growth: React.FC<DeckProps> = ({ data = {} }) => {
  const nodes = data.flywheel_nodes?.length
    ? data.flywheel_nodes
    : [
        { label: 'Customer', body: 'uses product' },
        { label: 'Data', body: 'compounds' },
        { label: 'Product', body: 'gets smarter' },
        { label: 'Network', body: 'expands' },
        { label: 'Revenue', body: 'funds invention' },
      ];
  const effects = data.network_effects?.length
    ? data.network_effects
    : [
        'Every workflow makes the next one cheaper to add.',
        'Each customer contributes anonymized benchmarks.',
        'New integrations create incoming partner demand.',
        'Audit-trail data becomes industry reference dataset.',
      ];
  return (
    <SlideFrame index={11} total={15} question="How does growth compound?" company={data.company}>
      <div className="grid grid-cols-12 gap-6 h-full">
        <div className="col-span-5 flex flex-col justify-center">
          <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.1, color: INK }}>
            Each turn lowers the cost of the next.
          </h2>
          <Card className="mt-6" title="COMPOUND ADVANTAGES">
            <ul className="space-y-3 mt-2">
              {effects.slice(0, 4).map((e, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ width: 24, height: 24, borderRadius: 999, background: ACCENT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, fontFamily: FONT_MONO, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 13, color: INK, lineHeight: 1.5 }}>{e}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="col-span-7 flex items-center">
          <FlywheelDiagram nodes={nodes} />
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide13Comp: React.FC<DeckProps> = ({ data = {} }) => {
  const competitors = data.competitors?.length
    ? data.competitors
    : [
        { name: 'Legacy A', x: 78, y: 25 },
        { name: 'Legacy B', x: 58, y: 32 },
        { name: 'Point Tool', x: 22, y: 70 },
        { name: 'Open Source', x: 35, y: 45 },
        { name: 'Us', x: 80, y: 86, is_us: true },
      ];
  const moats = data.moats?.length
    ? data.moats
    : [
        { title: 'Data flywheel',     body: 'Every workflow run improves the next prediction.' },
        { title: 'Switching cost',    body: 'Embedded in daily operations of the customer.' },
        { title: 'Distribution',      body: 'Partner channel into the ICP, not around it.' },
        { title: 'Technology lead',   body: '18-month head start on the architecture.' },
      ];
  return (
    <SlideFrame index={12} total={15} question="Why do we win?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        The only platform that does both.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="POSITIONING MAP">
            <PositioningMap competitors={competitors} axis_x={data.axis_x} axis_y={data.axis_y} />
          </Card>
        </div>
        <div className="col-span-5 grid grid-cols-2 gap-3 content-start">
          {moats.slice(0, 4).map((m, i) => (
            <Card key={i}>
              <div style={{ fontSize: 11, color: ACCENT, letterSpacing: 2, fontWeight: 700, fontFamily: FONT_MONO }}>
                {String(i + 1).padStart(2, '0')} · MOAT
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6, color: INK }}>{m.title}</div>
              <div style={{ fontSize: 13, color: SUBTLE, marginTop: 6, lineHeight: 1.45 }}>{m.body}</div>
            </Card>
          ))}
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide14Team: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const founders = data.founders?.length
    ? data.founders
    : [
        { name: '[Founder One]', role: 'CEO · Co-founder', bio: 'Prior: led product at [Co]. Shipped to 4M+ users.', initials: 'F1' },
        { name: '[Founder Two]', role: 'CTO · Co-founder', bio: 'Prior: principal eng at [Co]. ICPC world finalist.', initials: 'F2' },
      ];
  const leaders = data.leaders?.length
    ? data.leaders
    : [
        { name: '[VP Eng]',       role: 'ex-Datadog',  initials: 'VE' },
        { name: '[VP Sales]',     role: 'ex-Snowflake', initials: 'VS' },
        { name: '[Head of GTM]', role: 'ex-Stripe',   initials: 'HG' },
        { name: '[VP Product]',  role: 'ex-Figma',    initials: 'VP' },
      ];
  const hires = data.key_hires_planned?.length
    ? data.key_hires_planned
    : ['VP Engineering', 'Director, Enterprise Sales', 'Head of Customer Success', 'Staff Designer', '8 × Software Engineer'];
  return (
    <SlideFrame index={13} total={15} question="Why this team?" company={data.company}>
      <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 44px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Operators who shipped this before.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-7 grid grid-cols-2 gap-3">
          {founders.slice(0, 2).map((f, i) => (
            <Card key={i}>
              <div className="flex items-center gap-3">
                <div style={{ width: 56, height: 56, borderRadius: 14, background: ACCENT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, fontFamily: FONT_MONO }}>
                  {f.initials || f.name?.slice(0, 2)?.toUpperCase()}
                </div>
                <div>
                  <Editable as="div" value={f.name} path={`founders.${i}.name`} editable={editable} onEdit={onEdit} style={{ fontSize: 16, fontWeight: 700, color: INK, lineHeight: 1.1 }} />
                  <Editable value={f.role} path={`founders.${i}.role`} editable={editable} onEdit={onEdit} style={{ fontSize: 11, color: ACCENT, marginTop: 4, fontWeight: 700, letterSpacing: 1, fontFamily: FONT_MONO }} />
                </div>
              </div>
              <Editable value={f.bio} path={`founders.${i}.bio`} editable={editable} onEdit={onEdit} style={{ fontSize: 13, color: SUBTLE, marginTop: 12, lineHeight: 1.5 }} />
            </Card>
          ))}
          <Card className="col-span-2" title="LEADERSHIP TEAM">
            <div className="grid grid-cols-2 gap-3 mt-1">
              {leaders.slice(0, 4).map((l, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: SURFACE }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: ACCENT_2, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, fontFamily: FONT_MONO }}>
                    {l.initials || l.name?.slice(0, 2)?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{l.name}</div>
                    <div style={{ fontSize: 11, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 1 }}>{l.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-5">
          <Card title="KEY HIRES PLANNED · NEXT 12 MO">
            <ul className="space-y-2.5 mt-2">
              {hires.slice(0, 8).map((h, i) => (
                <li key={i} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: SURFACE, border: `1px dashed ${HAIRLINE}` }}>
                  <span style={{ width: 24, height: 24, borderRadius: 6, background: PAPER, color: ACCENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, fontFamily: FONT_MONO, border: `1px solid ${ACCENT}` }}>
                    +
                  </span>
                  <Editable value={h} path={`key_hires_planned.${i}`} editable={editable} onEdit={onEdit} style={{ fontSize: 14, fontWeight: 600, color: INK }} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide15Ask: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const uof = data.use_of_funds?.length
    ? data.use_of_funds
    : [
        { label: 'Engineering', pct: 45 },
        { label: 'GTM', pct: 30 },
        { label: 'Ops + Infra', pct: 15 },
        { label: 'Reserve', pct: 10 },
      ];
  const hiring = data.hiring_plan?.length
    ? data.hiring_plan
    : [
        { role: 'Engineering', count: 12 },
        { role: 'Sales', count: 8 },
        { role: 'Customer success', count: 4 },
        { role: 'Product / Design', count: 4 },
        { role: 'Ops + G&A', count: 4 },
      ];
  const milestones = data.milestones?.length
    ? data.milestones
    : [
        { quarter: 'Now',    goal: 'Live · 60+ paying logos', metric: '$4M ARR' },
        { quarter: '+6 mo',  goal: 'Repeatable sales motion', metric: '$10M ARR' },
        { quarter: '+12 mo', goal: 'Adjacent workflow live',  metric: '$22M ARR' },
        { quarter: '+24 mo', goal: 'Category leader',          metric: '$60M ARR' },
      ];
  return (
    <SlideFrame index={14} total={15} question="Why invest now?" company={data.company} bg={INK} ink={PAPER}>
      <div className="grid grid-cols-12 gap-6 h-full">
        <div className="col-span-7 flex flex-col">
          <div style={{ fontSize: 11, letterSpacing: 4, color: '#A5B4FC', fontWeight: 700, fontFamily: FONT_MONO }}>
            RAISING SERIES A
          </div>
          <Editable
            value={fmtUSD(data.ask_amount_usd)}
            path="ask_amount_usd"
            editable={editable}
            onEdit={onEdit}
            style={{
              fontSize: 'clamp(72px, 9vw, 168px)',
              fontWeight: 900,
              letterSpacing: -5,
              lineHeight: 0.95,
              color: PAPER,
              marginTop: 8,
            }}
          />
          <Editable
            value={data.closing_line}
            path="closing_line"
            editable={editable}
            onEdit={onEdit}
            placeholder="One memorable closing line — the world that becomes true with this round."
            style={{
              fontSize: 'clamp(15px, 1.4vw, 22px)',
              color: '#CBD5E1',
              marginTop: 24,
              maxWidth: 760,
              lineHeight: 1.45,
            }}
          />

          <div className="mt-6 grid grid-cols-3 gap-3">
            <Card style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, color: PAPER }}>
              <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 2, fontFamily: FONT_MONO }}>POST-RAISE RUNWAY</div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: PAPER }}>
                {data.post_raise_runway_months ?? '24'} <span style={{ fontSize: 13, color: '#94A3B8' }}>mo</span>
              </div>
            </Card>
            <Card style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, color: PAPER }}>
              <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 2, fontFamily: FONT_MONO }}>CURRENT ARR</div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: '#A5B4FC' }}>{fmtUSD(data.arr_usd)}</div>
            </Card>
            <Card style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, color: PAPER }}>
              <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 2, fontFamily: FONT_MONO }}>CONTACT</div>
              <Editable
                value={data.contact}
                path="contact"
                editable={editable}
                onEdit={onEdit}
                placeholder="founders@company.com"
                style={{ fontSize: 14, fontWeight: 700, marginTop: 8, color: PAPER, fontFamily: FONT_MONO }}
              />
            </Card>
          </div>

          <div className="mt-auto pt-6">
            <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 3, fontFamily: FONT_MONO, marginBottom: 8 }}>
              MILESTONES POST-RAISE
            </div>
            <div className="relative">
              <div className="absolute left-0 right-0 top-3 h-px" style={{ background: 'rgba(255,255,255,0.15)' }} />
              <div className="grid grid-cols-4 gap-3">
                {milestones.slice(0, 4).map((m, i) => (
                  <div key={i} className="relative pt-7">
                    <span className="absolute left-1/2 -translate-x-1/2 top-1 w-3 h-3 rounded-full" style={{ background: ACCENT }} />
                    <div style={{ fontSize: 10, color: '#A5B4FC', letterSpacing: 2, fontFamily: FONT_MONO, fontWeight: 700, textAlign: 'center' }}>
                      {(m.quarter ?? '—').toString().toUpperCase() || '—'}
                    </div>
                    <div style={{ fontSize: 13, color: PAPER, marginTop: 4, textAlign: 'center', lineHeight: 1.3 }}>
                      {m.goal}
                    </div>
                    {m.metric && (
                      <div style={{ fontSize: 12, color: ACCENT, marginTop: 2, textAlign: 'center', fontFamily: FONT_MONO, fontWeight: 700 }}>
                        {m.metric}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-5 flex flex-col gap-4">
          <Card title="USE OF FUNDS" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, color: PAPER }}>
            <div className="space-y-2.5 mt-2">
              {uof.map((u, i) => (
                <div key={i}>
                  <div className="flex justify-between" style={{ fontSize: 12 }}>
                    <span style={{ color: PAPER, fontWeight: 700, fontSize: 13 }}>{u.label}</span>
                    <span style={{ color: '#A5B4FC', fontFamily: FONT_MONO, fontWeight: 700 }}>{u.pct}%</span>
                  </div>
                  <div className="mt-1.5 h-2.5 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    <div className="h-2.5 rounded-full" style={{ width: `${u.pct}%`, background: i === 0 ? ACCENT : i === 1 ? ACCENT_2 : '#7C7FD8' }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="HIRING PLAN · NEXT 12 MO" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, color: PAPER, flex: 1 }}>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={hiring} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.1)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8', fontFamily: FONT_MONO }} stroke="rgba(255,255,255,0.2)" />
                  <YAxis type="category" dataKey="role" tick={{ fontSize: 12, fill: PAPER, fontFamily: FONT }} stroke="rgba(255,255,255,0.2)" width={120} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="count" fill={ACCENT} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

// ─────────────────────────────────────────────────────────────────
// Deck shell — keyboard nav, dot pagination, motion
// ─────────────────────────────────────────────────────────────────

const SLIDES: React.FC<DeckProps>[] = [
  Slide1Vision,
  Slide2Shift,
  Slide3Problem,
  Slide4Solution,
  Slide5Product,
  Slide6Market,
  Slide7Traction,
  Slide8RevenueGrowth,
  Slide9Adoption,
  Slide10UnitEcon,
  Slide11GTM,
  Slide12Growth,
  Slide13Comp,
  Slide14Team,
  Slide15Ask,
];

export const SeriesAGrowthDeckApp: React.FC<{
  initialData?: SeriesAData;
  editable?: boolean;
}> = ({ initialData = SAMPLE_DATA, editable = true }) => {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<SeriesAData>(initialData);
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
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 lg:p-10"
      style={{ background: '#EEF2F7', fontFamily: FONT }}>
      <div
        className="w-full max-w-[1480px] rounded-3xl overflow-hidden border bg-white shadow-[0_40px_100px_-30px_rgba(15,23,42,0.35)]"
        style={{ borderColor: HAIRLINE }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={reduced ? false : { opacity: 0, y: 22 }}
            animate={reduced ? {} : { opacity: 1, y: 0 }}
            exit={reduced ? {} : { opacity: 0, y: -22 }}
            transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Slide data={data} editable={editable} onEdit={onEdit} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="w-full max-w-[1480px] mt-6 flex items-center justify-between" style={{ color: INK }}>
        <button
          onClick={prev}
          disabled={index === 0}
          className="px-5 py-2.5 rounded-full border bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm font-semibold"
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
                width: i === index ? 30 : 6,
                height: 6,
                borderRadius: 999,
                background: i === index ? ACCENT : '#CBD5E1',
              }}
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={index === SLIDES.length - 1}
          className="px-5 py-2.5 rounded-full border bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm font-semibold"
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
// SAMPLE_DATA — replace at runtime with the merged Axal row shape
// produced server-side by cloudflare-worker/src/routes/decks.ts
// heuristicSlides(). Many JSON columns referenced here depend on
// the migration enumerated in earlier Prompt MD
// (DECK_AUTOFILL_AUDIT.md + 00xx_deck_autofill_fields.sql).
// ─────────────────────────────────────────────────────────────────

export const SAMPLE_DATA: SeriesAData = {
  company: '[Company]',
  domain: 'company.com',
  category: 'Workflow infrastructure',

  vision_headline: 'The default platform every operating team routes their work through.',
  vision_subline: 'The work itself becomes the system of record — observable, audited, alive.',
  vision_category: 'CATEGORY · WORKFLOW INFRASTRUCTURE',

  shift_pillars: [
    { kind: 'tech',   title: 'Compute · 100×',   body: 'LLM cost down ~1000× in 24 months.' },
    { kind: 'reg',    title: 'Audit Regulation', body: 'New rules force end-to-end traceability.' },
    { kind: 'econ',   title: 'Capital efficiency', body: 'Investors want growth + margin together.' },
    { kind: 'social', title: 'Operator behavior', body: 'Teams expect software to act for them.' },
  ],
  shift_curve: [
    { year: '2020', baseline: 100, new_world: 5 },
    { year: '2022', baseline: 95, new_world: 14 },
    { year: '2024', baseline: 82, new_world: 38 },
    { year: '2026', baseline: 60, new_world: 78 },
    { year: '2028', baseline: 35, new_world: 142 },
    { year: '2030', baseline: 18, new_world: 220 },
  ],

  problem_headline: 'The cost of fragmented workflow is measured in trillions.',
  problem_quant: [
    { value: '$1.2T', label: 'wasted globally on duplicated work each year.' },
    { value: '63%',   label: 'of operating teams cite tool sprawl as their #1 pain.' },
    { value: '7.4',   label: 'tools used on average to ship one cross-system workflow.' },
  ],
  pain_points: [
    'Reconciliation eats 2 days/week per analyst.',
    'No audit trail across systems — investigations take weeks.',
    'Errors caught at month-end, not at occurrence.',
    'Manual data entry as a full-time job.',
    'Tribal knowledge concentrated in one or two operators.',
    'Reporting requires custom builds every quarter.',
  ],

  solution_headline: 'One unified workflow. End to end. Built for audit by default.',
  workflow_before: ['Source', 'Transform', 'Sync', 'Reconcile', 'File'],
  workflow_after:  ['One platform', 'Audited', 'Reversible', 'Auto-synced'],

  product_modules: [
    { name: 'Capture',  capabilities: ['Web', 'API', 'Mobile', 'Webhook'] },
    { name: 'Reason',    capabilities: ['Workflow', 'Policy', 'LLM', 'Tests'] },
    { name: 'Act',       capabilities: ['Integrations', 'Records', 'Audit', 'Replay'] },
  ],
  user_journey: ['Connect data', 'Map workflow', 'Run', 'Observe', 'Scale across teams'],

  tam_usd: 42_000_000_000,
  sam_usd: 9_400_000_000,
  som_usd: 1_200_000_000,
  market_cagr_pct: 28,
  market_curve: [
    { year: '2022', v: 22 }, { year: '2024', v: 38 }, { year: '2026', v: 64 },
    { year: '2028', v: 105 }, { year: '2030', v: 168 },
  ],
  expansion_vectors: [
    'Adjacent workflow (CRM, finance, ops)',
    'Vertical playbook (Healthcare, Fintech)',
    'Geographic (EU, JP, APAC)',
    'Platform / marketplace',
    'Embedded workflows for partners',
  ],

  arr_usd: 4_180_000,
  mrr_usd: 348_000,
  paying_customers: 64,
  active_users: 12_400,
  growth_mom_pct: 28,
  growth_yoy_pct: 412,
  nrr_pct: 132,
  gross_margin_pct: 84,
  monthly_churn_pct: 0.9,
  magic_number: 1.6,
  rule_of_40: 86,
  payback_months: 9,
  ltv_cac: 4.8,

  arr_series: [
    { month: 'Jan', v: 240 }, { month: 'Feb', v: 320 }, { month: 'Mar', v: 410 },
    { month: 'Apr', v: 520 }, { month: 'May', v: 680 }, { month: 'Jun', v: 880 },
    { month: 'Jul', v: 1140 }, { month: 'Aug', v: 1480 }, { month: 'Sep', v: 1900 },
    { month: 'Oct', v: 2480 }, { month: 'Nov', v: 3210 }, { month: 'Dec', v: 4180 },
  ],
  arr_forecast: [
    { month: 'Jan', v: 240,  forecast: null as any },
    { month: 'Mar', v: 410,  forecast: null as any },
    { month: 'Jun', v: 880,  forecast: null as any },
    { month: 'Sep', v: 1900, forecast: null as any },
    { month: 'Dec', v: 4180, forecast: 4180 },
    { month: 'Jan+1', v: null as any, forecast: 5400 },
    { month: 'Apr+1', v: null as any, forecast: 7800 },
    { month: 'Jul+1', v: null as any, forecast: 11200 },
    { month: 'Oct+1', v: null as any, forecast: 16000 },
  ],

  customer_logos: [
    { name: 'Acme' }, { name: 'Nimbus' }, { name: 'Lattice' }, { name: 'Atlas' },
    { name: 'Verdant' }, { name: 'Helio' }, { name: 'Cobalt' }, { name: 'Quanta' },
    { name: 'Apex' }, { name: 'Prism' }, { name: 'Vector' }, { name: 'North' },
  ],
  retention_cohort: [
    { m: 'M0', v: 100 }, { m: 'M1', v: 96 }, { m: 'M2', v: 93 }, { m: 'M3', v: 91 },
    { m: 'M6', v: 88 }, { m: 'M9', v: 85 }, { m: 'M12', v: 82 },
  ],
  weekly_usage: Array.from({ length: 12 }, (_, i) => ({ week: `W${i + 1}`, v: 1200 + i * 480 })),
  expansion_layers: [
    { label: 'Gross retention', v: 95 },
    { label: 'Expansion',       v: 37 },
    { label: 'Net retention',   v: 132 },
  ],

  cac_usd: 1_240,
  ltv_usd: 5_960,
  contribution_margin_pct: 72,
  cac_payback_curve: [
    { month: 'M1', recovered_pct: 12 }, { month: 'M3', recovered_pct: 36 },
    { month: 'M6', recovered_pct: 72 }, { month: 'M9', recovered_pct: 102 },
    { month: 'M12', recovered_pct: 138 },
  ],

  funnel: [
    { stage: 'Visitors', v: 24000, conversion_pct: 100 },
    { stage: 'Signups', v: 4800, conversion_pct: 20 },
    { stage: 'Activated', v: 1920, conversion_pct: 40 },
    { stage: 'Qualified', v: 720, conversion_pct: 38 },
    { stage: 'Paying', v: 240, conversion_pct: 33 },
    { stage: 'Expanded', v: 96, conversion_pct: 40 },
  ],
  channels: [
    { name: 'Inbound / SEO',  share_pct: 35, cac_usd: 520 },
    { name: 'Founder network', share_pct: 22, cac_usd: 0 },
    { name: 'Partnerships',    share_pct: 18, cac_usd: 380 },
    { name: 'Outbound',         share_pct: 15, cac_usd: 1480 },
    { name: 'Community',        share_pct: 10, cac_usd: 220 },
  ],
  sales_motion: [
    'Self-serve to $20K ARR',
    'Inside sales to $100K ARR',
    'Enterprise AE > $100K ARR',
  ],

  flywheel_nodes: [
    { label: 'Customer', body: 'uses product' },
    { label: 'Data', body: 'compounds' },
    { label: 'Product', body: 'gets smarter' },
    { label: 'Network', body: 'expands' },
    { label: 'Revenue', body: 'funds invention' },
  ],
  network_effects: [
    'Every workflow makes the next one cheaper to add.',
    'Each customer contributes anonymized benchmarks.',
    'New integrations create incoming partner demand.',
    'Audit-trail data becomes an industry reference set.',
  ],

  axis_x: 'Reach',
  axis_y: 'Depth',
  competitors: [
    { name: 'Legacy A',    x: 78, y: 25 },
    { name: 'Legacy B',    x: 58, y: 32 },
    { name: 'Point Tool',  x: 22, y: 70 },
    { name: 'Open Source', x: 35, y: 45 },
    { name: 'Us',          x: 80, y: 86, is_us: true },
  ],
  moats: [
    { title: 'Data flywheel',   body: 'Every workflow run improves the next prediction.' },
    { title: 'Switching cost',  body: 'Embedded in the daily operations of the customer.' },
    { title: 'Distribution',    body: 'Partner channel into the ICP, not around it.' },
    { title: 'Technology lead', body: '18-month head start on the architecture.' },
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
      bio: 'Prior: principal engineer at Linear. Designed core systems for 50K+ teams. ICPC world finalist.',
      initials: 'F2',
    },
  ],
  leaders: [
    { name: '[VP Eng]',        role: 'ex-Datadog',   initials: 'VE' },
    { name: '[VP Sales]',      role: 'ex-Snowflake',  initials: 'VS' },
    { name: '[Head of GTM]',  role: 'ex-Stripe',    initials: 'HG' },
    { name: '[VP Product]',   role: 'ex-Figma',     initials: 'VP' },
  ],
  key_hires_planned: [
    'VP Engineering',
    'Director, Enterprise Sales',
    'Head of Customer Success',
    'Staff Designer',
    '8 × Software Engineer',
    'Data Scientist · Pricing',
    'GTM Operations',
    'Sales Engineer',
  ],

  ask_amount_usd: 15_000_000,
  prior_round_usd: 3_500_000,
  current_runway_months: 14,
  post_raise_runway_months: 28,
  use_of_funds: [
    { label: 'Engineering',         pct: 45 },
    { label: 'GTM',                 pct: 30 },
    { label: 'Operations + Infra',  pct: 15 },
    { label: 'Reserve',             pct: 10 },
  ],
  hiring_plan: [
    { role: 'Engineering',       count: 12 },
    { role: 'Sales',             count: 8 },
    { role: 'Customer Success',  count: 4 },
    { role: 'Product / Design',  count: 4 },
    { role: 'Ops + G&A',         count: 4 },
  ],
  milestones: [
    { quarter: 'Now',    goal: 'Live · 60+ paying logos',   metric: '$4M ARR' },
    { quarter: '+6 mo',  goal: 'Repeatable sales motion',   metric: '$10M ARR' },
    { quarter: '+12 mo', goal: 'Adjacent workflow shipped', metric: '$22M ARR' },
    { quarter: '+24 mo', goal: 'Category leader',           metric: '$60M ARR' },
  ],
  closing_line:
    'In five years, every operating team in this category will route their work through one platform. We intend to be it.',
  contact: 'founders@company.com',
};

export default SeriesAGrowthDeckApp;

// ─────────────────────────────────────────────────────────────────
// Registry adapter — `Deck_series_a_growth_app`
//
// Renders all 15 slides inside `<Slide16x9>` frames (each carries
// `data-slide-frame=""` + 1920×1080 + `pageBreakAfter: always`), so
// `PitchDeckPrintPage` keyboard nav, fullscreen viewer, and
// `window.print()` PDF export work the same way they do for every
// other template in the registry. The single-screen viewer (prev/
// next + dot pagination + motion) stays available via the
// `SeriesAGrowthDeckApp` default export for callers that want it.
//
// Incoming Axal `data` (built by `PitchDeckPrintPage.buildTemplateData`)
// is shallow-merged over `SAMPLE_DATA` so partial payloads keep the
// sample's nested defaults populated.
// ─────────────────────────────────────────────────────────────────
import { Slide16x9, type DeckProps as RegistryDeckProps } from '../DeckBase';

// Shape-aware merge — slides call `.map` on `metrics`, `unit_econ`,
// `hiring_plan`, `team`, etc. and dereference nested objects like
// `revenue.series`. Drop any incoming field whose runtime type does
// not match the sample (array-vs-non-array, object-vs-non-object)
// so a legacy string-shaped payload from Axal cannot crash the
// adapter inside `ThumbnailBoundary`.
function mergeShape(sample: SeriesAData, input: Record<string, any>): SeriesAData {
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

export const Deck_series_a_growth_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const seed: SeriesAData = (data && Object.keys(data).length > 0)
    ? mergeShape(SAMPLE_DATA, data as Record<string, any>)
    : SAMPLE_DATA;
  return (
    <>
      {SLIDES.map((Slide, i) => (
        <Slide16x9 key={i} bg="#EEF2F7" ink="#0F172A">
          <Slide data={seed} editable={editable} onEdit={onEdit} />
        </Slide16x9>
      ))}
    </>
  );
};
