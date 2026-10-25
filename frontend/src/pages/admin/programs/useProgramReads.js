import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { insightsApi } from '../../../lib/api/insights';
import { learningApi } from '../../../lib/api/learning';
import { adminTestingApi } from '../../../lib/api/productTesting';
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

function arrayReply(reply) {
  if (!Array.isArray(reply)) throw new Error('The referrals did not come back as a list.');
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
/** R8, one call per open status, at the cap of 200. */
const readReferrals = (status) => () => api.adminReferralSubmissions({ status, limit: 200 }).then(arrayReply);

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

/** Mentor cohort access: Overview reads R5, R7 and R2; How it runs reads R7. People's body reads its own. */
export function useMentorReads(tab) {
  const [tick, reload] = useTick();
  const overview = tab === 'overview';
  const assignments = useRead('assignments', 'assignments', tick, overview, readAssignments);
  const timeline = useRead('timeline', 'timeline', tick, overview || tab === 'how', readTimeline);
  const hosts = useRead('hosts', 'hosts', tick, overview, readHosts);
  return { assignments, timeline, hosts, reload };
}

/**
 * Refer & Earn: the three open statuses on every tab (the Queue tab's count is
 * Overview's total), and R1 on Overview for the oldest and Overdue.
 */
export function useReferReads(tab) {
  const [tick, reload] = useTick();
  const submitted = useRead('referrals:submitted', 'submitted', tick, true, readReferrals(OPEN_STATUSES[0]));
  const underReview = useRead('referrals:under_review', 'under_review', tick, true, readReferrals(OPEN_STATUSES[1]));
  const moreInfo = useRead('referrals:more_info_needed', 'more_info_needed', tick, true, readReferrals(OPEN_STATUSES[2]));
  const glance = useRead('glance', 'glance', tick, tab === 'overview', readGlance);
  return { sets: { submitted, under_review: underReview, more_info_needed: moreInfo }, glance, reload };
}

/** Perks: R3 on every tab (the Queue tab's count), and R4 on Overview. */
export function usePerksReads(tab) {
  const [tick, reload] = useTick();
  const perkQueue = useRead('perk-queue', 'perk-queue', tick, true, readPerkQueue);
  const perks = useRead('perks', 'perks', tick, tab === 'overview', readPerks);
  return { perkQueue, perks, reload };
}

/** Learning: R9 on Overview and People; R10 for the program People picked. */
export function useLearningReads(tab, programUid) {
  const [tick, reload] = useTick();
  const learning = useRead('learning', 'learning', tick, tab === 'overview' || tab === 'people', readLearning);
  const learners = useRead('learners', `learners:${programUid || ''}`, tick, tab === 'people' && Boolean(programUid),
    () => learningApi.programLearners(programUid).then(listed('learners', 'The learners')));
  return { learning, learners, reload };
}
