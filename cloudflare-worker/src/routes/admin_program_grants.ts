/**
 * D982 (#2773, part 1 of #2376) — HQ's program grants: which programs each
 * licensed studio may run, and on what terms. Mounted at
 * `/api/admin/program-grants`.
 *
 *   GET    /                                  the grid: licences × programs, the tiles, the two series
 *   GET    /defaults                          every program's default terms and "can be granted"
 *   PUT    /defaults/:program                 change a program's defaults          (write bar, reason)
 *   GET    /licences/:uid                     one licence's grants and its program history
 *   GET    /licences/:uid/history[?program=]  that history alone
 *   POST   /licences/:uid/:program            grant                                (write bar, reason)
 *   PATCH  /licences/:uid/:program            change terms                         (write bar, reason)
 *   POST   /licences/:uid/:program/pause      pause                                (write bar, reason)
 *   POST   /licences/:uid/:program/resume     resume                               (write bar, reason)
 *   POST   /licences/:uid/:program/end        end                                  (write bar, reason)
 *
 * WHO. Reads are `requireSuperAdmin`, as the ledger's are. Every write is
 * `requireSuperAdminWriteBar` (a TOTP session, a fresh step-up, the
 * elevation), as a terms save is, with a reason of at least 10 characters.
 *
 * WHAT A WRITE LEAVES. Each grant write appends one `licence_events`
 * `program_changed` row (D982 §4) whose note is the reason and whose detail is
 * `{ action, program_key, changed, reason }`. A defaults change is not one
 * licence's, so it goes to the admin audit log (`logAdminAction`).
 *
 * THE FREEZE. A suspended licence is frozen (D981 §2): grant, change terms and
 * resume are refused there; pause and end stay open, as they do on every
 * licence. A terminated licence takes no grant, change or resume either.
 *
 * THE BRANCH'S COPY (D984). Each grant write pushes the licence to its branch,
 * which carries the grants (`branch_licence.program_grants_json`, migration
 * 554), and answers `pushed` as a terms save does; a push that does not land
 * is retried (D272). A defaults change pushes nothing: it reaches each branch
 * with that licence's next push.
 *
 * A D1 failure is a 5xx through `mapError`, never an empty list.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { pushLicenceToBranch } from '../services/licencePush';
import {
  DEFAULT_KEYS, TERM_KEYS, presentGrant, programOf, readDefaults, readGrid, readHistory, readinessRefusal,
  termsDiff, termsOf, validateTerms, type LicenceLite, type Terms,
} from '../services/programGrants';

const r = new Hono<{ Bindings: Env }>();

const today = () => new Date().toISOString().slice(0, 10);
export const REASON_MIN = 10;

/** The reason a write must carry, or the refusal that says so. */
function reasonOf(b: any): { ok: true; reason: string } | { ok: false; body: Record<string, unknown> } {
  const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  if (reason.length < REASON_MIN) {
    return { ok: false, body: { error: 'reason_required', message: `Say why, in at least ${REASON_MIN} characters. It is the line HQ's record keeps.` } };
  }
  return { ok: true, reason };
}

function noteOf(b: any): { ok: true; note: string | null | undefined } | { ok: false } {
  if (b?.note === undefined) return { ok: true, note: undefined };
  if (b.note === null || b.note === '') return { ok: true, note: null };
  if (typeof b.note !== 'string' || b.note.length > 2000) return { ok: false };
  return { ok: true, note: b.note.trim() || null };
}

async function licenceByUid(env: Env, uid: string) {
  return await env.DB.prepare('SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences WHERE uid = ?')
    .bind(uid).first<LicenceLite>();
}

async function grantRow(env: Env, licenceId: number, programKey: string) {
  return await env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? AND program_key = ?')
    .bind(licenceId, programKey).first<Record<string, any>>();
}

async function logProgram(env: Env, licenceId: number, actorId: number, detail: Record<string, unknown>, reason: string) {
  await env.DB.prepare(
    `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
     VALUES (?, 'program_changed', ?, ?, ?, ?)`,
  ).bind(licenceId, JSON.stringify(detail), reason, actorId, nowIso()).run();
}

/** Why this licence cannot take a grant, a change or a resume now; null when it can. */
function frozen(licence: LicenceLite): string | null {
  if (licence.status === 'terminated') return 'This licence is terminated, so it holds no programs.';
  if (licence.status === 'suspended') return 'This licence is suspended. Program changes are frozen until HQ lifts the suspension; pause and end stay open.';
  if (licence.status === 'draft') return 'This licence is a draft. Issue it before granting a program.';
  return null;
}

