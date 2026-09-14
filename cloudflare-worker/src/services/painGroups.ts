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
// ONE DEFINITION OF WHAT COUNTS AS ICP, imported rather than restated. `isIcp`
// is `strong || partial`, with NULL a fourth state counted apart and an explicit
// `none` a recorded non-customer — a rule whose whole value is that the pain map
// and the hypothesis verdict move together when it changes. A service reaching
// into a `routes/_*.ts` shared module is the pattern `_competitor_writes.ts` and
// `_capital_call_writes.ts` already set; that file imports only `types` and
// `auth`, so there is no cycle back to here.
import { isIcp } from '../routes/_founder_validate_helpers';
import { ensureDiscoveryIcpFitColumn } from './discoveryInterviewSchema';

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

/**
 * One interview, as much of it as the pain map needs.
 *
 * `id`, `icp_fit` and `interview_date` are all OPTIONAL because
 * `computePainThemes` is called by the deck assembler with rows selected
 * elsewhere, and the deck ranks by mention count alone. A caller that omits them
 * gets counts and no attribution rather than a crash — which is why every read
 * of the three below is guarded rather than assumed.
 */
type InterviewPains = {
  pains_json: string | null;
  id?: number;
  icp_fit?: string | null;
  interview_date?: string | null;
};

/**
 * A severity a founder recorded against ONE phrase in ONE interview.
 *
 * Severity is per pain and not per interview, because one conversation names a
 * must-have and a nice-to-have in the same breath — which is why migration 211
 * put it in its own table keyed on `(interview_id, phrase_norm)` rather than as
 * a column on `discovery_interviews`. That table shipped with the shape right
 * and NO READER AND NO WRITER ANYWHERE, which migration 215's header calls out
 * by name as "a column that exists that nothing reads". This is the reader.
 */
export type PainSeverityRow = { interview_id: number; phrase_norm: string; severity: string };

