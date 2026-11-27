/**
 * D7516 (#7516, Expertise v2 EX-01, EX-03, EX-04b) — what the Expertise
 * Overview says above its sections, pure: the four status dimensions
 * (Completion, Publication, Verification, Availability), the Next step and up
 * to two more, and whether the viewer is an administrator previewing the
 * Advisor role. `ExpertiseOverview.jsx` draws it.
 *
 * EVERY FIGURE COMES FROM A READ THE BOARD ALREADY MAKES. The input is the
 * Expertise board's own source states (`useBucketSources`, D4697): `profile`
 * (`GET /api/advisors/me`), `services`, `proof`, `thinking` (their `/me/*`
 * lists, whose `counts` cover the whole list, D4689) and `visibility`
 * (`/me/visibility`, booking links). Nothing here reads again, and nothing is
 * counted off a page of rows where the Worker sends a whole-list count. Where
 * a fact needs the whole list and only a page came back, the fact is left out
 * rather than understated.
 *
 * A FAILED READ IS NEVER A VALUE. A dimension whose read failed is Unavailable,
 * one whose read was refused (the Advisor licence, #5363) is Refused, and one
 * built from several reads with one missing is Partial: #5129's states, drawn
 * with its `StateChip`. A step that would come from a failed read is not
 * offered, and the card says which reads it could not use.
 */
import { MATCH_FIELDS, filled } from './profileFields.js';
import { ADVISOR_LICENCE_REQUIRED } from './licenceRefusal.js';
import { SESSIONS_PATH, stageKey } from './expertiseModel.js';

/** The board's sources each dimension reads, and what a failed one is called in a sentence. */
export const SOURCE_NAMES = Object.freeze({
  profile: 'your profile', services: 'Services', proof: 'Proof', thinking: 'Thinking', visibility: 'your booking links',
});

export const PROFILE_PATH = '/expertise/profile';
export const SERVICES_PATH = '/expertise/services';
export const PROOF_PATH = '/expertise/proof';
/** The public profile a founder reads (`App.jsx`, `/advisors/:uid`, D571). */
export const publicProfilePath = (profile) => (profile?.uid ? `/advisors/${encodeURIComponent(profile.uid)}` : null);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const whole = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
const num = (v) => (v == null || v === '' ? null : whole(Number(v)));
const ready = (s) => s?.state === 'ready';
const failed = (s) => s?.state === 'error';
const refused = (s) => failed(s) && s.code === ADVISOR_LICENCE_REQUIRED;
/** A page that holds the whole list: the Worker says there is no next page. */
const wholePage = (page) => page != null && page.next_offset == null;

/** Completion: the fields a match surface reads (`MATCH_FIELDS`, the Profile meter's list), filled or not. */
export function completionOf(profile) {
  const missing = MATCH_FIELDS.filter(([, key]) => !filled(profile, key)).map(([label]) => label);
  return { complete: MATCH_FIELDS.length - missing.length, total: MATCH_FIELDS.length, missing };
}

/**
 * The state a dimension is in, from the reads it needs. `primary` must have
 * read for the dimension to have a value at all; any other that failed makes
 * it Partial. Exactly one of: loading · refused · unavailable · partial · value.
 */
export function dimensionState(sources, keys) {
  const states = keys.map((k) => sources?.[k]);
  if (states.some((s) => !s || s.state === 'loading')) return 'loading';
  if (refused(states[0])) return 'refused';
  if (failed(states[0])) return 'unavailable';
  return states.slice(1).some(failed) ? 'partial' : 'value';
}

