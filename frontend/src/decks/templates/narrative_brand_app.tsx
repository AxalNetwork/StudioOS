/**
 * narrative_brand_app.tsx
 *
 * Narrative-driven brand presentation — 15 slides in 4 acts.
 *   Act I   · The World     (slides 1–4)
 *   Act II  · The Belief    (slides 5–8)
 *   Act III · The Solution  (slides 9–12)
 *   Act IV  · The Future    (slides 13–15)
 *
 * Cinematic, editorial, emotional. Built to feel like Apple / Nike /
 * Airbnb / Patagonia / TED — not a startup deck.
 *
 * Self-contained React + TypeScript + Tailwind + Framer Motion app.
 * SVG-only artwork — no stock photos, no clipart, no data charts.
 *
 * Binds to Axal platform rows via `heuristicSlides()` in
 * `cloudflare-worker/src/routes/decks.ts` — mapping at the bottom.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BrandProvider, useBrandContext } from '../DeckBase';

/* ───────────────────────────── tokens ───────────────────────────── */

const C = {
  ink: '#0A0A0C',
  inkSoft: '#1A1A1E',
  paper: '#F7F3EC', // warm cream
  paperWarm: '#EFE9DC',
  cream: '#FBF7F0',
  charcoal: '#2A2A2E',
  text: '#0A0A0C',
  textSoft: '#3A3A3E',
  textMuted: '#7C766C',
  accent: '#C84A1F', // ember
  accentSoft: '#F2D9CB',
  gold: '#B68A2E',
  goldSoft: '#F1E2BB',
  sky: '#3C5A78',
  skySoft: '#CFD9E4',
  emerald: '#3F6650',
  emeraldSoft: '#D4DFD8',
  dusk: '#1F2940',
};

const fontDisplay =
  '"Playfair Display","GT Sectra","Source Serif Pro",Georgia,"Times New Roman",serif';
const fontSans = '"Inter","Helvetica Neue",Arial,system-ui,sans-serif';
const fontMono = '"JetBrains Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace';
const fontEditorial = '"Source Serif Pro",Georgia,serif';

/* ───────────────────────────── types ────────────────────────────── */

export type NarrativeData = {
  brand: {
    name: string;
    mark: string;
    tagline: string;
    confidential: string;
    presented_on: string;
  };
  opening: {
    eyebrow: string;
    headline: string;
    whisper: string;
  };
  change: {
    eyebrow: string;
    headline: string;
    paragraph: string;
    motifs: string[];
  };
  tension: {
    eyebrow: string;
    headline: string;
    fragments: string[];
  };
  human_impact: {
    eyebrow: string;
    headline: string;
    voices: { quote: string; name: string; role: string }[];
  };
  insight: {
    eyebrow: string;
    headline: string;
    body: string;
    pull_quote: string;
  };
  philosophy: {
    eyebrow: string;
    headline: string;
    principles: { word: string; line: string }[];
  };
  mission: {
    eyebrow: string;
    headline: string;
    paragraph: string;
    horizon: string;
  };
  movement: {
    eyebrow: string;
    headline: string;
    paragraph: string;
    members: { name: string; kind: string }[]; // populates community map
  };
  product: {
    eyebrow: string;
    headline: string;
    paragraph: string;
    transforms: { from: string; to: string }[];
  };
  experience: {
    eyebrow: string;
    headline: string;
    chapters: { title: string; line: string }[];
  };
  proof: {
    eyebrow: string;
    headline: string;
    testimonials: { quote: string; name: string; place: string }[];
    stat_strip: { value: string; label: string }[];
  };
  impact: {
    eyebrow: string;
    headline: string;
    pillars: { tone: 'human' | 'environmental' | 'economic'; headline: string; line: string }[];
  };
  opportunity: {
    eyebrow: string;
    headline: string;
    paragraph: string;
    horizons: string[];
  };
  vision: {
    eyebrow: string;
    headline: string;
    paragraph: string;
  };
  manifesto: {
    eyebrow: string;
    lines: string[];
    signoff: string;
    cta_line: string;
    contact: string;
  };
};

/* ───────────────────────────── utils ────────────────────────────── */

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
    className={`outline-none focus:bg-yellow-100/40 rounded-sm px-0.5 ${className ?? ''}`}
    style={style}
  >
    {value}
  </span>
);

const Frame: React.FC<{
  children: React.ReactNode;
  bg?: string;
  text?: string;
  step: number;
  total: number;
  chapter: string;
}> = ({ children, bg = C.paper, text = C.text, step, total, chapter }) => (
  <div className="relative w-full h-full overflow-hidden" style={{ background: bg, color: text, fontFamily: fontSans }}>
    <div
      className="absolute top-0 left-0 right-0 h-10 flex items-center justify-between px-12 text-[10px] tracking-[0.32em] uppercase"
      style={{ color: text === '#fff' || /^#0/.test(text) === false ? 'rgba(255,255,255,0.4)' : C.textMuted }}
    >
      <span style={{ fontFamily: fontEditorial, fontStyle: 'italic' }}>{chapter}</span>
      <span style={{ fontFamily: fontMono }}>
        {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
    <div className="absolute inset-x-0 top-10 bottom-8 px-12 py-6">{children}</div>
  </div>
);

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.accent }) => (
  <div className="flex items-center gap-3 mb-5">
    <span className="h-px w-10" style={{ background: color }} />
    <span className="text-[10px] tracking-[0.32em] uppercase font-medium" style={{ color }}>
      {children}
    </span>
  </div>
);

const Display: React.FC<{ children: React.ReactNode; size?: number; color?: string }> = ({ children, size = 80, color = C.ink }) => (
  <h1
    className="leading-[0.98] tracking-[-0.025em]"
    style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: `${size}px`, color }}
  >
    {children}
  </h1>
);

const Body: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({ children, color = C.textSoft, size = 17 }) => (
  <p className="leading-[1.45] max-w-[760px]" style={{ fontFamily: fontEditorial, fontSize: `${size}px`, color }}>
    {children}
  </p>
);

/* ───────────────────────────── SVG artwork ──────────────────────── */

/** Slow-rising sun horizon — Act I opener */
const HorizonScene: React.FC<{ accent?: string }> = ({ accent = C.accent }) => (
  <svg viewBox="0 0 1200 720" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="sky-grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#F3E2C9" />
        <stop offset="0.55" stopColor="#E8B98C" />
        <stop offset="1" stopColor="#C8754A" />
      </linearGradient>
      <radialGradient id="sun-grad" cx="50%" cy="50%">
        <stop offset="0" stopColor="#FFE7BB" />
        <stop offset="1" stopColor={accent} stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect width="1200" height="720" fill="url(#sky-grad)" />
    <circle cx="600" cy="440" r="260" fill="url(#sun-grad)" />
    <circle cx="600" cy="440" r="80" fill="#FFD68C" />
    {/* layered ridges */}
    <path d="M0,520 Q200,470 420,500 T800,490 T1200,510 L1200,720 L0,720 Z" fill={C.charcoal} fillOpacity="0.55" />
    <path d="M0,580 Q220,550 460,575 T880,565 T1200,580 L1200,720 L0,720 Z" fill={C.ink} fillOpacity="0.75" />
    <path d="M0,640 Q260,620 520,640 T960,635 T1200,645 L1200,720 L0,720 Z" fill={C.ink} />
    {/* silhouette figure */}
    <g transform="translate(560, 540)">
      <ellipse cx="40" cy="100" rx="34" ry="6" fill="#000" fillOpacity="0.25" />
      <path d="M40,12 a10,10 0 1 1 0,0.01 z" fill="#000" />
      <path d="M30,24 L50,24 L56,76 L48,88 L42,68 L38,68 L32,88 L24,76 Z" fill="#000" />
    </g>
  </svg>
);

