/**
 * D487 — HQ'S PUBLISHED GAMES REACH EVERY BRANCH, AS ONE SET.
 *
 * Before this, no game reached a branch: nothing pushed one, a branch's
 * database starts with none, and authoring is refused on a branch (D106,
 * `requireHqAuthoring`). H18 said "live on N branches" had nothing to count.
 *
 * DECIDED (#1025, option A): every PUBLISHED HQ game reaches every branch,
 * with its chapters, its active questions and its archetypes, the way the
 * contract template library goes (D147, `applyTemplateCopy`): the whole set in
 * one push, so a game HQ stops publishing can be withdrawn.
 *
 * WHERE THE COPY LIVES: the branch's own `assessment_*` tables. Authoring is
 * refused on a branch, so after this the push is the only writer of a branch's
 * games, chapters, questions and archetypes, and every branch reader of those
 * tables reads HQ's games without a second store. No migration: the tables are
 * bootstrapped by `ensureAssessmentSchema` on the write.
 *
 * KEYED BY SLUG, never by id. A game's slug is its stable identifier (unique on
 * both tiers); a chapter is its game's slug plus its own; a question and an
 * archetype carry slugs unique across games. A branch's row ids are its own,
 * so its members' runs keep pointing at the same row across pushes.
 *
 * WITHDRAWN IS ARCHIVED, NEVER DELETED. A game the branch holds that HQ no
 * longer sends is set `archived`, so a member's run keeps its game. Inside a
 * game HQ still sends:
 *   - a question HQ no longer sends is set inactive (`is_active = 0`), the way
 *     HQ's own delete treats an answered question;
 *   - an archetype HQ no longer sends is removed: a result keeps its
 *     archetype's slug and label as text, and HQ hard-deletes archetypes too;
 *   - a chapter HQ removed stays, holding no active question: chapters have no
 *     status, and a run may point at one.
 * Badges do not travel: they are not part of a game, and an archetype names
 * its badge by slug only.
 *
 * ONE TRANSACTION. `DB.batch` runs its statements as one, so a push that fails
 * part-way leaves the branch's previous games standing.
 */
import type { Env } from '../types';
import { ensureAssessmentSchema } from './assessmentSchema';

export type PushedChapter = { slug: string; title: string; description: string | null; display_order: number };
export type PushedItem = {
  slug: string; chapter_slug: string; mechanic: string; prompt: string; subprompt: string | null;
  options_json: string; measures_json: string; loads_json: string; config_json: string; display_order: number;
};
export type PushedArchetype = {
  slug: string; track: string; label: string; tagline: string | null; description: string | null;
  centroid_json: string; badge_slug: string | null; display_order: number;
};
export type PushedGame = {
  slug: string; track: string; title: string; subtitle: string | null; description: string | null;
  target_role: string | null; theme_json: string; version: number; display_order: number;
  chapters: PushedChapter[]; items: PushedItem[]; archetypes: PushedArchetype[];
};
export type GameSet = { games: PushedGame[]; pushed_at: string };

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const optStr = (v: unknown, max: number) => (v === null || v === undefined || v === '' ? null : str(v, max));
const json = (v: unknown, fallback: string) => {
  if (typeof v !== 'string') return fallback;
  try { JSON.parse(v); return v; } catch { return fallback; }
};
const int = (v: unknown, dflt = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : dflt);

