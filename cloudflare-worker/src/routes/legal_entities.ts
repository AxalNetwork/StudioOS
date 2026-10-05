/**
 * D376 — the entity writes behind the Funds · Fabric canvas's F1: recording
 * what an entity is in the fund fabric, its registration number, registered
 * agent and officers, and which entities a fund runs through (migration 314).
 *
 * Mounted by legal.ts at `/api/legal`, beside `GET /entities` (which stays
 * there, scoped by `entityListScope`). It is its own Hono sub-app, as
 * legal_83b.ts is, so node:test can load it without legal.ts's import graph.
 *
 * WHO MAY WRITE. `POST /entities` keeps the gate it had in legal.ts — admin
 * or partner, the studio's staff — and now validates what it writes. Every
 * write this file adds is ADMIN ONLY: an entity's fabric role, its officers
 * and which fund it is the GP or vehicle of are the structure HQ oversees, not
 * something a partner's desk needs to change. Every write is recorded through
 * `logAdminAction`, with the entity and the names of the fields changed.
 *
 * OFFICERS ARE PEOPLE. They are read by staff only, and nothing here or in the
 * `fundsRegistry` RPC carries them further. An appointment is never deleted:
 * it is ceased, with its date, so who held the office stays on the record.
 *
 * NO TENANT. Which branch an entity belongs to is which database holds it
 * (D245), so nothing here takes or stores one.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import {
  OBLIGATION_KINDS, OBLIGATION_CADENCES, US_PACKS, isoDate, daysUntil, nextDue, packObligations,
  type ObligationCadence, type UsPack,
} from '../services/entityObligations';

const app = new Hono<{ Bindings: Env }>();

/** The four kinds of company `entities.entity_type` allows (baseline CHECK). */
export const ENTITY_TYPES = ['holding_company', 'project', 'subsidiary', 'vc_fund'] as const;
/** What an entity does in a fund (migration 314's CHECK). */
export const FABRIC_ROLES = ['gp_entity', 'management_company', 'fund_vehicle', 'holding', 'operating'] as const;
/** Which of a fund's two links a fund link sets, and the role the entity must hold for it. */
export const FUND_LINKS = { gp: 'gp_entity', vehicle: 'fund_vehicle' } as const;

const TEXT_MAX = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isStaff = (role: unknown) => role === 'admin' || role === 'partner';

/**
 * A text field from a body: absent (`undefined`), cleared (`null`, or blank),
 * or a trimmed string no longer than TEXT_MAX. `false` means it is not text.
 */
