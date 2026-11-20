/**
 * D6011 (#6011) — where each market figure came from, when, and what it was before.
 *
 * `projects.tam/.sam/.som` are bare numbers. `market_figures` (migration
 * 202611150130) is the append-only record of each change: one row per change,
 * and the latest row per figure is the current one. The project columns stay
 * the copy every other surface reads; `recordMarketFigures` is called by the
 * writer that changes them, after it has, so the two stay in step.
 *
 * A ROW COUNTS ONLY WHILE IT AGREES WITH THE PROJECT. Some writers of
 * `projects.tam/.sam/.som` write no row yet (intake, project create, the
 * Eadwyn SOM answer: listed in D6011). When one of them changes a figure the
 * latest row describes a value that is no longer there, so `currentMarketFigure`
 * reads the project's own value and says no source is recorded, rather than
 * pin the old source on a new number.
 *
 * THE SOURCE IS COPIED, NEVER TAKEN FROM THE CLIENT. A save names one of the
 * venture's own `market_sources` rows by id; its title and link are copied
 * from that row here, so a client cannot write a source text of its own and
 * the history still names the source after the row is removed.
 *
 * D7704 (#7704): a market sizing version writes its three rows in its own
 * batch through `marketFigureStatement`, each naming the version
 * (`sizing_version_id`). A figure typed through `PUT /api/projects/:id`, and
 * every row saved before formula version 2, names none.
 */
import type { Env } from '../types';

export const MARKET_FIGURES = ['tam', 'sam', 'som'] as const;
export type MarketFigureKey = (typeof MARKET_FIGURES)[number];
export const MARKET_METHODS = ['typed', 'top_down', 'bottom_up', 'document'] as const;
export type MarketMethod = (typeof MARKET_METHODS)[number];

export type MarketFigureRow = {
  id: number; project_id: number; figure: MarketFigureKey; value: number | null; currency: string;
  method: MarketMethod; source_title: string | null; source_url: string | null;
  market_source_id: number | null; set_by: number | null; set_at: string;
  sizing_version_id?: number | null;
};

/**
 * What a save says about where its figures came from. `stated` is false when
 * the save said nothing (a page that echoes the whole project back): then an
 * unchanged value is no change, and the current source stays.
 */
export type MarketProvenance = { method: MarketMethod; source: { id: number; title: string; url: string | null } | null; stated: boolean };

/** The two refusals a provenance can earn, each our own sentence. */
export const MARKET_PROVENANCE_REFUSALS = {
  invalid_market_source: 'That source is not one of this venture’s sources.',
  invalid_market_method: 'The sizing method must be typed, top-down, bottom-up or from a document.',
} as const;
export type MarketProvenanceCode = keyof typeof MARKET_PROVENANCE_REFUSALS;

