/**
 * D4667 (#4667) — what the first ten skills need, and whether the readers behind a run can supply it.
 *
 * The matrix is the contract between a skill and its readers. Each input names the read key it comes from, the
 * KIND of evidence the skill needs (a typed record, a document's text, or only the latest activity summaries)
 * and whether the skill can run without it. `preflight` then reads the real reader for a real scope and says,
 * per input, which of seven things is true; a skill is `ready` only when every required input is `available`.
 *
 *   available          the reader answered, with its coverage complete and the shape the skill needs
 *   empty              the reader answered and the collection is complete and empty: nothing recorded
 *   missing            the reader answered null: the record does not exist
 *   absent_optional    as `missing`, for an input the skill can do without
 *   partial            some of it: more rows than were returned, an unknown count, a larger-than-allowed answer,
 *                      or a reader that gives summaries where the skill needs typed fields
 *   stale              the newest record is older than the window
 *   unavailable_reader no reader is built for this key
 *   withheld           the sponsor may not read this source for this venture (its own rule, checked as them)
 *   not_granted        the agent's rule book does not read this key, so no run of it carries the evidence (D4667-p2)
 *   unreadable         the reader threw
 *
 * Nothing here is a model call, a network read or a write. Native readers only: an approved MCP adapter or a
 * manually supplied record is a different path, named in `paths`, and is not exercised by this module.
 */
import type { Env } from '../../types';
import { isWithheld, READERS, READER_PROVIDES, readOne, type ReadContext, type ReadResult } from './reads';

export type Expects = 'project_profile' | 'company_profile' | 'activity_summaries' | 'typed_record' | 'document_text' | 'manual_evidence';
export type Need = { field: string; read: string; expects: Expects; required: boolean };
export type SkillInputs = { slug: string; needs: readonly Need[] };

const need = (field: string, read: string, expects: Expects, required = true): Need => ({ field, read, expects, required });

/** The ten skills of #4588, in its order. Their inputs come from each skill's own steps and #4588's scenarios. */
export const FIRST_TEN: readonly SkillInputs[] = Object.freeze([
  { slug: 'cash-runway-snapshot', needs: [
    need('recorded account balances and the balance date', 'mercury.balances', 'typed_record'),
    need('monthly burn for the last three months', 'grow.burn', 'typed_record'),
  ] },
  { slug: 'board-meeting-brief', needs: [
    need('the company or project profile', 'project.summary', 'project_profile'),
    need('recorded KPIs for the reporting period', 'grow.board_metrics', 'typed_record'),
    need('recorded monthly burn, for any runway claim', 'grow.burn', 'typed_record', false),
    need('recorded balances, for any runway claim', 'mercury.balances', 'typed_record', false),
    need('compliance dates', 'compliance.calendar', 'typed_record', false),
  ] },
  { slug: 'monthly-investor-update', needs: [
    need('period-aligned revenue metrics', 'stripe.revenue', 'typed_record'),
    need('recorded balances', 'mercury.balances', 'typed_record', false),
    need('raise progress', 'raise.records', 'activity_summaries', false),
    need('build progress', 'build.records', 'activity_summaries', false),
  ] },
  { slug: 'lp-quarterly-letter-draft', needs: [
    // D4667-p4: the run's selected fund (`vc_fund:<id>`), for one quarter, read by its GP of record.
    need('recorded fund performance with periods and valuation dates', 'fund.performance', 'typed_record'),
    need('growth context', 'grow.records', 'activity_summaries', false),
  ] },
  { slug: 'contract-clause-extraction', needs: [
    need('the contract text, with document and version identity', 'data_room.index', 'document_text'),
    need('the company profile', 'company.profile', 'company_profile', false),
  ] },
  { slug: 'contract-risk-issue-spotting', needs: [
    need('the contract text, with document and version identity', 'data_room.index', 'document_text'),
    // Owner's answer on #4588 (D4667-p3, A): a person supplies the review policy. It is not a company-profile field.
    need('the organization review policy', 'manual:review_policy', 'manual_evidence'),
    need('the company profile', 'company.profile', 'company_profile', false),
  ] },
  { slug: 'safe-convertible-instrument-review', needs: [
    // Owner's answer on #4588 (D4667-p3, A): the instrument's text is the run's selected data-room document, and the
    // skill declares `data_room.read`. It is not a typed `raise.records` instrument.
    need('the instrument text, with version identity', 'data_room.index', 'document_text'),
    need('capitalization definitions and holdings', 'cap_table.read', 'typed_record'),
    need('raise terms', 'raise.records', 'activity_summaries', false),
  ] },
  { slug: 'legal-due-diligence-coordination', needs: [
    need('workstreams, evidence owners, dates and open questions', 'raise.diligence', 'typed_record'),
    need('raise progress', 'raise.records', 'activity_summaries', false),
  ] },
  { slug: 'pipeline-health-diagnostics', needs: [
    need('opportunities with stage, stage-change dates and a snapshot date', 'raise.pipeline', 'typed_record'),
    need('the target', 'raise.records', 'typed_record', false),
  ] },
  { slug: 'customer-interview-summary', needs: [
    need('the transcript, speakers and consent status', 'validate.transcripts', 'typed_record'),
  ] },
]);

