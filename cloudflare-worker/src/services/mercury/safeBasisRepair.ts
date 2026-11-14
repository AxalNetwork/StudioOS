/**
 * D966 (#2630) — the owner's repair of Mercury SAFEs accepted before #2629.
 *
 * WHAT WENT WRONG. Before #2629 (`d15d97bd2f`), Accept on a Mercury SAFE
 * called `addHolder` without a basis and `safeEntry` never stored one, so the
 * `safes[]` entry it added to the venture's canonical `cap_table_scenarios`
 * row has no `basis`, and `simulate` reads it as the legacy pre-money SAFE.
 * Mercury's SAFE requests carry a post-money cap. #2629 fixed every later
 * Accept; this repairs the rows written before it.
 *
 * WHAT A CANDIDATE IS. One `mercury_raise_proposals` row with
 * `kind = 'safe'`, `status = 'accepted'` and `local_table =
 * 'cap_table_scenarios'` (`CANDIDATES`). That is where the pre-#2629 Accept
 * landed: `local_id` the venture's canonical scenario, `target` the entry
 * key `e-<n>` that `addHolder` returned, `payload_json` the terms it was
 * given. Accepts since D1017 land on `cap_table_issuances` and are never
 * candidates. A founder who disconnected Mercury lost these rows with the
 * connection (migration 520, `ON DELETE CASCADE`), so their SAFEs are not
 * seen here; D966 §6 counts them, read-only.
 *
 * ONE OUTCOME EACH, decided in this order (`settle`):
 *   scenario_missing        `local_id` is null, names no row, or names a row
 *                           that is no longer a canonical cap table (a draft
 *                           variant)
 *   scenario_other_venture  the row belongs to another venture, or to none
 *   ambiguous               another accepted SAFE proposal names the same
 *                           scenario and key, or the key names more than one
 *                           entry
 *   entry_missing           the key names no entry (deleted, or replaced under
 *                           a new key), or is not a key, or the inputs cannot
 *                           be read
 *   entry_not_safe          the key names a founder, a round or a note
 *   has_basis               the SAFE states a basis; it is kept as it is
 *   entry_changed           the SAFE's amount, cap or discount is not what the
 *                           Accept stored from the proposal's payload
 *                           (`safeTerms`), or the payload cannot be read
 *   record_venture          the venture's cap table is read from the record
 *                           (`readCapTable(...).source === 'record'`, the
 *                           check `acceptSafe` makes before it writes the
 *                           model), so its model is left alone
 *   inputs_invalid          the repaired inputs fail `validateInputs`, so
 *                           `simulate` would store errors, not results
 *   would_repair            a dry run's answer for the rest
 *   repaired                written: that one entry gains `basis: 'post_money'`
 *   conflict                the scenario changed after it was read; nothing
 *                           was written
 *   failed                  a read or the write threw; nothing of that row
 *                           was written, and the walk went on
 *
 * WHAT IS NEVER DONE. No entry is matched by investor name, only by the key
 * the proposal recorded. And the key alone does not prove the entry is the
 * Accept's: a client that posts no keys sends the same body for "edit the
 * Mercury row" and "delete it and type a namesake", and `withEntryKeys` gives
 * the namesake the deleted entry's key. So only an entry that still carries
 * the exact terms the Accept wrote is written; any other is `entry_changed`,
 * left for the owner. No entry but that one is touched: the rest of
 * `inputs_json` is written back as it was read. A draft variant is never
 * written, even when it holds an entry under the same key, because a key in a
 * copy proves nothing about where the entry came from (#2630, S1). Such
 * variants are listed in `variants_untouched`, by id.
 *
 * THE WRITE (`writeRow`) is one D1 batch of two statements under one guard,
 * "this row is still that venture's canonical scenario with the inputs that
 * were read":
 *   1. the rollback record: an `admin_audit_log` row (`ROW_AUDIT_ACTION`)
 *      holding the operator, the reason and the entry exactly as it was;
 *   2. the scenario: `inputs_json` with the one entry's basis added, and
 *      `result_json` recomputed through `simulate`, the engine every save
 *      runs (`saveScenario`), on inputs `validateInputs` has passed.
 * Both land or neither does. A guard that no longer holds writes neither, and
 * the row is `conflict`. Then D632's `captable_scenario_updated` activity row
 * names the operator in the venture's own History, by ids only.
 *
 * WHY NOT `saveScenario`. It keys entries and drops a founder's foreign
 * `holder_id` (`withEntryKeys`, `keepOwnHolders`), each of which can change
 * an entry other than the target, and its write is unconditional. The repair
 * keeps its recompute (`simulate`) and its columns, and adds the guard.
 *
 * RUN TWICE, THE SECOND RUN WRITES NOTHING: a repaired entry has a basis and
 * reports `has_basis`.
 *
 * The answer holds ids, keys and outcomes only: no name, email or amount.
 */
