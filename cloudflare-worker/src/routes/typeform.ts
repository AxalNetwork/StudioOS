/**
 * D5827 (#5827) — the Typeform form a venture reads.
 *
 *   GET    /api/typeform/forms?project=&page=     the venture's binding and, for a writer with
 *                                                 their own connection, one page of their forms
 *   GET    /api/typeform/forms/:id/fields?project= one form's field identities, for the picker
 *   PUT    /api/typeform/form                     { project, form_id | null } bind, change or unbind
 *   POST   /api/typeform/form/check               { project } re-verify the binding's access now
 *   GET    /api/typeform/sync?project=            the bound form's import status (D5828 part 2)
 *   POST   /api/typeform/sync                     { project, backfill? } run one import of the bound form now
 *
 * One form per venture, chosen explicitly, through one member's own `typeform`
 * connection switched on for the venture's company. A binding another member's
 * connection holds is never replaced. A form is bound only after a read of its
 * exact id succeeds with the member's grant; the binding keeps the fields' ids,
 * refs and types, never their titles. A revoked grant, a missing read scope and
 * a deleted form each answer with their own code, and none reads as an empty
 * account. The browser receives the capability, the status and the form's id
 * and fields: never a token. Logs name outcomes, never a form's contents.
 *
 * SYNC (D5828 part 2, `decisions/D5828-p2.md`). Dark until the owner sets
 * `TYPEFORM_APP_APPROVED=1` (D5827). Only the member whose own connection
 * holds the venture's binding, with write access to the venture and the
 * connection switched on for its company, may read the status or run an
 * import; a support session never. The run imports the binding's form only:
 * the sync row follows the binding (`services/typeform/selection.ts`), and
 * the grant and data center come from #5827's encrypted credentials
 * (`services/typeform/live.ts`). The answer carries the run's outcome, the
 * counts and the mapped fields that need remapping (their ids and titles, for
 * the connection owner only): never a token, a respondent or an answer.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { isSupportSession } from '../services/companyAccess';
import { projectEnabled } from '../integrations/companyScope';
import type { IntegrationRow } from '../integrations/registry';
import { TYPEFORM_KEY, typeformSession } from '../integrations/providers/typeform';
import {
  TypeformError, getTypeformForm, isFormId, listTypeformForms, type TypeformField,
} from '../integrations/typeformOAuth';
import { requestTypeformBackfill, syncTypeformForm, typeformFormStatus } from '../services/typeform/importer';
import { followTypeformBinding, selectedTypeformSync } from '../services/typeform/selection';
import { typeformImportDeps } from '../services/typeform/live';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

/** Each refusal's sentence, written here: never Typeform's text. */
export const TYPEFORM_REFUSALS: Record<string, string> = {
  project_required: 'Choose a venture first.',
  project_not_found: 'That venture was not found.',
  forbidden: 'You cannot see this venture.',
  read_only: 'You can read this venture but not change it.',
  support_session_refused: 'A support session cannot read or change a member’s Typeform.',
  not_connected: 'Typeform is not connected. Sign in with Typeform on the Typeform connector page first.',
  company_not_enabled: 'Your Typeform is not switched on for this venture’s company. Switch it on on the connector page.',
  venture_served: 'A teammate’s Typeform already serves this venture. They can unbind it.',
  form_malformed: 'That is not a Typeform form. Choose one from the list.',
  form_not_found: 'Your Typeform cannot see that form, or it was deleted. Choose one from the list.',
  form_mismatch: 'Typeform answered for a different form. Nothing was bound; try again.',
  scope_missing: 'Your Typeform sign-in does not allow reading forms. Sign in again and allow it.',
  not_bound: 'Choose a Typeform form for this venture first.',
  not_your_binding: 'Only the member whose Typeform serves this venture can do this.',
  sign_in_again: 'Typeform asked you to sign in again.',
  typeform_busy: 'Typeform is refreshing this connection. Try again in a moment.',
  rate_limited: 'Typeform asked us to wait. Try again in a minute.',
  typeform_unreadable: 'Typeform could not be read. Nothing changed; try again.',
  typeform_unavailable: 'Typeform is not available yet.',
  binding_lost: 'Axal lost access to this form. Check the form again before importing.',
  sync_request_invalid: 'Send backfill as true or false.',
};

class Refused extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

