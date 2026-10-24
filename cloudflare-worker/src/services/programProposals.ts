/**
 * D955 (#2788) — PROGRAM PROPOSALS (migration 561): a studio's drafts, Send to
 * HQ, the studio's own list, HQ's queue, and the Super Admin's decision.
 *
 * A PROPOSAL BELONGS TO ITS STUDIO. Its studio is the sender's licence on HQ
 * (`licence_admins`, as `routes/licence_requests.ts` reads it). An admin of
 * that licence reads and edits it; an admin bound to no licence reads only
 * their own. Anyone else gets 404, as for a uid that does not exist. A Super
 * Admin also reads any proposal that is not a draft, which is HQ's queue.
 *
 * ITS STATUS IS NOT A PROGRAM'S. Draft → Sent to HQ → Approved, Sent back or
 * Declined (dc:325). Only a draft or a sent-back proposal changes; only a sent
 * one is decided. An approval writes a registry row whose status is `proposed`,
 * HQ's draft, through `insertProgramStatements` (PROGRAMS_MAP §3).
 *
 * WHO MAY SEND WAITS ON OD-PROP (D953 §5): who may send a proposal while no
 * studio is deployed. `sendPolicy` is the one place that answers it. Until
 * D955 records the owner's answer it is closed, and Send answers 403
 * `proposals_closed`; drafts are saved as usual.
 *
 * EVERY SEND AND DECISION IS AUDITED with `logAdminAction` (PROPOSAL_ACTIONS).
 * A search escapes `%`, `_` and `\`. All SQL is bound.
 */
import type { Env } from '../types';
import { logAdminAction } from './adminAudit';
import {
  PROGRAM_GROUPS, PROPOSAL_ACTIONS, ProgramError, checkNewKey, checkTemplates, insertProgramStatements, isKeyTaken,
  keyFromName, type Actor, type NewProgram, type ProgramReader,
} from './programRegistry';

export const PROPOSAL_STATUSES = ['draft', 'sent', 'approved', 'sent_back', 'declined'] as const;
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];

/** PG14's lists (dc:463-466), in the canvas's order. */
export const WHO_WORDS = ['Founders', 'Investors', 'Advisors', 'Operating partners', 'Explorers', 'Product testers'] as const;
export const JOIN_METHODS = ['Open', 'By application', 'By invitation', 'Assigned by an admin'] as const;
export const REWARDS = ['None', 'Credits', 'Cash', 'Equity'] as const;
export const CYCLES = ['rolling', 'cohorts'] as const;
/** The seven switches, as stored and as the canvas names them. Declarations only. */
export const TOOLS = {
  application_queue: 'Application queue',
  cohort_calendar: 'Cohort calendar',
  assignments: 'Assignments',
  referral_codes: 'Referral codes',
  credits_perks: 'Credits and perks',
  learning_content: 'Learning content',
  events: 'Events',
} as const;
export type ToolKey = keyof typeof TOOLS;

export const DECISION_OUTCOMES = ['approve_studio', 'approve_catalogue', 'send_back', 'decline'] as const;
export type Outcome = typeof DECISION_OUTCOMES[number];

const MAX = { name: 120, purpose: 300, eligibility: 1000, hq_receives: 1000, note: 2000 } as const;
const SEATS_MAX = 100_000;
export const PAGE_SIZE = 25;
/** What Send needs (dc:463-464). */
export const SEND_NEEDS = ['name', 'purpose', 'who', 'grp', 'join_method'] as const;

export const PROPOSALS_CLOSED =
  'HQ has not opened program proposals yet, so this proposal cannot be sent. It stays saved as a draft.';

// ---------------------------------------------------------------------------
// Who
// ---------------------------------------------------------------------------

