/**
 * D1075 (#2967, part 3 of #2425) — the public trust center's content store
 * (migration 584): seven blocks with a draft and a published copy, one
 * change note per Publish, the subprocessors, and the public matrix.
 *
 * WHAT VISITORS READ IS THE PUBLISHED COPY, NOTHING ELSE. A draft is HQ's
 * until a Super Admin presses Publish (`routes/admin_trust_center.ts`). A
 * block the store holds no published copy of reads as `null`, and the page
 * keeps its own "Not recorded" line for it (D1072 §3), never an empty block
 * passed off as content.
 *
 * THE BLOCKS ARE THE CANVAS'S (TRU14). Six hold groups of lines: a fact the
 * code shows, or a gap with the reason it is a gap. The seventh,
 * Certifications, holds certifications, and each one names its auditor's
 * report, which must be on file (`trust_certification_reports`). An empty
 * Certifications block is "None held".
 *
 * PUBLISH IS ONE BATCH. Every draft block goes live, every drafted
 * subprocessor is listed, every removal is applied, and one row joins the
 * change log, in a single D1 batch, so a visitor never reads half a publish.
 * A new subprocessor starts no sooner than ten days after Publish
 * (`NOTICE_DAYS`, the draft DPA's notice), so subscribers hear first.
 */
import type { Env } from '../types';
import { obligationsForRole } from './trust';

export const BLOCK_KEYS = ['glance', 'security', 'data', 'subprocessors', 'certifications', 'documents', 'disclosure'] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];

/** The block names TRU14's list draws. */
export const BLOCK_LABELS: Record<BlockKey, string> = {
  glance: 'At a glance',
  security: 'Security',
  data: 'Data and privacy',
  subprocessors: 'Subprocessors',
  certifications: 'Certifications',
  documents: 'Documents',
  disclosure: 'Disclosure',
};

/** Days between Publish and the day a new subprocessor may start (the draft DPA's ten days). */
export const NOTICE_DAYS = 10;
export const NOTE_MIN = 10;
export const NOTE_MAX = 1000;
export const CHANGES_READ_MAX = 200;

export const isBlockKey = (k: unknown): k is BlockKey => typeof k === 'string' && (BLOCK_KEYS as readonly string[]).includes(k);

/** Today, UTC, as YYYY-MM-DD. */
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const newUid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

/** Each refusal's sentence, by code. */
export const CONTENT_REFUSALS = {
  bad_block: 'There is no such block.',
  body_required: 'Send the block as an object.',
  bad_body: 'The block is not in the shape this store keeps.',
  text_required: 'Every line needs its words.',
  text_too_long: 'A line is at most 500 characters.',
  why_required: 'A line that is not recorded says why.',
  too_many: 'A block holds at most 20 groups of 40 lines.',
  bad_checked_at: 'A checked date is a real day, written YYYY-MM-DD, and not in the future.',
  certification_fields: 'A certification needs its name, its auditor and the day it was issued.',
  report_required: 'A certification cannot be saved without its auditor\'s report on file.',
  report_unknown: 'That auditor\'s report is not on file. Attach it first.',
  bad_expiry: 'A certification expires after it was issued.',
  note_required: `Publishing needs a change note of ${NOTE_MIN} to ${NOTE_MAX} characters. It appears under Changes to this page.`,
  nothing_to_publish: 'There is nothing to publish: no block or subprocessor has a draft.',
  subprocessor_fields: 'A subprocessor needs its name, what it does for us, the data it sees and where it is.',
  bad_starts_at: 'A start date is a real day, written YYYY-MM-DD.',
  not_draft: 'Only a draft can be changed here.',
  not_found: 'There is no such subprocessor.',
  not_removing: 'This subprocessor is not being removed.',
  cannot_remove: 'This subprocessor is already off the list.',
} as const;
export type ContentRefusal = keyof typeof CONTENT_REFUSALS;

type Ok<T> = { ok: true; value: T };
type No = { ok: false; code: ContentRefusal };
const no = (code: ContentRefusal): No => ({ ok: false, code });

