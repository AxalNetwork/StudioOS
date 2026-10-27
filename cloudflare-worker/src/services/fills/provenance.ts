/**
 * What a filled value is, after it is filled.
 *
 * A proposal is a suggestion and stops being interesting the moment it is
 * decided. This writes the other half: one row per ACCEPTED fill, saying which
 * value in which row of which table a model put there, what it said before a
 * person edited it, and what it was drawn from.
 *
 * WHY THIS EXISTS AT ALL, in the words the product already uses. `SpinoutLabMarketPage`
 * carries a comment its author wrote deliberately:
 *
 *     Design says "AI-assisted estimates" — these figures are
 *     founder-entered/derived, not AI output, so the copy drops that claim
 *     rather than lie about provenance.
 *
 * and on screen, "Nothing on this page is auto-invented — empty means not
 * researched yet", with each card stamped "Founder research" or "Founder model".
 * Three true statements. The moment a model can write to `projects.tam` all three
 * become false, because `tam` is a bare `REAL` and nothing beside it records who
 * produced the number.
 *
 * So the choice is not between recording provenance and not bothering. It is
 * between recording it and making the product lie. This table is what lets the
 * card say "Founder research" when they derived it and "Eadwyn · sourced" when
 * Eadwyn did — per figure, from a row rather than from a guess.
 *
 * ONE WRITE PER ACCEPT, AND IT IS NOT OPTIONAL. `recordFill` is called on the
 * accept path immediately after the value is written, and a failure to record is
 * NOT swallowed: a value written with no provenance row is exactly the state this
 * module exists to prevent, and the accept route reverts rather than leave one.
 */
import type { Env } from '../../types';
import type { Citation, FillClass, FillTarget } from './types';
import { bindingKey } from '../../util/schemaBootstrap';
import { neverFillMessage, neverFillReason } from './neverFill';

export interface RecordFillInput {
  target: FillTarget;
  proposalId: number | null;
  fillClass: FillClass;
  /** What Eadwyn proposed, as a person reads it. */
  proposedValue: string;
  /** What was actually written — the same string unless the founder edited it. */
  writtenValue: string;
  citation?: Citation | null;
  model?: string | null;
  task?: string | null;
  decidedBy?: number | null;
  /** D777 part 2: the target row as text, where `rowId` cannot name it (the proposal's `target_ref`). */
  targetRowRef?: string | null;
  /** D777 part 2: the `ai_usage_logs` row of the run that produced the value. */
  usageLogId?: number | null;
  /** D777 part 3 (migration 518): the `ai_rail_proposals` row the member kept. */
  aiProposalId?: number | null;
}

/**
 * Create `fill_provenance` if this database has not run migration 246.
 *
 * The same lazy ensure the rest of this worker uses, for the same reason: the
 * dev SQLite file is not kept in sync with D1's migrations, so a route that
 * assumes the table exists is a 500 on a developer's first request. The DDL is a
 * copy of 246's; `fill_provenance_store.test.ts` builds its fixture from THE
 * MIGRATION, so if the two ever disagree the test fails rather than the product.
 */
const READY = new WeakMap<object, boolean>();
/**
 * D1325 (#3486, migration 643): the provenance source columns, each with its
 * literal DDL. THE NAMES ARE THE CONTRACT PIPE-BUILD (#2426) and PIPE-RAISE
 * (#2430) write. Literal statements, not a template, so nothing is spliced
 * into the SQL.
 */
