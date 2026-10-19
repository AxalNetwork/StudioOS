// D716 (#1781, PR 2) — the Subscription Booklet's store.
//
// The booklet is nine parts in order (`SUBSCRIPTION_BOOKLET_PARTS`,
// legalDocFormat.ts), each resolved here against the template store
// (`getTemplate`). An approved Fund I applicant opens one booklet, ticks its
// fields, and submits it; an Admin on HQ reads and withdraws (decision 9).
//
// - **A field** is a Markdown task item (`- [ ]`) in a part's store body. Its
//   id is `<slug>:<n>:<hash>`: the item's place among that body's task items,
//   and the first 12 hex of the SHA-256 of its text. A reworded item gets a
//   new id, so an old tick never lands on new words. Its `group` is the text
//   of the nearest Markdown heading above it (#1866): for the screen only,
//   never in the digest or the frozen answers.
// - **The digest** covers what the applicant sees: each part's slug, version
//   and body hash, and the ticks, in canonical JSON. Submit freezes that same
//   object under that digest; a body or tick that changed since is 409
//   `content_changed`. While any part the booklet reads is a stub, submit
//   refuses `booklet_part_missing` and names the parts.
// - Migration 478's triggers hold the rest: the status path, the frozen
//   columns, no delete, and ticks only while the booklet is open.
//
// - **The paper** (`bookletPaperInput`) is #1776's, as one composite paper:
//   the cover with Part 1's legend, the contents, then Parts 2 to 9, each on
//   its own named page with its own block. A part's ticks print in its body
//   as checked or empty squares, by field id.
// - **Signing** (D759, #1858; services/bookletSigning.ts sends it). A
//   submitted booklet prints its FROZEN text: each part at the version frozen
//   at submit (`bodyAtVersion`), hash-checked, with the frozen ticks, so what
//   the applicant rereads is what they sign. `bookletSigning` reads the state
//   from migration 485's links to the two envelopes; the paper names the
//   receiving accounts only once the General Partner has accepted
//   (`bookletAudience`). An accepted booklet cannot be withdrawn, and a
//   withdrawal voids the booklet's pending envelopes in its own batch.
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import type { Env } from '../types';
import { SUBSCRIPTION_BOOKLET_PARTS, type BookletPart } from './legalDocFormat';
import { getTemplate } from './legalTemplateStore';
import type { PaperInput, PaperPartInput } from './legalPaper';

export const BOOKLET_FUND_SLUG = 'spinout-fund-i';

/** Parts whose store body the booklet prints: the cover's legend, Parts 3 to 7, and Part 9. */
const READ_PARTS = new Set([1, 3, 4, 5, 6, 7, 9]);
/** Parts whose task items are the applicant's fields: Parts 3 to 7. Part 8 prints no LPA body. */
const FIELD_PARTS = new Set([3, 4, 5, 6, 7]);

export class BookletRefusal extends Error {
  status: number;
  code: string;
  publicMessage: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.publicMessage = message;
    this.extra = extra;
  }
}

export interface BookletField {
  id: string;
  part: number;
  text: string;
  /** #1866: the nearest heading above the item in the same body, or null. Screen only. */
  group: string | null;
}

