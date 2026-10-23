/**
 * /api/carta/investor — the investor's own Carta, on HQ or a branch (#2634).
 * Live read-only pages; no founder cap-table writes and no admin/support bypass.
 * Only the member's own active investor grant is usable. No row/owner parameter.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { refuse } from '../util/refusal';
import type { IntegrationRow } from '../integrations/registry';
import { cartaFetch } from '../integrations/providers/carta';
import { CARTA_INVESTOR_SCOPES, cartaExtraScopes } from '../integrations/cartaScopes';
import { cartaIdValid, cartaPageValid, readCartaInvestor, type CartaResource } from '../integrations/cartaInvestor';

const app = new Hono<{ Bindings: Env }>();
const resources: Array<{ path: string; kind: CartaResource; ids: string[] }> = [
  { path: '/firms', kind: 'firms', ids: [] },
  { path: '/firms/:firmId/funds', kind: 'funds', ids: ['firmId'] },
  { path: '/firms/:firmId/funds/:fundId/investments', kind: 'investments', ids: ['firmId', 'fundId'] },
  ...(['certificates', 'convertibleNotes', 'warrants', 'capitalizationTables'] as const).map(kind => ({
    path: `/firms/:firmId/funds/:fundId/investments/:companyId/${kind}`, kind, ids: ['firmId', 'fundId', 'companyId'],
  })),
  { path: '/firms/:firmId/funds/:fundId/investments/:companyId/capitalizationTables/:capTableId', kind: 'capitalizationTable', ids: ['firmId', 'fundId', 'companyId', 'capTableId'] },
];
for (const resource of resources) app.get(resource.path, async c => {
  c.header('Cache-Control', 'private, no-store');
  const user = await requireAuth(c);
  if ((await selectJwt(c))?.payload.impersonated_by) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot read a member’s Carta account.' });
  if (user.role !== 'investor') return refuse(c, 403, { code: 'purpose_not_allowed', message: 'Only an investor can read their own Carta firm here.' });
  const pageToken = c.req.query('page_token');
  if ((pageToken !== undefined && !cartaPageValid(pageToken)) || resource.ids.some(key => !cartaIdValid(c.req.param(key) || ''))) {
    return c.json({ error: 'invalid_carta_request' }, 400);
  }
  const row = await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'carta' LIMIT 1").bind(user.id).first<IntegrationRow>();
  if (!row) return refuse(c, 409, { code: 'carta_not_connected', message: 'Connect your own Carta firm on Connectors first.' });
  let audience: unknown, scopes: string[];
  try {
    audience = JSON.parse(row.config_json || '{}').audience;
    scopes = JSON.parse(row.scopes_json || '[]');
    if (!Array.isArray(scopes) || !scopes.every(s => typeof s === 'string')) throw new Error();
  } catch { return refuse(c, 409, { code: 'carta_reconnect_required', message: 'Your Carta connection could not be read. Connect again.' }); }
  if (row.status !== 'active' || row.auth_type !== 'oauth2' || audience !== 'investor' || cartaExtraScopes('investor', scopes).length || CARTA_INVESTOR_SCOPES.some(s => !scopes.includes(s))) {
    return refuse(c, 409, { code: 'carta_reconnect_required', message: 'Connect Carta again with investor read permissions.' });
  }
  const path = '/investors' + resource.path.replace(/:([A-Za-z]+)/g, (_all, key) => encodeURIComponent(c.req.param(key)!));
  let data: Awaited<ReturnType<typeof readCartaInvestor>>;
  try {
    data = await readCartaInvestor(path => cartaFetch(c.env, row, path), path, resource.kind, pageToken);
  } catch (error) {
    if (error instanceof Error && error.message === 'carta_scope_overreach') {
      return refuse(c, 409, { code: 'carta_reconnect_required', message: 'Carta returned different permissions. Connect again with investor read permissions.' });
    }
    return refuse(c, 502, { code: 'carta_unreadable', message: 'Your Carta data is unreadable. Check the permissions in Carta and try again. Nothing changed.' });
  }
  // Counts and a static resource name only; no firms, securities, names or figures.
  const count = 'items' in data ? data.items.length : 1;
  try {
    await c.env.DB.prepare("INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary) VALUES (?, ?, 'carta', 'outbound', ?, 'ok', ?)")
      .bind(row.id, user.id, `investor_${resource.kind}`, `read=${resource.kind} count=${count}`).run();
  } catch {
    return refuse(c, 503, { code: 'carta_read_log_unavailable', message: 'Axal could not record this read. Try again in a moment.' });
  }
  return c.json(data);
});
export default app;