/** The licence this admin administers on HQ, by uid, or null (HQ-held). */
export async function studioOf(env: Env, userId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT l.uid FROM licence_admins la JOIN territory_licences l ON l.id = la.licence_id WHERE la.user_id = ? ORDER BY la.licence_id LIMIT 1`,
  ).bind(userId).first<{ uid: string }>();
  return row?.uid ?? null;
}

/** Who reads the registry (part 1's reads filter studio-only programs by it). */
export async function readerOf(env: Env, user: { id: number; superAdmin: boolean }): Promise<ProgramReader> {
  return { superAdmin: user.superAdmin, licenceUid: user.superAdmin ? null : await studioOf(env, user.id) };
}

/**
 * OD-PROP (D953 §5): who may send a proposal to HQ. The one place its answer
 * lives. Until the owner answers, nobody may: Send is 403 `proposals_closed`.
 */
export function sendPolicy(_actor: { id: number; studio: string | null }): { open: boolean; sentence: string } {
  return { open: false, sentence: PROPOSALS_CLOSED };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type Row = {
  id: number; uid: string; created_by_user_id: number; licence_uid: string | null; status: ProposalStatus;
  name: string | null; purpose: string | null; who_json: string | null; grp: string | null;
  join_method: string | null; cycle: string | null; cohort_weeks: number | null; seats: number | null; eligibility: string | null;
  rewards_json: string | null; template_keys: string; hq_receives: string | null; tools_json: string | null;
  sent_at: string | null; decision: string | null; hq_note: string | null; decided_by_user_id: number | null;
  decided_at: string | null; program_key: string | null; created_at: string; updated_at: string;
};

const listOf = (raw: unknown): string[] => {
  try {
    const v = JSON.parse(String(raw ?? 'null'));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const listOrNull = (raw: unknown): string[] | null => (raw == null ? null : listOf(raw));
const toolsOf = (raw: unknown): Record<ToolKey, boolean> | null => {
  if (raw == null) return null;
  try {
    const v = JSON.parse(String(raw));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return Object.fromEntries((Object.keys(TOOLS) as ToolKey[]).map((k) => [k, v[k] === true])) as Record<ToolKey, boolean>;
  } catch {
    return null;
  }
};

/** Every field, for the row's Open and PG15a. A field nobody set is null ("Not set"). */
export function proposalView(r: Row, studio: string | null = null) {
  return {
    uid: r.uid, status: r.status, studio: studio ?? null, licence_uid: r.licence_uid ?? null,
    name: r.name, purpose: r.purpose, who: listOrNull(r.who_json), group: r.grp,
    join_method: r.join_method, cycle: r.cycle, cohort_weeks: r.cohort_weeks == null ? null : Number(r.cohort_weeks),
    seats: r.seats == null ? null : Number(r.seats), eligibility: r.eligibility,
    rewards: listOrNull(r.rewards_json), template_keys: listOf(r.template_keys), hq_receives: r.hq_receives,
    tools: toolsOf(r.tools_json),
    sent_at: r.sent_at, decision: r.decision, hq_note: r.hq_note, decided_at: r.decided_at, program_key: r.program_key,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

const notFound = () => new ProgramError(404, 'unknown_proposal', 'No proposal has that uid.');

/**
 * The studio's own rule, as bound SQL: a licence's admins share its proposals;
 * an admin with no licence reads only their own. It binds (studio, studio, id)
 * to `((? IS NOT NULL AND licence_uid = ?) OR (licence_uid IS NULL AND created_by_user_id = ?))`;
 * with a studio, the id is -1, which no user has.
 */
const ownsArgs = (a: { id: number; studio: string | null }) => [a.studio, a.studio, a.studio ? -1 : a.id];

async function ownRow(env: Env, uid: string, actor: { id: number; studio: string | null }): Promise<Row> {
  const row = await env.DB.prepare(
    'SELECT * FROM program_proposals WHERE uid = ? AND ((? IS NOT NULL AND licence_uid = ?) OR (licence_uid IS NULL AND created_by_user_id = ?))',
  ).bind(uid, ...ownsArgs(actor)).first<Row>();
  if (!row) throw notFound();
  return row;
}

async function studioName(env: Env, licenceUid: string | null): Promise<string> {
  if (!licenceUid) return 'HQ-held';
  const r = await env.DB.prepare('SELECT brand_name FROM territory_licences WHERE uid = ?').bind(licenceUid).first<{ brand_name: string | null }>();
  return r?.brand_name?.trim() || licenceUid;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

function text(b: Record<string, unknown>, k: string, max: number): string | null | undefined {
  if (!(k in b)) return undefined;
  const v = b[k];
  if (v === null) return null;
  if (typeof v !== 'string') throw new ProgramError(400, `bad_${k}`, `${k} must be text, or null to clear it.`);
  const t = v.trim();
  if (t.length > max) throw new ProgramError(400, `bad_${k}`, `${k} is at most ${max} characters.`);
  return t || null;
}

function oneOf<T extends string>(b: Record<string, unknown>, k: string, list: readonly T[]): T | null | undefined {
  if (!(k in b)) return undefined;
  if (b[k] === null) return null;
  if (!(list as readonly unknown[]).includes(b[k])) throw new ProgramError(400, `bad_${k}`, `${k} is one of ${list.join(', ')}.`);
  return b[k] as T;
}

function wholeIn(b: Record<string, unknown>, k: string, lo: number, hi: number): number | null | undefined {
  if (!(k in b)) return undefined;
  if (b[k] === null) return null;
  const n = b[k];
  if (typeof n !== 'number' || !Number.isInteger(n) || n < lo || n > hi) {
    throw new ProgramError(400, `bad_${k}`, `${k} is a whole number from ${lo} to ${hi}.`);
  }
  return n;
}

function wordsOf(b: Record<string, unknown>, k: string, list: readonly string[]): string | null | undefined {
  if (!(k in b)) return undefined;
  if (b[k] === null) return null;
  const v = b[k];
  if (!Array.isArray(v) || v.some((x) => !list.includes(x as string))) {
    throw new ProgramError(400, `bad_${k}`, `${k} is a list of ${list.join(', ')}.`);
  }
  const picked = list.filter((x) => v.includes(x));
  if (k === 'rewards' && picked.includes('None') && picked.length > 1) {
    throw new ProgramError(400, 'bad_rewards', 'None cannot be chosen with another reward.');
  }
  return picked.length ? JSON.stringify(picked) : null;
}

function toolsIn(b: Record<string, unknown>): string | null | undefined {
  if (!('tools' in b)) return undefined;
  if (b.tools === null) return null;
  const v = b.tools as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !(k in TOOLS) || typeof v[k] !== 'boolean')) {
    throw new ProgramError(400, 'bad_tools', `tools is an object of ${Object.keys(TOOLS).join(', ')}, each true or false.`);
  }
  return JSON.stringify(Object.fromEntries((Object.keys(TOOLS) as ToolKey[]).map((k) => [k, v[k] === true])));
}

/** Every column a draft saves, in one order: the INSERT and the UPDATE below name them in this order. */
const DRAFT_COLUMNS = ['name', 'purpose', 'who_json', 'grp', 'join_method', 'cycle', 'cohort_weeks', 'seats', 'eligibility',
  'rewards_json', 'template_keys', 'hq_receives', 'tools_json'] as const;

/** The fields a draft may save, validated; only what was sent. */
async function fieldsOf(env: Env, body: unknown): Promise<Record<string, unknown>> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const out: Record<string, unknown> = {
    name: text(b, 'name', MAX.name),
    purpose: text(b, 'purpose', MAX.purpose),
    who_json: wordsOf(b, 'who', WHO_WORDS),
    grp: oneOf(b, 'group', PROGRAM_GROUPS),
    join_method: oneOf(b, 'join_method', JOIN_METHODS),
    cycle: oneOf(b, 'cycle', CYCLES),
    cohort_weeks: wholeIn(b, 'cohort_weeks', 1, 52),
    seats: wholeIn(b, 'seats', 1, SEATS_MAX),
    eligibility: text(b, 'eligibility', MAX.eligibility),
    rewards_json: wordsOf(b, 'rewards', REWARDS),
    template_keys: 'template_keys' in b ? JSON.stringify(b.template_keys === null ? [] : await checkTemplates(env, b.template_keys)) : undefined,
    hq_receives: text(b, 'hq_receives', MAX.hq_receives),
    tools_json: toolsIn(b),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

const newUid = () => `pp-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** POST /api/admin/programs/proposals — a new draft for the caller's studio, with any fields sent. */
export async function startDraft(env: Env, actor: Actor & { studio: string | null }, body: unknown) {
  const f = await fieldsOf(env, body ?? {});
  const uid = newUid();
  const t = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO program_proposals (uid, created_by_user_id, licence_uid, status, created_at, updated_at,
       name, purpose, who_json, grp, join_method, cycle, cohort_weeks, seats, eligibility, rewards_json, template_keys, hq_receives, tools_json)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, actor.id, actor.studio, t, t,
    ...DRAFT_COLUMNS.map((c) => (c in f ? f[c] : c === 'template_keys' ? '[]' : null))).run();
  return proposalView(await ownRow(env, uid, actor), await studioName(env, actor.studio));
}

