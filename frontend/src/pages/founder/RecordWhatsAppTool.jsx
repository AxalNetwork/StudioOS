import React, { useCallback, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api as appApi } from '../../lib/api';
import { channelsApi } from '../../lib/api/channels.js';
import { conversationAnalyticsApi } from '../../lib/api/conversationAnalytics.js';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { useChannelsOverview } from '../account/ChannelsGroup';
import { useVentureInterviews } from './ChannelsInbox';
import { threadItems } from './channelThreads.js';
import {
  AssignDialog, CARD, ChannelAnalytics, ChannelInbox, ChannelProposals, ChannelTranscript, ConfirmDialog, ConnectSteps,
  EmptyBoard, ErrorBoard, H3, LoadingBoard, MUTED, NoPermissionBoard, SetupOff, useRead,
} from './ChannelSessionParts.jsx';
import {
  WA_TABS, contactName, pageState, proposalGroups, rangeOf, trendBars, trendWeeks, waHref, waRoute,
} from './channelSessionModel.js';

/**
 * D862 (#2507) — Record a session › WhatsApp, the boards WA1–WA13 at
 * `/validate/record/whatsapp` and its tab paths (`channelSessionModel.js`'s
 * `WA_TABS`): Inbox, Sessions, Analytics, Proposals and Connection. Each tab
 * reads what the Worker already serves (D684, D754, D856–D859); nothing here
 * adds a route.
 *
 * Consent comes first (D754): a chat reaches a session only once it is
 * assigned, and the session's words are shown only from the session read,
 * which the Worker scopes to the venture's founder. A proposal lands in
 * Validate only on the founder's Accept.
 */

const SIGNUP = '/account/connectors/whatsapp';
const SESSION_PAGE = (id) => `/validate/session/${Number(id)}`;

const DEFAULT_API = { channels: channelsApi, sessions: interviewSessionsApi, analytics: conversationAnalyticsApi, app: appApi };