export interface ResolvedPart {
  part: number;
  title: string;
  slug: string | null;
  version: number | null;
  body_sha256: string | null;
  /** True when a part the booklet reads has no usable body yet. */
  missing: boolean;
  fields: BookletField[];
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON with sorted object keys, so the same value always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const TASK_ITEM = /^\s*[-*+]\s+\[[ xX]\]\s+(.*\S)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/** The task items of one part's body, as fields with stable ids. */
export async function bookletFields(slug: string, body: string, part = 0): Promise<BookletField[]> {
  const out: BookletField[] = [];
  let n = 0;
  let group: string | null = null;
  for (const line of String(body || '').replace(/\r\n?/g, '\n').split('\n')) {
    const h = line.match(HEADING);
    if (h) { group = h[1].trim() || null; continue; }
    const m = line.match(TASK_ITEM);
    if (!m) continue;
    n++;
    const text = m[1];
    out.push({ id: `${slug}:${n}:${(await sha256Hex(text)).slice(0, 12)}`, part, text, group });
  }
  return out;
}

/** The nine parts, resolved against the store. */
export async function resolveParts(env: Env): Promise<ResolvedPart[]> {
  const out: ResolvedPart[] = [];
  for (const p of SUBSCRIPTION_BOOKLET_PARTS as readonly BookletPart[]) {
    if (!p.slug || !READ_PARTS.has(p.part)) {
      out.push({ part: p.part, title: p.title, slug: p.slug, version: null, body_sha256: null, missing: false, fields: [] });
      continue;
    }
    const tpl = await getTemplate(env, p.slug);
    const body = tpl && !tpl.is_stub ? String(tpl.body_md || '') : '';
    const missing = !tpl || !!tpl.is_stub || body.trim() === '';
    out.push({
      part: p.part,
      title: p.title,
      slug: p.slug,
      version: tpl ? Number(tpl.version) : null,
      body_sha256: missing ? null : await sha256Hex(body),
      missing,
      fields: !missing && FIELD_PARTS.has(p.part) ? await bookletFields(p.slug, body, p.part) : [],
    });
  }
  return out;
}

export interface BookletRow {
  id: number;
  uid: string;
  application_id: number;
  status: 'open' | 'submitted' | 'withdrawn';
  frozen_json: string | null;
  digest: string | null;
  submitted_at: string | null;
  withdrawn_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** The applicant's approved Fund I application, or null (the routes answer 404). */
export async function approvedApplication(env: Env, userId: number): Promise<{ id: number } | null> {
  return env.DB.prepare(
    `SELECT id FROM lp_applications WHERE user_id = ? AND fund_slug = 'spinout-fund-i' AND status = 'approved'
      ORDER BY id DESC LIMIT 1`,
  ).bind(userId).first<{ id: number }>();
}

async function liveBooklet(env: Env, applicationId: number): Promise<BookletRow | null> {
  return env.DB.prepare(
    `SELECT id, uid, application_id, status, frozen_json, digest, submitted_at, withdrawn_reason, created_at, updated_at
       FROM fund_subscription_booklets WHERE application_id = ? AND status <> 'withdrawn'`,
  ).bind(applicationId).first<BookletRow>();
}

export async function bookletByUid(env: Env, uid: string): Promise<BookletRow | null> {
  return env.DB.prepare(
    `SELECT id, uid, application_id, status, frozen_json, digest, submitted_at, withdrawn_reason, created_at, updated_at
       FROM fund_subscription_booklets WHERE uid = ?`,
  ).bind(uid).first<BookletRow>();
}

const notFound = () => new BookletRefusal(404, 'booklet_not_found', 'No subscription booklet here.');

/** The caller's live booklet, or 404 when they have no approved application or no booklet. */
export async function mineOrNull(env: Env, userId: number): Promise<BookletRow | null> {
  const app = await approvedApplication(env, userId);
  if (!app) throw notFound();
  return liveBooklet(env, app.id);
}

/** Open the caller's booklet, or return the one already open or submitted. */
export async function openBooklet(env: Env, userId: number): Promise<{ booklet: BookletRow; created: boolean }> {
  const app = await approvedApplication(env, userId);
  if (!app) throw notFound();
  const existing = await liveBooklet(env, app.id);
  if (existing) return { booklet: existing, created: false };
  // The partial UNIQUE index keeps one live booklet per application, so two
  // concurrent opens land one row; the loser reads the winner's.
  await env.DB.prepare(
    `INSERT INTO fund_subscription_booklets (uid, application_id, fund_slug, status)
     SELECT ?, ?, 'spinout-fund-i', 'open'
      WHERE NOT EXISTS (SELECT 1 FROM fund_subscription_booklets WHERE application_id = ? AND status <> 'withdrawn')`,
  ).bind(crypto.randomUUID(), app.id, app.id).run();
  const booklet = await liveBooklet(env, app.id);
  if (!booklet) throw new BookletRefusal(503, 'booklet_unreadable', 'The booklet could not be opened. Try again.');
  return { booklet, created: true };
}

async function ticksOf(env: Env, bookletId: number): Promise<Map<string, boolean>> {
  const rows = await env.DB.prepare(
    'SELECT field_id, checked FROM fund_booklet_answers WHERE booklet_id = ? ORDER BY field_id',
  ).bind(bookletId).all<{ field_id: string; checked: number }>();
  return new Map((rows.results || []).map((r) => [r.field_id, Number(r.checked) === 1]));
}

/** What the applicant sees and signs off on: the parts' identities and the ticks of current fields. */
function frozenOf(parts: ResolvedPart[], ticks: Map<string, boolean>) {
  const fieldIds = parts.flatMap((p) => p.fields.map((f) => f.id)).sort();
  return {
    parts: parts.map((p) => ({ part: p.part, slug: p.slug, version: p.version, body_sha256: p.body_sha256 })),
    ticks: fieldIds.map((id) => [id, ticks.get(id) === true]),
  };
}

export interface BookletView {
  uid: string;
  status: BookletRow['status'];
  submitted_at: string | null;
  digest: string;
  parts: Array<Omit<ResolvedPart, 'fields'> & { fields: Array<BookletField & { checked: boolean }> }>;
  missing_parts: number[];
  /** D759 — v[N]: this booklet's place among its application's booklets. */
  edition: number;
  signing: { state: SigningState; signed_at: string | null; accepted_at: string | null };
}

// ── Signing (D759) ──────────────────────────────────────────────────────────

export type SigningState = 'not_sent' | 'sent' | 'awaiting_gp' | 'accepted' | 'void';

export interface BookletStageRow {
  stage: 'applicant' | 'gp';
  envelope_uuid: string;
  envelope_id: number | null;
  status: string | null;
  signed_at: string | null;
}

/** The booklet's envelope links (migration 485), each with its envelope's state. */
export async function bookletStages(env: Env, bookletId: number): Promise<BookletStageRow[]> {
  const rows = await env.DB.prepare(
    `SELECT f.stage, f.envelope_uuid, e.id AS envelope_id, e.status,
            (SELECT MAX(r.signed_at) FROM esign_recipients r WHERE r.envelope_id = e.id AND r.status = 'signed') AS signed_at
       FROM fund_booklet_envelopes f LEFT JOIN esign_envelopes e ON e.envelope_uuid = f.envelope_uuid
      WHERE f.booklet_id = ? ORDER BY f.id`,
  ).bind(bookletId).all<BookletStageRow>();
  return rows.results || [];
}

const isVoid = (status: string | null) => status === 'void' || status === 'voided';

/** Decision 9's state: not_sent, sent, awaiting_gp, accepted or void. */
export async function bookletSigning(env: Env, booklet: BookletRow): Promise<BookletView['signing'] & { gp_sent: boolean }> {
  const stages = await bookletStages(env, booklet.id);
  const applicant = stages.find((s) => s.stage === 'applicant') || null;
  const gp = stages.find((s) => s.stage === 'gp') || null;
  const signedAt = applicant?.status === 'completed' ? applicant.signed_at : null;
  const acceptedAt = gp?.status === 'completed' ? gp.signed_at : null;
  let state: SigningState;
  if (stages.some((s) => isVoid(s.status))) state = 'void';
  else if (!applicant) state = 'not_sent';
  else if (applicant.status !== 'completed') state = 'sent';
  else if (gp?.status === 'completed') state = 'accepted';
  else state = 'awaiting_gp';
  return { state, signed_at: signedAt, accepted_at: acceptedAt, gp_sent: !!gp };
}

/** Decision 3's v[N]: booklets are never deleted, so the count is stable. */
export async function bookletEdition(env: Env, booklet: BookletRow): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM fund_subscription_booklets WHERE application_id = ? AND id <= ?',
  ).bind(booklet.application_id, booklet.id).first<{ n: number }>();
  return Number(row?.n || 1);
}

