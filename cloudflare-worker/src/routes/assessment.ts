/**
 * Task #44 — Gamified Assessment: authenticated player routes (design §7.1).
 *
 * Mounted at /api/assessment (see index.ts). Every handler is behind requireAuth
 * (wrapped so a missing session returns a clean 401 even outside the global
 * onError, e.g. in unit tests) and lazily calls ensureAssessmentSchema() on
 * first hit. Each method maps 1:1 to a frontend/src/lib/api.js `assessment.*`
 * method (the api-drift guard checks this prefix).
 *
 * Player surface:
 *   GET  /games                       — published games (caller's track first)
 *   POST /sessions                    — start or resume a session for a gameSlug
 *   GET  /sessions/:id                — session state (status, progress)
 *   GET  /sessions/:id/next           — next item to render, or { done }
 *   POST /sessions/:id/respond        — submit one answer (idempotent upsert)
 *   POST /sessions/:id/complete       — compute → persist → upsert → xp → badges
 *   GET  /results/me                  — caller's latest result per track
 *   GET  /results/:userId             — another user's result (consent-gated)
 *   POST /results/publish             — toggle consent to share caller's result
 *   GET  /badges/me                   — caller's badges + xp / level
 *
 * The scoring math lives in services/assessmentScoring.ts (pure); this layer
 * loads rows, calls it, persists + signs, and runs the §7.3 side-effects.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureAssessmentSchema, INVESTOR_TRACK } from '../services/assessmentSchema';
import {
  computeAssessment,
  assignArchetype,
  signResult,
  verifyResult,
  levelForXp,
  ASSESSMENT_INTEGRITY_VERSION,
  type ScoringItem,
  type ScoringResponse,
  type ArchetypeDef,
} from '../services/assessmentScoring';
import { getTaxonomyVersion, ensureTaxonomyVersionColumns } from '../services/taxonomyVersion';

const assessment = new Hono<{ Bindings: Env }>();

assessment.use('*', async (c, next) => {
  await ensureAssessmentSchema(c.env);
  await next();
});

async function auth(c: any): Promise<User | Response> {
  try {
    return await requireAuth(c);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
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

// Map an app role to the game.target_role we want to float to the top of /games.
const ROLE_TO_TARGET: Record<string, string> = {
  founder: 'founder',
  investor: 'investor_lp',
  partner: 'partner',
};

/** Strip authored `loads` from options before sending an item to the player. */
function stripLoadsForPlay(options: any): any {
  const clone = JSON.parse(JSON.stringify(options ?? {}));
  for (const arrKey of ['options', 'cards', 'buckets']) {
    if (Array.isArray(clone[arrKey])) {
      clone[arrKey] = clone[arrKey].map((o: any) => {
        const { loads, ...rest } = o || {};
        return rest;
      });
    }
  }
  return clone;
}

interface ItemRow {
  id: number;
  chapter_id: number;
  slug: string;
  mechanic: string;
  prompt: string;
  subprompt: string | null;
  options_json: string;
  measures_json: string;
  loads_json: string;
  config_json: string;
  display_order: number;
  chapter_slug?: string;
  chapter_title?: string;
}

