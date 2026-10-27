/**
 * D1241 (#3254, part 5 of #2423) — Compare's Eadwyn note: a comparison of two
 * to four ventures drafted from SCORING's bands only, and saved to the
 * investor's notes only when they press Save to notes.
 *
 *   - THE MATERIAL is each venture's name and, per scope in SCORING's order,
 *     its state, band and confidence word (`stripView`, D1256): never a value.
 *     A venture whose founder has not shared the scorecard is "locked" and
 *     carries no scope. Every picked deal must be one the investor may read
 *     (`userReadableDealIds`); one that is not refuses the whole draft.
 *   - THE DRAFT says how the bands compare and which scores have low
 *     confidence. It is checked before it is shown: no number above the count
 *     of scopes (so never a score), and none of the words of advice. A draft
 *     that fails is "ungrounded" and never shown. Eadwyn never changes a score:
 *     nothing here writes one.
 *   - A RECEIPT (HMAC over the draft, 15 minutes) is what Save to notes sends
 *     back. Only then is a row written: `research_zone_drafts`, surface
 *     `deals/compare-note`, scoped to the sorted deal ids, `accepted_at` set,
 *     with one activity row of ids only. Discard writes nothing.
 */
import type { Env, User } from '../types';
import { userReadableDealIds } from '../routes/deals';
import { SCOPE_ORDER, VENTURE_MODEL_V1 } from './ventureScoring/model';
import { dealProject, investorsMaySee, stripView } from './ventureScoring/access';
import { storedScorecard, type StoredScope } from './ventureScoring/store';
import { signHmac } from './scoreIntegrity';

export const NOTE_SURFACE = 'deals/compare-note';
export const NOTE_MAX = 1500;
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;
const RECEIPT_TTL_MS = 15 * 60 * 1000;

export class NoteError extends Error {
  code: string; status: number;
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status; }
}

export const SCOPE_LABEL: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(SCOPE_ORDER.map((k) =>
  [k, k === 'pmf' ? 'Product-market fit' : (VENTURE_MODEL_V1.scopes as Record<string, { label: string }>)[k]?.label ?? k])));

export interface NoteVenture {
  ref: string; deal_id: number; name: string; locked: boolean;
  scopes: Array<{ scope: string; label: string; state: string; band: string | null; confidence: string | null }>;
}

/** The picked deals, as two to four distinct ids, in the order picked. */
export function parseIds(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
  const ids = list ? [...new Set(list.map((v) => String(v).trim()))].filter((v) => v !== '') : [];
  if (ids.length < COMPARE_MIN || ids.length > COMPARE_MAX || ids.some((v) => !/^[1-9]\d{0,11}$/.test(v))) {
    throw new NoteError('bad_compare', 400, `Compare two to four ventures.`);
  }
  return ids.map(Number);
}
export const scopeKey = (ids: readonly number[]) => `deals:${[...ids].sort((a, b) => a - b).join(',')}`;