/** The map's audience (decision 4): the receiving accounts print only once the General Partner has accepted. */
export async function bookletAudience(env: Env, booklet: BookletRow): Promise<'issued' | 'preview'> {
  if (booklet.status !== 'submitted') return 'preview';
  return (await bookletSigning(env, booklet)).state === 'accepted' ? 'issued' : 'preview';
}

/** The booklet as the applicant (or an admin) reads it, with the digest of what it shows. */
export async function bookletView(env: Env, booklet: BookletRow): Promise<BookletView> {
  const parts = await resolveParts(env);
  const ticks = await ticksOf(env, booklet.id);
  const digest = booklet.status === 'submitted' && booklet.digest
    ? booklet.digest
    : await sha256Hex(canonicalJson(frozenOf(parts, ticks)));
  const { state, signed_at, accepted_at } = await bookletSigning(env, booklet);
  return {
    uid: booklet.uid,
    status: booklet.status,
    submitted_at: booklet.submitted_at,
    digest,
    parts: parts.map((p) => ({ ...p, fields: p.fields.map((f) => ({ ...f, checked: ticks.get(f.id) === true })) })),
    missing_parts: parts.filter((p) => p.missing).map((p) => p.part),
    edition: await bookletEdition(env, booklet),
    signing: { state, signed_at, accepted_at },
  };
}