function SubTabs({ active }) {
  return (
    <nav aria-label="WhatsApp" className="flex gap-5 overflow-x-auto border-b border-gray-200 dark:border-gray-700" data-testid="wa-tabs">
      {WA_TABS.map((t) => (
        <NavLink key={t.key} to={t.to} end={t.key === 'inbox'} aria-current={active === t.key ? 'page' : undefined} data-testid={`wa-tab-${t.key}`}
          className={`-mb-px inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 text-[13.5px] sm:min-h-[40px] ${active === t.key ? 'border-violet-600 font-bold text-gray-900 dark:border-violet-400 dark:text-gray-100' : 'border-transparent font-semibold text-gray-500 dark:text-gray-400'}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The assigned chats that have a session, as links to one tab's record. */
function SessionPicker({ items, tab, empty, extra }) {
  const rows = items.filter((t) => t.provider === 'whatsapp' && t.session_id);
  if (!rows.length) return <p className={`${CARD} ${MUTED}`} data-testid={`wa-${tab}-none`}>{empty}</p>;
  return (
    <ul className={`${CARD} m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800`} data-testid={`wa-${tab}-list`}>
      {rows.map((t) => (
        <li key={t.uid}>
          <Link to={waHref(tab, t.session_id)} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`wa-${tab}-pick-${t.session_id}`}>
            <span className="font-semibold">{contactName(t)}{t.interviewee_name ? ` · ${t.interviewee_name}` : ''}</span>
            <span className={MUTED}>{extra(t)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SessionTab({ id, items, api }) {
  const read = useRead(() => (id ? api.sessions.get(id) : null), [id, api]);
  if (!id) return <SessionPicker items={items} tab="sessions" empty="No WhatsApp chat is in a session yet. Assign a chat to an interview in Inbox." extra={(t) => `${Number(t.message_count) || 0} messages`} />;
  if (read.status === 'loading') return <LoadingBoard />;
  if (read.status === 'forbidden') return <NoPermissionBoard label="WhatsApp" />;
  if (read.status !== 'ready') return <ErrorBoard what="This session" onRetry={read.reload} />;
  const t = items.find((x) => x.session_id === id);
  const meta = [t ? contactName(t) : null, t?.interviewee_name ? `Interview with ${t.interviewee_name}` : null, 'WhatsApp'].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3 text-[12.5px]">
        <Link to={waHref('analytics', id)} className="font-semibold text-violet-700 dark:text-violet-300" data-testid="wa-session-analytics">This session’s analytics</Link>
        <Link to={waHref('proposals', id)} className="font-semibold text-violet-700 dark:text-violet-300" data-testid="wa-session-proposals">Its proposals</Link>
        <Link to={SESSION_PAGE(id)} className="font-semibold text-violet-700 dark:text-violet-300">The full session page</Link>
      </div>
      <ChannelTranscript read={read.data} meta={meta} />
    </div>
  );
}

/** A venture's trend: one read per week, so a week that cannot be read is Not recorded on its own. */
function useTrend(projectId, api) {
  const weeks = trendWeeks();
  return useRead(async () => {
    if (!projectId) return null;
    const values = await Promise.all(weeks.map((w) => api.analytics.venture({ projectId, from: w.from, to: w.to, channel: 'whatsapp' })
      .then((r) => (typeof r?.sessions === 'number' ? r.sessions : null), () => null)));
    return trendBars(weeks, values);
  }, [projectId, api]);
}

function AnalyticsTab({ id, items, projectId, api }) {
  const [range, setRange] = useState('30');
  const session = useRead(() => (id ? api.analytics.session(id) : null), [id, api]);
  const venture = useRead(() => (!id && projectId ? api.analytics.venture({ projectId, ...rangeOf(range), channel: 'whatsapp' }) : null), [id, projectId, range, api]);
  const trend = useTrend(!id ? projectId : null, api);
  if (id) {
    if (session.status === 'loading') return <LoadingBoard />;
    if (session.status === 'forbidden') return <NoPermissionBoard label="WhatsApp" />;
    if (session.status !== 'ready') return <ErrorBoard what="This session’s analytics" onRetry={session.reload} />;
    const t = items.find((x) => x.session_id === id);
    return <ChannelAnalytics data={session.data} title={`One session${t ? ` · ${contactName(t)}` : ''}`} />;
  }
  if (!projectId) return <p className={`${CARD} ${MUTED}`}>Analytics read a venture. Open a venture first.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Range" className="inline-flex self-start rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
        {[['30', 'Last 30 days'], ['90', 'Last 90 days']].map(([k, t]) => (
          <button key={k} type="button" role="radio" aria-checked={range === k ? 'true' : 'false'} onClick={() => setRange(k)} data-testid={`wa-range-${k}`}
            className={`min-h-[44px] rounded-md px-3 text-[12px] font-semibold sm:min-h-[30px] ${range === k ? 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'text-gray-700 dark:text-gray-300'}`}>{t}</button>
        ))}
      </div>
      {venture.status === 'loading' ? <LoadingBoard /> : venture.status === 'forbidden' ? <NoPermissionBoard label="WhatsApp" />
        : venture.status !== 'ready' ? <ErrorBoard what="Your WhatsApp analytics" onRetry={venture.reload} />
          : <ChannelAnalytics data={venture.data} venture title="Across WhatsApp chats" trend={trend.status === 'ready' ? trend.data : null} />}
    </div>
  );
}

function ProposalsTab({ id, items, api }) {
  const read = useRead(() => (id ? api.sessions.placements(id) : null), [id, api]);
  const [note, setNote] = useState('');
  if (!id) return <SessionPicker items={items} tab="proposals" empty="Nothing to accept yet. Proposals appear once Eadwyn has read a chat in a session." extra={(t) => `${Number(t.pending_suggestions) || 0} waiting`} />;
  if (read.status === 'loading') return <LoadingBoard />;
  if (read.status === 'forbidden') return <NoPermissionBoard label="WhatsApp" />;
  if (read.status !== 'ready') return <ErrorBoard what="This session’s proposals" onRetry={read.reload} />;
  const after = (r) => { read.reload(); return r; };
  return (
    <div className="flex flex-col gap-2">
      {note ? <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="wa-proposals-note">{note}</p> : null}
      <ChannelProposals
        groups={proposalGroups(read.data)}
        editHref={SESSION_PAGE(id)}
        line="Eadwyn read the chat and proposed these. Nothing lands in Validate until you accept it."
        onAccept={(pid) => api.sessions.accept(pid).then(after).then(() => setNote('Accepted. It is in Validate now.'))}
        onDiscard={(pid) => api.sessions.discard(pid).then(after).then(() => setNote('Dismissed.'))}
        onAcceptAll={(ids) => api.sessions.acceptAll(id, ids).then(after).then((r) => setNote(`${Number(r?.accepted) || 0} accepted.${Number(r?.remaining) ? ` ${Number(r.remaining)} still wait.` : ''}`))}
      />
    </div>
  );
}

function ConnectionTab({ api, onConnected }) {
  const read = useRead(() => api.channels.whatsappSetup(), [api]);
  if (read.status === 'loading') return <LoadingBoard />;
  if (read.error?.status === 404) return <SetupOff signupHref={SIGNUP} />;
  if (read.status === 'forbidden') return <NoPermissionBoard label="WhatsApp" />;
  if (read.status !== 'ready') return <ErrorBoard what="Your WhatsApp setup" onRetry={read.reload} />;
  return <ConnectSteps view={read.data} signupHref={SIGNUP} onPress={(step) => api.channels.whatsappSetupStep(step).then(() => { read.reload(); if (step === 'connect') onConnected(); })} />;
}

export default function RecordWhatsAppTool({ api = DEFAULT_API }) {
  const { pathname } = useLocation();
  const route = waRoute(pathname) || { tab: 'inbox', id: null };
  const overview = useChannelsOverview(api.channels);
  const threads = useRead(() => api.channels.threads(), [api]);
  const venture = useVentureInterviews(api.app);
  const [channel, setChannel] = useState('whatsapp');
  const [dialog, setDialog] = useState(null);
  const items = threads.status === 'ready' ? threadItems(threads.data) : [];
  const reloadAll = useCallback(() => { overview.reload(); threads.reload(); }, [overview, threads]);

  const state = pageState({ overview, threads });
  let body;
  if (route.tab === 'connection') body = <ConnectionTab api={api} onConnected={reloadAll} />;
  else if (state === 'loading') body = <LoadingBoard testId="wa-loading" />;
  else if (state === 'nop') body = <NoPermissionBoard label="WhatsApp" testId="wa-nop" />;
  else if (state === 'error') body = <ErrorBoard what="Your WhatsApp chats" onRetry={reloadAll} testId="wa-error" />;
  else if (state === 'empty') body = <EmptyBoard label="WhatsApp" connectTo={waHref('connection')} testId="wa-empty" />;
  else if (route.tab === 'sessions') body = <SessionTab id={route.id} items={items} api={api} />;
  else if (route.tab === 'analytics') body = <AnalyticsTab id={route.id} items={items} projectId={venture.project?.id || null} api={api} />;
  else if (route.tab === 'proposals') body = <ProposalsTab id={route.id} items={items} api={api} />;
  else {
    body = (
      <ChannelInbox items={items} channel={channel} onChannel={setChannel} sessionHref={(sid) => waHref('sessions', sid)}
        onAssign={(r) => setDialog({ kind: 'assign', r })} onAsk={(r) => setDialog({ kind: 'ask', r })} onIgnore={(r) => setDialog({ kind: 'ignore', r })} />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="wa-tool">
      <SubTabs active={route.tab} />
      <h2 className={`${H3} sr-only`}>{WA_TABS.find((t) => t.key === route.tab)?.label}</h2>
      {body}
      {dialog?.kind === 'assign' ? (
        <AssignDialog row={dialog.r} interviews={venture} inboxHref="/validate/inbox" onClose={() => setDialog(null)}
          onAssign={(uid, interviewId) => api.channels.assign(uid, { interview_id: interviewId }).then(() => threads.reload())} />
      ) : null}
      {dialog?.kind === 'ask' ? (
        <ConfirmDialog title="Ask for consent" sub={`Axal sends ${dialog.r.name} its consent message in the chat. Nothing they send is kept until they agree.`} confirm="Send the consent message"
          onConfirm={() => api.channels.requestConsent(dialog.r.uid).then(() => threads.reload())} onClose={() => setDialog(null)} testId="wa-ask-dialog" />
      ) : null}
      {dialog?.kind === 'ignore' ? (
        <ConfirmDialog title="Ignore this chat" sub={`${dialog.r.name}’s chat moves to Ignored. Nothing from it reaches an interview; you can bring it back from the inbox.`} confirm="Ignore" tone="neg"
          onConfirm={() => api.channels.ignore(dialog.r.uid, true).then(() => threads.reload())} onClose={() => setDialog(null)} testId="wa-ignore-dialog" />
      ) : null}
    </div>
  );
}