const refuse = (c: any, status: 400 | 404 | 409 | 422, error: string, message: string, extra: Record<string, unknown> = {}) =>
  c.json({ error, message, ...extra }, status);

/** Body, licence and program for a grant write, after the write bar. */
async function target(c: any) {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await c.req.json().catch(() => ({} as any));
  const reason = reasonOf(b);
  if (!reason.ok) return { refused: c.json(reason.body, 400) };
  const programKey = c.req.param('program');
  if (!programOf(programKey)) return { refused: refuse(c, 404, 'unknown_program', 'There is no such program.') };
  const licence = await licenceByUid(c.env, c.req.param('uid'));
  if (!licence) return { refused: refuse(c, 404, 'not_found', 'There is no such licence.') };
  return { admin, b, reason: reason.reason, programKey, licence };
}

// THE STATEMENTS ARE WRITTEN OUT, never assembled from a column list: no SQL
// text here is built at run time (scripts/check-sql-prepare.mjs). Their term
// columns are TERM_KEYS in order; `program_grants_d982.test.ts` holds them equal.
export const SQL_TERM_COLUMNS = 'starts_on, ends_on, ends_with_licence, capacity_cap, capacity_uncapped, cohorts_per_year, credits_per_quarter, fee_cents, currency, hq_share_bps, hq_approves_each_cohort, hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule';
const INSERT_GRANT = `INSERT INTO program_grants
  (uid, licence_id, program_key, state, starts_on, ends_on, ends_with_licence, capacity_cap, capacity_uncapped, cohorts_per_year, credits_per_quarter, fee_cents, currency, hq_share_bps, hq_approves_each_cohort, hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule, note, set_by_user_id, set_at)
  VALUES (?, ?, ?, 'granted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const REGRANT = `UPDATE program_grants SET state = 'granted', starts_on = ?, ends_on = ?, ends_with_licence = ?, capacity_cap = ?, capacity_uncapped = ?, cohorts_per_year = ?, credits_per_quarter = ?, fee_cents = ?, currency = ?, hq_share_bps = ?, hq_approves_each_cohort = ?, hq_approval_above_cents = ?, playbook = ?, brand = ?, reporting = ?, requires_signed_schedule = ?,
  note = ?, set_by_user_id = ?, set_at = ?, paused_at = NULL, ended_at = NULL, schedule_contract_uid = NULL, schedule_signed_at = NULL
  WHERE id = ? AND state = 'ended'`;
const CHANGE_TERMS = `UPDATE program_grants SET starts_on = ?, ends_on = ?, ends_with_licence = ?, capacity_cap = ?, capacity_uncapped = ?, cohorts_per_year = ?, credits_per_quarter = ?, fee_cents = ?, currency = ?, hq_share_bps = ?, hq_approves_each_cohort = ?, hq_approval_above_cents = ?, playbook = ?, brand = ?, reporting = ?, requires_signed_schedule = ?, note = ?, set_by_user_id = ?, set_at = ?
  WHERE id = ? AND state IN ('granted', 'paused')`;
const UPDATE_DEFAULTS = `UPDATE program_grant_defaults SET grantable = ?, ends_with_licence = ?, capacity_cap = ?, capacity_uncapped = ?, cohorts_per_year = ?, credits_per_quarter = ?, fee_cents = ?, currency = ?, hq_share_bps = ?, hq_approves_each_cohort = ?, hq_approval_above_cents = ?, playbook = ?, brand = ?, reporting = ?, requires_signed_schedule = ?, updated_by_user_id = ?, updated_at = ?
  WHERE program_key = ?`;
const PAUSE = "UPDATE program_grants SET state = 'paused', paused_at = ?, set_by_user_id = ?, set_at = ? WHERE id = ? AND state = 'granted'";
const RESUME = "UPDATE program_grants SET state = 'granted', paused_at = NULL, set_by_user_id = ?, set_at = ? WHERE id = ? AND state = 'paused'";
const END = "UPDATE program_grants SET state = 'ended', ended_at = ?, set_by_user_id = ?, set_at = ? WHERE id = ? AND state IN ('granted', 'paused')";
const termValues = (t: Terms) => TERM_KEYS.map((k) => t[k] ?? null);

// ─────────────────────────────────────────────── reads

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    const [grid, defaults] = [await readGrid(c.env, today()), await readDefaults(c.env)];
    return c.json({ programs: defaults, ...grid });
  } catch (e) { return mapError(c, e); }
});

r.get('/defaults', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json({ programs: await readDefaults(c.env) });
  } catch (e) { return mapError(c, e); }
});

r.get('/licences/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceByUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    const rows = ((await c.env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? ORDER BY id').bind(licence.id)
      .all<Record<string, any>>()).results || []);
    const t = today();
    return c.json({
      licence: { uid: licence.uid, licence_ref: licence.licence_ref, brand_name: licence.brand_name, kind: licence.kind, status: licence.status, renews_on: licence.renews_on },
      grants: rows.map((g) => presentGrant(g, licence, t)),
      history: await readHistory(c.env, licence.id),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/licences/:uid/history', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceByUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    return c.json({ licence_uid: licence.uid, history: await readHistory(c.env, licence.id, c.req.query('program') || null) });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── defaults

r.put('/defaults/:program', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const b = await c.req.json().catch(() => ({} as any));
    const reason = reasonOf(b);
    if (!reason.ok) return c.json(reason.body, 400);
    const key = c.req.param('program');
    if (!programOf(key)) return refuse(c, 404, 'unknown_program', 'There is no such program.');
    if (b?.grantable !== undefined && typeof b.grantable !== 'boolean') return refuse(c, 400, 'invalid_grantable', 'grantable must be true or false.');
    if (b?.grantable === true && readinessRefusal(key)) return refuse(c, 422, 'not_grantable', readinessRefusal(key)!);
    const v = validateTerms(key, b?.terms, { defaults: true });
    if (!v.ok) return refuse(c, 400, 'invalid_terms', `${v.errors[0].field} ${v.errors[0].message}.`, { errors: v.errors });
    const before = (await readDefaults(c.env)).find((d) => d.program_key === key)!;
    const after: Terms = { ...before.terms, ...v.terms };
    if (after.capacity_cap != null && after.capacity_uncapped === 1) {
      return refuse(c, 400, 'invalid_terms', 'capacity_uncapped cannot be set with a capacity cap.');
    }
    const grantable = b?.grantable === undefined ? before.grantable : b.grantable;
    await c.env.DB.prepare(UPDATE_DEFAULTS)
      .bind(grantable ? 1 : 0, ...DEFAULT_KEYS.map((k) => after[k] ?? null), admin.id, nowIso(), key).run();
    const changed = termsDiff(before.terms, after);
    if (grantable !== before.grantable) changed.push({ key: 'grantable', before: before.grantable ? 1 : 0, after: grantable ? 1 : 0 });
    await logAdminAction(c.env, admin.id, admin.email, 'program_grant_defaults_changed', { program_key: key, changed, reason: reason.reason });
    return c.json({ ok: true, program: (await readDefaults(c.env)).find((d) => d.program_key === key), changed });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── grant writes

r.post('/licences/:uid/:program', async (c) => {
  try {
    const t = await target(c);
    if ('refused' in t) return t.refused;
    const { admin, b, reason, programKey, licence } = t;
    const notReady = readinessRefusal(programKey);
    if (notReady) return refuse(c, 422, 'not_grantable', notReady);
    const defaults = (await readDefaults(c.env)).find((d) => d.program_key === programKey)!;
    if (!defaults.grantable) return refuse(c, 422, 'not_grantable', `${defaults.name} is switched off in HQ's default terms, so it cannot be granted.`);
    const blocked = frozen(licence);
    if (blocked) return refuse(c, 409, 'licence_frozen', blocked);
    const v = validateTerms(programKey, b?.terms);
    if (!v.ok) return refuse(c, 400, 'invalid_terms', `${v.errors[0].field} ${v.errors[0].message}.`, { errors: v.errors });
    const note = noteOf(b);
    if (!note.ok) return refuse(c, 400, 'invalid_note', 'The note to the studio is at most 2000 characters.');
    const existing = await grantRow(c.env, licence.id, programKey);
    if (existing && existing.state !== 'ended') {
      return refuse(c, 409, 'already_granted', `${defaults.name} is already ${existing.state} for this licence. Change its terms, resume or end it instead.`);
    }
    // The defaults fill every term the grant leaves out; what HQ names wins.
    const terms: Terms = { ...Object.fromEntries(Object.entries(defaults.terms).map(([k, val]) => [k, val ?? null])), ...v.terms };
    if (terms.capacity_cap != null && terms.capacity_uncapped === 1) {
      return refuse(c, 400, 'invalid_terms', 'capacity_uncapped cannot be set with a capacity cap.');
    }
    const at = nowIso();
    if (existing) {
      // A re-grant after an end: the same row starts again, with fresh terms and schedule.
      const res = await c.env.DB.prepare(REGRANT).bind(...termValues(terms), note.note ?? null, admin.id, at, existing.id).run();
      if (!res.meta?.changes) return refuse(c, 409, 'already_granted', `${defaults.name} changed while you were granting it. Read it again.`);
    } else {
      await c.env.DB.prepare(INSERT_GRANT)
        .bind(newUid(), licence.id, programKey, ...termValues(terms), note.note ?? null, admin.id, at).run();
    }
    const changed = termsDiff({}, Object.fromEntries(Object.entries(terms).filter(([, val]) => val != null)));
    await logProgram(c.env, licence.id, admin.id, { action: existing ? 'regranted' : 'granted', program_key: programKey, changed, reason }, reason);
    const saved = await grantRow(c.env, licence.id, programKey);
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    return c.json({ ok: true, grant: presentGrant(saved!, licence, today()), pushed }, existing ? 200 : 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/licences/:uid/:program', async (c) => {
  try {
    const t = await target(c);
    if ('refused' in t) return t.refused;
    const { admin, b, reason, programKey, licence } = t;
    const blocked = frozen(licence);
    if (blocked) return refuse(c, 409, 'licence_frozen', blocked);
    const existing = await grantRow(c.env, licence.id, programKey);
    if (!existing || existing.state === 'ended') return refuse(c, 409, 'not_granted', 'This program is not granted to this licence, so it has no terms to change.');
    const v = validateTerms(programKey, b?.terms);
    if (!v.ok) return refuse(c, 400, 'invalid_terms', `${v.errors[0].field} ${v.errors[0].message}.`, { errors: v.errors });
    const note = noteOf(b);
    if (!note.ok) return refuse(c, 400, 'invalid_note', 'The note to the studio is at most 2000 characters.');
    const before = termsOf(existing, programKey);
    const after: Terms = { ...before, ...v.terms };
    if (after.capacity_cap != null && after.capacity_uncapped === 1) {
      return refuse(c, 400, 'invalid_terms', 'capacity_uncapped cannot be set with a capacity cap.');
    }
    const changed = termsDiff(before, after);
    const noteChanged = note.note !== undefined && (note.note ?? null) !== (existing.note ?? null);
    if (!changed.length && !noteChanged) return refuse(c, 400, 'no_change', 'Nothing changes: these are the terms the grant already has.');
    const res = await c.env.DB.prepare(CHANGE_TERMS)
      .bind(...termValues(after), note.note === undefined ? (existing.note ?? null) : note.note, admin.id, nowIso(), existing.id).run();
    if (!res.meta?.changes) return refuse(c, 409, 'not_granted', 'This grant changed while you were changing it. Read it again.');
    await logProgram(c.env, licence.id, admin.id, { action: 'terms_changed', program_key: programKey, changed, note_changed: noteChanged, reason }, reason);
    const saved = await grantRow(c.env, licence.id, programKey);
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    return c.json({ ok: true, grant: presentGrant(saved!, licence, today()), changed, pushed });
  } catch (e) { return mapError(c, e); }
});

