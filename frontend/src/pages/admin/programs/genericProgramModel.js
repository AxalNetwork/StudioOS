// D4808 (#4808) — the generic, registry-backed program page and the proposal review page: their words and shapes.
// Pure, so a test reads them without drawing a page.
//
// A program the nine do not include (one an approval or New program made) has a registry row, a playbook, an activity
// read, an availability state and the capabilities its approved proposal declared. It has no bespoke page, and no route
// of its own: `/admin/programs/:key` draws these for any key the registry holds.
import { STATUS_WORD } from './catalogueModel';

export const PROGRAMS_PATH = '/admin/programs';
export const NOT_SET = 'Not set';
export const NOT_OPERATIONAL_WORD = 'Not operational yet';
export const UNKNOWN_PROGRAM = 'No program has that key.';
export const NO_PROPOSAL = 'No proposal made this program, so there is no approved specification to show.';
export const NO_CAPABILITIES = 'This program has declared no capabilities.';
export const NO_OPERATING_SCREEN = 'No operating screen exists for this program yet. It runs from this page.';

/**
 * D4873 (#4873, part 4, PG03): the shell's core sections, every program's: Overview, Playbook, Availability & grants,
 * Participation, History and Settings. Playbook and History keep D4808's addresses (`/how-it-runs`, `/activity`).
 */
const TAB_SUFFIX = Object.freeze({
  overview: '', how: '/how-it-runs', availability: '/availability', participation: '/participation', activity: '/activity', settings: '/settings',
});

/** A program's address, for a key the registry holds. */
export const programHref = (key, tab = 'overview') => `${PROGRAMS_PATH}/${encodeURIComponent(key)}${TAB_SUFFIX[tab] ?? ''}`;

/** The generic page's core tabs: the same shell for every program. */
export const genericTabs = (key) => [
  { key: 'overview', label: 'Overview', path: programHref(key) },
  { key: 'how', label: 'Playbook', path: programHref(key, 'how') },
  { key: 'availability', label: 'Availability & grants', path: programHref(key, 'availability') },
  { key: 'participation', label: 'Participation', path: programHref(key, 'participation') },
  { key: 'activity', label: 'History', path: programHref(key, 'activity') },
  { key: 'settings', label: 'Settings', path: programHref(key, 'settings') },
];

/** Which tab an address names. */
export function genericTabFrom(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  const hit = Object.entries(TAB_SUFFIX).find(([k, suffix]) => k !== 'overview' && path.endsWith(suffix));
  return hit ? hit[0] : 'overview';
}

