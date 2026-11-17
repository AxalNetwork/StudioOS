/**
 * D6085 (#6085) — pure: which cap-table scenario pays for a plan scenario
 * ("Paid for by", RA-32, RA-33), Founders after the round, the picker's rows
 * and the link's body. Every cap-table figure is Modelled; a raise that
 * differs names both amounts and is never fixed here; a missing figure is
 * Not recorded, never 0.
 */
import { NOT_RECORDED, dayText, money } from './useOfFundsModel';

export const MODELLED = 'Modelled';
export const CAP_TABLE_HREF = '/raise/cap-table';
export const scenarioHref = (uid) => `${CAP_TABLE_HREF}/scenarios/${encodeURIComponent(uid)}`;

const pct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(1)}%` : null);
/** "−6.0 pts", "+1.2 pts", "0.0 pts". */
export function pointsText(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const abs = Math.abs(n).toFixed(1);
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${abs} pts`;
}

/** "Seed · $1.5m · updated 12 Nov 2026": the round, its investment and the date. */
export function scenarioLine(x) {
  const round = x?.round;
  const parts = [];
  if (round?.name) parts.push(round.name);
  const inv = round?.investment_cents != null ? money(round.investment_cents, 'usd') : null;
  parts.push(inv || 'No round modelled');
  const day = dayText(x?.updated_at || x?.scenario?.updated_at);
  if (day) parts.push(`updated ${day}`);
  return parts.join(' · ');
}

/** The mismatch line (UF13d): both amounts, each with its tag. Null when they agree or one is missing. */
export function raiseDiffers(raise, name = 'The cap-table scenario') {
  if (!raise?.differs) return null;
  return {
    text: `Raise differs: ${name} invests ${money(raise.scenario_cents, 'usd')}; the plan raises ${money(raise.plan_cents, 'usd')}.`,
    plan: money(raise.plan_cents, 'usd'), scenario: money(raise.scenario_cents, 'usd'),
  };
}

/**
 * "Paid for by" in the plan's header. `link` is the scenario's `cap_table_link`;
 * `latest` is the plan's `ties.cap_table` block, shown unlinked when nothing is linked.
 */
export function paidForBy(link, latest = null) {
  const state = link?.state || 'not_linked';
  if (state === 'linked') {
    const name = link.scenario?.name || 'Cap-table scenario';
    return { state, label: 'Linked', name, tag: MODELLED, sub: scenarioLine(link), action: 'Change', href: scenarioHref(link.uid), differs: raiseDiffers(link.raise, name) };
  }
  if (state === 'deleted') {
    return { state, label: 'Link broken', name: null, tag: null, sub: link.reason || 'The linked scenario no longer exists.', action: 'Pick another', href: null, differs: null };
  }
  if (state === 'unreadable') {
    return { state, label: 'Unavailable', name: null, tag: null, sub: link.reason || 'The linked scenario could not be read. The plan still works.', action: 'Try again', href: null, differs: null };
  }
  const value = latest?.state === 'ok' ? latest.value : null;
  if (latest?.state === 'ok' && !value) {
    return { state: 'empty', label: 'None', name: null, tag: null, sub: 'No cap-table scenarios yet. Model a round to see what founders keep.', action: null, href: CAP_TABLE_HREF, differs: null };
  }
  return { state: 'not_linked', label: 'Not linked', name: null, tag: null,
    sub: value ? `Latest: ${value.name || 'Cap-table scenario'} · shown unlinked` : 'No cap-table scenario is linked.',
    action: 'Link a scenario', href: null, differs: null };
}

/**
 * Founders after the round (RA-32 A, RA-33): `hidden` until a scenario is
 * linked, `unavailable` when it could not be read, `not_recorded` when it has
 * no founders, else one row per founder and the founders together.
 */
export function foundersView(link) {
  if (!link || link.state === 'not_linked' || link.state === 'deleted') return { state: 'hidden' };
  if (link.state === 'unreadable') return { state: 'unavailable', reason: 'The scenario’s result couldn’t be read. The plan still works. Founders after the round is not shown.' };
  const f = link.founders;
  const scenario = link.scenario?.name || 'the linked scenario';
  if (!f || f.state !== 'ok') return { state: 'not_recorded', text: NOT_RECORDED, reason: f?.reason || `${scenario} has no founders, so there is nothing to compare. Not 0%.` };
  const round = f.round || 'the round';
  const day = dayText(link.scenario?.updated_at);
  return {
    state: 'ok', tag: MODELLED, round,
    caption: `Each founder’s modelled share before and after ${round} in ${scenario}`,
    rows: f.rows.map((r) => ({ founder: r.founder, before: pct(r.before_pct), after: pct(r.after_pct), change: pointsText(r.change_pts) })),
    together: f.together ? { before: pct(f.together.before_pct), after: pct(f.together.after_pct), change: pointsText(f.together.change_pts) } : null,
    note: `Modelled in ${scenario}${day ? `, updated ${day}` : ''}. These are the scenario’s founders, not recorded holders.`,
    href: scenarioHref(link.uid),
  };
}

/** One card's cap-table line on Scenarios (UF9). */
export function capTableLine(link) {
  const s = link?.state;
  if (s === 'linked') return `${link.scenario?.name || 'Cap-table scenario'} · ${MODELLED}${link.raise?.differs ? ' · Raise differs' : ''}`;
  if (s === 'deleted') return 'Link broken · the linked cap-table scenario no longer exists';
  if (s === 'unreadable') return 'The linked cap-table scenario could not be read';
  return 'No cap-table scenario linked';
}

/** Compare's "Founders after the round" cell (UF10): the founders together, Modelled, or why not. */
export function foundersCell(link) {
  const v = foundersView(link);
  if (v.state === 'ok' && v.together) return { text: `${v.together.after} · ${v.together.change}`, missing: false, reason: null, tag: MODELLED };
  if (v.state === 'unavailable') return { text: 'Unavailable', missing: true, reason: 'The linked scenario could not be read' };
  if (v.state === 'not_recorded') return { text: NOT_RECORDED, missing: true, reason: 'The linked scenario has no founders' };
  if (link?.state === 'deleted') return { text: NOT_RECORDED, missing: true, reason: 'The linked cap-table scenario no longer exists' };
  return { text: NOT_RECORDED, missing: true, reason: 'No cap-table scenario linked' };
}

/** The picker's rows (RA-32 B): each scenario with its investment, date and Raise differs; the matching one suggested. */
export function pickerRows(read) {
  const items = Array.isArray(read?.items) ? read.items : [];
  return items.map((i) => ({
    uid: i.uid, name: i.model ? `${i.name || 'Cap table'} · model` : i.name || 'Unnamed scenario',
    sub: scenarioLine(i), differs: !!i.raise?.differs, raise: i.raise,
    linked: read?.linked_uid === i.uid, suggested: read?.matching_uid === i.uid,
  }));
}

/** Eadwyn's suggestion line, only when one scenario's investment matches the plan's raise. */
export function suggestion(read) {
  const rows = pickerRows(read);
  const s = rows.find((r) => r.suggested);
  if (!s || s.linked) return null;
  return { uid: s.uid, text: `Eadwyn suggests ${s.name}.`, why: `Its investment, ${money(s.raise.scenario_cents, 'usd')}, matches the plan’s raise.` };
}

/** The write: the uid picked (or null to clear) and the revision the scenario was read at. */
export function linkBody(uid, revision) {
  return { cap_table_scenario_uid: uid ?? null, expected_revision: Number(revision ?? 0) };
}
