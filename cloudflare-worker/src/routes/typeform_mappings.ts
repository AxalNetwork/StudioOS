/** #5830: the bound connection owner's mapping HTTP wrapper; selection/import/retraction stay with D5828/D5829. */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { scope } from './typeform_validate';
import { WriterError } from '../services/validateWriters';
import { selectedTypeformSync } from '../services/typeform/selection';
import { setTypeformMappings, TypeformSessionBusy } from '../services/typeform/importer';
import { typeformImportDeps } from '../services/typeform/live';
import { formFields, typeformRead, TypeformReadError } from '../services/typeform/api';
import type { IntegrationRow } from '../integrations/registry';

const r = new Hono<{ Bindings: Env }>();
r.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
r.onError((e, c) => {
  if (e instanceof WriterError) return c.json({ error: 'typeform_mapping_refused', detail: e.sentence }, e.status as 400);
  if (e instanceof TypeformReadError || e instanceof TypeformSessionBusy) return c.json({ error: 'typeform_mapping_unreadable', detail: 'The selected form could not be checked. Nothing changed; reconnect or try again.' }, 503);
  throw e;
});
async function selected(c: Context<{ Bindings: Env }>, project: unknown) {
  if (c.env.TYPEFORM_APP_APPROVED !== '1') throw new WriterError(503, 'Typeform is not available yet');
  const currentScope = await scope(c, project);
  const key = await selectedTypeformSync(c.env, currentScope.projectId);
  if (!key || key.integrationId !== currentScope.integrationId) throw new WriterError(409, 'Choose a form before mapping its questions');
  return { scope: currentScope, key };
}
r.get('/', async c => {
  const { key } = await selected(c, c.req.query('project'));
  const items = await c.env.DB.prepare('SELECT id, field_id, field_type, kind, rule_json, keep_text, status FROM typeform_field_mappings WHERE sync_id = ? ORDER BY id').bind(key.syncId).all();
  // Read only: no selection, import or proposal is triggered by GET.
  return c.json({ form_id: key.formId, items: items.results || [] });
});
r.put('/', async c => {
  const b = await c.req.json().catch(() => null);
  if (!b || !Array.isArray(b.mappings)) throw new WriterError(400, 'Choose the mapped questions and qualifying answers');
  const { scope, key } = await selected(c, b.project);
  const connection = await c.env.DB.prepare("SELECT * FROM integrations WHERE id = ? AND user_id = ? AND status = 'active'").bind(key.integrationId, scope.userId).first<IntegrationRow>();
  if (!connection) throw new WriterError(403, 'Your Typeform connection is no longer available');
  const deps = typeformImportDeps(c.env, connection);
  const session = await deps.session(key.integrationId);
  const form = await typeformRead(deps.fetch, { token: session.accessToken, region: session.region as 'us' | 'eu', formId: key.formId }, 'forms.get');
  if (form?.id !== key.formId) throw new WriterError(409, 'Typeform answered for a different form. Nothing changed');
  // Recheck after the external read: cancellation or a venture/form switch must not write the old mapping.
  const current = await selected(c, b.project);
  if (current.key.syncId !== key.syncId || current.scope.integrationId !== key.integrationId) throw new WriterError(409, 'The selected form changed. Read it again');
  // The selection/company/grant can be withdrawn after the last read. Guard the importer's
  // existing all-or-nothing batch, including retractions, in that same transaction.
  const db = c.env.DB;
  const guard = db.prepare(`INSERT INTO decision_guard (decision_won)
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM typeform_form_bindings b
      JOIN typeform_form_syncs s ON s.integration_id = b.integration_id AND s.project_id = b.project_id AND s.form_id = b.form_id
      JOIN integrations i ON i.id = b.integration_id
      JOIN projects p ON p.id = b.project_id
      JOIN integration_companies ic ON ic.integration_id = i.id AND ic.company_id = p.company_id
      JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
      WHERE s.id = ? AND b.project_id = ? AND b.integration_id = ? AND b.form_id = ?
        AND b.access_state = 'ok' AND s.status = 'active' AND i.status = 'active' AND i.user_id = ?
        AND i.provider_key = 'typeform' AND ic.enabled = 1 AND p.deleted_at IS NULL
    ) THEN 1 ELSE 0 END`).bind(key.syncId, key.projectId, key.integrationId, key.formId, scope.userId);
  const guarded = new Proxy(db, { get(target, prop) {
    if (prop === 'batch') return (statements: D1PreparedStatement[]) => target.batch([guard, ...statements, db.prepare('DELETE FROM decision_guard')]);
    const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
  } });
  try {
    if (!await setTypeformMappings({ ...c.env, DB: guarded }, key.syncId, formFields(form), b.mappings, new Date().toISOString())) throw new WriterError(400, 'Choose only supported question types and valid qualifying answer rules');
  } catch (e) {
    if (/decision_won/.test(String(e))) throw new WriterError(409, 'The selected form or its access changed. Read it again');
    throw e;
  }
  const items = await c.env.DB.prepare('SELECT id, field_id, field_type, kind, rule_json, keep_text, status FROM typeform_field_mappings WHERE sync_id = ? ORDER BY id').bind(key.syncId).all();
  return c.json({ ok: true, form_id: key.formId, items: items.results || [] });
});
// Field titles remain under D5827's existing policy; expose neither respondent data nor a new title policy.
export const mount = { path: '/api/typeform/mappings', router: r };
export default r;
