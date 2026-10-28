/**
 * D1326 (#3487, #2431 part 3) — the `form` handler's gather, prompt and parse
 * (D720 §7: "forms and uploads (D777)" are a bespoke handler).
 *
 * WHAT IT ASKS FOR. The blank fields of one form (FILL_FIELDS, D1325) that
 * Eadwyn is offered (`offeredToEadwyn`): never a measured field, never a
 * never-fill one, and never a field the member has typed into. With `rows`,
 * up to that many whole rows for an Add form instead.
 *
 * WHAT IT GATHERS. Only the venture's own records the fields restate (its
 * pain themes and unretired hypotheses, as D1325's module sources read them),
 * the titles already on the form's table (so a proposal does not repeat one),
 * and the member's own words. The gathered rows are the member's own store, so
 * the guard checks only the member's words (`guardText`, D763).
 *
 * WHAT THE PARSE KEEPS, per field, by the class FILL_FIELDS gives it:
 *   restatement   a value that matches one of the venture's own records, by
 *                 id; anything else is dropped (`unmatched`), never written
 *                 with a hedge (D46's match-back);
 *   sourced       only with a citation; none is dropped (`no_citation`);
 *   composition   prose, never aimed at a measured field (`measured`);
 * and refuses outright a field the never-fill registry names (`never_fill`).
 * A field the form does not have, or did not ask for, is dropped too. The
 * parse writes nothing: the route stores what it keeps as proposals.
 */
import type { Env } from '../../types';
import { offeredToEadwyn, type FillField } from './fields';
import { neverFillReason } from './neverFill';
import type { Citation } from './types';

/** The most rows one run may propose, and the most Accept all takes at once (#2431 question 3, A). */
export const MAX_RUN_ROWS = 10;
export const ACCEPT_ALL_MAX = 50;
const MAX_VALUE = 300;

export type DropReason = 'unknown_field' | 'not_asked' | 'never_fill' | 'measured' | 'no_citation' | 'unmatched' | 'invalid' | 'empty';
export interface KeptValue { field: string; value: string | number; citation: Citation | null }
export interface Dropped { field: string; why: DropReason; row?: number }
export interface ParsedFields { kept: KeptValue[]; dropped: Dropped[] }

/** What the form's records restate, by field: the ids a restatement may name, with their words. */
export type Choices = Map<string, Array<{ id: number; label: string }>>;

export interface FormGather {
  choices: Choices;
  /** Titles already on the form's table for this venture, newest first, at most 40. */
  existing: string[];
  /** D1329: what a record that is not a venture's says about itself (titles, names), never a figure. */
  context?: string[];
}

/**
 * Effort as the Add feature writer stores it (`cycle_build.ts` EFFORT_IN: Low,
 * Medium and High write S, M and L), so a kept proposal equals what the Save
 * writes and `POST /api/fills/record` can tell it was kept.
 */
const EFFORT_WORDS: Readonly<Record<string, string>> = Object.freeze({ low: 'S', medium: 'M', high: 'L', s: 'S', m: 'M', l: 'L', xl: 'XL' });

/**
 * The fields one run asks Eadwyn for: offered, and blank in what the member
 * sees now (`values`, the form's own state) and in the record when there is one.
 */
export function fieldsToAsk(fields: readonly FillField[], values: Record<string, unknown> = {}, row: Record<string, unknown> | null = null): FillField[] {
  const blank = (v: unknown) => v == null || String(v).trim() === '';
  return fields.filter((f) => offeredToEadwyn(f) && blank(values[f.field]) && (!row || blank(row[f.column])));
}

/**
 * What is already on each form's table for this venture, newest first, so a
 * proposed row does not repeat one. One literal statement per table (D1328
 * adds Validate's themes, segments and hypotheses).
 */
export const EXISTING_READS: Readonly<Record<string, string>> = Object.freeze({
  mvp_features: 'SELECT title AS value FROM mvp_features WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  pain_groups: 'SELECT title AS value FROM pain_groups WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  customer_segments: 'SELECT name AS value FROM customer_segments WHERE project_id = ? AND archived_at IS NULL ORDER BY id DESC LIMIT 40',
  hypotheses: 'SELECT claim AS value FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY id DESC LIMIT 40',
});

