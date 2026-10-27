import { NONE_CLAIM, NOT_RECORDED, cohortName, isFailed, isLoading, isReady } from './programsModel.js';
import { refusalSentence } from './programPagesModel.js';

/**
 * D963 (#2796, Programs part 10) — Investor cohort access (PG11) and Give an
 * investor access (PG11d), on part 6's admin reads (D959,
 * `frontend/src/lib/api/investorCohorts.js`). Pure.
 *
 * VERIFIED is D653's rule (O-VER A): an investor account that is active, with
 * approved KYC. The Worker applies it on every give and every read; the page
 * only says what the Worker answered (`verified_now`).
 *
 * WHAT A GRANT OPENS (O-SEE A) is the venture summary and weekly progress.
 * Pitch deck and Demo Day have nothing to read yet (`scope_unavailable`), so
 * PG11d does not offer them.
 */

const nf = (n) => Number(n).toLocaleString('en-US');

export const ACCESS_WORD = Object.freeze({
  active: 'Active', ended: 'Ended', waits_for_verification: 'Waits for verification', waits_for_nda: 'Waits for the NDA',
});
export const NDA_WORD = Object.freeze({ signed: 'Signed', sent: 'Sent', not_sent: 'Not sent' });
export const SCOPES = Object.freeze([
  { key: 'summary', label: 'Venture summary' },
  { key: 'weekly_progress', label: 'Weekly progress' },
]);
export const SCOPES_CLOSED = 'Pitch deck and Demo Day room are not open yet: there is nothing for an investor to read there.';
export const NDA_TEMPLATE_LABEL = 'Cohort NDA · investor_cohort_nda_v1';
export const NDA_TEMPLATE_LINE = Object.freeze({
  published: 'The cohort NDA template is published. Each grant sends it to the investor to sign before they read anything.',
  missing: 'No cohort NDA template is published yet, so every grant waits for the NDA. HQ writes it in the legal template library.',
  unreadable: 'The cohort NDA template could not be read just now. That is not the same as missing.',
});
export const FOUNDER_COUNT_WAITS = 'Its founder count is not read here yet: what counts as a cohort’s founders is not decided.';
export const INVESTORS_EMPTY = 'No investor has access yet. An admin gives a verified investor access to one cohort.';
export const GIVEN_DONE = 'Access given. The investor reads nothing until they sign the cohort NDA.';
export const ENDED_DONE = 'Access ended. The investor can no longer read this cohort, and its founders are told.';
export const PAGE = 25;

/** The four tiles from the summary. A count it could not read (`founders_hidden: null`) is "Could not be read", never 0. */
export function investorTiles(read) {
  const keys = [['investors', 'Investors with access'], ['cohorts', 'Cohorts open to investors'], ['hidden', 'Founders hidden'], ['intros', 'Intro requests']];
  if (isLoading(read)) return keys.map(([key, label]) => ({ key, label, state: 'loading' }));
  if (isFailed(read) || !isReady(read) || !read.data || typeof read.data !== 'object') {
    return keys.map(([key, label]) => ({ key, label, state: 'unreadable', reason: `Investor cohort access could not be read. ${NONE_CLAIM}` }));
  }
  const d = read.data;
  const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const out = [];
  const put = (key, label, v, sub, unreadable) => out.push(v === null
    ? (unreadable
      ? { key, label, state: 'unreadable', reason: `${label} could not be read. ${NONE_CLAIM}` }
      : { key, label, state: 'placeholder', word: NOT_RECORDED, reason: 'The summary did not carry this figure.' })
    : { key, label, state: 'ready', value: nf(v), sub });
  put('investors', 'Investors with access', num(d.investors_with_access), 'Verified now, with open access.');
  put('cohorts', 'Cohorts open to investors', num(d.cohorts_open), 'With at least one open grant.');
  put('hidden', 'Founders hidden', num(d.founders_hidden), 'Founders who hid from an investor with access.', d.founders_hidden === null);
  const accepted = num(d.intros_accepted);
  put('intros', 'Intro requests', num(d.intro_requests), accepted === null ? null : `${nf(accepted)} accepted`);
  return out;
}

