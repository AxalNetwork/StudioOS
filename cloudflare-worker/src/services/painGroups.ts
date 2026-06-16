/**
 * Task #29 — Pain-group resolver + schema bootstrap for the Spin-Out Demo
 * Day deck's "PAIN FREQUENCY ACROSS INTERVIEWS" slide.
 *
 * Logged discovery pains are plain strings (discovery_interviews.pains_json).
 * Founders curate them into themes via two tables (see migration 106):
 *   pain_groups        — a named theme (the slide row label) per project.
 *   pain_group_aliases — maps a normalized pain phrase to a group;
 *                        UNIQUE(project_id, phrase_norm) so a phrase belongs
 *                        to exactly one group.
 *
 * A raw pain phrase resolves to a theme by, in order:
 *   1. explicit alias (phrase_norm)   — founder-curated membership.
 *   2. group title_norm exact match   — "reuse a suggested title" path
 *                                        (logging a pain equal to a group
 *                                        title auto-joins it, no alias needed).
 *   3. implicit one-phrase group      — an uncurated phrase is its own theme.
 *
 * The slide ranks themes by the number of DISTINCT interviews that mention
 * them (multiple matching pains in one interview count once), which matches
 * the "n / total interviews" label. Empty real data yields no themes so the
 * deck shows its honest placeholder, never the bundled BASEPOINT sample.
 */
import type { Env } from '../types';

const SCHEMA_READY = new WeakMap<object, boolean>();

/**
 * Normalize a pain phrase for matching. Mirrors the legacy `normTheme`
 * (lower-case, collapse whitespace/punctuation, cap length) so existing
 * clustering behaviour is preserved when no curation exists.
 */
