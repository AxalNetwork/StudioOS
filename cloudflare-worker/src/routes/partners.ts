import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const partners = new Hono<{ Bindings: Env }>();

partners.get('/', async (c) => {
  await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM partners ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

partners.post('/', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const refCode = `AXAL-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const sql = getSQL(c.env);
  const [partner] = await sql`INSERT INTO partners (name, company, email, specialization, referral_code) VALUES (${data.name}, ${data.company || null}, ${data.email}, ${data.specialization || null}, ${refCode}) RETURNING *`;
  await sql.end();
  return c.json(partner, 201);
});

partners.get('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM partners WHERE id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Partner not found' }, 404);
  return c.json(rows[0]);
});

partners.get('/referral/:code', async (c) => {
  await requireAuth(c);
  const code = c.req.param('code');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM partners WHERE referral_code = ${code}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Invalid referral code' }, 404);
  return c.json(rows[0]);
});

partners.post('/referral/:code/use', async (c) => {
  await requireAuth(c);
  const code = c.req.param('code');
  const sql = getSQL(c.env);
  const rows = await sql`UPDATE partners SET referrals_count = referrals_count + 1 WHERE referral_code = ${code} RETURNING *`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Invalid referral code' }, 404);
  return c.json({ message: 'Referral tracked', partner: rows[0] });
});

partners.get('/matchmaking/recommend', async (c) => {
  await requireAuth(c);
  const sector = c.req.query('sector');
  const sql = getSQL(c.env);
  const rows = sector
    ? await sql`SELECT * FROM partners WHERE status = 'active' AND specialization LIKE ${'%' + sector + '%'}`
    : await sql`SELECT * FROM partners WHERE status = 'active'`;
  await sql.end();
  return c.json({ matches: rows, count: rows.length });
});

partners.post('/matchPartners', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const allPartners = await sql`SELECT * FROM partners WHERE status = 'active'`;
  await sql.end();

  const ranked = allPartners.map((p: any) => {
    let score = 10;
    const reasons: string[] = [];
    if (data.sector && p.specialization) {
      const specs = p.specialization.toLowerCase().replace(/\//g, ',').split(',').map((s: string) => s.trim());
      if (specs.includes(data.sector.toLowerCase())) { score += 40; reasons.push(`Sector match: ${p.specialization}`); }
    }
    if (data.expertise_needed && p.specialization) {
      for (const kw of data.expertise_needed.split(',')) {
        if (p.specialization.toLowerCase().includes(kw.trim().toLowerCase())) { score += 20; reasons.push(`Expertise match: ${kw.trim()}`); }
      }
    }
    if (p.referrals_count > 0) { score += Math.min(p.referrals_count * 5, 20); reasons.push(`Referral track record: ${p.referrals_count}`); }
    return { partner_id: p.id, name: p.name, company: p.company, specialization: p.specialization, match_score: Math.min(score, 100), reasons, referral_code: p.referral_code };
  }).sort((a: any, b: any) => b.match_score - a.match_score);

  return c.json({ startup_id: data.startup_id, matches: ranked, total_matched: ranked.length });
});

export default partners;