/** Pause, resume and end: a state change from the states it may leave. */
function transition(action: 'paused' | 'resumed' | 'ended', from: string[], to: 'granted' | 'paused' | 'ended') {
  return async (c: any) => {
    try {
      const t = await target(c);
      if ('refused' in t) return t.refused;
      const { admin, reason, programKey, licence } = t;
      if (action === 'resumed') {
        const blocked = frozen(licence);
        if (blocked) return refuse(c, 409, 'licence_frozen', blocked);
      }
      const existing = await grantRow(c.env, licence.id, programKey);
      if (!existing || !from.includes(existing.state)) {
        const now = existing ? existing.state : 'not granted';
        return refuse(c, 409, 'wrong_state', `This program is ${now} for this licence, so it cannot be ${action}.`, { state: existing?.state ?? null });
      }
      const at = nowIso();
      const res = action === 'resumed'
        ? await c.env.DB.prepare(RESUME).bind(admin.id, at, existing.id).run()
        : await c.env.DB.prepare(action === 'paused' ? PAUSE : END).bind(at, admin.id, at, existing.id).run();
      if (!res.meta?.changes) return refuse(c, 409, 'wrong_state', 'This grant changed while you were changing it. Read it again.');
      await logProgram(c.env, licence.id, admin.id, {
        action, program_key: programKey, changed: [{ key: 'state', before: existing.state, after: to }], reason,
      }, reason);
      const saved = await grantRow(c.env, licence.id, programKey);
      const pushed = await pushLicenceToBranch(c.env, licence.id);
      return c.json({ ok: true, grant: presentGrant(saved!, licence, today()), pushed });
    } catch (e) { return mapError(c, e); }
  };
}

r.post('/licences/:uid/:program/pause', transition('paused', ['granted'], 'paused'));
r.post('/licences/:uid/:program/resume', transition('resumed', ['paused'], 'granted'));
r.post('/licences/:uid/:program/end', transition('ended', ['granted', 'paused'], 'ended'));

export default r;
