import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowLeft, Landmark } from 'lucide-react';
import { Card } from '../../../ui';
import {
  CAPABILITY_LABEL, CHANNELS, LOG_ACTION, PROPOSED_SETTINGS, SETTINGS_TYPES, SKIP_REASONS,
  TABS, channelStatus, tabFor,
} from './syndicationModel';

/**
 * D1491 (#3725) — HQ › Platform › Event syndication (SY1, SY5, SY6, SY7).
 *
 * Super Admin only (`hqOnly`). The canvas's three tabs at their addresses.
 * Part A's Worker core (D1490) is not on main, so nothing here reads or
 * writes: each channel says it is not available yet and why, Activity says
 * nothing has been posted, and Settings shows S1's proposed defaults, marked
 * as proposals. When D1490 lands, its reads replace the null accounts below
 * and the model's words stay as they are.
 */

const TONE = {
  green: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  red: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  muted: 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400',
};
const EYEBROW = 'font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const NOT_YET = 'Connecting a channel arrives with the syndication service.';
const tabClass = (on) => `-mb-px border-b-2 pb-2 ${on ? 'border-violet-600 font-bold text-axal-ink dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;

function ChannelCard({ channel }) {
  const status = channelStatus(null);
  return (
    <Card className="flex min-w-0 flex-col gap-2.5 px-4 py-4" data-testid="syndication-channel" data-channel={channel.key}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{channel.name}</h2>
          <p className="text-[12px] text-axal-muted dark:text-gray-400">Not connected</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[status.tone]}`}>{status.label}</span>
      </div>
      <p className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
        {CAPABILITY_LABEL[channel.capability]}{channel.pendingOwner ? <span className="font-normal text-axal-muted dark:text-gray-400"> (pending owner)</span> : null}
      </p>
      <p className="text-[12px] leading-relaxed text-axal-muted dark:text-gray-400">{channel.needs}</p>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-axal-hairline pt-2.5 dark:border-gray-800">
        <label className="flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400" title={NOT_YET}>
          <input type="checkbox" disabled className="h-4 w-4" aria-describedby={`${channel.key}-not-yet`} />
          Default on for new events
        </label>
        <button type="button" disabled title={NOT_YET} className="rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold text-axal-muted opacity-70 dark:border-gray-700 dark:text-gray-400">Connect</button>
      </div>
      <span id={`${channel.key}-not-yet`} className="sr-only">{NOT_YET}</span>
    </Card>
  );
}

function Channels() {
  return (
    <>
      <p role="status" className="rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" data-testid="syndication-not-built">
        Nothing is posted to other channels yet. Approve and publish lists a public event on axal.vc only. Connecting Axal’s accounts arrives with the syndication service.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="syndication-channels">
        {CHANNELS.map((c) => <ChannelCard key={c.key} channel={c} />)}
      </div>
      <Card className="px-4 py-3.5">
        <h2 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">The rules it will follow</h2>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12.5px] text-axal-muted dark:text-gray-400">
          <li>Only public events an admin approves are listed. Private and unlisted events are never posted.</li>
          <li>Posting happens on Approve and publish, never on save, draft or submit.</li>
          <li>Luma, Eventbrite and Google create a listing. LinkedIn and Facebook post a link to the event.</li>
          <li>Every listing links back to the event’s page on axal.vc. Paid tickets are sold only on Axal.</li>
        </ul>
      </Card>
    </>
  );
}

function Activity() {
  return (
    <Card className="px-4 py-4" data-testid="syndication-log">
      <table className="w-full text-[12.5px]">
        <thead className={EYEBROW}>
          <tr className="text-left"><th className="py-1.5 pr-3">Time</th><th className="py-1.5 pr-3">Event</th><th className="py-1.5 pr-3">Channel</th><th className="py-1.5 pr-3">Action</th><th className="py-1.5 pr-3">Outcome</th><th className="py-1.5">Who</th></tr>
        </thead>
        <tbody>
          <tr><td colSpan={6} className="py-6 text-center text-axal-muted dark:text-gray-400" data-testid="syndication-log-empty">No event has been syndicated. Every post, update, cancel and failure will be listed here.</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">Actions it will record: {Object.values(LOG_ACTION).join(', ')}.</p>
    </Card>
  );
}

function Settings() {
  const { hosts, hostAccounts } = PROPOSED_SETTINGS;
  return (
    <div className="space-y-3" data-testid="syndication-settings">
      <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
        Proposed defaults. They take effect when the syndication service ships and the owner has answered #3725’s questions A and C.
      </p>
      <Card className="px-4 py-4">
        <h2 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Who may syndicate</h2>
        <fieldset disabled className="mt-2 space-y-1.5 text-[12.5px] text-axal-ink dark:text-gray-200">
          <label className="flex items-center gap-2"><input type="radio" name="hosts" defaultChecked /> {hosts.label} <span className="text-axal-muted">(pending owner)</span></label>
          <label className="flex items-center gap-2"><input type="radio" name="hosts" /> {hosts.alt}</label>
        </fieldset>
      </Card>
      <Card className="overflow-x-auto px-4 py-4">
        <h2 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Default channels per event type</h2>
        <table className="mt-2 min-w-[560px] text-[12px]" data-testid="syndication-type-grid">
          <thead className={EYEBROW}><tr><th className="py-1 pr-3 text-left">Type</th>{CHANNELS.map((c) => <th key={c.key} className="px-2 py-1">{c.name}</th>)}</tr></thead>
          <tbody>
            {SETTINGS_TYPES.map((t) => (
              <tr key={t.id} className="border-t border-axal-hairline/60 dark:border-gray-800">
                <td className="py-1.5 pr-3 text-axal-ink dark:text-gray-200">{t.label}</td>
                {CHANNELS.map((c) => <td key={c.key} className="px-2 py-1.5 text-center"><input type="checkbox" disabled aria-label={`${t.label} on ${c.name}`} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="px-4 py-4">
        <label className="flex items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
          <input type="checkbox" disabled defaultChecked={hostAccounts.value} /> {hostAccounts.label} <span className="text-axal-muted">(pending owner)</span>
        </label>
      </Card>
      <Card className="px-4 py-3.5">
        <h2 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">When an event is skipped, it says why</h2>
        <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400">{SKIP_REASONS.join(' · ')}</p>
      </Card>
    </div>
  );
}

export default function EventSyndicationPage() {
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
        <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">List approved public events on Luma, Eventbrite, Google, LinkedIn and Facebook.</p>
        {/* Literal addresses, so the reachability walk finds each tab. */}
        <nav className="mt-3 flex gap-4 border-b border-axal-hairline text-[13px] dark:border-gray-800" aria-label="Event syndication">
          <NavLink to="/admin/platform/event-syndication" end className={tabClass(tab === 'channels')}>{TABS[0].label}</NavLink>
          <NavLink to="/admin/platform/event-syndication/log" end className={tabClass(tab === 'log')}>{TABS[1].label}</NavLink>
          <NavLink to="/admin/platform/event-syndication/settings" end className={tabClass(tab === 'settings')}>{TABS[2].label}</NavLink>
        </nav>
      </div>
      {tab === 'channels' && <Channels />}
      {tab === 'log' && <Activity />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
