/**
 * D9111 (#9111) — HQ › AI agents › Operations › Spend › Agent budgets (SA15 to SA19, D4137-p3), as pure rules.
 *
 * The read is `GET /api/admin/ai-agents/policy/budgets` (D8071, `routes/admin_ai_agents_policy.ts`); the sponsor's
 * is `GET /api/teams/agents/:uid/budget`. This file turns either into rows: each cap as a meter (used / cap, the
 * share, its words), an agent's highest share for the sort, the four workspace ceilings in force, the halted runs
 * in words, and the edit form's body (only the changed fields).
 *
 * Meter words (SAB-H): ■ At cap, ▲ 80% and over, ○ No cap, ∅ Not applicable, ? Unavailable. A cap of null is
 * No cap and its use is still shown; a use the read does not carry is Not recorded; a read that failed is
 * Unavailable (AGENTS.md § Honesty, D5129), never 0.
 */

export const NOT_RECORDED = 'Not recorded';
export const UNAVAILABLE = 'Unavailable';
export const NEAR_SHARE = 80;

export const METER_WORDS = Object.freeze({
  at_cap: '■ At cap',
  near: '▲ 80% and over',
  no_cap: '○ No cap',
  not_applicable: '∅ Not applicable',
  unavailable: `? ${UNAVAILABLE}`,
  not_recorded: NOT_RECORDED,
});

const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v));

/** Tokens in words: 2.45M, 12.5k, 800. */
export function tokensText(v) {
  if (!finite(v)) return NOT_RECORDED;
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-US');
}
const whole = (v) => (finite(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : NOT_RECORDED);
export const centsText = (v) => (finite(v) ? `$${(Number(v) / 100).toFixed(2)}` : NOT_RECORDED);

/**
 * An agent's four caps, in the canvas's order. `field` is the PUT body's key; `used` reads the read's `used`
 * (retries on one task: the read carries no use, so it is Not recorded); `scale` turns the form's entry into the
 * stored whole number (tokens are entered in millions, SA16's "M").
 */
export const AGENT_CAPS = Object.freeze([
  { key: 'tokens', field: 'tokens_cap', label: 'Tokens per month', column: 'Tokens', per: 'month', unit: 'M', scale: 1e6, min: 1, text: tokensText, used: (u) => u?.tokens },
  { key: 'minutes', field: 'minutes_cap', label: 'Minutes per month', column: 'Minutes', per: 'month', unit: 'min', scale: 1, min: 1, text: (v) => (finite(v) ? `${whole(v)} min` : NOT_RECORDED), used: (u) => u?.minutes },
  { key: 'prs_per_day', field: 'prs_per_day_cap', label: 'PRs per day', column: 'PRs', per: 'today UTC', unit: 'PRs', scale: 1, min: 0, text: (v) => (finite(v) ? `${whole(v)} PRs` : NOT_RECORDED), used: (u) => u?.prs_today },
  { key: 'retries_per_task', field: 'retries_per_task_cap', label: 'Retries per task', column: 'Retries', per: 'one task', unit: 'tries', scale: 1, min: 0, text: (v) => (finite(v) ? `${whole(v)} tries` : NOT_RECORDED), used: () => undefined },
]);

/** used / cap as a whole percentage, or null when there is no cap or no use to compare. A cap of 0 is reached. */
export function meterShare(used, cap) {
  if (!finite(cap) || !finite(used)) return null;
  const c = Number(cap), u = Number(used);
  if (c <= 0) return 100;
  return Math.round((u / c) * 100);
}

/**
 * One meter. `state` is 'unavailable' when the read failed and 'not_applicable' when the cap does not apply;
 * otherwise it follows the figures: no cap, use not recorded, at cap, near (80% and over) or within.
 */
export function meter(used, cap, { state, text = whole } = {}) {
  if (state === 'unavailable') return { kind: 'unavailable', share: null, word: METER_WORDS.unavailable, used: UNAVAILABLE, cap: finite(cap) ? text(cap) : null };
  if (state === 'not_applicable') return { kind: 'not_applicable', share: null, word: METER_WORDS.not_applicable, used: null, cap: null };
  const usedText = finite(used) ? text(used) : NOT_RECORDED;
  if (!finite(cap)) return { kind: 'no_cap', share: null, word: METER_WORDS.no_cap, used: usedText, cap: null };
  if (!finite(used)) return { kind: 'not_recorded', share: null, word: `Use ${NOT_RECORDED.toLowerCase()}`, used: NOT_RECORDED, cap: text(cap) };
  const share = meterShare(used, cap);
  if (share >= 100) return { kind: 'at_cap', share, word: `${METER_WORDS.at_cap} · ${share}%`, used: usedText, cap: text(cap) };
  if (share >= NEAR_SHARE) return { kind: 'near', share, word: `▲ ${share}% · 80% and over`, used: usedText, cap: text(cap) };
  return { kind: 'within', share, word: `${share}%`, used: usedText, cap: text(cap) };
}

/** An agent's (or a sponsor's budget's) four meters. */
export function agentMeters(budget, { unavailable = false } = {}) {
  return AGENT_CAPS.map((c) => ({
    ...c,
    meter: meter(c.used(budget?.used), budget?.caps?.[c.key], { state: unavailable ? 'unavailable' : undefined, text: c.text }),
  }));
}

/** The highest share an agent has used of any cap, or null when none compares. */
export function topShare(budget) {
  const shares = agentMeters(budget).map((m) => m.meter.share).filter((s) => s != null);
  return shares.length ? Math.max(...shares) : null;
}

/** Highest share first; an agent with nothing to compare goes last; ties by name, then uid. */
export function sortByShare(agents) {
  return [...(agents || [])].sort((a, b) => {
    const sa = topShare(a), sb = topShare(b);
    if (sa !== sb) return sa == null ? 1 : sb == null ? -1 : sb - sa;
    return String(agentLabel(a)).localeCompare(String(agentLabel(b))) || String(a.agent_uid).localeCompare(String(b.agent_uid));
  });
}

const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
export const agentLabel = (a) => (a?.name ? String(a.name) : a?.role_key ? `${titleCase(a.role_key)} agent` : 'Unnamed agent');

/** "Set by [name] · 3 Nov 2026", or that no cap has been set; who is Not recorded when the read names nobody. */
export function setLine(budget) {
  if (!budget?.set_at) return 'No caps set yet';
  return `Set by ${budget.set_by || NOT_RECORDED} · ${dayText(budget.set_at)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-03 10:00:00' → '3 Nov 2026' (UTC, as stored). */
export function dayText(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : NOT_RECORDED;
}
/** '2026-11-21 09:14:02' → '21 Nov 2026, 09:14 UTC'. */
export function whenText(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]} UTC` : NOT_RECORDED;
}
/** The period line: "Nov 2026 · calendar month, UTC". */
export function periodText(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period?.month || ''));
  const month = m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : NOT_RECORDED;
  return period?.kind === 'calendar_month_utc' ? `${month} · calendar month, UTC` : month;
}

