import React, { createContext, useContext } from 'react';

export type DeckData = Record<string, any>;

export interface DeckProps {
  data: DeckData;
  editable?: boolean;
  onEdit?: (path: string, value: string) => void;
  currentSlide?: number;
}

// ------------------------------------------------------------------
// Task #6 — Brand context for passing brand values down to all slides
// ------------------------------------------------------------------
export interface BrandContextValue {
  accent: string | null;
  bg: string | null;
  ink: string | null;
  font: string | null;
  logoUrl: string | null;
  logoSvg: string | null;
  theme: string | null;
}
export const BrandContext = createContext<BrandContextValue>({
  accent: null, bg: null, ink: null, font: null, logoUrl: null, logoSvg: null, theme: null,
});
export const useBrandContext = () => useContext(BrandContext);

export function BrandProvider({ data, fallbackAccent, fallbackBg, fallbackInk, fallbackFont, children }: {
  data: DeckData;
  fallbackAccent: string;
  fallbackBg?: string;
  fallbackInk?: string;
  fallbackFont?: string;
  children: React.ReactNode;
}) {
  const kit = useBrandKit(data);
  const value: BrandContextValue = {
    accent: kit.accent || fallbackAccent,
    bg: kit.bg || fallbackBg || null,
    ink: kit.ink || fallbackInk || null,
    font: brandFont(data, fallbackFont || 'Inter, system-ui, sans-serif'),
    logoUrl: kit.logoUrl,
    logoSvg: kit.logoSvg,
    theme: kit.theme,
  };
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export const Slide16x9: React.FC<React.PropsWithChildren<{
  bg?: string; ink?: string; font?: string; className?: string;
}>> = ({ bg = '#FFFFFF', ink = '#0F172A', font = 'Inter, system-ui, sans-serif', className = '', children }) => (
  <div
    data-slide-frame=""
    className={`relative ${className}`}
    style={{
      width: 1920, height: 1080, background: bg, color: ink,
      fontFamily: font, padding: 96, display: 'flex', flexDirection: 'column',
      pageBreakAfter: 'always',
    }}>
    {children}
  </div>
);

export const Editable: React.FC<{
  value: string; path: string; editable?: boolean; onEdit?: (p: string, v: string) => void;
  placeholder?: string; className?: string; style?: React.CSSProperties;
  as?: 'div' | 'span' | 'h1' | 'h2' | 'h3' | 'p';
}> = ({ value, path, editable, onEdit, placeholder, className, style, as = 'div' }) => {
  const Tag: any = as;
  return (
    <Tag
      contentEditable={!!editable} suppressContentEditableWarning
      onBlur={(e: any) => onEdit?.(path, e.currentTarget.textContent || '')}
      className={className}
      style={{ outline: 'none', minHeight: '1em', color: !value ? '#94A3B8' : style?.color, ...style }}>
      {value || placeholder || ''}
    </Tag>
  );
};

export const v = (data: DeckData, path: string, fallback = '') => {
  const keys = path.split('.');
  let cur: any = data;
  for (const k of keys) {
    if (cur == null) return fallback;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return fallback;
    cur = cur[k]; // codeql[js/prototype-polluting-function] -- read-only deck-data walk; __proto__/constructor/prototype rejected above, returns value/fallback
  }
  return cur ?? fallback;
};

export const fmtUSD = (n: any) =>
  typeof n === 'number' ? `$${n.toLocaleString()}` : (n ? String(n) : '—');
export const fmtPct = (n: any) =>
  typeof n === 'number' ? `${n}%` : (n ? String(n) : '—');
export const fmtNum = (n: any) =>
  typeof n === 'number' ? n.toLocaleString() : (n ? String(n) : '—');

// ------------------------------------------------------------------
// Task #6 — shared brand-kit helpers
// ------------------------------------------------------------------
const HEX_RE = /^#?([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const normHex = (h: string) => {
  const s = h.trim().replace(/^#/, '');
  if (s.length === 3) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (s.length === 4) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (s.length === 6) return `#${s}`;
  return `#${s.slice(0, 6)}`;
};
const sanitizeHex = (v: unknown, fallback: string): string =>
  (typeof v === 'string' && HEX_RE.test(v.trim())) ? normHex(v) : fallback;
const hexToRgb = (h: string): [number, number, number] => {
  const s = normHex(h);
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
};
const toHex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const rgbToHex = (r: number, g: number, b: number) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a); const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
};
const relLum = (h: string): number => {
  const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hexToRgb(h);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: string, b: string): number => {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export type BrandKit = {
  present: boolean;
  logoUrl: string | null;
  logoSvg: string | null;
  theme: string | null;
  bg: string | null;
  ink: string | null;
  accent: string | null;
  fonts: string | null;
};

export function useBrandKit(data: DeckData): BrandKit {
  const present = !!data?.brandkit_present && String(data.brandkit_present) !== 'false';
  return {
    present,
    logoUrl: present ? (data.brandkit_logo_url || null) : null,
    logoSvg: present ? (data.brandkit_logo_svg || null) : null,
    theme: present ? (data.brandkit_theme || null) : null,
    bg: present ? sanitizeHex(data.brandkit_bg, null as any) : null,
    ink: present ? sanitizeHex(data.brandkit_ink, null as any) : null,
    accent: present ? sanitizeHex(data.brandkit_accent, null as any) : null,
    fonts: present ? (data.brandkit_fonts || null) : null,
  };
}

export function brandAccent(data: DeckData, fallback: string): string {
  const kit = useBrandKit(data);
  return kit.accent || fallback;
}

export function brandPalette(data: DeckData, fallback: { bg: string; ink: string; accent: string }) {
  const kit = useBrandKit(data);
  const bg = sanitizeHex(kit.bg || '', fallback.bg);
  const isDark = relLum(bg) < 0.4;
  const safeInk = isDark ? '#F7F4FF' : '#15102A';
  let ink = sanitizeHex(kit.ink || '', safeInk);
  if (contrast(ink, bg) < 4.5) ink = safeInk;
  let accent = sanitizeHex(kit.accent || '', fallback.accent);
  if (contrast(accent, bg) < 3) {
    accent = isDark ? mix(accent, '#ffffff', 0.45) : mix(accent, '#000000', 0.2);
    if (contrast(accent, bg) < 3) accent = isDark ? '#C4B5FD' : fallback.accent;
  }
  return {
    bg,
    ink,
    accent,
    isDark,
    surface: mix(bg, isDark ? '#ffffff' : '#000000', 0.04),
    inkSoft: mix(ink, bg, 0.26),
    muted: mix(ink, bg, 0.5),
    accentSoft: mix(accent, bg, isDark ? 0.8 : 0.86),
    rule: mix(ink, bg, isDark ? 0.8 : 0.86),
    chip: mix(accent, bg, isDark ? 0.84 : 0.9),
  };
}

export function brandFont(data: DeckData, fallback: string): string {
  const kit = useBrandKit(data);
  if (!kit.fonts) return fallback;
  const map: Record<string, string> = {
    editorial: '"Playfair Display",Georgia,serif',
    modern: '"Inter","Helvetica Neue",system-ui,sans-serif',
    sans: '"Inter","Helvetica Neue",system-ui,sans-serif',
    serif: '"Source Serif Pro",Georgia,serif',
    mono: '"JetBrains Mono",ui-monospace,Menlo,monospace',
  };
  return map[kit.fonts] || map[kit.fonts.toLowerCase()] || fallback;
}
