/**
 * HQ · Content — canvas H6, "one pipeline replacing three systems".
 *
 * SUPER ADMIN ONLY.
 *
 *   GET /summary      the editorial pipeline, and what is still not one thing
 *
 * THE CANVAS'S PREMISE IS A THIRD OUT OF DATE, AND THAT CHANGED THIS ROUTE.
 * The artboard says "Articles, publications and news were three systems that
 * disagreed about what 'published' meant." Checking each:
 *
 *   articles              The real editorial store. draft → submitted →
 *                         in_review → changes_requested → approved →
 *                         published, with rejected off to the side.
 *   news                  NOT a third system any more. `admin_news.ts` reads
 *                         the SAME `articles` table and already answers with
 *                         `Deprecation: true` and a `Link: </api/admin/articles>;
 *                         rel="successor-version"`. A third of the
 *                         unification the canvas asks for has already
 *                         happened, and drawing it as outstanding would
 *                         misreport the repo's own state.
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
 * THE MASTER TEMPLATE LIBRARY IS NOT REBUILT EITHER. The artboard draws it
 * in this zone, but it already exists at `/admin/contracts` over
 * `admin_contracts.ts` (`/templates`, `/templates/legal`, `/templates/store`)
 * and the `legal_templates` / `legal_template_versions` tables. Two pages
 * over one store drift apart; this one points at the page that owns it and
 * carries the version count so the pointer is worth following.
 *
 * Mounted at /api/admin/content BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { DERIVED_UNAVAILABLE } from './licence';

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

r.get('/summary', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  // ── The article pipeline ──────────────────────────────────────────────
  let pipeline: unknown;
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

    const recent = await env.DB.prepare(
      `SELECT id, title, status, updated_at, published_at
         FROM articles ORDER BY updated_at DESC LIMIT 12`,
    ).all<Record<string, unknown>>();

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
      recent: recent.results || [],
    };
  } catch {
    pipeline = { available: false, reason: 'The articles table could not be read.' };
  }

  // ── The second vocabulary ─────────────────────────────────────────────
  let publications: unknown;
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

  return c.json({
    pipeline,
    publications,
    templates,

    // The unification the canvas asks for, and exactly how far it has got.
    unified_pipeline_available: false,
    unified_pipeline_reason:
      'Articles and publications are still two stores with two meanings of "published": an article '
      + 'is editorial and goes through review, a publication is an audience-and-section digest. News '
      + 'is no longer a third — `admin_news.ts` reads the articles table and already answers with a '
      + 'Deprecation header pointing at /api/admin/articles. Merging the remaining two is a migration '
      + 'and a product decision, not a read, so this page reports both rather than showing a pipeline '
      + 'that does not exist.',

    // Localisation, which the artboard's header counts.
    localisation_available: false,
    localisation_reason:
      'Nothing records that a piece is a localisation of another, and nothing records which '
      + 'subsidiary produced it. "4 localised, awaiting brand approval" has no source: there is no '
      + 'localisation link, no brand-approval state, and no per-subsidiary attribution (U1).',

    ...DERIVED_UNAVAILABLE,
  });
});

export default r;
