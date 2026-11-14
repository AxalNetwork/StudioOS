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
import { logAdminAction } from '../services/adminAudit';
import { mapError, nowIso, newUid, trimOrNull } from './_t13t14t15_helpers';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';
import { pageFacts, pageWindow } from '../services/listPage';
import {
  PRACTICE_PAGE, requireMyAdvisor, requireOwnEngagement,
} from '../services/advisorPractice';
import { ALLOWED_DECLARED, MAX_UPLOAD_BYTES, sniffType } from './company_documents';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';

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
type DeliverableRow = {
  id: number; uid: string; advisor_id: number;
  engagement_id: number | null; client_name: string; title: string;
  due_date?: string | null; manual_status?: string | null;
  created_at: string; updated_at: string;
};
type VersionRow = {
  id: number; uid: string; deliverable_id: number; version: number;
  label: string | null; summary: string | null; link_url: string | null;
  sent_at: string | null; opened_at: string | null; signed_off_at: string | null;
  // #4684: who it was sent to and who recorded each receipt, each written once.
  recipient_user_id?: number | null; opened_by_user_id?: number | null; signed_off_by_user_id?: number | null;
  // #5316 (D5316): the advisor's "ready to send" mark, cleared by the send.
  ready_at?: string | null; ready_by_user_id?: number | null;
  // #5960 (D5960): a stored file as the version's document. The key and the hash never leave this file.
  file_key?: string | null; file_name?: string | null; file_type?: string | null; file_size?: number | null; file_sha256?: string | null;
  created_at: string; updated_at: string;
};

/** `not_started` | `sent` | `opened`, from the stamps alone. */
export function deliverableState(versions: Pick<VersionRow, 'sent_at' | 'opened_at'>[]): string {
  if (versions.some((v) => v.opened_at)) return 'opened';
  if (versions.some((v) => v.sent_at)) return 'sent';
  return 'not_started';
}

/** An absolute https web address: the one shape a version's content link may take. */
function isHttpsLink(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname; } catch { return false; }
}

/** #5960 (D5960): whether a version has a document to send: an https link or a stored file. */
const hasDocument = (v: Pick<VersionRow, 'link_url' | 'file_key'>) => !!v.file_key || (!!v.link_url && isHttpsLink(v.link_url));

/** #5960 (D5960): a stored file's name, type and size, or null. Never its key or hash. */
function fileOf(r: VersionRow): { name: string; type: string | null; size: number | null } | null {
  if (!r.file_key) return null;
  return { name: r.file_name ?? 'document', type: r.file_type ?? null, size: r.file_size == null ? null : Number(r.file_size) };
}

function versionDto(r: VersionRow): any {
  return {
    uid: r.uid, version: Number(r.version), label: r.label, summary: r.summary,
    link_url: r.link_url,
    // #5960 (D5960): which kind of document this version has, and the file's name, type and size. Never the R2 key
    // or the hash: a key is a capability the routes alone hold.
    document: r.file_key ? 'file' : r.link_url ? 'link' : null,
    file: fileOf(r),
    // All three are null until they happen. Never coalesced to a date.
    sent_at: r.sent_at, opened_at: r.opened_at, signed_off_at: r.signed_off_at,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/**
 * #4684: the advisor's view of a version adds who it was sent to. The client's
 * own read keeps `versionDto`: it never needs another account's name.
 */
function sentVersionDto(r: VersionRow & { recipient_name?: string | null; ready_by_name?: string | null }): any {
  return {
    ...versionDto(r),
    recipient_user_id: r.recipient_user_id ?? null,
    recipient_name: r.recipient_user_id == null ? null : (r.recipient_name ?? null),
    // #5316 (D5316): marked ready to send, by whom and when; null until marked,
    // and null again once sent. The advisor's own fact: `versionDto`, which the
    // client reads, never carries it.
    ready_at: r.ready_at ?? null,
    ready_by_user_id: r.ready_at ? (r.ready_by_user_id ?? null) : null,
    ready_by_name: r.ready_at && r.ready_by_user_id != null ? (r.ready_by_name ?? null) : null,
  };
}

/**
 * #5316 (D5316): the version a deliverable is waiting to send, or null. Only an
 * UNSENT version marked ready counts; the highest such version if several are.
 */
export function readyVersion(versions: Pick<VersionRow, 'version' | 'sent_at' | 'ready_at'>[]): number | null {
  const ready = versions.filter((v) => v.ready_at && !v.sent_at).map((v) => Number(v.version));
  return ready.length ? Math.max(...ready) : null;
}

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
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: sniffed }, customMetadata: { advisorId: String(advisorId) } });
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

