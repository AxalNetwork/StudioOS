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
 *   unreadable         the reader threw
 *
 * Nothing here is a model call, a network read or a write. Native readers only: an approved MCP adapter or a
 * manually supplied record is a different path, named in `paths`, and is not exercised by this module.
 */
import type { Env } from '../../types';
import { READERS, READER_PROVIDES, readOne, type ReadContext } from './reads';

export type Expects = 'project_profile' | 'company_profile' | 'activity_summaries' | 'typed_record' | 'document_text' | 'manual_evidence';
export type Need = { field: string; read: string; expects: Expects; required: boolean };
export type SkillInputs = { slug: string; needs: readonly Need[] };

const need = (field: string, read: string, expects: Expects, required = true): Need => ({ field, read, expects, required });

/** The ten skills of #4588, in its order. Their inputs come from each skill's own steps and #4588's scenarios. */
export const FIRST_TEN: readonly SkillInputs[] = Object.freeze([
  { slug: 'cash-runway-snapshot', needs: [
    need('recorded account balances and the balance date', 'mercury.balances', 'typed_record'),
    need('monthly burn for the last three months', 'grow.records', 'typed_record'),
  ] },
  { slug: 'board-meeting-brief', needs: [
    need('the company or project profile', 'project.summary', 'project_profile'),
    need('metrics for the reporting period', 'grow.records', 'typed_record'),
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
    need('recorded fund performance with periods and valuation dates', 'raise.records', 'typed_record'),
    need('growth context', 'grow.records', 'activity_summaries', false),
  ] },
  { slug: 'contract-clause-extraction', needs: [
    need('the contract text, with document and version identity', 'data_room.index', 'document_text'),
    need('the company profile', 'company.profile', 'company_profile', false),
  ] },
  { slug: 'contract-risk-issue-spotting', needs: [
    need('the contract text, with document and version identity', 'data_room.index', 'document_text'),
    need('the organization review policy', 'manual:review_policy', 'manual_evidence'),
    need('the company profile', 'company.profile', 'company_profile', false),
  ] },
  { slug: 'safe-convertible-instrument-review', needs: [
    need('the instrument text, with version identity', 'data_room.index', 'document_text'),
    need('capitalization definitions and holdings', 'cap_table.read', 'typed_record'),
    need('raise terms', 'raise.records', 'activity_summaries', false),
  ] },
  { slug: 'legal-due-diligence-coordination', needs: [
    need('workstreams, evidence owners, dates and open questions', 'data_room.index', 'typed_record'),
    need('raise progress', 'raise.records', 'activity_summaries', false),
  ] },
  { slug: 'pipeline-health-diagnostics', needs: [
    need('opportunities with stage, stage-change dates and a snapshot date', 'grow.records', 'typed_record'),
    need('the target', 'raise.records', 'typed_record', false),
  ] },
  { slug: 'customer-interview-summary', needs: [
    need('the transcript, speakers and consent status', 'validate.records', 'typed_record'),
  ] },
]);

export const FIRST_TEN_SLUGS = Object.freeze(FIRST_TEN.map((s) => s.slug));

export type InputStatus = 'available' | 'empty' | 'missing' | 'absent_optional' | 'partial' | 'stale' | 'unavailable_reader' | 'unreadable';
/** `wrong_shape`: the reader answers, but not what the skill needs (summaries where it needs typed fields). */
export type InputReport = { field: string; read: string; required: boolean; status: InputStatus; note: string | null; reason?: 'wrong_shape' };
/** `ready`: every input available. `conditional`: the required inputs are there, in part or stale, or an optional one is not; the brief states its `limits`. `not_ready`: a required input cannot be supplied. */
export type Readiness = 'ready' | 'conditional' | 'not_ready';
export type PathSupport = { default_context: 'supported' | 'unsupported'; scheduled: 'supported' | 'unsupported'; manual: 'approved_tool_reads_not_exercised_here' };
export type SkillPreflight = { slug: string; state: Readiness; inputs: InputReport[]; limits: string[]; paths: PathSupport };

export const STALE_DAYS = 45;

/** Which paths could carry this skill's inputs. Static: it asks no reader. */
export function pathsFor(slug: string, readers: Partial<Record<string, unknown>> = READERS): PathSupport | null {
  const skill = FIRST_TEN.find((s) => s.slug === slug);
  if (!skill) return null;
  const built = skill.needs.filter((n) => n.required).every((n) => typeof readers[n.read] === 'function' && satisfies(n));
  const side = built ? 'supported' : 'unsupported';
  return { default_context: side, scheduled: side, manual: 'approved_tool_reads_not_exercised_here' };
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

async function inputReport(env: Env, n: Need, c: ReadContext, readers: Partial<Record<string, Reader>>, now: number, provides: Provides): Promise<InputReport> {
  const base = { field: n.field, read: n.read, required: n.required };
  const absent = n.required ? 'missing' as const : 'absent_optional' as const;
  if (typeof readers[n.read] !== 'function') return { ...base, status: 'unavailable_reader', note: 'No reader is built for this evidence yet.' };
  let out;
  try { out = await readOne(env, n.read, c, readers); } catch { return { ...base, status: 'unreadable', note: 'The source could not be read.' }; }
  if (out.incomplete) return { ...base, status: 'partial', note: 'The record is larger than a run may carry, so none of it is supplied.' };
  const data: any = out.data;
  if (data === null || data === undefined) return { ...base, status: absent, note: 'No such record.' };
  if (provides[n.read] !== n.expects) {
    return { ...base, status: 'partial', reason: 'wrong_shape', note: `This reader gives ${(provides[n.read] ?? 'another shape').replace('_', ' ')}, not ${n.expects.replace('_', ' ')}.` };
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
  return { ...base, status: 'available', note: null };
}

/**
 * Reads the real readers for one scope and says whether the skill can run. Required inputs that are not
 * `available` make it `not_ready` when they are absent or unreadable, and `conditional` when some of the
 * evidence is there (partial or stale): a conditional result must state its `limits`.
 */
export async function preflight(env: Env, slug: string, c: ReadContext, readers: Partial<Record<string, Reader>> = READERS, now = Date.now(), provides: Provides = READER_PROVIDES): Promise<SkillPreflight | null> {
  const skill = FIRST_TEN.find((s) => s.slug === slug);
  if (!skill) return null;
  const inputs: InputReport[] = [];
  for (const n of skill.needs) {
    if (n.read.startsWith('manual:')) {
      inputs.push({ field: n.field, read: n.read, required: n.required, status: 'unavailable_reader', note: 'Supplied by the person, not read from a record.' });
    } else inputs.push(await inputReport(env, n, c, readers, now, provides));
  }
  // A required input the reader cannot give at all (absent, empty, unreadable, or the wrong shape) leaves nothing to
  // brief from. Some of it (a page of many rows, a stale newest record) leaves a brief that must state its limits.
  const hard = inputs.some((i) => i.required && (['unavailable_reader', 'missing', 'empty', 'unreadable'].includes(i.status) || i.reason === 'wrong_shape'));
  const lacking = inputs.filter((i) => i.status !== 'available');
  const state: Readiness = hard ? 'not_ready' : lacking.length ? 'conditional' : 'ready';
  const limits = lacking.map((i) => `${i.field}: ${i.note ?? i.status}`);
  return { slug, state, inputs, limits, paths: pathsFor(slug, readers)! };
}
