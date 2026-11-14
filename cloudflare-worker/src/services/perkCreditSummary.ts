/** D957 (#2790), OD8 A: active non-admin holdings, with debt kept separate. */
import type { Env } from '../types';

type RoleBalance = {
  role: string;
  credits_held: number;
  accounts: number;
  negative_total: number;
  negative_accounts: number;
};

export async function perkCreditSummary(env: Env) {
  const result = await env.DB.prepare(
    `WITH balances AS (
       SELECT u.id, u.role, COALESCE(SUM(l.delta), 0) AS balance
       FROM users u LEFT JOIN perk_credit_ledger l ON l.user_id = u.id
       WHERE u.is_active = ? AND u.role <> ?
       GROUP BY u.id, u.role
     )
     SELECT role,
       SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END) AS credits_held,
       SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS accounts,
       SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END) AS negative_total,
       SUM(CASE WHEN balance < 0 THEN 1 ELSE 0 END) AS negative_accounts
     FROM balances GROUP BY role ORDER BY role`,
  ).bind(1, 'admin').all<RoleBalance>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('credit_summary_unreadable');
  const summary = { credits_held: 0, accounts: 0, roles: [] as string[], negative_balances: { total: 0, accounts: 0 } };
  for (const row of result.results) {
    if (typeof row.role !== 'string' || !row.role || row.role === 'admin'
      || ![row.credits_held, row.accounts, row.negative_total, row.negative_accounts].every(Number.isSafeInteger)
      || row.credits_held < 0 || row.accounts < 0 || row.negative_total > 0 || row.negative_accounts < 0) {
      throw new Error('credit_summary_unreadable');
    }
    summary.credits_held += row.credits_held;
    summary.accounts += row.accounts;
    summary.negative_balances.total += row.negative_total;
    summary.negative_balances.accounts += row.negative_accounts;
    summary.roles.push(row.role);
  }
  if (![summary.credits_held, summary.accounts, summary.negative_balances.total, summary.negative_balances.accounts].every(Number.isSafeInteger)) {
    throw new Error('credit_summary_unreadable');
  }
  return summary;
}
