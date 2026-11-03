/**
 * Task #16 (DE) — Recommendation engine.
 *
 * Given a project's sector × stage signals, returns the best-fit deck
 * method id (admin-editable mapping in `deck_recommendation_overrides`
 * — falls back to the static map below when no override exists).
 */
import type { Env } from '../../types';
import type { DeckMethodId } from './methods';
import { bindingKey } from '../../util/schemaBootstrap';

type Stage =
  | 'idea' | 'pre_seed' | 'seed' | 'series_a' | 'series_b'
  | 'growth' | 'partnership' | 'sales' | 'unknown';

const STAGE_ALIASES: Record<string, Stage> = {
  idea: 'idea', concept: 'idea', mvp: 'idea',
  pre_seed: 'pre_seed', preseed: 'pre_seed', 'pre-seed': 'pre_seed',
  seed: 'seed',
  series_a: 'series_a', a: 'series_a', 'series-a': 'series_a',
  series_b: 'series_b', b: 'series_b', 'series-b': 'series_b',
  growth: 'growth', 'series_c': 'growth', c: 'growth',
};

function normaliseStage(input: string | null | undefined): Stage {
  if (!input) return 'unknown';
  const k = String(input).trim().toLowerCase().replace(/\s+/g, '_');
  return STAGE_ALIASES[k] || 'unknown';
}

const STAGE_DEFAULTS: Record<Stage, DeckMethodId> = {
  idea: 'minimal_seed',
  pre_seed: 'yc_seed',
  seed: 'sequoia_classic',
  series_a: 'series_a_growth',
  series_b: 'series_b_diligence',
  growth: 'series_b_diligence',
  partnership: 'partnership_bd',
  sales: 'sales_commercial',
  unknown: 'minimal_seed',
};

// Sector overrides — explicit picks beat the stage default.
// D4155 K4 (#4191, owner decision): "deep tech" with a space or a hyphen is deep tech too, as HQ's grid writes it.
const SECTOR_OVERRIDES: Array<{ sectorPattern: RegExp; stage: Stage; method: DeckMethodId }> = [
  { sectorPattern: /(consumer|d2c|brand|fashion)/i, stage: 'seed', method: 'narrative_brand' },
  { sectorPattern: /(consumer|d2c|brand|fashion)/i, stage: 'series_a', method: 'narrative_brand' },
  { sectorPattern: /(saas|enterprise|b2b)/i, stage: 'series_a', method: 'series_a_growth' },
  { sectorPattern: /(deep[\s-]?tech|biotech|hardware|robotics)/i, stage: 'seed', method: 'sequoia_classic' },
  { sectorPattern: /(deep[\s-]?tech|biotech|hardware|robotics)/i, stage: 'series_a', method: 'investor_appendix' },
  { sectorPattern: /(deep[\s-]?tech|biotech|hardware|robotics)/i, stage: 'series_b', method: 'series_b_diligence' },
];

