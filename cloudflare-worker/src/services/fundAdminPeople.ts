/**
 * D4812 part 3 (#4812, board FA-04 B) — `GET /api/fund-admin/funds/:id/people`,
 * the person picker's read for the two people a fund names: its general
 * partner of record (`role=gp`, act `fund.gp_of_record`) and its ledger
 * administrator (`role=ledger`, act `fund_ledger.administrator`).
 *
 * WHO HOLDS IT is answered to any HQ admin on the console's gate: a name and
 * an account kind, never an email, so the fund page stops saying "their name
 * is not read on this page".
 *
 * WHO COULD is the Super Admin's: both changes are Super Admin acts, so only
 * the Super Admin is shown other accounts (`candidates`); an Admin gets
 * `candidates: null`. Each candidate carries the Worker's own rule as its
 * eligibility, with the reason a person cannot hold the role:
 *   · gp      an active HQ admin, because a fund whose GP of record is not an
 *             admin leaves administration (`administeredFunds`);
 *   · ledger  an active investor account, because `PUT
 *             /api/fund-ledger/:id/administrator` writes only that.
 *
 * The search text is trimmed, at most 60 characters, its LIKE wildcards
 * escaped, and bound. At most 20 candidates come back.
 */
import type { Env } from '../types';
import { isAdministered } from './fundReportBuild';

export type PeopleRole = 'gp' | 'ledger';
export const PEOPLE_ROLES: readonly PeopleRole[] = Object.freeze(['gp', 'ledger']);
const PEOPLE_MAX = 20;
export const PEOPLE_Q_MAX = 60;

export type Person = { id: number; name: string; kind: string; eligible: boolean; reason: string | null; current: boolean };

const KIND: Record<string, string> = { admin: 'HQ admin', investor: 'Investor account' };

export const NOT_ELIGIBLE: Record<PeopleRole, string> = {
  gp: 'Not eligible: the general partner of record of an administered fund is an HQ admin. An outside GP’s fund is run from its own fund page.',
  ledger: 'Not eligible: the ledger administrator is an active investor account. HQ admins already keep the books.',
};

const eligibleRole: Record<PeopleRole, string> = { gp: 'admin', ledger: 'investor' };

/** `?role=` and `?q=` from the address, or the name of the parameter that is not valid. */
export function parsePeopleQuery(get: (k: string) => string | undefined): { role: PeopleRole; q: string } | string {
  const role = get('role');
  if (!PEOPLE_ROLES.includes(role as PeopleRole)) return 'role';
  const q = String(get('q') ?? '').trim();
  if (q.length > PEOPLE_Q_MAX) return 'q';
  return { role: role as PeopleRole, q };
}

const person = (row: any, role: PeopleRole, currentId: number | null): Person => {
  const ok = row.role === eligibleRole[role] && Number(row.is_active) === 1;
  return {
    id: Number(row.id),
    name: String(row.name || 'Name not recorded'),
    kind: KIND[row.role] || 'Other account',
    eligible: ok,
    reason: ok ? null : Number(row.is_active) !== 1 ? 'Not eligible: this account is not active.' : NOT_ELIGIBLE[role],
    current: currentId != null && Number(row.id) === currentId,
  };
};

/**
 * The holder and, for the Super Admin, the candidates; `not_found` for a fund
 * that is not administered here. Throws when a store cannot be read.
 */
export async function fundPeople(env: Env, fundId: number, role: PeopleRole, q: string, superAdmin: boolean):
  Promise<{ role: PeopleRole; current: Person | null; candidates: Person[] | null } | 'not_found'> {
  if (!await isAdministered(env, fundId)) return 'not_found';
  const fund = await env.DB.prepare(`SELECT gp_user_id, fund_admin_user_id FROM vc_funds WHERE id = ?`).bind(fundId)
    .first<{ gp_user_id: number | null; fund_admin_user_id: number | null }>();
  if (!fund) return 'not_found';
  const currentId = role === 'gp' ? fund.gp_user_id : fund.fund_admin_user_id;
  const holder = currentId == null ? null
    : await env.DB.prepare(`SELECT id, name, role, is_active FROM users WHERE id = ?`).bind(currentId).first<any>();
  const current = holder ? person(holder, role, Number(currentId)) : null;
  if (!superAdmin) return { role, current, candidates: null };
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const res = await env.DB.prepare(
    `SELECT id, name, role, is_active FROM users
      WHERE role IN ('admin', 'investor') AND is_active = 1
        AND (? = '' OR name LIKE ? ESCAPE '\\')
      ORDER BY (role = ?) DESC, name, id
      LIMIT ?`,
  ).bind(q, like, eligibleRole[role], PEOPLE_MAX).all<any>();
  if (res && (res as any).success === false) throw new Error('read failed');
  const candidates = ((res?.results || []) as any[]).map((r) => person(r, role, currentId == null ? null : Number(currentId)));
  return { role, current, candidates };
}
