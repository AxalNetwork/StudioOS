/**
 * D757 §2.6 (#1923) — the interview findings no Validate module table holds,
 * and the rules every one of them is read by: its payload, its dedupe key and
 * the module it belongs to. Pure, so the structure step
 * (`interviewStructuring.ts`'s PLACEMENT_KINDS), the MCP tool and the writer
 * (`validateWriters.ts`'s `writeInterviewFinding`) validate a payload by one
 * function, and an edited suggestion is held to the model's own rule.
 *
 * The store is `interview_findings` (migration 489): one row per interview,
 * kind and key, so a retried accept is the same row. `presentTables` is the one
 * reader here: the privacy statements (§2.13) run only where their table is.
 */
import type { Env } from '../types';
import type { ModuleSlug } from './cycleValidate';

export const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t && t.length <= max ? t : null;
};
export const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => {
  const t = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  return (values as readonly string[]).includes(t) ? (t as T) : null;
};
export const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
/** A key's text: lower case, one space, at most 120 characters. */
export const norm = (v: unknown): string => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);

export const PERIODS = ['once', 'month', 'year'] as const;
/** The largest amount a finding names, in cents: $1bn. A larger one is not a reading of an interview. */
export const MAX_AMOUNT_CENTS = 100_000_000_000;

/**
 * An optional amount: `{ amount_cents, currency, period }`, or `{}` when none
 * is named. Null when one is named and is not a positive whole number of
 * cents, a three-letter currency or a known period: the placement is refused,
 * never stored with half an amount.
 */
export function parseAmount(p: Record<string, unknown>): Record<string, unknown> | null {
  if (p.amount_cents == null) return p.currency == null && p.period == null ? {} : null;
  const amount = posInt(p.amount_cents);
  if (!amount || amount > MAX_AMOUNT_CENTS) return null;
  const currency = p.currency == null ? 'usd' : typeof p.currency === 'string' ? p.currency.trim().toLowerCase() : '';
  if (!/^[a-z]{3}$/.test(currency)) return null;
  const period = p.period == null ? null : oneOf(p.period, PERIODS);
  if (p.period != null && !period) return null;
  return { amount_cents: amount, currency, ...(period ? { period } : {}) };
}

export const FIRMOGRAPHIC_ATTRIBUTES = ['role', 'company', 'company_size', 'industry', 'geography', 'stage', 'tools'] as const;
/** Role and company are the interview record's own fields (`updateInterviewDetails`); the rest are findings. */
export const INTERVIEW_FIELDS = ['role', 'company'] as const;
export const ALTERNATIVE_KINDS = ['workaround', 'status_quo', 'in_house'] as const;
export const MARKET_TOPICS = ['size', 'trend', 'regulation', 'pricing', 'other'] as const;
export const URGENCY_LEVELS = ['low', 'medium', 'high'] as const;
export const OBJECTION_ABOUT = ['price', 'risk', 'fit', 'timing', 'trust', 'other'] as const;

export type FindingKind =
  | 'firmographic' | 'job_to_be_done' | 'market_fact' | 'alternative'
  | 'budget' | 'timing' | 'urgency' | 'buying_trigger' | 'objection';

/** The modules `interview_findings.module` admits (its CHECK). */
export type FindingModule = Extract<ModuleSlug, 'customer-research' | 'ideal-customer-profile' | 'market-intelligence' | 'demand-signals' | 'experiments'>;

export interface FindingSpec {
  /** The finding's MCP module string (`assistantInterviews.ts`), kept as each kind's own. */
  mcpModule: string;
  /** The Validate module it lands in, by payload where a kind spans two. */
  slug(p: Record<string, unknown>): FindingModule;
  /** Normalise the payload, or null to refuse it. */
  parse(p: Record<string, unknown>): Record<string, unknown> | null;
  /** The dedupe key: two placements with one key are one finding, and one row. */
  key(p: Record<string, unknown>): string;
}

const single = (kind: string) => () => kind;