/** The venture's own records the form's restatement fields pick from. Literal statements only. */
export async function gatherForm(env: Env, projectId: number, fields: readonly FillField[]): Promise<FormGather> {
  const choices: Choices = new Map();
  for (const f of fields) {
    if (f.sources.includes('module:validate/problem-discovery')) {
      const rows = ((await env.DB.prepare('SELECT id, title FROM pain_groups WHERE project_id = ? ORDER BY sort_order, id LIMIT 200')
        .bind(projectId).all<{ id: number; title: string }>()).results) || [];
      choices.set(f.field, rows.map((r) => ({ id: Number(r.id), label: String(r.title) })));
    }
    if (f.sources.includes('module:validate/experiments')) {
      const rows = ((await env.DB.prepare('SELECT id, code, claim FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY sort_order, id LIMIT 200')
        .bind(projectId).all<{ id: number; code: string; claim: string }>()).results) || [];
      choices.set(f.field, rows.map((r) => ({ id: Number(r.id), label: `${r.code}: ${r.claim}` })));
    }
  }
  const table = fields[0]?.table;
  const read = table ? EXISTING_READS[table] : undefined;
  const existing = read
    ? (((await env.DB.prepare(read).bind(projectId).all<{ value: string }>()).results) || []).map((r) => String(r.value))
    : [];
  return { choices, existing };
}

/**
 * D1329 (#3490): what Eadwyn reads for a record that is not a venture's, by
 * its table, all literal statements on rows the route has already scoped:
 * the record's own title and kind, the advisor's own recorded outcomes and
 * services, the event's sessions. Never an amount, a term, a vote or a decision.
 */
export async function gatherScoped(env: Env, userId: number, table: string, row: Record<string, unknown> | null, parentId: number | null = null): Promise<FormGather> {
  const out: FormGather = { choices: new Map(), existing: [], context: [] };
  const list = async (sql: string, ...binds: unknown[]) => ((((await env.DB.prepare(sql).bind(...binds).all<{ value: string }>()).results) || []).map((r) => String(r.value)));
  if (table === 'advisor_services') {
    out.context = (await list(`SELECT p.title AS value FROM advisor_proof_items p JOIN advisors a ON a.id = p.advisor_id
      WHERE a.user_id = ? AND p.kind = 'outcome' ORDER BY p.id DESC LIMIT 20`, userId)).map((t) => `Recorded outcome: ${t}`);
    out.existing = await list('SELECT s.title AS value FROM advisor_services s JOIN advisors a ON a.id = s.advisor_id WHERE a.user_id = ? ORDER BY s.id DESC LIMIT 40', userId);
  } else if (table === 'ic_decisions' && row) {
    const name = await env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL').bind(row.project_id ?? null).first<{ name: string }>();
    out.context = [`Decision: ${String(row.title ?? 'title not recorded')}`, `Company: ${name?.name ?? 'not recorded'}`];
  } else if (table === 'events' && row) {
    out.context = [`Event: ${String(row.title ?? 'title not recorded')}`, `Kind: ${String(row.type ?? 'not recorded')}`];
  } else if (table === 'event_agenda_items') {
    const eventId = row ? row.event_id : parentId;
    out.existing = await list('SELECT title AS value FROM event_agenda_items WHERE event_id = ? ORDER BY display_order, id LIMIT 40', eventId ?? null);
    const ev = await env.DB.prepare('SELECT title FROM events WHERE id = ?').bind(eventId ?? null).first<{ title: string }>();
    out.context = ev ? [`Event: ${ev.title}`] : [];
  } else if (table === 'admin_publications' && row) {
    out.context = [`Publication: ${String(row.title ?? 'title not recorded')}`, `Section: ${String(row.section ?? 'not recorded')}`];
  }
  return out;
}

const SYSTEM = [
  'You fill blank fields of one form for a founder, as JSON only.',
  'Answer with {"fields":[{"field":"<name>","value":<value>}]} for one record, or {"rows":[{"<name>":<value>,…}]} when rows are asked for.',
  'Only use the fields listed. For a field with choices, answer one choice\'s id as a number, or leave the field out.',
  'Never invent a figure. If you cannot fill a field from what is given, leave it out.',
].join(' ');

/** The run's messages, and the member's own words for the guard (`guardText`). */
export function formMessages(asked: readonly FillField[], gather: FormGather, opts: { text?: string; rows?: number } = {}) {
  const lines = asked.map((f) => {
    const choice = gather.choices.get(f.field);
    const effort = f.field === 'effort' ? ' (one of Low, Medium, High)' : '';
    return choice
      ? `- ${f.field} ("${f.label}"): choose by id from ${JSON.stringify(choice.map((c) => ({ id: c.id, label: c.label })))}`
      : `- ${f.field} ("${f.label}")${effort}`;
  });
  const words = String(opts.text ?? '').trim().slice(0, 4000);
  const user = [
    opts.rows ? `Propose up to ${opts.rows} new rows.` : 'Fill these fields for one record.',
    'Fields:', ...lines,
    gather.existing.length ? `Already on file, do not repeat: ${JSON.stringify(gather.existing)}` : '',
    gather.context?.length ? `On record: ${JSON.stringify(gather.context)}` : '',
    words ? `The founder's notes: ${words}` : '',
  ].filter(Boolean).join('\n');
  return {
    messages: [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: user }],
    guardText: words,
  };
}