/** The grants list's query: search from two characters, the three filters and the page. */
export function grantParams({ q = '', cycleId = '', nda = '', state = '', page = 0 } = {}) {
  const needle = q.trim();
  return {
    ...(needle.length >= 2 ? { q: needle } : {}),
    ...(cycleId ? { cycle_id: cycleId } : {}),
    ...(nda ? { nda } : {}),
    ...(state ? { state } : {}),
    limit: PAGE, offset: page * PAGE,
  };
}

/** A grant's cohort: the Worker's label, else "Cycle #[id]", as People does. */
export const grantCohort = (g) => g?.cohort?.label || `Cycle #${g?.cohort?.id ?? '?'}`;

/** Cohorts PG11d offers: scheduled or running ones from the timeline, soonest first, with their dates. */
export function cohortChoices(timeline) {
  const cycles = isReady(timeline) && Array.isArray(timeline.data?.cycles) ? timeline.data.cycles : [];
  return cycles
    .filter((c) => c.status === 'scheduled' || c.status === 'active')
    .map((c) => ({ id: Number(c.id), label: cohortName(c), dates: datesOf(c), cycle: c }))
    .sort((a, b) => String(a.cycle.start_at || '').localeCompare(String(b.cycle.start_at || '')));
}
function datesOf(c) {
  const s = Date.parse(c.start_at || '');
  const e = Date.parse(c.end_at || '');
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  const f = (ms, o) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  return `${f(s, { day: 'numeric', month: 'short' })}–${f(e, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** PG11d's line under the fields. */
export const toldLine = (cohort, name) => `Founders in ${cohort || '[the cohort]'} are told that ${name || '[the investor]'} can read their ventures.`;

/** PG11d's body, or what to fix first. */
export function giveBody({ investor, cohort, endsOn, scope, note, today }) {
  if (!investor) return { error: 'Choose a verified investor.' };
  if (investor.has_open_grant) return { error: 'This investor already has open access to this cohort.' };
  if (!cohort) return { error: 'Choose a cohort.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn || '') || (today && endsOn < today)) return { error: 'The end date is the last day of access, today or later.' };
  const picked = SCOPES.map((s) => s.key).filter((k) => scope?.[k]);
  if (!picked.length) return { error: 'Choose what they see.' };
  return { body: { investor_user_id: Number(investor.id), cohort_cycle_id: Number(cohort.id), ends_at: endsOn, scope: picked, note: (note || '').trim() || null } };
}

export const INVESTOR_REFUSALS = Object.freeze({
  not_verified: 'Only a verified investor can be given a cohort: an active investor account with approved KYC. Nothing changed.',
  already_active: 'This investor already has open access to this cohort, so nothing changed.',
  invalid_end_date: 'The end date is the last day of access, today or later. Nothing changed.',
  scope_unavailable: 'Pitch deck and Demo Day have nothing to read yet, so a grant cannot open them. Nothing changed.',
  invalid_scope: 'Choose the venture summary, weekly progress or both. Nothing changed.',
  note_too_long: 'Keep the note to 1,000 characters. Nothing changed.',
  user_not_found: 'That investor’s account is not on record now. Nothing changed.',
  cycle_not_found: 'That cohort is not on record now. Nothing changed.',
  grant_not_found: 'This access is not on record now. Refresh the list.',
  already_ended: 'This access has already ended, so nothing changed. Refresh to see the list as it is.',
  invalid_ids: 'Choose the investor and the cohort again. Nothing changed.',
});
const codeOf = (err) => err?.code || err?.data?.code || (typeof err?.data?.error === 'string' ? err.data.error : null);
export function investorRefusal(err, fallback) {
  const c = codeOf(err);
  return (c && INVESTOR_REFUSALS[c]) || refusalSentence(err, fallback);
}
