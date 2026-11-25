/** D4704 part 3 (#4704): deliverable state, distribution, fixed recipient identity and client receipts. */
import type { Env, User } from '../types';
import { nowIso } from '../routes/_t13t14t15_helpers';
import { ensureAdvisorStoresSchema } from './advisorStoresSchema';
import { logAdminAction } from './adminAudit';
import { pageFacts, type PageWindow } from './listPage';
import { practiceRefusal } from './practiceRefusal';
export type DeliverableRow = {
  id: number; uid: string; advisor_id: number;
  engagement_id: number | null; client_name: string; title: string;
  due_date?: string | null; manual_status?: string | null;
  created_at: string; updated_at: string;
};
export type VersionRow = {
  id: number; uid: string; deliverable_id: number; version: number;
  label: string | null; summary: string | null; link_url: string | null;
  // #5959 (D5959): the optional summary, apart from `summary` (the change note); null on older rows.
  version_summary?: string | null;
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
export function isHttpsLink(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname; } catch { return false; }
}

/** #5960 (D5960): whether a version has a document to send: an https link or a stored file. */
export const hasDocument = (v: Pick<VersionRow, 'link_url' | 'file_key'>) => !!v.file_key || (!!v.link_url && isHttpsLink(v.link_url));

/** #5960 (D5960): a stored file's name, type and size, or null. Never its key or hash. */
function fileOf(r: VersionRow): { name: string; type: string | null; size: number | null } | null {
  if (!r.file_key) return null;
  return { name: r.file_name ?? 'document', type: r.file_type ?? null, size: r.file_size == null ? null : Number(r.file_size) };
}