function refusalOf(e: TypeformError): Refused {
  switch (e.code) {
    case 'typeform_grant_revoked':
    case 'typeform_grant_changed':
    case 'typeform_connection_unreadable':
      return new Refused(409, 'sign_in_again');
    case 'typeform_not_connected': return new Refused(409, 'not_connected');
    case 'typeform_refresh_busy': return new Refused(503, 'typeform_busy');
    case 'typeform_scope_missing': return new Refused(409, 'scope_missing');
    case 'typeform_rate_limited': return new Refused(429, 'rate_limited');
    case 'form_not_found': return new Refused(409, 'form_not_found');
    case 'form_malformed': return new Refused(400, 'form_malformed');
    case 'form_mismatch': return new Refused(502, 'form_mismatch');
    default: return new Refused(502, 'typeform_unreadable');
  }
}

const handle = (fn: (c: C, user: User) => Promise<Response>) => async (c: C) => {
  try {
    const user = await requireAuth(c);
    if (await isSupportSession(c)) throw new Refused(403, 'support_session_refused');
    return await fn(c, user);
  } catch (e) {
    const refused = e instanceof Refused ? e : e instanceof TypeformError ? refusalOf(e) : null;
    if (!refused) throw e;
    if (e instanceof TypeformError) console.warn('[typeform] typeform refused', { outcome: e.code, status: e.status });
    return c.json({ error: refused.code, detail: TYPEFORM_REFUSALS[refused.code] }, refused.status as 400);
  }
};

async function body(c: C): Promise<Record<string, unknown>> {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {};
}

async function ventureOf(c: C, user: User, raw: unknown): Promise<{ id: number; writer: boolean }> {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Refused(400, 'project_required');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new Refused(404, 'project_not_found');
  if (!(await canAccessProject(c.env, user, p, { write: false }))) throw new Refused(403, 'forbidden');
  return { id: p.id, writer: await canAccessProject(c.env, user, p, { write: true }) };
}

function ownConnection(c: C, user: User): Promise<IntegrationRow | null> {
  return c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' AND auth_type = 'oauth2' LIMIT 1")
    .bind(user.id, TYPEFORM_KEY).first<IntegrationRow>();
}

interface Binding {
  integration_id: number; owner_name: string | null; form_id: string; fields_json: string;
  access_state: 'ok' | 'lost'; lost_reason: string | null; checked_at: string;
}

function bindingOf(env: Env, projectId: number): Promise<Binding | null> {
  return env.DB.prepare(
    `SELECT b.integration_id, COALESCE(u.display_name, u.name) AS owner_name, b.form_id, b.fields_json,
            b.access_state, b.lost_reason, b.checked_at
       FROM typeform_form_bindings b JOIN integrations i ON i.id = b.integration_id LEFT JOIN users u ON u.id = i.user_id
      WHERE b.project_id = ?`,
  ).bind(projectId).first<Binding>();
}

const fieldsOf = (json: string): TypeformField[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};
const publicBinding = (b: Binding, own: boolean) => ({
  form_id: b.form_id, fields: fieldsOf(b.fields_json), access_state: b.access_state,
  lost_reason: b.lost_reason, checked_at: b.checked_at, own,
});

async function logBinding(env: Env, userId: number, action: string, projectId: number) {
  try {
    await env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, actor, action, details) VALUES (?, ?, ?, ?, ?)')
      .bind(projectId, userId, String(userId), action, JSON.stringify({ provider_key: TYPEFORM_KEY })).run();
  } catch { console.warn('[typeform] activity log failed'); }
}

r.get('/forms', handle(async (c, user) => {
  const venture = await ventureOf(c, user, c.req.query('project'));
  const binding = await bindingOf(c.env, venture.id);
  const row = await ownConnection(c, user);
  const enabled = !!row && await projectEnabled(c.env, Number(row.id), venture.id);
  const own = !!binding && !!row && binding.integration_id === Number(row.id);
  let forms: Awaited<ReturnType<typeof listTypeformForms>> | null = null;
  let formsError: string | null = null;
  if (venture.writer && row && enabled) {
    try {
      const s = await typeformSession(c.env, row);
      forms = await listTypeformForms(s.region, s.accessToken, Number(c.req.query('page') ?? 1));
    } catch (e) {
      if (!(e instanceof TypeformError)) throw e;
      formsError = refusalOf(e).code;
      console.warn('[typeform] forms unreadable', { outcome: e.code });
    }
  }
  return c.json({
    ok: true, project_id: venture.id,
    capability: { connected: !!row, company_enabled: enabled, can_bind: venture.writer && enabled && (!binding || own) },
    binding: binding ? publicBinding(binding, own) : null,
    served_by: binding && !own ? { name: binding.owner_name } : null,
    forms,
    forms_error: formsError ? { code: formsError, detail: TYPEFORM_REFUSALS[formsError] } : null,
  });
}));