/** The four workspace ceilings: the key in `caps`, its label and how its use reads from `workspaceUsage`. */
export const CEILINGS = Object.freeze([
  { key: 'agents_cap', label: 'Agents in total', used: (u) => u?.agents, text: whole },
  { key: 'live_agents_cap', label: 'Live at once', used: (u) => u?.live_agents, text: whole },
  { key: 'ai_spend_cap_cents', label: 'AI spend', used: (u) => (u?.ai_spend_microusd == null ? undefined : Number(u.ai_spend_microusd) / 10_000), text: centsText, money: true },
  { key: 'compute_spend_cap_cents', label: 'Compute spend', used: (u) => (u?.compute_spend_microusd == null ? undefined : Number(u.compute_spend_microusd) / 10_000), text: centsText, money: true },
]);

/**
 * The ceiling in force (`workspaceCaps` in `services/agentBudgets.ts`): the workspace's own, else the platform's,
 * never above the platform's when both are set; and where it comes from.
 */
export function ceilingInForce(own, platform) {
  if (own == null && platform == null) return { cap: null, source: 'none' };
  if (own == null) return { cap: Number(platform), source: 'platform' };
  if (platform == null) return { cap: Number(own), source: 'workspace' };
  return Number(own) <= Number(platform) ? { cap: Number(own), source: 'workspace' } : { cap: Number(platform), source: 'platform' };
}
const SOURCE_WORDS = { none: 'No ceiling', platform: 'The platform figure', workspace: 'This workspace’s own' };

export function ceilingRows(workspace, platform, { unavailable = false } = {}) {
  return CEILINGS.map((c) => {
    const f = ceilingInForce(workspace?.caps?.[c.key] ?? null, platform?.[c.key] ?? null);
    return {
      ...c, ...f, source_words: SOURCE_WORDS[f.source], platform: platform?.[c.key] ?? null, own: workspace?.caps?.[c.key] ?? null,
      meter: meter(c.used(workspace?.used), f.cap, { state: unavailable ? 'unavailable' : undefined, text: c.text }),
    };
  });
}

