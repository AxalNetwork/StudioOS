/**
 * D5828 (#5828) — what a founder may map on a Typeform form, and whether one
 * mapped answer qualifies. Pure: no reads, no storage.
 *
 * A mapping names one field by Typeform's stable field id, the demand kind it
 * is evidence of, and the rule that makes an answer count:
 *   choice   (multiple_choice, dropdown, picture_choice)  `choices`: choice ids
 *   boolean  (yes_no, legal)                               `equals`: true/false
 *   number   (opinion_scale, rating, nps, number)          `min`: the lowest that counts
 *   text     (short_text, long_text)                       any non-empty answer
 * Identity-bearing types (email, phone_number, contact_info, address, website,
 * file_upload, signature, payment, calendly) and hidden fields can never be
 * mapped, so no answer of theirs is ever read.
 *
 * Stored text is the founder-selected field's answer only: the matched choice
 * labels, Yes/No, the number, or (only when `keep_text` is on) the free text,
 * bounded. Every other answer is never stored.
 */
import { DEMAND_KINDS } from '../validateWriters';
import { FIELD_ID, type FormField } from './api';

export const MAPPABLE_TYPES: Readonly<Record<string, 'choice' | 'boolean' | 'number' | 'text'>> = Object.freeze({
  multiple_choice: 'choice', dropdown: 'choice', picture_choice: 'choice',
  yes_no: 'boolean', legal: 'boolean',
  opinion_scale: 'number', rating: 'number', nps: 'number', number: 'number',
  short_text: 'text', long_text: 'text',
});
export const MAX_MAPPINGS = 10;
export const TEXT_LIMIT = 1000;
const LABEL_LIMIT = 500;

export interface MappingRule { choices?: string[]; equals?: boolean; min?: number }
export interface TypeformMapping { field_id: string; field_type: string; kind: string; rule: MappingRule; keep_text: boolean }

/** A mapping the importer accepts for this form's field, or null with nothing stored. */
export function typeformMapping(raw: unknown, fields: FormField[]): TypeformMapping | null {
  const m = raw as any;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const fieldId = typeof m.field_id === 'string' ? m.field_id.trim() : '';
  if (!FIELD_ID.test(fieldId)) return null;
  const field = fields.find((f) => f.id === fieldId);
  const shape = field ? MAPPABLE_TYPES[field.type] : undefined;
  if (!field || !shape) return null;
  const kind = String(m.kind ?? '');
  if (!(DEMAND_KINDS as readonly string[]).includes(kind)) return null;
  const keepText = m.keep_text === true;
  const rule: MappingRule = {};
  if (shape === 'choice') {
    const ids = Array.isArray(m.choices) ? [...new Set(m.choices.filter((c: unknown) => typeof c === 'string'))] as string[] : [];
    if (!ids.length || ids.length > 20 || !ids.every((id) => field.choices.some((c) => c.id === id))) return null;
    rule.choices = ids;
  } else if (shape === 'boolean') {
    if (typeof m.equals !== 'boolean') return null;
    rule.equals = m.equals;
  } else if (shape === 'number') {
    if (typeof m.min !== 'number' || !Number.isFinite(m.min)) return null;
    rule.min = m.min;
  }
  return { field_id: fieldId, field_type: field.type, kind, rule, keep_text: shape === 'text' ? keepText : false };
}

/** Whether one mapped answer counts, and the only text kept from it. Reads that one answer only. */
export function qualifyingAnswer(answer: any, mapping: { field_type: string; rule: MappingRule; keep_text: boolean }): { text: string | null } | null {
  if (!answer || typeof answer !== 'object') return null;
  const shape = MAPPABLE_TYPES[mapping.field_type];
  if (shape === 'choice') {
    const wanted = mapping.rule.choices ?? [];
    if (answer.type === 'choice') {
      const id = answer.choice?.id;
      return typeof id === 'string' && wanted.includes(id) ? { text: String(answer.choice?.label ?? '').slice(0, LABEL_LIMIT) || null } : null;
    }
    if (answer.type === 'choices') {
      const ids: unknown[] = Array.isArray(answer.choices?.ids) ? answer.choices.ids : [];
      const labels: unknown[] = Array.isArray(answer.choices?.labels) ? answer.choices.labels : [];
      const hits = ids.map((id, i) => (typeof id === 'string' && wanted.includes(id) ? String(labels[i] ?? '') : null)).filter((l): l is string => l !== null);
      return hits.length ? { text: hits.filter(Boolean).join(', ').slice(0, LABEL_LIMIT) || null } : null;
    }
    return null;
  }
  if (shape === 'boolean') {
    return answer.type === 'boolean' && answer.boolean === mapping.rule.equals ? { text: answer.boolean ? 'Yes' : 'No' } : null;
  }
  if (shape === 'number') {
    return answer.type === 'number' && typeof answer.number === 'number' && answer.number >= (mapping.rule.min ?? Infinity) ? { text: String(answer.number) } : null;
  }
  if (shape === 'text') {
    const t = answer.type === 'text' && typeof answer.text === 'string' ? answer.text.trim() : '';
    return t ? { text: mapping.keep_text ? t.slice(0, TEXT_LIMIT) : null } : null;
  }
  return null;
}
