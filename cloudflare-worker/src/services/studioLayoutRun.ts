/**
 * D1420 (#3864): `studio:layout`, Eadwyn's layout proposals for /studio (the
 * canvas's SM9 and SM10). The model proposes; this file decides what may be
 * proposed.
 *
 * - **What the model reads:** the member's current layout and its revision,
 *   this profile's catalogue (title, purpose, group, default size and whether
 *   the plan locks it), and for a founder their Lab week and readiness tier.
 *   Nothing of any other member, and no table name.
 * - **What it may propose:** `add`, `remove`, `resize` or `move` ops. Each is
 *   checked against the catalogue and the layout as the earlier kept ops left
 *   it, so two ops cannot together take the layout past 12. A dropped op is
 *   named by its op, its module's title (or null) and why, never by its key.
 * - **What it writes:** nothing here. `routes/rail_run.ts` writes one
 *   `ai_rail_proposals` row per kept op; Accept saves through
 *   `PUT /api/studio/layout` with the run's `base_revision`.
 */
import type { Env, User } from '../types';
import {
  STUDIO_FIXED, STUDIO_LAYOUT_MAX, STUDIO_SIZES, catalogueOf, lockOf,
  type StudioModule, type StudioProfile, type StudioSize,
} from './studioModules';
import { RETIRED_TITLES } from '../routes/studio_layout';
import { verifyScoreHash, snapshotIsVisible } from './scoreIntegrity';
import { tierLabel } from './scoring';

/** The rail page key each profile's /studio answers to (`frontend/src/lib/railPages.js`). Advisor has no rail there. */
export const STUDIO_RAIL_PAGES: Readonly<Partial<Record<StudioProfile, string>>> = {
  founder: 'Founder · Studio',
  investor: 'Investor · Home',
  partner: 'Operating Partner · Home',
};

export const STUDIO_LAYOUT_OPTION = 'studio:layout';
export const STUDIO_LAYOUT_OPS = ['add', 'remove', 'resize', 'move'] as const;
export type StudioLayoutOp = (typeof STUDIO_LAYOUT_OPS)[number];
export type LayoutEntry = { key: string; size: StudioSize };

export type DropWhy = 'unknown_op' | 'fixed' | 'not_offered' | 'locked' | 'already_placed' | 'not_placed' | 'invalid_size' | 'invalid_index' | 'over_limit';
export type DroppedOp = { op: string | null; title: string | null; why: DropWhy };
export type KeptOp = { op: StudioLayoutOp; key: string; title: string; size?: StudioSize; index?: number };

/** What the run read for a founder, each part null when it could not be read or is not recorded. */
export type FounderContext = { lab: { active: boolean; week: number } | null; readiness: { tier: string; label: string } | null };

/**
 * A founder's Lab week and readiness tier, as the Studio page reads them:
 * the Lab columns `/api/spinout-lab/state` reads, and the newest official
 * score snapshot of the founder's own latest venture that the scores read
 * would show them (signed, verified, not flagged). Each part fails alone.
 */
export async function founderContext(env: Env, user: User): Promise<FounderContext> {
  let lab: FounderContext['lab'] = null;
  try {
    const r = await env.DB.prepare('SELECT spinout_lab_active, spinout_lab_week FROM users WHERE id = ?')
      .bind(user.id).first<{ spinout_lab_active: number | null; spinout_lab_week: number | null }>();
    if (r) lab = { active: Number(r.spinout_lab_active ?? 0) === 1, week: Number(r.spinout_lab_week ?? 1) };
  } catch { lab = null; }
  let readiness: FounderContext['readiness'] = null;
  try {
    const founderId = user.founder_id ?? null;
    if (founderId != null) {
      const p = await env.DB.prepare('SELECT id FROM projects WHERE founder_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1')
        .bind(founderId).first<{ id: number }>();
      if (p) {
        const rows = (await env.DB.prepare(
          'SELECT * FROM score_snapshots WHERE project_id = ? AND is_sandbox = 0 ORDER BY created_at DESC LIMIT 5',
        ).bind(p.id).all<any>()).results ?? [];
        for (const row of rows) {
          const v = await verifyScoreHash(env, row);
          if (!snapshotIsVisible(row, v.valid, { role: String(user.role), founderId, ownerFounderId: founderId })) continue;
          readiness = { tier: String(row.tier), label: tierLabel(String(row.tier)) };
          break;
        }
      }
    }
  } catch { readiness = null; }
  return { lab, readiness };
}

/** The short sentence each proposal carries: what the run read. */
export function sourceSentence(profile: StudioProfile, ctx: FounderContext | null): string {
  if (profile === 'founder' && ctx) {
    if (ctx.lab?.active && ctx.readiness) return 'Your Lab week and readiness score.';
    if (ctx.lab?.active) return 'Your Lab week and your Studio.';
    if (ctx.readiness) return 'Your readiness score and your Studio.';
  }
  return 'Your Studio and the modules it offers.';
}

const titleOf = (catalogue: Map<string, StudioModule>, key: unknown): string | null =>
  typeof key === 'string' ? catalogue.get(key)?.title ?? RETIRED_TITLES[key] ?? null : null;