export function textField(v: unknown): string | null | undefined | false {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (!t) return null;
  return t.length <= TEXT_MAX ? t : false;
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function body(c: any): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

async function requireAdmin(c: any) {
  const user = await requireAuth(c);
  if (user.role !== 'admin') {
    return { user, refused: refuse(c, 403, { code: 'admin_only', message: 'Only an admin can change how an entity sits in the fund fabric.' }) };
  }
  return { user, refused: null };
}

async function entityById(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT id, uid, name, entity_type, parent_id, jurisdiction, incorporation_date, status,
            fabric_role, registration_number, registered_agent, created_at, updated_at
       FROM entities WHERE id = ?`,
  ).bind(id).first<any>();
}

const notFound = (c: any) => refuse(c, 404, { code: 'entity_not_found', message: 'No entity with that id exists here.' });

/** The fields PATCH may change, and the ones POST also accepts. */
const EDITABLE = ['name', 'jurisdiction', 'fabric_role', 'registration_number', 'registered_agent'] as const;

/**
 * Read EDITABLE from a body, refusing a malformed value. Returns the fields
 * present (a cleared one as null), or the refusal to send.
 */
function readEditable(c: any, b: Record<string, unknown>) {
  const out: Partial<Record<typeof EDITABLE[number], string | null>> = {};
  for (const k of EDITABLE) {
    const v = textField(b[k]);
    if (v === false) {
      return { refused: refuse(c, 400, { code: 'field_invalid', message: `${k} must be text of at most ${TEXT_MAX} characters.`, extra: { field: k } }) };
    }
    if (v !== undefined) out[k] = v;
  }
  if (out.name === null) return { refused: refuse(c, 400, { code: 'name_required', message: 'An entity needs a name.' }) };
  if (out.fabric_role != null && !(FABRIC_ROLES as readonly string[]).includes(out.fabric_role)) {
    return { refused: refuse(c, 400, { code: 'fabric_role_invalid', message: `A fabric role is one of: ${FABRIC_ROLES.join(', ')}.` }) };
  }
  return { fields: out };
}

// POST /api/legal/entities — create an entity (staff, as before; now validated).
app.post('/entities', async (c) => {
  const user = await requireAuth(c);
  if (!isStaff(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const b = await body(c);
  const read = readEditable(c, b);
  if (read.refused) return read.refused;
  const f = read.fields;
  if (!f.name) return refuse(c, 400, { code: 'name_required', message: 'An entity needs a name.' });
  if (typeof b.entity_type !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(b.entity_type)) {
    return refuse(c, 400, { code: 'entity_type_invalid', message: `An entity type is one of: ${ENTITY_TYPES.join(', ')}.` });
  }
  let parentId: number | null = null;
  if (b.parent_id != null && b.parent_id !== '') {
    parentId = positiveInt(b.parent_id);
    if (parentId === null || !(await entityById(c.env, parentId))) {
      return refuse(c, 404, { code: 'parent_not_found', message: 'The parent entity does not exist here.' });
    }
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO entities (name, entity_type, parent_id, jurisdiction, fabric_role, registration_number, registered_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).bind(f.name, b.entity_type, parentId, f.jurisdiction ?? null, f.fabric_role ?? null,
    f.registration_number ?? null, f.registered_agent ?? null).first<{ id: number }>();
  const entity = await entityById(c.env, Number(row!.id));
  await logAdminAction(c.env, user.id, user.email, 'legal.entity.create', {
    entity_id: entity.id, entity_type: entity.entity_type, fields: Object.keys(f),
  });
  return c.json(entity, 201);
});

// PATCH /api/legal/entities/:id — change an entity's name, jurisdiction, role,
// registration number or registered agent (admin). A field sent as null or
// blank is cleared; a field not sent is left as it is.
app.patch('/entities/:id', async (c) => {
  const { user, refused } = await requireAdmin(c);
  if (refused) return refused;
  const id = positiveInt(c.req.param('id'));
  const existing = id ? await entityById(c.env, id) : null;
  if (!existing) return notFound(c);
  const read = readEditable(c, await body(c));
  if (read.refused) return read.refused;
  const f = read.fields;
  const changed = EDITABLE.filter((k) => k in f);
  if (!changed.length) {
    return refuse(c, 400, { code: 'nothing_to_change', message: `Send at least one of: ${EDITABLE.join(', ')}.` });
  }
  // One fixed statement: each column is set only when its flag is 1, so the
  // column list never comes from the request.
  const flag = (k: typeof EDITABLE[number]) => (k in f ? 1 : 0);
  const val = (k: typeof EDITABLE[number]) => (k in f ? f[k] ?? null : null);
  await c.env.DB.prepare(
    `UPDATE entities SET
        name                = CASE WHEN ? = 1 THEN ? ELSE name END,
        jurisdiction        = CASE WHEN ? = 1 THEN ? ELSE jurisdiction END,
        fabric_role         = CASE WHEN ? = 1 THEN ? ELSE fabric_role END,
        registration_number = CASE WHEN ? = 1 THEN ? ELSE registration_number END,
        registered_agent    = CASE WHEN ? = 1 THEN ? ELSE registered_agent END,
        updated_at          = datetime('now')
      WHERE id = ?`,
  ).bind(
    flag('name'), val('name'), flag('jurisdiction'), val('jurisdiction'), flag('fabric_role'), val('fabric_role'),
    flag('registration_number'), val('registration_number'), flag('registered_agent'), val('registered_agent'), id,
  ).run();
  await logAdminAction(c.env, user.id, user.email, 'legal.entity.update', { entity_id: id, fields: changed });
  return c.json(await entityById(c.env, id!));
});

// GET /api/legal/entities/:id/officers — every appointment, ceased ones too (staff).
app.get('/entities/:id/officers', async (c) => {
  const user = await requireAuth(c);
  if (!isStaff(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const id = positiveInt(c.req.param('id'));
  if (!id || !(await entityById(c.env, id))) return notFound(c);
  const rows = await c.env.DB.prepare(
    `SELECT uid, name, title, appointed_on, ceased_on, created_at
       FROM entity_officers WHERE entity_id = ?
      ORDER BY ceased_on IS NOT NULL, appointed_on DESC, id DESC`,
  ).bind(id).all<any>();
  return c.json({ officers: rows.results || [] });
});

// POST /api/legal/entities/:id/officers — record an appointment (admin).
app.post('/entities/:id/officers', async (c) => {
  const { user, refused } = await requireAdmin(c);
  if (refused) return refused;
  const id = positiveInt(c.req.param('id'));
  if (!id || !(await entityById(c.env, id))) return notFound(c);
  const b = await body(c);
  const name = textField(b.name);
  const title = textField(b.title);
  if (!name || !title) {
    return refuse(c, 400, { code: 'officer_invalid', message: `An officer needs a name and a title, each at most ${TEXT_MAX} characters.` });
  }
  const appointed = b.appointed_on == null || b.appointed_on === '' ? null : String(b.appointed_on);
  if (appointed !== null && !DATE_RE.test(appointed)) {
    return refuse(c, 400, { code: 'date_invalid', message: 'appointed_on is a date, YYYY-MM-DD.', extra: { field: 'appointed_on' } });
  }
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO entity_officers (uid, entity_id, name, title, appointed_on, recorded_by) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(uid, id, name, title, appointed, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'legal.entity.officer_appointed', { entity_id: id, officer_uid: uid });
  const officer = await c.env.DB.prepare(
    `SELECT uid, name, title, appointed_on, ceased_on, created_at FROM entity_officers WHERE uid = ?`,
  ).bind(uid).first<any>();
  return c.json({ officer }, 201);
});

// POST /api/legal/entities/:id/officers/:uid/cease — end an appointment (admin).
app.post('/entities/:id/officers/:uid/cease', async (c) => {
  const { user, refused } = await requireAdmin(c);
  if (refused) return refused;
  const id = positiveInt(c.req.param('id'));
  const uid = c.req.param('uid');
  const b = await body(c);
  const ceased = typeof b.ceased_on === 'string' ? b.ceased_on : '';
  if (!DATE_RE.test(ceased)) {
    return refuse(c, 400, { code: 'date_invalid', message: 'ceased_on is a date, YYYY-MM-DD.', extra: { field: 'ceased_on' } });
  }
  const res = await c.env.DB.prepare(
    `UPDATE entity_officers SET ceased_on = ? WHERE uid = ? AND entity_id = ? AND ceased_on IS NULL`,
  ).bind(ceased, uid, id).run();
  if (Number(res.meta?.changes ?? 0) !== 1) {
    const row = await c.env.DB.prepare(`SELECT ceased_on FROM entity_officers WHERE uid = ? AND entity_id = ?`)
      .bind(uid, id).first<any>();
    if (!row) return refuse(c, 404, { code: 'officer_not_found', message: 'No appointment with that id is on this entity.' });
    return refuse(c, 409, { code: 'already_ceased', message: `This appointment already ceased on ${row.ceased_on}.` });
  }
  await logAdminAction(c.env, user.id, user.email, 'legal.entity.officer_ceased', { entity_id: id, officer_uid: uid });
  return c.json({ ok: true, ceased_on: ceased });
});

/**
 * POST /api/legal/entities/:id/funds — make this entity a fund's GP or its
 * vehicle (admin). `{ fund_id, as: 'gp' | 'vehicle' }`. The entity must
 * already hold the matching fabric role, so a link never says a company is
 * something its own record does not. `{ ..., unlink: true }` clears the link,
 * and only if it points at this entity.
 */
app.post('/entities/:id/funds', async (c) => {
  const { user, refused } = await requireAdmin(c);
  if (refused) return refused;
  const id = positiveInt(c.req.param('id'));
  const entity = id ? await entityById(c.env, id) : null;
  if (!entity) return notFound(c);
  const b = await body(c);
  const as = b.as === 'gp' || b.as === 'vehicle' ? b.as : null;
  if (!as) return refuse(c, 400, { code: 'link_invalid', message: 'Say whether this entity is the fund\'s GP ("gp") or its vehicle ("vehicle").' });
  const fundId = positiveInt(b.fund_id);
  const fund = fundId
    ? await c.env.DB.prepare(`SELECT id, gp_entity_id, vehicle_entity_id FROM vc_funds WHERE id = ?`).bind(fundId).first<any>()
    : null;
  if (!fund) return refuse(c, 404, { code: 'fund_not_found', message: 'No fund with that id exists here.' });

  if (b.unlink === true) {
    const current = as === 'gp' ? fund.gp_entity_id : fund.vehicle_entity_id;
    if (current == null || Number(current) !== id) {
      return refuse(c, 409, { code: 'not_linked', message: `This entity is not that fund's ${as === 'gp' ? 'GP' : 'vehicle'}, so there is nothing to unlink.` });
    }
    await c.env.DB.prepare(as === 'gp'
      ? `UPDATE vc_funds SET gp_entity_id = NULL, updated_at = datetime('now') WHERE id = ? AND gp_entity_id = ?`
      : `UPDATE vc_funds SET vehicle_entity_id = NULL, updated_at = datetime('now') WHERE id = ? AND vehicle_entity_id = ?`,
    ).bind(fundId, id).run();
    await logAdminAction(c.env, user.id, user.email, 'legal.entity.fund_unlinked', { entity_id: id, fund_id: fundId, as });
    return c.json({ ok: true, fund_id: fundId, as, entity_id: null });
  }

  if (entity.fabric_role !== FUND_LINKS[as]) {
    return refuse(c, 409, {
      code: 'fabric_role_mismatch',
      message: `Only an entity recorded as ${FUND_LINKS[as]} can be a fund's ${as === 'gp' ? 'GP' : 'vehicle'}; this one is ${entity.fabric_role || 'not recorded'}.`,
    });
  }
  await c.env.DB.prepare(as === 'gp'
    ? `UPDATE vc_funds SET gp_entity_id = ?, updated_at = datetime('now') WHERE id = ?`
    : `UPDATE vc_funds SET vehicle_entity_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id, fundId).run();
  await logAdminAction(c.env, user.id, user.email, 'legal.entity.fund_linked', { entity_id: id, fund_id: fundId, as });
  return c.json({ ok: true, fund_id: fundId, as, entity_id: id });
});


// ── D417 · F2's filings calendar (migration 374) ─────────────────────────────
//
// Read by staff, written by an admin, every write recorded through
// `logAdminAction` with the entity and the obligation's uid. A row is never
// deleted: it is filed or waived, and filing a recurring one opens the next
// occurrence. See services/entityObligations.ts for the rules.

const MIN_REASON = 8;
const today = () => new Date().toISOString().slice(0, 10);

/** One row as served: the stored columns plus days left on an open, dated one. */
function obligationOut(r: any, on: string) {
  return { ...r, days_left: r.status === 'open' && r.due_date ? daysUntil(r.due_date, on) : null };
}

async function obligationByUid(env: Env, entityId: number, uid: string) {
  return env.DB.prepare(
    `SELECT id, entity_id, uid, kind, title, cadence, due_date, status, resolved_on, resolution_note, next_uid,
            source, pack_key, note, created_at, updated_at FROM entity_obligations WHERE uid = ? AND entity_id = ?`,
  ).bind(uid, entityId).first<any>();
}

// GET /api/legal/entities/:id/obligations — the calendar (staff). Open ones
// first, soonest first; then the resolved history, newest first.
app.get('/entities/:id/obligations', async (c) => {
  const user = await requireAuth(c);
  if (!isStaff(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const id = positiveInt(c.req.param('id'));
  if (!id || !(await entityById(c.env, id))) return notFound(c);
  const rows = await c.env.DB.prepare(
    `SELECT uid, kind, title, cadence, due_date, status, resolved_on, resolution_note, next_uid,
            source, pack_key, note, created_at, updated_at FROM entity_obligations WHERE entity_id = ?
      ORDER BY status <> 'open', CASE WHEN status = 'open' THEN due_date END IS NULL,
               CASE WHEN status = 'open' THEN due_date END, resolved_on DESC, id DESC`,
  ).bind(id).all<any>();
  const on = today();
  return c.json({ as_of: on, obligations: (rows.results || []).map((r) => obligationOut(r, on)) });
});

// POST /api/legal/entities/:id/obligations — enter one (admin).
// { kind, title, cadence, due_date?, note? }. A dated cadence needs a real
// date; only an event-driven obligation may have none.
app.post('/entities/:id/obligations', async (c) => {
  const { user, refused } = await requireAdmin(c);
  if (refused) return refused;
  const id = positiveInt(c.req.param('id'));
  if (!id || !(await entityById(c.env, id))) return notFound(c);
  const b = await body(c);
  const kind = typeof b.kind === 'string' && (OBLIGATION_KINDS as readonly string[]).includes(b.kind) ? b.kind : null;
  if (!kind) return refuse(c, 400, { code: 'kind_invalid', message: `An obligation kind is one of: ${OBLIGATION_KINDS.join(', ')}.` });
  const title = textField(b.title);
  if (!title) return refuse(c, 400, { code: 'title_required', message: `An obligation needs a title of at most ${TEXT_MAX} characters.` });
  const cadence = typeof b.cadence === 'string' && (OBLIGATION_CADENCES as readonly string[]).includes(b.cadence)
    ? b.cadence as ObligationCadence : null;
  if (!cadence) return refuse(c, 400, { code: 'cadence_invalid', message: `A cadence is one of: ${OBLIGATION_CADENCES.join(', ')}.` });
  const due = b.due_date == null || b.due_date === '' ? null : isoDate(b.due_date);
  if (b.due_date != null && b.due_date !== '' && !due) {
    return refuse(c, 400, { code: 'date_invalid', message: 'due_date is a calendar date, YYYY-MM-DD.', extra: { field: 'due_date' } });
  }
  if (!due && cadence !== 'event') {
    return refuse(c, 400, { code: 'due_date_required', message: 'Only an event-driven obligation can be entered without a due date.' });
  }
  const note = textField(b.note);
  if (note === false) return refuse(c, 400, { code: 'field_invalid', message: `note must be text of at most ${TEXT_MAX} characters.`, extra: { field: 'note' } });
  const uid = crypto.randomUUID();
  const res = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO entity_obligations (uid, entity_id, kind, title, cadence, due_date, source, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
  ).bind(uid, id, kind, title, cadence, due, note ?? null, user.id).run();
  if (Number(res.meta?.changes ?? 0) !== 1) {
    return refuse(c, 409, { code: 'already_recorded', message: 'This entity already has that obligation for that date.' });
  }
  await logAdminAction(c.env, user.id, user.email, 'legal.entity.obligation_added', { entity_id: id, obligation_uid: uid, kind });
  const row = await obligationByUid(c.env, id, uid);
  return c.json({ obligation: obligationOut(row, today()) }, 201);
});

// POST /api/legal/entities/:id/obligations/pack — seed a US pack (admin).
// { pack: 'us_de_llc' | 'us_de_ccorp' }. Idempotent: an obligation already
// on the calendar for its date is left alone. A rule dated from formation is
// skipped, with its reason, when the entity records no formation date.
app.post('/entities/:id/obligations/pack', async (c) => {
  const { user, refused } = await requireAdmin(c);
  if (refused) return refused;
  const id = positiveInt(c.req.param('id'));
  const entity = id ? await entityById(c.env, id) : null;
  if (!entity) return notFound(c);
  const b = await body(c);
  const pack = typeof b.pack === 'string' && (US_PACKS as readonly string[]).includes(b.pack) ? b.pack as UsPack : null;
  if (!pack) {
    return refuse(c, 400, {
      code: 'pack_unknown',
      message: `The packs on file are ${US_PACKS.join(' and ')}. Another jurisdiction's pack is defined once at HQ, and that registry is not built yet.`,
    });
  }
  const on = today();
  const { rows, skipped } = packObligations(pack, on, isoDate(String(entity.incorporation_date ?? '').slice(0, 10)));
  const added: string[] = [];
  for (const r of rows) {
    const uid = crypto.randomUUID();
    const res = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO entity_obligations (uid, entity_id, kind, title, cadence, due_date, source, pack_key, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pack', ?, ?, ?)`,
    ).bind(uid, id, r.kind, r.title, r.cadence, r.due_date, r.pack_key, r.note, user.id).run();
    if (Number(res.meta?.changes ?? 0) === 1) added.push(uid);
  }
  await logAdminAction(c.env, user.id, user.email, 'legal.entity.obligations_seeded', {
    entity_id: id, pack, added: added.length, skipped: skipped.length,
  });
  return c.json({ pack, added: added.length, already_on_calendar: rows.length - added.length, skipped });
});