export interface Answer { field_id: string; checked: boolean }

export function readAnswers(body: unknown): Answer[] {
  const list = (body as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(list) || list.length === 0 || list.length > 500) {
    throw new BookletRefusal(400, 'answers_invalid', 'Send answers as a list of { field_id, checked }.');
  }
  return list.map((a) => {
    const id = typeof (a as any)?.field_id === 'string' ? (a as any).field_id : '';
    if (!id || id.length > 120 || typeof (a as any)?.checked !== 'boolean') {
      throw new BookletRefusal(400, 'answers_invalid', 'Send answers as a list of { field_id, checked }.');
    }
    return { field_id: id, checked: (a as any).checked };
  });
}

/** Store ticks on the caller's open booklet. An id that is not a current field is refused. */
export async function answerBooklet(env: Env, booklet: BookletRow, userId: number, answers: Answer[]): Promise<void> {
  if (booklet.status !== 'open') throw new BookletRefusal(409, 'booklet_not_open', 'This booklet is no longer open, so its answers cannot change.');
  const parts = await resolveParts(env);
  const known = new Set(parts.flatMap((p) => p.fields.map((f) => f.id)));
  const unknown = answers.filter((a) => !known.has(a.field_id)).map((a) => a.field_id);
  if (unknown.length) {
    throw new BookletRefusal(400, 'field_unknown', 'An answer names a field the booklet does not have. Reload the booklet and answer again.', { fields: unknown.length });
  }
  await env.DB.batch(answers.map((a) => env.DB.prepare(
    `INSERT INTO fund_booklet_answers (booklet_id, field_id, checked, answered_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (booklet_id, field_id) DO UPDATE SET checked = excluded.checked, answered_by = excluded.answered_by, updated_at = excluded.updated_at`,
  ).bind(booklet.id, a.field_id, a.checked ? 1 : 0, userId)));
}

/** Freeze the booklet under the digest the applicant saw. */
export async function submitBooklet(env: Env, booklet: BookletRow, digest: unknown): Promise<{ digest: string; submitted_at: string }> {
  if (booklet.status !== 'open') throw new BookletRefusal(409, 'booklet_not_open', 'This booklet is no longer open, so it cannot be submitted again.');
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new BookletRefusal(400, 'digest_invalid', 'Send the digest of the booklet you read.');
  }
  const parts = await resolveParts(env);
  const missing = parts.filter((p) => p.missing).map((p) => p.part);
  if (missing.length) {
    throw new BookletRefusal(409, 'booklet_part_missing',
      `The booklet cannot be submitted yet: Part ${missing.join(', Part ')} has no text from counsel.`, { parts: missing });
  }
  const frozen = frozenOf(parts, await ticksOf(env, booklet.id));
  const current = await sha256Hex(canonicalJson(frozen));
  if (current !== digest) {
    throw new BookletRefusal(409, 'content_changed', 'The booklet changed since you read it. Read it again, then submit.');
  }
  const at = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE fund_subscription_booklets SET status = 'submitted', frozen_json = ?, digest = ?, submitted_at = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'open'`,
  ).bind(canonicalJson(frozen), current, at, booklet.id).run();
  if (!(res.meta?.changes && res.meta.changes > 0)) {
    throw new BookletRefusal(409, 'booklet_not_open', 'This booklet is no longer open, so it cannot be submitted again.');
  }
  return { digest: current, submitted_at: at };
}

/** The admin list: no ticks. */
export async function listBooklets(env: Env): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare(
    `SELECT b.uid, b.status, b.submitted_at, b.created_at, b.updated_at, a.user_id, a.investor_type
       FROM fund_subscription_booklets b JOIN lp_applications a ON a.id = b.application_id
      ORDER BY b.id DESC LIMIT 500`,
  ).all<Record<string, unknown>>();
  return rows.results || [];
}

/** Withdraw a booklet with a reason, so the applicant can open a new one. */
export async function withdrawBooklet(env: Env, booklet: BookletRow, adminId: number, reason: unknown): Promise<void> {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 10 || text.length > 200) {
    throw new BookletRefusal(400, 'reason_invalid', 'Give a reason of 10 to 200 characters for the withdrawal.');
  }
  if (booklet.status === 'withdrawn') throw new BookletRefusal(409, 'booklet_withdrawn', 'This booklet is already withdrawn.');
  const accepted = () => new BookletRefusal(409, 'booklet_accepted', 'This booklet is accepted by the General Partner, so it cannot be withdrawn.');
  if ((await bookletSigning(env, booklet)).state === 'accepted') throw accepted();
  // D759 — one batch: the withdrawal (never of an accepted booklet, checked in
  // the statement itself, so a GP signature landing meanwhile wins) and the
  // voiding of the booklet's PENDING envelopes, so the next booklet's send
  // does not meet D410's one-pending key. A completed envelope is evidence
  // and is never touched.
  const [res] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE fund_subscription_booklets SET status = 'withdrawn', withdrawn_by = ?, withdrawn_reason = ?, updated_at = datetime('now')
        WHERE id = ? AND status <> 'withdrawn'
          AND NOT EXISTS (SELECT 1 FROM fund_booklet_envelopes f JOIN esign_envelopes e ON e.envelope_uuid = f.envelope_uuid
                           WHERE f.booklet_id = ? AND f.stage = 'gp' AND e.status = 'completed')`,
    ).bind(adminId, text, booklet.id, booklet.id),
    env.DB.prepare(
      `UPDATE esign_envelopes SET status = 'void'
        WHERE status IN ('sent', 'partially_signed')
          AND envelope_uuid IN (SELECT envelope_uuid FROM fund_booklet_envelopes WHERE booklet_id = ?)
          AND EXISTS (SELECT 1 FROM fund_subscription_booklets WHERE id = ? AND status = 'withdrawn')`,
    ).bind(booklet.id, booklet.id),
  ]);
  if (!(res.meta?.changes && res.meta.changes > 0)) {
    if ((await bookletSigning(env, booklet)).state === 'accepted') throw accepted();
    throw new BookletRefusal(409, 'booklet_withdrawn', 'This booklet is already withdrawn.');
  }
}


