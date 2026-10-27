/**
 * D1172 (#3085, STG20) — the words and rows of HQ › Platform › Storage, pure
 * for the tests. The figures are `GET /api/admin/platform/storage`'s (D1170,
 * with D1172's `by_tier`): totals, plans and states only. Nothing here names
 * a member or a file, and no allowance is written here: each tier's is the
 * Worker's, from the catalogue. 1 GB = 1,024 MB (`usageModel.bytes`).
 *
 * WHAT CANNOT BE READ IS SAID. A figure the read sends as null is null here,
 * with the read's reason, never 0. A tier with no members has a measured 0 B
 * and no median ("—", with why).
 */
import { bytes } from '../account/usageModel';

export const STORAGE_HQ = Object.freeze({
  title: 'Storage',
  crumb: 'Platform',
  pill: 'HQ only',
  line: 'How much members store, by plan and by kind. Totals only.',
  byPlan: 'Stored by plan',
  byState: 'Members by state, per plan',
  byStateFoot: 'Members on each plan, by how much of their allowance they use.',
  table: 'By plan',
  tableFoot: 'Totals only. A member’s files are theirs; HQ sees sums. No member or file is named here.',
  reading: 'Reading platform storage…',
  noMembers: 'No members on this plan',
  negotiated: 'Not measured: the allowance is negotiated',
  floor: 'Some stored files could not be read, so this is a floor.',
});

/** The six kinds, in the Worker's order (`STORAGE_KINDS`), with the canvas's names and palette. */
export const KINDS = Object.freeze([
  { key: 'data_room', label: 'Data room', colour: '#7c3aed', dark: '#a78bfa' },
  { key: 'documents', label: 'Documents', colour: '#0ea5e9', dark: '#38bdf8' },
  { key: 'recordings', label: 'Recordings', colour: '#f59e0b', dark: '#fbbf24' },
  { key: 'decks_exports', label: 'Decks and exports', colour: '#10b981', dark: '#34d399' },
  { key: 'brand', label: 'Brand', colour: '#6b6577', dark: '#9ca3af' },
  { key: 'other', label: 'Other', colour: 'hatch', dark: 'hatch' },
]);

/** The five measured states, in the canvas's order; a negotiated plan's members are "not measured". */
export const STATES = Object.freeze([
  { key: 'ok', label: 'Under 80%', colour: '#7c3aed', dark: '#a78bfa' },
  { key: 'near_80', label: '80% or more', colour: '#0ea5e9', dark: '#38bdf8' },
  { key: 'near_95', label: '95% or more', colour: '#f59e0b', dark: '#fbbf24' },
  { key: 'full', label: 'Full', colour: '#10b981', dark: '#34d399' },
  { key: 'over', label: 'Over their plan', colour: '#6b6577', dark: '#9ca3af' },
]);

const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);
const sumOf = (rows, pick) => {
  let total = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) return null;
    total += v;
  }
  return total;
};
/** A count in the en-US form the canvas uses: 1,204. */
export const countText = (n) => (count(n) === null ? null : n.toLocaleString('en-US'));
/** Bytes as the canvas draws them; 0 is a measured "0 B". */
export const sizeText = (n) => (count(n) === null ? null : bytes(n));

/** The tiers the read sent, or null when the plans could not be read. */
const tiers = (read) => (Array.isArray(read?.by_tier) ? read.by_tier : null);
const near = (t) => {
  const a = count(t.by_state?.near_80); const b = count(t.by_state?.near_95);
  return a === null || b === null ? null : a + b;
};

/**
 * The six tiles. Each is `{ key, label, value, note }`; `value` null means it
 * could not be read, and `reason` says why.
 */
