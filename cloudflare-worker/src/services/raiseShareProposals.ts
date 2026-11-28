/**
 * D6897 part 3 (#6897, canvas D6054 RA-27 A and RA-30): Eadwyn's drafts for Share outside Axal — a proposed pack
 * selection for one reader, with a reason per item, and a one-sentence covering line for the readiness snapshot.
 *
 * They live in the AIRail proposals store (`ai_rail_proposals`, D780), one row per draft, under the venture's
 * record `raise-share:<projectId>`:
 *
 *   pack           `share:pack`            the items the founder could tick for this reader, each with one plain
 *                                          reason, and one line on what was left out
 *   covering line  `share:covering-line`   one sentence above the snapshot: the largest gap and what to fix next
 *
 * WHAT EADWYN SEES. For the pack: the items a pack may hold right now (`outsidePackView`, the founder's own
 * preview reader), by uid, area, kind, source, strength, day and the founder's summary. Never a Private item,
 * never a figure, never a file, and nothing from the data room. For the line: the seven snapshot areas as
 * `readinessBody` builds them (score words, evidence kind, what is missing). Both inside an untrusted block.
 *
 * THE RUN. One `rail_reason` run per press, quoted first: the press carries the quote's `confirm_quote`, a digest
 * of what will be sent, the model and the hold; without it, or with a stale one, nothing runs (402
 * `quote_required`). A new run withdraws the member's earlier open draft of the same kind.
 *
 * ACCEPT writes nothing but the proposal. A pack draft's accept returns the uids still eligible, for the composer
 * to tick; the founder still makes the pack. A covering line's accept returns the sentence, or the founder's
 * edit of it (checked like any covering line), for the snapshot's field, labelled as theirs. Eadwyn never sends,
 * never shares and never changes a record. DISCARD writes the proposal only.
 *
 * Bound SQL only; every statement binds the member and the venture's record.
 */
import type { Env } from '../types';
import { AI_SURFACE } from './aiSurfaces';
import type { RunOptions } from './aiRouter';
import { untrustedBlock, withUntrustedRule } from './ai/untrusted';
import { listRail, type RailProposal } from './railProposals';
import { outsidePackView } from './raiseEvidence';
import { isFounderChosen } from './raiseEvidenceSources';
import { coveringLine, readinessBody, COVERING_LINE_MAX } from './raiseEvidenceShare';

export const PROPOSALS_PAGE = 'Founder · Raise · Evidence';
export const DRAFT_KINDS = ['pack', 'covering-line'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const OPTION_OF: Readonly<Record<DraftKind, string>> = Object.freeze({ pack: 'share:pack', 'covering-line': 'share:covering-line' });
export const kindOfOption = (option: string): DraftKind | null => DRAFT_KINDS.find((k) => OPTION_OF[k] === option) ?? null;
export const recordOf = (projectId: number) => `raise-share:${projectId}`;
export const isDraftKind = (v: unknown): v is DraftKind => typeof v === 'string' && (DRAFT_KINDS as readonly string[]).includes(v);

/** The most items sent in one run; past it, the newest are sent. */
export const MAX_ITEMS = 120;
/** The most items one proposal may tick. */
export const MAX_PICKS = 30;
export const REASON_MAX = 200;
export const AUDIENCE_MAX = 120;
export const LEFT_OUT_MAX = 280;

/** Words a draft may not carry: an email address, a link, and the two words the product never uses. */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LINK = /\bhttps?:\/\/|\bwww\./i;
const BANNED = /\badvi(?:c|s)e|\badvisor/i;
export const wordsRefused = (s: string) => EMAIL.test(s) || LINK.test(s) || BANNED.test(s);

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || s.length > max || wordsRefused(s)) return null;
  return s;
};

/** Who the pack is for, as the founder typed it: one short line, required. */
export function audienceOf(v: unknown): string | null {
  return clean(v, AUDIENCE_MAX);
}

// ── What a run reads ────────────────────────────────────────────────────────

export type PackItem = { uid: string; area: string; kind: string; source: string; strength: string | null; day: string | null; summary: string | null };
export type PackFacts = { audience: string; items: PackItem[] };
export type LineFacts = { areas: Array<{ area: string; score: string; evidence: string | null; missing: string | null }> };

