/**
 * D1018 (#2855) — Cap table part 3: a scenario starts from Today, the record
 * (D1017), never from typed founders; and one reader of the cap table for
 * every module that draws it.
 *
 *   startFromRecord(record)  the record's holders, unallocated pool and
 *                            instruments as the engine's `start` and `safes`;
 *                            what the record does not hold is listed as not
 *                            modelled, never guessed
 *   offerFromModel(...)      the canonical model's founders and SAFEs as
 *                            part 2's proposal bodies ("Record them from the
 *                            model", CT19b); nothing is written here
 *   readCapTable(env, id)    the one reader: Today from the record when the
 *                            record holds shares, else the saved model,
 *                            marked `modelled`
 *
 * The model keeps its row in `cap_table_scenarios`; it is read as the scenario
 * "Cap table · model" and never written to the record.
 */
import type { Env } from '../types';
import { readRecord } from './capTableRecord';
import { simulate, type Inputs, type SimulateResult, type StartHolder } from './captable';

/** The name the canonical model is read under once the record exists (CT19b). */
export const MODEL_SCENARIO_NAME = 'Cap table · model';

type RecordRead = Awaited<ReturnType<typeof readRecord>>;
type SafeInput = NonNullable<Inputs['safes']>[number];
export type NotModelled = { uid: string; name: string; kind: string; reason: string; sentence: string };

const NOT_MODELLED: Record<string, string> = {
  amount_not_recorded: 'Its amount is not recorded, so it cannot convert in a scenario.',
  basis_not_recorded: 'Whether it is pre-money or post-money is not recorded.',
  no_cap_or_discount: 'It has neither a cap nor a discount, so no conversion price can be set.',
  issue_date_not_recorded: 'It accrues interest, and its issue date is not recorded.',
  other_currency: 'It is recorded in another currency than the venture’s.',
};

export type Start =
  | {
    available: true; reason: null;
    currency: string;
    start: NonNullable<Inputs['start']>;
    safes: SafeInput[];
    /** Recorded instruments left out of the scenario, each with its reason. */
    not_modelled: NotModelled[];
    /** holder name → `h-<holder id>`, so a reader can name each row the way the record does. */
    ids: Record<string, string>;
  }
  | { available: false; reason: string; sentence: string };

const keyOf = (holderId: number | null | undefined, name: string | null | undefined) =>
  holderId != null ? `h-${holderId}` : `n:${String(name ?? '').trim().toLowerCase()}`;

/**
 * The record as the engine's starting point. Holders take their recorded
 * shares by class kind: common, preferred, and options granted from a pool.
 * The unallocated pool is the record's own figure. A block the record cannot
 * compute makes the start unavailable with the record's reason.
 */