/** PATCH /api/admin/programs/proposals/:uid — saves any subset; only a draft or a sent-back proposal changes. */
export async function saveDraft(env: Env, uid: string, actor: Actor & { studio: string | null }, body: unknown) {
  const row = await ownRow(env, uid, actor);
  if (row.status !== 'draft' && row.status !== 'sent_back') {
    throw new ProgramError(409, 'not_editable', 'Only a draft or a proposal HQ sent back can be changed.');
  }
  const f = await fieldsOf(env, body);
  if (!Object.keys(f).length) throw new ProgramError(400, 'nothing_to_change', 'Send at least one field to save.');
  const t = new Date().toISOString();
  // Each column is written only when it was sent: `? = 1` says whether it was.
  await env.DB.prepare(
    `UPDATE program_proposals SET
       name = CASE WHEN ? = 1 THEN ? ELSE name END,
       purpose = CASE WHEN ? = 1 THEN ? ELSE purpose END,
       who_json = CASE WHEN ? = 1 THEN ? ELSE who_json END,
       grp = CASE WHEN ? = 1 THEN ? ELSE grp END,
       join_method = CASE WHEN ? = 1 THEN ? ELSE join_method END,
       cycle = CASE WHEN ? = 1 THEN ? ELSE cycle END,
       cohort_weeks = CASE WHEN ? = 1 THEN ? ELSE cohort_weeks END,
       seats = CASE WHEN ? = 1 THEN ? ELSE seats END,
       eligibility = CASE WHEN ? = 1 THEN ? ELSE eligibility END,
       rewards_json = CASE WHEN ? = 1 THEN ? ELSE rewards_json END,
       template_keys = CASE WHEN ? = 1 THEN ? ELSE template_keys END,
       hq_receives = CASE WHEN ? = 1 THEN ? ELSE hq_receives END,
       tools_json = CASE WHEN ? = 1 THEN ? ELSE tools_json END,
       updated_at = ?
     WHERE id = ? AND status IN ('draft', 'sent_back')`,
  ).bind(...DRAFT_COLUMNS.flatMap((c) => (c in f ? [1, f[c]] : [0, null])), t, row.id).run();
  return proposalView(await ownRow(env, uid, actor), await studioName(env, actor.studio));
}