export type Line = { text: string; recorded: boolean; why: string | null; checked_at: string | null };
export type Group = { title: string | null; lines: Line[] };
export type LinesBody = { intro: string | null; groups: Group[] };
export type Certification = { name: string; auditor: string; issued_on: string; expires_on: string | null; report_uid: string };
export type CertificationsBody = { items: Certification[] };
export type BlockBody = LinesBody | CertificationsBody;

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};
const optStr = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return null;
  return str(v, max) ?? undefined;
};
const notFuture = (v: unknown, now: number) => isDay(v) && v <= today(now);

/** A checked date: null (Not recorded), or a real day that is not in the future. */
export function parseCheckedAt(v: unknown, now = Date.now()): Ok<string | null> | No {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  return notFuture(v, now) ? { ok: true, value: v as string } : no('bad_checked_at');
}

/**
 * A block's body, checked. `reportExists` says whether a report uid is on
 * file; only Certifications asks it.
 */
export async function parseBody(
  key: BlockKey, raw: unknown, reportExists: (uid: string) => Promise<boolean>, now = Date.now(),
): Promise<Ok<BlockBody> | No> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('body_required');
  const body = raw as Record<string, unknown>;
  if (key === 'certifications') {
    if (Object.keys(body).some((k) => k !== 'items') || !Array.isArray(body.items)) return no('bad_body');
    if (body.items.length > 20) return no('too_many');
    const items: Certification[] = [];
    for (const it of body.items as unknown[]) {
      if (!it || typeof it !== 'object') return no('bad_body');
      const c = it as Record<string, unknown>;
      const name = str(c.name, 120), auditor = str(c.auditor, 120);
      if (!name || !auditor || !isDay(c.issued_on)) return no('certification_fields');
      if (!notFuture(c.issued_on, now)) return no('bad_checked_at');
      if (c.expires_on != null && c.expires_on !== '' && (!isDay(c.expires_on) || (c.expires_on as string) <= (c.issued_on as string))) return no('bad_expiry');
      const report = typeof c.report_uid === 'string' ? c.report_uid.trim() : '';
      if (!report) return no('report_required');
      if (!/^tcr_[0-9a-f]{20}$/.test(report) || !(await reportExists(report))) return no('report_unknown');
      items.push({ name, auditor, issued_on: c.issued_on as string, expires_on: (c.expires_on as string) || null, report_uid: report });
    }
    return { ok: true, value: { items } };
  }
  if (Object.keys(body).some((k) => k !== 'intro' && k !== 'groups') || !Array.isArray(body.groups)) return no('bad_body');
  const intro = optStr(body.intro, 1000);
  if (intro === undefined) return no('text_too_long');
  if (body.groups.length > 20) return no('too_many');
  const groups: Group[] = [];
  for (const g of body.groups as unknown[]) {
    if (!g || typeof g !== 'object' || !Array.isArray((g as any).lines)) return no('bad_body');
    const title = optStr((g as any).title, 120);
    if (title === undefined) return no('text_too_long');
    const raws = (g as any).lines as unknown[];
    if (raws.length > 40) return no('too_many');
    const lines: Line[] = [];
    for (const l of raws) {
      if (!l || typeof l !== 'object') return no('bad_body');
      const x = l as Record<string, unknown>;
      if (typeof x.text !== 'string' || !x.text.trim()) return no('text_required');
      if (x.text.trim().length > 500) return no('text_too_long');
      if (typeof x.recorded !== 'boolean') return no('bad_body');
      const why = optStr(x.why, 300);
      if (why === undefined) return no('text_too_long');
      if (!x.recorded && !why) return no('why_required');
      const checked = parseCheckedAt(x.checked_at, now);
      if (!checked.ok) return checked;
      lines.push({ text: x.text.trim(), recorded: x.recorded, why: x.recorded ? null : why, checked_at: x.recorded ? checked.value : null });
    }
    groups.push({ title, lines });
  }
  return { ok: true, value: { intro, groups } };
}

/** Whether a report uid is on file. */
export async function reportOnFile(env: Env, uid: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM trust_certification_reports WHERE uid = ?').bind(uid).first());
}

