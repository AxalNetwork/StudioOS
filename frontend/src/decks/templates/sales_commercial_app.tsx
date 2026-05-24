/**
 * sales_commercial_app.tsx
 *
 * Enterprise customer-facing commercial deck — 18 slides, 5 sections
 * (Customer Context · Solution · Value · Implementation · Commercials).
 *
 * NOT an investor deck. Built to help close enterprise customers:
 * outcome-first, ROI-anchored, security-credible, implementation-realistic.
 *
 * Self-contained React + TypeScript + Tailwind + Framer Motion app.
 * Every product screen and diagram is hand-built SVG.
 * Binds to Axal platform rows via `heuristicSlides()` in
 * `cloudflare-worker/src/routes/decks.ts` (mapping at the bottom).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Slide16x9, type DeckProps as RegistryDeckProps } from '../DeckBase';

/* ───────────────────────────── types ────────────────────────────── */

export type SalesData = {
  meta: {
    vendor: string;
    customer: string;
    vendor_mark: string;
    customer_mark: string;
    doc_label: string;
    confidential: string;
    prepared_for: string;
    prepared_by: string;
    presented_on: string;
  };
  executive: {
    headline: string;
    sub: string;
    outcomes: { label: string; value: string; note: string }[];
    elevator: string;
  };
  industry_trends: {
    headline: string;
    sub: string;
    forces: { title: string; detail: string; intensity_pct: number }[];
    why_now: string[];
  };
  challenges: {
    headline: string;
    sub: string;
    pains: { area: string; pain: string; impact: string }[];
  };
  business_impact: {
    headline: string;
    sub: string;
    kpis: { label: string; current: string; target: string; gap_usd: number }[];
    annual_loss_usd: number;
  };
  solution: {
    headline: string;
    sub: string;
    capabilities: { title: string; detail: string }[];
    transformation: { from: string; to: string }[];
  };
  how_it_works: {
    headline: string;
    sub: string;
    steps: { title: string; detail: string; owner: 'customer' | 'platform' | 'joint' }[];
  };
  features: {
    headline: string;
    sub: string;
    modules: { name: string; icon: string; bullets: string[] }[];
  };
  use_cases: {
    name: string;
    persona: string;
    headline: string;
    sub: string;
    bullets: string[];
    outcome_label: string;
    outcome_value: string;
    screen: 'dashboard' | 'workflow' | 'analytics';
  }[];
  roi: {
    headline: string;
    sub: string;
    components: { line: string; year1_usd: number; year3_usd: number }[];
    investment_usd: number;
    payback_months: number;
    npv_usd: number;
    irr_pct: number;
  };
  case_studies: {
    headline: string;
    sub: string;
    studies: { client: string; sector: string; outcome: string; metric: string; value: string }[];
  };
  competitive: {
    headline: string;
    sub: string;
    competitors: string[];
    criteria: { name: string; scores: number[] }[]; // scores 0..4 length=competitors.length+1 (us first)
  };
  deployment: {
    headline: string;
    sub: string;
    phases: { name: string; duration: string; milestones: string[]; owner: string }[];
  };
  integration: {
    headline: string;
    sub: string;
    layers: { name: string; detail: string }[];
    integrations: { name: string; protocol: string }[];
  };
  security: {
    headline: string;
    sub: string;
    controls: { category: string; controls: string[] }[];
    certifications: string[];
    sla_uptime_pct: number;
    rpo_minutes: number;
    rto_minutes: number;
  };
  pricing: {
    headline: string;
    sub: string;
    tiers: { name: string; price_usd: number; period: string; users: string; features: string[]; recommended: boolean }[];
    services: { name: string; price_label: string }[];
    discount_note: string;
  };
  next_steps: {
    headline: string;
    sub: string;
    pilot: { name: string; duration: string; investment_usd: number; success_criteria: string[] };
    timeline: { week: string; milestone: string; owner: string }[];
    closing_line: string;
    contact_name: string;
    contact_email: string;
  };
};

/* ───────────────────────────── tokens ───────────────────────────── */

const C = {
  ink: '#0F1B2D',
  inkSoft: '#1B2A40',
  paper: '#FFFFFF',
  warm: '#F6F8FB',
  dim: '#EDF1F7',
  line: '#D9DFE9',
  lineSoft: '#E8ECF2',
  text: '#0F1B2D',
  soft: '#4A586E',
  muted: '#7C8AA1',
  accent: '#0F62FE', // IBM/Microsoft enterprise blue
  accentSoft: '#D9E7FF',
  accentDeep: '#0043CE',
  teal: '#00766F',
  tealSoft: '#CFEAE7',
  emerald: '#0F8A5F',
  emeraldSoft: '#D5EFE5',
  amber: '#C8821D',
  amberSoft: '#FBEACD',
  rose: '#B0314A',
  roseSoft: '#F8DBE2',
  gold: '#B8862A',
};

const fontSerif = '"Source Serif Pro", "Source Serif 4", Georgia, "Times New Roman", serif';
const fontSans = '"Inter", "Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif';
const fontMono = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

/* ───────────────────────────── utils ────────────────────────────── */

const usd = (n: number) => {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};

const setIn = <T,>(obj: T, path: (string | number)[], v: unknown): T => {
  const next = structuredClone(obj) as Record<string, unknown>;
  let cur: Record<string, unknown> = next as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i] as string] as Record<string, unknown>;
  cur[path[path.length - 1] as string] = v;
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
  <div className="relative w-full h-full overflow-hidden" style={{ background: bg, color: C.text, fontFamily: fontSans }}>
    <div
      className="absolute top-0 left-0 right-0 h-11 flex items-center justify-between px-10 text-[10px] tracking-[0.22em] uppercase"
      style={{ color: C.muted, borderBottom: `1px solid ${C.lineSoft}` }}
    >
      <span style={{ fontFamily: fontSerif, fontStyle: 'italic', letterSpacing: '0.1em' }}>{section}</span>
      <span style={{ fontFamily: fontMono }}>
        {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
    <div className="absolute inset-x-0 top-11 bottom-9 px-10 py-6">{children}</div>
    <div
      className="absolute bottom-0 left-0 right-0 h-9 flex items-center justify-between px-10 text-[10px]"
      style={{ color: C.muted, borderTop: `1px solid ${C.lineSoft}` }}
    >
      <span>Confidential — prepared for customer evaluation</span>
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

const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 className="leading-[1.08] tracking-[-0.015em]" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '34px', color: C.ink }}>
    {children}
  </h1>
);

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-3 text-[13.5px] leading-snug max-w-[820px]" style={{ color: C.soft }}>
    {children}
  </p>
);

const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  tone?: 'plain' | 'soft' | 'accent';
  style?: React.CSSProperties;
}> = ({ children, className, tone = 'plain', style }) => {
  const bg = tone === 'soft' ? C.warm : tone === 'accent' ? C.accentSoft : '#fff';
  const border = tone === 'accent' ? C.accentSoft : C.line;
  return (
    <div className={`rounded-md ${className ?? ''}`} style={{ background: bg, border: `1px solid ${border}`, ...style }}>
      {children}
    </div>
  );
};

/* ───────────────────────────── SVG products + diagrams ──────────── */

const BrowserChrome: React.FC<{ url: string; children: React.ReactNode }> = ({ url, children }) => (
  <div className="w-full h-full rounded-lg overflow-hidden border" style={{ borderColor: C.line, background: '#fff' }}>
    <div className="flex items-center gap-2 px-3 h-8 border-b" style={{ borderColor: C.line, background: C.warm }}>
      <div className="flex gap-1">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FEBC2E' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
      </div>
      <div
        className="flex-1 mx-2 h-5 rounded flex items-center px-2 text-[10px]"
        style={{ background: '#fff', border: `1px solid ${C.line}`, color: C.muted, fontFamily: fontMono }}
      >
        {url}
      </div>
    </div>
    <div className="w-full" style={{ height: 'calc(100% - 2rem)' }}>
      {children}
    </div>
  </div>
);

