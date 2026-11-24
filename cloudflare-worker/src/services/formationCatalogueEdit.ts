/**
 * D6699 (#6699, plan key H3 of #6680) — editing the formation catalogue in a
 * draft: each versioned row read by its natural key, its revision, a
 * revision-checked write, the diff of two versions, and the SHA-256 of a
 * version's content, of each form's templates and of the rule set (for
 * counsel's sign-off in #6700). Also the restricted-places reader.
 *
 * KEYS, NOT IDS. A row is named by what it is: a country by `country` and
 * `subdivision`, a form by `form_key`, a fact by `form_key` and `fact_key`,
 * and so on. Ids differ between a published version and the draft copied
 * from it; the keys do not, so the diff, the hashes and the revisions are
 * computed from keys and values only.
 *
 * A REVISION IS THE ROW'S CONTENT. The schema (D6689) has no revision column,
 * and #6699 adds no migration. A row's revision is the SHA-256 of its
 * canonical content. A write names the revision it read; the route compares
 * it with the row as stored and then writes with a compare-and-set (`WHERE`
 * every stored column `IS` the value it compared), so a write that loses a
 * race changes nothing and is refused as a conflict.
 *
 * CANONICAL. Objects are written with their keys sorted, a JSON column is
 * read as its parsed value, and each table's rows are sorted by their key.
 * The same content therefore hashes the same whatever its ids or row order.
 *
 * All SQL is literal and bound. Nothing here publishes: a published or
 * retired version is immutable (the D6689 triggers), and the routes edit only
 * a `draft`.
 */
import type { Env } from '../types';

// ── canonical JSON and SHA-256 ──

/** JSON with every object's keys sorted, so equal content gives equal text. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = walk(x);
      }
      return out;
    }
    return v === undefined ? null : v;
  };
  return JSON.stringify(walk(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const parseJson = (s: unknown): unknown => {
  if (typeof s !== 'string') return s ?? null;
  try { return JSON.parse(s); } catch { return s; }
};

// ── what each editable table holds ──

export const ENTITIES = Object.freeze(['countries', 'forms', 'facts', 'fees', 'pack', 'questions', 'scenarios', 'rules'] as const);
export type Entity = typeof ENTITIES[number];

export type FieldKind = 'text' | 'enum' | 'bool' | 'int' | 'cents' | 'currency' | 'day' | 'source' | 'json';
export type Field = {
  name: string; kind: FieldKind; max?: number; values?: readonly string[];
  /** May be null. */ nullable?: boolean;
  /** Needed when the row is created. */ required?: boolean;
  /** The value a new row takes when the field is not given. */ default?: unknown;
};

type Spec = {
  entity: Entity;
  /** The request's `key` fields, in order. */
  key: readonly string[];
  /** A child of a form: `form_key` resolves to `form_id` in the same version. */
  parent: 'none' | 'jurisdiction' | 'form' | 'form_optional';
  fields: readonly Field[];
  /** Stored columns other than `id` and `version_id`, in the bind order of insert, update and delete. */
  cols: readonly string[];
  json: readonly string[];
  select: string;
  insert: string;
  update: string;
  remove: string;
};

const day: Field = { name: 'checked_on', kind: 'day', nullable: true, default: null };
const source: Field = { name: 'source_id', kind: 'source', nullable: true, default: null };

