/**
 * Task #44 — Gamified Assessment: admin authoring routes (design §7.2).
 *
 * Mounted at /api/admin/assessment, BEFORE the catch-all /api/admin router
 * (same mount-before-catch-all precedence as admin_events / admin_news). Every
 * handler is requireAdmin and (in prod) sits behind the /api/admin/* Cf-Access
 * perimeter applied in index.ts.
 *
 * Surface: CRUD + version + publish/archive for games / chapters / items /
 * archetypes / badges; preview a game (plays without writing results);
 * analytics (completion %, per-chapter drop-off, archetype distribution, 8-axis
 * coverage, median latency); admin re-score a session.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import {
  ensureAssessmentSchema,
  GAME_STATUSES,
  ASSESSMENT_MECHANICS,
  BADGE_KINDS,
  INVESTOR_TRACK,
} from '../services/assessmentSchema';
import {
  computeAssessment,
  assignArchetype,
  signResult,
  ASSESSMENT_INTEGRITY_VERSION,
  type ScoringItem,
  type ScoringResponse,
  type ArchetypeDef,
} from '../services/assessmentScoring';

const adminAssessment = new Hono<{ Bindings: Env }>();

adminAssessment.use('*', async (c, next) => {
  await ensureAssessmentSchema(c.env);
  await next();
});

async function admin(c: any) {
  try {
    return await requireAdmin(c);
  } catch (e) {
    const msg = (e as Error)?.message;
    return c.json({ error: msg || 'Admin required' }, msg === 'Unauthorized' ? 401 : 403);
  }
}

function parseJSON<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || s.trim() === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$/;

async function gameBySlug(env: Env, slug: string): Promise<any | null> {
  const row = await env.DB.prepare(`SELECT * FROM assessment_games WHERE slug = ?`).bind(slug).first<any>();
  return row || null;
}

function shapeGame(g: any): any {
  return {
    id: g.id,
    slug: g.slug,
    track: g.track,
    title: g.title,
    subtitle: g.subtitle,
    description: g.description,
    target_role: g.target_role,
    theme: parseJSON(g.theme_json, {}),
    status: g.status,
    version: g.version,
    display_order: g.display_order,
    created_at: g.created_at,
    updated_at: g.updated_at,
  };
}

function shapeItem(i: any): any {
  return {
    id: i.id,
    chapter_id: i.chapter_id,
    slug: i.slug,
    mechanic: i.mechanic,
    prompt: i.prompt,
    subprompt: i.subprompt,
    options: parseJSON(i.options_json, {}),
    measures: parseJSON(i.measures_json, {}),
    loads: parseJSON(i.loads_json, {}),
    config: parseJSON(i.config_json, {}),
    display_order: i.display_order,
    is_active: !!i.is_active,
  };
}

// ── GAMES ──────────────────────────────────────────────────────────────────
adminAssessment.get('/games', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const res = await c.env.DB.prepare(`SELECT * FROM assessment_games ORDER BY display_order, id`).all<any>();
  return c.json({ games: (res.results || []).map(shapeGame) });
});

adminAssessment.post('/games', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const b = await c.req.json().catch(() => ({}));
  const slug = String(b?.slug || '').trim();
  const track = String(b?.track || '').trim();
  const title = String(b?.title || '').trim();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid slug' }, 400);
  if (!track) return c.json({ error: 'track required' }, 400);
  if (!title) return c.json({ error: 'title required' }, 400);
  try {
    await c.env.DB.prepare(
      `INSERT INTO assessment_games (slug, track, title, subtitle, description, target_role, theme_json, status, version, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?)`,
    )
      .bind(
        slug,
        track,
        title,
        b?.subtitle ?? null,
        b?.description ?? null,
        b?.target_role ?? null,
        JSON.stringify(b?.theme ?? {}),
        Number(b?.display_order) || 0,
      )
      .run();
  } catch {
    return c.json({ error: 'slug already exists' }, 409);
  }
  return c.json({ game: shapeGame(await gameBySlug(c.env, slug)) }, 201);
});

adminAssessment.get('/games/:slug', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const chapters = await c.env.DB.prepare(
    `SELECT * FROM assessment_chapters WHERE game_id = ? ORDER BY display_order, id`,
  )
    .bind(game.id)
    .all<any>();
  const items = await c.env.DB.prepare(
    `SELECT * FROM assessment_items WHERE game_id = ? ORDER BY display_order, id`,
  )
    .bind(game.id)
    .all<any>();
  const archetypes = await c.env.DB.prepare(
    `SELECT * FROM assessment_archetypes WHERE game_id = ? ORDER BY display_order, id`,
  )
    .bind(game.id)
    .all<any>();
  return c.json({
    game: shapeGame(game),
    chapters: chapters.results || [],
    items: (items.results || []).map(shapeItem),
    archetypes: (archetypes.results || []).map((a) => ({ ...a, centroid: parseJSON(a.centroid_json, {}) })),
  });
});

adminAssessment.put('/games/:slug', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];
  const map: Record<string, any> = {
    title: b?.title,
    subtitle: b?.subtitle,
    description: b?.description,
    target_role: b?.target_role,
    track: b?.track,
    display_order: b?.display_order,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(val);
    }
  }
  if (b?.theme !== undefined) {
    sets.push('theme_json = ?');
    vals.push(JSON.stringify(b.theme ?? {}));
  }
  if (b?.status !== undefined) {
    if (!GAME_STATUSES.includes(b.status)) return c.json({ error: 'invalid status' }, 400);
    sets.push('status = ?');
    vals.push(b.status);
  }
  if (!sets.length) return c.json({ game: shapeGame(game) });
  sets.push("updated_at = datetime('now')");
  vals.push(game.id);
  await c.env.DB.prepare(`UPDATE assessment_games SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ game: shapeGame(await gameBySlug(c.env, game.slug)) });
});

async function setGameStatus(c: any, slug: string, status: string) {
  const game = await gameBySlug(c.env, slug);
  if (!game) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare(`UPDATE assessment_games SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, game.id)
    .run();
  return c.json({ game: shapeGame(await gameBySlug(c.env, slug)) });
}
adminAssessment.post('/games/:slug/publish', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  return setGameStatus(c, c.req.param('slug'), 'published');
});
adminAssessment.post('/games/:slug/archive', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  return setGameStatus(c, c.req.param('slug'), 'archived');
});
adminAssessment.post('/games/:slug/version', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare(
    `UPDATE assessment_games SET version = version + 1, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(game.id)
    .run();
  return c.json({ game: shapeGame(await gameBySlug(c.env, game.slug)) });
});

// ── CHAPTERS ────────────────────────────────────────────────────────────────
adminAssessment.post('/games/:slug/chapters', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const slug = String(b?.slug || '').trim();
  const title = String(b?.title || '').trim();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid slug' }, 400);
  if (!title) return c.json({ error: 'title required' }, 400);
  try {
    await c.env.DB.prepare(
      `INSERT INTO assessment_chapters (game_id, slug, title, description, display_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(game.id, slug, title, b?.description ?? null, Number(b?.display_order) || 0)
      .run();
  } catch {
    return c.json({ error: 'chapter slug already exists in this game' }, 409);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_chapters WHERE game_id = ? AND slug = ?`)
    .bind(game.id, slug)
    .first<any>();
  return c.json({ chapter: row }, 201);
});

adminAssessment.put('/chapters/:id', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];
  for (const col of ['title', 'description', 'display_order']) {
    if (b?.[col] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(b[col]);
    }
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  await c.env.DB.prepare(`UPDATE assessment_chapters SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_chapters WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ chapter: row });
});

adminAssessment.delete('/chapters/:id', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param('id'));
  const itemCount = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM assessment_items WHERE chapter_id = ?`)
    .bind(id)
    .first<any>();
  if ((Number(itemCount?.n) || 0) > 0) {
    return c.json({ error: 'chapter has items; delete them first' }, 409);
  }
  await c.env.DB.prepare(`DELETE FROM assessment_chapters WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ── ITEMS ──────────────────────────────────────────────────────────────────
adminAssessment.post('/games/:slug/items', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const slug = String(b?.slug || '').trim();
  const mechanic = String(b?.mechanic || '').trim();
  const prompt = String(b?.prompt || '').trim();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid slug' }, 400);
  if (!ASSESSMENT_MECHANICS.includes(mechanic as any)) return c.json({ error: 'invalid mechanic' }, 400);
  if (!prompt) return c.json({ error: 'prompt required' }, 400);

  // Resolve chapter by id or slug.
  let chapterId = Number(b?.chapterId ?? b?.chapter_id);
  if (!Number.isFinite(chapterId) && b?.chapterSlug) {
    const ch = await c.env.DB.prepare(`SELECT id FROM assessment_chapters WHERE game_id = ? AND slug = ?`)
      .bind(game.id, String(b.chapterSlug))
      .first<any>();
    chapterId = ch?.id;
  }
  if (!Number.isFinite(chapterId)) return c.json({ error: 'chapterId or chapterSlug required' }, 400);

  try {
    await c.env.DB.prepare(
      `INSERT INTO assessment_items
         (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
      .bind(
        game.id,
        chapterId,
        slug,
        mechanic,
        prompt,
        b?.subprompt ?? null,
        JSON.stringify(b?.options ?? {}),
        JSON.stringify(b?.measures ?? {}),
        JSON.stringify(b?.loads ?? {}),
        JSON.stringify(b?.config ?? {}),
        Number(b?.display_order) || 0,
      )
      .run();
  } catch {
    return c.json({ error: 'item slug already exists' }, 409);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_items WHERE slug = ?`).bind(slug).first<any>();
  return c.json({ item: shapeItem(row) }, 201);
});

adminAssessment.put('/items/:id', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];
  for (const col of ['prompt', 'subprompt', 'display_order']) {
    if (b?.[col] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(b[col]);
    }
  }
  if (b?.mechanic !== undefined) {
    if (!ASSESSMENT_MECHANICS.includes(b.mechanic)) return c.json({ error: 'invalid mechanic' }, 400);
    sets.push('mechanic = ?');
    vals.push(b.mechanic);
  }
  for (const [col, key] of [
    ['options_json', 'options'],
    ['measures_json', 'measures'],
    ['loads_json', 'loads'],
    ['config_json', 'config'],
  ] as const) {
    if (b?.[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(JSON.stringify(b[key] ?? {}));
    }
  }
  if (b?.is_active !== undefined) {
    sets.push('is_active = ?');
    vals.push(b.is_active ? 1 : 0);
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  await c.env.DB.prepare(`UPDATE assessment_items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_items WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ item: shapeItem(row) });
});

adminAssessment.delete('/items/:id', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param('id'));
  // Hard-delete only if never answered; otherwise soft-deactivate to preserve
  // historical results' interpretability.
  const used = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM assessment_responses WHERE item_id = ?`)
    .bind(id)
    .first<any>();
  if ((Number(used?.n) || 0) > 0) {
    await c.env.DB.prepare(`UPDATE assessment_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
      .bind(id)
      .run();
    return c.json({ ok: true, deactivated: true });
  }
  await c.env.DB.prepare(`DELETE FROM assessment_items WHERE id = ?`).bind(id).run();
  return c.json({ ok: true, deleted: true });
});

// ── ARCHETYPES ───────────────────────────────────────────────────────────--
adminAssessment.post('/games/:slug/archetypes', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const slug = String(b?.slug || '').trim();
  const label = String(b?.label || '').trim();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid slug' }, 400);
  if (!label) return c.json({ error: 'label required' }, 400);
  try {
    await c.env.DB.prepare(
      `INSERT INTO assessment_archetypes
         (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        game.id,
        game.track,
        slug,
        label,
        b?.tagline ?? null,
        b?.description ?? null,
        JSON.stringify(b?.centroid ?? {}),
        b?.badge_slug ?? null,
        Number(b?.display_order) || 0,
      )
      .run();
  } catch {
    return c.json({ error: 'archetype slug already exists' }, 409);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_archetypes WHERE slug = ?`).bind(slug).first<any>();
  return c.json({ archetype: { ...row, centroid: parseJSON(row.centroid_json, {}) } }, 201);
});

adminAssessment.put('/archetypes/:id', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];
  for (const col of ['label', 'tagline', 'description', 'badge_slug', 'display_order']) {
    if (b?.[col] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(b[col]);
    }
  }
  if (b?.centroid !== undefined) {
    sets.push('centroid_json = ?');
    vals.push(JSON.stringify(b.centroid ?? {}));
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  await c.env.DB.prepare(`UPDATE assessment_archetypes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_archetypes WHERE id = ?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ archetype: { ...row, centroid: parseJSON(row.centroid_json, {}) } });
});

adminAssessment.delete('/archetypes/:id', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  await c.env.DB.prepare(`DELETE FROM assessment_archetypes WHERE id = ?`).bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ── BADGES ──────────────────────────────────────────────────────────────────
adminAssessment.get('/badges', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const res = await c.env.DB.prepare(`SELECT * FROM assessment_badges ORDER BY display_order, id`).all<any>();
  return c.json({
    badges: (res.results || []).map((b) => ({ ...b, criteria: parseJSON(b.criteria_json, {}), is_active: !!b.is_active })),
  });
});

adminAssessment.post('/badges', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const b = await c.req.json().catch(() => ({}));
  const slug = String(b?.slug || '').trim();
  const label = String(b?.label || '').trim();
  const kind = String(b?.kind || 'milestone').trim();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid slug' }, 400);
  if (!label) return c.json({ error: 'label required' }, 400);
  if (!BADGE_KINDS.includes(kind as any)) return c.json({ error: 'invalid kind' }, 400);
  try {
    await c.env.DB.prepare(
      `INSERT INTO assessment_badges (slug, label, description, kind, icon, criteria_json, xp_reward, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
      .bind(
        slug,
        label,
        b?.description ?? null,
        kind,
        b?.icon ?? null,
        JSON.stringify(b?.criteria ?? {}),
        Number(b?.xp_reward) || 0,
        Number(b?.display_order) || 0,
      )
      .run();
  } catch {
    return c.json({ error: 'badge slug already exists' }, 409);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_badges WHERE slug = ?`).bind(slug).first<any>();
  return c.json({ badge: { ...row, criteria: parseJSON(row.criteria_json, {}) } }, 201);
});

adminAssessment.put('/badges/:slug', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const slug = c.req.param('slug');
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];
  for (const col of ['label', 'description', 'icon', 'xp_reward', 'display_order']) {
    if (b?.[col] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(b[col]);
    }
  }
  if (b?.kind !== undefined) {
    if (!BADGE_KINDS.includes(b.kind)) return c.json({ error: 'invalid kind' }, 400);
    sets.push('kind = ?');
    vals.push(b.kind);
  }
  if (b?.criteria !== undefined) {
    sets.push('criteria_json = ?');
    vals.push(JSON.stringify(b.criteria ?? {}));
  }
  if (b?.is_active !== undefined) {
    sets.push('is_active = ?');
    vals.push(b.is_active ? 1 : 0);
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  vals.push(slug);
  await c.env.DB.prepare(`UPDATE assessment_badges SET ${sets.join(', ')} WHERE slug = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_badges WHERE slug = ?`).bind(slug).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ badge: { ...row, criteria: parseJSON(row.criteria_json, {}) } });
});

adminAssessment.delete('/badges/:slug', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  await c.env.DB.prepare(`DELETE FROM assessment_badges WHERE slug = ?`).bind(c.req.param('slug')).run();
  return c.json({ ok: true });
});

// ── PREVIEW (plays without writing results) ──────────────────────────────--
adminAssessment.post('/games/:slug/preview', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const rawResponses: any[] = Array.isArray(b?.responses) ? b.responses : [];

  const itemsRes = await c.env.DB.prepare(
    `SELECT * FROM assessment_items WHERE game_id = ? AND is_active = 1`,
  )
    .bind(game.id)
    .all<any>();
  const items: ScoringItem[] = (itemsRes.results || []).map((i) => ({
    id: i.id,
    slug: i.slug,
    mechanic: i.mechanic,
    options: parseJSON(i.options_json, {}),
    measures: parseJSON(i.measures_json, {}),
    loads: parseJSON(i.loads_json, {}),
    config: parseJSON(i.config_json, {}),
  }));
  const bySlug = new Map(items.map((i) => [i.slug || '', i.id]));

  const responses: ScoringResponse[] = rawResponses.map((r) => ({
    item_id: Number.isFinite(Number(r?.itemId ?? r?.item_id))
      ? Number(r?.itemId ?? r?.item_id)
      : bySlug.get(String(r?.itemSlug ?? r?.item_slug)) ?? -1,
    response: r?.response ?? {},
    latency_ms: r?.latencyMs ?? r?.latency_ms ?? null,
    confidence_wager: r?.confidenceWager ?? r?.confidence_wager ?? null,
  }));

  const scored = computeAssessment(items, responses);
  const archRes = await c.env.DB.prepare(
    `SELECT slug, label, badge_slug, centroid_json, display_order FROM assessment_archetypes WHERE game_id = ? ORDER BY display_order, id`,
  )
    .bind(game.id)
    .all<any>();
  const archetypes: ArchetypeDef[] = (archRes.results || []).map((a) => ({
    slug: a.slug,
    label: a.label,
    badge_slug: a.badge_slug,
    display_order: a.display_order,
    centroid: parseJSON(a.centroid_json, {}),
  }));
  const archetype = assignArchetype(archetypes, {
    valueVector: scored.valueVector,
    skillVector: scored.skillVector,
  });
  return c.json({ preview: true, ...scored, archetype });
});

// ── ANALYTICS ──────────────────────────────────────────────────────────────
adminAssessment.get('/games/:slug/analytics', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const game = await gameBySlug(c.env, c.req.param('slug'));
  if (!game) return c.json({ error: 'not found' }, 404);

  const sessions = await c.env.DB.prepare(
    `SELECT
        COUNT(*) AS started,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM assessment_sessions WHERE game_id = ?`,
  )
    .bind(game.id)
    .first<any>();
  const started = Number(sessions?.started) || 0;
  const completed = Number(sessions?.completed) || 0;

  // Per-chapter drop-off: how many sessions answered at least one item per chapter.
  const perChapter = await c.env.DB.prepare(
    `SELECT c.slug AS chapter_slug, c.title AS chapter_title, c.display_order,
            COUNT(DISTINCT r.session_id) AS sessions_reached
       FROM assessment_chapters c
       LEFT JOIN assessment_items i ON i.chapter_id = c.id
       LEFT JOIN assessment_responses r ON r.item_id = i.id
      WHERE c.game_id = ?
      GROUP BY c.id ORDER BY c.display_order, c.id`,
  )
    .bind(game.id)
    .all<any>();

  // Archetype distribution.
  const archDist = await c.env.DB.prepare(
    `SELECT archetype_slug, COUNT(*) AS n FROM assessment_results
      WHERE game_id = ? AND archetype_slug IS NOT NULL
      GROUP BY archetype_slug ORDER BY n DESC`,
  )
    .bind(game.id)
    .all<any>();

  // 8-axis coverage + median latency from response/result rows.
  const resultRows = await c.env.DB.prepare(
    `SELECT skill_vector_json FROM assessment_results WHERE game_id = ?`,
  )
    .bind(game.id)
    .all<any>();
  const axisCoverage: Record<string, number> = {};
  for (const row of resultRows.results || []) {
    const sv = parseJSON<Record<string, number>>(row.skill_vector_json, {});
    for (const axis of Object.keys(sv)) axisCoverage[axis] = (axisCoverage[axis] || 0) + 1;
  }

  const latRows = await c.env.DB.prepare(
    `SELECT r.latency_ms FROM assessment_responses r
       JOIN assessment_sessions s ON s.id = r.session_id
      WHERE s.game_id = ? AND r.latency_ms IS NOT NULL
      ORDER BY r.latency_ms`,
  )
    .bind(game.id)
    .all<any>();
  const lats = (latRows.results || []).map((r) => Number(r.latency_ms)).filter((n) => Number.isFinite(n));
  const medianLatency = lats.length
    ? lats.length % 2
      ? lats[(lats.length - 1) / 2]
      : Math.round((lats[lats.length / 2 - 1] + lats[lats.length / 2]) / 2)
    : null;

  return c.json({
    game: game.slug,
    sessions: { started, completed, completion_rate: started ? Math.round((completed / started) * 100) : 0 },
    per_chapter: (perChapter.results || []).map((r) => ({
      chapter_slug: r.chapter_slug,
      chapter_title: r.chapter_title,
      sessions_reached: Number(r.sessions_reached) || 0,
    })),
    archetype_distribution: (archDist.results || []).map((r) => ({ slug: r.archetype_slug, count: Number(r.n) || 0 })),
    axis_coverage: axisCoverage,
    median_latency_ms: medianLatency,
  });
});

// ── ADMIN RE-SCORE ──────────────────────────────────────────────────────--
adminAssessment.post('/sessions/:id/rescore', async (c) => {
  const u = await admin(c);
  if (u instanceof Response) return u;
  const session = await c.env.DB.prepare(`SELECT * FROM assessment_sessions WHERE public_id = ?`)
    .bind(c.req.param('id'))
    .first<any>();
  if (!session) return c.json({ error: 'not found' }, 404);
  const game = await c.env.DB.prepare(`SELECT * FROM assessment_games WHERE id = ?`)
    .bind(session.game_id)
    .first<any>();
  if (!game) return c.json({ error: 'game not found' }, 404);

  const itemsRes = await c.env.DB.prepare(
    `SELECT * FROM assessment_items WHERE game_id = ? AND is_active = 1`,
  )
    .bind(session.game_id)
    .all<any>();
  const items: ScoringItem[] = (itemsRes.results || []).map((i) => ({
    id: i.id,
    slug: i.slug,
    mechanic: i.mechanic,
    options: parseJSON(i.options_json, {}),
    measures: parseJSON(i.measures_json, {}),
    loads: parseJSON(i.loads_json, {}),
    config: parseJSON(i.config_json, {}),
  }));
  const respRes = await c.env.DB.prepare(
    `SELECT item_id, mechanic, response_json, response_value, latency_ms, confidence_wager
       FROM assessment_responses WHERE session_id = ?`,
  )
    .bind(session.id)
    .all<any>();
  const responses: ScoringResponse[] = (respRes.results || []).map((r) => ({
    item_id: r.item_id,
    mechanic: r.mechanic,
    response: parseJSON(r.response_json, {}),
    response_value: r.response_value,
    latency_ms: r.latency_ms,
    confidence_wager: r.confidence_wager,
  }));

  const scored = computeAssessment(items, responses);
  const archRes = await c.env.DB.prepare(
    `SELECT slug, label, badge_slug, centroid_json, display_order FROM assessment_archetypes WHERE game_id = ? ORDER BY display_order, id`,
  )
    .bind(session.game_id)
    .all<any>();
  const archetypes: ArchetypeDef[] = (archRes.results || []).map((a) => ({
    slug: a.slug,
    label: a.label,
    badge_slug: a.badge_slug,
    display_order: a.display_order,
    centroid: parseJSON(a.centroid_json, {}),
  }));
  const archetype = assignArchetype(archetypes, {
    valueVector: scored.valueVector,
    skillVector: scored.skillVector,
  });
  const integrityHash = await signResult(c.env, {
    userId: session.user_id,
    sessionId: session.id,
    track: game.track,
    valueVector: scored.valueVector,
    skillVector: scored.skillVector,
    archetypeSlug: archetype?.slug ?? null,
    integrityVersion: ASSESSMENT_INTEGRITY_VERSION,
  });

  await c.env.DB.prepare(
    `UPDATE assessment_results SET
        value_vector_json = ?, skill_vector_json = ?, confidence_json = ?, flags_json = ?,
        archetype_slug = ?, archetype_label = ?, integrity_hash = ?, integrity_version = ?,
        updated_at = datetime('now')
      WHERE session_id = ?`,
  )
    .bind(
      JSON.stringify(scored.valueVector),
      JSON.stringify(scored.skillVector),
      JSON.stringify(scored.confidence),
      JSON.stringify(scored.flags),
      archetype?.slug ?? null,
      archetype?.label ?? null,
      integrityHash,
      ASSESSMENT_INTEGRITY_VERSION,
      session.id,
    )
    .run();

  return c.json({
    rescored: true,
    track: game.track,
    investor_track: game.track === INVESTOR_TRACK,
    value_vector: scored.valueVector,
    skill_vector: scored.skillVector,
    confidence: scored.confidence,
    flags: scored.flags,
    archetype,
  });
});

export default adminAssessment;
