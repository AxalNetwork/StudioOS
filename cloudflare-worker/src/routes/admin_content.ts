/**
 * HQ · Content — canvas H6, "one pipeline replacing three systems", and since
 * D214 the four panels H18 and H19 draw on the same page.
 *
 * SUPER ADMIN ONLY.
 *
 *   GET /summary      the editorial pipeline and its board, the Assessment
 *                     Studio, the personas taxonomy and the deck roster — and
 *                     what is still not one thing
 *
 * THE CANVAS'S PREMISE IS A THIRD OUT OF DATE, AND THAT CHANGED THIS ROUTE.
 * The artboard says "Articles, publications and news were three systems that
 * disagreed about what 'published' meant." Checking each:
 *
 *   articles              The real editorial store. draft → submitted →
 *                         in_review → changes_requested → approved →
 *                         published, with rejected off to the side.
 *   news                  GONE, as of D166. It was never a third store — the
 *                         retired `admin_news.ts` read the SAME `articles`
 *                         table behind a `Deprecation: true` header — but it
 *                         was not harmless either: its publish handler
 *                         accepted `in_review`, so the approval gate on
 *                         `/api/admin/articles` could be walked around by
 *                         calling the deprecated path. A third of the
 *                         unification the canvas asks for is therefore
 *                         DONE rather than merely announced, and drawing it
 *                         as outstanding would misreport the repo's state.
 *   admin_publications    A genuinely separate store (migration 045) with its
 *                         own status column and its own meaning of
 *                         "published" — an audience-and-section digest, not
 *                         an article.
 *
 * So it is TWO vocabularies, not three, and this endpoint reports both
 * rather than pretending they are one. **The unified pipeline is not built
 * here.** Merging two editorial models is a product decision with a
 * migration behind it, not a read; what ships is an honest view of the two
 * and a statement of where they still disagree.
 *
 * THE BOARD (D214, H19's C3) DRAWS BOTH IN ONE SET OF LANES AND MERGES
 * NOTHING. H19 asks for six lanes — Draft, Review, Localisation, Brand
 * approval, Scheduled, Published — under "one meaning of published". The
 * lanes are built from THE SAME two by-status reads as `pipeline` and
 * `publications` above them, never a second count, so a lane cannot disagree
 * with the block beside it; each part of a lane names its store; and the
 * header's "one meaning of published" is refused, because there are still
 * two. Localisation has no source (below), so its lane says so instead of
 * holding a number. Brand approval is the open content escalations, read
 * through D204's one statement of what "open" means.
 *
 * THE MASTER TEMPLATE LIBRARY IS NOT REBUILT EITHER. The artboard draws it
 * in this zone, but it already exists at `/admin/contracts` over
 * `admin_contracts.ts` (`/templates`, `/templates/legal`, `/templates/store`)
 * and the `legal_templates` / `legal_template_versions` tables. Two pages
 * over one store drift apart; this one points at the page that owns it and
 * carries the version count so the pointer is worth following.
 *
 * H18 AND H19'S OTHER THREE PANELS ARE READ-ONLY SUMMARIES OF CONSOLES THAT
 * STAY WHERE THEY ARE (D214). The canvas changelog says they retire
 * `/admin/assessment` authoring, the Personas tab and the network-profiles
 * console; the owner's brief says nothing retires. So each block reads the
 * store its console writes, and none of them writes. The page ends each panel
 * in one literal link to its console, as D213 did on Platform; the payload
 * carries no path, because a field nothing reads is not a pointer:
 *
 *   assessment   games, chapters, archetypes, active questions and completed
 *                runs on HQ's database. "Live on N branches" is refused: no
 *                game reaches a branch.
 *   personas     each active account's primary tag against the twelve
 *                personas the code defines. The set itself is code, so no
 *                console — HQ's included — authors it.
 *   roster       the Advisors & Partners rows, each marked with what the deck
 *                does with it, from the deck's own two caps. "Nominated by"
 *                is refused: nothing records a nomination.
 *
 * EVERY BLOCK FAILS ON ITS OWN, AND NONE BOOTSTRAPS A SCHEMA. Each has its own
 * try and its own availability state, so one unreadable store never empties
 * another. And this GET never calls `ensureAssessmentSchema`,
 * `ensurePersonaSchema` or `ensureNetworkProfilesSchema`: a bootstrap would
 * create the missing table and turn "could not be read" into "empty", which
 * is D204's rule.
 *
 * Mounted at /api/admin/content BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { DERIVED_UNAVAILABLE } from './licence';
import { PERSONAS } from '../personas';
import { GAME_STATUSES } from '../services/assessmentSchema';
import { NETWORK_KINDS } from '../services/networkProfilesSchema';
import { openEscalationSummary, OPEN_ESCALATION_CEILING } from '../rpc/hqOps';
import {
  DECK_ROSTER_NAMES, DECK_ROSTER_PROFILES, deckAdvisorRole, deckRosterReach,
} from '../services/decks/deckRoster';

const r = new Hono<{ Bindings: Env }>();

/**
 * The artboard's four lanes, mapped onto the statuses `articles` actually
 * uses. `submitted` and `in_review` are one lane because the queue treats
 * them as one (`admin_articles.ts` selects them together); `approved` is the
 * scheduled lane because approval is what queues a piece to go out.
 */