/** The items a pack may hold now, as the founder's own preview reader sees them after an NDA. No figure. */
export async function packFacts(env: Env, projectId: number, audience: string): Promise<PackFacts | null> {
  const view: any = await outsidePackView(env, projectId, true, null);
  if (!view?.items || view.items.state !== 'recorded') return null;
  // D5837, D5842 part 2: a founder-chosen ledger fact or Search Console aggregate never goes to a model; the founder ticks it in the composer.
  const rows = (view.items.rows as any[])
    .filter((r) => !isFounderChosen(r))
    .sort((a, b) => String(b.observed_on ?? '').localeCompare(String(a.observed_on ?? '')) || String(a.uid).localeCompare(String(b.uid)))
    .slice(0, MAX_ITEMS);
  return {
    audience,
    items: rows.map((r) => ({
      uid: String(r.uid), area: String(r.area), kind: String(r.kind), source: String(r.source_label),
      strength: r.strength ? String(r.strength) : null, day: r.observed_on ? String(r.observed_on) : null,
      summary: typeof r.summary === 'string' ? r.summary.slice(0, 200) : null,
    })),
  };
}

/** The seven snapshot areas the line is written from: words only, as the reader would see them. */
export async function lineFacts(env: Env, projectId: number): Promise<LineFacts> {
  const { body } = await readinessBody(env, projectId);
  return { areas: body.areas.map((a) => ({ area: a.label, score: a.words, evidence: a.evidence, missing: a.missing })) };
}

// ── The run's output, checked ───────────────────────────────────────────────

export type PackDraft = { audience: string; items: Array<{ uid: string; reason: string }>; left_out: string | null };
export type LineDraft = { line: string };

function jsonOf(output: unknown, open: '[' | '{', close: ']' | '}'): unknown {
  if (typeof output !== 'string') return output;
  const at = output.indexOf(open);
  const end = output.lastIndexOf(close);
  if (at < 0 || end <= at) return null;
  try { return JSON.parse(output.slice(at, end + 1)); } catch { return null; }
}

/**
 * A pack draft survives only with items this venture may share now, each named once with a plain reason. Unknown
 * uids (a Private item, an item since unshared, an invented one) are dropped; so is a reason with an email, a
 * link or a word the product never uses. A draft with no item left is no draft.
 */
export function packDraftFrom(output: unknown, facts: PackFacts): PackDraft | null {
  const v: any = jsonOf(output, '{', '}');
  if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return null;
  const known = new Set(facts.items.map((i) => i.uid));
  const used = new Set<string>();
  const items: PackDraft['items'] = [];
  for (const r of v.items as any[]) {
    if (items.length >= MAX_PICKS) break;
    const uid = typeof r?.uid === 'string' ? r.uid : '';
    const reason = clean(r?.reason, REASON_MAX);
    if (!known.has(uid) || used.has(uid) || !reason) continue;
    used.add(uid);
    items.push({ uid, reason });
  }
  if (!items.length) return null;
  return { audience: facts.audience, items, left_out: clean(v.left_out, LEFT_OUT_MAX) };
}

/** A covering line survives as one sentence the snapshot would accept (`coveringLine`), in plain words. */
export function lineDraftFrom(output: unknown): LineDraft | null {
  const v: any = jsonOf(output, '{', '}');
  const raw = v && typeof v === 'object' ? v.line : typeof output === 'string' && !output.includes('{') ? output : null;
  const line = coveringLine(typeof raw === 'string' ? raw.trim().replace(/^["“]|["”]$/g, '') : raw);
  if (line == null || line === 'bad' || wordsRefused(line)) return null;
  return { line };
}

// ── The one run a press makes ───────────────────────────────────────────────

/** What the run is shown. The quote's digest is taken over exactly this. */
export const sentOf = (kind: DraftKind, facts: PackFacts | LineFacts) => ({ kind, ...facts });

