/**
 * The founder's Team roster, coverage and headcount plan (D435, migration 326).
 *
 * Vocabulary and validation for the three stores, kept out of the route so a
 * test can run the rules without a router, and so the page and the worker
 * agree on the words. Every enumerated field has a closed list here and the
 * route refuses anything outside it: a roster row is a record about a real
 * person, and a free-text "type" that says "kinda employee" is not a fact.
 *
 * ECONOMICS FOLLOW D431. `salary_cents` and `compensation_note` are served
 * to an editor of the company and to the person the row is linked to, and to
 * nobody else: the field is ABSENT for a refused reader, never null, because
 * null means "not recorded" and a reader must not confuse "withheld" with
 * "none". The page draws a locked section for the absent field (canvas T4's
 * rule: a hidden one teaches people the wrong shape of the org).
 *
 * NOTHING HERE ISSUES PAPERWORK. The canvas's invite drawer says "issues the
 * right paperwork for their type"; this store records what state the
 * paperwork is in, and the page says that issuing it is an owner decision.
 */

export const PERSON_TYPES = ['founder', 'employee', 'contractor', 'advisor'] as const;
export type PersonType = (typeof PERSON_TYPES)[number];

export const PERSON_STATUSES = ['active', 'offer_out', 'offboarded'] as const;
export const ACCESS_LEVELS = ['owner', 'member', 'limited', 'pending', 'none'] as const;
export const EQUITY_KINDS = ['common', 'options', 'advisory', 'none'] as const;
export const AGREEMENT_STATES = ['signed', 'sent', 'pending', 'missing'] as const;
export const IP_STATES = ['signed', 'pending', 'missing', 'not_applicable'] as const;
export const ELECTION_83B_STATES = ['filed', 'not_filed', 'not_applicable'] as const;
export const COVERAGE_STATES = ['covered', 'thin', 'gap'] as const;

const ENUMS: Record<string, readonly string[]> = {
  person_type: PERSON_TYPES,
  status: PERSON_STATUSES,
  access_level: ACCESS_LEVELS,
  equity_kind: EQUITY_KINDS,
  agreement_status: AGREEMENT_STATES,
  ip_assignment: IP_STATES,
  election_83b: ELECTION_83B_STATES,
};

const TEXT_FIELDS: Record<string, number> = {
  name: 200, email: 254, role_title: 120, compensation_note: 500,
  advisor_focus: 200, advisor_cadence: 120, note: 2000,
};
const DATE_FIELDS = ['start_date', 'vest_start_date'] as const;
const INT_FIELDS: Record<string, [number, number]> = {
  salary_cents: [0, 100_000_000_000],
  cliff_months: [0, 120],
  vest_months: [0, 240],
};

/** A calendar date, YYYY-MM-DD, that the calendar accepts. */
export function isCalendarDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type PersonPatch = Record<string, string | number | null>;

/**
 * Validate a person body. `create` requires a name and a type; a patch may
 * carry any subset. Returns the cleaned columns or the first refusal.
 */
