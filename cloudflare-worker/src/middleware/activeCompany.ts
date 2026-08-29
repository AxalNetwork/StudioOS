/**
 * activeCompany — turns a client's company claim into a VERIFIED company id.
 *
 * The browser sends the company the CompanySwitcher has selected. That value is
 * a request from an untrusted party, exactly like any other header, and the
 * whole point of this module is that it never reaches a query unchecked. The
 * client says which company; `user_company_links` says whether it may.
 *
 * The failure this prevents is not subtle today, but it is inevitable later.
 * `companyScope` narrows a founder's OWN projects, so a forged id cannot reach
 * another founder's rows through it. But scope functions get reused —
 * `esignEnvelopeScope` and `fundGpScope` both started narrow — and the first
 * scope that treats company as an AUTHORISATION rather than a filter would
 * inherit an unverified id from every caller written before it. Verifying once,
 * here, means that scope can be written without re-auditing its callers.
 *
 * NULL IS THE ANSWER FOR EVERY UNCERTAIN CASE: header absent, unparseable, or
 * naming a company the caller does not belong to. Null means "no company
 * selected", which `companyScope` reads as "every project you own" — correct
 * for the single-company user and for the moment before the switcher is
 * touched. A rejected claim is therefore ignored rather than 403'd: a stale id
 * in a long-open tab is an ordinary event (membership revoked, company
 * deleted), and blanking the app on it would be a worse bug than the one being
 * prevented. Nothing is granted by returning null, so failing open here is not
 * failing open on access.
 */

export const ACTIVE_COMPANY_HEADER = 'X-Company-Id';

/**
 * The caller's active company id, or null.
 *
 * @param env   worker env (needs DB)
 * @param user  the authenticated principal — pass the result of requireAuth
 * @param raw   the raw header value, straight off the request
 */
export async function resolveActiveCompany(
  env: { DB: D1Database },
  user: { id?: number | null } | null | undefined,
  raw: string | null | undefined,
): Promise<number | null> {
  const userId = typeof user?.id === 'number' ? user.id : null;
  if (userId === null) return null;
  if (!raw) return null;

  // Number() alone accepts '', '0x10', ' 12 ', '1e3' and Infinity. A company id
  // is a run of digits or it is nothing, so the shape is checked before the
  // conversion rather than after it.
  const trimmed = raw.trim();
  if (!/^[0-9]{1,15}$/.test(trimmed)) return null;
  const claimed = Number(trimmed);
  if (!Number.isSafeInteger(claimed) || claimed <= 0) return null;

  const link = await env.DB.prepare(
    'SELECT 1 AS ok FROM user_company_links WHERE user_id = ? AND company_id = ? LIMIT 1',
  ).bind(userId, claimed).first<{ ok: number }>();

  return link ? claimed : null;
}
