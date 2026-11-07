/**
 * #4739 (D4160, H2 of #4137) — the From Axal lifecycle as pure rules: which
 * actions a skill offers in its status, a golden case as a form and as the
 * Worker's body, and the diff as rows. `SkillLifecycle.jsx` draws them and
 * calls `adminHqSkillsApi`; nothing here reads or writes.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { REASON_MIN, REASON_MAX } from './refusals.js';

export const CASES_MAX = 20;
export const OUTPUT_KINDS = Object.freeze([
  { key: 'draft', label: 'A draft' },
  { key: 'record_change', label: 'A record change' },
  { key: 'brief', label: 'A brief' },
]);
export const PHRASES_MAX = 20;

/** A reason the Worker accepts: 10 to 500 characters once trimmed. */
export const reasonFits = (r) => {
  const n = String(r ?? '').replace(/\s+/g, ' ').trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
};

/**
 * What a skill offers in its status. A draft asks for a review; a draft in
 * review is decided by the reviewer; an approved draft is published (Publish…
 * refuses with needs_approval otherwise, and the page says so); a published
 * skill re-runs evals and retires; a retired skill offers nothing.
 */
export function actionsFor(skill) {
  const status = skill?.status;
  if (status === 'retired') return { review: false, decide: false, publish: false, evals: false, retire: false, cases: false };
  return {
    review: status === 'draft' || status === 'in_review',
    decide: status === 'in_review',
    publish: status === 'draft' || status === 'in_review',
    evals: true,
    retire: status === 'published' || status === 'draft' || status === 'in_review',
    cases: true,
  };
}

/** Whether the person viewing is the reviewer who was asked (`review.open.reviewer.uid`). Unknown reads as no. */
export const isAskedReviewer = (review, viewerUid) => !!viewerUid && review?.open?.reviewer?.uid === viewerUid;

// ─── Golden cases ───────────────────────────────────────────────────────────

const lines = (v) => (Array.isArray(v) ? v.join('\n') : '');
const phrases = (text) => String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

/** A case from the Worker as the editor's form. A case that was saved keeps its `uid` until its text changes. */
export function caseToForm(c) {
  return {
    uid: c?.uid ?? null,
    name: c?.name ?? '',
    records: JSON.stringify(c?.input?.records ?? {}, null, 2),
    output: c?.expect?.output ?? 'draft',
    must_include: lines(c?.expect?.must_include),
    must_say_not_recorded: lines(c?.expect?.must_say_not_recorded),
    must_not_include: lines(c?.expect?.must_not_include),
    saved: c ? JSON.stringify({ n: c.name, i: c.input, e: c.expect }) : null,
  };
}

export const blankCase = () => caseToForm(null);

/** The form as the Worker's case, or what is wrong with it. */
export function formToCase(f) {
  let records;
  try { records = JSON.parse(f.records); } catch { return { ok: false, field: 'records', problem: 'The input records must be valid JSON, such as {"stripe.read": {"mrr": 12000}}.' }; }
  if (!records || typeof records !== 'object' || Array.isArray(records) || !Object.keys(records).length) {
    return { ok: false, field: 'records', problem: 'Give the case its input records, keyed by the read each stands in for.' };
  }
  const name = String(f.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 120) return { ok: false, field: 'name', problem: 'Name the case in up to 120 characters.' };
  const expect = {
    output: f.output,
    must_include: phrases(f.must_include),
    must_say_not_recorded: phrases(f.must_say_not_recorded),
    must_not_include: phrases(f.must_not_include),
  };
  if (!OUTPUT_KINDS.some((k) => k.key === expect.output)) return { ok: false, field: 'output', problem: 'Say what the case expects: a draft, a record change or a brief.' };
  for (const k of ['must_include', 'must_say_not_recorded', 'must_not_include']) {
    if (expect[k].length > PHRASES_MAX || expect[k].some((p) => p.length > 200)) return { ok: false, field: k, problem: `Each expectation is up to ${PHRASES_MAX} phrases of up to 200 characters.` };
  }
  if (!expect.must_include.length && !expect.must_say_not_recorded.length && !expect.must_not_include.length) {
    return { ok: false, field: 'must_include', problem: 'Give the case at least one phrase it must or must not contain.' };
  }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(JSON.stringify({ name, records, expect }))) {
    return { ok: false, field: 'records', problem: 'A golden case never holds an email address. Use made-up records.' };
  }
  const value = { name, input: { records }, expect };
  // An unchanged saved case keeps its uid (it keeps its results); a changed one is a new case.
  const same = f.uid && f.saved === JSON.stringify({ n: name, i: { records }, e: expect });
  return { ok: true, value: same ? { uid: f.uid, ...value } : value };
}

/** The body of `PUT …/cases`: every form, or the first problem with its index. */
export function casesPayload(forms, reason) {
  if (forms.length > CASES_MAX) return { ok: false, problem: `A skill has up to ${CASES_MAX} golden cases.` };
  const cases = [];
  for (const [index, f] of forms.entries()) {
    const c = formToCase(f);
    if (!c.ok) return { ok: false, index, field: c.field, problem: c.problem };
    cases.push(c.value);
  }
  if (!reasonFits(reason)) return { ok: false, problem: `Say why, in ${REASON_MIN} to ${REASON_MAX} characters.` };
  return { ok: true, cases, reason: String(reason).trim() };
}

// ─── The diff ───────────────────────────────────────────────────────────────

const show = (v) => (v == null ? NOT_RECORDED : Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' · ') : 'None') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** `GET …/diff` as rows a person reads: changed fields, then the steps kept, added and removed. */
export function diffRows(diff) {
  const fields = (diff?.frontmatter ?? []).map((f) => ({ kind: 'field', label: String(f.field).replaceAll('_', ' '), from: show(f.from), to: show(f.to) }));
  const steps = (diff?.steps ?? []).map((s) => ({ kind: s.op === 'add' ? 'added' : s.op === 'remove' ? 'removed' : 'kept', text: String(s.text ?? '') }));
  return { fields, steps, changed: fields.length > 0 || steps.some((s) => s.kind !== 'kept') };
}

/** The versions a diff can compare: every published version and the draft. */
export const diffChoices = (versions = []) => [...versions.map((v) => `v${v.version}`), 'draft'];

/** The evaluation summary as a line. Nothing run reads "Not recorded", never "0 of 0". */
export function evalLine(evals) {
  if (!evals || !Number.isFinite(evals.total) || evals.total === 0) return NOT_RECORDED;
  return `${evals.pass} of ${evals.total} passed${evals.meets_bar ? ', at or above the bar' : ', below the bar'}`;
}