/** HQ's published games, whole, as the push sends them. Throws when a table cannot be read. */
export async function readPublishedGameSet(env: Env): Promise<PushedGame[]> {
  const games = await env.DB.prepare(
    `SELECT slug, track, title, subtitle, description, target_role, theme_json, version, display_order
       FROM assessment_games WHERE status = 'published' ORDER BY display_order, id`,
  ).all<Record<string, unknown>>();
  const chapters = await env.DB.prepare(
    `SELECT g.slug AS game_slug, ch.slug, ch.title, ch.description, ch.display_order
       FROM assessment_chapters ch JOIN assessment_games g ON g.id = ch.game_id
      WHERE g.status = 'published' ORDER BY ch.display_order, ch.id`,
  ).all<Record<string, unknown>>();
  const items = await env.DB.prepare(
    `SELECT g.slug AS game_slug, ch.slug AS chapter_slug, it.slug, it.mechanic, it.prompt, it.subprompt,
            it.options_json, it.measures_json, it.loads_json, it.config_json, it.display_order
       FROM assessment_items it
       JOIN assessment_games g ON g.id = it.game_id
       JOIN assessment_chapters ch ON ch.id = it.chapter_id
      WHERE g.status = 'published' AND it.is_active = 1 ORDER BY it.display_order, it.id`,
  ).all<Record<string, unknown>>();
  const archetypes = await env.DB.prepare(
    `SELECT g.slug AS game_slug, ar.track, ar.slug, ar.label, ar.tagline, ar.description, ar.centroid_json,
            ar.badge_slug, ar.display_order
       FROM assessment_archetypes ar JOIN assessment_games g ON g.id = ar.game_id
      WHERE g.status = 'published' ORDER BY ar.display_order, ar.id`,
  ).all<Record<string, unknown>>();
  const of = (rows: Array<Record<string, unknown>>, slug: string) => rows.filter((r) => r.game_slug === slug);
  return (games.results || []).map((g) => {
    const slug = String(g.slug);
    return normaliseGame({
      ...g,
      chapters: of(chapters.results || [], slug),
      items: of(items.results || [], slug),
      archetypes: of(archetypes.results || [], slug),
    });
  }).filter((g): g is PushedGame => g !== null);
}

/** Coerce one game at the boundary; `null` when it lacks what identifies it. Pure. */
export function normaliseGame(g: any): PushedGame | null {
  const slug = str(g?.slug, 120);
  const title = str(g?.title, 300);
  const track = str(g?.track, 120);
  if (!slug || !title || !track) return null;
  const chapters = (Array.isArray(g?.chapters) ? g.chapters : [])
    .map((c: any) => ({
      slug: str(c?.slug, 120), title: str(c?.title, 300),
      description: optStr(c?.description, 4000), display_order: int(c?.display_order),
    }))
    .filter((c: PushedChapter) => c.slug && c.title);
  const chapterSlugs = new Set(chapters.map((c: PushedChapter) => c.slug));
  const items = (Array.isArray(g?.items) ? g.items : [])
    .map((i: any) => ({
      slug: str(i?.slug, 160), chapter_slug: str(i?.chapter_slug, 120), mechanic: str(i?.mechanic, 40),
      prompt: str(i?.prompt, 4000), subprompt: optStr(i?.subprompt, 4000),
      options_json: json(i?.options_json, '{}'), measures_json: json(i?.measures_json, '{}'),
      loads_json: json(i?.loads_json, '{}'), config_json: json(i?.config_json, '{}'),
      display_order: int(i?.display_order),
    }))
    // A question whose chapter did not travel has nowhere to sit.
    .filter((i: PushedItem) => i.slug && i.prompt && i.mechanic && chapterSlugs.has(i.chapter_slug));
  const archetypes = (Array.isArray(g?.archetypes) ? g.archetypes : [])
    .map((a: any) => ({
      slug: str(a?.slug, 160), track: str(a?.track, 120) || track, label: str(a?.label, 300),
      tagline: optStr(a?.tagline, 600), description: optStr(a?.description, 4000),
      centroid_json: json(a?.centroid_json, '{}'), badge_slug: optStr(a?.badge_slug, 120),
      display_order: int(a?.display_order),
    }))
    .filter((a: PushedArchetype) => a.slug && a.label);
  return {
    slug, track, title,
    subtitle: optStr(g?.subtitle, 600), description: optStr(g?.description, 4000),
    target_role: optStr(g?.target_role, 120), theme_json: json(g?.theme_json, '{}'),
    version: Math.max(1, int(g?.version, 1)), display_order: int(g?.display_order),
    chapters, items, archetypes,
  };
}

