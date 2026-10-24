/** D690 — one gated record, activity, action and form-options route for cycles. */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canReadBoard, canWrite, canWritePitchDeck, type ProjectRef } from './_founder_validate_helpers';
import { activityFor } from '../services/cycleActivity';
import { hasRecords, RECORD_SPECS, specFor } from '../services/records';
import { ownedRow, RECORD_ID } from '../services/records/owned';
import type { Gate, ModuleSpec, Next, RecordAction, RecordContext, RecordRegistry, RecordSection } from '../services/records/types';

const CYCLES = new Set(['validate', 'build', 'raise', 'grow']);
// The canvas's pattern exactly: unanchored and case-sensitive (CO:265).
const STATUS_NEXT = /Open|Pending|Missing|Due|Failed|Next|Planned|To confirm|Needs/;

async function allowed(gate: Gate, project: ProjectRef, user: User, env: Env): Promise<boolean> {
  if (typeof gate === 'function') return gate(project, user, env);
  return gate === 'write' ? canWrite(project, user) : canReadBoard(project, user);
}

function declaration(action: RecordAction) {
  const { execute: _execute, references: _references, ...publicAction } = action;
  return { ...publicAction, tone: action.tone ?? 'default',
    multipart: action.multipart || action.form?.fields.some((field) => field.input === 'file') || false };
}

/**
 * The canvas's rule (CO:263-269): the first main-section row whose status
 * matches, else the first section action, else the primary action, else none.
 */
export function nextFor(main: RecordSection[], actions: Array<Pick<RecordAction, 'key' | 'label' | 'tone'>>): Next | null {
  for (const section of main) {
    for (const row of section.rows) {
      if (STATUS_NEXT.test(String(row.c ?? ''))) {
        const key = typeof row.action === 'string' ? row.action : row.action?.key ?? null;
        return { text: row.a + (row.b ? ' · ' + row.b : ''), action: key };
      }
    }
  }
  for (const section of main) {
    const key = typeof section.action === 'string' ? section.action : section.action?.key;
    const declared = key ? actions.find((a) => a.key === key) : undefined;
    if (declared) return { text: declared.label, action: declared.key };
  }
  const primary = actions.find((a) => a.tone === 'primary') ?? actions.at(-1);
  return primary ? { text: primary.label, action: primary.key } : null;
}

function scoped(c: any, registry: RecordRegistry, withId: boolean): Promise<
  | { ctx: RecordContext; spec: ModuleSpec; cycle: string; slug: string; id: string }
  | Response
> {
  return (async () => {
    let user: User;
    try { user = (await requireAuth(c)) as User; }
    catch { return c.json({ detail: 'Unauthorized' }, 401); }
    const rawProject = String(c.req.query('project') ?? '');
    if (!/^[1-9][0-9]{0,9}$/.test(rawProject)) return c.json({ detail: 'project is required' }, 400);
    const projectId = Number(rawProject);
    const cycle = String(c.req.param('cycle') ?? '');
    if (!CYCLES.has(cycle)) return c.json({ detail: 'No such cycle' }, 404);
    if (!hasRecords(cycle, registry)) return c.json({ detail: `Records for ${cycle} are not built yet.` }, 404);
    const slug = String(c.req.param('slug') ?? '');
    const spec = specFor(cycle, slug, registry);
    if (!spec) return c.json({ detail: 'No such module' }, 404);
    const id = withId ? String(c.req.param('id') ?? '') : '';
    // A malformed id never reaches a database query, even for an existing venture.
    if (withId && !RECORD_ID.test(id)) return c.json({ detail: 'Record not found.' }, 404);
    const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
      .bind(projectId).first() as ProjectRef | null;
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const reading = c.req.method === 'GET' && !c.req.path.endsWith('/form-options');
    const ctx: RecordContext = { env: c.env, projectId, project, user };
    if (reading) {
      if (!await allowed(spec.read, project, user, c.env)) return c.json({ detail: 'Forbidden' }, 403);
    } else {
      const refusal = await writerAllowed(c, ctx, spec);
      if (refusal) return refusal;
    }
    if (withId && !await ownedRow(c.env, spec.store, id, projectId)) return c.json({ detail: 'Record not found.' }, 404);
    return { ctx: { env: c.env, projectId, project, user }, spec, cycle, slug, id };
  })();
}

async function writerAllowed(c: any, ctx: RecordContext, spec: ModuleSpec): Promise<Response | null> {
  if (c.req.param('cycle') === 'raise' && c.req.param('slug') === 'pitch-deck' && !canWritePitchDeck(ctx.project, ctx.user)) return c.json({ detail: 'Forbidden' }, 403);
  return await allowed(spec.write, ctx.project, ctx.user, ctx.env) ? null : c.json({ detail: 'Forbidden' }, 403);
}

