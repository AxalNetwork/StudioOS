/**
 * D1238 (#3251, part 2 of #2423) — an investor firm's own deal flow
 * (migration 618): its stage per deal, its owner, how it entered, its pass,
 * its events, and the New for you inbox of deals not yet in it.
 *
 * WHOSE FLOW. A firm's (`c:<company_id>`, every seat linked to the company)
 * when the investor has one selected, else the investor's own
 * (`u:<user_id>`). Another firm's rows are never read or written.
 *
 * WHAT IT NEVER DOES:
 *   · write `deals.status`: an investor's pass is theirs alone, and the round
 *     stays open for every other investor;
 *   · grant a deal read: a row's `can_open` is DEAL's rule (invited or
 *     committed, `deals.ts` canReadDeal), and nothing else opens a deal;
 *   · move to Closing without a commitment.
 */
import type { Env, User } from '../types';
import { PASS_REASON_KEYS } from './dealPassTaxonomy';

export const STAGES = ['sourcing', 'screening', 'diligence', 'commit', 'closing', 'passed'] as const;
export type Stage = typeof STAGES[number];
export const VIA = ['invited', 'requested', 'committed', 'added', 'thesis', 'introduction', 'syndicate', 'watchlist'] as const;
export type Via = typeof VIA[number];
export const PASS_REASONS = PASS_REASON_KEYS as readonly string[];
export const NOTE_MAX = 2000;
export const DISMISS_MAX = 500;
/** Thesis matches are part 3's (D1239, migration 619). */
export const THESIS_REASON = 'Matches to your thesis are not recorded yet: they come with your thesis fit.';

export class FlowError extends Error {
  status: 400 | 403 | 404 | 409 | 422 | 503;
  code: string;
  sentence: string;
  constructor(code: string, status: FlowError['status'], sentence: string) {
    super(code); this.code = code; this.status = status; this.sentence = sentence;
  }
}

export type Scope = { key: string; companyId: number | null; user: User };
export function scopeFor(user: User, companyId: number | null): Scope {
  return { key: companyId != null ? 'c:' + companyId : 'u:' + user.id, companyId, user };
}

const DAY = 86_400_000;
const utc = (s: unknown) => {
  if (!s) return null;
  const raw = String(s);
  const t = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : null;
};
export function daysIn(since: unknown, nowMs: number): number | null {
  const t = utc(since);
  return t == null ? null : Math.max(0, Math.floor((nowMs - t) / DAY));
}
const validDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
};
const textOrNull = (v: unknown, max: number, code: string) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) throw new FlowError(code, 400, `Keep it to ${max.toLocaleString('en-US')} characters.`);
  return v.trim() || null;
};

// The relationship that opens a deal: the same two EXISTS as investorHasDealRelationship.
const CAN_OPEN = `(EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id AND i.investor_user_id = ?)
   OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id AND k.investor_user_id = ?))`;

/** A deal an investor can add: it exists and its venture is not deleted. */
async function liveDeal(env: Env, dealId: number) {
  const row = await env.DB.prepare('SELECT d.id FROM deals d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND p.deleted_at IS NULL')
    .bind(dealId).first<{ id: number }>();
  if (!row) throw new FlowError('deal_not_found', 404, 'No deal has that number.');
}

/** Closing follows a commitment: this investor's, or a seat's in the same firm, not withdrawn. */
export async function hasCommitment(env: Env, scope: Scope, dealId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM commitments WHERE deal_id = ? AND status <> 'withdrawn' AND (investor_user_id = ? OR (? IS NOT NULL AND company_id = ?)) LIMIT 1",
  ).bind(dealId, scope.user.id, scope.companyId, scope.companyId).first();
  return !!row;
}

/** An owner is this investor, or an active investor seat linked to the same firm. */
async function validOwner(env: Env, scope: Scope, ownerId: unknown): Promise<number> {
  if (ownerId == null) return scope.user.id;
  if (!Number.isSafeInteger(ownerId) || Number(ownerId) <= 0) throw new FlowError('invalid_owner', 400, 'Choose someone from your firm.');
  if (ownerId === scope.user.id) return scope.user.id;
  if (scope.companyId == null) throw new FlowError('invalid_owner', 400, 'Only you can own a deal in your own flow.');
  const seat = await env.DB.prepare(
    "SELECT 1 AS ok FROM user_company_links l JOIN users u ON u.id = l.user_id WHERE l.company_id = ? AND l.user_id = ? AND u.role = 'investor' AND u.is_active = 1",
  ).bind(scope.companyId, ownerId).first();
  if (!seat) throw new FlowError('invalid_owner', 400, 'Choose someone from your firm.');
  return Number(ownerId);
}

