/**
 * #4715 (D4715) — Deliverables: what an advisor sends a client and the client's receipt (migration 239).
 *
 * Split out of routes/advisors.ts, which mounts it at the place these routes
 * held there (`advisors.route('/', …)`), so the paths and their order under
 * /api/advisors and /api/mentors are unchanged. Shared rows, checks and money
 * helpers come from services/advisorPractice.ts.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { PracticeRefusal } from '../services/practiceRefusal';
import { logAdminAction } from '../services/adminAudit';
import { type DeliverableRow, type VersionRow, isHttpsLink, hasDocument, versionDto, sentVersionDto, deliverablePage, receivedDeliverables, sendDeliverable, openDeliverable, acceptDeliverable } from '../services/advisorDistribution';
export { deliverableState, readyVersion } from '../services/advisorDistribution';
import { mapError, nowIso, newUid, trimOrNull } from './_t13t14t15_helpers';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';
import { pageWindow } from '../services/listPage';
import {
  PRACTICE_PAGE, requireMyAdvisor, requireOwnEngagement,
} from '../services/advisorPractice';
import { ALLOWED_DECLARED, MAX_UPLOAD_BYTES, sniffType } from './company_documents';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import { putRecord } from '../services/recordStore';
import { eraseRecordObjects } from '../services/recordErasure';

const advisors = new Hono<{ Bindings: Env }>();


// ---------------------------------------------------------------------------
// 239 — Deliverables. What you sent a client, and whether they opened it.
//
// TWO INVARIANTS HOLD THIS WHOLE ZONE UP, and both are here rather than on the
// page, because a page can only report what the routes let it be told.
//
// ONE: NO ROUTE IN THIS FILE WRITES `opened_at`. Migration 208's header states
// the rule this store inherits — "Only the founder side can truthfully say a
// thing was read, so a partner-side write to either would be the firm reporting
// a metric about itself." The founder side writes it, through
// `routes/advisor_grants.ts`. A receipt the advisor can set is not a receipt,
// and three of the four tiles on this zone are receipts.
//
// TWO: SENDING REQUIRES A CLIENT WITH AN ACCOUNT. A version sent to a client
// who cannot sign in can never be opened by anyone, so it would sit in
// `Unopened` forever, inflate `Never opened`, and quietly bias `median to open`
// toward whichever clients happen to be linked. Creating and versioning stay
// open to any client — a draft needs no counterparty — and only the send
// demands one, with a 409 that names what is missing. Same shape as the
// engagement block above refusing signed → ended and naming the renewal route.
//
// STATE IS DERIVED AND THERE IS NO COLUMN FOR IT: `not_started` (nothing sent),
// `sent` (sent, unopened), `opened`. See 239's header for why storing it would
// reproduce D70's `investor_introductions` defect.
// ---------------------------------------------------------------------------
/**
 * #5960 (D5960): a version's body, from JSON or from a multipart form, and its file when one came.
 * A form's text fields read as strings, as JSON's would.
 */
type Incoming = { body: Record<string, any>; file: { name: string; type: string; size: number; bytes: () => Promise<Uint8Array> } | null };
async function readIncoming(c: Context<{ Bindings: Env }>): Promise<Incoming> {
  if (!(c.req.header('content-type') || '').toLowerCase().includes('multipart/form-data')) {
    return { body: await c.req.json().catch(() => ({} as any)), file: null };
  }
  let form: FormData;
  try { form = await c.req.formData(); } catch { throw c.json({ detail: 'The form could not be read.', code: 'form_unreadable' }, 400); }
  const body: Record<string, any> = {};
  let file: Incoming['file'] = null;
  for (const [key, value] of form.entries()) {
    if (key === 'file' && value && typeof value === 'object' && typeof (value as any).arrayBuffer === 'function') {
      const f = value as unknown as { name?: string; type?: string; size?: number; arrayBuffer: () => Promise<ArrayBuffer> };
      file = { name: String(f.name || 'document'), type: String(f.type || ''), size: Number(f.size ?? 0), bytes: async () => new Uint8Array(await f.arrayBuffer()) };
    } else if (typeof value === 'string') body[key] = value;
  }
  return { body, file };
}