/** A published body as visitors read it: a certification says its report is on file, never its uid. */
export function publicBody(key: BlockKey, body: BlockBody): unknown {
  if (key !== 'certifications') return body;
  return { items: (body as CertificationsBody).items.map(({ report_uid: _r, ...c }) => ({ ...c, report_on_file: true })) };
}

const parseJson = (s: string | null | undefined) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

type BlockRow = { key: BlockKey; state: 'draft' | 'published'; body_json: string; checked_at: string | null; published_at: string | null; change_uid: string | null; change_note: string | null; updated_at: string };

/** Every block, by key, in one state. A key with no row is `null`. */
export async function blocksIn(env: Env, state: 'draft' | 'published') {
  const rows = (await env.DB.prepare(
    `SELECT key, state, body_json, checked_at, published_at, change_uid, change_note, updated_at
       FROM trust_content_blocks WHERE state = ?`,
  ).bind(state).all<BlockRow>()).results || [];
  const out = {} as Record<BlockKey, null | { key: BlockKey; label: string; body: BlockBody; checked_at: string | null; published_at: string | null; change_uid: string | null; updated_at: string }>;
  for (const k of BLOCK_KEYS) out[k] = null;
  for (const r of rows) {
    if (!isBlockKey(r.key)) continue;
    const body = parseJson(r.body_json);
    if (!body) continue;
    out[r.key] = { key: r.key, label: BLOCK_LABELS[r.key], body, checked_at: r.checked_at, published_at: r.published_at, change_uid: r.change_uid, updated_at: r.updated_at };
  }
  return out;
}

export type SubprocessorRow = {
  id: number; uid: string; name: string; purpose: string; data_seen: string; location: string;
  state: 'draft' | 'published' | 'removing' | 'removed'; starts_at: string | null; published_at: string | null; removed_at: string | null;
  created_at: string; updated_at: string;
};


/** The subprocessors visitors see: published, and those being removed until the removal is published. */
export async function publicSubprocessors(env: Env, now = Date.now()) {
  const rows = (await env.DB.prepare(
    `SELECT id, uid, name, purpose, data_seen, location, state, starts_at, published_at, removed_at, created_at, updated_at FROM trust_subprocessors WHERE state IN ('published', 'removing') ORDER BY starts_at, name, id`,
  ).all<SubprocessorRow>()).results || [];
  const day = today(now);
  const last = await env.DB.prepare(
    `SELECT MAX(at) AS at FROM (SELECT MAX(published_at) AS at FROM trust_subprocessors WHERE published_at IS NOT NULL
                                UNION ALL SELECT MAX(removed_at) FROM trust_subprocessors WHERE removed_at IS NOT NULL)`,
  ).first<{ at: string | null }>();
  return {
    items: rows.map((r) => ({
      uid: r.uid, name: r.name, purpose: r.purpose, data: r.data_seen, location: r.location,
      starts_at: r.starts_at, active: !!r.starts_at && r.starts_at <= day,
    })),
    last_change: last?.at ?? null,
  };
}

/** Every subprocessor, every state, for HQ. */
export async function allSubprocessors(env: Env) {
  return (await env.DB.prepare(`SELECT id, uid, name, purpose, data_seen, location, state, starts_at, published_at, removed_at, created_at, updated_at FROM trust_subprocessors ORDER BY created_at, id`).all<SubprocessorRow>()).results || [];
}

/** The change log, newest first, at most `limit` rows, and whether it was cut. */
export async function changes(env: Env, limit: number) {
  const n = Math.max(1, Math.min(CHANGES_READ_MAX, Math.floor(limit) || 1));
  const rows = (await env.DB.prepare(
    `SELECT uid, published_at, change_note, blocks_json, subprocessors_json
       FROM trust_content_changes ORDER BY published_at DESC, id DESC LIMIT ?`,
  ).bind(n + 1).all<{ uid: string; published_at: string; change_note: string; blocks_json: string; subprocessors_json: string }>()).results || [];
  return {
    items: rows.slice(0, n).map((r) => ({
      uid: r.uid, published_at: r.published_at, note: r.change_note,
      blocks: ((parseJson(r.blocks_json) as string[]) || []).filter(isBlockKey).map((k) => ({ key: k, label: BLOCK_LABELS[k] })),
      subprocessors: (parseJson(r.subprocessors_json) as unknown[]) || [],
    })),
    complete: rows.length <= n,
  };
}

