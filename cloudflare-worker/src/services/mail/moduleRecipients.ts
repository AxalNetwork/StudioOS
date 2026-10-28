/** D1345: the two former Messages starters, under their own module's scope. */
import type { Env, User } from '../../types';
import { andScope, lpSelfScope } from '../tenancyScope';
import { advisorRow, caseOnly, profileOf, RecordMissing, type ProfileRead } from './profileRecords';

const missing = () => new RecordMissing('not found');
const address = (v: unknown) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.trim().length <= 320 ? v.trim().toLowerCase() : null;

export async function moduleRecipient(env: Env, user: User, kind: string, id: string): Promise<ProfileRead | null> {
  if (kind !== 'fund_gp' && kind !== 'work_product') return null;
  if (caseOnly(user) || !/^[1-9][0-9]{0,9}$/.test(id)) throw missing();
  const ref = `${kind}:${id}`;
  if (kind === 'fund_gp') {
    // Same self-view predicate as LPs.listByUser; an email match never claims a linked LP row.
    const query = andScope(`SELECT f.name, f.gp_name, gu.email AS address, lp.status, lp.updated_at
      FROM limited_partners lp JOIN vc_funds f ON f.id = lp.fund_id
      JOIN users gu ON gu.id = f.gp_user_id
      WHERE f.id = ?`, [Number(id)], lpSelfScope(user));
    const r = await env.DB.prepare(query.sql + ' ORDER BY lp.id LIMIT 1')
      .bind(...query.binds).first<any>();
    if (!r) throw missing();
    const name = r.gp_name || 'General partner of record';
    return {
      person: { ref, kind, relationship: 'fund_gp', name, project_id: null, address: address(r.address) },
      item: { ref, kind, label: `LP commitment · ${r.name}`, as_of: r.updated_at?.slice(0, 10) ?? null,
        link: '/spinout-lab/investor-workspace#my-commitment', selected: true,
        text: `Fund: ${r.name}\nGeneral partner: ${name}\nYour LP status: ${r.status ?? 'Not recorded'}` }, more: [],
    };
  }
  if (profileOf(user) !== 'advisor') throw missing();
  const advisor = await advisorRow(env, user);
  if (!advisor) throw missing();
  const r = await env.DB.prepare(`SELECT d.title, d.updated_at, u.name, u.email AS address
    FROM advisor_deliverables d
    JOIN advisor_engagements e ON e.id = d.engagement_id AND e.advisor_id = d.advisor_id
    JOIN users u ON u.id = e.founder_user_id
    WHERE d.id = ? AND d.advisor_id = ? LIMIT 1`)
    .bind(Number(id), advisor.id).first<any>();
  if (!r) throw missing();
  const name = r.name || 'Client';
  return {
    person: { ref, kind, relationship: 'founder', name, project_id: null, address: address(r.address) },
    item: { ref, kind, label: `Work product · ${r.title}`, as_of: r.updated_at?.slice(0, 10) ?? null,
      link: '/practice/delivery', selected: true,
      text: `Client: ${name}\nWork product: ${r.title}` }, more: [],
  };
}
