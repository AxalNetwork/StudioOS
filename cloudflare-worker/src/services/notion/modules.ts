/**
 * D1086 (#2951, #2405 part 2) — the modules a founder's Notion may feed, what
 * each takes, and the field map's check.
 *
 * A choice's values are its store's own (`roadmap_okrs.kanban_status`,
 * `progress.ts` `MVP_STATUSES`, `contacts.ts` `RAISE_STAGES`, and the
 * Grow stores' lists); a test holds them to those sources.
 *
 * ONE ENTRY PER MODULE OF #2405's MODULE MAP. Each says its section, the
 * source kinds it takes, whether an item lands as a fact or waits as a
 * proposal (and which proposal kind), and the fields a database's properties
 * may map to, each with its type and, where the module's store has a closed
 * list, the values it accepts. Parts 3–6 add the writers that land items;
 * this file only says what may be mapped.
 *
 * THE FIELD MAP. `{ fields: { <field>: { property, values? } }, default_source? }`.
 * It is checked twice: here against the module (a field the module does not
 * have, a value outside its list, a required field left unmapped), and against
 * the database's own schema when a source is saved (a property the database
 * does not have is refused: `unknown_property`).
 */

export type Section = 'validate' | 'build' | 'raise' | 'grow';
export type SourceKind = 'page' | 'page_tree' | 'database';
/** `fact_link` (D1088, migration 644): a fact module's look-alike, "Link to [existing]?", never imported twice. */
export type ProposalKind = 'interview' | 'design_note' | 'prospect' | 'prospect_link' | 'data_room_snapshot' | 'fact_link';

export interface FieldDef {
  label: string;
  type: 'text' | 'date' | 'number' | 'choice';
  required?: boolean;
  /** For a `choice`: the store's closed list. A Notion value maps onto one of these. */
  values?: readonly string[];
}

export interface NotionModule {
  key: string;
  section: Section;
  label: string;
  kinds: readonly SourceKind[];
  lands: 'fact' | 'proposal';
  proposal?: ProposalKind;
  /** A database's fields; a page or page tree lands its title and link only. */
  fields: Readonly<Record<string, FieldDef>>;
  /** Product improvement's `source` when no column maps it. */
  defaultSources?: readonly string[];
}

const text = (label: string, required = false): FieldDef => ({ label, type: 'text', required });

export const NOTION_MODULES: Readonly<Record<string, NotionModule>> = Object.freeze({
  customer_research: { key: 'customer_research', section: 'validate', label: 'Customer research', kinds: ['page', 'page_tree', 'database'], lands: 'proposal', proposal: 'interview',
    fields: { date: { label: 'Date', type: 'date' }, interviewee: text('Interviewee'), role: text('Role'), company: text('Company') } },
  // D1087: a tree's page is never mapped; these name what From Notion draws for it (its title and link).
  market_intelligence: { key: 'market_intelligence', section: 'validate', label: 'Market intelligence', kinds: ['page_tree'], lands: 'fact', fields: { title: text('Title'), url: text('Link') } },
  product_roadmap: { key: 'product_roadmap', section: 'build', label: 'Product roadmap', kinds: ['database'], lands: 'fact',
    fields: { objective: text('Objective', true), key_result: text('Key result'), status: { label: 'Status', type: 'choice', values: ['now', 'next', 'later', 'done'] }, quarter: text('Quarter'), progress: { label: 'Progress', type: 'number' } } },
  prototype_mvp: { key: 'prototype_mvp', section: 'build', label: 'Prototype / MVP', kinds: ['database'], lands: 'fact',
    fields: { feature: text('Feature', true), added_value: { label: 'Added value', type: 'choice', values: ['High', 'Medium', 'Low'] },
      delivery_status: { label: 'Delivery status', type: 'choice', values: ['Backlog', 'In Progress', 'Review', 'Done', 'Blocked'] } } },
  solution_design: { key: 'solution_design', section: 'build', label: 'Solution design', kinds: ['page', 'page_tree'], lands: 'proposal', proposal: 'design_note', fields: {} },
  capital_relationships: { key: 'capital_relationships', section: 'raise', label: 'Capital relationships', kinds: ['database'], lands: 'proposal', proposal: 'prospect',
    fields: { name: text('Name', true), firm: text('Firm'), stage: { label: 'Stage', type: 'choice', values: ['to_contact', 'contacted', 'meeting', 'diligence', 'committed', 'passed'] },
      notes: text('Notes'), email: text('Email') } },
  data_room: { key: 'data_room', section: 'raise', label: 'Data room', kinds: ['page', 'page_tree'], lands: 'proposal', proposal: 'data_room_snapshot', fields: {} },
  distribution: { key: 'distribution', section: 'grow', label: 'Distribution', kinds: ['database'], lands: 'fact',
    fields: { title: text('Title', true), planned_on: { label: 'Planned on', type: 'date' },
      status: { label: 'Status', type: 'choice', values: ['idea', 'planned', 'scheduled', 'published', 'dropped'] }, channel: text('Channel') } },
  product_improvement: { key: 'product_improvement', section: 'grow', label: 'Product improvement', kinds: ['database'], lands: 'fact',
    fields: { body: text('Feedback', true), theme: text('Theme'), status: { label: 'Status', type: 'choice', values: ['open', 'planned', 'shipped'] },
      source: { label: 'Source', type: 'choice', values: ['customer', 'investor', 'team'] } },
    defaultSources: ['customer', 'investor', 'team'] },
} as Record<string, NotionModule>);