const ROW_SELECT = `SELECT f.uid, f.deal_id, f.stage, f.owner_user_id, o.name AS owner_name, f.entered_via, f.entered_at,
    f.stage_changed_at, f.pass_reason, f.passed_at, f.revisit, f.revisit_at, f.note,
    d.status AS round_status, d.amount, d.target_raise, p.name AS project_name, p.sector AS sector,
    ` + CAN_OPEN + ` AS can_open
  FROM deal_flow_entries f JOIN deals d ON d.id = f.deal_id JOIN projects p ON p.id = d.project_id LEFT JOIN users o ON o.id = f.owner_user_id`;

function shape(r: any, nowMs: number) {
  const ask = r.target_raise ?? r.amount;
  return {
    uid: r.uid, deal_id: Number(r.deal_id), venture: r.project_name ?? null, sector: r.sector ?? null,
    round_status: r.round_status, stage: r.stage,
    owner: r.owner_user_id == null ? null : { user_id: Number(r.owner_user_id), name: r.owner_name ?? null },
    entered_via: r.entered_via, entered_at: r.entered_at, stage_changed_at: r.stage_changed_at,
    days_in_stage: daysIn(r.stage_changed_at, nowMs),
    ask: ask == null || !Number.isFinite(Number(ask)) ? null : Number(ask),
    pass: r.stage === 'passed' ? { reason: r.pass_reason, passed_at: r.passed_at, revisit: r.revisit ?? null, revisit_at: r.revisit_at ?? null } : null,
    note: r.note ?? null,
    // A door only where DEAL's rule holds; a flow row never opens a deal by itself.
    can_open: Number(r.can_open) === 1,
  };
}

/** The flow, every stage, newest move first. */
export async function readFlow(env: Env, scope: Scope, nowMs = Date.now()) {
  const rows = await env.DB.prepare(ROW_SELECT + ' WHERE f.scope_key = ? AND p.deleted_at IS NULL ORDER BY f.stage_changed_at DESC, f.id DESC')
    .bind(scope.user.id, scope.user.id, scope.key).all<any>();
  const items = (rows.results || []).map((r) => shape(r, nowMs));
  const by_stage = Object.fromEntries(STAGES.map((s) => [s, items.filter((i) => i.stage === s).length]));
  return { scope: scope.companyId != null ? 'firm' : 'you', items, by_stage };
}

async function readOne(env: Env, scope: Scope, dealId: number, nowMs = Date.now()) {
  const r = await env.DB.prepare(ROW_SELECT + ' WHERE f.scope_key = ? AND f.deal_id = ?').bind(scope.user.id, scope.user.id, scope.key, dealId).first<any>();
  if (!r) throw new FlowError('not_in_flow', 404, 'This deal is not in your deal flow.');
  return shape(r, nowMs);
}

async function entryOf(env: Env, scope: Scope, dealId: number) {
  return env.DB.prepare('SELECT id, stage FROM deal_flow_entries WHERE scope_key = ? AND deal_id = ?').bind(scope.key, dealId)
    .first<{ id: number; stage: Stage }>();
}

const event = (env: Env, scope: Scope, dealId: number, kind: string, from: string | null, to: string | null, reason: string | null = null) =>
  env.DB.prepare(`INSERT INTO deal_flow_events (entry_id, scope_key, deal_id, actor_user_id, kind, from_stage, to_stage, pass_reason)
    SELECT id, ?, ?, ?, ?, ?, ?, ? FROM deal_flow_entries WHERE scope_key = ? AND deal_id = ?`)
    .bind(scope.key, dealId, scope.user.id, kind, from, to, reason, scope.key, dealId);

