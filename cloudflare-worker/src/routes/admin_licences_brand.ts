/**
 * #4707 — HQ licence routes: the white-label brand kit and its mark. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { cleanHex, markExtension, readUploadedMark } from './brand';
import { type LicenceRow, type LicenceBrandKitRow, brandKitPayload, KIT_UNREADABLE, byUid } from '../services/licenceLedgerCore';

const r = new Hono<{ Bindings: Env }>();

/* ------------------------------------------------------------------ *
 * D198 — H26 step 6: the brand a WHITE-LABEL operator trades under     *
 * ------------------------------------------------------------------ *
 *
 * ALL FOUR ROUTES REFUSE A SUBSIDIARY, and that refusal is the feature
 * rather than a guard around it. `wlCompare` on the Super canvas is what
 * settles who owns a kit — `{ k:'Brand kit', a:'Axal, fixed', w:'Theirs ·
 * name, mark, colours, domain' }` — so a subsidiary licence HAS a brand and
 * it is Axal's, fixed, and not a row in this table. Storing one would make
 * the ledger able to say a subsidiary trades under a mark of its own, which
 * is a claim the product does not want to be able to make.
 *
 * HQ WRITES; HQ DOES NOT APPROVE. H26's own prose: "HQ will never approve
 * this. They will." What HQ is doing here is CAPTURE — a licence is issued
 * before any administrator is named on it (D134), so at issue time there is
 * nobody else to type it. The branch-side editor S1d and `dmSub` draw is
 * filed, not built: it needs the kit pushed to the branch first, and the
 * mark's bytes crossing from HQ's R2 to the branch's is a transport decision
 * rather than a store one.
 */

/** Every write here is the same refusal for a subsidiary; said once. */
export function refuseUnlessWhiteLabel(licence: LicenceRow) {
  if (licence.kind === 'white_label') return null;
  return {
    error: 'A brand kit belongs to a white-label licence. An Axal subsidiary trades under Axal’s '
      + 'brand, which is fixed and is not stored per licence.',
    code: 'not_white_label',
  };
}

/** The kit row for a licence, or the unreadable state, never one as the other. */
export async function kitFor(
  env: Env, licenceId: number,
): Promise<{ ok: true; row: LicenceBrandKitRow | null } | { ok: false }> {
  try {
    const row = await env.DB.prepare(
`SELECT id, licence_id, mark_r2_key, mark_mime, mark_bytes, primary_hex, accent_hex,
              updated_by_user_id, created_at, updated_at
         FROM licence_brand_kits WHERE licence_id = ?`,
    ).bind(licenceId).first<LicenceBrandKitRow>();
    return { ok: true, row: row || null };
  } catch (e) {
    console.warn('[licences] licence_brand_kits unreadable', (e as Error).message);
    return { ok: false };
  }
}

