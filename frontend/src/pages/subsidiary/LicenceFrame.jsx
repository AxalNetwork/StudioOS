import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  kindLabel, longDate, statusLabel, territoryLine,
} from '../../lib/licencePage';

/**
 * D800 (#2233) — the Licences page's frame (canvas board L1's header and tab
 * row, L7's banners, L8's pill row). `MyLicencePage.jsx` mounts it on every
 * tab; each tab is a sub-path of `/admin/my-licence`, and the Licences row
 * stays lit on all six (`sidebarConfig.js`'s `match`).
 */

const STATUS_TONE = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  pending_activation: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  suspended: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  terminated: 'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
const pill = 'rounded-full border px-2.5 py-0.5 text-xs font-semibold';

/** The header: brand, reference, kind and status pills, and the territories. */
export function LicenceHeader({ licence, terms }) {
  const l = licence || {};
  const where = territoryLine(l, terms);
  return (
    <header className="space-y-1.5" data-testid="licence-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-xl font-extrabold tracking-tight text-gray-900 sm:text-2xl dark:text-white">{l.brand_name}</h1>
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{l.licence_ref || 'Not recorded'}</span>
        <span className={`${pill} border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`} data-testid="licence-kind">
          {kindLabel(l.kind)}
        </span>
        <span className={`${pill} ${STATUS_TONE[l.status] || STATUS_TONE.terminated}`} data-testid="licence-status">
          {statusLabel(l.status)}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
        <span>{where.lead}</span>
        {where.codes.length === 0
          ? <span className="italic text-gray-400 dark:text-gray-500">no territory held</span>
          : where.codes.map((cc) => (
            <span key={cc} className="rounded border border-gray-200 px-1.5 py-0.5 font-mono text-[11px] text-gray-800 dark:border-gray-700 dark:text-gray-200">{cc}</span>
          ))}
      </p>
    </header>
  );
}

function Tab({ to, tab, children }) {
  return (
    <li className="shrink-0">
      <NavLink
        to={to}
        end
        data-testid={`licence-tab-${tab}`}
        className={({ isActive }) => `block whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors ${
          isActive
            ? 'border-slate-300 bg-slate-100 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
            : 'border-gray-200 bg-white font-semibold text-gray-600 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`}
      >
        {children}
      </NavLink>
    </li>
  );
}

/**
 * The tab row. On a phone (board L8) it is one scrolling row of pills rather
 * than a wrap, so the page below starts at the same height on every tab. THE
 * SEVEN PATHS ARE WRITTEN OUT, not mapped from `LICENCE_TABS`, because the
 * reachability walk (`admin_route_reachability.test.mjs`) counts a literal
 * `to="…"` as a door; `licences_page_d800.test.mjs` holds the two lists equal.
 */
export function LicenceTabs() {
  return (
    <nav aria-label="Licence" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]" data-testid="licence-tabs">
      <ul className="flex flex-nowrap gap-1.5 pb-0.5 sm:flex-wrap">
        <Tab to="/admin/my-licence" tab="summary">Summary</Tab>
        <Tab to="/admin/my-licence/terms" tab="terms">Terms</Tab>
        <Tab to="/admin/my-licence/programs" tab="programs">Programs</Tab>
        <Tab to="/admin/my-licence/contract" tab="contract">Contract</Tab>
        <Tab to="/admin/my-licence/statements" tab="statements">Statements</Tab>
        <Tab to="/admin/my-licence/requests" tab="requests">Requests</Tab>
        <Tab to="/admin/my-licence/history" tab="history">History</Tab>
      </ul>
    </nav>
  );
}

const BANNER_TONE = {
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  rose: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  grey: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200',
};

/** Board L7's banner for Pending activation, Suspended or Terminated. */
export function LicenceStateBanner({ banner, children }) {
  if (!banner) return null;
  const a = banner.action;
  return (
    <div className={`rounded-xl border p-4 ${BANNER_TONE[banner.tone] || BANNER_TONE.grey}`} data-testid="licence-state-banner">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-bold">{banner.title}</p>
          {banner.detail && <p className="text-xs leading-relaxed">{banner.detail}</p>}
        </div>
        {a && (a.href
          ? <a href={a.href} className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800" data-testid="licence-state-action">{a.label}</a>
          : <Link to={a.to} className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800" data-testid="licence-state-action">{a.label}</Link>)}
      </div>
      {children}
    </div>
  );
}

/** A branch reads a copy of HQ's licence; the stamp says how old it is. */
export function CopyStamp({ data }) {
  if (data?.source !== 'hq_copy') return null;
  return (
    <p data-testid="licence-as-of" className="text-xs text-gray-500 dark:text-gray-400">
      Copy pushed by HQ · as of {longDate(data.as_of)}. HQ holds the licence itself; a change there reaches this page on the next push.
    </p>
  );
}