const LANES: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'draft', label: 'Draft', statuses: ['draft'] },
  { key: 'review', label: 'Review', statuses: ['submitted', 'in_review', 'changes_requested'] },
  { key: 'scheduled', label: 'Scheduled', statuses: ['approved'] },
  { key: 'published', label: 'Published', statuses: ['published'] },
];

/** Migration 045's two statuses; anything else is reported, not placed. */
const PUBLICATION_STATUSES = ['draft', 'published'];

/** How many rows a board part shows, newest first (oldest first for escalations). */
const BOARD_CARDS = 3;
const GAMES_LIST_LIMIT = 50;
const ROSTER_LIST_LIMIT = 50;

/** A COUNT that is not a finite number is a failed read, never a zero. */
function countOf(value: unknown, what: string): number {
  const n = value === null || value === undefined ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} unreadable`);
  return n;
}

/**
 * `articles.updated_at` is written two ways — a `datetime('now')` default and
 * values the routes bind — so rows from separate per-status reads are merged
 * on a key both formats share: the first 19 characters with the ISO `T`
 * replaced. The SQL side orders by `datetime(updated_at)` for the same reason.
 */
const stampKey = (v: unknown) => String(v ?? '').replace('T', ' ').slice(0, 19);

type Card = { store: 'article' | 'publication'; id: number; title: string; status: string; updated_at: string | null };

/**
 * The newest rows of one store across a set of statuses: one literal,
 * bound statement per status (no IN list built from data), merged here.
 * A status the by-status read found empty is not queried at all.
 */
async function newestCards(
  env: Env, store: Card['store'], statuses: string[], byStatus: Record<string, number>,
): Promise<Card[]> {
  const rows: Card[] = [];
  for (const status of statuses) {
    if (!byStatus[status]) continue;
    const res = store === 'article'
      ? await env.DB.prepare(
        `SELECT id, title, status, updated_at FROM articles
          WHERE status = ?
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT ?`,
      ).bind(status, BOARD_CARDS).all<Record<string, unknown>>()
      : await env.DB.prepare(
        `SELECT id, title, status, updated_at FROM admin_publications
          WHERE status = ?
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT ?`,
      ).bind(status, BOARD_CARDS).all<Record<string, unknown>>();
    for (const row of res.results || []) {
      rows.push({
        store,
        id: Number(row.id),
        title: String(row.title ?? ''),
        status: String(row.status ?? ''),
        updated_at: row.updated_at == null ? null : String(row.updated_at),
      });
    }
  }
  rows.sort((a, b) => {
    const ka = stampKey(a.updated_at);
    const kb = stampKey(b.updated_at);
    if (ka !== kb) return ka < kb ? 1 : -1;
    return b.id - a.id;
  });
  return rows.slice(0, BOARD_CARDS);
}

r.get('/summary', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  // ── The article pipeline ──────────────────────────────────────────────
  // `articleByStatus` is hoisted so the board below reads THIS measurement
  // rather than counting the same table a second time.
  let pipeline: unknown;
  let articleByStatus: Record<string, number> | null = null;
  try {
    const rows = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM articles GROUP BY status',
    ).all<{ status: string; n: number }>();
    const byStatus: Record<string, number> = {};
    for (const row of rows.results || []) byStatus[String(row.status)] = Number(row.n) || 0;

    // Anything the lanes do not name is reported rather than dropped: a
    // status nobody mapped is a lane missing from this page, and a total
    // that quietly excludes it reads as the whole pipeline.
    const mapped = new Set(LANES.flatMap((l) => l.statuses));
    const unmapped = Object.entries(byStatus)
      .filter(([s]) => !mapped.has(s) && s !== 'rejected')
      .map(([status, n]) => ({ status, n }));

    pipeline = {
      available: true,
      lanes: LANES.map((l) => ({
        key: l.key,
        label: l.label,
        statuses: l.statuses,
        n: l.statuses.reduce((sum, s) => sum + (byStatus[s] || 0), 0),
      })),
      rejected: byStatus.rejected || 0,
      unmapped_statuses: unmapped,
      in_pipeline: LANES.filter((l) => l.key !== 'published')
        .reduce((sum, l) => sum + l.statuses.reduce((n, s) => n + (byStatus[s] || 0), 0), 0),
      // No `recent` list since D214: the board's newest rows per lane replace
      // it on the page, and a list nothing renders is a read nothing needs.
    };
    articleByStatus = byStatus;
  } catch {
    pipeline = { available: false, reason: 'The articles table could not be read.' };
  }

  // ── The second vocabulary ─────────────────────────────────────────────
  let publications: unknown;
  let publicationByStatus: Record<string, number> | null = null;
  try {
    const rows = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM admin_publications GROUP BY status',
    ).all<{ status: string; n: number }>();
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of rows.results || []) {
      byStatus[String(row.status)] = Number(row.n) || 0;
      total += Number(row.n) || 0;
    }
    publications = { available: true, total, by_status: byStatus };
    publicationByStatus = byStatus;
  } catch {
    // Migration 045 creates this table and the route self-creates it, so an
    // unreadable one is a real failure rather than "not built yet".
    publications = { available: false, reason: 'The publications table could not be read.' };
  }

  // ── The template library, which already has a page ────────────────────
  let templates: unknown;
  try {
    const t = await env.DB.prepare('SELECT COUNT(*) AS n FROM legal_templates').first<{ n: number }>();
    const v = await env.DB.prepare('SELECT COUNT(*) AS n FROM legal_template_versions').first<{ n: number }>();
    templates = {
      available: true,
      templates: Number(t?.n) || 0,
      versions: Number(v?.n) || 0,
      owned_by: '/admin/contracts',
    };
  } catch {
    templates = { available: false, reason: 'The legal template library could not be read.' };
  }

  // ── C3 · the board ────────────────────────────────────────────────────
  const board = await readBoard(env, articleByStatus, publicationByStatus);

  // ── C1 · the Assessment Studio ────────────────────────────────────────
  let assessment: unknown;
  try {
    const statusRows = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM assessment_games GROUP BY status',
    ).all<{ status: string; n: number }>();
    const byStatus: Record<string, number> = {};
    for (const s of GAME_STATUSES) byStatus[s] = 0;
    const otherStatuses: Array<{ status: string; n: number }> = [];
    let gamesTotal = 0;
    for (const row of statusRows.results || []) {
      const n = countOf(row.n, 'game count');
      gamesTotal += n;
      if ((GAME_STATUSES as readonly string[]).includes(String(row.status))) byStatus[String(row.status)] = n;
      else otherStatuses.push({ status: String(row.status), n });
    }

    const games = await env.DB.prepare(
      `SELECT g.id, g.slug, g.title, g.status, g.version,
              (SELECT COUNT(*) FROM assessment_chapters ch WHERE ch.game_id = g.id) AS chapters,
              (SELECT COUNT(*) FROM assessment_archetypes ar WHERE ar.game_id = g.id) AS archetypes,
              (SELECT COUNT(*) FROM assessment_items it WHERE it.game_id = g.id AND it.is_active = 1) AS questions
         FROM assessment_games g
        ORDER BY g.display_order ASC, g.id ASC
        LIMIT ?`,
    ).bind(GAMES_LIST_LIMIT + 1).all<Record<string, unknown>>();
    const gameRows = games.results || [];

    const chapters = await env.DB.prepare('SELECT COUNT(*) AS n FROM assessment_chapters').first<{ n: number }>();
    const archetypes = await env.DB.prepare('SELECT COUNT(*) AS n FROM assessment_archetypes').first<{ n: number }>();

    // Completed runs, in their OWN try: a missing sessions table leaves every
    // game's runs unreadable while the games themselves still render. A
    // failed read is never a zero.
    let runsByGame: Map<number, number> | null = null;
    let runsReason: string | null = null;
    try {
      const runs = await env.DB.prepare(
        `SELECT game_id, COUNT(*) AS n FROM assessment_sessions
          WHERE status = 'completed'
          GROUP BY game_id`,
      ).all<{ game_id: number; n: number }>();
      runsByGame = new Map();
      for (const row of runs.results || []) runsByGame.set(Number(row.game_id), countOf(row.n, 'run count'));
    } catch {
      runsReason = 'The assessment sessions table could not be read, so no game shows a run count.';
    }

    assessment = {
      available: true,
      games: gameRows.slice(0, GAMES_LIST_LIMIT).map((g) => ({
        id: Number(g.id),
        slug: String(g.slug ?? ''),
        title: String(g.title ?? ''),
        status: String(g.status ?? ''),
        version: Number.isFinite(Number(g.version)) ? Number(g.version) : null,
        chapters: countOf(g.chapters, 'chapter count'),
        archetypes: countOf(g.archetypes, 'archetype count'),
        questions: countOf(g.questions, 'question count'),
        runs: runsByGame ? (runsByGame.get(Number(g.id)) ?? 0) : null,
      })),
      truncated: gameRows.length > GAMES_LIST_LIMIT,
      games_total: gamesTotal,
      by_status: byStatus,
      other_statuses: otherStatuses,
      chapters_total: countOf(chapters?.n, 'chapter total'),
      archetypes_total: countOf(archetypes?.n, 'archetype total'),
      runs_available: runsByGame !== null,
      ...(runsReason ? { runs_reason: runsReason } : {}),
      runs_basis:
        'Completed runs recorded on HQ\'s own database. The routes that recorded a run are retired, '
        + 'so this count does not grow; it is what was played before they were.',
      branches: {
        recorded: false,
        reason:
          'No game reaches a branch: no call pushes one, a branch\'s database is built from a '
          + 'baseline that carries no games, and authoring is refused on a branch. So "live on N '
          + 'branches" has nothing to count, and a branch\'s own runs have no route to HQ either.',
      },
    };
  } catch {
    assessment = {
      available: false,
      reason: 'The assessment tables could not be read, so no game is shown rather than none being claimed.',
    };
  }

  // ── C2 · the personas taxonomy ────────────────────────────────────────
  let personas: unknown;
  try {
    const tagged = await env.DB.prepare(
      `SELECT up.persona_id AS persona_id, COUNT(DISTINCT up.user_id) AS n
         FROM user_personas up
         JOIN users u ON u.id = up.user_id
        WHERE up.is_primary = 1 AND u.is_active = 1
        GROUP BY up.persona_id`,
    ).all<{ persona_id: string; n: number }>();
    const counts = new Map<string, number>();
    for (const row of tagged.results || []) counts.set(String(row.persona_id), countOf(row.n, 'persona count'));

    // One statement for the footing, so its three figures are one
    // measurement: every active account, those with no primary tag, and those
    // holding more than one (which nothing constrains — it holds only by
    // convention).
    const footing = await env.DB.prepare(
      `SELECT COUNT(*) AS active_accounts,
              COALESCE(SUM(CASE WHEN NOT EXISTS (
                SELECT 1 FROM user_personas up
                 WHERE up.user_id = u.id AND up.is_primary = 1
              ) THEN 1 ELSE 0 END), 0) AS unclassified,
              COALESCE(SUM(CASE WHEN (
                SELECT COUNT(*) FROM user_personas up
                 WHERE up.user_id = u.id AND up.is_primary = 1
              ) > 1 THEN 1 ELSE 0 END), 0) AS multi_primary
         FROM users u
        WHERE u.is_active = 1`,
    ).first<{ active_accounts: number; unclassified: number; multi_primary: number }>();
    const activeAccounts = countOf(footing?.active_accounts, 'active account count');
    const unclassified = countOf(footing?.unclassified, 'unclassified count');
    const multiPrimary = countOf(footing?.multi_primary, 'multi-primary count');

    const known = new Set(PERSONAS.map((p) => p.id as string));
    const unrecognised = [...counts.entries()]
      .filter(([id]) => !known.has(id))
      .map(([id, n]) => ({ id, tagged: n }))
      .sort((a, b) => b.tagged - a.tagged || a.id.localeCompare(b.id));
    const items = PERSONAS.map((p) => ({ id: p.id, label: p.label, tagged: counts.get(p.id) ?? 0 }));
    const taggedSum = [...counts.values()].reduce((s, n) => s + n, 0);

    personas = {
      available: true,
      items,
      unrecognised,
      tagged_sum: taggedSum,
      accounts_tagged: activeAccounts - unclassified,
      unclassified,
      active_accounts: activeAccounts,
      multi_primary: multiPrimary,
      basis:
        'Each active account is counted under its primary tag, admins included, because the tag is '
        + 'not bound to a role.',
      schema_note:
        'The twelve personas are defined in code and mirrored in the SPA, so adding, renaming or '
        + 'retiring one is a code change: no console authors the set, HQ\'s included. What a console '
        + 'changes is which persona an account carries.',
      scope_note:
        'Counted on HQ\'s database only. A branch tags its own accounts in its own database, and no '
        + 'branch call returns persona counts.',
    };
  } catch {
    personas = {
      available: false,
      reason: 'The persona tags could not be read, so no persona shows a count rather than a zero.',
    };
  }

  // ── C4 · the Advisors & Partners deck roster ──────────────────────────
  let roster: unknown;
  try {
    // THE DECK'S OWN ORDER for the active rows — `loadNetworkProfiles` reads
    // `WHERE is_active = 1 ORDER BY display_order, name, id` — with archived
    // rows after them, so the marking below cannot disagree with the slide.
    // No bio, photo key or LinkedIn URL: the panel needs none of them.
    const rows = await env.DB.prepare(
      `SELECT id, name, kind, role, company, is_active
         FROM network_profiles
        ORDER BY CASE WHEN is_active = 1 THEN 0 ELSE 1 END ASC,
                 display_order ASC, name ASC, id ASC
        LIMIT ?`,
    ).bind(ROSTER_LIST_LIMIT + 1).all<Record<string, unknown>>();
    const listed = (rows.results || []).slice(0, ROSTER_LIST_LIMIT);

    const kindRows = await env.DB.prepare(
      `SELECT CASE WHEN is_active = 1 THEN 1 ELSE 0 END AS active, kind, COUNT(*) AS n
         FROM network_profiles
        GROUP BY CASE WHEN is_active = 1 THEN 1 ELSE 0 END, kind`,
    ).all<{ active: number; kind: string; n: number }>();
    const byKind = new Map<string, { kind: string; active: number; archived: number; known: boolean }>();
    for (const k of NETWORK_KINDS) byKind.set(k, { kind: k, active: 0, archived: 0, known: true });
    let active = 0;
    let archived = 0;
    for (const row of kindRows.results || []) {
      const n = countOf(row.n, 'roster count');
      const kind = String(row.kind ?? '');
      const slot = byKind.get(kind) ?? { kind, active: 0, archived: 0, known: false };
      if (Number(row.active) === 1) { slot.active += n; active += n; } else { slot.archived += n; archived += n; }
      byKind.set(kind, slot);
    }

    // The deck's name rule, exactly: `String(r.name || '')`, then a row with
    // no name is never named. `deckRosterReach` holds the two caps.
    const activeRows = listed.filter((row) => Number(row.is_active) === 1);
    const reach = deckRosterReach(activeRows.map((row) => String(row.name || '')));
    let a = 0;
    roster = {
      available: true,
      rows: listed.map((row) => {
        const isActive = Number(row.is_active) === 1;
        const state = isActive ? reach[a++] : 'archived';
        return {
          id: Number(row.id),
          name: String(row.name ?? ''),
          kind: String(row.kind ?? ''),
          role: row.role == null || String(row.role).trim() === '' ? null : String(row.role),
          // What the Team & Network slide prints — only for a row it draws.
          deck_role: state === 'profile' ? deckAdvisorRole(row.role) : null,
          company: row.company == null || String(row.company).trim() === '' ? null : String(row.company),
          active: isActive,
          reach: state,
        };
      }),
      truncated: (rows.results || []).length > ROSTER_LIST_LIMIT,
      active,
      archived,
      by_kind: [...byKind.values()],
      caps: { profiles: DECK_ROSTER_PROFILES, names: DECK_ROSTER_NAMES },
      reach_note:
        'What the deck built on HQ does with each active row, in its own order: the first '
        + `${DECK_ROSTER_PROFILES} are passed to the Team & Network advisor block with name, role and `
        + `photo; the next named rows, up to ${DECK_ROSTER_NAMES} names in all, are passed by name `
        + 'only, in a list that slide reads only when there are no profiles; every active row is '
        + 'counted in the network total and the skill coverage. Passed, not shown: the slide\'s '
        + 'layout decides how many fit.',
      nominations: {
        recorded: false,
        reason:
          'Nothing records who put a person on the roster: a row carries no creator and no branch, and '
          + 'a branch has no route to propose anyone to HQ.',
      },
      branch_rule:
        'A branch authors its own roster in its own database, and its decks read that one. No row '
        + 'here reaches a branch: nothing pushes a roster.',
    };
  } catch {
    roster = {
      available: false,
      reason: 'The network profiles table could not be read, so the roster is not shown rather than shown empty.',
    };
  }

  return c.json({
    pipeline,
    publications,
    templates,
    board,
    assessment,
    personas,
    roster,

    // The unification the canvas asks for, and exactly how far it has got.
    unified_pipeline_available: false,
    unified_pipeline_reason:
      'Articles and publications are still two stores with two meanings of "published": an article '
      + 'is editorial and goes through review, a publication is an audience-and-section digest. News '
      + 'is not a third — the deprecated /api/admin/news queue was retired in D166, so there is one '
      + 'admin queue over the articles table rather than two. The board draws both stores in the '
      + 'lanes their statuses map to, each row labelled with its store, which puts them side by side '
      + 'and merges nothing. Merging them is a migration and a product decision, not a read, so this '
      + 'page reports both rather than showing a pipeline that does not exist.',

    // Localisation, which the artboard's header counts.
    //
    // NARROWED IN D112, NOT DELETED. This refusal had three parts and one PR
    // closed two of them: a content escalation carries `branch_code`, which is
    // the per-subsidiary attribution, and it now carries a decision, which is
    // the brand-approval state. The third part is untouched and is the reason
    // the header's count still has no source — NOTHING RECORDS THAT ONE PIECE
    // LOCALISES ANOTHER. An escalation names what a branch submitted; it does
    // not say which original it is a version of, so "4 localised" would be
    // counting submissions and calling them translations.
    //
    // NARROWED AGAIN IN D208. A content escalation can now NAME the item it
    // concerns — HQ's template or the branch's own article — as a label the
    // branch builds from its own row (`services/escalationConcerns.ts`), since
    // HQ cannot open that database. That closes "which item". It does not close
    // "what the submission is TO that item": a French version of template X and
    // a request to fix a clause in X both name X. So the count still has no
    // source, and this sentence now says the narrower true thing.
    //
    // D214 corrected the decision it names: HQ answers or declines an
    // escalation (`ESCALATION_STATUSES`, and HQ Support offers exactly those
    // two), where this said "an approve or request-changes decision".
    localisation_available: false,
    localisation_reason:
      'Brand approval, per-subsidiary attribution and the item a submission concerns exist now: a '
      + 'branch submits content as an escalation of kind "content", which carries its branch code, '
      + 'is answered or declined by HQ, and can name the item it concerns — a label '
      + 'the branch builds, not a link HQ can open. The lane is read from '
      + '/api/admin/escalations?kind=content. What is still not recorded is the RELATION — naming '
      + 'an item does not say that the submission is a localisation of another rather than a change '
      + 'to it, so a count of localised items would be a count of submissions wearing the wrong '
      + 'name.',
    localisation_lane_endpoint: '/api/admin/escalations?kind=content',

    ...DERIVED_UNAVAILABLE,
  });
});

type BoardPart = {
  store: 'articles' | 'publications' | 'escalations';
  statuses: string[];
  n: number | null;
  cards: Array<Record<string, unknown>> | null;
  reason?: string;
};

/**
 * C3 — the six lanes, from the two by-status maps the blocks above already
 * read and from D204's one statement of what an open escalation is.
 *
 * A LANE'S TOTAL IS THE SUM OF ITS PARTS ONLY WHEN EVERY PART ANSWERED —
 * otherwise it is null and the unreadable store is named. A total smaller
 * than the truth, shown as the total, is the `backlogOf` rule this follows.
 */
async function readBoard(
  env: Env,
  articleByStatus: Record<string, number> | null,
  publicationByStatus: Record<string, number> | null,
) {
  const lane = (key: string) => LANES.find((l) => l.key === key)!.statuses;

  async function articlesPart(statuses: string[]): Promise<BoardPart> {
    if (!articleByStatus) {
      return { store: 'articles', statuses, n: null, cards: null, reason: 'The articles table could not be read.' };
    }
    const n = statuses.reduce((s, st) => s + (articleByStatus[st] || 0), 0);
    let cards: BoardPart['cards'] = null;
    try { cards = await newestCards(env, 'article', statuses, articleByStatus); } catch { cards = null; }
    return { store: 'articles', statuses, n, cards };
  }

  async function publicationsPart(status: string): Promise<BoardPart> {
    if (!publicationByStatus) {
      return { store: 'publications', statuses: [status], n: null, cards: null, reason: 'The publications table could not be read.' };
    }
    const n = publicationByStatus[status] || 0;
    let cards: BoardPart['cards'] = null;
    try { cards = await newestCards(env, 'publication', [status], publicationByStatus); } catch { cards = null; }
    return { store: 'publications', statuses: [status], n, cards };
  }

  // Brand approval: the open escalations of kind "content", oldest first,
  // from the one statement HQ Home and HQ Support also read — never a second
  // `WHERE status = 'open'`.
  let brand: BoardPart;
  try {
    const summary = await openEscalationSummary(env);
    const content = summary.items.filter((e) => e.kind === 'content');
    brand = {
      store: 'escalations',
      statuses: ['open'],
      n: summary.complete ? content.length : null,
      cards: content.slice(0, BOARD_CARDS).map((e) => ({
        store: 'escalation',
        uid: e.uid,
        subject: e.subject,
        branch_code: e.branch_code,
        created_at: e.created_at,
        sla: e.sla,
      })),
      ...(summary.complete ? {} : {
        reason: `More than ${OPEN_ESCALATION_CEILING} escalations are open, so the read stopped counting and `
          + 'this lane shows the oldest rather than a total.',
      }),
    };
  } catch {
    brand = {
      store: 'escalations', statuses: ['open'], n: null, cards: null,
      reason: 'The escalations table could not be read.',
    };
  }

  const lanes = [
    { key: 'draft', label: 'Draft', parts: [await articlesPart(lane('draft')), await publicationsPart('draft')] },
    { key: 'review', label: 'Review', parts: [await articlesPart(lane('review'))] },
    {
      key: 'localisation', label: 'Localisation', parts: [] as BoardPart[], recorded: false,
      reason:
        'A branch localises in its own database, and nothing records that one piece is a localisation '
        + 'of another, so this lane has no source. What a branch sends HQ for approval is the Brand '
        + 'approval lane; which of those are localisations is a decision not yet taken.',
    },
    {
      key: 'brand_approval', label: 'Brand approval', parts: [brand],
      note:
        'Content escalations a branch raised and HQ has not answered. Axal subsidiaries only: HQ '
        + 'refuses a white-label\'s content escalation before recording it, because a white-label has '
        + 'no brand desk to send it to.',
    },
    {
      key: 'scheduled', label: 'Scheduled', parts: [await articlesPart(lane('scheduled'))],
      note:
        'Approved and waiting for someone to publish it: approval queues a piece, and publishing is '
        + 'a separate manual step. Nothing stores a publish time.',
    },
    {
      key: 'published', label: 'Published', parts: [await articlesPart(lane('published')), await publicationsPart('published')],
      note:
        'Two meanings of "published": an article on the public site, and a publication issued to its '
        + 'audience. Each row says which store it came from.',
    },
  ].map((l) => {
    const parts = l.parts;
    const unreadable = parts.filter((p) => p.n === null);
    const total = parts.length === 0 || unreadable.length > 0
      ? null
      : parts.reduce((s, p) => s + (p.n as number), 0);
    return {
      ...l,
      total,
      ...(parts.length > 0 && unreadable.length > 0 ? {
        total_reason: `${unreadable.map((p) => p.store).join(' and ')} could not be counted, so this `
          + 'lane has no total rather than one smaller than the truth.',
      } : {}),
    };
  });

  const measured = lanes.filter((l) => l.parts.length > 0);
  const anyNull = measured.some((l) => l.total === null);
  const sum = (ls: typeof measured) => ls.reduce((s, l) => s + (l.total as number), 0);

  return {
    lanes,
    // Every item in a measured lane; the Localisation lane has no source and
    // adds nothing. Null when any lane could not be counted.
    total: anyNull ? null : sum(measured),
    // Everything short of Published — what the band calls "in pipeline".
    in_flight: anyNull ? null : sum(measured.filter((l) => l.key !== 'published')),
    other_publication_statuses: publicationByStatus
      ? Object.entries(publicationByStatus)
        .filter(([s]) => !PUBLICATION_STATUSES.includes(s))
        .map(([status, n]) => ({ status, n }))
      : [],
    publish_time: {
      recorded: false,
      reason:
        'Scheduled means approved; publishing is a manual step, and nothing stores when a piece is '
        + 'meant to go out.',
    },
    origin: {
      recorded: false,
      reason:
        'Neither an article nor a publication names a branch, so no row here can say which branch it '
        + 'came from; only a content escalation carries a branch code.',
    },
  };
}

export default r;
