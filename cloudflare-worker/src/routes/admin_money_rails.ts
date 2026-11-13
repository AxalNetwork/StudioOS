/**
 * D707 (#1772) — `GET /api/admin/money-rails`: each Axal entity's role, each
 * kind of money's payer, payee and rail, and whose Stripe account takes
 * payments, with its mode. Admin only. It answers no key and no account number.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { AXAL_ENTITIES, type AxalEntityKey } from '../services/legalDocFormat';
import { ENTITY_ROLES, MONEY_KINDS } from '../services/moneyRails';
import { stripeMode } from '../services/catalog';

const adminMoneyRails = new Hono<{ Bindings: Env }>();

adminMoneyRails.get('/', async (c) => {
  await requireAdmin(c);
  const keys = Object.keys(ENTITY_ROLES) as AxalEntityKey[];
  return c.json({
    entities: keys.map((key) => ({ key, name: AXAL_ENTITIES[key].name, role: ENTITY_ROLES[key] })),
    kinds: MONEY_KINDS,
    stripe: { account_holder: 'management', mode: stripeMode(c.env) },
  });
});

export default adminMoneyRails;
