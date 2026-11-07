/**
 * #4707 — HQ licence routes: the ledger list, territories held, the summary, a licence's requests, and issuing a draft. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { requireSuperAdmin } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { ledgerSummary, licenceRequests, LedgerReadRefusal, pageLicences } from '../services/licenceLedgerReads';
import { LICENCE_KINDS, type LicenceRow, str, intOrNull, byUid, logEvent, hydrate } from '../services/licenceLedgerCore';
import type { Env } from '../types';

const r = new Hono<{ Bindings: Env }>();

/* ---------------------------------------------------------------- */

// #4700 — ONE PAGE, NOT THE LEDGER. `?q=&kind=&status=&limit=&cursor=`: the
// search, the filters and the order run in SQL, then the page is cut, then
// only that page is hydrated. `total` counts every match, so the console never
// reads a page's length as the ledger's size. The coverage grid and renewal
// pipeline read `GET /summary`, which is over the whole ledger.
r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    let page;
    try {
      page = await pageLicences(c.env, {
        q: c.req.query('q'), kind: c.req.query('kind'), status: c.req.query('status'),
        limit: c.req.query('limit'), cursor: c.req.query('cursor'),
      });
    } catch (e) {
      if (e instanceof LedgerReadRefusal) return refuse(c, 400, { code: e.code, message: e.sentence });
      throw e;
    }
    return c.json({
      items: await hydrate(c.env, page.rows as LicenceRow[]),
      total: page.total,
      next_cursor: page.next_cursor,
      limit: page.limit,
      // Said once, at the top, rather than implied by a column of dashes.
      seats_used_available: false,
      seats_used_reason:
        'This ledger does not attribute HQ accounts to a licence (U1), so a per-licence '
        + 'utilisation figure here would invent scoping. Seats used on a deployed branch is read '
        + 'on HQ Home from each branch\'s own database and on the branch console itself.',
    });
  } catch (e) { return mapError(c, e); }
});

// Who holds what, for the step-2 picker. A country not listed here is free.
r.get('/territories', async (c) => {
  try {
    await requireSuperAdmin(c);
    const rows = await c.env.DB.prepare(
      `SELECT lt.country_code, l.uid AS licence_uid, l.licence_ref, l.brand_name, l.status
         FROM licence_territories lt
         JOIN territory_licences l ON l.id = lt.licence_id
        ORDER BY lt.country_code`,
    ).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

// #4700 — coverage, renewals and counts over the WHOLE ledger, apart from the
// page, so the grid and the pipeline are right whichever page is open.
r.get('/summary', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json(await ledgerSummary(c.env));
  } catch (e) { return mapError(c, e); }
});

// #4700 — this licence's open requests, HQ-origin and branch-origin, scoped
// and counted on the server before the page. `?limit=&cursor=`.
r.get('/:uid/requests', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    try {
      return c.json(await licenceRequests(c.env, licence.uid, { limit: c.req.query('limit'), cursor: c.req.query('cursor') }));
    } catch (e) {
      if (e instanceof LedgerReadRefusal) return refuse(c, 400, { code: e.code, message: e.sentence });
      // The request board itself could not be read (migration 259): unknown, not none.
      console.warn('[licences] hq_escalations unreadable', (e as Error).message);
      return c.json({
        available: false,
        reason: 'HQ\'s request board could not be read on this database, so this licence\'s requests are unknown — not none.',
      });
    }
  } catch (e) { return mapError(c, e); }
});

// Step 1 — the entity.
r.post('/', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const ref = str(b?.licence_ref, 40).toUpperCase();
    const legalName = str(b?.legal_entity_name, 200);
    const brand = str(b?.brand_name, 200) || legalName;
    if (!ref || !legalName) {
      return c.json({ error: 'licence_ref and legal_entity_name are required' }, 400);
    }
    const clash = await c.env.DB.prepare('SELECT 1 AS x FROM territory_licences WHERE licence_ref = ?')
      .bind(ref).first<{ x: number }>();
    if (clash) return c.json({ error: `${ref} is already in use` }, 409);

    // KIND IS STEP 1 (H26), AND IT IS REFUSED HERE RATHER THAN COERCED.
    // Migration 279's CHECK would reject a third value anyway — as a 500 with
    // SQLite's own wording. An operator who mistypes a kind deserves to be told
    // which two exist, which is why the handler names them.
    const kind = str(b?.kind, 20) || 'subsidiary';
    // The two kinds migration 279's CHECK admits (`services/licenceContracts.ts`):
    // a third is refused by both, and this refusal is the readable one.
    if (!(LICENCE_KINDS as readonly string[]).includes(kind)) {
      return c.json({ error: `kind must be one of ${LICENCE_KINDS.join(', ')}` }, 400);
    }

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO territory_licences (uid, licence_ref, entity_id, legal_entity_name,
                                       brand_name, registered_address, signatory_name,
                                       signatory_title, kind, status, created_by_user_id,
                                       created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?,?,?)`,
    ).bind(
      uid, ref, intOrNull(b?.entity_id), legalName, brand,
      str(b?.registered_address) || null, str(b?.signatory_name, 200) || null,
      str(b?.signatory_title, 200) || null, kind, admin.id, nowIso(), nowIso(),
    ).run();
    const created = await byUid(c.env, uid);
    // The kind rides the audit row: `licence_events` is the licence's own
    // record, and which kind it was issued as is not recoverable from the
    // other fields.
    if (created) await logEvent(c.env, created.id, 'created', admin.id, { licence_ref: ref, kind });
    return c.json({ uid, licence_ref: ref, status: 'draft', kind }, 201);
  } catch (e) { return mapError(c, e); }
});

export default r;