import type { Env } from '../../types';
import { simulate, validateInputs, type Inputs } from '../captable';
import { ENTRY_KEY, HolderError, KEYED_LISTS, logScenarioAct, safeTerms, type SafeTerms } from '../capTableWrites';
import { ensureCapTableVariantColumn } from '../captableSchema';
import { readCapTable } from '../capTableToday';
import { ensureAdminAuditLogTable } from '../../routes/admin';

/** The most candidates one page reads. */
export const SAFE_BASIS_REPAIR_LIMIT_MAX = 100;
export const SAFE_BASIS_REPAIR_LIMIT_DEFAULT = 25;
/** The basis Mercury's SAFE requests carry (`raiseReadsOf`), the one #2629 now passes. */
export const REPAIR_BASIS = 'post_money' as const;
/** One `admin_audit_log` row per repaired entry: its rollback record. */
export const ROW_AUDIT_ACTION = 'mercury_safe_basis_repaired';

export const REPAIR_OUTCOMES = [
  'repaired', 'would_repair', 'has_basis', 'scenario_missing', 'scenario_other_venture',
  'entry_missing', 'entry_not_safe', 'entry_changed', 'record_venture', 'inputs_invalid', 'ambiguous', 'conflict', 'failed',
] as const;
export type RepairOutcome = typeof REPAIR_OUTCOMES[number];

export type RepairRow = {
  proposal_id: number;
  project_id: number;
  scenario_id: number | null;
  entry_key: string | null;
  outcome: RepairOutcome;
  /** The venture's draft variants holding a SAFE with no basis under this key. Never written. */
  variants_untouched: number[];
};

export type RepairResult = {
  checked: number;
  counts: Record<RepairOutcome, number>;
  /** How many rows this run wrote. */
  written: number;
  rows: RepairRow[];
  /** The last proposal id of a full page; null once the walk has read every candidate. */
  next_after: number | null;
};

const CANDIDATES = `SELECT id, project_id, local_id, target, payload_json FROM mercury_raise_proposals
  WHERE id > ? AND kind = 'safe' AND status = 'accepted' AND local_table = 'cap_table_scenarios'
  ORDER BY id LIMIT ?`;
const CLAIMANTS = `SELECT COUNT(*) AS n FROM mercury_raise_proposals
  WHERE kind = 'safe' AND status = 'accepted' AND local_table = 'cap_table_scenarios' AND local_id = ? AND target = ?`;
const SCENARIO = 'SELECT id, uid, project_id, COALESCE(is_variant, 0) AS is_variant, inputs_json FROM cap_table_scenarios WHERE id = ?';
const VARIANTS = 'SELECT id, inputs_json FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 1 ORDER BY id';
// The batch's two statements share one guard, so they match exactly together.
const ROW_RECORD = `INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, filters_json)
  SELECT ?, ?, NULL, ?
   WHERE EXISTS (SELECT 1 FROM cap_table_scenarios WHERE id = ? AND project_id = ? AND COALESCE(is_variant, 0) = 0 AND inputs_json = ?)`;
const WRITE = `UPDATE cap_table_scenarios SET inputs_json = ?, result_json = ?, computed_at = ?, updated_at = ?
  WHERE id = ? AND project_id = ? AND COALESCE(is_variant, 0) = 0 AND inputs_json = ?`;

type Candidate = { id: number; project_id: number; local_id: number | null; target: string | null; payload_json: string | null };
type ScenarioRead = { id: number; uid: string; project_id: number | null; is_variant: number; inputs_json: string };
type Entry = Record<string, unknown>;
type Match = { list: typeof KEYED_LISTS[number]; index: number; entry: Entry };