/** Fragmented glass — Act I tension */
const FragmentedGlass: React.FC<{}> = () => (
  <svg viewBox="0 0 1200 720" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="ten-grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#16161A" />
        <stop offset="1" stopColor="#3A3A40" />
      </linearGradient>
    </defs>
    <rect width="1200" height="720" fill="url(#ten-grad)" />
    {/* shards */}
    {[
      'M180,80 L420,140 L300,400 L120,360 Z',
      'M420,140 L740,90 L660,360 L300,400 Z',
      'M740,90 L1060,180 L900,400 L660,360 Z',
      'M120,360 L300,400 L240,640 L80,620 Z',
      'M300,400 L660,360 L600,640 L240,640 Z',
      'M660,360 L900,400 L880,640 L600,640 Z',
      'M900,400 L1060,180 L1180,400 L1080,640 L880,640 Z',
    ].map((d, i) => (
      <path
        key={i}
        d={d}
        fill="#1A1A1E"
        stroke="#FFFFFF"
        strokeOpacity={0.12 + (i % 3) * 0.05}
        strokeWidth={1.5}
      />
    ))}
    {/* light leaks through cracks */}
    <line x1="420" y1="140" x2="300" y2="400" stroke="#FFD68C" strokeOpacity="0.4" />
    <line x1="660" y1="360" x2="600" y2="640" stroke="#FFD68C" strokeOpacity="0.3" />
    <line x1="900" y1="400" x2="1060" y2="180" stroke="#FFD68C" strokeOpacity="0.35" />
  </svg>
);

/** Constellation of people — Act II / movement */
const ConstellationCommunity: React.FC<{ count?: number; accent?: string }> = ({ count = 48, accent = C.accent }) => {
  const points = Array.from({ length: count }).map((_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = 60 + ((i * 53) % 220);
    const cx = 600 + r * Math.cos(a) + (((i * 97) % 80) - 40);
    const cy = 360 + r * Math.sin(a) * 0.66 + (((i * 71) % 60) - 30);
    return [cx, cy] as const;
  });
  return (
    <svg viewBox="0 0 1200 720" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <rect width="1200" height="720" fill={C.dusk} />
      {/* connecting lines (sparse) */}
      {points.map((p, i) => {
        const next = points[(i + 7) % points.length];
        return <line key={i} x1={p[0]} y1={p[1]} x2={next[0]} y2={next[1]} stroke="#FFFFFF" strokeOpacity="0.08" />;
      })}
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i % 7 === 0 ? 4 : 2} fill={i % 5 === 0 ? accent : '#FFE9C7'} fillOpacity={0.6 + (i % 3) * 0.13} />
      ))}
      <circle cx="600" cy="360" r="30" fill={accent} />
      <circle cx="600" cy="360" r="48" fill="none" stroke={accent} strokeOpacity="0.5" />
      <circle cx="600" cy="360" r="68" fill="none" stroke={accent} strokeOpacity="0.25" />
    </svg>
  );
};

/** Sun arc trail — Act II philosophy */
const SunTrail: React.FC<{}> = () => (
  <svg viewBox="0 0 600 360" className="w-full h-full">
    <defs>
      <linearGradient id="trail-grad" x1="0" x2="1">
        <stop offset="0" stopColor={C.accent} stopOpacity="0" />
        <stop offset="1" stopColor={C.accent} />
      </linearGradient>
    </defs>
    <path d="M40,300 Q300,40 560,300" fill="none" stroke="url(#trail-grad)" strokeWidth={2} strokeDasharray="4 6" />
    {[0.1, 0.3, 0.5, 0.7, 0.9].map((t) => {
      const x = 40 + 520 * t;
      const y = 300 - 4 * 65 * t * (1 - t);
      return <circle key={t} cx={x} cy={y} r={6} fill={C.accent} fillOpacity={0.3 + t * 0.7} />;
    })}
    <circle cx="560" cy="300" r="14" fill={C.accent} />
  </svg>
);

/** Open landscape — Act III product reveal */
const OpenLandscape: React.FC<{}> = () => (
  <svg viewBox="0 0 1200 720" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="land-grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#FAF1DD" />
        <stop offset="0.6" stopColor="#F0D9AA" />
        <stop offset="1" stopColor="#D5A06A" />
      </linearGradient>
      <radialGradient id="prod-glow" cx="50%" cy="40%">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect width="1200" height="720" fill="url(#land-grad)" />
    {/* layered hills */}
    <path d="M0,420 Q300,360 600,400 T1200,410 L1200,720 L0,720 Z" fill={C.gold} fillOpacity="0.45" />
    <path d="M0,520 Q300,470 600,510 T1200,520 L1200,720 L0,720 Z" fill={C.accent} fillOpacity="0.35" />
    <path d="M0,620 Q400,580 800,620 T1200,640 L1200,720 L0,720 Z" fill={C.ink} fillOpacity="0.85" />
    {/* path */}
    <path d="M600,720 Q580,600 600,520 Q620,440 600,360" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="6 8" fill="none" />
    {/* product as glowing object on horizon */}
    <ellipse cx="600" cy="360" rx="220" ry="120" fill="url(#prod-glow)" />
    <rect x="540" y="320" width="120" height="80" rx="10" fill={C.cream} stroke={C.ink} strokeWidth="1.5" />
    <line x1="552" y1="340" x2="640" y2="340" stroke={C.ink} strokeOpacity="0.4" />
    <line x1="552" y1="354" x2="620" y2="354" stroke={C.ink} strokeOpacity="0.3" />
    <line x1="552" y1="368" x2="630" y2="368" stroke={C.ink} strokeOpacity="0.3" />
    <line x1="552" y1="382" x2="600" y2="382" stroke={C.ink} strokeOpacity="0.2" />
  </svg>
);

