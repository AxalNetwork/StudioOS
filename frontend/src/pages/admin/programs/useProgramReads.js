import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { insightsApi } from '../../../lib/api/insights';
import { learningApi } from '../../../lib/api/learning';
import { adminTestingApi } from '../../../lib/api/productTesting';
import { programsApi } from '../../../lib/api/programs';
import { reportError } from '../../../lib/log';
import { OPEN_STATUSES } from './programsModel';

/**
 * D953 (#2371) — the Programs pages' reads, each made alone, so one that fails
 * marks only the blocks it feeds and the rest of the page stands (D953 §2).
 * A page makes only the reads its blocks draw; `reload()` reads them again.
 * Every client is an existing one: this file adds no `/api/*` method.
 */

const idle = (what) => ({ status: 'loading', data: null, error: null, at: null, what });

/**
 * One read. `what` names what it reads (a new `what` starts from loading);
 * `tick` reads it again, and a read that already answered keeps its answer on
 * screen until the new one lands, as on the Events desk (D915). `load` is
 * rebuilt on every render and is not a dependency, so an inline function
 * cannot re-run the effect in a loop.
 */
export function useRead(scope, what, tick, enabled, load) {
  const [read, setRead] = useState(() => idle(what));
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setRead((r) => (r.status === 'ready' && r.what === what ? r : idle(what)));
    Promise.resolve().then(load).then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null, at: Date.now(), what }); },
      (error) => {
        reportError(`admin-programs:${scope}`, error);
        if (live) setRead({ status: 'error', data: null, error, at: null, what });
      },
    );
    return () => { live = false; };
    // `load` is rebuilt on every render; `what`, `tick` and `enabled` say when to call it.
  }, [what, tick, enabled]);
  return read;
}

/** A reply without the list it should carry is a failed read, never an empty one. */
function listed(key, what) {
  return (reply) => {
    if (!Array.isArray(reply?.[key])) throw new Error(`${what} did not come back as a list.`);
    return reply;
  };
}
const items = (what) => listed('items', what);

function hostsReply(reply) {
  if (!Array.isArray(reply?.items) || !Number.isFinite(Number(reply?.counts?.pending))) {
    throw new Error('The office-hours hosts did not come back with their counts.');
  }
  return reply;
}

/** R1, R2 and R3: what Waiting for you and the cards' Needs you count. */
const readGlance = () => api.adminStudioGlance();
const readHosts = () => api.adminLabHosts('pending').then(hostsReply);
const readPerkQueue = () => api.perkReviewQueue().then(items('The perk review queue'));
const readPerks = () => api.perksCatalog().then(items('The live perks'));
const readAssignments = () => api.adminAdvisorCohortAssignments().then(items('The mentor assignments'));
const readTimeline = () => api.adminCohortTimeline().then(listed('cycles', 'The cohort cycles'));
const readLearning = () => learningApi.assignedPrograms().then(listed('programs', 'The learning programs'));
const readTesting = () => adminTestingApi.programmes().then(items('The testing programs'));
const readScopes = () => insightsApi.insightsScopes();
/** D962: 565's grants and ends (M1), the five newest activity rows (P2) and the sessions (P3). */
const readHistory = () => api.adminAdvisorCohortHistory({ limit: 200 }).then(items('The access history'));
const readRecent = () => programsApi.activity('mentor-cohorts', { limit: 5 }).then(listed('rows', 'The activity'));
const readSessions = () => programsApi.mentorSessions().then(listed('cycles', 'The sessions'));

function useTick() {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return [tick, reload];
}

/** The catalogue (PG1, PG2): every read its tiles and cards draw; R11 and R12 for a Super Admin only. */
export function useCatalogueReads(superAdmin) {
  const [tick, reload] = useTick();
  const glance = useRead('glance', 'glance', tick, true, readGlance);
  const hosts = useRead('hosts', 'hosts', tick, true, readHosts);
  const perkQueue = useRead('perk-queue', 'perk-queue', tick, true, readPerkQueue);
  const perks = useRead('perks', 'perks', tick, true, readPerks);
  const assignments = useRead('assignments', 'assignments', tick, true, readAssignments);
  const timeline = useRead('timeline', 'timeline', tick, true, readTimeline);
  const learning = useRead('learning', 'learning', tick, true, readLearning);
  const testing = useRead('testing', 'testing', tick, Boolean(superAdmin), readTesting);
  const scopes = useRead('scopes', 'scopes', tick, Boolean(superAdmin), readScopes);
  const drawn = [glance, hosts, perkQueue, perks, assignments, timeline, learning, ...(superAdmin ? [testing] : [])];
  return { glance, hosts, perkQueue, perks, assignments, timeline, learning, testing, scopes, drawn, reload };
}

/**
 * Mentor cohort access: Overview reads R5, R7, R2, 565's history (M1) and the
 * five newest activity rows (P2); How it runs reads R5 (founders hidden), R7
 * and the sessions (P3); Activity reads R7 to name each cohort. People's body
 * reads its own. Every tab reads R5 and R7, which the header's Assign uses.
 */
