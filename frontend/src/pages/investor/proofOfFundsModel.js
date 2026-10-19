/**
 * D752 (#1891) — the investor's "Show Axal you can fund this", pure: no React,
 * no fetch, no storage. `ProofOfFunds.jsx` draws it. The Worker's words
 * (`capitalAttestationTerms.ts`) are filled in here, never rewritten: the
 * preview equals the sentence Axal's admins read, and a test holds the two
 * together. Nothing here holds or draws a balance.
 */
import { accountLine } from '../account/mercuryModel';
import { branchOfUser } from '../../lib/shellRole';

export const PURPOSES = Object.freeze(['deal_commitment', 'lp_application', 'lp_commitment']);

/** The amount field's line, naming the figure the cap comes from (decision 4). */
export const CAP_WORDS = Object.freeze({
  deal_commitment: (cap) => `Up to ${cap}, your commitment`,
  lp_application: (cap) => `Up to ${cap}, the commitment on your application`,
  lp_commitment: (cap) => `Up to ${cap}, your uncalled commitment`,
});

/** A target that cannot carry a statement, by the Worker's reason (decision 9). */
export const NOT_ATTESTABLE_WORDS = Object.freeze({
  amount_missing: { kind: 'unrecorded', text: 'No amount is recorded on this commitment, so there is nothing to prove.' },
  below_minimum: { kind: 'unrecorded', text: 'Proof of funds starts at $1,000. This commitment is below it.' },
  calls_unreadable: { kind: 'unreadable', text: 'Your capital calls on this commitment could not be read, so the uncalled amount is unknown.' },
});
export const NOT_ATTESTABLE_OTHER = { kind: 'unrecorded', text: 'StudioOS cannot prove funds for this commitment.' };

/** The shared list's state words and pill tones (decision 10). */
export const STATE_WORDS = Object.freeze({
  active: ['Active', 'ok'],
  expired: ['Expired', 'warn'],
  superseded: ['Replaced', 'neutral'],
  revoked: ['Revoked', 'neutral'],
});

/** The refusals that add the Connectors › Mercury link (decision 8). */
export const CONNECTOR_DOOR_CODES = Object.freeze(['mercury_not_connected', 'mercury_reconnect_required', 'credentials_unreadable', 'write_scope_refused', 'mercury_entity_account']);
/** The refusals that reload the targets and close the sheet. */
export const CLOSE_CODES = Object.freeze(['target_not_found', 'target_not_attestable']);

export const SHARE_BUTTON = 'Show Axal you can fund this';
export const SHEET_TITLE = 'Proof of funds from Mercury';
export const SHEET_SUB = 'Axal\'s admins read one dated sentence. Never your balance.';
export const CONNECT_FIRST = 'Connect your own Mercury account first, with a Read Only token from your own organization.';
export const CONNECTORS_LINK = { text: 'Connectors › Mercury', href: '/account/connectors' };
export const ONLY_CHECKING_SAVINGS = 'Only checking and savings accounts count. Treasury and other accounts are not read.';
export const HOLDER_MISSING = 'Mercury did not give your organization\'s name, so no statement can name its holder.';
export const REPLACES_ACTIVE = (asOf) => `You shared one on ${asOf}. Sharing again replaces it.`;
export const COMMIT_RECORDED = 'Commitment recorded.';
export const SECTION_TITLE = 'Proof of funds you\'ve shared · from Mercury';
export const SECTION_LINE = 'Only Axal\'s admins on HQ read these. Each time one is opened, it is counted here.';
export const EMPTY_LIST = 'You have shared no proof of funds yet. Share one from a deal commitment, your Fund I application or My commitment.';
export const REVOKE_CONFIRM = 'Revoke this statement? Axal\'s admins will see that you revoked it, with no amount and no holder. You can share a new one later.';
export const TARGETS_UNREADABLE = 'Your open commitments could not be read. This is not a claim that you have none.';
export const LIST_UNREADABLE = 'The statements you shared could not be read. This is not a claim that you shared none.';
export const PURPOSE_UNREADABLE = Object.freeze({
  deal_commitment: 'Your deal commitments could not be read for proof of funds. This is not a claim that you have none.',
  lp_application: 'Your Fund I application could not be read for proof of funds. This is not a claim that it is not open.',
  lp_commitment: 'Your Fund I commitment could not be read for proof of funds. This is not a claim that you have none.',
});
export const MANAGE_HREF = '/spinout-lab/investor-workspace#proof-of-funds';

/** Decision 1: an investor on HQ, and no one else. */
export const showsProof = (user) => user?.role === 'investor' && !branchOfUser(user);

/** "$1,234,567" for whole-dollar cents; null for anything else. */
export function dollars(cents) {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents % 100 !== 0 || cents < 0) return null;
  return `$${(cents / 100).toLocaleString('en-US')}`;
}

/** Today in UTC, as the Worker dates a statement. */
export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