/** Adds a deal. `via_key` is a New for you item; its source says how it entered. */
export async function addToFlow(env: Env, scope: Scope, input: Record<string, unknown>) {
  const dealId = Number(input.deal_id);
  if (!Number.isSafeInteger(dealId) || dealId <= 0) throw new FlowError('invalid_deal', 400, 'Choose a deal.');
  await liveDeal(env, dealId);
  const stage = (input.stage ?? 'sourcing') as Stage;
  if (!STAGES.includes(stage)) throw new FlowError('invalid_stage', 400, 'Choose one of the stages.');
  if (stage === 'passed') throw new FlowError('use_pass', 400, 'Pass with its reason instead.');
  if (stage === 'closing' && !(await hasCommitment(env, scope, dealId))) throw new FlowError('closing_needs_commitment', 409, 'Closing follows a commitment. Commit on the deal page first.');
  let via: Via = 'added';
  if (input.via_key != null) {
    const item = (await inboxItems(env, scope)).items.find((i) => i.key === input.via_key && i.deal_id === dealId);
    if (!item) throw new FlowError('inbox_item_not_found', 404, 'That item is no longer new for you.');
    via = item.entered_via;
  }
  const owner = await validOwner(env, scope, input.owner_user_id);
  if (await entryOf(env, scope, dealId)) throw new FlowError('already_in_flow', 409, 'This deal is already in your deal flow.');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO deal_flow_entries (uid, scope_key, company_id, investor_user_id, deal_id, stage, owner_user_id, entered_via)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), scope.key, scope.companyId, scope.user.id, dealId, stage, owner, via),
    event(env, scope, dealId, 'entered', null, stage),
  ]);
  return readOne(env, scope, dealId);
}

/** Moves a stage, changes the owner, or writes the note. A pass goes through `passDeal`. */
export async function updateFlow(env: Env, scope: Scope, dealId: number, input: Record<string, unknown>) {
  const entry = await entryOf(env, scope, dealId);
  if (!entry) throw new FlowError('not_in_flow', 404, 'This deal is not in your deal flow.');
  const statements: D1PreparedStatement[] = [];
  if (input.stage !== undefined && input.stage !== entry.stage) {
    const stage = input.stage as Stage;
    if (!STAGES.includes(stage)) throw new FlowError('invalid_stage', 400, 'Choose one of the stages.');
    if (stage === 'passed') throw new FlowError('use_pass', 400, 'Pass with its reason instead.');
    if (stage === 'closing' && !(await hasCommitment(env, scope, dealId))) throw new FlowError('closing_needs_commitment', 409, 'Closing follows a commitment. Commit on the deal page first.');
    // Leaving Passed keeps the pass in the events and clears it from the row.
    statements.push(env.DB.prepare(`UPDATE deal_flow_entries SET stage = ?, stage_changed_at = datetime('now'), updated_at = datetime('now'),
        pass_reason = NULL, passed_at = NULL, revisit = NULL, revisit_at = NULL WHERE scope_key = ? AND deal_id = ? AND stage = ?`)
      .bind(stage, scope.key, dealId, entry.stage), event(env, scope, dealId, 'moved', entry.stage, stage));
  }
  if (input.owner_user_id !== undefined) {
    const owner = await validOwner(env, scope, input.owner_user_id);
    statements.push(env.DB.prepare("UPDATE deal_flow_entries SET owner_user_id = ?, updated_at = datetime('now') WHERE scope_key = ? AND deal_id = ?").bind(owner, scope.key, dealId),
      event(env, scope, dealId, 'owner', null, null));
  }
  if (input.note !== undefined) {
    const note = textOrNull(input.note, NOTE_MAX, 'invalid_note');
    statements.push(env.DB.prepare("UPDATE deal_flow_entries SET note = ?, updated_at = datetime('now') WHERE scope_key = ? AND deal_id = ?").bind(note, scope.key, dealId),
      event(env, scope, dealId, 'note', null, null));
  }
  if (!statements.length) return readOne(env, scope, dealId);
  const result = await env.DB.batch(statements);
  if (input.stage !== undefined && input.stage !== entry.stage && Number(result[0]?.meta?.changes) !== 1) throw new FlowError('flow_changed', 409, 'This deal moved meanwhile. Reload and try again.');
  return readOne(env, scope, dealId);
}

/**
 * Passes, with one of the five reasons and when it comes back. It never
 * touches `deals.status`: the round stays open for every other investor. A
 * deal not yet in the flow (a New for you row) is added as passed.
 */
