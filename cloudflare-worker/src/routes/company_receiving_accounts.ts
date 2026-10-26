/** D1217 (#3214): prepared /api/closings/company-receiving-accounts routes. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireBranchNotSuspended } from '../auth';
import { isSupportSession } from '../integrations/providers/mercury';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { CompanyAccountError, readCompanyAccount, setCompanyAccount, revealCompanyAccount } from '../services/companyReceivingAccounts';

const accounts = new Hono<{ Bindings: Env }>();
accounts.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'Receiving account instructions are not available in a support session.' });
  await next();
});
accounts.onError((e, c) => {
  if (e instanceof CompanyAccountError) return refuse(c, e.status, { code: e.code, message: e.publicMessage });
  if (Object.hasOwn(AUTH_ERROR_STATUSES, e.message)) {
    const status = AUTH_ERROR_STATUSES[e.message];
    return refuse(c, status, { code: status === 423 ? 'branch_suspended' : status === 401 ? 'unauthorized' : 'forbidden',
      message: status === 423 ? 'This studio is suspended, so the account cannot be changed.' : 'This account cannot take that action.' });
  }
  console.error('[company-account] request unavailable');
  return refuse(c, 503, { code: 'company_account_unavailable', message: 'These instructions could not be read or saved. Try again.' });
});
accounts.get('/:projectId', async (c) => {
  const user = await requireAuth(c);
  return c.json(await readCompanyAccount(c.env, user.id, Number(c.req.param('projectId'))));
});
accounts.put('/:projectId', async (c) => {
  const user = await requireAuth(c);
  await requireBranchNotSuspended(c);
  const input = await c.req.json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse(c, 400, { code: 'invalid_body', message: 'Enter the receiving account details.' });
  return c.json(await setCompanyAccount(c.env, user.id, Number(c.req.param('projectId')), input));
});
accounts.post('/:projectId/reveal', async (c) => {
  const user = await requireAuth(c);
  const input = await c.req.json().catch(() => null);
  return c.json(await revealCompanyAccount(c.env, user.id, Number(c.req.param('projectId')), input?.commitment_uid));
});
export default accounts;