export const FIRST_TEN_SLUGS = Object.freeze(FIRST_TEN.map((s) => s.slug));

export type InputStatus = 'available' | 'empty' | 'missing' | 'absent_optional' | 'partial' | 'stale' | 'unavailable_reader' | 'withheld' | 'not_granted' | 'unreadable';
/**
 * `wrong_shape`: the reader answers, but not what the skill needs (summaries where it needs typed fields).
 * `not_bound` (D4667-p2): the rule book reads it, but the run's context left it out for length, so the run does not carry it.
 * D4667-p3, a document's text: `not_selected` (the run names no document), `not_found` (not in this room, or in Trash),
 * `not_read` (its text was never read), `not_current` (replaced since its text was read, so the text on record is an
 * earlier version's), `no_text` (it holds none the reader can read), `failed` (reading it to text failed).
 * D4667-p4, a fund's performance: `not_selected` (the run names no fund) and `not_found` (not a fund the sponsor runs
 * under this company) as for a document.
 */
export type InputReason = 'wrong_shape' | 'manual' | 'supplied_invalid' | 'not_bound' | 'not_selected' | 'not_found' | 'not_read' | 'not_current' | 'no_text' | 'failed';
export type InputReport = {
  field: string; read: string; required: boolean; status: InputStatus; note: string | null; reason?: InputReason;
  /** Where the evidence came from: a native reader, or a person (`manual`, with its reference). */
  source?: 'native' | 'manual'; ref?: string;
};

/**
 * D4667 (second slice) — evidence a person supplies for one input, by read key: what it is, when it was recorded,
 * its own reference and its text. A `manual:` input (the review policy) is met by it. Any other input it stands in
 * for stays `partial`: the brief says the figure came from a person, not from a record the platform read.
 */
export type SuppliedEvidence = { ref: string; recorded_at: string; text: string };
export type Supplied = Readonly<Record<string, SuppliedEvidence>>;
const SUPPLIED_REF = /^manual:[a-z0-9][a-z0-9_-]{0,63}$/;
const SUPPLIED_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const SUPPLIED_TEXT_MAX = 20_000;

