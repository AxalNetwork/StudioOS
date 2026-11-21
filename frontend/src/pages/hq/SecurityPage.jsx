import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { adminMfaPolicyApi } from '../../lib/api/adminMfaPolicy';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { reportError } from '../../lib/log';
import AccessWorkspace from './security/AccessWorkspace.jsx';
import { feedQuery } from './security/eventsModel.js';
import { changeMfaPolicy } from './security/mfaPolicyModel.js';
import { tabFromSearch } from './security/securityTabs.js';
import { EMPTY_CONTROLS, UNAVAILABLE } from './security/securityShared.js';
import { SecurityConsole } from './security/SecurityConsole';

/**
 * HQ · Security — canvas H23 (Admin · Super), which "completes Y2/H7".
 *
 * ONE LEDGER, FIVE STORES, AND IT IS DELIBERATELY NOT PRETTY. H23's own
 * subtitle says so. The feed that used to be H7's "Privileged action log" —
 * four stores merged newest-first — is now H23's `security_events` ledger:
 * the same union with a fifth store, the `security_events` table migration
 * 282 created (D200), rendered as a MONOSPACE five-column ledger in the
 * canvas's columns (`ts · actor · branch · event · outcome`). H7 still draws
 * `Time · Actor · Tenant · Action · Target and reason` and five filters; H23
 * draws these five and says it completes H7, so H23 wins for this page and
 * D200 records the disagreement rather than picking silently.
 *
 * WHAT WAS "NOT RECORDED" AND IS NOT ANY MORE. This page used to name three
 * absences in the zones the canvas draws for them: the security ledger, a
 * sanctions screen, and backup / DR status. Measured, two of the three were
 * refusals denying stores the platform has — `sanctions_screenings` has been
 * written by `screenUser` since migration 035 (on request, never on a
 * schedule) and the nightly export writes a heartbeat to R2 the Worker can
 * read. So: the ledger is real (rows today, refused sign-ins in 24 hours, the
 * feed), the Sanctions card carries the store's own figures with the sentence
 * that a count of zero is a measured zero, and Backup / DR is two halves with
 * their own states — the export's heartbeat, and the restore drill's own
 * marker (D263; until then its outcome was written nowhere the platform could
 * read). H23 itself draws Sanctions as "Not recorded"; the canvas's sentence "a list
 * check happens inside KYC at the branch" is false for this repo, and the
 * card says what is true instead.
 *
 * ABSENT IS NOT ZERO. `num` returns null for a missing figure, a failed
 * request is unreadable rather than a quiet platform, and each `available:
 * false` block carries its reason onto the screen. A `security_events` count
 * that could not be read renders its reason in the bar, never `0 rows today`.
 *
 * AND H7'S RULE FOR ITSELF IS KEPT: "no cards, no summary tiles, no chart —
 * an audit log that has been made attractive is an audit log someone has
 * edited for legibility." No tile sits above the ledger. The tiles this page
 * does carry belong to H23's own cards, which are not the log.
 *
 * H7'S "Viewing as: Axal VC France · Return to HQ view" OVERLAY IS BUILT
 * (D153), and this page describes it rather than drawing it: the bar lives in
 * the shell, above every other bar, so it frames Home and Team rather than one
 * page. What this page carries is the sentence, and it comes from the payload
 * rather than from here so there is one copy of it. This page's own figures
 * stay HQ-wide — the ledger is HQ's record of what happened at HQ's door and
 * what HQ did, which is not a branch's to show.
 */
/*
 * D4708 part 3 (#4708) — THIS FILE IS THE SHELL. The view (`SecurityConsole`) and the zones it
 * draws live in `./security/` (that folder's README lists them); this file keeps the three reads,
 * the session acts and the route's default export, and re-exports the moved names so every
 * importer of this path is unchanged.
 */
export { UNAVAILABLE, EMPTY_CONTROLS, IDENTITY_KIND_LABEL, identityLine, impersonationNote } from './security/securityShared.js';
export { NotRecordedList } from './security/SecurityParts.jsx';
export { AiSafety, TokenAnomalies } from './security/AiSafetyZone.jsx';
export { DsrSubject, DsrKindsNotRecorded, dsrBranchesSentence } from './security/PrivacyZones.jsx';
export { Sanctions } from './security/TrustZones.jsx';
export { drillSentence, backupSentence, BackupDr } from './security/ResilienceZones.jsx';
export { SecurityConsole, securityEventsBar } from './security/SecurityConsole.jsx';