async function perform(c: any, registry: RecordRegistry, key: string) {
  const s = await scoped(c, registry, true);
  if (s instanceof Response) return s;
  const refusal = await writerAllowed(c, s.ctx, s.spec);
  if (refusal) return refusal;
  const record = await s.spec.record(s.ctx, s.id);
  const actions = await s.spec.actions(s.ctx, s.id, record);
  const action = actions.find((entry) => entry.key === key);
  if (!action) return c.json({ detail: 'No such action on this record.' }, 404);
  let body: Record<string, unknown> | FormData;
  if ((action.multipart || action.form?.fields.some((field) => field.input === 'file'))
    && c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    body = await c.req.formData();
  } else {
    const parsed = await c.req.json().catch(() => ({}));
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }
  for (const ref of action.references?.(body) ?? []) {
    if (!await ownedRow(c.env, ref.store, ref.id, s.ctx.projectId)) return c.json({ detail: 'Record not found.' }, 404);
  }
  if (!action.execute) {
    if (action.kind === 'link' && action.href) return c.json({ ok: true, open: { url: action.href } });
    return c.json({ detail: 'No such action on this record.' }, 404);
  }
  return c.json(await action.execute(s.ctx, s.id, body));
}

/** A registry argument makes the route testable before any real cycle registers. */
export function createCycleRecords(registry: RecordRegistry = RECORD_SPECS) {
  const route = new Hono<{ Bindings: Env }>();

  route.get('/:cycle/modules/:slug/records/:id/activity', async (c) => {
    const s = await scoped(c, registry, true);
    if (s instanceof Response) return s;
    const page = Number(c.req.query('page') ?? 1);
    return c.json(await activityFor(c.env, {
      projectId: s.ctx.projectId, entityType: s.spec.activityType ?? `${s.cycle}.${s.slug}`,
      entityId: s.id, page, oldRows: s.spec.oldRows, store: s.spec.store,
    }));
  });

  route.get('/:cycle/modules/:slug/records/:id', async (c) => {
    const s = await scoped(c, registry, true);
    if (s instanceof Response) return s;
    const record = await s.spec.record(s.ctx, s.id);
    const canWrite = await writerAllowed(c, s.ctx, s.spec) === null;
    const sections: RecordSection[] = [];
    for (const section of s.spec.sections) {
      if (section.gate && !await allowed(section.gate, s.ctx.project, s.ctx.user, s.ctx.env)) continue;
      if (section.when && !section.when(s.id, record)) continue;
      const data = await section.read(s.ctx, s.id, record);
      const rows = canWrite ? data.rows : data.rows.map(({ action: _action, ...row }) => row);
      sections.push({ key: section.key, title: section.title,
        gate: section.publicGate ?? (section.gate === 'write' ? 'write' : 'read'), side: section.side, rows,
        empty: data.empty, action: canWrite ? data.action : undefined });
    }
    const actions = canWrite ? (await s.spec.actions(s.ctx, s.id, record)).map(declaration) : [];
    const activity = await activityFor(c.env, {
      projectId: s.ctx.projectId, entityType: s.spec.activityType ?? `${s.cycle}.${s.slug}`,
      entityId: s.id, store: s.spec.store, oldRows: s.spec.oldRows,
    });
    const { createdBy: _createdBy, createdAt: _createdAt, ...publicRecord } = record;
    const main = sections.filter((section) => !section.side);
    return c.json({ cycle: s.cycle, module: s.slug, id: s.id, ...publicRecord,
      main, side: sections.filter((section) => section.side), actions, next: nextFor(main, actions),
      activity: activity.items, activity_total: activity.total });
  });

  route.post('/:cycle/modules/:slug/records/:id/actions/:key', (c) => perform(c, registry, String(c.req.param('key'))));
  route.patch('/:cycle/modules/:slug/records/:id', (c) => perform(c, registry, 'edit'));
  route.delete('/:cycle/modules/:slug/records/:id', (c) => perform(c, registry, 'delete'));

  route.get('/:cycle/modules/:slug/form-options', async (c) => {
    const s = await scoped(c, registry, false);
    if (s instanceof Response) return s;
    const refusal = await writerAllowed(c, s.ctx, s.spec);
    if (refusal) return refusal;
    if (!s.spec.formOptions) return c.json({});
    const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    delete query.project;
    return c.json(await s.spec.formOptions(s.ctx, query));
  });
  return route;
}

const cycleRecords = createCycleRecords();
export default cycleRecords;