/** Why supplied evidence cannot be used, or null when it can. Checked before any model operation. */
export function suppliedProblem(e: unknown, now = Date.now()): string | null {
  if (!e || typeof e !== 'object') return 'It is not a record.';
  const v = e as Record<string, unknown>;
  if (typeof v.ref !== 'string' || !SUPPLIED_REF.test(v.ref)) return 'Its reference is not a manual reference.';
  if (typeof v.recorded_at !== 'string' || !SUPPLIED_DAY.test(v.recorded_at) || !Number.isFinite(Date.parse(`${v.recorded_at}T00:00:00Z`))) return 'It has no recorded date.';
  if (Date.parse(`${v.recorded_at}T00:00:00Z`) > now + 86_400_000) return 'Its recorded date is in the future.';
  if (typeof v.text !== 'string' || !v.text.trim()) return 'It is empty.';
  if (v.text.length > SUPPLIED_TEXT_MAX) return `It is longer than ${SUPPLIED_TEXT_MAX} characters.`;
  return null;
}
/** `ready`: every input available. `conditional`: the required inputs are there, in part or stale, or an optional one is not; the brief states its `limits`. `not_ready`: a required input cannot be supplied. */
export type Readiness = 'ready' | 'conditional' | 'not_ready';
/** `selected_record` (D4667-p4): present when a required input is read only for a record a manual run selects. */
export type PathSupport = { default_context: 'supported' | 'unsupported'; scheduled: 'supported' | 'unsupported'; manual: 'approved_tool_reads_not_exercised_here'; selected_record?: 'supported' | 'unsupported' };
export type SkillPreflight = { slug: string; state: Readiness; inputs: InputReport[]; limits: string[]; paths: PathSupport };

export const STALE_DAYS = 45;
/** A required input in one of these leaves nothing to brief from: the skill is `not_ready`. */
export const HARD: readonly InputStatus[] = Object.freeze(['unavailable_reader', 'missing', 'empty', 'withheld', 'not_granted', 'unreadable']);

/**
 * D4667-p4 — read keys whose evidence exists only for a record the run selects, and that a scheduled session cannot
 * select: a session's target kinds (`agent_duties.target_kind`) have no fund. A skill that requires one runs only on
 * the manual path, whose `record` selects it.
 */
export const MANUAL_SELECTION_ONLY: readonly string[] = Object.freeze(['fund.performance']);

/** Which paths could carry this skill's inputs. Static: it asks no reader. */
export function pathsFor(slug: string, readers: Partial<Record<string, unknown>> = READERS): PathSupport | null {
  const skill = FIRST_TEN.find((s) => s.slug === slug);
  if (!skill) return null;
  const required = skill.needs.filter((n) => n.required);
  const built = required.every((n) => typeof readers[n.read] === 'function' && satisfies(n));
  const side = built ? 'supported' : 'unsupported';
  const scheduled = built && !required.some((n) => MANUAL_SELECTION_ONLY.includes(n.read)) ? 'supported' : 'unsupported';
  return { default_context: scheduled, scheduled, manual: 'approved_tool_reads_not_exercised_here', ...(side !== scheduled ? { selected_record: side } : {}) };
}

/** A native reader gives a shape; a need is met only by that shape. */
function satisfies(n: Need): boolean {
  const gives = READER_PROVIDES[n.read];
  return gives !== undefined && gives === n.expects;
}

/** The matrix with no reads: every input and where it can come from. */
export function inputMatrix(readers: Partial<Record<string, unknown>> = READERS) {
  return FIRST_TEN.map((s) => ({
    slug: s.slug,
    paths: pathsFor(s.slug, readers),
    inputs: s.needs.map((n) => ({
      field: n.field, read: n.read, expects: n.expects, required: n.required,
      reader: typeof readers[n.read] === 'function' ? (satisfies(n) ? 'built' : 'built_other_shape') : 'not_built',
    })),
  }));
}

const daysBetween = (a: number, b: number) => (a - b) / 86_400_000;

type Reader = (env: Env, c: ReadContext) => Promise<unknown>;

type Provides = Readonly<Record<string, string>>;