const SOURCE_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  source_kind: 'ALTER TABLE fill_provenance ADD COLUMN source_kind TEXT',
  source_ref: 'ALTER TABLE fill_provenance ADD COLUMN source_ref TEXT',
  source_label: 'ALTER TABLE fill_provenance ADD COLUMN source_label TEXT',
  source_as_of: 'ALTER TABLE fill_provenance ADD COLUMN source_as_of TEXT',
  prior_value: 'ALTER TABLE fill_provenance ADD COLUMN prior_value TEXT',
  undone_at: 'ALTER TABLE fill_provenance ADD COLUMN undone_at TEXT',
  undone_by: 'ALTER TABLE fill_provenance ADD COLUMN undone_by INTEGER',
});
export const FILL_SOURCE_COLUMNS: readonly string[] = Object.freeze(Object.keys(SOURCE_COLUMNS));
/** #2431's three on `ai_rail_proposals`, which migration 581 (D1065) added. */
const RAIL_SOURCE_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  source_kind: 'ALTER TABLE ai_rail_proposals ADD COLUMN source_kind TEXT',
  source_ref: 'ALTER TABLE ai_rail_proposals ADD COLUMN source_ref TEXT',
  source_label: 'ALTER TABLE ai_rail_proposals ADD COLUMN source_label TEXT',
});
export const RAIL_PROPOSAL_SOURCE_COLUMNS: readonly string[] = Object.freeze(Object.keys(RAIL_SOURCE_COLUMNS));
export async function ensureFillProvenanceSchema(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS fill_provenance ('
      + 'id INTEGER PRIMARY KEY AUTOINCREMENT, '
      + 'target_table TEXT NOT NULL, '
      + 'target_row_id INTEGER NOT NULL, '
      + 'target_column TEXT NOT NULL, '
      + 'proposal_id INTEGER REFERENCES validate_proposals(id) ON DELETE SET NULL, '
      + 'fill_class TEXT NOT NULL, '
      + 'proposed_value TEXT, '
      + 'written_value TEXT, '
      + 'edited INTEGER NOT NULL DEFAULT 0, '
      + 'citation_json TEXT, '
      + 'model TEXT, '
      + 'task TEXT, '
      + 'decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL, '
      + "created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_fill_provenance_target '
      + 'ON fill_provenance (target_table, target_row_id, target_column)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_fill_provenance_proposal ON fill_provenance (proposal_id)',
    );
    // Migration 503's columns, on a table made before it (D235: 503 declares them).
    const cols = await env.DB.prepare('PRAGMA table_info(fill_provenance)').all<{ name: string }>();
    const have = new Set((cols.results ?? []).map((c) => c.name));
    if (!have.has('target_row_ref')) await env.DB.exec('ALTER TABLE fill_provenance ADD COLUMN target_row_ref TEXT');
    if (!have.has('ai_usage_log_id')) await env.DB.exec('ALTER TABLE fill_provenance ADD COLUMN ai_usage_log_id INTEGER');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_fill_provenance_usage ON fill_provenance (ai_usage_log_id)');
    // Migration 518's column (D777 part 3), the same way.
    if (!have.has('ai_proposal_id')) await env.DB.exec('ALTER TABLE fill_provenance ADD COLUMN ai_proposal_id INTEGER');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_fill_provenance_rail_proposal ON fill_provenance (ai_proposal_id)');
    // Migration 643's columns (D1325): where the value came from, and what it replaced.
    for (const [name, ddl] of Object.entries(SOURCE_COLUMNS)) {
      if (!have.has(name)) await env.DB.exec(ddl);
    }
    READY.set(bindingKey(env), true);
  } catch (e) {
    console.error('[fills] ensureFillProvenanceSchema:', (e as Error).message);
  }
}

/**
 * #2431's source columns on `ai_rail_proposals` (migration 581, D1065), on a
 * table made before it (D235). A database with no `ai_rail_proposals` at all is left alone: its
 * own migration (506) creates it.
 */
const RAIL_READY = new WeakMap<object, boolean>();
export async function ensureRailProposalSourceColumns(env: Env): Promise<void> {
  if (RAIL_READY.get(bindingKey(env))) return;
  try {
    const cols = await env.DB.prepare('PRAGMA table_info(ai_rail_proposals)').all<{ name: string }>();
    const have = new Set((cols.results ?? []).map((c) => c.name));
    if (have.size) {
      for (const [name, ddl] of Object.entries(RAIL_SOURCE_COLUMNS)) {
        if (!have.has(name)) await env.DB.exec(ddl);
      }
    }
    RAIL_READY.set(bindingKey(env), true);
  } catch (e) {
    console.error('[fills] ensureRailProposalSourceColumns:', (e as Error).message);
  }
}