const OV_SCHEMA_READY = new WeakMap<object, boolean>();
async function ensureOverrideSchema(env: Env): Promise<void> {
  if (OV_SCHEMA_READY.get(bindingKey(env))) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS deck_recommendation_overrides (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         sector TEXT NOT NULL,
         stage TEXT NOT NULL,
         method_id TEXT NOT NULL,
         updated_by INTEGER,
         updated_at TEXT NOT NULL DEFAULT (datetime('now')),
         UNIQUE (sector, stage)
       )`,
    ).run();
  } catch (e: any) { console.error('deck_recommendation_overrides:', e?.message); }
  OV_SCHEMA_READY.set(bindingKey(env), true);
}

export type DeckRecommendation = {
  method_id: DeckMethodId;
  sector: string;
  stage: Stage;
  source: 'override' | 'sector' | 'stage_default';
};

export async function recommendMethod(
  env: Env,
  project: { sector?: string | null; stage?: string | null },
): Promise<DeckRecommendation> {
  const sector = String(project.sector || '').trim();
  const stage = normaliseStage(project.stage);

  await ensureOverrideSchema(env);

  if (sector) {
    try {
      const ov = await env.DB.prepare(
        `SELECT method_id FROM deck_recommendation_overrides
         WHERE LOWER(sector) = LOWER(?) AND stage = ? LIMIT 1`,
      ).bind(sector, stage).first<{ method_id: string }>();
      if (ov?.method_id) {
        return { method_id: ov.method_id as DeckMethodId, sector, stage, source: 'override' };
      }
    } catch { /* ignore */ }

  }
  const d = engineDefault(sector, stage);
  return { method_id: d.method_id, sector, stage, source: d.source };
}

/**
 * D4155 K4 (#4191): what the engine picks for a sector and stage with no
 * override — the sector's explicit pick, else the stage's default. One
 * function, so `recommendMethod` and HQ's grid cannot disagree.
 */
export function engineDefault(sector: string, stageInput: string): { method_id: DeckMethodId; source: 'sector' | 'stage_default' } {
  const stage = normaliseStage(stageInput);
  if (sector) {
    for (const r of SECTOR_OVERRIDES) {
      if (r.sectorPattern.test(sector) && r.stage === stage) return { method_id: r.method, source: 'sector' };
    }
  }
  return { method_id: STAGE_DEFAULTS[stage], source: 'stage_default' };
}

/** The canvas's grid (HD4): six sectors by four stages, in the engine's stage ids. */
export const GRID_SECTORS = ['B2B software', 'Fintech', 'Health', 'Climate', 'Consumer', 'Deep tech'] as const;
export const GRID_STAGES = ['pre_seed', 'seed', 'series_a', 'series_b'] as const;
export function engineDefaults() {
  return GRID_SECTORS.flatMap((sector) => GRID_STAGES.map((stage) => ({ sector, stage, ...engineDefault(sector, stage) })));
}

export type OverrideRow = { sector: string; stage: string; method_id: string; updated_at: string; updated_by: { uid: string; name: string | null } | null };
/** The overrides, each naming who set it by uid and name; never an email. */
export async function listOverrides(env: Env): Promise<OverrideRow[]> {
  await ensureOverrideSchema(env);
  const rows = await env.DB.prepare(
    `SELECT o.sector, o.stage, o.method_id, o.updated_at, u.uid AS by_uid, u.name AS by_name
       FROM deck_recommendation_overrides o LEFT JOIN users u ON u.id = o.updated_by
      ORDER BY o.sector ASC, o.stage ASC`,
  ).all<{ sector: string; stage: string; method_id: string; updated_at: string; by_uid: string | null; by_name: string | null }>();
  return (rows.results || []).map((r) => ({ sector: r.sector, stage: r.stage, method_id: r.method_id, updated_at: r.updated_at,
    updated_by: r.by_uid ? { uid: r.by_uid, name: r.by_name } : null }));
}

/** One override as stored, for an audit row's before; null when none. */
export async function overrideOf(env: Env, sector: string, stage: string): Promise<{ method_id: string } | null> {
  await ensureOverrideSchema(env);
  return (await env.DB.prepare(`SELECT method_id FROM deck_recommendation_overrides WHERE LOWER(sector) = LOWER(?) AND stage = ? LIMIT 1`)
    .bind(sector.trim(), normaliseStage(stage)).first<{ method_id: string }>()) ?? null;
}

export async function setOverride(
  env: Env, sector: string, stage: string, method_id: string, userId: number | null,
): Promise<void> {
  await ensureOverrideSchema(env);
  const s = normaliseStage(stage);
  await env.DB.prepare(
    `INSERT INTO deck_recommendation_overrides (sector, stage, method_id, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(sector, stage) DO UPDATE SET method_id = excluded.method_id,
       updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).bind(sector.trim(), s, method_id, userId).run();
}

export async function deleteOverride(env: Env, sector: string, stage: string): Promise<void> {
  await ensureOverrideSchema(env);
  await env.DB.prepare(
    `DELETE FROM deck_recommendation_overrides WHERE LOWER(sector) = LOWER(?) AND stage = ?`,
  ).bind(sector.trim(), normaliseStage(stage)).run();
}
