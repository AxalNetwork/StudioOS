/**
 * D714 (#1779) — the fund administration console's Worker routes, mounted at
 * `/api/fund-admin`.
 *
 * `GET /access` answers which fund acts this admin may take, straight from
 * `FUND_ACTS` (`services/fundAdminAccess.ts`): `requireAdmin`, HQ only, never
 * a support session. The screens draw their controls from it; the Worker
 * still decides each act on its own route. PR 3 adds `GET /overview`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { fundAdminAccess } from '../services/fundAdminAccess';

const fundAdmin = new Hono<{ Bindings: Env }>();

fundAdmin.get('/access', async (c) => c.json(await fundAdminAccess(c)));

export default fundAdmin;
