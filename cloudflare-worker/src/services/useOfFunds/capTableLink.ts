/**
 * D6085 (#6085): the cap-table scenario a Use of funds scenario names ("Paid for by", RA-32, RA-33).
 *
 * A link is a stored `cap_table_scenarios.uid` on the plan's scenario. It is
 * read back only from a scenario of the same project; one that no longer
 * exists there reads `deleted` ("Link broken"), never an error. A linked
 * scenario's first modelled round gives the raise compared with the plan's
 * (shown, never fixed) and each founder's share before and after it, all
 * Modelled: these are the scenario's founders, not recorded holders.
 */
import type { Env } from '../../types';
import { majorToMinor } from '../../../../frontend/src/lib/money.js';

type Row = { uid: string; name: string | null; is_variant: number | null; inputs_json: string | null; result_json: string | null; updated_at: string | null };

const parse = (raw: string | null): any => {
  if (raw == null || raw === '') return null;
  try { return JSON.parse(raw); } catch { return undefined; }
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The scenario's first modelled round: its name and investment in cents (USD, as the simulator types it). */
export function firstRound(inputs: any): { name: string | null; investment_cents: number | null } | null {
  const rounds = Array.isArray(inputs?.rounds) ? inputs.rounds : [];
  if (!rounds.length) return null;
  const r = rounds[0] ?? {};
  const inv = typeof r.investment === 'number' && Number.isFinite(r.investment) && r.investment >= 0 ? majorToMinor(r.investment, 'USD') : null;
  return { name: typeof r.name === 'string' && r.name ? r.name : null, investment_cents: inv };
}

/** Each founder before the round (Founding) and after the first round, in percent and points. */
export function foundersAfter(result: any) {
  const list = Array.isArray(result?.founder_dilution) ? result.founder_dilution : [];
  const rows = list.map((f: any) => {
    const series = Array.isArray(f?.series) ? f.series : [];
    const before = typeof series[0]?.pct === 'number' ? series[0].pct : null;
    const after = typeof series[1]?.pct === 'number' ? series[1].pct : null;
    return { founder: typeof f?.founder === 'string' ? f.founder : null, before_pct: before, after_pct: after,
      change_pts: before != null && after != null ? round1(after - before) : null };
  }).filter((f: any) => f.founder && f.before_pct != null && f.after_pct != null);
  if (!rows.length) return { state: 'not_recorded' as const, source: 'Modelled', reason: 'This scenario has no founders after a round, so there is nothing to compare. Not 0%.', round: null, rows: [], together: null };
  const before = rows.reduce((a: number, f: any) => a + f.before_pct, 0);
  const after = rows.reduce((a: number, f: any) => a + f.after_pct, 0);
  const roundName = list[0]?.series?.[1]?.round ?? null;
  return { state: 'ok' as const, source: 'Modelled', reason: null, round: typeof roundName === 'string' ? roundName : null,
    rows: rows.map((f: any) => ({ ...f, before_pct: round1(f.before_pct), after_pct: round1(f.after_pct) })),
    together: { before_pct: round1(before), after_pct: round1(after), change_pts: round1(after - before) } };
}

/** One cap-table scenario as the picker and the link draw it, compared with the plan's raise. */
export function option(row: Row, planRaiseCents: number | null) {
  const inputs = parse(row.inputs_json);
  const round = inputs === undefined ? null : firstRound(inputs);
  const investment = round?.investment_cents ?? null;
  return {
    uid: row.uid, name: row.name || null, model: !row.is_variant, updated_at: row.updated_at, source: 'Modelled',
    round: round ? { name: round.name, investment_cents: investment } : null,
    raise: { plan_cents: planRaiseCents, scenario_cents: investment,
      differs: planRaiseCents != null && investment != null && planRaiseCents !== investment },
    readable: inputs !== undefined,
  };
}


/** The project's cap-table scenarios for the picker: the model first, then the newest. */
export async function capTableOptions(env: Env, projectId: number, planRaiseCents: number | null) {
  const rows = (await env.DB.prepare('SELECT uid,name,is_variant,inputs_json,result_json,updated_at FROM cap_table_scenarios WHERE project_id=? ORDER BY COALESCE(is_variant,0) ASC,updated_at DESC,id DESC LIMIT 50').bind(projectId).all<Row>()).results ?? [];
  const items = rows.map((r) => option(r, planRaiseCents));
  const match = planRaiseCents == null ? null : items.find((i) => i.raise.scenario_cents === planRaiseCents) ?? null;
  return { items, plan_raise_cents: planRaiseCents, matching_uid: match?.uid ?? null, source: 'Modelled' };
}

/** A same-project cap-table scenario by uid, or null when it is not there. */
export async function capTableScenarioIn(env: Env, projectId: number, uid: string): Promise<Row | null> {
  return env.DB.prepare('SELECT uid,name,is_variant,inputs_json,result_json,updated_at FROM cap_table_scenarios WHERE uid=? AND project_id=?').bind(uid, projectId).first<Row>();
}

/**
 * The link as a scenario's read carries it. `not_linked` reads nothing; a
 * failed read is `unreadable` with the plan still readable around it.
 */
export async function linkView(env: Env, projectId: number, r: any) {
  const uid = typeof r?.cap_table_scenario_uid === 'string' && r.cap_table_scenario_uid ? r.cap_table_scenario_uid : null;
  const at = r?.cap_table_linked_at ?? null;
  if (!uid) return { state: 'not_linked' as const, uid: null, linked_at: at, reason: 'No cap-table scenario is linked.' };
  let row: Row | null;
  try { row = await capTableScenarioIn(env, projectId, uid); }
  catch { return { state: 'unreadable' as const, uid, linked_at: at, reason: 'The linked scenario could not be read. The plan still works.' }; }
  if (!row) return { state: 'deleted' as const, uid, linked_at: at, reason: 'The linked scenario no longer exists. Founders after the round is hidden until you pick another.' };
  const opt = option(row, r?.amount_to_raise_cents ?? null);
  const result = parse(row.result_json);
  if (!opt.readable || result === undefined) return { state: 'unreadable' as const, uid, linked_at: at, reason: 'The linked scenario could not be read. The plan still works.' };
  return { state: 'linked' as const, uid, linked_at: at, reason: null, scenario: { uid: opt.uid, name: opt.name, model: opt.model, updated_at: opt.updated_at, source: 'Modelled' },
    round: opt.round, raise: opt.raise, founders: foundersAfter(result) };
}
