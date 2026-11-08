/**
 * #4531 (slice 1) — the deterministic assertions a golden case's output is
 * judged by, beyond "this phrase appears". Pure; `skillLifecycle.judge()`
 * calls these for the draft evaluation and the published one alike, so the
 * two paths cannot judge the same output differently.
 *
 * STATEMENTS. An output is cut into statements: lines, and within a line the
 * sentences or clauses ended by `.`, `!`, `?` or `;` followed by a space or the
 * end of the line. A decimal point (`0.20x`) never ends a statement. So a list
 * item, a table row (`| Runway | Not recorded |`), a `Field: value` line and a
 * sentence are each one statement. A field named on one line and its value on
 * the next is two, and is not supported.
 *
 * MISSING DATA (`must_say_not_recorded`, judge version 2). Each field must be
 * named in a statement that also says "Not recorded" (case-insensitive; that
 * exact phrase, which is what the run prompt tells the model to write). It
 * fails when:
 *   - no statement names the field together with "Not recorded" (an unrelated
 *     "Churn is Not recorded" does not cover runway);
 *   - another statement names the field with a figure and without "Not
 *     recorded" (it says the value is missing and also gives one).
 * Version 1 accepted the field anywhere plus "Not recorded" anywhere.
 *
 * NUMBERS (`numbers`, new and optional). Each assertion names a metric label,
 * a value, a unit and a tolerance. A statement supports it when the label is
 * followed by the number, with optionally `:`, `=`, `is`, `of`, `at`, `was`
 * or a table cell boundary (`|`) between, and the unit right after the number
 * (a space allowed). `DPI 0.20x`, `DPI: 0.2x`, `DPI = 0.20 x`, `DPI is 0.20x`
 * and `| DPI | 0.20x |` are the same figure. It fails when the metric is not
 * stated, a stated value is outside the tolerance or has another unit, or two
 * statements give the metric different values. A statement that is
 * conditional (`if`, `would`, `could`, `assume`, `suppose`, `hypothetical`)
 * neither supports nor contradicts it. Nothing else is treated as equivalent.
 */

export const JUDGE_VERSION = 2;
export const NOT_RECORDED_MARK = 'not recorded';
export const NUMBERS_MAX = 20;
export const UNIT_MAX = 12;

export type NumberAssertion = { metric: string; value: number; unit: string; tolerance: number };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The term as a whole word, case-insensitive. */
const word = (term: string) => new RegExp(`(?:^|[^a-z0-9])${esc(term.toLowerCase())}(?:$|[^a-z0-9])`);
const CONDITIONAL = /(?:^|[^a-z])(if|would|could|assume|assuming|suppose|hypothetical(?:ly)?)(?:$|[^a-z])/;
const FIGURE = /\d/;

/** The output as lower-case statements; see the header. */
export function statements(output: string): string[] {
  const out: string[] = [];
  for (const line of output.toLowerCase().split(/\r?\n/)) {
    for (const part of line.split(/(?<=[.!?;])(?=\s|$)/)) {
      // One space for every run, so no pattern below backtracks over a long run of whitespace.
      const s = part.replace(/\s+/g, ' ').trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Why `field` is not stated as missing, or null when it is. */
export function missingDataMiss(field: string, parts: readonly string[]): string | null {
  const f = word(field);
  const named = parts.filter((p) => f.test(p));
  const says = named.filter((p) => p.includes(NOT_RECORDED_MARK));
  if (!says.length) return `It did not say ${field} is not recorded.`;
  const invented = named.find((p) => !p.includes(NOT_RECORDED_MARK) && FIGURE.test(p) && !CONDITIONAL.test(p));
  if (invented) return `It said ${field} is not recorded and also gave it a value.`;
  return null;
}

/** A number assertion as a case must give it, or null. */
export function checkNumberAssertion(raw: unknown): NumberAssertion | null {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!b) return null;
  const metric = typeof b.metric === 'string' ? b.metric.replace(/\s+/g, ' ').trim() : '';
  if (!metric || metric.length > 80 || !/[a-z]/i.test(metric)) return null;
  if (typeof b.value !== 'number' || !Number.isFinite(b.value)) return null;
  if (typeof b.unit !== 'string' || b.unit.length > UNIT_MAX || /\s|\d/.test(b.unit)) return null;
  if (typeof b.tolerance !== 'number' || !Number.isFinite(b.tolerance) || b.tolerance < 0) return null;
  return { metric, value: b.value, unit: b.unit, tolerance: b.tolerance };
}

/**
 * Every value the statements give `metric`, skipping conditional statements:
 * the number, the unit written against it (`0.20x`) and the word after a space
 * (`0.20 x`, `37 paying`), which counts as the unit only when it is the unit
 * the assertion asks for.
 */
export function valuesOf(metric: string, parts: readonly string[]): Array<{ value: number; attached: string; spaced: string }> {
  const label = esc(metric.toLowerCase());
  const re = new RegExp(`(?:^|[^a-z0-9])${label}\\s*(?:\\|\\s*)?(?:[:=]|is|of|at|was)?\\s*(?:\\|\\s*)?(-?\\d[\\d,]*(?:\\.\\d+)?)([a-z%$€£]*)(?: ([a-z%$€£]+))?`, 'g');
  const out: Array<{ value: number; attached: string; spaced: string }> = [];
  for (const p of parts) {
    if (CONDITIONAL.test(p)) continue;
    for (const m of p.matchAll(re)) out.push({ value: Number(m[1].replace(/,/g, '')), attached: m[2] ?? '', spaced: m[3] ?? '' });
  }
  return out;
}

/** Why the output does not state `a`, or null when it does. */
export function numberMiss(a: NumberAssertion, parts: readonly string[]): string | null {
  const want = `${a.metric} ${a.value}${a.unit}`;
  const found = valuesOf(a.metric, parts);
  if (!found.length) return `It did not state ${want}.`;
  const unit = a.unit.toLowerCase();
  for (const f of found) {
    const got = f.attached || (unit && f.spaced === unit ? f.spaced : '');
    if (got !== unit) return `It gave ${a.metric} in "${got || 'no unit'}", not "${a.unit || 'no unit'}".`;
    if (Math.abs(f.value - a.value) > a.tolerance) return `It gave ${a.metric} as ${f.value}${got}, not ${a.value}${a.unit}.`;
  }
  return null;
}
