/**
 * D1215 (#3212, part 2 of #2424) — a closing as a record: its lines, their
 * capital route, the evidence that money moved, the cap-table proposal and the
 * events, over migration 612's four stores.
 *
 * WHO READS WHAT (#2424 owner question 3):
 *   · an admin reads every closing and every line;
 *   · a founder reads the closings of their own ventures (`projectOwnerScope`),
 *     every line;
 *   · anyone else reads a closing only through a line of their own
 *     (`closing_lines.investor_user_id`), and then reads their own lines and
 *     the round's total only: no other investor's line, name or amount, and no
 *     events.
 * Any other caller gets the same 404 as a closing that does not exist.
 *
 * WHAT COUNTS AS RECEIVED (owner question 4). A line reads `received` only on
 * RECEIVING-side evidence that is not withdrawn: the company's or an Axal
 * entity's Mercury, an Admin's phone-verified record (a `deal_transfers` row on
 * the deal), or a bank confirmation file. The investor's own Mercury is the
 * SENDING side: alone it reads `sent`, "Sent, not yet confirmed". The status is
 * recomputed from the evidence in the same batch as each change, never set by
 * hand.
 *
 * EVERY WRITE APPENDS ONE EVENT, in the same batch as the write, so a write and
 * its event commit together or not at all. An event carries the actor, the
 * step, the line and a source reference that names a stored row by its uid
 * (`closing_evidence:<uid>`, `deal_transfer:<uid>`). It carries no amount, no
 * name and no account number; `closing_events` has no column for one.
 *
 * The platform never moves money: every write here records.
 */
import type { Env, User } from '../types';
import { projectOwnerScope } from './tenancyScope';

export class ClosingRefusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

export const ROUTES = ['direct', 'syndicate', 'axal_fund', 'third_party_fund'] as const;
export type CapitalRoute = typeof ROUTES[number];

/** Which side each kind of evidence comes from (owner question 4). */
export const EVIDENCE_SIDE = {
  company_mercury: 'receiving',
  axal_mercury: 'receiving',
  phone_verified_record: 'receiving',
  bank_confirmation: 'receiving',
  investor_mercury: 'sending',
} as const;
export type EvidenceKind = keyof typeof EVIDENCE_SIDE;

/** The source reference each kind takes: a stored row or file named by its id, never bank text. */
const SOURCE_REF: Record<EvidenceKind, RegExp> = {
  company_mercury: /^mercury:[A-Za-z0-9_-]{1,64}$/,
  axal_mercury: /^mercury:[A-Za-z0-9_-]{1,64}$/,
  investor_mercury: /^mercury:[A-Za-z0-9_-]{1,64}$/,
  phone_verified_record: /^deal_transfer:[A-Za-z0-9_-]{1,64}$/,
  bank_confirmation: /^file:[A-Za-z0-9_./-]{1,160}$/,
};

export const WITHDRAW_REASON_MIN = 10;
export const WITHDRAW_REASON_MAX = 200;

const uid = () => crypto.randomUUID().replace(/-/g, '');
const now = () => new Date().toISOString();
const missing = () => new ClosingRefusal(404, 'closing_not_found', 'No closing here.');

type ClosingRow = {
  id: number; uid: string; deal_id: number; project_id: number; round_label: string | null; instrument: string | null;
  template_slug: string | null; currency: string; status: 'open' | 'closed' | 'cancelled'; owner_user_id: number | null;
  deadline: string | null; captable_state: 'accepted' | 'dismissed' | null; captable_decided_at: string | null;
  closed_at: string | null; created_at: string;
};

export type Reach = 'all' | 'own';

const isAdmin = (user: User) => String(user?.role ?? '') === 'admin';

async function closingByUid(env: Env, closingUid: string): Promise<ClosingRow | null> {
  return env.DB.prepare('SELECT * FROM closings WHERE uid = ?').bind(String(closingUid)).first<ClosingRow>();
}

