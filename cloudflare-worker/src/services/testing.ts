/**
 * D812 (#2258) — product testing: programmes run by HQ and partners, HQ's
 * review of a partner's, members' applications, and the owner's picks.
 * Migration 516. The routes are `routes/testing.ts`.
 *
 * WHO OWNS A PROGRAMME is `Owner`: HQ, or one partner firm (`partners.id`).
 * Every owner-side read and write goes through `ownProgramme`, so a partner can
 * never reach another firm's programme, and a missing one and another firm's
 * answer the same 404.
 *
 * EVERY CHANGE IS ONE BATCH: the conditional UPDATE (or INSERT) and its
 * `testing_events` row, the event inserted only `WHERE changes() = 1`. A write
 * that lost a race writes no event, and an event never describes a change that
 * did not happen. The bell is told after, best-effort (`notify`).
 *
 * PLACES ARE HELD IN SQL. A pick is `UPDATE … WHERE (picked count) < places`,
 * one statement, so two owners picking at once cannot pass the limit.
 *
 * MAIL'S TESTERS ARE D811'S `testerRecipients` (`services/mailLinkTesters.ts`):
 * picked, consenting testers who have not turned programme emails off, on a
 * programme that has opened, at an address neither suppressed nor
 * unsubscribed. `testersAudience` and `mailApplicants` here read that same
 * rule, and `mail_link_testing_d812.test.ts` holds the three to the same
 * people. Nothing here emails anyone.
 */
import type { Env } from '../types';
import { notify } from './notify';
import { newUid, nowIso } from '../routes/_t13t14t15_helpers';

export type Owner = { kind: 'hq' } | { kind: 'partner'; partnerId: number };

export const ROLES = ['founder', 'partner', 'investor', 'exploring', 'advisor'] as const;
export const MAX_QUESTIONS = 5;
export const PROGRAMME_STATUSES = ['draft', 'submitted', 'approved', 'open', 'testing', 'closed', 'rejected'] as const;

/** The sentence a member agrees to, and its version, recorded on the application. */
export const CONSENT_VERSION = 'd812-1';
export const CONSENT_TEXT = 'Axal may email me about this testing programme, including whether I was picked.';

/** A refusal: the route answers `status` with `{ error: code, detail: message }`. */
export class TestingRefusal extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const refuse = (status: number, code: string, message: string) => new TestingRefusal(status, code, message);
const NOT_FOUND = () => refuse(404, 'not_found', 'Programme not found.');