/**
 * Migration 503's `validate_proposals.ai_usage_log_id`, on a table made before
 * it. The propose route calls this before it stores a proposal with its run.
 */
const PROPOSALS_READY = new WeakMap<object, boolean>();
export async function ensureProposalRunColumn(env: Env): Promise<void> {
  if (PROPOSALS_READY.get(bindingKey(env))) return;
  try {
    const cols = await env.DB.prepare('PRAGMA table_info(validate_proposals)').all<{ name: string }>();
    const have = new Set((cols.results ?? []).map((c) => c.name));
    if (have.size && !have.has('ai_usage_log_id')) {
      await env.DB.exec('ALTER TABLE validate_proposals ADD COLUMN ai_usage_log_id INTEGER');
    }
    PROPOSALS_READY.set(bindingKey(env), true);
  } catch (e) {
    console.error('[fills] ensureProposalRunColumn:', (e as Error).message);
  }
}

/**
 * Record one accepted fill. Throws on failure — see the header.
 *
 * `edited` is DERIVED from the two values rather than passed in, because a caller
 * that has to remember to set it is a caller that will eventually forget, and the
 * one thing this row must never do is claim a value is untouched when it is not.
 * Compared after trimming: trailing whitespace a founder never typed is not an
 * edit, and calling it one would make every accept look corrected.
 */