/** How much of this closing the caller reads: every line, their own lines, or nothing (null). */
export async function reachOf(env: Env, user: User, closing: ClosingRow): Promise<Reach | null> {
  if (isAdmin(user)) return 'all';
  const owner = projectOwnerScope(user as any, 'p');
  const founder = await env.DB.prepare(`SELECT 1 AS yes FROM projects p WHERE p.id = ? AND ${owner.sql}`)
    .bind(closing.project_id, ...owner.binds).first();
  if (founder) return 'all';
  const own = await env.DB.prepare('SELECT 1 AS yes FROM closing_lines WHERE closing_id = ? AND investor_user_id = ? LIMIT 1')
    .bind(closing.id, Number(user.id)).first();
  return own ? 'own' : null;
}

/** The closing, if the caller may read it; else the 404 of one that does not exist. */
async function readable(env: Env, user: User, closingUid: string): Promise<{ closing: ClosingRow; reach: Reach }> {
  const closing = await closingByUid(env, closingUid);
  if (!closing) throw missing();
  const reach = await reachOf(env, user, closing);
  if (!reach) throw missing();
  return { closing, reach };
}

/** An open closing an admin acts on. */
async function openForAdmin(env: Env, closingUid: string): Promise<ClosingRow> {
  const closing = await closingByUid(env, closingUid);
  if (!closing) throw missing();
  if (closing.status !== 'open') throw new ClosingRefusal(409, 'closing_not_open', 'This closing is closed, so nothing on it changes.');
  return closing;
}