/** A subprocessor's fields from a request: each present one checked; `partial` lets an edit send some. */
export function parseSubprocessor(raw: unknown, partial: boolean, now = Date.now()):
  Ok<{ name?: string; purpose?: string; data_seen?: string; location?: string; starts_at?: string | null }> | No {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('subprocessor_fields');
  const b = raw as Record<string, unknown>;
  const out: { name?: string; purpose?: string; data_seen?: string; location?: string; starts_at?: string | null } = {};
  const fields: Array<[keyof typeof out, string, number]> = [['name', 'name', 120], ['purpose', 'purpose', 300], ['data_seen', 'data', 300], ['location', 'location', 120]];
  for (const [col, field, max] of fields) {
    if (b[field] === undefined) { if (!partial) return no('subprocessor_fields'); continue; }
    const v = str(b[field], max);
    if (!v) return no('subprocessor_fields');
    (out as any)[col] = v;
  }
  if (b.starts_at !== undefined && b.starts_at !== null && b.starts_at !== '') {
    if (!isDay(b.starts_at) || (b.starts_at as string) < today(now)) return no('bad_starts_at');
    out.starts_at = b.starts_at as string;
  } else if (b.starts_at === null || b.starts_at === '') out.starts_at = null;
  return { ok: true, value: out };
}

export function parseNote(v: unknown): Ok<string> | No {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length >= NOTE_MIN && t.length <= NOTE_MAX ? { ok: true, value: t } : no('note_required');
}

export type PublishResult = {
  uid: string; published_at: string;
  blocks: BlockKey[];
  added: Array<{ uid: string; name: string; starts_at: string }>;
  removed: Array<{ uid: string; name: string }>;
};

/**
 * Publish every draft with one note, in one batch. Refuses when there is
 * nothing to publish. Each draft block is copied live as it stands at
 * commit (`INSERT … SELECT`), so a concurrent second Publish finds no draft
 * and copies nothing.
 */
