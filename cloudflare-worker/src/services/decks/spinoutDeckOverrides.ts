/* ============================================================================
 *  Spin-Out deck — MANUAL OVERRIDE LAYER.
 *
 *  WHY THIS EXISTS. The deck renders entirely from live Lab data
 *  (`assembleSpinoutDeckData`), which is the right default: change the Customer
 *  Discovery module and the deck follows. But it left the deck editor with no
 *  place to put a wording change. `SpinoutSlideEditor`'s editable rows wrote
 *  STRAIGHT BACK into the project columns — so "tighten the solution sentence
 *  for this investor deck" silently rewrote `projects.solution`, the canonical
 *  field every other surface reads. A deck edit is not a module edit, and the
 *  editor had no way to say so.
 *
 *  This module is that missing layer. Precedence, highest first:
 *
 *    1. MANUAL OVERRIDE  — a per-project, per-key string stored here.
 *    2. CANONICAL MODULE DATA — whatever the Lab modules actually hold.
 *    3. DERIVED / FALLBACK — the '[draft — …]' placeholders the mapper emits
 *       when a module is empty (always paired with a gap + DRAFT stamp).
 *
 *  Design notes:
 *
 *  - SCALARS ONLY. `SPINOUT_OVERRIDABLE_KEYS` is a curated allowlist of the
 *    narrative wording fields. Chart series, rosters, KPI tuples and cap-table
 *    segments are NOT overridable: hand-editing a funnel count would let the
 *    deck assert a number the data does not support, which is exactly the class
 *    of bug the gaps/DRAFT machinery exists to prevent.
 *
 *  - AN OVERRIDE CLEARS ITS GAP. `mapToSpinoutDeckData` tags each gap with the
 *    field it is about (`gapFields`), so overriding `cover.thesis` drops
 *    "Cover: add a one-line thesis…" and can un-DRAFT the deck. A gap that says
 *    "you haven't written a thesis" is wrong once a thesis has been written.
 *
 *  - PURE. `applySpinoutOverrides` takes a bundle + a plain record and returns a
 *    new bundle. No D1, no env — so it is unit-testable, and the D1 read/write
 *    helpers below stay a thin shell around it.
 * ========================================================================== */

import type { Env } from '../../types';
import type { SpinoutDeckBundle, SpinoutDeckData } from './spinoutDeckData';
import { flattenSpinoutDeckData } from './spinoutDeckData';

/**
 * The narrative fields a founder may override at deck level, as dotted paths
 * into `SpinoutDeckData`. Each MUST be a string-valued leaf — enforced by
 * `spinoutDeckOverrides.test.ts`, which walks a fully-populated bundle and
 * fails if any key here is missing or non-scalar.
 */
export const SPINOUT_OVERRIDABLE_KEYS: readonly string[] = [
  'cover.thesis',
  'problem.title',
  'problem.framing',
  'problem.quote',
  'problem.quoteAttr',
  'validation.title',
  'market.title',
  'market.assumptions',
  'solution.title',
  'productDemo.title',
  'productDemo.body',
  'productDemo.caption',
  'roadmap.title',
  'team.title',
  'captable.title',
  'ask.title',
  'deal.title',
  'deal.closingLine',
];

const OVERRIDABLE = new Set(SPINOUT_OVERRIDABLE_KEYS);

/** Longest override we will store, per field. Deck copy, not an essay. */
export const MAX_OVERRIDE_LEN = 600;

export type SpinoutDeckOverrides = Record<string, string>;

/** A bundle plus the override bookkeeping the editor needs to render state. */
export interface SpinoutDeckBundleWithOverrides extends SpinoutDeckBundle {
  /** The overrides that were actually applied (post-validation), by key. */
  overrides: SpinoutDeckOverrides;
  /** Sorted list of keys currently overridden — the editor's "Manual" badges. */
  overriddenKeys: string[];
}

export const isOverridableKey = (key: unknown): boolean =>
  typeof key === 'string' && OVERRIDABLE.has(key);

