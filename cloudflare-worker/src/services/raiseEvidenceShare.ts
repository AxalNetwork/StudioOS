/**
 * D6864 (#6864, canvas D6054): Raise evidence shared outside Axal, and evidence the founder adds by hand.
 *
 * - **Evidence pack link (RA-27, RA-28, RA-29).** The founder makes a dated pack: before an NDA it is coverage only;
 *   after an NDA the founder confirms outside Axal (and its date) it carries summaries, a figure only for After NDA
 *   items, and Value withheld with its reason. The pack is the founder's own preview projection (`outsidePackView`),
 *   so it never shows more than an invited investor on Axal would at the same point: no Private item, no
 *   unconsented quote, no file the data room refuses, no bank line, no investor's name or money. It is frozen at
 *   creation and never updates; the list says "Changed since sent" when the current pack would differ.
 * - **The link is a capability.** 32 random bytes, stored only as a SHA-256 digest (as `captable_share_tokens`).
 *   Opening it consumes one view in a single conditional UPDATE; expired, used-up, revoked and unknown links are
 *   refused with a page that carries no venture data.
 * - **Add evidence by hand (RA-32).** Source "Typed: stated by you", strength Anecdote, sharing Private.
 *
 * - **Readiness snapshot (RA-30, D6897).** The same link store with `output = 'readiness'`: the seven readiness areas
 *   with their score out of 10, evidence kind, what is missing and the day scored, frozen when made. Data room with no
 *   score reads "Not scored yet", never 0; Team reads "Team is assessed by a person". There is no overall score and
 *   no Product-market fit row. An optional one-sentence covering line from the founder sits above it.
 *
 * - **PDF copies (RA-28 C, RA-30 B, D6897 part 2).** The same content, drawn as an A4 page in the browser. A copy has
 *   no token and cannot be stopped or counted; `raise_share_pdf_copies` records that it left, for Shared links.
 *
 * Nothing here sends anything: making a link only returns its address to the founder.
 */
import type { Env } from '../types';
import { logCycleWriteStatement } from './cycleActivity';
import { EVIDENCE_AREAS, type EvidenceArea } from './raiseEvidenceSources';
import { outsidePackView, evidenceUid, TYPED_EVIDENCE_KIND, TYPED_EVIDENCE_TABLE, type RaiseEvidenceContext } from './raiseEvidence';
import { READINESS_ITEMS, loadReadiness, latestScores } from './raiseCycle';

const SENTENCES = {
  forbidden: 'Only this venture’s founders can share evidence outside Axal.',
  invalid: 'Some of what you entered cannot be used. Check the highlighted fields and try again.',
  nda_unconfirmed: 'Confirm that an NDA is signed outside Axal, and its date, before sharing figures.',
  empty: 'Nothing is shared beyond Private yet, so there is no pack to make. Share an item first.',
  unreadable: 'The evidence could not be read, so no pack was made. Nothing left Axal. Try again.',
  not_found: 'This link is not on Shared links for this venture.',
  already_stopped: 'This link was already stopped.',
  failed: 'Nothing was saved. Try again.',
} as const;
export class EvidenceShareError extends Error {
  readonly code: keyof typeof SENTENCES;
  readonly status: 400 | 403 | 404 | 409 | 503;
  readonly sentence: string;
  constructor(code: keyof typeof SENTENCES, status: EvidenceShareError['status']) {
    super('evidence_share_refused'); this.code = code; this.status = status; this.sentence = SENTENCES[code];
  }
}

export const LINK_DEFAULTS = { expires_in_days: 14, view_limit: 10 } as const;
export const LINK_BOUNDS = { expires_in_days: [1, 90], view_limit: [1, 100], label: 80, items: 500 } as const;
export const TYPED_BOUNDS = { summary: 200, unit: 24 } as const;
const LIST_MAX = 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function founderOnly(ctx: RaiseEvidenceContext) { if (!ctx.founder) throw new EvidenceShareError('forbidden', 403); }
const todayUtc = () => new Date().toISOString().slice(0, 10);
const validDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const intIn = (v: unknown, [lo, hi]: readonly [number, number]) => Number.isSafeInteger(v) && Number(v) >= lo && Number(v) <= hi;
const newUid = () => crypto.randomUUID().replaceAll('-', '');