/**
 * Store the set HQ pushed, on a branch. Returns what it stored and what it
 * withdrew. The caller is another Worker in the same account: trusted for
 * authorisation, not for shape, so everything is coerced here.
 */
export async function applyGameSet(
  env: Env,
  p: GameSet,
): Promise<{ ok: true; stored: number; archived: number; deactivated: number; removed_archetypes: number }> {
  await ensureAssessmentSchema(env);
  const now = new Date().toISOString();
  const games = (Array.isArray(p?.games) ? p.games : [])
    .map(normaliseGame).filter((g): g is PushedGame => g !== null);
  const incoming = new Set(games.map((g) => g.slug));

  // What the branch holds now, read before the batch so the withdrawals are
  // set differences in JS: no `NOT IN (…)` list is built into a query's text.
  const held = await env.DB.prepare('SELECT slug, status FROM assessment_games').all<{ slug: string; status: string }>();
  const heldItems = await env.DB.prepare(
    `SELECT it.slug, g.slug AS game_slug FROM assessment_items it JOIN assessment_games g ON g.id = it.game_id
      WHERE it.is_active = 1`,
  ).all<{ slug: string; game_slug: string }>();
  const heldArchetypes = await env.DB.prepare(
    `SELECT ar.slug, g.slug AS game_slug FROM assessment_archetypes ar JOIN assessment_games g ON g.id = ar.game_id`,
  ).all<{ slug: string; game_slug: string }>();

  const toArchive = (held.results || [])
    .filter((r) => !incoming.has(String(r.slug)) && String(r.status) !== 'archived')
    .map((r) => String(r.slug));
  const sentItems = new Set(games.flatMap((g) => g.items.map((i) => i.slug)));
  const toDeactivate = (heldItems.results || [])
    .filter((r) => incoming.has(String(r.game_slug)) && !sentItems.has(String(r.slug)))
    .map((r) => String(r.slug));
  const sentArchetypes = new Set(games.flatMap((g) => g.archetypes.map((a) => a.slug)));
  const toRemove = (heldArchetypes.results || [])
    .filter((r) => incoming.has(String(r.game_slug)) && !sentArchetypes.has(String(r.slug)))
    .map((r) => String(r.slug));

  const db = env.DB;
  const statements = [
    ...games.flatMap((g) => [
      db.prepare(
        `INSERT INTO assessment_games (slug, track, title, subtitle, description, target_role, theme_json,
                                       status, version, display_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           track = excluded.track, title = excluded.title, subtitle = excluded.subtitle,
           description = excluded.description, target_role = excluded.target_role,
           theme_json = excluded.theme_json, status = 'published', version = excluded.version,
           display_order = excluded.display_order, updated_at = excluded.updated_at`,
      ).bind(g.slug, g.track, g.title, g.subtitle, g.description, g.target_role, g.theme_json,
        g.version, g.display_order, now),
      ...g.chapters.map((c) => db.prepare(
        `INSERT INTO assessment_chapters (game_id, slug, title, description, display_order, updated_at)
         VALUES ((SELECT id FROM assessment_games WHERE slug = ?), ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, slug) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           display_order = excluded.display_order, updated_at = excluded.updated_at`,
      ).bind(g.slug, c.slug, c.title, c.description, c.display_order, now)),
      ...g.items.map((i) => db.prepare(
        `INSERT INTO assessment_items (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json,
                                       measures_json, loads_json, config_json, display_order, is_active, updated_at)
         VALUES ((SELECT id FROM assessment_games WHERE slug = ?),
                 (SELECT ch.id FROM assessment_chapters ch JOIN assessment_games g ON g.id = ch.game_id
                   WHERE g.slug = ? AND ch.slug = ?),
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(slug) DO UPDATE SET
           game_id = excluded.game_id, chapter_id = excluded.chapter_id, mechanic = excluded.mechanic,
           prompt = excluded.prompt, subprompt = excluded.subprompt, options_json = excluded.options_json,
           measures_json = excluded.measures_json, loads_json = excluded.loads_json,
           config_json = excluded.config_json, display_order = excluded.display_order,
           is_active = 1, updated_at = excluded.updated_at`,
      ).bind(g.slug, g.slug, i.chapter_slug, i.slug, i.mechanic, i.prompt, i.subprompt, i.options_json,
        i.measures_json, i.loads_json, i.config_json, i.display_order, now)),
      ...g.archetypes.map((a) => db.prepare(
        `INSERT INTO assessment_archetypes (game_id, track, slug, label, tagline, description, centroid_json,
                                            badge_slug, display_order, updated_at)
         VALUES ((SELECT id FROM assessment_games WHERE slug = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           game_id = excluded.game_id, track = excluded.track, label = excluded.label,
           tagline = excluded.tagline, description = excluded.description,
           centroid_json = excluded.centroid_json, badge_slug = excluded.badge_slug,
           display_order = excluded.display_order, updated_at = excluded.updated_at`,
      ).bind(g.slug, a.track, a.slug, a.label, a.tagline, a.description, a.centroid_json, a.badge_slug,
        a.display_order, now)),
    ]),
    ...toDeactivate.map((slug) => db.prepare(
      `UPDATE assessment_items SET is_active = 0, updated_at = ? WHERE slug = ?`,
    ).bind(now, slug)),
    ...toRemove.map((slug) => db.prepare('DELETE FROM assessment_archetypes WHERE slug = ?').bind(slug)),
    ...toArchive.map((slug) => db.prepare(
      `UPDATE assessment_games SET status = 'archived', updated_at = ? WHERE slug = ?`,
    ).bind(now, slug)),
  ];
  if (statements.length) await db.batch(statements);
  return {
    ok: true, stored: games.length, archived: toArchive.length,
    deactivated: toDeactivate.length, removed_archetypes: toRemove.length,
  };
}

