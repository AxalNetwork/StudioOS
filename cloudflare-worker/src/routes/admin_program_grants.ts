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
 *   GET    /history[?program=&licence=&before=&limit=]  every licence's history, newest first (D1126)
 *   GET    /export.csv                        the grid as CSV, one row per studio and program (D1126)
 *   GET    /licences/:uid/export.csv          one studio's rows (D1126)
 *   POST   /licences/:uid/:program            grant                                (write bar, reason)
 *   PATCH  /licences/:uid/:program            change terms                         (write bar, reason)
 *   POST   /licences/:uid/:program/pause      pause                                (write bar, reason)
 *   POST   /licences/:uid/:program/resume     resume                               (write bar, reason)
 *   POST   /licences/:uid/:program/end        end                                  (write bar, reason)
 *   POST   /licences/:uid/:program/schedule/send  send the schedule for signature  (write bar, reason)
 *
 * THE SCHEDULE (D1120). A grant under the signed-schedule rule waits on
 * `schedule_signed` until the studio signs its schedule. The send builds the
 * schedule from the grant's terms (`services/programSchedule.ts`), sends it
 * through e-sign to the licence's principal administrator, and stores the
 * envelope's uuid as `schedule_contract_uid`. The envelope's completion sets
 * `schedule_signed_at` once (`onProgramScheduleEnvelopeCompleted`, called from
 * the e-sign completion block and the DocuSign poller).
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
 * A DRAFT (D956, migration 562). A proposal HQ approves for one studio only
 * opens a `draft` grant of its new program for that studio. The grant write
 * below is a draft's one way out (`draft` → `granted`), with no readiness or
 * "can be granted" check, because HQ already approved the program for that
 * studio; it still refuses a frozen licence. A terms change, pause, resume and
 * end are refused on a draft. A program D955 added, with no draft, cannot be
 * granted here: it has no defaults to grant from.
 *
 * THE BRANCH'S COPY (D984). Each grant write pushes the licence to its branch,
 * which carries the grants (`branch_licence.program_grants_json`, migration
 * 554), and answers `pushed` as a terms save does; a push that does not land
 * is retried (D272). A defaults change pushes nothing: it reaches each branch
 * with that licence's next push.
 *
 * A D1 failure is a 5xx through `mapError`, never an empty list.
 */
import { readProgramUsage } from '../services/programUsage';
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { pushLicenceToBranch, queuePushStatement } from '../services/licencePush';
import { clearGuard, decisionGuard, runDecision } from '../services/decisionBatch';
import { offerRefusal } from '../services/programGrantStates';
import { createAndSendEnvelope } from './esign';
import { sha256Hex } from '../services/pdf';
import { PROGRAM_SCHEDULE_DOC_TYPE, scheduleDocument, voidSupersededSchedules } from '../services/programSchedule';
import { agreementsOfLicence, scheduleAgreementSentStatements, scheduleAgreementsSupersededStatements } from '../services/programAgreements';
import {
  alreadyHolds, freezeHoldingStatements, holdingsOf, isMissingPolicyStore, latestPolicy, legalWaitingByProgram, programLegalStatus,
  replacementOnTermsChangeStatement, requirementFor, syncLegalGate, type Holding, type Policy,
} from '../services/agreementPolicies';
import {
  DEFAULT_KEYS, TERM_KEYS, presentGrant, programNamed, programOf, readDefaults, readGrid, readHistory, readinessRefusal,
  termsDiff, termsHashOf, termsOf, validateTerms, type LicenceLite, type Terms,
} from '../services/programGrants';
import { exportCsv, readAllHistory } from '../services/programGrantsHistory';
import { csvResponse, stamp } from '../services/csv';
import { decisionStatement, planProgramPricing, validatePricingBody, type ProgramPricingPlan } from '../services/programPricing';

/**
 * D5020 (#5020) — a program pricing decision reaches the admin audit log too, not only the licence history, so
 * HQ's governance feed lists who priced which program, from which recommendation, and why. Written after the
 * grant's batch committed, so a lost write records nothing.
 */
async function auditProgramPricing(env: Env, admin: { id: number; email?: string | null }, a: {
  licenceUid: string; programKey: string; grantUid: string; decisionUid: string; plan: ProgramPricingPlan; reason: string; write: 'grant' | 'terms_changed';
}) {
  const p = a.plan;
  await logAdminAction(env, admin.id, admin.email || '', 'program_pricing_decided', {
    licence_uid: a.licenceUid, program_key: a.programKey, grant_uid: a.grantUid, decision_uid: a.decisionUid, write: a.write,
    decision: p.decision, accepted_annual_fee_cents: p.fee_cents, accepted_initial_fee_cents: p.initial_fee_cents, currency: p.currency,
    recommended_annual_fee_cents: p.recommendation.recommended_annual_fee_cents, licence_snapshot_uid: p.licence_snapshot_uid,
    model_version: p.model_version, override_reason: p.override_reason, effective_from: p.effective_from, reason: a.reason,
  });
}

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