/**
 * D481 — which route each of the Access workspace's acts goes to. Sign out
 * account is D165's per-account route, reached from a row rather than
 * duplicated; the other three are D481's. D4801 — emergency
 * re-authentication goes through here too, so every write the workspace
 * makes leaves this page by one door (`security/README.md`: no request from
 * the workspace files).
 */
/**
 * D4699 — whether the operator is still signed in once `kind` succeeds, so the page may re-read.
 * Emergency re-authentication signs everyone out; signing out an account signs out its holder, so
 * the operator's own account counts as signed out. Revoking their own current session is refused
 * by the server, and ending a support session never ends the operator's.
 */
export function actLeavesOperatorSignedIn(kind, arg, ownUserId) {
  if (kind === 'emergency') return false;
  if (kind === 'sign_out') return ownUserId != null && Number(arg) !== Number(ownUserId);
  return kind === 'revoke' || kind === 'revoke_selected' || kind === 'end';
}

export async function runSessionAct(client, kind, arg, reason) {
  if (kind === 'revoke') return client.hqRevokeSession(arg, reason);
  if (kind === 'revoke_selected') return client.hqRevokeSessions(arg, reason);
  if (kind === 'end') return client.hqEndImpersonation(arg, reason);
  if (kind === 'sign_out') return client.hqForceReauthUser(arg, reason);
  if (kind === 'emergency') return client.hqSecurityForceReauth(reason);
  throw new Error(`Unknown session act: ${kind}`);
}

/**
 * D481's list, drawn by the Access workspace (D4801). A caller that still
 * mounts SessionsPanel gets that workspace: the row shows the network bucket,
 * never the address, and names a support-held session as held.
 */
export function SessionsPanel(props) {
  return <AccessWorkspace unavailable={UNAVAILABLE} onRetry={() => {}} {...props} />;
}

/**
 * D4800 (#4800, D4803) — the page is Security v2's shell: one header, seven
 * workspaces (`security/securityTabs.js`) at `?tab=`, and the three reads it
 * has always made. The reads live HERE, once, so moving between workspaces
 * never re-reads and every workspace sees the same answer. The view below
 * (`SecurityConsole`) takes them as props so a test can render any workspace
 * with a payload.
 */