/** Vertical wave — Act IV vision */
const WaveOfLight: React.FC<{}> = () => (
  <svg viewBox="0 0 1200 720" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="wave-grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#0A0A0C" />
        <stop offset="0.5" stopColor="#1A1A2E" />
        <stop offset="1" stopColor="#2A2545" />
      </linearGradient>
    </defs>
    <rect width="1200" height="720" fill="url(#wave-grad)" />
    {/* stars */}
    {Array.from({ length: 80 }).map((_, i) => (
      <circle
        key={i}
        cx={(i * 137) % 1200}
        cy={(i * 97) % 360}
        r={(i % 5 === 0 ? 1.6 : 1) * 1}
        fill="#FFE9C7"
        fillOpacity={0.3 + (i % 7) * 0.06}
      />
    ))}
    {/* rolling waves */}
    {[420, 470, 520, 575, 640].map((y, i) => (
      <path
        key={i}
        d={`M-50,${y} Q200,${y - 30 + i * 6} 600,${y} T1250,${y}`}
        fill="none"
        stroke="#FFE9C7"
        strokeOpacity={0.18 + i * 0.08}
        strokeWidth={i === 4 ? 1.4 : 1}
      />
    ))}
    {/* ember sun */}
    <circle cx="900" cy="240" r="80" fill="#FFD68C" fillOpacity="0.3" />
    <circle cx="900" cy="240" r="36" fill="#FFE9C7" />
  </svg>
);

/** Three-line silhouette — human-impact slide */
const VoicesSilhouette: React.FC<{}> = () => (
  <svg viewBox="0 0 600 300" className="w-full h-full">
    <defs>
      <linearGradient id="silh" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#F3E2C9" />
        <stop offset="1" stopColor="#D5A06A" />
      </linearGradient>
    </defs>
    <rect width="600" height="300" fill="url(#silh)" />
    {[120, 300, 480].map((cx, i) => (
      <g key={i} transform={`translate(${cx}, 130)`}>
        <ellipse cx="0" cy="0" r="36" fill={C.ink} />
        <path d={`M-44,160 L-30,46 L30,46 L44,160 Z`} fill={C.ink} />
      </g>
    ))}
    <path d="M0,260 L600,260" stroke={C.ink} strokeOpacity="0.2" />
  </svg>
);

/* ───────────────────────────── act dividers ─────────────────────── */

const ActDivider: React.FC<{ act: string; title: string; subtitle: string; bg?: string; tone?: string; step: number; total: number }> = ({
  act,
  title,
  subtitle,
  bg = C.ink,
  tone = '#fff',
  step,
  total,
}) => (
  <Frame bg={bg} text={tone} step={step} total={total} chapter={`Act ${act}`}>
    <div className="h-full flex flex-col justify-center max-w-[860px]">
      <div className="text-[11px] tracking-[0.42em] uppercase font-medium" style={{ color: bg === C.ink ? '#F7E2B5' : C.accent }}>
        Act {act}
      </div>
      <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 120, lineHeight: 1, color: tone }}>{title}</div>
      <div className="mt-6 text-[18px]" style={{ fontFamily: fontEditorial, color: bg === C.ink ? '#C9C4B8' : C.textSoft, fontStyle: 'italic' }}>
        {subtitle}
      </div>
    </div>
  </Frame>
);

/* ───────────────────────────── slides ──────────────────────────── */

type Edit = (p: (string | number)[], v: string) => void;

const S1Opening: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.ink} text="#fff" step={step} total={total} chapter={d.brand.name}>
    <div className="absolute inset-0 -z-0">
      <HorizonScene />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,10,12,0.0) 0%, rgba(10,10,12,0.8) 100%)' }} />
    </div>
    <div className="relative h-full flex flex-col justify-end pb-8">
      <Eyebrow color="#F7E2B5">
        <Editable value={d.opening.eyebrow} path={['opening', 'eyebrow']} onEdit={e} />
      </Eyebrow>
      <h1 className="leading-[0.96] tracking-[-0.02em]" style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 88, color: '#fff', maxWidth: 980 }}>
        <Editable value={d.opening.headline} path={['opening', 'headline']} onEdit={e} multiline />
      </h1>
      <div className="mt-6 text-[18px]" style={{ fontFamily: fontEditorial, color: '#C9C4B8', fontStyle: 'italic', maxWidth: 720 }}>
        <Editable value={d.opening.whisper} path={['opening', 'whisper']} onEdit={e} multiline />
      </div>
    </div>
  </Frame>
);