// PUT /:uid/brand — the colours.
//
// BOTH ARE REQUIRED TOGETHER, which is the same condition `activationBlockers`
// checks. A kit holding one colour would satisfy "a kit exists" while a shell
// built from it still has to reach for a second colour, and the only second
// colour available is Axal's.
r.put('/:uid/brand', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const refusal = refuseUnlessWhiteLabel(licence);
    if (refusal) return c.json(refusal, 409);

    const body = await c.req.json().catch(() => ({} as any));
    // REFUSED, NEVER COERCED. `cleanHex` returns null for anything that is not
    // a hex colour, and a null here is a 400 rather than a default — a brand
    // colour quietly replaced by a fallback is a wrong claim about somebody's
    // brand, which is worse than a missing one.
    const primary = cleanHex(body?.primary_hex);
    const accent = cleanHex(body?.accent_hex);
    if (!primary || !accent) {
      return c.json({
        error: 'Both a primary and an accent colour are required, each as a hex value such as '
          + '#0f766e. A white-label shell with only one colour of its own reaches for Axal’s '
          + 'for the other.',
        code: 'invalid_colours',
      }, 400);
    }

    const existing = await kitFor(c.env, licence.id);
    if (!existing.ok) return c.json({ error: KIT_UNREADABLE, code: 'brand_kit_unreadable' }, 503);

    if (existing.row) {
      await c.env.DB.prepare(
        `UPDATE licence_brand_kits
            SET primary_hex = ?, accent_hex = ?, updated_by_user_id = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      ).bind(primary, accent, admin.id, existing.row.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO licence_brand_kits (licence_id, primary_hex, accent_hex, updated_by_user_id)
         VALUES (?,?,?,?)`,
      ).bind(licence.id, primary, accent, admin.id).run();
    }

    // Through `logAdminAction` (D159), and NOT `licence_events`: that table's
    // CHECK admits ten values and widening it cost migration 266 a full
    // rebuild to add one. No `target_user_id` — the subject is a licence, and
    // a licence may have several administrators.
    await logAdminAction(c.env, admin.id, admin.email, 'licence_brand_kit_set', {
      licence_uid: licence.uid,
      licence_ref: licence.licence_ref,
      primary_hex: primary,
      accent_hex: accent,
    });

    const after = await kitFor(c.env, licence.id);
    return c.json({
      ok: true,
      brand_kit: after.ok && after.row ? brandKitPayload(licence.uid, after.row) : null,
    });
  } catch (e) { return mapError(c, e); }
});

// POST /:uid/brand/mark — the logo, multipart.
//
// THE PARSING AND SANITISING HALF IS `readUploadedMark` FROM routes/brand.ts,
// reused rather than re-implemented: the MIME allowlist, the 512 KB cap and
// the SVG sanitisation are one set of rules and two upload paths that decided
// them separately would drift. What is NOT shared is the half that must
// differ — that route is `requireAuth` and keys by the uploader; this one is
// on the super-admin write bar and keys by the LICENCE, so a mark can never
// land in a namespace belonging to whichever operator happened to upload it.
r.post('/:uid/brand/mark', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const refusal = refuseUnlessWhiteLabel(licence);
    if (refusal) return c.json(refusal, 409);

    const ctype = (c.req.header('content-type') || '').toLowerCase();
    if (!ctype.includes('multipart/form-data')) {
      return c.json({ error: 'expected_multipart', code: 'expected_multipart' }, 400);
    }
    const read = await readUploadedMark(await c.req.formData());
    if (!read.ok) return c.json({ error: read.error }, read.status);

    const files = c.env.FILES;
    // STATED, NOT SWALLOWED. Without the binding there is nowhere to put the
    // bytes, and storing a data URI in a TEXT column instead would put a
    // 512 KB blob on every licence payload the console fetches.
    if (!files) {
      return c.json({
        error: 'No object store is bound on this deployment, so a mark cannot be uploaded. The '
          + 'colours can still be set.',
        code: 'r2_unavailable',
      }, 503);
    }

    const existing = await kitFor(c.env, licence.id);
    if (!existing.ok) return c.json({ error: KIT_UNREADABLE, code: 'brand_kit_unreadable' }, 503);

    const key = `licence-marks/${licence.uid}/${crypto.randomUUID()}.${markExtension(read.mime)}`;
    try {
      await files.put(key, read.bytes, {
        httpMetadata: { contentType: read.mime },
        customMetadata: { licenceUid: licence.uid, uploadedAt: new Date().toISOString() },
      });
    } catch {
      return c.json({ error: 'upload failed', code: 'upload_failed' }, 500);
    }

    if (existing.row) {
      await c.env.DB.prepare(
        `UPDATE licence_brand_kits
            SET mark_r2_key = ?, mark_mime = ?, mark_bytes = ?, updated_by_user_id = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      ).bind(key, read.mime, read.bytes.length, admin.id, existing.row.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO licence_brand_kits
           (licence_id, mark_r2_key, mark_mime, mark_bytes, updated_by_user_id)
         VALUES (?,?,?,?,?)`,
      ).bind(licence.id, key, read.mime, read.bytes.length, admin.id).run();
    }

    // The superseded object is removed AFTER the row points at the new one, so
    // a failure here costs an orphan in the bucket rather than a kit whose
    // mark_r2_key names an object that no longer exists.
    if (existing.row?.mark_r2_key && existing.row.mark_r2_key !== key) {
      try { await files.delete(existing.row.mark_r2_key); } catch { /* orphan, not a failure */ }
    }

    await logAdminAction(c.env, admin.id, admin.email, 'licence_brand_mark_set', {
      licence_uid: licence.uid,
      licence_ref: licence.licence_ref,
      mime: read.mime,
      bytes: read.bytes.length,
    });

    const after = await kitFor(c.env, licence.id);
    return c.json({
      ok: true,
      brand_kit: after.ok && after.row ? brandKitPayload(licence.uid, after.row) : null,
    });
  } catch (e) { return mapError(c, e); }
});