async function writerConnection(c: C, user: User, raw: unknown) {
  const venture = await ventureOf(c, user, raw);
  if (!venture.writer) throw new Refused(403, 'read_only');
  const row = await ownConnection(c, user);
  if (!row) throw new Refused(409, 'not_connected');
  if (!(await projectEnabled(c.env, Number(row.id), venture.id))) throw new Refused(409, 'company_not_enabled');
  return { venture, row, mine: Number(row.id) };
}

r.get('/forms/:id/fields', handle(async (c, user) => {
  const { row } = await writerConnection(c, user, c.req.query('project'));
  const id = c.req.param('id');
  if (!isFormId(id)) throw new Refused(400, 'form_malformed');
  const s = await typeformSession(c.env, row);
  const form = await getTypeformForm(s.region, s.accessToken, id);
  return c.json({ ok: true, form_id: form.id, title: form.title, fields: form.fields });
}));

r.put('/form', handle(async (c, user) => {
  const b = await body(c);
  const { venture, row, mine } = await writerConnection(c, user, b.project);
  const existing = await bindingOf(c.env, venture.id);
  if (existing && existing.integration_id !== mine) throw new Refused(409, 'venture_served');
  if (b.form_id === null) {
    const del = await c.env.DB.prepare('DELETE FROM typeform_form_bindings WHERE project_id = ? AND integration_id = ?').bind(venture.id, mine).run();
    if (Number(del.meta?.changes ?? 0) > 0) await logBinding(c.env, Number(user.id), 'typeform_form_unbound', venture.id);
    await followBinding(c.env, venture.id);
    return c.json({ ok: true, binding: null });
  }
  if (!isFormId(b.form_id)) throw new Refused(400, 'form_malformed');
  // Verified at selection: the member's grant reads this exact form now.
  const s = await typeformSession(c.env, row);
  const form = await getTypeformForm(s.region, s.accessToken, b.form_id);
  const write = await c.env.DB.prepare(
    `INSERT INTO typeform_form_bindings (uid, integration_id, project_id, form_id, fields_json, bound_by)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       form_id = excluded.form_id, fields_json = excluded.fields_json, access_state = 'ok', lost_reason = NULL,
       checked_at = datetime('now'), bound_by = excluded.bound_by, bound_at = datetime('now'), updated_at = datetime('now')
     WHERE typeform_form_bindings.integration_id = excluded.integration_id`,
  ).bind(crypto.randomUUID(), mine, venture.id, form.id, JSON.stringify(form.fields), user.id).run();
  if (Number(write.meta?.changes ?? 0) === 0) throw new Refused(409, 'venture_served');
  await logBinding(c.env, Number(user.id), existing ? 'typeform_form_changed' : 'typeform_form_bound', venture.id);
  await followBinding(c.env, venture.id);
  const bound = await bindingOf(c.env, venture.id);
  return c.json({ ok: true, binding: bound ? publicBinding(bound, true) : null });
}));

type LostReason = 'grant_revoked' | 'scope_missing' | 'form_deleted';

/** Which lost-access reason a Typeform answer is, or null when it is something else. */
const lostReason = (e: TypeformError): LostReason | null =>
  e.code === 'typeform_grant_revoked' ? 'grant_revoked'
    : e.code === 'typeform_scope_missing' ? 'scope_missing'
      : e.code === 'form_not_found' ? 'form_deleted' : null;

