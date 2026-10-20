/**
 * D791 part 2 (#2216) — HQ › AI usage: what the page draws from
 * `GET /api/admin/ai-usage` and its member reads, as pure functions the tests
 * read directly. The page (`AiUsagePage.jsx`) only lays them out.
 *
 * THE HONESTY RULE (D640): an amount the Worker could not read is said, never
 * drawn as $0. A charge the run log did not record is counted in
 * `not_recorded` and kept out of the margin by the Worker; here it is named.
 */
import { planLabel, usd, whenLabel } from '../account/usageModel';
import { modelColour } from '../../lib/modelColours';

export const RANGES = Object.freeze([
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'mtd', label: 'Month to date' },
]);

/** A micro-USD amount, signed (a margin can be negative), or null when it is not a number. */
export function money(micro) {
  return Number.isFinite(micro) ? usd(micro / 1_000_000) : null;
}

/** The margin as a share of Cloudflare's cost, whole percent; null when there is no cost to compare. */
export function marginShare(t) {
  if (!t || !Number.isFinite(t.margin_microusd) || !(t.cost_microusd > 0)) return null;
  return Math.round((t.margin_microusd / t.cost_microusd) * 100);
}

export const FLAG_LABELS = Object.freeze({
  spike: 'Spike',
  refusals: 'Refusals',
  held: 'Held runs',
  refund_after_spend: 'Refund after spend',
  new_heavy: 'New account heavy use',
});
export const FLAG_KINDS = Object.freeze(Object.keys(FLAG_LABELS));

export const ROLE_LABELS = Object.freeze({
  founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', admin: 'Admin', system: 'System',
});
export const roleLabel = (role) => (role ? ROLE_LABELS[role] || role : null);
/** A plan key as the page prints it: `founder:growth` → "Founder · Growth"; `system` stays "System". */
export const planText = (plan) => (plan === 'system' ? 'System' : planLabel(plan));

/** A model id as a short name: the last path segment ("llama-3.3-70b-instruct-fp8-fast"). */
export function modelName(model) {
  const s = String(model || '');
  return s.split('/').pop() || s || 'Unknown model';
}

/** The five totals the board heads the page with. */
export function headline(read) {
  const t = read?.totals;
  if (!t) return [];
  const share = marginShare(t);
  return [
    { key: 'runs', label: 'Runs', value: t.runs.toLocaleString('en-US'), note: t.refused ? `${t.refused.toLocaleString('en-US')} refused, not counted` : 'in the range' },
    { key: 'cost', label: 'Cloudflare cost', value: money(t.cost_microusd), note: 'paid to Cloudflare' },
    { key: 'charged', label: 'Charged to customers', value: money(t.charged_microusd),
      note: t.not_recorded ? `${t.not_recorded.toLocaleString('en-US')} ${t.not_recorded === 1 ? 'run' : 'runs'} not recorded` : 'at the posted rates' },
    { key: 'margin', label: 'Margin', value: money(t.margin_microusd), note: share == null ? 'no Cloudflare cost to compare' : `${share}% of Cloudflare cost` },
    { key: 'topups', label: 'AI tokens bought', value: Number.isFinite(read.topups_microusd) ? money(read.topups_microusd) : null, note: 'packs and auto-reloads' },
  ];
}

/**
 * The daily chart: one column per day in the range, stacked by model, on the
 * metric the toggle names (`cost` or `charged`). Days with no runs are drawn
 * empty, so the axis is the range, not the busy days.
 */
export function dailyByModel(read, metric = 'charged') {
  const field = metric === 'cost' ? 'cost_microusd' : 'charged_microusd';
  const cells = Array.isArray(read?.by_day_model) ? read.by_day_model : [];
  const models = [...new Set((read?.by_model || []).map((m) => m.model).concat(cells.map((c) => c.model)))];
  const days = rangeDays(read?.from, read?.to);
  const columns = days.map((day) => {
    const parts = models
      .map((model) => ({ model, value: cells.filter((c) => c.day === day && c.model === model).reduce((t, c) => t + (c[field] || 0), 0) }))
      .filter((p) => p.value > 0);
    return { day, parts, total: parts.reduce((t, p) => t + p.value, 0) };
  });
  return { metric, models: models.map((model) => ({ model, name: modelName(model), colour: modelColour(model) })), columns,
    max: columns.reduce((m, c) => Math.max(m, c.total), 0) };
}

