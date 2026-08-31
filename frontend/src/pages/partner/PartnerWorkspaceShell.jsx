import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, LockKeyhole, ShieldCheck, Sparkles, TimerReset } from 'lucide-react';

const WORKSPACE_META = {
  pipeline: {
    eyebrow: 'Pipeline',
    title: 'Win the work',
    description: 'Turn founder needs into scoped proposals, trusted matches, and durable retainers.',
  },
  delivery: {
    eyebrow: 'Delivery',
    title: 'Ship the work',
    description: 'Keep active engagements, client visibility, milestones, and performance in one place.',
  },
  offers: {
    eyebrow: 'Offers',
    title: 'Package what we sell',
    description: 'Make capabilities, partner perks, and proof easy for the right founders to discover.',
  },
  network: {
    eyebrow: 'Network',
    title: 'Work our relationships',
    description: 'Use consented relationship context to make warmer, more useful introductions.',
  },
  research: {
    eyebrow: 'Research',
    title: 'Know the client’s world',
    description: 'Ground partner decisions in sourced market context and clearly labelled live signals.',
  },
};

export const PARTNER_WORKSPACE_META = WORKSPACE_META;

function isActive(location, tab) {
  if (tab.match) return tab.match.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  return location.pathname === tab.to;
}

/**
 * Partner-only chrome. This is intentionally separate from the generic
 * WorkspaceTabs primitive so amber means "partner action" and cyan means
 * "source/provenance" without changing another role's visual language.
 */
export default function PartnerWorkspaceShell({
  workspace,
  title,
  description,
  eyebrow,
  icon: Icon = Sparkles,
  tabs = [],
  children,
  rail = true,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const meta = WORKSPACE_META[workspace] || {};
  const resolvedEyebrow = eyebrow || meta.eyebrow || 'Partner workspace';
  const resolvedTitle = title || meta.title || 'Partner workspace';
  const resolvedDescription = description || meta.description;

  return (
    <div className="min-h-full bg-slate-50/70 dark:bg-slate-950/30">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-amber-200/80 bg-white/95 p-5 shadow-sm dark:border-amber-900/60 dark:bg-gray-900/95 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                <Icon size={22} aria-hidden="true" />
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">{resolvedEyebrow}</p>
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-300">
                    <CheckCircle2 size={12} /> Scoped live data
                  </span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-white">{resolvedTitle}</h1>
                {resolvedDescription && <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-400">{resolvedDescription}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-cyan-200/80 bg-cyan-50/70 px-3 py-2 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-200">
              <LockKeyhole size={15} />
              <span>Founder-granted access</span>
            </div>
          </div>

          {tabs.length > 0 && (
            <nav aria-label={`${resolvedEyebrow} sections`} className="mt-6 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
              {tabs.map((tab) => {
                const TabIcon = tab.icon;
                const active = isActive(location, tab);
                return (
                  <button
                    key={tab.to}
                    type="button"
                    onClick={() => navigate(tab.to)}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? 'border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-300'
                        : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    {TabIcon && <TabIcon size={15} />} {tab.label}
                  </button>
                );
              })}
            </nav>
          )}
        </header>

        <div className={`mt-5 grid gap-5 ${rail ? 'lg:grid-cols-[minmax(0,1fr)_240px]' : ''}`}>
          <div className="min-w-0">{children}</div>
          {rail && (
            <aside className="hidden space-y-4 lg:block">
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-900/60 dark:bg-cyan-950/25">
                <div className="flex items-center gap-2 text-sm font-semibold text-cyan-950 dark:text-cyan-200">
                  <ShieldCheck size={17} /> Trust seam
                </div>
                <p className="mt-2 text-xs leading-5 text-cyan-900/80 dark:text-cyan-200/75">
                  Screened and consented founder context is labelled at the source. Restricted or expired access stays visible as a warning.
                </p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-white p-4 dark:border-amber-900/60 dark:bg-gray-900">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <Sparkles size={17} className="text-amber-600 dark:text-amber-300" /> AI assist
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-400">
                  Suggestions are a starting point. Confirm scope, consent, and the latest source before acting.
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <TimerReset size={13} /> Review before sending
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}