/** The model's JSON, with or without a code fence; null when it is not an object. */
export function readJson(output: string | undefined): Record<string, unknown> | null {
  const raw = String(output ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { const v = JSON.parse(raw.slice(start, end + 1)); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

function citationOf(v: unknown): Citation | null {
  const c = v as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || typeof c.quote !== 'string' || !c.quote.trim()) return null;
  if (c.kind === 'library' && Number.isSafeInteger(c.document_id) && typeof c.title === 'string') {
    return { kind: 'library', document_id: Number(c.document_id), title: c.title, chunk: Number(c.chunk) || 0, quote: c.quote };
  }
  if (c.kind === 'research' && typeof c.source === 'string' && typeof c.query === 'string') {
    return { kind: 'research', task: String(c.task ?? ''), query: c.query, source: c.source, quote: c.quote };
  }
  return null;
}

/** One proposed value against its field's rules: the value kept, or why it is dropped. */
export function checkValue(f: FillField | undefined, name: string, value: unknown, citation: unknown, asked: ReadonlySet<string>, gather: FormGather): KeptValue | Dropped {
  // A never-fill name is refused as such even when the form does not have it, so the refusal is said, not hidden.
  if (neverFillReason(name) || (f && neverFillReason(`${f.table}.${f.column}`))) return { field: name, why: 'never_fill' };
  if (!f) return { field: name, why: 'unknown_field' };
  if (f.class === 'measured') return { field: name, why: 'measured' };
  if (!asked.has(f.field)) return { field: name, why: 'not_asked' };
  if (value == null || String(value).trim() === '') return { field: name, why: 'empty' };
  if (f.class === 'restatement') {
    const id = Number(value);
    const known = gather.choices.get(f.field) ?? [];
    return Number.isSafeInteger(id) && known.some((c) => c.id === id) ? { field: f.field, value: id, citation: null } : { field: name, why: 'unmatched' };
  }
  if (f.class === 'sourced') {
    const cite = citationOf(citation);
    if (!cite) return { field: name, why: 'no_citation' };
    return { field: f.field, value: String(value).trim().slice(0, MAX_VALUE), citation: cite };
  }
  if (f.field === 'effort') {
    const word = EFFORT_WORDS[String(value).trim().toLowerCase()];
    return word ? { field: f.field, value: word, citation: null } : { field: name, why: 'invalid' };
  }
  if (typeof value !== 'string' && typeof value !== 'number') return { field: name, why: 'invalid' };
  return { field: f.field, value: String(value).trim().slice(0, MAX_VALUE), citation: null };
}

const isKept = (x: KeptValue | Dropped): x is KeptValue => 'value' in x;

/** `{"fields":[…]}` for one record: one kept value per field at most. */
export function parseFields(output: string | undefined, fields: readonly FillField[], asked: readonly FillField[], gather: FormGather): ParsedFields {
  const json = readJson(output);
  const list = Array.isArray(json?.fields) ? json!.fields as unknown[] : [];
  const byName = new Map(fields.map((f) => [f.field, f]));
  const askedSet = new Set(asked.map((f) => f.field));
  const kept: KeptValue[] = [];
  const dropped: Dropped[] = [];
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>;
    const name = typeof o.field === 'string' ? o.field : '';
    const r = checkValue(byName.get(name), name, o.value, o.citation, askedSet, gather);
    if (isKept(r)) { if (!kept.some((k) => k.field === r.field)) kept.push(r); } else dropped.push(r);
  }
  return { kept, dropped };
}

/** `{"rows":[…]}` for an Add form: each row's fields checked alone; a row needs a value for every field the form requires. */
export function parseRows(output: string | undefined, fields: readonly FillField[], asked: readonly FillField[], gather: FormGather, max: number, required: readonly string[] = []) {
  const json = readJson(output);
  const list = (Array.isArray(json?.rows) ? json!.rows as unknown[] : []).slice(0, Math.max(0, Math.min(max, MAX_RUN_ROWS)));
  const byName = new Map(fields.map((f) => [f.field, f]));
  const askedSet = new Set(asked.map((f) => f.field));
  const rows: Array<Record<string, string | number>> = [];
  const dropped: Dropped[] = [];
  list.forEach((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const row: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(o)) {
      const r = checkValue(byName.get(name), name, value, null, askedSet, gather);
      if (isKept(r)) row[r.field] = r.value; else dropped.push({ ...r, row: i });
    }
    if (required.every((k) => row[k] != null) && Object.keys(row).length) rows.push(row);
    else dropped.push({ field: required.find((k) => row[k] == null) ?? '', why: 'empty', row: i });
  });
  return { rows, dropped };
}