type StoredFile = { key: string; name: string; type: string; size: number; sha256: string | null };

/**
 * #5960 (D5960): checks a version's file, then puts its bytes in R2 `FILES`. The checks are
 * `company_documents.ts`'s: at most 10 MB, not empty, and a PDF, JPEG or PNG by its first bytes (a declared type
 * outside those three is refused too). Each refusal is thrown before anything is stored, so a refused file leaves
 * nothing in R2 or D1. The caller writes the row only after this returns, and removes the object if that write fails.
 */
async function storeVersionFile(c: Context<{ Bindings: Env }>, advisorId: number, file: NonNullable<Incoming['file']>): Promise<StoredFile> {
  const tooLarge = () => c.json({ detail: 'The file is larger than 10 MB.', code: 'file_too_large' }, 413);
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge();
  const bytes = await file.bytes();
  if (bytes.length === 0) throw c.json({ detail: 'The file is empty.', code: 'file_empty' }, 400);
  if (bytes.length > MAX_UPLOAD_BYTES) throw tooLarge();
  const sniffed = sniffType(bytes);
  const declared = file.type.toLowerCase().split(';')[0].trim();
  if (!sniffed || (declared && !ALLOWED_DECLARED.has(declared))) {
    throw c.json({ detail: 'Upload a PDF, JPEG or PNG file.', code: 'file_type_invalid' }, 400);
  }
  if (!c.env.FILES) throw c.json({ detail: 'File storage is not configured on this deployment.', code: 'storage_unconfigured' }, 503);
  const key = `advisor-deliverables/${advisorId}/${crypto.randomUUID()}`;
  // D1170: the advisor's own upload is weighed against their storage plan before it lands; a full plan
  // answers 413 `storage_full` (thrown as a Response, like the checks above) and nothing is stored.
  const room = await assertStorageRoom(c.env, { userId: advisorId }, bytes.length, { id: advisorId });
  try {
    // D6651: a deliverable original is a record, written once.
    const stored = await putRecord(c.env.FILES, key, bytes, { httpMetadata: { contentType: sniffed }, customMetadata: { advisorId: String(advisorId) } });
    if (!stored.ok) throw new Error('record_exists');
  } catch {
    throw c.json({ detail: 'The file could not be stored. Try again.', code: 'storage_failed' }, 502);
  }
  await noteStorageLanded(c.env, room);
  let sha256: string | null = null;
  try {
    sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { /* the hash is metadata, best effort */ }
  const name = file.name.replace(/[\\/\u0000-\u001f]+/g, '').trim().slice(0, 200) || 'document';
  return { key, name, type: sniffed, size: bytes.length, sha256 };
}

/**
 * A write failed after the bytes were stored: take them back out (best effort), then fail as the write did.
 * D6651: only while no version row names the key (a later statement can fail after the version row landed),
 * and through the one record-erasure path as `unreferenced` — this request created the object under a fresh key.
 */
async function dropStored(c: Context<{ Bindings: Env }>, stored: StoredFile | null) {
  if (!stored || !c.env.FILES) return;
  try {
    const named = await c.env.DB.prepare('SELECT 1 AS x FROM advisor_deliverable_versions WHERE file_key = ?').bind(stored.key).first();
    if (!named) await eraseRecordObjects(c.env.FILES, stored.key, 'unreferenced');
  } catch { /* orphaned bytes, never a row pointing nowhere */ }
}

/**
 * #5960 (D5960): a version's stored file, as a download. A missing object behind a recorded key is a storage
 * failure and answers 502, never an empty file.
 */
async function fileResponse(c: Context<{ Bindings: Env }>, v: VersionRow): Promise<Response> {
  if (!v.file_key) return c.json({ detail: 'This version has no file.', code: 'no_file' }, 404);
  let obj: Awaited<ReturnType<NonNullable<Env['FILES']>['get']>> | null = null;
  try { obj = c.env.FILES ? await c.env.FILES.get(v.file_key) : null; } catch { obj = null; }
  if (!obj) return c.json({ detail: 'The file could not be read. Try again.', code: 'file_unreadable' }, 502);
  const name = (v.file_name || 'document').replace(/[^A-Za-z0-9 ._-]+/g, '').trim().slice(0, 120) || 'document';
  return new Response(obj.body, {
    headers: {
      'Content-Type': v.file_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

/**
 * One deliverable of the caller's own, or a thrown 404 — `requireOwnEngagement`
 * one table over, and 404 for the same reason: loading by id and comparing the
 * advisor afterwards makes someone else's row indistinguishable from one that
 * does not exist.
 */
async function requireOwnDeliverable(
  c: Context<{ Bindings: Env }>, advisorId: number, id: number,
): Promise<DeliverableRow> {
  const row = await c.env.DB.prepare('SELECT * FROM advisor_deliverables WHERE id = ?')
    .bind(id).first<DeliverableRow>();
  if (!row || row.advisor_id !== advisorId) {
    throw c.json({ detail: 'Deliverable not found' }, 404);
  }
  return row;
}

advisors.get('/me/deliverables', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    return c.json(await deliverablePage(c.env, m.id, pageWindow(c.req.query(), PRACTICE_PAGE)));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

advisors.post('/me/deliverables', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    // #5960 (D5960): JSON, or a form carrying the first version's file.
    const { body, file } = await readIncoming(c);
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return c.json({ detail: 'A work product needs a title' }, 400);

    // The client comes from the engagement when one is named, so the two cannot
    // disagree about who this is for; otherwise it is typed.
    let clientName = String(body.client_name || '').trim().slice(0, 200);
    let engagementId: number | null = null;
    if (body.engagement_id != null && body.engagement_id !== '') {
      const eng = await requireOwnEngagement(c, m.id, Number(body.engagement_id));
      engagementId = eng.id;
      clientName = eng.client_name;
    }
    if (!clientName) return c.json({ detail: 'A work product needs a client' }, 400);
    if (file && trimOrNull(body.link_url, 2000)) return c.json({ detail: 'A version\'s document is a link or a file, not both.', code: 'two_documents' }, 422);

    // #5960: the bytes first, the rows only after the put succeeded.
    const stored = file ? await storeVersionFile(c, m.id, file) : null;
    // The insert names the file columns, so a store adopted by baseline is healed first.
    await ensureAdvisorStoresSchema(c.env);
    const now = nowIso();
    const uid = newUid();
    try {
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_deliverables
         (uid, advisor_id, engagement_id, client_name, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, m.id, engagementId, clientName, title, now, now).run();
    const id = Number((r as any).meta?.last_row_id);
    // VERSION 1 COMES WITH IT. A work product with no version is a title, and
    // every read here assumes at least one row to be the latest.
    await c.env.DB.prepare(
      `INSERT INTO advisor_deliverable_versions
         (uid, deliverable_id, version, label, summary, version_summary, link_url, file_key, file_name, file_type, file_size, file_sha256, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newUid(), id, trimOrNull(body.label, 60), trimOrNull(body.summary, 2000), trimOrNull(body.version_summary, 2000),
           trimOrNull(body.link_url, 2000), stored?.key ?? null, stored?.name ?? null, stored?.type ?? null,
           stored?.size ?? null, stored?.sha256 ?? null, now, now).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverables WHERE id = ?')
      .bind(id).first<DeliverableRow>();
    return c.json({ ...fresh, state: 'not_started', version_count: 1 }, 201);
    } catch (e) { await dropStored(c, stored); throw e; }
  } catch (e) { return mapError(c, e); }
});

advisors.patch('/me/deliverables/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnDeliverable(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const due = body.due_date === undefined ? row.due_date ?? null : body.due_date;
    if (due != null && (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due)
      || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due)) {
      return c.json({ detail: 'Due date must be a calendar date (YYYY-MM-DD)' }, 400);
    }
    const manual = body.manual_status === undefined ? row.manual_status ?? null : body.manual_status;
    if (manual != null && !['planned', 'in_progress'].includes(manual)) {
      return c.json({ detail: 'Manual status must be planned or in_progress; delivery and acceptance use receipts' }, 400);
    }
    let engagementId = row.engagement_id;
    let clientName = row.client_name;
    if ('engagement_id' in body) {
      if (body.engagement_id == null || body.engagement_id === '') engagementId = null;
      else {
        const eng = await requireOwnEngagement(c, m.id, Number(body.engagement_id));
        engagementId = eng.id;
        clientName = eng.client_name;
      }
    }
    if ('client_name' in body && engagementId == null) {
      clientName = String(body.client_name ?? '').trim().slice(0, 200) || row.client_name;
    }
    await c.env.DB.prepare(
      `UPDATE advisor_deliverables
          SET title = ?, engagement_id = ?, client_name = ?, due_date = ?, manual_status = ?, updated_at = ?
        WHERE id = ? AND advisor_id = ?`
    ).bind(
      String(body.title ?? '').trim().slice(0, 200) || row.title,
      engagementId, clientName, due, manual, nowIso(), row.id, m.id,
    ).run();
    await logAdminAction(c.env, user.id, user.email, 'advisor_deliverable_updated', { deliverable_id: row.id });
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverables WHERE id = ?')
      .bind(row.id).first<DeliverableRow>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/deliverables/:id/versions — the next version of a work product.
 *
 * The ordinal is `MAX(version) + 1` read inside the same request, and the
 * table's `UNIQUE (deliverable_id, version)` is what turns a lost race into an
 * error rather than two rows both calling themselves v3.
 */
advisors.post('/me/deliverables/:id/versions', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnDeliverable(c, m.id, Number(c.req.param('id')));
    const { body, file } = await readIncoming(c);
    // #4712 (D4712): A REVISION IS NEVER EMPTY. A new version carries a change
    // note (what is different from the last one) and the content, a web link;
    // "Add a version" used to POST `{}` and record a v3 that said nothing and
    // pointed nowhere. Older versions stay as recorded: there is no route that
    // edits one.
    const note = trimOrNull(body.summary, 2000);
    const link = trimOrNull(body.link_url, 2000);
    if (!note) return c.json({ detail: 'Say what changed in this version.', code: 'empty_version' }, 422);
    // #5960 (D5960): the content is a web link or a file: one of the two, never neither and never both.
    if (file && link) return c.json({ detail: 'A version\'s document is a link or a file, not both.', code: 'two_documents' }, 422);
    if (!file && (!link || !isHttpsLink(link))) {
      return c.json({ detail: 'Add the content as a file, or as a web link that starts with https://', code: 'empty_version' }, 422);
    }
    const stored = file ? await storeVersionFile(c, m.id, file) : null;
    // The insert names the file columns, so a store adopted by baseline is healed first.
    await ensureAdvisorStoresSchema(c.env);
    try {
    const top = await c.env.DB.prepare(
      'SELECT MAX(version) AS v FROM advisor_deliverable_versions WHERE deliverable_id = ?'
    ).bind(row.id).first<{ v: number | null }>();
    const next = Number(top?.v || 0) + 1;
    const now = nowIso();
    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO advisor_deliverable_versions
         (uid, deliverable_id, version, label, summary, version_summary, link_url, file_key, file_name, file_type, file_size, file_sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, row.id, next, trimOrNull(body.label, 60), trimOrNull(body.summary, 2000), trimOrNull(body.version_summary, 2000),
           link, stored?.key ?? null, stored?.name ?? null, stored?.type ?? null, stored?.size ?? null, stored?.sha256 ?? null,
           now, now).run();
    await c.env.DB.prepare('UPDATE advisor_deliverables SET updated_at = ? WHERE id = ?')
      .bind(now, row.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE uid = ?')
      .bind(uid).first<VersionRow>();
    return c.json(versionDto(fresh!), 201);
    } catch (e) { await dropStored(c, stored); throw e; }
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/deliverables/:id/versions/:version/send — it went to the client.
 *
 * REFUSES A CLIENT WITH NO ACCOUNT, with a 409 that names the link. See the
 * block comment at the top of this section: a version nobody can open would
 * poison three of this zone's four tiles, and the alternative — letting the
 * advisor claim it was opened — is the one thing this store exists to prevent.
 */
advisors.post('/me/deliverables/:id/versions/:version/send', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnDeliverable(c, m.id, Number(c.req.param('id')));
    const version = Number(c.req.param('version'));
    return c.json(await sendDeliverable(c.env, m.id, row, version));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

/**
 * #5316 (D5316) — POST /me/deliverables/:id/versions/:version/ready marks a
 * version ready to send; DELETE on the same path takes the mark off.
 *
 * MARKING SENDS NOTHING. It stamps `ready_at` and `ready_by_user_id` and touches
 * no other column: no recipient, no `sent_at`, no message. The send clears the
 * mark. A version already sent cannot be marked (409 `already_sent`), and one
 * with no content cannot be either (422 `empty_version`, the send's own rule):
 * ready means it could be sent as it stands.
 *
 * The first mark stands: marking again answers the version as it is, with the
 * original stamp and the account that made it.
 */
async function ownVersion(c: Context<{ Bindings: Env }>, advisorId: number) {
  const row = await requireOwnDeliverable(c, advisorId, Number(c.req.param('id')));
  const v = await c.env.DB.prepare(
    'SELECT * FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = ?'
  ).bind(row.id, Number(c.req.param('version'))).first<VersionRow>();
  if (!v) throw c.json({ detail: 'Version not found' }, 404);
  return { row, v };
}
const readVersionDto = async (c: Context<{ Bindings: Env }>, id: number) => sentVersionDto((await c.env.DB.prepare(
  `SELECT v.*, r.name AS recipient_name, k.name AS ready_by_name
     FROM advisor_deliverable_versions v
     LEFT JOIN users r ON r.id = v.recipient_user_id
     LEFT JOIN users k ON k.id = v.ready_by_user_id
    WHERE v.id = ?`
).bind(id).first<VersionRow & { recipient_name?: string | null; ready_by_name?: string | null }>())!);
const ALREADY_SENT = { detail: 'That version has already been sent, so it is not waiting to be sent.', code: 'already_sent' };

advisors.post('/me/deliverables/:id/versions/:version/ready', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const { row, v } = await ownVersion(c, m.id);
    if (v.sent_at) return c.json(ALREADY_SENT, 409);
    if (!hasDocument(v)) {
      return c.json({ detail: 'This version has no content to send, so it cannot be ready. Add a version with a file or a link.', code: 'empty_version' }, 422);
    }
    const now = nowIso();
    const marked: any = await c.env.DB.prepare(
      `UPDATE advisor_deliverable_versions SET ready_at = ?, ready_by_user_id = ?, updated_at = ?
        WHERE id = ? AND sent_at IS NULL AND ready_at IS NULL`
    ).bind(now, user.id, now, v.id).run();
    if (marked.meta?.changes) {
      await c.env.DB.prepare('UPDATE advisor_deliverables SET updated_at = ? WHERE id = ?').bind(now, row.id).run();
    } else {
      // Either it was already marked (the first mark stands) or it was sent in between.
      const cur = await c.env.DB.prepare('SELECT sent_at FROM advisor_deliverable_versions WHERE id = ?')
        .bind(v.id).first<{ sent_at: string | null }>();
      if (cur?.sent_at) return c.json(ALREADY_SENT, 409);
    }
    return c.json(await readVersionDto(c, v.id));
  } catch (e) { return mapError(c, e); }
});

advisors.delete('/me/deliverables/:id/versions/:version/ready', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const { row, v } = await ownVersion(c, m.id);
    if (v.sent_at) return c.json(ALREADY_SENT, 409);
    const now = nowIso();
    const cleared: any = await c.env.DB.prepare(
      `UPDATE advisor_deliverable_versions SET ready_at = NULL, ready_by_user_id = NULL, updated_at = ?
        WHERE id = ? AND sent_at IS NULL AND ready_at IS NOT NULL`
    ).bind(now, v.id).run();
    if (cleared.meta?.changes) {
      await c.env.DB.prepare('UPDATE advisor_deliverables SET updated_at = ? WHERE id = ?').bind(now, row.id).run();
    }
    return c.json(await readVersionDto(c, v.id));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// 239, the client's half — the receipt an advisor cannot write
// ---------------------------------------------------------------------------
/**
 * THE WHOLE POINT OF THESE TWO ROUTES is that `opened_at` has no advisor-side
 * writer and never will. Migration 208's header, inherited by 239, states the
 * rule: `opened_at` and `signed_off_at` are the CLIENT's to set, because only
 * the founder side can truthfully say a thing was read — an advisor-side write
 * would be the practice reporting a metric about itself. `/me/deliverables`
 * reports three tiles that stay null until a founder acts here.
 *
 * THEY SIT IN THIS FILE RATHER THAN `advisor_grants.ts`, AND THE SCHEMA IS WHY:
 * no grant is involved. The relationship that carries a deliverable is the
 * ENGAGEMENT, so a grant-scoped route would hide every work product from a
 * founder who never opened a record — which is most of them. This router already
 * holds the founder-facing half of the advisor surface (`/`, `/match`, `/:uid`,
 * `/:uid/slots`, `/slots/:id/book`, `/bookings/:id/*`), all `requireAuth` with
 * no advisor profile, and these join it.
 */

/**
 * GET /received/deliverables — what my advisors have sent me.
 *
 * SENT VERSIONS ONLY, and that is a privacy rule rather than a filter. A version
 * with no `sent_at` is the advisor's draft: they created it, they have not handed
 * it over, and a client who could see it would be reading work in progress. A
 * deliverable whose every version is unsent does not appear at all.
 */
advisors.get('/received/deliverables', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    return c.json(await receivedDeliverables(c.env, user.id, pageWindow(c.req.query(), PRACTICE_PAGE)));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

/**
 * POST /received/deliverables/:uid/open — the receipt, stamped once.
 *
 * FIRST OPEN WINS, AND THE SQL IS WHAT ENFORCES IT: `WHERE opened_at IS NULL`
 * on the UPDATE, not a read-then-write in the handler. A founder reloading the
 * page cannot move the stamp, and two concurrent opens cannot race one past the
 * other. The second call is not an error — reading something twice never is — so
 * it returns the row with the original stamp intact.
 *
 * A DRAFT CANNOT BE OPENED. `sent_at IS NOT NULL` is in the scope query, so a
 * version the advisor never sent answers 404 like anyone else's: without it a
 * founder could stamp a deliverable nobody handed them, and `median_to_open` on
 * the advisor's page would be measuring an interval that never happened.
 *
 * 404, NEVER 403, for a version belonging to someone else's engagement — the
 * `requireOwnDeliverable` reasoning from PR3a, one table further out. Comparing
 * after the load is what makes another client's row indistinguishable from one
 * that does not exist.
 */
advisors.post('/received/deliverables/:uid/open', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    return c.json(await openDeliverable(c.env, user, c.req.param('uid')));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

advisors.post('/received/deliverables/:uid/accept', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    return c.json(await acceptDeliverable(c.env, user, c.req.param('uid')));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

/**
 * #5960 (D5960) — GET /me/deliverables/:id/versions/:version/file: the advisor's own version's file. Another
 * advisor's deliverable is the same 404 `requireOwnDeliverable` gives.
 */
advisors.get('/me/deliverables/:id/versions/:version/file', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    await ensureAdvisorStoresSchema(c.env);
    const { v } = await ownVersion(c, m.id);
    return await fileResponse(c, v);
  } catch (e) { return mapError(c, e); }
});

/**
 * #5960 (D5960) — GET /received/deliverables/:uid/file: a sent version's file, for the account it was sent to.
 * Scoped exactly as `/open` and the list are (D4684): the version's recorded recipient, and sent. Anyone else, and
 * an unsent version, get the same 404 those routes give.
 */
advisors.get('/received/deliverables/:uid/file', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const v = await c.env.DB.prepare(
      `SELECT v.* FROM advisor_deliverable_versions v
        WHERE v.uid = ? AND v.recipient_user_id = ? AND v.sent_at IS NOT NULL`
    ).bind(c.req.param('uid'), user.id).first<VersionRow>();
    if (!v) return c.json({ detail: 'Work product not found' }, 404);
    return await fileResponse(c, v);
  } catch (e) { return mapError(c, e); }
});

export default advisors;