async function loadGameBySlug(env: Env, slug: string, publishedOnly: boolean): Promise<any | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM assessment_games WHERE slug = ?${publishedOnly ? " AND status = 'published'" : ''}`,
  )
    .bind(slug)
    .first<any>();
  return row || null;
}

async function loadActiveItems(env: Env, gameId: number): Promise<ItemRow[]> {
  const res = await env.DB.prepare(
    `SELECT i.*, c.slug AS chapter_slug, c.title AS chapter_title, c.display_order AS chapter_order
       FROM assessment_items i
       JOIN assessment_chapters c ON c.id = i.chapter_id
      WHERE i.game_id = ? AND i.is_active = 1
      ORDER BY c.display_order, i.display_order, i.id`,
  )
    .bind(gameId)
    .all<ItemRow>();
  return res.results || [];
}

function toScoringItem(row: ItemRow): ScoringItem {
  return {
    id: row.id,
    slug: row.slug,
    mechanic: row.mechanic,
    options: parseJSON(row.options_json, {}),
    measures: parseJSON(row.measures_json, {}),
    loads: parseJSON(row.loads_json, {}),
    config: parseJSON(row.config_json, {}),
  };
}

async function sessionByPublicId(env: Env, publicId: string): Promise<any | null> {
  const row = await env.DB.prepare(`SELECT * FROM assessment_sessions WHERE public_id = ?`)
    .bind(publicId)
    .first<any>();
  return row || null;
}

function shapeResult(row: any, verified: boolean | null = null): any {
  return {
    session_id: row.session_id,
    user_id: row.user_id,
    track: row.track,
    value_vector: parseJSON(row.value_vector_json, {}),
    skill_vector: parseJSON(row.skill_vector_json, {}),
    confidence: parseJSON(row.confidence_json, {}),
    flags: parseJSON(row.flags_json, []),
    archetype_slug: row.archetype_slug || null,
    archetype_label: row.archetype_label || null,
    xp_awarded: Number(row.xp_awarded) || 0,
    integrity_version: Number(row.integrity_version) || ASSESSMENT_INTEGRITY_VERSION,
    published: !!row.published,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(verified === null ? {} : { verified }),
  };
}

// ── GET /games ───────────────────────────────────────────────────────────--
assessment.get('/games', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const res = await c.env.DB.prepare(
    `SELECT slug, track, title, subtitle, description, target_role, theme_json, display_order
       FROM assessment_games WHERE status = 'published' ORDER BY display_order, id`,
  ).all<any>();
  const games = (res.results || []).map((g) => ({
    slug: g.slug,
    track: g.track,
    title: g.title,
    subtitle: g.subtitle,
    description: g.description,
    target_role: g.target_role,
    theme: parseJSON(g.theme_json, {}),
  }));
  const preferred = ROLE_TO_TARGET[user.role];
  if (preferred) {
    games.sort((a, b) => (b.target_role === preferred ? 1 : 0) - (a.target_role === preferred ? 1 : 0));
  }
  return c.json({ games });
});

// ── POST /sessions ──────────────────────────────────────────────────────--
assessment.post('/sessions', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const body = await c.req.json().catch(() => ({}));
  const gameSlug = String(body?.gameSlug || body?.game_slug || '').trim();
  if (!gameSlug) return c.json({ error: 'gameSlug required' }, 400);

  const game = await loadGameBySlug(c.env, gameSlug, true);
  if (!game) return c.json({ error: 'game not found' }, 404);

  // Resume an in-progress session for this user+game if one exists.
  const existing = await c.env.DB.prepare(
    `SELECT * FROM assessment_sessions
      WHERE user_id = ? AND game_id = ? AND status = 'in_progress'
      ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(user.id, game.id)
    .first<any>();
  if (existing) {
    return c.json({ public_id: existing.public_id, resumed: true, status: existing.status });
  }

  const publicId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO assessment_sessions (public_id, user_id, game_id, game_slug, game_version, status)
     VALUES (?, ?, ?, ?, ?, 'in_progress')`,
  )
    .bind(publicId, user.id, game.id, game.slug, Number(game.version) || 1)
    .run();
  return c.json({ public_id: publicId, resumed: false, status: 'in_progress' });
});

// ── GET /sessions/:id ──────────────────────────────────────────────────--
assessment.get('/sessions/:id', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const session = await sessionByPublicId(c.env, c.req.param('id'));
  if (!session || session.user_id !== user.id) return c.json({ error: 'not found' }, 404);

  const items = await loadActiveItems(c.env, session.game_id);
  const answered = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM assessment_responses WHERE session_id = ?`,
  )
    .bind(session.id)
    .first<any>();
  return c.json({
    public_id: session.public_id,
    game_slug: session.game_slug,
    status: session.status,
    progress: { answered: Number(answered?.n) || 0, total: items.length },
    started_at: session.started_at,
    completed_at: session.completed_at,
  });
});

