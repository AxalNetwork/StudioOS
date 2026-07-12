// Shared UI primitives for the advisor Network workspace pages (Introductions,
// Relationships, Organizations). These mirror the app's existing table / chip /
// slide-over patterns so the section reads like the rest of the product without
// pulling in a new component library.
import React, { useEffect } from 'react';
import { X, Search } from 'lucide-react';

export function Avatar({ name, size = 40 }) {
  const initials = (name || '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className="rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300 flex items-center justify-center font-semibold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

const CHIP_TONES = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

export function Chip({ children, tone = 'gray', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${CHIP_TONES[tone] || CHIP_TONES.gray} ${className}`}>
      {children}
    </span>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search' }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3">
      <Search size={14} className="text-gray-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent w-full py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none"
      />
    </div>
  );
}

// Horizontal scrollable filter chips. `options` is [{ id, label, count? }].
export function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-violet-300'
            }`}
          >
            {o.label}
            {o.count != null && (
              <span className={`text-[10px] ${active ? 'text-violet-100' : 'text-gray-400'}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Right-hand slide-over detail panel. Renders nothing when `open` is false.
export function SlideOver({ open, onClose, title, subtitle, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full overflow-y-auto bg-white dark:bg-gray-950 shadow-xl border-l border-gray-200 dark:border-gray-800">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-5">{children}</div>
      </div>
    </div>
  );
}

export function Section({ title, action, children }) {
  return (
    <section>
      {(title || action) && (
        <div className="flex items-center justify-between mb-2">
          {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm text-gray-800 dark:text-gray-200">{children ?? <span className="text-gray-400 italic">—</span>}</div>
    </div>
  );
}

export function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

// Small in-page tab strip (distinct from the workspace-level WorkspaceTabs).
export function SubTabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto [&>button]:whitespace-nowrap">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {Icon && <Icon size={14} />} {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function StrengthBar({ value }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-violet-500 to-emerald-500" style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-gray-600 dark:text-gray-400 w-8 text-right">{v}</span>
    </div>
  );
}

export function EmptyState({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500 dark:text-gray-400">
      {children}
    </div>
  );
}