function b64url(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** An unguessable link token: 32 random bytes, 43 base64url characters. Only its digest is stored. */
export function newShareToken(): string { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
export const tokenHash = (token: string) => sha256Hex('raise-evidence-share:v1:' + token);

type Reader = 'before_nda' | 'after_nda';
type PackView = Awaited<ReturnType<typeof outsidePackView>>;

/** The founder's note sits under a Mismatch (Q7 A), only while it was written against the figure still stated. */
async function claimNotes(env: Env, projectId: number, uids: string[]): Promise<Map<string, string>> {
  if (!uids.length) return new Map();
  const rows = await env.DB.prepare(`SELECT uid, note FROM raise_claims WHERE project_id = ? AND state = 'mismatch' AND note IS NOT NULL
      AND TRIM(note) <> '' AND note_value IS stated_value AND uid IN (SELECT value FROM json_each(?))`)
    .bind(projectId, JSON.stringify(uids)).all<{ uid: string; note: string }>();
  return new Map((rows.results || []).map(r => [r.uid, r.note]));
}
async function ventureName(env: Env, projectId: number): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(p.name), '')) AS name
      FROM projects p LEFT JOIN company_profiles c ON c.id = p.company_id WHERE p.id = ?`).bind(projectId).first<{ name: string | null }>();
  return row?.name ?? null;
}
/** What the reader receives, minus the date. Its hash is what "Changed since sent" compares. */
async function packBody(env: Env, projectId: number, reader: Reader, only: ReadonlySet<string> | null) {
  const view: PackView = await outsidePackView(env, projectId, reader === 'after_nda', only);
  if (view.coverage.state !== 'recorded') throw new EvidenceShareError('unreadable', 503);
  if (reader === 'after_nda' && (!view.items || view.items.state !== 'recorded')) throw new EvidenceShareError('unreadable', 503);
  const itemCount = reader === 'after_nda'
    ? (view.items as { rows: unknown[] }).rows.length
    : view.coverage.groups.reduce((n, g) => n + g.count, 0);
  let claims: unknown = null;
  if (reader === 'after_nda') {
    if (!view.claims || view.claims.state !== 'recorded') throw new EvidenceShareError('unreadable', 503);
    const rows = view.claims.rows as Array<{ uid: string; state: string }>;
    const notes = await claimNotes(env, projectId, rows.map(r => r.uid));
    claims = { state: 'recorded', rows: rows.map(r => ({ ...r, founder_note: r.state === 'mismatch' ? notes.get(r.uid) ?? null : null })) };
  }
  const body = {
    reader, nda_signed: reader === 'after_nda', before_nda: view.before_nda, coverage: view.coverage,
    items: reader === 'after_nda' ? view.items : null, claims, partial: view.partial,
  };
  return { body, itemCount, hash: await sha256Hex(JSON.stringify(body)) };
}

function parseSelection(v: unknown): Set<string> | null {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length < 1 || v.length > LINK_BOUNDS.items || !v.every(evidenceUid)) throw new EvidenceShareError('invalid', 400);
  return new Set(v as string[]);
}

/** The pack a founder chose: label, reader (with the NDA confirmed outside Axal) and items. Shared by the link and the PDF. */
function packChoice(data: Record<string, unknown>, allowed: readonly string[]) {
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !allowed.includes(k))) throw new EvidenceShareError('invalid', 400);
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (!label || label.length > LINK_BOUNDS.label) throw new EvidenceShareError('invalid', 400);
  const reader = (data.reader ?? 'before_nda') as Reader;
  if (reader !== 'before_nda' && reader !== 'after_nda') throw new EvidenceShareError('invalid', 400);
  let ndaOn: string | null = null;
  if (reader === 'after_nda') {
    if (data.nda_confirmed !== true || !validDay(data.nda_signed_on)) throw new EvidenceShareError('nda_unconfirmed', 400);
    if (data.nda_signed_on > todayUtc()) throw new EvidenceShareError('nda_unconfirmed', 400);
    ndaOn = data.nda_signed_on;
  } else if (data.nda_confirmed !== undefined || data.nda_signed_on !== undefined) throw new EvidenceShareError('invalid', 400);
  return { label, reader, ndaOn, only: parseSelection(data.items) };
}

/** RA-27 C: make the pack and its link. Nothing is sent; the founder copies the address. */
export async function createPackLink(ctx: RaiseEvidenceContext, data: Record<string, unknown>) {
  founderOnly(ctx);
  const { label, reader, ndaOn, only } = packChoice(data, ['label', 'reader', 'nda_confirmed', 'nda_signed_on', 'expires_in_days', 'view_limit', 'items']);
  const days = data.expires_in_days ?? LINK_DEFAULTS.expires_in_days;
  const limit = data.view_limit ?? LINK_DEFAULTS.view_limit;
  if (!intIn(days, LINK_BOUNDS.expires_in_days) || !intIn(limit, LINK_BOUNDS.view_limit)) throw new EvidenceShareError('invalid', 400);

  let pack: Awaited<ReturnType<typeof packBody>>;
  try { pack = await packBody(ctx.env, ctx.projectId, reader, only); }
  catch (e) { if (e instanceof EvidenceShareError) throw e; throw new EvidenceShareError('unreadable', 503); }
  if (pack.itemCount === 0) throw new EvidenceShareError('empty', 409);

  const now = new Date();
  const madeAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Number(days) * 86400000).toISOString();
  const snapshot = { ...pack.body, venture: await ventureName(ctx.env, ctx.projectId), made_at: madeAt, nda_signed_on: ndaOn };
  const token = newShareToken();
  const uid = newUid();
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO raise_evidence_share_links(uid,project_id,output,token_hash,label,reader,nda_signed_on,nda_confirmed_by,item_uids_json,item_count,
          snapshot_json,pack_hash,expires_at,view_limit,created_by,created_at) VALUES(?,?,'pack',?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(uid, ctx.projectId, await tokenHash(token), label, reader, ndaOn, ndaOn ? ctx.user.id : null, only ? JSON.stringify([...only].sort()) : null,
          pack.itemCount, JSON.stringify(snapshot), pack.hash, expiresAt, limit, ctx.user.id, madeAt),
      logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: 'fundraising-readiness', entityId: uid,
        action: 'evidence_pack_shared', summary: reader === 'after_nda' ? 'An evidence pack link was made for a reader after an NDA.' : 'An evidence pack link was made for a reader before an NDA.' }),
    ]);
  } catch { throw new EvidenceShareError('failed', 503); }
  return { uid, path: '/share/evidence/' + token, label, reader, nda_signed_on: ndaOn, item_count: pack.itemCount, created_at: madeAt, expires_at: expiresAt,
    view_limit: limit, view_count: 0, state: 'live' as const, sent: false };
}

type LinkRow = { uid: string; output: string; label: string; reader: Reader; nda_signed_on: string | null; item_uids_json: string | null; item_count: number;
  pack_hash: string; expires_at: string; view_limit: number; view_count: number; last_viewed_at: string | null; revoked_at: string | null; created_at: string };
export function linkState(row: Pick<LinkRow, 'revoked_at' | 'expires_at' | 'view_count' | 'view_limit'>, nowMs = Date.now()): 'live' | 'revoked' | 'expired' | 'used_up' {
  if (row.revoked_at) return 'revoked';
  if (Date.parse(row.expires_at) <= nowMs) return 'expired';
  if (row.view_count >= row.view_limit) return 'used_up';
  return 'live';
}

type CopyRow = { uid: string; output: string; label: string; reader: Reader; nda_signed_on: string | null; item_count: number; created_at: string };
/** RA-29: every link the founder made, newest first; expired, used-up and revoked rows stay, in grey on the page. */
export async function listPackLinks(ctx: RaiseEvidenceContext) {
  founderOnly(ctx);
  const res = await ctx.env.DB.prepare(`SELECT uid,output,label,reader,nda_signed_on,item_uids_json,item_count,pack_hash,expires_at,view_limit,view_count,last_viewed_at,revoked_at,created_at
      FROM raise_evidence_share_links WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(ctx.projectId, LIST_MAX + 1).all<LinkRow>();
  const rows = (res.results || []).slice(0, LIST_MAX);
  const current = new Map<string, string | null>();
  const links = [];
  for (const row of rows) {
    const state = linkState(row);
    let changed: boolean | null = null;
    if (state === 'live') {
      const key = row.output === 'readiness' ? 'readiness' : row.reader + '|' + (row.item_uids_json ?? '*');
      if (!current.has(key)) {
        try {
          current.set(key, row.output === 'readiness'
            ? (await readinessBody(ctx.env, ctx.projectId)).hash
            : (await packBody(ctx.env, ctx.projectId, row.reader, row.item_uids_json ? new Set(JSON.parse(row.item_uids_json)) : null)).hash);
        } catch { current.set(key, null); }
      }
      const now = current.get(key);
      changed = now == null ? null : now !== row.pack_hash;
    }
    links.push({ uid: row.uid, output: row.output, label: row.label, reader: row.reader, nda_signed_on: row.nda_signed_on, item_count: row.item_count,
      created_at: row.created_at, expires_at: row.expires_at, view_limit: row.view_limit, view_count: row.view_count, last_viewed_at: row.last_viewed_at,
      revoked_at: row.revoked_at, state, changed_since_sent: changed });
  }
  // D6897 part 2 (RA-29): the PDF copies, listed apart. A copy has no state: it cannot be stopped or counted.
  const pdf = await ctx.env.DB.prepare(`SELECT uid,output,label,reader,nda_signed_on,item_count,created_at
      FROM raise_share_pdf_copies WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(ctx.projectId, LIST_MAX + 1).all<CopyRow>();
  const copies = (pdf.results || []).slice(0, LIST_MAX).map((r) => ({ ...r, kind: 'pdf' as const }));
  return { state: 'recorded' as const, links, capped: (res.results || []).length > LIST_MAX, copies, copies_capped: (pdf.results || []).length > LIST_MAX,
    defaults: LINK_DEFAULTS, bounds: LINK_BOUNDS };
}

/** RA-29 B: stop a link. Anyone opening it afterwards sees "This link was stopped by the founder". The row stays. */
export async function revokePackLink(ctx: RaiseEvidenceContext, uid: string) {
  founderOnly(ctx);
  if (!evidenceUid(uid)) throw new EvidenceShareError('not_found', 404);
  const at = new Date().toISOString();
  const res = await ctx.env.DB.prepare(`UPDATE raise_evidence_share_links SET revoked_at = ?, revoked_by = ? WHERE uid = ? AND project_id = ? AND revoked_at IS NULL`)
    .bind(at, ctx.user.id, uid, ctx.projectId).run();
  if ((res as { meta?: { changes?: number } }).meta?.changes !== 1) {
    const row = await ctx.env.DB.prepare('SELECT revoked_at FROM raise_evidence_share_links WHERE uid = ? AND project_id = ?').bind(uid, ctx.projectId).first<{ revoked_at: string | null }>();
    throw row ? new EvidenceShareError('already_stopped', 409) : new EvidenceShareError('not_found', 404);
  }
  try {
    await logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: 'fundraising-readiness', entityId: uid,
      action: 'evidence_pack_revoked', summary: 'An evidence pack link was stopped.' }).run();
  } catch { console.error('[raise_evidence_share] revoke activity log failed'); }
  return { uid, state: 'revoked' as const, revoked_at: at };
}

/** The reader's refusal pages (RA-36): none of them names the venture or shows any evidence. */
export const REFUSALS = {
  not_found: { status: 404, title: 'This link does not open anything', sentence: 'Check that the whole address was copied, or ask the sender for a new link.' },
  expired: { status: 410, title: 'This link has expired', sentence: 'Ask the sender for a new link.' },
  used_up: { status: 410, title: 'This link has been opened as many times as its sender allowed', sentence: 'Ask the sender for a new link.' },
  revoked: { status: 410, title: 'This link was stopped by the founder', sentence: 'Ask the sender if you still need it.' },
} as const;
export type Refusal = keyof typeof REFUSALS;

/** RA-28: the public read. One view is consumed only when the link is live; a refusal never says whose link it was. */
export async function openPackLink(env: Env, token: string, output: 'pack' | 'readiness' = 'pack'): Promise<{ ok: true; pack: unknown; link: { made_at: string; expires_at: string } } | { ok: false; refusal: Refusal }> {
  if (!TOKEN.test(token)) return { ok: false, refusal: 'not_found' };
  const hash = await tokenHash(token);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(`UPDATE raise_evidence_share_links SET view_count = view_count + 1, last_viewed_at = ?
      WHERE token_hash = ? AND output = ? AND revoked_at IS NULL AND view_count < view_limit AND datetime(expires_at) > datetime(?)
        AND EXISTS (SELECT 1 FROM projects p WHERE p.id = raise_evidence_share_links.project_id AND p.deleted_at IS NULL)`)
    .bind(now, hash, output, now).run();
  const row = await env.DB.prepare(`SELECT l.snapshot_json, l.created_at, l.expires_at, l.revoked_at, l.view_count, l.view_limit,
      (SELECT p.deleted_at FROM projects p WHERE p.id = l.project_id) AS deleted_at FROM raise_evidence_share_links l WHERE l.token_hash = ? AND l.output = ?`)
    .bind(hash, output).first<{ snapshot_json: string; created_at: string; expires_at: string; revoked_at: string | null; view_count: number; view_limit: number; deleted_at: string | null }>();
  if ((res as { meta?: { changes?: number } }).meta?.changes === 1 && row) {
    try { return { ok: true, pack: JSON.parse(row.snapshot_json), link: { made_at: row.created_at, expires_at: row.expires_at } }; }
    catch { return { ok: false, refusal: 'not_found' }; }
  }
  if (!row || row.deleted_at) return { ok: false, refusal: 'not_found' };
  if (row.revoked_at) return { ok: false, refusal: 'revoked' };
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, refusal: 'expired' };
  return { ok: false, refusal: 'used_up' };
}

// ---------------------------------------------------------------------------
// D6897 (#6897, RA-30): the readiness snapshot shared outside Axal
// ---------------------------------------------------------------------------

/** The seven areas a snapshot shows: every readiness item but Product-market fit (D6054: no PMF row). */
export const SNAPSHOT_AREAS = READINESS_ITEMS.filter((i) => i.key !== 'pmf');
export const NOT_SCORED = 'Not scored yet';
export const TEAM_LINE = 'Team is assessed by a person';
export const COVERING_LINE_MAX = 200;
const EVIDENCE_WORD: Record<string, string> = { measured: 'Measured', stated: 'Stated', pattern: 'Pattern', anecdote: 'Anecdote' };

export type SnapshotArea = { key: string; label: string; score: number | null; evidence: string | null; missing: string | null; scored_on: string | null; words: string };

/** The seven areas as stored now, and the hash "Changed since sent" compares. Never an overall score. */
export async function readinessBody(env: Env, projectId: number): Promise<{ body: { areas: SnapshotArea[] }; hash: string }> {
  const { items, scores } = await loadReadiness({ env, projectId, today: todayUtc() });
  const latest = latestScores(scores);
  const idOf = new Map(items.map((i) => [i.item_key, Number(i.id)]));
  const areas: SnapshotArea[] = SNAPSHOT_AREAS.map(({ key, label }) => {
    const id = idOf.get(key);
    const s = id == null ? undefined : latest.get(id);
    if (key === 'team') {
      return { key, label, score: null, evidence: null, missing: null, scored_on: null, words: TEAM_LINE };
    }
    const raw = s?.score == null ? null : Number(s.score);
    const score = raw != null && Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : null;
    const evidence = s?.evidence ? EVIDENCE_WORD[String(s.evidence)] ?? null : null;
    return {
      key, label, score, evidence,
      missing: s?.missing ? String(s.missing).slice(0, 300) : null,
      scored_on: score != null && s?.scored_at ? String(s.scored_at).slice(0, 10) : null,
      words: score == null ? NOT_SCORED : `${score} of 10`,
    };
  });
  const body = { areas };
  return { body, hash: await sha256Hex(JSON.stringify(body)) };
}

/** One sentence the founder adds above the snapshot, or null. At most 200 characters, no line breaks. */
export function coveringLine(v: unknown): string | null | 'bad' {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return 'bad';
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  if (t.length > COVERING_LINE_MAX || /[\r\n]/.test(v.trim())) return 'bad';
  return t;
}

/** RA-30: make the readiness snapshot and its link. Nothing is sent; the founder copies the address. */
export async function createReadinessLink(ctx: RaiseEvidenceContext, data: Record<string, unknown>) {
  founderOnly(ctx);
  const allowed = ['label', 'expires_in_days', 'view_limit', 'covering_line'];
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !allowed.includes(k))) throw new EvidenceShareError('invalid', 400);
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (!label || label.length > LINK_BOUNDS.label) throw new EvidenceShareError('invalid', 400);
  const days = data.expires_in_days ?? LINK_DEFAULTS.expires_in_days;
  const limit = data.view_limit ?? LINK_DEFAULTS.view_limit;
  if (!intIn(days, LINK_BOUNDS.expires_in_days) || !intIn(limit, LINK_BOUNDS.view_limit)) throw new EvidenceShareError('invalid', 400);
  const line = coveringLine(data.covering_line);
  if (line === 'bad') throw new EvidenceShareError('invalid', 400);

  let made: Awaited<ReturnType<typeof readinessBody>>;
  try { made = await readinessBody(ctx.env, ctx.projectId); }
  catch { throw new EvidenceShareError('unreadable', 503); }

  const now = new Date();
  const madeAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Number(days) * 86400000).toISOString();
  const snapshot = { kind: 'readiness', ...made.body, covering_line: line, venture: await ventureName(ctx.env, ctx.projectId), made_at: madeAt };
  const token = newShareToken();
  const uid = newUid();
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO raise_evidence_share_links(uid,project_id,output,token_hash,label,reader,nda_signed_on,nda_confirmed_by,item_uids_json,item_count,
          snapshot_json,pack_hash,expires_at,view_limit,created_by,created_at) VALUES(?,?,'readiness',?,?,'before_nda',NULL,NULL,NULL,?,?,?,?,?,?,?)`)
        .bind(uid, ctx.projectId, await tokenHash(token), label, made.body.areas.length, JSON.stringify(snapshot), made.hash, expiresAt, limit, ctx.user.id, madeAt),
      logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: 'fundraising-readiness', entityId: uid,
        action: 'readiness_snapshot_shared', summary: 'A readiness snapshot link was made.' }),
    ]);
  } catch { throw new EvidenceShareError('failed', 503); }
  return { uid, output: 'readiness' as const, path: '/share/readiness/' + token, label, covering_line: line, item_count: made.body.areas.length,
    created_at: madeAt, expires_at: expiresAt, view_limit: limit, view_count: 0, state: 'live' as const, sent: false };
}