// The statements are spelled out, not assembled: every column is named here once per statement.
const SPECS: Readonly<Record<Entity, Spec>> = Object.freeze({
  countries: {
    entity: 'countries', key: ['country', 'subdivision'], parent: 'none',
    fields: [
      { name: 'registry_name', kind: 'text', max: 200, nullable: true, default: null },
      { name: 'vocabulary', kind: 'json', default: {} },
    ],
    cols: ['country', 'subdivision', 'registry_name', 'vocabulary_json'], json: ['vocabulary_json'],
    select: `SELECT j.id, j.country, j.subdivision, j.registry_name, j.vocabulary_json
               FROM formation_jurisdictions j WHERE j.version_id = ?`,
    insert: `INSERT INTO formation_jurisdictions (version_id, country, subdivision, registry_name, vocabulary_json) VALUES (?, ?, ?, ?, ?)`,
    update: `UPDATE formation_jurisdictions SET country = ?, subdivision = ?, registry_name = ?, vocabulary_json = ?
              WHERE id = ? AND version_id = ? AND country IS ? AND subdivision IS ? AND registry_name IS ? AND vocabulary_json IS ?`,
    remove: `DELETE FROM formation_jurisdictions
              WHERE id = ? AND version_id = ? AND country IS ? AND subdivision IS ? AND registry_name IS ? AND vocabulary_json IS ?`,
  },
  forms: {
    entity: 'forms', key: ['form_key'], parent: 'jurisdiction',
    fields: [
      { name: 'label', kind: 'text', max: 200, required: true },
      { name: 'offer_mode', kind: 'enum', values: ['orderable', 'guided', 'information_only', 'off'], default: 'off' },
      { name: 'legal_form_family', kind: 'text', max: 64, nullable: true, default: null },
      { name: 'legacy_gate', kind: 'text', max: 64, nullable: true, default: null },
      { name: 'legacy_display', kind: 'json', nullable: true, default: null },
      { name: 'allow_axal_collection', kind: 'bool', default: 0 },
    ],
    cols: ['jurisdiction_id', 'form_key', 'label', 'offer_mode', 'legal_form_family', 'legacy_gate', 'legacy_display_json', 'allow_axal_collection'],
    json: ['legacy_display_json'],
    select: `SELECT f.id, f.jurisdiction_id, j.country, j.subdivision, f.form_key, f.label, f.offer_mode, f.legal_form_family,
                    f.legacy_gate, f.legacy_display_json, f.allow_axal_collection
               FROM formation_entity_forms f JOIN formation_jurisdictions j ON j.id = f.jurisdiction_id WHERE f.version_id = ?`,
    insert: `INSERT INTO formation_entity_forms (version_id, jurisdiction_id, form_key, label, offer_mode, legal_form_family, legacy_gate, legacy_display_json, allow_axal_collection)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    update: `UPDATE formation_entity_forms SET jurisdiction_id = ?, form_key = ?, label = ?, offer_mode = ?, legal_form_family = ?, legacy_gate = ?, legacy_display_json = ?, allow_axal_collection = ?
              WHERE id = ? AND version_id = ? AND jurisdiction_id IS ? AND form_key IS ? AND label IS ? AND offer_mode IS ? AND legal_form_family IS ?
                AND legacy_gate IS ? AND legacy_display_json IS ? AND allow_axal_collection IS ?`,
    remove: `DELETE FROM formation_entity_forms
              WHERE id = ? AND version_id = ? AND jurisdiction_id IS ? AND form_key IS ? AND label IS ? AND offer_mode IS ? AND legal_form_family IS ?
                AND legacy_gate IS ? AND legacy_display_json IS ? AND allow_axal_collection IS ?`,
  },
  facts: {
    entity: 'facts', key: ['form_key', 'fact_key'], parent: 'form',
    fields: [
      { name: 'value', kind: 'text', max: 2000, nullable: true, default: null },
      { name: 'status', kind: 'enum', values: ['recorded', 'provisional', 'not_recorded', 'disputed'], default: 'not_recorded' },
      { name: 'blocking', kind: 'bool', default: 0 },
      source, day,
    ],
    cols: ['form_id', 'fact_key', 'value', 'status', 'blocking', 'source_id', 'checked_on', 'checked_by'], json: [],
    select: `SELECT x.id, x.form_id, f.form_key, x.fact_key, x.value, x.status, x.blocking, x.source_id, x.checked_on, x.checked_by
               FROM formation_form_facts x JOIN formation_entity_forms f ON f.id = x.form_id WHERE x.version_id = ?`,
    insert: `INSERT INTO formation_form_facts (version_id, form_id, fact_key, value, status, blocking, source_id, checked_on, checked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    update: `UPDATE formation_form_facts SET form_id = ?, fact_key = ?, value = ?, status = ?, blocking = ?, source_id = ?, checked_on = ?, checked_by = ?
              WHERE id = ? AND version_id = ? AND form_id IS ? AND fact_key IS ? AND value IS ? AND status IS ? AND blocking IS ?
                AND source_id IS ? AND checked_on IS ? AND checked_by IS ?`,
    remove: `DELETE FROM formation_form_facts
              WHERE id = ? AND version_id = ? AND form_id IS ? AND fact_key IS ? AND value IS ? AND status IS ? AND blocking IS ?
                AND source_id IS ? AND checked_on IS ? AND checked_by IS ?`,
  },
  fees: {
    entity: 'fees', key: ['form_key', 'line_key'], parent: 'form',
    fields: [
      { name: 'label', kind: 'text', max: 200, required: true },
      { name: 'payee', kind: 'text', max: 200, required: true },
      { name: 'collected_by', kind: 'enum', values: ['axal', 'payee', 'provider'], required: true },
      { name: 'currency', kind: 'currency', required: true },
      { name: 'amount_cents', kind: 'cents', nullable: true, default: null },
      { name: 'timing', kind: 'enum', values: ['at_formation', 'annual', 'one_off', 'on_event'], required: true },
      source, day,
    ],
    cols: ['form_id', 'line_key', 'label', 'payee', 'collected_by', 'currency', 'amount_cents', 'timing', 'source_id', 'checked_on', 'checked_by'], json: [],
    select: `SELECT x.id, x.form_id, f.form_key, x.line_key, x.label, x.payee, x.collected_by, x.currency, x.amount_cents, x.timing,
                    x.source_id, x.checked_on, x.checked_by
               FROM formation_fee_lines x JOIN formation_entity_forms f ON f.id = x.form_id WHERE x.version_id = ?`,
    insert: `INSERT INTO formation_fee_lines (version_id, form_id, line_key, label, payee, collected_by, currency, amount_cents, timing, source_id, checked_on, checked_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    update: `UPDATE formation_fee_lines SET form_id = ?, line_key = ?, label = ?, payee = ?, collected_by = ?, currency = ?, amount_cents = ?, timing = ?,
                    source_id = ?, checked_on = ?, checked_by = ?
              WHERE id = ? AND version_id = ? AND form_id IS ? AND line_key IS ? AND label IS ? AND payee IS ? AND collected_by IS ? AND currency IS ?
                AND amount_cents IS ? AND timing IS ? AND source_id IS ? AND checked_on IS ? AND checked_by IS ?`,
    remove: `DELETE FROM formation_fee_lines
              WHERE id = ? AND version_id = ? AND form_id IS ? AND line_key IS ? AND label IS ? AND payee IS ? AND collected_by IS ? AND currency IS ?
                AND amount_cents IS ? AND timing IS ? AND source_id IS ? AND checked_on IS ? AND checked_by IS ?`,
  },
  pack: {
    entity: 'pack', key: ['form_key', 'item_key'], parent: 'form',
    fields: [
      { name: 'phase', kind: 'enum', values: ['before_filing', 'filing', 'after_filing'], required: true },
      { name: 'kind', kind: 'enum', values: ['document', 'filing', 'registration', 'step'], required: true },
      { name: 'acting_party', kind: 'enum', values: ['founder', 'axal', 'counsel', 'provider', 'registry'], required: true },
      { name: 'title', kind: 'text', max: 200, required: true },
      { name: 'template_key', kind: 'text', max: 64, nullable: true, default: null },
      { name: 'counsel_required', kind: 'bool', default: 1 },
      { name: 'position', kind: 'int', default: 0 },
    ],
    cols: ['form_id', 'item_key', 'phase', 'kind', 'acting_party', 'title', 'template_key', 'counsel_required', 'position'], json: [],
    select: `SELECT x.id, x.form_id, f.form_key, x.item_key, x.phase, x.kind, x.acting_party, x.title, x.template_key, x.counsel_required, x.position
               FROM formation_pack_items x JOIN formation_entity_forms f ON f.id = x.form_id WHERE x.version_id = ?`,
    insert: `INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, template_key, counsel_required, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    update: `UPDATE formation_pack_items SET form_id = ?, item_key = ?, phase = ?, kind = ?, acting_party = ?, title = ?, template_key = ?, counsel_required = ?, position = ?
              WHERE id = ? AND version_id = ? AND form_id IS ? AND item_key IS ? AND phase IS ? AND kind IS ? AND acting_party IS ? AND title IS ?
                AND template_key IS ? AND counsel_required IS ? AND position IS ?`,
    remove: `DELETE FROM formation_pack_items
              WHERE id = ? AND version_id = ? AND form_id IS ? AND item_key IS ? AND phase IS ? AND kind IS ? AND acting_party IS ? AND title IS ?
                AND template_key IS ? AND counsel_required IS ? AND position IS ?`,
  },
  questions: {
    entity: 'questions', key: ['form_key', 'question_key'], parent: 'form_optional',
    fields: [
      { name: 'label', kind: 'text', max: 300, required: true },
      { name: 'answer_kind', kind: 'enum', values: ['text', 'number', 'date', 'choice', 'boolean', 'person', 'address'], required: true },
      { name: 'options', kind: 'json', nullable: true, default: null },
      { name: 'required', kind: 'bool', default: 1 },
      { name: 'position', kind: 'int', default: 0 },
    ],
    cols: ['form_id', 'question_key', 'label', 'answer_kind', 'options_json', 'required', 'position'], json: ['options_json'],
    select: `SELECT x.id, x.form_id, f.form_key, x.question_key, x.label, x.answer_kind, x.options_json, x.required, x.position
               FROM formation_fact_schema x LEFT JOIN formation_entity_forms f ON f.id = x.form_id WHERE x.version_id = ?`,
    insert: `INSERT INTO formation_fact_schema (version_id, form_id, question_key, label, answer_kind, options_json, required, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    update: `UPDATE formation_fact_schema SET form_id = ?, question_key = ?, label = ?, answer_kind = ?, options_json = ?, required = ?, position = ?
              WHERE id = ? AND version_id = ? AND form_id IS ? AND question_key IS ? AND label IS ? AND answer_kind IS ? AND options_json IS ?
                AND required IS ? AND position IS ?`,
    remove: `DELETE FROM formation_fact_schema
              WHERE id = ? AND version_id = ? AND form_id IS ? AND question_key IS ? AND label IS ? AND answer_kind IS ? AND options_json IS ?
                AND required IS ? AND position IS ?`,
  },
  scenarios: {
    entity: 'scenarios', key: ['form_key', 'scenario_key'], parent: 'form',
    fields: [
      { name: 'route', kind: 'enum', values: ['axal_files', 'provider_files', 'founder_files', 'refer_counsel', 'not_offered'], required: true },
      { name: 'waiver_allowed', kind: 'bool', default: 0 },
      { name: 'conditions', kind: 'json', default: {} },
    ],
    cols: ['form_id', 'scenario_key', 'route', 'waiver_allowed', 'conditions_json'], json: ['conditions_json'],
    select: `SELECT x.id, x.form_id, f.form_key, x.scenario_key, x.route, x.waiver_allowed, x.conditions_json
               FROM formation_scenarios x JOIN formation_entity_forms f ON f.id = x.form_id WHERE x.version_id = ?`,
    insert: `INSERT INTO formation_scenarios (version_id, form_id, scenario_key, route, waiver_allowed, conditions_json) VALUES (?, ?, ?, ?, ?, ?)`,
    update: `UPDATE formation_scenarios SET form_id = ?, scenario_key = ?, route = ?, waiver_allowed = ?, conditions_json = ?
              WHERE id = ? AND version_id = ? AND form_id IS ? AND scenario_key IS ? AND route IS ? AND waiver_allowed IS ? AND conditions_json IS ?`,
    remove: `DELETE FROM formation_scenarios
              WHERE id = ? AND version_id = ? AND form_id IS ? AND scenario_key IS ? AND route IS ? AND waiver_allowed IS ? AND conditions_json IS ?`,
  },
  rules: {
    entity: 'rules', key: ['rule_key'], parent: 'none',
    fields: [
      { name: 'kind', kind: 'enum', values: ['recommend', 'block', 'require', 'warn'], required: true },
      { name: 'rule', kind: 'json', required: true },
      { name: 'position', kind: 'int', default: 0 },
    ],
    cols: ['rule_key', 'kind', 'rule_json', 'position'], json: ['rule_json'],
    select: `SELECT x.id, x.rule_key, x.kind, x.rule_json, x.position FROM formation_rules x WHERE x.version_id = ?`,
    insert: `INSERT INTO formation_rules (version_id, rule_key, kind, rule_json, position) VALUES (?, ?, ?, ?, ?)`,
    update: `UPDATE formation_rules SET rule_key = ?, kind = ?, rule_json = ?, position = ?
              WHERE id = ? AND version_id = ? AND rule_key IS ? AND kind IS ? AND rule_json IS ? AND position IS ?`,
    remove: `DELETE FROM formation_rules WHERE id = ? AND version_id = ? AND rule_key IS ? AND kind IS ? AND rule_json IS ? AND position IS ?`,
  },
});

export function specOf(entity: string): Spec | null {
  return (ENTITIES as readonly string[]).includes(entity) ? SPECS[entity as Entity] : null;
}

/** A field's request name is its column's name without `_json`. */
const fieldCol = (f: Field) => (f.kind === 'json' ? `${f.name}_json` : f.name);

/** A stored row as read: its id, its stored columns, and the parent keys (`form_key`, `country`, `subdivision`). */
export type RawRow = Record<string, unknown> & { id: number };

/**
 * The canonical content of a stored row: its key and values, no ids. A form
 * names its country and subdivision; a child names its form; a JSON column is
 * its parsed value under the field's name (`vocabulary`, `rule`, …).
 */
export function canonicalRow(spec: Spec, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of spec.key) out[k] = raw[k] ?? null;
  if (spec.entity === 'forms') { out.country = raw.country ?? null; out.subdivision = raw.subdivision ?? null; }
  for (const f of spec.fields) {
    const v = raw[fieldCol(f)];
    out[f.name] = f.kind === 'json' ? (v == null ? null : parseJson(v)) : (v ?? null);
    if (f.kind === 'bool' || f.kind === 'int' || f.kind === 'source' || f.kind === 'cents') out[f.name] = v == null ? null : Number(v);
  }
  if (spec.cols.includes('checked_by')) out.checked_by = raw.checked_by == null ? null : Number(raw.checked_by);
  return out;
}

/** The row's key as one string, for maps and sorting. */
export function keyString(spec: Spec, row: Record<string, unknown>): string {
  return JSON.stringify(spec.key.map((k) => row[k] ?? null));
}

/** A row's revision: the SHA-256 of its canonical content. */
export async function rowRevision(spec: Spec, raw: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson(canonicalRow(spec, raw)));
}

export type VersionContent = Record<Entity, Record<string, unknown>[]>;

/** Every stored row of a version, raw, per table. */
export async function readRawVersion(env: Env, versionId: number): Promise<Record<Entity, RawRow[]>> {
  const lists = await Promise.all(ENTITIES.map((e) => env.DB.prepare(SPECS[e].select).bind(versionId).all<RawRow>()));
  const out = {} as Record<Entity, RawRow[]>;
  ENTITIES.forEach((e, i) => { out[e] = (lists[i].results || []) as RawRow[]; });
  return out;
}

/** A version's canonical content: each table's rows, canonical and sorted by key. */
export function canonicalContent(raw: Record<Entity, Record<string, unknown>[]>): VersionContent {
  const out = {} as VersionContent;
  for (const e of ENTITIES) {
    const spec = SPECS[e];
    out[e] = (raw[e] || []).map((r) => canonicalRow(spec, r))
      .sort((a, b) => (keyString(spec, a) < keyString(spec, b) ? -1 : keyString(spec, a) > keyString(spec, b) ? 1 : 0));
  }
  return out;
}

export async function versionContent(env: Env, versionId: number): Promise<VersionContent> {
  return canonicalContent(await readRawVersion(env, versionId));
}

// ── hashes for sign-off (#6700) ──

/** The SHA-256 of a version's whole content (every table, no ids, no version metadata). */
export async function contentSha256(content: VersionContent): Promise<string> {
  return sha256Hex(canonicalJson(content));
}

/** The SHA-256 of the rule set alone. */
export async function rulesSha256(content: VersionContent): Promise<string> {
  return sha256Hex(canonicalJson(content.rules));
}

/** The active body of a template, as the order gate reads it (D6693), or null. */
export type TemplateBodyOf = (slug: string) => Promise<string | null>;
export const templateBodyFrom = (env: Env): TemplateBodyOf => async (slug) => {
  const r = await env.DB.prepare(
    `SELECT body_md FROM legal_templates WHERE slug = ? AND is_active = 1 AND is_stub = 0 AND length(trim(body_md)) > 0`,
  ).bind(slug).first<{ body_md: string }>();
  return r?.body_md ?? null;
};

/**
 * Per form, the SHA-256 of its templates: each pack item that names a
 * template, with the SHA-256 of that template's active body (null when it has
 * none), sorted by item key. A change to a template body changes it.
 */
export async function formTemplatesSha256(content: VersionContent, bodyOf: TemplateBodyOf): Promise<{ form_key: string; templates_sha256: string; templates: { item_key: string; template_key: string; counsel_required: number; body_sha256: string | null }[] }[]> {
  const bodies = new Map<string, string | null>();
  const out = [];
  for (const form of content.forms) {
    const fk = String(form.form_key);
    const items = [];
    for (const p of content.pack.filter((x) => x.form_key === fk && x.template_key != null)) {
      const slug = String(p.template_key);
      if (!bodies.has(slug)) {
        const body = await bodyOf(slug);
        bodies.set(slug, body == null ? null : await sha256Hex(body));
      }
      items.push({ item_key: String(p.item_key), template_key: slug, counsel_required: Number(p.counsel_required), body_sha256: bodies.get(slug) ?? null });
    }
    out.push({ form_key: fk, templates_sha256: await sha256Hex(canonicalJson({ form_key: fk, templates: items })), templates: items });
  }
  return out;
}

// ── diff ──

export type FieldChange = { field: string; from: unknown; to: unknown };
export type RowChange = { entity: Entity; change: 'added' | 'removed' | 'changed'; key: Record<string, unknown>; fields: FieldChange[] };

/** Every row added, removed or changed from `base` to `next`, table by table, with each changed field. */
export function diffContent(base: VersionContent, next: VersionContent): RowChange[] {
  const out: RowChange[] = [];
  for (const e of ENTITIES) {
    const spec = SPECS[e];
    const a = new Map((base[e] || []).map((r) => [keyString(spec, r), r]));
    const b = new Map((next[e] || []).map((r) => [keyString(spec, r), r]));
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
    for (const k of keys) {
      const was = a.get(k); const now = b.get(k);
      const keyObj = Object.fromEntries(spec.key.map((f) => [f, (now ?? was)![f] ?? null]));
      const names = [...new Set([...Object.keys(was || {}), ...Object.keys(now || {})])].filter((f) => !spec.key.includes(f)).sort();
      if (!was || !now) {
        out.push({ entity: e, change: was ? 'removed' : 'added', key: keyObj, fields: names.map((f) => ({ field: f, from: was ? was[f] ?? null : null, to: now ? now[f] ?? null : null })) });
        continue;
      }
      const fields = names.filter((f) => canonicalJson(was[f] ?? null) !== canonicalJson(now[f] ?? null)).map((f) => ({ field: f, from: was[f] ?? null, to: now[f] ?? null }));
      if (fields.length) out.push({ entity: e, change: 'changed', key: keyObj, fields });
    }
  }
  return out;
}

// ── validating an edit ──

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** A real calendar day, YYYY-MM-DD, not after `today`. */
export function isPastDay(s: unknown, today = todayIso()): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s <= today;
}

const KEY_RE = /^[a-z0-9_]{1,64}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const SUBDIVISION_RE = /^[A-Z0-9]{1,6}$/;

export type Refusal = { status: number; code: string; message: string };

/** The request's `key`, checked against the table's key fields. */
export function parseKey(spec: Spec, key: unknown): { key: Record<string, string | null> } | Refusal {
  const k = (key && typeof key === 'object' ? key : {}) as Record<string, unknown>;
  const out: Record<string, string | null> = {};
  for (const name of spec.key) {
    const v = k[name];
    if (name === 'country') {
      if (typeof v !== 'string' || !COUNTRY_RE.test(v)) return { status: 400, code: 'invalid_key', message: 'A country is two upper-case letters (ISO 3166-1).' };
      out[name] = v;
    } else if (name === 'subdivision') {
      if (v == null || v === '') { out[name] = null; continue; }
      if (typeof v !== 'string' || !SUBDIVISION_RE.test(v)) return { status: 400, code: 'invalid_key', message: 'A subdivision is one to six upper-case letters or digits, or none.' };
      out[name] = v;
    } else if (name === 'form_key' && spec.parent === 'form_optional' && (v == null || v === '')) {
      out[name] = null;
    } else {
      if (typeof v !== 'string' || !KEY_RE.test(v)) return { status: 400, code: 'invalid_key', message: `The key needs ${name}: lower-case letters, digits and underscores, at most 64.` };
      out[name] = v;
    }
  }
  return { key: out };
}

/**
 * The given fields as stored column values, each checked. Unknown fields are
 * refused, so a typo is never silently dropped.
 */
export function parseFields(spec: Spec, fields: unknown): { values: Record<string, unknown> } | Refusal {
  const given = (fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {}) as Record<string, unknown>;
  const known = new Set(spec.fields.map((f) => f.name));
  if (spec.entity === 'forms') known.add('jurisdiction');
  const unknown = Object.keys(given).filter((k) => !known.has(k));
  if (unknown.length) return { status: 400, code: 'unknown_field', message: `These fields are not part of a ${spec.entity} row: ${unknown.join(', ')}.` };
  const values: Record<string, unknown> = {};
  for (const f of spec.fields) {
    if (!Object.hasOwn(given, f.name)) continue;
    const v = given[f.name];
    const bad = (why: string): Refusal => ({ status: 400, code: 'invalid_field', message: `${f.name}: ${why}` });
    if (v === null) {
      if (!f.nullable) return bad('it cannot be empty.');
      values[fieldCol(f)] = null; continue;
    }
    switch (f.kind) {
      case 'text':
        if (typeof v !== 'string' || !v.trim() || v.length > (f.max ?? 200)) return bad(`text of 1 to ${f.max ?? 200} characters.`);
        values[f.name] = v.trim(); break;
      case 'enum':
        if (typeof v !== 'string' || !f.values!.includes(v)) return bad(`one of ${f.values!.join(', ')}.`);
        values[f.name] = v; break;
      case 'bool':
        if (v !== true && v !== false && v !== 0 && v !== 1) return bad('true or false.');
        values[f.name] = v === true || v === 1 ? 1 : 0; break;
      case 'int':
        if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 100000) return bad('a whole number from 0 to 100000.');
        values[f.name] = v; break;
      case 'cents':
        if (!Number.isSafeInteger(v) || (v as number) < 0) return bad('whole minor units (cents), 0 or more; null when not recorded.');
        values[f.name] = v; break;
      case 'currency':
        if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) return bad('three upper-case letters (ISO 4217).');
        values[f.name] = v; break;
      case 'day':
        if (!isPastDay(v)) return bad('a real day, YYYY-MM-DD, not in the future.');
        values[f.name] = v; break;
      case 'source':
        if (!Number.isSafeInteger(v) || (v as number) < 1) return bad('the id of a recorded source.');
        values[f.name] = v; break;
      case 'json': {
        const text = canonicalJson(v);
        if (text.length > 20000) return bad('at most 20000 characters of JSON.');
        values[fieldCol(f)] = text; break;
      }
    }
  }
  return { values };
}

/** The defaults of a new row, and the first required field it is missing, if any. */
export function newRowDefaults(spec: Spec, values: Record<string, unknown>): { row: Record<string, unknown> } | Refusal {
  const row: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const col = fieldCol(f);
    if (Object.hasOwn(values, col)) continue;
    if (f.required) return { status: 400, code: 'field_required', message: `A new ${spec.entity} row needs ${f.name}.` };
    row[col] = f.kind === 'json' ? (f.default == null ? null : canonicalJson(f.default)) : (f.default ?? null);
  }
  return { row };
}

/**
 * D4357 in the editor: a fact is `recorded` only with a value, a source and
 * the day it was checked; a fee line with an amount has a source and a day.
 */
export function sourcedRefusal(spec: Spec, row: Record<string, unknown>): Refusal | null {
  if (spec.entity === 'facts' && row.status === 'recorded' && (row.source_id == null || row.checked_on == null || row.value == null)) {
    return { status: 400, code: 'fact_unsourced', message: 'A fact is recorded only with a value, a source and the day it was checked. Nothing was saved.' };
  }
  if (spec.entity === 'fees' && row.amount_cents != null && (row.source_id == null || row.checked_on == null)) {
    return { status: 400, code: 'fee_unsourced', message: 'A fee amount needs a source and the day it was checked; leave the amount empty ("Not recorded") until then. Nothing was saved.' };
  }
  return null;
}

/** The bind values of the stored columns, in `spec.cols` order. */
export const colValues = (spec: Spec, row: Record<string, unknown>) => spec.cols.map((c) => (row[c] === undefined ? null : row[c]));

// ── restricted places (not versioned) ──

export type RestrictedPlace = {
  id: number; place: string; kind: string; note: string | null; checked_on: string; checked_by: number;
  source: { id: number; kind: string; title: string; url: string | null };
};
export const RESTRICTED_KINDS = Object.freeze(['sanctioned', 'not_served', 'counsel_only'] as const);
export const PLACE_RE = /^[A-Z]{2}(-[A-Z0-9]{1,9})?$/;

/** Every restricted place as stored now. Read on every call: nothing is cached, so a change shows on the next request. */
export async function restrictedPlaces(env: Env): Promise<RestrictedPlace[]> {
  const rows = (await env.DB.prepare(
    `SELECT r.id, r.place, r.kind, r.note, r.checked_on, r.checked_by, s.id AS source_id, s.kind AS source_kind, s.title AS source_title, s.url AS source_url
       FROM formation_restricted_jurisdictions r JOIN formation_sources s ON s.id = r.source_id
      ORDER BY r.place, r.kind`,
  ).all<any>()).results || [];
  return rows.map((r: any) => ({
    id: Number(r.id), place: String(r.place), kind: String(r.kind), note: r.note ?? null,
    checked_on: String(r.checked_on), checked_by: Number(r.checked_by),
    source: { id: Number(r.source_id), kind: String(r.source_kind), title: String(r.source_title), url: r.source_url ?? null },
  }));
}