export function runOptions(userId: number, projectId: number, kind: DraftKind, facts: PackFacts | LineFacts, model?: string): RunOptions {
  const rail = { page: PROPOSALS_PAGE, option: OPTION_OF[kind], record: recordOf(projectId) };
  const shared = { task: 'rail_reason' as const, userId, model, rail, temperature: 0 };
  if (kind === 'pack') {
    return {
      ...shared,
      surface: AI_SURFACE.raiseEvidence,
      maxTokens: 1500,
      systemPrompt: withUntrustedRule([
        'You help a startup founder choose which evidence items to put in a pack for one reader, named in `audience`.',
        'You see each item\'s uid, area, kind, source, strength, day and the founder\'s summary. You never see a figure.',
        `Return one JSON object only: {"items":[{"uid":"…","reason":"…"}],"left_out":"…"}, at most ${MAX_PICKS} items.`,
        'Pick only items that serve this reader. Use only uid values given. Each reason is one plain sentence on why this reader needs it.',
        '`left_out` is one plain sentence on what you left out and why. Never name a person, an email, a link or a figure.',
        'Return {"items":[]} when nothing fits.',
      ].join('\n')),
      messages: [{ role: 'user', content: untrustedBlock('record_text', JSON.stringify(sentOf(kind, facts))) }],
    };
  }
  return {
    ...shared,
    surface: AI_SURFACE.raiseReadiness,
    maxTokens: 300,
    systemPrompt: withUntrustedRule([
      'You draft one sentence a startup founder may put above a dated fundraising-readiness snapshot shared outside the platform.',
      'You see the seven areas with their score words, evidence kind and what is missing. There is no overall score: never invent one.',
      `Return one JSON object only: {"line":"…"}. One sentence, at most ${COVERING_LINE_MAX} characters, in the founder's voice:`,
      'say where preparation stands and name the largest gap and what comes next. Never name a person, an email, a link or a figure that is not a score shown.',
    ].join('\n')),
    messages: [{ role: 'user', content: untrustedBlock('record_text', JSON.stringify(sentOf(kind, facts))) }],
  };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** What a quote promises: this member, this venture, this draft, this input, this model, this hold. */
export async function quoteDigest(userId: number, projectId: number, kind: DraftKind, facts: PackFacts | LineFacts, model: string, hold: number): Promise<string> {
  const text = JSON.stringify([userId, projectId, sentOf(kind, facts), model, hold]);
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// ── The list ────────────────────────────────────────────────────────────────

export type DraftView = {
  uid: string; kind: DraftKind; status: 'proposed' | 'accepted' | 'edited';
  audience: string | null; items: Array<{ uid: string; reason: string }> | null; left_out: string | null;
  line: string | null; created_at: string; decided_at: string | null;
};

function viewOf(r: RailProposal): DraftView | null {
  const kind = kindOfOption(r.rail_option);
  if (!kind || !['proposed', 'accepted', 'edited'].includes(r.status)) return null;
  const p = r.payload as Record<string, any>;
  const d = (r.decided_payload ?? {}) as Record<string, any>;
  return {
    uid: r.uid, kind, status: r.status as DraftView['status'],
    audience: kind === 'pack' && typeof p.audience === 'string' ? p.audience : null,
    items: kind === 'pack' && Array.isArray(p.items) ? (p.items as any[]).map((i) => ({ uid: String(i.uid), reason: String(i.reason) })) : null,
    left_out: kind === 'pack' && typeof p.left_out === 'string' ? p.left_out : null,
    line: kind === 'covering-line' ? String((typeof d.line === 'string' ? d.line : p.line) ?? '') : null,
    created_at: r.created_at, decided_at: r.decided_at,
  };
}

/** The member's own latest draft of each kind for this venture: open, or decided and kept. */
export async function listDrafts(env: Env, userId: number, projectId: number): Promise<DraftView[]> {
  const rows = await listRail(env, userId, { page: PROPOSALS_PAGE, record: recordOf(projectId) });
  const out: DraftView[] = [];
  const seen = new Set<DraftKind>();
  for (const r of rows) {
    const v = viewOf(r);
    if (!v || seen.has(v.kind)) continue;
    seen.add(v.kind);
    out.push(v);
  }
  return out;
}

// ── Accept and discard ──────────────────────────────────────────────────────

export type Outcome =
  | { ok: true; draft: { uid: string; status: string }; tick?: string[]; dropped?: number; line?: string }
  | { ok: false; status: 400 | 409; code: string; message: string };

const NOT_OPEN: Outcome = { ok: false, status: 409, code: 'not_open', message: 'That draft is not yours, or it has already been decided.' };
const BAD_LINE: Outcome = { ok: false, status: 400, code: 'invalid_line', message: 'A covering line is one sentence of at most 200 characters, with no email or link.' };
const EMPTY_PACK: Outcome = { ok: false, status: 409, code: 'draft_stale', message: 'None of these items can be shared now, so nothing was ticked. Discard it and ask again.' };

const parse = (s: string | null): Record<string, any> => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

async function ownRow(env: Env, userId: number, projectId: number, uid: string) {
  return env.DB.prepare(
    `SELECT uid, rail_option, status, payload_json FROM ai_rail_proposals
      WHERE uid = ? AND user_id = ? AND record_ref = ? AND rail_page = ?`,
  ).bind(uid, userId, recordOf(projectId), PROPOSALS_PAGE).first<{ uid: string; rail_option: string; status: string; payload_json: string }>();
}

/**
 * Accept: the proposal only. A pack returns the uids a pack may still hold (an item made Private since is dropped
 * and counted); a covering line returns the sentence, or the founder's edit of it, which is stored as `edited`.
 */
export async function acceptDraft(env: Env, userId: number, projectId: number, uid: string, edit: unknown): Promise<Outcome> {
  const row = await ownRow(env, userId, projectId, uid);
  const kind = row ? kindOfOption(row.rail_option) : null;
  if (!row || !kind || row.status !== 'proposed') return NOT_OPEN;
  const p = parse(row.payload_json);
  let decided: Record<string, unknown>;
  let status: 'accepted' | 'edited' = 'accepted';
  let result: Omit<Extract<Outcome, { ok: true }>, 'ok' | 'draft'>;
  if (kind === 'pack') {
    if (edit !== undefined) return { ok: false, status: 400, code: 'invalid', message: 'A pack draft is accepted as it is; change the ticks in the composer.' };
    const view: any = await outsidePackView(env, projectId, true, null);
    if (!view?.items || view.items.state !== 'recorded') return { ok: false, status: 409, code: 'unreadable', message: 'The evidence could not be read, so nothing was ticked. Try again.' };
    const now = new Set((view.items.rows as any[]).map((r) => String(r.uid)));
    const asked = Array.isArray(p.items) ? (p.items as any[]).map((i) => String(i.uid)) : [];
    const tick = asked.filter((u) => now.has(u));
    if (!tick.length) return EMPTY_PACK;
    decided = { tick, dropped: asked.length - tick.length };
    result = { tick, dropped: asked.length - tick.length };
  } else {
    const proposed = typeof p.line === 'string' ? p.line : '';
    let line = proposed;
    if (edit !== undefined) {
      const got = coveringLine(edit);
      if (got == null || got === 'bad' || wordsRefused(got)) return BAD_LINE;
      line = got;
      if (got !== proposed) status = 'edited';
    }
    decided = { line };
    result = { line };
  }
  const res = await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = ?, decided_payload_json = ?, decided_at = CURRENT_TIMESTAMP, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE uid = ? AND user_id = ? AND record_ref = ? AND status = 'proposed'`,
  ).bind(status, JSON.stringify(decided), userId, uid, userId, recordOf(projectId)).run();
  if (!Number(res.meta?.changes ?? 0)) return NOT_OPEN;
  return { ok: true, draft: { uid, status }, ...result };
}

/** Discard: the proposal is discarded by this member; nothing else is touched. */
export async function discardDraft(env: Env, userId: number, projectId: number, uid: string): Promise<Outcome> {
  const row = await ownRow(env, userId, projectId, uid);
  if (!row || !kindOfOption(row.rail_option) || row.status !== 'proposed') return NOT_OPEN;
  const res = await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = 'discarded', decided_at = CURRENT_TIMESTAMP, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE uid = ? AND user_id = ? AND record_ref = ? AND status = 'proposed'`,
  ).bind(userId, uid, userId, recordOf(projectId)).run();
  return Number(res.meta?.changes ?? 0) ? { ok: true, draft: { uid, status: 'discarded' } } : NOT_OPEN;
}