const parse = <T>(s: unknown, def: T): T => {
  if (typeof s !== 'string' || !s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const TEXT_FIELDS: Record<string, number> = {
  product_name: 200, logo_key: 500, summary: 4000, tester_tasks: 4000, time_needed: 200,
};
const DATE_FIELDS = ['opens_at', 'closes_at', 'testing_starts', 'testing_ends'] as const;

/**
 * The programme's columns from a create (`partial = false`) or an edit body.
 * Unknown keys are ignored; a key present with a bad value is refused.
 */
export function programmeInput(body: any, partial: boolean): Record<string, unknown> {
  const b = body && typeof body === 'object' ? body : {};
  const out: Record<string, unknown> = {};
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    if (!(k in b)) continue;
    const v = b[k] == null ? '' : String(b[k]).trim();
    if (v.length > max) throw refuse(400, 'invalid_request', `${k} is longer than ${max} characters.`);
    out[k] = v || null;
  }
  if (!partial || 'product_name' in b) {
    if (!out.product_name) throw refuse(400, 'invalid_request', 'Name the product being tested.');
  }
  for (const k of DATE_FIELDS) {
    if (!(k in b)) continue;
    if (b[k] == null || b[k] === '') { out[k] = null; continue; }
    const t = Date.parse(String(b[k]));
    if (!Number.isFinite(t)) throw refuse(400, 'invalid_request', `${k} is not a date.`);
    out[k] = new Date(t).toISOString();
  }
  if (!partial || 'places' in b) {
    const p = b.places;
    if (!(typeof p === 'number' && Number.isSafeInteger(p) && p > 0 && p <= 10000)) {
      throw refuse(400, 'invalid_request', 'Places is a whole number from 1 to 10000.');
    }
    out.places = p;
  }
  if (!partial || 'eligible_roles' in b) {
    const r = b.eligible_roles;
    if (!Array.isArray(r) || r.length === 0 || !r.every((x) => (ROLES as readonly string[]).includes(x))) {
      throw refuse(400, 'invalid_request', `Eligible roles is a list of one or more of: ${ROLES.join(', ')}.`);
    }
    out.eligible_roles = JSON.stringify([...new Set(r)]);
  }
  if (!partial || 'questions' in b) {
    const q = b.questions ?? [];
    if (!Array.isArray(q) || q.length > MAX_QUESTIONS
      || !q.every((x) => typeof x === 'string' && x.trim() && x.trim().length <= 300)) {
      throw refuse(400, 'invalid_request', `Questions is a list of up to ${MAX_QUESTIONS}, each up to 300 characters.`);
    }
    out.questions = JSON.stringify(q.map((x: string) => x.trim()));
  }
  return out;
}

/** Every column a create or an edit writes, in the order the statements bind them. */
const COLUMNS = ['product_name', 'logo_key', 'summary', 'tester_tasks', 'time_needed', 'opens_at', 'closes_at',
  'testing_starts', 'testing_ends', 'places', 'eligible_roles', 'questions'] as const;

/** The programme's values after `input`, over `current` (a stored row, or nothing for a create). */
function merged(current: any, input: Record<string, unknown>): unknown[] {
  const m: Record<string, unknown> = {};
  for (const k of COLUMNS) m[k] = k in input ? input[k] : (current?.[k] ?? null);
  for (const [a, z] of [['opens_at', 'closes_at'], ['testing_starts', 'testing_ends']]) {
    const x = m[a], y = m[z];
    if (typeof x === 'string' && typeof y === 'string' && x > y) {
      throw refuse(400, 'invalid_request', `${a} is after ${z}.`);
    }
  }
  return COLUMNS.map((k) => m[k]);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const PICKED = "(SELECT COUNT(*) FROM testing_applications a WHERE a.programme_id = p.id AND a.status = 'picked')";
const APPLIED = "(SELECT COUNT(*) FROM testing_applications a WHERE a.programme_id = p.id AND a.status <> 'withdrawn')";
const OWNER_NAME = "CASE WHEN p.owner_kind = 'hq' THEN 'Axal VC' ELSE COALESCE(pt.company, pt.name) END";
const PROGRAMME_COLS = `p.*, ${PICKED} AS picked_count, ${APPLIED} AS applicant_count, ${OWNER_NAME} AS owner_name`;
const PROGRAMME_FROM = 'FROM testing_programmes p LEFT JOIN partners pt ON pt.id = p.owner_partner_id';
const SELECT_PROGRAMME = `SELECT ${PROGRAMME_COLS} ${PROGRAMME_FROM}`;

export function programmeDto(r: any) {
  const picked = Number(r.picked_count ?? 0);
  return {
    uid: r.uid,
    owner_kind: r.owner_kind,
    owner_name: r.owner_name ?? null,
    product_name: r.product_name,
    logo_key: r.logo_key ?? null,
    summary: r.summary ?? null,
    tester_tasks: r.tester_tasks ?? null,
    time_needed: r.time_needed ?? null,
    opens_at: r.opens_at ?? null,
    closes_at: r.closes_at ?? null,
    testing_starts: r.testing_starts ?? null,
    testing_ends: r.testing_ends ?? null,
    places: Number(r.places),
    places_left: Math.max(0, Number(r.places) - picked),
    picked_count: picked,
    applicant_count: Number(r.applicant_count ?? 0),
    eligible_roles: parse<string[]>(r.eligible_roles, []),
    questions: parse<string[]>(r.questions, []),
    status: r.status,
    review_note: r.review_note ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** The owner-side scope: HQ sees HQ's programmes, a partner its firm's. */
function ownerWhere(owner: Owner): { sql: string; binds: unknown[] } {
  return owner.kind === 'hq'
    ? { sql: "p.owner_kind = 'hq'", binds: [] }
    : { sql: "p.owner_kind = 'partner' AND p.owner_partner_id = ?", binds: [owner.partnerId] };
}

export async function ownerProgrammes(env: Env, owner: Owner) {
  const w = ownerWhere(owner);
  const { results } = await env.DB.prepare(`${SELECT_PROGRAMME} WHERE ${w.sql} ORDER BY p.id DESC`).bind(...w.binds).all();
  return (results || []).map(programmeDto);
}

/** One of the owner's programmes, or 404 (a missing one and another firm's alike). */
export async function ownProgramme(env: Env, owner: Owner, uid: string): Promise<any> {
  const w = ownerWhere(owner);
  const row = await env.DB.prepare(`${SELECT_PROGRAMME} WHERE p.uid = ? AND ${w.sql}`).bind(uid, ...w.binds).first<any>();
  if (!row) throw NOT_FOUND();
  return row;
}

/** HQ's review list: every programme, optionally one status. */
export async function allProgrammes(env: Env, status: string | null) {
  if (status && !(PROGRAMME_STATUSES as readonly string[]).includes(status)) {
    throw refuse(400, 'invalid_request', `Status is one of: ${PROGRAMME_STATUSES.join(', ')}.`);
  }
  const stmt = status
    ? env.DB.prepare(`${SELECT_PROGRAMME} WHERE p.status = ? ORDER BY p.id DESC`).bind(status)
    : env.DB.prepare(`${SELECT_PROGRAMME} ORDER BY p.id DESC`);
  const { results } = await stmt.all();
  return (results || []).map(programmeDto);
}

async function programmeByUid(env: Env, uid: string): Promise<any> {
  const row = await env.DB.prepare(`${SELECT_PROGRAMME} WHERE p.uid = ?`).bind(uid).first<any>();
  if (!row) throw NOT_FOUND();
  return row;
}

/**
 * What a member may apply to: open, between `opens_at` and `closes_at`, for
 * their role, with a place left. The summary counts the same set; `apply`
 * re-checks each condition on the one programme.
 */
export async function memberProgrammes(env: Env, user: { id: number; role: string }) {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `SELECT p.*,
            (SELECT COUNT(*) FROM testing_applications a WHERE a.programme_id = p.id AND a.status = 'picked') AS picked_count,
            (SELECT COUNT(*) FROM testing_applications a WHERE a.programme_id = p.id AND a.status <> 'withdrawn') AS applicant_count,
            CASE WHEN p.owner_kind = 'hq' THEN 'Axal VC' ELSE COALESCE(pt.company, pt.name) END AS owner_name,
            (SELECT a.status FROM testing_applications a WHERE a.programme_id = p.id AND a.user_id = ?) AS my_status
       FROM testing_programmes p LEFT JOIN partners pt ON pt.id = p.owner_partner_id
      WHERE p.status = 'open' AND (p.closes_at IS NULL OR p.closes_at > ?) AND (p.opens_at IS NULL OR p.opens_at <= ?)
        AND EXISTS (SELECT 1 FROM json_each(p.eligible_roles) r WHERE r.value = ?)
        AND (SELECT COUNT(*) FROM testing_applications a WHERE a.programme_id = p.id AND a.status = 'picked') < p.places
      ORDER BY p.closes_at IS NULL, p.closes_at, p.id`,
  ).bind(user.id, now, now, String(user.role)).all();
  return (results || []).map((r: any) => ({ ...programmeDto(r), my_status: r.my_status ?? null }));
}

const SELECT_APPLICATION = `SELECT a.*, p.uid AS programme_uid, p.product_name, p.testing_starts, p.testing_ends, p.status AS programme_status
  FROM testing_applications a JOIN testing_programmes p ON p.id = a.programme_id`;

function applicationDto(r: any) {
  return {
    uid: r.uid,
    programme_uid: r.programme_uid,
    product_name: r.product_name,
    programme_status: r.programme_status,
    testing_starts: r.testing_starts ?? null,
    testing_ends: r.testing_ends ?? null,
    answers: parse<string[]>(r.answers, []),
    availability: r.availability ?? null,
    consented: !!r.consent_email_at,
    status: r.status,
    applied_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function myApplications(env: Env, userId: number) {
  const { results } = await env.DB.prepare(`${SELECT_APPLICATION} WHERE a.user_id = ? ORDER BY a.id DESC`).bind(userId).all();
  return (results || []).map(applicationDto);
}

/** The owner's view of who applied. No email: Mail writes to testers, StudioOS does not. */
export async function applicants(env: Env, owner: Owner, uid: string) {
  const p = await ownProgramme(env, owner, uid);
  const { results } = await env.DB.prepare(
    `SELECT a.uid, a.answers, a.availability, a.consent_email_at, a.status, a.created_at, a.updated_at,
            COALESCE(u.display_name, u.name) AS name, u.role
       FROM testing_applications a JOIN users u ON u.id = a.user_id
      WHERE a.programme_id = ? AND a.status <> 'withdrawn' ORDER BY a.id`,
  ).bind(p.id).all();
  return {
    programme: programmeDto(p),
    items: (results || []).map((r: any) => ({
      uid: r.uid, name: r.name, role: r.role,
      answers: parse<string[]>(r.answers, []),
      availability: r.availability ?? null,
      consented: !!r.consent_email_at,
      status: r.status, applied_at: r.created_at, updated_at: r.updated_at,
    })),
  };
}

/** The Studio card (D814): how many the caller could apply to, and where they were picked. */
export async function summary(env: Env, user: { id: number; role: string }) {
  const now = nowIso();
  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM testing_programmes p
      WHERE p.status = 'open' AND (p.closes_at IS NULL OR p.closes_at > ?) AND (p.opens_at IS NULL OR p.opens_at <= ?)
        AND EXISTS (SELECT 1 FROM json_each(p.eligible_roles) r WHERE r.value = ?)
        AND (SELECT COUNT(*) FROM testing_applications a WHERE a.programme_id = p.id AND a.status = 'picked') < p.places`,
  ).bind(now, now, String(user.role)).first<{ n: number }>();
  const { results } = await env.DB.prepare(
    `${SELECT_APPLICATION} WHERE a.user_id = ? AND a.status = 'picked' ORDER BY p.testing_starts IS NULL, p.testing_starts, a.id`,
  ).bind(user.id).all();
  return {
    open_count: Number(open?.n ?? 0),
    picked: (results || []).map((r: any) => ({
      programme_uid: r.programme_uid, product_name: r.product_name,
      testing_starts: r.testing_starts ?? null, testing_ends: r.testing_ends ?? null,
      programme_status: r.programme_status,
    })),
  };
}

/**
 * The testers Mail may write to, without paging: D811's `testerRecipients`
 * rule (#2296), which is what `testers:<uid>` sends to. Picked, consented,
 * `mail_enabled`, an active account with an address, a programme that has
 * opened, and an address neither suppressed nor unsubscribed.
 */
export async function testersAudience(env: Env, programmeUid: string) {
  const { results } = await env.DB.prepare(
    `SELECT u.id AS user_id, lower(trim(u.email)) AS email, COALESCE(u.display_name, u.name) AS name, a.consent_version
       FROM testing_applications a
       JOIN testing_programmes p ON p.id = a.programme_id
       JOIN users u ON u.id = a.user_id
      WHERE p.uid = ? AND p.status IN ('open', 'testing', 'closed')
        AND a.status = 'picked' AND a.consent_email_at IS NOT NULL AND a.mail_enabled = 1 AND u.is_active = 1
        AND u.email IS NOT NULL AND trim(u.email) <> ''
        AND NOT EXISTS (SELECT 1 FROM email_suppressions z WHERE z.email = lower(trim(u.email)))
        AND NOT EXISTS (SELECT 1 FROM newsletter_subscribers s WHERE s.email = lower(trim(u.email)) AND s.status = 'unsubscribed')
      ORDER BY a.id`,
  ).bind(programmeUid).all();
  return (results || []).map((r: any) => ({
    user_id: Number(r.user_id), email: r.email, name: r.name,
    first_name: String(r.name || '').trim().split(/\s+/)[0] || null,
    consent_version: r.consent_version,
  }));
}

// ---------------------------------------------------------------------------
// Mail's Product testing page (D812 part 2a, #2258)
//
// Two reads for AxalNetwork/mail, mounted only on D811's signed router
// (`routes/mail_link.ts`, part 2b), behind its signature check and rate limit.
// `testers:<uid>` stays the only list Mail sends to.
// ---------------------------------------------------------------------------

/** The first line of the first answer, at most 140 characters: what Mail's list shows. */
export function firstAnswerLine(answersJson: unknown): string | null {
  const first = parse<unknown[]>(answersJson, [])[0];
  const line = String(first ?? '').split(/\r?\n/)[0].trim();
  if (!line) return null;
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

/** Every programme, with its owner (Axal VC, or the partner firm), status, places, applicants and dates. */
export async function mailProgrammes(env: Env) {
  return (await allProgrammes(env, null)).map((p) => ({
    uid: p.uid, owner_kind: p.owner_kind, owner_name: p.owner_name, product_name: p.product_name,
    status: p.status, places: p.places, places_left: p.places_left, picked_count: p.picked_count,
    applicant_count: p.applicant_count,
    opens_at: p.opens_at, closes_at: p.closes_at, testing_starts: p.testing_starts, testing_ends: p.testing_ends,
  }));
}

/**
 * One programme's applicants for Mail: name, role, the first line of their
 * answers, when they applied, and their status. A withdrawn application is
 * left out, as the owner's list leaves it out.
 *
 * THE EMAIL IS IN THE SELECT ONLY FOR SOMEONE `testers:<uid>` WOULD SEND TO:
 * D811's `testerRecipients` rule, written in the query's CASE so no other
 * address leaves the database. That is a picked tester who consented and has
 * not turned programme emails off (`mail_enabled`), on an active account, on a
 * programme that has opened, at an address neither suppressed nor
 * unsubscribed. Everyone else's `email` is null. An unknown uid is null, never
 * another programme's list.
 */
export async function mailApplicants(env: Env, programmeUid: string) {
  const p = await env.DB.prepare(
    `SELECT p.id, p.uid, p.product_name, p.status, p.places,
            CASE WHEN p.owner_kind = 'hq' THEN 'Axal VC' ELSE COALESCE(pt.company, pt.name) END AS owner_name
       FROM testing_programmes p LEFT JOIN partners pt ON pt.id = p.owner_partner_id
      WHERE p.uid = ?`,
  ).bind(String(programmeUid ?? '')).first<any>();
  if (!p) return null;
  const { results } = await env.DB.prepare(
    `SELECT a.uid, a.answers, a.status, a.created_at, a.consent_email_at,
            COALESCE(u.display_name, u.name) AS name, u.role,
            CASE WHEN p.status IN ('open', 'testing', 'closed')
                  AND a.status = 'picked' AND a.consent_email_at IS NOT NULL AND a.mail_enabled = 1 AND u.is_active = 1
                  AND u.email IS NOT NULL AND trim(u.email) <> ''
                  AND NOT EXISTS (SELECT 1 FROM email_suppressions z WHERE z.email = lower(trim(u.email)))
                  AND NOT EXISTS (SELECT 1 FROM newsletter_subscribers s WHERE s.email = lower(trim(u.email)) AND s.status = 'unsubscribed')
                 THEN lower(trim(u.email)) ELSE NULL END AS email
       FROM testing_applications a JOIN users u ON u.id = a.user_id
       JOIN testing_programmes p ON p.id = a.programme_id
      WHERE a.programme_id = ? AND a.status <> 'withdrawn'
      ORDER BY a.id`,
  ).bind(p.id).all();
  return {
    programme: { uid: p.uid, product_name: p.product_name, owner_name: p.owner_name, status: p.status, places: Number(p.places) },
    items: (results || []).map((r: any) => ({
      uid: r.uid, name: r.name, role: r.role,
      first_answer: firstAnswerLine(r.answers),
      applied_on: String(r.created_at || '').slice(0, 10) || null,
      status: r.status,
      consented: !!r.consent_email_at,
      email: r.email ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The event row, inserted only when the statement before it changed one row. */
function eventAfter(env: Env, programmeId: number, applicationUid: string | null, actor: number, action: string, detail?: unknown) {
  return env.DB.prepare(
    `INSERT INTO testing_events (programme_id, application_id, actor_user_id, action, detail)
     SELECT ?, (SELECT id FROM testing_applications WHERE uid = ?), ?, ?, ?
     WHERE changes() = 1`,
  ).bind(programmeId, applicationUid, actor, action, detail === undefined ? null : JSON.stringify(detail));
}

async function changed(env: Env, stmts: any[]): Promise<boolean> {
  const res = await env.DB.batch(stmts);
  return Number(res?.[0]?.meta?.changes ?? 0) === 1;
}

/**
 * D814 (#2260): a member's notification opens My applications. The two that go
 * to a programme's creator name no page yet (D815 draws the partner's).
 */
export const MY_APPLICATIONS_LINK = '/product-testing?tab=applications';
const MEMBER_NOTICES = new Set(['testing_applied', 'testing_picked', 'testing_not_picked']);

async function tell(env: Env, userId: number | null | undefined, type: string, title: string, body: string, payload: Record<string, unknown>) {
  if (!userId) return;
  const link = MEMBER_NOTICES.has(type) ? MY_APPLICATIONS_LINK : null;
  try {
    await notify(env, { userId: Number(userId), type, title, body, payload, link, channels: ['in_app'], category: 'product_testing' });
  } catch (e) { console.warn('[testing] notify failed', (e as Error)?.message); }
}

export async function createProgramme(env: Env, owner: Owner, actor: number, body: any) {
  const input = programmeInput(body, false);
  const uid = newUid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO testing_programmes (uid, owner_kind, owner_partner_id, created_by, product_name, logo_key, summary,
         tester_tasks, time_needed, opens_at, closes_at, testing_starts, testing_ends, places, eligible_roles, questions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, owner.kind, owner.kind === 'partner' ? owner.partnerId : null, actor, ...merged(null, input)),
    env.DB.prepare(`INSERT INTO testing_events (programme_id, actor_user_id, action)
      SELECT id, ?, 'created' FROM testing_programmes WHERE uid = ? AND changes() = 1`).bind(actor, uid),
  ]);
  return programmeDto(await ownProgramme(env, owner, uid));
}

/** An edit: a draft, or a programme HQ sent back, which returns to draft. */
export async function editProgramme(env: Env, owner: Owner, actor: number, uid: string, body: any) {
  const p = await ownProgramme(env, owner, uid);
  const input = programmeInput(body, true);
  const keys = Object.keys(input);
  if (keys.length === 0) throw refuse(400, 'invalid_request', 'Nothing to change.');
  const ok = await changed(env, [
    env.DB.prepare(
      `UPDATE testing_programmes SET product_name = ?, logo_key = ?, summary = ?, tester_tasks = ?, time_needed = ?,
         opens_at = ?, closes_at = ?, testing_starts = ?, testing_ends = ?, places = ?, eligible_roles = ?, questions = ?,
         status = 'draft', updated_at = datetime('now')
       WHERE id = ? AND status IN ('draft', 'rejected')`,
    ).bind(...merged(p, input), p.id),
    eventAfter(env, p.id, null, actor, 'edited', { fields: keys }),
  ]);
  if (!ok) throw refuse(409, 'not_editable', 'Only a draft can be edited.');
  return programmeDto(await ownProgramme(env, owner, uid));
}

/** One status step on a programme, from `from` to `to`, with its event. */
async function step(env: Env, p: any, actor: number, from: string[], to: string, action: string, note?: string | null) {
  // `from` is one or two statuses; the JSON list keeps the statement fixed.
  const ok = await changed(env, [
    env.DB.prepare(
      `UPDATE testing_programmes SET status = ?, review_note = CASE WHEN ? THEN ? ELSE review_note END, updated_at = datetime('now')
        WHERE id = ? AND status IN (SELECT value FROM json_each(?))`,
    ).bind(to, note !== undefined ? 1 : 0, note ?? null, p.id, JSON.stringify(from)),
    eventAfter(env, p.id, null, actor, action, note ? { note } : undefined),
  ]);
  return ok;
}

export async function submitProgramme(env: Env, owner: Owner, actor: number, uid: string) {
  const p = await ownProgramme(env, owner, uid);
  if (p.owner_kind !== 'partner') throw refuse(409, 'not_submittable', "HQ's own programmes open without a review.");
  if (!(await step(env, p, actor, ['draft'], 'submitted', 'submitted'))) {
    throw refuse(409, 'not_submittable', 'Only a draft can be sent to HQ for review.');
  }
  return programmeDto(await ownProgramme(env, owner, uid));
}

/** HQ approves a partner's submitted programme, or sends it back with a note. */
export async function reviewProgramme(env: Env, actor: number, uid: string, decision: 'approve' | 'reject', noteIn: unknown) {
  const p = await programmeByUid(env, uid);
  const note = noteIn == null ? '' : String(noteIn).trim().slice(0, 2000);
  if (decision === 'reject' && !note) throw refuse(400, 'invalid_request', 'Say what to change before sending it back.');
  if (p.owner_kind !== 'partner') throw refuse(409, 'not_reviewable', "HQ's own programmes are not reviewed.");
  const to = decision === 'approve' ? 'approved' : 'rejected';
  if (!(await step(env, p, actor, ['submitted'], to, to, note || null))) {
    throw refuse(409, 'not_reviewable', 'Only a programme waiting for review can be approved or sent back.');
  }
  if (decision === 'approve') {
    await tell(env, p.created_by, 'testing_programme_approved', `${p.product_name} is approved`,
      'HQ approved your testing programme. It opens to members when HQ opens it.', { programme_uid: uid });
  } else {
    await tell(env, p.created_by, 'testing_programme_sent_back', `${p.product_name} was sent back`,
      `HQ sent your testing programme back: ${note}`, { programme_uid: uid });
  }
  return programmeDto(await programmeByUid(env, uid));
}

/** HQ opens a programme: its own from draft, a partner's only once approved. */
export async function openProgramme(env: Env, actor: number, uid: string) {
  const p = await programmeByUid(env, uid);
  const from = p.owner_kind === 'hq' ? ['draft'] : ['approved'];
  if (!(await step(env, p, actor, from, 'open', 'opened'))) {
    throw refuse(409, 'not_openable', p.owner_kind === 'hq'
      ? 'Only a draft can be opened.'
      : "A partner's programme opens only after HQ approves it.");
  }
  return programmeDto(await programmeByUid(env, uid));
}

export async function closeProgramme(env: Env, actor: number, uid: string) {
  const p = await programmeByUid(env, uid);
  if (!(await step(env, p, actor, ['open', 'testing'], 'closed', 'closed'))) {
    throw refuse(409, 'not_closable', 'Only an open programme can be closed.');
  }
  return programmeDto(await programmeByUid(env, uid));
}

export async function apply(env: Env, user: { id: number; role: string }, uid: string, body: any) {
  const p = await programmeByUid(env, uid);
  const now = nowIso();
  const accepting = p.status === 'open' && (!p.closes_at || p.closes_at > now) && (!p.opens_at || p.opens_at <= now);
  if (!accepting) throw refuse(409, 'not_open', 'This programme is not taking applications.');
  if (!parse<string[]>(p.eligible_roles, []).includes(String(user.role))) {
    throw refuse(403, 'not_eligible', 'This programme is not open to your role.');
  }
  if (Number(p.picked_count) >= Number(p.places)) throw refuse(409, 'programme_full', 'Every place on this programme is taken.');
  const questions = parse<string[]>(p.questions, []);
  const b = body && typeof body === 'object' ? body : {};
  const answers = Array.isArray(b.answers) ? b.answers.map((x: unknown) => String(x ?? '').trim()) : [];
  if (answers.length !== questions.length || answers.some((a: string) => !a || a.length > 2000)) {
    throw refuse(400, 'invalid_request', `Answer each of the ${questions.length} questions, up to 2000 characters each.`);
  }
  const availability = b.availability == null ? null : String(b.availability).trim().slice(0, 1000) || null;
  const consent = b.consent_email === true;
  const appUid = newUid();
  const ok = await changed(env, [
    env.DB.prepare(
      `INSERT OR IGNORE INTO testing_applications (uid, programme_id, user_id, answers, availability, consent_email_at, consent_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(appUid, p.id, user.id, JSON.stringify(answers), availability, consent ? now : null, consent ? CONSENT_VERSION : null),
    eventAfter(env, p.id, appUid, user.id, 'applied', { consent_email: consent }),
  ]);
  if (!ok) throw refuse(409, 'already_applied', 'You have already applied to this programme.');
  await tell(env, user.id, 'testing_applied', `You applied to test ${p.product_name}`,
    `${p.owner_name || 'The team'} will let you know if you are picked.`, { programme_uid: uid, application_uid: appUid });
  return (await myApplications(env, user.id)).find((a) => a.uid === appUid);
}

export async function withdraw(env: Env, userId: number, appUid: string) {
  const row = await env.DB.prepare('SELECT id, programme_id FROM testing_applications WHERE uid = ? AND user_id = ?')
    .bind(appUid, userId).first<any>();
  if (!row) throw refuse(404, 'not_found', 'Application not found.');
  const ok = await changed(env, [
    env.DB.prepare(`UPDATE testing_applications SET status = 'withdrawn', updated_at = datetime('now')
      WHERE id = ? AND status IN ('applied', 'picked')`).bind(row.id),
    eventAfter(env, row.programme_id, appUid, userId, 'withdrawn'),
  ]);
  if (!ok) throw refuse(409, 'not_withdrawable', 'This application can no longer be withdrawn.');
  return (await myApplications(env, userId)).find((a) => a.uid === appUid);
}

/** The owner picks or declines one application, picks held to the places. */
export async function decide(env: Env, owner: Owner, actor: number, appUid: string, decision: 'pick' | 'decline') {
  const a = await env.DB.prepare(
    'SELECT a.id, a.user_id, a.status, p.uid AS programme_uid FROM testing_applications a JOIN testing_programmes p ON p.id = a.programme_id WHERE a.uid = ?',
  ).bind(appUid).first<any>();
  if (!a) throw refuse(404, 'not_found', 'Application not found.');
  let p: any;
  try { p = await ownProgramme(env, owner, a.programme_uid); } catch { throw refuse(404, 'not_found', 'Application not found.'); }
  if (!['open', 'testing', 'closed'].includes(p.status)) {
    throw refuse(409, 'not_open', 'Testers are picked once the programme has opened.');
  }
  const ok = decision === 'pick'
    ? await changed(env, [
      env.DB.prepare(`UPDATE testing_applications SET status = 'picked', updated_at = datetime('now')
        WHERE id = ? AND status IN ('applied', 'declined')
          AND (SELECT COUNT(*) FROM testing_applications WHERE programme_id = ? AND status = 'picked') < ?`)
        .bind(a.id, p.id, Number(p.places)),
      eventAfter(env, p.id, appUid, actor, 'picked'),
    ])
    : await changed(env, [
      env.DB.prepare(`UPDATE testing_applications SET status = 'declined', updated_at = datetime('now')
        WHERE id = ? AND status IN ('applied', 'picked')`).bind(a.id),
      eventAfter(env, p.id, appUid, actor, 'declined'),
    ]);
  if (!ok) {
    if (decision === 'pick' && ['applied', 'declined'].includes(a.status)) {
      throw refuse(409, 'programme_full', 'Every place is taken. Decline someone first.');
    }
    throw refuse(409, 'not_decidable', decision === 'pick' ? 'This application cannot be picked.' : 'This application cannot be declined.');
  }
  if (decision === 'pick') {
    await tell(env, a.user_id, 'testing_picked', `You were picked to test ${p.product_name}`,
      'The team will be in touch with what happens next.', { programme_uid: p.uid });
  } else {
    await tell(env, a.user_id, 'testing_not_picked', `You were not picked to test ${p.product_name}`,
      'Thank you for applying. Other programmes will open.', { programme_uid: p.uid });
  }
  return (await applicants(env, owner, p.uid)).items.find((x) => x.uid === appUid);
}