export async function passDeal(env: Env, scope: Scope, dealId: number, input: Record<string, unknown>) {
  if (!PASS_REASONS.includes(String(input.reason))) throw new FlowError('reason_required', 400, 'Choose why you are passing.');
  const revisit = input.revisit ?? 'next_round';
  if (revisit !== 'next_round' && revisit !== 'date') throw new FlowError('invalid_revisit', 400, 'Choose when it comes back.');
  const today = new Date().toISOString().slice(0, 10);
  if (revisit === 'date' && (!validDate(input.revisit_at) || input.revisit_at <= today)) throw new FlowError('invalid_revisit', 400, 'Choose a date after today.');
  const revisitAt = revisit === 'date' ? String(input.revisit_at) : null;
  const note = input.note === undefined ? undefined : textOrNull(input.note, NOTE_MAX, 'invalid_note');
  const reason = String(input.reason);
  let entry = await entryOf(env, scope, dealId);
  if (!entry) {
    await liveDeal(env, dealId);
    let via: Via = 'added';
    if (input.via_key != null) {
      const item = (await inboxItems(env, scope)).items.find((i) => i.key === input.via_key && i.deal_id === dealId);
      if (!item) throw new FlowError('inbox_item_not_found', 404, 'That item is no longer new for you.');
      via = item.entered_via;
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO deal_flow_entries (uid, scope_key, company_id, investor_user_id, deal_id, stage, owner_user_id, entered_via, pass_reason, passed_at, revisit, revisit_at, note)
        VALUES (?, ?, ?, ?, ?, 'passed', ?, ?, ?, datetime('now'), ?, ?, ?)`)
        .bind(crypto.randomUUID(), scope.key, scope.companyId, scope.user.id, dealId, scope.user.id, via, reason, revisit, revisitAt, note ?? null),
      event(env, scope, dealId, 'entered', null, 'passed'),
      event(env, scope, dealId, 'passed', null, 'passed', reason),
    ]);
    return readOne(env, scope, dealId);
  }
  if (entry.stage === 'passed') throw new FlowError('already_passed', 409, 'You have already passed on this deal.');
  const statements = [
    env.DB.prepare(`UPDATE deal_flow_entries SET stage = 'passed', stage_changed_at = datetime('now'), updated_at = datetime('now'), pass_reason = ?, passed_at = datetime('now'),
        revisit = ?, revisit_at = ?` + (note === undefined ? '' : ', note = ?') + ' WHERE scope_key = ? AND deal_id = ? AND stage = ?')
      .bind(...[reason, revisit, revisitAt, ...(note === undefined ? [] : [note]), scope.key, dealId, entry.stage]),
    event(env, scope, dealId, 'passed', entry.stage, 'passed', reason),
  ];
  const result = await env.DB.batch(statements);
  if (Number(result[0]?.meta?.changes) !== 1) throw new FlowError('flow_changed', 409, 'This deal moved meanwhile. Reload and try again.');
  return readOne(env, scope, dealId);
}

/** One row's events, oldest first. */
export async function flowEvents(env: Env, scope: Scope, dealId: number) {
  if (!(await entryOf(env, scope, dealId))) throw new FlowError('not_in_flow', 404, 'This deal is not in your deal flow.');
  const rows = await env.DB.prepare(`SELECT e.kind, e.from_stage, e.to_stage, e.pass_reason, e.created_at, e.actor_user_id, u.name AS actor_name
      FROM deal_flow_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.scope_key = ? AND e.deal_id = ? ORDER BY e.id`)
    .bind(scope.key, dealId).all<any>();
  return { items: (rows.results || []).map((r) => ({ kind: r.kind, from: r.from_stage ?? null, to: r.to_stage ?? null, reason: r.pass_reason ?? null,
    at: r.created_at, by: { user_id: Number(r.actor_user_id), name: r.actor_name ?? null } })) };
}

// ---------------------------------------------------------------- New for you

type Item = { key: string; source: string; entered_via: Via; deal_id: number; venture: string | null; sector: string | null; round_status: string; at: string | null; message: string | null; can_open: boolean };

/**
 * Each source of a deal not yet in this flow, as one query that answers
 * alone. `company_id` narrows the investor's own rows to the firm selected, or
 * leaves them whole with none (deals.ts' reading).
 */
const FIRM = '(? IS NULL OR x.company_id = ? OR x.company_id IS NULL)';
const SOURCES: Record<string, { via: Via; sql: string; binds: (s: Scope) => unknown[] }> = {
  invitation: { binds: (s) => [s.user.id, s.companyId, s.companyId], via: 'invited', sql: `SELECT 'invitation:' || x.id AS item_key, x.deal_id, x.created_at AS at, x.message AS message
      FROM deal_invitations x WHERE x.investor_user_id = ? AND x.status = 'invited' AND ` + FIRM },
  room: { binds: (s) => [s.user.id, s.companyId, s.companyId], via: 'requested', sql: `SELECT 'room:' || x.deal_id AS item_key, x.deal_id, x.joined_at AS at, NULL AS message
      FROM investor_dealroom_members x WHERE x.investor_user_id = ? AND ` + FIRM + `
       AND NOT EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = x.deal_id AND i.investor_user_id = x.investor_user_id)` },
  commitment: { binds: (s) => [s.user.id, s.companyId, s.companyId], via: 'committed', sql: `SELECT 'commitment:' || x.id AS item_key, x.deal_id, x.created_at AS at, NULL AS message
      FROM commitments x WHERE x.investor_user_id = ? AND x.status <> 'withdrawn' AND ` + FIRM },
  introduction: { binds: (s) => [s.user.id], via: 'introduction', sql: `SELECT 'introduction:' || x.id || ':' || d.id AS item_key, d.id AS deal_id, x.responded_at AS at, NULL AS message
      FROM intro_propositions x JOIN users t ON t.id = x.target_user_id JOIN projects tp ON tp.founder_id = t.founder_id JOIN deals d ON d.project_id = tp.id
      WHERE x.user_id = ? AND x.status = 'accepted' AND t.founder_id IS NOT NULL` },
  syndicate: { binds: () => [], via: 'syndicate', sql: `SELECT 'syndicate:' || x.id AS item_key, x.deal_id, x.created_at AS at, NULL AS message
      FROM syndicates x WHERE x.status = 'open' AND x.deal_id IS NOT NULL` },
  watchlist: { binds: (s) => [s.user.id], via: 'watchlist', sql: `SELECT 'watchlist:' || x.id AS item_key, x.converted_deal_id AS deal_id, x.converted_at AS at, NULL AS message
      FROM watchlist_items x WHERE x.owner_user_id = ? AND x.status = 'converted' AND x.converted_deal_id IS NOT NULL` },
};
export const SOURCE_KEYS = Object.keys(SOURCES);
const KEY = /^(invitation|room|commitment|introduction|syndicate|watchlist):[0-9]+(?::[0-9]+)?$/;

export async function inboxItems(env: Env, scope: Scope) {
  const items: Item[] = [];
  const sources: Record<string, unknown> = {};
  const inFlow = new Set(((await env.DB.prepare('SELECT deal_id FROM deal_flow_entries WHERE scope_key = ?').bind(scope.key).all<{ deal_id: number }>()).results || []).map((r) => Number(r.deal_id)));
  const dismissed = new Set(((await env.DB.prepare('SELECT item_key FROM deal_flow_dismissals WHERE scope_key = ?').bind(scope.key).all<{ item_key: string }>()).results || []).map((r) => r.item_key));
  for (const [name, spec] of Object.entries(SOURCES)) {
    try {
      const binds = spec.binds(scope);
      const q = `SELECT s.item_key, s.deal_id, s.at, s.message, d.status AS round_status, p.name AS venture, p.sector AS sector, ` + CAN_OPEN + ` AS can_open
        FROM (` + spec.sql + `) s JOIN deals d ON d.id = s.deal_id JOIN projects p ON p.id = d.project_id WHERE p.deleted_at IS NULL`;
      const rows = await env.DB.prepare(q).bind(scope.user.id, scope.user.id, ...binds).all<any>();
      sources[name] = { available: true };
      for (const r of rows.results || []) {
        if (inFlow.has(Number(r.deal_id)) || dismissed.has(String(r.item_key))) continue;
        items.push({ key: String(r.item_key), source: name, entered_via: spec.via, deal_id: Number(r.deal_id), venture: r.venture ?? null, sector: r.sector ?? null,
          round_status: r.round_status, at: r.at ?? null, message: r.message ?? null, can_open: Number(r.can_open) === 1 });
      }
    } catch (e) {
      console.error('[deal-flow] inbox source unreadable', name);
      sources[name] = { available: false, unreadable: true, reason: 'This source could not be read. That is not the same as none.' };
    }
  }
  sources.thesis = { recorded: false, reason: THESIS_REASON };
  items.sort((a, b) => (utc(b.at) ?? 0) - (utc(a.at) ?? 0) || a.key.localeCompare(b.key));
  return { items, sources };
}

export async function dismissItem(env: Env, scope: Scope, key: string, input: Record<string, unknown>) {
  if (!KEY.test(key)) throw new FlowError('inbox_item_not_found', 404, 'That item is no longer new for you.');
  const reason = textOrNull(input.reason, DISMISS_MAX, 'invalid_reason');
  if (!(await inboxItems(env, scope)).items.some((i) => i.key === key)) throw new FlowError('inbox_item_not_found', 404, 'That item is no longer new for you.');
  await env.DB.prepare('INSERT OR IGNORE INTO deal_flow_dismissals (scope_key, item_key, reason, dismissed_by) VALUES (?, ?, ?, ?)')
    .bind(scope.key, key, reason, scope.user.id).run();
  return { ok: true, key };
}