// DELETE /:uid/brand/mark — remove the logo, keep the colours.
r.delete('/:uid/brand/mark', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const refusal = refuseUnlessWhiteLabel(licence);
    if (refusal) return c.json(refusal, 409);

    const existing = await kitFor(c.env, licence.id);
    if (!existing.ok) return c.json({ error: KIT_UNREADABLE, code: 'brand_kit_unreadable' }, 503);
    if (!existing.row?.mark_r2_key) {
      return c.json({ error: 'This licence has no mark to remove.', code: 'no_mark' }, 404);
    }

    await c.env.DB.prepare(
      `UPDATE licence_brand_kits
          SET mark_r2_key = NULL, mark_mime = NULL, mark_bytes = NULL,
              updated_by_user_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(admin.id, existing.row.id).run();
    // Row first, bytes second, for the same reason as above.
    try { await c.env.FILES?.delete(existing.row.mark_r2_key); } catch { /* orphan */ }

    await logAdminAction(c.env, admin.id, admin.email, 'licence_brand_mark_removed', {
      licence_uid: licence.uid,
      licence_ref: licence.licence_ref,
      mark_bytes: existing.row.mark_bytes,
    });

    const after = await kitFor(c.env, licence.id);
    return c.json({
      ok: true,
      brand_kit: after.ok && after.row ? brandKitPayload(licence.uid, after.row) : null,
    });
  } catch (e) { return mapError(c, e); }
});

// GET /:uid/brand/mark — the bytes, behind the gate.
//
// A PLAIN GATED STREAM, NOT A SIGNED TOKEN, and the difference is measured
// rather than stylistic. `mintDownloadToken` is ONE-TIME — its `jti` is
// pre-registered in KV and deleted on consume — and hard-clamped to five
// minutes, which is right for a document and wrong for an `<img src>` on a
// page that re-renders: the second render would 404. This is the shape
// `articles.ts:292` already uses for exactly that reason, and three more
// routes after it.
//
// `requireSuperAdmin`, NOT the write bar: drawing a preview is a read, and
// putting a step-up in front of an `<img>` would make the preview blank for an
// operator who is perfectly entitled to see it. A same-origin `<img>` cannot
// send a Bearer header, so this authenticates on the cookie — which is what
// `getCurrentUser` reads first anyway.
r.get('/:uid/brand/mark', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const existing = await kitFor(c.env, licence.id);
    if (!existing.ok) return c.json({ error: KIT_UNREADABLE, code: 'brand_kit_unreadable' }, 503);
    if (!existing.row?.mark_r2_key) return c.json({ error: 'not_found' }, 404);
    if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
    const obj = await c.env.FILES.get(existing.row.mark_r2_key);
    if (!obj) return c.json({ error: 'not_found' }, 404);
    return new Response(obj.body, {
      headers: {
        'content-type': existing.row.mark_mime || 'application/octet-stream',
        // Never cached: a mark is replaceable, the URL does not change when it
        // is replaced, and a stale logo behind a brand is worse than a refetch.
        'cache-control': 'private, no-store',
      },
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