export type GameHolding = { slug: string; status: string; version: number; completions: number | null };
export type GameHoldings =
  | { received: false; games: [] }
  | { received: true; games: GameHolding[]; completions_reason?: string };

/**
 * Which games this database holds, and each one's completed runs. A database
 * whose assessment tables were never created has received no push: that is
 * "holds none", not a failed read, and it says so. Never bootstraps a schema
 * (D204): a read that created the table would turn "never received" into
 * "holds none" with no way back. Throws when the games table exists and
 * cannot be read.
 */
export async function readGameHoldings(env: Env): Promise<GameHoldings> {
  const t = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'assessment_games'`,
  ).first<{ n: number }>();
  if (!Number(t?.n)) return { received: false, games: [] };
  const games = await env.DB.prepare(
    'SELECT id, slug, status, version FROM assessment_games ORDER BY display_order, id',
  ).all<{ id: number; slug: string; status: string; version: number }>();
  let runs: Map<number, number> | null = null;
  let completionsReason: string | undefined;
  try {
    const q = await env.DB.prepare(
      `SELECT game_id, COUNT(*) AS n FROM assessment_sessions WHERE status = 'completed' GROUP BY game_id`,
    ).all<{ game_id: number; n: number }>();
    runs = new Map((q.results || []).map((r) => [Number(r.game_id), Number(r.n)]));
  } catch (e) {
    completionsReason = `The assessment sessions could not be read: ${(e as Error)?.message || 'unknown'}.`;
  }
  return {
    received: true,
    games: (games.results || []).map((g) => ({
      slug: String(g.slug), status: String(g.status), version: int(g.version, 1),
      completions: runs ? (runs.get(Number(g.id)) ?? 0) : null,
    })),
    ...(completionsReason ? { completions_reason: completionsReason } : {}),
  };
}
