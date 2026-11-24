/**
 * D6693 (#6693, plan key C3 of #6680) and D6699 (#6699, plan key H3): HQ's
 * formation catalogue, mounted at /api/admin/formation/catalogue — pausing a
 * form, and editing the catalogue in a draft.
 *
 * PAUSE (D6693), Super Admin past the write bar:
 *   POST /forms/:key/pause    { reason }   the form stops being orderable
 *   POST /forms/:key/resume   { reason }   it is orderable again if every other gate passes
 *
 * EDITING (D6699), HQ authoring (`requireHqAuthoring`):
 *   GET  /versions                              every version, newest first
 *   GET  /versions/:version                     its content, each row's revision, and its SHA-256s
 *   GET  /versions/:version/diff[?against=N]    what changed against the current published version (or N)
 *   GET  /versions/:version/attention           its stale and disputed facts
 *   POST /drafts                    { reason }  a draft copied from the current version
 *   PUT  /drafts/:version/:entity   { key, fields, revision, reason }   create (revision null) or edit one row
 *   DELETE /drafts/:version/:entity { key, revision, reason }           remove one row
 *   GET  /sources, POST /sources, POST /sources/:id/checks              sources and who checked them, when
 *
 * RESTRICTED PLACES (D6699), not versioned: read by HQ authoring, changed by
 * the Super Admin past the write bar, each change with a reason, a source and
 * the day it was checked. A change shows on the next read.
 *   GET /restricted, POST /restricted, PATCH /restricted/:id, DELETE /restricted/:id
 *
 * Only a `draft` is edited; a published version never changes (S1, and the
 * D6689 triggers refuse it underneath). Every write names a reason and is
 * recorded in admin_audit_log in the same batch as the change. A person makes
 * every edit: no model writes catalogue content. Publishing and counsel's
 * sign-off are #6700.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { isSuperAdmin, requireHqAdmin, requireHqAuthoring, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { adminAuditStatement, logAdminAction } from '../services/adminAudit';
import { ensureAdminAuditLogTable } from './admin';
import { currentVersion, versionByNumber, type CatalogueVersion } from '../services/formationCatalogue';
import { factMaxAgeDays, freshSince } from '../services/formationGates';
import {
  ENTITIES, PLACE_RE, RESTRICTED_KINDS, canonicalRow, colValues, contentSha256, diffContent, formTemplatesSha256, isPastDay,
  keyString, newRowDefaults, parseFields, parseKey, readRawVersion, restrictedPlaces, rowRevision, rulesSha256, canonicalContent,
  sourcedRefusal, specOf, templateBodyFrom, todayIso, versionContent, type Refusal, type RawRow,
} from '../services/formationCatalogueEdit';

type Ctx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

export const REASON_MAX = 500;
const FORM_KEY = /^[a-z0-9_]{1,64}$/;
const SOURCE_KINDS = ['statute', 'registry', 'regulator', 'tax_authority', 'counsel', 'provider', 'other'];
const CHECK_OUTCOMES = ['unchanged', 'changed', 'unreachable'];

async function superAdminWrite(c: Ctx, admin: User, what = 'pauses or resumes a form'): Promise<Response | null> {
  if (!isSuperAdmin(admin)) return refuse(c, 403, { code: 'super_admin_required', message: `Only the Super Admin ${what}.` });
  await requireSuperAdminWriteBar(c);
  return null;
}

const bodyOf = async (c: Ctx) => (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
const fail = (c: Ctx, x: Refusal) => refuse(c, x.status, { code: x.code, message: x.message });

/** The trimmed reason, or a refusal: every write says why. */
function reasonOf(c: Ctx, body: Record<string, unknown> | null): string | Response {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return refuse(c, 400, { code: 'reason_required', message: 'Say why. Nothing was changed.' });
  if (reason.length > REASON_MAX) return refuse(c, 400, { code: 'reason_too_long', message: `The reason is at most ${REASON_MAX} characters. Nothing was changed.` });
  return reason;
}

/** A store error as a refusal: the raw text is logged, never sent. */
function storeRefusal(c: Ctx, e: unknown): Response {
  const text = String((e as Error)?.message ?? e);
  if (/immutable/i.test(text)) return refuse(c, 409, { code: 'version_not_draft', message: 'That version is no longer a draft, so it cannot be edited. Nothing was saved.', raw: e });
  if (/UNIQUE constraint failed/i.test(text)) return refuse(c, 409, { code: 'revision_conflict', message: 'Someone saved a row with that key meanwhile. Read it again; nothing was saved.', raw: e });
  if (/(CHECK|NOT NULL|FOREIGN KEY) constraint failed/i.test(text)) return refuse(c, 400, { code: 'invalid_row', message: 'The row breaks a rule of the catalogue (a missing value, a source or a date). Nothing was saved.', raw: e });
  return refuse(c, 503, { code: 'store_unavailable', message: 'The catalogue could not be saved with its audit record, so nothing was changed.', raw: e });
}

