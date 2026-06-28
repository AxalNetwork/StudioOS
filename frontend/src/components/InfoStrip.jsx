/**
 * InfoStrip — compact inline informational help strip.
 *
 * USE FOR: page-level contextual help, tips, and process reminders placed
 *   directly under a page <h1> or a section heading.
 * DO NOT USE FOR: errors, validation feedback, toasts, or action alerts.
 *   Those belong in the existing rose/amber AlertCircle blocks, ErrorState,
 *   or Toast patterns.
 *
 * Props
 *   title?       Short headline (optional; rendered bold before body).
 *   body         One or two sentence description (required unless children provided).
 *   variant      'info' | 'tip' | 'warning'  — default 'info'.
 *   icon?        Lucide icon component; defaults to variant-appropriate icon.
 *   dismissible  Show dismiss ×  — default true.
 *   storageKey?  Persist dismissal to localStorage when provided.
 *   onDismiss?   Called when the strip is dismissed (after internal state update).
 *   inline?      Compact padding (default true); set false for a banner/notice strip.
 *   children?    Replaces `body` when richer markup (links, spans) is needed.
 */
import React, { useState } from 'react';
import { Info, Lightbulb, AlertTriangle, X } from 'lucide-react';

const VARIANTS = {
  info: {
    wrap: 'bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900',
    iconCls: 'text-blue-500 dark:text-blue-400',
    DefaultIcon: Info,
  },
  tip: {
    wrap: 'bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-900',
    iconCls: 'text-green-600 dark:text-green-500',
    DefaultIcon: Lightbulb,
  },
  warning: {
    wrap: 'bg-amber-50/60 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900',
    iconCls: 'text-amber-500 dark:text-amber-400',
    DefaultIcon: AlertTriangle,
  },
};

export default function InfoStrip({
  title,
  body,
  variant = 'info',
  icon: IconProp,
  dismissible = true,
  storageKey,
  onDismiss,
  inline = true,
  children,
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (!storageKey) return false;
    try { return localStorage.getItem(storageKey) === 'true'; } catch { return false; }
  });

  if (dismissed) return null;

  const cfg = VARIANTS[variant] ?? VARIANTS.info;
  const IconComponent = IconProp ?? cfg.DefaultIcon;

  const handleDismiss = () => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, 'true'); } catch {}
    }
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div
      role="note"
      aria-label={title ?? (variant === 'warning' ? 'Warning' : 'Information')}
      className={`flex items-start gap-2.5 rounded-lg border ${cfg.wrap} ${inline ? 'px-3 py-2' : 'px-4 py-3'} text-sm text-gray-700 dark:text-gray-300`}
    >
      <IconComponent
        size={15}
        className={`flex-shrink-0 mt-0.5 ${cfg.iconCls}`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        {title && (
          <span className="font-semibold text-gray-900 dark:text-gray-100 mr-1.5">
            {title}
          </span>
        )}
        {children ?? body}
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400 focus:ring-offset-1"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