// ---------------------------------------------------------------------------
// Send to HQ
// ---------------------------------------------------------------------------

/** What Send still needs, by field name; empty when it may go. */
export function missingForSend(r: Row): string[] {
  const has: Record<(typeof SEND_NEEDS)[number], boolean> = {
    name: !!r.name, purpose: !!r.purpose, who: listOf(r.who_json).length > 0, grp: !!r.grp, join_method: !!r.join_method,
  };
  return SEND_NEEDS.filter((k) => !has[k]).map((k) => (k === 'grp' ? 'group' : k));
}

/**
 * POST /api/admin/programs/proposals/:uid/send. A draft or sent-back proposal
 * with a name, purpose, who, group and join method becomes `sent`, if
 * `sendPolicy` (OD-PROP) lets this sender send.
 */
export async function sendProposal(
  env: Env, uid: string, actor: Actor & { studio: string | null },
  policy: typeof sendPolicy = sendPolicy,
) {
  const row = await ownRow(env, uid, actor);
  if (row.status !== 'draft' && row.status !== 'sent_back') {
    throw new ProgramError(409, 'not_editable', 'Only a draft or a proposal HQ sent back can be sent.');
  }
  const missing = missingForSend(row);
  if (missing.length) {
    throw Object.assign(new ProgramError(400, 'incomplete', `Add ${missing.join(', ')} before sending to HQ.`), { missing });
  }
  const gate = policy({ id: actor.id, studio: actor.studio });
  if (!gate.open) throw new ProposalsClosed(gate.sentence);
  const t = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE program_proposals SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'sent_back')`,
  ).bind(t, t, row.id).run();
  if (!Number(res.meta?.changes)) throw new ProgramError(409, 'not_editable', 'This proposal changed. Reload it.');
  await logAdminAction(env, actor.id, actor.email, PROPOSAL_ACTIONS.send, { uid, licence_uid: actor.studio });
  return proposalView(await ownRow(env, uid, actor), await studioName(env, actor.studio));
}

/** Send's refusal while OD-PROP is open: 403 `proposals_closed`. */
export class ProposalsClosed extends Error {
  sentence: string;
  constructor(sentence: string) { super(sentence); this.sentence = sentence; }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `q` matched as a substring of the name, with `%`, `_` and `\` taken literally. */
export const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export type ListQuery = { q: string; status: ProposalStatus | null; sort: 'newest' | 'oldest'; page: number; licence?: string | null };

export function parseListQuery(get: (k: string) => string | undefined, defaultSort: 'newest' | 'oldest'):
  { ok: true; query: ListQuery } | { ok: false; code: string; detail: string } {
  const q = String(get('q') ?? '').trim().slice(0, 120);
  const s = get('status');
  if (s && !(PROPOSAL_STATUSES as readonly string[]).includes(s)) {
    return { ok: false, code: 'bad_status', detail: `status is one of ${PROPOSAL_STATUSES.join(', ')}.` };
  }
  const sort = get('sort') || defaultSort;
  if (sort !== 'newest' && sort !== 'oldest') return { ok: false, code: 'bad_sort', detail: 'sort is newest or oldest.' };
  const rawPage = get('page');
  const page = rawPage === undefined || rawPage === '' ? 1 : Number(rawPage);
  if (!Number.isInteger(page) || page < 1 || page > 10_000) return { ok: false, code: 'bad_page', detail: 'page is a whole number from 1.' };
  const licence = get('licence');
  return { ok: true, query: { q, status: (s as ProposalStatus) || null, sort, page, licence: licence ? licence.slice(0, 64) : null } };
}

/** GET /api/admin/programs/proposals/mine — the studio's proposals (or the caller's own with no licence). */
/** The filters both lists share, as bound SQL: status, then the name search. Binds (status, status, like, like). */
const filterArgs = (lq: ListQuery) => [lq.status, lq.status, lq.q ? likeOf(lq.q) : null, lq.q ? likeOf(lq.q) : null];

export async function myProposals(env: Env, actor: { id: number; studio: string | null }, lq: ListQuery) {
  const args = [...ownsArgs(actor), ...filterArgs(lq)];
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM program_proposals
      WHERE ((? IS NOT NULL AND licence_uid = ?) OR (licence_uid IS NULL AND created_by_user_id = ?))
        AND (? IS NULL OR status = ?) AND (? IS NULL OR name LIKE ? ESCAPE '\\')`,
  ).bind(...args).first<{ n: number }>();
  // Newest by when it was last sent, or made for one never sent; `sort` picks the direction.
  const rows = await env.DB.prepare(
    `SELECT * FROM program_proposals
      WHERE ((? IS NOT NULL AND licence_uid = ?) OR (licence_uid IS NULL AND created_by_user_id = ?))
        AND (? IS NULL OR status = ?) AND (? IS NULL OR name LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN ? = 'oldest' THEN COALESCE(sent_at, created_at) END ASC,
               CASE WHEN ? = 'oldest' THEN id END ASC,
               COALESCE(sent_at, created_at) DESC, id DESC
      LIMIT ? OFFSET ?`,
  ).bind(...args, lq.sort, lq.sort, PAGE_SIZE, (lq.page - 1) * PAGE_SIZE).all<Row>();
  return {
    rows: (rows.results || []).map((r) => ({
      uid: r.uid, name: r.name, sent_at: r.sent_at, status: r.status, hq_note: r.hq_note, updated_at: r.updated_at,
    })),
    total: Number(total?.n ?? 0), page: lq.page, page_size: PAGE_SIZE,
  };
}