async function setPaused(c: Ctx, paused: boolean) {
  const admin = await requireHqAdmin(c);
  const denied = await superAdminWrite(c, admin);
  if (denied) return denied;
  const key = String(c.req.param('key') ?? '');
  if (!FORM_KEY.test(key)) return refuse(c, 400, { code: 'invalid_form_key', message: 'A form key is lower-case letters, digits and underscores.' });
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return refuse(c, 400, { code: 'reason_required', message: `Say why the form is ${paused ? 'paused' : 'resumed'}. Nothing was changed.` });
  if (reason.length > REASON_MAX) return refuse(c, 400, { code: 'reason_too_long', message: `The reason is at most ${REASON_MAX} characters. Nothing was changed.` });
  const known = await c.env.DB.prepare('SELECT 1 FROM formation_entity_forms WHERE form_key = ? LIMIT 1').bind(key).first();
  if (!known) return refuse(c, 404, { code: 'form_not_found', message: 'No catalogue version has a form with that key.' });
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await c.env.DB.prepare(
    `INSERT INTO formation_form_switches (form_key, paused, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(form_key) DO UPDATE SET paused = excluded.paused, reason = excluded.reason, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
  ).bind(key, paused ? 1 : 0, reason, Number(admin.id), now).run();
  await logAdminAction(c.env, Number(admin.id), admin.email || '', paused ? 'formation_form_paused' : 'formation_form_resumed', { form_key: key, reason });
  return c.json({ ok: true, form_key: key, paused, reason, changed_at: now });
}

r.post('/forms/:key/pause', (c) => setPaused(c, true));
r.post('/forms/:key/resume', (c) => setPaused(c, false));

// ── versions ──

async function versionParam(c: Ctx): Promise<CatalogueVersion | Response> {
  const n = Number(c.req.param('version'));
  if (!Number.isSafeInteger(n) || n < 1) return refuse(c, 400, { code: 'invalid_version', message: 'A version is a whole number from 1.' });
  const v = await versionByNumber(c.env, n);
  if (!v) return refuse(c, 404, { code: 'version_not_found', message: 'There is no catalogue version with that number.' });
  return v;
}

/** The version, if it is a draft; otherwise a refusal. A published version is never edited. */
async function draftParam(c: Ctx): Promise<CatalogueVersion | Response> {
  const v = await versionParam(c);
  if (v instanceof Response) return v;
  if (v.status !== 'draft') {
    return refuse(c, 409, {
      code: 'version_not_draft',
      message: `Version ${v.version} is ${v.status.replace('_', ' ')}, and only a draft is edited. Create a draft from the current version to change it.`,
    });
  }
  return v;
}

r.get('/versions', async (c) => {
  await requireHqAuthoring(c);
  const rows = (await c.env.DB.prepare(
    `SELECT version, status, is_current, notes, created_by, created_at, published_by, published_at, retired_at
       FROM formation_catalogue_versions ORDER BY version DESC`,
  ).all<any>()).results || [];
  return c.json({
    versions: rows.map((v: any) => ({
      version: Number(v.version), status: String(v.status), is_current: Number(v.is_current) === 1, notes: v.notes ?? null,
      created_by: v.created_by == null ? null : Number(v.created_by), created_at: v.created_at ?? null,
      published_by: v.published_by == null ? null : Number(v.published_by), published_at: v.published_at ?? null, retired_at: v.retired_at ?? null,
    })),
  });
});

r.get('/versions/:version', async (c) => {
  await requireHqAuthoring(c);
  const v = await versionParam(c);
  if (v instanceof Response) return v;
  const raw = await readRawVersion(c.env, v.id);
  const content = canonicalContent(raw);
  const rows: Record<string, unknown[]> = {};
  for (const e of ENTITIES) {
    const spec = specOf(e)!;
    const list = await Promise.all(raw[e].map(async (x) => ({ ...canonicalRow(spec, x), revision: await rowRevision(spec, x) })));
    rows[e] = list.sort((a, b) => (keyString(spec, a) < keyString(spec, b) ? -1 : 1));
  }
  return c.json({
    version: v,
    content: rows,
    content_sha256: await contentSha256(content),
    rules_sha256: await rulesSha256(content),
    form_templates: (await formTemplatesSha256(content, templateBodyFrom(c.env))).map((f) => ({ form_key: f.form_key, templates_sha256: f.templates_sha256, templates: f.templates })),
  });
});

r.get('/versions/:version/diff', async (c) => {
  await requireHqAuthoring(c);
  const v = await versionParam(c);
  if (v instanceof Response) return v;
  const against = c.req.query('against');
  let base: CatalogueVersion | null;
  if (against != null && against !== '') {
    const n = Number(against);
    base = Number.isSafeInteger(n) && n >= 1 ? await versionByNumber(c.env, n) : null;
    if (!base) return refuse(c, 404, { code: 'version_not_found', message: 'There is no catalogue version to compare against with that number.' });
  } else {
    base = await currentVersion(c.env);
  }
  const empty = Object.fromEntries(ENTITIES.map((e) => [e, []])) as any;
  const [from, to] = await Promise.all([base ? versionContent(c.env, base.id) : empty, versionContent(c.env, v.id)]);
  const changes = diffContent(from, to);
  const count = (kind: string) => changes.filter((x) => x.change === kind).length;
  return c.json({
    from: base ? { version: base.version, status: base.status } : null,
    to: { version: v.version, status: v.status },
    totals: { added: count('added'), removed: count('removed'), changed: count('changed') },
    changes,
  });
});

r.get('/versions/:version/attention', async (c) => {
  await requireHqAuthoring(c);
  const v = await versionParam(c);
  if (v instanceof Response) return v;
  const maxAge = factMaxAgeDays(c.env);
  const since = freshSince(todayIso(), maxAge);
  const rows = (await c.env.DB.prepare(
    `SELECT f.form_key, x.fact_key, x.value, x.status, x.blocking, x.source_id, x.checked_on, x.checked_by
       FROM formation_form_facts x JOIN formation_entity_forms f ON f.id = x.form_id
      WHERE x.version_id = ?
        AND (x.status = 'disputed'
             OR (x.status IN ('recorded', 'provisional') AND (x.checked_on IS NULL OR date(x.checked_on) < date(?))))
      ORDER BY f.form_key, x.fact_key`,
  ).bind(v.id, since).all<any>()).results || [];
  const fact = (x: any) => ({
    form_key: String(x.form_key), fact_key: String(x.fact_key), value: x.value ?? null, status: String(x.status), blocking: Number(x.blocking) === 1,
    source_id: x.source_id == null ? null : Number(x.source_id), checked_on: x.checked_on ?? null, checked_by: x.checked_by == null ? null : Number(x.checked_by),
  });
  return c.json({
    version: v.version, max_age_days: maxAge, fresh_since: since,
    stale: rows.filter((x: any) => x.status !== 'disputed').map(fact),
    disputed: rows.filter((x: any) => x.status === 'disputed').map(fact),
  });
});

// ── drafts ──

r.post('/drafts', async (c) => {
  const admin = await requireHqAuthoring(c);
  const body = await bodyOf(c);
  const reason = reasonOf(c, body);
  if (reason instanceof Response) return reason;
  const open = await c.env.DB.prepare(`SELECT version, status FROM formation_catalogue_versions WHERE status IN ('draft', 'in_review') ORDER BY version LIMIT 1`).first<{ version: number; status: string }>();
  if (open) return refuse(c, 409, { code: 'draft_open', message: `Version ${open.version} is already open (${String(open.status).replace('_', ' ')}). Edit it, or finish it, before starting another.`, extra: { version: Number(open.version) } });
  const from = await currentVersion(c.env);
  if (!from) return refuse(c, 409, { code: 'no_current_version', message: 'No catalogue version is published and current, so there is nothing to copy.' });
  const top = await c.env.DB.prepare('SELECT MAX(version) AS v FROM formation_catalogue_versions').first<{ v: number }>();
  const next = Number(top?.v ?? 0) + 1;
  const db = c.env.DB;
  try {
    await ensureAdminAuditLogTable(c.env);
    await db.batch([
      db.prepare(`INSERT INTO formation_catalogue_versions (version, status, notes, created_by) VALUES (?, 'draft', ?, ?)`)
        .bind(next, `Draft from version ${from.version}: ${reason}`, Number(admin.id)),
      db.prepare(
        `INSERT INTO formation_jurisdictions (version_id, country, subdivision, registry_name, vocabulary_json)
         SELECT (SELECT id FROM formation_catalogue_versions WHERE version = ?), country, subdivision, registry_name, vocabulary_json
           FROM formation_jurisdictions WHERE version_id = ? ORDER BY id`,
      ).bind(next, from.id),
      db.prepare(
        `INSERT INTO formation_entity_forms (version_id, jurisdiction_id, form_key, label, offer_mode, legal_form_family, legacy_gate, legacy_display_json, allow_axal_collection)
         SELECT nj.version_id, nj.id, f.form_key, f.label, f.offer_mode, f.legal_form_family, f.legacy_gate, f.legacy_display_json, f.allow_axal_collection
           FROM formation_entity_forms f
           JOIN formation_jurisdictions oj ON oj.id = f.jurisdiction_id
           JOIN formation_jurisdictions nj ON nj.version_id = (SELECT id FROM formation_catalogue_versions WHERE version = ?)
                AND nj.country = oj.country AND COALESCE(nj.subdivision, '') = COALESCE(oj.subdivision, '')
          WHERE f.version_id = ? ORDER BY f.id`,
      ).bind(next, from.id),
      db.prepare(
        `INSERT INTO formation_form_facts (version_id, form_id, fact_key, value, status, blocking, source_id, checked_on, checked_by)
         SELECT nf.version_id, nf.id, x.fact_key, x.value, x.status, x.blocking, x.source_id, x.checked_on, x.checked_by
           FROM formation_form_facts x JOIN formation_entity_forms ofm ON ofm.id = x.form_id
           JOIN formation_entity_forms nf ON nf.version_id = (SELECT id FROM formation_catalogue_versions WHERE version = ?) AND nf.form_key = ofm.form_key
          WHERE x.version_id = ? ORDER BY x.id`,
      ).bind(next, from.id),
      db.prepare(
        `INSERT INTO formation_fee_lines (version_id, form_id, line_key, label, payee, collected_by, currency, amount_cents, timing, source_id, checked_on, checked_by)
         SELECT nf.version_id, nf.id, x.line_key, x.label, x.payee, x.collected_by, x.currency, x.amount_cents, x.timing, x.source_id, x.checked_on, x.checked_by
           FROM formation_fee_lines x JOIN formation_entity_forms ofm ON ofm.id = x.form_id
           JOIN formation_entity_forms nf ON nf.version_id = (SELECT id FROM formation_catalogue_versions WHERE version = ?) AND nf.form_key = ofm.form_key
          WHERE x.version_id = ? ORDER BY x.id`,
      ).bind(next, from.id),
      db.prepare(
        `INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, template_key, counsel_required, position)
         SELECT nf.version_id, nf.id, x.item_key, x.phase, x.kind, x.acting_party, x.title, x.template_key, x.counsel_required, x.position
           FROM formation_pack_items x JOIN formation_entity_forms ofm ON ofm.id = x.form_id
           JOIN formation_entity_forms nf ON nf.version_id = (SELECT id FROM formation_catalogue_versions WHERE version = ?) AND nf.form_key = ofm.form_key
          WHERE x.version_id = ? ORDER BY x.id`,
      ).bind(next, from.id),
      db.prepare(
        `INSERT INTO formation_fact_schema (version_id, form_id, question_key, label, answer_kind, options_json, required, position)
         SELECT (SELECT id FROM formation_catalogue_versions WHERE version = ?), nf.id, x.question_key, x.label, x.answer_kind, x.options_json, x.required, x.position
           FROM formation_fact_schema x LEFT JOIN formation_entity_forms ofm ON ofm.id = x.form_id
           LEFT JOIN formation_entity_forms nf ON nf.version_id = (SELECT id FROM formation_catalogue_versions WHERE version = ?) AND nf.form_key = ofm.form_key
          WHERE x.version_id = ? ORDER BY x.id`,
      ).bind(next, next, from.id),
      db.prepare(
        `INSERT INTO formation_scenarios (version_id, form_id, scenario_key, route, waiver_allowed, conditions_json)
         SELECT nf.version_id, nf.id, x.scenario_key, x.route, x.waiver_allowed, x.conditions_json
           FROM formation_scenarios x JOIN formation_entity_forms ofm ON ofm.id = x.form_id
           JOIN formation_entity_forms nf ON nf.version_id = (SELECT id FROM formation_catalogue_versions WHERE version = ?) AND nf.form_key = ofm.form_key
          WHERE x.version_id = ? ORDER BY x.id`,
      ).bind(next, from.id),
      db.prepare(
        `INSERT INTO formation_rules (version_id, rule_key, kind, rule_json, position)
         SELECT (SELECT id FROM formation_catalogue_versions WHERE version = ?), rule_key, kind, rule_json, position
           FROM formation_rules WHERE version_id = ? ORDER BY id`,
      ).bind(next, from.id),
      adminAuditStatement(c.env, Number(admin.id), 'formation_catalogue_draft_created', { version: next, from_version: from.version, reason }),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e))) {
      return refuse(c, 409, { code: 'draft_open', message: 'Another draft was started meanwhile. Nothing was created.', raw: e });
    }
    return storeRefusal(c, e);
  }
  const draft = (await versionByNumber(c.env, next))!;
  return c.json({ ok: true, version: next, from_version: from.version, content_sha256: await contentSha256(await versionContent(c.env, draft.id)) }, 201);
});

/** The draft row with this key, as stored, or null. */
async function findRow(c: Ctx, entity: string, versionId: number, key: Record<string, string | null>): Promise<RawRow | null> {
  const spec = specOf(entity)!;
  const rows = (await readRawVersion(c.env, versionId))[spec.entity];
  const want = keyString(spec, key);
  return rows.find((x) => keyString(spec, canonicalRow(spec, x)) === want) ?? null;
}

async function formIdIn(c: Ctx, versionId: number, formKey: string): Promise<number | null> {
  const f = await c.env.DB.prepare('SELECT id FROM formation_entity_forms WHERE version_id = ? AND form_key = ?').bind(versionId, formKey).first<{ id: number }>();
  return f ? Number(f.id) : null;
}

/** Parse `:entity`, the draft, the key, the reason and the revision shared by save and remove. */
async function editContext(c: Ctx, mode: 'save' | 'remove') {
  const spec = specOf(String(c.req.param('entity') ?? ''));
  if (!spec) return refuse(c, 404, { code: 'unknown_entity', message: `The catalogue edits ${ENTITIES.join(', ')}.` });
  const v = await draftParam(c);
  if (v instanceof Response) return v;
  const body = await bodyOf(c);
  const reason = reasonOf(c, body);
  if (reason instanceof Response) return reason;
  const k = parseKey(spec, body?.key);
  if ('code' in k) return fail(c, k);
  const revision = body?.revision == null ? null : String(body.revision);
  if (mode === 'remove' && revision === null) return refuse(c, 400, { code: 'revision_required', message: 'Send the revision of the row you read to remove it. Nothing was removed.' });
  const existing = await findRow(c, spec.entity, v.id, k.key);
  if (revision === null && existing) {
    return refuse(c, 409, { code: 'revision_conflict', message: 'A row with that key already exists. Read it and send its revision to edit it; nothing was saved.', extra: { current_revision: await rowRevision(spec, existing) } });
  }
  if (revision !== null) {
    if (!existing) return refuse(c, 409, { code: 'revision_conflict', message: 'That row is no longer in the draft. Read the draft again; nothing was saved.', extra: { current_revision: null } });
    const now = await rowRevision(spec, existing);
    if (now !== revision) return refuse(c, 409, { code: 'revision_conflict', message: 'The row changed since you read it. Read it again; nothing was saved.', extra: { current_revision: now } });
  }
  return { spec, v, body: body!, reason, key: k.key, existing };
}

r.put('/drafts/:version/:entity', async (c) => {
  const admin = await requireHqAuthoring(c);
  const ctx = await editContext(c, 'save');
  if (ctx instanceof Response) return ctx;
  const { spec, v, body, reason, key, existing } = ctx;
  const parsed = parseFields(spec, body.fields);
  if ('code' in parsed) return fail(c, parsed);
  let row: Record<string, unknown>;
  if (existing) {
    row = { ...existing, ...parsed.values };
  } else {
    const d = newRowDefaults(spec, parsed.values);
    if ('code' in d) return fail(c, d);
    row = { ...d.row, ...parsed.values, ...key };
  }
  // Where the row hangs from: its form, or (for a form) its country.
  if (spec.parent === 'form' || (spec.parent === 'form_optional' && key.form_key != null)) {
    const id = await formIdIn(c, v.id, String(key.form_key));
    if (id == null) return refuse(c, 404, { code: 'form_not_found', message: 'The draft has no form with that key.' });
    row.form_id = id;
  } else if (spec.parent === 'form_optional') {
    row.form_id = null;
  }
  if (spec.entity === 'forms') {
    const j = (body.fields as any)?.jurisdiction;
    if (j !== undefined || !existing) {
      const jk = parseKey(specOf('countries')!, j);
      if ('code' in jk) return refuse(c, 400, { code: 'jurisdiction_required', message: 'A form names its country (and subdivision, if any) as fields.jurisdiction.' });
      const found = await c.env.DB.prepare(`SELECT id FROM formation_jurisdictions WHERE version_id = ? AND country = ? AND COALESCE(subdivision, '') = ?`)
        .bind(v.id, jk.key.country, jk.key.subdivision ?? '').first<{ id: number }>();
      if (!found) return refuse(c, 404, { code: 'country_not_found', message: 'The draft has no such country. Add the country first.' });
      row.jurisdiction_id = Number(found.id);
    }
  }
  // Whoever records the day a fact or fee was checked is its checker.
  if (spec.cols.includes('checked_by') && Object.hasOwn(parsed.values, 'checked_on')) {
    row.checked_by = parsed.values.checked_on == null ? null : Number(admin.id);
  }
  const unsourced = sourcedRefusal(spec, row);
  if (unsourced) return fail(c, unsourced);
  if (row.source_id != null && Object.hasOwn(parsed.values, 'source_id')) {
    const s = await c.env.DB.prepare('SELECT 1 FROM formation_sources WHERE id = ?').bind(row.source_id).first();
    if (!s) return refuse(c, 404, { code: 'source_not_found', message: 'There is no recorded source with that id. Record the source first.' });
  }
  const db = c.env.DB;
  const write = existing
    ? db.prepare(spec.update).bind(...colValues(spec, row), existing.id, v.id, ...colValues(spec, existing))
    : db.prepare(spec.insert).bind(v.id, ...colValues(spec, row));
  let out: any[];
  try {
    await ensureAdminAuditLogTable(c.env);
    out = await db.batch([
      write,
      adminAuditStatement(c.env, Number(admin.id), existing ? 'formation_catalogue_row_edited' : 'formation_catalogue_row_added',
        { version: v.version, entity: spec.entity, key, fields: Object.keys((body.fields as object) || {}).sort(), reason }, { onlyIfChanged: true }),
    ]);
  } catch (e) {
    return storeRefusal(c, e);
  }
  if (Number(out?.[0]?.meta?.changes ?? 0) !== 1) {
    return refuse(c, 409, { code: 'revision_conflict', message: 'The row changed while it was being saved. Read it again; nothing was saved.' });
  }
  const saved = await findRow(c, spec.entity, v.id, key);
  return c.json({ ok: true, version: v.version, entity: spec.entity, row: saved ? canonicalRow(spec, saved) : null, revision: saved ? await rowRevision(spec, saved) : null }, existing ? 200 : 201);
});

r.delete('/drafts/:version/:entity', async (c) => {
  const admin = await requireHqAuthoring(c);
  const ctx = await editContext(c, 'remove');
  if (ctx instanceof Response) return ctx;
  const { spec, v, reason, key } = ctx;
  const existing = ctx.existing!;
  if (spec.entity === 'countries' || spec.entity === 'forms') {
    const used = spec.entity === 'countries'
      ? await c.env.DB.prepare('SELECT 1 FROM formation_entity_forms WHERE jurisdiction_id = ? LIMIT 1').bind(existing.id).first()
      : await c.env.DB.prepare(
        `SELECT 1 WHERE EXISTS (SELECT 1 FROM formation_form_facts WHERE form_id = ?) OR EXISTS (SELECT 1 FROM formation_fee_lines WHERE form_id = ?)
            OR EXISTS (SELECT 1 FROM formation_pack_items WHERE form_id = ?) OR EXISTS (SELECT 1 FROM formation_fact_schema WHERE form_id = ?)
            OR EXISTS (SELECT 1 FROM formation_scenarios WHERE form_id = ?)`,
      ).bind(existing.id, existing.id, existing.id, existing.id, existing.id).first();
    if (used) return refuse(c, 409, { code: 'row_in_use', message: `Remove what hangs from this ${spec.entity === 'countries' ? 'country (its forms)' : 'form (its facts, fees, pack, questions and scenarios)'} first. Nothing was removed.` });
  }
  const db = c.env.DB;
  let out: any[];
  try {
    await ensureAdminAuditLogTable(c.env);
    out = await db.batch([
      db.prepare(spec.remove).bind(existing.id, v.id, ...colValues(spec, existing)),
      adminAuditStatement(c.env, Number(admin.id), 'formation_catalogue_row_removed', { version: v.version, entity: spec.entity, key, reason }, { onlyIfChanged: true }),
    ]);
  } catch (e) {
    return storeRefusal(c, e);
  }
  if (Number(out?.[0]?.meta?.changes ?? 0) !== 1) {
    return refuse(c, 409, { code: 'revision_conflict', message: 'The row changed while it was being removed. Read it again; nothing was removed.' });
  }
  return c.json({ ok: true, version: v.version, entity: spec.entity, key, removed: true });
});

// ── sources and their checks (not versioned) ──

r.get('/sources', async (c) => {
  await requireHqAuthoring(c);
  const rows = (await c.env.DB.prepare(
    `SELECT s.id, s.kind, s.title, s.url, s.publisher, s.created_at,
            (SELECT k.checked_on FROM formation_source_checks k WHERE k.source_id = s.id ORDER BY k.checked_on DESC, k.id DESC LIMIT 1) AS last_checked_on,
            (SELECT k.outcome FROM formation_source_checks k WHERE k.source_id = s.id ORDER BY k.checked_on DESC, k.id DESC LIMIT 1) AS last_outcome,
            (SELECT k.checked_by FROM formation_source_checks k WHERE k.source_id = s.id ORDER BY k.checked_on DESC, k.id DESC LIMIT 1) AS last_checked_by
       FROM formation_sources s ORDER BY s.id`,
  ).all<any>()).results || [];
  return c.json({
    sources: rows.map((s: any) => ({
      id: Number(s.id), kind: String(s.kind), title: String(s.title), url: s.url ?? null, publisher: s.publisher ?? null, created_at: s.created_at ?? null,
      last_check: s.last_checked_on == null ? null : { checked_on: String(s.last_checked_on), outcome: String(s.last_outcome), checked_by: Number(s.last_checked_by) },
    })),
  });
});

r.post('/sources', async (c) => {
  const admin = await requireHqAuthoring(c);
  const body = await bodyOf(c);
  const reason = reasonOf(c, body);
  if (reason instanceof Response) return reason;
  const kind = String(body?.kind ?? '');
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const url = body?.url == null || body.url === '' ? null : String(body.url);
  const publisher = typeof body?.publisher === 'string' && body.publisher.trim() ? body.publisher.trim() : null;
  if (!SOURCE_KINDS.includes(kind)) return refuse(c, 400, { code: 'invalid_field', message: `kind: one of ${SOURCE_KINDS.join(', ')}.` });
  if (!title || title.length > 300) return refuse(c, 400, { code: 'invalid_field', message: 'title: 1 to 300 characters.' });
  if (url !== null && (!url.startsWith('https://') || url.length > 2000)) return refuse(c, 400, { code: 'invalid_field', message: 'url: an https:// address of at most 2000 characters, or none.' });
  if (publisher !== null && publisher.length > 200) return refuse(c, 400, { code: 'invalid_field', message: 'publisher: at most 200 characters.' });
  const db = c.env.DB;
  let out: any[];
  try {
    await ensureAdminAuditLogTable(c.env);
    out = await db.batch([
      db.prepare('INSERT INTO formation_sources (kind, title, url, publisher, created_by) VALUES (?, ?, ?, ?, ?)').bind(kind, title, url, publisher, Number(admin.id)),
      adminAuditStatement(c.env, Number(admin.id), 'formation_source_added', { kind, title, url, reason }),
    ]);
  } catch (e) {
    return storeRefusal(c, e);
  }
  return c.json({ ok: true, id: Number(out?.[0]?.meta?.last_row_id ?? 0), kind, title, url, publisher }, 201);
});

r.post('/sources/:id/checks', async (c) => {
  const admin = await requireHqAuthoring(c);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return refuse(c, 400, { code: 'invalid_source', message: 'A source id is a whole number.' });
  const body = await bodyOf(c);
  const reason = reasonOf(c, body);
  if (reason instanceof Response) return reason;
  if (!isPastDay(body?.checked_on)) return refuse(c, 400, { code: 'invalid_field', message: 'checked_on: the day the source was read, YYYY-MM-DD, not in the future.' });
  const outcome = String(body?.outcome ?? '');
  if (!CHECK_OUTCOMES.includes(outcome)) return refuse(c, 400, { code: 'invalid_field', message: `outcome: one of ${CHECK_OUTCOMES.join(', ')}.` });
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  if (note !== null && note.length > 2000) return refuse(c, 400, { code: 'invalid_field', message: 'note: at most 2000 characters.' });
  const s = await c.env.DB.prepare('SELECT 1 FROM formation_sources WHERE id = ?').bind(id).first();
  if (!s) return refuse(c, 404, { code: 'source_not_found', message: 'There is no recorded source with that id.' });
  const db = c.env.DB;
  try {
    await ensureAdminAuditLogTable(c.env);
    await db.batch([
      db.prepare('INSERT INTO formation_source_checks (source_id, checked_on, checked_by, outcome, note) VALUES (?, ?, ?, ?, ?)')
        .bind(id, body!.checked_on, Number(admin.id), outcome, note),
      adminAuditStatement(c.env, Number(admin.id), 'formation_source_checked', { source_id: id, checked_on: body!.checked_on, outcome, reason }),
    ]);
  } catch (e) {
    return storeRefusal(c, e);
  }
  return c.json({ ok: true, source_id: id, checked_on: body!.checked_on, checked_by: Number(admin.id), outcome, note }, 201);
});

// ── restricted places (not versioned; Super Admin) ──

r.get('/restricted', async (c) => {
  await requireHqAuthoring(c);
  return c.json({ places: await restrictedPlaces(c.env) });
});

/** The checked fields of a restricted place: kind, source, day and note. */
async function restrictedFields(c: Ctx, body: Record<string, unknown> | null): Promise<{ kind: string; source_id: number; checked_on: string; note: string | null } | Response> {
  const kind = String(body?.kind ?? '');
  if (!(RESTRICTED_KINDS as readonly string[]).includes(kind)) return refuse(c, 400, { code: 'invalid_field', message: `kind: one of ${RESTRICTED_KINDS.join(', ')}.` });
  const sourceId = Number(body?.source_id);
  if (!Number.isSafeInteger(sourceId) || sourceId < 1) return refuse(c, 400, { code: 'source_required', message: 'A restricted place needs the source it rests on. Nothing was changed.' });
  if (!isPastDay(body?.checked_on)) return refuse(c, 400, { code: 'checked_on_required', message: 'A restricted place needs the day its source was checked, YYYY-MM-DD, not in the future. Nothing was changed.' });
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  if (note !== null && note.length > 2000) return refuse(c, 400, { code: 'invalid_field', message: 'note: at most 2000 characters.' });
  const s = await c.env.DB.prepare('SELECT 1 FROM formation_sources WHERE id = ?').bind(sourceId).first();
  if (!s) return refuse(c, 404, { code: 'source_not_found', message: 'There is no recorded source with that id. Record the source first.' });
  return { kind, source_id: sourceId, checked_on: String(body!.checked_on), note };
}

const RESTRICTED_WHAT = 'changes the restricted places';

r.post('/restricted', async (c) => {
  const admin = await requireHqAdmin(c);
  const denied = await superAdminWrite(c, admin, RESTRICTED_WHAT);
  if (denied) return denied;
  const body = await bodyOf(c);
  const reason = reasonOf(c, body);
  if (reason instanceof Response) return reason;
  const place = typeof body?.place === 'string' ? body.place.trim().toUpperCase() : '';
  if (!PLACE_RE.test(place)) return refuse(c, 400, { code: 'invalid_place', message: 'A place is a country code (IR) or a place within one (UA-43).' });
  const f = await restrictedFields(c, body);
  if (f instanceof Response) return f;
  const db = c.env.DB;
  let out: any[];
  try {
    await ensureAdminAuditLogTable(c.env);
    out = await db.batch([
      db.prepare('INSERT INTO formation_restricted_jurisdictions (place, kind, source_id, checked_on, checked_by, note) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(place, f.kind, f.source_id, f.checked_on, Number(admin.id), f.note),
      adminAuditStatement(c.env, Number(admin.id), 'formation_restricted_place_added', { place, ...f, reason }),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e))) {
      return refuse(c, 409, { code: 'place_exists', message: 'That place is already restricted that way. Edit it instead.', raw: e });
    }
    return storeRefusal(c, e);
  }
  return c.json({ ok: true, id: Number(out?.[0]?.meta?.last_row_id ?? 0), place, ...f }, 201);
});

async function restrictedRow(c: Ctx): Promise<{ id: number; place: string; kind: string } | Response> {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return refuse(c, 400, { code: 'invalid_place', message: 'A restricted place id is a whole number.' });
  const row = await c.env.DB.prepare('SELECT id, place, kind FROM formation_restricted_jurisdictions WHERE id = ?').bind(id).first<{ id: number; place: string; kind: string }>();
  if (!row) return refuse(c, 404, { code: 'place_not_found', message: 'There is no restricted place with that id.' });
  return row;
}

r.patch('/restricted/:id', async (c) => {
  const admin = await requireHqAdmin(c);
  const denied = await superAdminWrite(c, admin, RESTRICTED_WHAT);
  if (denied) return denied;
  const row = await restrictedRow(c);
  if (row instanceof Response) return row;
  const body = await bodyOf(c);
  const reason = reasonOf(c, body);
  if (reason instanceof Response) return reason;
  const f = await restrictedFields(c, { kind: row.kind, ...(body || {}) });
  if (f instanceof Response) return f;
  const db = c.env.DB;
  try {
    await ensureAdminAuditLogTable(c.env);
    await db.batch([
      db.prepare('UPDATE formation_restricted_jurisdictions SET kind = ?, source_id = ?, checked_on = ?, checked_by = ?, note = ? WHERE id = ?')
        .bind(f.kind, f.source_id, f.checked_on, Number(admin.id), f.note, row.id),
      adminAuditStatement(c.env, Number(admin.id), 'formation_restricted_place_edited', { id: row.id, place: row.place, from_kind: row.kind, ...f, reason }, { onlyIfChanged: true }),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e))) {
      return refuse(c, 409, { code: 'place_exists', message: 'That place is already restricted that way.', raw: e });
    }
    return storeRefusal(c, e);
  }
  return c.json({ ok: true, id: row.id, place: row.place, ...f });
});

r.delete('/restricted/:id', async (c) => {
  const admin = await requireHqAdmin(c);
  const denied = await superAdminWrite(c, admin, RESTRICTED_WHAT);
  if (denied) return denied;
  const row = await restrictedRow(c);
  if (row instanceof Response) return row;
  const body = await bodyOf(c);
  const reason = reasonOf(c, body);
  if (reason instanceof Response) return reason;
  const db = c.env.DB;
  try {
    await ensureAdminAuditLogTable(c.env);
    await db.batch([
      db.prepare('DELETE FROM formation_restricted_jurisdictions WHERE id = ?').bind(row.id),
      adminAuditStatement(c.env, Number(admin.id), 'formation_restricted_place_removed', { id: row.id, place: row.place, kind: row.kind, reason }, { onlyIfChanged: true }),
    ]);
  } catch (e) {
    return storeRefusal(c, e);
  }
  return c.json({ ok: true, id: row.id, place: row.place, kind: row.kind, removed: true });
});

export const mount: RouteMount = { path: '/api/admin/formation/catalogue', router: r };
export default r;