async function inputReport(env: Env, n: Need, c: ReadContext, readers: Partial<Record<string, Reader>>, now: number, provides: Provides, capture?: Map<string, ReadResult>): Promise<InputReport> {
  const base = { field: n.field, read: n.read, required: n.required };
  const absent = n.required ? 'missing' as const : 'absent_optional' as const;
  if (typeof readers[n.read] !== 'function') return { ...base, status: 'unavailable_reader', note: 'No reader is built for this evidence yet.' };
  let out;
  try { out = await readOne(env, n.read, c, readers); } catch { return { ...base, status: 'unreadable', note: 'The source could not be read.' }; }
  capture?.set(n.read, out);
  if (isWithheld(out.data)) return { ...base, status: 'withheld', note: out.data.reason };
  if (out.incomplete) return { ...base, status: 'partial', note: 'The record is larger than a run may carry, so none of it is supplied.' };
  const data: any = out.data;
  if (data === null || data === undefined) return { ...base, status: absent, note: 'No such record.' };
  if (provides[n.read] !== n.expects) {
    return { ...base, status: 'partial', reason: 'wrong_shape', note: `This reader gives ${(provides[n.read] ?? 'another shape').replace('_', ' ')}, not ${n.expects.replace('_', ' ')}.` };
  }
  if (n.expects === 'document_text') return documentReport(base, absent, data, out.truncated === true);
  if (data && typeof data === 'object' && 'fund_status' in data) return fundReport(base, absent, data, out.truncated === true);
  // A typed reader names the fields its source does not record; the skill gets the rest, and the brief says so.
  const nothing = data?.coverage && Array.isArray(data.records) && data.coverage.total === 0;
  if (!nothing && Array.isArray(data?.missing_fields) && data.missing_fields.length) {
    return { ...base, status: 'partial', note: `Not recorded at the source: ${data.missing_fields.join(', ')}.` };
  }
  const cov = data?.coverage;
  if (cov && Array.isArray(data.records)) {
    if (cov.total === null) return { ...base, status: 'partial', note: 'How many records exist could not be counted.' };
    if (cov.total === 0) return { ...base, status: 'empty', note: 'Nothing is recorded.' };
    if (!cov.complete) return { ...base, status: 'partial', note: `${cov.returned} of ${cov.total} records supplied; ${cov.omitted} left out.` };
    const newest = Math.max(...data.records.map((r: any) => Date.parse(String(r?.at ?? '').replace(' ', 'T') + (String(r?.at ?? '').includes('Z') ? '' : 'Z'))).filter(Number.isFinite));
    if (Number.isFinite(newest) && daysBetween(now, newest) > STALE_DAYS) return { ...base, status: 'stale', note: `The newest record is more than ${STALE_DAYS} days old.` };
  }
  if (out.truncated) return { ...base, status: 'partial', note: 'Part of the record was left out for length.' };
  // Records whose words the source holds back (an interview without recording consent) leave the input partial.
  const held = Array.isArray(data?.records) ? data.records.filter((r: any) => r && r.words_withheld).length : 0;
  if (held) return { ...base, status: 'partial', note: `${held} record(s) carried without their words: ${data.records.find((r: any) => r.words_withheld).words_withheld}` };
  return { ...base, status: 'available', note: null };
}

/**
 * D4667-p3 — one selected document's text (`data_room.index`). Only its current version's text counts: none
 * selected, not found, never read or replaced since it was read leave nothing to supply (`missing`); a document the
 * reader cannot turn into text is `unreadable`; some of its passages is `partial`, and says how many.
 */