/** GET /api/admin/programs/proposals — HQ's queue: every studio's proposals but drafts, oldest first by default. */
export async function hqQueue(env: Env, lq: ListQuery) {
  // `licence` is a licence's uid, `hq-held` for proposals sent by no studio, or none for every studio.
  const licence = lq.licence ?? null;
  const args = [licence, licence, licence, ...filterArgs(lq)];
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM program_proposals p
      WHERE p.status != 'draft'
        AND (? IS NULL OR (? = 'hq-held' AND p.licence_uid IS NULL) OR p.licence_uid = ?)
        AND (? IS NULL OR p.status = ?) AND (? IS NULL OR p.name LIKE ? ESCAPE '\\')`,
  ).bind(...args).first<{ n: number }>();
  // Oldest first by default (dc:368); `sort` picks the direction.
  const rows = await env.DB.prepare(
    `SELECT p.uid, p.name, p.licence_uid, p.sent_at, p.status, l.brand_name
       FROM program_proposals p LEFT JOIN territory_licences l ON l.uid = p.licence_uid
      WHERE p.status != 'draft'
        AND (? IS NULL OR (? = 'hq-held' AND p.licence_uid IS NULL) OR p.licence_uid = ?)
        AND (? IS NULL OR p.status = ?) AND (? IS NULL OR p.name LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN ? = 'newest' THEN p.sent_at END DESC,
               CASE WHEN ? = 'newest' THEN p.id END DESC,
               p.sent_at ASC, p.id ASC
      LIMIT ? OFFSET ?`,
  ).bind(...args, lq.sort, lq.sort, PAGE_SIZE, (lq.page - 1) * PAGE_SIZE)
    .all<{ uid: string; name: string | null; licence_uid: string | null; sent_at: string | null; status: ProposalStatus; brand_name: string | null }>();
  const counts = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM program_proposals WHERE status != 'draft' GROUP BY status",
  ).all<{ status: ProposalStatus; n: number }>();
  const by = Object.fromEntries(PROPOSAL_STATUSES.filter((s) => s !== 'draft').map((s) => [s, 0])) as Record<string, number>;
  for (const c of counts.results || []) by[c.status] = Number(c.n);
  return {
    rows: (rows.results || []).map((r) => ({
      uid: r.uid, name: r.name, studio: r.licence_uid ? (r.brand_name?.trim() || r.licence_uid) : 'HQ-held',
      licence_uid: r.licence_uid, sent_at: r.sent_at, status: r.status,
    })),
    total: Number(total?.n ?? 0), page: lq.page, page_size: PAGE_SIZE, counts: by,
  };
}

/** GET /api/admin/programs/proposals/:uid — the studio's own, or, for a Super Admin, any that is not a draft. */
export async function proposalDetail(env: Env, uid: string, actor: { id: number; studio: string | null; superAdmin: boolean }) {
  let row: Row | null = null;
  try {
    row = await ownRow(env, uid, actor);
  } catch (e) {
    if (!(e instanceof ProgramError) || !actor.superAdmin) throw e;
  }
  if (!row) {
    row = await env.DB.prepare("SELECT * FROM program_proposals WHERE uid = ? AND status != 'draft'").bind(uid).first<Row>();
    if (!row) throw notFound();
  }
  return proposalView(row, await studioName(env, row.licence_uid));
}

// ---------------------------------------------------------------------------
// The Super Admin's decision
// ---------------------------------------------------------------------------

const lower = (w: string) => w.charAt(0).toLowerCase() + w.slice(1);
/** "Founders, operating partners", as PG14's Review reads it (dc:467). */
export const whoLine = (words: string[]) => words.map((w, i) => (i ? lower(w) : w)).join(', ') || null;

/** "By application · cohorts of 12 weeks · 12 seats" (dc:467). */
export function joinLine(p: { join_method: string | null; cycle: string | null; cohort_weeks: number | null; seats: number | null }) {
  const parts = [
    p.join_method,
    p.cycle === 'rolling' ? 'rolling' : p.cycle === 'cohorts' && p.cohort_weeks ? `cohorts of ${p.cohort_weeks} ${p.cohort_weeks === 1 ? 'week' : 'weeks'}` : null,
    p.seats ? `${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const toolsLine = (t: Record<ToolKey, boolean> | null) => {
  const on = t ? (Object.keys(TOOLS) as ToolKey[]).filter((k) => t[k]).map((k) => TOOLS[k]) : [];
  return on.length ? on.map((x, i) => (i ? lower(x) : x)).join(', ') : null;
};

/** PG14's Review sections (dc:467), as an unpublished playbook draft. */
export function reviewSections(v: ReturnType<typeof proposalView>): NewProgram['sections'] {
  return [
    { key: 'purpose', title: 'Purpose', body: v.purpose },
    { key: 'who', title: 'Who it is for', body: whoLine(v.who ?? []) },
    { key: 'join', title: 'How people join', body: joinLine(v) },
    { key: 'rewards', title: 'Rewards', body: v.rewards?.length ? v.rewards.join(', ') : null, template_keys: v.template_keys },
    { key: 'tools', title: 'Tools', body: toolsLine(v.tools) },
  ];
}

/**
 * POST /api/admin/programs/proposals/:uid/decision — { outcome, note }.
 * Only a `sent` proposal is decided (409 `not_waiting`). Send back and Decline
 * need a note. An approval writes the registry row and its draft in the same
 * batch as the decision, and the decision's UPDATE is guarded on `sent`, so a
 * second decision racing the first changes nothing.
 */
export async function decide(env: Env, uid: string, body: unknown, actor: Actor) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (!(DECISION_OUTCOMES as readonly unknown[]).includes(b.outcome)) {
    throw new ProgramError(400, 'bad_outcome', `outcome is one of ${DECISION_OUTCOMES.join(', ')}.`);
  }
  const outcome = b.outcome as Outcome;
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') {
    throw new ProgramError(400, 'bad_note', 'note must be text.');
  }
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > MAX.note) throw new ProgramError(400, 'note_too_long', `A note is at most ${MAX.note} characters.`);
  if ((outcome === 'send_back' || outcome === 'decline') && !note) {
    throw new ProgramError(400, 'note_required', 'Write a note to the studio. It is required to send a proposal back or decline it.');
  }
  const row = await env.DB.prepare("SELECT * FROM program_proposals WHERE uid = ? AND status != 'draft'").bind(uid).first<Row>();
  if (!row) throw notFound();
  if (row.status !== 'sent') throw new ProgramError(409, 'not_waiting', 'Only a proposal sent to HQ and not yet decided can be decided.');

  const status: ProposalStatus = outcome === 'send_back' ? 'sent_back' : outcome === 'decline' ? 'declined' : 'approved';
  const decision = outcome === 'approve_studio' ? 'studio' : outcome === 'approve_catalogue' ? 'catalogue' : null;
  let programKey: string | null = null;
  const stmts = [];
  if (decision) {
    if (decision === 'studio' && !row.licence_uid) {
      throw new ProgramError(409, 'no_studio', 'This proposal was sent by no studio, so it cannot be approved for one studio only.');
    }
    const v = proposalView(row);
    programKey = keyFromName(v.name ?? '');
    await checkNewKey(env, programKey);
    stmts.push(...insertProgramStatements(env, {
      key: programKey, grp: v.group!, name: v.name!, purpose: v.purpose, who: whoLine(v.who ?? []), join_method: v.join_method,
      licence_uid: decision === 'studio' ? row.licence_uid : null, sections: reviewSections(v),
    }, actor.id));
  }
  const t = new Date().toISOString();
  stmts.push(env.DB.prepare(
    `UPDATE program_proposals SET status = ?, decision = ?, hq_note = ?, decided_by_user_id = ?, decided_at = ?, program_key = ?, updated_at = ?
      WHERE id = ? AND status = 'sent'`,
  ).bind(status, decision, note || null, actor.id, t, programKey, t, row.id));
  let results;
  try {
    results = await env.DB.batch(stmts);
  } catch (e) {
    if (isKeyTaken(e)) throw new ProgramError(409, 'program_key_taken', `A program with the key ${programKey} already exists.`);
    throw e;
  }
  if (!Number(results[results.length - 1]?.meta?.changes)) {
    throw new ProgramError(409, 'not_waiting', 'Another decision landed first. Reload the proposal.');
  }
  await logAdminAction(env, actor.id, actor.email, PROPOSAL_ACTIONS.decide, {
    uid, outcome, note: note || null, ...(programKey ? { program_key: programKey } : {}),
  });
  const after = await env.DB.prepare('SELECT * FROM program_proposals WHERE id = ?').bind(row.id).first<Row>();
  return proposalView(after!, await studioName(env, after!.licence_uid));
}

