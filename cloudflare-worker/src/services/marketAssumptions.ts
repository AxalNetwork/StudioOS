/**
 * The twelve inputs behind a market size, which used to live only in a tab.
 *
 * `SpinoutLabMarketPage` derives TAM from an addressable population × an ACV,
 * takes a SAM percentage and a win rate off it, and saves the three RESULTS to
 * `projects.tam/.sam/.som`. Until migration 247 the inputs went nowhere: close
 * the tab and the reasoning was gone, leaving a conclusion on a page whose claim
 * is that its figures are derived rather than invented. The drawer re-seeded
 * `samPct` and `winRate` by inverting the saved ratios and left the rest blank,
 * so a population of 41,200 firms came back as no population at all.
 *
 * WHY A SERVICE AND NOT JUST TWO ROUTES. Two callers need this, and they must
 * agree: the drawer writes it, and a `sourced` fill writes one field of it with a
 * citation. The registry's rule is that `apply` calls the function the manual form
 * calls — the same rule `insertHypothesis` exists for — so the writer has to be
 * reachable from both, which means neither of them owns it.
 *
 * EVERY FIELD IS A STRING, DELIBERATELY. These are what a founder typed. "41,200
 * firms" parsed into a REAL is 41; parsed and rejected is nothing at all. The page
 * already reads them with `parseFloat`, which stops at the first non-digit and is
 * the behaviour the drawer has always had — storing the text keeps the note the
 * founder attached to their own number instead of quietly editing it.
 *
 * NO FIELD HAS A MARKET-FACT DEFAULT. The page's rule, on screen, is "empty means
 * not researched yet". A default here would make a figure nobody supplied
 * indistinguishable from one somebody did, which is the same failure
 * `fill_provenance` exists to prevent one layer down.
 */
import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';

/**
 * The writable fields, and the column each lands in.
 *
 * The page uses camelCase and the table uses snake_case, and the map is here
 * rather than in either of them so a new field is added once. A key absent from
 * this map is REJECTED by `sanitizeAssumptions` rather than dropped: a typo'd
 * field that is silently ignored looks exactly like a save that worked.
 */
export const ASSUMPTION_COLUMNS: Record<string, string> = {
  category: 'category',
  geography: 'geography',
  targetYear: 'target_year',
  methodology: 'methodology',
  population: 'population',
  acv: 'acv',
  tamOverride: 'tam_override',
  samPct: 'sam_pct',
  winRate: 'win_rate',
  runway: 'runway',
  capacity: 'capacity',
  cagr: 'cagr',
  growthDriver: 'growth_driver',
  maturity: 'maturity',
};

/** `segFilter` is an array, so it is handled apart from the scalar map above. */
export const SEG_FILTER_KEY = 'segFilter';
export const SEG_FILTER_COLUMN = 'seg_filter_json';

/**
 * The closed set of columns an UPDATE here may name.
 *
 * `saveAssumptions` builds its SET clause by joining column names into the query
 * TEXT, where no binding protects them, and `check-sql-prepare.mjs` is right to
 * stop and ask. This Set is the answer: every name that reaches that join is
 * filtered through it first, so the interpolated fragment is provably a member of
 * a list declared in this file from literals. It is checkable at the line rather
 * than by reading `sanitizeAssumptions` and trusting it — which is the difference
 * between a guarantee and a habit.
 */
const WRITABLE_COLUMNS: ReadonlySet<string> = new Set([
  ...Object.values(ASSUMPTION_COLUMNS), SEG_FILTER_COLUMN,
]);

export const ASSUMPTION_KEYS: readonly string[] = [
  ...Object.keys(ASSUMPTION_COLUMNS), SEG_FILTER_KEY,
];

/** One field's worth of typing. Long enough for a number with a note. */
const MAX_FIELD = 200;
/** The drawer offers a handful of segments; this is a bound, not a product rule. */
const MAX_SEGMENTS = 40;

