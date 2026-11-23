/**
 * D5834 (#5834): sync a venture's QuickBooks Online P&L and balance sheets into
 * the D5833 revision store. The flow is fetch (`quickbooksClient.ts`) →
 * `fromQuickBooks` → `writeSnapshot`.
 *
 * The connection decides everything the request must not choose:
 *   · which company: `integrations.external_account_id`, the realm bound when
 *     the founder connected;
 *   · which venture: `config_json.project_id`. A sync for any other venture is
 *     refused before anything is fetched;
 *   · sandbox or production: `config_json.environment`.
 * The caller supplies only the statements and periods, and a token source;
 * refresh and rotation are part 2's connect machinery.
 *
 * A sync is safe to retry and safe to interrupt:
 *   · each statement is written on its own, atomically, as a revision;
 *   · a statement already written comes back `unchanged` on the retry;
 *   · `last_synced_at` moves only when every requested statement completed.
 * A failure records its code alone in `last_error`, never a body, a figure or
 * an identifier.
 */
import type { Env, User } from '../../types';
import { canAccessProject } from '../projectAccess';
import { REPORTS, StatementRefusal, type Basis, type Period, type Report } from './contract';
import { fromQuickBooks } from './quickbooks';
import { fetchReport, isRealmId, QuickBooksFailure, type QuickBooksEnvironment } from './quickbooksClient';
import { writeSnapshot } from './store';

type Scope = { user: Pick<User, 'id' | 'role' | 'founder_id'> & Partial<User>; projectId: number };
export type SyncRequest = { statements: { report: Report; period: Period }[]; basis: Basis };
export type SyncDeps = { fetch: typeof fetch; accessToken: (integrationId: number) => Promise<string> };

/** At most this many statements in one sync, e.g. two month-end balance sheets and a P&L. */
export const MAX_STATEMENTS = 6;

type Binding = { id: number; realm: string; environment: QuickBooksEnvironment };

/** The caller's own active QuickBooks connection, bound to this venture and to one realm. */
export async function quickBooksBinding(env: Env, s: Scope, integrationId: number): Promise<Binding> {
  const row = await env.DB.prepare("SELECT id, external_account_id, config_json FROM integrations WHERE id = ? AND user_id = ? AND provider_key = 'quickbooks' AND status = 'active'")
    .bind(integrationId, s.user.id).first<{ id: number; external_account_id: string | null; config_json: string | null }>();
  if (!row) throw new StatementRefusal('connection_not_found', 404);
  let config: any = null;
  try { config = row.config_json ? JSON.parse(row.config_json) : null; } catch { config = null; }
  if (!isRealmId(row.external_account_id)) throw new StatementRefusal('realm_not_bound', 409);
  if (!config || Number(config.project_id) !== s.projectId) throw new StatementRefusal('realm_not_bound_to_venture', 409);
  const environment = config.environment === 'production' ? 'production' : config.environment === 'sandbox' ? 'sandbox' : null;
  if (!environment) throw new StatementRefusal('environment_not_bound', 409);
  return { id: row.id, realm: row.external_account_id, environment };
}

function checkRequest(r: SyncRequest) {
  if (!r || !Array.isArray(r.statements) || !r.statements.length || r.statements.length > MAX_STATEMENTS) throw new StatementRefusal('statements_invalid');
  if (!['cash', 'accrual', 'unknown'].includes(r.basis)) throw new StatementRefusal('basis_invalid');
  for (const st of r.statements) if (!st || !(REPORTS as readonly string[]).includes(st.report)) throw new StatementRefusal('report_not_allowed');
}

async function recordOutcome(env: Env, id: number, failure: string | null) {
  if (failure) await env.DB.prepare('UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(failure, id).run();
  else await env.DB.prepare('UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
}

export async function syncQuickBooks(env: Env, s: Scope, integrationId: number, request: SyncRequest, deps: SyncDeps) {
  checkRequest(request);
  const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(s.projectId).first<{ id: number; founder_id: number | null }>();
  if (!p || !(await canAccessProject(env, s.user, p, { write: true }))) throw new StatementRefusal('project_not_found', 404);
  const b = await quickBooksBinding(env, s, integrationId);
  const written: { report: Report; uid: string; revision: number; state: 'created' | 'unchanged' }[] = [];
  for (const st of request.statements) {
    try {
      const token = await deps.accessToken(b.id);
      const body = await fetchReport({ fetch: deps.fetch, accessToken: token, environment: b.environment }, b.realm, st.report, st.period, request.basis);
      const input = fromQuickBooks(body, { realm_id: b.realm, requested: st.period });
      if (input.report !== st.report) throw new QuickBooksFailure('report_mismatch');
      const out = await writeSnapshot(env, s, b.id, input);
      written.push({ report: st.report, uid: out.uid, revision: out.revision, state: out.state });
    } catch (e) {
      const code = e instanceof QuickBooksFailure || e instanceof StatementRefusal ? e.code : 'sync_failed';
      await recordOutcome(env, b.id, code);
      return { state: 'incomplete' as const, written, failed: { report: st.report, code, retry_after_s: e instanceof QuickBooksFailure ? e.retry_after_s : null } };
    }
  }
  await recordOutcome(env, b.id, null);
  return { state: 'complete' as const, written };
}