/** Each dimension: the reads behind it, and its value from those reads once the first has read. */
export const DIMENSIONS = Object.freeze([
  {
    key: 'completion',
    label: 'Completion',
    reads: ['profile'],
    value: ({ profile }) => {
      if (profile == null) {
        return { word: 'No profile yet', fact: null, sub: 'A profile gives founders a page to find you.', tone: 'warn', action: { label: 'Create profile', to: PROFILE_PATH } };
      }
      const c = completionOf(profile);
      return {
        word: c.missing.length ? 'Incomplete' : 'Complete',
        fact: `${c.complete} of ${c.total} fields`,
        sub: c.missing.length
          ? `Missing: ${c.missing.join(', ').toLowerCase()}.`
          : 'Every field a match reads is filled. This counts fields, not how good they are.',
        tone: c.missing.length ? 'warn' : 'ok',
        action: { label: 'Edit profile', to: PROFILE_PATH },
      };
    },
  },
  {
    key: 'publication',
    label: 'Publication',
    reads: ['profile', 'services', 'thinking'],
    value: ({ profile, services, thinking }) => {
      if (profile == null) {
        return { word: 'Nothing public', fact: null, sub: 'Nothing is public until you save a profile.', tone: 'neutral', action: null };
      }
      const parts = [];
      const svc = services === undefined ? null : num(services?.publication_counts?.published);
      const art = thinking === undefined ? null : num(thinking?.counts?.published);
      if (svc != null) parts.push(`${plural(svc, 'service')} published`);
      if (art != null) parts.push(`${plural(art, 'article')} published`);
      const to = publicProfilePath(profile);
      return {
        word: profile.is_active ? 'Profile listed' : 'Profile not listed',
        fact: parts.length ? parts.join(' · ') : null,
        sub: 'Proof is private to you: no claim is on your public profile.',
        tone: profile.is_active ? 'ok' : 'neutral',
        action: to ? { label: 'Preview public profile ↗', to } : null,
      };
    },
  },
  {
    key: 'verification',
    label: 'Verification',
    reads: ['proof'],
    value: ({ proof }) => {
      const c = proof?.counts || {};
      const total = num(c.total ?? proof?.page?.total);
      const attested = num(c.attested);
      const awaiting = num(c.awaiting);
      const selfStated = num(c.self_stated);
      if (total === 0) {
        return { word: 'No claims yet', fact: null, sub: 'A claim counts as confirmed once the person you name confirms it.', tone: 'neutral', action: { label: 'Add proof', to: PROOF_PATH } };
      }
      const facts = [];
      if (attested != null) facts.push(`${attested} confirmed`);
      if (awaiting != null) facts.push(`${awaiting} awaiting`);
      // D7807 (#7807): the Worker's whole-list figure, on any page size; never a count of the page.
      const reconfirm = num(c.needs_reconfirmation);
      const subs = [];
      if (selfStated != null) subs.push(`${selfStated} self-stated`);
      if (reconfirm) subs.push(`${reconfirm} ${reconfirm === 1 ? 'needs' : 'need'} reconfirmation`);
      return {
        word: attested ? 'Confirmed' : 'Self-stated',
        fact: facts.length ? facts.join(' · ') : null,
        sub: subs.length ? `${subs.join(' · ')}.` : null,
        tone: attested ? 'ok' : 'warn',
        action: { label: 'Manage proof', to: PROOF_PATH },
      };
    },
  },
  {
    key: 'availability',
    label: 'Availability',
    reads: ['visibility'],
    value: ({ visibility }) => {
      const total = num(visibility?.links?.total);
      const links = (visibility?.surfaces || []).filter((s) => s?.kind === 'booking_link');
      // Live links are counted only when the whole list came back; otherwise the total stands alone.
      const live = wholePage(visibility?.links) ? links.filter((s) => s.is_active).length : null;
      const unlinked = Array.isArray(visibility?.unlinked_services?.items) ? visibility.unlinked_services.items.length : null;
      const sub = unlinked
        ? `${unlinked}${visibility.unlinked_services.more ? '+' : ''} active session ${unlinked === 1 && !visibility.unlinked_services.more ? 'type has' : 'types have'} no live link.`
        : 'Founders book a session type through a booking link, set in Practice › Sessions.';
      if (total === 0) {
        return { word: 'Not bookable', fact: 'No booking link', sub, tone: 'warn', action: { label: 'Open Sessions', to: SESSIONS_PATH } };
      }
      return {
        word: live === 0 ? 'Not bookable' : 'Bookable',
        fact: live != null ? `${plural(live, 'live booking link')} of ${total}` : (total != null ? plural(total, 'booking link') : null),
        sub,
        tone: live === 0 ? 'warn' : 'ok',
        action: { label: 'Open Sessions', to: SESSIONS_PATH },
      };
    },
  },
]);