export const SECTIONS: readonly Section[] = Object.freeze(['validate', 'build', 'raise', 'grow']);
export const modulesOf = (section: Section) => Object.values(NOTION_MODULES).filter((m) => m.section === section).map((m) => m.key);

export interface FieldMap {
  fields: Record<string, { property: string; values?: Record<string, string> }>;
  default_source?: string | null;
}

/** A refused field map: a code the page words, and the field it names. Never a property's or a value's text. */
export class FieldMapError extends Error {
  code: string; field: string | null;
  constructor(code: string, field: string | null = null) { super(code); this.code = code; this.field = field; }
}

const MAX_NAME = 200;
const MAX_VALUES = 50;

/**
 * The field map, checked against the module: known fields only, a property
 * name for each, values only onto the field's list, every required field
 * mapped, and Product improvement's default source from its list. Returns the
 * clean map; anything else is refused, never dropped.
 */
export function cleanFieldMap(moduleKey: string, kind: SourceKind, raw: unknown): FieldMap | null {
  const mod = NOTION_MODULES[moduleKey];
  if (!mod) throw new FieldMapError('invalid_module');
  if (kind !== 'database') {
    if (raw != null && !(typeof raw === 'object' && Object.keys((raw as any).fields ?? {}).length === 0)) throw new FieldMapError('map_not_supported');
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FieldMapError('invalid_map');
  const src = raw as Record<string, unknown>;
  const fields = src.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new FieldMapError('invalid_map');
  const out: FieldMap = { fields: {} };
  for (const [field, m] of Object.entries(fields as Record<string, unknown>)) {
    const def = mod.fields[field];
    if (!def) throw new FieldMapError('unknown_field', field);
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new FieldMapError('invalid_map', field);
    const property = (m as any).property;
    if (typeof property !== 'string' || !property.trim() || property.length > MAX_NAME) throw new FieldMapError('invalid_property', field);
    const entry: { property: string; values?: Record<string, string> } = { property: property.trim() };
    const values = (m as any).values;
    if (values != null) {
      if (def.type !== 'choice' || typeof values !== 'object' || Array.isArray(values)) throw new FieldMapError('invalid_values', field);
      const pairs = Object.entries(values as Record<string, unknown>);
      if (pairs.length > MAX_VALUES) throw new FieldMapError('invalid_values', field);
      entry.values = {};
      for (const [from, to] of pairs) {
        if (typeof to !== 'string' || !def.values!.includes(to) || !from.trim() || from.length > MAX_NAME) throw new FieldMapError('invalid_value', field);
        entry.values[from.trim()] = to;
      }
    }
    out.fields[field] = entry;
  }
  for (const [field, def] of Object.entries(mod.fields)) if (def.required && !out.fields[field]) throw new FieldMapError('required_field', field);
  if (src.default_source != null) {
    if (!mod.defaultSources?.includes(String(src.default_source))) throw new FieldMapError('invalid_default_source');
    out.default_source = String(src.default_source);
  }
  return out;
}

/** Every mapped property must be one the database has: a map to a missing column is refused. */
export function checkAgainstSchema(map: FieldMap | null, properties: readonly string[]) {
  if (!map) return;
  const have = new Set(properties);
  for (const [field, m] of Object.entries(map.fields)) if (!have.has(m.property)) throw new FieldMapError('unknown_property', field);
}

export type Mapped = Record<string, string | number | boolean | null>;

/** A cell as the module will store it, or null with why it was skipped. Never a guessed value. */
function cell(def: FieldDef, value: unknown, values?: Record<string, string>): { ok: true; value: string | number | null } | { ok: false } {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return { ok: true, value: null };
  const s = Array.isArray(value) ? String(value[0]) : String(value);
  if (def.type === 'number') {
    const n = typeof value === 'number' ? value : Number(s.replace(/%$/, ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (def.type === 'date') {
    const m = /^(\d{4}-\d{2}(?:-\d{2})?)/.exec(s);
    return m ? { ok: true, value: m[1] } : { ok: false };
  }
  if (def.type === 'choice') {
    const v = values?.[s] ?? (def.values!.includes(s) ? s : null);
    return v ? { ok: true, value: v } : { ok: true, value: null };
  }
  return { ok: true, value: s.slice(0, 2000) };
}

/**
 * One database row, mapped. `skip` names why a row is not read: a required
 * field empty ("empty_required"), or a date or number that is not one
 * ("bad_value"), each with the field. A choice outside the map is left empty,
 * never forced onto a value.
 */
export function mapRow(moduleKey: string, map: FieldMap, properties: Record<string, unknown>):
  { values: Mapped; skip: null } | { values: null; skip: { reason: 'empty_required' | 'bad_value'; field: string } } {
  const mod = NOTION_MODULES[moduleKey];
  const values: Mapped = {};
  for (const [field, m] of Object.entries(map.fields)) {
    const def = mod.fields[field];
    const c = cell(def, properties[m.property], m.values);
    if (!c.ok) return { values: null, skip: { reason: 'bad_value', field } };
    if (def.required && c.value == null) return { values: null, skip: { reason: 'empty_required', field } };
    values[field] = c.value;
  }
  if (mod.defaultSources && values.source == null && map.default_source) values.source = map.default_source;
  return { values, skip: null };
}