/**
 * Normalise a caller-supplied override map: drop unknown keys, trim, drop
 * empties (an empty override is a REVERT, not a blank slide), cap length.
 * Returns the cleaned map plus the keys that were rejected, so a route can
 * 400 loudly instead of silently swallowing a typo'd field name.
 */
export function sanitizeSpinoutOverrides(
  raw: unknown,
): { overrides: SpinoutDeckOverrides; rejected: string[] } {
  const overrides: SpinoutDeckOverrides = Object.create(null);
  const rejected: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { overrides, rejected };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!OVERRIDABLE.has(key)) { rejected.push(key); continue; }
    // null / '' means "revert to the canonical module value" — represented by
    // simply not carrying the key. Callers delete by sending an empty string.
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number') { rejected.push(key); continue; }
    const s = String(value).trim();
    if (s === '') continue;
    overrides[key] = s.slice(0, MAX_OVERRIDE_LEN);
  }
  return { overrides, rejected };
}

/**
 * Pre-split allowlist: dotted key -> its `[section, field]` segments.
 *
 * This exists so `setPath` never writes a property name that came from its
 * `path` ARGUMENT. The argument is used only as a lookup key into this Map,
 * built once from the `SPINOUT_OVERRIDABLE_KEYS` literal; the strings that
 * actually index into the deck data come out of that constant. A caller who
 * skips the allowlist — or an attacker who reaches this function directly with
 * `__proto__.x` — gets `undefined` from the Map and is refused before anything
 * is indexed, so there is no path-traversal to guard against rather than a
 * guard to keep correct.
 *
 * Every allowlisted key is exactly two segments (`section.field`), which is why
 * this needs no walk down a chain. `spinoutDeckOverrides.test.ts` asserts that
 * invariant, so adding a three-level key fails the suite loudly instead of
 * silently becoming a no-op override.
 */
const OVERRIDABLE_PATH_SEGMENTS: ReadonlyMap<string, readonly [string, string]> = new Map(
  SPINOUT_OVERRIDABLE_KEYS.flatMap((key) => {
    const parts = key.split('.');
    return parts.length === 2 ? [[key, [parts[0], parts[1]] as const] as const] : [];
  }),
);

/**
 * Write `value` at an allowlisted dotted path inside `root`, shallow-cloning
 * the section on the way so the caller's bundle is never mutated. Returns false
 * when the path is not allowlisted, or does not resolve to an existing string
 * leaf — the latter catching a stale allowlist entry that would otherwise grow
 * a junk key on the deck data.
 */
function setPath(root: Record<string, any>, path: string, value: string): boolean {
  const segments = OVERRIDABLE_PATH_SEGMENTS.get(path);
  if (!segments) return false;
  const [section, field] = segments;

  const current = root[section];
  if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
  if (typeof current[field] !== 'string') return false;

  root[section] = { ...current, [field]: value };
  return true;
}

/**
 * Layer manual overrides on top of an assembled bundle.
 *
 * Applies each override into `data`, re-flattens `fields` so the editor's
 * hydrate() contract sees the overridden text, drops any gap whose field is now
 * overridden, and recomputes `draft` from the surviving gaps. `programDay` is
 * untouched: a manual edit does not move the founder through the program, so a
 * Day-16 deck stays DRAFT no matter how much copy is overridden.
 */
export function applySpinoutOverrides(
  bundle: SpinoutDeckBundle,
  raw: unknown,
): SpinoutDeckBundleWithOverrides {
  const { overrides } = sanitizeSpinoutOverrides(raw);
  const keys = Object.keys(overrides);
  if (!keys.length) {
    return { ...bundle, overrides: {}, overriddenKeys: [] };
  }

  // Shallow-clone the sections we touch; setPath clones deeper as it walks.
  const data = { ...(bundle.data as unknown as Record<string, any>) } as unknown as SpinoutDeckData;
  const applied: SpinoutDeckOverrides = {};
  for (const key of keys) {
    if (setPath(data as unknown as Record<string, any>, key, overrides[key])) {
      applied[key] = overrides[key];
    }
  }

  const appliedKeys = new Set(Object.keys(applied));
  // Drop the gaps that the overrides answer. `gapFields` is index-aligned with
  // `gaps`; an untagged gap (null) is never dropped.
  const gapFields = bundle.gapFields || [];
  const gaps: string[] = [];
  const nextGapFields: Array<string | null> = [];
  bundle.gaps.forEach((g, i) => {
    const field = gapFields[i] ?? null;
    if (field && appliedKeys.has(field)) return;
    gaps.push(g);
    nextGapFields.push(field);
  });

  return {
    ...bundle,
    data,
    fields: flattenSpinoutDeckData(data),
    gaps,
    gapFields: nextGapFields,
    draft: bundle.programDay < 28 || gaps.length > 0,
    overrides: applied,
    overriddenKeys: Object.keys(applied).sort(),
  };
}