export async function recordFill(env: Env, input: RecordFillInput): Promise<number> {
  // EVERY FILL PATH ENDS HERE, so the never-fill registry (D777) is enforced here
  // as well as at propose and accept: a path added later that forgets those two
  // still cannot file Eadwyn as the author of a signature or a payment amount.
  // The accept path reverts on the throw; `recordCompositionFills` skips the row
  // and keeps the member's own save.
  const field = `${input.target.table}.${input.target.column}`;
  if (neverFillReason(field)) throw new Error(neverFillMessage(field));
  await ensureFillProvenanceSchema(env);
  const proposed = String(input.proposedValue ?? '');
  const written = String(input.writtenValue ?? '');
  const edited = proposed.trim() !== written.trim() ? 1 : 0;
  const r = await env.DB.prepare(
    `INSERT INTO fill_provenance
       (target_table, target_row_id, target_column, proposal_id, fill_class,
        proposed_value, written_value, edited, citation_json, model, task, decided_by,
        target_row_ref, ai_usage_log_id, ai_proposal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.target.table,
    input.target.rowId,
    input.target.column,
    input.proposalId ?? null,
    input.fillClass,
    proposed,
    written,
    edited,
    input.citation ? JSON.stringify(input.citation) : null,
    input.model ?? null,
    input.task ?? null,
    input.decidedBy ?? null,
    input.targetRowRef ? String(input.targetRowRef).slice(0, 300) : null,
    Number.isSafeInteger(input.usageLogId) && Number(input.usageLogId) > 0 ? input.usageLogId : null,
    Number.isSafeInteger(input.aiProposalId) && Number(input.aiProposalId) > 0 ? input.aiProposalId : null,
  ).run();
  return Number(r.meta?.last_row_id) || 0;
}

/**
 * Record a whole form's worth of `composition` fills, in one call.
 *
 * WHY THIS EXISTS SEPARATELY FROM `recordFill`. Validate's fills are decided one
 * at a time: a proposal appears, a founder accepts it, one row is written. Brand
 * copy is not shaped like that and should not be forced into that shape — the
 * editor's autofill already works correctly, drafting into LOCAL state that the
 * founder edits freely and commits with Save. Its only defect was that
 * `ai_generated: true` came back from the route and was thrown away at the point
 * of use, so a published headline Eadwyn wrote was indistinguishable from one the
 * founder typed. There is nothing to rebuild here; there is a fact to keep.
 *
 * SO THE PROPOSALS ARRIVE AT SAVE TIME, and both values are kept per the
 * product's decision: what Eadwyn proposed, what the founder actually saved, and
 * `edited` derived from comparing them. A founder who took a drafted line and
 * rewrote half of it has produced something that is neither the model's work nor
 * unaided, and being able to say which is the whole point of the table.
 *
 * COLUMNS ARE CHECKED AGAINST WHAT THE CALLER ACTUALLY WROTE, not taken on the
 * client's word. A proposal naming a column absent from `written` is dropped: the
 * client sends the columns it believes it filled, and a stale or wrong name would
 * otherwise file provenance against a value nobody set.
 */
export async function recordCompositionFills(env: Env, input: {
  table: string;
  rowId: number;
  /** Column → what Eadwyn proposed for it. */
  proposals: Record<string, unknown>;
  /** Column → what was actually written. The authority on which columns exist. */
  written: Record<string, unknown>;
  model?: string | null;
  task?: string | null;
  decidedBy?: number | null;
}): Promise<number> {
  const { proposals, written } = input;
  if (!proposals || typeof proposals !== 'object') return 0;
  let count = 0;
  for (const [column, proposed] of Object.entries(proposals)) {
    const proposedText = String(proposed ?? '').trim();
    const writtenText = String(written[column] ?? '').trim();
    // ONE GATE, THREE CASES, and they collapse into each other by construction:
    // a proposal with nothing in it, a field the founder cleared before saving,
    // and a column the page does not have at all — the last because an absent key
    // reads as `undefined` and then as the empty string. An earlier version also
    // tested `hasOwnProperty(written, column)` above this line, which sounds like
    // a different check and cannot be: a column absent from `written` can never
    // have a non-empty value, so no input distinguishes the two and removing the
    // guard changed nothing a test could see. Dead code that reads as a safeguard
    // is worse than no safeguard, because the next reader trusts it.
    //
    // All three must skip for the same reason: a row saying "Eadwyn proposed X"
    // beside a field holding nothing would put provenance behind an empty value,
    // which `filledColumns` would then have to special-case.
    if (!proposedText || !writtenText) continue;
    try {
      await recordFill(env, {
        target: { table: input.table, rowId: input.rowId, column },
        proposalId: null,
        fillClass: 'composition',
        proposedValue: proposedText,
        writtenValue: writtenText,
        citation: null,
        model: input.model ?? null,
        task: input.task ?? null,
        decidedBy: input.decidedBy ?? null,
      });
      count += 1;
    } catch (e) {
      // ONE FAILED ROW DOES NOT FAIL THE SAVE, and this is the one place in this
      // module where that is right. The accept path reverts because a value with
      // no provenance is the state it exists to prevent; here the value is the
      // founder's own copy on their own page, saved by an explicit click, and
      // refusing the save over a missing audit row would be the worse outcome.
      console.error('[fills] recordCompositionFills:', (e as Error).message);
    }
  }
  return count;
}

export interface FilledValue {
  target_column: string;
  fill_class: FillClass;
  proposed_value: string | null;
  written_value: string | null;
  edited: boolean;
  citation: Citation | null;
  model: string | null;
  created_at: string;
  /**
   * D777 part 2: the run that produced the value — its rail page and option and
   * what it cost (D762). `null` when the fill names no run, or its row cannot be
   * read: "Not recorded", never a zero cost.
   */
  run: FillRun | null;
  /**
   * D777 part 3 (migration 518): the `ai_rail_proposals` row the member kept,
   * when the value came from a rail placement. `null` for any other fill.
   */
  ai_proposal_id: number | null;
}

export interface FillRun {
  usage_log_id: number;
  rail_page: string | null;
  rail_option: string | null;
  /** What the member was charged, in micro-USD; null while unsettled or before migration 493. */
  charged_microusd: number | null;
  est_cost_usd: number | null;
}

/** The runs behind some fills, by usage row id. Best-effort: an unreadable log reads as no run. */
async function runsByLogId(env: Env, ids: number[]): Promise<Map<number, FillRun>> {
  const out = new Map<number, FillRun>();
  if (!ids.length) return out;
  try {
    const r = await env.DB.prepare(
      `SELECT id, rail_page, rail_option, charged_microusd, est_cost_usd
         FROM ai_usage_logs WHERE id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify([...new Set(ids)])).all<{
      id: number; rail_page: string | null; rail_option: string | null;
      charged_microusd: number | null; est_cost_usd: number | null;
    }>();
    for (const row of r.results || []) {
      out.set(Number(row.id), {
        usage_log_id: Number(row.id),
        rail_page: row.rail_page ?? null,
        rail_option: row.rail_option ?? null,
        charged_microusd: row.charged_microusd ?? null,
        est_cost_usd: row.est_cost_usd ?? null,
      });
    }
  } catch (e) {
    console.error('[fills] runsByLogId:', (e as Error).message);
  }
  return out;
}