/**
 * D5052 (#5052): the program's latest agreement policy and the licence's current holdings, or nulls on a
 * database without the policy store (an older D1), where nothing is frozen and nothing gates — as before.
 */
async function policyContext(env: Env, licenceUid: string, programKey: string): Promise<{ ready: boolean; latest: Policy | null; holdings: Holding[] }> {
  try {
    const [latest, holdings] = await Promise.all([latestPolicy(env, 'program', programKey), holdingsOf(env, licenceUid)]);
    return { ready: true, latest, holdings };
  } catch (e) {
    if (isMissingPolicyStore(e)) return { ready: false, latest: null, holdings: [] };
    throw e;
  }
}

/**
 * D4805 (#4805): the history line of a grant write, as a statement of that write's own batch, so the state
 * and its history commit together or not at all.
 */
function programEvent(env: Env, licenceId: number, actorId: number, detail: Record<string, unknown>, reason: string) {
  return env.DB.prepare(
    `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
     VALUES (?, 'program_changed', ?, ?, ?, ?)`,
  ).bind(licenceId, JSON.stringify(detail), reason, actorId, nowIso());
}

/** The schedules of earlier revisions stop being current; their rows, and any signature on them, stay. */
const supersedeSchedules = (env: Env, grantId: number) => env.DB.prepare(
  'UPDATE program_grant_schedules SET superseded_at = ? WHERE grant_id = ? AND superseded_at IS NULL',
).bind(nowIso(), grantId);

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
  const program = await programNamed(c.env, programKey);
  if (!program) return { refused: refuse(c, 404, 'unknown_program', 'There is no such program.') };
  const licence = await licenceByUid(c.env, c.req.param('uid'));
  if (!licence) return { refused: refuse(c, 404, 'not_found', 'There is no such licence.') };
  return { admin, b, reason: reason.reason, programKey, program, licence };
}

