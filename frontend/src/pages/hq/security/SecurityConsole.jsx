/**
 * D4708 part 3 (#4708) — the Security page's view, moved out of `../SecurityPage.jsx` unchanged.
 * The page keeps the three reads and the acts and passes them here as props, so a test can render
 * any workspace with a payload; this file makes no request. `../SecurityPage.jsx` re-exports
 * `SecurityConsole` and `securityEventsBar`.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { RailFrame, WorkerRail, Unreadable } from '../../../ui';
import HeaderAsk from '../../../ui/HeaderAsk.jsx';
import { SECURITY_PROMPTS, SECURITY_USAGE_AT } from './securityPrompts.js';
import SecurityTabs from './SecurityTabs.jsx';
import OverviewWorkspace from './OverviewWorkspace.jsx';
import SourceAvailability from './SourceAvailability.jsx';
import AccessWorkspace from './AccessWorkspace.jsx';
import EventsWorkspace from './EventsWorkspace.jsx';
import { activeCount } from './eventsModel.js';
import ResilienceWorkspace from './ResilienceWorkspace.jsx';
import { otherNotRecorded } from './resilienceModel.js';
import AiSafetyWorkspace from './AiSafetyWorkspace.jsx';
import PrivacyWorkspace from './PrivacyWorkspace.jsx';
import TrustWorkspace from './TrustWorkspace.jsx';
import { buildOverview, clockOf } from './overviewModel.js';
import { tabOf } from './securityTabs.js';
import { EMPTY_CONTROLS, num, UNAVAILABLE } from './securityShared.js';
import { NotRecordedList, Zone } from './SecurityParts.jsx';
import { AiSafety } from './AiSafetyZone.jsx';
import { AccessSummaryZone, DataAccessZone } from './AccessZones.jsx';
import { DsrZone } from './PrivacyZones.jsx';
import { KycZone, Sanctions } from './TrustZones.jsx';
import { BackupDr, backupSentence, drillSentence } from './ResilienceZones.jsx';

/** Workspaces that say for themselves what could not be read (D4803), so the page banner stays off there. */
const OWN_UNREADABLE = new Set(['overview', 'resilience', 'ai-safety', 'privacy', 'trust']);

/**
 * The six filters, in the server's order — the fallback while the feed is
 * still in flight so the bar does not pop into existence. The server sends
 * the same list with what each one reads, and that copy wins once it arrives.
 * The sixth is H23's: the ledger of refusals and step-ups (D200).
 */
const GOV_FILTERS = [
  { key: 'all', label: 'All actions' },
  { key: 'impersonations', label: 'Impersonations' },
  { key: 'licence_changes', label: 'Licence changes' },
  { key: 'suspensions', label: 'Suspensions' },
  { key: 'exports', label: 'Exports' },
  { key: 'auth', label: 'Sign-ins and step-ups' },
];

/**
 * D200 — H23's bar: `security_events · append-only · N rows today`.
 *
 * Three states, and only one of them is a figure. Before the overview answers
 * the slot says it is waiting; under a FAILED overview read it says the ledger
 * is unreadable rather than keeping the ellipsis, which would claim an answer
 * is on its way; and an unreadable ledger inside a readable overview carries
 * the server's own reason. None of the three is ever `0 rows today`.
 */
export function securityEventsBar(ready, se, overviewUnreadable) {
  if (!ready) {
    return overviewUnreadable ? 'security_events · unreadable · the security overview could not be read' : 'security_events · …';
  }
  if (se?.available) return `security_events · append-only · ${num(se.today)} rows today`;
  return `security_events · unreadable · ${se?.reason || 'the ledger could not be read'}`;
}

/** A read as the Overview model takes it: in flight, failed, or answered. */
const readOf = (v, at) => (v === null ? { state: 'loading' } : v === UNAVAILABLE ? { state: 'unreadable' } : { state: 'ready', value: v, at });