export function tiles(read) {
  const ts = tiers(read);
  const totals = read?.totals || {};
  const stateReason = read?.by_tier_reason || null;
  const states = (pick) => (ts ? sumOf(ts, (t) => (t.by_state ? count(pick(t.by_state)) : null)) : null);
  const withFiles = count(totals.members_with_files);
  const stored = sizeText(totals.measured_bytes);
  return [
    { key: 'stored', label: 'Total stored', value: stored === null ? null : read?.complete === false ? `at least ${stored}` : stored,
      note: read?.complete === false ? STORAGE_HQ.floor : withFiles === null ? 'Members not read' : `across ${countText(withFiles)} members with files` },
    { key: 'members', label: 'Members with files', value: countText(withFiles), note: 'staff accounts not counted', reason: withFiles === null ? read?.by_plan_reason : null },
    { key: 'near', label: 'Near the limit', value: countText(ts ? sumOf(ts, near) : null), note: 'at 80% or more of their plan', reason: stateReason },
    { key: 'full', label: 'Storage full', value: countText(states((s) => s.full)), note: 'new uploads paused', reason: stateReason },
    { key: 'over', label: 'Over their plan', value: countText(states((s) => s.over)), note: 'after a plan change', reason: stateReason },
    { key: 'unknown', label: 'Size not recorded', value: count(totals.unknown_size_files) === null ? null : `${countText(totals.unknown_size_files)} files`, note: 'being measured · not in the total', muted: true },
  ];
}

/** A tier's allowance: the catalogue's bytes, else its reason. */
export const allowanceOf = (t) => sizeText(t?.allowance_bytes) ?? t?.allowance_reason ?? null;

/**
 * The By plan table's rows, sorted by `sort` (`used`, the canvas's default, or
 * `plan`, the owner's table order). Each cell is text, or null with why.
 */
export function planRows(read, sort = 'used') {
  const ts = tiers(read);
  if (!ts) return null;
  const rows = ts.map((t, i) => {
    const measured = t.allowance_bytes !== null;
    const state = (k) => (!measured ? { text: '—', why: STORAGE_HQ.negotiated } : t.by_state ? { text: countText(t.by_state[k]) } : { text: null, why: read.by_tier_reason });
    return {
      key: t.tier, order: i, label: t.label, plans: (t.plan_names || []).join(', '), allowance: allowanceOf(t),
      members: countText(t.members),
      used: t.measured_bytes === null ? { text: null, why: read.by_tier_reason } : { text: sizeText(t.measured_bytes) },
      median: t.members === 0 ? { text: '—', why: STORAGE_HQ.noMembers } : t.median_bytes === null ? { text: null, why: read.by_tier_reason } : { text: sizeText(t.median_bytes) },
      near: !measured ? state('near_80') : t.by_state ? { text: countText(near(t)) } : { text: null, why: read.by_tier_reason },
      full: state('full'),
      over: state('over'),
      usedBytes: t.measured_bytes ?? -1,
    };
  });
  return sort === 'plan' ? rows : [...rows].sort((a, b) => b.usedBytes - a.usedBytes || a.order - b.order);
}

/**
 * Stored by plan: one column per tier, stacked by kind. Null when the bytes
 * could not be read (the read's reason says why).
 */
export function kindColumns(read) {
  const ts = tiers(read);
  if (!ts || ts.some((t) => !Array.isArray(t.by_kind))) return null;
  return ts.map((t) => {
    const parts = KINDS.map((k) => ({ ...k, bytes: count(t.by_kind.find((x) => x.key === k.key)?.measured_bytes) ?? 0 }));
    return { key: t.tier, label: t.label, total: parts.reduce((n, p) => n + p.bytes, 0), parts, members: t.members };
  });
}

/**
 * Members by state, per plan: one bar per tier. A tier with no members says so;
 * a negotiated one says its members are not measured.
 */
export function stateBars(read) {
  const ts = tiers(read);
  if (!ts || ts.some((t) => !t.by_state)) return null;
  return ts.map((t) => {
    const parts = STATES.map((s) => ({ ...s, members: count(t.by_state[s.key]) ?? 0 }));
    return {
      key: t.tier, label: t.label, total: t.members, parts,
      note: t.members === 0 ? STORAGE_HQ.noMembers : t.allowance_bytes === null ? `${countText(t.members)} ${t.members === 1 ? 'member' : 'members'} · ${STORAGE_HQ.negotiated.toLowerCase()}` : null,
    };
  });
}