// THE STATEMENTS ARE WRITTEN OUT, never assembled from a column list: no SQL
// text here is built at run time (scripts/check-sql-prepare.mjs). Their term
// columns are TERM_KEYS in order; `program_grants_d982.test.ts` holds them equal.
export const SQL_TERM_COLUMNS = 'starts_on, ends_on, ends_with_licence, capacity_cap, capacity_uncapped, cohorts_per_year, credits_per_quarter, fee_cents, currency, hq_share_bps, hq_approves_each_cohort, hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule';
const INSERT_GRANT = `INSERT INTO program_grants
  (uid, licence_id, program_key, state, starts_on, ends_on, ends_with_licence, capacity_cap, capacity_uncapped, cohorts_per_year, credits_per_quarter, fee_cents, currency, hq_share_bps, hq_approves_each_cohort, hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule, note, set_by_user_id, set_at)
  VALUES (?, ?, ?, 'granted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const REGRANT = `UPDATE program_grants SET state = 'granted', starts_on = ?, ends_on = ?, ends_with_licence = ?, capacity_cap = ?, capacity_uncapped = ?, cohorts_per_year = ?, credits_per_quarter = ?, fee_cents = ?, currency = ?, hq_share_bps = ?, hq_approves_each_cohort = ?, hq_approval_above_cents = ?, playbook = ?, brand = ?, reporting = ?, requires_signed_schedule = ?,
  note = ?, set_by_user_id = ?, set_at = ?, paused_at = NULL, ended_at = NULL, schedule_contract_uid = NULL, schedule_signed_at = NULL,
  terms_revision = terms_revision + 1
  WHERE id = ? AND state = 'ended' AND terms_revision = ?`;
// D956: a draft is granted in place, keeping its proposal.
const GRANT_DRAFT = `UPDATE program_grants SET state = 'granted', starts_on = ?, ends_on = ?, ends_with_licence = ?, capacity_cap = ?, capacity_uncapped = ?, cohorts_per_year = ?, credits_per_quarter = ?, fee_cents = ?, currency = ?, hq_share_bps = ?, hq_approves_each_cohort = ?, hq_approval_above_cents = ?, playbook = ?, brand = ?, reporting = ?, requires_signed_schedule = ?,
  note = ?, set_by_user_id = ?, set_at = ?, terms_revision = terms_revision + 1
  WHERE id = ? AND state = 'draft' AND terms_revision = ?`;
const CHANGE_TERMS = `UPDATE program_grants SET starts_on = ?, ends_on = ?, ends_with_licence = ?, capacity_cap = ?, capacity_uncapped = ?, cohorts_per_year = ?, credits_per_quarter = ?, fee_cents = ?, currency = ?, hq_share_bps = ?, hq_approves_each_cohort = ?, hq_approval_above_cents = ?, playbook = ?, brand = ?, reporting = ?, requires_signed_schedule = ?, note = ?, set_by_user_id = ?, set_at = ?,
  schedule_contract_uid = NULL, schedule_signed_at = NULL, terms_revision = terms_revision + 1
  WHERE id = ? AND state IN ('granted', 'paused') AND terms_revision = ?`;
const UPDATE_DEFAULTS = `UPDATE program_grant_defaults SET grantable = ?, ends_with_licence = ?, capacity_cap = ?, capacity_uncapped = ?, cohorts_per_year = ?, credits_per_quarter = ?, fee_cents = ?, currency = ?, hq_share_bps = ?, hq_approves_each_cohort = ?, hq_approval_above_cents = ?, playbook = ?, brand = ?, reporting = ?, requires_signed_schedule = ?, updated_by_user_id = ?, updated_at = ?
  WHERE program_key = ?`;
const PAUSE = "UPDATE program_grants SET state = 'paused', paused_at = ?, set_by_user_id = ?, set_at = ? WHERE id = ? AND state = 'granted'";
const RESUME = "UPDATE program_grants SET state = 'granted', paused_at = NULL, set_by_user_id = ?, set_at = ? WHERE id = ? AND state = 'paused'";
const END = "UPDATE program_grants SET state = 'ended', ended_at = ?, set_by_user_id = ?, set_at = ? WHERE id = ? AND state IN ('granted', 'paused')";
const termValues = (t: Terms) => TERM_KEYS.map((k) => t[k] ?? null);
// D1120, D4805: an envelope is named only on a grant with no signed schedule AND only while its terms are
// still the revision the schedule was rendered from, so a send racing a signature or a terms change never
// names an envelope for terms the grant no longer has.
const RECORD_SCHEDULE = 'UPDATE program_grants SET schedule_contract_uid = ? WHERE id = ? AND schedule_signed_at IS NULL AND terms_revision = ?';
const INSERT_SCHEDULE = `INSERT INTO program_grant_schedules (grant_id, revision, terms_hash, envelope_uuid, sent_at) VALUES (?, ?, ?, ?, ?)`;

// ─────────────────────────────────────────────── reads

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    // D5052: each licence's legal gate, so a program whose required agreement is unsigned is not counted in force.
    const licenceRows = ((await c.env.DB.prepare(
      `SELECT DISTINCT l.id, l.uid, l.licence_ref, l.brand_name, l.kind, l.status, l.renews_on
         FROM territory_licences l JOIN program_grants g ON g.licence_id = l.id`,
    ).all<LicenceLite & { id: number }>()).results || []);
    const waiting = new Map<number, Map<string, number>>();
    for (const l of licenceRows) waiting.set(l.id, await legalWaitingByProgram(c.env, l, today()));
    const [grid, defaults] = [await readGrid(c.env, today(), waiting), await readDefaults(c.env)];
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
    // D5052: the frozen agreement policy's gate, so an unsigned required agreement never reads as in force here.
    const waiting = await legalWaitingByProgram(c.env, licence as LicenceLite & { id: number }, t);
    return c.json({
      licence: { uid: licence.uid, licence_ref: licence.licence_ref, brand_name: licence.brand_name, kind: licence.kind, status: licence.status, renews_on: licence.renews_on },
      grants: rows.map((g) => presentGrant({ ...g, legal_waiting: waiting.get(String(g.program_key)) ?? null }, licence, t)),
      history: await readHistory(c.env, licence.id),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/licences/:uid/in-use', async (c) => {
  await requireSuperAdmin(c);
  try {
    const licence = await licenceByUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    return c.json(await readProgramUsage(c.env, licence.id, licence.uid));
  } catch { return c.json({ error: 'program_usage_unreadable', message: 'Program figures are unreadable. Try again.' }, 503); }
});

r.get('/licences/:uid/history', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceByUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    return c.json({ licence_uid: licence.uid, history: await readHistory(c.env, licence.id, c.req.query('program') || null) });
  } catch (e) { return mapError(c, e); }
});

// D1126 (#3006): HQ's History tab and the two CSV exports.
r.get('/history', async (c) => {
  try {
    await requireSuperAdmin(c);
    const before = Number(c.req.query('before'));
    const program = c.req.query('program') || null;
    if (program && !programOf(program)) return refuse(c, 400, 'bad_program', 'There is no such program.');
    return c.json(await readAllHistory(c.env, {
      program,
      licence: c.req.query('licence') || null,
      before: Number.isSafeInteger(before) && before > 0 ? before : null,
      limit: Number(c.req.query('limit')) || null,
    }));
  } catch (e) { return mapError(c, e); }
});

r.get('/export.csv', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const out = await exportCsv(c.env, today());
    await logAdminAction(c.env, admin.id, admin.email, 'program_grants.exported', { rows: out.rows });
    return csvResponse(out.body, `program-grants-${stamp()}.csv`, { 'Cache-Control': 'private, no-store', 'X-Export-Rows': String(out.rows) });
  } catch (e) { return mapError(c, e); }
});

r.get('/licences/:uid/export.csv', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await licenceByUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    const out = await exportCsv(c.env, today(), licence.id);
    await logAdminAction(c.env, admin.id, admin.email, 'program_grants.exported', { licence_uid: licence.uid, rows: out.rows });
    return csvResponse(out.body, `program-grants-${licence.licence_ref || licence.uid}-${stamp()}.csv`, { 'Cache-Control': 'private, no-store', 'X-Export-Rows': String(out.rows) });
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
    // D956: switching it on is Offer to studios' one rule, whichever page flips it.
    const current = (await readDefaults(c.env)).find((d) => d.program_key === key)!;
    if (b?.grantable === true && !current.grantable) {
      const refused = await offerRefusal(c.env, key);
      if (refused) return refuse(c, 409, refused.code, refused.message);
    }
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
    const { admin, b, reason, programKey, program, licence } = t;
    const existing = await grantRow(c.env, licence.id, programKey);
    const fromDraft = existing?.state === 'draft';
    let defaultTerms: Terms = {};
    if (!program.nine) {
      // A program D955 added: granted from its draft, or again after an end.
      if (!existing) {
        return refuse(c, 422, 'not_grantable', `${program.name} was added for one studio only. It is granted from the draft its approval opened, and this licence holds none.`);
      }
    } else if (!fromDraft) {
      const notReady = readinessRefusal(programKey);
      if (notReady) return refuse(c, 422, 'not_grantable', notReady);
    }
    if (program.nine) {
      const defaults = (await readDefaults(c.env)).find((d) => d.program_key === programKey)!;
      if (!fromDraft && !defaults.grantable) return refuse(c, 422, 'not_grantable', `${defaults.name} is switched off in HQ's default terms, so it cannot be granted.`);
      defaultTerms = defaults.terms as Terms;
    }
    const blocked = frozen(licence);
    if (blocked) return refuse(c, 409, 'licence_frozen', blocked);
    const v = validateTerms(programKey, b?.terms);
    if (!v.ok) return refuse(c, 400, 'invalid_terms', `${v.errors[0].field} ${v.errors[0].message}.`, { errors: v.errors });
    const note = noteOf(b);
    if (!note.ok) return refuse(c, 400, 'invalid_note', 'The note to the studio is at most 2000 characters.');
    if (existing && existing.state !== 'ended' && !fromDraft) {
      return refuse(c, 409, 'already_granted', `${program.name} is already ${existing.state} for this licence. Change its terms, resume or end it instead.`);
    }
    // The defaults fill every term the grant leaves out; what HQ names wins.
    const terms: Terms = { ...Object.fromEntries(Object.entries(defaultTerms).map(([k, val]) => [k, val ?? null])), ...v.terms };
    if (terms.capacity_cap != null && terms.capacity_uncapped === 1) {
      return refuse(c, 400, 'invalid_terms', 'capacity_uncapped cannot be set with a capacity cap.');
    }
    // D5018: the price. With `pricing`, the fee is the country-adjusted recommendation, accepted or overridden with
    // a reason; without it, a fee the grant sets is HQ's own and is recorded as an override. Either way one
    // program_pricing_decisions row commits with the grant, so the accepted price and where it came from stay together.
    const pv = validatePricingBody(b?.pricing);
    if (!pv.ok) return refuse(c, 400, 'invalid_pricing', 'The pricing has fields to fix.', { errors: pv.errors });
    if (pv.value && v.terms.fee_cents !== undefined) return refuse(c, 400, 'fee_from_pricing', 'Name the fee in pricing or in the terms, not both.');
    const priced = await planProgramPricing(c.env, {
      licenceUid: licence.uid, programKey, pricing: pv.value, termsFee: (terms.fee_cents ?? null) as number | null,
      termsCurrency: (terms.currency ?? null) as string | null, writeReason: reason,
      startsOn: (terms.starts_on ?? null) as string | null, endsOn: (terms.ends_on ?? null) as string | null, today: today(),
    });
    if (!priced.ok) return refuse(c, 400, priced.code, priced.sentence);
    if (priced.plan) { terms.fee_cents = priced.plan.fee_cents; terms.currency = priced.plan.currency; }
    const at = nowIso();
    const pricingUid = crypto.randomUUID();
    const grantUid = existing ? String(existing.uid) : newUid();
    const pricingRow = priced.plan
      ? [decisionStatement(c.env, { uid: pricingUid, licenceUid: licence.uid, programKey, grantUid, plan: priced.plan, reason, grantTermsRevision: existing ? Number(existing.terms_revision ?? 1) + 1 : 1, actor: `user:${admin.id}`, now: at })]
      : [];
    // D5052: the policy this grant will hold is the program's LATEST version, frozen in the grant's own batch
    // (a package the licence already holds keeps the version it froze). Under `required_before_grant` the grant
    // is refused until every required agreement is executed; the schedule is not one of them (it is built from
    // the grant's terms, so it cannot come first).
    const policy = await policyContext(c.env, licence.uid, programKey);
    const freeze = !!policy.latest && !alreadyHolds(policy.holdings, 'program', programKey, policy.latest, null);
    const prospective: Holding[] = policy.latest
      ? [...policy.holdings.filter((h) => !(h.scope_kind === 'program' && h.scope_key === programKey)),
        { uid: 'prospective', licence_uid: licence.uid, scope_kind: 'program', scope_key: programKey, policy_uid: policy.latest.uid,
          policy_version: policy.latest.version, origin: 'program_granted', package_offer_uid: null, frozen_at: at, frozen_by_user_id: admin.id,
          superseded_at: null, superseded_by_uid: null, policy: policy.latest }]
      : policy.holdings;
    const requirement = requirementFor(programKey, prospective);
    if (requirement.legal_gate === 'required_before_grant') {
      const rows = await agreementsOfLicence(c.env, licence.uid);
      const before = programLegalStatus({ program_key: programKey, state: 'granted', requires_signed_schedule: 0 }, rows, requirement, { grantInForce: true });
      if (before.missing.length) {
        return refuse(c, 409, 'agreement_required_before_grant',
          `${program.name} is granted only once its agreement is executed: ${before.requirement.documents.filter((d) => !d.satisfied).map((d) => d.label).join(', ')}.`,
          { missing: before.missing, policy_uid: requirement.policy_uid, policy_version: requirement.policy_version });
      }
    }
    const freezeStatements = freeze ? freezeHoldingStatements(c.env, {
      uid: newUid(), licenceUid: licence.uid, scopeKind: 'program', scopeKey: programKey, origin: 'program_granted',
      packageOfferUid: null, actorId: admin.id, at, reason,
    }) : [];
    const changed = termsDiff({}, Object.fromEntries(Object.entries(terms).filter(([, val]) => val != null)));
    if (fromDraft) changed.unshift({ key: 'state', before: 'draft', after: 'granted' });
    const action = fromDraft ? 'granted' : existing ? 'regranted' : 'granted';
    const history = programEvent(c.env, licence.id, admin.id, {
      action, program_key: programKey, changed, reason, ...(fromDraft ? { from_draft: true, proposal_uid: existing!.proposal_uid ?? null } : {}),
    }, reason);
    if (existing) {
      // A re-grant after an end: the same row starts again, with fresh terms and schedule.
      // A draft (D956) is granted in place, with its proposal. D4805: the grant, its history, the schedules it
      // replaces and the branch push it owes are one batch, and the grant names the revision it read.
      const run = await runDecision(c.env, [
        c.env.DB.prepare(fromDraft ? GRANT_DRAFT : REGRANT).bind(...termValues(terms), note.note ?? null, admin.id, at, existing.id, existing.terms_revision ?? 1),
        decisionGuard(c.env),
        history,
        ...pricingRow,
        ...voidSupersededSchedules(c.env, existing.id),
        supersedeSchedules(c.env, existing.id),
        // D5048: the grant's canonical schedule agreements stop being current with it.
        ...scheduleAgreementsSupersededStatements(c.env, existing.id, at, admin.id),
        ...freezeStatements,
        queuePushStatement(c.env, licence.id),
        clearGuard(c.env),
      ]);
      if (run.lost) return refuse(c, 409, 'already_granted', `${program.name} changed while you were granting it. Read it again.`);
    } else {
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(INSERT_GRANT).bind(grantUid, licence.id, programKey, ...termValues(terms), note.note ?? null, admin.id, at),
          history,
          ...pricingRow,
          ...freezeStatements,
          queuePushStatement(c.env, licence.id),
        ]);
      } catch (e) {
        // A grant for this licence and program landed first; the batch rolled back whole.
        if (/UNIQUE/i.test(e instanceof Error ? e.message : '')) return refuse(c, 409, 'already_granted', `${program.name} changed while you were granting it. Read it again.`);
        throw e;
      }
    }
    const saved = await grantRow(c.env, licence.id, programKey);
    if (priced.plan) await auditProgramPricing(c.env, admin, { licenceUid: licence.uid, programKey, grantUid, decisionUid: pricingUid, plan: priced.plan, reason, write: 'grant' });
    if (policy.ready) await syncLegalGate(c.env, licence.uid, { actorId: admin.id, reason });
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    return c.json({ ok: true, grant: presentGrant(saved!, licence, today()), pricing_decision: priced.plan ? { uid: pricingUid, decision: priced.plan.decision } : null, pushed }, existing ? 200 : 201);
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
    if (existing?.state === 'draft') return refuse(c, 409, 'not_granted', 'This grant is a draft. Grant it first: its terms are set when HQ grants it.');
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
    // D5018: a change of price is a new pricing decision. A change that leaves the fee alone records none, so a
    // new market recommendation, a pause or a resume never reprices a grant.
    const pv = validatePricingBody(b?.pricing);
    if (!pv.ok) return refuse(c, 400, 'invalid_pricing', 'The pricing has fields to fix.', { errors: pv.errors });
    if (pv.value && v.terms.fee_cents !== undefined) return refuse(c, 400, 'fee_from_pricing', 'Name the fee in pricing or in the terms, not both.');
    const feeTouched = pv.value !== null || v.terms.fee_cents !== undefined || v.terms.currency !== undefined;
    const priced = feeTouched
      ? await planProgramPricing(c.env, {
        licenceUid: licence.uid, programKey, pricing: pv.value, termsFee: (after.fee_cents ?? null) as number | null,
        termsCurrency: (after.currency ?? null) as string | null, writeReason: reason,
        startsOn: (after.starts_on ?? null) as string | null, endsOn: (after.ends_on ?? null) as string | null, today: today(),
      })
      : { ok: true as const, plan: null };
    if (!priced.ok) return refuse(c, 400, priced.code, priced.sentence);
    if (priced.plan) { after.fee_cents = priced.plan.fee_cents; after.currency = priced.plan.currency; }
    const pricingUid = crypto.randomUUID();
    const changed = termsDiff(before, after);
    const noteChanged = note.note !== undefined && (note.note ?? null) !== (existing.note ?? null);
    if (!changed.length && !noteChanged) return refuse(c, 400, 'no_change', 'Nothing changes: these are the terms the grant already has.');
    // D5052: an executed agreement drafted against these terms no longer matches them. It is recorded as
    // needing a replacement (once per revision) and left exactly as signed.
    const policyReady = (await policyContext(c.env, licence.uid, programKey)).ready;
    // D4805: a change of terms is a new revision. The grant names the revision it read, so a stale change
    // loses; the schedule signed under the old revision no longer vouches for these terms (the grant waits
    // on an amendment) but its record stays; and the history and the owed branch push commit with it.
    const run = await runDecision(c.env, [
      c.env.DB.prepare(CHANGE_TERMS)
        .bind(...termValues(after), note.note === undefined ? (existing.note ?? null) : note.note, admin.id, nowIso(), existing.id, existing.terms_revision ?? 1),
      decisionGuard(c.env),
      programEvent(c.env, licence.id, admin.id, { action: 'terms_changed', program_key: programKey, changed, note_changed: noteChanged, reason }, reason),
      ...(priced.plan ? [decisionStatement(c.env, {
        uid: pricingUid, licenceUid: licence.uid, programKey, grantUid: String(existing.uid), plan: priced.plan, reason,
        grantTermsRevision: Number(existing.terms_revision ?? 1) + 1, actor: `user:${admin.id}`, now: nowIso(),
      })] : []),
      ...(policyReady ? [replacementOnTermsChangeStatement(c.env, {
        licenceUid: licence.uid, programKey, newRevision: Number(existing.terms_revision ?? 1) + 1, actorId: admin.id, at: nowIso(), reason,
      })] : []),
      ...voidSupersededSchedules(c.env, existing.id),
      supersedeSchedules(c.env, existing.id),
      // D5048: the grant's canonical schedule agreements stop being current with it.
      ...scheduleAgreementsSupersededStatements(c.env, existing.id, nowIso(), admin.id),
      queuePushStatement(c.env, licence.id),
      clearGuard(c.env),
    ]);
    if (run.lost) return refuse(c, 409, 'not_granted', 'This grant changed while you were changing it. Read it again.');
    const saved = await grantRow(c.env, licence.id, programKey);
    if (priced.plan) await auditProgramPricing(c.env, admin, { licenceUid: licence.uid, programKey, grantUid: String(existing.uid), decisionUid: pricingUid, plan: priced.plan, reason, write: 'terms_changed' });
    if (policyReady) await syncLegalGate(c.env, licence.uid, { actorId: admin.id, reason });
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    return c.json({ ok: true, grant: presentGrant(saved!, licence, today()), changed, pricing_decision: priced.plan ? { uid: pricingUid, decision: priced.plan.decision } : null, pushed });
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
      // D4805: the state, its history and the branch push it owes commit together, or not at all.
      const run = await runDecision(c.env, [
        action === 'resumed' ? c.env.DB.prepare(RESUME).bind(admin.id, at, existing.id) : c.env.DB.prepare(action === 'paused' ? PAUSE : END).bind(at, admin.id, at, existing.id),
        decisionGuard(c.env),
        programEvent(c.env, licence.id, admin.id, { action, program_key: programKey, changed: [{ key: 'state', before: existing.state, after: to }], reason }, reason),
        queuePushStatement(c.env, licence.id),
        clearGuard(c.env),
      ]);
      if (run.lost) return refuse(c, 409, 'wrong_state', 'This grant changed while you were changing it. Read it again.');
      const saved = await grantRow(c.env, licence.id, programKey);
      // D5052: a pause, resume or end changes whether the program's gate is in play; record its answer.
      await syncLegalGate(c.env, licence.uid, { actorId: admin.id, reason });
      const pushed = await pushLicenceToBranch(c.env, licence.id);
      return c.json({ ok: true, grant: presentGrant(saved!, licence, today()), pushed });
    } catch (e) { return mapError(c, e); }
  };
}