// ── The paper ───────────────────────────────────────────────────────────────

export const BOOKLET_TITLE = 'Subscription Booklet';
/** Part 2's closing line (decision 8). */
export const PART_TWO_CLOSE = 'Send no money until you receive a Capital Call Notice.';

/** A part's body with each task item ticked or emptied by its field id. */
export async function tickedBody(slug: string, body: string, ticks: Map<string, boolean>): Promise<string> {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_ITEM);
    if (!m) continue;
    n++;
    const id = `${slug}:${n}:${(await sha256Hex(m[1])).slice(0, 12)}`;
    lines[i] = lines[i].replace(/\[[ xX]\]/, ticks.get(id) === true ? '[x]' : '[ ]');
  }
  return lines.join('\n');
}

/** Part 2, generated from the part list. */
function partTwoBody(): string {
  return SUBSCRIPTION_BOOKLET_PARTS.filter((p) => p.part >= 3 && p.part <= 8)
    .map((p) => `Complete Part ${p.part}, ${p.title}.`).concat(PART_TWO_CLOSE).join('\n\n');
}

/** The applicant's printed name: the legal name they recorded, else their account name. */
export async function applicantName(env: Env, applicationId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT u.full_legal_name, u.name FROM lp_applications a JOIN users u ON u.id = a.user_id WHERE a.id = ?',
  ).bind(applicationId).first<{ full_legal_name: string | null; name: string | null }>();
  const name = (row?.full_legal_name || row?.name || '').trim();
  return name || null;
}

/**
 * D759 — a part's body at the version frozen at submit: the live row when its
 * version is that one, else the snapshot an edit took before bumping it
 * (`legal_template_versions`, legalTemplateStore.ts). Null when neither has it.
 */
export async function bodyAtVersion(env: Env, slug: string, version: number): Promise<string | null> {
  const live = await getTemplate(env, slug);
  if (live && Number(live.version) === Number(version)) return String(live.body_md || '');
  const old = await env.DB.prepare(
    'SELECT body_md FROM legal_template_versions WHERE slug = ? AND version = ? ORDER BY id DESC LIMIT 1',
  ).bind(slug, version).first<{ body_md: string }>();
  return old ? String(old.body_md) : null;
}

const textChanged = (parts: number[]) => new BookletRefusal(409, 'booklet_text_changed',
  'The text you submitted can no longer be rebuilt exactly, so it cannot be signed. Ask Axal VC to withdraw the booklet so you can open a new one.',
  { parts });

/**
 * D759 — a submitted booklet's bodies as frozen: each part the booklet reads,
 * at its frozen version, whose SHA-256 must be the frozen hash, ticked with
 * the frozen ticks. A missing version or a different hash is 409
 * `booklet_text_changed`, naming the parts.
 */