/* ============================================================================
 *  D1 shell.
 * ========================================================================== */

/**
 * Self-heal the table on a cold isolate, mirroring the ensureXSchema pattern
 * used across the worker (partnerGuidanceSchema, fundGpSchema, …). Migration
 * 164 is the canonical DDL; this exists so a preview/dev D1 that has not been
 * migrated still serves the route instead of 500ing on "no such table".
 */
let _overridesReady = false;
export async function ensureSpinoutDeckOverridesSchema(env: Env): Promise<void> {
  if (_overridesReady) return;
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS spinout_deck_overrides (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'project_id INTEGER NOT NULL, ' +
      'field_key TEXT NOT NULL, ' +
      'value TEXT NOT NULL, ' +
      'updated_by INTEGER, ' +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now'))" +
      ')',
  );
  await env.DB.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_spinout_deck_overrides_project_key ' +
      'ON spinout_deck_overrides(project_id, field_key)',
  );
  _overridesReady = true;
}

/** Read a project's stored overrides as a plain map. Never throws on a missing table. */
export async function loadSpinoutDeckOverrides(
  env: Env,
  projectId: number,
): Promise<SpinoutDeckOverrides> {
  try {
    await ensureSpinoutDeckOverridesSchema(env);
    const res = await env.DB
      .prepare('SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ?')
      .bind(projectId)
      .all();
    const out: SpinoutDeckOverrides = {};
    for (const row of (res?.results || []) as Array<{ field_key: string; value: string }>) {
      if (OVERRIDABLE.has(row.field_key)) out[row.field_key] = String(row.value ?? '');
    }
    return out;
  } catch {
    // A deck that cannot read its overrides must still render from live data.
    return {};
  }
}

/**
 * Upsert / delete overrides for a project. Keys present with a non-empty value
 * are written; keys present with an empty value (or listed in `remove`) are
 * deleted — that is the revert path. Returns the resulting full override map.
 */
export async function saveSpinoutDeckOverrides(
  env: Env,
  projectId: number,
  userId: number,
  raw: unknown,
  remove: string[] = [],
): Promise<SpinoutDeckOverrides> {
  await ensureSpinoutDeckOverridesSchema(env);
  const { overrides } = sanitizeSpinoutOverrides(raw);

  // Anything the caller sent as an explicit empty string is a revert. sanitize
  // drops those, so recover them from the raw payload here.
  const cleared = new Set(remove.filter(isOverridableKey));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!OVERRIDABLE.has(key)) continue;
      if (value === null || (typeof value === 'string' && value.trim() === '')) cleared.add(key);
    }
  }

  for (const key of cleared) {
    await env.DB
      .prepare('DELETE FROM spinout_deck_overrides WHERE project_id = ? AND field_key = ?')
      .bind(projectId, key)
      .run();
  }
  for (const [key, value] of Object.entries(overrides)) {
    await env.DB
      .prepare(
        'INSERT INTO spinout_deck_overrides (project_id, field_key, value, updated_by, updated_at) ' +
          "VALUES (?, ?, ?, ?, datetime('now')) " +
          'ON CONFLICT(project_id, field_key) DO UPDATE SET ' +
          "value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')",
      )
      .bind(projectId, key, value, userId)
      .run();
  }

  return loadSpinoutDeckOverrides(env, projectId);
}
