import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Task #3 (IC) — Single empty-state component used by every list/feed page
 * on a fresh account. Replaces blank divs and "Loading…" placeholders.
 *
 *   <EmptyState
 *     icon={Sparkles}
 *     title="No projects yet"
 *     body="Create your first venture project to get started."
 *     cta={{ label: 'New project', to: '/projects' }}
 *     secondary={{ label: 'Learn more', to: '/docs#core/projects' }}
 *   />
 *
 * CTAs accept either `to` (in-app react-router link) or `onClick`
 * (in-page action like opening a modal). The component renders an
 * accessible region with a single h2 heading, body copy, and ≥44 × 44 px
 * hit targets so it passes the WCAG checklist out of the box.
 */
export default function EmptyState({
  icon: Icon,
  title,
  body,
  cta,
  secondary,
  className = '',
  size = 'md',
  'data-testid': testId,
}) {
  const pad = size === 'sm' ? 'py-8 px-4' : size === 'lg' ? 'py-16 px-6' : 'py-12 px-5';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId || 'empty-state'}
      className={`flex flex-col items-center justify-center text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/60 dark:bg-gray-900/30 ${pad} ${className}`}
    >
      {Icon && (
        <div className="mb-4 inline-flex items-center justify-center w-12 h-12 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300">
          <Icon size={22} aria-hidden="true" />
        </div>
      )}
      {title && (
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
          {title}
        </h2>
      )}
      {body && (
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mb-5 leading-relaxed">
          {body}
        </p>
      )}
      {(cta || secondary) && (
        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          {cta && <CtaButton spec={cta} primary />}
          {secondary && <CtaButton spec={secondary} />}
        </div>
      )}
    </div>
  );
}

function CtaButton({ spec, primary = false }) {
  const cls = primary
    ? 'inline-flex items-center justify-center min-h-[44px] px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900'
    : 'inline-flex items-center justify-center min-h-[44px] px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900';

  if (spec.to) {
    return <Link to={spec.to} className={cls}>{spec.label}</Link>;
  }
  if (spec.href) {
    return <a href={spec.href} className={cls} target={spec.external ? '_blank' : undefined} rel={spec.external ? 'noopener noreferrer' : undefined}>{spec.label}</a>;
  }
  return (
    <button type="button" onClick={spec.onClick} className={cls}>
      {spec.label}
    </button>
  );
}