/** Each UTC day from `from` up to (not including) `to`, as YYYY-MM-DD. */
export function rangeDays(from, to) {
  const start = Date.parse(`${String(from || '').slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(to || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const out = [];
  for (let t = start; t < end && out.length < 62; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** The three split tables: by model, by role and by plan. */
export function splits(read) {
  const row = (key, label, s) => ({ key, label, runs: s.runs, cost: s.cost_microusd, charged: s.charged_microusd, margin: s.margin_microusd, not_recorded: s.not_recorded });
  return [
    { title: 'By model', head: 'Model', rows: (read?.by_model || []).map((s) => ({ ...row(s.model, modelName(s.model), s), colour: modelColour(s.model) })) },
    { title: 'By role', head: 'Role', rows: (read?.by_role || []).map((s) => row(s.role, roleLabel(s.role), s)) },
    { title: 'By plan', head: 'Plan', rows: (read?.by_plan || []).map((s) => row(s.plan, planText(s.plan), s)) },
  ];
}

/** Every flag on a member, by member id; with "Paused" first for a paused member. */
export function flagsByMember(read) {
  const out = new Map();
  for (const p of read?.paused || []) out.set(p.member.id, [{ kind: 'paused', label: 'Paused' }]);
  for (const f of read?.flags || []) {
    const list = out.get(f.member.id) || [];
    if (!list.some((x) => x.kind === f.flag)) list.push({ kind: f.flag, label: FLAG_LABELS[f.flag] || f.flag });
    out.set(f.member.id, list);
  }
  return out;
}

export const isPaused = (read, id) => (read?.paused || []).some((p) => p.member.id === id);
export const capOf = (read, id) => (read?.caps || []).find((c) => c.member.id === id) || null;

/**
 * The Members table's rows: the top members by charge (or a search's answer),
 * each with its flags, whether it is paused and its cap.
 */
export function memberRows(read, list = read?.top_charged) {
  const flags = flagsByMember(read);
  return (list || []).map((r) => ({
    id: r.member.id, email: r.member.email, name: r.member.name, role: r.role ?? null, plan: r.plan ?? null,
    runs: r.runs, cost: r.cost_microusd, charged: r.charged_microusd, margin: r.margin_microusd, topups: r.topups_microusd,
    not_recorded: r.not_recorded,
    flags: flags.get(r.member.id) || [],
    paused: isPaused(read, r.member.id),
    cap: capOf(read, r.member.id)?.monthly_microusd ?? null,
  }));
}

export const SORTABLE = Object.freeze(['runs', 'cost', 'charged', 'margin', 'topups']);
/** Sorted on a money or count column; ties by user id, so the order is stable. */
export function sortRows(rows, key = 'charged', dir = 'desc') {
  if (!SORTABLE.includes(key)) return rows.slice();
  const sign = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => sign * ((a[key] ?? 0) - (b[key] ?? 0)) || a.id - b.id);
}

/** The "Fastest rising" tab: today against the 7-day daily average. */
export function risingRows(read) {
  const flags = flagsByMember(read);
  return (read?.top_velocity || []).map((v) => ({
    id: v.member.id, email: v.member.email, name: v.member.name,
    today: v.today_microusd, average: v.daily_average_microusd, ratio: v.ratio,
    flags: flags.get(v.member.id) || [],
  }));
}

/** The Flags list, newest first, each with its kind's label. */
export function flagRows(read) {
  return (read?.flags || []).map((f) => ({ ...f, label: FLAG_LABELS[f.flag] || f.flag, sinceText: whenLabel(f.since) || f.since }))
    .sort((a, b) => String(b.since).localeCompare(String(a.since)) || a.member.id - b.member.id);
}

/** One line of a member's pause and cap history, from its audit line. */
export function historyLine(h) {
  const d = h?.details && typeof h.details === 'object' ? h.details : {};
  const what = h.action === 'ai_member_paused' ? 'AI paused'
    : h.action === 'ai_member_unpaused' ? 'AI resumed'
      : h.action === 'ai_member_cap_set' ? `Cap set to ${money(d.after_microusd) ?? 'an amount not recorded'} a month`
        : h.action === 'ai_member_cap_cleared' ? 'Cap cleared'
          : h.action;
  return { when: whenLabel(h.at) || h.at, what, who: h.actor_name || (h.actor_id ? `#${h.actor_id}` : 'Not recorded'), why: typeof d.reason === 'string' ? d.reason : null };
}

/** The panel's state pill: paused, capped, both or neither. */
export function panelState(detail) {
  const parts = [];
  if (detail?.pause) parts.push('Paused');
  if (detail?.cap) parts.push(`Cap · ${money(detail.cap.monthly_microusd)} a month`);
  return parts.length ? parts.join(' · ') : 'Not paused · no cap';
}

/** A read the Worker could not make is `{ state: 'unreadable' }`: said, never $0. */
export function readOr(value, fmt) {
  if (!value || value.state !== 'ok') return { text: null, unreadable: true };
  return { text: fmt(value), unreadable: false };
}

export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const reasonOk = (text) => {
  const t = String(text ?? '').trim();
  return t.length >= REASON_MIN && t.length <= REASON_MAX;
};
/** The cap as typed: whole or decimal dollars, 0 to 100,000. Null when it is not one. */
export function parseCap(text) {
  const t = String(text ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100_000 ? n : null;
}