// ---------------------------------------------------------------------------
// D6897 part 2 (#6897, RA-28 C, RA-30 B): the same content as a PDF the founder downloads
// ---------------------------------------------------------------------------

/**
 * A downloaded PDF is a copy: nobody can stop it and its opens are not counted. The Worker builds exactly what a
 * link would freeze, records that a copy left (label, reader, how many items, hash, who, when) and returns the
 * content; the browser draws the A4 page and saves it. Nothing is sent, and no token is made.
 */
async function recordCopy(ctx: RaiseEvidenceContext, row: { output: 'pack' | 'readiness'; label: string; reader: Reader; ndaOn: string | null;
  itemCount: number; hash: string; madeAt: string; action: string; summary: string }) {
  const uid = newUid();
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO raise_share_pdf_copies(uid,project_id,output,label,reader,nda_signed_on,item_count,content_hash,created_by,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .bind(uid, ctx.projectId, row.output, row.label, row.reader, row.ndaOn, row.itemCount, row.hash, ctx.user.id, row.madeAt),
      logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: 'fundraising-readiness', entityId: uid,
        action: row.action, summary: row.summary }),
    ]);
  } catch { throw new EvidenceShareError('failed', 503); }
  return uid;
}

/** RA-28 C: the evidence pack as a PDF copy. The same pack a link would carry; no expiry, no view limit. */
export async function createPackPdf(ctx: RaiseEvidenceContext, data: Record<string, unknown>) {
  founderOnly(ctx);
  const { label, reader, ndaOn, only } = packChoice(data, ['label', 'reader', 'nda_confirmed', 'nda_signed_on', 'items']);
  let pack: Awaited<ReturnType<typeof packBody>>;
  try { pack = await packBody(ctx.env, ctx.projectId, reader, only); }
  catch (e) { if (e instanceof EvidenceShareError) throw e; throw new EvidenceShareError('unreadable', 503); }
  if (pack.itemCount === 0) throw new EvidenceShareError('empty', 409);
  const madeAt = new Date().toISOString();
  const snapshot = { ...pack.body, venture: await ventureName(ctx.env, ctx.projectId), made_at: madeAt, nda_signed_on: ndaOn };
  const uid = await recordCopy(ctx, { output: 'pack', label, reader, ndaOn, itemCount: pack.itemCount, hash: pack.hash, madeAt,
    action: 'evidence_pack_pdf_copied', summary: reader === 'after_nda' ? 'An evidence pack PDF was downloaded for a reader after an NDA.' : 'An evidence pack PDF was downloaded for a reader before an NDA.' });
  return { uid, kind: 'pdf' as const, output: 'pack' as const, label, reader, nda_signed_on: ndaOn, item_count: pack.itemCount, created_at: madeAt, pack: snapshot };
}

