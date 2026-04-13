import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const deals = new Hono<{ Bindings: Env }>();

deals.get('/', async (c) => {
  await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const rows = status
    ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE d.status = ${status} ORDER BY d.created_at DESC`
    : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id ORDER BY d.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

deals.post('/', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const p = await sql`SELECT id FROM projects WHERE id = ${data.project_id}`;
  if (p.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const [deal] = await sql`INSERT INTO deals (project_id, partner_id, status, notes, amount) VALUES (${data.project_id}, ${data.partner_id || null}, ${data.status || 'applied'}, ${data.notes || null}, ${data.amount || null}) RETURNING *`;
  await sql.end();
  return c.json(deal, 201);
});

deals.get('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.name as project_name, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE d.id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Deal not found' }, 404);
  return c.json(rows[0]);
});

deals.put('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }

  if (data.status) await sql`UPDATE deals SET status = ${data.status}, updated_at = now() WHERE id = ${id}`;
  if (data.partner_id !== undefined) await sql`UPDATE deals SET partner_id = ${data.partner_id}, updated_at = now() WHERE id = ${id}`;
  if (data.notes !== undefined) await sql`UPDATE deals SET notes = ${data.notes}, updated_at = now() WHERE id = ${id}`;
  if (data.amount !== undefined) await sql`UPDATE deals SET amount = ${data.amount}, updated_at = now() WHERE id = ${id}`;

  const [updated] = await sql`SELECT * FROM deals WHERE id = ${id}`;
  await sql.end();
  return c.json(updated);
});

export default deals;
