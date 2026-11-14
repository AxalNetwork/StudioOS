import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowLeft, Landmark } from 'lucide-react';
import { eventSyndicationApi } from '../../../lib/api/eventSyndication';
import { TABS, tabFor } from './syndicationModel';
import { Channels, Activity, Settings } from './SyndicationTabs';

/** D1491 (#3725) — SY1/SY5/SY6 read and write the mounted D1490 core. Super Admin route gate remains unchanged. */
const EYEBROW = 'font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const tabClass = (on) => `-mb-px border-b-2 pb-2 ${on ? 'border-violet-600 font-bold text-axal-ink dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;

export default function EventSyndicationPage({ api = eventSyndicationApi }) {
  const { pathname } = useLocation();
  const tab = tabFor(pathname);
  return (
    <div className="min-w-0 space-y-4" data-testid="hq-event-syndication-page">
      <div>
        <Link to="/admin/platform" className="inline-flex min-h-[32px] items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100">
          <ArrowLeft size={13} /> Platform
        </Link>
        <div className={EYEBROW}>HQ › Platform › Event syndication</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">Event syndication</h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <Landmark size={11} aria-hidden="true" /> Super Admin
          </span>
        </div>
        <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">List approved public events on Eventbrite, Google, LinkedIn and Facebook.</p>
        {/* Literal addresses, so the reachability walk finds each tab. */}
        <nav className="mt-3 flex gap-4 border-b border-axal-hairline text-[13px] dark:border-gray-800" aria-label="Event syndication">
          <NavLink to="/admin/platform/event-syndication" end className={tabClass(tab === 'channels')}>{TABS[0].label}</NavLink>
          <NavLink to="/admin/platform/event-syndication/log" end className={tabClass(tab === 'log')}>{TABS[1].label}</NavLink>
          <NavLink to="/admin/platform/event-syndication/settings" end className={tabClass(tab === 'settings')}>{TABS[2].label}</NavLink>
        </nav>
      </div>
      {tab === 'channels' && <Channels api={api} />}
      {tab === 'log' && <Activity api={api} />}
      {tab === 'settings' && <Settings api={api} />}
    </div>
  );
}