/**
 * One dimension as the strip draws it: its state, its value (once its first
 * read has read; the reads that failed are left out of the facts), and the
 * reads to try again.
 */
export function dimensionView(dim, sources) {
  const state = dimensionState(sources, dim.reads);
  const retry = dim.reads.filter((k) => failed(sources?.[k]) && !refused(sources[k]));
  const missing = dim.reads.filter((k) => failed(sources?.[k])).map((k) => SOURCE_NAMES[k]);
  if (state === 'loading' || state === 'refused' || state === 'unavailable') return { key: dim.key, label: dim.label, state, retry, missing, value: null };
  const data = Object.fromEntries(dim.reads.filter((k) => ready(sources[k])).map((k) => [k, sources[k].data]));
  return { key: dim.key, label: dim.label, state, retry, missing, value: dim.value(data) };
}

export const statusStrip = (sources) => DIMENSIONS.map((d) => dimensionView(d, sources));

/** The claims on the page read whose confirmation no longer counts (D4670: `needs_reconfirmation`), with whom to ask. */
export function reconfirmations(proof) {
  const out = [];
  for (const item of proof?.items || []) {
    if (item?.attested) continue;
    const c = (item?.consents || []).find((x) => x?.state === 'needs_reconfirmation');
    if (c) out.push({ item, consent: c });
  }
  return out;
}

/**
 * THE STEPS, IN ORDER (EX-01, D4823 EX-16 "NextActionCard: one dominant step;
 * at most 3 total; none when state supports none"). Each comes from a read
 * that answered; the first that applies leads, two more at most follow.
 */
const STEPS = [
  // A missing profile comes before everything: nothing else is public without it.
  ({ profile }) => (profile.ok && profile.data == null ? [{
    key: 'create-profile', area: 'Profile',
    title: 'Create your Expertise profile',
    why: 'A profile gives founders a page to find you, understand what you do and book a session.',
    action: 'Create profile', to: PROFILE_PATH,
  }] : []),
  ({ proof }) => (proof.ok ? reconfirmations(proof.data).slice(0, 1).map(({ item, consent }) => ({
    key: `reconfirm-${item.id}`, area: 'Proof',
    title: `Ask ${consent.attester_name || 'the person you named'} to reconfirm “${item.title}”`,
    why: 'Their confirmation no longer counts as confirmed: it was recorded before confirmations needed an emailed code, or the claim has changed since. A fresh confirmation restores it.',
    action: 'Ask again in Proof', to: PROOF_PATH,
  })) : []),
  ({ thinking }) => (thinking.ok ? (thinking.data?.items || []).filter((a) => stageKey(a) === 'changes_requested').slice(0, 1).map((a) => ({
    key: `feedback-${a.id}`, area: 'Thinking',
    title: `Review editor feedback on “${a.title}”`,
    why: 'An editor asked for changes. Their notes are in the editor.',
    action: 'Review feedback', to: `/articles/edit/${a.id}`,
  })) : []),
  ({ profile }) => {
    if (!profile.ok || profile.data == null) return [];
    const { missing } = completionOf(profile.data);
    return missing.length ? [{
      key: 'fill-profile', area: 'Profile',
      title: `Fill in ${plural(missing.length, 'profile field')} a match reads`,
      why: `Missing: ${missing.join(', ').toLowerCase()}.`,
      action: 'Edit profile', to: PROFILE_PATH,
    }] : [];
  },
  ({ services }) => {
    if (!services.ok) return [];
    const unpriced = num(services.data?.counts?.unpriced);
    if (!unpriced) return [];
    const row = (services.data?.items || []).find((s) => s?.price_cents == null);
    return [{
      key: 'price-service', area: 'Services',
      title: unpriced === 1 && row ? `Add a price to “${row.title}”` : `Add a price to ${plural(unpriced, 'service')}`,
      why: 'A service with no price shows as Not recorded, never as free.',
      action: 'Edit services', to: SERVICES_PATH,
    }];
  },
  ({ proof }) => {
    if (!proof.ok) return [];
    const c = proof.data?.counts || {};
    if (num(c.total) === 0) {
      return [{ key: 'add-proof', area: 'Proof', title: 'Add a claim someone you name can confirm', why: 'Your own word and a confirmation from the person you name are different evidence.', action: 'Add proof', to: PROOF_PATH }];
    }
    if (num(c.attested) === 0 && num(c.awaiting) === 0) {
      const item = (proof.data?.items || []).find((p) => p?.status === 'self_stated');
      return [{
        key: 'confirm-proof', area: 'Proof',
        title: item ? `Ask someone to confirm “${item.title}”` : 'Ask someone to confirm a claim',
        why: 'Every claim is self-stated. A claim the person you name confirms is stronger evidence.',
        action: 'Open Proof', to: PROOF_PATH,
      }];
    }
    return [];
  },
  ({ visibility }) => (visibility.ok ? (visibility.data?.unlinked_services?.items || []).slice(0, 1).map((t) => ({
    key: `link-${t.uid}`, area: 'Availability',
    title: `Give “${t.name}” a booking link`,
    why: 'It is an active session type, and no live booking link sells it, so no founder can book it.',
    action: 'Open Sessions', to: SESSIONS_PATH,
  })) : []),
  ({ services }) => (services.ok && num(services.data?.counts?.total) === 0 ? [{
    key: 'add-service', area: 'Services', title: 'Add a service', why: 'What you sell, with a price and its currency.', action: 'Add a service', to: SERVICES_PATH,
  }] : []),
];