// ── GET /sessions/:id/next ─────────────────────────────────────────────--
assessment.get('/sessions/:id/next', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const session = await sessionByPublicId(c.env, c.req.param('id'));
  if (!session || session.user_id !== user.id) return c.json({ error: 'not found' }, 404);

  const items = await loadActiveItems(c.env, session.game_id);
  const answeredRes = await c.env.DB.prepare(
    `SELECT item_id FROM assessment_responses WHERE session_id = ?`,
  )
    .bind(session.id)
    .all<any>();
  const answered = new Set((answeredRes.results || []).map((r) => r.item_id));
  const next = items.find((it) => !answered.has(it.id));
  if (!next) {
    return c.json({ done: true, answered: answered.size, total: items.length });
  }
  return c.json({
    done: false,
    answered: answered.size,
    total: items.length,
    item: {
      id: next.id,
      slug: next.slug,
      mechanic: next.mechanic,
      prompt: next.prompt,
      subprompt: next.subprompt,
      chapter: { slug: next.chapter_slug, title: next.chapter_title },
      options: stripLoadsForPlay(parseJSON(next.options_json, {})),
      config: parseJSON(next.config_json, {}),
    },
  });
});

// ── POST /sessions/:id/respond ─────────────────────────────────────────--
assessment.post('/sessions/:id/respond', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const session = await sessionByPublicId(c.env, c.req.param('id'));
  if (!session || session.user_id !== user.id) return c.json({ error: 'not found' }, 404);
  if (session.status !== 'in_progress') return c.json({ error: 'session not in progress' }, 409);

  const body = await c.req.json().catch(() => ({}));
  const itemId = Number(body?.itemId ?? body?.item_id);
  if (!Number.isFinite(itemId)) return c.json({ error: 'itemId required' }, 400);

  const item = await c.env.DB.prepare(
    `SELECT id, chapter_id, slug, mechanic FROM assessment_items
      WHERE id = ? AND game_id = ? AND is_active = 1`,
  )
    .bind(itemId, session.game_id)
    .first<any>();
  if (!item) return c.json({ error: 'item not found in this game' }, 404);

  const response = body?.response ?? {};
  const latencyMs = body?.latencyMs ?? body?.latency_ms;
  const wager = body?.confidenceWager ?? body?.confidence_wager;
  const responseValue = body?.responseValue ?? body?.response_value;

  await c.env.DB.prepare(
    `INSERT INTO assessment_responses
       (session_id, item_id, user_id, item_slug, mechanic, response_json, response_value, confidence_wager, latency_ms, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(session_id, item_id) DO UPDATE SET
       response_json = excluded.response_json,
       response_value = excluded.response_value,
       confidence_wager = excluded.confidence_wager,
       latency_ms = excluded.latency_ms,
       updated_at = datetime('now')`,
  )
    .bind(
      session.id,
      itemId,
      user.id,
      item.slug,
      item.mechanic,
      JSON.stringify(response ?? {}),
      responseValue == null ? null : Number(responseValue),
      wager == null ? null : Number(wager),
      latencyMs == null ? null : Number(latencyMs),
    )
    .run();

  const items = await loadActiveItems(c.env, session.game_id);
  const answered = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM assessment_responses WHERE session_id = ?`,
  )
    .bind(session.id)
    .first<any>();
  const answeredN = Number(answered?.n) || 0;
  await c.env.DB.prepare(
    `UPDATE assessment_sessions
        SET current_item_id = ?, current_chapter_id = ?,
            progress_json = ?, updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(itemId, item.chapter_id, JSON.stringify({ answered: answeredN, total: items.length }), session.id)
    .run();

  return c.json({ ok: true, answered: answeredN, total: items.length });
});

// ── Completion side-effects (design §7.3) ─────────────────────────────────--