function documentReport(base: Pick<InputReport, 'field' | 'read' | 'required'>, absent: 'missing' | 'absent_optional', data: any, truncated: boolean): InputReport {
  const st = data?.document_status;
  if (st === 'not_selected') return { ...base, status: absent, reason: 'not_selected', note: 'No document is selected for this run.' };
  if (st === 'not_found') return { ...base, status: absent, reason: 'not_found', note: 'The selected document is not in this data room.' };
  if (st === 'not_read') return { ...base, status: absent, reason: 'not_read', note: 'The selected document\'s text has not been read yet.' };
  if (st === 'not_current') return { ...base, status: absent, reason: 'not_current', note: 'The selected document was replaced after its text was read, so no text of its current version is on record.' };
  if (st === 'no_text') return { ...base, status: 'unreadable', reason: 'no_text', note: 'The selected document holds no text the reader can read.' };
  if (st === 'failed') return { ...base, status: 'unreadable', reason: 'failed', note: 'The selected document could not be read to text.' };
  const doc = data?.document;
  const cov = doc?.coverage;
  if (st !== 'read' || !doc?.file_uid || !doc?.version_digest || !Array.isArray(doc?.passages) || !cov) {
    return { ...base, status: 'partial', reason: 'wrong_shape', note: 'This reader does not give a document\'s versioned text.' };
  }
  if (truncated) return { ...base, status: 'partial', note: 'Part of the document was left out for length.' };
  if (!cov.complete) return { ...base, status: 'partial', note: `${cov.returned} of ${cov.total} passages of the document supplied; ${cov.total - cov.returned} left out.` };
  return { ...base, status: 'available', note: null };
}

/**
 * D4667-p4 — one selected fund's recorded performance for a quarter (`fund.performance`). None selected, or not a fund
 * the sponsor runs here, leaves nothing to supply (`missing`). A fund with no position, call or distribution by the
 * quarter end is `empty`. Otherwise every gap is named: a collection not read whole or not counted, a position with
 * no mark by the quarter end, a figure the fund performance formula could not compute (unknown, never zero); and a
 * mark dated before the quarter is `stale`. Each gap goes into the brief's limits.
 */
function fundReport(base: Pick<InputReport, 'field' | 'read' | 'required'>, absent: 'missing' | 'absent_optional', data: any, truncated: boolean): InputReport {
  const st = data?.fund_status;
  if (st === 'not_selected') return { ...base, status: absent, reason: 'not_selected', note: 'No fund is selected for this run.' };
  if (st === 'not_found') return { ...base, status: absent, reason: 'not_found', note: 'The selected fund is not one the sponsor runs under this company.' };
  const lists = [['marks', 'positions'], ['capital_calls', 'capital calls'], ['distributions', 'distributions']] as const;
  if (st !== 'read' || !data?.fund?.ref || !data?.period?.to || !data?.performance || lists.some(([k]) => !Array.isArray(data[k]) || !data[`${k}_coverage`])) {
    return { ...base, status: 'partial', reason: 'wrong_shape', note: 'This reader does not give a fund\'s performance for a period.' };
  }
  const end = data.period.to;
  const perf = data.performance;
  const marks: any[] = data.marks;
  if (lists.every(([k]) => data[`${k}_coverage`].total === 0) && perf.paid_in === null && perf.nav === null) {
    return { ...base, status: 'empty', note: `Nothing is recorded for this fund by ${end}.` };
  }
  const gaps: string[] = [];
  if (truncated) gaps.push('part of the record was left out for length');
  for (const [k, words] of lists) {
    const cov = data[`${k}_coverage`];
    if (cov.total === null) gaps.push(`how many ${words} exist could not be counted`);
    else if (!cov.complete) gaps.push(`${cov.returned} of ${cov.total} ${words} supplied; ${cov.omitted} left out`);
  }
  const unmarked = marks.filter((m) => !m?.mark);
  if (unmarked.length) gaps.push(`${unmarked.length} position(s) have no mark on or before ${end}: ${unmarked.map((m) => m.company ?? m.ref).join(', ')}`);
  const unknown = Object.keys(perf.unavailable ?? {});
  if (unknown.length) gaps.push(`not recorded at the source: ${unknown.join(', ')}`);
  const before = marks.filter((m) => m?.mark?.before_period);
  if (gaps.length) {
    if (before.length) gaps.push(`${before.length} mark(s) are dated before ${data.period.from}`);
    return { ...base, status: 'partial', note: `${gaps.join('; ')}.` };
  }
  if (before.length) return { ...base, status: 'stale', note: `${before.length} mark(s) are dated before the quarter began (${data.period.from}): ${before.map((m) => `${m.company ?? m.ref} ${m.mark.valuation_date}`).join(', ')}.` };
  return { ...base, status: 'available', note: null };
}