/** Each venture's name and bands. A deal the investor may not read refuses the draft. */
export async function noteMaterial(env: Env, user: User, ids: readonly number[],
  scorecard: (env: Env, projectId: number) => Promise<StoredScope[]> = storedScorecard): Promise<NoteVenture[]> {
  const readable = await userReadableDealIds(env, user, [...ids]);
  if (ids.some((id) => !readable.has(id))) throw new NoteError('not_shared', 404, 'A venture you picked is not shared with you, so Eadwyn cannot compare it.');
  const names = new Map(((await env.DB.prepare(
    `SELECT d.id, p.name FROM deals d JOIN projects p ON p.id = d.project_id WHERE d.id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(ids)).all<{ id: number; name: string | null }>()).results || []).map((r) => [Number(r.id), r.name || 'Unnamed venture']));
  const out: NoteVenture[] = [];
  for (const [i, dealId] of ids.entries()) {
    const projectId = await dealProject(env, dealId);
    const base = { ref: `v${i + 1}`, deal_id: dealId, name: names.get(dealId) ?? 'Unnamed venture' };
    if (projectId == null || !(await investorsMaySee(env, projectId)).on) { out.push({ ...base, locked: true, scopes: [] }); continue; }
    const strip = stripView(await scorecard(env, projectId));
    out.push({ ...base, locked: false, scopes: strip.map((s) => ({ scope: s.scope, label: SCOPE_LABEL[s.scope] ?? s.scope, state: s.state, band: s.band, confidence: s.confidence_word })) });
  }
  return out;
}

/** Enough to compare: at least two ventures with a band on at least one scope. */
export const comparable = (m: readonly NoteVenture[]) => m.filter((v) => v.scopes.some((s) => s.band)).length >= COMPARE_MIN;

export function notePrompt(m: readonly NoteVenture[]): string {
  return [
    'You are Eadwyn. Write a short comparison note, in plain sentences, of the ventures below, for an investor\'s own notes.',
    'Use only the bands (Strong, Fair, Weak) and the confidence words given. Say on which scopes each venture has the stronger band,',
    'and name every score with low confidence and every scope without a score. Never write a score, a percentage or any number other than',
    'a count of scopes. Never recommend, advise, rank for investment, or say what the investor should do. A locked venture has not shared its scores: say so.',
    'Answer with JSON only: {"text": "..."} and at most 1200 characters.',
    'The ventures, as JSON:',
    JSON.stringify(m.map(({ ref, name, locked, scopes }) => ({ ref, name, locked, scopes: scopes.map(({ label, state, band, confidence }) => ({ label, state, band, confidence })) }))),
  ].join('\n');
}

const ADVICE = /\b(recommend\w*|advis\w*|should|must|invest in|buy|sell|pass on|go with|best choice|better investment)\b/i;

/** The draft, or null when it is not grounded: no JSON, too long, a number that could be a score, or advice. */
export function parseNote(output: string): string | null {
  let text: unknown;
  try { text = (JSON.parse(String(output).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as { text?: unknown }).text; } catch { return null; }
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > NOTE_MAX) return null;
  for (const n of t.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!/^\d+$/.test(n) || Number(n) > SCOPE_ORDER.length) return null;
  if (/%/.test(t) || ADVICE.test(t)) return null;
  return t;
}

const sign = (env: Env, payload: string) => signHmac(env, 'deal-compare-note:v1:' + payload);
function same(a: unknown, b: string) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let n = 0; n < b.length; n++) diff |= a.charCodeAt(n) ^ b.charCodeAt(n);
  return diff === 0;
}

export interface NotePayload { uid: string; user: number; deal_ids: number[]; text: string; captured_at: string; cost_micro_usd: number; expires: number }

export async function receiptFor(env: Env, p: NotePayload) {
  const payload = JSON.stringify(p);
  return { payload, signature: await sign(env, payload) };
}

/** Save to notes: the receipt's own draft, for its own investor and deals, while fresh. */
export async function keepNote(env: Env, user: User, raw: unknown): Promise<NotePayload> {
  const r = raw as { payload?: unknown; signature?: unknown } | null;
  if (!r || typeof r.payload !== 'string' || r.payload.length > 20000 || !same(r.signature, await sign(env, r.payload))) {
    throw new NoteError('invalid_note', 400, 'Draft a note before saving it.');
  }
  const p = JSON.parse(r.payload) as NotePayload;
  if (p.user !== user.id || !Array.isArray(p.deal_ids) || typeof p.text !== 'string' || !Number.isFinite(p.expires) || p.expires < Date.now()) {
    throw new NoteError('note_expired', 409, 'This draft is too old to save. Draft it again.');
  }
  const body = JSON.stringify({ payload: r.payload, signature: r.signature });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO research_zone_drafts (uid, owner_user_id, surface, scope_key, body, cost_micro_usd, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(uid) DO NOTHING`).bind(p.uid, user.id, NOTE_SURFACE, scopeKey(p.deal_ids), body, p.cost_micro_usd),
    env.DB.prepare(`INSERT INTO activity_logs (user_id, entity_type, entity_id, action, details, actor)
      SELECT ?, 'deals.compare', ?, 'eadwyn_compare_note_saved', ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM activity_logs WHERE entity_type = 'deals.compare' AND entity_id = ? AND action = 'eadwyn_compare_note_saved')`)
      .bind(user.id, p.uid, JSON.stringify({ deals: p.deal_ids.length }), `user:${user.id}`, p.uid),
  ]);
  return p;
}

/** The notes this investor saved for this set of ventures, newest first; a row that fails its signature is counted, never shown. */
export async function savedNotes(env: Env, user: User, ids: readonly number[]) {
  const rows = (await env.DB.prepare(`SELECT body FROM research_zone_drafts WHERE owner_user_id = ? AND surface = ? AND scope_key = ? AND accepted_at IS NOT NULL
    ORDER BY id DESC LIMIT 20`).bind(user.id, NOTE_SURFACE, scopeKey(ids)).all<{ body: string }>()).results || [];
  const items: Array<Pick<NotePayload, 'uid' | 'text' | 'deal_ids' | 'captured_at'>> = [];
  let unreadable = 0;
  for (const row of rows) {
    try {
      const kept = JSON.parse(row.body) as { payload: string; signature: string };
      if (!same(kept.signature, await sign(env, kept.payload))) throw new Error('signature');
      const p = JSON.parse(kept.payload) as NotePayload;
      if (p.user !== user.id) throw new Error('owner');
      items.push({ uid: p.uid, text: p.text, deal_ids: p.deal_ids, captured_at: p.captured_at });
    } catch { unreadable += 1; }
  }
  return { items, unreadable };
}

export const newNotePayload = (user: User, ids: readonly number[], text: string, costMicro: number): NotePayload => ({
  uid: crypto.randomUUID().replace(/-/g, ''), user: user.id, deal_ids: [...ids], text,
  captured_at: new Date().toISOString(), cost_micro_usd: costMicro, expires: Date.now() + RECEIPT_TTL_MS,
});