/** Best-effort canonical write into user_values / user_skills. */
async function writeCanonical(
  env: Env,
  userId: number,
  valueVector: Record<string, number>,
  skillVector: Record<string, number>,
  confidence: Record<string, number>,
): Promise<void> {
  try {
    const taxv = await getTaxonomyVersion(env);
    await ensureTaxonomyVersionColumns(env);

    const valueSlugs = Object.keys(valueVector);
    if (valueSlugs.length) {
      const placeholders = valueSlugs.map(() => '?').join(',');
      const dims = await env.DB.prepare(
        `SELECT id, slug FROM value_dimensions WHERE slug IN (${placeholders})`,
      )
        .bind(...valueSlugs)
        .all<any>();
      for (const d of dims.results || []) {
        await env.DB.prepare(
          `INSERT INTO user_values (user_id, dimension_id, score, confidence, taxonomy_version, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id, dimension_id) DO UPDATE SET
             score = excluded.score,
             confidence = excluded.confidence,
             taxonomy_version = excluded.taxonomy_version,
             updated_at = excluded.updated_at`,
        )
          .bind(userId, d.id, valueVector[d.slug], confidence[d.slug] ?? null, taxv)
          .run();
      }
    }

    const skillAxes = Object.keys(skillVector);
    for (const axis of skillAxes) {
      // Map an axis signal to its representative skill (lowest display_order in
      // the category) and UPSERT self_level, NEVER lowering an existing level.
      const skill = await env.DB.prepare(
        `SELECT id FROM skills WHERE category_slug = ? AND is_active = 1
          ORDER BY display_order, id LIMIT 1`,
      )
        .bind(axis)
        .first<any>();
      if (!skill) continue;
      await env.DB.prepare(
        `INSERT INTO user_skills (user_id, skill_id, self_level, taxonomy_version, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, skill_id) DO UPDATE SET
           self_level = MAX(user_skills.self_level, excluded.self_level),
           taxonomy_version = excluded.taxonomy_version,
           updated_at = datetime('now')`,
      )
        .bind(userId, skill.id, skillVector[axis], taxv)
        .run();
    }
  } catch (err) {
    console.warn('[assessment] canonical UPSERT failed (best-effort)', err);
  }
}