r.post('/form/check', handle(async (c, user) => {
  const b = await body(c);
  const { venture, row, mine } = await writerConnection(c, user, b.project);
  const binding = await bindingOf(c.env, venture.id);
  if (!binding) throw new Refused(409, 'not_bound');
  if (binding.integration_id !== mine) throw new Refused(403, 'not_your_binding');
  let reason: LostReason | null = null;
  let fields: TypeformField[] | null = null;
  try {
    const s = await typeformSession(c.env, row);
    fields = (await getTypeformForm(s.region, s.accessToken, binding.form_id)).fields;
  } catch (e) {
    reason = e instanceof TypeformError ? lostReason(e) : null;
    if (!reason) throw e;
  }
  if (fields) {
    await c.env.DB.prepare("UPDATE typeform_form_bindings SET fields_json = ?, access_state = 'ok', lost_reason = NULL, checked_at = datetime('now'), updated_at = datetime('now') WHERE project_id = ? AND integration_id = ?")
      .bind(JSON.stringify(fields), venture.id, mine).run();
  } else {
    // The binding stays, marked with why: the founder decides what comes next.
    await c.env.DB.prepare("UPDATE typeform_form_bindings SET access_state = 'lost', lost_reason = ?, checked_at = datetime('now'), updated_at = datetime('now') WHERE project_id = ? AND integration_id = ?")
      .bind(reason, venture.id, mine).run();
    if (binding.access_state !== 'lost') await logBinding(c.env, Number(user.id), `typeform_form_lost_${reason}`, venture.id);
  }
  const now = await bindingOf(c.env, venture.id);
  return c.json({ ok: true, binding: now ? publicBinding(now, true) : null });
}));

// ---------------------------------------------------------------------------
// D5828 part 2 — the import trigger and its status
// ---------------------------------------------------------------------------

/**
 * The import's sync rows follow the binding just written. The binding is
 * already committed; a failure here is caught up by the next import, which
 * follows the binding again, and the importer never runs an unselected form.
 */
async function followBinding(env: Env, projectId: number) {
  try { await followTypeformBinding(env, projectId); } catch (e) {
    console.warn('[typeform] sync follow failed', { outcome: (e as Error)?.name ?? 'error' });
  }
}

/** The sync gate: the flag, then the binding owner's own checks (`writerConnection`), then the binding is theirs. */
async function syncOwner(c: C, user: User, raw: unknown) {
  if (c.env.TYPEFORM_APP_APPROVED !== '1') throw new Refused(503, 'typeform_unavailable');
  const { venture, row, mine } = await writerConnection(c, user, raw);
  const binding = await bindingOf(c.env, venture.id);
  if (!binding) throw new Refused(409, 'not_bound');
  if (binding.integration_id !== mine) throw new Refused(403, 'not_your_binding');
  return { venture, row, mine, binding };
}

const bindingState = (b: Binding) => ({ form_id: b.form_id, access_state: b.access_state, lost_reason: b.lost_reason, checked_at: b.checked_at });

r.get('/sync', handle(async (c, user) => {
  const { venture, mine, binding } = await syncOwner(c, user, c.req.query('project'));
  // Read only: a binding no import has followed yet has no status, never a zero.
  const selected = await selectedTypeformSync(c.env, venture.id);
  const status = selected ? await typeformFormStatus(c.env, { integrationId: mine, projectId: venture.id }, selected.formId) : null;
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, project_id: venture.id, binding: bindingState(binding), status });
}));

r.post('/sync', handle(async (c, user) => {
  const b = await body(c);
  if (b.backfill !== undefined && typeof b.backfill !== 'boolean') throw new Refused(400, 'sync_request_invalid');
  const { venture, row, mine, binding } = await syncOwner(c, user, b.project);
  if (binding.access_state !== 'ok') throw new Refused(409, 'binding_lost');
  const selected = await followTypeformBinding(c.env, venture.id);
  if (!selected || selected.integrationId !== mine) throw new Refused(409, 'not_bound');
  const scope = { integrationId: mine, projectId: venture.id };
  if (b.backfill === true && await requestTypeformBackfill(c.env, scope, selected.formId, new Date().toISOString())) {
    await logBinding(c.env, Number(user.id), 'typeform_backfill_requested', venture.id);
  }
  const result = await syncTypeformForm(c.env, typeformImportDeps(c.env, row), { ...scope, formId: selected.formId });
  if (result.outcome !== 'ok' && result.outcome !== 'partly') console.warn('[typeform] import stopped', { outcome: result.outcome });
  const status = await typeformFormStatus(c.env, scope, selected.formId);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, project_id: venture.id, outcome: result.outcome, result, status });
}));

export const mount: RouteMount = { path: '/api/typeform', router: r };
export default r;