// ---------------------------------------------------------------------------
// New program (HQ's own)
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/programs — a `proposed` registry row from Basics and How it
 * runs, for every studio, with the Review sections as an unpublished draft:
 * "How people join" from How it runs, the rest unset ("Not set").
 */
export async function newProgram(env: Env, body: unknown, actor: Actor) {
  const f = await fieldsOf(env, body);
  const allowed = ['name', 'purpose', 'who_json', 'grp', 'join_method', 'cycle', 'cohort_weeks', 'seats', 'eligibility'];
  const extra = Object.keys(f).filter((k) => !allowed.includes(k));
  if (extra.length) {
    throw new ProgramError(400, 'bad_field', 'New program takes Basics and How it runs: name, purpose, who, group, join_method, cycle, cohort_weeks, seats and eligibility.');
  }
  const name = (f.name as string | null | undefined) ?? null;
  const grp = (f.grp as string | null | undefined) ?? null;
  const missing = [!name && 'name', !grp && 'group'].filter(Boolean);
  if (missing.length) throw new ProgramError(400, 'incomplete', `Add ${missing.join(' and ')} to create a program.`);
  const key = keyFromName(name!);
  await checkNewKey(env, key);
  const who = listOf(f.who_json ?? null);
  const join = {
    join_method: (f.join_method as string | null) ?? null, cycle: (f.cycle as string | null) ?? null,
    cohort_weeks: (f.cohort_weeks as number | null) ?? null, seats: (f.seats as number | null) ?? null,
  };
  const eligibility = (f.eligibility as string | null | undefined) ?? null;
  const sections: NewProgram['sections'] = [
    { key: 'purpose', title: 'Purpose', body: (f.purpose as string | null) ?? null },
    { key: 'who', title: 'Who it is for', body: [whoLine(who), eligibility].filter(Boolean).join('\n') || null },
    { key: 'join', title: 'How people join', body: joinLine(join) },
    { key: 'rewards', title: 'Rewards', body: null },
    { key: 'tools', title: 'Tools', body: null },
  ];
  try {
    await env.DB.batch(insertProgramStatements(env, {
      key, grp: grp!, name: name!, purpose: (f.purpose as string | null) ?? null, who: whoLine(who), join_method: join.join_method,
      licence_uid: null, sections,
    }, actor.id));
  } catch (e) {
    if (isKeyTaken(e)) throw new ProgramError(409, 'program_key_taken', `A program with the key ${key} already exists.`);
    throw e;
  }
  await logAdminAction(env, actor.id, actor.email, PROPOSAL_ACTIONS.create, { program_key: key });
  return key;
}