/** Best-effort investor_profiles UPSERT for the investor_lp track. */
async function writeInvestorProfile(
  env: Env,
  userId: number,
  valueVector: Record<string, number>,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO investor_profiles (user_id, value_weights_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         value_weights_json = excluded.value_weights_json,
         updated_at = excluded.updated_at`,
    )
      .bind(userId, JSON.stringify(valueVector))
      .run();
  } catch (err) {
    console.warn('[assessment] investor_profiles UPSERT failed (best-effort)', err);
  }
}

// ── POST /sessions/:id/complete ───────────────────────────────────────────--
assessment.post('/sessions/:id/complete', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const session = await sessionByPublicId(c.env, c.req.param('id'));
  if (!session || session.user_id !== user.id) return c.json({ error: 'not found' }, 404);

  // Idempotent on UNIQUE(session_id): return the already-computed result.
  const existing = await c.env.DB.prepare(
    `SELECT * FROM assessment_results WHERE session_id = ?`,
  )
    .bind(session.id)
    .first<any>();
  if (existing) {
    const ok = await verifyResult(
      c.env,
      {
        userId: existing.user_id,
        sessionId: existing.session_id,
        track: existing.track,
        valueVector: parseJSON(existing.value_vector_json, {}),
        skillVector: parseJSON(existing.skill_vector_json, {}),
        archetypeSlug: existing.archetype_slug || null,
        integrityVersion: Number(existing.integrity_version) || ASSESSMENT_INTEGRITY_VERSION,
      },
      existing.integrity_hash,
    );
    return c.json({ result: shapeResult(existing, ok), idempotent: true });
  }

  const game = await c.env.DB.prepare(`SELECT * FROM assessment_games WHERE id = ?`)
    .bind(session.game_id)
    .first<any>();
  if (!game) return c.json({ error: 'game not found' }, 404);

  const itemRows = await loadActiveItems(c.env, session.game_id);
  const scoringItems: ScoringItem[] = itemRows.map(toScoringItem);
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

  const { valueVector, skillVector, confidence, flags } = computeAssessment(scoringItems, responses);

  // Archetype (§5) — nearest centroid over shared dims.
  const archRes = await c.env.DB.prepare(
    `SELECT slug, label, badge_slug, centroid_json, display_order
       FROM assessment_archetypes WHERE game_id = ? ORDER BY display_order, id`,
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
  const archetype = assignArchetype(archetypes, { valueVector, skillVector });

  // Sign the canonical result (§8).
  const integrityHash = await signResult(c.env, {
    userId: user.id,
    sessionId: session.id,
    track: game.track,
    valueVector,
    skillVector,
    archetypeSlug: archetype?.slug ?? null,
    integrityVersion: ASSESSMENT_INTEGRITY_VERSION,
  });

  // Is this the user's first completed result (for first_steps)?
  const priorCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM assessment_results WHERE user_id = ?`,
  )
    .bind(user.id)
    .first<any>();
  const isFirst = (Number(priorCount?.n) || 0) === 0;

  // Award badges (idempotent) and tally newly-granted XP.
  const toAward: string[] = [];
  if (archetype?.badge_slug) toAward.push(archetype.badge_slug);
  const milestoneRes = await c.env.DB.prepare(
    `SELECT slug, criteria_json, xp_reward FROM assessment_badges
      WHERE kind = 'milestone' AND is_active = 1`,
  ).all<any>();
  const milestoneXp = new Map<string, number>();
  for (const m of milestoneRes.results || []) {
    const crit = parseJSON<any>(m.criteria_json, {});
    if (crit.event === 'first_assessment_complete' && isFirst) {
      toAward.push(m.slug);
    } else if (crit.event === 'game_complete' && crit.track === game.track) {
      toAward.push(m.slug);
    }
    milestoneXp.set(m.slug, Number(m.xp_reward) || 0);
  }

  let gainedXp = 0;
  for (const slug of toAward) {
    const ins = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO user_badges (user_id, badge_slug, source) VALUES (?, ?, 'assessment')`,
    )
      .bind(user.id, slug)
      .run();
    if (ins.meta?.changes && ins.meta.changes > 0) {
      let xp = milestoneXp.get(slug);
      if (xp == null) {
        const b = await c.env.DB.prepare(`SELECT xp_reward FROM assessment_badges WHERE slug = ?`)
          .bind(slug)
          .first<any>();
        xp = Number(b?.xp_reward) || 0;
      }
      gainedXp += xp;
    }
  }

  // Bump user_xp + derived level.
  const xpRow = await c.env.DB.prepare(`SELECT xp FROM user_xp WHERE user_id = ?`)
    .bind(user.id)
    .first<any>();
  const newXp = (Number(xpRow?.xp) || 0) + gainedXp;
  const newLevel = levelForXp(newXp);
  await c.env.DB.prepare(
    `INSERT INTO user_xp (user_id, xp, level, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, updated_at = excluded.updated_at`,
  )
    .bind(user.id, newXp, newLevel)
    .run();

  // Persist the result row (idempotent on UNIQUE(session_id)).
  await c.env.DB.prepare(
    `INSERT INTO assessment_results
       (session_id, user_id, game_id, track, value_vector_json, skill_vector_json,
        confidence_json, flags_json, archetype_slug, archetype_label, xp_awarded,
        integrity_hash, integrity_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(session_id) DO NOTHING`,
  )
    .bind(
      session.id,
      user.id,
      session.game_id,
      game.track,
      JSON.stringify(valueVector),
      JSON.stringify(skillVector),
      JSON.stringify(confidence),
      JSON.stringify(flags),
      archetype?.slug ?? null,
      archetype?.label ?? null,
      gainedXp,
      integrityHash,
      ASSESSMENT_INTEGRITY_VERSION,
    )
    .run();

  // Canonical profile writes (best-effort; the result row is the source of truth).
  await writeCanonical(c.env, user.id, valueVector, skillVector, confidence);
  if (game.track === INVESTOR_TRACK) {
    await writeInvestorProfile(c.env, user.id, valueVector);
  }

  // Mark the session completed.
  await c.env.DB.prepare(
    `UPDATE assessment_sessions
        SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(session.id)
    .run();

  const saved = await c.env.DB.prepare(`SELECT * FROM assessment_results WHERE session_id = ?`)
    .bind(session.id)
    .first<any>();
  return c.json({
    result: shapeResult(saved, true),
    xp: { xp: newXp, level: newLevel, gained: gainedXp },
    badges_awarded: toAward,
  });
});

// ── GET /results/me ───────────────────────────────────────────────────────--
assessment.get('/results/me', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  // Latest result per track for the caller.
  const res = await c.env.DB.prepare(
    `SELECT r.* FROM assessment_results r
       JOIN (SELECT track, MAX(updated_at) AS mx FROM assessment_results
              WHERE user_id = ? GROUP BY track) latest
         ON latest.track = r.track AND latest.mx = r.updated_at
      WHERE r.user_id = ?
      ORDER BY r.updated_at DESC`,
  )
    .bind(user.id, user.id)
    .all<any>();
  const results = await Promise.all(
    (res.results || []).map(async (row) => {
      const ok = await verifyResult(
        c.env,
        {
          userId: row.user_id,
          sessionId: row.session_id,
          track: row.track,
          valueVector: parseJSON(row.value_vector_json, {}),
          skillVector: parseJSON(row.skill_vector_json, {}),
          archetypeSlug: row.archetype_slug || null,
          integrityVersion: Number(row.integrity_version) || ASSESSMENT_INTEGRITY_VERSION,
        },
        row.integrity_hash,
      );
      return shapeResult(row, ok);
    }),
  );
  return c.json({ results });
});

// ── GET /results/:userId ─────────────────────────────────────────────────--
assessment.get('/results/:userId', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const targetId = Number(c.req.param('userId'));
  if (!Number.isFinite(targetId)) return c.json({ error: 'invalid user id' }, 400);

  const isSelf = targetId === user.id;
  const isAdmin = user.role === 'admin';
  // Consent gate: another user's results require published = 1.
  const res = await c.env.DB.prepare(
    `SELECT r.* FROM assessment_results r
       JOIN (SELECT track, MAX(updated_at) AS mx FROM assessment_results
              WHERE user_id = ?${isSelf || isAdmin ? '' : ' AND published = 1'} GROUP BY track) latest
         ON latest.track = r.track AND latest.mx = r.updated_at
      WHERE r.user_id = ?${isSelf || isAdmin ? '' : ' AND r.published = 1'}
      ORDER BY r.updated_at DESC`,
  )
    .bind(targetId, targetId)
    .all<any>();
  const results = (res.results || []).map((row) => shapeResult(row));
  return c.json({ user_id: targetId, results });
});

