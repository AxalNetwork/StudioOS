/**
 * D717 (#1782) decision 11 — GET /api/admin/fund-structure: the entity and
 * money map behind the "Structure of the Fund" sheet on the Contracts desk
 * (`?sheet=structure`, #1855) and the Bank accounts console.
 *
 * An admin on HQ only: a branch is refused with `HQ_ONLY`, as
 * `requireSuperAdmin` refuses it (the entities and their accounts are HQ's).
 * A Super Admin's map carries each receiving account masked, or #1773's
 * refusal sentence, and also lists each entity's active accounts, masked, from
 * the registry's list (`accounts`; never revealed or decrypted). A plain
 * Admin's carries #1773 decision 5's sentence and no `accounts`, and the
 * registry is not read for it. Read-only: nothing here moves money.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, isSuperAdmin } from '../auth';
import { branchOf, HQ_ONLY } from '../util/branch';
import { fundStructureModel } from '../services/fundStructure';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

r.get('/', async (c) => {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  try {
    const model = await fundStructureModel(c.env, { audience: isSuperAdmin(user as any) ? 'super_admin' : 'admin' });
    c.header('Cache-Control', 'no-store');
    return c.json(model);
  } catch (e) {
    return refuse(c, 503, { code: 'fund_structure_unreadable', message: 'The map could not be read. Try again.', raw: e });
  }
});

export default r;