/**
 * What Eadwyn filled on one row — the read a page makes to label its own values.
 *
 * NEWEST PER COLUMN, not every row ever written. A founder who accepts a fill,
 * edits it by hand and then accepts another leaves three states behind, and the
 * only one that describes what is on screen is the last. Returning all of them
 * would make a page choose, and a page choosing is how two pages come to
 * disagree about the same value.
 *
 * A COLUMN A PERSON HAS SINCE OVERWRITTEN STILL APPEARS HERE, and that is the
 * known limit of this design rather than a bug to fix later. Nothing tells this
 * table when a form writes over a filled value by hand, so a caller that needs
 * certainty must compare `written_value` against what the row actually holds.
 * `filledColumns` below does exactly that, and it is the function pages should
 * use for a label.
 */
export async function fillsForRow(
  env: Env, table: string, rowId: number,
): Promise<FilledValue[]> {
  await ensureFillProvenanceSchema(env);
  const r = await env.DB.prepare(
    `SELECT target_column, fill_class, proposed_value, written_value, edited,
            citation_json, model, created_at, ai_usage_log_id, ai_proposal_id
       FROM fill_provenance
      WHERE target_table = ? AND target_row_id = ?
      ORDER BY id DESC`,
  ).bind(table, rowId).all<{
    target_column: string; fill_class: string; proposed_value: string | null;
    written_value: string | null; edited: number; citation_json: string | null;
    model: string | null; created_at: string; ai_usage_log_id: number | null; ai_proposal_id: number | null;
  }>();
  const seen = new Set<string>();
  const newest = (r.results || []).filter((row) => {
    if (seen.has(row.target_column)) return false;
    seen.add(row.target_column);
    return true;
  });
  const runs = await runsByLogId(env, newest.map((row) => Number(row.ai_usage_log_id)).filter((n) => Number.isSafeInteger(n) && n > 0));
  const out: FilledValue[] = [];
  for (const row of newest) {
    let citation: Citation | null = null;
    try { citation = row.citation_json ? JSON.parse(row.citation_json) as Citation : null; } catch { citation = null; }
    out.push({
      target_column: row.target_column,
      fill_class: row.fill_class as FillClass,
      proposed_value: row.proposed_value,
      written_value: row.written_value,
      edited: row.edited === 1,
      citation,
      model: row.model,
      created_at: row.created_at,
      run: runs.get(Number(row.ai_usage_log_id)) ?? null,
      ai_proposal_id: row.ai_proposal_id ?? null,
    });
  }
  return out;
}

/**
 * Which columns on this row STILL hold the value Eadwyn wrote.
 *
 * This is the function a page should label from, and the comparison is the whole
 * of it: a provenance row says what was written then, and `current` says what is
 * there now. A founder who typed over a filled figure by hand owns it, and a
 * card still reading "Eadwyn · sourced" over their number would be the same lie
 * pointed the other way.
 *
 * Compared as trimmed strings so `42000` and `42000.0` are not treated as
 * different answers by a numeric column's own formatting.
 */
