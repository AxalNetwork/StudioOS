/**
 * #4046 — who may open a deal for which firm, and which firm a deal note is
 * filed under: `routes/deal_context.ts`' rule (D1150), shared with the deal
 * note's fill scope (`services/fills/scopes.ts`) so the two never drift.
 * Literal statements only; every value is bound. Imports nothing.
 */

/**
 * The firm a deal note is filed under, by `context`'s rule: the request's
 * verified active company; else the caller's only firm; else none (null).
 * `undefined` when the caller holds two firms and named none, or named one
 * they do not hold: an invalid explicit claim never falls back to another firm.
 */
export async function noteFirm(db: D1Database, userId: number, active: number | null, claimed: boolean): Promise<number | null | undefined> {
  if (active != null) return active;
  if (claimed) return undefined;
  const links = await db.prepare('SELECT DISTINCT company_id FROM user_company_links WHERE user_id = ? LIMIT 2').bind(userId).all();
  if (links.results.length > 1) return undefined;
  return links.results.length ? Number(links.results[0].company_id) : null;
}

/** The deal, when this investor may open it for this firm: invited or committed, on a venture not deleted. */
export function visibleDeal(db: D1Database, dealId: number, userId: number, company: number | null) {
  return db.prepare(`SELECT d.id, d.project_id, d.status, d.created_at, d.updated_at FROM deals d
    WHERE d.id = ? AND EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id AND p.deleted_at IS NULL)
    AND (EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id AND i.investor_user_id = ? AND (i.company_id = ? OR i.company_id IS NULL))
      OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id AND k.investor_user_id = ? AND (k.company_id = ? OR k.company_id IS NULL)))`)
    .bind(dealId, userId, company, userId, company).first();
}

