/**
 * The funds a caller may read figures for (D627, D6246; moved here for D6278).
 *
 * An admin reads every fund. An investor reads the funds they hold a limited
 * partner position in (`lpMembershipScope`, after the sign-in claim runs), and
 * the GP of record reads the funds they run through the operating gate's own
 * scope (`managedFundIds`: institutional tier, verified active company), so
 * this list and `requireFundGp` never disagree. Fund performance and the
 * Research benchmark offer (D6278) both read this one list, so a figure is
 * never offered for a fund its reader could not open.
 */
import type { Context } from 'hono';
import type { Env } from '../types';
import { holdsLicence } from './accountLicences';
import { lpMembershipScope } from './tenancyScope';
import { claimLpRowsByEmail } from './lpClaim';
import { managedFundIds } from './fundGpAccess';

export type ReadableFund = { id: number; name: string; vintage_year: number | null; status: string | null };

export async function readableFunds(c: Context<{ Bindings: Env }>, user: any): Promise<ReadableFund[]> {
  const env = c.env;
  if (user.role === 'admin') {
    const all = await env.DB.prepare(`SELECT id, name, vintage_year, status FROM vc_funds ORDER BY id`).all<any>();
    if (!all.success) throw new Error('Fund list read failed');
    return all.results;
  }
  if (holdsLicence(user, 'investor')) await claimLpRowsByEmail(env, Number(user.id), user.email);
  const scope = lpMembershipScope(user);
  const lp = holdsLicence(user, 'investor')
    ? await env.DB.prepare(`SELECT f.id, f.name, f.vintage_year, f.status FROM vc_funds f
        WHERE EXISTS (SELECT 1 FROM limited_partners lp WHERE lp.fund_id = f.id
          AND ${scope.sql}) ORDER BY f.id`)
        .bind(...scope.binds).all<any>()
    : { success: true, results: [] };
  if (!lp.success) throw new Error('Fund list read failed');
  const managed = await managedFundIds(c, user);
  const gp = managed.length
    ? await env.DB.prepare(`SELECT id, name, vintage_year, status FROM vc_funds
        WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(JSON.stringify(managed)).all<any>()
    : { success: true, results: [] };
  if (!gp.success) throw new Error('Fund list read failed');
  const byId = new Map<number, any>();
  for (const fund of [...lp.results, ...gp.results]) if (!byId.has(Number(fund.id))) byId.set(Number(fund.id), fund);
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