export const MAX_STEPS = 3;

/**
 * The Next step and the steps after it, once every read has answered (a step
 * chosen while a read is in flight could be overtaken when it lands).
 * `{ state: 'loading' }` until then; otherwise `{ state: 'ready', steps,
 * unread }`, where `unread` names the reads that failed, whose steps could not
 * be worked out. No step and nothing unread is `steps: []`: the card is not
 * drawn, because the record supports no step.
 */
export function nextSteps(sources) {
  const keys = Object.keys(SOURCE_NAMES);
  if (keys.some((k) => !sources?.[k] || sources[k].state === 'loading')) return { state: 'loading', steps: [], unread: [] };
  const view = Object.fromEntries(keys.map((k) => [k, { ok: ready(sources[k]), data: sources[k].data }]));
  const unread = keys.filter((k) => failed(sources[k])).map((k) => SOURCE_NAMES[k]);
  if (keys.every((k) => refused(sources[k]))) return { state: 'refused', steps: [], unread: [] };
  const steps = [];
  for (const rule of STEPS) {
    for (const s of rule(view)) {
      if (steps.length < MAX_STEPS && !steps.some((x) => x.key === s.key)) steps.push(s);
    }
    // No profile: every other area waits on it, so it is the only step.
    if (steps[0]?.key === 'create-profile') break;
  }
  return { state: 'ready', steps, unread };
}

/**
 * EX-03: an administrator previewing the Advisor role, not a person — the
 * same rule as `App.jsx`'s `advisorRolePreview` (an admin, not in a support
 * session, browsing as `advisor`). `view` is the shell's `useViewMode()`.
 * `isAdmin` is the signed-in account's own role, never the role browsed as.
 */
export function isAdvisorPreview(view) {
  return Boolean(view) && view.isAdmin === true && view.isImpersonating !== true && view.viewMode === 'advisor';
}

/** Where an administrator chooses an advisor to open: All accounts, whose View As starts a recorded support session. */
export const CHOOSE_ADVISOR_PATH = '/admin/accounts/all';

/** EX-03's sentences. */
export const PREVIEW_COPY = Object.freeze({
  title: 'Select an advisor to view their Expertise',
  body: 'You’re previewing the Advisor workspace without an advisor, so there is no profile, service, proof or article to show. No advisor’s record is read.',
  impersonate: 'Impersonate an advisor',
  impersonateHint: 'Opens All accounts. View As on an advisor’s row starts a support session that is recorded with your reason.',
  exit: 'Exit preview',
  layout: 'Workspace preview',
  layoutNote: 'Layout only · no data',
});