/**
 * File or waive one open obligation (admin). Both are guarded on `status =
 * 'open'` so a second click, or a race, resolves it once. Filing a recurring
 * one opens its next occurrence in the same batch.
 */
async function resolveObligation(c: any, outcome: 'filed' | 'waived') {
  const { user, refused } = await requireAdmin(c);
  if (refused) return refused;
  const id = positiveInt(c.req.param('id'));
  if (!id || !(await entityById(c.env, id))) return notFound(c);
  const uid = c.req.param('uid');
  const row = await obligationByUid(c.env, id, uid);
  if (!row) return refuse(c, 404, { code: 'obligation_not_found', message: 'No obligation with that id is on this entity.' });
  if (row.status !== 'open') {
    return refuse(c, 409, { code: 'already_resolved', message: `This obligation was already ${row.status} on ${row.resolved_on}.` });
  }
  const b = await body(c);
  const on = b.on == null || b.on === '' ? today() : isoDate(b.on);
  if (!on) return refuse(c, 400, { code: 'date_invalid', message: 'on is a calendar date, YYYY-MM-DD.', extra: { field: 'on' } });
  const noteRaw = typeof b.note === 'string' ? b.note.trim() : '';
  if (outcome === 'waived' && noteRaw.length < MIN_REASON) {
    return refuse(c, 400, { code: 'reason_required', message: `Waiving an obligation needs a reason of at least ${MIN_REASON} characters. It is stored with it.` });
  }
  const note = textField(b.note);
  if (note === false) return refuse(c, 400, { code: 'field_invalid', message: `note must be text of at most ${TEXT_MAX} characters.`, extra: { field: 'note' } });

  const next = outcome === 'filed' && row.due_date ? nextDue(row.due_date, row.cadence) : null;
  const nextUid = next ? crypto.randomUUID() : null;
  const stmts = [
    c.env.DB.prepare(
      `UPDATE entity_obligations
          SET status = ?, resolved_on = ?, resolved_by = ?, resolution_note = ?, next_uid = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'open'`,
    ).bind(outcome, on, user.id, note ?? null, nextUid, row.id),
  ];
  if (next) {
    // Only when the update above landed: it is the one that wrote this
    // request's next_uid, so a request that lost a race opens nothing.
    stmts.push(c.env.DB.prepare(
      `INSERT OR IGNORE INTO entity_obligations (uid, entity_id, kind, title, cadence, due_date, source, pack_key, note, created_by)
       SELECT ?, entity_id, kind, title, cadence, ?, source, pack_key, note, ? FROM entity_obligations WHERE id = ? AND next_uid = ?`,
    ).bind(nextUid, next, user.id, row.id, nextUid));
  }
  const results = await c.env.DB.batch(stmts);
  if (Number((results[0] as any)?.meta?.changes ?? 0) !== 1) {
    return refuse(c, 409, { code: 'already_resolved', message: 'This obligation was resolved by someone else first.' });
  }
  let opened = nextUid ? await obligationByUid(c.env, id, nextUid) : null;
  let linkedUid = nextUid;
  if (nextUid && !opened) {
    // The next occurrence was already on the calendar (entered by hand, or
    // seeded), so the insert was ignored. Link the filed row to that one
    // rather than to a uid that names nothing.
    const existing = await c.env.DB.prepare(
      `SELECT uid FROM entity_obligations WHERE entity_id = ? AND kind = ? AND title = ? AND due_date = ?`,
    ).bind(id, row.kind, row.title, next).first();
    linkedUid = existing?.uid ?? null;
    await c.env.DB.prepare(`UPDATE entity_obligations SET next_uid = ? WHERE id = ?`)
      .bind(linkedUid, row.id).run();
    opened = linkedUid ? await obligationByUid(c.env, id, linkedUid) : null;
  }
  // Recorded after the link is settled, so the log names the occurrence the
  // filed row actually points at.
  await logAdminAction(c.env, user.id, user.email, `legal.entity.obligation_${outcome}`, {
    entity_id: id, obligation_uid: uid, on, ...(linkedUid ? { next_uid: linkedUid } : {}),
  });
  const resolved = await obligationByUid(c.env, id, uid);
  const t = today();
  return c.json({ obligation: obligationOut(resolved, t), next: opened ? obligationOut(opened, t) : null });
}

// POST /api/legal/entities/:id/obligations/:uid/file — { on?, note? }
app.post('/entities/:id/obligations/:uid/file', (c) => resolveObligation(c, 'filed'));
// POST /api/legal/entities/:id/obligations/:uid/waive — { note (reason), on? }
app.post('/entities/:id/obligations/:uid/waive', (c) => resolveObligation(c, 'waived'));

export default app;
