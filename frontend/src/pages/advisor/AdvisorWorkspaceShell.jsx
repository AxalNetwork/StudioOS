import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Bot, Radio, ShieldCheck } from 'lucide-react';

const TONE = {
  active: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  idle: 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200 hover:text-emerald-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-800 dark:hover:text-emerald-300',
};

export const advisorTabs = [
  { to: '/advisor/advisory/opportunities', label: 'Opportunities' },
  { to: '/advisor/advisory/clients', label: 'Clients' },
  { to: '/advisor/advisory/engagements', label: 'Engagements' },
  { to: '/advisor/advisory/delivery', label: 'Delivery' },
  { to: '/advisor/advisory/contracts', label: 'Contracts' },
];

/**
 * `embedded` is set when this shell is rendered INSIDE `workspaces/WorkspaceShell`
 * — which happens on every `/practice/*`, `/cohorts/*`, `/expertise/*` and
 * advisor `/network/*` route. That outer shell already draws a breadcrumb, an
 * h1, the zone pills and the Worker AI rail, so drawing them again here gave
 * the advisor two headers and two rails on one page. It suppresses the chrome
 * and keeps the body; the outer shell owns the frame.
 *
 * This is the same seam the investor pages use (`InvestorDealsWorkspace`,
 * `InvestorNetworkWorkspace`), for the same reason.
 */
export function AdvisorWorkspaceShell({
  eyebrow = 'Advisor workspace',
  title,
  description,
  icon: Icon = Radio,
  tabs = [],
  children,
  rail = true,
  embedded = false,
}) {
  const { pathname } = useLocation();
  if (embedded) return <div className="advisor-workspace min-w-0 text-gray-900 dark:text-gray-100">{children}</div>;
  return (
    <div className="advisor-workspace mx-auto w-full max-w-[1500px] pb-10 text-gray-900 dark:text-gray-100">
      <div className="mb-5 flex flex-col gap-4 border-b border-gray-200 pb-5 dark:border-gray-800">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <Icon size={20} />
            </span>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">{eyebrow}</div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white md:text-[28px]">{title}</h1>
              {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-400">{description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-medium text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300">
              <Radio size={12} /> Scoped live data
            </span>
          </div>
        </div>
        {tabs.length > 0 && (
          <nav className="flex gap-1 overflow-x-auto no-scrollbar" aria-label={`${title} sections`}>
            {tabs.map((tab) => {
              const active = pathname === tab.to || pathname.startsWith(`${tab.to}/`);
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? TONE.active : TONE.idle}`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        )}
        {/*
          A SECOND STRIP USED TO RENDER HERE and it is gone, not moved. It
          marked its current item by list position — the same paint-the-first-
          one defect the founder desks carried in CSS — so it claimed the
          reader was on the first section whatever they were looking at. It was
          also unreachable: the prop defaulted to an empty list and no caller in
          the repo ever passed one, so nothing rendered and nobody saw the lie.
          Removed rather than repaired, because a second strip of in-page
          fragment links beside the real zone pills is not something this shell
          should offer: the pills are the navigation, and they come from the URL.
        */}
      </div>

      <div className={rail ? 'grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]' : ''}>
        <main className="min-w-0">{children}</main>
        {rail && (
          <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-900/70 dark:bg-cyan-950/20">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-300">
                <ShieldCheck size={14} /> Source before score
              </div>
              <p className="mt-2 text-xs leading-5 text-cyan-950/75 dark:text-cyan-100/75">
                Client-shared history, bookings, relationships, and public signals stay attributed to their source.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-gray-100">
                <Bot size={14} className="text-emerald-600 dark:text-emerald-400" /> AI assist
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                Suggestions appear only when the underlying record and permission are available.
              </p>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                No pending suggestions <ArrowUpRight size={12} />
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export function AdvisorEmptyPanel({ title, body, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-8 text-center dark:border-amber-900 dark:bg-amber-950/20">
      <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-200">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-amber-900/75 dark:text-amber-100/70">{body}</p>
      {action}
    </div>
  );
}