export const FINDING_KINDS: Record<FindingKind, FindingSpec> = {
  firmographic: {
    mcpModule: 'ideal_customer_profile',
    slug: (p) => ((INTERVIEW_FIELDS as readonly string[]).includes(String(p.attribute)) ? 'customer-research' : 'ideal-customer-profile'),
    parse: (p) => {
      const attribute = oneOf(p.attribute, FIRMOGRAPHIC_ATTRIBUTES);
      const value = str(p.value, 120);
      return attribute && value ? { attribute, value } : null;
    },
    // One role, company, size, industry, geography and stage per interview; tools are many.
    key: (p) => (p.attribute === 'tools' ? `firmographic:tools:${norm(p.value)}` : `firmographic:${p.attribute}`),
  },
  job_to_be_done: {
    mcpModule: 'ideal_customer_profile',
    slug: () => 'ideal-customer-profile',
    parse: (p) => {
      const job = str(p.job, 200);
      return job ? { job } : null;
    },
    key: (p) => `job:${norm(p.job)}`,
  },
  market_fact: {
    mcpModule: 'market_intelligence',
    slug: () => 'market-intelligence',
    // D757 gives it a topic and a store. `source` stays readable for the
    // proposals made before it, and is no longer required.
    parse: (p) => {
      const fact = str(p.fact, 300);
      if (!fact) return null;
      const topic = p.topic == null ? 'other' : oneOf(p.topic, MARKET_TOPICS);
      if (!topic) return null;
      const source = p.source == null ? null : str(p.source, 200);
      if (p.source != null && !source) return null;
      return { fact, topic, ...(source ? { source } : {}) };
    },
    key: (p) => `fact:${norm(p.fact)}`,
  },
  alternative: {
    mcpModule: 'market_intelligence',
    slug: () => 'market-intelligence',
    parse: (p) => {
      const name = str(p.name, 120);
      const kind = oneOf(p.kind, ALTERNATIVE_KINDS);
      return name && kind ? { name, kind } : null;
    },
    key: (p) => `alternative:${norm(p.name)}`,
  },
  budget: {
    mcpModule: 'demand_signals',
    slug: () => 'demand-signals',
    parse: (p) => {
      const detail = str(p.detail, 200);
      const amount = parseAmount(p);
      return detail && amount ? { detail, ...amount } : null;
    },
    key: single('budget'),
  },
  timing: {
    mcpModule: 'demand_signals',
    slug: () => 'demand-signals',
    parse: (p) => {
      const when = str(p.when, 120);
      return when ? { when } : null;
    },
    key: single('timing'),
  },
  urgency: {
    mcpModule: 'demand_signals',
    slug: () => 'demand-signals',
    parse: (p) => {
      const level = oneOf(p.level, URGENCY_LEVELS);
      const reason = p.reason == null ? null : str(p.reason, 200);
      if (!level || (p.reason != null && !reason)) return null;
      return { level, ...(reason ? { reason } : {}) };
    },
    key: single('urgency'),
  },
  buying_trigger: {
    mcpModule: 'demand_signals',
    slug: () => 'demand-signals',
    parse: (p) => {
      const trigger = str(p.trigger, 200);
      return trigger ? { trigger } : null;
    },
    key: (p) => `trigger:${norm(p.trigger)}`,
  },
  objection: {
    mcpModule: 'demand_signals',
    slug: () => 'demand-signals',
    parse: (p) => {
      const about = oneOf(p.about, OBJECTION_ABOUT);
      const detail = str(p.detail, 200);
      return about && detail ? { about, detail } : null;
    },
    key: (p) => `objection:${p.about}:${norm(p.detail)}`,
  },
};

export function isFindingKind(k: unknown): k is FindingKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(FINDING_KINDS, k);
}

const ATTRIBUTE_WORD: Record<string, string> = {
  role: 'Role', company: 'Company', company_size: 'Company size', industry: 'Industry', geography: 'Geography', stage: 'Stage', tools: 'Tools',
};
const KIND_WORD: Record<string, string> = { workaround: 'Workaround', status_quo: 'Status quo', in_house: 'Built in-house' };
const capital = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1).replace(/_/g, ' ')}` : s);
/** "1,200 USD / month", or null when the finding names no amount. */
export function amountWord(p: Record<string, unknown>): string | null {
  const cents = posInt(p.amount_cents);
  if (!cents) return null;
  const period = p.period === 'month' ? ' / month' : p.period === 'year' ? ' / year' : '';
  return `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${String(p.currency || 'usd').toUpperCase()}${period}`;
}

/**
 * D757 (#1925) — a finding in one line, as a module record lists it: what it
 * is and what was said, from its stored payload. The quote is never part of
 * it: the record draws that behind its own gate.
 */
export function findingLine(kind: FindingKind, p: Record<string, unknown>): { what: string; detail: string } {
  switch (kind) {
    case 'firmographic': return { what: ATTRIBUTE_WORD[String(p.attribute)] ?? 'Firmographic', detail: String(p.value ?? '') };
    case 'job_to_be_done': return { what: 'Job to be done', detail: String(p.job ?? '') };
    case 'market_fact': return { what: `Market fact · ${capital(String(p.topic ?? 'other'))}`, detail: String(p.fact ?? '') };
    case 'alternative': return { what: `Alternative · ${KIND_WORD[String(p.kind)] ?? 'Other'}`, detail: String(p.name ?? '') };
    case 'budget': return { what: 'Budget', detail: [p.detail, amountWord(p)].filter(Boolean).join(' · ') };
    case 'timing': return { what: 'Timing', detail: String(p.when ?? '') };
    case 'urgency': return { what: `Urgency · ${capital(String(p.level ?? ''))}`, detail: String(p.reason ?? '') };
    case 'buying_trigger': return { what: 'Buying trigger', detail: String(p.trigger ?? '') };
    case 'objection': return { what: `Objection · ${capital(String(p.about ?? 'other'))}`, detail: String(p.detail ?? '') };
  }
}

/**
 * Which of these tables the database has. The privacy statements that clear or
 * delete findings and evidence links run in the same batch as the session's or
 * interview's own deletes, and a batch fails whole on a missing table, so a
 * database that has not reached migration 489 skips them rather than refusing
 * the delete.
 */
export async function presentTables(env: Env, names: readonly string[]): Promise<Set<string>> {
  if (!names.length) return new Set();
  const res = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names.map(() => '?').join(', ')})`,
  ).bind(...names).all<{ name: string }>();
  return new Set((res.results ?? []).map((r) => r.name));
}