export function normPhrase(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[\s.,!?;:"'`]+/g, ' ')
    .slice(0, 60)
    .trim();
}

export type PainGroupRow = {
  id: number;
  project_id: number;
  title: string;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

type PainAliasRow = {
  id: number;
  project_id: number;
  group_id: number;
  phrase_norm: string;
  display_phrase: string;
};

type InterviewPains = { pains_json: string | null };

export type PainTheme = { theme: string; mentions: number };

export type PainGroupsView = {
  project_id: number;
  interview_total: number;
  groups: Array<{
    id: number;
    title: string;
    sort_order: number;
    count: number;
    phrases: Array<{ phrase_norm: string; display_phrase: string }>;
  }>;
  ungrouped: Array<{ phrase_norm: string; display_phrase: string; count: number }>;
};

export type PainGroupModel = {
  groups: PainGroupRow[];
  aliasByNorm: Map<string, number>; // phrase_norm → group_id
  aliasDisplay: Map<string, string>; // phrase_norm → curated display
  titleNormToGroupId: Map<string, number>;
};

export async function ensurePainGroupsSchema(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (SCHEMA_READY.get(key)) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS pain_groups (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         title TEXT NOT NULL,
         sort_order INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_pain_groups_project ON pain_groups (project_id)`,
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS pain_group_aliases (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         group_id INTEGER NOT NULL REFERENCES pain_groups(id) ON DELETE CASCADE,
         phrase_norm TEXT NOT NULL,
         display_phrase TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_pain_group_aliases_project_phrase
         ON pain_group_aliases (project_id, phrase_norm)`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_pain_group_aliases_group
         ON pain_group_aliases (group_id)`,
    ).run();
    SCHEMA_READY.set(key, true);
  } catch (e) {
    console.warn('[painGroups] schema bootstrap failed', e);
  }
}

function safeParseStrings(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))) : [];
  } catch {
    return [];
  }
}

export async function loadPainGroupModel(env: Env, projectId: number): Promise<PainGroupModel> {
  await ensurePainGroupsSchema(env);
  const groupsRes = await env.DB.prepare(
    `SELECT id, project_id, title, sort_order, created_at, updated_at
       FROM pain_groups WHERE project_id = ? ORDER BY sort_order ASC, id ASC`,
  ).bind(projectId).all<PainGroupRow>().catch(() => ({ results: [] as PainGroupRow[] }));
  const aliasRes = await env.DB.prepare(
    `SELECT id, project_id, group_id, phrase_norm, display_phrase
       FROM pain_group_aliases WHERE project_id = ?`,
  ).bind(projectId).all<PainAliasRow>().catch(() => ({ results: [] as PainAliasRow[] }));

  const groups = groupsRes.results || [];
  const groupIds = new Set(groups.map((g) => g.id));
  const aliasByNorm = new Map<string, number>();
  const aliasDisplay = new Map<string, string>();
  for (const a of aliasRes.results || []) {
    if (!groupIds.has(a.group_id)) continue; // defensive: orphaned alias
    aliasByNorm.set(a.phrase_norm, a.group_id);
    aliasDisplay.set(a.phrase_norm, a.display_phrase);
  }
  const titleNormToGroupId = new Map<string, number>();
  for (const g of groups) {
    const tn = normPhrase(g.title);
    if (tn && !titleNormToGroupId.has(tn)) titleNormToGroupId.set(tn, g.id);
  }
  return { groups, aliasByNorm, aliasDisplay, titleNormToGroupId };
}

type ThemeAccum = {
  key: string; // `g:<id>` or `impl:<norm>`
  title: string;
  groupId: number | null;
  count: number; // distinct interviews
  phrases: Map<string, string>; // phrase_norm → display
};

function resolvePhrase(
  norm: string,
  display: string,
  model: PainGroupModel,
): { key: string; groupId: number | null; title: string } {
  const aliasGid = model.aliasByNorm.get(norm);
  if (aliasGid != null) {
    const g = model.groups.find((x) => x.id === aliasGid);
    if (g) return { key: `g:${g.id}`, groupId: g.id, title: g.title };
  }
  const titleGid = model.titleNormToGroupId.get(norm);
  if (titleGid != null) {
    const g = model.groups.find((x) => x.id === titleGid);
    if (g) return { key: `g:${g.id}`, groupId: g.id, title: g.title };
  }
  return { key: `impl:${norm}`, groupId: null, title: display };
}

type PainAnalysis = { interviewTotal: number; themes: PainTheme[]; view: PainGroupsView };

function analyzePains(
  interviews: InterviewPains[],
  model: PainGroupModel,
  projectId: number,
): PainAnalysis {
  const interviewTotal = interviews.length;
  const acc = new Map<string, ThemeAccum>();
  const ensureAcc = (key: string, title: string, groupId: number | null): ThemeAccum => {
    let a = acc.get(key);
    if (!a) {
      a = { key, title, groupId, count: 0, phrases: new Map() };
      acc.set(key, a);
    }
    return a;
  };

  // Seed curated groups so they appear in the view even with 0 mentions,
  // and seed their explicit alias phrases as members (display may be
  // refined when the phrase is actually seen in an interview below).
  for (const g of model.groups) ensureAcc(`g:${g.id}`, g.title, g.id);
  for (const [norm, gid] of model.aliasByNorm) {
    const a = acc.get(`g:${gid}`);
    if (!a) continue;
    if (!a.phrases.has(norm)) a.phrases.set(norm, model.aliasDisplay.get(norm) || norm);
  }

  for (const it of interviews) {
    const seenKeys = new Set<string>();
    for (const phrase of safeParseStrings(it.pains_json)) {
      const display = phrase.trim();
      if (!display) continue;
      const norm = normPhrase(display);
      if (!norm) continue;
      const r = resolvePhrase(norm, display, model);
      const a = ensureAcc(r.key, r.title, r.groupId);
      a.phrases.set(norm, display);
      if (!seenKeys.has(r.key)) {
        a.count += 1;
        seenKeys.add(r.key);
      }
    }
  }

  const themes = Array.from(acc.values())
    .filter((a) => a.count > 0)
    .sort((x, y) => y.count - x.count || x.title.localeCompare(y.title))
    .map((a) => ({ theme: a.title, mentions: a.count }));

  const groups = model.groups.map((g) => {
    const a = acc.get(`g:${g.id}`);
    const phrases = a
      ? Array.from(a.phrases.entries()).map(([phrase_norm, display_phrase]) => ({
          phrase_norm,
          display_phrase,
        }))
      : [];
    return { id: g.id, title: g.title, sort_order: g.sort_order, count: a ? a.count : 0, phrases };
  });

  const ungrouped = Array.from(acc.values())
    .filter((a) => a.groupId == null)
    .sort((x, y) => y.count - x.count || x.title.localeCompare(y.title))
    .map((a) => ({
      phrase_norm: a.key.slice('impl:'.length),
      display_phrase: a.title,
      count: a.count,
    }));

  return {
    interviewTotal,
    themes,
    view: { project_id: projectId, interview_total: interviewTotal, groups, ungrouped },
  };
}

/**
 * Ranked themes for the deck assembler — `[{theme, mentions}]` where
 * `mentions` is the count of DISTINCT interviews mentioning the theme.
 * Preserves the legacy output shape so the downstream mapper / export /
 * share / print path is unchanged.
 */
export async function computePainThemes(
  env: Env,
  projectId: number,
  interviews: InterviewPains[],
): Promise<PainTheme[]> {
  const model = await loadPainGroupModel(env, projectId);
  return analyzePains(interviews, model, projectId).themes;
}

/**
 * Persist any logged pains that currently resolve to `group` ONLY via its
 * title-norm (path 2, no explicit alias) as explicit aliases. Call this
 * before renaming a group: without it, changing the title silently drops
 * those phrases back to implicit themes, moving the slide's counts even
 * though no interview was edited. No-op when the membership is already
 * explicit or nothing was actually logged against the title.
 */
export async function materializeTitleNormAliases(
  env: Env,
  projectId: number,
  group: { id: number; title: string },
): Promise<void> {
  await ensurePainGroupsSchema(env);
  const oldNorm = normPhrase(group.title);
  if (!oldNorm) return;
  const existing = await env.DB.prepare(
    'SELECT 1 AS hit FROM pain_group_aliases WHERE project_id = ? AND phrase_norm = ? LIMIT 1',
  )
    .bind(projectId, oldNorm)
    .first<{ hit: number }>()
    .catch(() => null);
  if (existing) return; // already curated explicitly — title-norm wasn't load-bearing
  const res = await env.DB.prepare(
    'SELECT pains_json FROM discovery_interviews WHERE project_id = ?',
  )
    .bind(projectId)
    .all<{ pains_json: string | null }>()
    .catch(() => ({ results: [] as { pains_json: string | null }[] }));
  let display: string | null = null;
  for (const row of res.results || []) {
    for (const phrase of safeParseStrings(row.pains_json)) {
      const d = phrase.trim();
      if (d && normPhrase(d) === oldNorm) {
        display = d.slice(0, 200);
        break;
      }
    }
    if (display) break;
  }
  if (!display) return; // nobody logged this title — nothing to preserve
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO pain_group_aliases
       (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, phrase_norm) DO NOTHING`,
  )
    .bind(projectId, group.id, oldNorm, display, nowIso, nowIso)
    .run();
}

/** Structured view for the curation UI: curated groups + ungrouped phrases. */
export async function getPainGroupsView(env: Env, projectId: number): Promise<PainGroupsView> {
  const model = await loadPainGroupModel(env, projectId);
  const res = await env.DB.prepare(
    `SELECT pains_json FROM discovery_interviews WHERE project_id = ?`,
  )
    .bind(projectId)
    .all<{ pains_json: string | null }>()
    .catch(() => ({ results: [] as { pains_json: string | null }[] }));
  return analyzePains(res.results || [], model, projectId).view;
}
