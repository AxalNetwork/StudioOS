// Task #3 — Shared form primitives for the assessment authoring surface. Every
// element ships its dark: pairing so the dark-mode guard (check-dark-mode.mjs)
// stays green and the studio reads in both themes.
import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { parseJsonField, stringifyField } from './jsonFields';

export const inputCls =
  'w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500';

export function Field({ label, hint, error, required, children }) {
  return (
    <label className="block text-sm">
      {label && (
        <div className="font-medium mb-1 text-slate-700 dark:text-slate-200">
          {label}{required && <span className="text-red-500"> *</span>}
        </div>
      )}
      {children}
      {error
        ? <div className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</div>
        : hint && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</div>}
    </label>
  );
}

export function TextInput({ value, onChange, ...rest }) {
  return <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputCls} {...rest} />;
}

export function Textarea({ value, onChange, rows = 4, mono, ...rest }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className={`${inputCls} ${mono ? 'font-mono' : ''}`}
      {...rest}
    />
  );
}

export function Select({ value, onChange, options, includeBlank, blankLabel = '— select —', ...rest }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputCls} {...rest}>
      {includeBlank && <option value="">{blankLabel}</option>}
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const lbl = typeof o === 'string' ? o : o.label;
        return <option key={val} value={val}>{lbl}</option>;
      })}
    </select>
  );
}

// Button variants. `as` lets a button render styling on a non-button when needed.
const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_VARIANTS = {
  primary: 'bg-violet-600 text-white hover:bg-violet-700',
  ghost: 'border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  dangerGhost: 'border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
  emerald: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }) {
  const pad = size === 'sm' ? 'px-2.5 py-1' : 'px-3.5 py-1.5';
  return (
    <button className={`${BTN_BASE} ${pad} ${BTN_VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function SectionCard({ className = '', children }) {
  return (
    <div className={`rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  archived: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

export function StatusBadge({ status }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {status}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEscapeClose(onClose);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className={`bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full my-8 ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Validated JSON textarea. Reports validity up via onValidityChange so parent
// forms can block save on a parse error. `value` is the raw text the user edits.
export function JsonEditor({ label, hint, value, onChange, onValidityChange, rows = 8, palette }) {
  const parsed = parseJsonField(value);
  React.useEffect(() => {
    onValidityChange?.(parsed.ok);
  }, [parsed.ok, onValidityChange]);
  return (
    <div className="text-sm">
      {label && <div className="font-medium mb-1 text-slate-700 dark:text-slate-200">{label}</div>}
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        className={`${inputCls} font-mono text-xs ${parsed.ok ? '' : 'border-red-400 dark:border-red-500'}`}
      />
      {!parsed.ok ? (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {parsed.error}
        </div>
      ) : hint ? (
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</div>
      ) : null}
      {palette}
    </div>
  );
}

export { parseJsonField, stringifyField };