export interface MarketAssumptions {
  category: string | null;
  geography: string | null;
  targetYear: string | null;
  methodology: string | null;
  population: string | null;
  acv: string | null;
  tamOverride: string | null;
  samPct: string | null;
  winRate: string | null;
  runway: string | null;
  capacity: string | null;
  cagr: string | null;
  growthDriver: string | null;
  maturity: string | null;
  segFilter: string[];
  updated_at: string | null;
}

/**
 * Create the table if this database has not run 247.
 *
 * The same lazy ensure the rest of this worker uses, for the reason
 * `CLAUDE.md` gives: the dev SQLite file is not kept in sync with D1's
 * migrations, so a route that assumes the table exists is a 500 on a
 * developer's first request. The DDL is a copy of 247's and
 * `market_assumptions_store.test.ts` builds its fixture FROM THE MIGRATION, so a
 * disagreement between the two fails the test rather than the product.
 */
const READY = new WeakMap<object, boolean>();
export async function ensureMarketAssumptionsSchema(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS project_market_assumptions ('
      + 'id INTEGER PRIMARY KEY AUTOINCREMENT, '
      + 'project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, '
      + 'category TEXT, geography TEXT, target_year TEXT, '
      + "methodology TEXT DEFAULT 'Top-down', "
      + 'population TEXT, acv TEXT, tam_override TEXT, sam_pct TEXT, win_rate TEXT, '
      + 'runway TEXT, capacity TEXT, cagr TEXT, growth_driver TEXT, '
      + "maturity TEXT DEFAULT 'Growing', "
      + 'seg_filter_json TEXT, '
      + 'updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL, '
      + "created_at TEXT NOT NULL DEFAULT (datetime('now')), "
      + "updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    READY.set(bindingKey(env), true);
  } catch (e) {
    console.error('[market] ensureMarketAssumptionsSchema:', (e as Error).message);
  }
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, MAX_FIELD);
  // An empty string is a CLEARED field, and it has to come back as NULL: the
  // page renders '' and null identically, but `filledColumns` compares a
  // provenance row against what the row holds now, and '' would read as a value
  // Eadwyn's number was replaced by rather than as nothing at all.
  return s === '' ? null : s;
};

/**
 * Keep the known fields, reject the unknown ones, and say which.
 *
 * Rejecting rather than dropping, for the same reason
 * `sanitizeSpinoutOverrides` does one file over: a field name the client got
 * wrong is a control that appears to work. The page would show the save
 * succeeding and the value would never come back.
 */
export function sanitizeAssumptions(raw: unknown): {
  patch: Record<string, string | null>;
  segFilter?: string[];
  rejected: string[];
} {
  const patch: Record<string, string | null> = {};
  const rejected: string[] = [];
  let segFilter: string[] | undefined;
  if (!raw || typeof raw !== 'object') return { patch, rejected };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === SEG_FILTER_KEY) {
      if (value == null) { segFilter = []; continue; }
      if (!Array.isArray(value)) { rejected.push(key); continue; }
      segFilter = value.map((v) => String(v).trim().slice(0, MAX_FIELD))
        .filter(Boolean).slice(0, MAX_SEGMENTS);
      continue;
    }
    const column = ASSUMPTION_COLUMNS[key];
    if (!column) { rejected.push(key); continue; }
    patch[column] = str(value);
  }
  return { patch, segFilter, rejected };
}

