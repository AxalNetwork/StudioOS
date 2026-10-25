import React from 'react';
import { NavLink } from 'react-router-dom';

/**
 * D953 (#2371) — each program's tab strip. THE PATHS ARE WRITTEN OUT, one
 * literal `NavLink` per tab, not mapped from `PAGES`, because the
 * reachability walk (`admin_route_reachability.test.mjs`) counts a literal
 * `to="…"` as a door, as on Events (D915) and Partner invitations (D923);
 * `admin_programs_d953.test.mjs` holds each strip equal to `PAGES`. A program
 * has only the tabs it has today. A Queue tab carries its count, amber when
 * above zero; a program without a queue has no Queue tab, so no tab reads
 * "[0]". On a phone the strip scrolls sideways. D962 adds Activity to
 * Mentor, Refer & Earn, Perks and Learning; no page has a Terms tab, because
 * part 1's store holds no program's terms.
 */

function Tab({ to, end = false, count = null, testId, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      className={({ isActive }) => `-mb-px inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-[13px] lg:min-h-[40px] ${isActive
        ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
        : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
    >
      {children}
      {count ? (
        <span title={count.title} className={`rounded-full border px-[7px] font-mono text-[10.5px] font-bold ${count.amber
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`} data-testid={`${testId}-count`}>
          {count.text}
          {count.title ? <span className="sr-only">{`, ${count.title}`}</span> : null}
        </span>
      ) : null}
    </NavLink>
  );
}

function Strip({ label, children }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]" data-testid="programs-tabs">
      <div className="flex gap-[22px] border-b border-axal-hairline dark:border-gray-700">{children}</div>
    </nav>
  );
}

export function MentorTabs() {
  return (
    <Strip label="Mentor cohort access">
      <Tab to="/admin/programs/mentor-cohorts" end testId="programs-tab-overview">Overview</Tab>
      <Tab to="/admin/programs/mentor-cohorts/how-it-runs" testId="programs-tab-how">How it runs</Tab>
      <Tab to="/admin/programs/mentor-cohorts/people" testId="programs-tab-people">People</Tab>
      <Tab to="/admin/programs/mentor-cohorts/activity" testId="programs-tab-activity">Activity</Tab>
    </Strip>
  );
}

export function ReferTabs({ queue }) {
  return (
    <Strip label="Refer & Earn">
      <Tab to="/admin/programs/refer-and-earn" end testId="programs-tab-overview">Overview</Tab>
      <Tab to="/admin/programs/refer-and-earn/how-it-runs" testId="programs-tab-how">How it runs</Tab>
      <Tab to="/admin/programs/refer-and-earn/queue" count={queue} testId="programs-tab-queue">Queue</Tab>
      <Tab to="/admin/programs/refer-and-earn/settings" testId="programs-tab-settings">Settings</Tab>
      <Tab to="/admin/programs/refer-and-earn/activity" testId="programs-tab-activity">Activity</Tab>
    </Strip>
  );
}

export function PerksTabs({ queue }) {
  return (
    <Strip label="Perks">
      <Tab to="/admin/programs/perks" end testId="programs-tab-overview">Overview</Tab>
      <Tab to="/admin/programs/perks/how-it-runs" testId="programs-tab-how">How it runs</Tab>
      <Tab to="/admin/programs/perks/queue" count={queue} testId="programs-tab-queue">Queue</Tab>
      <Tab to="/admin/programs/perks/activity" testId="programs-tab-activity">Activity</Tab>
    </Strip>
  );
}

export function LearningTabs() {
  return (
    <Strip label="Learning">
      <Tab to="/admin/programs/learning" end testId="programs-tab-overview">Overview</Tab>
      <Tab to="/admin/programs/learning/how-it-runs" testId="programs-tab-how">How it runs</Tab>
      <Tab to="/admin/programs/learning/people" testId="programs-tab-people">People</Tab>
      <Tab to="/admin/programs/learning/activity" testId="programs-tab-activity">Activity</Tab>
    </Strip>
  );
}

export function PartnersTabs() {
  return (
    <Strip label="Referral partners">
      <Tab to="/admin/programs/referral-partners" end testId="programs-tab-overview">Overview</Tab>
      <Tab to="/admin/programs/referral-partners/how-it-runs" testId="programs-tab-how">How it runs</Tab>
    </Strip>
  );
}
