// frontend/src/decks/templates/series_b_diligence_app.tsx
//
// Series B Diligence — 22 main slides + 10 appendix. Board / IC quality.
// Snowflake / Datadog / Atlassian visual language. Data-rich, executive,
// credible. SVG + Recharts. Framer Motion transitions.
//
// Binds to Axal platform data via `data` prop; falls back to
// SAMPLE_DATA. Cloudflare Browser Rendering captures 16:9 for PDF.
//
// Requires: framer-motion + recharts (verify in package.json).

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Slide16x9, type DeckProps as RegistryDeckProps, BrandProvider, useBrandContext } from '../DeckBase';
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Legend, ComposedChart,
  PieChart, Pie, Cell, Sector,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type SeriesBData = {
  // Identity
  company?: string;
  domain?: string;
  category?: string;

  // SECTION I — OPPORTUNITY
  vision_headline?: string;
  vision_subline?: string;
  vision_category?: string;

  market_shifts?: { kind: 'tech' | 'reg' | 'industry'; title: string; body: string; metric?: string }[];
  market_inflection_curve?: { year: string; baseline: number; new_world: number }[];

  problem_headline?: string;
  problem_drivers?: { title: string; body: string; metric?: string }[];
  problem_consequences?: string[];

  tam_usd?: number;
  sam_usd?: number;
  som_usd?: number;
  market_cagr_pct?: number;
  market_curve?: { year: string; v: number }[];
  expansion_vectors?: { name: string; tam_usd: number; phase: 'now' | 'next' | 'future' }[];

  // SECTION II — PRODUCT
  platform_layers?: { name: string; capabilities: string[] }[];
  value_metrics?: { label: string; value: string; sublabel?: string }[];
  tech_stack?: { layer: string; components: string[] }[];
  innovation_pillars?: { title: string; body: string }[];
  ip_assets?: { label: string; v: number; sublabel?: string }[];

  product_roadmap?: { phase: 'past' | 'now' | 'next'; quarter: string; items: string[] }[];

  // SECTION III — TRACTION
  arr_usd?: number;
  mrr_usd?: number;
  customer_count?: number;
  active_users?: number;
  growth_mom_pct?: number;
  growth_yoy_pct?: number;
  nrr_pct?: number;
  grr_pct?: number;
  monthly_churn_pct?: number;
  gross_margin_pct?: number;
  magic_number?: number;
  rule_of_40?: number;
  payback_months?: number;
  ltv_cac?: number;
  ebitda_margin_pct?: number;
  burn_multiple?: number;

  arr_series?: { month: string; v: number }[];
  mrr_series?: { month: string; v: number }[];
  arr_forecast?: { month: string; v: number; forecast?: number }[];
  growth_rate_curve?: { quarter: string; rate: number }[];

  customer_count_series?: { month: string; enterprise: number; midmarket: number; smb: number }[];
  customer_segments?: { segment: string; count: number; arr_share_pct: number }[];
  geo_split?: { region: string; arr_share_pct: number }[];

  retention_cohort?: { m: string; v: number }[];
  cohort_grid?: { cohort: string; values: number[] }[];          // matrix
  nrr_decomposition?: { label: string; v: number }[];

  product_engagement?: {
    activation_rate_pct?: number;
    median_time_to_value_min?: number;
    weekly_actives?: { week: string; v: number }[];
    feature_adoption?: { feature: string; pct: number }[];
    session_frequency?: { bucket: string; share_pct: number }[];
  };

  // SECTION IV — GTM
  sales_motion?: { tier: string; threshold: string; ratio: string }[];
  acquisition_channels?: { name: string; share_pct: number; cac_usd: number; payback_months: number }[];
  pipeline?: { stage: string; v: number; conversion_pct?: number }[];
  cac_payback_curve?: { month: string; recovered_pct: number }[];
  cac_usd?: number;
  ltv_usd?: number;
  rep_productivity?: { quarter: string; arr_per_rep: number }[];
  margin_trend?: { quarter: string; gross_margin: number; contribution_margin: number }[];

  // SECTION V — DEFENSIBILITY
  competitors?: { name: string; x: number; y: number; size?: number; is_us?: boolean }[];
  axis_x?: string;
  axis_y?: string;
  competitor_table?: { name: string; product?: string; pricing?: string; scale?: string; verdict?: string }[];

  moats?: { kind: 'tech' | 'data' | 'network' | 'distribution' | 'brand'; title: string; body: string; metric?: string }[];
  strategic_advantages?: { title: string; body: string }[];
  partnerships?: { name: string; type: 'channel' | 'data' | 'platform' | 'reseller' }[];

  // SECTION VI — ORG
  leaders?: { name: string; role: string; bio: string; initials?: string }[];
  hiring_plan?: { dept: string; current: number; target: number }[];
  org_split?: { dept: string; current_pct: number }[];
  operational_kpis?: { label: string; value: string; target?: string }[];

  // SECTION VII — INVESTMENT
  ask_amount_usd?: number;
  prior_round_usd?: number;
  current_runway_months?: number;
  post_raise_runway_months?: number;
  use_of_funds?: { label: string; pct: number; subuses?: string[] }[];
  milestones?: { quarter: string; goal: string; metric?: string }[];
  return_scenarios?: { case: string; arr_y3: number; multiple: string }[];
  closing_line?: string;
  contact?: string;

  // APPENDIX
  financial_statements?: {
    revenue_quarterly?: { q: string; recurring: number; non_recurring: number }[];
    expense_quarterly?: { q: string; r_and_d: number; s_and_m: number; g_and_a: number }[];
    margin_quarterly?: { q: string; gross: number; ebitda: number }[];
    cash_position?: { q: string; cash: number; runway_mo: number }[];
  };
  revenue_cohorts?: { cohort: string; m0: number; m3: number; m6: number; m12: number; m18: number; m24: number }[];
  customer_seg_detail?: {
    enterprise?: { count: number; avg_acv: number; logo_retention_pct: number; nrr_pct: number };
    midmarket?:  { count: number; avg_acv: number; logo_retention_pct: number; nrr_pct: number };
    smb?:        { count: number; avg_acv: number; logo_retention_pct: number; nrr_pct: number };
    geo?: { region: string; count: number; arr_usd: number }[];
  };
  funnel_detail?: { stage: string; v: number; conversion_pct?: number; cycle_days?: number }[];
  pricing_plans?: { name: string; price: string; seats: string; modules: string[]; target: string }[];
  architecture_detail?: { layer: string; nodes: string[] }[];
  security_compliance?: {
    certifications?: string[];
    frameworks?: string[];
    controls?: { area: string; items: string[] }[];
  };
  risks?: { category: 'technical' | 'market' | 'operational' | 'regulatory'; title: string; mitigation: string; severity?: 'low' | 'med' | 'high' }[];
  governance?: {
    board?: { name: string; role: string; affiliation?: string; initials?: string }[];
    investors?: { name: string; round: string }[];
    advisors?: { name: string; expertise: string }[];
  };
  three_year_plan?: {
    revenue?: { year: string; arr: number }[];
    hires?: { year: string; total_headcount: number }[];
    capital?: { year: string; deployed_usd: number; cash_end_usd: number }[];
  };
};

export type DeckProps = {
  data?: SeriesBData;
  editable?: boolean;
  onEdit?: (path: string, value: string) => void;
};

// ─────────────────────────────────────────────────────────────────
// Tokens — public-company / board-meeting palette
// ─────────────────────────────────────────────────────────────────

const PAPER = '#FFFFFF';
const INK = '#0B1220';
const INK_2 = '#1E293B';
const ACCENT = '#1E40AF';       // navy primary
const ACCENT_2 = '#0EA5E9';      // sky
const ACCENT_3 = '#7C3AED';      // violet (segment differentiator)
const POSITIVE = '#059669';
const ALERT = '#D97706';
const NEGATIVE = '#DC2626';
const SUBTLE = '#475569';
const FAINT = '#94A3B8';
const HAIRLINE = '#E2E8F0';
const SURFACE = '#F8FAFC';
const SURFACE_2 = '#F1F5F9';
const PANEL = '#FAFBFC';

const FONT = '-apple-system, BlinkMacSystemFont, "Inter", "SF Pro Display", Helvetica, sans-serif';
const FONT_MONO = '"SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, monospace';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const fmtUSD = (n?: number) => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const fmtNum = (n?: number) => (n == null || isNaN(n) ? '—' : n.toLocaleString());
const fmtPct = (n?: number) => (n == null || isNaN(n) ? '—' : `${n}%`);
// Defensive uppercaser for share-rendered data: founder-supplied items may omit
// a stringy field (e.g. `quarter`, `phase`, `kind`); never crash the share-link
// tree — degrade to a neutral placeholder instead.
const safeUpper = (v: unknown, fallback = '—'): string => {
  if (v == null) return fallback;
  const s = typeof v === 'string' ? v : String(v);
  return s.length ? s.toUpperCase() : fallback;
};

const Editable: React.FC<{
  value?: string; path: string; editable?: boolean; onEdit?: (p: string, v: string) => void;
  placeholder?: string; className?: string; style?: React.CSSProperties; as?: keyof JSX.IntrinsicElements;
}> = ({ value, path, editable, onEdit, placeholder, className, style, as = 'div' }) => {
  const Tag: any = as;
  return (
    <Tag
      contentEditable={!!editable}
      suppressContentEditableWarning
      onBlur={(e: any) => onEdit?.(path, e.currentTarget.textContent || '')}
      className={className}
      style={{ outline: 'none', minHeight: '1em', color: !value ? '#A3A3A3' : style?.color, ...style }}
    >
      {value || placeholder || ''}
    </Tag>
  );
};

// ─────────────────────────────────────────────────────────────────
// Slide-frame primitive — board-grade header strip + section labeling
// ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  { idx: [0, 1, 2, 3],      title: 'I · Opportunity' },
  { idx: [4, 5, 6, 7],      title: 'II · Product' },
  { idx: [8, 9, 10, 11, 12], title: 'III · Traction' },
  { idx: [13, 14, 15],      title: 'IV · GTM' },
  { idx: [16, 17, 18],      title: 'V · Defensibility' },
  { idx: [19, 20],          title: 'VI · Organization' },
  { idx: [21],              title: 'VII · Investment' },
];
const APPENDIX_OFFSET = 22;

const sectionForIndex = (i: number) => SECTIONS.find(s => s.idx.includes(i))?.title || (i >= APPENDIX_OFFSET ? 'Appendix' : '');

const SLIDE_TITLES = [
  'Vision', 'Market Transformation', 'Problem Landscape', 'Opportunity Size',
  'Platform Overview', 'Technology Stack', 'Innovation & IP', 'Product Roadmap',
  'Company Growth Overview', 'Revenue Growth', 'Customer Growth',
  'Retention', 'Product Engagement',
  'Go-To-Market Model', 'Sales Efficiency', 'Customer Economics',
  'Competition', 'Moat Analysis', 'Strategic Advantages',
  'Team', 'Operational Excellence',
  'Fundraising',
  // Appendix
  'A1 · Financial Statements',
  'A2 · Revenue Cohorts',
  'A3 · Customer Segmentation',
  'A4 · Sales Funnel',
  'A5 · Pricing',
  'A6 · Technology Architecture',
  'A7 · Security & Compliance',
  'A8 · Risk Analysis',
  'A9 · Board & Governance',
  'A10 · Three-Year Operating Plan',
];