/** The two values a severity may take. Anything else is not recorded. */
export const PAIN_SEVERITIES = ['need', 'nice'] as const;
export type PainSeverity = (typeof PAIN_SEVERITIES)[number];
export const isPainSeverity = (v: unknown): v is PainSeverity =>
  typeof v === 'string' && (PAIN_SEVERITIES as readonly string[]).includes(v);

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
    // How many DISTINCT interviews called this theme a need, and how many
    // called it a nice-to-have. Two counts rather than one verdict: the same
    // pain is a must-have for one segment and an optional for another, and
    // collapsing that to a single label is the judgement the founder is
    // supposed to be making from this page.
    need_count: number;
    nice_count: number;
    // How many DISTINCT interviews mentioning this theme were recorded as ICP
    // (`strong` or `partial`, the rule `isIcp` owns), and how many carry no
    // recorded fit at all. The second is not a footnote: a page narrowing on
    // the first without it would report "this pain is not your customers'"
    // when the truth is "nobody filled the field in".
    icp_count: number;
    fit_unrecorded_count: number;
    // The latest `interview_date` among them, or null when none carries one.
    last_mention_at: string | null;
  }>;
  ungrouped: Array<{
    phrase_norm: string; display_phrase: string; count: number;
    need_count: number; nice_count: number;
    icp_count: number; fit_unrecorded_count: number;
    last_mention_at: string | null;
  }>;
  // Absent, not zero, when nothing has been recorded — so a page can tell "no
  // severity is on file" from "every mention is a nice-to-have". A chip
  // narrowing on severity over the first of those would answer a question the
  // store cannot answer.
  severity_recorded: boolean;
  /**
   * Whether ANY interview on this project carries a recorded `icp_fit`, and
   * whether any carries an `interview_date`.
   *
   * The same guard as `severity_recorded` and for the same reason, one field per
   * chip that needs it. `ICP only` over a project where the field was never
   * filled in shows an empty map, and an empty map is read as a finding; these
   * two let the page say "nothing is on file" instead, which is the true answer.
   *
   * FROM THE ROWS, NOT FROM THE COUNTS. A project whose only ICP interview
   * mentions no pain leaves every theme at `icp_count: 0` while the field is
   * demonstrably in use, and deriving this from the totals would then tell the
   * page the opposite of what is true.
   */
  icp_recorded: boolean;
  dates_recorded: boolean;
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
  // Distinct interviews that recorded a severity against ANY phrase of this
  // theme. Counted per theme rather than per phrase because that is the
  // question the chip row asks — "which of these are need-to-have" is about the
  // theme a reader is looking at, not about one wording of it.
  needInterviews: Set<number>;
  niceInterviews: Set<number>;
  /**
   * Distinct interviews mentioning this theme whose `icp_fit` is ICP, and those
   * whose fit was never recorded.
   *
   * TWO SETS AND NOT ONE RATIO, for the same reason `evidenceFor` keeps
   * `fitUnrecorded` apart from `supporting`: `icp_fit` arrived in migration 161,
   * so every interview logged before it — and every one logged after by someone
   * who skipped the field — carries NULL. Folding those into "not ICP" would
   * make `icp_count` read 0 for a whole project and an `ICP only` chip answer
   * "none of your pains come from your customers", with total confidence, on no
   * evidence at all.
   */
  icpInterviews: Set<number>;
  fitUnknownInterviews: Set<number>;
  /**
   * The latest `interview_date` among the interviews mentioning this theme, or
   * null when none of them carries one.
   *
   * THE INTERVIEW'S DATE, NOT THE THEME'S, and the distinction is the whole
   * reason this field can exist at all. A theme has no date of its own — a
   * founder renames one months after the conversations behind it — so "recent"
   * here means "somebody said this to us recently", which is the question a
   * founder ordering a pain map is actually asking. `created_at` is deliberately
   * NOT the fallback: it is when the row was typed up, and a backfilled batch of
   * old interviews would all read as today.
   */
  lastMentionAt: string | null;
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
  severities: PainSeverityRow[] = [],
): PainAnalysis {
  const interviewTotal = interviews.length;
  const acc = new Map<string, ThemeAccum>();
  const ensureAcc = (key: string, title: string, groupId: number | null): ThemeAccum => {
    let a = acc.get(key);
    if (!a) {
      a = {
        key, title, groupId, count: 0, phrases: new Map(),
        needInterviews: new Set(), niceInterviews: new Set(),
        icpInterviews: new Set(), fitUnknownInterviews: new Set(),
        lastMentionAt: null,
      };
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

  // `(interview_id, phrase_norm)` → severity, which is the table's own unique
  // index, so at most one row can reach this map per pair.
  const sevBy = new Map<string, string>();
  for (const r of severities) sevBy.set(`${r.interview_id}\u0000${r.phrase_norm}`, r.severity);

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
        // ATTRIBUTION RIDES THE SAME FIRST-SIGHT BRANCH AS `count`, so the three
        // numbers cannot disagree about how many interviews are behind a theme.
        // One interviewee naming it three ways counts once for all of them.
        if (it.id != null) {
          if (isIcp(it.icp_fit)) a.icpInterviews.add(it.id);
          else if (it.icp_fit == null) a.fitUnknownInterviews.add(it.id);
        }
        // A STRING COMPARE, DELIBERATELY. `interview_date` is stored as
        // `YYYY-MM-DD` text, which sorts lexicographically in exactly date
        // order, and `Date.parse` on a bare date string is the UTC-versus-local
        // trap this repo has already been bitten by. A malformed value sorts
        // somewhere harmless rather than becoming `NaN` and poisoning the max.
        const d = typeof it.interview_date === 'string' ? it.interview_date.trim() : '';
        if (d && (a.lastMentionAt == null || d > a.lastMentionAt)) a.lastMentionAt = d;
      }
      // A SEVERITY IS AGAINST THE PHRASE THE FOUNDER TYPED, and it lands on the
      // THEME that phrase resolves to — so re-grouping two wordings under one
      // theme carries their severities with them, exactly as it already carries
      // their counts. The set is of interview ids, so one interview naming the
      // same theme three ways counts once.
      if (it.id != null) {
        const sev = sevBy.get(`${it.id}\u0000${norm}`);
        if (sev === 'need') a.needInterviews.add(it.id);
        else if (sev === 'nice') a.niceInterviews.add(it.id);
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
    return {
      id: g.id, title: g.title, sort_order: g.sort_order, count: a ? a.count : 0, phrases,
      need_count: a ? a.needInterviews.size : 0,
      nice_count: a ? a.niceInterviews.size : 0,
      icp_count: a ? a.icpInterviews.size : 0,
      fit_unrecorded_count: a ? a.fitUnknownInterviews.size : 0,
      last_mention_at: a ? a.lastMentionAt : null,
    };
  });

  const ungrouped = Array.from(acc.values())
    .filter((a) => a.groupId == null)
    .sort((x, y) => y.count - x.count || x.title.localeCompare(y.title))
    .map((a) => ({
      phrase_norm: a.key.slice('impl:'.length),
      display_phrase: a.title,
      count: a.count,
      need_count: a.needInterviews.size,
      nice_count: a.niceInterviews.size,
      icp_count: a.icpInterviews.size,
      fit_unrecorded_count: a.fitUnknownInterviews.size,
      last_mention_at: a.lastMentionAt,
    }));

  return {
    interviewTotal,
    themes,
    view: {
      project_id: projectId,
      interview_total: interviewTotal,
      groups,
      ungrouped,
      // FROM THE ROWS, NOT FROM THE COUNTS. A severity recorded against a
      // phrase nobody has logged since — or against an interview whose pain was
      // re-worded — leaves every theme at zero while the store is not empty.
      // Deriving this from `need_count + nice_count` would then tell the page
      // "nothing is recorded", and a chip that narrows on severity would answer
      // a question the store cannot answer.
      severity_recorded: severities.length > 0,
      // FROM THE INTERVIEWS, NOT FROM THE THEMES, for the reason the type
      // records: an ICP interview that mentions no pain leaves every theme at
      // `icp_count: 0` while the field is plainly in use, and a page told
      // "nothing is on file" would then explain an empty chip with the wrong
      // reason. Same for dates.
      icp_recorded: interviews.some((it) => it.icp_fit != null && String(it.icp_fit).trim() !== ''),
      dates_recorded: interviews.some(
        (it) => typeof it.interview_date === 'string' && it.interview_date.trim() !== '',
      ),
    },
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
  // `id` JOINED THE SELECT so severity can be attributed. It was `pains_json`
  // alone, which is the whole reason three of this zone's four chips could not
  // be built: with no interview behind a mention there is nothing to narrow by.
  //
  // `icp_fit` AND `interview_date` JOINED IT FOR THE OTHER THREE. Both have
  // existed on `discovery_interviews` since migrations 161 and the baseline
  // respectively, and neither reached this view — so `/validate/pain-map`'s
  // `ICP only`, `All interviews` and `By recency` chips all carried the same
  // reason, that a theme keeps its phrases and not the interviews behind them.
  // The interviews were one column list away the whole time. No migration.
  //
  // BUT `icp_fit` IS NOT STRUCTURALLY GUARANTEED, and naming it unconditionally
  // was a real regression rather than a hypothetical one.
  // `ensureDiscoveryIcpFitColumn` exists because migration 161 ALTERs the column
  // in, and its own header says a caller should "degrade to 'ICP fit
  // unavailable' instead of emitting SQL that would fail with `no such column`".
  // The SELECT below is wrapped in `.catch(() => [])`, so on an environment
  // missing the column the failure would not be "attribution unavailable" — it
  // would be NO INTERVIEWS, and the whole pain map would render empty with no
  // error shown. The first fixture without the column proved exactly that.
  //
  // So the column list follows the bootstrap's answer. Without `icp_fit` every
  // mention lands in `fitUnknownInterviews` and `icp_recorded` is false, which is
  // the honest reading — nothing is attributed to a customer and the page says
  // nothing is on file — while the map, the counts and the dates all still work.
  // `interview_date` needs no such guard: it is in the baseline CREATE TABLE, not
  // an ALTER.
  const icpReady = await ensureDiscoveryIcpFitColumn(env);
  const res = await env.DB.prepare(
    icpReady
      ? `SELECT id, pains_json, icp_fit, interview_date FROM discovery_interviews WHERE project_id = ?`
      : `SELECT id, pains_json, interview_date FROM discovery_interviews WHERE project_id = ?`,
  )
    .bind(projectId)
    .all<InterviewPains>()
    .catch(() => ({ results: [] as InterviewPains[] }));

  // SCOPED THROUGH THE INTERVIEW, because `interview_pain_severities` carries
  // no project of its own — the same join `discovery_interviews` is the owner
  // of everywhere else in this file. A severity from another founder's project
  // cannot reach this view.
  const sev = await env.DB.prepare(
    `SELECT s.interview_id, s.phrase_norm, s.severity
       FROM interview_pain_severities s
       JOIN discovery_interviews i ON i.id = s.interview_id
      WHERE i.project_id = ?`,
  )
    .bind(projectId)
    .all<PainSeverityRow>()
    .catch(() => ({ results: [] as PainSeverityRow[] }));

  return analyzePains(res.results || [], model, projectId, sev.results || []).view;
}
