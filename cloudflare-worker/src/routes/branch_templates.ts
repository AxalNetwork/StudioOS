/**
 * HQ's master contract library, as this branch holds it (S5 + S10, D147).
 *
 *   GET /api/branch/templates
 *
 * IT IS A COPY, AND EVERY FIELD ON THE RESPONSE SAYS SO. `branch_templates`
 * (migration 268) is filled only by `publishTemplate`, HQ's push; nothing on a
 * branch authors a template, and `requireHqAuthoring` (D106) refuses the three
 * store writes with the sentence D.9 wrote — *changing a template is a Content
 * submission*. So the read carries `pushed_at`, the way `/api/licence/mine`
 * carries `as_of` for the licence copy, and the page prints it.
 *
 * THREE STATES, NOT TWO, AND THE MIDDLE ONE IS WHY `branch_templates_sync`
 * EXISTS. An empty `branch_templates` means either "HQ pushed a library and it
 * was empty" or "HQ has never pushed", and only the first is a statement about
 * HQ. The sync row is written in the same batch as the library, so its presence
 * IS the fact that a push happened. `licence_not_pushed` (D107) is the
 * precedent: an empty copy and an absent copy are two claims, not one.
 *
 * SUSPENSION DOES NOT GATE IT, for the reason D130's board and D131's digest
 * are not gated: `requireBranchNotSuspended` guards approval WRITES, and a
 * frozen branch still needs to read what it is contracted on. Reading changes
 * nothing.
 *
 * AN UNREADABLE TABLE IS NOT AN EMPTY LIBRARY. A database that has not applied
 * migration 268 answers `available: false` with its reason rather than a
 * cheerful zero — the #204 rule, and the one D138 re-learned when two narrow
 * fixtures made seven tests report "HQ has not pushed this branch its licence"
 * about a row sitting in front of them.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type TemplateRow = {
  slug: string; title: string; category: string | null; version: number; pushed_at: string;
};

export const BRANCH_LIBRARY_NEVER_PUSHED =
  'HQ has not pushed its master library to this branch yet. The library lives at HQ and '
  + 'travels on a push, so until then this branch has nothing to instantiate — which is a '
  + 'different thing from HQ having no templates.';

const BRANCH_LIBRARY_UNREADABLE =
  'The template copy could not be read on this database (migration 268). That is not the '
  + 'same as HQ having pushed nothing.';

/** The copy HQ pushed, or `available: false` when the table could not be read. */
export async function readBranchTemplateCopy(env: Env): Promise<
  | {
    available: true;
    items: TemplateRow[];
    pushed_at: string | null;
    never_pushed_reason?: string;
  }
  | { available: false; items: []; pushed_at: null; reason: string }
> {
  try {
    const q = await env.DB.prepare(
      `SELECT slug, title, category, version, pushed_at
         FROM branch_templates ORDER BY category, title`,
    ).all<TemplateRow>();
    const sync = await env.DB.prepare(
      'SELECT pushed_at, count FROM branch_templates_sync WHERE id = 1',
    ).first<{ pushed_at: string; count: number }>();
    const items = q.results || [];
    return {
      available: true,
      items,
      pushed_at: sync?.pushed_at ?? null,
      ...(sync ? {} : { never_pushed_reason: BRANCH_LIBRARY_NEVER_PUSHED }),
    };
  } catch (e) {
    console.error('[branch-templates] library', (e as Error).message);
    return { available: false, items: [], pushed_at: null, reason: BRANCH_LIBRARY_UNREADABLE };
  }
}

// GET /api/branch/templates
r.get('/templates', async (c) => {
  try {
    await requireAdmin(c);
    const branch = requireBranchTier(c.env);

    const copy = await readBranchTemplateCopy(c.env);

    return c.json({
      branch,
      items: copy.items,
      available: copy.available,
      ...(copy.available ? {} : { reason: copy.reason }),
      // HQ's stamp, never this database's write time, so "as of" never gets
      // younger than the push it reports (migration 256's rule).
      pushed_at: copy.pushed_at,
      ...(copy.available && copy.never_pushed_reason
        ? { never_pushed_reason: copy.never_pushed_reason }
        : {}),
      // WHAT THE COPY DELIBERATELY DOES NOT CARRY, named on the payload rather
      // than written into the page, so the reason travels with the absence.
      not_carried: [
        {
          field: 'body_md',
          reason:
            'The document text stays at HQ. Nothing on a branch renders or instantiates a template '
            + 'body, and GET /api/admin/contracts carries the template name and not the body, so a '
            + 'body column here would be a store with no reader.',
        },
        {
          field: 'archived versions',
          reason:
            'HQ\'s own library shows only active templates and its contract route offers only the '
            + 'current version, so there is no archived-and-unusable state for a branch to mirror. '
            + 'A template\'s version number is carried; the older versions behind it live at HQ.',
        },
      ],
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
