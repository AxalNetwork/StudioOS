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
 *
 * SLICE 2 (judge version 3, D4531 "Slice 2"). Five more optional assertions,
 * each with its checker (`check…`, used by `checkCase`) and its evaluator
 * (`…Miss`, used by `judge`). A case without them is judged exactly as under
 * version 2. Their accepted forms are listed above each evaluator below.
 *   structure      required sections (headings) and, optionally, their order
 *                  and a list or a table in the output
 *   evidence       the records the output must cite, as `[read.key]` or
 *                  `[source: read.key.path]`; a citation of anything the
 *                  case's records do not hold fails
 *   refusal        ask for a missing input, decline an unsupported conclusion,
 *                  say Not recorded, or (`none`) do not refuse
 *   claims         required and forbidden claims, each a subject and an
 *                  object in one statement, in that order, not negated;
 *                  version 4 (D4531 part 4) adds a claim's reason (`because`)
 *                  and a claim that must stay conditional (`conditional`)
 *   output_schema  the output is one JSON value that meets a small, closed
 *                  subset of JSON Schema
 */

export const JUDGE_VERSION = 4;
/**
 * The optional assertion keys of a case's `expect`, in the order `judge()`
 * evaluates them. `skillCatalogue.ts` counts them as evaluated, and the HQ case
 * editor keeps them on save; exported for #4533's release-evidence manifest.
 */
export const ASSERTION_KEYS = ['numbers', 'output_schema', 'structure', 'evidence', 'refusal', 'claims'] as const;
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