/** RA-30 B: the readiness snapshot as a PDF copy, with the founder's optional covering line. */
export async function createReadinessPdf(ctx: RaiseEvidenceContext, data: Record<string, unknown>) {
  founderOnly(ctx);
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !['label', 'covering_line'].includes(k))) throw new EvidenceShareError('invalid', 400);
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (!label || label.length > LINK_BOUNDS.label) throw new EvidenceShareError('invalid', 400);
  const line = coveringLine(data.covering_line);
  if (line === 'bad') throw new EvidenceShareError('invalid', 400);
  let made: Awaited<ReturnType<typeof readinessBody>>;
  try { made = await readinessBody(ctx.env, ctx.projectId); }
  catch { throw new EvidenceShareError('unreadable', 503); }
  const madeAt = new Date().toISOString();
  const snapshot = { kind: 'readiness', ...made.body, covering_line: line, venture: await ventureName(ctx.env, ctx.projectId), made_at: madeAt };
  const uid = await recordCopy(ctx, { output: 'readiness', label, reader: 'before_nda', ndaOn: null, itemCount: made.body.areas.length, hash: made.hash, madeAt,
    action: 'readiness_snapshot_pdf_copied', summary: 'A readiness snapshot PDF was downloaded.' });
  return { uid, kind: 'pdf' as const, output: 'readiness' as const, label, covering_line: line, item_count: made.body.areas.length, created_at: madeAt, snapshot };
}