export default function HqSecurityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromSearch(searchParams.get('tab'));
  const onTab = useCallback((key) => {
    setSearchParams((cur) => {
      const next = new URLSearchParams(cur);
      next.set('tab', key);
      return next;
    });
  }, [setSearchParams]);

  // When each read answered, in the browser — the "Observed" time. The
  // platform records no per-store collection time (#4800 question C).
  const [readAt, setReadAt] = useState({ overview: null, feed: null });
  const stampRead = (k) => setReadAt((cur) => ({ ...cur, [k]: new Date().toISOString() }));

  // D4699 — each read is numbered, and only the newest answer lands. A slow first read that answers
  // after a retry (or after a filter changed) is dropped instead of overwriting the newer one.
  const seq = useRef({ overview: 0, sessions: 0, feed: 0, mfaPolicy: 0 });
  const latest = (k) => { const n = ++seq.current[k]; return () => n === seq.current[k]; };

  const [data, setData] = useState(null);
  // `soft === true` only: `load` is also an onClick handler, and an event is not a soft re-read.
  const load = useCallback((soft) => {
    const current = latest('overview');
    if (soft !== true) setData(null);
    api.hqSecurityOverview().then(
      (r) => { if (current()) { setData(r); stampRead('overview'); } },
      (e) => { reportError('hq-security', e); if (current() && soft !== true) setData(UNAVAILABLE); },
    );
  }, []);
  useEffect(() => { load(); }, [load]);

  // D481 — the Sessions zone's list, its own request: it is a page of rows the
  // zone acts on, and an unreadable list must cost that zone alone.
  const [sessionList, setSessionList] = useState(null);
  const loadSessions = useCallback(() => {
    const current = latest('sessions');
    setSessionList(null);
    api.hqSecuritySessions().then(
      (r) => { if (current()) setSessionList(r); },
      (e) => { reportError('hq-sessions', e); if (current()) setSessionList(UNAVAILABLE); },
    );
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  // D5249 — "Require MFA for admins". The read is Super Admin only, so a plain
  // admin never asks for it and sees no control. The state shown is the
  // server's last answer: a change lands only from its reply, never optimistically.
  const isSuper = isSuperAdminUser(useAuth()?.user);
  const [mfaPolicy, setMfaPolicy] = useState(null);
  const loadMfaPolicy = useCallback(() => {
    if (!isSuper) return;
    const current = latest('mfaPolicy');
    setMfaPolicy(null);
    adminMfaPolicyApi.get().then(
      (r) => { if (current()) setMfaPolicy(r); },
      (e) => { reportError('hq-mfa-policy', e); if (current()) setMfaPolicy(UNAVAILABLE); },
    );
  }, [isSuper]);
  useEffect(() => { loadMfaPolicy(); }, [loadMfaPolicy]);
  const onSetMfaPolicy = useCallback(
    (enabled, reason) => changeMfaPolicy({ put: adminMfaPolicyApi.set, setPolicy: setMfaPolicy, reload: loadMfaPolicy }, enabled, reason),
    [loadMfaPolicy],
  );
  // D4699 — Load more: the next page below the last session id, appended once (a re-read or a new
  // first page in the meantime drops it). Resolves to the merged list, or throws for the caller's Retry.
  const loadMoreSessions = useCallback(async () => {
    const list = sessionList;
    const before = list?.cursor?.before_id;
    if (!before) return list;
    const current = seq.current.sessions;
    const page = await api.hqSecuritySessions(before);
    if (current !== seq.current.sessions) return list;
    const seen = new Set((list.rows || []).map((x) => x.id));
    const merged = { ...list, rows: [...(list.rows || []), ...(page.rows || []).filter((x) => !seen.has(x.id))], cursor: page.cursor || null, total: page.total ?? list.total, appended_to: list };
    setSessionList(merged);
    return merged;
  }, [sessionList]);

  // D4801 — the act; the SESSION LIST IS NOT RE-READ BEHIND IT. The workspace marks
  // what the server confirmed (a revoked row reads Revoked, in the dialog's
  // word) and offers Re-read. Re-reading on its own would also be wrong after
  // the two acts that sign the operator out: the next request answers 401 and
  // the page leaves for /login before the result could be read.
  // D4699 — what the act made stale elsewhere IS re-read, softly (the page and the dialog stay drawn):
  // the overview's counts and the ledger, after an act that leaves the operator signed in. Never after
  // emergency re-authentication, nor after signing out the operator's own account.
  const ownUserId = sessionList && sessionList !== UNAVAILABLE ? (sessionList.rows || []).find((x) => x.is_current)?.user_id ?? null : null;
  const refreshAfter = useRef(() => {});
  const onSessionAct = useCallback(async (kind, arg, reason) => {
    const result = await runSessionAct(api, kind, arg, reason);
    if (actLeavesOperatorSignedIn(kind, arg, ownUserId)) refreshAfter.current();
    return result;
  }, [ownUserId]);

  // H23's ledger, its own request. The filter is applied SERVER-side because
  // the feed is a merged page of sixty rows across five stores: filtering
  // that page in the browser would show whichever few of the sixty matched
  // and read as "that is all there is".
  const [feed, setFeed] = useState(null);
  const [filter, setFilter] = useState('all');
  // D4803 — the Events workspace's filters, sent with the category. The same
  // request feeds Overview's source count, which says which filter it counted under.
  const [controls, setControls] = useState(EMPTY_CONTROLS);
  const query = JSON.stringify(feedQuery(controls));
  const loadFeed = useCallback((soft) => {
    const current = latest('feed');
    if (soft !== true) setFeed(null);
    api.hqGovernance(filter, JSON.parse(query)).then(
      (r) => { if (current()) { setFeed(r); stampRead('feed'); } },
      (e) => { reportError('hq-governance', e); if (current() && soft !== true) setFeed(UNAVAILABLE); },
    );
  }, [filter, query]);
  refreshAfter.current = () => { load(true); loadFeed(true); };
  const loadOlder = useCallback((before, skip) => api.hqGovernance(filter, { ...JSON.parse(query), before, ...(skip ? { skip } : {}) }), [filter, query]);
  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  return (
    <SecurityConsole
      tab={tab}
      onTab={onTab}
      data={data}
      load={load}
      feed={feed}
      filter={filter}
      setFilter={setFilter}
      controls={controls}
      setControls={setControls}
      loadOlder={loadOlder}
      loadFeed={loadFeed}
      sessionList={sessionList}
      loadSessions={loadSessions}
      loadMoreSessions={loadMoreSessions}
      onSessionAct={onSessionAct}
      readAt={readAt}
      mfaPolicy={mfaPolicy}
      mfaPolicyProps={{ isSuper, unavailable: UNAVAILABLE, onSet: onSetMfaPolicy, onRetry: loadMfaPolicy }}
    />
  );
}