/** The workspaces the read names, by name, and the agents of one. */
export const workspaceKey = (w) => (w ? `${w.scope_kind}:${w.scope_id}` : '');
export function workspaceList(data) {
  return [...(data?.workspaces || [])].sort((a, b) => String(a.scope_name || '').localeCompare(String(b.scope_name || '')) || workspaceKey(a).localeCompare(workspaceKey(b)));
}
export const workspaceName = (w) => (w?.scope_name ? String(w.scope_name) : w ? `${w.scope_kind === 'company' ? 'Company' : 'Project'} ${w.scope_id}` : NOT_RECORDED);
export function agentsOf(data, key) {
  return sortByShare((data?.agents || []).filter((a) => !key || `${a.scope_kind}:${a.scope_id}` === key));
}

/** A halted run's own refusal in words. */
export const HALT_WORDS = Object.freeze({
  budget_exhausted: { label: 'Cap reached', line: 'The cap was reached, so the run was halted.' },
  budget_unreadable: { label: 'Budget could not be read', line: 'The budget could not be read, so the run was stopped.' },
});
export function haltedRows(halted, agents = [], key = '') {
  const byUid = new Map((agents || []).map((a) => [a.agent_uid, a]));
  return (halted || [])
    .filter((h) => !key || !byUid.size || (byUid.get(h.agent_uid) && `${byUid.get(h.agent_uid).scope_kind}:${byUid.get(h.agent_uid).scope_id}` === key))
    .map((h) => {
      const words = HALT_WORDS[h.refusal] || { label: String(h.refusal || NOT_RECORDED), line: 'The run was halted.' };
      const agent = byUid.get(h.agent_uid);
      return { ...h, when: whenText(h.ended_at), agent: agent ? agentLabel(agent) : null, label: words.label, line: words.line };
    });
}

/** The edit form from an agent's caps: blank for no cap; tokens in millions. */
export function capsForm(caps) {
  return Object.fromEntries(AGENT_CAPS.map((c) => {
    const v = caps?.[c.key];
    return [c.field, finite(v) ? String(c.scale === 1 ? Number(v) : Number(v) / c.scale) : ''];
  }));
}

/**
 * The PUT body's caps: only the fields that changed. Blank is null (no cap). An entry that is not a whole number
 * in range (after tokens' scale) is returned as a problem, with the field, and nothing is sent.
 */
export function changedCaps(form, caps) {
  const out = {};
  for (const c of AGENT_CAPS) {
    const raw = String(form?.[c.field] ?? '').trim().replaceAll(',', '');
    let next = null;
    if (raw !== '') {
      const n = Number(raw) * c.scale;
      if (!Number.isFinite(n) || n < c.min || Math.abs(n - Math.round(n)) > 1e-6) return { ok: false, field: c.field, message: `${c.label} is a whole number${c.min ? ' above zero' : ''}${c.scale !== 1 ? ' of tokens' : ''}, or blank for no cap.` };
      next = Math.round(n);
    }
    const cur = finite(caps?.[c.key]) ? Number(caps[c.key]) : null;
    if (next !== cur) out[c.field] = next;
  }
  return { ok: true, caps: out };
}

/** Save is offered only with a change and a reason (the Worker refuses a blank one: reason_required). */
export const canSave = (changes, reason) => !!(changes?.ok && Object.keys(changes.caps).length && String(reason || '').trim());

/** The workspace's own ceilings as a form: blank is the platform figure; spend is entered in dollars. */
export function ceilingsForm(own) {
  return Object.fromEntries(CEILINGS.map((c) => {
    const v = own?.[c.key];
    return [c.key, finite(v) ? (c.money ? (Number(v) / 100).toFixed(2) : String(Number(v))) : ''];
  }));
}

/**
 * The workspace PUT's caps: only the changed fields, blank as null (the platform figure). A figure above the
 * platform's is refused here before it is sent (owner pick A, D4137-p3: the platform figure is edited on
 * Policies), as the Worker would with 409 above_platform_ceiling.
 */
export function changedCeilings(form, own, platform) {
  const out = {};
  for (const c of CEILINGS) {
    const raw = String(form?.[c.key] ?? '').trim().replaceAll(',', '').replace(/^\$/, '');
    let next = null;
    if (raw !== '') {
      const n = Number(raw) * (c.money ? 100 : 1);
      if (!Number.isFinite(n) || n < 0 || Math.abs(n - Math.round(n)) > 1e-6) return { ok: false, field: c.key, message: `${c.label} is ${c.money ? 'a dollar amount' : 'a whole number'}, or blank for the platform figure.` };
      next = Math.round(n);
    }
    const cap = platform?.[c.key];
    if (next != null && finite(cap) && next > Number(cap)) {
      return { ok: false, field: c.key, above: true, message: `Above the platform ceiling of ${c.text(cap)}. Nobody can set a workspace above it here. Change the figure on Operations › Policies first.` };
    }
    const cur = finite(own?.[c.key]) ? Number(own[c.key]) : null;
    if (next !== cur) out[c.key] = next;
  }
  return { ok: true, caps: out };
}