const SlideFrame: React.FC<React.PropsWithChildren<{
  index: number; total: number; company?: string; subtitle?: string;
  bg?: string; ink?: string; accent?: string;
}>> = ({ index, total, company, subtitle, bg = PAPER, ink = INK, accent = ACCENT, children }) => {
  const isAppendix = index >= APPENDIX_OFFSET;
  return (
    <div
      className="relative"
      style={{
        aspectRatio: '16 / 9', width: '100%', maxHeight: '100vh',
        background: bg, color: ink, fontFamily: FONT,
        padding: 'clamp(24px, 3.6vw, 56px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      {/* Header strip */}
      <div className="flex items-center justify-between" style={{ marginBottom: 'clamp(14px, 2vw, 24px)' }}>
        <div className="flex items-center gap-3">
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6, background: accent, color: '#FFFFFF',
            fontSize: 11, fontWeight: 800, fontFamily: FONT_MONO, letterSpacing: 1,
          }}>
            {isAppendix ? 'A' : String(index + 1).padStart(2, '0')}
          </span>
          <span style={{ fontSize: 11, letterSpacing: '0.3em', fontWeight: 700, color: accent, textTransform: 'uppercase' }}>
            {sectionForIndex(index)}
          </span>
          <span style={{ color: HAIRLINE }}>·</span>
          <span style={{ fontSize: 11, letterSpacing: '0.3em', color: SUBTLE, textTransform: 'uppercase', fontWeight: 600 }}>
            {SLIDE_TITLES[index]}
          </span>
        </div>
        <div className="flex items-center gap-5">
          {subtitle && <span style={{ fontSize: 12, color: FAINT, fontStyle: 'italic' }}>{subtitle}</span>}
          <span style={{ fontSize: 11, color: FAINT, letterSpacing: 2, fontFamily: FONT_MONO }}>
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>

      {/* Footer */}
      <div className="flex items-center justify-between" style={{ marginTop: 'clamp(10px, 1.4vw, 18px)', paddingTop: 10, borderTop: `1px solid ${HAIRLINE}` }}>
        <span style={{ fontSize: 10, color: FAINT, letterSpacing: 2.5, fontFamily: FONT_MONO }}>
          {(company || 'Company').toUpperCase()} · SERIES B · CONFIDENTIAL — INVESTOR USE ONLY
        </span>
        <span style={{ fontSize: 10, color: FAINT, letterSpacing: 2.5, fontFamily: FONT_MONO }}>
          {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Reusable primitives
// ─────────────────────────────────────────────────────────────────

const Card: React.FC<React.PropsWithChildren<{
  title?: string; subtitle?: string; className?: string; style?: React.CSSProperties; accent?: boolean;
  right?: React.ReactNode;
}>> = ({ title, subtitle, className = '', style, accent, right, children }) => (
  <div className={`rounded-xl p-4 ${className}`} style={{
    background: accent ? ACCENT : PANEL,
    border: `1px solid ${accent ? ACCENT : HAIRLINE}`,
    color: accent ? '#FFFFFF' : INK, ...style,
  }}>
    {(title || subtitle || right) && (
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 10 }}>
        <div>
          {title && (
            <div style={{
              fontSize: 10, letterSpacing: 2.5, fontWeight: 700,
              color: accent ? 'rgba(255,255,255,0.85)' : SUBTLE, fontFamily: FONT_MONO,
              textTransform: 'uppercase',
            }}>{title}</div>
          )}
          {subtitle && (
            <div style={{ fontSize: 12, color: accent ? 'rgba(255,255,255,0.8)' : FAINT, marginTop: 4 }}>{subtitle}</div>
          )}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
);

const KpiTile: React.FC<{
  label: string; value: string; delta?: string; positive?: boolean;
  spark?: { v: number }[]; sublabel?: string;
}> = ({ label, value, delta, positive, spark, sublabel }) => (
  <Card>
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1">
        <div style={{ fontSize: 10, letterSpacing: 2, color: SUBTLE, fontFamily: FONT_MONO }}>{label.toUpperCase()}</div>
        <div style={{ fontSize: 'clamp(22px, 2.2vw, 32px)', fontWeight: 800, letterSpacing: -1, marginTop: 4, color: INK, lineHeight: 1 }}>
          {value}
        </div>
        {sublabel && <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>{sublabel}</div>}
        {delta && (
          <div style={{ fontSize: 11, color: positive ? POSITIVE : NEGATIVE, fontWeight: 600, marginTop: 6, fontFamily: FONT_MONO }}>
            {positive ? '▲' : '▼'} {delta}
          </div>
        )}
      </div>
      {spark && spark.length > 0 && (
        <div style={{ width: 64, height: 30 }}>
          <ResponsiveContainer>
            <AreaChart data={spark}>
              <defs>
                <linearGradient id={`sp-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={1.5} fill={`url(#sp-${label.replace(/\W/g, '')})`} />
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
    <div style={{ background: '#FFFFFF', border: `1px solid ${HAIRLINE}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, fontFamily: FONT, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: 11, color: SUBTLE, letterSpacing: 1.5, fontFamily: FONT_MONO }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ marginTop: 2, color: p.color || INK, fontWeight: 600 }}>
          {p.name}: {prefix}{fmtNum(p.value)}{suffix}
        </div>
      ))}
    </div>
  );
};

const SectionDivider: React.FC<{ section: string; index: number }> = ({ section, index }) => (
  <div
    className="relative"
    style={{
      aspectRatio: '16 / 9', width: '100%', maxHeight: '100vh',
      background: INK, color: PAPER, fontFamily: FONT,
      padding: 'clamp(40px, 6vw, 96px)', display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }}
  >
    <div style={{ fontSize: 12, letterSpacing: 8, color: ACCENT_2, fontWeight: 700, fontFamily: FONT_MONO }}>
      {section}
    </div>
    <div style={{ fontSize: 'clamp(48px, 6vw, 96px)', fontWeight: 800, letterSpacing: -3, marginTop: 12 }}>
      {SLIDE_TITLES[index]}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// SVG primitives
// ─────────────────────────────────────────────────────────────────

const MarketRings: React.FC<{ tam?: number; sam?: number; som?: number }> = ({ tam, sam, som }) => {
  const maxR = 200;
  const tamR = maxR;
  const samR = sam && tam ? maxR * Math.sqrt(sam / tam) : maxR * 0.66;
  const somR = som && tam ? maxR * Math.sqrt(som / tam) : maxR * 0.33;
  return (
    <svg viewBox="0 0 540 480" className="w-full" aria-hidden>
      <defs>
        <radialGradient id="mb" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.06" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.2" />
        </radialGradient>
      </defs>
      <circle cx="270" cy="240" r={tamR} fill="url(#mb)" stroke={ACCENT} strokeOpacity="0.4" />
      <circle cx="270" cy="240" r={samR} fill={ACCENT} fillOpacity="0.18" stroke={ACCENT} strokeOpacity="0.6" />
      <circle cx="270" cy="240" r={somR} fill={ACCENT} fillOpacity="0.92" />
      <text x="270" y="42" textAnchor="middle" fontSize="11" letterSpacing="3" fill={SUBTLE} fontFamily={FONT_MONO}>TAM</text>
      <text x="270" y="66" textAnchor="middle" fontSize="22" fontWeight={800} fill={INK} fontFamily={FONT}>{fmtUSD(tam)}</text>
      <text x="270" y={240 - samR - 14} textAnchor="middle" fontSize="10" letterSpacing="3" fill={SUBTLE} fontFamily={FONT_MONO}>SAM</text>
      <text x="270" y={240 - samR + 8} textAnchor="middle" fontSize="17" fontWeight={800} fill={INK} fontFamily={FONT}>{fmtUSD(sam)}</text>
      <text x="270" y="244" textAnchor="middle" fontSize="10" letterSpacing="3" fill="#FFFFFF" fontFamily={FONT_MONO}>SOM</text>
      <text x="270" y="266" textAnchor="middle" fontSize="16" fontWeight={800} fill="#FFFFFF" fontFamily={FONT}>{fmtUSD(som)}</text>
    </svg>
  );
};

const PlatformDiagram: React.FC<{ layers: { name: string; capabilities: string[] }[] }> = ({ layers }) => {
  const W = 720;
  const H = 340;
  const colW = (W - 60) / Math.max(layers.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      <defs>
        <linearGradient id="pd2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.08" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect x="30" y={H - 50} width={W - 60} height="36" rx="8" fill={SURFACE_2} stroke={HAIRLINE} />
      <text x="46" y={H - 28} fontSize="10" fontFamily={FONT_MONO} fill={SUBTLE} letterSpacing="3">PLATFORM · API · INTEGRATIONS · SECURITY · OBSERVABILITY</text>
      {layers.map((m, ci) => {
        const cx = 30 + colW * ci + colW / 2;
        return (
          <g key={ci}>
            <rect x={cx - colW * 0.42} y="20" width={colW * 0.84} height={H - 90} rx="12" fill="url(#pd2)" stroke={ACCENT} strokeOpacity="0.4" />
            <text x={cx} y="44" textAnchor="middle" fontSize="12" fontFamily={FONT_MONO} letterSpacing="3" fill={ACCENT} fontWeight={700}>{m.name.toUpperCase()}</text>
            {m.capabilities.slice(0, 5).map((c, i) => (
              <g key={i} transform={`translate(${cx} ${78 + i * 42})`}>
                <rect x={-colW * 0.36} y={-14} width={colW * 0.72} height={30} rx={6} fill={PAPER} stroke={HAIRLINE} />
                <text x="0" y="6" textAnchor="middle" fontSize="12" fontFamily={FONT} fill={INK}>{c}</text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
};

const PositioningMap: React.FC<{
  competitors: { name: string; x: number; y: number; size?: number; is_us?: boolean }[];
  axis_x?: string; axis_y?: string;
}> = ({ competitors, axis_x = 'Reach', axis_y = 'Depth' }) => {
  const W = 540;
  const H = 380;
  const padL = 60, padR = 20, padT = 20, padB = 50;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" aria-hidden>
      <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke={INK} strokeWidth={1.5} />
      <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke={INK} strokeWidth={1.5} />
      <text x={W - padR} y={H - padB + 24} textAnchor="end" fontSize="11" letterSpacing="2" fontFamily={FONT_MONO} fill={SUBTLE}>{axis_x.toUpperCase()} →</text>
      <g transform={`translate(${padL - 36}, ${H / 2}) rotate(-90)`}>
        <text fontSize="11" letterSpacing="2" fontFamily={FONT_MONO} fill={SUBTLE}>{axis_y.toUpperCase()} →</text>
      </g>
      {competitors.map((c, i) => {
        const cx = padL + (c.x / 100) * (W - padL - padR);
        const cy = H - padB - (c.y / 100) * (H - padT - padB);
        const us = c.is_us;
        const r = c.size ? Math.max(6, Math.min(28, c.size)) : (us ? 12 : 8);
        return (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            {us && <circle r={r + 12} fill={ACCENT} opacity="0.12" />}
            <circle r={r} fill={us ? ACCENT : '#FFFFFF'} stroke={us ? ACCENT : INK} strokeWidth={us ? 0 : 1.5} />
            <text y={r + 16} textAnchor="middle" fontSize={us ? 13 : 11} fontFamily={FONT} fontWeight={us ? 700 : 600} fill={us ? ACCENT : INK}>{c.name}</text>
          </g>
        );
      })}
    </svg>
  );
};

// Cohort retention triangle grid
const CohortGrid: React.FC<{
  cohorts: { cohort: string; values: number[] }[];
  periodLabels?: string[];
}> = ({ cohorts, periodLabels = ['M0', 'M3', 'M6', 'M9', 'M12'] }) => {
  const cellW = 60, cellH = 28;
  const W = 130 + periodLabels.length * cellW;
  const H = 40 + cohorts.length * cellH + 20;
  const colorFor = (v: number) => {
    if (v >= 100) return '#065F46';   // emerald-800
    if (v >= 95)  return '#047857';
    if (v >= 90)  return '#10B981';
    if (v >= 80)  return '#34D399';
    if (v >= 70)  return '#A7F3D0';
    if (v >= 60)  return '#FCD34D';
    if (v >= 50)  return '#FBBF24';
    return '#F87171';
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      {/* header */}
      <text x="20" y="30" fontSize="11" fontFamily={FONT_MONO} letterSpacing="2" fill={SUBTLE} fontWeight={700}>COHORT</text>
      {periodLabels.map((p, i) => (
        <text key={i} x={130 + i * cellW + cellW / 2} y="30" textAnchor="middle" fontSize="11" fontFamily={FONT_MONO} letterSpacing="1" fill={SUBTLE}>{p}</text>
      ))}
      {cohorts.map((row, r) => (
        <g key={r}>
          <text x="20" y={40 + r * cellH + cellH / 2 + 5} fontSize="11" fontFamily={FONT_MONO} fill={INK} fontWeight={600}>{row.cohort}</text>
          {row.values.map((v, c) => (
            <g key={c}>
              <rect x={130 + c * cellW + 2} y={40 + r * cellH + 2} width={cellW - 4} height={cellH - 4} rx="4" fill={colorFor(v)} fillOpacity="0.85" />
              <text x={130 + c * cellW + cellW / 2} y={40 + r * cellH + cellH / 2 + 4} textAnchor="middle" fontSize="11" fontFamily={FONT_MONO} fontWeight={700} fill={v >= 80 ? '#FFFFFF' : INK}>
                {v}%
              </text>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
};

// Network of moats — pentagonal
const MoatPentagon: React.FC<{ moats: { kind: string; title: string }[] }> = ({ moats }) => {
  const W = 460, H = 380, cx = W / 2, cy = H / 2;
  const items = moats.slice(0, 5);
  const labels = items.length ? items : [{ kind: 'tech', title: 'Technology' }];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" aria-hidden>
      {[0.3, 0.6, 1].map((t, i) => (
        <polygon
          key={i}
          points={labels.map((_, k) => {
            const a = (k / labels.length) * Math.PI * 2 - Math.PI / 2;
            return `${cx + Math.cos(a) * 140 * t},${cy + Math.sin(a) * 140 * t}`;
          }).join(' ')}
          fill="none"
          stroke={HAIRLINE}
        />
      ))}
      {labels.map((m, k) => {
        const a = (k / labels.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * 140;
        const y = cy + Math.sin(a) * 140;
        const lx = cx + Math.cos(a) * 170;
        const ly = cy + Math.sin(a) * 170;
        return (
          <g key={k}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={HAIRLINE} />
            <circle cx={x} cy={y} r="8" fill={ACCENT} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="12" fontFamily={FONT} fill={INK} fontWeight={600}>
              {m.title}
            </text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="14" fill={INK} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fill="#FFFFFF" fontFamily={FONT_MONO} letterSpacing="1.5">MOAT</text>
    </svg>
  );
};

// Simple architecture rack diagram (used in A6)
const ArchitectureRack: React.FC<{ layers: { layer: string; nodes: string[] }[] }> = ({ layers }) => {
  const W = 820;
  const layerH = 64;
  const H = layers.length * (layerH + 10) + 20;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      {layers.map((L, i) => {
        const y = 10 + i * (layerH + 10);
        const slotW = (W - 200) / Math.max(L.nodes.length, 1);
        return (
          <g key={i}>
            <rect x="10" y={y} width="180" height={layerH} rx="8" fill={INK} />
            <text x="100" y={y + layerH / 2 + 5} textAnchor="middle" fontSize="13" fontWeight={700} fill="#FFFFFF" fontFamily={FONT_MONO} letterSpacing="2">
              {safeUpper(L.layer)}
            </text>
            {L.nodes.map((n, j) => (
              <g key={j}>
                <rect x={200 + j * slotW + 4} y={y + 6} width={slotW - 8} height={layerH - 12} rx={8} fill={PAPER} stroke={HAIRLINE} />
                <text x={200 + j * slotW + slotW / 2} y={y + layerH / 2 + 5} textAnchor="middle" fontSize="13" fontFamily={FONT} fill={INK}>{n}</text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────
// SLIDES — 22 main + 10 appendix
// ─────────────────────────────────────────────────────────────────

// SECTION I — OPPORTUNITY ────────────────────────────────────────

const Slide1Vision: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => (
  <SlideFrame index={0} total={32} company={data.company} subtitle="Future state · category · mission">
    <div className="grid grid-cols-12 gap-8 h-full items-center">
      <div className="col-span-7 flex flex-col">
        <Editable value={data.vision_category || data.category} path="vision_category" editable={editable} onEdit={onEdit}
          placeholder="THE CATEGORY"
          style={{ fontSize: 11, letterSpacing: 4, fontFamily: FONT_MONO, color: ACCENT, fontWeight: 700 }} />
        <Editable as="h1" value={data.vision_headline} path="vision_headline" editable={editable} onEdit={onEdit}
          placeholder="The default platform every operating team will route their work through."
          style={{ fontSize: 'clamp(36px, 4vw, 72px)', fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: 16, color: INK, maxWidth: 700 }} />
        <Editable value={data.vision_subline} path="vision_subline" editable={editable} onEdit={onEdit}
          placeholder="Mission · concrete, specific, ambitious. Two sentences max."
          style={{ fontSize: 'clamp(15px, 1.3vw, 20px)', color: SUBTLE, marginTop: 18, lineHeight: 1.5, maxWidth: 600 }} />
        <div className="mt-10 grid grid-cols-3 gap-3 max-w-lg">
          {[
            { l: 'Stage',      v: 'Series B' },
            { l: 'Round size', v: fmtUSD(data.ask_amount_usd) },
            { l: 'Current ARR', v: fmtUSD(data.arr_usd) },
          ].map((s, i) => (
            <Card key={i}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: SUBTLE, fontFamily: FONT_MONO }}>{safeUpper(s.l)}</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: i === 1 ? ACCENT : INK }}>{s.v}</div>
            </Card>
          ))}
        </div>
      </div>
      <div className="col-span-5 h-full max-h-[58vh]">
        <svg viewBox="0 0 600 540" className="w-full h-full" aria-hidden>
          <defs>
            <radialGradient id="v1" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor={ACCENT_2} stopOpacity="0.3" />
              <stop offset="100%" stopColor={ACCENT_2} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="600" height="540" fill="url(#v1)" />
          {[60, 110, 180, 270, 380].map((r, i) => (
            <circle key={i} cx="300" cy="280" r={r} fill="none" stroke={ACCENT} strokeOpacity={0.3 - i * 0.04} strokeDasharray={i % 2 ? '4 6' : 'none'} />
          ))}
          {[[300, 280, 16], [220, 200, 9], [400, 220, 8], [440, 320, 9], [240, 360, 7], [180, 280, 6], [480, 180, 6]].map(([cx, cy, r], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r={(r as number) + 5} fill={ACCENT} opacity="0.15" />
              <circle cx={cx} cy={cy} r={r as number} fill={ACCENT} />
            </g>
          ))}
          <text x="300" y="510" textAnchor="middle" fontSize="11" letterSpacing="4" fill={SUBTLE} fontFamily={FONT_MONO}>OPERATING SYSTEM FOR ITS CATEGORY</text>
        </svg>
      </div>
    </div>
  </SlideFrame>
);

const Slide2Market: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const shifts = data.market_shifts?.length ? data.market_shifts : [
    { kind: 'tech',     title: 'Compute · 1000×',  body: 'LLM cost down ~1000× in 24 months.', metric: '↓ cost' },
    { kind: 'reg',      title: 'Audit regulation', body: 'New rules require traceability across systems.', metric: '↑ scrutiny' },
    { kind: 'industry', title: 'Operator behavior', body: 'Teams now expect software to act for them.', metric: '↑ demand' },
  ] as any;
  const curve = data.market_inflection_curve?.length ? data.market_inflection_curve : [
    { year: '2020', baseline: 100, new_world: 6 }, { year: '2022', baseline: 92, new_world: 17 },
    { year: '2024', baseline: 76, new_world: 44 }, { year: '2026', baseline: 52, new_world: 92 },
    { year: '2028', baseline: 28, new_world: 168 }, { year: '2030', baseline: 12, new_world: 280 },
  ];
  const icon = (k: string) => k === 'tech' ? '◆' : k === 'reg' ? '§' : '↻';
  return (
    <SlideFrame index={1} total={32} company={data.company} subtitle="Why now — three converging forces">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK, lineHeight: 1.1 }}>
        The window is open and closing.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-5 grid grid-cols-1 gap-3">
          {shifts.slice(0, 3).map((p: any, i: number) => (
            <Card key={i}>
              <div className="flex items-start gap-3">
                <span style={{ width: 32, height: 32, borderRadius: 8, background: ACCENT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, fontFamily: FONT_MONO, flexShrink: 0 }}>
                  {icon(p.kind)}
                </span>
                <div>
                  <Editable as="div" value={p.title} path={`market_shifts.${i}.title`} editable={editable} onEdit={onEdit}
                    style={{ fontSize: 15, fontWeight: 700, color: INK }} />
                  <Editable value={p.body} path={`market_shifts.${i}.body`} editable={editable} onEdit={onEdit}
                    style={{ fontSize: 13, color: SUBTLE, marginTop: 4, lineHeight: 1.45 }} />
                  {p.metric && (
                    <div style={{ fontSize: 10, marginTop: 6, letterSpacing: 2, color: ACCENT, fontFamily: FONT_MONO, fontWeight: 700 }}>{p.metric}</div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
        <div className="col-span-7">
          <Card title="OLD vs NEW WORLD" subtitle="Capability per dollar of investment">
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
  const drivers = data.problem_drivers?.length ? data.problem_drivers : [
    { title: 'Fragmented data', body: 'No single source of truth across operating systems.', metric: '$1.2T waste/yr' },
    { title: 'Manual reconciliation', body: 'Operators spend 30%+ of their week stitching.', metric: '63% of teams' },
    { title: 'No audit', body: 'Errors caught months after they occur.', metric: '7.4 tools / workflow' },
  ];
  const consequences = data.problem_consequences?.length ? data.problem_consequences : [
    'Increased compliance exposure',
    'Slower decision cycles',
    'Hidden working capital trapped',
    'Failed audits',
  ];
  return (
    <SlideFrame index={2} total={32} company={data.company} subtitle="Inefficiencies · pain · economic consequences">
      <Editable as="h2" value={data.problem_headline} path="problem_headline" editable={editable} onEdit={onEdit}
        placeholder="A trillion-dollar friction tax that nobody charges for — but everyone pays."
        style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.1, color: INK }} />
      <div className="mt-6 grid grid-cols-3 gap-3">
        {drivers.slice(0, 3).map((d, i) => (
          <Card key={i}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, fontWeight: 700, fontFamily: FONT_MONO }}>DRIVER · 0{i + 1}</div>
            <Editable as="div" value={d.title} path={`problem_drivers.${i}.title`} editable={editable} onEdit={onEdit}
              style={{ fontSize: 17, fontWeight: 800, color: INK, marginTop: 6 }} />
            <Editable value={d.body} path={`problem_drivers.${i}.body`} editable={editable} onEdit={onEdit}
              style={{ fontSize: 13, color: SUBTLE, marginTop: 8, lineHeight: 1.45 }} />
            {d.metric && (
              <div style={{ fontSize: 22, fontWeight: 900, color: ACCENT, marginTop: 10, fontFamily: FONT_MONO }}>{d.metric}</div>
            )}
          </Card>
        ))}
      </div>
      <div className="mt-4 flex-1 min-h-0">
        <Card title="ECONOMIC CONSEQUENCES">
          <div className="grid grid-cols-2 gap-2">
            {consequences.slice(0, 6).map((c, i) => (
              <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg" style={{ background: SURFACE }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: ALERT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, fontFamily: FONT_MONO, flexShrink: 0, marginTop: 2 }}>!</span>
                <Editable value={c} path={`problem_consequences.${i}`} editable={editable} onEdit={onEdit}
                  style={{ fontSize: 13, color: INK, lineHeight: 1.4, fontWeight: 500 }} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </SlideFrame>
  );
};

const Slide4Opportunity: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const curve = data.market_curve?.length ? data.market_curve : [
    { year: '2022', v: 22 }, { year: '2024', v: 38 }, { year: '2026', v: 64 },
    { year: '2028', v: 105 }, { year: '2030', v: 168 },
  ];
  const expansion = data.expansion_vectors?.length ? data.expansion_vectors : [
    { name: 'Adjacent workflow', tam_usd: 8_000_000_000, phase: 'now' as const },
    { name: 'Vertical playbook', tam_usd: 6_000_000_000, phase: 'next' as const },
    { name: 'Geographic expansion', tam_usd: 11_000_000_000, phase: 'next' as const },
    { name: 'Platform / marketplace', tam_usd: 17_000_000_000, phase: 'future' as const },
  ];
  return (
    <SlideFrame index={3} total={32} company={data.company} subtitle="TAM · SAM · SOM · expansion vectors">
      <div className="grid grid-cols-12 gap-4 h-full">
        <div className="col-span-6 flex items-center">
          <MarketRings tam={data.tam_usd} sam={data.sam_usd} som={data.som_usd} />
        </div>
        <div className="col-span-6 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>TAM</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{fmtUSD(data.tam_usd)}</div>
              <div style={{ fontSize: 11, color: FAINT, marginTop: 2 }}>Total addressable</div>
            </Card>
            <Card>
              <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>SAM</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{fmtUSD(data.sam_usd)}</div>
              <div style={{ fontSize: 11, color: FAINT, marginTop: 2 }}>Serviceable</div>
            </Card>
            <Card accent>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', letterSpacing: 2, fontFamily: FONT_MONO }}>SOM</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{fmtUSD(data.som_usd)}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>5-yr obtainable</div>
            </Card>
          </div>
          <Card title={`CATEGORY GROWTH · ${fmtPct(data.market_cagr_pct)} CAGR`}>
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer>
                <AreaChart data={curve}>
                  <defs>
                    <linearGradient id="mc2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="year" tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="B" />} />
                  <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={2.5} fill="url(#mc2)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="EXPANSION VECTORS · TAM unlock">
            <div className="space-y-2.5">
              {expansion.slice(0, 5).map((e, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ fontWeight: 600, color: INK }}>{e.name}</span>
                    <span style={{ fontFamily: FONT_MONO, color: SUBTLE }}>
                      {fmtUSD(e.tam_usd)} · <span style={{ color: e.phase === 'now' ? POSITIVE : e.phase === 'next' ? ACCENT : FAINT, fontWeight: 700 }}>{safeUpper(e.phase)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full" style={{ background: SURFACE_2 }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min(e.tam_usd / (data.tam_usd || 42e9) * 100, 100)}%`, background: e.phase === 'now' ? POSITIVE : e.phase === 'next' ? ACCENT : ACCENT_3 }} />
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

// SECTION II — PRODUCT ──────────────────────────────────────────

const Slide5Platform: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const layers = data.platform_layers?.length ? data.platform_layers : [
    { name: 'Capture', capabilities: ['Web', 'API', 'Mobile', 'Webhook', 'Batch'] },
    { name: 'Reason',  capabilities: ['Workflow', 'Policy', 'LLM', 'Tests', 'Audit'] },
    { name: 'Act',     capabilities: ['Integrations', 'Records', 'Replay', 'Reports', 'Alerts'] },
  ];
  const metrics = data.value_metrics?.length ? data.value_metrics : [
    { label: 'Workflow ship time', value: '94%', sublabel: 'faster vs. status quo' },
    { label: 'Reconciliation effort', value: '−82%', sublabel: 'measured on first cohort' },
    { label: 'Audit coverage', value: '100%', sublabel: 'system-wide trail' },
  ];
  return (
    <SlideFrame index={4} total={32} company={data.company} subtitle="Architecture · workflows · value creation">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Three layers. One platform. Customer-visible value at each.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-8">
          <Card title="PLATFORM ARCHITECTURE">
            <PlatformDiagram layers={layers} />
          </Card>
        </div>
        <div className="col-span-4 grid grid-rows-3 gap-3">
          {metrics.slice(0, 3).map((m, i) => (
            <Card key={i}>
              <div style={{ fontSize: 10, color: SUBTLE, letterSpacing: 2, fontFamily: FONT_MONO }}>{safeUpper(m.label)}</div>
              <div style={{ fontSize: 'clamp(28px, 2.8vw, 44px)', fontWeight: 900, letterSpacing: -1, color: ACCENT, marginTop: 6, lineHeight: 1 }}>{m.value}</div>
              {m.sublabel && <div style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>{m.sublabel}</div>}
            </Card>
          ))}
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide6TechStack: React.FC<DeckProps> = ({ data = {} }) => {
  const stack = data.tech_stack?.length ? data.tech_stack : [
    { layer: 'Infrastructure', components: ['Cloudflare Workers', 'D1', 'R2', 'Durable Objects', 'Queues'] },
    { layer: 'Data',           components: ['Vectorize', 'Analytics Engine', 'Streaming ingest'] },
    { layer: 'Application',    components: ['Workflow engine', 'Policy DSL', 'API SDK', 'Integration bus'] },
    { layer: 'Security',       components: ['SOC 2 Type II', 'Cf Access', 'Field-level encryption', 'Audit log streaming'] },
    { layer: 'Scalability',    components: ['Edge runtime', 'Multi-region', 'Async DLQ', 'Smart placement'] },
  ];
  return (
    <SlideFrame index={5} total={32} company={data.company} subtitle="Infra · data · application · security · scalability">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Built on edge primitives — designed for scale from day one.
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-3 flex-1 min-h-0">
        {stack.slice(0, 6).map((s, i) => (
          <Card key={i}>
            <div className="flex items-center gap-3">
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: ACCENT, color: '#FFFFFF', fontWeight: 800, fontSize: 12, fontFamily: FONT_MONO }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ fontSize: 14, letterSpacing: 2, color: ACCENT, fontWeight: 800, fontFamily: FONT_MONO }}>{safeUpper(s.layer)}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.components.map((c, j) => (
                <span key={j} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: SURFACE, border: `1px solid ${HAIRLINE}`, color: INK, fontWeight: 500 }}>
                  {c}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </SlideFrame>
  );
};

const Slide7Innovation: React.FC<DeckProps> = ({ data = {} }) => {
  const pillars = data.innovation_pillars?.length ? data.innovation_pillars : [
    { title: 'Differential privacy by design', body: 'Workflow data trained without leaking customer-specific records.' },
    { title: 'Deterministic LLM gating',       body: 'Symbolic policy layer blocks non-conforming model outputs.' },
    { title: 'Audit-trail compression',        body: 'Patent-pending storage format reduces audit size 18×.' },
  ];
  const ip = data.ip_assets?.length ? data.ip_assets : [
    { label: 'Patents filed',       v: 7,  sublabel: '3 granted' },
    { label: 'Provisional patents', v: 4,  sublabel: 'priority dates secured' },
    { label: 'Trade secrets',       v: 12, sublabel: 'core algorithms' },
    { label: 'Research papers',     v: 5,  sublabel: 'peer-reviewed' },
  ];
  return (
    <SlideFrame index={6} total={32} company={data.company} subtitle="Unique technology · IP · research advantages">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Original research compounding into defensible IP.
      </h2>
      <div className="mt-6 grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-7 grid grid-cols-1 gap-3">
          {pillars.slice(0, 3).map((p, i) => (
            <Card key={i}>
              <div className="flex items-start gap-4">
                <div style={{ fontSize: 22, fontWeight: 900, color: ACCENT, fontFamily: FONT_MONO, lineHeight: 1 }}>0{i + 1}</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{p.title}</div>
                  <div style={{ fontSize: 13, color: SUBTLE, marginTop: 6, lineHeight: 1.5 }}>{p.body}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
        <div className="col-span-5">
          <Card title="IP & RESEARCH ASSETS">
            <div className="grid grid-cols-2 gap-3">
              {ip.slice(0, 4).map((s, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, color: SUBTLE, fontFamily: FONT_MONO }}>{safeUpper(s.label)}</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: INK, marginTop: 4, lineHeight: 1 }}>{s.v}</div>
                  {s.sublabel && <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>{s.sublabel}</div>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide8Roadmap: React.FC<DeckProps> = ({ data = {} }) => {
  const phases = data.product_roadmap?.length ? data.product_roadmap : [
    { phase: 'past' as const, quarter: 'PAST 12 MO', items: ['Workflow v2', 'Audit framework', '6 connector launches', 'SOC 2 Type II'] },
    { phase: 'now' as const,  quarter: 'NOW',         items: ['Reasoning engine GA', 'Enterprise tier', 'Compliance API', 'EU residency'] },
    { phase: 'next' as const, quarter: 'NEXT 12 MO',  items: ['Adjacent workflow', 'Vertical playbook · Health', 'Public marketplace', 'Embedded distribution'] },
  ];
  const phaseColor = (p: string) => p === 'past' ? FAINT : p === 'now' ? ACCENT : ACCENT_2;
  return (
    <SlideFrame index={7} total={32} company={data.company} subtitle="Past · current · next 12 months">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Shipped reliably. Investing in the next platform layer.
      </h2>
      <div className="mt-6 grid grid-cols-3 gap-4 flex-1 min-h-0">
        {phases.slice(0, 3).map((ph, i) => (
          <Card key={i} style={{ borderColor: phaseColor(ph.phase), background: ph.phase === 'now' ? '#FFFFFF' : PANEL }}>
            <div className="flex items-center justify-between">
              <div style={{ fontSize: 11, letterSpacing: 3, color: phaseColor(ph.phase), fontWeight: 800, fontFamily: FONT_MONO }}>
                {ph.quarter}
              </div>
              <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: SUBTLE, letterSpacing: 2 }}>
                {ph.phase === 'now' ? '· LIVE' : ph.phase === 'past' ? '· DELIVERED' : '· PLANNED'}
              </div>
            </div>
            <ul className="mt-4 space-y-2.5">
              {ph.items.map((it, j) => (
                <li key={j} className="flex items-start gap-2.5">
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: phaseColor(ph.phase), marginTop: 6 }} />
                  <span style={{ fontSize: 13, color: INK, lineHeight: 1.45 }}>{it}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </SlideFrame>
  );
};

// SECTION III — TRACTION ─────────────────────────────────────────

const Slide9Overview: React.FC<DeckProps> = ({ data = {} }) => {
  const spark = (base: number) => Array.from({ length: 8 }, (_, i) => ({ v: base * (0.5 + i * 0.08 + Math.random() * 0.04) }));
  return (
    <SlideFrame index={8} total={32} company={data.company} subtitle="Executive KPI dashboard">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Growth + efficiency · best-in-class across the dashboard.
      </h2>
      <div className="mt-6 grid grid-cols-4 gap-3 flex-1 min-h-0">
        <KpiTile label="ARR"             value={fmtUSD(data.arr_usd)}              delta={`${data.growth_yoy_pct ?? '—'}% YoY`} positive spark={spark(8)} />
        <KpiTile label="MRR"             value={fmtUSD(data.mrr_usd)}              delta={`${data.growth_mom_pct ?? '—'}% MoM`} positive spark={spark(6)} />
        <KpiTile label="Customers"        value={fmtNum(data.customer_count)}       delta="+14 this q" positive spark={spark(5)} />
        <KpiTile label="Active users"     value={fmtNum(data.active_users)}         delta="+38% QoQ" positive spark={spark(7)} />
        <KpiTile label="NRR"              value={fmtPct(data.nrr_pct)}              delta="best in class" positive />
        <KpiTile label="GRR"              value={fmtPct(data.grr_pct)}              delta="durable" positive />
        <KpiTile label="Gross margin"     value={fmtPct(data.gross_margin_pct)}     delta="+4 pts" positive />
        <KpiTile label="Monthly churn"    value={fmtPct(data.monthly_churn_pct)}    delta="-0.3 pts" positive />
        <KpiTile label="Magic number"     value={String(data.magic_number ?? '—')}   delta="< 1y payback" positive />
        <KpiTile label="Rule of 40"       value={String(data.rule_of_40 ?? '—')}     delta="growth + margin" positive />
        <KpiTile label="EBITDA margin"    value={fmtPct(data.ebitda_margin_pct)}    delta="approaching profit" positive />
        <KpiTile label="Burn multiple"    value={String(data.burn_multiple ?? '—')}  delta="best practice" positive />
      </div>
    </SlideFrame>
  );
};

const Slide10Revenue: React.FC<DeckProps> = ({ data = {} }) => {
  const arr = data.arr_series?.length ? data.arr_series : Array.from({ length: 24 }, (_, i) => ({ month: `M${i + 1}`, v: 240 * Math.pow(1.18, i) }));
  const forecast = data.arr_forecast?.length ? data.arr_forecast :
    [...arr.map(p => ({ ...p, forecast: null as any })),
     ...Array.from({ length: 8 }, (_, i) => ({ month: `F${i + 1}`, v: null as any, forecast: 6500 * Math.pow(1.14, i) }))];
  const growthRate = data.growth_rate_curve?.length ? data.growth_rate_curve :
    [{ quarter: 'Q1', rate: 92 }, { quarter: 'Q2', rate: 88 }, { quarter: 'Q3', rate: 95 },
     { quarter: 'Q4', rate: 102 }, { quarter: 'Q5', rate: 118 }, { quarter: 'Q6', rate: 124 }];
  return (
    <SlideFrame index={9} total={32} company={data.company} subtitle="ARR · MRR · growth rate · forecast">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Acceleration through scale — growth rate <em>increasing</em> with size.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="ARR · TRAILING + FORWARD (K USD)" subtitle="Actual solid; forecast dashed">
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <ComposedChart data={forecast}>
                  <defs>
                    <linearGradient id="arr2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity="0.45" />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={2.5} fill="url(#arr2)" name="ARR" />
                  <Line type="monotone" dataKey="forecast" stroke={ACCENT_2} strokeWidth={2.5} strokeDasharray="5 5" dot={false} name="Forecast" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-5 grid grid-rows-2 gap-3">
          <Card title="GROWTH RATE TREND" subtitle="QoQ rolling growth">
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer>
                <BarChart data={growthRate}>
                  <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Bar dataKey="rate" fill={ACCENT} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="ARR today" value={fmtUSD(data.arr_usd)} delta={`${data.growth_yoy_pct ?? '—'}% YoY`} positive />
            <KpiTile label="MRR today" value={fmtUSD(data.mrr_usd)} delta={`${data.growth_mom_pct ?? '—'}% MoM`} positive />
          </div>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide11Customers: React.FC<DeckProps> = ({ data = {} }) => {
  const series = data.customer_count_series?.length ? data.customer_count_series :
    Array.from({ length: 8 }, (_, i) => ({
      month: `Q${i + 1}`,
      enterprise: Math.round(4 * Math.pow(1.4, i)),
      midmarket: Math.round(12 * Math.pow(1.28, i)),
      smb: Math.round(48 * Math.pow(1.18, i)),
    }));
  const segments = data.customer_segments?.length ? data.customer_segments :
    [{ segment: 'Enterprise', count: 24, arr_share_pct: 52 },
     { segment: 'Mid-market', count: 88, arr_share_pct: 33 },
     { segment: 'SMB',         count: 248, arr_share_pct: 15 }];
  const geo = data.geo_split?.length ? data.geo_split :
    [{ region: 'NA', arr_share_pct: 62 }, { region: 'EU', arr_share_pct: 22 }, { region: 'APAC', arr_share_pct: 12 }, { region: 'LATAM', arr_share_pct: 4 }];
  return (
    <SlideFrame index={10} total={32} company={data.company} subtitle="Count · segments · expansion · geography">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Layered customer base — increasingly enterprise-weighted.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="CUSTOMER COUNT BY SEGMENT">
            <div style={{ width: '100%', height: 250 }}>
              <ResponsiveContainer>
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT_MONO, color: SUBTLE }} />
                  <Bar dataKey="enterprise" stackId="x" fill={ACCENT} name="Enterprise" />
                  <Bar dataKey="midmarket"   stackId="x" fill={ACCENT_2} name="Mid-market" />
                  <Bar dataKey="smb"         stackId="x" fill={ACCENT_3} name="SMB" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-5 grid grid-rows-2 gap-3">
          <Card title="ARR MIX BY SEGMENT">
            <div className="space-y-2.5 mt-1">
              {segments.map((s, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm">
                    <span style={{ fontWeight: 600 }}>{s.segment}</span>
                    <span style={{ fontFamily: FONT_MONO, color: SUBTLE }}>{s.count} · {s.arr_share_pct}% ARR</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full" style={{ background: SURFACE_2 }}>
                    <div className="h-2 rounded-full" style={{ width: `${s.arr_share_pct}%`, background: i === 0 ? ACCENT : i === 1 ? ACCENT_2 : ACCENT_3 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="GEOGRAPHIC ARR SHARE">
            <div style={{ width: '100%', height: 110 }}>
              <ResponsiveContainer>
                <BarChart data={geo} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="region" type="category" tick={{ fontSize: 11, fill: INK, fontFamily: FONT_MONO }} stroke={HAIRLINE} width={56} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Bar dataKey="arr_share_pct" fill={ACCENT} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide12Retention: React.FC<DeckProps> = ({ data = {} }) => {
  const logo = data.retention_cohort?.length ? data.retention_cohort :
    [{ m: 'M0', v: 100 }, { m: 'M3', v: 97 }, { m: 'M6', v: 95 }, { m: 'M9', v: 94 }, { m: 'M12', v: 93 }];
  const cohorts = data.cohort_grid?.length ? data.cohort_grid : [
    { cohort: '2024 Q1', values: [100, 102, 108, 117, 128] },
    { cohort: '2024 Q2', values: [100, 104, 112, 124, 135] },
    { cohort: '2024 Q3', values: [100, 107, 118, 130] as any },
    { cohort: '2024 Q4', values: [100, 110, 122] as any },
  ];
  const nrrDec = data.nrr_decomposition?.length ? data.nrr_decomposition :
    [{ label: 'Gross retention', v: 96 }, { label: 'Expansion', v: 36 }, { label: 'Churn', v: -4 }, { label: 'Net retention', v: 128 }];
  return (
    <SlideFrame index={11} total={32} company={data.company} subtitle="Logo · gross · net · cohort">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Cohorts expand. Logo retention durable. NRR best-in-class.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-4">
          <Card title="LOGO RETENTION COHORT">
            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer>
                <LineChart data={logo}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="m" tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis domain={[80, 100]} tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <ReferenceLine y={90} stroke={ALERT} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={3} dot={{ r: 4, fill: ACCENT }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="mt-3" title="NRR DECOMPOSITION">
            <div style={{ width: '100%', height: 170 }}>
              <ResponsiveContainer>
                <BarChart data={nrrDec} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: INK, fontFamily: FONT }} stroke={HAIRLINE} width={110} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Bar dataKey="v" radius={[0, 4, 4, 0]}>
                    {nrrDec.map((row, i) => (
                      <Cell key={i} fill={row.label.includes('Net') ? POSITIVE : row.v < 0 ? NEGATIVE : ACCENT} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-8">
          <Card title="NET REVENUE RETENTION BY COHORT" subtitle="Indexed to 100 at cohort start">
            <CohortGrid cohorts={cohorts} />
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide13Engagement: React.FC<DeckProps> = ({ data = {} }) => {
  const e = data.product_engagement || {} as any;
  const weekly = e.weekly_actives?.length ? e.weekly_actives :
    Array.from({ length: 16 }, (_, i) => ({ week: `W${i + 1}`, v: 1800 + i * 480 + Math.round(Math.random() * 220) }));
  const adoption = e.feature_adoption?.length ? e.feature_adoption :
    [{ feature: 'Workflow', pct: 96 }, { feature: 'Audit', pct: 88 }, { feature: 'Policy', pct: 74 }, { feature: 'LLM gate', pct: 62 }, { feature: 'Reports', pct: 58 }];
  const freq = e.session_frequency?.length ? e.session_frequency :
    [{ bucket: 'Daily',     share_pct: 42 }, { bucket: '3-5/wk', share_pct: 28 }, { bucket: '1-2/wk', share_pct: 18 }, { bucket: '<1/wk',  share_pct: 12 }];
  return (
    <SlideFrame index={12} total={32} company={data.company} subtitle="Usage · activation · adoption · frequency">
      <div className="grid grid-cols-4 gap-3">
        <KpiTile label="Activation" value={fmtPct(e.activation_rate_pct ?? 76)} delta="+8 pts QoQ" positive />
        <KpiTile label="Time-to-value" value={`${e.median_time_to_value_min ?? 9} min`} sublabel="median" />
        <KpiTile label="WAU / MAU" value="0.74" sublabel="stickiness" />
        <KpiTile label="Power users" value="38%" sublabel="≥ 5 sessions / wk" />
      </div>
      <div className="mt-3 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="WEEKLY ACTIVE USERS">
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={weekly}>
                  <defs>
                    <linearGradient id="wkl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT_2} stopOpacity="0.4" />
                      <stop offset="100%" stopColor={ACCENT_2} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="v" stroke={ACCENT_2} strokeWidth={2.5} fill="url(#wkl)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-5 grid grid-rows-2 gap-3">
          <Card title="FEATURE ADOPTION (% OF ACTIVE)">
            <div className="space-y-2 mt-1">
              {adoption.map((a: any, i: number) => (
                <div key={i}>
                  <div className="flex justify-between text-sm">
                    <span style={{ fontWeight: 600 }}>{a.feature}</span>
                    <span style={{ fontFamily: FONT_MONO, color: SUBTLE }}>{a.pct}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full" style={{ background: SURFACE_2 }}>
                    <div className="h-2 rounded-full" style={{ width: `${a.pct}%`, background: ACCENT, opacity: 1 - i * 0.12 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="SESSION FREQUENCY">
            <div style={{ width: '100%', height: 120 }}>
              <ResponsiveContainer>
                <BarChart data={freq}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Bar dataKey="share_pct" fill={ACCENT_3} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

// SECTION IV — GTM ──────────────────────────────────────────────

const Slide14GTM: React.FC<DeckProps> = ({ data = {} }) => {
  const motion = data.sales_motion?.length ? data.sales_motion : [
    { tier: 'SMB',         threshold: '< $20K ACV',        ratio: 'Self-serve · 1 PLG funnel' },
    { tier: 'Mid-market',  threshold: '$20K–$100K ACV',   ratio: '1 AE : 1 SDR : 1 CSM' },
    { tier: 'Enterprise',  threshold: '$100K+ ACV',        ratio: '1 AE : 2 SDR : 1 SE : 1 CSM' },
  ];
  const channels = data.acquisition_channels?.length ? data.acquisition_channels :
    [{ name: 'Inbound', share_pct: 38, cac_usd: 540, payback_months: 7 },
     { name: 'Partner', share_pct: 24, cac_usd: 420, payback_months: 5 },
     { name: 'Outbound', share_pct: 22, cac_usd: 1480, payback_months: 12 },
     { name: 'Community', share_pct: 10, cac_usd: 220, payback_months: 4 },
     { name: 'Events', share_pct: 6, cac_usd: 980, payback_months: 9 }];
  const pipeline = data.pipeline?.length ? data.pipeline : [
    { stage: 'Visitors',  v: 36000, conversion_pct: 100 },
    { stage: 'MQL',       v: 5400,  conversion_pct: 15 },
    { stage: 'SQL',       v: 1620,  conversion_pct: 30 },
    { stage: 'Opp',       v: 540,   conversion_pct: 33 },
    { stage: 'Closed',    v: 162,   conversion_pct: 30 },
  ];
  return (
    <SlideFrame index={13} total={32} company={data.company} subtitle="Motion · channels · funnel">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Multi-tier motion · diversified channels · improving efficiency.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-4">
          <Card title="SALES MOTION">
            <div className="space-y-3 mt-1">
              {motion.map((m, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
                  <div className="flex items-center justify-between">
                    <div style={{ fontWeight: 700, color: INK }}>{m.tier}</div>
                    <span style={{ fontSize: 10, color: ACCENT, fontWeight: 700, fontFamily: FONT_MONO, letterSpacing: 2 }}>{m.threshold}</span>
                  </div>
                  <div style={{ fontSize: 12, color: SUBTLE, marginTop: 4, fontFamily: FONT_MONO }}>{m.ratio}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-4">
          <Card title="CHANNEL MIX & EFFICIENCY">
            <div className="space-y-2 mt-1">
              {channels.map((c, i) => (
                <div key={i}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontFamily: FONT_MONO, color: SUBTLE }}>{c.share_pct}% · CAC {fmtUSD(c.cac_usd)} · {c.payback_months}mo</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full" style={{ background: SURFACE_2 }}>
                    <div className="h-2 rounded-full" style={{ width: `${c.share_pct}%`, background: ACCENT, opacity: 1 - i * 0.1 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-4">
          <Card title="ACQUISITION FUNNEL · LAST 90 DAYS">
            <div className="space-y-2.5 mt-1">
              {pipeline.map((s, i) => {
                const max = pipeline[0].v;
                return (
                  <div key={i}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span style={{ fontWeight: 600 }}>{s.stage}</span>
                      <span style={{ fontFamily: FONT_MONO, color: SUBTLE }}>
                        {fmtNum(s.v)}{s.conversion_pct != null && <span style={{ color: ACCENT, marginLeft: 6 }}>· {s.conversion_pct}%</span>}
                      </span>
                    </div>
                    <div className="mt-1 h-3 rounded-full" style={{ background: SURFACE_2 }}>
                      <div className="h-3 rounded-full" style={{ width: `${(s.v / max) * 100}%`, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_2})` }} />
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

const Slide15Efficiency: React.FC<DeckProps> = ({ data = {} }) => {
  const payback = data.cac_payback_curve?.length ? data.cac_payback_curve :
    [{ month: 'M1', recovered_pct: 12 }, { month: 'M3', recovered_pct: 38 },
     { month: 'M6', recovered_pct: 72 }, { month: 'M9', recovered_pct: 108 },
     { month: 'M12', recovered_pct: 144 }];
  const rep = data.rep_productivity?.length ? data.rep_productivity :
    [{ quarter: 'Q1', arr_per_rep: 280 }, { quarter: 'Q2', arr_per_rep: 340 },
     { quarter: 'Q3', arr_per_rep: 410 }, { quarter: 'Q4', arr_per_rep: 480 },
     { quarter: 'Q5', arr_per_rep: 560 }, { quarter: 'Q6', arr_per_rep: 620 }];
  return (
    <SlideFrame index={14} total={32} company={data.company} subtitle="CAC · payback · magic number · pipeline conversion">
      <div className="grid grid-cols-5 gap-3">
        <KpiTile label="CAC"               value={fmtUSD(data.cac_usd)}             delta="-14% QoQ" positive />
        <KpiTile label="CAC payback"        value={`${data.payback_months ?? '—'} mo`} delta="−2 mo YoY" positive />
        <KpiTile label="Magic number"       value={String(data.magic_number ?? '—')}  delta=">1.0 healthy" positive />
        <KpiTile label="Pipeline coverage" value="4.2×" delta="vs. 3.0× target" positive />
        <KpiTile label="Win rate"           value="32%" delta="+5 pts" positive />
      </div>
      <div className="mt-3 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="CAC PAYBACK CURVE" subtitle="Cumulative gross-margin recovery">
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={payback}>
                  <defs>
                    <linearGradient id="pay2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={POSITIVE} stopOpacity="0.4" />
                      <stop offset="100%" stopColor={POSITIVE} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <ReferenceLine y={100} stroke={ALERT} strokeDasharray="4 4" label={{ value: 'Payback', position: 'right', fill: ALERT, fontSize: 11 }} />
                  <Area type="monotone" dataKey="recovered_pct" stroke={POSITIVE} strokeWidth={3} fill="url(#pay2)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-5">
          <Card title="ARR PER QUOTA REP ($K)" subtitle="Sales productivity trending up-and-to-the-right">
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={rep}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Bar dataKey="arr_per_rep" fill={ACCENT} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide16Economics: React.FC<DeckProps> = ({ data = {} }) => {
  const margin = data.margin_trend?.length ? data.margin_trend :
    [{ quarter: 'Q1', gross_margin: 76, contribution_margin: 48 },
     { quarter: 'Q2', gross_margin: 78, contribution_margin: 52 },
     { quarter: 'Q3', gross_margin: 80, contribution_margin: 58 },
     { quarter: 'Q4', gross_margin: 82, contribution_margin: 62 },
     { quarter: 'Q5', gross_margin: 84, contribution_margin: 66 },
     { quarter: 'Q6', gross_margin: 85, contribution_margin: 70 }];
  return (
    <SlideFrame index={15} total={32} company={data.company} subtitle="LTV · margins · expansion · profitability">
      <div className="grid grid-cols-5 gap-3">
        <KpiTile label="LTV"                value={fmtUSD(data.ltv_usd)} delta="+28% YoY" positive />
        <KpiTile label="LTV / CAC"          value={String(data.ltv_cac ?? '—')} delta="target 3+" positive />
        <KpiTile label="Gross margin"       value={fmtPct(data.gross_margin_pct)} delta="+4 pts YoY" positive />
        <KpiTile label="Contribution margin" value="72%" delta="+8 pts YoY" positive />
        <KpiTile label="EBITDA margin"      value={fmtPct(data.ebitda_margin_pct)} delta="approaching positive" positive />
      </div>
      <div className="mt-3 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-8">
          <Card title="MARGIN TREND · 6 QUARTERS" subtitle="Gross vs contribution margin">
            <div style={{ width: '100%', height: 230 }}>
              <ResponsiveContainer>
                <LineChart data={margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis domain={[40, 100]} tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT_MONO, color: SUBTLE }} />
                  <Line type="monotone" dataKey="gross_margin"        stroke={ACCENT}    strokeWidth={3} dot={{ r: 4, fill: ACCENT }}    name="Gross margin" />
                  <Line type="monotone" dataKey="contribution_margin" stroke={POSITIVE} strokeWidth={3} dot={{ r: 4, fill: POSITIVE }} name="Contribution margin" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-4">
          <Card title="EXPANSION-REVENUE COMPOSITION">
            <div className="space-y-3 mt-1">
              {[
                { l: 'Seat expansion',     v: 52 },
                { l: 'Module upsell',      v: 28 },
                { l: 'Usage / consumption', v: 14 },
                { l: 'Enterprise upgrade', v: 6 },
              ].map((c, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm">
                    <span style={{ fontWeight: 600 }}>{c.l}</span>
                    <span style={{ fontFamily: FONT_MONO, color: SUBTLE }}>{c.v}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full" style={{ background: SURFACE_2 }}>
                    <div className="h-2 rounded-full" style={{ width: `${c.v}%`, background: ACCENT, opacity: 1 - i * 0.15 }} />
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

// SECTION V — DEFENSIBILITY ──────────────────────────────────────

const Slide17Competition: React.FC<DeckProps> = ({ data = {} }) => {
  const competitors = data.competitors?.length ? data.competitors :
    [{ name: 'Legacy A', x: 78, y: 25, size: 18 }, { name: 'Legacy B', x: 58, y: 32, size: 14 },
     { name: 'Point tool', x: 22, y: 70, size: 10 }, { name: 'Open source', x: 35, y: 45, size: 8 },
     { name: 'Us', x: 82, y: 86, size: 18, is_us: true }];
  const table = data.competitor_table?.length ? data.competitor_table :
    [{ name: 'Us',         product: 'Unified workflow + audit',     pricing: 'Per-seat + usage', scale: 'Best in class', verdict: 'Win' },
     { name: 'Legacy A',   product: 'Workflow only · siloed',       pricing: 'Per-seat',          scale: 'Mature',         verdict: 'Niche' },
     { name: 'Legacy B',   product: 'Audit only · point solution',  pricing: 'Enterprise',        scale: 'Mature',         verdict: 'Adjacent' },
     { name: 'Point tool', product: 'Single workflow',              pricing: 'Per-user',          scale: 'SMB',            verdict: 'Limited' },
     { name: 'Open source', product: 'Self-host · DIY',             pricing: 'Free',              scale: 'Small teams',    verdict: 'Floor' }];
  return (
    <SlideFrame index={16} total={32} company={data.company} subtitle="Market map · positioning · alternatives">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        The only platform delivering both depth and reach.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-6">
          <Card title="POSITIONING MAP">
            <PositioningMap competitors={competitors} axis_x={data.axis_x} axis_y={data.axis_y} />
          </Card>
        </div>
        <div className="col-span-6">
          <Card title="COMPETITOR MATRIX">
            <div className="overflow-hidden mt-2 rounded-lg" style={{ border: `1px solid ${HAIRLINE}` }}>
              <table className="w-full" style={{ fontSize: 12 }}>
                <thead>
                  <tr style={{ background: SURFACE_2, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 1.5 }}>
                    {['Name', 'Product', 'Pricing', 'Scale', 'Verdict'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left" style={{ fontWeight: 700, fontSize: 10 }}>{safeUpper(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((r, i) => {
                    const us = r.name === 'Us';
                    return (
                      <tr key={i} style={{ background: us ? '#EFF6FF' : i % 2 ? SURFACE : '#FFFFFF', borderTop: `1px solid ${HAIRLINE}` }}>
                        <td className="px-3 py-2" style={{ fontWeight: us ? 800 : 600, color: us ? ACCENT : INK }}>{r.name}</td>
                        <td className="px-3 py-2" style={{ color: INK }}>{r.product}</td>
                        <td className="px-3 py-2" style={{ color: SUBTLE, fontFamily: FONT_MONO }}>{r.pricing}</td>
                        <td className="px-3 py-2" style={{ color: SUBTLE, fontFamily: FONT_MONO }}>{r.scale}</td>
                        <td className="px-3 py-2" style={{ color: us ? POSITIVE : SUBTLE, fontWeight: us ? 800 : 500 }}>{r.verdict}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide18Moat: React.FC<DeckProps> = ({ data = {} }) => {
  const moats = data.moats?.length ? data.moats : [
    { kind: 'tech' as const,     title: 'Technology',   body: '18-month head start on architecture.',          metric: '7 patents filed' },
    { kind: 'data' as const,     title: 'Data',          body: 'Each customer trains the next prediction.',    metric: '12B events' },
    { kind: 'network' as const,  title: 'Network',       body: 'Cross-customer benchmarks unique to platform.', metric: '320+ logos' },
    { kind: 'distribution' as const, title: 'Distribution', body: 'Partner channel into the ICP.',              metric: '5 reseller deals' },
    { kind: 'brand' as const,    title: 'Brand',         body: 'Reference customer in every key vertical.',    metric: 'NPS 72' },
  ];
  return (
    <SlideFrame index={17} total={32} company={data.company} subtitle="Technology · data · network · distribution · brand">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Five moats compounding into a defensible platform.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-5">
          <Card title="MOAT MAP">
            <MoatPentagon moats={moats as any} />
          </Card>
        </div>
        <div className="col-span-7 grid grid-cols-1 gap-3">
          {moats.slice(0, 5).map((m, i) => (
            <Card key={i}>
              <div className="flex items-center justify-between">
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, fontWeight: 800, fontFamily: FONT_MONO }}>0{i + 1} · {safeUpper(m.kind)}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: INK, marginTop: 4 }}>{m.title}</div>
                  <div style={{ fontSize: 13, color: SUBTLE, marginTop: 4 }}>{m.body}</div>
                </div>
                {m.metric && (
                  <div style={{ fontSize: 18, fontWeight: 900, color: ACCENT, fontFamily: FONT_MONO, paddingLeft: 16, borderLeft: `1px solid ${HAIRLINE}`, lineHeight: 1 }}>{m.metric}</div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide19Strategic: React.FC<DeckProps> = ({ data = {} }) => {
  const advantages = data.strategic_advantages?.length ? data.strategic_advantages : [
    { title: 'Distribution partnerships',  body: 'Channel relationships with two top-tier global SIs.' },
    { title: 'Scale advantages',            body: 'Edge runtime → marginal cost approaches zero.' },
    { title: 'Execution advantages',        body: 'Founding team has shipped this category before.' },
    { title: 'Capital efficiency',          body: 'Reached $4M ARR on a $3.5M seed round.' },
  ];
  const partnerships = data.partnerships?.length ? data.partnerships : [
    { name: 'GSI Alpha', type: 'channel' as const }, { name: 'GSI Beta', type: 'channel' as const },
    { name: 'Cloud A', type: 'platform' as const }, { name: 'Cloud B', type: 'platform' as const },
    { name: 'Data X', type: 'data' as const }, { name: 'Data Y', type: 'data' as const },
    { name: 'Reseller Z', type: 'reseller' as const },
  ];
  const partnerColor = (t: string) => t === 'channel' ? ACCENT : t === 'platform' ? ACCENT_2 : t === 'data' ? ACCENT_3 : POSITIVE;
  return (
    <SlideFrame index={18} total={32} company={data.company} subtitle="Partnerships · scale · execution">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Advantages that compound — and that capital accelerates.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-7 grid grid-cols-2 gap-3">
          {advantages.slice(0, 4).map((a, i) => (
            <Card key={i}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: ACCENT, fontWeight: 800, fontFamily: FONT_MONO }}>0{i + 1}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: INK, marginTop: 4 }}>{a.title}</div>
              <div style={{ fontSize: 13, color: SUBTLE, marginTop: 6, lineHeight: 1.5 }}>{a.body}</div>
            </Card>
          ))}
        </div>
        <div className="col-span-5">
          <Card title="STRATEGIC PARTNERSHIPS">
            <div className="grid grid-cols-2 gap-2 mt-1">
              {partnerships.slice(0, 8).map((p, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: partnerColor(p.type) }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 1.5, textTransform: 'uppercase' }}>{p.type}</div>
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

// SECTION VI — ORG ──────────────────────────────────────────────

const Slide20Team: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const leaders = data.leaders?.length ? data.leaders : [
    { name: 'CEO', role: 'Co-founder', bio: 'Prior: led product at Stripe.', initials: 'CE' },
    { name: 'CTO', role: 'Co-founder', bio: 'Prior: principal eng at Linear.', initials: 'CT' },
    { name: 'CRO', role: 'Series A hire',  bio: 'Built $0→$80M ARR at Snowflake.', initials: 'CR' },
    { name: 'VP Eng', role: 'ex-Datadog', bio: 'Scaled infra to 100M+ events/day.', initials: 'VE' },
    { name: 'VP Product', role: 'ex-Figma', bio: 'Led 0→1 design systems platform.', initials: 'VP' },
    { name: 'CFO', role: 'ex-Atlassian',   bio: 'IPO + post-IPO operator.',          initials: 'CF' },
  ];
  const hiring = data.hiring_plan?.length ? data.hiring_plan : [
    { dept: 'Engineering',     current: 28, target: 52 },
    { dept: 'GTM',             current: 18, target: 44 },
    { dept: 'Customer success', current: 8,  target: 18 },
    { dept: 'Product / Design', current: 9,  target: 16 },
    { dept: 'Ops + G&A',        current: 7,  target: 14 },
  ];
  const org = data.org_split?.length ? data.org_split :
    [{ dept: 'Engineering', current_pct: 38 }, { dept: 'GTM', current_pct: 26 }, { dept: 'Customer success', current_pct: 12 }, { dept: 'Product / Design', current_pct: 14 }, { dept: 'Ops + G&A', current_pct: 10 }];
  return (
    <SlideFrame index={19} total={32} company={data.company} subtitle="Leadership · hiring · org structure">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Operators who scaled comparable companies.
      </h2>
      <div className="mt-5 grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-7">
          <Card title="LEADERSHIP TEAM">
            <div className="grid grid-cols-3 gap-3 mt-1">
              {leaders.slice(0, 6).map((l, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
                  <div className="flex items-center gap-3">
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: ACCENT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, fontFamily: FONT_MONO }}>
                      {l.initials || safeUpper(l.name?.slice(0, 2))}
                    </div>
                    <div>
                      <Editable as="div" value={l.name} path={`leaders.${i}.name`} editable={editable} onEdit={onEdit}
                        style={{ fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.1 }} />
                      <div style={{ fontSize: 10, color: ACCENT, fontFamily: FONT_MONO, marginTop: 2, letterSpacing: 1 }}>{safeUpper(l.role)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: SUBTLE, marginTop: 8, lineHeight: 1.45 }}>{l.bio}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-5 grid grid-rows-2 gap-3">
          <Card title="HIRING PLAN · 24 MO">
            <div style={{ width: '100%', height: 130 }}>
              <ResponsiveContainer>
                <BarChart data={hiring}>
                  <XAxis dataKey="dept" tick={{ fontSize: 9, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} interval={0} angle={-12} dy={6} />
                  <YAxis tick={{ fontSize: 10, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="current" fill={FAINT} radius={[4, 4, 0, 0]} name="Today" />
                  <Bar dataKey="target" fill={ACCENT} radius={[4, 4, 0, 0]} name="24-mo target" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="ORG MIX TODAY">
            <div style={{ width: '100%', height: 130 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={org} dataKey="current_pct" nameKey="dept" innerRadius={28} outerRadius={56} paddingAngle={2}>
                    {org.map((_, i) => (
                      <Cell key={i} fill={[ACCENT, ACCENT_2, ACCENT_3, POSITIVE, ALERT][i % 5]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: FONT_MONO, color: SUBTLE }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const Slide21Ops: React.FC<DeckProps> = ({ data = {} }) => {
  const kpis = data.operational_kpis?.length ? data.operational_kpis : [
    { label: 'SLA uptime',           value: '99.97%', target: '99.95%' },
    { label: 'P95 latency',           value: '180 ms', target: '< 250 ms' },
    { label: 'Support response (P1)', value: '12 min',  target: '< 30 min' },
    { label: 'Deploy frequency',      value: '14 / wk', target: '> 10 / wk' },
    { label: 'Onboarding TTV',        value: '9 min',   target: '< 15 min' },
    { label: 'NPS',                   value: '72',      target: '> 50' },
  ];
  return (
    <SlideFrame index={20} total={32} company={data.company} subtitle="KPIs · processes · execution systems">
      <h2 style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', fontWeight: 800, letterSpacing: -1, color: INK }}>
        Operating maturity ahead of stage.
      </h2>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {kpis.slice(0, 6).map((k, i) => (
          <Card key={i}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: SUBTLE, fontFamily: FONT_MONO }}>{safeUpper(k.label)}</div>
            <div className="flex items-baseline justify-between mt-2">
              <div style={{ fontSize: 'clamp(26px, 2.6vw, 40px)', fontWeight: 900, color: INK, letterSpacing: -1, lineHeight: 1 }}>{k.value}</div>
              {k.target && (
                <div style={{ fontSize: 11, color: SUBTLE, fontFamily: FONT_MONO }}>target {k.target}</div>
              )}
            </div>
            <div className="mt-2 h-1.5 rounded-full" style={{ background: POSITIVE }} />
          </Card>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 flex-1 min-h-0">
        <Card title="WEEKLY BUSINESS REVIEW">
          <ul className="mt-2 text-sm space-y-2" style={{ color: INK }}>
            <li>· Mon: pipeline · forecast call</li>
            <li>· Tue: product · platform review</li>
            <li>· Wed: customer · CS / churn</li>
            <li>· Thu: ops · KPIs · roadmap</li>
            <li>· Fri: cash · hiring · all-hands</li>
          </ul>
        </Card>
        <Card title="EXECUTION SYSTEMS">
          <ul className="mt-2 text-sm space-y-2" style={{ color: INK }}>
            <li>· OKR cadence (quarterly)</li>
            <li>· Weekly executive scorecard</li>
            <li>· On-call rotation + DLQ ops</li>
            <li>· Quarterly board memo</li>
            <li>· Incident post-mortems &lt;5 d</li>
          </ul>
        </Card>
        <Card title="DATA / DECISION STACK">
          <ul className="mt-2 text-sm space-y-2" style={{ color: INK }}>
            <li>· Warehouse: native · stage-prod parity</li>
            <li>· Analytics: real-time KPI dashboard</li>
            <li>· Experimentation: weekly tests</li>
            <li>· Pricing committee monthly</li>
            <li>· Talent reviews biannual</li>
          </ul>
        </Card>
      </div>
    </SlideFrame>
  );
};

// SECTION VII — INVESTMENT ───────────────────────────────────────

const Slide22Fundraise: React.FC<DeckProps> = ({ data = {}, editable, onEdit }) => {
  const uof = data.use_of_funds?.length ? data.use_of_funds : [
    { label: 'Engineering', pct: 38, subuses: ['Platform layers · 22', 'Reliability · 8', 'Security · 8'] },
    { label: 'GTM',         pct: 32, subuses: ['Enterprise AE · 16', 'Inside sales · 8', 'Marketing · 8'] },
    { label: 'CS + Services', pct: 12, subuses: ['Onboarding · 6', 'Renewal · 6'] },
    { label: 'Ops + Infra',  pct: 10, subuses: ['Edge spend · 4', 'Tooling · 3', 'Data · 3'] },
    { label: 'Reserve',      pct: 8 },
  ];
  const milestones = data.milestones?.length ? data.milestones : [
    { quarter: 'Now',    goal: 'Live · 320+ logos', metric: '$8M ARR' },
    { quarter: '+6 mo',  goal: 'Repeatable enterprise motion', metric: '$18M ARR' },
    { quarter: '+12 mo', goal: 'Adjacent workflow shipped', metric: '$40M ARR' },
    { quarter: '+24 mo', goal: 'Category leader', metric: '$90M ARR' },
  ];
  const scenarios = data.return_scenarios?.length ? data.return_scenarios : [
    { case: 'Base',     arr_y3: 60_000_000,  multiple: '3.0×' },
    { case: 'Upside',   arr_y3: 110_000_000, multiple: '5.5×' },
    { case: 'Outlier',  arr_y3: 220_000_000, multiple: '12.0×' },
  ];
  return (
    <SlideFrame index={21} total={32} company={data.company} subtitle="Round · use of proceeds · milestones · return" bg={INK} ink={PAPER}>
      <div className="grid grid-cols-12 gap-5 h-full">
        <div className="col-span-7 flex flex-col">
          <div style={{ fontSize: 11, letterSpacing: 4, color: ACCENT_2, fontWeight: 700, fontFamily: FONT_MONO }}>RAISING SERIES B</div>
          <Editable value={fmtUSD(data.ask_amount_usd)} path="ask_amount_usd" editable={editable} onEdit={onEdit}
            style={{ fontSize: 'clamp(72px, 9vw, 168px)', fontWeight: 900, letterSpacing: -5, lineHeight: 0.95, color: PAPER, marginTop: 6 }} />
          <Editable value={data.closing_line} path="closing_line" editable={editable} onEdit={onEdit}
            placeholder="One memorable closing line — the world that becomes true with this round."
            style={{ fontSize: 'clamp(15px, 1.4vw, 22px)', color: '#CBD5E1', marginTop: 20, maxWidth: 760, lineHeight: 1.45 }} />
          <div className="mt-5 grid grid-cols-3 gap-3">
            <Card style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: PAPER }}>
              <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 2, fontFamily: FONT_MONO }}>CURRENT ARR</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: ACCENT_2 }}>{fmtUSD(data.arr_usd)}</div>
            </Card>
            <Card style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: PAPER }}>
              <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 2, fontFamily: FONT_MONO }}>POST-RAISE RUNWAY</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: PAPER }}>{data.post_raise_runway_months ?? 30} <span style={{ fontSize: 13, color: '#94A3B8' }}>mo</span></div>
            </Card>
            <Card style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: PAPER }}>
              <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 2, fontFamily: FONT_MONO }}>CONTACT</div>
              <Editable value={data.contact} path="contact" editable={editable} onEdit={onEdit}
                placeholder="founders@company.com" style={{ fontSize: 13, fontWeight: 700, marginTop: 8, color: PAPER, fontFamily: FONT_MONO }} />
            </Card>
          </div>

          <div className="mt-auto pt-5">
            <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: 3, fontFamily: FONT_MONO, marginBottom: 8 }}>MILESTONES POST-RAISE</div>
            <div className="relative">
              <div className="absolute left-0 right-0 top-3 h-px" style={{ background: 'rgba(255,255,255,0.15)' }} />
              <div className="grid grid-cols-4 gap-3">
                {milestones.slice(0, 4).map((m, i) => (
                  <div key={i} className="relative pt-7">
                    <span className="absolute left-1/2 -translate-x-1/2 top-1 w-3 h-3 rounded-full" style={{ background: ACCENT_2 }} />
                    <div style={{ fontSize: 10, color: ACCENT_2, letterSpacing: 2, fontFamily: FONT_MONO, fontWeight: 700, textAlign: 'center' }}>{safeUpper(m.quarter)}</div>
                    <div style={{ fontSize: 12, color: PAPER, marginTop: 4, textAlign: 'center', lineHeight: 1.3 }}>{m.goal}</div>
                    {m.metric && <div style={{ fontSize: 11, color: ACCENT_2, marginTop: 2, textAlign: 'center', fontFamily: FONT_MONO, fontWeight: 700 }}>{m.metric}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-5 grid grid-rows-2 gap-3">
          <Card title="USE OF FUNDS" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: PAPER }}>
            <div className="space-y-2 mt-1">
              {uof.map((u, i) => (
                <div key={i}>
                  <div className="flex justify-between" style={{ fontSize: 12 }}>
                    <span style={{ color: PAPER, fontWeight: 700, fontSize: 13 }}>{u.label}</span>
                    <span style={{ color: ACCENT_2, fontFamily: FONT_MONO, fontWeight: 700 }}>{u.pct}%</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    <div className="h-2 rounded-full" style={{ width: `${u.pct}%`, background: [ACCENT, ACCENT_2, ACCENT_3, POSITIVE, ALERT][i % 5] }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="RETURN SCENARIOS · YEAR 3 ARR · TVPI" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: PAPER }}>
            <div className="space-y-3 mt-1">
              {scenarios.map((s, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex justify-between items-baseline">
                    <span style={{ fontSize: 12, color: '#94A3B8', fontFamily: FONT_MONO, letterSpacing: 2 }}>{safeUpper(s.case)}</span>
                    <span style={{ fontSize: 14, color: ACCENT_2, fontWeight: 800, fontFamily: FONT_MONO }}>{s.multiple}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: PAPER }}>{fmtUSD(s.arr_y3)} ARR</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

// ─────────────────────────────────────────────────────────────────
// APPENDIX — 10 slides
// ─────────────────────────────────────────────────────────────────

const A1Financials: React.FC<DeckProps> = ({ data = {} }) => {
  const fs = data.financial_statements || {};
  const rev = fs.revenue_quarterly?.length ? fs.revenue_quarterly :
    Array.from({ length: 8 }, (_, i) => ({ q: `Q${i + 1}`, recurring: 400 + i * 320, non_recurring: 40 + i * 20 }));
  const exp = fs.expense_quarterly?.length ? fs.expense_quarterly :
    Array.from({ length: 8 }, (_, i) => ({ q: `Q${i + 1}`, r_and_d: 220 + i * 140, s_and_m: 180 + i * 180, g_and_a: 80 + i * 40 }));
  const margin = fs.margin_quarterly?.length ? fs.margin_quarterly :
    Array.from({ length: 8 }, (_, i) => ({ q: `Q${i + 1}`, gross: 72 + i, ebitda: -42 + i * 4 }));
  const cash = fs.cash_position?.length ? fs.cash_position :
    Array.from({ length: 8 }, (_, i) => ({ q: `Q${i + 1}`, cash: 12000 - i * 1100, runway_mo: 22 - i }));
  return (
    <SlideFrame index={APPENDIX_OFFSET + 0} total={32} company={data.company} subtitle="P&L · margins · cash">
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-6">
          <Card title="REVENUE BY QUARTER ($K)">
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={rev}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="q" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT_MONO, color: SUBTLE }} />
                  <Bar dataKey="recurring"    stackId="r" fill={ACCENT}   name="Recurring" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="non_recurring" stackId="r" fill={ACCENT_2} name="Non-recurring" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-6">
          <Card title="OPEX BY QUARTER ($K)">
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={exp}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="q" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT_MONO, color: SUBTLE }} />
                  <Bar dataKey="r_and_d" stackId="o" fill={ACCENT}    name="R&D" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="s_and_m" stackId="o" fill={ACCENT_3} name="S&M" />
                  <Bar dataKey="g_and_a" stackId="o" fill={ACCENT_2} name="G&A" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-6">
          <Card title="MARGINS (%)">
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <LineChart data={margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="q" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT_MONO, color: SUBTLE }} />
                  <ReferenceLine y={0} stroke={NEGATIVE} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="gross"   stroke={POSITIVE} strokeWidth={3} dot={false} name="Gross" />
                  <Line type="monotone" dataKey="ebitda" stroke={ALERT}    strokeWidth={3} dot={false} name="EBITDA" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-6">
          <Card title="CASH POSITION ($K) + RUNWAY (MO)">
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <ComposedChart data={cash}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="q" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis yAxisId="L" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT_MONO, color: SUBTLE }} />
                  <Bar yAxisId="L" dataKey="cash" fill={ACCENT} name="Cash" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="R" type="monotone" dataKey="runway_mo" stroke={POSITIVE} strokeWidth={3} dot={false} name="Runway (mo)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const A2Cohorts: React.FC<DeckProps> = ({ data = {} }) => {
  const cohorts = data.revenue_cohorts?.length ? data.revenue_cohorts : [
    { cohort: '2024 Q1', m0: 100, m3: 108, m6: 124, m12: 152, m18: 174, m24: 198 },
    { cohort: '2024 Q2', m0: 100, m3: 110, m6: 128, m12: 158, m18: 184, m24: 0 },
    { cohort: '2024 Q3', m0: 100, m3: 112, m6: 134, m12: 162, m18: 0,   m24: 0 },
    { cohort: '2024 Q4', m0: 100, m3: 114, m6: 138, m12: 0,   m18: 0,   m24: 0 },
    { cohort: '2025 Q1', m0: 100, m3: 116, m6: 140, m12: 0,   m18: 0,   m24: 0 },
    { cohort: '2025 Q2', m0: 100, m3: 118, m6: 0,   m12: 0,   m18: 0,   m24: 0 },
  ];
  const grid = cohorts.map((c) => ({
    cohort: c.cohort,
    values: [c.m0, c.m3, c.m6, c.m12, c.m18, c.m24].filter((v) => v > 0),
  }));
  return (
    <SlideFrame index={APPENDIX_OFFSET + 1} total={32} company={data.company} subtitle="Monthly cohorts · expansion · retention">
      <Card title="REVENUE COHORT TABLE · INDEXED TO 100 AT M0">
        <CohortGrid cohorts={grid} periodLabels={['M0', 'M3', 'M6', 'M12', 'M18', 'M24']} />
      </Card>
      <div className="mt-3 grid grid-cols-3 gap-3 flex-1 min-h-0">
        <Card title="OBSERVATION 01">
          <div style={{ fontSize: 14, color: INK, lineHeight: 1.5 }}>
            Every cohort has expanded net by ≥ 24% within 6 months — consistent across vintages.
          </div>
        </Card>
        <Card title="OBSERVATION 02">
          <div style={{ fontSize: 14, color: INK, lineHeight: 1.5 }}>
            Newer cohorts expand <strong>faster</strong> than older ones — proof of improving product / motion fit.
          </div>
        </Card>
        <Card title="OBSERVATION 03">
          <div style={{ fontSize: 14, color: INK, lineHeight: 1.5 }}>
            Mature cohorts (24 mo) approach 200% — long-tail NRR remains best-in-class.
          </div>
        </Card>
      </div>
    </SlideFrame>
  );
};

const A3Segmentation: React.FC<DeckProps> = ({ data = {} }) => {
  const d = data.customer_seg_detail || {};
  const ent = d.enterprise || { count: 24,  avg_acv: 248_000, logo_retention_pct: 98, nrr_pct: 138 };
  const mid = d.midmarket  || { count: 88,  avg_acv: 56_000,  logo_retention_pct: 96, nrr_pct: 124 };
  const smb = d.smb        || { count: 248, avg_acv: 12_000,  logo_retention_pct: 92, nrr_pct: 110 };
  const geo = d.geo?.length ? d.geo : [
    { region: 'United States', count: 220, arr_usd: 4_800_000 },
    { region: 'Europe',         count: 96,  arr_usd: 1_950_000 },
    { region: 'APAC',           count: 32,  arr_usd: 720_000 },
    { region: 'LATAM',          count: 12,  arr_usd: 180_000 },
  ];
  return (
    <SlideFrame index={APPENDIX_OFFSET + 2} total={32} company={data.company} subtitle="Enterprise · mid-market · SMB · geography">
      <div className="grid grid-cols-3 gap-3">
        {[
          { l: 'Enterprise', d: ent, color: ACCENT },
          { l: 'Mid-market', d: mid, color: ACCENT_2 },
          { l: 'SMB',        d: smb, color: ACCENT_3 },
        ].map((s, i) => (
          <Card key={i} style={{ borderColor: s.color }}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: s.color, fontWeight: 800, fontFamily: FONT_MONO }}>{safeUpper(s.l)}</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: INK, marginTop: 6 }}>{fmtNum(s.d.count)}</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <div style={{ fontSize: 10, color: SUBTLE, fontFamily: FONT_MONO }}>AVG ACV</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{fmtUSD(s.d.avg_acv)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: SUBTLE, fontFamily: FONT_MONO }}>LOGO RET</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: POSITIVE }}>{s.d.logo_retention_pct}%</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: SUBTLE, fontFamily: FONT_MONO }}>NRR</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: ACCENT }}>{s.d.nrr_pct}%</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-3 flex-1 min-h-0">
        <Card title="GEOGRAPHIC BREAKDOWN">
          <div className="overflow-hidden mt-2 rounded-lg" style={{ border: `1px solid ${HAIRLINE}` }}>
            <table className="w-full" style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ background: SURFACE_2, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 1.5 }}>
                  {['Region', 'Customers', 'ARR', 'Share'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left" style={{ fontWeight: 700, fontSize: 10 }}>{safeUpper(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {geo.map((r, i) => {
                  const total = geo.reduce((acc, g) => acc + g.arr_usd, 0);
                  return (
                    <tr key={i} style={{ background: i % 2 ? SURFACE : '#FFFFFF', borderTop: `1px solid ${HAIRLINE}` }}>
                      <td className="px-4 py-2" style={{ fontWeight: 700 }}>{r.region}</td>
                      <td className="px-4 py-2" style={{ fontFamily: FONT_MONO }}>{fmtNum(r.count)}</td>
                      <td className="px-4 py-2" style={{ fontFamily: FONT_MONO, fontWeight: 700 }}>{fmtUSD(r.arr_usd)}</td>
                      <td className="px-4 py-2" style={{ fontFamily: FONT_MONO, color: ACCENT, fontWeight: 700 }}>{Math.round((r.arr_usd / total) * 100)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </SlideFrame>
  );
};

const A4Funnel: React.FC<DeckProps> = ({ data = {} }) => {
  const detail = data.funnel_detail?.length ? data.funnel_detail : [
    { stage: 'Lead',        v: 36000, conversion_pct: 100, cycle_days: 0 },
    { stage: 'MQL',         v: 5400,  conversion_pct: 15,  cycle_days: 14 },
    { stage: 'SQL',         v: 1620,  conversion_pct: 30,  cycle_days: 28 },
    { stage: 'Opportunity', v: 540,   conversion_pct: 33,  cycle_days: 52 },
    { stage: 'Closed Won',  v: 162,   conversion_pct: 30,  cycle_days: 78 },
  ];
  return (
    <SlideFrame index={APPENDIX_OFFSET + 3} total={32} company={data.company} subtitle="Lead → MQL → SQL → Opportunity → Closed">
      <Card title="FULL FUNNEL · LAST 90 DAYS">
        <div className="overflow-hidden mt-2 rounded-lg" style={{ border: `1px solid ${HAIRLINE}` }}>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr style={{ background: SURFACE_2, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 1.5 }}>
                {['Stage', 'Volume', 'Conversion', 'Avg cycle (days)'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left" style={{ fontWeight: 700, fontSize: 10 }}>{safeUpper(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.map((r, i) => {
                const max = detail[0].v;
                return (
                  <tr key={i} style={{ background: i === detail.length - 1 ? '#ECFDF5' : i % 2 ? SURFACE : '#FFFFFF', borderTop: `1px solid ${HAIRLINE}` }}>
                    <td className="px-4 py-2" style={{ fontWeight: 700 }}>{r.stage}</td>
                    <td className="px-4 py-2" style={{ fontFamily: FONT_MONO }}>
                      <div className="flex items-center gap-3">
                        <span style={{ minWidth: 64 }}>{fmtNum(r.v)}</span>
                        <div style={{ flex: 1, height: 8, background: SURFACE_2, borderRadius: 99 }}>
                          <div style={{ width: `${(r.v / max) * 100}%`, height: 8, borderRadius: 99, background: i === detail.length - 1 ? POSITIVE : ACCENT }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2" style={{ fontFamily: FONT_MONO, fontWeight: 700, color: ACCENT }}>{r.conversion_pct}%</td>
                    <td className="px-4 py-2" style={{ fontFamily: FONT_MONO }}>{r.cycle_days}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="mt-3 grid grid-cols-4 gap-3 flex-1 min-h-0">
        <KpiTile label="MQL → SQL"   value="30%"   delta="+5 pts" positive />
        <KpiTile label="SQL → Opp"   value="33%"   delta="+3 pts" positive />
        <KpiTile label="Win rate"     value="30%"  delta="+5 pts" positive />
        <KpiTile label="Cycle time"   value="78 d"  delta="-12 d" positive />
      </div>
    </SlideFrame>
  );
};

const A5Pricing: React.FC<DeckProps> = ({ data = {} }) => {
  const plans = data.pricing_plans?.length ? data.pricing_plans : [
    { name: 'Team',       price: '$48 / seat / mo', seats: '5–25',   modules: ['Workflow', 'Audit'],            target: 'SMB' },
    { name: 'Business',   price: '$96 / seat / mo', seats: '25–250', modules: ['Workflow', 'Audit', 'Policy', 'Integrations'], target: 'Mid-market' },
    { name: 'Enterprise', price: 'Custom · Annual', seats: '250+',   modules: ['Everything', 'SSO/SCIM', 'Dedicated infra', 'EU residency'], target: 'Enterprise' },
  ];
  return (
    <SlideFrame index={APPENDIX_OFFSET + 4} total={32} company={data.company} subtitle="Plans · packaging · expansion mechanics">
      <div className="grid grid-cols-3 gap-3">
        {plans.map((p, i) => (
          <Card key={i} accent={i === 1}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: i === 1 ? 'rgba(255,255,255,0.85)' : ACCENT, fontWeight: 800, fontFamily: FONT_MONO }}>
              {safeUpper(p.name)}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>{p.price}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: i === 1 ? 'rgba(255,255,255,0.85)' : SUBTLE }}>Seats {p.seats} · {p.target}</div>
            <div className="mt-4 space-y-2">
              {p.modules.map((m, j) => (
                <div key={j} className="flex items-center gap-2" style={{ fontSize: 13, color: i === 1 ? '#FFFFFF' : INK }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: i === 1 ? '#FFFFFF' : ACCENT }} />
                  {m}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 flex-1 min-h-0">
        <Card title="EXPANSION MECHANIC 01">
          <div style={{ fontSize: 14, color: INK, lineHeight: 1.5 }}>
            <strong>Seat expansion.</strong> Land single team → expand to 4× seats within 12 months on average.
          </div>
        </Card>
        <Card title="EXPANSION MECHANIC 02">
          <div style={{ fontSize: 14, color: INK, lineHeight: 1.5 }}>
            <strong>Module unlock.</strong> Audit and Policy each add ~30% ARR per customer.
          </div>
        </Card>
        <Card title="EXPANSION MECHANIC 03">
          <div style={{ fontSize: 14, color: INK, lineHeight: 1.5 }}>
            <strong>Usage tier.</strong> Volume-based pricing on workflow events captures peak demand without negotiation.
          </div>
        </Card>
      </div>
    </SlideFrame>
  );
};

const A6Architecture: React.FC<DeckProps> = ({ data = {} }) => {
  const arch = data.architecture_detail?.length ? data.architecture_detail : [
    { layer: 'Edge',         nodes: ['Workers', 'Smart placement', 'Cf Access', 'WAF'] },
    { layer: 'Application',  nodes: ['Workflow engine', 'Policy DSL', 'LLM gateway', 'API SDK'] },
    { layer: 'Data',         nodes: ['D1 (OLTP)', 'R2 (objects)', 'Vectorize (embeddings)', 'Analytics Engine'] },
    { layer: 'Integrations', nodes: ['CRM', 'ERP', 'Data warehouse', 'Webhook bus'] },
    { layer: 'Observability', nodes: ['Tail Workers', 'Logs to R2', 'Tracing', 'DLQ'] },
  ];
  return (
    <SlideFrame index={APPENDIX_OFFSET + 5} total={32} company={data.company} subtitle="Detailed infrastructure">
      <Card title="ARCHITECTURE RACK">
        <ArchitectureRack layers={arch} />
      </Card>
      <div className="mt-3 grid grid-cols-3 gap-3 flex-1 min-h-0">
        <Card title="SCALABILITY">
          <ul className="mt-1 text-sm space-y-1.5">
            <li>· Edge runtime → no cold starts</li>
            <li>· Horizontal scaling in seconds</li>
            <li>· 99.97% uptime · multi-region</li>
            <li>· P95 latency &lt; 200ms global</li>
          </ul>
        </Card>
        <Card title="EXTENSIBILITY">
          <ul className="mt-1 text-sm space-y-1.5">
            <li>· Plugin runtime per workspace</li>
            <li>· Public + private SDK</li>
            <li>· Connector framework</li>
            <li>· Custom workflow DSL</li>
          </ul>
        </Card>
        <Card title="RESILIENCE">
          <ul className="mt-1 text-sm space-y-1.5">
            <li>· Dead-letter queue on every job</li>
            <li>· Replayable audit trail</li>
            <li>· Backups · 7-year retention</li>
            <li>· Disaster recovery RTO &lt; 4h</li>
          </ul>
        </Card>
      </div>
    </SlideFrame>
  );
};

const A7Security: React.FC<DeckProps> = ({ data = {} }) => {
  const s = data.security_compliance || {};
  const certs = s.certifications?.length ? s.certifications : ['SOC 2 Type II', 'ISO 27001', 'GDPR', 'CCPA', 'HIPAA-ready'];
  const frameworks = s.frameworks?.length ? s.frameworks : ['NIST 800-53', 'CSA STAR', 'OWASP ASVS L2'];
  const controls = s.controls?.length ? s.controls : [
    { area: 'Identity',  items: ['SSO/SAML/SCIM', 'Per-route Cf Access', 'TOTP + Passkey + SMS', 'Step-up auth on sensitive routes'] },
    { area: 'Data',       items: ['Column-level AES-GCM', 'R2 object lock · 7yr', 'Per-tenant KEK rotation', 'GDPR data export'] },
    { area: 'Application', items: ['CSP + nonce', 'HSTS preload', 'CodeQL + Dependabot', 'Gitleaks pre-commit'] },
    { area: 'Operations',  items: ['Audit log streaming to R2', 'On-call rotation', 'Incident playbook + post-mortems', 'Quarterly tabletop'] },
  ];
  return (
    <SlideFrame index={APPENDIX_OFFSET + 6} total={32} company={data.company} subtitle="Policies · frameworks · certifications">
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-4 grid grid-rows-2 gap-3">
          <Card title="CERTIFICATIONS">
            <div className="flex flex-wrap gap-2 mt-1">
              {certs.map((c, i) => (
                <span key={i} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 999, background: ACCENT, color: '#FFFFFF', fontWeight: 700 }}>{c}</span>
              ))}
            </div>
          </Card>
          <Card title="FRAMEWORKS">
            <div className="flex flex-wrap gap-2 mt-1">
              {frameworks.map((f, i) => (
                <span key={i} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 999, background: SURFACE, border: `1px solid ${HAIRLINE}`, color: INK, fontWeight: 600 }}>{f}</span>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-8 grid grid-cols-2 gap-3">
          {controls.map((c, i) => (
            <Card key={i} title={safeUpper(c.area)}>
              <ul className="mt-1 space-y-1.5">
                {c.items.map((it, j) => (
                  <li key={j} className="flex items-start gap-2" style={{ fontSize: 13, color: INK }}>
                    <span style={{ color: POSITIVE, fontWeight: 800 }}>✓</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </SlideFrame>
  );
};

const A8Risks: React.FC<DeckProps> = ({ data = {} }) => {
  const risks = data.risks?.length ? data.risks : [
    { category: 'technical' as const,   title: 'Edge runtime ceiling',         mitigation: 'Hybrid placement option; gradual migration plan',    severity: 'low' as const },
    { category: 'market' as const,      title: 'Category compression',         mitigation: 'Two adjacent workflow expansions in roadmap',         severity: 'med' as const },
    { category: 'operational' as const, title: 'Key-person dependency · CTO',  mitigation: 'Hiring VP Eng · co-deputy for critical decisions',    severity: 'med' as const },
    { category: 'regulatory' as const,  title: 'EU AI Act enforcement',         mitigation: 'EU residency live · DPIA on file · gating LLM outputs', severity: 'low' as const },
    { category: 'technical' as const,   title: 'Third-party LLM cost spikes',  mitigation: 'Multi-provider router · prompt cache · budget caps',  severity: 'low' as const },
    { category: 'market' as const,      title: 'Hyperscaler enters category',  mitigation: 'Distribution moat · data moat · 18-mo head start',    severity: 'high' as const },
  ];
  const sevColor = (s?: string) => s === 'high' ? NEGATIVE : s === 'med' ? ALERT : POSITIVE;
  return (
    <SlideFrame index={APPENDIX_OFFSET + 7} total={32} company={data.company} subtitle="Technical · market · operational · regulatory">
      <Card title="RISK REGISTER">
        <div className="overflow-hidden mt-2 rounded-lg" style={{ border: `1px solid ${HAIRLINE}` }}>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr style={{ background: SURFACE_2, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 1.5 }}>
                {['Category', 'Risk', 'Mitigation', 'Severity'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left" style={{ fontWeight: 700, fontSize: 10 }}>{safeUpper(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {risks.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? SURFACE : '#FFFFFF', borderTop: `1px solid ${HAIRLINE}` }}>
                  <td className="px-4 py-2" style={{ fontFamily: FONT_MONO, letterSpacing: 1.5, color: ACCENT, fontWeight: 700, fontSize: 11 }}>{safeUpper(r.category)}</td>
                  <td className="px-4 py-2" style={{ fontWeight: 700, color: INK }}>{r.title}</td>
                  <td className="px-4 py-2" style={{ color: SUBTLE }}>{r.mitigation}</td>
                  <td className="px-4 py-2">
                    <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, background: sevColor(r.severity), color: '#FFFFFF', fontWeight: 700, fontSize: 11, fontFamily: FONT_MONO, letterSpacing: 1.5 }}>
                      {(r.severity || 'low').toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </SlideFrame>
  );
};

const A9Governance: React.FC<DeckProps> = ({ data = {} }) => {
  const g = data.governance || {};
  const board = g.board?.length ? g.board : [
    { name: '[CEO]',         role: 'Founder',                       affiliation: 'Common',         initials: 'CE' },
    { name: '[Lead investor]', role: 'Board member',                affiliation: 'Series A',       initials: 'LI' },
    { name: '[Independent]',  role: 'Board member',                 affiliation: 'Independent',    initials: 'ID' },
    { name: '[New BoD]',      role: 'Series B nominee',              affiliation: 'New round',     initials: 'NB' },
  ];
  const investors = g.investors?.length ? g.investors : [
    { name: '[Seed lead]',     round: 'Seed · 2024' },
    { name: '[Series A lead]', round: 'Series A · 2025' },
    { name: '[Strategic]',     round: 'Series A · 2025' },
    { name: '[Series B lead]', round: 'Series B · 2026' },
  ];
  const advisors = g.advisors?.length ? g.advisors : [
    { name: '[Advisor 1]', expertise: 'GTM · enterprise sales' },
    { name: '[Advisor 2]', expertise: 'Compliance · audit' },
    { name: '[Advisor 3]', expertise: 'Platform · infra' },
  ];
  return (
    <SlideFrame index={APPENDIX_OFFSET + 8} total={32} company={data.company} subtitle="Board · investors · advisors">
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-6">
          <Card title="BOARD OF DIRECTORS">
            <div className="grid grid-cols-2 gap-3 mt-1">
              {board.slice(0, 6).map((b, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: ACCENT, color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, fontFamily: FONT_MONO }}>
                    {b.initials || safeUpper(b.name?.slice(0, 2))}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 1 }}>{safeUpper(b.role)} · {safeUpper(b.affiliation)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-3">
          <Card title="INVESTORS">
            <ul className="mt-1 space-y-2.5">
              {investors.map((iv, i) => (
                <li key={i}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{iv.name}</div>
                  <div style={{ fontSize: 11, color: ACCENT, fontFamily: FONT_MONO, letterSpacing: 1.5 }}>{safeUpper(iv.round)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="col-span-3">
          <Card title="ADVISORS">
            <ul className="mt-1 space-y-2.5">
              {advisors.map((ad, i) => (
                <li key={i}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{ad.name}</div>
                  <div style={{ fontSize: 11, color: SUBTLE, fontFamily: FONT_MONO }}>{ad.expertise}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const A10Plan: React.FC<DeckProps> = ({ data = {} }) => {
  const p = data.three_year_plan || {};
  const rev = p.revenue?.length ? p.revenue :
    [{ year: 'Y0', arr: 4_000_000 }, { year: 'Y1', arr: 18_000_000 }, { year: 'Y2', arr: 40_000_000 }, { year: 'Y3', arr: 90_000_000 }];
  const hires = p.hires?.length ? p.hires :
    [{ year: 'Y0', total_headcount: 70 }, { year: 'Y1', total_headcount: 130 }, { year: 'Y2', total_headcount: 220 }, { year: 'Y3', total_headcount: 320 }];
  const cap = p.capital?.length ? p.capital :
    [{ year: 'Y0', deployed_usd: 0,     cash_end_usd: 25_000_000 },
     { year: 'Y1', deployed_usd: 12_000_000, cash_end_usd: 32_000_000 },
     { year: 'Y2', deployed_usd: 18_000_000, cash_end_usd: 24_000_000 },
     { year: 'Y3', deployed_usd: 22_000_000, cash_end_usd: 18_000_000 }];
  return (
    <SlideFrame index={APPENDIX_OFFSET + 9} total={32} company={data.company} subtitle="Revenue · headcount · capital allocation">
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-6">
          <Card title="REVENUE PLAN ($K)">
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={rev.map((r) => ({ year: r.year, arr: r.arr / 1000 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Bar dataKey="arr" fill={ACCENT} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-6">
          <Card title="HEADCOUNT PLAN">
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={hires}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total_headcount" fill={ACCENT_2} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="col-span-12">
          <Card title="CAPITAL ALLOCATION ($K)">
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <ComposedChart data={cap.map((c) => ({ year: c.year, deployed: c.deployed_usd / 1000, cash_end: c.cash_end_usd / 1000 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <YAxis tick={{ fontSize: 11, fill: SUBTLE, fontFamily: FONT_MONO }} stroke={HAIRLINE} />
                  <Tooltip content={<ChartTooltip prefix="$" suffix="K" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT_MONO, color: SUBTLE }} />
                  <Bar dataKey="deployed" fill={ACCENT} name="Deployed" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="cash_end" stroke={POSITIVE} strokeWidth={3} dot={false} name="Cash at year-end" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

// ─────────────────────────────────────────────────────────────────
// Deck shell — keyboard nav, dot pagination, motion transitions
// ─────────────────────────────────────────────────────────────────

const SLIDES: React.FC<DeckProps>[] = [
  Slide1Vision, Slide2Market, Slide3Problem, Slide4Opportunity,
  Slide5Platform, Slide6TechStack, Slide7Innovation, Slide8Roadmap,
  Slide9Overview, Slide10Revenue, Slide11Customers, Slide12Retention, Slide13Engagement,
  Slide14GTM, Slide15Efficiency, Slide16Economics,
  Slide17Competition, Slide18Moat, Slide19Strategic,
  Slide20Team, Slide21Ops,
  Slide22Fundraise,
  // Appendix
  A1Financials, A2Cohorts, A3Segmentation, A4Funnel, A5Pricing,
  A6Architecture, A7Security, A8Risks, A9Governance, A10Plan,
];

export const SeriesBDiligenceDeckApp: React.FC<{
  initialData?: SeriesBData;
  editable?: boolean;
}> = ({ initialData = SAMPLE_DATA, editable = true }) => {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<SeriesBData>(initialData);
  const reduced = useReducedMotion();
  const total = SLIDES.length;

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, total - 1)), [total]);
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
  const isAppendix = index >= APPENDIX_OFFSET;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 lg:p-10"
      style={{ background: '#E2E8F0', fontFamily: FONT }}>
      <div className="w-full max-w-[1480px] rounded-3xl overflow-hidden border bg-white shadow-[0_40px_100px_-30px_rgba(15,23,42,0.4)]"
        style={{ borderColor: HAIRLINE }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={reduced ? {} : { opacity: 1, y: 0 }}
            exit={reduced ? {} : { opacity: 0, y: -18 }}
            transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Slide data={data} editable={editable} onEdit={onEdit} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="w-full max-w-[1480px] mt-5 flex items-center justify-between" style={{ color: INK }}>
        <button
          onClick={prev}
          disabled={index === 0}
          className="px-4 py-2 rounded-full border bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm font-semibold"
          style={{ borderColor: HAIRLINE }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 18 L9 12 L15 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Previous
        </button>

        <div className="flex items-center gap-2">
          <div style={{ fontSize: 11, color: SUBTLE, fontFamily: FONT_MONO, letterSpacing: 2, marginRight: 12 }}>
            {isAppendix ? `A${index - APPENDIX_OFFSET + 1}` : String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} · {sectionForIndex(index)}
          </div>
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className="transition-all"
              style={{
                width: i === index ? 22 : 5,
                height: 5,
                borderRadius: 999,
                background: i === index ? ACCENT : i >= APPENDIX_OFFSET ? '#94A3B8' : '#CBD5E1',
              }}
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={index === total - 1}
          className="px-4 py-2 rounded-full border bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm font-semibold"
          style={{ borderColor: HAIRLINE }}>
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
// SAMPLE_DATA — drop in the merged Axal row shape produced by
// cloudflare-worker/src/routes/decks.ts heuristicSlides() to hydrate.
// JSON columns referenced here depend on the autofill migration
// from earlier Prompt MD (DECK_AUTOFILL_AUDIT.md +
// 00xx_deck_autofill_fields.sql).
// ─────────────────────────────────────────────────────────────────

export const SAMPLE_DATA: SeriesBData = {
  company: '[Company]',
  domain: 'company.com',
  category: 'Workflow infrastructure',

  vision_headline: 'The default platform every operating team routes their work through.',
  vision_subline:  'The work itself becomes the system of record — observable, audited, alive.',
  vision_category: 'CATEGORY · WORKFLOW INFRASTRUCTURE',

  problem_headline: 'A trillion-dollar friction tax that nobody charges for — but everyone pays.',

  tam_usd: 42_000_000_000,
};

// ─────────────────────────────────────────────────────────────────
// Registry adapter — wraps each SLIDES entry in <Slide16x9> so the
// platform print pipeline (PitchDeckPrintPage.jsx) can find each
// slide via `[data-slide-frame]` and so per-slide page breaks fire
// during window.print(). Mirrors the pattern from series_a_growth_app.
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

export const Deck_series_b_diligence_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => (
  <BrandProvider data={data || {}} fallbackAccent={ACCENT}>
    <Deck_series_b_diligence_app_inner data={data} editable={editable} onEdit={onEdit} />
  </BrandProvider>
);

const Deck_series_b_diligence_app_inner: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const { accent: brandAccent } = useBrandContext();
  const merged = useMemo(
    () => mergeShape(SAMPLE_DATA, data || {}) as SeriesBData,
    [data],
  );
  return (
    <>
      {SLIDES.map((Slide, i) => (
        <Slide16x9 key={i}>
          <Slide data={merged} editable={editable} onEdit={onEdit} />
        </Slide16x9>
      ))}
    </>
  );
};