export function versionDto(r: VersionRow): any {
  return {
    uid: r.uid, version: Number(r.version), label: r.label, summary: r.summary,
    // #5959 (D5959): optional, and null (never '') when the advisor gave none.
    version_summary: r.version_summary ?? null,
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
export function sentVersionDto(r: VersionRow & { recipient_name?: string | null; ready_by_name?: string | null }): any {
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

/** Complete metrics never depend on how many detail rows this request returns. */
async function distributionTotals(env: Env, advisorId: number) {
  const row = await env.DB.prepare(`
    WITH facts AS (
      SELECT v.deliverable_id,
        MAX(CASE WHEN v.sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
        MAX(CASE WHEN v.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
        MAX(CASE WHEN v.ready_at IS NOT NULL AND v.sent_at IS NULL THEN 1 ELSE 0 END) AS ready,
        MIN(CASE WHEN v.opened_at IS NOT NULL THEN v.version END) AS first_open,
        MAX(v.version) AS latest,
        MAX(CASE WHEN v.sent_at IS NOT NULL THEN v.version END) AS latest_sent
      FROM advisor_deliverable_versions v
      JOIN advisor_deliverables d ON d.id = v.deliverable_id WHERE d.advisor_id = ?
      GROUP BY v.deliverable_id
    ), population AS (
      SELECT d.id, d.title, d.client_name, d.updated_at,
        COALESCE(f.sent, 0) AS sent, COALESCE(f.opened, 0) AS opened, COALESCE(f.ready, 0) AS ready,
        latest.sent_at, r.email AS recipient_email,
        CASE WHEN julianday(first.opened_at) >= julianday(first.sent_at)
          THEN ROUND((julianday(first.opened_at) - julianday(first.sent_at)) * 86400000) / 3600000.0 END AS open_hours
      FROM advisor_deliverables d LEFT JOIN facts f ON f.deliverable_id = d.id
      LEFT JOIN advisor_deliverable_versions first ON first.deliverable_id = d.id AND first.version = f.first_open
      LEFT JOIN advisor_deliverable_versions latest ON latest.deliverable_id = d.id AND latest.version = f.latest
      LEFT JOIN advisor_deliverable_versions sent ON sent.deliverable_id = d.id AND sent.version = f.latest_sent
      LEFT JOIN users r ON r.id = sent.recipient_user_id WHERE d.advisor_id = ?
    ), measured AS (
      SELECT open_hours, ROW_NUMBER() OVER (ORDER BY open_hours) AS rn, COUNT(*) OVER () AS n
      FROM population WHERE open_hours IS NOT NULL
    )
    SELECT COUNT(*) AS work_products, COUNT(DISTINCT client_name) AS clients,
      COALESCE(SUM(CASE WHEN sent = 1 OR opened = 1 THEN 1 ELSE 0 END), 0) AS sent,
      COALESCE(SUM(CASE WHEN sent = 1 AND opened = 0 THEN 1 ELSE 0 END), 0) AS unopened,
      COALESCE(SUM(opened), 0) AS opened,
      COALESCE(SUM(CASE WHEN sent = 0 AND opened = 0 THEN 1 ELSE 0 END), 0) AS drafts,
      COALESCE(SUM(ready), 0) AS ready,
      COALESCE(SUM(CASE WHEN sent = 1 AND opened = 0 AND recipient_email IS NOT NULL AND recipient_email != '' THEN 1 ELSE 0 END), 0) AS addressable,
      (SELECT AVG(open_hours) FROM measured WHERE rn IN ((n + 1) / 2, (n + 2) / 2)) AS median_hours,
      (SELECT json_object('title', title, 'client_name', client_name, 'sent_at', sent_at)
        FROM population WHERE sent = 1 AND opened = 0
        ORDER BY COALESCE(sent_at, ''), updated_at DESC, id DESC LIMIT 1) AS oldest
    FROM population
  `).bind(advisorId, advisorId).first<any>();
  return {
    work_products: Number(row.work_products), clients: Number(row.clients), sent: Number(row.sent),
    unopened: Number(row.unopened), opened: Number(row.opened), drafts: Number(row.drafts), ready: Number(row.ready),
    median_to_open_hours: row.median_hours == null ? null : Math.round(Number(row.median_hours) * 10) / 10,
    never_opened: Number(row.unopened), oldest_never_opened: row.oldest == null ? null : JSON.parse(row.oldest),
    addressable: Number(row.addressable),
  };
}

function versionsByDeliverable(versions: VersionRow[]) {
  const out = new Map<number, VersionRow[]>();
  for (const v of versions) {
    const id = Number(v.deliverable_id);
    const list = out.get(id) ?? [];
    list.push(v); out.set(id, list);
  }
  return out;
}

export async function deliverablePage(env: Env, advisorId: number, w: PageWindow) {
  const [rows, totals] = await Promise.all([
    env.DB.prepare(`SELECT d.*, e.founder_user_id AS client_user_id,
        u.name AS client_user_name, u.email AS client_user_email
      FROM advisor_deliverables d LEFT JOIN advisor_engagements e ON e.id = d.engagement_id
      LEFT JOIN users u ON u.id = e.founder_user_id WHERE d.advisor_id = ?
      ORDER BY d.updated_at DESC, d.id DESC LIMIT ? OFFSET ?`).bind(advisorId, w.limit, w.offset).all<any>(),
    distributionTotals(env, advisorId),
  ]);
  const ids = rows.results.map((d) => Number(d.id));
  const versions = ids.length ? (await env.DB.prepare(`
    SELECT v.*, r.name AS recipient_name, r.email AS recipient_email, k.name AS ready_by_name
    FROM advisor_deliverable_versions v JOIN advisor_deliverables d ON d.id = v.deliverable_id
    LEFT JOIN users r ON r.id = v.recipient_user_id LEFT JOIN users k ON k.id = v.ready_by_user_id
    WHERE d.advisor_id = ? AND d.id IN (SELECT value FROM json_each(?))
    ORDER BY v.deliverable_id, v.version DESC
  `).bind(advisorId, JSON.stringify(ids)).all<VersionRow>()).results : [];
  const byDeliverable = versionsByDeliverable(versions);
  const items = rows.results.map((d) => {
    const vs = byDeliverable.get(Number(d.id)) ?? [];
    return {
      id: d.id, uid: d.uid, advisor_id: d.advisor_id, engagement_id: d.engagement_id ?? null,
      client_name: d.client_name, title: d.title, due_date: d.due_date ?? null, manual_status: d.manual_status ?? null,
      client_user_id: d.client_user_id ?? null, client_user_name: d.client_user_name ?? null, client_user_email: d.client_user_email ?? null,
      state: deliverableState(vs), ready_version: readyVersion(vs), version_count: vs.length,
      latest_version: vs[0] ? sentVersionDto(vs[0]) : null, versions: vs.map(sentVersionDto),
      // A relink never changes the identity or address recorded at send time.
      recipient_email: (vs.find((v) => v.sent_at) as any)?.recipient_email ?? null,
      created_at: d.created_at, updated_at: d.updated_at,
    };
  });
  return { items, page: pageFacts(w, totals.work_products, items.length), totals,
    population: { definition: 'practice_deliverables_v1', complete: true } };
}

/** Client detail is bounded and batched; totals cover all versions sent to this recipient. */
export async function receivedDeliverables(env: Env, recipientId: number, w: PageWindow) {
  const [rows, totals] = await Promise.all([
    env.DB.prepare(`SELECT d.id, d.uid, d.title, d.updated_at, a.display_name AS advisor_name, a.uid AS advisor_uid
      FROM advisor_deliverables d JOIN advisors a ON a.id = d.advisor_id
      WHERE EXISTS (SELECT 1 FROM advisor_deliverable_versions v
        WHERE v.deliverable_id = d.id AND v.sent_at IS NOT NULL AND v.recipient_user_id = ?)
      ORDER BY d.updated_at DESC, d.id DESC LIMIT ? OFFSET ?`).bind(recipientId, w.limit, w.offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS work_products, COUNT(DISTINCT advisor_id) AS advisors,
        COALESCE(SUM(CASE WHEN opened = 0 THEN 1 ELSE 0 END), 0) AS unread
      FROM (SELECT d.id, d.advisor_id, MAX(CASE WHEN v.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened
        FROM advisor_deliverables d JOIN advisors a ON a.id = d.advisor_id
        JOIN advisor_deliverable_versions v ON v.deliverable_id = d.id
        WHERE v.sent_at IS NOT NULL AND v.recipient_user_id = ? GROUP BY d.id, d.advisor_id)`)
      .bind(recipientId).all(),
  ]);
  const details = rows.results as any[];
  const ids = details.map((d) => Number(d.id));
  const versions = ids.length ? (await env.DB.prepare(`SELECT * FROM advisor_deliverable_versions
    WHERE deliverable_id IN (SELECT value FROM json_each(?)) AND sent_at IS NOT NULL AND recipient_user_id = ?
    ORDER BY deliverable_id, version DESC`).bind(JSON.stringify(ids), recipientId).all<VersionRow>()).results : [];
  const byDeliverable = versionsByDeliverable(versions);
  const items = details.map((d) => {
    const vs = (byDeliverable.get(Number(d.id)) ?? []).map(versionDto);
    return { uid: d.uid, title: d.title, advisor_name: d.advisor_name, advisor_uid: d.advisor_uid,
      state: deliverableState(vs), version_count: vs.length, versions: vs, updated_at: d.updated_at };
  });
  const t = totals.results[0] as any;
  return { items, page: pageFacts(w, Number(t.work_products), items.length),
    totals: { work_products: Number(t.work_products), unread: Number(t.unread), advisors: Number(t.advisors) },
    population: { definition: 'practice_recipient_deliverables_v1', complete: true } };
}

export async function sendDeliverable(env: Env, advisorId: number, row: DeliverableRow, version: number) {

    const v = await env.DB.prepare(
      'SELECT * FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = ?'
    ).bind(row.id, version).first<VersionRow>();
    if (!v) return practiceRefusal({ detail: 'Version not found' }, 404);
    if (v.sent_at) return practiceRefusal({ detail: 'That version has already been sent' }, 409);

    const client = row.engagement_id == null ? null : await env.DB.prepare(
      `SELECT u.id FROM advisor_engagements e
         JOIN users u ON u.id = e.founder_user_id
        WHERE e.id = ? AND e.advisor_id = ?`
    ).bind(row.engagement_id, advisorId).first<{ id: number }>();
    if (!client) {
      return practiceRefusal({
        detail: 'Link this work product to an engagement whose client has an Axal account before sending — nothing an unlinked client is sent can ever be recorded as opened',
      }, 409);
    }

    // #4712: nothing is sent that has nothing in it. A version with no link has
    // no content for the client to open (an empty v1 from a title-only work
    // product, or an empty revision recorded before this rule).
    if (!hasDocument(v)) {
      return practiceRefusal({ detail: 'This version has no content to send. Add a version with a link or a file, then send that one.', code: 'empty_version' }, 422);
    }

    const now = nowIso();
    // #5316 (D5316): the send clears the "ready to send" mark in the same UPDATE,
    // so a sent version is never also waiting to be sent.
    // #4684: THE RECIPIENT IS FIXED HERE, in the same UPDATE as `sent_at`. The
    // client routes authorise against it, never against the engagement's current
    // client, so a later relink can neither take this version from the person it
    // went to nor hand it to someone else. `sent_at IS NULL` in the WHERE makes
    // two concurrent sends one send.
    await ensureAdvisorStoresSchema(env);
    const sent: any = await env.DB.prepare(
      `UPDATE advisor_deliverable_versions SET sent_at = ?, recipient_user_id = ?,
              ready_at = NULL, ready_by_user_id = NULL, updated_at = ?
        WHERE id = ? AND sent_at IS NULL`
    ).bind(now, client.id, now, v.id).run();
    if (!sent.meta?.changes) return practiceRefusal({ detail: 'That version has already been sent' }, 409);
    await env.DB.prepare('UPDATE advisor_deliverables SET updated_at = ? WHERE id = ?')
      .bind(now, row.id).run();
    const fresh = await env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return (versionDto(fresh!));
}

export async function openDeliverable(env: Env, user: User, uid: string) {

    const v = await env.DB.prepare(
      `SELECT v.* FROM advisor_deliverable_versions v
        WHERE v.uid = ? AND v.recipient_user_id = ? AND v.sent_at IS NOT NULL`
    ).bind(uid, user.id).first<VersionRow>();
    if (!v) return practiceRefusal({ detail: 'Work product not found' }, 404);

    const now = nowIso();
    // #4684: the receipt records who made it, and only the recipient can: the
    // WHERE repeats the recipient so no other account's open can land here.
    await env.DB.prepare(
      `UPDATE advisor_deliverable_versions SET opened_at = ?, opened_by_user_id = ?, updated_at = ?
        WHERE id = ? AND opened_at IS NULL AND recipient_user_id = ?`
    ).bind(now, user.id, now, v.id, user.id).run();
    const fresh = await env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return (versionDto(fresh!));
}

export async function acceptDeliverable(env: Env, user: User, uid: string) {

    const v = await env.DB.prepare(
      `SELECT v.* FROM advisor_deliverable_versions v
        WHERE v.uid = ? AND v.recipient_user_id = ? AND v.sent_at IS NOT NULL`
    ).bind(uid, user.id).first<VersionRow>();
    if (!v) return practiceRefusal({ detail: 'Work product not found' }, 404);
    const now = nowIso();
    const accepted: any = await env.DB.prepare(
      `UPDATE advisor_deliverable_versions
          SET signed_off_at = ?, signed_off_by_user_id = ?,
              opened_by_user_id = CASE WHEN opened_at IS NULL THEN ? ELSE opened_by_user_id END,
              opened_at = COALESCE(opened_at, ?), updated_at = ?
        WHERE id = ? AND signed_off_at IS NULL AND recipient_user_id = ?`
    ).bind(now, user.id, user.id, now, now, v.id, user.id).run();
    if (accepted.meta?.changes) {
      await logAdminAction(env, user.id, user.email, 'advisor_deliverable_accepted', { version_id: v.id });
    }
    const fresh = await env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return (versionDto(fresh!));
}