const DashboardScreen: React.FC<{ vendor: string }> = ({ vendor }) => (
  <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="720" fill="#fff" />
    <rect x="0" y="0" width="200" height="720" fill={C.warm} />
    <rect x="20" y="22" width="28" height="28" rx="6" fill={C.accent} />
    <text x="56" y="40" fontFamily={fontSerif} fontWeight={700} fontSize="13" fill={C.ink}>
      {vendor}
    </text>
    {['Overview', 'Operations', 'Customers', 'Compliance', 'Reports', 'Admin'].map((l, i) => (
      <g key={l} transform={`translate(20, ${80 + i * 38})`}>
        <rect width="160" height="28" rx="6" fill={i === 0 ? '#fff' : 'transparent'} stroke={i === 0 ? C.line : 'none'} />
        <circle cx="14" cy="14" r="3" fill={i === 0 ? C.accent : C.muted} />
        <text x="28" y="18" fontFamily={fontSans} fontWeight={i === 0 ? 600 : 500} fontSize="11" fill={i === 0 ? C.ink : C.soft}>
          {l}
        </text>
      </g>
    ))}
    <rect x="200" y="0" width="1000" height="56" fill="#fff" />
    <line x1="200" y1="56" x2="1200" y2="56" stroke={C.line} />
    <text x="220" y="35" fontFamily={fontSerif} fontWeight={600} fontSize="16" fill={C.ink}>
      Operations Console
    </text>
    {[
      { l: 'Open tickets', v: '142', d: '−24 this wk' },
      { l: 'Avg cycle time', v: '3.2d', d: '−1.4d' },
      { l: 'SLA adherence', v: '98.6%', d: '+2.1pt' },
      { l: 'Cost / case', v: '$48', d: '−18%' },
    ].map((k, i) => (
      <g key={k.l} transform={`translate(${220 + i * 240}, 80)`}>
        <rect width="220" height="92" rx="8" fill="#fff" stroke={C.line} />
        <text x="16" y="26" fontFamily={fontSans} fontSize="10" fill={C.muted}>
          {k.l.toUpperCase()}
        </text>
        <text x="16" y="58" fontFamily={fontSerif} fontWeight={700} fontSize="26" fill={C.ink}>
          {k.v}
        </text>
        <text x="16" y="78" fontFamily={fontMono} fontSize="10" fill={C.emerald}>
          ▼ {k.d}
        </text>
      </g>
    ))}
    <g transform="translate(220, 196)">
      <rect width="700" height="280" rx="8" fill="#fff" stroke={C.line} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="12" fill={C.ink}>
        Throughput · last 30 days
      </text>
      <defs>
        <linearGradient id="dash-g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.3" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {(() => {
        const v = [40, 48, 52, 58, 62, 70, 68, 76, 84, 88, 92, 100, 108, 118, 124];
        const w = 660;
        const h = 200;
        const ox = 20;
        const oy = 56;
        const max = 140;
        const pts = v.map((vv, i) => `${ox + (i * w) / (v.length - 1)},${oy + h - (vv / max) * h}`);
        return (
          <>
            <path d={`M${ox},${oy + h} L${pts.join(' L')} L${ox + w},${oy + h} Z`} fill="url(#dash-g)" />
            <path d={`M${pts.join(' L')}`} fill="none" stroke={C.accent} strokeWidth={2} />
          </>
        );
      })()}
    </g>
    <g transform="translate(940, 196)">
      <rect width="240" height="280" rx="8" fill="#fff" stroke={C.line} />
      <text x="16" y="28" fontFamily={fontSans} fontWeight={600} fontSize="12" fill={C.ink}>
        Top exceptions
      </text>
      {['SLA breach risk', 'Missing approval', 'Doc mismatch', 'Region change', 'Audit hold'].map((t, i) => (
        <g key={t} transform={`translate(16, ${48 + i * 42})`}>
          <rect width="208" height="34" rx="6" fill={C.warm} />
          <circle cx="14" cy="17" r="6" fill={[C.rose, C.amber, C.amber, C.accent, C.teal][i]} />
          <text x="28" y="21" fontFamily={fontSans} fontWeight={500} fontSize="11" fill={C.ink}>
            {t}
          </text>
        </g>
      ))}
    </g>
    <g transform="translate(220, 500)">
      <rect width="960" height="200" rx="8" fill="#fff" stroke={C.line} />
      <text x="20" y="30" fontFamily={fontSans} fontWeight={600} fontSize="12" fill={C.ink}>
        Active workflows
      </text>
      {['Case ID', 'Stage', 'Owner', 'Region', 'Due', 'Status'].map((h, i) => (
        <text key={h} x={20 + i * 156} y="56" fontFamily={fontSans} fontWeight={600} fontSize="10" fill={C.muted}>
          {h.toUpperCase()}
        </text>
      ))}
      {[
        ['CASE-4812', 'Review', 'M. Chen', 'EU', 'Jun 02', 'On track'],
        ['CASE-4811', 'Approval', 'J. Becker', 'US', 'Jun 03', 'On track'],
        ['CASE-4805', 'Intake', 'P. Patel', 'APAC', 'Jun 05', 'At risk'],
      ].map((r, ri) => (
        <g key={ri} transform={`translate(0, ${72 + ri * 32})`}>
          {r.map((c, ci) => (
            <text key={ci} x={20 + ci * 156} y="18" fontFamily={fontSans} fontSize="11" fill={C.ink}>
              {c}
            </text>
          ))}
        </g>
      ))}
    </g>
  </svg>
);

const WorkflowScreen: React.FC = () => (
  <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="720" fill="#fff" />
    <text x="40" y="60" fontFamily={fontSerif} fontWeight={600} fontSize="22" fill={C.ink}>
      Case workflow · Tier-1 customer onboarding
    </text>
    <text x="40" y="84" fontFamily={fontSans} fontSize="12" fill={C.muted}>
      Automated routing · SLA enforced · audit-logged
    </text>
    {[
      { x: 60, label: 'Intake', tone: C.accent },
      { x: 270, label: 'Verify', tone: C.accent },
      { x: 480, label: 'Approve', tone: C.amber },
      { x: 690, label: 'Provision', tone: C.accent },
      { x: 900, label: 'Notify', tone: C.emerald },
    ].map((n, i, arr) => (
      <g key={n.label}>
        <rect x={n.x} y={140} width="160" height="80" rx="10" fill="#fff" stroke={n.tone} strokeWidth="2" />
        <text x={n.x + 80} y={180} textAnchor="middle" fontFamily={fontSans} fontWeight={600} fontSize="14" fill={C.ink}>
          {n.label}
        </text>
        <text x={n.x + 80} y={200} textAnchor="middle" fontFamily={fontMono} fontSize="10" fill={C.muted}>
          STEP {i + 1}
        </text>
        {i < arr.length - 1 && <line x1={n.x + 160} y1={180} x2={arr[i + 1].x} y2={180} stroke={C.line} strokeDasharray="4 4" />}
      </g>
    ))}
    <g transform="translate(40, 280)">
      <rect width="1120" height="380" rx="12" fill={C.warm} />
      <text x="20" y="36" fontFamily={fontSans} fontWeight={600} fontSize="14" fill={C.ink}>
        Live case · CASE-4812
      </text>
      {[
        { t: 'Submitted', who: 'Self-service portal', when: '08:42' },
        { t: 'Auto-verified KYC', who: 'Platform', when: '08:43' },
        { t: 'Routed to approver', who: 'Mia Chen', when: '08:45' },
        { t: 'Approval granted', who: 'Mia Chen', when: '09:02' },
        { t: 'Provisioned', who: 'Platform', when: '09:03' },
        { t: 'Customer notified', who: 'Platform', when: '09:03' },
      ].map((row, i) => (
        <g key={i} transform={`translate(20, ${64 + i * 48})`}>
          <rect width="1080" height="38" rx="8" fill="#fff" stroke={C.line} />
          <circle cx="20" cy="19" r="8" fill={C.emerald} />
          <text x="44" y="16" fontFamily={fontSans} fontWeight={600} fontSize="12" fill={C.ink}>
            {row.t}
          </text>
          <text x="44" y="30" fontFamily={fontSans} fontSize="11" fill={C.soft}>
            {row.who}
          </text>
          <text x="1060" y="24" textAnchor="end" fontFamily={fontMono} fontSize="11" fill={C.muted}>
            {row.when}
          </text>
        </g>
      ))}
    </g>
  </svg>
);