export async function frozenBodies(env: Env, booklet: BookletRow): Promise<Map<number, string>> {
  const frozen = JSON.parse(String(booklet.frozen_json || '{}')) as {
    parts?: Array<{ part: number; slug: string | null; version: number | null; body_sha256: string | null }>;
    ticks?: Array<[string, boolean]>;
  };
  const ticks = new Map((frozen.ticks || []).map(([id, checked]) => [id, checked === true] as [string, boolean]));
  const bodies = new Map<number, string>();
  const changed: number[] = [];
  for (const p of frozen.parts || []) {
    if (!p.slug || !READ_PARTS.has(p.part) || !p.body_sha256 || p.version == null) continue;
    const body = await bodyAtVersion(env, p.slug, p.version);
    if (body === null || await sha256Hex(body) !== p.body_sha256) { changed.push(p.part); continue; }
    bodies.set(p.part, await tickedBody(p.slug, body, ticks));
  }
  if (changed.length) throw textChanged(changed);
  return bodies;
}

/** Signatures on a booklet's parts, by the party's role (D759). */
export type BookletSignatures = NonNullable<PaperPartInput['signed']>;

/**
 * The one part assembly both papers share: the nine parts in order, each
 * with its body, its stub flag and its own block, and the signatures when the
 * paper is a signed one.
 */
export function bookletParts(opts: {
  bodies: Map<number, string>;
  missing: (part: number) => boolean;
  applicant: string | null;
  signed?: BookletSignatures | null;
}): PaperPartInput[] {
  return (SUBSCRIPTION_BOOKLET_PARTS as readonly BookletPart[]).map((p) => ({
    n: p.part,
    title: p.title,
    body: p.part === 2 ? partTwoBody() : opts.bodies.get(p.part) ?? null,
    missing: READ_PARTS.has(p.part) && p.part !== 1 && opts.missing(p.part),
    block: p.block ? { kind: p.block.kind, axalEntityKey: p.block.axalEntityKey } : null,
    counterpartyName: opts.applicant,
    footer: `${BOOKLET_TITLE} · Part ${p.part}`,
    ...(opts.signed && p.block ? { signed: opts.signed } : {}),
  }));
}

/**
 * The booklet as #1776's paper reads it: the cover's legend as the body, and
 * the nine parts. A part with no text from counsel prints the stub sentence,
 * and the paper is then a Draft. A submitted booklet prints its frozen text
 * (D759), so the paper never drifts from what the applicant ticked.
 */
export async function bookletPaperInput(env: Env, booklet: BookletRow, signed?: BookletSignatures | null): Promise<PaperInput> {
  const applicant = await applicantName(env, booklet.application_id);
  // Frozen at submit (a withdrawn booklet keeps its frozen copy, which its completed envelopes print).
  const frozen = !!booklet.frozen_json && !!booklet.digest;
  let bodies: Map<number, string>;
  let missing: number[];
  let digest: string;
  if (frozen) {
    bodies = await frozenBodies(env, booklet);
    missing = [];
    digest = booklet.digest as string;
  } else {
    const view = await bookletView(env, booklet);
    const ticks = new Map(view.parts.flatMap((p) => p.fields.map((f) => [f.id, f.checked] as [string, boolean])));
    bodies = new Map<number, string>();
    for (const p of view.parts) {
      if (!p.slug || p.missing || !READ_PARTS.has(p.part)) continue;
      const tpl = await getTemplate(env, p.slug);
      bodies.set(p.part, await tickedBody(p.slug, String(tpl?.body_md || ''), ticks));
    }
    missing = view.missing_parts;
    digest = view.digest;
  }
  const parts = bookletParts({ bodies, missing: (n) => missing.includes(n), applicant, signed });
  const date = (booklet.submitted_at || new Date().toISOString()).slice(0, 10);
  return {
    title: BOOKLET_TITLE,
    body: bodies.get(1) ?? '',
    slug: 'subscription_booklet',
    bodySha256: digest,
    state: { kind: missing.length ? 'draft' : 'issued' },
    copyNumber: booklet.uid,
    offeree: applicant,
    effectiveDate: date,
    audit: frozen && booklet.digest
      ? `Booklet ${booklet.uid} · digest ${booklet.digest.slice(0, 12)}`
      : `Booklet ${booklet.uid} · digest assigned when submitted`,
    parts,
  };
}