/** Everything on record for one project, or every field null. */
export async function loadAssumptions(
  env: Env, projectId: number,
): Promise<MarketAssumptions> {
  await ensureMarketAssumptionsSchema(env);
  const row = await env.DB.prepare(
    `SELECT category, geography, target_year, methodology, population, acv,
            tam_override, sam_pct, win_rate, runway, capacity, cagr,
            growth_driver, maturity, seg_filter_json, updated_at
       FROM project_market_assumptions WHERE project_id = ?`,
  ).bind(projectId).first<Record<string, unknown>>();

  let segFilter: string[] = [];
  if (row?.seg_filter_json) {
    try {
      const parsed = JSON.parse(String(row.seg_filter_json));
      if (Array.isArray(parsed)) segFilter = parsed.map((v) => String(v));
    } catch { segFilter = []; }
  }
  const get = (col: string) => (row?.[col] == null ? null : String(row[col]));
  return {
    category: get('category'),
    geography: get('geography'),
    targetYear: get('target_year'),
    methodology: get('methodology'),
    population: get('population'),
    acv: get('acv'),
    tamOverride: get('tam_override'),
    samPct: get('sam_pct'),
    winRate: get('win_rate'),
    runway: get('runway'),
    capacity: get('capacity'),
    cagr: get('cagr'),
    growthDriver: get('growth_driver'),
    maturity: get('maturity'),
    segFilter,
    updated_at: get('updated_at'),
  };
}

/**
 * Write the fields that were sent, leaving the rest alone.
 *
 * A PATCH AND NOT A REPLACE, which is the whole reason this is not one INSERT OR
 * REPLACE. A `sourced` fill writes ONE field — an addressable population, with a
 * citation — and a replace would blank the eleven the founder typed. The drawer
 * sends all of them and gets the same result either way; the fill is the caller
 * that makes the distinction matter.
 *
 * Returns the row as it stands afterwards, so a caller never has to guess what
 * its own write produced.
 */
export async function saveAssumptions(
  env: Env, projectId: number, raw: unknown, userId: number | null,
): Promise<{ assumptions: MarketAssumptions; rejected: string[] }> {
  await ensureMarketAssumptionsSchema(env);
  const { patch, segFilter, rejected } = sanitizeAssumptions(raw);
  if (segFilter !== undefined) patch[SEG_FILTER_COLUMN] = JSON.stringify(segFilter);

  // The row has to exist before it can be patched, and `ON CONFLICT DO NOTHING`
  // makes first-write and every-later-write the same two statements rather than
  // a read-then-branch that two requests can interleave through.
  await env.DB.prepare(
    'INSERT INTO project_market_assumptions (project_id) VALUES (?) ON CONFLICT(project_id) DO NOTHING',
  ).bind(projectId).run();

  // FILTERED THROUGH THE CLOSED SET AT THE POINT OF USE, not upstream. The join
  // below puts these names in the query TEXT where no binding protects them, so
  // the safety has to be visible on the line that does it: `WRITABLE_COLUMNS` is
  // built in this file out of literals, and a name not in it cannot reach the
  // fragment even if `sanitizeAssumptions` is one day changed to let it through.
  // Values stay bound.
  const columns = Object.keys(patch).filter((c) => WRITABLE_COLUMNS.has(c));
  if (columns.length) {
    const sets = columns.map((c) => `${c} = ?`).join(', ');
    await env.DB.prepare(
      `UPDATE project_market_assumptions
          SET ${sets}, updated_by = ?, updated_at = datetime('now')
        WHERE project_id = ?`,
    ).bind(...columns.map((c) => patch[c]), userId ?? null, projectId).run();
  }
  return { assumptions: await loadAssumptions(env, projectId), rejected };
}

/**
 * Write exactly one field. The entry point a `sourced` fill's `apply` uses.
 *
 * It exists so the fill path cannot invent its own UPDATE: same sanitiser, same
 * patch semantics, same rejection of an unknown key. A key this store does not
 * know throws rather than writing nothing, because a fill that appeared to be
 * accepted and changed nothing is the silent failure the accept route's
 * claim-then-revert was built to avoid.
 */
export async function saveOneAssumption(
  env: Env, projectId: number, key: string, value: string, userId: number | null,
): Promise<MarketAssumptions> {
  if (!ASSUMPTION_COLUMNS[key]) {
    throw new Error(`There is no market assumption called ${key}`);
  }
  const { assumptions } = await saveAssumptions(env, projectId, { [key]: value }, userId);
  return assumptions;
}