r.post('/licences/:uid/:program/pause', transition('paused', ['granted'], 'paused'));
r.post('/licences/:uid/:program/resume', transition('resumed', ['paused'], 'granted'));
r.post('/licences/:uid/:program/end', transition('ended', ['granted', 'paused'], 'ended'));

// ─────────────────────────────────────────────── the schedule (D1120)

/** The envelope states after which a schedule can be sent again: it was never signed and never will be. */
const SCHEDULE_DEAD = new Set(['void', 'rejected']);

r.post('/licences/:uid/:program/schedule/send', async (c) => {
  try {
    const t = await target(c);
    if ('refused' in t) return t.refused;
    const { admin, reason, programKey, licence } = t;
    const blocked = frozen(licence);
    if (blocked) return refuse(c, 409, 'licence_frozen', blocked);
    const existing = await grantRow(c.env, licence.id, programKey);
    if (!existing || existing.state === 'ended') {
      return refuse(c, 409, 'wrong_state', `This program is ${existing ? 'ended' : 'not granted'} for this licence, so it has no schedule to send.`, { state: existing?.state ?? null });
    }
    // D956: a draft is HQ's and not granted yet; its schedule is sent once HQ grants it.
    if (existing.state === 'draft') {
      return refuse(c, 409, 'wrong_state', 'This grant is a draft. Grant it first: its schedule is sent once HQ grants it.', { state: 'draft' });
    }
    if (existing.requires_signed_schedule != null && Number(existing.requires_signed_schedule) === 0) {
      return refuse(c, 409, 'schedule_not_required', 'This grant does not wait on a signed schedule, so there is nothing to send. Change its terms first if it should.');
    }
    if (existing.schedule_signed_at) {
      return refuse(c, 409, 'already_signed', 'This grant’s schedule is already signed.', { signed_at: existing.schedule_signed_at });
    }
    if (existing.schedule_contract_uid) {
      const env = await c.env.DB.prepare('SELECT status FROM esign_envelopes WHERE envelope_uuid = ?')
        .bind(existing.schedule_contract_uid).first<{ status: string }>();
      if (!env || !SCHEDULE_DEAD.has(String(env.status))) {
        return refuse(c, 409, 'already_sent', 'This grant’s schedule is already out for signature. It can be sent again only once that envelope is voided or declined.', {
          contract_uid: existing.schedule_contract_uid, envelope_status: env?.status ?? null,
        });
      }
    }
    const signer = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name
         FROM licence_admins la
         JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ? AND u.is_active = 1
        ORDER BY CASE la.admin_role WHEN 'principal' THEN 0 ELSE 1 END, la.id
        LIMIT 1`,
    ).bind(licence.id).first<{ id: number; email: string; name: string | null }>();
    if (!signer?.email) {
      return refuse(c, 409, 'no_signer', 'No active licence administrator has an account to receive the schedule. Grant an admin on this licence first.');
    }
    const named = await c.env.DB.prepare('SELECT legal_entity_name, signatory_name FROM territory_licences WHERE id = ?')
      .bind(licence.id).first<{ legal_entity_name: string | null; signatory_name: string | null }>();
    // D4805: the schedule is rendered from, and bound to, the revision and fingerprint of the terms as read now.
    const revision = Number(existing.terms_revision ?? 1);
    const hash = await termsHashOf(existing);
    const doc = scheduleDocument({ ...licence, legal_entity_name: named?.legal_entity_name ?? null }, existing, today(), { number: revision, hash });
    // A rendered body skips the template library, so no template refusal can
    // come back; a malformed body is this code's fault and answers 5xx.
    const sent = await createAndSendEnvelope(c.env, {
      adminUserId: admin.id,
      adminName: admin.name || admin.email,
      recipientUserId: signer.id,
      recipientEmail: signer.email,
      recipientName: signer.name || named?.signatory_name || signer.email,
      documentType: PROGRAM_SCHEDULE_DOC_TYPE,
      dealId: existing.id,
      appUrl: c.env.APP_URL || 'https://axal.vc',
      viaProvider: 'native',
      renderedBody: doc,
      templateVersion: null,
    });
    if (!sent) return c.json({ error: 'envelope_send_failed', message: 'The schedule could not be created or sent. Nothing was recorded.' }, 502);
    // The envelope is named on the grant, recorded against the revision it carries, and its history and owed
    // push commit with it. If the terms moved or the schedule was signed meanwhile this writes nothing, and the
    // envelope that was sent has no record, so it can sign nothing.
    // D5048: the canonical agreement version is written in the same batch, with the hash the envelope carries.
    const sentAt = nowIso();
    const envelopeSha = (await c.env.DB.prepare('SELECT body_sha256 FROM esign_envelopes WHERE envelope_uuid = ?')
      .bind(sent.envelope_uuid).first<{ body_sha256: string | null }>())?.body_sha256 ?? null;
    const recorded = await runDecision(c.env, [
      c.env.DB.prepare(RECORD_SCHEDULE).bind(sent.envelope_uuid, existing.id, revision),
      decisionGuard(c.env),
      c.env.DB.prepare(INSERT_SCHEDULE).bind(existing.id, revision, hash, sent.envelope_uuid, sentAt),
      ...scheduleAgreementSentStatements(c.env, {
        uid: newUid(), licenceUid: licence.uid, grantId: existing.id, programKey, envelopeUuid: sent.envelope_uuid,
        bodySha256: envelopeSha && envelopeSha.length === 64 ? envelopeSha : await sha256Hex(doc.body), actorId: admin.id, at: sentAt,
      }),
      programEvent(c.env, licence.id, admin.id, {
        action: 'schedule_sent', program_key: programKey, revision,
        changed: [{ key: 'schedule_contract_uid', before: existing.schedule_contract_uid ?? null, after: sent.envelope_uuid }], reason,
      }, reason),
      queuePushStatement(c.env, licence.id),
      clearGuard(c.env),
    ]);
    if (recorded.lost) return refuse(c, 409, 'terms_changed', 'This grant’s terms changed, or its schedule was signed, while you were sending it. The schedule that went out is for the earlier terms and signs nothing. Read the grant again, then send it again.');
    await logAdminAction(c.env, admin.id, admin.email, 'program_grant_schedule_sent', {
      licence_uid: licence.uid, program_key: programKey, envelope_uuid: sent.envelope_uuid, reason,
    });
    const saved = await grantRow(c.env, licence.id, programKey);
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    return c.json({
      ok: true,
      grant: presentGrant(saved!, licence, today()),
      envelope: { uuid: sent.envelope_uuid, email_sent: sent.email_sent, already_pending: sent.already_pending ?? false },
      pushed,
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
