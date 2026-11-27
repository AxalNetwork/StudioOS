/**
 * D986 (#2776, part 5 of #2376) — HQ sets which partner deal types each
 * licence may offer (the canvas's GR3, "Partner deal types this studio may
 * offer"). Mounted at `/api/admin/partner-deal-types`.
 *
 *   GET  /                 every licence, with its types or "Not recorded"
 *   GET  /licences/:uid    one licence: its types and their history
 *   PUT  /licences/:uid    set them { types: [...] | null, reason }   (write bar)
 *
 * WHO. Reads are `requireSuperAdmin`, as the ledger's are. The write is
 * `requireSuperAdminWriteBar` (a TOTP session, a fresh step-up, the
 * elevation), as a terms save is, with a reason of at least 10 characters.
 *
 * WHAT A WRITE LEAVES. The row and one `licence_events` `program_changed` row,
 * in one batch: D982 §5's generic kind, here with the action
 * `deal_types_changed`, the reason as its note and `{ before, after }` in its
 * detail. Then the licence is pushed, so the branch's copy carries the new set
 * (a push that does not land is retried, D272).
 *
 * `types: null` clears the row: the licence reads "Not recorded" again. An
 * empty list is a decision, recorded as such: the studio offers none.
 *
 * A D1 failure is a 5xx through `mapError`, never an empty list.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { pushLicenceToBranch } from '../services/licencePush';
import {
  DealTypesInputError, NOT_RECORDED_SENTENCE, catalogue, normalizeTypes, readAllHqDealTypes, readHqDealTypes,
} from '../services/partnerDealTypes';

const r = new Hono<{ Bindings: Env }>();

export const REASON_MIN = 10;

type Licence = { id: number; uid: string; licence_ref: string | null; brand_name: string | null; status: string };

async function licenceByUid(env: Env, uid: string): Promise<Licence | null> {
  return await env.DB.prepare('SELECT id, uid, licence_ref, brand_name, status FROM territory_licences WHERE uid = ?')
    .bind(uid).first<Licence>();
}

const licenceView = (l: Licence) => ({ uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, status: l.status });

/** This licence's deal-type changes, newest first. */
async function history(env: Env, licenceId: number) {
  const res = await env.DB.prepare(
    `SELECT detail_json, note, actor_user_id, created_at FROM licence_events
      WHERE licence_id = ? AND event = 'program_changed'
        AND json_extract(detail_json, '$.action') = 'deal_types_changed'
      ORDER BY created_at DESC, id DESC LIMIT 50`,
  ).bind(licenceId).all<{ detail_json: string; note: string | null; actor_user_id: number | null; created_at: string }>();
  return (res.results || []).map((e) => {
    let d: any = {};
    try { d = JSON.parse(e.detail_json || '{}'); } catch { /* a malformed detail keeps its date and reason */ }
    return { at: e.created_at, by_user_id: e.actor_user_id, reason: e.note, before: d.before ?? null, after: d.after ?? null };
  });
}

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licences = await c.env.DB.prepare(
      'SELECT id, uid, licence_ref, brand_name, status FROM territory_licences ORDER BY licence_ref, id',
    ).all<Licence>();
    const rows = await readAllHqDealTypes(c.env);
    return c.json({
      catalogue: catalogue(),
      licences: (licences.results || []).map((l) => {
        const rec = rows.get(Number(l.id));
        return rec
          ? { ...licenceView(l), recorded: true, types: rec.types, updated_at: rec.updated_at, reason: null }
          : { ...licenceView(l), recorded: false, types: null, updated_at: null, reason: NOT_RECORDED_SENTENCE };
      }),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/licences/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceByUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found', message: 'There is no such licence.' }, 404);
    const rec = await readHqDealTypes(c.env, licence.id);
    return c.json({ licence: licenceView(licence), catalogue: catalogue(), ...rec, history: await history(c.env, licence.id) });
  } catch (e) { return mapError(c, e); }
});

r.put('/licences/:uid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const b = await c.req.json().catch(() => ({} as any));
    const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (reason.length < REASON_MIN) {
      return c.json({ error: 'reason_required', message: `Say why, in at least ${REASON_MIN} characters. It is the line HQ's record keeps.` }, 400);
    }
    if (!Object.prototype.hasOwnProperty.call(b ?? {}, 'types')) {
      return c.json({ error: 'types_required', message: 'Send `types`: the deal types this studio may offer, or null to clear them.', valid: catalogue().map((t) => t.type) }, 400);
    }
    let after;
    try { after = normalizeTypes(b.types); } catch (e) {
      if (e instanceof DealTypesInputError) return c.json({ error: e.code, message: e.sentence, ...e.extra }, 400);
      throw e;
    }
    const licence = await licenceByUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found', message: 'There is no such licence.' }, 404);
    if (licence.status === 'terminated') {
      return c.json({ error: 'licence_terminated', message: 'This licence is terminated, so it offers no partner deals.' }, 409);
    }
    const now = await readHqDealTypes(c.env, licence.id);
    const before = now.recorded ? now.types : null;
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return c.json({ error: 'unchanged', message: 'Those are already this studio\'s partner deal types.' }, 409);
    }
    const at = nowIso();
    const write = after === null
      ? c.env.DB.prepare('DELETE FROM licence_partner_deal_types WHERE licence_id = ?').bind(licence.id)
      : c.env.DB.prepare(
        `INSERT INTO licence_partner_deal_types (licence_id, types_json, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(licence_id) DO UPDATE SET types_json = excluded.types_json,
           updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      ).bind(licence.id, JSON.stringify(after), admin.id, at);
    await c.env.DB.batch([
      write,
      c.env.DB.prepare(
        `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
         VALUES (?, 'program_changed', ?, ?, ?, ?)`,
      ).bind(licence.id, JSON.stringify({ action: 'deal_types_changed', program_key: null, before, after, reason }), reason, admin.id, at),
    ]);
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    return c.json({ ok: true, licence: licenceView(licence), ...(await readHqDealTypes(c.env, licence.id)), pushed });
  } catch (e) { return mapError(c, e); }
});

export default r;