export function startFromRecord(record: RecordRead): Start {
  const byHolder = record.by_holder as { available: boolean; reason: string | null; sentence?: string; rows?: any[] };
  // Fully diluted is unavailable whenever the holders are (nothing recorded, a negative balance), and for a pool it cannot count.
  const fd = record.fully_diluted as { available: boolean; reason?: string; sentence?: string; unallocated_pool?: number | null };
  if (!fd.available) return { available: false, reason: String(fd.reason), sentence: String(fd.sentence ?? '') };
  const classes = (record.by_class as { rows?: any[] }).rows ?? [];
  const kindOf = new Map<string, string>(classes.map((c: any) => [String(c.uid), String(c.kind)]));

  // A preferred holder's preference is what they paid in: the sum of their
  // recorded priced issuances into a preferred class. Any other row that put
  // preferred shares in their hands leaves it not recorded.
  const paid = new Map<string, number | null>();
  for (const r of (record.issuances as { rows: any[] }).rows) {
    if (r.status !== 'recorded' || !r.class_uid || kindOf.get(r.class_uid) !== 'preferred') continue;
    const k = keyOf(r.holder?.holder_id, r.holder?.name);
    if (r.kind === 'priced' && r.amount_cents != null && r.currency === record.currency.code) {
      const prev = paid.get(k);
      if (prev !== null) paid.set(k, (prev ?? 0) + Number(r.amount_cents) / 100);
    } else if (r.kind !== 'cancellation') paid.set(k, null);
  }

  const holders: StartHolder[] = [];
  const ids: Record<string, string> = {};
  for (const h of byHolder.rows ?? []) {
    const name = String(h.name ?? '').trim();
    if (h.holder_id != null) ids[name] = `h-${h.holder_id}`;
    let common = 0; let preferred = 0; let options = 0;
    for (const c of h.by_class ?? []) {
      const kind = kindOf.get(String(c.class_uid));
      if (kind === 'common') common += Number(c.shares);
      else if (kind === 'preferred') preferred += Number(c.shares);
      else if (kind === 'option_pool') options += Number(c.shares);
    }
    if (common > 0) holders.push({ name, type: 'common', shares: common });
    if (preferred > 0) holders.push({ name, type: 'preferred', shares: preferred, preference: paid.get(keyOf(h.holder_id, h.name)) ?? null });
    if (options > 0) holders.push({ name, type: 'options', shares: options });
  }

  // Instruments a recorded conversion has already converted are not outstanding.
  const converted = new Set((record.issuances as { rows: any[] }).rows
    .filter((r) => r.status === 'recorded' && r.kind === 'conversion' && r.related_uid).map((r) => r.related_uid));
  const safes: SafeInput[] = [];
  const notModelled: NotModelled[] = [];
  for (const r of (record.instruments as { rows: any[] }).rows) {
    if (converted.has(r.uid)) continue;
    const name = String(r.holder?.name ?? '').trim();
    const t = r.terms ?? {};
    const skip = (reason: string) => notModelled.push({ uid: r.uid, name, kind: r.kind, reason, sentence: NOT_MODELLED[reason] });
    if (r.amount_cents == null) { skip('amount_not_recorded'); continue; }
    if (r.currency && r.currency !== record.currency.code) { skip('other_currency'); continue; }
    if (t.basis !== 'pre_money' && t.basis !== 'post_money') { skip('basis_not_recorded'); continue; }
    if (!(Number(t.cap_cents) > 0) && !(Number(t.discount_bps) > 0)) { skip('no_cap_or_discount'); continue; }
    if (r.kind === 'note' && Number(t.interest_bps) > 0 && !r.issued_on) { skip('issue_date_not_recorded'); continue; }
    safes.push({
      name, amount: Number(r.amount_cents) / 100,
      ...(Number(t.cap_cents) > 0 ? { cap: Number(t.cap_cents) / 100 } : {}),
      ...(Number(t.discount_bps) > 0 ? { discount: Number(t.discount_bps) / 10000 } : {}),
      basis: t.basis, instrument: r.kind === 'note' ? 'note' : 'safe',
      ...(r.kind === 'note' && Number(t.interest_bps) > 0 ? { interest_rate: Number(t.interest_bps) / 10000 } : {}),
      ...(r.issued_on ? { issue_date: r.issued_on } : {}),
      ...(t.mfn === true ? { mfn: true } : {}),
    });
  }
  return {
    available: true, reason: null, currency: record.currency.code,
    start: { holders, pool_shares: fd.unallocated_pool ?? null },
    safes, not_modelled: notModelled, ids,
  };
}

/** The engine's inputs for a scenario from Today, with the caller's rounds and exits. */
export function inputsFrom(start: Extract<Start, { available: true }>, extra: Pick<Inputs, 'rounds' | 'exit_value' | 'exit_values'> & { converting?: string[] | null } = {}): Inputs {
  const converting = extra.converting == null ? null : new Set(extra.converting);
  return {
    start: start.start,
    safes: start.safes.map((s) => (converting && !converting.has(s.name) ? { ...s, converts: false } : s)),
    ...(extra.rounds ? { rounds: extra.rounds } : {}),
    ...(extra.exit_value != null ? { exit_value: extra.exit_value } : {}),
    ...(extra.exit_values ? { exit_values: extra.exit_values } : {}),
  };
}

type ModelRow = { uid?: string; name?: string; inputs_json: string | null; result_json: string | null; updated_at?: string };

async function canonicalModel(env: Env, projectId: number): Promise<ModelRow | null> {
  return env.DB.prepare(
    // Every column, as the readers it replaces asked: an older table may lack some.
    'SELECT * FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant,0) = 0 ORDER BY updated_at DESC LIMIT 1',
  ).bind(projectId).first<ModelRow>();
}

const parse = <T>(s: string | null | undefined): T | null => {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
};

/**
 * The model's founders and SAFEs as part 2's proposal bodies, for "Record them
 * from the model". A holder the record already holds, or has a live proposal
 * for, with the same kind, is left out. Nothing is written: each body is sent
 * through `POST /record/:projectId/proposals`, so a co-founder's still waits
 * for the owner.
 */
