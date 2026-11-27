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
  { id: 'deducted', label: 'Deductions' },
  { id: 'revoked', label: 'Revoked' },
];

const KIND_LABEL = { cap: 'Monthly cap', bounty: 'Bounty', lab: 'Lab milestone', reward: 'Reward' };
export const kindLabel = (kind) => KIND_LABEL[kind] || 'Reward';

/** What each kind of rule does, in the order the page explains them (#1412, from #1399's page). */
export const KIND_NOTES = [
  { kind: 'reward', note: 'Paid once when the event happens.' },
  { kind: 'bounty', note: 'Paid for a reported bug or a shipped feature, by severity. They count toward the monthly cap.' },
  { kind: 'cap', note: 'The most bounty credits one member can earn in a calendar month. A bounty that would cross it is refused whole.' },
  { kind: 'lab', note: 'Paid once per member when a Lab milestone is reached.' },
];

/** The notes for the kinds these rules have; an unknown kind reads as a reward. */
export function kindNotesFor(rules) {
  const kinds = new Set((rules || []).map((r) => (KIND_LABEL[r.kind] ? r.kind : 'reward')));
  return KIND_NOTES.filter((k) => kinds.has(k.kind)).map((k) => ({ ...k, label: kindLabel(k.kind) }));
}

/**
 * A grant's state: taken back; a deduction (a manual line that took credits
 * away, which a revoke does not apply to); or standing, which can be taken back.
 */
export function grantState(g) {
  if (g?.revoked) return 'revoked';
  if (Number(g?.credits) < 0) return 'deducted';
  return 'standing';
}

/** The state cell, with the reason a grant was taken back in plain sight. */
export function grantStateText(g) {
  const state = grantState(g);
  if (state === 'deducted') return 'Deduction';
  if (state === 'standing') return 'Standing';
  const day = String(g.revoked_at || '').slice(0, 10);
  return `Taken back${day ? ` ${day}` : ''}${g.revoke_reason ? `: “${g.revoke_reason}”` : ''}`;
}

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
    if (state !== 'all' && grantState(g) !== state) return false;
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

const plural = (n) => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? 'credit' : 'credits'}`;

/** "Worth US$175.": what the credits typed are worth, at the one fixed rate. */
export function valueLine(credits) {
  const s = String(credits ?? '').trim();
  return /^\d+$/.test(s)
    ? `Worth US$${Number(s).toLocaleString('en-US')}. 1 credit is US$1; the value follows the credits.`
    : `A whole number from 0 to ${CREDITS_MAX.toLocaleString('en-US')}.`;
}

/** "Was 150 credits, on. Now 175 credits, on, worth US$175.": the line before a save. */
export function editSummary(rule, changes) {
  const credits = changes.credits ?? Number(rule.credits);
  const active = changes.active ?? Boolean(rule.active);
  return `Was ${plural(rule.credits)}, ${rule.active ? 'on' : 'off'}. Now ${plural(credits)}, ${active ? 'on' : 'off'}, worth US$${credits.toLocaleString('en-US')}.`;
}

/** The line under a rule edit: why it cannot be saved yet, or what it would save. */
export function editHint(rule, form) {
  const planned = ruleChanges(rule, form);
  return planned.error || editSummary(rule, planned.changes);
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
 * The sentence for a refusal that arrives with a code and no message of its
 * own (#1412, from #1399's page), so a code is never what the Super Admin reads.
 */
const REFUSALS = {
  reason_too_short: `Say why, in at least ${REASON_MIN} characters.`,
  rule_unknown: 'No reward rule has that name any more. Reload the rules.',
  invalid_credits: `Credits must be a whole number from 0 to ${CREDITS_MAX.toLocaleString('en-US')}.`,
  usd_value_fixed: '1 credit is US$1, so the value follows the credits. Change the credits instead.',
  invalid_active: 'A rule is either on or off.',
  invalid_id: 'That is not a grant id.',
  not_found: 'No grant has that id. It may have been removed; reload the grants.',
};
const CODE_SHAPE = /^[a-z][a-z0-9_]*$/;

/**
 * A refusal from the Worker, as a sentence. The Worker's own message is
 * already one; a few codes get what the page knows on top of it, and a
 * message that is only a code is replaced by the code's sentence.
 */
export function refusalSentence(err, fallback) {
  const code = err?.code || err?.data?.error;
  const raw = typeof err?.message === 'string' ? err.message.trim() : '';
  const msg = raw && !CODE_SHAPE.test(raw) ? raw : null;
  if (code === 'would_overdraw') {
    const bal = err?.data?.balance;
    return `${msg || 'The credits have already been spent.'}${Number.isFinite(Number(bal)) && !/\bholds\b/.test(msg || '') ? ` The account holds ${bal} credits now.` : ''} Nothing was taken back.`;
  }
  if (err?.status === 403 || code === 'forbidden') return 'Only the Super Admin can change credit rules. Nothing was changed.';
  return msg || REFUSALS[code] || fallback;
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
    return { ok: true, result: (await revoke(grant.id, String(reason).trim())) || null };
  } catch (e) {
    return { ok: false, error: refusalSentence(e, 'The grant could not be taken back. Nothing was changed.'), cause: e };
  }
}

/** What the page says once a rule is saved. */
export const ruleNotice = (rule, changes) => `${rule.key} saved. ${editSummary(rule, changes)}`;

/** What the page says once a grant is taken back, or found already taken back. */
export function revokeNotice(grant, result) {
  const who = grant.email || `account #${grant.user_id}`;
  if (result?.status === 'already_revoked') return `That grant was already taken back. Nothing more was taken from ${who}.`;
  return `${plural(grant.credits)} taken back from ${who}.${result?.notified === false ? ' The inbox notice could not be sent.' : ''}`;
}