/** A write's reason: 1 to 500 characters once trimmed, else null. */
export function repairReason(body: unknown): string | null {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>).reason : null;
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason.length > 0 && reason.length <= 500 ? reason : null;
}

const isEntry = (e: unknown): e is Entry => !!e && typeof e === 'object' && !Array.isArray(e);
const keyOf = (target: unknown): string | null => (typeof target === 'string' && ENTRY_KEY.test(target) ? target : null);

function parseObject(json: string | null): Record<string, unknown> | null {
  try {
    const v = JSON.parse(String(json ?? ''));
    return isEntry(v) ? v : null;
  } catch { return null; }
}

/** Every entry of the three keyed lists that holds `key`. Keys are issued across all three. */
function entriesUnder(inputs: Record<string, unknown>, key: string): Match[] {
  const out: Match[] = [];
  for (const list of KEYED_LISTS) {
    const entries = inputs[list];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => { if (isEntry(entry) && entry.key === key) out.push({ list, index, entry }); });
  }
  return out;
}

/** A SAFE, as `simulate` reads one: a `safes[]` entry that is not a note. */
const isSafe = (m: Match) => m.list === 'safes' && (m.entry.instrument == null || m.entry.instrument === 'safe');
/** No basis, as `safeEntry` and `validateInputs` read one: absent or null. */
const lacksBasis = (e: Entry) => e.basis == null;

/**
 * The amount, cap and discount the pre-#2629 Accept stored from this payload:
 * `acceptRaiseProposal` passed `amount_cents`, `cap_cents ?? null` and
 * `discount_pct ?? null` to `addHolder`, whose `safeEntry` converts them with
 * `safeTerms`. Null when the payload cannot be read, or holds terms
 * `safeEntry` refuses, so no Accept could have stored them.
 */
function acceptedTerms(payloadJson: string | null): SafeTerms | null {
  const payload = parseObject(payloadJson);
  if (!payload) return null;
  try {
    return safeTerms({
      amount_cents: payload.amount_cents, cap_cents: payload.cap_cents ?? null, discount_pct: payload.discount_pct ?? null,
    } as Parameters<typeof safeTerms>[0]);
  } catch (e) {
    if (e instanceof HolderError) return null;
    throw e;
  }
}
const TERMS = ['amount', 'cap', 'discount'] as const;
/** Exactly those terms. Absent and null are one value: `safeEntry` leaves the key out, and a client may post null. */
const sameTerms = (e: Entry, t: SafeTerms) => TERMS.every((k) => (e[k] ?? null) === (t[k] ?? null));

/** The inputs as read, with that one entry's basis added. */
function withBasis(inputs: Record<string, unknown>, m: Match): Inputs {
  const list = [...(inputs[m.list] as unknown[])];
  list[m.index] = { ...m.entry, basis: REPAIR_BASIS };
  return { ...inputs, [m.list]: list } as Inputs;
}

async function untouchedVariants(env: Env, projectId: number, key: string): Promise<number[]> {
  const rows = (await env.DB.prepare(VARIANTS).bind(projectId).all<{ id: number; inputs_json: string }>()).results ?? [];
  return rows.filter((v) => {
    const inputs = parseObject(v.inputs_json);
    return !!inputs && entriesUnder(inputs, key).some((m) => isSafe(m) && lacksBasis(m.entry));
  }).map((v) => Number(v.id));
}

type RunOpts = { write: boolean; operator: { id: number; email?: string | null }; reason: string | null };