// ── Slice 2 (judge version 3) ───────────────────────────────────────────────
//
// Every checker returns the assertion as it is kept, or the exact problem; a
// key the assertion does not define is a problem, so a misspelt field is never
// silently ignored. Every evaluator returns why the output misses, or null.
// No miss quotes the output: a result's detail is stored, outputs are not.

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };
const fine = <T>(value: T): Checked<T> => ({ ok: true, value });
const wrong = <T>(message: string): Checked<T> => ({ ok: false, message });
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const onlyKeys = (b: Record<string, unknown>, keys: readonly string[]) => Object.keys(b).every((k) => keys.includes(k));
const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
/** A short label: a string with a letter, whitespace collapsed, up to `max` characters. */
const labelOf = (v: unknown, max = 80): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.length <= max && /[a-z]/i.test(t) ? t : null;
};
/** A statement with curly apostrophes straightened and "can't" / "can not" read as "cannot". */
const plain = (p: string) => p.replace(/[’‘]/g, "'").replace(/(?:^|(?<=[^a-z]))can(?:'t| not)(?=$|[^a-z])/g, 'cannot');
/** Where `term` first occurs as a whole word in `p` at or after `from`. */
function wordAt(term: string, p: string, from = 0): { start: number; end: number } | null {
  const t = plain(term.toLowerCase());
  if (!t) return null;
  const inWord = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);
  for (let i = p.indexOf(t, Math.max(0, from)); i !== -1; i = p.indexOf(t, i + 1)) {
    if (!inWord(p[i - 1]) && !inWord(p[i + t.length])) return { start: i, end: i + t.length };
  }
  return null;
}
/** A hypothetical framing; unlike CONDITIONAL it leaves "could you share…" an ask. */
const HYPOTHETICAL = /(?:^|[^a-z])(if|suppose|supposing|assume|assuming|hypothetical(?:ly)?)(?:$|[^a-z])/;

// ── structure ───────────────────────────────────────────────────────────────
//
// `structure: { sections: ["Summary", "Risks"], ordered: true, form: "list" }`.
// A HEADING is a whole line in one of these forms, outside a ``` fence:
//   `# Summary` to `###### Summary` (closing #s allowed)
//   `**Summary**`, `**Summary:**`, `**Summary**:` or `__Summary__`
//   `Summary:` alone on its line
// optionally numbered (`## 1. Summary`, `2) Risks:`), with a trailing colon
// allowed. Its text must EQUAL the section, ignoring case and spacing: "Risks
// and mitigations" is not "Risks". A section is present when its heading is,
// and empty when no line other than a rule (`---`) or a fence stands between
// it and the next heading. With `ordered`, the sections' first headings come in
// the listed order. `form: "list"` needs a line starting `- `, `* `, `+ `, `• `,
// `1. ` or `1) `; `form: "table"` needs a `| … |` header row, a `| --- | --- |`
// row and one more `| … |` row. Nothing else is a heading, a list or a table.

export const SECTIONS_MAX = 12;
export type StructureAssertion = { sections: string[]; ordered?: true; form?: 'list' | 'table' };

export function checkStructure(raw: unknown): Checked<StructureAssertion> {
  const msg = `Give structure as { sections: [up to ${SECTIONS_MAX} headings], ordered: true or false, form: "list" or "table" }, with at least one section or a form.`;
  const b = obj(raw);
  if (!b || !onlyKeys(b, ['sections', 'ordered', 'form'])) return wrong(msg);
  const list = b.sections == null ? [] : Array.isArray(b.sections) && b.sections.length <= SECTIONS_MAX ? b.sections.map((x) => labelOf(x)) : null;
  if (!list || list.some((x) => x == null)) return wrong(msg);
  const sections = list as string[];
  if (b.ordered != null && typeof b.ordered !== 'boolean') return wrong(msg);
  if (b.form != null && b.form !== 'list' && b.form !== 'table') return wrong(msg);
  if (!sections.length && b.form == null) return wrong(msg);
  if (new Set(sections.map(norm)).size !== sections.length) return wrong('Name each required section once.');
  if (b.ordered && sections.length < 2) return wrong('An order needs at least two sections.');
  return fine({ sections, ...(b.ordered ? { ordered: true as const } : {}), ...(b.form ? { form: b.form as 'list' | 'table' } : {}) });
}

/** A line's heading text in an accepted form, normalised; null when the line is not a heading. */
export function headingOf(line: string): string | null {
  let t = line.replace(/\s+/g, ' ').trim();
  let m: RegExpExecArray | null;
  if ((m = /^#{1,6} (.+?)(?: #+)?$/.exec(t))) t = m[1];
  else if ((m = /^(\*\*|__)((?:(?!\*\*|__).)+)\1 ?:?$/.exec(t))) t = m[2];
  else if ((m = /^([^:|*#\-+•`>~ ][^:|]{0,79}):$/.exec(t))) t = m[1];
  else return null;
  t = t.replace(/^(\*\*|__)(.+?)\1$/, '$2').replace(/ ?:$/, '').replace(/^\d{1,2}[.)] /, '');
  return norm(t) || null;
}

const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+\S/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/** Why the output lacks the structure, or null. */
export function structureMiss(a: StructureAssertion, output: string): string | null {
  const lines = output.split(/\r?\n/);
  const heads: Array<{ text: string; at: number }> = [];
  let fenced = false;
  lines.forEach((l, at) => {
    if (FENCE.test(l)) { fenced = !fenced; return; }
    const text = fenced ? null : headingOf(l);
    if (text) heads.push({ text, at });
  });
  let last = -1, lastName = '';
  for (const s of a.sections ?? []) {
    const i = heads.findIndex((h) => h.text === norm(s));
    if (i < 0) return `It has no "${s}" section.`;
    const end = i + 1 < heads.length ? heads[i + 1].at : lines.length;
    if (!lines.slice(heads[i].at + 1, end).some((l) => l.trim() && !FENCE.test(l) && !/^\s*[-*_]{3,}\s*$/.test(l))) return `The "${s}" section is empty.`;
    if (a.ordered && i < last) return `The "${s}" section comes before "${lastName}"; the case asks for "${lastName}" first.`;
    last = i; lastName = s;
  }
  if (a.form === 'list' && !lines.some((l) => LIST_ITEM.test(l))) return 'It has no list (lines starting "- ", "* " or "1. ").';
  if (a.form === 'table' && !lines.some((l, i) => TABLE_ROW.test(l) && TABLE_RULE.test(lines[i + 1] ?? '') && TABLE_ROW.test(lines[i + 2] ?? ''))) {
    return 'It has no table (a | header | row, a | --- | row and at least one more row).';
  }
  return null;
}

// ── evidence ────────────────────────────────────────────────────────────────
//
// `evidence: { cite: ["mercury.balances", "grow.records.kpis.0"] }`. A
// CITATION is written `[path]`, `[path, path]`, `[source: path]`,
// `[sources: path, path]` or `(source: path)`; a path is a record's read key,
// optionally followed by keys and array indexes into it, joined by dots
// (`grow.records.kpis.0.value`). Brackets around anything else (`[1]`,
// `[TBD]`) are not a citation, and neither is a markdown link `[text](url)` or
// a bare `mercury.balances` without brackets. It fails when:
//   - any citation, anywhere, names a path the case's records do not hold (a
//     made-up source); with `source:`, every listed item must be such a path;
//   - a `cite` path is not cited, by itself or by a path inside it, in a
//     statement that is not conditional.
// Keys are matched ignoring case. Each `cite` path must exist in the case's
// own records, or the case is refused.

export const CITES_MAX = 20;
export type EvidenceAssertion = { cite: string[] };
const PATH = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/i;

/** Whether `path` names something the records hold: the longest read key that prefixes it, then keys and indexes. */
export function resolves(path: string, records: Record<string, unknown>): boolean {
  const seg = path.toLowerCase().split('.');
  const keyOf = (o: object, k: string) => Object.keys(o).find((x) => x.toLowerCase() === k);
  for (let k = seg.length; k >= 1; k -= 1) {
    const key = keyOf(records, seg.slice(0, k).join('.'));
    if (key === undefined) continue;
    let at: unknown = records[key];
    let ok = true;
    for (const s of seg.slice(k)) {
      if (Array.isArray(at) && /^\d+$/.test(s) && Number(s) < at.length) { at = at[Number(s)]; continue; }
      const o = obj(at);
      const kk = o ? keyOf(o, s) : undefined;
      if (!o || kk === undefined) { ok = false; break; }
      at = o[kk];
    }
    if (ok) return true;
  }
  return false;
}

/** The citations in one (lower-case) statement, as paths. */
export function citations(p: string): string[] {
  const out: string[] = [];
  for (const m of p.matchAll(/\[([^[\]]{1,400})\](?!\()|\(\s*sources?\s*:([^()]{1,400})\)/g)) {
    const inner = m[1] ?? m[2];
    const prefixed = m[2] != null || /^\s*sources?\s*:/.test(inner);
    const pieces = inner.replace(/^\s*sources?\s*:/, '').split(',').map((x) => x.trim()).filter(Boolean);
    if (prefixed || (pieces.length && pieces.every((x) => PATH.test(x)))) out.push(...pieces);
  }
  return out;
}

export function checkEvidence(raw: unknown, records: Record<string, unknown>): Checked<EvidenceAssertion> {
  const msg = `Give evidence as { cite: [1 to ${CITES_MAX} record paths, such as "mercury.balances" or "grow.records.kpis.0"] }.`;
  const b = obj(raw);
  if (!b || !onlyKeys(b, ['cite']) || !Array.isArray(b.cite) || !b.cite.length || b.cite.length > CITES_MAX) return wrong(msg);
  const cite: string[] = [];
  for (const c of b.cite) {
    const t = typeof c === 'string' ? c.trim() : '';
    if (!t || t.length > 200 || !PATH.test(t)) return wrong(msg);
    if (!resolves(t, records)) return wrong(`The case asks for a citation of ${t}, which its records do not hold.`);
    if (cite.some((x) => x.toLowerCase() === t.toLowerCase())) return wrong(`The case asks for ${t} twice.`);
    cite.push(t);
  }
  return fine({ cite });
}

/** Why the output's citations miss, or null. */
export function evidenceMiss(a: EvidenceAssertion, parts: readonly string[], records: Record<string, unknown> | null): string | null {
  if (!records) return 'The case has no records to check its citations against.';
  for (const p of parts) for (const c of citations(p)) if (!PATH.test(c) || !resolves(c, records)) return `It cited [${c}], which the case's records do not hold.`;
  for (const want of a.cite ?? []) {
    const w = want.toLowerCase();
    if (!parts.some((p) => !CONDITIONAL.test(p) && citations(p).some((c) => c === w || c.startsWith(`${w}.`)))) return `It did not cite [${want}].`;
  }
  return null;
}

// ── refusal ─────────────────────────────────────────────────────────────────
//
// `refusal: { mode, subject }`. The subject is matched as a whole word, in a
// statement that is not hypothetical (`if`, `suppose`, `assume`, `assuming`,
// `hypothetical`).
//   ask_for_input  a statement names the subject and asks for it with one of
//                  ASK_MARKS ("Please provide the signed consent form.")
//   decline        a statement names the subject and declines with one of
//                  DECLINE_MARKS ("We cannot conclude product-market fit.")
//   not_recorded   exactly `must_say_not_recorded` for the subject
//   none           no statement names the subject with an ask, a decline or
//                  "Not recorded": the records hold it, so it must not refuse
// `ask_for_input` and `decline` also fail when another statement names the
// subject with a figure and none of those marks (it asks and answers). To
// forbid a stated conclusion in words, add a forbidden claim. "can't" and
// "can not" read as "cannot". Other wordings are not recognised.
//
// It replaces the historical `refuse_when`, which was never validated or
// evaluated: `checkCase` still drops that key and CI still warns on it.

export const ASK_MARKS = [
  'please provide', 'please share', 'please send', 'please supply', 'please confirm', 'please upload',
  'can you provide', 'could you provide', 'can you share', 'could you share',
  'provide the', 'share the', 'send the', 'is needed', 'are needed', 'is required', 'are required', 'i need', 'we need',
] as const;
export const DECLINE_MARKS = [
  'cannot conclude', 'cannot determine', 'cannot confirm', 'cannot assess',
  'cannot be concluded', 'cannot be determined', 'cannot be confirmed', 'cannot be assessed',
  'unable to conclude', 'unable to determine', 'unable to confirm', 'unable to assess',
  'not enough evidence', 'insufficient evidence', 'no evidence', 'not supported by the records', 'does not support', 'do not support',
] as const;
export const REFUSAL_MODES = ['ask_for_input', 'decline', 'not_recorded', 'none'] as const;
export type RefusalAssertion = { mode: typeof REFUSAL_MODES[number]; subject: string };

export function checkRefusal(raw: unknown): Checked<RefusalAssertion> {
  const b = obj(raw);
  const subject = labelOf(b?.subject);
  if (!b || !onlyKeys(b, ['mode', 'subject']) || !(REFUSAL_MODES as readonly unknown[]).includes(b.mode) || !subject) {
    return wrong(`Give refusal as { mode: ${REFUSAL_MODES.map((m) => `"${m}"`).join(', ')}, subject: what it is about, in up to 80 characters }.`);
  }
  return fine({ mode: b.mode as RefusalAssertion['mode'], subject });
}

const marked = (p: string, marks: readonly string[]) => marks.some((m) => word(m).test(p));

/** Why the output does not refuse (or, for `none`, does), or null. */
export function refusalMiss(a: RefusalAssertion, parts: readonly string[]): string | null {
  if (a.mode === 'not_recorded') return missingDataMiss(a.subject, parts);
  const f = word(a.subject);
  const said = parts.map(plain).filter((p) => f.test(p) && !HYPOTHETICAL.test(p));
  const refuses = (p: string) => marked(p, ASK_MARKS) || marked(p, DECLINE_MARKS) || p.includes(NOT_RECORDED_MARK);
  if (a.mode === 'none') return said.some(refuses) ? `It refused on ${a.subject}, which the case's records hold.` : null;
  const ask = a.mode === 'ask_for_input';
  if (!said.some((p) => marked(p, ask ? ASK_MARKS : DECLINE_MARKS))) return ask ? `It did not ask for ${a.subject}.` : `It did not decline to conclude on ${a.subject}.`;
  if (said.some((p) => !refuses(p) && FIGURE.test(p) && !CONDITIONAL.test(p))) return ask ? `It asked for ${a.subject} and also gave it a value.` : `It declined to conclude on ${a.subject} and also gave it a value.`;
  return null;
}

// ── claims ──────────────────────────────────────────────────────────────────
//
// `claims: { required: [{ subject, object }], forbidden: [{ subject, object }] }`.
// A statement STATES a claim when it is not conditional, names the subject as
// a whole word, and names the object as a whole word after it ("Scheduling is
// the bottleneck" states { subject: "scheduling", object: "bottleneck" }). It
// NEGATES the claim when a negation (not, no, never, none, nor, neither,
// without, cannot, or a word ending in n't) comes before the object; otherwise
// it AFFIRMS it. A required claim fails when no statement affirms it, or when
// any statement negates it (a contradiction). A forbidden claim fails when any
// statement affirms it, reported speech included; negating it is allowed. The
// object before the subject ("The bottleneck is scheduling"), or the two in
// different statements, does not state the claim.
//
// Judge version 4 (D4531 part 4) adds two optional fields to a claim; a claim
// without them is judged exactly as under version 3.
//   because: "burn"     the statement must also give the reason: a causal
//                       marker (CAUSE_MARKS: "because", "since", "due to", …)
//                       after the object and the reason after that marker
//                       ("Runway: Not recorded, because monthly burn is not
//                       recorded"), or the marker, then the reason, before the
//                       subject ("Because burn is not recorded, runway is Not
//                       recorded"); a negation inside that leading reason
//                       clause does not negate the claim. A statement with
//                       the subject and object but no such reason does not
//                       state the claim, so a required claim then fails "did
//                       not state"; the reason in another statement does not
//                       count.
//   conditional: true   required claims only: the claim must be affirmed in a
//                       conditional statement (CONDITIONAL, the same list the
//                       number and claim checks skip) and affirmed in no other
//                       statement. A calculation on assumed inputs ("If a
//                       3,000,000 USD round closed …, the SAFE would convert at
//                       the cap") must stay conditional: stating it as fact
//                       ("the SAFE will convert at the cap") fails, and so does
//                       leaving it out or negating it.

export const CLAIMS_MAX = 20;
export const CAUSE_MARKS = ['because', 'since', 'due to', 'owing to', 'given that', 'as a result of', 'for lack of', 'for want of'] as const;
export type Claim = { subject: string; object: string; because?: string; conditional?: true };
export type ClaimsAssertion = { required: Claim[]; forbidden: Claim[] };
const NEGATION = /(?:^|[^a-z'])(?:not|no|never|none|nor|neither|without|cannot|[a-z]+n't)(?=$|[^a-z'])/;

export function checkClaims(raw: unknown): Checked<ClaimsAssertion> {
  const msg = `Give claims as { required: [...], forbidden: [...] }, each claim { subject, object, because?, conditional? } (subject, object and because in up to 80 characters each, all different; conditional: true on a required claim only), at most ${CLAIMS_MAX} a list, at least one claim.`;
  const b = obj(raw);
  if (!b || !onlyKeys(b, ['required', 'forbidden'])) return wrong(msg);
  const list = (v: unknown, mayBeConditional: boolean): Claim[] | null => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > CLAIMS_MAX) return null;
    const out: Claim[] = [];
    for (const c of v) {
      const o = obj(c), subject = labelOf(o?.subject), object = labelOf(o?.object);
      if (!o || !onlyKeys(o, ['subject', 'object', 'because', 'conditional']) || !subject || !object || norm(subject) === norm(object)) return null;
      const because = o.because == null ? null : labelOf(o.because);
      if (o.because != null && (!because || norm(because) === norm(subject) || norm(because) === norm(object))) return null;
      if (o.conditional != null && (typeof o.conditional !== 'boolean' || (o.conditional && !mayBeConditional))) return null;
      out.push({ subject, object, ...(because ? { because } : {}), ...(o.conditional ? { conditional: true as const } : {}) });
    }
    return out;
  };
  const required = list(b.required, true), forbidden = list(b.forbidden, false);
  if (!required || !forbidden || !(required.length + forbidden.length)) return wrong(msg);
  const key = (c: Claim) => `${norm(c.subject)}|${norm(c.object)}|${norm(c.because ?? '')}`;
  if (required.some((r) => forbidden.some((f) => key(f) === key(r)))) return wrong('A claim cannot be both required and forbidden.');
  return fine({ required, forbidden });
}

/**
 * Where `p` gives `reason` for what it states: a cause marker then the reason
 * after `after` ('after'), or wholly before `before` ('before'); null when it
 * does not. 'after' wins when both hold.
 */
export function reasonIn(reason: string, p: string, after: number, before: number): 'after' | 'before' | null {
  let found: 'before' | null = null;
  for (const m of CAUSE_MARKS) {
    for (let at = wordAt(m, p, 0); at; at = wordAt(m, p, at.start + 1)) {
      const r = wordAt(reason, p, at.end);
      if (!r) continue;
      if (at.start >= after) return 'after';
      if (r.end <= before) found = 'before';
    }
  }
  return found;
}

/** How one statement stands on the claim: affirmed, negated, or null when it does not state it. */
export function claimIn(c: Claim, p: string): 'affirmed' | 'negated' | null {
  const s = wordAt(c.subject, p);
  const o = s ? wordAt(c.object, p, s.end) : null;
  if (!s || !o) return null;
  const why = c.because ? reasonIn(c.because, p, o.end, s.start) : null;
  if (c.because && !why) return null;
  // A reason clause before the subject ("Because burn is not recorded, …") is the reason's own; its negation is not the claim's.
  return NEGATION.test(p.slice(why === 'before' ? s.start : 0, o.start)) ? 'negated' : 'affirmed';
}

/** Why the output misses a required claim or states a forbidden one, or null. */
export function claimsMiss(a: ClaimsAssertion, parts: readonly string[]): string | null {
  const all = parts.map(plain);
  const ps = all.filter((p) => !CONDITIONAL.test(p));
  const name = (c: Claim) => `"${c.subject} … ${c.object}"${c.because ? ` because "${c.because}"` : ''}`;
  for (const c of a.required ?? []) {
    if (c.conditional) {
      if (ps.some((p) => claimIn(c, p) === 'affirmed')) return `It stated the claim ${name(c)} as fact; the case requires it to stay conditional.`;
      const hyp = all.filter((p) => CONDITIONAL.test(p)).map((p) => claimIn(c, p));
      if (hyp.includes('negated')) return `It contradicted the claim ${name(c)}.`;
      if (!hyp.includes('affirmed')) return `It did not state the claim ${name(c)} as conditional.`;
      continue;
    }
    const seen = ps.map((p) => claimIn(c, p));
    if (seen.includes('negated')) return `It contradicted the claim ${name(c)}.`;
    if (!seen.includes('affirmed')) return `It did not state the claim ${name(c)}.`;
  }
  for (const c of a.forbidden ?? []) if (ps.some((p) => claimIn(c, p) === 'affirmed')) return `It stated the forbidden claim ${name(c)}.`;
  return null;
}

// ── output_schema ───────────────────────────────────────────────────────────
//
// `output_schema: { format: "json", schema: { … } }`, for a case whose output
// contract is a typed artifact. The JSON value is the whole output when it
// starts with `{` or `[` (nothing may follow it), or else the content of the
// output's one ``` or ```json fence (a fence is a line of its own; a block
// with another label, such as ```text, is ignored); two such fences, none, or
// JSON that does not parse fail. The schema is this closed subset of JSON Schema, and a
// keyword outside it is refused:
//   type                  object | array | string | number | integer | boolean | null (required)
//   enum                  up to 20 allowed values, for string, number, integer or boolean
//   required, properties  for an object; every required name must be a property when properties are given
//   additionalProperties  false only, for an object: no other key
//   items, minItems       for an array
// At most 100 schema nodes, nested at most 6 deep. An integer is also a number.
// A miss names the JSON path (`$.changes[0].field`) and the expectation.

export const SCHEMA_NODES_MAX = 100;
export const SCHEMA_DEPTH_MAX = 6;
const JSON_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'] as const;
export type JsonSchema = {
  type: typeof JSON_TYPES[number]; enum?: Array<string | number | boolean>;
  required?: string[]; properties?: Record<string, JsonSchema>; additionalProperties?: false;
  items?: JsonSchema; minItems?: number;
};
export type OutputSchemaAssertion = { format: 'json'; schema: JsonSchema };

function checkSchema(raw: unknown, at: string, depth: number, count: { n: number }): JsonSchema | string {
  const b = obj(raw);
  count.n += 1;
  if (count.n > SCHEMA_NODES_MAX) return `The schema has more than ${SCHEMA_NODES_MAX} nodes.`;
  if (depth > SCHEMA_DEPTH_MAX) return `The schema nests more than ${SCHEMA_DEPTH_MAX} deep.`;
  if (!b) return `At ${at}: give a schema object.`;
  const t = b.type as JsonSchema['type'];
  if (!(JSON_TYPES as readonly unknown[]).includes(t)) return `At ${at}: type is one of ${JSON_TYPES.join(', ')}.`;
  const allowed = ['type', ...(t === 'object' ? ['required', 'properties', 'additionalProperties'] : t === 'array' ? ['items', 'minItems'] : t === 'null' ? [] : ['enum'])];
  const extra = Object.keys(b).find((k) => !allowed.includes(k));
  if (extra) return `At ${at}: "${extra}" is not supported for type ${t}.`;
  const out: JsonSchema = { type: t };
  if (b.enum != null) {
    const ok = Array.isArray(b.enum) && b.enum.length >= 1 && b.enum.length <= 20
      && b.enum.every((v) => (t === 'string' ? typeof v === 'string' : t === 'boolean' ? typeof v === 'boolean' : typeof v === 'number' && Number.isFinite(v) && (t !== 'integer' || Number.isInteger(v))));
    if (!ok) return `At ${at}: enum is 1 to 20 values of type ${t}.`;
    out.enum = b.enum as JsonSchema['enum'];
  }
  if (b.properties != null) {
    const p = obj(b.properties);
    if (!p) return `At ${at}: properties is an object of schemas.`;
    out.properties = {};
    for (const [k, v] of Object.entries(p)) {
      const sub = checkSchema(v, `${at}.${k}`, depth + 1, count);
      if (typeof sub === 'string') return sub;
      out.properties[k] = sub;
    }
  }
  if (b.required != null) {
    if (!Array.isArray(b.required) || b.required.length > 50 || !b.required.every((r) => typeof r === 'string' && r) || new Set(b.required).size !== b.required.length) return `At ${at}: required is a list of distinct property names.`;
    const missing = out.properties ? (b.required as string[]).find((r) => !Object.hasOwn(out.properties!, r)) : undefined;
    if (missing) return `At ${at}: required "${missing}" is not in properties.`;
    out.required = b.required as string[];
  }
  if (b.additionalProperties != null) {
    if (b.additionalProperties !== false) return `At ${at}: additionalProperties may only be false.`;
    out.additionalProperties = false;
  }
  if (b.items != null) {
    const sub = checkSchema(b.items, `${at}[]`, depth + 1, count);
    if (typeof sub === 'string') return sub;
    out.items = sub;
  }
  if (b.minItems != null) {
    if (!Number.isInteger(b.minItems) || (b.minItems as number) < 0) return `At ${at}: minItems is a whole number.`;
    out.minItems = b.minItems as number;
  }
  return out;
}

export function checkOutputSchema(raw: unknown): Checked<OutputSchemaAssertion> {
  const b = obj(raw);
  if (!b || !onlyKeys(b, ['format', 'schema']) || b.format !== 'json') return wrong('Give output_schema as { format: "json", schema: { type: … } }.');
  const s = checkSchema(b.schema, '$', 1, { n: 0 });
  return typeof s === 'string' ? wrong(s) : fine({ format: 'json', schema: s });
}

/** The output's JSON value, by the rule above, or why there is none. */
export function jsonOf(output: string): { ok: true; value: unknown } | { ok: false; miss: string } {
  const t = output.trim();
  let text: string;
  if (t.startsWith('{') || t.startsWith('[')) text = t;
  else {
    // Fences are read line by line, so a ```text block never pairs with a ```json one.
    const blocks: string[] = [];
    let open: { info: string; body: string[] } | null = null;
    for (const line of t.split(/\r?\n/)) {
      const fence = /^\s*```\s*([a-z0-9_-]*)\s*$/i.exec(line);
      if (fence && !open) { open = { info: fence[1].toLowerCase(), body: [] }; continue; }
      if (fence && open && !fence[1]) { if (open.info === '' || open.info === 'json') blocks.push(open.body.join('\n')); open = null; continue; }
      open?.body.push(line);
    }
    if (blocks.length !== 1) return { ok: false, miss: blocks.length ? `It gave ${blocks.length} code blocks; the case expects one JSON value.` : 'It gave no JSON: the whole output, or one ```json block, must be the JSON value.' };
    text = blocks[0];
  }
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, miss: 'Its JSON does not parse.' }; }
}

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);

/** Why `v` does not meet `s`, naming the JSON path; null when it does. */
export function schemaMiss(s: JsonSchema, v: unknown, at = '$'): string | null {
  const t = typeOf(v);
  if (t !== s.type && !(s.type === 'number' && t === 'integer')) return `At ${at}: expected ${s.type}, got ${t}.`;
  if (s.enum && !s.enum.some((e) => e === v)) return `At ${at}: the value is not one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}.`;
  if (s.type === 'object') {
    const o = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (!Object.hasOwn(o, r)) return `At ${at}: missing required "${r}".`;
    for (const [k, sub] of Object.entries(s.properties ?? {})) {
      if (!Object.hasOwn(o, k)) continue;
      const m = schemaMiss(sub, o[k], `${at}.${k}`);
      if (m) return m;
    }
    if (s.additionalProperties === false) {
      const extra = Object.keys(o).find((k) => !Object.hasOwn(s.properties ?? {}, k));
      if (extra) return `At ${at}: "${extra}" is not in the schema.`;
    }
  }
  if (s.type === 'array') {
    const a = v as unknown[];
    if (s.minItems != null && a.length < s.minItems) return `At ${at}: expected at least ${s.minItems} item${s.minItems === 1 ? '' : 's'}, got ${a.length}.`;
    if (s.items) for (const [i, x] of a.entries()) { const m = schemaMiss(s.items, x, `${at}[${i}]`); if (m) return m; }
  }
  return null;
}

export function outputSchemaMiss(a: OutputSchemaAssertion, output: string): string | null {
  const j = jsonOf(output);
  return j.ok ? schemaMiss(a.schema, j.value) : j.miss;
}

// ── The slice-2 assertions together ─────────────────────────────────────────

export type SliceTwo = { output_schema?: OutputSchemaAssertion; structure?: StructureAssertion; evidence?: EvidenceAssertion; refusal?: RefusalAssertion; claims?: ClaimsAssertion };
const SLICE_TWO = ['output_schema', 'structure', 'evidence', 'refusal', 'claims'] as const;

/** The slice-2 assertions of a case's `expect`, as kept, or the first problem. Keys that are absent stay absent. */
export function checkAssertions(e: Record<string, unknown>, records: Record<string, unknown>): Checked<SliceTwo> {
  const out: SliceTwo = {};
  for (const k of SLICE_TWO) {
    if (e[k] == null) continue;
    const c: Checked<unknown> = k === 'output_schema' ? checkOutputSchema(e[k]) : k === 'structure' ? checkStructure(e[k])
      : k === 'evidence' ? checkEvidence(e[k], records) : k === 'refusal' ? checkRefusal(e[k]) : checkClaims(e[k]);
    if (!c.ok) return c as Checked<SliceTwo>;
    (out as Record<string, unknown>)[k] = c.value;
  }
  return fine(out);
}

/**
 * The first slice-2 miss, in `ASSERTION_KEYS` order, or null. Each assertion is
 * checked again first, so one written to the store without `checkCase` fails
 * the case rather than passing it.
 */
export function assertionsMiss(e: SliceTwo, output: string, parts: readonly string[], records: Record<string, unknown> | null): string | null {
  if (e.evidence != null && !records) return 'The case has no records to check its citations against.';
  const again = checkAssertions(e as Record<string, unknown>, records ?? {});
  if (!again.ok) return `The case's assertion is malformed: ${again.message}`;
  const a = again.value;
  return (a.output_schema && outputSchemaMiss(a.output_schema, output))
    || (a.structure && structureMiss(a.structure, output))
    || (a.evidence && evidenceMiss(a.evidence, parts, records))
    || (a.refusal && refusalMiss(a.refusal, parts))
    || (a.claims && claimsMiss(a.claims, parts))
    || null;
}
