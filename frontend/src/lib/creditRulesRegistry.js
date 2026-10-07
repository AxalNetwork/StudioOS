/**
 * D638 (#1384) — the pure half of the Super Admin's credit rules page.
 *
 * The registry page (`pages/hq/CreditRulesRegistryPage.jsx`) draws the HQ canvas's registry pattern (`hq-contracts`, `hq-credits`
 * in design/canvases/integrated/ops-data.js): a table with search, filters, a
 * count and pages, and a reason card whose refusals read as sentences. What
 * it lists comes from routes/admin_credit_rules.ts; nothing here invents an
 * amount.
 */

/** The floor every Super Admin credit act shares (CREDIT_REASON_MIN in the Worker). */
export const REASON_MIN = 10;
export const PAGE_SIZE = 25;
/** The bound a rule's credits take in the Worker (CREDITS_MAX). */
export const CREDITS_MAX = 100000;

export const RULE_KINDS = [
  { id: 'all', label: 'All kinds' },
  { id: 'bounty', label: 'Bounties' },
  { id: 'lab', label: 'Lab milestones' },
  { id: 'reward', label: 'Other rewards' },
  { id: 'cap', label: 'Monthly cap' },
];

export const GRANT_SOURCES = [
  { id: 'all', label: 'All sources' },
  { id: 'rule', label: 'Rule grants' },
  { id: 'manual', label: 'Manual adjustments' },
];

export const GRANT_STATES = [
  { id: 'all', label: 'Any state' },
  { id: 'standing', label: 'Standing' },
  { id: 'revoked', label: 'Revoked' },
];

const KIND_LABEL = { cap: 'Monthly cap', bounty: 'Bounty', lab: 'Lab milestone', reward: 'Reward' };
export const kindLabel = (kind) => KIND_LABEL[kind] || 'Reward';

/** What a rule pays, in the words the table uses. The cap is a limit, not a payment. */
export function ruleAmount(rule) {
  const n = Number(rule?.credits) || 0;
  const usd = `US$${(n).toLocaleString('en-US')}`;
  return rule?.kind === 'cap'
    ? `${n.toLocaleString('en-US')} credits a month (${usd})`
    : `${n.toLocaleString('en-US')} credits (${usd})`;
}

const has = (hay, q) => String(hay ?? '').toLowerCase().includes(q);

export function filterRules(rules, { q = '', kind = 'all' } = {}) {
  const needle = q.trim().toLowerCase();
  return (rules || []).filter((r) => (kind === 'all' || r.kind === kind) && (!needle || has(r.key, needle)));
}

export function filterGrants(grants, { q = '', source = 'all', state = 'all' } = {}) {
  const needle = q.trim().toLowerCase();
  return (grants || []).filter((g) => {
    if (source === 'manual' && !g.manual) return false;
    if (source === 'rule' && g.manual) return false;
    if (state === 'revoked' && !g.revoked) return false;
    if (state === 'standing' && g.revoked) return false;
    if (!needle) return true;
    return has(g.email, needle) || has(g.rule_key, needle) || has(g.source_ref, needle) || has(g.note, needle)
      || String(g.user_id) === needle;
  });
}

/** One page of a filtered list, and the count line the canvas draws ("1–25 of N"). */
export function pageOf(list, page = 1, size = PAGE_SIZE) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, page), pages);
  const rows = list.slice((at - 1) * size, at * size);
  const count = total === 0 ? '0 of 0' : `${(at - 1) * size + 1}–${(at - 1) * size + rows.length} of ${total}`;
  return { rows, page: at, pages, total, count };
}

/** Whether a reason may be sent: trimmed, at least REASON_MIN characters. */
export const reasonReady = (reason) => String(reason || '').trim().length >= REASON_MIN;

/**
 * A rule edit as the Worker takes it: only what changed, credits as a whole
 * number. Returns `{ error }` for what the page can refuse before sending.
 */
export function ruleChanges(rule, { credits, active }) {
  const out = {};
  const n = String(credits ?? '').trim() === '' ? NaN : Number(credits);
  if (!Number.isInteger(n) || n < 0 || n > CREDITS_MAX) {
    return { error: `Credits must be a whole number from 0 to ${CREDITS_MAX.toLocaleString('en-US')}.` };
  }
  if (n !== Number(rule.credits)) out.credits = n;
  if (Boolean(active) !== Boolean(rule.active)) out.active = Boolean(active);
  if (!Object.keys(out).length) return { error: 'Nothing changed. Change the credits or switch the rule on or off.' };
  return { changes: out };
}

/**
 * A refusal from the Worker, as a sentence. The Worker's own message is
 * already one; a few codes get what the page knows on top of it.
 */
export function refusalSentence(err, fallback) {
  const code = err?.code || err?.data?.error;
  const msg = err?.message && err.message !== code ? err.message : null;
  if (code === 'would_overdraw') {
    const bal = err?.data?.balance;
    return `${msg || 'The credits have already been spent.'}${Number.isFinite(Number(bal)) && !/\bholds\b/.test(msg || '') ? ` The account holds ${bal} credits now.` : ''} Nothing was taken back.`;
  }
  if (code === 'reason_too_short') return msg || `Say why, in at least ${REASON_MIN} characters.`;
  if (err?.status === 403) return 'Only the Super Admin can change credit rules. Nothing was changed.';
  return msg || fallback;
}

/** Who last changed a rule, or why that is not recorded. */
export function ruleUpdated(rule) {
  if (rule?.updated_by == null) {
    return { nr: true, reason: 'Set by the migration that created the rule; no Super Admin has changed it since.' };
  }
  return { nr: false, text: `${String(rule.updated_at || '').slice(0, 10)} · admin #${rule.updated_by}` };
}

/**
 * Save a rule edit: refuse what the page can before sending, then send only
 * what changed. `{ ok: true, rule }` or `{ ok: false, error }`, a sentence.
 */
export async function submitRule(rule, form, reason, save) {
  if (!reasonReady(reason)) return { ok: false, error: `Say why, in at least ${REASON_MIN} characters.` };
  const planned = ruleChanges(rule, form);
  if (planned.error) return { ok: false, error: planned.error };
  try {
    const res = await save(rule.key, planned.changes, String(reason).trim());
    return { ok: true, rule: res?.rule || null };
  } catch (e) {
    return { ok: false, error: refusalSentence(e, 'The rule could not be saved. Nothing was changed.'), cause: e };
  }
}

/** Take a grant back. `{ ok: true }` or `{ ok: false, error }`, the Worker's refusal as a sentence. */
export async function submitRevoke(grant, reason, revoke) {
  if (!reasonReady(reason)) return { ok: false, error: `Say why, in at least ${REASON_MIN} characters.` };
  try {
    await revoke(grant.id, String(reason).trim());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: refusalSentence(e, 'The grant could not be taken back. Nothing was changed.'), cause: e };
  }
}