const AnalyticsScreen: React.FC = () => (
  <svg viewBox="0 0 1200 720" className="w-full h-full block" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="720" fill="#fff" />
    <text x="40" y="56" fontFamily={fontSerif} fontWeight={600} fontSize="22" fill={C.ink}>
      Cost-to-serve analytics
    </text>
    <text x="40" y="80" fontFamily={fontSans} fontSize="12" fill={C.muted}>
      Filter: last 90 days · all regions
    </text>
    <g transform="translate(40, 110)">
      <rect width="720" height="280" rx="10" fill={C.warm} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
        Cost per case · cohorts
      </text>
      {(() => {
        const lines = [
          { c: C.accent, v: [100, 92, 86, 78, 70, 64, 58, 52, 48, 44, 42] },
          { c: C.amber, v: [100, 95, 92, 88, 84, 82, 80, 78, 76, 74, 72] },
          { c: C.teal, v: [100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80] },
        ];
        return lines.map((l, li) => {
          const w = 680;
          const h = 200;
          const ox = 20;
          const oy = 56;
          const pts = l.v.map((vv, i) => `${ox + (i * w) / (l.v.length - 1)},${oy + h - (vv / 100) * h}`);
          return <path key={li} d={`M${pts.join(' L')}`} fill="none" stroke={l.c} strokeWidth={2.5} />;
        });
      })()}
      <g transform="translate(20, 268)">
        <rect width="10" height="10" fill={C.accent} />
        <text x="16" y="9" fontFamily={fontSans} fontSize="10" fill={C.soft}>
          Platform cohort
        </text>
        <rect x="120" width="10" height="10" fill={C.amber} />
        <text x="136" y="9" fontFamily={fontSans} fontSize="10" fill={C.soft}>
          Hybrid
        </text>
        <rect x="220" width="10" height="10" fill={C.teal} />
        <text x="236" y="9" fontFamily={fontSans} fontSize="10" fill={C.soft}>
          Legacy
        </text>
      </g>
    </g>
    <g transform="translate(780, 110)">
      <rect width="380" height="280" rx="10" fill={C.warm} />
      <text x="20" y="32" fontFamily={fontSans} fontWeight={600} fontSize="13" fill={C.ink}>
        Cost composition
      </text>
      {(() => {
        const cx = 190;
        const cy = 160;
        const r = 80;
        const segments = [
          { pct: 38, c: C.accent, label: 'Labor' },
          { pct: 24, c: C.teal, label: 'Vendor' },
          { pct: 18, c: C.amber, label: 'Rework' },
          { pct: 12, c: C.gold, label: 'Compliance' },
          { pct: 8, c: C.rose, label: 'Other' },
        ];
        let acc = 0;
        return segments.map((s, i) => {
          const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          acc += s.pct;
          const end = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          const x1 = cx + r * Math.cos(start);
          const y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end);
          const y2 = cy + r * Math.sin(end);
          const large = s.pct > 50 ? 1 : 0;
          return (
            <g key={i}>
              <path d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`} fill={s.c} />
              <text
                x={cx + (r + 18) * Math.cos((start + end) / 2)}
                y={cy + (r + 18) * Math.sin((start + end) / 2)}
                textAnchor="middle"
                fontFamily={fontMono}
                fontSize="9"
                fill={C.ink}
              >
                {s.label} {s.pct}%
              </text>
            </g>
          );
        });
      })()}
    </g>
    {[
      { l: 'YoY savings', v: '$4.8M' },
      { l: 'Cost / case', v: '$42' },
      { l: 'Productivity', v: '+34%' },
      { l: 'Time saved / FTE', v: '11h/wk' },
    ].map((k, i) => (
      <g key={k.l} transform={`translate(${40 + i * 280}, 420)`}>
        <rect width="260" height="220" rx="10" fill="#fff" stroke={C.line} />
        <text x="20" y="36" fontFamily={fontSans} fontSize="11" fill={C.muted}>
          {k.l.toUpperCase()}
        </text>
        <text x="20" y="110" fontFamily={fontSerif} fontWeight={700} fontSize="48" fill={C.ink}>
          {k.v}
        </text>
        <rect x="20" y="160" width="220" height="5" rx="3" fill={C.dim} />
        <rect x="20" y="160" width={120 + i * 25} height="5" rx="3" fill={C.accent} />
        <text x="20" y="190" fontFamily={fontSans} fontSize="11" fill={C.soft}>
          vs. benchmark
        </text>
      </g>
    ))}
  </svg>
);

/* Stat / comparison primitives */

const TrendBars: React.FC<{ forces: { title: string; intensity_pct: number }[] }> = ({ forces }) => {
  const w = 540;
  const h = 200;
  const bw = (w - 40) / forces.length - 16;
  return (
    <svg viewBox={`0 0 ${w} ${h + 50}`} className="w-full h-full">
      <line x1="0" y1={h} x2={w} y2={h} stroke={C.line} />
      {forces.map((f, i) => {
        const x = 20 + i * ((w - 40) / forces.length);
        const bh = (f.intensity_pct / 100) * h;
        return (
          <g key={i}>
            <rect x={x} y={h - bh} width={bw} height={bh} rx={3} fill={C.accent} />
            <text x={x + bw / 2} y={h - bh - 6} textAnchor="middle" fontFamily={fontMono} fontWeight={600} fontSize="10" fill={C.ink}>
              {f.intensity_pct}%
            </text>
            <text x={x + bw / 2} y={h + 18} textAnchor="middle" fontFamily={fontSans} fontSize="10" fill={C.soft}>
              {f.title.length > 22 ? f.title.slice(0, 21) + '…' : f.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const ImpactBarChart: React.FC<{ components: { line: string; year1_usd: number; year3_usd: number }[] }> = ({ components }) => {
  const w = 540;
  const h = 220;
  const max = Math.max(...components.flatMap((c) => [c.year1_usd, c.year3_usd]));
  const bw = (w - 60) / components.length / 2 - 6;
  return (
    <svg viewBox={`0 0 ${w} ${h + 50}`} className="w-full h-full">
      <line x1="30" y1={h} x2={w - 10} y2={h} stroke={C.line} />
      {components.map((c, i) => {
        const gx = 40 + i * ((w - 60) / components.length);
        const h1 = (c.year1_usd / max) * h;
        const h3 = (c.year3_usd / max) * h;
        return (
          <g key={i}>
            <rect x={gx} y={h - h1} width={bw} height={h1} rx={3} fill={C.accent} fillOpacity={0.45} />
            <rect x={gx + bw + 4} y={h - h3} width={bw} height={h3} rx={3} fill={C.accent} />
            <text x={gx + bw + 2} y={h + 18} textAnchor="middle" fontFamily={fontSans} fontSize="9" fill={C.soft}>
              {c.line.length > 20 ? c.line.slice(0, 19) + '…' : c.line}
            </text>
            <text x={gx + bw / 2} y={h - h1 - 4} textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.ink}>
              {usd(c.year1_usd)}
            </text>
            <text x={gx + bw + 4 + bw / 2} y={h - h3 - 4} textAnchor="middle" fontFamily={fontMono} fontSize="9" fill={C.ink}>
              {usd(c.year3_usd)}
            </text>
          </g>
        );
      })}
      <g transform={`translate(30, ${h + 36})`}>
        <rect width="10" height="9" fill={C.accent} fillOpacity={0.45} />
        <text x="16" y="8" fontFamily={fontSans} fontSize="10" fill={C.soft}>
          Year 1
        </text>
        <rect x="68" width="10" height="9" fill={C.accent} />
        <text x="84" y="8" fontFamily={fontSans} fontSize="10" fill={C.soft}>
          Year 3
        </text>
      </g>
    </svg>
  );
};

const SecurityShield: React.FC<{ certifications: string[] }> = ({ certifications }) => (
  <svg viewBox="0 0 360 360" className="w-full h-full">
    <defs>
      <radialGradient id="shield-g" cx="50%" cy="40%">
        <stop offset="0" stopColor={C.accentSoft} />
        <stop offset="1" stopColor="#fff" />
      </radialGradient>
    </defs>
    <path d="M180,30 L320,80 L320,200 Q320,300 180,340 Q40,300 40,200 L40,80 Z" fill="url(#shield-g)" stroke={C.accent} strokeWidth={2} />
    <circle cx="180" cy="160" r="40" fill="#fff" stroke={C.accent} strokeWidth={2} />
    <text x="180" y="170" textAnchor="middle" fontFamily={fontSerif} fontWeight={700} fontSize="22" fill={C.accent}>
      ✓
    </text>
    {certifications.slice(0, 6).map((c, i) => {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = 180 + 130 * Math.cos(angle);
      const y = 220 + 80 * Math.sin(angle) * 0.6;
      return (
        <g key={c}>
          <rect x={x - 36} y={y - 12} width="72" height="22" rx="6" fill="#fff" stroke={C.accent} />
          <text x={x} y={y + 4} textAnchor="middle" fontFamily={fontMono} fontWeight={600} fontSize="9" fill={C.ink}>
            {c}
          </text>
        </g>
      );
    })}
  </svg>
);

/* ───────────────────────────── slides ───────────────────────────── */

type Edit = (p: (string | number)[], v: string) => void;

const S1Exec: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Customer Context">
    <div className="grid grid-cols-12 gap-8 h-full">
      <div className="col-span-7 flex flex-col">
        <SectionLabel>Executive overview</SectionLabel>
        <Title>
          <Editable value={data.executive.headline} path={['executive', 'headline']} onEdit={e} />
        </Title>
        <Sub>
          <Editable value={data.executive.sub} path={['executive', 'sub']} onEdit={e} multiline />
        </Sub>
        <div className="mt-6 grid grid-cols-3 gap-4">
          {data.executive.outcomes.map((o, i) => (
            <Card key={i} className="p-4" tone="soft">
              <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
                Outcome 0{i + 1}
              </div>
              <div className="mt-2" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '24px', color: C.ink }}>
                <Editable value={o.value} path={['executive', 'outcomes', i, 'value']} onEdit={e} />
              </div>
              <div className="text-[11px] mt-1 font-medium" style={{ color: C.ink }}>
                <Editable value={o.label} path={['executive', 'outcomes', i, 'label']} onEdit={e} />
              </div>
              <div className="text-[11px] mt-2" style={{ color: C.soft }}>
                <Editable value={o.note} path={['executive', 'outcomes', i, 'note']} onEdit={e} />
              </div>
            </Card>
          ))}
        </div>
        <Card className="mt-auto p-5" tone="accent">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            One-sentence value
          </div>
          <div className="mt-1 text-[16px] leading-snug" style={{ color: C.ink, fontFamily: fontSerif, fontWeight: 600 }}>
            <Editable value={data.executive.elevator} path={['executive', 'elevator']} onEdit={e} multiline />
          </div>
        </Card>
      </div>
      <div className="col-span-5">
        <Card className="h-full p-5" tone="soft">
          <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: C.muted }}>
            Prepared for
          </div>
          <div className="mt-1 font-semibold text-base" style={{ color: C.ink }}>
            <Editable value={data.meta.prepared_for} path={['meta', 'prepared_for']} onEdit={e} />
          </div>
          <div className="mt-4 h-[380px]">
            <BrowserChrome url={`app.${data.meta.vendor.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/dashboard`}>
              <DashboardScreen vendor={data.meta.vendor} />
            </BrowserChrome>
          </div>
          <div
            className="mt-3 pt-3 border-t flex items-center justify-between text-[11px]"
            style={{ borderColor: C.line, color: C.muted }}
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

const S2Trends: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Customer Context">
    <SectionLabel color={C.teal}>Industry trends</SectionLabel>
    <Title>
      <Editable value={data.industry_trends.headline} path={['industry_trends', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.industry_trends.sub} path={['industry_trends', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-12 gap-6">
      <Card className="col-span-7 p-5" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.22em] mb-2" style={{ color: C.muted }}>
          Pressure on incumbents — intensity index
        </div>
        <div className="h-[260px]">
          <TrendBars forces={data.industry_trends.forces} />
        </div>
      </Card>
      <div className="col-span-5 space-y-3">
        {data.industry_trends.forces.map((f, i) => (
          <Card key={i} className="p-3" tone="plain">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold" style={{ color: C.ink }}>
                <Editable value={f.title} path={['industry_trends', 'forces', i, 'title']} onEdit={e} />
              </span>
              <span className="text-[10px] font-semibold" style={{ color: C.accent, fontFamily: fontMono }}>
                {f.intensity_pct}
              </span>
            </div>
            <div className="text-[11px] mt-1" style={{ color: C.soft }}>
              <Editable value={f.detail} path={['industry_trends', 'forces', i, 'detail']} onEdit={e} />
            </div>
          </Card>
        ))}
      </div>
    </div>
    <Card className="mt-4 p-4" tone="accent">
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
        Why act now
      </div>
      <div className="grid grid-cols-3 gap-3 text-[12px]">
        {data.industry_trends.why_now.map((w, i) => (
          <div key={i} style={{ color: C.ink }}>
            <Editable value={w} path={['industry_trends', 'why_now', i]} onEdit={e} />
          </div>
        ))}
      </div>
    </Card>
  </SlideFrame>
);

const S3Challenges: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Customer Context">
    <SectionLabel color={C.rose}>Customer challenges</SectionLabel>
    <Title>
      <Editable value={data.challenges.headline} path={['challenges', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.challenges.sub} path={['challenges', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-2 gap-4">
      {data.challenges.pains.map((p, i) => (
        <Card key={i} className="p-5" tone="plain">
          <div className="flex items-start gap-3">
            <div
              className="shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-[12px] font-bold"
              style={{ background: C.roseSoft, color: C.rose, fontFamily: fontMono }}
            >
              {String(i + 1).padStart(2, '0')}
            </div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.muted }}>
                <Editable value={p.area} path={['challenges', 'pains', i, 'area']} onEdit={e} />
              </div>
              <div className="mt-1 font-semibold text-[14px]" style={{ color: C.ink }}>
                <Editable value={p.pain} path={['challenges', 'pains', i, 'pain']} onEdit={e} multiline />
              </div>
              <div className="mt-3 text-[11px] px-2 py-1 inline-block rounded" style={{ background: C.roseSoft, color: C.rose }}>
                <Editable value={p.impact} path={['challenges', 'pains', i, 'impact']} onEdit={e} />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  </SlideFrame>
);

const S4Impact: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="I · Customer Context">
    <SectionLabel color={C.rose}>Business impact</SectionLabel>
    <Title>
      <Editable value={data.business_impact.headline} path={['business_impact', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.business_impact.sub} path={['business_impact', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-12 gap-6">
      <Card className="col-span-8 p-0" tone="plain">
        <div className="px-5 pt-5 pb-2 text-[10px] uppercase tracking-[0.22em]" style={{ color: C.muted }}>
          Current vs. target — key operating metrics
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: C.warm }}>
              <th className="text-left px-5 py-2 font-semibold" style={{ color: C.muted }}>
                Metric
              </th>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: C.muted }}>
                Current
              </th>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: C.muted }}>
                Target
              </th>
              <th className="text-right px-5 py-2 font-semibold" style={{ color: C.muted }}>
                Annual gap
              </th>
            </tr>
          </thead>
          <tbody>
            {data.business_impact.kpis.map((k, i) => (
              <tr key={i} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-5 py-2 font-medium" style={{ color: C.ink }}>
                  <Editable value={k.label} path={['business_impact', 'kpis', i, 'label']} onEdit={e} />
                </td>
                <td className="px-3 py-2" style={{ color: C.soft }}>
                  <Editable value={k.current} path={['business_impact', 'kpis', i, 'current']} onEdit={e} />
                </td>
                <td className="px-3 py-2" style={{ color: C.emerald, fontWeight: 600 }}>
                  <Editable value={k.target} path={['business_impact', 'kpis', i, 'target']} onEdit={e} />
                </td>
                <td className="px-5 py-2 text-right" style={{ color: C.rose, fontFamily: fontMono }}>
                  {usd(k.gap_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="col-span-4 p-5 flex flex-col justify-between" tone="accent">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
            Estimated annual loss
          </div>
          <div className="mt-2" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '52px', color: C.ink }}>
            {usd(data.business_impact.annual_loss_usd)}
          </div>
          <div className="text-[12px]" style={{ color: C.soft }}>
            Composed of margin leakage, FTE inefficiency, and risk-adjusted exposure across the metrics above.
          </div>
        </div>
        <div
          className="mt-4 pt-4 border-t text-[11px] leading-snug"
          style={{ borderColor: C.accent + '55', color: C.ink }}
        >
          A coordinated rollout can recover roughly 70% of this within 18 months — modelled in section III.
        </div>
      </Card>
    </div>
  </SlideFrame>
);

const S5Solution: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="II · Solution">
    <SectionLabel>Solution overview</SectionLabel>
    <Title>
      <Editable value={data.solution.headline} path={['solution', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.solution.sub} path={['solution', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <div className="col-span-7 grid grid-cols-2 gap-3">
        {data.solution.capabilities.map((c, i) => (
          <Card key={i} className="p-4" tone="plain">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
              Capability 0{i + 1}
            </div>
            <div className="mt-1 font-semibold text-[14px]" style={{ color: C.ink }}>
              <Editable value={c.title} path={['solution', 'capabilities', i, 'title']} onEdit={e} />
            </div>
            <div className="mt-2 text-[12px]" style={{ color: C.soft }}>
              <Editable value={c.detail} path={['solution', 'capabilities', i, 'detail']} onEdit={e} multiline />
            </div>
          </Card>
        ))}
      </div>
      <Card className="col-span-5 p-5" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: C.muted }}>
          Transformation
        </div>
        <div className="space-y-2">
          {data.solution.transformation.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 p-3 rounded" style={{ background: '#fff', border: `1px solid ${C.line}` }}>
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                  From
                </div>
                <div className="text-[12px] line-through decoration-2" style={{ color: C.soft }}>
                  <Editable value={t.from} path={['solution', 'transformation', i, 'from']} onEdit={e} />
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: C.accent }}>
                  To
                </div>
                <div className="text-[12px] font-semibold" style={{ color: C.ink }}>
                  <Editable value={t.to} path={['solution', 'transformation', i, 'to']} onEdit={e} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  </SlideFrame>
);

const S6HowItWorks: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="II · Solution">
    <SectionLabel>How it works</SectionLabel>
    <Title>
      <Editable value={data.how_it_works.headline} path={['how_it_works', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.how_it_works.sub} path={['how_it_works', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <Card className="col-span-7 p-3" tone="plain">
        <div className="h-[360px]">
          <BrowserChrome url={`app.${data.meta.vendor.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/workflow/case-4812`}>
            <WorkflowScreen />
          </BrowserChrome>
        </div>
      </Card>
      <div className="col-span-5 space-y-2">
        {data.how_it_works.steps.map((s, i) => {
          const tone = s.owner === 'customer' ? C.teal : s.owner === 'platform' ? C.accent : C.gold;
          return (
            <Card key={i} className="p-3" tone="plain">
              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold"
                  style={{ background: tone + '22', color: tone, fontFamily: fontMono }}
                >
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[13px]" style={{ color: C.ink }}>
                      <Editable value={s.title} path={['how_it_works', 'steps', i, 'title']} onEdit={e} />
                    </span>
                    <span
                      className="text-[9px] uppercase tracking-[0.16em] font-semibold px-2 py-0.5 rounded"
                      style={{ background: tone + '22', color: tone }}
                    >
                      {s.owner}
                    </span>
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: C.soft }}>
                    <Editable value={s.detail} path={['how_it_works', 'steps', i, 'detail']} onEdit={e} multiline />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  </SlideFrame>
);

const S7Features: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="II · Solution">
    <SectionLabel>Feature overview</SectionLabel>
    <Title>
      <Editable value={data.features.headline} path={['features', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.features.sub} path={['features', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-3 gap-4">
      {data.features.modules.map((m, i) => (
        <Card key={i} className="p-5" tone="plain">
          <div
            className="w-10 h-10 rounded-md flex items-center justify-center mb-3"
            style={{ background: C.accentSoft, color: C.accent, fontFamily: fontSerif, fontWeight: 700, fontSize: 18 }}
          >
            {m.icon}
          </div>
          <div className="font-semibold text-[15px]" style={{ color: C.ink }}>
            <Editable value={m.name} path={['features', 'modules', i, 'name']} onEdit={e} />
          </div>
          <ul className="mt-3 space-y-1 text-[12px]">
            {m.bullets.map((b, bi) => (
              <li key={bi} className="flex gap-2" style={{ color: C.ink }}>
                <span style={{ color: C.accent }}>·</span>
                <Editable value={b} path={['features', 'modules', i, 'bullets', bi]} onEdit={e} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  </SlideFrame>
);

const UseCaseSlide: React.FC<{ data: SalesData; e: Edit; step: number; total: number; idx: number }> = ({
  data,
  e,
  step,
  total,
  idx,
}) => {
  // Defensive fallback: if the platform passes a partial `use_cases`
  // array (1–2 entries), `mergeShape` will have replaced the sample
  // wholesale. Fall back per-index to SAMPLE_DATA so slide 2/3 don't
  // crash on `undefined.headline`. Task #10 — caught in code review.
  const uc = data.use_cases[idx] ?? SAMPLE_DATA.use_cases[idx];
  const screen =
    uc.screen === 'workflow' ? <WorkflowScreen /> : uc.screen === 'analytics' ? <AnalyticsScreen /> : <DashboardScreen vendor={data.meta.vendor} />;
  return (
    <SlideFrame step={step} total={total} section="II · Solution">
      <SectionLabel>Use case 0{idx + 1}</SectionLabel>
      <div className="flex items-baseline justify-between">
        <Title>
          <Editable value={uc.headline} path={['use_cases', idx, 'headline']} onEdit={e} />
        </Title>
        <span
          className="text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 rounded font-semibold"
          style={{ background: C.accentSoft, color: C.accent }}
        >
          <Editable value={uc.persona} path={['use_cases', idx, 'persona']} onEdit={e} />
        </span>
      </div>
      <Sub>
        <Editable value={uc.sub} path={['use_cases', idx, 'sub']} onEdit={e} multiline />
      </Sub>
      <div className="mt-5 grid grid-cols-12 gap-6">
        <Card className="col-span-7 p-3" tone="plain">
          <div className="h-[360px]">
            <BrowserChrome url={`app.${data.meta.vendor.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/${uc.name.toLowerCase().replace(/\s+/g, '-')}`}>
              {screen}
            </BrowserChrome>
          </div>
        </Card>
        <div className="col-span-5 space-y-3">
          <Card className="p-4" tone="soft">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
              What the user does
            </div>
            <ul className="mt-2 space-y-1.5 text-[12px]">
              {uc.bullets.map((b, bi) => (
                <li key={bi} className="flex gap-2" style={{ color: C.ink }}>
                  <span style={{ color: C.accent }}>·</span>
                  <Editable value={b} path={['use_cases', idx, 'bullets', bi]} onEdit={e} />
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4" tone="accent">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
              Measured outcome
            </div>
            <div className="flex items-baseline gap-3 mt-1">
              <div style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '40px', color: C.ink }}>
                <Editable value={uc.outcome_value} path={['use_cases', idx, 'outcome_value']} onEdit={e} />
              </div>
              <div className="text-[12px]" style={{ color: C.soft }}>
                <Editable value={uc.outcome_label} path={['use_cases', idx, 'outcome_label']} onEdit={e} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </SlideFrame>
  );
};

const S11Roi: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="III · Value">
    <SectionLabel color={C.emerald}>ROI analysis</SectionLabel>
    <Title>
      <Editable value={data.roi.headline} path={['roi', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.roi.sub} path={['roi', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-12 gap-6">
      <Card className="col-span-7 p-5" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.22em] mb-2" style={{ color: C.muted }}>
          Value composition · Year 1 vs Year 3
        </div>
        <div className="h-[260px]">
          <ImpactBarChart components={data.roi.components} />
        </div>
      </Card>
      <div className="col-span-5 grid grid-cols-2 gap-3">
        {[
          { l: 'Investment', v: usd(data.roi.investment_usd), n: 'License + implementation', tone: 'soft' as const },
          { l: 'Payback', v: `${data.roi.payback_months}mo`, n: 'Modeled base case', tone: 'soft' as const },
          { l: 'NPV (3yr)', v: usd(data.roi.npv_usd), n: '10% discount rate', tone: 'accent' as const },
          { l: 'IRR (3yr)', v: `${data.roi.irr_pct}%`, n: 'Above hurdle', tone: 'accent' as const },
        ].map((k, i) => (
          <Card key={i} className="p-4 h-full" tone={k.tone}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.muted }}>
              {k.l}
            </div>
            <div className="mt-1" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '30px', color: C.ink }}>
              {k.v}
            </div>
            <div className="text-[10px]" style={{ color: C.soft }}>
              {k.n}
            </div>
          </Card>
        ))}
      </div>
    </div>
  </SlideFrame>
);

const S12Cases: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="III · Value">
    <SectionLabel>Customer success</SectionLabel>
    <Title>
      <Editable value={data.case_studies.headline} path={['case_studies', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.case_studies.sub} path={['case_studies', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-3 gap-4">
      {data.case_studies.studies.map((s, i) => (
        <Card key={i} className="p-5" tone="plain">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.accent }}>
              <Editable value={s.sector} path={['case_studies', 'studies', i, 'sector']} onEdit={e} />
            </div>
            <div className="text-[10px]" style={{ color: C.muted, fontFamily: fontMono }}>
              CASE {String(i + 1).padStart(2, '0')}
            </div>
          </div>
          <div className="mt-2" style={{ color: C.ink, fontFamily: fontSerif, fontSize: '20px', fontWeight: 600 }}>
            <Editable value={s.client} path={['case_studies', 'studies', i, 'client']} onEdit={e} />
          </div>
          <div className="mt-3 text-[12px]" style={{ color: C.soft }}>
            <Editable value={s.outcome} path={['case_studies', 'studies', i, 'outcome']} onEdit={e} multiline />
          </div>
          <div className="mt-4 pt-4 border-t flex items-baseline justify-between" style={{ borderColor: C.line }}>
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: C.muted }}>
              <Editable value={s.metric} path={['case_studies', 'studies', i, 'metric']} onEdit={e} />
            </div>
            <div style={{ color: C.emerald, fontFamily: fontSerif, fontSize: '22px', fontWeight: 600 }}>
              <Editable value={s.value} path={['case_studies', 'studies', i, 'value']} onEdit={e} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  </SlideFrame>
);

const S13Compete: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="III · Value">
    <SectionLabel>Competitive comparison</SectionLabel>
    <Title>
      <Editable value={data.competitive.headline} path={['competitive', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.competitive.sub} path={['competitive', 'sub']} onEdit={e} multiline />
    </Sub>
    <Card className="mt-6 p-0" tone="plain">
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ background: C.warm }}>
            <th className="text-left px-4 py-3 font-semibold" style={{ color: C.muted }}>
              Capability
            </th>
            <th className="text-center px-3 py-3 font-semibold" style={{ color: C.accent, background: C.accentSoft }}>
              {data.meta.vendor}
            </th>
            {data.competitive.competitors.map((c, i) => (
              <th key={i} className="text-center px-3 py-3 font-semibold" style={{ color: C.muted }}>
                <Editable value={c} path={['competitive', 'competitors', i]} onEdit={e} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.competitive.criteria.map((cr, i) => (
            <tr key={i} className="border-t" style={{ borderColor: C.line }}>
              <td className="px-4 py-2 font-medium" style={{ color: C.ink }}>
                <Editable value={cr.name} path={['competitive', 'criteria', i, 'name']} onEdit={e} />
              </td>
              {cr.scores.map((s, si) => (
                <td
                  key={si}
                  className="text-center px-3 py-2"
                  style={si === 0 ? { background: C.accentSoft } : undefined}
                >
                  <div className="flex justify-center gap-0.5">
                    {[0, 1, 2, 3].map((n) => (
                      <span
                        key={n}
                        className="w-2 h-2 rounded-full"
                        style={{ background: n < s ? (si === 0 ? C.accent : C.soft) : C.line }}
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
    <div className="mt-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: C.muted }}>
      Scoring: ●●●● = leader · ●●●○ = strong · ●●○○ = adequate · ●○○○ = limited
    </div>
  </SlideFrame>
);

const S14Deploy: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="IV · Implementation">
    <SectionLabel>Deployment plan</SectionLabel>
    <Title>
      <Editable value={data.deployment.headline} path={['deployment', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.deployment.sub} path={['deployment', 'sub']} onEdit={e} multiline />
    </Sub>
    <Card className="mt-6 p-4" tone="plain">
      <div className="grid grid-cols-4 gap-2">
        {data.deployment.phases.map((p, i) => (
          <div key={i} className="rounded-md overflow-hidden">
            <div className="px-4 py-2 text-[11px] font-semibold text-white" style={{ background: [C.teal, C.accent, C.amber, C.emerald][i % 4] }}>
              Phase {i + 1} · <Editable value={p.duration} path={['deployment', 'phases', i, 'duration']} onEdit={e} />
            </div>
            <div className="p-3" style={{ background: '#fff', border: `1px solid ${C.line}`, borderTop: 'none' }}>
              <div className="font-semibold text-[13px]" style={{ color: C.ink }}>
                <Editable value={p.name} path={['deployment', 'phases', i, 'name']} onEdit={e} />
              </div>
              <div className="text-[10px] uppercase tracking-[0.14em] mt-2" style={{ color: C.muted }}>
                Milestones
              </div>
              <ul className="text-[11px] mt-1 space-y-0.5">
                {p.milestones.map((m, mi) => (
                  <li key={mi} className="flex gap-2" style={{ color: C.ink }}>
                    <span style={{ color: C.muted }}>·</span>
                    <Editable value={m} path={['deployment', 'phases', i, 'milestones', mi]} onEdit={e} />
                  </li>
                ))}
              </ul>
              <div className="mt-3 pt-2 border-t text-[10px]" style={{ borderColor: C.line, color: C.muted }}>
                Owner:{' '}
                <span style={{ color: C.ink, fontWeight: 600 }}>
                  <Editable value={p.owner} path={['deployment', 'phases', i, 'owner']} onEdit={e} />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  </SlideFrame>
);

const S15Integration: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="IV · Implementation">
    <SectionLabel>Integration architecture</SectionLabel>
    <Title>
      <Editable value={data.integration.headline} path={['integration', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.integration.sub} path={['integration', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <Card className="col-span-8 p-5" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.22em] mb-2" style={{ color: C.muted }}>
          Reference architecture
        </div>
        <div className="space-y-2">
          {data.integration.layers.map((l, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded" style={{ background: C.warm, border: `1px solid ${C.line}` }}>
              <div
                className="shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-[12px] font-bold"
                style={{ background: C.accent + (i === 0 ? '' : '22'), color: i === 0 ? '#fff' : C.accent, fontFamily: fontMono }}
              >
                L{i + 1}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-[13px]" style={{ color: C.ink }}>
                  <Editable value={l.name} path={['integration', 'layers', i, 'name']} onEdit={e} />
                </div>
                <div className="text-[11px]" style={{ color: C.soft }}>
                  <Editable value={l.detail} path={['integration', 'layers', i, 'detail']} onEdit={e} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="col-span-4 p-4" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: C.accent }}>
          Out-of-box integrations
        </div>
        <div className="space-y-1.5">
          {data.integration.integrations.map((ig, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b last:border-b-0" style={{ borderColor: C.line }}>
              <span style={{ color: C.ink }}>
                <Editable value={ig.name} path={['integration', 'integrations', i, 'name']} onEdit={e} />
              </span>
              <span style={{ color: C.soft, fontFamily: fontMono }}>
                <Editable value={ig.protocol} path={['integration', 'integrations', i, 'protocol']} onEdit={e} />
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  </SlideFrame>
);

const S16Security: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="IV · Implementation">
    <SectionLabel color={C.teal}>Security & compliance</SectionLabel>
    <Title>
      <Editable value={data.security.headline} path={['security', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.security.sub} path={['security', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-6 grid grid-cols-12 gap-6">
      <Card className="col-span-5 p-4" tone="plain">
        <div className="h-[280px]">
          <SecurityShield certifications={data.security.certifications} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2 text-center">
          {[
            { l: 'Uptime SLA', v: `${data.security.sla_uptime_pct}%` },
            { l: 'RPO', v: `${data.security.rpo_minutes}m` },
            { l: 'RTO', v: `${data.security.rto_minutes}m` },
          ].map((k) => (
            <div key={k.l} className="p-2 rounded" style={{ background: C.warm }}>
              <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                {k.l}
              </div>
              <div className="mt-1 font-semibold" style={{ color: C.ink, fontFamily: fontSerif, fontSize: '18px' }}>
                {k.v}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <div className="col-span-7 space-y-3">
        {data.security.controls.map((c, i) => (
          <Card key={i} className="p-4" tone="plain">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
              <Editable value={c.category} path={['security', 'controls', i, 'category']} onEdit={e} />
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {c.controls.map((ct, ci) => (
                <div key={ci} className="flex gap-2" style={{ color: C.ink }}>
                  <span style={{ color: C.emerald }}>✓</span>
                  <Editable value={ct} path={['security', 'controls', i, 'controls', ci]} onEdit={e} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  </SlideFrame>
);

const S17Pricing: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <SlideFrame step={step} total={total} section="V · Commercials">
    <SectionLabel color={C.gold}>Pricing & commercial model</SectionLabel>
    <Title>
      <Editable value={data.pricing.headline} path={['pricing', 'headline']} onEdit={e} />
    </Title>
    <Sub>
      <Editable value={data.pricing.sub} path={['pricing', 'sub']} onEdit={e} multiline />
    </Sub>
    <div className="mt-5 grid grid-cols-4 gap-3">
      {data.pricing.tiers.map((t, i) => (
        <Card
          key={i}
          className="p-5 flex flex-col"
          tone={t.recommended ? 'accent' : 'plain'}
          style={t.recommended ? { borderColor: C.accent, borderWidth: 2 } : undefined}
        >
          {t.recommended && (
            <div
              className="text-[10px] uppercase tracking-[0.18em] font-semibold px-2 py-0.5 rounded self-start mb-2"
              style={{ background: C.accent, color: '#fff' }}
            >
              Recommended
            </div>
          )}
          <div className="font-semibold text-[14px]" style={{ color: C.ink }}>
            <Editable value={t.name} path={['pricing', 'tiers', i, 'name']} onEdit={e} />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <div style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '28px', color: C.ink }}>{usd(t.price_usd)}</div>
            <div className="text-[11px]" style={{ color: C.soft }}>
              /<Editable value={t.period} path={['pricing', 'tiers', i, 'period']} onEdit={e} />
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] mt-1" style={{ color: C.muted }}>
            <Editable value={t.users} path={['pricing', 'tiers', i, 'users']} onEdit={e} />
          </div>
          <ul className="mt-3 space-y-1 text-[11px] flex-1">
            {t.features.map((f, fi) => (
              <li key={fi} className="flex gap-2" style={{ color: C.ink }}>
                <span style={{ color: C.accent }}>✓</span>
                <Editable value={f} path={['pricing', 'tiers', i, 'features', fi]} onEdit={e} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
    <div className="mt-4 grid grid-cols-12 gap-3">
      <Card className="col-span-8 p-4" tone="soft">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: C.accent }}>
          Professional services
        </div>
        <div className="grid grid-cols-3 gap-3 text-[11px]">
          {data.pricing.services.map((s, i) => (
            <div key={i} className="flex items-center justify-between p-2 rounded" style={{ background: '#fff', border: `1px solid ${C.line}` }}>
              <span style={{ color: C.ink }}>
                <Editable value={s.name} path={['pricing', 'services', i, 'name']} onEdit={e} />
              </span>
              <span style={{ color: C.soft, fontFamily: fontMono }}>
                <Editable value={s.price_label} path={['pricing', 'services', i, 'price_label']} onEdit={e} />
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="col-span-4 p-4" tone="plain">
        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.gold }}>
          Enterprise discount
        </div>
        <div className="text-[12px] mt-1" style={{ color: C.ink }}>
          <Editable value={data.pricing.discount_note} path={['pricing', 'discount_note']} onEdit={e} multiline />
        </div>
      </Card>
    </div>
  </SlideFrame>
);

const S18Next: React.FC<{ data: SalesData; e: Edit; step: number; total: number }> = ({ data, e, step, total }) => (
  <div className="relative w-full h-full overflow-hidden" style={{ background: C.ink, color: '#fff', fontFamily: fontSans }}>
    <div
      className="absolute top-0 left-0 right-0 h-11 flex items-center justify-between px-10 text-[10px] tracking-[0.22em] uppercase opacity-60"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
    >
      <span style={{ fontFamily: fontSerif, fontStyle: 'italic' }}>V · Commercials — Next Steps</span>
      <span style={{ fontFamily: fontMono }}>
        {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
    <div className="absolute inset-x-0 top-11 bottom-9 px-10 py-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px w-8" style={{ background: C.gold }} />
        <span className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: C.gold }}>
          Next steps
        </span>
      </div>
      <h1 className="leading-[1.06] tracking-[-0.015em]" style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '36px' }}>
        <Editable value={data.next_steps.headline} path={['next_steps', 'headline']} onEdit={e} />
      </h1>
      <p className="mt-3 text-[13.5px] max-w-[820px]" style={{ color: '#A9BBD6' }}>
        <Editable value={data.next_steps.sub} path={['next_steps', 'sub']} onEdit={e} multiline />
      </p>
      <div className="mt-5 grid grid-cols-12 gap-5">
        <div
          className="col-span-7 p-5 rounded-md"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="text-[10px] uppercase tracking-[0.22em] mb-2" style={{ color: '#7E92B3' }}>
            Pilot proposal
          </div>
          <div style={{ fontFamily: fontSerif, fontWeight: 600, fontSize: '22px' }}>
            <Editable value={data.next_steps.pilot.name} path={['next_steps', 'pilot', 'name']} onEdit={e} />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-3 text-[12px]">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7E92B3' }}>
                Duration
              </div>
              <div className="mt-1 font-medium">
                <Editable value={data.next_steps.pilot.duration} path={['next_steps', 'pilot', 'duration']} onEdit={e} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7E92B3' }}>
                Investment
              </div>
              <div className="mt-1 font-medium" style={{ fontFamily: fontMono }}>
                {usd(data.next_steps.pilot.investment_usd)}
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
          <div className="mt-4 pt-4 border-t text-[10px] uppercase tracking-[0.18em]" style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#7E92B3' }}>
            Success criteria
          </div>
          <ul className="mt-2 text-[12px] space-y-1">
            {data.next_steps.pilot.success_criteria.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: C.gold }}>·</span>
                <Editable value={s} path={['next_steps', 'pilot', 'success_criteria', i]} onEdit={e} />
              </li>
            ))}
          </ul>
        </div>
        <div
          className="col-span-5 p-5 rounded-md flex flex-col"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: '#7E92B3' }}>
            Decision timeline
          </div>
          <div className="space-y-2 flex-1">
            {data.next_steps.timeline.map((t, i) => (
              <div key={i} className="flex items-center gap-3 text-[12px]">
                <div
                  className="shrink-0 w-12 text-center font-semibold rounded px-1 py-0.5 text-[10px]"
                  style={{ background: C.gold + '33', color: C.gold, fontFamily: fontMono }}
                >
                  {t.week}
                </div>
                <div className="flex-1">
                  <Editable value={t.milestone} path={['next_steps', 'timeline', i, 'milestone']} onEdit={e} />
                </div>
                <div className="text-[10px]" style={{ color: '#7E92B3' }}>
                  <Editable value={t.owner} path={['next_steps', 'timeline', i, 'owner']} onEdit={e} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[16px] leading-snug" style={{ fontFamily: fontSerif, fontStyle: 'italic', color: '#FFE4B0' }}>
            <Editable value={data.next_steps.closing_line} path={['next_steps', 'closing_line']} onEdit={e} multiline />
          </div>
          <div className="mt-3 text-[12px]" style={{ color: '#A9BBD6' }}>
            <Editable value={data.next_steps.contact_name} path={['next_steps', 'contact_name']} onEdit={e} /> ·{' '}
            <Editable value={data.next_steps.contact_email} path={['next_steps', 'contact_email']} onEdit={e} />
          </div>
        </div>
      </div>
    </div>
    <div
      className="absolute bottom-0 left-0 right-0 h-9 flex items-center justify-between px-10 text-[10px] opacity-60"
      style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      <span>Confidential — prepared for customer evaluation</span>
      <span style={{ fontFamily: fontMono }}>NEXT STEPS</span>
    </div>
  </div>
);

/* ───────────────────────────── deck shell ───────────────────────── */

export const SalesCommercialDeckApp: React.FC<{ initial?: SalesData }> = ({ initial = SAMPLE_DATA }) => {
  const [data, setData] = useState<SalesData>(initial);
  const [idx, setIdx] = useState(0);
  const onEdit = useCallback((p: (string | number)[], v: string) => setData((prev) => setIn(prev, p, v)), []);

  const slides = useMemo(
    () => [
      (p: { step: number; total: number }) => <S1Exec data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S2Trends data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S3Challenges data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S4Impact data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S5Solution data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S6HowItWorks data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S7Features data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <UseCaseSlide data={data} e={onEdit} {...p} idx={0} />,
      (p: { step: number; total: number }) => <UseCaseSlide data={data} e={onEdit} {...p} idx={1} />,
      (p: { step: number; total: number }) => <UseCaseSlide data={data} e={onEdit} {...p} idx={2} />,
      (p: { step: number; total: number }) => <S11Roi data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S12Cases data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S13Compete data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S14Deploy data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S15Integration data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S16Security data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S17Pricing data={data} e={onEdit} {...p} />,
      (p: { step: number; total: number }) => <S18Next data={data} e={onEdit} {...p} />,
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
    <div className="w-screen h-screen flex items-center justify-center" style={{ background: '#D9DFE9' }}>
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
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0"
          >
            {slides[idx]({ step: idx + 1, total })}
          </motion.div>
        </AnimatePresence>
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 18px rgba(0,0,0,0.08)' }}
        >
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} className="px-2 py-1 text-sm rounded hover:bg-slate-100">
            ◀
          </button>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{ background: i === idx ? C.accent : C.line, transform: i === idx ? 'scale(1.6)' : 'scale(1)' }}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
          <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))} className="px-2 py-1 text-sm rounded hover:bg-slate-100">
            ▶
          </button>
        </div>
      </div>
    </div>
  );
};

export default SalesCommercialDeckApp;

/* ──────────────────── sample data + Axal binding ────────────────── */
/*
 * Mirrors field names heuristicSlides() in cloudflare-worker/src/routes/decks.ts
 * writes after Replit Prompt MD (00xx_deck_autofill_fields.sql) plus sales-deck
 * extension tables (customers, customer_opportunities, customer_success_stories,
 * pricing_plans, compliance_certs, deployment_phases). Empty fields fall through
 * to "—" per heuristicSlides() convention.
 *
 * Mapping:
 *   customer_opportunities.customer_name              → meta.customer
 *   organizations.name (vendor)                       → meta.vendor
 *   customer_opportunities.prepared_for / by / on     → meta.prepared_*
 *   projects.one_liner                                → executive.headline
 *   projects.solution                                 → executive.sub
 *   customer_opportunities.outcomes_json              → executive.outcomes
 *   projects.tagline                                  → executive.elevator
 *
 *   industry_signals.market_shifts_json (filtered)    → industry_trends.forces
 *   industry_signals.why_now_bullets_json             → industry_trends.why_now
 *
 *   customer_opportunities.pain_points_json           → challenges.pains
 *
 *   financial_models.kpi_gaps_json                    → business_impact.kpis
 *   financial_models.annual_loss_usd                  → business_impact.annual_loss_usd
 *
 *   projects.capabilities_json                        → solution.capabilities
 *   projects.transformation_json                      → solution.transformation
 *
 *   workflows.steps_json (active scenario)            → how_it_works.steps
 *
 *   projects.modules_json (with bullets)              → features.modules
 *
 *   customer_opportunities.use_cases_json             → use_cases[*]
 *
 *   financial_models.roi_components_json              → roi.components
 *   financial_models.investment_usd / payback_months / npv_usd / irr_pct
 *                                                     → roi.*
 *
 *   customer_success_stories.* (filtered by sector)   → case_studies.studies
 *
 *   competitive_matrix.* (curated per opportunity)    → competitive.*
 *
 *   deployment_phases.* (template for offering)       → deployment.phases
 *
 *   projects.tech_stack_json                          → integration.layers
 *   projects.integration_points_json                  → integration.integrations
 *
 *   security_controls.* + compliance_certs            → security.controls / certifications
 *   sla_uptime_pct / rpo_minutes / rto_minutes        → security.*
 *
 *   pricing_plans.* (active offering)                 → pricing.tiers / services
 *   commercial_terms.discount_note                    → pricing.discount_note
 *
 *   customer_opportunities.pilot_proposal_json        → next_steps.pilot
 *   customer_opportunities.decision_timeline_json     → next_steps.timeline
 *   users.full_name + .email (account exec)           → next_steps.contact_*
 */

export const SAMPLE_DATA: SalesData = {
  meta: {
    vendor: 'Axal',
    customer: 'Continental Bank',
    vendor_mark: 'A',
    customer_mark: 'C',
    doc_label: 'Solution Proposal',
    confidential: 'CONFIDENTIAL — Customer Evaluation',
    prepared_for: 'Continental Bank — Office of the COO',
    prepared_by: 'Axal Customer Solutions Team',
    presented_on: 'May 2026',
  },
  executive: {
    headline: 'A unified operations platform that delivers measurable cost-to-serve reduction in 120 days.',
    sub: 'Axal consolidates fragmented intake, approval, and provisioning workflows into a single, audit-grade platform — reducing cycle time, lowering cost-per-case, and surfacing risk before it materializes.',
    outcomes: [
      { label: 'Cycle time', value: '−42%', note: 'Intake → fulfilment, blended.' },
      { label: 'Cost per case', value: '−38%', note: 'Year-1, attributable to platform.' },
      { label: 'SLA adherence', value: '99.2%', note: 'Across pilot scopes.' },
    ],
    elevator:
      'One platform that runs your operations end-to-end, with the audit posture your regulators expect and the economics your CFO requires.',
  },
  industry_trends: {
    headline: 'Four converging pressures make the case for consolidation today.',
    sub: 'Across regulated industries, leaders are simplifying their operating stack to absorb regulatory load, cost discipline, and customer-experience expectations simultaneously.',
    forces: [
      { title: 'Stack consolidation', detail: 'Average IT footprint cut 40% by 2027.', intensity_pct: 78 },
      { title: 'Regulatory load', detail: 'New data-residency mandates in 14 markets.', intensity_pct: 62 },
      { title: 'Customer experience', detail: 'Time-to-resolution now a top NPS driver.', intensity_pct: 71 },
      { title: 'AI-native ops', detail: 'Embedded copilots reshape every workflow.', intensity_pct: 84 },
    ],
    why_now: [
      'Budgeting window aligns with FY-27 IT planning starting Q4-26.',
      'Pilot capacity available before peak audit season.',
      'Two competitors have not yet productised a converged response.',
    ],
  },
  challenges: {
    headline: 'Six structural challenges identified from our discovery sessions with your operating leaders.',
    sub: 'These match what we hear across comparable institutions — and what we have proven we can address with measurable results.',
    pains: [
      {
        area: 'Fragmented intake',
        pain: 'Customer requests span 11 systems with no canonical case record.',
        impact: '~ 14 hrs/week per analyst on reconciliation.',
      },
      {
        area: 'Manual approvals',
        pain: 'Approval routing requires email + spreadsheet with no SLA enforcement.',
        impact: '~ 22% of cases miss SLA by ≥ 1 business day.',
      },
      {
        area: 'Audit posture',
        pain: 'No unified evidence trail — audits require manual reconstruction.',
        impact: '~ 6 weeks per audit cycle, $1.4M annual cost.',
      },
      {
        area: 'Risk blind spots',
        pain: 'Compliance breaches surface only after escalation.',
        impact: '~ 3 regulatory findings per year, materially.',
      },
      {
        area: 'Customer experience',
        pain: 'No real-time status visibility for customers; high inbound call volume.',
        impact: '~ 38% of calls are status-only.',
      },
      {
        area: 'Vendor sprawl',
        pain: '7 overlapping tools across operations; license & integration burden.',
        impact: '~ $3.8M annual run-rate avoidable.',
      },
    ],
  },
  business_impact: {
    headline: 'The compound annual cost of inaction across these challenges is significant.',
    sub: 'Modelled from public benchmarks, our discovery sessions, and comparable Tier-1 customer deployments. Conservative base case shown.',
    kpis: [
      { label: 'Cost per case', current: '$78', target: '$48', gap_usd: 5_400_000 },
      { label: 'Avg cycle time', current: '5.6 days', target: '3.2 days', gap_usd: 3_800_000 },
      { label: 'SLA adherence', current: '88.4%', target: '99.0%', gap_usd: 2_200_000 },
      { label: 'Audit prep hours / cycle', current: '1,400 hrs', target: '120 hrs', gap_usd: 1_400_000 },
      { label: 'License & integration', current: '7 tools', target: '1 platform', gap_usd: 3_800_000 },
      { label: 'Customer call volume', current: '+38%', target: 'baseline', gap_usd: 1_900_000 },
    ],
    annual_loss_usd: 18_500_000,
  },
  solution: {
    headline: 'Axal is a single operations platform with embedded AI, native compliance, and out-of-box integration.',
    sub: 'Six capabilities consolidate today\'s seven-tool footprint into one auditable surface, deployable in 12 weeks.',
    capabilities: [
      { title: 'Unified case record', detail: 'Canonical case object across intake channels with full lineage.' },
      { title: 'Workflow & SLA engine', detail: 'BPMN runtime with SLA-enforced routing and exception handling.' },
      { title: 'Embedded AI copilot', detail: 'Drafts responses, summarises calls, flags exceptions in real time.' },
      { title: 'Audit & evidence vault', detail: 'Immutable evidence trail with one-click regulator export.' },
      { title: 'Customer self-service', detail: 'Real-time status, document upload, in-app messaging.' },
      { title: 'Insights & reporting', detail: 'Operating KPIs, cohort analytics, regulator-ready packs.' },
    ],
    transformation: [
      { from: '11 intake systems', to: 'One canonical case record' },
      { from: 'Email-based approvals', to: 'SLA-enforced routing' },
      { from: 'Manual audit prep', to: 'One-click evidence export' },
      { from: 'Status-only calls', to: 'Self-service customer portal' },
    ],
  },
  how_it_works: {
    headline: 'Cases flow through six steps with clear ownership and complete auditability.',
    sub: 'Every step is logged, time-stamped, and exportable. SLA exceptions auto-route to the right team without manual triage.',
    steps: [
      { title: 'Intake', detail: 'Customer submits via portal, email, or API; case auto-classified.', owner: 'customer' },
      { title: 'Verify', detail: 'KYC and document checks run automatically against your data sources.', owner: 'platform' },
      { title: 'Approve', detail: 'Routed to the right approver(s) with SLA timers and escalation.', owner: 'joint' },
      { title: 'Provision', detail: 'Downstream systems updated via your existing API/iPaaS.', owner: 'platform' },
      { title: 'Notify', detail: 'Customer notified across channels; in-app status updates live.', owner: 'platform' },
      { title: 'Evidence', detail: 'Full trail archived in the audit vault for regulator export.', owner: 'platform' },
    ],
  },
  features: {
    headline: 'Nine modules covering the full operations lifecycle, modular by design.',
    sub: 'Activate what you need today; extend later without re-platforming.',
    modules: [
      {
        name: 'Cases',
        icon: '◆',
        bullets: ['Canonical case object', 'Multi-channel intake', 'Lineage & timeline', 'Custom fields per LOB'],
      },
      {
        name: 'Workflows',
        icon: '◇',
        bullets: ['Visual designer', 'SLA enforcement', 'Conditional routing', 'Versioned & auditable'],
      },
      {
        name: 'AI Copilot',
        icon: '★',
        bullets: ['Drafts responses', 'Summarises calls', 'Detects exceptions', 'Human-in-the-loop'],
      },
      {
        name: 'Documents',
        icon: '▣',
        bullets: ['Secure vault', 'OCR + classification', 'Redaction', 'Customer upload portal'],
      },
      {
        name: 'Self-service portal',
        icon: '◉',
        bullets: ['Branded customer UX', 'Real-time status', 'Document upload', 'In-app messaging'],
      },
      {
        name: 'Audit & evidence',
        icon: '⛨',
        bullets: ['Immutable log', 'One-click export', 'Regulator-friendly packs', 'Retention policies'],
      },
      {
        name: 'Insights',
        icon: '◐',
        bullets: ['Operating KPIs', 'Cohort analysis', 'Forecast accuracy', 'Custom dashboards'],
      },
      {
        name: 'Identity & access',
        icon: '◈',
        bullets: ['SSO', 'RBAC + ABAC', 'Just-in-time access', 'Audit log of admin actions'],
      },
      {
        name: 'Admin & ops',
        icon: '✦',
        bullets: ['Tenant config', 'Policy management', 'Deployment slots', 'Health monitoring'],
      },
    ],
  },
  use_cases: [
    {
      name: 'Onboarding',
      persona: 'Customer onboarding ops',
      headline: 'Reduce Tier-1 onboarding cycle time from 6 days to under 36 hours.',
      sub: 'A single workflow replaces 4 systems and 11 manual handoffs, with full KYC and provisioning automation.',
      bullets: [
        'Customer submits once, in any channel.',
        'KYC + identity verification runs automatically.',
        'SLA-enforced approval routes to the right team.',
        'Provisioning fires across downstream systems.',
      ],
      outcome_label: 'cycle-time reduction',
      outcome_value: '−76%',
      screen: 'workflow',
    },
    {
      name: 'Servicing',
      persona: 'Servicing operations',
      headline: 'Cut servicing cost per case by 38% while improving customer NPS.',
      sub: 'Embedded AI drafts responses and surfaces exception cases before they breach SLA — agents focus only on judgment work.',
      bullets: [
        'AI copilot drafts responses agents approve.',
        'Real-time exception detection.',
        'Self-service portal absorbs status-only calls.',
        'Full conversation history with the customer.',
      ],
      outcome_label: 'cost per case',
      outcome_value: '−38%',
      screen: 'dashboard',
    },
    {
      name: 'Audit',
      persona: 'Compliance & internal audit',
      headline: 'Reduce audit preparation from six weeks to four days.',
      sub: 'Every action, decision, and document is captured in an immutable evidence vault, exportable in regulator-friendly format.',
      bullets: [
        'Immutable evidence trail per case.',
        'One-click regulator export.',
        'Pre-built packs for common audits.',
        'Continuous monitoring against policy.',
      ],
      outcome_label: 'audit prep cycle',
      outcome_value: '−93%',
      screen: 'analytics',
    },
  ],
  roi: {
    headline: 'Modelled three-year value of $42M against a $4.8M total investment.',
    sub: 'Base case uses your discovery numbers + comparable benchmarks. Sensitivity analysis available on request.',
    components: [
      { line: 'Cost-out (ops)', year1_usd: 3_200_000, year3_usd: 14_400_000 },
      { line: 'Audit savings', year1_usd: 900_000, year3_usd: 3_800_000 },
      { line: 'Vendor consolidation', year1_usd: 2_100_000, year3_usd: 8_400_000 },
      { line: 'Risk avoidance', year1_usd: 1_400_000, year3_usd: 5_600_000 },
      { line: 'Customer satisfaction', year1_usd: 1_800_000, year3_usd: 9_800_000 },
    ],
    investment_usd: 4_800_000,
    payback_months: 11,
    npv_usd: 28_400_000,
    irr_pct: 142,
  },
  case_studies: {
    headline: 'Comparable customers have delivered the outcomes we model for you.',
    sub: 'All three operate in regulated industries with directly comparable case volumes.',
    studies: [
      {
        client: 'Northbridge Trust',
        sector: 'Banking',
        outcome: 'Consolidated 9 servicing systems on Axal in 14 weeks; reduced cost-to-serve by 41% and lifted NPS by 12 points.',
        metric: 'Cost-to-serve',
        value: '−41%',
      },
      {
        client: 'Atlas Health Group',
        sector: 'Healthcare',
        outcome: 'Deployed across 14 hospitals; clinician admin reduced by 4.2 hours/week. Audit prep cut from 5 weeks to 3 days.',
        metric: 'Admin saved',
        value: '4.2h/wk',
      },
      {
        client: 'Ministry of Transport',
        sector: 'Public sector',
        outcome: 'Replaced 11 legacy systems on a single platform under the Cloud-First mandate. 100% on-shore data residency maintained.',
        metric: 'Systems consolidated',
        value: '11 → 1',
      },
    ],
  },
  competitive: {
    headline: 'Axal leads on consolidation, audit posture, and time-to-value.',
    sub: 'Independent functional scoring across the criteria most often cited in your peer-group RFPs.',
    competitors: ['Incumbent A', 'Incumbent B', 'Build in-house'],
    criteria: [
      { name: 'Time to first value', scores: [4, 2, 2, 1] },
      { name: 'Audit & evidence posture', scores: [4, 2, 3, 1] },
      { name: 'Embedded AI quality', scores: [4, 1, 2, 2] },
      { name: 'Out-of-box integrations', scores: [4, 3, 3, 1] },
      { name: 'Vendor consolidation', scores: [4, 2, 2, 1] },
      { name: 'Total cost of ownership', scores: [4, 2, 2, 1] },
      { name: 'Regulatory & residency', scores: [4, 3, 3, 2] },
      { name: 'Customer experience', scores: [4, 2, 2, 2] },
    ],
  },
  deployment: {
    headline: 'A four-phase, 18-week plan from kickoff to full rollout — pilot live in 8 weeks.',
    sub: 'Phased delivery with clear ownership across both teams. Each phase has explicit exit criteria reviewed in joint steering.',
    phases: [
      {
        name: 'Discover',
        duration: 'Weeks 1–2',
        milestones: ['Workshops with ops + IT', 'Tech baseline review', 'Joint OKRs'],
        owner: 'Joint',
      },
      {
        name: 'Pilot',
        duration: 'Weeks 3–8',
        milestones: ['Pilot scope live', 'First 1,000 cases processed', 'KPI baseline established'],
        owner: 'Axal lead',
      },
      {
        name: 'Scale',
        duration: 'Weeks 9–14',
        milestones: ['2 additional LOBs onboarded', 'Self-service portal live', 'Integrations completed'],
        owner: 'Joint',
      },
      {
        name: 'Optimise',
        duration: 'Weeks 15–18',
        milestones: ['Audit pack delivered', 'Steady-state operations', 'Phase-2 backlog ratified'],
        owner: 'Customer lead',
      },
    ],
  },
  integration: {
    headline: 'A composable architecture that plugs into your existing stack — no rip-and-replace.',
    sub: 'Five-layer reference architecture with out-of-box adapters for your current systems of record.',
    layers: [
      { name: 'Experience layer', detail: 'Branded customer portal, agent console, mobile.' },
      { name: 'Workflow & automation', detail: 'BPMN runtime, SLA engine, approval chains.' },
      { name: 'AI & decision', detail: 'AI copilot, retrieval, evaluations, full audit log.' },
      { name: 'Data & integration', detail: 'CDC pipelines, event streams, iPaaS-friendly.' },
      { name: 'Identity & governance', detail: 'SSO, RBAC, audit log, data residency by tenant.' },
    ],
    integrations: [
      { name: 'Salesforce', protocol: 'REST + Connect' },
      { name: 'SAP S/4HANA', protocol: 'IDoc + OData' },
      { name: 'ServiceNow', protocol: 'REST + Webhook' },
      { name: 'Workday', protocol: 'REST + SCIM' },
      { name: 'Snowflake', protocol: 'JDBC + share' },
      { name: 'Microsoft 365', protocol: 'Graph API' },
      { name: 'Active Directory', protocol: 'SAML + SCIM' },
      { name: 'Kafka', protocol: 'Avro topics' },
    ],
  },
  security: {
    headline: 'Enterprise-grade security and compliance baked into every layer.',
    sub: 'Audited against the controls your CISO and DPO will require. Single-tenant isolation available per workspace.',
    controls: [
      {
        category: 'Data protection',
        controls: [
          'AES-256 at rest, TLS 1.3 in transit',
          'Per-tenant encryption keys',
          'Column-level encryption for PII',
          'Field-level redaction in logs',
        ],
      },
      {
        category: 'Identity & access',
        controls: ['SSO (SAML, OIDC)', 'RBAC + ABAC', 'Just-in-time access', 'Privileged action approvals'],
      },
      {
        category: 'Audit & monitoring',
        controls: [
          'Immutable activity log',
          'Real-time anomaly detection',
          'SIEM integration',
          'Regulator-ready export packs',
        ],
      },
      {
        category: 'Resilience',
        controls: ['Multi-AZ + multi-region', 'Daily encrypted backups', 'Disaster-recovery runbooks', 'Quarterly DR tests'],
      },
    ],
    certifications: ['SOC 2 II', 'ISO 27001', 'ISO 27701', 'HIPAA', 'PCI DSS', 'GDPR'],
    sla_uptime_pct: 99.95,
    rpo_minutes: 5,
    rto_minutes: 60,
  },
  pricing: {
    headline: 'Transparent, subscription-based pricing with predictable economics.',
    sub: 'Choose the package that matches your initial scope; expand modularly without re-contracting.',
    tiers: [
      {
        name: 'Essential',
        price_usd: 180_000,
        period: 'year',
        users: 'Up to 100 named',
        features: ['Core platform', '1 region', 'Standard SLA', 'Email support'],
        recommended: false,
      },
      {
        name: 'Professional',
        price_usd: 420_000,
        period: 'year',
        users: 'Up to 500 named',
        features: ['Full platform', '2 regions', 'Enhanced SLA', '24×5 support'],
        recommended: true,
      },
      {
        name: 'Enterprise',
        price_usd: 950_000,
        period: 'year',
        users: 'Up to 2,500 named',
        features: ['All modules', 'Global', 'Premium SLA', '24×7 support', 'Named CSM'],
        recommended: false,
      },
      {
        name: 'Strategic',
        price_usd: 1_800_000,
        period: 'year',
        users: 'Unlimited',
        features: ['Single-tenant option', 'Custom residency', 'Premium SLA', 'Co-dev backlog'],
        recommended: false,
      },
    ],
    services: [
      { name: 'Implementation (pilot)', price_label: '$280K fixed' },
      { name: 'Production rollout', price_label: 'T&M, capped' },
      { name: 'Training & enablement', price_label: 'Included Tier 2+' },
      { name: 'Premium support', price_label: '$120K / yr' },
      { name: 'Embedded CSM', price_label: '$180K / yr' },
      { name: 'Custom integrations', price_label: 'SOW-based' },
    ],
    discount_note:
      'Multi-year and prepay discounts available (5% / 12% / 18% for 1/2/3-year prepay). Enterprise+ qualifies for an additional 8% partner discount where applicable.',
  },
  next_steps: {
    headline: 'A 90-day path to a signed pilot, with three decisions in the next 14 days.',
    sub: 'We propose moving immediately to a contained pilot with documented success criteria — and an explicit decision point on full rollout.',
    pilot: {
      name: 'Continental × Axal — Servicing Operations Pilot',
      duration: '120 days',
      investment_usd: 280_000,
      success_criteria: [
        'Cost per case reduced by ≥ 30% on pilot scope.',
        'SLA adherence ≥ 98% on pilot LOB.',
        'Audit pack delivered for pilot period.',
        'Internal NPS ≥ 50 among pilot users.',
      ],
    },
    timeline: [
      { week: 'W1', milestone: 'NDA + scope finalised', owner: 'Both' },
      { week: 'W2', milestone: 'Joint steering kickoff', owner: 'Both' },
      { week: 'W3', milestone: 'Pilot SOW signed', owner: 'Procurement' },
      { week: 'W6', milestone: 'Pilot configuration complete', owner: 'Axal' },
      { week: 'W8', milestone: 'Pilot go-live', owner: 'Both' },
      { week: 'W14', milestone: 'Go/no-go on Phase 2', owner: 'Steering' },
    ],
    closing_line:
      'A measurable pilot in 90 days. A consolidated operating platform in 18 weeks. Let\'s start the conversation that gets us there.',
    contact_name: 'Guillaume Lauzier — CEO, Axal',
    contact_email: 'guillaume@axal.vc',
  },
};
// ─────────────────────────────────────────────────────────────────
// Registry adapter — `Deck_sales_commercial_app`
//
// Wraps each of the 18 slides in <Slide16x9> so the platform print
// pipeline (PitchDeckPrintPage.jsx) can find each slide via the
// `[data-slide-frame]` hook and so per-slide page breaks fire
// during window.print(). Mirrors the pattern from
// series_a_growth_app / series_b_diligence_app / demo_day_app /
// partnership_bd_app.
// ─────────────────────────────────────────────────────────────────

// Shape-safe merge: arrays in `incoming` only replace when non-empty,
// objects merge field-by-field, primitives override. Lets the
// platform pass partial SalesData (whatever fields autofill produced)
// without nuking the SAMPLE_DATA defaults the slide internals rely on.
function mergeShape<T>(base: T, incoming: any): T {
  if (incoming == null) return base;
  if (Array.isArray(base)) {
    return (Array.isArray(incoming) && incoming.length > 0 ? incoming : base) as unknown as T;
  }
  if (typeof base === 'object' && base !== null && typeof incoming === 'object' && !Array.isArray(incoming)) {
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

export const Deck_sales_commercial_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const merged = useMemo(
    () => mergeShape(SAMPLE_DATA, data || {}) as SalesData,
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

  const total = 18;
  const slides: React.ReactNode[] = [
    <S1Exec        data={merged} e={handleEdit} step={1}  total={total} />,
    <S2Trends      data={merged} e={handleEdit} step={2}  total={total} />,
    <S3Challenges  data={merged} e={handleEdit} step={3}  total={total} />,
    <S4Impact      data={merged} e={handleEdit} step={4}  total={total} />,
    <S5Solution    data={merged} e={handleEdit} step={5}  total={total} />,
    <S6HowItWorks  data={merged} e={handleEdit} step={6}  total={total} />,
    <S7Features    data={merged} e={handleEdit} step={7}  total={total} />,
    <UseCaseSlide  data={merged} e={handleEdit} step={8}  total={total} idx={0} />,
    <UseCaseSlide  data={merged} e={handleEdit} step={9}  total={total} idx={1} />,
    <UseCaseSlide  data={merged} e={handleEdit} step={10} total={total} idx={2} />,
    <S11Roi        data={merged} e={handleEdit} step={11} total={total} />,
    <S12Cases      data={merged} e={handleEdit} step={12} total={total} />,
    <S13Compete    data={merged} e={handleEdit} step={13} total={total} />,
    <S14Deploy     data={merged} e={handleEdit} step={14} total={total} />,
    <S15Integration data={merged} e={handleEdit} step={15} total={total} />,
    <S16Security   data={merged} e={handleEdit} step={16} total={total} />,
    <S17Pricing    data={merged} e={handleEdit} step={17} total={total} />,
    <S18Next       data={merged} e={handleEdit} step={18} total={total} />,
  ];

  return (
    <>
      {slides.map((slide, i) => (
        <Slide16x9 key={i}>{slide}</Slide16x9>
      ))}
    </>
  );
};