export function filledColumns(
  fills: readonly FilledValue[], current: Record<string, unknown>,
): Map<string, FilledValue> {
  const out = new Map<string, FilledValue>();
  for (const f of fills) {
    const now = current[f.target_column];
    if (now == null) continue;
    const a = String(f.written_value ?? '').trim();
    const b = String(now).trim();
    if (a === b || (a !== '' && b !== '' && Number.isFinite(Number(a)) && Number(a) === Number(b))) {
      out.set(f.target_column, f);
    }
  }
  return out;
}

/**
 * WHICH CLAIMS EADWYN SUPPLIED, and only while they still say what it wrote
 * (D424). Read by the founder Validate board (`routes/founder_validate.ts`)
 * and by the Validate cycle's Experiments records (`services/cycleValidate.ts`,
 * #1523): one reader, so the two can never mark the same claim differently.
 *
 * The accept path has written a `fill_provenance` row for every hypothesis a
 * founder took from the band since migration 246, and nothing ever read them
 * back for this board: the only reader was the market page's
 * (`projects.ts`'s `/market-assumptions`). So a claim Eadwyn drafted and one a
 * founder typed looked identical on the desk, the canvas's provenance mark
 * notwithstanding.
 *
 * THE MARK FOLLOWS THE TEXT, NOT THE ROW. A provenance row says what was
 * written then; a founder who has since rewritten the claim by hand owns it,
 * and a card still reading "Eadwyn" over their sentence would be the same lie
 * pointed the other way. So the newest row per claim counts only when its
 * `written_value` is the claim's text now — `filledColumns`' comparison, done
 * over one query for the whole board rather than one `fillsForRow` per card.
 *
 * `edited` is the founder's correction before accepting, which the accept
 * route derives by comparing the two values; the mark says so.
 *
 * Throws on a failed read: the caller reports `fills_recorded: false` rather
 * than an unmarked board, which would claim every claim was typed by hand.
 */
export async function claimFills(env: Env, projectId: number, items: any[]): Promise<Map<number, {
  edited: boolean; model: string | null; fill_class: string;
  /** D777 part 4: the run that wrote the claim, as `fillsForRow` answers it; null is "Not recorded". */
  run: FillRun | null;
  ai_proposal_id: number | null;
}>> {
  await ensureFillProvenanceSchema(env);
  const rows = await env.DB.prepare(
    `SELECT fp.target_row_id, fp.written_value, fp.edited, fp.model, fp.fill_class, fp.ai_usage_log_id, fp.ai_proposal_id
       FROM fill_provenance fp
       JOIN hypotheses h ON h.id = fp.target_row_id
      WHERE fp.target_table = 'hypotheses' AND fp.target_column = 'claim'
        AND h.project_id = ?
      ORDER BY fp.id DESC`,
  ).bind(projectId).all<{
    target_row_id: number; written_value: string | null; edited: number;
    model: string | null; fill_class: string; ai_usage_log_id: number | null; ai_proposal_id: number | null;
  }>();
  const claimNow = new Map<number, string>(items.map((h) => [Number(h.id), String(h.claim ?? '').trim()]));
  const seen = new Set<number>();
  const kept: typeof rows.results = [];
  for (const r of rows.results || []) {
    const id = Number(r.target_row_id);
    if (seen.has(id)) continue;
    seen.add(id);
    const now = claimNow.get(id);
    if (now && String(r.written_value ?? '').trim() === now) kept.push(r);
  }
  const runs = await runsByLogId(env, kept.map((r) => Number(r.ai_usage_log_id)).filter((id) => id > 0));
  const out = new Map<number, { edited: boolean; model: string | null; fill_class: string; run: FillRun | null; ai_proposal_id: number | null }>();
  for (const r of kept) {
    out.set(Number(r.target_row_id), {
      edited: r.edited === 1, model: r.model ?? null, fill_class: r.fill_class,
      run: runs.get(Number(r.ai_usage_log_id)) ?? null,
      ai_proposal_id: r.ai_proposal_id ?? null,
    });
  }
  return out;
}