/** The key an address names: `/admin/programs/<key>[/how-it-runs|/availability|/participation|/activity|/settings]`. */
export function genericKeyFrom(pathname) {
  const m = /^\/admin\/programs\/([^/]+)(?:\/(?:how-it-runs|availability|participation|activity|settings))?\/?$/.exec(String(pathname || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * D4873 (part 4): the capability modules the registry lists for a program (`programs.modules`), each with the
 * operating screen that already runs it. A module with no screen for this key is named and marked so; a program with
 * none runs from its core sections alone.
 */
export const MODULE_LABEL = Object.freeze({
  applications: 'Applications', hosts: 'Hosts', cohorts: 'Cohorts', referral_queue: 'Referral queue', perk_queue: 'Perk queue',
  learners: 'Learners', influencers: 'Influencers', offers: 'Offers', nda_signature: 'NDA / signature',
});
const MODULE_PATHS = Object.freeze({
  'spinout-lab': { applications: '/applications', cohorts: '/cohorts', hosts: '/hosts' },
  'mentor-cohorts': { cohorts: '/people' },
  'investor-cohorts': { cohorts: '', nda_signature: '' },
  'referral-partners': { referral_queue: '/queue' },
  'refer-and-earn': { referral_queue: '/queue' },
  perks: { perk_queue: '/queue' },
  learning: { learners: '/people' },
  influencer: { applications: '/applications', influencers: '/influencers' },
});
export const NO_MODULES = 'None yet. This program works with the core sections alone.';
export const MODULES_UNREAD = 'Its modules could not be read.';

/** `{ state, rows: [{ key, label, path }] }` from the program read; `path` null where no screen runs the module here. */
export function moduleRows(programKey, program) {
  if (!program || typeof program !== 'object') return { state: 'loading', rows: [] };
  if (program.extras && program.extras.available === false) return { state: 'unreadable', rows: [] };
  if (!Array.isArray(program.modules)) return { state: 'pending', rows: [] };
  const paths = MODULE_PATHS[programKey] || {};
  return {
    state: 'ready',
    rows: program.modules.map((m) => ({
      key: m, label: MODULE_LABEL[m] || m,
      path: m in paths ? `${PROGRAMS_PATH}/${programKey}${paths[m]}` : null,
    })),
  };
}

/**
 * D5313 (#5313): the modules from a page's own registry read (`useProgramDetail`'s `read`), for a built-in program in
 * the shell. Its page draws while that read is out or after it failed, so a failed read is "Could not be read", never
 * none, and one still out is loading.
 */
export function shellModules(programKey, read) {
  if (!read || read.status === 'loading') return { state: 'loading', rows: [] };
  if (read.status !== 'ready') return { state: 'unreadable', rows: [] };
  return moduleRows(programKey, read.data?.program || {});
}

/** The member-access choices Settings offers: the registry's seven words, and Not recorded (null). */
export const ACCESS_CHOICES = Object.freeze(['open', 'apply', 'request', 'invite', 'assigned', 'not_open', 'closed']);
export const PARTICIPATION_UNRECORDED = 'No participation store exists for this program yet, so who has joined is not recorded. It is not the same as nobody.';

/** The refusal a registry read ended in: a key nobody holds, or a read that failed. */
export function readProblem(error) {
  const status = Number(error?.status ?? error?.response?.status);
  const code = error?.data?.code || error?.code || error?.data?.error || null;
  if (status === 404 || code === 'unknown_program') return { kind: 'unknown', sentence: UNKNOWN_PROGRAM };
  return { kind: 'unreadable', sentence: 'This program could not be read. That is not the same as it having no details.' };
}

const dash = (v) => (v === null || v === undefined || v === '' ? null : v);
const list = (v) => (Array.isArray(v) && v.length ? v.join(', ') : null);

/** The registry row's facts, in the shell every program shares. A value nobody set is `null` ("Not set"). */
export function metadataRows(program) {
  const p = program || {};
  return [
    { key: 'group', label: 'Group', value: dash(p.group) },
    { key: 'status', label: 'Status', value: STATUS_WORD[p.status] || null },
    { key: 'purpose', label: 'Purpose', value: dash(p.purpose) },
    { key: 'who', label: 'Who it is for', value: dash(p.who) },
    { key: 'join', label: 'How people join', value: dash(p.join_method) },
    { key: 'studio', label: 'Offered to', value: p.studio_only ? 'One studio' : 'Every studio' },
    { key: 'updated', label: 'Updated', value: dash(p.updated_at) },
  ];
}

const WORDS = {
  rolling: 'Rolling',
  cohorts: 'In cohorts',
};

/**
 * Every material field of a proposal, for the review before Decide and for the approved specification.
 * `operational: false` rows carry D4808's marker: recorded as approved, enforced by nothing yet.
 */
export function specRows(f) {
  const x = f || {};
  const tools = x.tools && typeof x.tools === 'object' ? Object.entries(x.tools).filter(([, on]) => on === true).map(([k]) => k) : null;
  return [
    { key: 'name', label: 'Name', value: dash(x.name), operational: true },
    { key: 'group', label: 'Group', value: dash(x.group), operational: true },
    { key: 'purpose', label: 'Purpose', value: dash(x.purpose), operational: true },
    { key: 'who', label: 'Who it is for', value: list(x.who), operational: true },
    { key: 'join_method', label: 'How people join', value: dash(x.join_method), operational: true },
    { key: 'cycle', label: 'Cycle', value: x.cycle ? `${WORDS[x.cycle] || x.cycle}${x.cohort_weeks ? ` · ${x.cohort_weeks} ${x.cohort_weeks === 1 ? 'week' : 'weeks'}` : ''}` : null, operational: false },
    { key: 'seats', label: 'Seats', value: x.seats === null || x.seats === undefined ? null : String(x.seats), operational: false },
    { key: 'eligibility', label: 'Eligibility', value: dash(x.eligibility), operational: false },
    { key: 'rewards', label: 'Rewards', value: list(x.rewards), operational: false },
    { key: 'templates', label: 'Contracts and templates', value: list(x.template_keys), operational: false },
    { key: 'tools', label: 'Tools', value: tools && tools.length ? tools.join(', ') : null, operational: false },
    { key: 'hq', label: 'What HQ receives', value: dash(x.hq_receives), operational: false },
  ];
}

/** The line under a not-operational row. */
export const notOperationalLine = (spec) => spec?.not_operational?.reason || 'Recorded as approved. Nothing enforces it yet.';

/** The approved proposal's rows for the program's page (from the frozen spec). */
export const approvedRows = (approved) => specRows(approved?.spec?.fields);

/** The declared capabilities, each with whether it operates. */
export function capabilityRows(capabilities) {
  return (Array.isArray(capabilities) ? capabilities : []).map((c) => ({
    key: String(c.key), label: String(c.label || c.key), operational: c.operational === true,
  }));
}

/** The review page's address. */
export const reviewHref = (uid) => `${PROGRAMS_PATH}/proposals/${encodeURIComponent(uid)}`;

/** Where an approved proposal's program is. */
export const decidedProgramHref = (proposal) => (proposal?.program_key ? programHref(proposal.program_key) : null);

/** The compact proposal line on the catalogue: how many wait on HQ, in words. */
export function proposalSummary(waiting, now = Date.now()) {
  if (!waiting || waiting.state === 'loading') return { state: 'loading', text: 'Reading the proposals…' };
  if (waiting.state === 'unreadable') return { state: 'unreadable', text: 'The proposals could not be read. That is not the same as none.' };
  if (waiting.state !== 'ready') return { state: 'off', text: '' };
  const n = Number(waiting.count) || 0;
  const out = { state: 'ready', count: n, text: n === 0 ? 'No proposal is waiting on HQ.' : `${n.toLocaleString('en-US')} ${n === 1 ? 'proposal is' : 'proposals are'} waiting on HQ.` };
  // D4873 (PG01): the oldest one's age and the latest one's studio, from the queue's own rows. The queue reads
  // oldest first, a page at a time, so the latest studio is known only when every waiting row was read.
  const rows = Array.isArray(waiting.rows) ? waiting.rows.filter((r) => r && r.sent_at) : [];
  if (n > 0 && rows.length) {
    const byAge = [...rows].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
    out.oldest = daysSince(byAge[0].sent_at, now);
    out.latestStudio = rows.length >= n ? byAge[byAge.length - 1].studio || null : null;
  }
  return out;
}

/** "3 days", "1 day" or "today", from an ISO time. */
export function daysSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((now - t) / 86_400_000);
  return d <= 0 ? 'today' : `${d} ${d === 1 ? 'day' : 'days'}`;
}