/** The picker's rows: id, name, kind, last four and the drawn line, field by field. Checking and savings only. */
export function accountChoices(read) {
  const list = Array.isArray(read?.accounts) ? read.accounts : [];
  return list
    .filter((a) => a && (a.kind === 'checking' || a.kind === 'savings') && typeof a.id === 'string')
    .map((a) => {
      const l = accountLine({ kind: a.kind, last_four: a.last_four, nickname: a.name });
      return { id: a.id, name: a.name ?? null, kind: a.kind, last_four: a.last_four ?? null, line: l.nickname ? `${l.text} · ${l.nickname}` : l.text };
    });
}

/** '' when the typed whole dollars are valid for this target; else why not (decision 4). */
export function amountError(dollarsText, target, minimumCents) {
  const t = String(dollarsText ?? '').trim().replace(/,/g, '');
  if (!t) return 'Enter an amount in whole dollars.';
  if (!/^\d+$/.test(t)) return 'Enter a whole number of dollars, with no cents.';
  const cents = Number(t) * 100;
  if (!Number.isSafeInteger(cents)) return 'Enter a whole number of dollars, with no cents.';
  if (cents < minimumCents) return `The amount must be at least ${dollars(minimumCents)}.`;
  if (target?.max_cents != null && cents > target.max_cents) return `The amount can be at most ${dollars(target.max_cents)}.`;
  return '';
}
export const amountCents = (dollarsText) => Number(String(dollarsText ?? '').trim().replace(/,/g, '')) * 100;

/** The Worker's consent words with their four slots filled. */
export function fillConsent(template, { accounts, amount_cents, as_of, holder_name }) {
  return String(template || '')
    .replace('{accounts}', String(accounts))
    .replace('{amount}', dollars(amount_cents) ?? '')
    .replace('{as_of}', String(as_of))
    .replace('{holder}', String(holder_name ?? ''));
}

/** The sentence Axal's admins will read: the Worker's `statementSentence`, word for word. */
export function statementPreview({ amount_cents, as_of, holder_name, accounts_counted, consented_on }) {
  const n = Number(accounts_counted);
  return `At least ${dollars(amount_cents)} available at Mercury on ${as_of}, held by ${holder_name}, `
    + `across ${n} ${n === 1 ? 'account' : 'accounts'}. Shared by the investor on ${consented_on}.`;
}

/** The share's POST body, exactly six keys (decision 7). */
export function shareBody({ target, amount_cents, account_ids, consent_version }) {
  return { purpose: target.purpose, target_id: target.target_id, amount_cents, account_ids: [...account_ids], consent: true, consent_version };
}

const targetsOf = (read) => (Array.isArray(read?.targets) ? read.targets : []);
/** One target by purpose and id, or null. */
export const targetOf = (read, purpose, targetId) => targetsOf(read).find((t) => t.purpose === purpose && Number(t.target_id) === Number(targetId)) ?? null;
/** The caller's own deal commitment's target, never another investor's row. */
export function ownDealTarget(read, commitment, user) {
  if (!commitment || !user || Number(commitment.investor_user_id) !== Number(user.id)) return null;
  return targetOf(read, 'deal_commitment', commitment.id);
}
/** The newest deal commitment target on a deal (the targets are newest first). */
export const newestDealTarget = (read, dealId) => targetsOf(read).find((t) => t.purpose === 'deal_commitment' && Number(t.deal_id) === Number(dealId)) ?? null;

/** What a door draws for one target (decision 2). */
export function doorState(target) {
  if (!target) return null;
  if (!target.attestable) return { state: 'not_attestable', ...(NOT_ATTESTABLE_WORDS[target.reason] || NOT_ATTESTABLE_OTHER) };
  if (target.active && target.active.expired) return { state: 'expired', text: `Proof of funds expired · as of ${target.active.as_of}`, action: 'Share a new one' };
  if (target.active) return { state: 'shared', text: `Proof of funds shared · as of ${target.active.as_of}`, action: 'Manage', href: MANAGE_HREF };
  return { state: 'share', action: SHARE_BUTTON };
}

/** A shared statement's state word and tone; Not recorded for one this model does not know. */
export function stateWords(dto) {
  const key = dto?.state === 'active' && dto?.expired ? 'expired' : dto?.state;
  return Object.hasOwn(STATE_WORDS, key) ? { word: STATE_WORDS[key][0], tone: STATE_WORDS[key][1] } : null;
}

/** "Not viewed yet", "Viewed once, last <date>", "Viewed N times, last <date>"; null when not recorded. */
export function viewsWords(dto) {
  const n = dto?.admin_view_count;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
  if (n === 0) return 'Not viewed yet';
  const last = dto?.last_admin_view_at ? String(dto.last_admin_view_at).slice(0, 10) : 'date not recorded';
  return n === 1 ? `Viewed once, last ${last}` : `Viewed ${n} times, last ${last}`;
}

/** The dates line: "As of <as_of> · expires <expires_on>", or "As of <as_of> · expired <expires_on>". */
export const datesLine = (dto) => `As of ${dto.as_of} · ${dto.expired ? 'expired' : 'expires'} ${dto.expires_on}`;
export const revokedLine = (dto) => `You revoked it on ${String(dto.revoked_at ?? '').slice(0, 10)}.`;
export const unreadableLine = (n, m) => `Mercury gave no balance for ${n} of the accounts you picked, so the statement counts ${m}.`;