export async function publish(env: Env, userId: number, note: string, now = Date.now()): Promise<Ok<PublishResult> | No> {
  const drafts = ((await env.DB.prepare(`SELECT key FROM trust_content_blocks WHERE state = 'draft'`).all<{ key: string }>()).results || [])
    .map((r) => r.key).filter(isBlockKey);
  const subs = (await env.DB.prepare(
    `SELECT uid, name, state, starts_at FROM trust_subprocessors WHERE state IN ('draft', 'removing') ORDER BY id`,
  ).all<{ uid: string; name: string; state: string; starts_at: string | null }>()).results || [];
  if (!drafts.length && !subs.length) return no('nothing_to_publish');

  const uid = newUid('tcc');
  const at = new Date(now).toISOString();
  const earliest = addDays(today(now), NOTICE_DAYS);
  const added = subs.filter((s) => s.state === 'draft')
    .map((s) => ({ uid: s.uid, name: s.name, starts_at: s.starts_at && s.starts_at > earliest ? s.starts_at : earliest }));
  const removed = subs.filter((s) => s.state === 'removing').map((s) => ({ uid: s.uid, name: s.name }));
  const log = [...added.map((s) => ({ action: 'added', ...s })), ...removed.map((s) => ({ action: 'removed', ...s }))];

  const stmts = [
    env.DB.prepare(
      `INSERT INTO trust_content_changes (uid, published_at, published_by, change_note, blocks_json, subprocessors_json) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(uid, at, userId, note, JSON.stringify(drafts), JSON.stringify(log)),
  ];
  for (const key of drafts) {
    stmts.push(env.DB.prepare(
      `INSERT OR REPLACE INTO trust_content_blocks (key, state, body_json, checked_at, published_at, published_by, change_note, change_uid, updated_at, updated_by)
       SELECT key, 'published', body_json, checked_at, ?, ?, ?, ?, datetime('now'), updated_by
         FROM trust_content_blocks WHERE key = ? AND state = 'draft'`,
    ).bind(at, userId, note, uid, key));
    stmts.push(env.DB.prepare(`DELETE FROM trust_content_blocks WHERE key = ? AND state = 'draft'`).bind(key));
  }
  for (const s of added) {
    stmts.push(env.DB.prepare(
      `UPDATE trust_subprocessors SET state = 'published', published_at = ?, starts_at = ?, change_uid = ?, updated_at = datetime('now')
        WHERE uid = ? AND state = 'draft'`,
    ).bind(at, s.starts_at, uid, s.uid));
  }
  for (const s of removed) {
    stmts.push(env.DB.prepare(
      `UPDATE trust_subprocessors SET state = 'removed', removed_at = ?, change_uid = ?, updated_at = datetime('now')
        WHERE uid = ? AND state = 'removing'`,
    ).bind(at, uid, s.uid));
  }
  await env.DB.batch(stmts);
  return { ok: true, value: { uid, published_at: at, blocks: drafts, added, removed } };
}

// ---------------------------------------------------------------------------
// "What we check, and for whom": the public matrix
// ---------------------------------------------------------------------------

/** The profiles the canvas's matrix draws, in its order (TRU1). */
export const MATRIX_PROFILES = [
  { key: 'founder', label: 'Founder' },
  { key: 'investor', label: 'Investor' },
  { key: 'advisor', label: 'Advisor' },
  { key: 'partner', label: 'Operating Partner' },
  { key: 'exploring', label: 'Explorer' },
] as const;

/** Each requirement the matrix names, and the obligation keys behind it. */
export const MATRIX_REQUIREMENTS = [
  { key: 'tos', label: 'Terms of Service', obligations: ['tos_v1'] },
  { key: 'privacy', label: 'Privacy Policy', obligations: ['privacy_v1'] },
  { key: 'role_nda', label: 'Role NDA', obligations: ['founder_nda_v1', 'investor_nda_v1', 'mentor_nda_v1'] },
  { key: 'advisor_disclaimer', label: 'Advisor disclaimer', obligations: ['mentor_disclaimer_v1'] },
  { key: 'identity', label: 'Identity check', obligations: ['kyc_v1'] },
  { key: 'accreditation', label: 'Accreditation', obligations: ['accreditation_v1'] },
  { key: 'entity', label: 'Entity check', obligations: ['kyb_v1'] },
  { key: 'partner_agreement', label: 'Partner agreement', obligations: ['partner_msa_v1'] },
] as const;

const MONTH_MS = (365 * 24 * 60 * 60 * 1000) / 12;

export type MatrixCell = { asked: 'always' | 'when_it_applies'; renews_months: number | null };

/**
 * The matrix, from the obligations the Worker seeds (`obligationsForRole`,
 * `services/trust.ts`), for every profile including Explorer. `null` is a
 * requirement not asked of that profile. A requirement asked of nobody is
 * left out. An obligation no requirement names is a row of its own under its
 * key, so a new obligation is never silently dropped.
 */
export function publicMatrix() {
  const named = new Set<string>(MATRIX_REQUIREMENTS.flatMap((r) => r.obligations as readonly string[]));
  const extra = new Set<string>();
  for (const p of MATRIX_PROFILES) for (const d of obligationsForRole(p.key)) if (!named.has(d.key)) extra.add(d.key);
  const reqs = [...MATRIX_REQUIREMENTS.map((r) => ({ key: r.key as string, label: r.label as string, obligations: [...r.obligations] as string[] })),
    ...[...extra].map((k) => ({ key: k, label: k, obligations: [k] }))];
  const rows = reqs.map((r) => {
    const cells: Record<string, MatrixCell | null> = {};
    for (const p of MATRIX_PROFILES) {
      const d = obligationsForRole(p.key).find((o) => r.obligations.includes(o.key));
      cells[p.key] = d ? { asked: d.required ? 'always' : 'when_it_applies', renews_months: d.ttlMs ? Math.round(d.ttlMs / MONTH_MS) : null } : null;
    }
    return { key: r.key, label: r.label, cells };
  }).filter((r) => Object.values(r.cells).some(Boolean));
  return { profiles: MATRIX_PROFILES.map((p) => ({ ...p })), rows };
}