/** One candidate's outcome; `row` gains its untouched variants. Throws only on a failed read or write. */
async function settle(env: Env, p: Candidate, row: RepairRow, opts: RunOpts, sources: Map<number, string>): Promise<RepairOutcome> {
  const key = row.entry_key;
  if (key) row.variants_untouched = await untouchedVariants(env, p.project_id, key);
  if (p.local_id == null) return 'scenario_missing';
  const s = await env.DB.prepare(SCENARIO).bind(p.local_id).first<ScenarioRead>();
  if (!s || Number(s.is_variant) !== 0) return 'scenario_missing';
  if (s.project_id == null || Number(s.project_id) !== Number(p.project_id)) return 'scenario_other_venture';
  if (!key) return 'entry_missing';
  const claimants = await env.DB.prepare(CLAIMANTS).bind(p.local_id, key).first<{ n: number }>();
  if (Number(claimants?.n ?? 0) > 1) return 'ambiguous';
  const inputs = parseObject(s.inputs_json);
  if (!inputs) return 'entry_missing';
  const matches = entriesUnder(inputs, key);
  if (!matches.length) return 'entry_missing';
  if (matches.length > 1) return 'ambiguous';
  const [m] = matches;
  if (!isSafe(m)) return 'entry_not_safe';
  if (!lacksBasis(m.entry)) return 'has_basis';
  const terms = acceptedTerms(p.payload_json);
  if (!terms || !sameTerms(m.entry, terms)) return 'entry_changed';
  let source = sources.get(p.project_id);
  if (source === undefined) {
    source = (await readCapTable(env, p.project_id)).source;
    sources.set(p.project_id, source);
  }
  if (source === 'record') return 'record_venture';
  const next = withBasis(inputs, m);
  if (validateInputs(next).length) return 'inputs_invalid';
  if (!opts.write) return 'would_repair';
  return (await writeRow(env, p, s, next, m, key, opts)) ? 'repaired' : 'conflict';
}

/** The guarded batch. True when it wrote; false when the scenario changed since it was read. */
async function writeRow(env: Env, p: Candidate, s: ScenarioRead, next: Inputs, m: Match, key: string, opts: RunOpts): Promise<boolean> {
  const nextJson = JSON.stringify(next);
  const result = JSON.stringify(simulate(next));
  const now = new Date().toISOString();
  const record = JSON.stringify({
    decision: 'D966', proposal_id: p.id, project_id: p.project_id, scenario_id: s.id, scenario_uid: s.uid,
    entry_key: key, list: m.list, index: m.index, prior_entry: m.entry, basis: REPAIR_BASIS, reason: opts.reason,
  });
  const out = await env.DB.batch([
    env.DB.prepare(ROW_RECORD).bind(opts.operator.id, ROW_AUDIT_ACTION, record, s.id, p.project_id, s.inputs_json),
    env.DB.prepare(WRITE).bind(nextJson, result, now, now, s.id, p.project_id, s.inputs_json),
  ]);
  if (Number(out[1]?.meta?.changes ?? 0) !== 1) return false;
  // D632: the venture's History names who changed its scenario. Best effort, by ids only.
  await logScenarioAct(env, opts.operator, 'captable_scenario_updated', { uid: s.uid, project_id: p.project_id, is_variant: 0 }, { repair: 'D966', entry_key: key });
  return true;
}

/**
 * One page of candidates, by proposal id after `after`. Each is reported, and
 * written only when `write`. A row whose read or write throws is `failed` and
 * the walk goes on, so the answer always says which rows were written. Only
 * the page read throws, before any row is touched.
 */
export async function repairSafeBasis(env: Env, opts: RunOpts & { after: number; limit: number }): Promise<RepairResult> {
  const limit = Math.max(1, Math.min(SAFE_BASIS_REPAIR_LIMIT_MAX, Math.floor(opts.limit)));
  await ensureCapTableVariantColumn(env);
  if (opts.write) await ensureAdminAuditLogTable(env);
  const page = (await env.DB.prepare(CANDIDATES).bind(Math.max(0, Math.floor(opts.after)), limit).all<Candidate>()).results ?? [];
  const sources = new Map<number, string>();
  const rows: RepairRow[] = [];
  for (const p of page) {
    const row: RepairRow = {
      proposal_id: Number(p.id), project_id: Number(p.project_id), scenario_id: p.local_id == null ? null : Number(p.local_id),
      entry_key: keyOf(p.target), outcome: 'failed', variants_untouched: [],
    };
    try {
      row.outcome = await settle(env, p, row, opts, sources);
    } catch (e) {
      // A batch rolls back whole, so a throw leaves nothing of this row written.
      console.warn('[mercury] SAFE basis repair: row not settled', p.id, (e as Error).message);
      row.outcome = 'failed';
    }
    rows.push(row);
  }
  const counts = Object.fromEntries(REPAIR_OUTCOMES.map((o) => [o, 0])) as Record<RepairOutcome, number>;
  for (const r of rows) counts[r.outcome]++;
  return {
    checked: rows.length,
    counts,
    written: counts.repaired,
    rows,
    next_after: page.length === limit ? Number(page[page.length - 1].id) : null,
  };
}