/** The row write failed after the bytes were stored: take them back out (best effort), then fail as the write did. */
async function dropStored(c: Context<{ Bindings: Env }>, stored: StoredFile | null) {
  if (stored) { try { await c.env.FILES?.delete(stored.key); } catch { /* orphaned bytes, never a row pointing nowhere */ } }
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

/** Hours between two stamps, or null if either is missing or unparseable. */
function hoursBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3600000;
}

/** The middle value, or null for an empty set — never 0. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

advisors.get('/me/deliverables', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const [rows, versions] = await Promise.all([
      // The client's ACCOUNT AND ADDRESS come through the engagement, and only
      // for a linked one. This is what lets the zone offer a nudge over exactly
      // the rows it can reach, rather than a bulk action that silently skips
      // some of them.
      c.env.DB.prepare(
        `SELECT d.*, e.founder_user_id AS client_user_id,
                u.name AS client_user_name, u.email AS client_user_email
           FROM advisor_deliverables d
           LEFT JOIN advisor_engagements e ON e.id = d.engagement_id
           LEFT JOIN users u ON u.id = e.founder_user_id
          WHERE d.advisor_id = ?
          ORDER BY d.updated_at DESC, d.id DESC`
      ).bind(m.id).all<DeliverableRow & {
        client_user_id: number | null; client_user_name: string | null; client_user_email: string | null;
      }>(),
      // #4684: each sent version names the account it went to, which may not be
      // the engagement's client today: a relink moves nothing already sent.
      c.env.DB.prepare(
        `SELECT v.*, r.name AS recipient_name, r.email AS recipient_email,
                k.name AS ready_by_name
           FROM advisor_deliverable_versions v
           JOIN advisor_deliverables d ON d.id = v.deliverable_id
           LEFT JOIN users r ON r.id = v.recipient_user_id
           LEFT JOIN users k ON k.id = v.ready_by_user_id
          WHERE d.advisor_id = ?
          ORDER BY v.deliverable_id, v.version DESC`
      ).bind(m.id).all<VersionRow & { recipient_name?: string | null; recipient_email?: string | null; ready_by_name?: string | null }>(),
    ]);

    const byDeliverable = new Map<number, VersionRow[]>();
    for (const v of versions.results || []) {
      const list = byDeliverable.get(Number(v.deliverable_id)) || [];
      list.push(v);
      byDeliverable.set(Number(v.deliverable_id), list);
    }

    const items = (rows.results || []).map((d) => {
      const vs = byDeliverable.get(Number(d.id)) || [];
      const latest = vs[0] || null;   // the SELECT orders version DESC
      return {
        id: d.id, uid: d.uid, advisor_id: d.advisor_id,
        engagement_id: d.engagement_id ?? null,
        client_name: d.client_name, title: d.title,
        due_date: d.due_date ?? null, manual_status: d.manual_status ?? null,
        // NULL means this client has no account, so nothing they are sent can
        // ever be opened. The zone says so rather than showing a stuck row.
        client_user_id: d.client_user_id ?? null,
        client_user_name: d.client_user_name ?? null,
        client_user_email: d.client_user_email ?? null,
        state: deliverableState(vs),
        // #5316 (D5316): the unsent version marked ready to send, or null. Beside
        // `state`, not in it: a deliverable can be opened at v1 and ready at v2.
        ready_version: readyVersion(vs),
        version_count: vs.length,
        latest_version: latest ? sentVersionDto(latest) : null,
        versions: vs.map(sentVersionDto),
        // The address a nudge about unread work reaches: the latest sent
        // version's recipient, not whoever the engagement names now.
        recipient_email: (vs.find((v) => v.sent_at) as any)?.recipient_email ?? null,
        created_at: d.created_at, updated_at: d.updated_at,
      };
    });

    const sent = items.filter((i) => i.state === 'sent' || i.state === 'opened');
    const unopened = items.filter((i) => i.state === 'sent');
    // THE MEASUREMENT, and unlike Opportunities' median this one is real: both
    // stamps exist, so there is no need to substitute a last-touched column.
    // Measured on the FIRST open of each deliverable, because a second version
    // read later says nothing about how fast the work reached its reader.
    const openHours = items
      .map((i) => {
        const opened = [...i.versions].reverse().find((v) => v.opened_at);
        return opened ? hoursBetween(opened.sent_at, opened.opened_at) : null;
      })
      .filter((h): h is number => h != null);
    const medianHours = median(openHours);
    // The oldest thing that went out and was never read by anyone — no
    // threshold, which is what keeps this from being an arbitrary rule.
    const neverOpened = unopened
      .map((i) => ({ title: i.title, client_name: i.client_name, sent_at: i.latest_version?.sent_at || null }))
      .sort((a, b) => String(a.sent_at || '').localeCompare(String(b.sent_at || '')));

    // #4714 (D4714): the totals are over every work product; the list is a
    // page of them.
    const w = pageWindow(c.req.query(), PRACTICE_PAGE);
    const shown = items.slice(w.offset, w.offset + w.limit);
    return c.json({
      items: shown,
      page: pageFacts(w, items.length, shown.length),
      totals: {
        work_products: items.length,
        clients: new Set(items.map((i) => i.client_name)).size,
        sent: sent.length,
        unopened: unopened.length,
        opened: items.filter((i) => i.state === 'opened').length,
        drafts: items.filter((i) => i.state === 'not_started').length,
        // #5316 (D5316): work products with a version marked ready and not yet sent.
        ready: items.filter((i) => i.ready_version != null).length,
        // Null, never 0. Nothing opened yet is not "opened instantly" (D56/D68).
        median_to_open_hours: medianHours == null ? null : Math.round(medianHours * 10) / 10,
        never_opened: neverOpened.length,
        oldest_never_opened: neverOpened[0] || null,
        // How many rows a nudge could actually reach. The zone reports the gap
        // rather than skipping rows quietly.
        addressable: unopened.filter((i) => i.recipient_email).length,
      },
    });
  } catch (e) { return mapError(c, e); }
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
         (uid, deliverable_id, version, label, summary, link_url, file_key, file_name, file_type, file_size, file_sha256, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newUid(), id, trimOrNull(body.label, 60), trimOrNull(body.summary, 2000),
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
         (uid, deliverable_id, version, label, summary, link_url, file_key, file_name, file_type, file_size, file_sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, row.id, next, trimOrNull(body.label, 60), trimOrNull(body.summary, 2000),
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
    const v = await c.env.DB.prepare(
      'SELECT * FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = ?'
    ).bind(row.id, version).first<VersionRow>();
    if (!v) return c.json({ detail: 'Version not found' }, 404);
    if (v.sent_at) return c.json({ detail: 'That version has already been sent' }, 409);

    const client = row.engagement_id == null ? null : await c.env.DB.prepare(
      `SELECT u.id FROM advisor_engagements e
         JOIN users u ON u.id = e.founder_user_id
        WHERE e.id = ? AND e.advisor_id = ?`
    ).bind(row.engagement_id, m.id).first<{ id: number }>();
    if (!client) {
      return c.json({
        detail: 'Link this work product to an engagement whose client has an Axal account before sending — nothing an unlinked client is sent can ever be recorded as opened',
      }, 409);
    }

    // #4712: nothing is sent that has nothing in it. A version with no link has
    // no content for the client to open (an empty v1 from a title-only work
    // product, or an empty revision recorded before this rule).
    // #5960 (D5960): a link or a stored file.
    if (!hasDocument(v)) {
      return c.json({ detail: 'This version has no content to send. Add a version with a file or a link, then send that one.', code: 'empty_version' }, 422);
    }

    const now = nowIso();
    // #5316 (D5316): the send clears the "ready to send" mark in the same UPDATE,
    // so a sent version is never also waiting to be sent.
    // #4684: THE RECIPIENT IS FIXED HERE, in the same UPDATE as `sent_at`. The
    // client routes authorise against it, never against the engagement's current
    // client, so a later relink can neither take this version from the person it
    // went to nor hand it to someone else. `sent_at IS NULL` in the WHERE makes
    // two concurrent sends one send.
    await ensureAdvisorStoresSchema(c.env);
    const sent: any = await c.env.DB.prepare(
      `UPDATE advisor_deliverable_versions SET sent_at = ?, recipient_user_id = ?,
              ready_at = NULL, ready_by_user_id = NULL, updated_at = ?
        WHERE id = ? AND sent_at IS NULL`
    ).bind(now, client.id, now, v.id).run();
    if (!sent.meta?.changes) return c.json({ detail: 'That version has already been sent' }, 409);
    await c.env.DB.prepare('UPDATE advisor_deliverables SET updated_at = ? WHERE id = ?')
      .bind(now, row.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return c.json(versionDto(fresh!));
  } catch (e) { return mapError(c, e); }
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
    const rows = await c.env.DB.prepare(
      // #4684: BY RECIPIENT, NOT BY THE ENGAGEMENT'S CURRENT CLIENT. A version
      // belongs to the account it was sent to, so relinking the engagement (or
      // the work product) moves nothing that was already sent.
      `SELECT d.id, d.uid, d.title, d.client_name, d.created_at, d.updated_at,
              a.display_name AS advisor_name, a.uid AS advisor_uid
         FROM advisor_deliverables d
         JOIN advisors a ON a.id = d.advisor_id
        WHERE EXISTS (SELECT 1 FROM advisor_deliverable_versions v
                       WHERE v.deliverable_id = d.id AND v.sent_at IS NOT NULL
                         AND v.recipient_user_id = ?)
        ORDER BY d.updated_at DESC LIMIT 200`
    ).bind(user.id).all<any>();

    const items = [] as any[];
    for (const d of rows.results || []) {
      const vs = await c.env.DB.prepare(
        `SELECT * FROM advisor_deliverable_versions
          WHERE deliverable_id = ? AND sent_at IS NOT NULL AND recipient_user_id = ?
          ORDER BY version DESC`
      ).bind(d.id, user.id).all<VersionRow>();
      const versions = (vs.results || []).map(versionDto);
      items.push({
        uid: d.uid, title: d.title,
        advisor_name: d.advisor_name, advisor_uid: d.advisor_uid,
        // DERIVED BY THE SAME FUNCTION THE ADVISOR'S PAGE READS, so the two
        // sides can never disagree about what "opened" means. `not_started` is
        // unreachable here by construction — every row has a sent version — and
        // that is worth leaving to the shared helper rather than re-deriving a
        // two-state version of it that would drift.
        state: deliverableState(versions),
        version_count: versions.length,
        versions,
        updated_at: d.updated_at,
      });
    }
    return c.json({
      items,
      totals: {
        work_products: items.length,
        unread: items.filter((i) => i.state === 'sent').length,
        advisors: new Set(items.map((i) => i.advisor_uid)).size,
      },
    });
  } catch (e) { return mapError(c, e); }
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
    const v = await c.env.DB.prepare(
      `SELECT v.* FROM advisor_deliverable_versions v
        WHERE v.uid = ? AND v.recipient_user_id = ? AND v.sent_at IS NOT NULL`
    ).bind(c.req.param('uid'), user.id).first<VersionRow>();
    if (!v) return c.json({ detail: 'Work product not found' }, 404);

    const now = nowIso();
    // #4684: the receipt records who made it, and only the recipient can: the
    // WHERE repeats the recipient so no other account's open can land here.
    await c.env.DB.prepare(
      `UPDATE advisor_deliverable_versions SET opened_at = ?, opened_by_user_id = ?, updated_at = ?
        WHERE id = ? AND opened_at IS NULL AND recipient_user_id = ?`
    ).bind(now, user.id, now, v.id, user.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return c.json(versionDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

advisors.post('/received/deliverables/:uid/accept', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const v = await c.env.DB.prepare(
      `SELECT v.* FROM advisor_deliverable_versions v
        WHERE v.uid = ? AND v.recipient_user_id = ? AND v.sent_at IS NOT NULL`
    ).bind(c.req.param('uid'), user.id).first<VersionRow>();
    if (!v) return c.json({ detail: 'Work product not found' }, 404);
    const now = nowIso();
    const accepted: any = await c.env.DB.prepare(
      `UPDATE advisor_deliverable_versions
          SET signed_off_at = ?, signed_off_by_user_id = ?,
              opened_by_user_id = CASE WHEN opened_at IS NULL THEN ? ELSE opened_by_user_id END,
              opened_at = COALESCE(opened_at, ?), updated_at = ?
        WHERE id = ? AND signed_off_at IS NULL AND recipient_user_id = ?`
    ).bind(now, user.id, user.id, now, now, v.id, user.id).run();
    if (accepted.meta?.changes) {
      await logAdminAction(c.env, user.id, user.email, 'advisor_deliverable_accepted', { version_id: v.id });
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return c.json(versionDto(fresh!));
  } catch (e) { return mapError(c, e); }
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