/** The model's instructions and the member's facts. No table name and no other member's data. */
export function studioLayoutMessages(
  profile: StudioProfile,
  user: User,
  layout: readonly LayoutEntry[],
  ctx: FounderContext | null,
): { messages: Array<{ role: 'system' | 'user'; content: string }>; guardText: string } {
  const catalogue = catalogueOf(profile, user);
  const placed = new Set(layout.map((e) => e.key));
  const modules = catalogue.map((m) => ({
    key: m.key, title: m.title, purpose: m.purpose, group: m.group, default_size: m.default_size,
    locked_by_plan: lockOf(user, m) !== null, placed: placed.has(m.key),
  }));
  const facts: Record<string, unknown> = { profile, layout, max_modules: STUDIO_LAYOUT_MAX, sizes: STUDIO_SIZES, modules };
  if (profile === 'founder' && ctx) {
    facts.lab = ctx.lab ? { in_lab: ctx.lab.active, week: ctx.lab.week } : 'Not recorded';
    facts.readiness = ctx.readiness ? ctx.readiness.label : 'Not recorded';
  }
  const system = [
    'You arrange a member\'s Studio page for where they are now. You only propose; the member accepts or discards each change.',
    'Answer with JSON only: {"ops":[...]}. Each op is one of:',
    '{"op":"add","key":<module key>,"size":"1/3"|"1/2"|"full"}, {"op":"remove","key":<key>}, {"op":"resize","key":<key>,"size":<size>}, {"op":"move","key":<key>,"index":<0-based position>}.',
    `Use only keys from "modules". Never add a module whose "locked_by_plan" is true. Keep at most ${STUDIO_LAYOUT_MAX} modules. Propose at most 4 ops, the ones that matter most for this stage.`,
    'When the layout already fits, answer {"ops":[]}.',
  ].join('\n');
  const user_ = JSON.stringify(facts);
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user_ }], guardText: user_ };
}

/** The first JSON object in the output, or null. */
function parseOps(output: unknown): unknown[] {
  const text = String(output ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(obj?.ops) ? obj.ops : [];
  } catch { return []; }
}

/**
 * Check each proposed op against the catalogue and the layout as the kept
 * ops before it leave it. Pure.
 */
export function validateOps(
  output: unknown,
  profile: StudioProfile,
  user: User,
  layout: readonly LayoutEntry[],
): { kept: KeptOp[]; dropped: DroppedOp[] } {
  const catalogue = new Map(catalogueOf(profile, user).map((m) => [m.key, m]));
  const work: LayoutEntry[] = layout.map((e) => ({ ...e }));
  const kept: KeptOp[] = [];
  const dropped: DroppedOp[] = [];
  const isSize = (s: unknown): s is StudioSize => (STUDIO_SIZES as readonly unknown[]).includes(s);
  for (const raw of parseOps(output)) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const op = typeof o.op === 'string' ? o.op : null;
    const key = o.key;
    const drop = (why: DropWhy) => dropped.push({ op, title: titleOf(catalogue, key), why });
    if (!op || !(STUDIO_LAYOUT_OPS as readonly string[]).includes(op)) { drop('unknown_op'); continue; }
    if (typeof key === 'string' && (STUDIO_FIXED as readonly string[]).includes(key)) { drop('fixed'); continue; }
    const mod = typeof key === 'string' ? catalogue.get(key) : undefined;
    if (!mod) { drop('not_offered'); continue; }
    const at = work.findIndex((e) => e.key === mod.key);
    if (op === 'add') {
      if (lockOf(user, mod)) { drop('locked'); continue; }
      if (at >= 0) { drop('already_placed'); continue; }
      if (!isSize(o.size)) { drop('invalid_size'); continue; }
      if (work.length + 1 > STUDIO_LAYOUT_MAX) { drop('over_limit'); continue; }
      work.push({ key: mod.key, size: o.size });
      kept.push({ op: 'add', key: mod.key, title: mod.title, size: o.size });
    } else if (op === 'remove') {
      if (at < 0) { drop('not_placed'); continue; }
      work.splice(at, 1);
      kept.push({ op: 'remove', key: mod.key, title: mod.title });
    } else if (op === 'resize') {
      if (lockOf(user, mod)) { drop('locked'); continue; }
      if (at < 0) { drop('not_placed'); continue; }
      if (!isSize(o.size)) { drop('invalid_size'); continue; }
      work[at] = { key: mod.key, size: o.size };
      kept.push({ op: 'resize', key: mod.key, title: mod.title, size: o.size });
    } else {
      if (lockOf(user, mod)) { drop('locked'); continue; }
      if (at < 0) { drop('not_placed'); continue; }
      const index = Number(o.index);
      if (!Number.isSafeInteger(index) || index < 0 || index >= work.length) { drop('invalid_index'); continue; }
      const [entry] = work.splice(at, 1);
      work.splice(index, 0, entry);
      kept.push({ op: 'move', key: mod.key, title: mod.title, index });
    }
  }
  return { kept, dropped };
}
