/** D957: the admin page and program catalogue share exact claim counts. */
import type { Env } from '../types';

export async function perkClaimsCounts(env: Env, weeks = 12, now = new Date()) {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new Error('bad_weeks');
  const end = now.toISOString();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7 - 7 * (weeks - 1));
  const from = monday.toISOString().slice(0, 10);
  const listings = await env.DB.prepare(
    `SELECT p.uid, p.offer, p.partner_name, COUNT(*) AS claims,
            SUM(CASE WHEN x.status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed
       FROM perk_claims x JOIN perks p ON p.id = x.perk_id
      WHERE datetime(x.created_at) >= datetime(?) AND datetime(x.created_at) <= datetime(?)
      GROUP BY p.id, p.uid, p.offer, p.partner_name ORDER BY claims DESC, p.uid`,
  ).bind(from, end).all<{ uid: string; offer: string; partner_name: string; claims: number; redeemed: number }>();
  const buckets = await env.DB.prepare(
    `SELECT date(datetime(created_at), '-6 days', 'weekday 1') AS week, kind_at_claim,
            COUNT(*) AS claims, SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed
       FROM perk_claims WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
      GROUP BY date(datetime(created_at), '-6 days', 'weekday 1'), kind_at_claim`,
  ).bind(from, end).all<{ week: string; kind_at_claim: string; claims: number; redeemed: number }>();
  const by_week = [];
  for (let i = 0; i < weeks; i++) {
    const week = monday.toISOString().slice(0, 10);
    for (const kind_at_claim of ['credits', 'tier', 'money']) {
      const row = buckets.results?.find((x) => x.week === week && x.kind_at_claim === kind_at_claim);
      by_week.push({ week, kind_at_claim, claims: Number(row?.claims || 0), redeemed: Number(row?.redeemed || 0) });
    }
    monday.setUTCDate(monday.getUTCDate() + 7);
  }
  const totals = by_week.reduce((sum, x) => ({ claims: sum.claims + x.claims, redeemed: sum.redeemed + x.redeemed }), { claims: 0, redeemed: 0 });
  return { from, by_listing: listings.results || [], by_week, totals };
}