/** RA-32: evidence the founder adds by hand. Typed: stated by you · Anecdote · Private. A claim it backs stays Founder's figure. */
export async function addTypedEvidence(ctx: RaiseEvidenceContext, data: Record<string, unknown>) {
  founderOnly(ctx);
  const allowed = ['area', 'summary', 'value_num', 'value_unit', 'currency', 'observed_on'];
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !allowed.includes(k))) throw new EvidenceShareError('invalid', 400);
  const area = data.area as EvidenceArea;
  if (!EVIDENCE_AREAS.includes(area)) throw new EvidenceShareError('invalid', 400);
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  if (!summary || summary.length > TYPED_BOUNDS.summary) throw new EvidenceShareError('invalid', 400);
  const hasValue = data.value_num !== undefined && data.value_num !== null;
  if (hasValue && (typeof data.value_num !== 'number' || !Number.isFinite(data.value_num))) throw new EvidenceShareError('invalid', 400);
  const unit = data.value_unit == null ? null : typeof data.value_unit === 'string' && data.value_unit.trim() && data.value_unit.trim().length <= TYPED_BOUNDS.unit ? data.value_unit.trim() : undefined;
  if (unit === undefined || (!hasValue && unit)) throw new EvidenceShareError('invalid', 400);
  const currency = data.currency == null ? null : typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : undefined;
  if (currency === undefined || (!hasValue && currency)) throw new EvidenceShareError('invalid', 400);
  if (data.observed_on !== undefined && data.observed_on !== null && (!validDay(data.observed_on) || data.observed_on > todayUtc())) throw new EvidenceShareError('invalid', 400);
  const observed = (data.observed_on as string | null | undefined) ?? null;
  const uid = newUid();
  const valueNum = hasValue ? Number(data.value_num) : null;
  const hash = await sha256Hex(JSON.stringify({ area, summary, valueNum, unit, currency, observed }));
  try {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO raise_evidence_items(uid,project_id,area,kind,source_table,source_ref,provider,source_label,strength,observed_on,summary,value_num,value_unit,currency,
          snapshot_hash,state,visibility,mutation_uid,accepted_by,updated_by)
        SELECT ?,?,?,?,?,?,NULL,'typed','anecdote',?,?,?,?,?,?,'pinned','private',?,?,? WHERE EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id = ? AND u.is_active = 1
          WHERE p.id = ? AND p.deleted_at IS NULL AND p.founder_id = u.founder_id AND u.role <> 'admin')`)
        .bind(uid, ctx.projectId, area, TYPED_EVIDENCE_KIND, TYPED_EVIDENCE_TABLE, uid, observed, summary, valueNum, unit, currency, hash, newUid(), ctx.user.id, ctx.user.id,
          ctx.user.id, ctx.projectId),
      logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: 'fundraising-readiness', entityId: uid,
        action: 'evidence_added', summary: 'Evidence was added by hand (typed, anecdote, private).' }),
    ]);
  } catch { throw new EvidenceShareError('failed', 503); }
  const row = await ctx.env.DB.prepare(`SELECT uid,area,kind,source_label,strength,observed_on,summary,value_num,value_unit,currency,state,visibility,version
      FROM raise_evidence_items WHERE uid = ? AND project_id = ?`).bind(uid, ctx.projectId).first();
  if (!row) throw new EvidenceShareError('forbidden', 403);
  return { item: row, source: 'Typed: stated by you', strength: 'Anecdote', sharing: 'Private' };
}
