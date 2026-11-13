// Locked-tab blurred preview — the Market Intelligence "PersonasPaywall"
// pattern extracted into a reusable component. Renders `children` (a teaser of
// the real content) blurred behind a frosted overlay with a lock badge, title,
// message and — for tier-gated locks — an upgrade CTA plus a QuotaCard.
//
// Two modes:
//   • role lock  (no `tier`)  → blur + message only (e.g. admin-only surface).
//   • tier lock  (`tier` set) → blur + "Unlock" CTA (opens the paywall) + QuotaCard.
import React from 'react';
import { Lock } from 'lucide-react';
import { openPaywall } from './PaywallModal';
import QuotaCard from './QuotaCard';

export default function LockedPreview({
  children,
  title = 'Locked',
  message = '',
  tier = null,
  user = null,
  icon: Icon = Lock,
  ctaLabel,
  minHeight = 340,
}) {
  return (
    <div
      className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800"
      style={{ minHeight }}
    >
      {/* Blurred teaser — inert, non-interactive, hidden from assistive tech. */}
      <div aria-hidden className="select-none" style={{ filter: 'blur(8px)', opacity: 0.55, pointerEvents: 'none' }}>
        {children}
      </div>

      {/* Frosted overlay + call to action */}
      <div className="absolute inset-0 flex items-center justify-center p-6 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto w-11 h-11 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-300 mb-3">
            <Icon size={20} />
          </div>
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</div>
          {message && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{message}</p>}
          {tier && (
            <>
              <button
                type="button"
                onClick={() => openPaywall(tier, message)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
              >
                <Lock size={14} /> {ctaLabel || 'Unlock this tab'}
              </button>
              {user && <QuotaCard user={user} className="mt-4 text-left" />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
