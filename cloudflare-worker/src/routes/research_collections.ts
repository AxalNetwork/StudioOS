/** D549: named groups of the caller's own Library documents. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';

const collections = new Hono<{ Bindings: Env }>();
interface CollectionRow { id: number; uid: string; name: string; created_at: string; updated_at: string }
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120;
async function ownCollection(env: Env, uid: string, userId: number) {
  return env.DB.prepare('SELECT id, uid, name, created_at, updated_at FROM research_collections WHERE uid = ? AND owner_user_id = ?')
    .bind(uid, userId).first<CollectionRow>();
}
collections.get('/', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare('SELECT id, uid, name, created_at, updated_at FROM research_collections WHERE owner_user_id = ? ORDER BY id DESC LIMIT 500')
    .bind(user.id).all<CollectionRow>();
  const members = await c.env.DB.prepare(
    `SELECT collection.uid AS collection_uid, document.uid AS document_uid
       FROM research_collection_documents member
       JOIN research_collections collection ON collection.id = member.collection_id
       JOIN research_documents document ON document.id = member.document_id
      WHERE collection.owner_user_id = ? AND document.owner_user_id = ?`
  ).bind(user.id, user.id).all<{ collection_uid: string; document_uid: string }>();
  return c.json({ items: (rows.results || []).map(({ uid, name, created_at, updated_at }) => ({
    uid, name, created_at, updated_at, document_uids: (members.results || []).filter((member) => member.collection_uid === uid).map((member) => member.document_uid),
  })) });
});
collections.post('/', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => null);
  if (!validName(body?.name)) return c.json({ detail: 'invalid_collection_name' }, 400);
  const uid = newUid();
  await c.env.DB.prepare('INSERT INTO research_collections (uid, owner_user_id, name, created_by) VALUES (?, ?, ?, ?)')
    .bind(uid, user.id, body.name.trim(), user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_collection_created', { collection_uid: uid });
  return c.json({ item: { uid, name: body.name.trim(), document_uids: [] } }, 201);
});
collections.patch('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await ownCollection(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!validName(body?.name)) return c.json({ detail: 'invalid_collection_name' }, 400);
  await c.env.DB.prepare("UPDATE research_collections SET name = ?, updated_at = datetime('now') WHERE uid = ? AND owner_user_id = ?")
    .bind(body.name.trim(), row.uid, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_collection_renamed', { collection_uid: row.uid });
  return c.json({ ok: true });
});
collections.delete('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await ownCollection(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  // Membership cascades; documents and their R2/vector contents remain.
  await c.env.DB.prepare('DELETE FROM research_collections WHERE uid = ? AND owner_user_id = ?')
    .bind(row.uid, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_collection_deleted', { collection_uid: row.uid });
  return c.json({ ok: true });
});
collections.post('/:uid/documents', async (c) => {
  const user = await requireAuth(c);
  const row = await ownCollection(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (typeof body?.document_uid !== 'string' || !body.document_uid) return c.json({ detail: 'document_uid_required' }, 400);
  const document = await c.env.DB.prepare('SELECT id FROM research_documents WHERE uid = ? AND owner_user_id = ?')
    .bind(body.document_uid, user.id).first<{ id: number }>();
  if (!document) return c.json({ detail: 'not_found' }, 404);
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO research_collection_documents (collection_id, document_id, created_by)
     SELECT collection.id, document.id, ? FROM research_collections collection, research_documents document
      WHERE collection.uid = ? AND collection.owner_user_id = ? AND document.uid = ? AND document.owner_user_id = ?`
  ).bind(user.id, row.uid, user.id, body.document_uid, user.id).run();
  await logAdminAction(c.env, user.id, user.email, 'research_collection_document_added', { collection_uid: row.uid, document_uid: body.document_uid });
  return c.json({ ok: true });
});
collections.delete('/:uid/documents/:documentUid', async (c) => {
  const user = await requireAuth(c);
  const row = await ownCollection(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ detail: 'not_found' }, 404);
  const documentUid = c.req.param('documentUid');
  const result = await c.env.DB.prepare(
    `DELETE FROM research_collection_documents WHERE collection_id = ?
      AND document_id IN (SELECT id FROM research_documents WHERE uid = ? AND owner_user_id = ?)`
  ).bind(row.id, documentUid, user.id).run();
  if (!result.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  await logAdminAction(c.env, user.id, user.email, 'research_collection_document_removed', { collection_uid: row.uid, document_uid: documentUid });
  return c.json({ ok: true });
});
export default collections;