const S2Change: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame step={step} total={total} chapter="The Change">
    <div className="grid grid-cols-12 gap-10 h-full">
      <div className="col-span-7 flex flex-col justify-center">
        <Eyebrow>
          <Editable value={d.change.eyebrow} path={['change', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={64}>
          <Editable value={d.change.headline} path={['change', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-6">
          <Body size={18}>
            <Editable value={d.change.paragraph} path={['change', 'paragraph']} onEdit={e} multiline />
          </Body>
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          {d.change.motifs.map((m, i) => (
            <span
              key={i}
              className="px-3 py-1 rounded-full text-[11px] tracking-[0.18em] uppercase"
              style={{ background: '#fff', border: `1px solid ${C.paperWarm}`, color: C.textMuted, fontFamily: fontMono }}
            >
              <Editable value={m} path={['change', 'motifs', i]} onEdit={e} />
            </span>
          ))}
        </div>
      </div>
      <div className="col-span-5 flex items-center">
        <div className="w-full aspect-square rounded-md overflow-hidden" style={{ background: C.charcoal }}>
          <svg viewBox="0 0 360 360" className="w-full h-full">
            <defs>
              <radialGradient id="change-g" cx="50%" cy="50%">
                <stop offset="0" stopColor={C.accent} stopOpacity={0.8} />
                <stop offset="1" stopColor={C.accent} stopOpacity={0} />
              </radialGradient>
            </defs>
            <rect width="360" height="360" fill={C.ink} />
            <circle cx="180" cy="180" r="120" fill="url(#change-g)" />
            {[0.3, 0.5, 0.7, 0.9].map((r, i) => (
              <circle key={i} cx="180" cy="180" r={r * 120} fill="none" stroke="#F7E2B5" strokeOpacity={0.5 - i * 0.1} />
            ))}
            <text x="180" y="184" textAnchor="middle" fontFamily={fontDisplay} fontSize="36" fontWeight={700} fill="#fff">
              now
            </text>
          </svg>
        </div>
      </div>
    </div>
  </Frame>
);

const S3Tension: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.ink} text="#fff" step={step} total={total} chapter="The Tension">
    <div className="absolute inset-0 opacity-90">
      <FragmentedGlass />
    </div>
    <div className="relative h-full grid grid-cols-12 gap-8">
      <div className="col-span-7 flex flex-col justify-end pb-4">
        <Eyebrow color="#F7E2B5">
          <Editable value={d.tension.eyebrow} path={['tension', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={64} color="#fff">
          <Editable value={d.tension.headline} path={['tension', 'headline']} onEdit={e} multiline />
        </Display>
      </div>
      <div className="col-span-5 flex flex-col justify-end pb-4 space-y-2">
        {d.tension.fragments.map((f, i) => (
          <div key={i} className="px-4 py-3 rounded-sm" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="text-[10px] tracking-[0.28em] uppercase mb-1" style={{ color: '#F7E2B5', fontFamily: fontMono }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div className="text-[14px]" style={{ fontFamily: fontEditorial, fontStyle: 'italic', color: '#E8E1D2' }}>
              <Editable value={f} path={['tension', 'fragments', i]} onEdit={e} multiline />
            </div>
          </div>
        ))}
      </div>
    </div>
  </Frame>
);

const S4Human: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame step={step} total={total} chapter="Human Impact">
    <div className="h-full grid grid-cols-12 gap-10">
      <div className="col-span-5 flex flex-col justify-center">
        <Eyebrow>
          <Editable value={d.human_impact.eyebrow} path={['human_impact', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={56}>
          <Editable value={d.human_impact.headline} path={['human_impact', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-6 h-[160px] rounded-md overflow-hidden">
          <VoicesSilhouette />
        </div>
      </div>
      <div className="col-span-7 flex flex-col justify-center space-y-5">
        {d.human_impact.voices.map((v, i) => (
          <div key={i} className="flex gap-5 items-start">
            <div className="text-[64px] leading-none" style={{ color: C.accent, fontFamily: fontDisplay }}>
              "
            </div>
            <div>
              <div className="text-[19px] leading-snug" style={{ fontFamily: fontEditorial, color: C.ink }}>
                <Editable value={v.quote} path={['human_impact', 'voices', i, 'quote']} onEdit={e} multiline />
              </div>
              <div className="mt-2 text-[12px] tracking-[0.14em] uppercase" style={{ color: C.textMuted, fontFamily: fontMono }}>
                <Editable value={v.name} path={['human_impact', 'voices', i, 'name']} onEdit={e} /> ·{' '}
                <Editable value={v.role} path={['human_impact', 'voices', i, 'role']} onEdit={e} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </Frame>
);

const S5Insight: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.cream} step={step} total={total} chapter="The Insight">
    <div className="h-full grid grid-cols-12 gap-10">
      <div className="col-span-7 flex flex-col justify-center">
        <Eyebrow color={C.gold}>
          <Editable value={d.insight.eyebrow} path={['insight', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={64}>
          <Editable value={d.insight.headline} path={['insight', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-6">
          <Body size={17}>
            <Editable value={d.insight.body} path={['insight', 'body']} onEdit={e} multiline />
          </Body>
        </div>
      </div>
      <div className="col-span-5 flex items-center">
        <div className="relative px-8 py-10 w-full" style={{ borderLeft: `2px solid ${C.gold}` }}>
          <div className="absolute -left-3 -top-3 text-[80px] leading-none" style={{ color: C.gold, fontFamily: fontDisplay }}>
            "
          </div>
          <div className="text-[28px] leading-[1.18]" style={{ fontFamily: fontDisplay, fontStyle: 'italic', color: C.ink }}>
            <Editable value={d.insight.pull_quote} path={['insight', 'pull_quote']} onEdit={e} multiline />
          </div>
        </div>
      </div>
    </div>
  </Frame>
);

const S6Philosophy: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame step={step} total={total} chapter="The Philosophy">
    <div className="h-full grid grid-cols-12 gap-10">
      <div className="col-span-5 flex flex-col justify-center">
        <Eyebrow>
          <Editable value={d.philosophy.eyebrow} path={['philosophy', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={56}>
          <Editable value={d.philosophy.headline} path={['philosophy', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-6 h-[140px]">
          <SunTrail />
        </div>
      </div>
      <div className="col-span-7 flex flex-col justify-center">
        <div className="grid grid-cols-2 gap-x-10 gap-y-8">
          {d.philosophy.principles.map((p, i) => (
            <div key={i} className="pb-6" style={{ borderBottom: `1px solid ${C.paperWarm}` }}>
              <div className="text-[10px] tracking-[0.32em] uppercase mb-2" style={{ color: C.accent, fontFamily: fontMono }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="text-[26px] leading-tight" style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.ink }}>
                <Editable value={p.word} path={['philosophy', 'principles', i, 'word']} onEdit={e} />
              </div>
              <div className="mt-2 text-[14px]" style={{ fontFamily: fontEditorial, color: C.textSoft }}>
                <Editable value={p.line} path={['philosophy', 'principles', i, 'line']} onEdit={e} multiline />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </Frame>
);

const S7Mission: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.dusk} text="#fff" step={step} total={total} chapter="The Mission">
    <div className="h-full flex flex-col justify-center max-w-[900px]">
      <Eyebrow color="#F7E2B5">
        <Editable value={d.mission.eyebrow} path={['mission', 'eyebrow']} onEdit={e} />
      </Eyebrow>
      <Display size={74} color="#fff">
        <Editable value={d.mission.headline} path={['mission', 'headline']} onEdit={e} multiline />
      </Display>
      <div className="mt-8">
        <Body size={19} color="#D7CFB9">
          <Editable value={d.mission.paragraph} path={['mission', 'paragraph']} onEdit={e} multiline />
        </Body>
      </div>
      <div className="mt-10 text-[12px] tracking-[0.32em] uppercase" style={{ color: '#F7E2B5', fontFamily: fontMono }}>
        Horizon · <Editable value={d.mission.horizon} path={['mission', 'horizon']} onEdit={e} />
      </div>
    </div>
  </Frame>
);

const S8Movement: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.dusk} text="#fff" step={step} total={total} chapter="The Movement">
    <div className="absolute inset-0">
      <ConstellationCommunity />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(31,41,64,0.95) 0%, rgba(31,41,64,0.55) 50%, rgba(31,41,64,0.2) 100%)' }} />
    </div>
    <div className="relative h-full grid grid-cols-12 gap-10">
      <div className="col-span-7 flex flex-col justify-center">
        <Eyebrow color="#F7E2B5">
          <Editable value={d.movement.eyebrow} path={['movement', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={64} color="#fff">
          <Editable value={d.movement.headline} path={['movement', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-6">
          <Body size={17} color="#D7CFB9">
            <Editable value={d.movement.paragraph} path={['movement', 'paragraph']} onEdit={e} multiline />
          </Body>
        </div>
      </div>
      <div className="col-span-5 flex flex-col justify-center">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {d.movement.members.map((m, i) => (
            <div key={i} className="flex items-baseline gap-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="text-[10px] tracking-[0.24em] uppercase" style={{ color: '#F7E2B5', fontFamily: fontMono }}>
                <Editable value={m.kind} path={['movement', 'members', i, 'kind']} onEdit={e} />
              </span>
              <span className="text-[14px]" style={{ fontFamily: fontEditorial, color: '#fff', fontStyle: 'italic' }}>
                <Editable value={m.name} path={['movement', 'members', i, 'name']} onEdit={e} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </Frame>
);

const S9Product: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame step={step} total={total} chapter="The Product">
    <div className="h-full grid grid-cols-12 gap-10">
      <div className="col-span-6 flex flex-col justify-center">
        <Eyebrow>
          <Editable value={d.product.eyebrow} path={['product', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={66}>
          <Editable value={d.product.headline} path={['product', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-6">
          <Body size={17}>
            <Editable value={d.product.paragraph} path={['product', 'paragraph']} onEdit={e} multiline />
          </Body>
        </div>
        <div className="mt-8 space-y-2">
          {d.product.transforms.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-4 items-baseline">
              <div className="text-[14px]" style={{ fontFamily: fontEditorial, color: C.textMuted, textDecoration: 'line-through', textDecorationThickness: '1.5px' }}>
                <Editable value={t.from} path={['product', 'transforms', i, 'from']} onEdit={e} />
              </div>
              <div className="text-[15px] font-medium" style={{ fontFamily: fontEditorial, color: C.ink }}>
                → <Editable value={t.to} path={['product', 'transforms', i, 'to']} onEdit={e} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-6">
        <div className="w-full h-full rounded-md overflow-hidden">
          <OpenLandscape />
        </div>
      </div>
    </div>
  </Frame>
);

const S10Experience: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.cream} step={step} total={total} chapter="The Experience">
    <div className="h-full flex flex-col">
      <Eyebrow>
        <Editable value={d.experience.eyebrow} path={['experience', 'eyebrow']} onEdit={e} />
      </Eyebrow>
      <Display size={56}>
        <Editable value={d.experience.headline} path={['experience', 'headline']} onEdit={e} multiline />
      </Display>
      <div className="mt-10 relative flex-1">
        {/* timeline thread */}
        <div className="absolute left-0 right-0 top-12 h-px" style={{ background: C.accent }} />
        <div className="grid grid-cols-5 gap-6 mt-2">
          {d.experience.chapters.map((c, i) => (
            <div key={i} className="relative pt-16">
              <div
                className="absolute top-7 left-0 w-5 h-5 rounded-full"
                style={{ background: C.cream, border: `2px solid ${C.accent}` }}
              />
              <div className="text-[10px] tracking-[0.32em] uppercase mb-2" style={{ color: C.accent, fontFamily: fontMono }}>
                Ch. {String(i + 1).padStart(2, '0')}
              </div>
              <div className="text-[20px] leading-tight" style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.ink }}>
                <Editable value={c.title} path={['experience', 'chapters', i, 'title']} onEdit={e} />
              </div>
              <div className="mt-2 text-[13px]" style={{ fontFamily: fontEditorial, color: C.textSoft }}>
                <Editable value={c.line} path={['experience', 'chapters', i, 'line']} onEdit={e} multiline />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </Frame>
);

const S11Proof: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame step={step} total={total} chapter="The Proof">
    <div className="h-full grid grid-cols-12 gap-10">
      <div className="col-span-5 flex flex-col justify-center">
        <Eyebrow>
          <Editable value={d.proof.eyebrow} path={['proof', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={60}>
          <Editable value={d.proof.headline} path={['proof', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-8 grid grid-cols-2 gap-4">
          {d.proof.stat_strip.map((s, i) => (
            <div key={i} className="pb-4" style={{ borderBottom: `1px solid ${C.paperWarm}` }}>
              <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 42, color: C.ink, lineHeight: 1 }}>
                <Editable value={s.value} path={['proof', 'stat_strip', i, 'value']} onEdit={e} />
              </div>
              <div className="mt-1 text-[11px] tracking-[0.18em] uppercase" style={{ color: C.textMuted, fontFamily: fontMono }}>
                <Editable value={s.label} path={['proof', 'stat_strip', i, 'label']} onEdit={e} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-7 flex flex-col justify-center space-y-6">
        {d.proof.testimonials.map((t, i) => (
          <div key={i} className="pl-6" style={{ borderLeft: `2px solid ${C.accent}` }}>
            <div className="text-[20px] leading-[1.3]" style={{ fontFamily: fontDisplay, fontStyle: 'italic', color: C.ink }}>
              <Editable value={t.quote} path={['proof', 'testimonials', i, 'quote']} onEdit={e} multiline />
            </div>
            <div className="mt-3 text-[11px] tracking-[0.18em] uppercase" style={{ color: C.textMuted, fontFamily: fontMono }}>
              <Editable value={t.name} path={['proof', 'testimonials', i, 'name']} onEdit={e} /> ·{' '}
              <Editable value={t.place} path={['proof', 'testimonials', i, 'place']} onEdit={e} />
            </div>
          </div>
        ))}
      </div>
    </div>
  </Frame>
);

const S12Impact: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => {
  const toneColor = (t: 'human' | 'environmental' | 'economic') =>
    t === 'human' ? C.accent : t === 'environmental' ? C.emerald : C.gold;
  const toneSoft = (t: 'human' | 'environmental' | 'economic') =>
    t === 'human' ? C.accentSoft : t === 'environmental' ? C.emeraldSoft : C.goldSoft;
  return (
    <Frame step={step} total={total} chapter="The Impact">
      <div className="h-full grid grid-cols-12 gap-8">
        <div className="col-span-4 flex flex-col justify-center">
          <Eyebrow>
            <Editable value={d.impact.eyebrow} path={['impact', 'eyebrow']} onEdit={e} />
          </Eyebrow>
          <Display size={56}>
            <Editable value={d.impact.headline} path={['impact', 'headline']} onEdit={e} multiline />
          </Display>
        </div>
        <div className="col-span-8 grid grid-rows-3 gap-3">
          {d.impact.pillars.map((p, i) => (
            <div key={i} className="rounded-md p-6 flex items-center gap-6" style={{ background: toneSoft(p.tone) }}>
              <div className="text-[10px] tracking-[0.32em] uppercase font-semibold w-32 shrink-0" style={{ color: toneColor(p.tone), fontFamily: fontMono }}>
                {p.tone}
              </div>
              <div className="flex-1">
                <div className="text-[22px] leading-tight" style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.ink }}>
                  <Editable value={p.headline} path={['impact', 'pillars', i, 'headline']} onEdit={e} />
                </div>
                <div className="mt-1 text-[14px]" style={{ fontFamily: fontEditorial, color: C.textSoft }}>
                  <Editable value={p.line} path={['impact', 'pillars', i, 'line']} onEdit={e} multiline />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
};

const S13Opportunity: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame step={step} total={total} chapter="The Opportunity">
    <div className="h-full grid grid-cols-12 gap-10">
      <div className="col-span-7 flex flex-col justify-center">
        <Eyebrow>
          <Editable value={d.opportunity.eyebrow} path={['opportunity', 'eyebrow']} onEdit={e} />
        </Eyebrow>
        <Display size={60}>
          <Editable value={d.opportunity.headline} path={['opportunity', 'headline']} onEdit={e} multiline />
        </Display>
        <div className="mt-6">
          <Body size={17}>
            <Editable value={d.opportunity.paragraph} path={['opportunity', 'paragraph']} onEdit={e} multiline />
          </Body>
        </div>
      </div>
      <div className="col-span-5 flex flex-col justify-center space-y-3">
        {d.opportunity.horizons.map((h, i) => (
          <div
            key={i}
            className="flex gap-4 items-baseline p-4"
            style={{ background: '#fff', border: `1px solid ${C.paperWarm}` }}
          >
            <span style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 36, color: C.accent, lineHeight: 1 }}>{i + 1}</span>
            <span className="text-[15px]" style={{ fontFamily: fontEditorial, color: C.ink }}>
              <Editable value={h} path={['opportunity', 'horizons', i]} onEdit={e} multiline />
            </span>
          </div>
        ))}
      </div>
    </div>
  </Frame>
);

const S14Vision: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.ink} text="#fff" step={step} total={total} chapter="Vision">
    <div className="absolute inset-0">
      <WaveOfLight />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,10,12,0.1) 0%, rgba(10,10,12,0.7) 100%)' }} />
    </div>
    <div className="relative h-full flex flex-col justify-end pb-6">
      <Eyebrow color="#F7E2B5">
        <Editable value={d.vision.eyebrow} path={['vision', 'eyebrow']} onEdit={e} />
      </Eyebrow>
      <Display size={86} color="#fff">
        <Editable value={d.vision.headline} path={['vision', 'headline']} onEdit={e} multiline />
      </Display>
      <div className="mt-6 max-w-[760px]">
        <Body size={19} color="#D7CFB9">
          <Editable value={d.vision.paragraph} path={['vision', 'paragraph']} onEdit={e} multiline />
        </Body>
      </div>
    </div>
  </Frame>
);

const S15Manifesto: React.FC<{ d: NarrativeData; e: Edit; step: number; total: number }> = ({ d, e, step, total }) => (
  <Frame bg={C.accent} text="#fff" step={step} total={total} chapter="The Invitation">
    <div className="h-full flex flex-col justify-center max-w-[920px]">
      <Eyebrow color="#FFE9C7">
        <Editable value={d.manifesto.eyebrow} path={['manifesto', 'eyebrow']} onEdit={e} />
      </Eyebrow>
      <div className="space-y-3">
        {d.manifesto.lines.map((l, i) => (
          <div
            key={i}
            className="leading-[1.04]"
            style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 56, color: '#fff', letterSpacing: '-0.02em' }}
          >
            <Editable value={l} path={['manifesto', 'lines', i]} onEdit={e} multiline />
          </div>
        ))}
      </div>
      <div className="mt-10 text-[22px]" style={{ fontFamily: fontEditorial, fontStyle: 'italic', color: '#FFE9C7' }}>
        <Editable value={d.manifesto.signoff} path={['manifesto', 'signoff']} onEdit={e} />
      </div>
      <div className="mt-2 text-[16px]" style={{ fontFamily: fontEditorial, color: '#FFE9C7' }}>
        <Editable value={d.manifesto.cta_line} path={['manifesto', 'cta_line']} onEdit={e} />
      </div>
      <div className="mt-6 text-[11px] tracking-[0.32em] uppercase" style={{ color: '#FFD68C', fontFamily: fontMono }}>
        <Editable value={d.manifesto.contact} path={['manifesto', 'contact']} onEdit={e} />
      </div>
    </div>
  </Frame>
);

/* ───────────────────────────── deck shell ───────────────────────── */

export const NarrativeBrandDeckApp: React.FC<{ initial?: NarrativeData }> = ({ initial = SAMPLE_DATA }) => {
  const [data, setData] = useState<NarrativeData>(initial);
  const [idx, setIdx] = useState(0);
  const onEdit = useCallback((p: (string | number)[], v: string) => setData((prev) => setIn(prev, p, v)), []);

  const slides = useMemo(() => {
    const arr: Array<(p: { step: number; total: number }) => React.ReactNode> = [];
    // Act I — The World
    arr.push((p) => <ActDivider act="I" title="The World" subtitle="Where we begin." {...p} />);
    arr.push((p) => <S1Opening d={data} e={onEdit} {...p} />);
    arr.push((p) => <S2Change d={data} e={onEdit} {...p} />);
    arr.push((p) => <S3Tension d={data} e={onEdit} {...p} />);
    arr.push((p) => <S4Human d={data} e={onEdit} {...p} />);
    // Act II — The Belief
    arr.push((p) => <ActDivider act="II" title="The Belief" subtitle="What we have come to believe." bg={C.dusk} {...p} />);
    arr.push((p) => <S5Insight d={data} e={onEdit} {...p} />);
    arr.push((p) => <S6Philosophy d={data} e={onEdit} {...p} />);
    arr.push((p) => <S7Mission d={data} e={onEdit} {...p} />);
    arr.push((p) => <S8Movement d={data} e={onEdit} {...p} />);
    // Act III — The Solution
    arr.push((p) => <ActDivider act="III" title="The Solution" subtitle="What we have built — together." bg={C.cream} tone={C.ink} {...p} />);
    arr.push((p) => <S9Product d={data} e={onEdit} {...p} />);
    arr.push((p) => <S10Experience d={data} e={onEdit} {...p} />);
    arr.push((p) => <S11Proof d={data} e={onEdit} {...p} />);
    arr.push((p) => <S12Impact d={data} e={onEdit} {...p} />);
    // Act IV — The Future
    arr.push((p) => <ActDivider act="IV" title="The Future" subtitle="Where we go from here." {...p} />);
    arr.push((p) => <S13Opportunity d={data} e={onEdit} {...p} />);
    arr.push((p) => <S14Vision d={data} e={onEdit} {...p} />);
    arr.push((p) => <S15Manifesto d={data} e={onEdit} {...p} />);
    return arr;
  }, [data, onEdit]);

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
    <div className="w-screen h-screen flex items-center justify-center" style={{ background: '#1A1A1E' }}>
      <div
        className="relative shadow-2xl"
        style={{
          width: 'min(96vw, calc(96vh * 16 / 9))',
          aspectRatio: '16 / 9',
          background: C.paper,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute inset-0"
          >
            {slides[idx]({ step: idx + 1, total })}
          </motion.div>
        </AnimatePresence>
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(247,243,236,0.95)', boxShadow: '0 4px 18px rgba(0,0,0,0.18)' }}
        >
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} className="px-2 py-1 text-sm">
            ◀
          </button>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{ background: i === idx ? C.accent : C.paperWarm, transform: i === idx ? 'scale(1.7)' : 'scale(1)' }}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
          <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))} className="px-2 py-1 text-sm">
            ▶
          </button>
        </div>
      </div>
    </div>
  );
};

export default NarrativeBrandDeckApp;

/* ──────────────────── sample data + Axal binding ────────────────── */
/*
 * Field names mirror heuristicSlides() output after Prompt MD's
 * additive migration plus brand-narrative supporting tables
 * (brand_principles, brand_voices, community_members, impact_pillars).
 *
 * Mapping:
 *   projects.name / tagline                            → brand.name / brand.tagline
 *   projects.opening_line / vision_sentence            → opening.headline / vision.headline
 *   projects.mission                                    → mission.headline / mission.paragraph
 *   projects.category                                   → opening.eyebrow
 *   projects.problem_statement                          → change.paragraph / tension.headline
 *   projects.insight                                    → insight.headline / insight.body
 *   projects.pull_quote                                 → insight.pull_quote
 *   brand_principles                                    → philosophy.principles
 *   community_members (kind, name)                      → movement.members
 *   projects.transformations_json                       → product.transforms
 *   projects.experience_chapters_json                   → experience.chapters
 *   advisor_answers (tag=testimonial) + customer_*       → proof.testimonials, human_impact.voices
 *   metrics_snapshots                                    → proof.stat_strip
 *   impact_pillars (tone, headline, line)               → impact.pillars
 *   projects.horizons_json                              → opportunity.horizons
 *   projects.manifesto_lines_json                        → manifesto.lines
 *   projects.cta_line / contact_email                    → manifesto.cta_line / manifesto.contact
 *   users.email (primary founder)                        → fallback contact
 *
 * Empty fields fall through to "—" per heuristicSlides() convention.
 */

export const SAMPLE_DATA: NarrativeData = {
  brand: {
    name: 'Loopline',
    mark: 'L',
    tagline: 'For the teams who refuse to settle for the way it has always been done.',
    confidential: 'Brand narrative',
    presented_on: 'May 2026',
  },
  opening: {
    eyebrow: 'A new chapter for revenue teams',
    headline: 'Somewhere along the way, work forgot the people doing it.',
    whisper: 'This is the story of how we set out to remember.',
  },
  change: {
    eyebrow: 'The Change',
    headline: 'The world of work is rewriting itself in real time.',
    paragraph:
      'A new generation is no longer willing to be measured in dashboards they cannot move. They expect the tools they use to think with them, not for them — to make their best work easier and their hardest days kinder. That expectation is not a trend. It is the new floor.',
    motifs: ['Distributed', 'Async', 'AI-native', 'Outcome-priced', 'Human-first'],
  },
  tension: {
    eyebrow: 'The Tension',
    headline: 'And yet — most days at work still feel like running through wet sand.',
    fragments: [
      'Seventeen tabs and no idea what to do first.',
      'A forecast that updates only after the deal has slipped.',
      'Coaching reserved for the people who already win.',
      'Late nights logging information for a system that gives nothing back.',
    ],
  },
  human_impact: {
    eyebrow: 'Human Impact',
    headline: 'Behind every metric is a person who deserved better tools.',
    voices: [
      {
        quote:
          'I used to spend Sundays writing the same emails I had already sent. Loopline didn\'t just save me time. It gave me my weekends back.',
        name: 'Mia C.',
        role: 'Account Executive · Mid-market',
      },
      {
        quote:
          'I coached the top performers because I had bandwidth for nothing else. The rest of my team grew alone, in silence.',
        name: 'Jonas B.',
        role: 'VP Sales · Continental Europe',
      },
      {
        quote:
          'I joined this company to build something. Instead I administer it. That has to change.',
        name: 'Priya P.',
        role: 'Head of Revenue · Growth-stage SaaS',
      },
    ],
  },
  insight: {
    eyebrow: 'The Insight',
    headline: 'The next platform shift is not a tool — it is a teammate.',
    body:
      'The CRM was built when the question was "where did the deal go?" We are building for a different question — "what should I do next, and who should I bring?" When software answers that question well, work stops being administration and starts being craft again.',
    pull_quote: 'A great teammate makes everyone around them better. Software should do the same.',
  },
  philosophy: {
    eyebrow: 'The Philosophy',
    headline: 'What we believe — written down, on purpose.',
    principles: [
      { word: 'Quiet craft', line: 'The best work is unnoticeable. Tools should make people look brilliant, not busy.' },
      { word: 'Evidence over opinion', line: 'Every claim earns its place with the data that justifies it.' },
      { word: 'Coaching for everyone', line: 'Growth is not a reward for the top 20%. It is a default for everyone.' },
      { word: 'Trust the operator', line: 'We build with founders and operators, not for some imagined buyer persona.' },
    ],
  },
  mission: {
    eyebrow: 'The Mission',
    headline: 'To make every revenue team in the world operate like the best one.',
    paragraph:
      'Not by replacing people with software. By giving every person the same access to insight, action and improvement that today only the very few enjoy. We do not want to win an industry. We want to lift one.',
    horizon: 'The next decade · ten million teams',
  },
  movement: {
    eyebrow: 'The Movement',
    headline: 'A community of people who refused to accept that work had to feel this way.',
    paragraph:
      'Operators, founders, partners and customers building shoulder-to-shoulder. We make decisions in the open, share learnings publicly, and credit the people whose questions shape what we ship.',
    members: [
      { kind: 'Founders', name: 'Sofia Marquez, Daniel Okafor' },
      { kind: 'Operators', name: '142 active companies' },
      { kind: 'Customers', name: 'Northwind, Acme, Globex' },
      { kind: 'Partners', name: 'Stripe, Salesforce ISV, AWS' },
      { kind: 'Advisors', name: 'Lawson, Young, Rachitsky' },
      { kind: 'Community', name: '4,800 operators on Slack' },
      { kind: 'Investors', name: 'Initialized Capital + angels' },
      { kind: 'Alumni', name: 'Plaid, Stripe, Linear' },
    ],
  },
  product: {
    eyebrow: 'The Product',
    headline: 'A teammate, not another tab.',
    paragraph:
      'Loopline does the work between deals — the reading, the drafting, the routing, the remembering — so the people doing the work can do the part only they can do.',
    transforms: [
      { from: 'Seventeen tabs', to: 'One workspace, every signal' },
      { from: 'Forgotten follow-up', to: 'A draft, waiting for one click' },
      { from: 'Forecast = vibes', to: 'Forecast = math + signal' },
      { from: 'Top-rep coaching', to: 'Every rep, coached every call' },
      { from: 'CRM as chore', to: 'CRM as teammate' },
    ],
  },
  experience: {
    eyebrow: 'The Experience',
    headline: 'A day spent doing the work that mattered.',
    chapters: [
      { title: 'Morning brief', line: 'The three deals that needed you, summarized over coffee.' },
      { title: 'First touch', line: 'A draft email, in your voice, waiting for approval.' },
      { title: 'On the call', line: 'A real-time prompt when the buyer signals the next objection.' },
      { title: 'After the call', line: 'The follow-up plan written before you leave the room.' },
      { title: 'End of day', line: 'A clean handoff to your CSM. Inbox at zero. Time to live.' },
    ],
  },
  proof: {
    eyebrow: 'The Proof',
    headline: 'People who would not let us go back.',
    stat_strip: [
      { value: '142', label: 'paying companies' },
      { value: '92%', label: 'six-month retention' },
      { value: '74', label: 'NPS — top decile' },
      { value: '11h', label: 'saved per rep per week' },
    ],
    testimonials: [
      {
        quote: 'It replaced four tools, two spreadsheets, and one full-time ops hire. We will never go back.',
        name: 'Jonas Becker',
        place: 'CRO · Acme',
      },
      {
        quote: 'My team thanks me for it. That has never happened with any sales tool.',
        name: 'Priya Patel',
        place: 'Head of Revenue · Globex',
      },
      {
        quote: 'I would pay five times what they charge. Please do not tell them.',
        name: 'Wei Zhang',
        place: 'Founder & CEO · Initech',
      },
    ],
  },
  impact: {
    eyebrow: 'The Impact',
    headline: 'Better work changes more than work.',
    pillars: [
      {
        tone: 'human',
        headline: 'Eleven hours back, every week.',
        line: '142 customers report a median 11h/wk recovered — time spent with family, on rest, on the work that matters.',
      },
      {
        tone: 'environmental',
        headline: 'Fewer flights. Less paper. Smaller footprint.',
        line: 'Async-first defaults reduced customer business travel by 38% and printed proposals to near zero.',
      },
      {
        tone: 'economic',
        headline: 'Compounding earnings for the people who do the work.',
        line: 'Mid-tier reps now reach quota at 1.6× the historical rate — and we see it in their pay.',
      },
    ],
  },
  opportunity: {
    eyebrow: 'The Opportunity',
    headline: 'A movement is not a market — but it does expand.',
    paragraph:
      'What works for revenue teams works, in turn, for customer success, for marketing operations, for partner ecosystems. The same operating layer, the same philosophy, applied to every team whose work is too important to leave to spreadsheets.',
    horizons: [
      'From revenue to customer success — the renewal copilot, live in 2026.',
      'From SMB to global enterprise — single-tenant, audit-grade, residency-aware.',
      'From English-first to ten languages — the same craft, every market.',
      'From product to ecosystem — a marketplace that lifts every operator in it.',
    ],
  },
  vision: {
    eyebrow: 'The Vision',
    headline: 'Ten million teams. One quieter, kinder, better day at work.',
    paragraph:
      'We do not need every team to become the same. We need every team to have the chance to become the best version of itself. That is the world we are building toward — and the one we are inviting you to build with us.',
  },
  manifesto: {
    eyebrow: 'The Invitation',
    lines: [
      'For the operator who refused to settle.',
      'For the team that wants to be better, not bigger.',
      'For the leader who measures success in people, not pipelines.',
      'This one is for you.',
    ],
    signoff: 'Welcome to Loopline.',
    cta_line: 'Come build the next chapter with us.',
    contact: 'hello@loopline.ai · loopline.ai',
  },
};
/* ──────────────────── registry adapter ──────────────────────────── */
// `Deck_narrative_brand_app` — wraps each of the 15 slides (4 act
// dividers + 11 content slides spread across acts I–IV) in <Slide16x9>
// so the platform print pipeline (PitchDeckPrintPage.jsx) can find
// each slide via the `[data-slide-frame]` hook and per-slide page
// breaks fire during window.print(). Mirrors the pattern from
// series_a_growth_app / series_b_diligence_app / demo_day_app /
// partnership_bd_app / sales_commercial_app / investor_appendix_app.
import { Slide16x9, type DeckProps as RegistryDeckProps } from '../DeckBase';

// Shape-safe merge: arrays in `incoming` only replace when non-empty,
// objects merge field-by-field, primitives override. Lets the
// platform pass partial NarrativeData (whatever fields autofill
// produced) without nuking the SAMPLE_DATA defaults the slide
// internals rely on.
function mergeShape<T>(base: T, incoming: any): T {
  if (incoming == null) return base;
  if (Array.isArray(base)) {
    return (Array.isArray(incoming) && incoming.length > 0 ? incoming : base) as unknown as T;
  }
  if (typeof base === 'object' && base !== null) {
    // Type-mismatch guard: a typed object base must never be replaced
    // by a non-object incoming (e.g. the editor's flat-field blob can
    // produce `data.proof = "The Proof"` as a string, which used to
    // clobber the entire nested object and crash slide internals with
    // `undefined is not an object (evaluating 'd.proof.stat_strip.map')`).
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

export const Deck_narrative_brand_app: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => (
  <BrandProvider data={data || {}} fallbackAccent="#C84A1F" fallbackBg="#F7F3EC" fallbackInk="#0A0A0C" fallbackFont="Inter, system-ui, sans-serif">
    <Deck_narrative_brand_app_inner data={data} editable={editable} onEdit={onEdit} />
  </BrandProvider>
);

const Deck_narrative_brand_app_inner: React.FC<RegistryDeckProps> = ({ data, editable, onEdit }) => {
  const merged = useMemo(
    () => mergeShape(SAMPLE_DATA, data || {}) as NarrativeData,
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

  // 4 act dividers + 15 content slides = 19 frames. The source file's
  // header docstring counts only the content slides ("15 in 4 acts");
  // the actual deck shell (and this adapter) emits the dividers as
  // standalone full-bleed slides, matching how every other cinematic
  // template counts its section cards. We build a factory list first so
  // `total` derives from the actual length — registry + slide numbering
  // can't drift if a future slide is added or removed.
  type SlideFactory = (p: { step: number; total: number }) => React.ReactNode;
  const factories: SlideFactory[] = [
    // Act I — The World
    (p) => <ActDivider act="I"   title="The World"    subtitle="Where we begin." {...p} />,
    (p) => <S1Opening   d={merged} e={handleEdit} {...p} />,
    (p) => <S2Change    d={merged} e={handleEdit} {...p} />,
    (p) => <S3Tension   d={merged} e={handleEdit} {...p} />,
    (p) => <S4Human     d={merged} e={handleEdit} {...p} />,
    // Act II — The Belief
    (p) => <ActDivider act="II"  title="The Belief"   subtitle="What we have come to believe." bg={C.dusk} {...p} />,
    (p) => <S5Insight   d={merged} e={handleEdit} {...p} />,
    (p) => <S6Philosophy d={merged} e={handleEdit} {...p} />,
    (p) => <S7Mission   d={merged} e={handleEdit} {...p} />,
    (p) => <S8Movement  d={merged} e={handleEdit} {...p} />,
    // Act III — The Solution
    (p) => <ActDivider act="III" title="The Solution" subtitle="What we have built — together." bg={C.cream} tone={C.ink} {...p} />,
    (p) => <S9Product    d={merged} e={handleEdit} {...p} />,
    (p) => <S10Experience d={merged} e={handleEdit} {...p} />,
    (p) => <S11Proof     d={merged} e={handleEdit} {...p} />,
    (p) => <S12Impact    d={merged} e={handleEdit} {...p} />,
    // Act IV — The Future
    (p) => <ActDivider act="IV"  title="The Future"   subtitle="Where we go from here." {...p} />,
    (p) => <S13Opportunity d={merged} e={handleEdit} {...p} />,
    (p) => <S14Vision    d={merged} e={handleEdit} {...p} />,
    (p) => <S15Manifesto d={merged} e={handleEdit} {...p} />,
  ];
  const total = factories.length;

  return (
    <>
      {factories.map((make, i) => (
        <Slide16x9 key={i} bg={C.paper} ink={C.ink} font={fontSans}>
          {make({ step: i + 1, total })}
        </Slide16x9>
      ))}
    </>
  );
};