export function offerFromModel(inputs: Inputs | null, record: RecordRead) {
  if (!inputs) return { available: false, reason: 'no_model', sentence: 'No model is saved for this venture.', rows: [] as Record<string, unknown>[] };
  const held = new Set<string>();
  for (const r of [...(record.issuances as { rows: any[] }).rows, ...(record.proposals as { rows: any[] }).rows]) {
    if (r.status === 'void') continue;
    held.add(`${r.kind === 'note' || r.kind === 'safe' ? r.kind : 'founding'}:${String(r.holder?.name ?? '').trim().toLowerCase()}`);
  }
  const rows: Record<string, unknown>[] = [];
  for (const f of inputs.founders || []) {
    const name = String(f?.name ?? '').trim();
    if (!name || held.has(`founding:${name.toLowerCase()}`)) continue;
    const holderId = Number((f as any).holder_id);
    rows.push({
      kind: 'founding', ...(Number.isInteger(holderId) && holderId > 0 ? { holder_id: holderId } : { holder_name: name }),
      shares: Math.round(Number(f.shares)), source: 'typed', note: `From the model "${MODEL_SCENARIO_NAME}".`,
    });
  }
  for (const s of inputs.safes || []) {
    const name = String(s?.name ?? '').trim();
    const kind = s.instrument === 'note' ? 'note' : 'safe';
    if (!name || held.has(`${kind}:${name.toLowerCase()}`)) continue;
    rows.push({
      kind, holder_name: name, amount_cents: Math.round(Number(s.amount) * 100), source: 'typed',
      ...(Number(s.cap) > 0 ? { cap_cents: Math.round(Number(s.cap) * 100) } : {}),
      ...(Number(s.discount) > 0 ? { discount_bps: Math.round(Number(s.discount) * 10000) } : {}),
      // The model's default is a pre-money SAFE (services/captable.ts); its basis is stated, not guessed.
      basis: s.basis === 'post_money' ? 'post_money' : 'pre_money',
      ...(kind === 'note' && Number(s.interest_rate) > 0 ? { interest_bps: Math.round(Number(s.interest_rate) * 10000) } : {}),
      ...(s.issue_date ? { issued_on: s.issue_date } : {}),
      note: `From the model "${MODEL_SCENARIO_NAME}".`,
    });
  }
  const pool = Number(inputs.option_pool_pct || 0);
  return {
    available: true, reason: null, rows,
    // A pool is a class with a size on the record (D1017), not an issuance, so the model's percentage is not offered.
    pool_note: pool > 0 ? `The model's ${pool}% option pool is a class on the record: create it with its size.` : null,
  };
}

/** A database before migration 573 has no record: it reads as nothing recorded, never as a failure. */
function isNoRecordTable(e: unknown) {
  return /no such table: (main\.)?cap_table_(issuances|share_classes|currency)/i.test(String((e as Error)?.message ?? e));
}

export type CapTableRead =
  | {
    source: 'record'; modelled: false; currency: string;
    /** Today: each holder's shares by type, and the unallocated pool. */
    today: SimulateResult; start: Extract<Start, { available: true }>;
    /** The canonical model, still the source of any planned round (Modelled). */
    model: { uid: string; inputs: Inputs | null; result: SimulateResult | null } | null;
  }
  | {
    source: 'model'; modelled: true;
    model: { uid: string; inputs: Inputs | null; result: SimulateResult | null };
    /** Why the record was not used. */
    record_reason: string;
  }
  | { source: 'none'; modelled: false; record_reason: string };

/**
 * The one cap table reader for the deck, Build, the Raise card and Mercury.
 * Today comes from the record whenever the record holds shares; otherwise
 * the saved model is read, marked `modelled`. A failed read throws.
 */
export async function readCapTable(env: Env, projectId: number): Promise<CapTableRead> {
  let start: Start;
  try {
    start = startFromRecord(await readRecord(env, projectId));
  } catch (e) {
    if (!isNoRecordTable(e)) throw e;
    start = { available: false, reason: 'nothing_recorded', sentence: 'No issuance of shares is on record yet.' };
  }
  const row = await canonicalModel(env, projectId);
  const model = row ? { uid: String(row.uid ?? ''), inputs: parse<Inputs>(row.inputs_json), result: parse<SimulateResult>(row.result_json) } : null;
  if (start.available) {
    const today = simulate(inputsFrom(start));
    if (!('errors' in today && today.errors)) {
      return { source: 'record', modelled: false, currency: start.currency, today: today as SimulateResult, start, model };
    }
  }
  const reason = start.available ? 'record_unavailable' : start.reason;
  if (model) return { source: 'model', modelled: true, model, record_reason: reason };
  return { source: 'none', modelled: false, record_reason: reason };
}