/**
 * D4667-p2 — what binds the evidence to a run. `granted`: the read keys the agent's rule book names; any other key
 * is `not_granted` and is not read, because no run of that agent carries it. `bound`: the keys whose blocks the
 * run's context actually holds (the task loop's prompt, after what it left out for length); a granted key outside
 * it is `missing` (`absent_optional`), reason `not_bound`. `capture` receives each read's answer, so a run binds the
 * same snapshot the preflight judged.
 */
export type Binding = { granted?: readonly string[]; bound?: readonly string[]; capture?: Map<string, ReadResult> };

/**
 * Reads the real readers for one scope and says whether the skill can run. Required inputs that are not
 * `available` make it `not_ready` when they are absent or unreadable, and `conditional` when some of the
 * evidence is there (partial or stale): a conditional result must state its `limits`.
 */
export async function preflight(env: Env, slug: string, c: ReadContext, readers: Partial<Record<string, Reader>> = READERS, now = Date.now(), provides: Provides = READER_PROVIDES, supplied: Supplied = {}, binding: Binding = {}): Promise<SkillPreflight | null> {
  const skill = FIRST_TEN.find((s) => s.slug === slug);
  if (!skill) return null;
  const inputs: InputReport[] = [];
  for (const n of skill.needs) {
    const base = { field: n.field, read: n.read, required: n.required };
    const given = Object.prototype.hasOwnProperty.call(supplied, n.read) ? supplied[n.read] : undefined;
    const problem = given === undefined ? null : suppliedProblem(given, now);
    if (n.read.startsWith('manual:')) {
      if (given === undefined) inputs.push({ ...base, status: n.required ? 'missing' : 'absent_optional', note: 'A person supplies this; none was supplied.', source: 'manual' });
      else if (problem) inputs.push({ ...base, status: n.required ? 'missing' : 'absent_optional', reason: 'supplied_invalid', note: `The supplied evidence cannot be used: ${problem}`, source: 'manual' });
      else inputs.push({ ...base, status: 'available', note: null, source: 'manual', ref: given!.ref });
      continue;
    }
    if (binding.granted && !binding.granted.includes(n.read)) {
      inputs.push({ ...base, status: 'not_granted', note: `This agent's rule book does not read ${n.read}.`, source: 'native' });
      continue;
    }
    if (binding.bound && !binding.bound.includes(n.read)) {
      inputs.push({ ...base, status: n.required ? 'missing' : 'absent_optional', reason: 'not_bound', note: 'The run\'s context left it out for length.', source: 'native' });
      continue;
    }
    const native = await inputReport(env, n, c, readers, now, provides, binding.capture);
    // A person's record stands in only where the platform has nothing to read, and the brief says so.
    if (given !== undefined && !problem && ['unavailable_reader', 'missing', 'absent_optional', 'empty'].includes(native.status)) {
      inputs.push({ ...base, status: 'partial', reason: 'manual', source: 'manual', ref: given.ref, note: `Supplied by a person (recorded ${given.recorded_at}), not read from a record.` });
    } else inputs.push({ ...native, source: 'native' });
  }
  // A required input the reader cannot give at all (absent, empty, unreadable, or the wrong shape) leaves nothing to
  // brief from. Some of it (a page of many rows, a stale newest record) leaves a brief that must state its limits.
  const hard = inputs.some((i) => i.required && (HARD.includes(i.status) || i.reason === 'wrong_shape'));
  const lacking = inputs.filter((i) => i.status !== 'available');
  const state: Readiness = hard ? 'not_ready' : lacking.length ? 'conditional' : 'ready';
  const limits = lacking.map((i) => `${i.field}: ${i.note ?? i.status}`);
  return { slug, state, inputs, limits, paths: pathsFor(slug, readers)! };
}