export function SecurityConsole({
  tab = 'overview', onTab = () => {}, data, load, feed, filter, setFilter, loadFeed, sessionList, loadSessions, onSessionAct, readAt = {}, loadMoreSessions = null,
  controls = EMPTY_CONTROLS, setControls = () => {}, loadOlder = () => Promise.reject(new Error('no cursor reader')),
  mfaPolicy = null, mfaPolicyProps = null,
}) {
  const feedReady = feed && feed !== UNAVAILABLE;
  const access = feedReady ? feed.data_access : null;

  const ready = data && data !== UNAVAILABLE;
  const imp = ready ? data.impersonations : null;
  const sessions = ready ? data.sessions : null;
  // D4691 — each of these is its own read: `available: false` is drawn as
  // unreadable in its own tile, never as a zero or an empty list.
  const mfa = ready && data.mfa?.available !== false ? data.mfa : null;
  const kycReadable = ready && data.kyc_available !== false && data.kyc;
  const kyc = kycReadable ? data.kyc : {};
  const dsrReadable = ready && data.dsr?.available !== false;
  const dsr = ready ? data.dsr?.rows || [] : [];
  const dsrGroups = ready ? data.dsr?.by_branch || [] : [];
  const dsrBranches = ready ? data.dsr?.branches : null;
  const dsrDue = dsr.filter((d) => d.days_left !== null && d.days_left <= 14).length;
  const withoutMfa = mfa ? mfa.admins_total - mfa.admins_with_mfa : null;
  // D200 — the ledger's own block: rows today and refused sign-ins, or the
  // reason neither could be read. `se.available === false` is a state the
  // bar and the Sessions tile each render as such, never as a zero.
  const se = ready ? data.security_events : null;
  // D152 — the rail's AI-safety row, built from the SERVER's list rather than
  // retyped, but kept to ONE literal pair. Spreading the mapped rows straight
  // into `unavailable` was the first shape and it was wrong: two guards read
  // that array line by line to prove every entry is a `[title, detail]` pair —
  // WorkerRail destructures each one, so a bare string renders as its first
  // two characters — and a spread hides the row shape from exactly the check
  // that exists to see it. The gaps' full reasons are in the zone; the rail
  // names them.
  const aiGaps = ready ? (data.ai_safety?.not_counted || []).map((n) => n.what) : [];
  // Computed here rather than inline, because the rail's `unavailable` entries
  // are ONE PER LINE by convention and two guards read that array line by
  // line — a wrapped pair is still a pair, and still invisible to them.
  const aiSafetyDetail = !ready ? 'unreadable'
    : (aiGaps.length
      ? `Guardrail verdicts and enforcement ARE counted — the zone above reads them. Not counted: ${aiGaps.join(' · ')}, each with its reason there.`
      : 'Counted, with nothing named as still missing.');
  // D200 — the same shape for the ledger: what it deliberately does not
  // record comes from the server's list, and the rail names it in one pair.
  const seGaps = ready ? (se?.not_counted || []).map((n) => n.what) : [];
  const securityGapsDetail = !ready ? 'unreadable'
    : (seGaps.length
      ? `Refusals and step-ups ARE recorded — the ledger above reads them. Not recorded: ${seGaps.join(' · ')}, each with its reason there.`
      : 'Recorded, with nothing named as still missing.');
  const sanctionsDetail = !ready ? 'unreadable'
    : (data.sanctions?.available
      ? `Read from sanctions_screenings — ${num(data.sanctions.runs_total)} run${data.sanctions.runs_total === 1 ? '' : 's'} recorded. Runs happen on request from the Trust Center; nothing schedules one.`
      : (data.sanctions?.reason || 'unreadable'));
  const backupDetail = !ready ? 'unreadable' : backupSentence(data.backup_dr?.backup);
  const drillDetail = !ready ? 'unreadable' : drillSentence(data.backup_dr?.drill);

  const rail = (
    <WorkerRail
      workspace="Security"
      role="super_admin"
      // D4803 (SE12): security prompts first; models, usage and top-up are one link away.
      prompts={SECURITY_PROMPTS}
      usageAt={SECURITY_USAGE_AT}
      stance="Read-only, except sessions and force re-auth"
      note="The security ledger, the admin action log, sessions, KYC, deletion clocks, the sanctions runs and the backup heartbeat are read from their stores. The acts here revoke sessions, sign accounts out and close data-subject requests, and each is recorded with its reason."
      coverage={ready ? [
        se?.available ? `${num(se.today)} security event${se.today === 1 ? '' : 's'} recorded today` : 'Security events: unreadable',
        data.audit?.available === false ? 'Admin actions: unreadable' : `${num(data.audit?.total) ?? 'an unrecorded number of'} admin actions on record`,
        imp?.available ? `${num(imp.active)} impersonation${imp.active === 1 ? '' : 's'} live` : 'Impersonations: unreadable',
        dsrReadable ? `${num(dsr.length)} deletion request${dsr.length === 1 ? '' : 's'} open` : 'Deletion requests: unreadable',
      ] : []}
      coverageNote={ready ? undefined : (data === UNAVAILABLE ? 'The security overview could not be read.' : 'Loading…')}
      unavailable={[
        // [title, detail] pairs: WorkerRail destructures each entry, so a bare
        // string would render as its first two characters.
        // D200 — THE ROW THAT SAID "No security_events ledger exists yet." IS
        // GONE, because the ledger exists (migration 282). What replaces it is
        // named by the SERVER: the events the ledger deliberately does not
        // count, each with its reason in the zone.
        ['Security events not counted', securityGapsDetail],
        // D152 — THIS ROW SAID "Nothing aggregates guardrail verdicts" AND IT
        // WAS FALSE. Something did: `aiRouter.loadAiUsageReport` had rolled
        // them up all along and `AiUsageTab` rendered them. Correcting it is
        // the sixth time this programme has had to re-aim a rail row the day
        // its refusal stopped being true, and what it says now is named by the
        // SERVER rather than retyped here, so the zone and the rail cannot
        // disagree about what is missing.
        ['AI safety counters', aiSafetyDetail],
        // D200 — "Not run on the platform." was FALSE: screenUser has written
        // sanctions_screenings since migration 035. The row now says what the
        // store holds and how a run happens.
        ['Sanctions screening', sanctionsDetail],
        // D200 — one absence became two facts. The backup half reads the
        // export's heartbeat. D263 — the drill half reads the drill's own
        // marker, in the same sentence the zone draws.
        ['Backup heartbeat', backupDetail],
        ['Restore drill', drillDetail],
        ['Per-tenant anything', 'No account names its licence yet (U1) — except a licence event, which is about one, and a security event, which names the deployment that recorded it.'],
        // D153 — THIS ROW IS GONE, not reworded: the overlay is built, so a
        // rail row saying it is not would be the stale-refusal defect this
        // programme keeps deleting. What the overlay does NOT cover is this
        // page, and that is a fact about scope rather than about a gap:
        // governance is HQ's own record of HQ's own acts.
        ['The security ledger under the overlay', 'Out of scope. Viewing as a branch scopes Home and Team; this ledger is HQ\'s record of what happened at HQ\'s door and what HQ did, which no branch holds.'],
      ]}
      data-testid="hq-security-rail"
    />
  );

  // D4800 — the Overview workspace's findings, clear row, areas and sources,
  // from the two reads above and nothing else.
  const overviewModel = buildOverview({ overview: readOf(data, readAt.overview), feed: readOf(feed, readAt.feed) });
  const categoryLabel = feedReady && feed.filter && feed.filter !== 'all'
    ? (feed.filters || GOV_FILTERS).find((f) => f.key === feed.filter)?.label || feed.filter
    : null;
  // D4803 — a search or date filter narrows the same read, and the count says so.
  const narrowedBy = feedReady ? activeCount(feed.applied) : 0;
  const filterLabel = categoryLabel && narrowedBy
    ? `${categoryLabel} and ${narrowedBy} more`
    : categoryLabel || (narrowedBy ? `${narrowedBy}-filter` : null);
  const refreshAll = () => { load(); loadFeed(); loadSessions(); };
  const observed = clockOf(readAt.overview);
  const here = tabOf(tab);

  // The implementation notes that used to open the page. They are true and
  // they stay, behind "Source details" (#4800: out of the primary reading path).
  const sourceNotes = (
    <>
      <p>
        Was Governance, which described the audit log and nothing else. The ledger here is H23&apos;s: five
        stores — the security_events ledger of refusals and step-ups, the admin action log, the activity log,
        impersonation sessions and licence events — merged newest-first into one monospace feed. Sanctions and
        backup read their own stores; the restore drill reads the marker each run writes. Only a licence
        event names a subsidiary and only a security event names its deployment — nothing else here is
        scoped per subsidiary yet, the guardrail counters included.
      </p>
      <p>
        &quot;Observed&quot; is the time this browser received each read. Each store also records its last good read
        (D5247) and has its own age, set from how often it is written: a store past its age is marked Stale.
        Sanctions screenings run on request only and have no age, so they are never Stale.
      </p>
    </>
  );

  /**
   * D4800 — THE WORKSPACES, keyed by `securityTabs.js`. Overview is Security
   * v2's; the other six hold today's zones for their area, moved here intact
   * so nothing the page did before has gone. #4801 to #4803 replace an entry
   * (Access first) rather than adding a second switch.
   */
  const workspaces = {
    overview: (
      <OverviewWorkspace
        model={overviewModel}
        onRetry={{ overview: load, feed: loadFeed }}
        filterLabel={filterLabel}
        sourceNotes={sourceNotes}
        mfaPolicy={mfaPolicy}
        mfaPolicyProps={mfaPolicyProps}
      />
    ),
    events: (
      <EventsWorkspace
        feed={feed}
        unavailable={UNAVAILABLE}
        filter={filter}
        setFilter={setFilter}
        controls={controls}
        setControls={setControls}
        onRetry={loadFeed}
        loadOlder={loadOlder}
        se={se}
        categories={GOV_FILTERS}
      />
    ),
    access: (
      <>
        <AccessSummaryZone sessions={sessions} imp={imp} mfa={mfa} withoutMfa={withoutMfa} se={se} />
        <AccessWorkspace list={sessionList} unavailable={UNAVAILABLE} onAct={onSessionAct} onRetry={loadSessions} onRefresh={refreshAll} onLoadMore={loadMoreSessions} />


        <DataAccessZone feed={feed} access={access} onRetry={loadFeed} />
      </>
    ),
    // D4803 slice 3: SE06 leads and owns the one write (Record outcome); the
    // previous zone stays behind "How this is measured", read-only.
    privacy: (
      <PrivacyWorkspace dsr={ready ? data.dsr : null} unreadable={data === UNAVAILABLE} onReread={load}>
        <DsrZone ready={ready} data={data} dsr={dsr} dsrGroups={dsrGroups} dsrReadable={dsrReadable} dsrBranches={dsrBranches} />
      </PrivacyWorkspace>
    ),
    // D4803 slice 4: SE07 leads; the previous zones stay behind "How this is measured".
    trust: (
      <TrustWorkspace overview={ready ? data : null} unreadable={data === UNAVAILABLE} onRetry={load}>
      <div className="grid gap-4 md:grid-cols-2">
        <Zone title="Sanctions review" sub="from the store's own runs">
          <Sanctions block={ready ? data.sanctions : null} unreadable={data === UNAVAILABLE} />
        </Zone>
        <KycZone ready={ready} data={data} kyc={kyc} kycReadable={kycReadable} />
      </div>
      </TrustWorkspace>
    ),
    // D4803 slice 2: SE08 leads; the previous zone stays whole behind "How this is measured".
    'ai-safety': (
      <AiSafetyWorkspace block={ready ? data.ai_safety : null} unreadable={data === UNAVAILABLE} onRetry={load}>
        <Zone title="AI safety" sub="guardrail hits · Advisor-AI outputs the screen caught">
          <AiSafety block={ready ? data.ai_safety : null} />
        </Zone>
      </AiSafetyWorkspace>
    ),
    // D4803 slice 2: SE09 leads; the previous zone stays whole behind "How this is measured".
    resilience: (
      <ResilienceWorkspace block={ready ? data.backup_dr : null} unreadable={data === UNAVAILABLE} onRetry={load}>
        <Zone title="Backup / DR drill" sub="the backup heartbeat and the restore drill, each read from its own record">
          <BackupDr block={ready ? data.backup_dr : null} unreadable={data === UNAVAILABLE} />
          {/* #5046: failover is drawn above as Unsupported, so it is not listed here as "Not recorded". */}
          {ready && <NotRecordedList items={otherNotRecorded(data.backup_dr)} testid="hq-dr-not-recorded" />}
        </Zone>
      </ResilienceWorkspace>
    ),
  };

  return (
    <RailFrame rail={rail} data-testid="hq-security-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] opacity-80 tabular-nums">
            <span>{ready ? `${num(dsrDue)} deletion request${dsrDue === 1 ? '' : 's'} inside deadline pressure` : '…'}</span>
            {/* H23's bar: `security_events · append-only · N rows today`. An
                unreadable ledger says so here, in the same slot, never `0`. */}
            <span className="font-mono" data-testid="hq-security-events-bar">
              {securityEventsBar(ready, se, data === UNAVAILABLE)}
            </span>
          </span>
        </div>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-muted">
              <ShieldCheck size={13} /> HQ · Security
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">
              {tab === 'overview' ? 'Security' : here.label}
            </h1>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted" data-testid="security-workspace-sub">{here.sub}</p>
            <p className="mt-1 text-[12.5px]">
              <Link to="/admin/security/obligations" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Trust obligations by role</Link>
              {' · '}
              {/* D1079 (#2971): TRU14, the public trust center's content. */}
              <Link to="/admin/security/trust-center" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="security-trust-content-link">Trust center content</Link>
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <HeaderAsk />
            {/* SE01's freshness and scope line: when the overview was read,
                Refresh, and the scope every figure here is drawn from. */}
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-axal-muted" data-testid="security-observed">
              <span aria-live="polite">{observed ? <>Observed <b>{observed}</b></> : (data === UNAVAILABLE ? 'Not read' : 'Reading…')}</span>
              <button type="button" onClick={refreshAll} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Refresh</button>
              <span className="rounded-md border border-axal-hairline px-1.5 py-0.5 text-[10.5px] font-semibold dark:border-gray-700" title="Scope">HQ-held accounts</span>
            </div>
            <SourceAvailability sources={overviewModel.sources} onRetry={loadFeed} filterLabel={filterLabel} compact data-testid="security-header-sources" />
          </div>
        </header>

        <SecurityTabs current={tab} onSelect={onTab} marks={overviewModel.marks} />

        {data === UNAVAILABLE && !OWN_UNREADABLE.has(tab) && <div className="mt-4"><Unreadable what="The security overview" claim="This is not a claim that nothing happened." onRetry={load} /></div>}

        <div className="mt-4 space-y-4" data-testid={`security-ws-${tab}`}>
          {workspaces[tab] || workspaces.overview}
        </div>
      </div>

    </RailFrame>
  );
}
