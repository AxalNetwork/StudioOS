/**
 * D601 (#998; the owner's answer 1A) — HQ moves a paid formation order on by
 * hand. Mounted at /api/admin/incorporations. Every endpoint gates on
 * requireAdmin, and every write is recorded through logAdminAction.
 *
 *   GET  /                    → paid orders, each with its project's documents
 *   POST /:id/packet-ready    → { document_id } — the packet, a document of the order's project
 *   POST /:id/filed           → { filed_on: 'YYYY-MM-DD' } — the date it was filed with the state
 *
 * Nothing here assembles a packet or files with a state; it records what an
 * admin did (services/incorporationFiling.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { listPaidOrders, markFiled, markPacketReady } from '../services/incorporationFiling';

const r = new Hono<{ Bindings: Env }>();

r.get('/', async (c) => {
  await requireAdmin(c);
  return c.json({ orders: await listPaidOrders(c.env) });
});

r.post('/:id/packet-ready', async (c) => {
  const admin = await requireAdmin(c);
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as { document_id?: unknown };
  const out = await markPacketReady(c.env, id, body.document_id, admin.id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  await logAdminAction(c.env, admin.id, admin.email, 'incorporation_packet_ready', {
    incorporation_id: id, document_id: Number(body.document_id),
  });
  return c.json(out);
});

r.post('/:id/filed', async (c) => {
  const admin = await requireAdmin(c);
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as { filed_on?: unknown };
  const out = await markFiled(c.env, id, body.filed_on, admin.id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  await logAdminAction(c.env, admin.id, admin.email, 'incorporation_filed', {
    incorporation_id: id, filed_on: body.filed_on,
  });
  return c.json(out);
});

export default r;
