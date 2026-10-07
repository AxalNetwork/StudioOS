/**
 * #1384 — HQ · Credits: the Super Admin's page for the credit reward rules and
 * the grants they paid (D540, D608). Pure: the page in
 * `pages/hq/CreditRulesPage.jsx` draws what these return.
 *
 * WHAT IS THE WORKER'S, AND IS ONLY MIRRORED HERE:
 *   - the reason floor, `CREDIT_REASON_MIN` (10) in `routes/admin_credit_rules.ts`;
 *   - the credits bound, 0 to `CREDITS_MAX` (100,000), whole numbers only;
 *   - 1 credit = US$1, so a rule's value is always `credits × 100` cents
 *     (`usd_value_fixed`). The page shows the value and never sends one.
 * The Worker checks all three again on every write; these exist so a form
 * that can only be refused is not sent.
 */

export const CREDIT_REASON_MIN = 10;
export const CREDITS_MAX = 100_000;

/** The rule groups, in the order the page lists them. `kind` is the Worker's `ruleKind`. */
export const RULE_GROUPS = [
  { kind: 'reward', label: 'Rewards', note: 'Paid once when the event happens.' },
  { kind: 'bounty', label: 'Bounties', note: 'Paid for a reported bug or a shipped feature, by severity. They count toward the monthly cap.' },
  { kind: 'cap', label: 'Monthly bounty cap', note: 'The most bounty credits one member can earn in a calendar month. A bounty that would cross it is refused whole.' },
  { kind: 'lab', label: 'Lab milestones', note: 'Paid once per member when a Lab milestone is reached.' },
];

const n0 = (n) => Number(n).toLocaleString('en-US');

/** "US$150" — the value a number of credits is worth, at the one fixed rate. */
export function usdOfCredits(credits) {
  const n = Number(credits);
  return Number.isFinite(n) ? `US$${n0(n)}` : '';
}

/** "150 credits" / "1 credit". */
export function creditsLabel(credits) {
  const n = Number(credits);
  return `${n0(n)} ${n === 1 ? 'credit' : 'credits'}`;
}

/** The rules split into RULE_GROUPS, each group's rules by key; an unknown kind joins Rewards. */
export function groupRules(rules) {
  const known = new Set(RULE_GROUPS.map((g) => g.kind));
  return RULE_GROUPS.map((g) => ({
    ...g,
    rules: (rules || [])
      .filter((r) => (known.has(r.kind) ? r.kind : 'reward') === g.kind)
      .slice()
      .sort((a, b) => String(a.key).localeCompare(String(b.key))),
  })).filter((g) => g.rules.length > 0);
}

/** One line under a rule: what it pays now, or that it is off. */
export function ruleLine(rule) {
  if (rule.kind === 'cap') {
    return rule.active
      ? `${creditsLabel(rule.credits)} a month (${usdOfCredits(rule.credits)})`
      : 'Off: no monthly cap is applied';
  }
  return rule.active
    ? `${creditsLabel(rule.credits)} · ${usdOfCredits(rule.credits)}`
    : `Off: pays nothing (set to ${creditsLabel(rule.credits)})`;
}

export const reasonReady = (text) => String(text || '').trim().length >= CREDIT_REASON_MIN;
export function reasonHint(text) {
  const n = String(text || '').trim().length;
  return n >= CREDIT_REASON_MIN ? null : `At least ${CREDIT_REASON_MIN} characters (${n} so far). It is recorded beside the change.`;
}

/** The credits field as typed: a whole number from 0 to CREDITS_MAX, or null. */
export function parseCredits(text) {
  const s = String(text ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= CREDITS_MAX ? n : null;
}

/**
 * What a rule edit would send, or why it cannot be sent yet. Nothing is sent
 * when nothing changed, because the Worker would record an audit row for a
 * change that is not one.
 */
export function ruleEdit(rule, { credits, active, reason }) {
  const n = parseCredits(credits);
  if (n === null) return { ready: false, why: `Credits must be a whole number from 0 to ${n0(CREDITS_MAX)}.` };
  if (n === Number(rule.credits) && !!active === !!rule.active) return { ready: false, why: 'Nothing has changed.' };
  if (!reasonReady(reason)) return { ready: false, why: reasonHint(reason) };
  return { ready: true, body: { credits: n, active: !!active, reason: String(reason).trim() } };
}

/** "Was 60 credits, on → now 80 credits, off": the confirm line before a save. */
export function editSummary(rule, body) {
  const was = `${creditsLabel(rule.credits)}, ${rule.active ? 'on' : 'off'}`;
  const now = `${creditsLabel(body.credits)}, ${body.active ? 'on' : 'off'}`;
  return `Was ${was}. Now ${now}, worth ${usdOfCredits(body.credits)}.`;
}

/**
 * A refusal as a sentence. The Worker already writes one for each of its
 * refusals (`refuse()`), and that is what `request()` puts on `e.message`;
 * these are only for a refusal that arrives without one, so a code is never
 * what the Super Admin reads.
 */
const REFUSALS = {
  reason_too_short: `Say why, in at least ${CREDIT_REASON_MIN} characters. It is recorded beside the change.`,
  rule_unknown: 'No reward rule has that name any more. Reload the rules.',
  invalid_credits: `Credits must be a whole number from 0 to ${n0(CREDITS_MAX)}.`,
  usd_value_fixed: '1 credit is US$1, so the value follows the credits. Change the credits instead.',
  invalid_active: 'A rule is either on or off.',
  invalid_id: 'That is not a grant id.',
  not_found: 'No grant has that id. It may have been removed; reload the grants.',
  would_overdraw: 'The member has already spent these credits, so the grant cannot be taken back without a negative balance.',
  forbidden: 'Only the Super Admin can change credit rules and grants.',
};
const CODE_SHAPE = /^[a-z][a-z0-9_]*$/;

export function refusalSentence(err) {
  const msg = typeof err?.message === 'string' ? err.message.trim() : '';
  if (msg && !CODE_SHAPE.test(msg)) return msg;
  const code = typeof err?.code === 'string' ? err.code : null;
  if (code && REFUSALS[code]) return REFUSALS[code];
  if (err?.status === 403) return REFUSALS.forbidden;
  return 'The change was not saved. Nothing was changed; try again.';
}

/** Who a grant went to: the email on record, or the account id when none is. */
export const grantWho = (g) => g.email || `Account #${g.user_id}`;

/** What a grant was for: the rule's key, or "Manual" for a D608 line. */
export const grantRule = (g) => (g.manual ? 'Manual' : String(g.rule_key || ''));

/**
 * A grant's state as the page shows it:
 *   revoked  — taken back, with the reason recorded;
 *   deducted — a manual line that took credits away (a negative line), which
 *              revoke does not apply to;
 *   standing — paid and not taken back, so it can be revoked.
 */
export function grantState(g) {
  if (g.revoked) return 'revoked';
  if (Number(g.credits) < 0) return 'deducted';
  return 'standing';
}

/** The day part of an ISO time, or '' when there is none. */
export const dayOf = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : '');