// ── POST /results/publish ─────────────────────────────────────────────────--
assessment.post('/results/publish', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const body = await c.req.json().catch(() => ({}));
  const published = body?.published === undefined ? true : !!body.published;
  const track = body?.track ? String(body.track) : null;

  if (track) {
    await c.env.DB.prepare(
      `UPDATE assessment_results SET published = ?, updated_at = datetime('now')
        WHERE user_id = ? AND track = ?`,
    )
      .bind(published ? 1 : 0, user.id, track)
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE assessment_results SET published = ?, updated_at = datetime('now')
        WHERE user_id = ?`,
    )
      .bind(published ? 1 : 0, user.id)
      .run();
  }
  return c.json({ ok: true, published });
});

// ── GET /badges/me ────────────────────────────────────────────────────────--
assessment.get('/badges/me', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const badgeRes = await c.env.DB.prepare(
    `SELECT ub.badge_slug, ub.source, ub.awarded_at,
            b.label, b.description, b.kind, b.icon, b.xp_reward
       FROM user_badges ub
       LEFT JOIN assessment_badges b ON b.slug = ub.badge_slug
      WHERE ub.user_id = ?
      ORDER BY ub.awarded_at DESC, ub.id DESC`,
  )
    .bind(user.id)
    .all<any>();
  const xpRow = await c.env.DB.prepare(`SELECT xp, level FROM user_xp WHERE user_id = ?`)
    .bind(user.id)
    .first<any>();
  const xp = Number(xpRow?.xp) || 0;
  return c.json({
    xp,
    level: Number(xpRow?.level) || levelForXp(xp),
    badges: (badgeRes.results || []).map((b) => ({
      slug: b.badge_slug,
      label: b.label,
      description: b.description,
      kind: b.kind,
      icon: b.icon,
      xp_reward: Number(b.xp_reward) || 0,
      source: b.source,
      awarded_at: b.awarded_at,
    })),
  });
});

export default assessment;