export class MarketProvenanceError extends Error {
  code: MarketProvenanceCode;
  constructor(code: MarketProvenanceCode) { super(MARKET_PROVENANCE_REFUSALS[code]); this.code = code; }
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The save's `market_figure_source` → a checked provenance. Absent is a typed
 * figure with no source. A named source must be one of this venture's rows.
 */
export async function resolveMarketProvenance(env: Env, projectId: number, raw: unknown): Promise<MarketProvenance> {
  if (raw == null) return { method: 'typed', source: null, stated: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MarketProvenanceError('invalid_market_source');
  }
  const r = raw as { method?: unknown; market_source_id?: unknown };
  const method = r.method == null ? 'typed' : String(r.method);
  if (!(MARKET_METHODS as readonly string[]).includes(method)) {
    throw new MarketProvenanceError('invalid_market_method');
  }
  if (r.market_source_id == null || r.market_source_id === '') return { method: method as MarketMethod, source: null, stated: true };
  const id = Number(r.market_source_id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new MarketProvenanceError('invalid_market_source');
  }
  const row = await env.DB.prepare('SELECT id, title, url FROM market_sources WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<{ id: number; title: string; url: string | null }>();
  if (!row) throw new MarketProvenanceError('invalid_market_source');
  return { method: method as MarketMethod, source: { id: Number(row.id), title: String(row.title), url: row.url ?? null }, stated: true };
}

/** The latest row per figure, or null where none was ever written. A failed read throws. */
export async function latestMarketFigures(env: Env, projectId: number): Promise<Record<MarketFigureKey, MarketFigureRow | null>> {
  const rows = await env.DB.prepare(
    `SELECT m.* FROM market_figures m
      WHERE m.project_id = ?
        AND m.id = (SELECT MAX(x.id) FROM market_figures x WHERE x.project_id = m.project_id AND x.figure = m.figure)`,
  ).bind(projectId).all<MarketFigureRow>();
  const out: Record<MarketFigureKey, MarketFigureRow | null> = { tam: null, sam: null, som: null };
  for (const r of rows.results || []) if ((MARKET_FIGURES as readonly string[]).includes(r.figure)) out[r.figure] = r;
  return out;
}

/** The latest row, only while it still describes the project's own value. */
export function currentMarketFigure(projectValue: unknown, latest: MarketFigureRow | null): MarketFigureRow | null {
  if (!latest) return null;
  return num(latest.value) === num(projectValue) ? latest : null;
}

/**
 * The project's three values and, per figure, the row that describes it (null
 * when none does). The one read `loadMarket` and the sizing page both use.
 */
export async function currentMarketFigures(env: Env, projectId: number): Promise<{
  values: Record<MarketFigureKey, number | null>; current: Record<MarketFigureKey, MarketFigureRow | null>;
}> {
  const p = await env.DB.prepare('SELECT tam, sam, som FROM projects WHERE id = ?')
    .bind(projectId).first<{ tam: unknown; sam: unknown; som: unknown }>();
  const latest = await latestMarketFigures(env, projectId);
  const values = { tam: num(p?.tam), sam: num(p?.sam), som: num(p?.som) };
  return {
    values,
    current: {
      tam: currentMarketFigure(values.tam, latest.tam),
      sam: currentMarketFigure(values.sam, latest.sam),
      som: currentMarketFigure(values.som, latest.som),
    },
  };
}

/**
 * Append one row for each figure the save carries whose value differs from
 * the current row's (or, with no current row, from the project's value before
 * the save), or whose stated method or source differs from the current row's. Called AFTER `projects` is written, with
 * the values it held before. Returns the figures it recorded.
 */
export async function recordMarketFigures(
  env: Env,
  input: {
    projectId: number;
    before: Partial<Record<MarketFigureKey, unknown>>;
    after: Partial<Record<MarketFigureKey, unknown>>;
    provenance: MarketProvenance;
    setBy: number | null;
  },
): Promise<MarketFigureKey[]> {
  const keys = MARKET_FIGURES.filter((k) => input.after[k] !== undefined);
  if (!keys.length) return [];
  const latest = await latestMarketFigures(env, input.projectId);
  const { method, source, stated } = input.provenance;
  const changed = keys.filter((k) => {
    const value = num(input.after[k]);
    const cur = currentMarketFigure(input.before[k], latest[k]);
    if (value !== num(cur ? cur.value : input.before[k])) return true;
    // Same value: a change only when the save named a different method or source.
    if (!stated) return false;
    if (!cur) return method !== 'typed' || source != null;
    return method !== cur.method || (source?.id ?? null) !== (cur.market_source_id ?? null);
  });
  if (!changed.length) return [];
  await env.DB.batch(changed.map((k) => env.DB.prepare(
    `INSERT INTO market_figures (project_id, figure, value, currency, method, source_title, source_url, market_source_id, set_by)
     VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?)`,
  ).bind(input.projectId, k, num(input.after[k]), method, source?.title ?? null, source?.url ?? null, source?.id ?? null, input.setBy)));
  return changed;
}

/**
 * D7704: one `market_figures` row as an unrun statement, for a caller's own
 * `DB.batch`. `sizingVersionUid` names the version written earlier in the same
 * batch; the row takes that version's id. Always written, changed value or
 * not, so all three current rows name one version.
 */
export function marketFigureStatement(env: Env, input: {
  projectId: number; figure: MarketFigureKey; value: number; provenance: MarketProvenance;
  setBy: number | null; sizingVersionUid: string;
}): D1PreparedStatement {
  const { method, source } = input.provenance;
  return env.DB.prepare(
    `INSERT INTO market_figures (project_id, figure, value, currency, method, source_title, source_url, market_source_id, set_by, sizing_version_id)
     VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, (SELECT id FROM market_sizing_versions WHERE uid = ? AND project_id = ?))`,
  ).bind(input.projectId, input.figure, input.value, method, source?.title ?? null, source?.url ?? null, source?.id ?? null,
    input.setBy, input.sizingVersionUid, input.projectId);
}

export type MarketHistoryRow = {
  id: number; figure: MarketFigureKey; value: number | null; currency: string; method: MarketMethod;
  source_title: string | null; source_url: string | null; set_by_name: string | null; set_at: string;
  /** D7704: the sizing version that saved this row, or null (typed, or saved before formula version 2). */
  sizing_version: number | null;
};

/** Every change, newest first, with who made it (a name, never an address). */
export async function marketFigureHistory(env: Env, projectId: number, limit = 60): Promise<MarketHistoryRow[]> {
  const rows = await env.DB.prepare(
    `SELECT m.id, m.figure, m.value, m.currency, m.method, m.source_title, m.source_url, m.set_at, u.name AS set_by_name,
            v.version_number AS sizing_version
       FROM market_figures m LEFT JOIN users u ON u.id = m.set_by
       LEFT JOIN market_sizing_versions v ON v.id = m.sizing_version_id
      WHERE m.project_id = ? ORDER BY m.id DESC LIMIT ?`,
  ).bind(projectId, limit).all<MarketHistoryRow>();
  return (rows.results || []).map((r) => ({
    ...r, value: num(r.value), set_by_name: r.set_by_name ?? null,
    sizing_version: r.sizing_version == null ? null : Number(r.sizing_version),
  }));
}