export function useMentorReads(tab) {
  const [tick, reload] = useTick();
  const overview = tab === 'overview';
  const assignments = useRead('assignments', 'assignments', tick, true, readAssignments);
  const timeline = useRead('timeline', 'timeline', tick, true, readTimeline);
  const hosts = useRead('hosts', 'hosts', tick, overview, readHosts);
  const history = useRead('history', 'history', tick, overview, readHistory);
  const recent = useRead('recent', 'recent', tick, overview, readRecent);
  const sessions = useRead('sessions', 'sessions', tick, tab === 'how', readSessions);
  return { assignments, timeline, hosts, history, recent, sessions, reload };
}

/** A paged read's reply: `{ items, total }`, or a failed read. */
function paged(what) {
  return (reply) => {
    if (!Array.isArray(reply?.items) || !Number.isFinite(Number(reply?.total))) throw new Error(`${what} did not come back with a total.`);
    return reply;
  };
}
/** D962 (F1): one exact total, read as a page of one. */
const referTotal = (status) => () => api.adminReferralSubmissions({ ...(status ? { status } : {}), limit: 1, offset: 0 }).then(paged('The referrals'));

/**
 * Refer & Earn (D962): the open total on every tab (the Queue tab's count);
 * on Overview, each figure's exact total (F1), the oldest 200 open for the
 * bands, the weekly read (F3), the strategic queue (F4), and R1 for the
 * oldest and Overdue. The Queue reads its own pages.
 */
export function useReferReads(tab) {
  const [tick, reload] = useTick();
  const overview = tab === 'overview';
  const open = useRead('refer:open', 'open', tick, true, referTotal(OPEN_STATUSES.join(',')));
  const all = useRead('refer:all', 'all', tick, overview, referTotal(null));
  const converted = useRead('refer:converted', 'converted', tick, overview, referTotal('converted,reward_eligible,reward_issued'));
  const submitted = useRead('refer:submitted', 'submitted', tick, overview, referTotal('submitted'));
  const underReview = useRead('refer:under_review', 'under_review', tick, overview, referTotal('under_review'));
  const moreInfo = useRead('refer:more_info_needed', 'more_info_needed', tick, overview, referTotal('more_info_needed'));
  const rejected = useRead('refer:rejected', 'rejected', tick, overview, referTotal('rejected'));
  const closed = useRead('refer:closed', 'closed', tick, overview, referTotal('closed'));
  const oldest = useRead('refer:oldest', 'oldest', tick, overview,
    () => api.adminReferralSubmissions({ status: OPEN_STATUSES.join(','), sort: 'oldest', limit: 200, offset: 0 }).then(paged('The open referrals')));
  const weekly = useRead('refer:weekly', 'weekly', tick, overview, () => api.adminReferralWeekly(12));
  const strategic = useRead('refer:strategic', 'strategic', tick, overview, () => api.adminStrategicAccess({ status: 'requested', limit: 200 }).then(paged('The strategic access requests')));
  const glance = useRead('glance', 'glance', tick, overview, readGlance);
  return {
    open, all, converted, totals: { submitted, under_review: underReview, more_info_needed: moreInfo }, rejected, closed,
    oldest, weekly, strategic, glance, reload,
  };
}

/**
 * Perks (D962): the listings in review, oldest first (K1), on every tab: its
 * total is the Queue tab's count and Overview's Waiting for review, and its
 * first row is the oldest. On Overview, R4's live listings and the claims
 * (K2, twelve weeks). The Queue reads its own pages.
 */
export function usePerksReads(tab) {
  const [tick, reload] = useTick();
  const inReview = useRead('perks:in-review', 'in-review', tick, true,
    () => api.adminPerkListings({ status: 'in_review', sort: 'oldest', limit: 1, offset: 0 }).then(paged('The listings in review')));
  const perks = useRead('perks', 'perks', tick, tab === 'overview', readPerks);
  const claims = useRead('perks:claims', 'claims', tick, tab === 'overview', () => api.adminPerkClaims(12));
  return { inReview, perks, claims, reload };
}

/** Learning: R9 on Overview and People; P4 on Overview; R10 for the program People picked. */
export function useLearningReads(tab, programUid) {
  const [tick, reload] = useTick();
  const learning = useRead('learning', 'learning', tick, tab === 'overview' || tab === 'people', readLearning);
  const weekly = useRead('learning:weekly', 'weekly', tick, tab === 'overview', () => programsApi.learningWeekly(12));
  const learners = useRead('learners', `learners:${programUid || ''}`, tick, tab === 'people' && Boolean(programUid),
    () => learningApi.programLearners(programUid).then(listed('learners', 'The learners')));
  return { learning, weekly, learners, reload, tick };
}

/**
 * D962: R10 for each program `uids` names, each read alone, so a program
 * whose learners cannot be read marks only its own row (Completion by
 * program, OD9's Finished).
 */
export function useLearnersFor(uids, tick, enabled) {
  const [reads, setReads] = useState({});
  const key = uids.join(',');
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setReads(Object.fromEntries(uids.map((u) => [u, { status: 'loading', data: null, error: null, at: null }])));
    uids.forEach((u) => {
      learningApi.programLearners(u).then(listed('learners', 'The learners')).then(
        (data) => { if (live) setReads((r) => ({ ...r, [u]: { status: 'ready', data, error: null, at: Date.now() } })); },
        (error) => { reportError('admin-programs:learners', error); if (live) setReads((r) => ({ ...r, [u]: { status: 'error', data: null, error, at: null } })); },
      );
    });
    return () => { live = false; };
    // `uids` is keyed by `key`.
  }, [key, tick, enabled]);
  return reads;
}