/** D1325: where a mark's value came from. A row from before migration 643 names no source and is Eadwyn's. */
export interface FillMark {
  fill_class: string;
  source_kind: 'eadwyn' | 'connector' | 'module';
  source_ref: string | null;
  /** The Source word: `connector`, `document`, `recorded`, `signed` or `typed`; null for an Eadwyn value. */
  source_label: string | null;
  source_as_of: string | null;
  edited: boolean;
  /** The run behind an Eadwyn value, as `fillsForRow` answers it; null is "Not recorded". */
  run: FillRun | null;
  ai_proposal_id: number | null;
  /** The provenance row, which part 3's undo names. */
  provenance_id: number;
}

const SOURCE_KINDS = new Set(['eadwyn', 'connector', 'module']);

/**
 * D1325 (#3486): the marks on some rows of one table — which columns STILL hold
 * the value a fill wrote, and where it came from. `claimFills` (one table, one
 * column) and the market read (`fillsForRow` plus `filledColumns`, one row)
 * are its two special cases; part 4 (#3488) moves their pages onto it.
 *
 *   marksForRows(env, table, ids, current)  →  Map<row id, Map<column, FillMark>>
 *
 * `current` is each row's values now, by id. The rule is `filledColumns'`: the
 * newest provenance row per column counts only while the row still holds what
 * it wrote, so a value typed over by hand reads as the member's. A row undone
 * (`undone_at`, part 3) is never a mark. The model is not part of a mark: no
 * product copy names one.
 *
 * Throws on a failed read, so the caller answers "Unreadable" rather than an
 * unmarked row, which would claim every value was typed by hand.
 */
export async function marksForRows(
  env: Env, table: string, ids: readonly number[], current: ReadonlyMap<number, Record<string, unknown>>,
): Promise<Map<number, Map<string, FillMark>>> {
  const out = new Map<number, Map<string, FillMark>>();
  const want = [...new Set(ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!table || !want.length) return out;
  await ensureFillProvenanceSchema(env);
  const r = await env.DB.prepare(
    `SELECT id, target_row_id, target_column, fill_class, written_value, edited, ai_usage_log_id, ai_proposal_id,
            source_kind, source_ref, source_label, source_as_of
       FROM fill_provenance
      WHERE target_table = ? AND target_row_id IN (SELECT value FROM json_each(?)) AND undone_at IS NULL
      ORDER BY id DESC`,
  ).bind(table, JSON.stringify(want)).all<{
    id: number; target_row_id: number; target_column: string; fill_class: string; written_value: string | null; edited: number;
    ai_usage_log_id: number | null; ai_proposal_id: number | null;
    source_kind: string | null; source_ref: string | null; source_label: string | null; source_as_of: string | null;
  }>();
  const seen = new Set<string>();
  const kept: NonNullable<typeof r.results> = [];
  for (const row of r.results || []) {
    const key = `${row.target_row_id}:${row.target_column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const now = current.get(Number(row.target_row_id))?.[row.target_column];
    if (now == null) continue;
    const a = String(row.written_value ?? '').trim();
    const b = String(now).trim();
    if (a === b || (a !== '' && b !== '' && Number.isFinite(Number(a)) && Number(a) === Number(b))) kept.push(row);
  }
  const runs = await runsByLogId(env, kept.map((row) => Number(row.ai_usage_log_id)).filter((n) => Number.isSafeInteger(n) && n > 0));
  for (const row of kept) {
    const kind = SOURCE_KINDS.has(String(row.source_kind)) ? row.source_kind as FillMark['source_kind'] : 'eadwyn';
    const id = Number(row.target_row_id);
    if (!out.has(id)) out.set(id, new Map());
    out.get(id)!.set(row.target_column, {
      fill_class: row.fill_class,
      source_kind: kind,
      source_ref: row.source_ref ?? null,
      source_label: kind === 'eadwyn' ? null : row.source_label ?? null,
      source_as_of: row.source_as_of ?? null,
      edited: row.edited === 1,
      run: runs.get(Number(row.ai_usage_log_id)) ?? null,
      ai_proposal_id: row.ai_proposal_id ?? null,
      provenance_id: Number(row.id),
    });
  }
  return out;
}