function event(env: Env, closingId: number, lineId: number | null, actor: number, name: string, sourceRef: string | null = null) {
  return env.DB.prepare(
    'INSERT INTO closing_events (closing_id, line_id, actor_user_id, event, source_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(closingId, lineId, actor, name, sourceRef, now());
}

/** The line's status from its evidence: withdrawn stays; receiving evidence is received; sending alone is sent. */
function recompute(env: Env, lineId: number) {
  return env.DB.prepare(
    `UPDATE closing_lines SET status = CASE
        WHEN status = 'withdrawn' THEN 'withdrawn'
        WHEN EXISTS (SELECT 1 FROM closing_evidence e WHERE e.line_id = closing_lines.id AND e.side = 'receiving' AND e.withdrawn_at IS NULL) THEN 'received'
        WHEN EXISTS (SELECT 1 FROM closing_evidence e WHERE e.line_id = closing_lines.id AND e.side = 'sending' AND e.withdrawn_at IS NULL) THEN 'sent'
        ELSE 'open' END,
      updated_at = ?
      WHERE id = ?`,
  ).bind(now(), lineId);
}

// ───────────────────────────────────────────────────────────── reads

/** The closings this caller reads, newest first. An investor's carry no line count but their own. */
export async function listClosings(env: Env, user: User) {
  if (isAdmin(user)) {
    const r = await env.DB.prepare(`SELECT c.uid, c.deal_id, c.project_id, p.name AS project_name, c.round_label, c.instrument, c.currency, c.status,
            c.deadline, c.owner_user_id, c.created_at, c.closed_at
       FROM closings c JOIN projects p ON p.id = c.project_id ORDER BY c.id DESC LIMIT 200`).all<any>();
    return (r.results || []).map((x: any) => ({ ...x, reach: 'all' as Reach }));
  }
  const owner = projectOwnerScope(user as any, 'p');
  const mine = await env.DB.prepare(
    `SELECT c.uid, c.deal_id, c.project_id, p.name AS project_name, c.round_label, c.instrument, c.currency, c.status,
            c.deadline, c.owner_user_id, c.created_at, c.closed_at
       FROM closings c JOIN projects p ON p.id = c.project_id WHERE ${owner.sql} ORDER BY c.id DESC LIMIT 200`,
  ).bind(...owner.binds).all<any>();
  const lined = await env.DB.prepare(
    `SELECT c.uid, c.deal_id, c.project_id, p.name AS project_name, c.round_label, c.instrument, c.currency, c.status,
            c.deadline, c.owner_user_id, c.created_at, c.closed_at
       FROM closings c JOIN projects p ON p.id = c.project_id
      WHERE EXISTS (SELECT 1 FROM closing_lines l WHERE l.closing_id = c.id AND l.investor_user_id = ?)
      ORDER BY c.id DESC LIMIT 200`,
  ).bind(Number(user.id)).all<any>();
  const seen = new Set<string>();
  const out: any[] = [];
  for (const x of mine.results || []) { seen.add(x.uid); out.push({ ...x, reach: 'all' }); }
  for (const x of lined.results || []) if (!seen.has(x.uid)) out.push({ ...x, reach: 'own' });
  return out;
}

/**
 * One closing as the caller may read it. `total_cents` is the round's total
 * (every line not withdrawn), which every reader sees; `lines` are every line
 * for an admin or the founder, and only the caller's own for anyone else.
 */
export async function readClosing(env: Env, user: User, closingUid: string) {
  const { closing, reach } = await readable(env, user, closingUid);
  // An investor's own lines only: `investor_user_id` matched to the caller, or every line (-1 matches none).
  const lines = await env.DB.prepare(
    `SELECT l.id, l.uid, l.commitment_id, l.prospect_id, l.investor_user_id, l.route, l.amount_cents, l.currency, l.envelope_id,
            l.safe_issuance_uid, l.vehicle_ref, l.status, l.created_at, l.updated_at,
            COALESCE(u.name, rp.name) AS investor_name
       FROM closing_lines l
       LEFT JOIN users u ON u.id = l.investor_user_id
       LEFT JOIN raise_prospects rp ON rp.id = l.prospect_id
      WHERE l.closing_id = ? AND (? = 0 OR l.investor_user_id = ?)
      ORDER BY l.id`,
  ).bind(closing.id, reach === 'own' ? 1 : 0, reach === 'own' ? Number(user.id) : -1).all<any>();
  const total = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS n FROM closing_lines WHERE closing_id = ? AND status <> 'withdrawn'`,
  ).bind(closing.id).first<{ cents: number; n: number }>();
  const ids = (lines.results || []).map((l: any) => Number(l.id));
  const evidence = ids.length ? await env.DB.prepare(
    `SELECT e.uid, e.line_id, e.kind, e.side, e.source_ref, e.file_key, e.recorded_by, e.accepted_by, e.accepted_at,
            e.withdrawn_at, e.withdrawn_reason, e.created_at
       FROM closing_evidence e WHERE e.line_id IN (SELECT value FROM json_each(?)) ORDER BY e.id`,
  ).bind(JSON.stringify(ids)).all<any>() : { results: [] };
  const byLine = new Map<number, any[]>();
  for (const e of evidence.results || []) {
    const list = byLine.get(Number(e.line_id)) || [];
    const { line_id: _line, ...rest } = e;
    list.push(rest);
    byLine.set(Number(e.line_id), list);
  }
  const events = reach === 'all' ? ((await env.DB.prepare(
    `SELECT ev.event, ev.line_id, ev.actor_user_id, ev.source_ref, ev.created_at FROM closing_events ev WHERE ev.closing_id = ? ORDER BY ev.id`,
  ).bind(closing.id).all<any>()).results || []) : null;
  const all = await env.DB.prepare('SELECT status FROM closing_lines WHERE closing_id = ?').bind(closing.id).all<{ status: string }>();
  return {
    uid: closing.uid,
    deal_id: closing.deal_id,
    project_id: closing.project_id,
    round_label: closing.round_label,
    instrument: closing.instrument,
    template_slug: closing.template_slug,
    currency: closing.currency,
    status: closing.status,
    owner_user_id: closing.owner_user_id,
    deadline: closing.deadline,
    created_at: closing.created_at,
    closed_at: closing.closed_at,
    reach,
    total_cents: Number(total?.cents ?? 0),
    line_count: Number(total?.n ?? 0),
    captable: { state: captableState(closing, (all.results || []).map((r) => r.status)), decided_at: closing.captable_decided_at },
    lines: (lines.results || []).map((l: any) => {
      const { id: _id, ...rest } = l;
      return { ...rest, evidence: byLine.get(Number(l.id)) || [] };
    }),
    events,
  };
}

/**
 * The cap-table proposal: `not_ready` until every line is received or
 * withdrawn with at least one received, then `proposed` until the founder
 * accepts or dismisses it.
 */
export function captableState(closing: Pick<ClosingRow, 'captable_state'>, statuses: string[]): 'not_ready' | 'proposed' | 'accepted' | 'dismissed' {
  if (closing.captable_state) return closing.captable_state;
  const settled = statuses.length > 0 && statuses.every((s) => s === 'received' || s === 'withdrawn') && statuses.includes('received');
  return settled ? 'proposed' : 'not_ready';
}

/**
 * Who the closing waits on, for the admin desk: `admin` to add lines, choose
 * a route, confirm receipt or close it; `investor` while a line has no
 * evidence; `founder` to decide the cap-table proposal.
 */
export function nextActor(lines: Array<{ status: string; route: string | null }>, captable: string): { who: 'admin' | 'investor' | 'founder'; why: string } {
  const live = lines.filter((l) => l.status !== 'withdrawn');
  if (live.length === 0) return { who: 'admin', why: 'No line is open: add the commitments.' };
  if (live.some((l) => !l.route)) return { who: 'admin', why: 'A line has no capital route.' };
  if (live.some((l) => l.status === 'sent')) return { who: 'admin', why: 'A line was sent and waits for the receiving side’s evidence.' };
  if (live.some((l) => l.status === 'open')) return { who: 'investor', why: 'A line has no evidence that money was sent.' };
  if (captable === 'proposed') return { who: 'founder', why: 'The cap-table proposal waits for the founder.' };
  return { who: 'admin', why: 'Every line is settled: the closing can be closed.' };
}

/** The admin desk: every open closing with its lines waiting, next actor and owner. */
export async function adminDesk(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.uid, c.deal_id, c.project_id, p.name AS project_name, c.round_label, c.currency, c.deadline,
            c.owner_user_id, o.name AS owner_name, c.captable_state, c.created_at
       FROM closings c JOIN projects p ON p.id = c.project_id LEFT JOIN users o ON o.id = c.owner_user_id
      WHERE c.status = 'open' ORDER BY (c.deadline IS NULL), c.deadline, c.id`,
  ).all<any>();
  const out = [];
  for (const c of rows.results || []) {
    const lines = ((await env.DB.prepare('SELECT status, route, amount_cents FROM closing_lines WHERE closing_id = ?').bind(c.id).all<any>()).results || []);
    const captable = captableState(c, lines.map((l: any) => l.status));
    const live = lines.filter((l: any) => l.status !== 'withdrawn');
    const { id: _id, captable_state: _cs, ...rest } = c;
    out.push({
      ...rest,
      lines: live.length,
      lines_waiting: live.filter((l: any) => l.status !== 'received').length,
      total_cents: live.reduce((s: number, l: any) => s + Number(l.amount_cents), 0),
      received_cents: live.filter((l: any) => l.status === 'received').reduce((s: number, l: any) => s + Number(l.amount_cents), 0),
      captable,
      next_actor: nextActor(lines, captable),
      owner_name: c.owner_name ?? null,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── writes (the route has checked who may act)

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Open a closing for a deal, with one line per pending or confirmed
 * commitment that holds an amount in cents. At most one open closing per deal.
 */
export async function openClosing(env: Env, user: User, body: any) {
  const dealId = Number(body?.deal_id);
  if (!Number.isInteger(dealId) || dealId <= 0) throw new ClosingRefusal(400, 'deal_required', 'Say which deal this closing is for.');
  const deal = await env.DB.prepare('SELECT id, project_id, instrument, closing_deadline, currency FROM deals WHERE id = ?').bind(dealId).first<any>();
  if (!deal) throw new ClosingRefusal(404, 'deal_not_found', 'No deal here.');
  // A deadline given must be a date; the deal's own is taken only when it is one, never guessed from other text.
  const given = body?.deadline == null || body.deadline === '' ? null : String(body.deadline);
  if (given !== null && !/^\d{4}-\d{2}-\d{2}/.test(given)) throw new ClosingRefusal(400, 'deadline_invalid', 'The deadline is a date, written YYYY-MM-DD.');
  const fallback = typeof deal.closing_deadline === 'string' && /^\d{4}-\d{2}-\d{2}/.test(deal.closing_deadline) ? deal.closing_deadline : null;
  const deadline = given ?? fallback;
  const ownerId = body?.owner_user_id == null ? Number(user.id) : Number(body.owner_user_id);
  if (!Number.isInteger(ownerId) || ownerId <= 0) throw new ClosingRefusal(400, 'owner_invalid', 'The owner is a user id.');
  const open = await env.DB.prepare("SELECT uid FROM closings WHERE deal_id = ? AND status = 'open'").bind(dealId).first<any>();
  if (open) throw new ClosingRefusal(409, 'closing_open', 'This deal already has an open closing.');
  const closingUid = uid();
  const stamp = now();
  const currency = /^[A-Z]{3}$/.test(String(deal.currency ?? '')) ? deal.currency : 'USD';
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO closings (uid, deal_id, project_id, round_label, instrument, template_slug, currency, owner_user_id, deadline, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM closings WHERE deal_id = ? AND status = 'open')`,
    ).bind(closingUid, dealId, deal.project_id, text(body?.round_label, 80), text(body?.instrument, 40) ?? deal.instrument ?? null,
      text(body?.template_slug, 120), currency, ownerId, deadline ? deadline.slice(0, 10) : null, Number(user.id), stamp, stamp, dealId),
    env.DB.prepare(
      `INSERT INTO closing_lines (uid, closing_id, commitment_id, investor_user_id, amount_cents, currency, created_by, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), c2.id, cm.id, cm.investor_user_id, cm.amount_cents, c2.currency, ?, ?, ?
         FROM commitments cm JOIN closings c2 ON c2.uid = ?
        WHERE cm.deal_id = ? AND cm.status IN ('pending', 'confirmed') AND cm.amount_cents > 0
        ORDER BY cm.id`,
    ).bind(Number(user.id), stamp, stamp, closingUid, dealId),
    env.DB.prepare(
      `INSERT INTO closing_events (closing_id, line_id, actor_user_id, event, source_ref, created_at)
       SELECT id, NULL, ?, 'opened', ?, ? FROM closings WHERE uid = ?`,
    ).bind(Number(user.id), `deal:${dealId}`, stamp, closingUid),
  ]);
  if (!Number((results[0] as any)?.meta?.changes ?? 0)) throw new ClosingRefusal(409, 'closing_open', 'This deal already has an open closing.');
  return closingUid;
}

/** Add a line for a commitment on the closing's deal, or a Raise prospect of its venture with an amount in cents. */
export async function addLine(env: Env, user: User, closingUid: string, body: any) {
  const closing = await openForAdmin(env, closingUid);
  let source: { commitment_id: number | null; prospect_id: number | null; investor: number | null; cents: number };
  if (body?.commitment_uid) {
    const c = await env.DB.prepare(
      `SELECT id, investor_user_id, amount_cents FROM commitments WHERE uid = ? AND deal_id = ? AND status IN ('pending', 'confirmed')`,
    ).bind(String(body.commitment_uid), closing.deal_id).first<any>();
    if (!c) throw new ClosingRefusal(404, 'commitment_not_found', 'No live commitment on this deal has that id.');
    if (!(Number(c.amount_cents) > 0)) throw new ClosingRefusal(409, 'amount_not_recorded', 'This commitment has no amount recorded in cents, so it cannot be a line.');
    source = { commitment_id: Number(c.id), prospect_id: null, investor: c.investor_user_id ?? null, cents: Number(c.amount_cents) };
  } else if (body?.prospect_id != null) {
    const pr = await env.DB.prepare('SELECT id, amount_cents FROM raise_prospects WHERE id = ? AND project_id = ?')
      .bind(Number(body.prospect_id), closing.project_id).first<any>();
    if (!pr) throw new ClosingRefusal(404, 'prospect_not_found', 'No Raise prospect of this venture has that id.');
    if (!(Number(pr.amount_cents) > 0)) throw new ClosingRefusal(409, 'amount_not_recorded', 'This prospect has no amount recorded in cents, so it cannot be a line.');
    source = { commitment_id: null, prospect_id: Number(pr.id), investor: null, cents: Number(pr.amount_cents) };
  } else {
    throw new ClosingRefusal(400, 'line_source_required', 'A line is a commitment on this deal or a Raise prospect of this venture.');
  }
  const lineUid = uid();
  const stamp = now();
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO closing_lines (uid, closing_id, commitment_id, prospect_id, investor_user_id, amount_cents, currency, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(lineUid, closing.id, source.commitment_id, source.prospect_id, source.investor, source.cents, closing.currency, Number(user.id), stamp, stamp),
    env.DB.prepare(
      `INSERT INTO closing_events (closing_id, line_id, actor_user_id, event, source_ref, created_at)
       SELECT closing_id, id, ?, 'line_added', NULL, ? FROM closing_lines WHERE uid = ?`,
    ).bind(Number(user.id), stamp, lineUid),
  ]);
  if (!Number((ins as any)?.meta?.changes ?? 0)) throw new ClosingRefusal(409, 'line_exists', 'That commitment or prospect already has a line on this closing.');
  return lineUid;
}

async function lineOf(env: Env, closing: ClosingRow, lineUid: string) {
  const line = await env.DB.prepare('SELECT id, uid, status FROM closing_lines WHERE uid = ? AND closing_id = ?').bind(String(lineUid), closing.id).first<any>();
  if (!line) throw new ClosingRefusal(404, 'line_not_found', 'No line on this closing has that id.');
  return line;
}

/** Choose a line's capital route, with the vehicle it goes through. */
export async function setRoute(env: Env, user: User, closingUid: string, lineUid: string, body: any) {
  const closing = await openForAdmin(env, closingUid);
  const line = await lineOf(env, closing, lineUid);
  const route = String(body?.route ?? '');
  if (!(ROUTES as readonly string[]).includes(route)) throw new ClosingRefusal(400, 'route_invalid', `The route is one of: ${ROUTES.join(', ')}.`);
  if (line.status === 'withdrawn') throw new ClosingRefusal(409, 'line_withdrawn', 'This line is withdrawn, so its route does not change.');
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE closing_lines SET route = ?, vehicle_ref = ?, updated_at = ? WHERE id = ?')
      .bind(route, text(body?.vehicle_ref, 120), stamp, line.id),
    event(env, closing.id, line.id, Number(user.id), 'route_set', `route:${route}`),
  ]);
}

/** Withdraw a line: the commitment or prospect no longer closes in this round. */
export async function withdrawLine(env: Env, user: User, closingUid: string, lineUid: string) {
  const closing = await openForAdmin(env, closingUid);
  const line = await lineOf(env, closing, lineUid);
  if (line.status === 'withdrawn') throw new ClosingRefusal(409, 'line_withdrawn', 'This line is already withdrawn.');
  await env.DB.batch([
    env.DB.prepare("UPDATE closing_lines SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(now(), line.id),
    event(env, closing.id, line.id, Number(user.id), 'line_withdrawn'),
  ]);
}

/**
 * Record evidence that money moved for a line. Its side comes from its kind,
 * never from the body. A phone-verified record names a transfer recorded on
 * this closing's deal. The line's status is recomputed in the same batch.
 */
export async function addEvidence(env: Env, user: User, closingUid: string, lineUid: string, body: any) {
  const closing = await openForAdmin(env, closingUid);
  const line = await lineOf(env, closing, lineUid);
  if (line.status === 'withdrawn') throw new ClosingRefusal(409, 'line_withdrawn', 'This line is withdrawn, so it takes no evidence.');
  const kind = String(body?.kind ?? '') as EvidenceKind;
  if (!(kind in EVIDENCE_SIDE)) throw new ClosingRefusal(400, 'kind_invalid', `The kind is one of: ${Object.keys(EVIDENCE_SIDE).join(', ')}.`);
  const sourceRef = String(body?.source_ref ?? '').trim();
  if (!SOURCE_REF[kind].test(sourceRef)) {
    throw new ClosingRefusal(400, 'source_ref_invalid', 'The source names the stored record by its id: mercury:<id>, deal_transfer:<uid> or file:<key>.');
  }
  const fileKey = kind === 'bank_confirmation' ? sourceRef.slice('file:'.length) : null;
  if (kind === 'phone_verified_record') {
    const t = await env.DB.prepare('SELECT 1 AS yes FROM deal_transfers WHERE uid = ? AND deal_id = ? AND phone_verified = 1')
      .bind(sourceRef.slice('deal_transfer:'.length), closing.deal_id).first();
    if (!t) throw new ClosingRefusal(404, 'transfer_not_found', 'No phone-verified transfer on this deal has that id.');
  }
  const evidenceUid = uid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO closing_evidence (uid, line_id, kind, side, source_ref, file_key, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(evidenceUid, line.id, kind, EVIDENCE_SIDE[kind], sourceRef, fileKey, Number(user.id), now()),
    recompute(env, line.id),
    event(env, closing.id, line.id, Number(user.id), 'evidence_added', `closing_evidence:${evidenceUid}`),
  ]);
  return evidenceUid;
}

/** Withdraw a piece of evidence with a reason; the line's status is recomputed. */
export async function withdrawEvidence(env: Env, user: User, closingUid: string, evidenceUid: string, body: any) {
  const closing = await openForAdmin(env, closingUid);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < WITHDRAW_REASON_MIN || reason.length > WITHDRAW_REASON_MAX) {
    throw new ClosingRefusal(400, 'reason_invalid', `Give a reason of ${WITHDRAW_REASON_MIN} to ${WITHDRAW_REASON_MAX} characters.`);
  }
  const ev = await env.DB.prepare(
    `SELECT e.id, e.line_id, e.withdrawn_at FROM closing_evidence e JOIN closing_lines l ON l.id = e.line_id
      WHERE e.uid = ? AND l.closing_id = ?`,
  ).bind(String(evidenceUid), closing.id).first<any>();
  if (!ev) throw new ClosingRefusal(404, 'evidence_not_found', 'No evidence on this closing has that id.');
  if (ev.withdrawn_at) throw new ClosingRefusal(409, 'evidence_withdrawn', 'This evidence is already withdrawn.');
  await env.DB.batch([
    env.DB.prepare('UPDATE closing_evidence SET withdrawn_by = ?, withdrawn_at = ?, withdrawn_reason = ? WHERE id = ? AND withdrawn_at IS NULL')
      .bind(Number(user.id), now(), reason, ev.id),
    recompute(env, Number(ev.line_id)),
    event(env, closing.id, Number(ev.line_id), Number(user.id), 'evidence_withdrawn', `closing_evidence:${evidenceUid}`),
  ]);
}

/**
 * The founder accepts or dismisses the cap-table proposal. It exists only
 * once every line is received or withdrawn, with one received. Accepting
 * records the decision; the holder is written by the cap table's own path.
 */
export async function decideCaptable(env: Env, user: User, closingUid: string, decision: 'accepted' | 'dismissed') {
  const closing = await closingByUid(env, closingUid);
  if (!closing) throw missing();
  const owner = projectOwnerScope(user as any, 'p');
  const founder = await env.DB.prepare(`SELECT 1 AS yes FROM projects p WHERE p.id = ? AND ${owner.sql}`)
    .bind(closing.project_id, ...owner.binds).first();
  if (!founder || isAdmin(user)) {
    if (await reachOf(env, user, closing)) throw new ClosingRefusal(403, 'founder_decides', 'The founder decides the cap-table change.');
    throw missing();
  }
  if (closing.status !== 'open') throw new ClosingRefusal(409, 'closing_not_open', 'This closing is closed, so nothing on it changes.');
  const statuses = ((await env.DB.prepare('SELECT status FROM closing_lines WHERE closing_id = ?').bind(closing.id).all<any>()).results || []).map((r: any) => r.status);
  const state = captableState(closing, statuses);
  if (state !== 'proposed') {
    throw new ClosingRefusal(409, state === 'not_ready' ? 'captable_not_ready' : 'captable_decided',
      state === 'not_ready' ? 'The cap-table proposal waits until every line is received or withdrawn.' : 'The cap-table proposal is already decided.');
  }
  const stamp = now();
  const [upd] = await env.DB.batch([
    env.DB.prepare(`UPDATE closings SET captable_state = ?, captable_decided_by = ?, captable_decided_at = ?, updated_at = ?
                     WHERE id = ? AND captable_state IS NULL AND status = 'open'`)
      .bind(decision, Number(user.id), stamp, stamp, closing.id),
    env.DB.prepare(
      `INSERT INTO closing_events (closing_id, line_id, actor_user_id, event, source_ref, created_at)
       SELECT id, NULL, ?, ?, NULL, ? FROM closings WHERE id = ? AND captable_decided_at = ? AND captable_decided_by = ?`,
    ).bind(Number(user.id), decision === 'accepted' ? 'captable_accepted' : 'captable_dismissed', stamp, closing.id, stamp, Number(user.id)),
  ]);
  if (!Number((upd as any)?.meta?.changes ?? 0)) throw new ClosingRefusal(409, 'captable_decided', 'The cap-table proposal is already decided.');
}

/** Close it: every line received or withdrawn, one received, and the cap-table proposal decided. */
export async function completeClosing(env: Env, user: User, closingUid: string) {
  const closing = await openForAdmin(env, closingUid);
  const statuses = ((await env.DB.prepare('SELECT status FROM closing_lines WHERE closing_id = ?').bind(closing.id).all<any>()).results || []).map((r: any) => r.status);
  const state = captableState(closing, statuses);
  if (state === 'not_ready') throw new ClosingRefusal(409, 'lines_not_settled', 'Every line must be received or withdrawn, with one received, before the closing closes.');
  if (state === 'proposed') throw new ClosingRefusal(409, 'captable_undecided', 'The founder has not decided the cap-table proposal yet.');
  const stamp = now();
  const [upd] = await env.DB.batch([
    env.DB.prepare("UPDATE closings SET status = 'closed', closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'")
      .bind(Number(user.id), stamp, stamp, closing.id),
    env.DB.prepare(
      `INSERT INTO closing_events (closing_id, line_id, actor_user_id, event, source_ref, created_at)
       SELECT id, NULL, ?, 'closed', NULL, ? FROM closings WHERE id = ? AND closed_at = ? AND closed_by = ?`,
    ).bind(Number(user.id), stamp, closing.id, stamp, Number(user.id)),
  ]);
  if (!Number((upd as any)?.meta?.changes ?? 0)) throw new ClosingRefusal(409, 'closing_not_open', 'This closing is closed, so nothing on it changes.');
}