export function validatePerson(raw: unknown, create: boolean): { value?: PersonPatch; error?: string } {
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: PersonPatch = {};

  for (const [f, max] of Object.entries(TEXT_FIELDS)) {
    if (body[f] === undefined) continue;
    if (body[f] === null || body[f] === '') { out[f] = null; continue; }
    if (typeof body[f] !== 'string') return { error: `${f} must be text` };
    const v = (body[f] as string).trim();
    if (v.length > max) return { error: `${f} is longer than ${max} characters` };
    out[f] = v || null;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(out.email))) return { error: 'email must be an email address' };
  if (out.email) out.email = String(out.email).toLowerCase();

  for (const [f, list] of Object.entries(ENUMS)) {
    if (body[f] === undefined) continue;
    if (body[f] === null || body[f] === '') {
      if (f === 'person_type' || f === 'status') return { error: `${f} cannot be cleared` };
      out[f] = null; continue;
    }
    if (typeof body[f] !== 'string' || !list.includes(body[f] as string)) {
      return { error: `${f} must be one of ${list.join(', ')}` };
    }
    out[f] = body[f] as string;
  }

  for (const f of DATE_FIELDS) {
    if (body[f] === undefined) continue;
    if (body[f] === null || body[f] === '') { out[f] = null; continue; }
    if (!isCalendarDate(body[f])) return { error: `${f} must be a calendar date, YYYY-MM-DD` };
    out[f] = body[f] as string;
  }

  for (const [f, [lo, hi]] of Object.entries(INT_FIELDS)) {
    if (body[f] === undefined) continue;
    if (body[f] === null || body[f] === '') { out[f] = null; continue; }
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n < lo || n > hi) return { error: `${f} must be a whole number between ${lo} and ${hi}` };
    out[f] = n;
  }

  if (body.equity_shares !== undefined) {
    if (body.equity_shares === null || body.equity_shares === '') out.equity_shares = null;
    else {
      const n = Number(body.equity_shares);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return { error: 'equity_shares must be a non-negative number of shares' };
      out.equity_shares = n;
    }
  }

  if (create) {
    if (!out.name) return { error: 'name is required' };
    if (!out.person_type) return { error: `person_type is required: ${PERSON_TYPES.join(', ')}` };
    if (!out.status) out.status = 'active';
  }
  return { value: out };
}

export type CoverageRow = { function_name: string; state: string; owner_note: string | null; fix_note: string | null };

/** The coverage list a PUT replaces: every row validated, names unique. */
export function validateCoverage(raw: unknown): { value?: CoverageRow[]; error?: string } {
  const rows = Array.isArray(raw) ? raw : (raw as any)?.rows;
  if (!Array.isArray(rows)) return { error: 'rows must be a list' };
  if (rows.length > 40) return { error: 'at most 40 functions' };
  const out: CoverageRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = typeof r?.function_name === 'string' ? r.function_name.trim() : '';
    if (!name || name.length > 80) return { error: 'each row needs a function_name of at most 80 characters' };
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `function ${name} is listed twice` };
    seen.add(key);
    if (!COVERAGE_STATES.includes(r?.state)) return { error: `state must be one of ${COVERAGE_STATES.join(', ')}` };
    const owner = typeof r?.owner_note === 'string' ? r.owner_note.trim().slice(0, 300) : '';
    const fix = typeof r?.fix_note === 'string' ? r.fix_note.trim().slice(0, 300) : '';
    out.push({ function_name: name, state: r.state, owner_note: owner || null, fix_note: fix || null });
  }
  return { value: out };
}

export type PlanRow = { period_label: string; target_headcount: number; note: string | null };

/** The headcount plan a PUT replaces. */
export function validatePlan(raw: unknown): { value?: PlanRow[]; error?: string } {
  const rows = Array.isArray(raw) ? raw : (raw as any)?.rows;
  if (!Array.isArray(rows)) return { error: 'rows must be a list' };
  if (rows.length > 24) return { error: 'at most 24 periods' };
  const out: PlanRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const label = typeof r?.period_label === 'string' ? r.period_label.trim() : '';
    if (!label || label.length > 60) return { error: 'each row needs a period_label of at most 60 characters' };
    const key = label.toLowerCase();
    if (seen.has(key)) return { error: `period ${label} is listed twice` };
    seen.add(key);
    const n = Number(r?.target_headcount);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) return { error: 'target_headcount must be a whole number' };
    const note = typeof r?.note === 'string' ? r.note.trim().slice(0, 300) : '';
    out.push({ period_label: label, target_headcount: n, note: note || null });
  }
  return { value: out };
}

/**
 * The row as the page reads it. `economics` decides whether the two
 * compensation fields are present at all (D431).
 */
export function personDto(row: Record<string, any>, economics: boolean): Record<string, any> {
  const { salary_cents, compensation_note, created_by, updated_by, ...rest } = row;
  const out: Record<string, any> = {
    ...rest,
    equity_shares: row.equity_shares == null ? null : Number(row.equity_shares),
    created_by: created_by ?? null,
    updated_by: updated_by ?? null,
  };
  if (economics) {
    out.salary_cents = salary_cents == null ? null : Number(salary_cents);
    out.compensation_note = compensation_note ?? null;
  }
  return out;
}
