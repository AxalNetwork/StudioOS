/**
 * D1082 (#2947, part 2 of #2398) — the Build in Lovable prompt: two
 * deterministic templates, the 4,000-character cap, the launch link, and the
 * privacy check every prompt passes before it leaves.
 *
 * WHAT GOES IN. Only what the venture recorded about the thing to build: the
 * venture's name and description, an experiment's claim, title, method and
 * target, or the Prototype / MVP must-haves and target date. Never what an
 * interview holds: the templates read no interview, transcript, quote,
 * contact, email or phone store (`NEVER_INCLUDE`, held by a source scan in
 * `test/lovable_launch.test.ts`). The interviewees' names are read for one
 * purpose only: to refuse a prompt the founder typed one into. The venture's
 * members' account and display names (D8773, #8773) are read for one purpose
 * only: to ask the founder whether a name that matches one should go.
 *
 * THE LINK. `https://lovable.dev/#prompt=` and the prompt, encoded, nothing
 * else: the prompt rides in the fragment, which the browser never sends to a
 * server, and Lovable waits for the founder to press send (owner decision 1
 * on #2398, (A)). The Worker never calls Lovable.
 */
import type { Env } from '../../types';
import { lintForSend } from '../telegramRedactCheck';
import { LOVABLE_PROMPT_MAX } from '../buildHandoffs';

export { LOVABLE_PROMPT_MAX };
export const LOVABLE_URL = 'https://lovable.dev/#prompt=';

/** The stores a prompt is never built from. */
export const NEVER_INCLUDE = Object.freeze([
  'discovery_interviews', 'interview_sessions', 'interview_findings', 'interview_chunks',
  'contacts', 'crm_contacts', 'emails', 'phone_numbers',
] as const);

/** The dialog's "Left out" line, the same for both templates. */
export const LEFT_OUT = 'Interview names, quotes and contacts are never included.';

export type ExperimentRecord = { venture: string; description: string | null; code: string | null; claim: string; title: string; method: string | null; target: string | null;
  /** D1312: the experiment's sign-up address, when it has one; the form posts its email there. */
  signupUrl?: string | null };
export type PrototypeRecord = { venture: string; description: string | null; mustHaves: Array<{ title: string; description: string | null }>; targetDate: string | null };

const line = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** The Lovable launch link for a prompt. */
export function buildWithUrl(prompt: string): string {
  return LOVABLE_URL + encodeURIComponent(prompt);
}

/**
 * Cuts a draft to the cap at a line break, and says how many lines were left
 * out. A draft is never longer than Lovable takes.
 */
function capped(head: string[], list: string[], tail: string[]): { prompt: string; dropped: number } {
  const join = (items: string[]) => [...head, ...(items.length ? [items.join('\n')] : []), ...tail].join('\n\n');
  let keep = list.length;
  while (keep > 0 && join(list.slice(0, keep)).length > LOVABLE_PROMPT_MAX) keep -= 1;
  let prompt = join(list.slice(0, keep));
  if (prompt.length > LOVABLE_PROMPT_MAX) prompt = prompt.slice(0, LOVABLE_PROMPT_MAX);
  return { prompt, dropped: list.length - keep };
}

/** LV2: a landing page that tests one experiment's claim. */
export function landingTestPrompt(r: ExperimentRecord): { prompt: string; dropped: number } {
  const head = [
    `Build a one-page landing page for ${line(r.venture) || 'a new product'} that tests one claim with real visitors.`,
    ...(line(r.description) ? [`About the product: ${line(r.description)}`] : []),
  ];
  const list = [
    `The claim to test${r.code ? ` (${line(r.code)})` : ''}: ${line(r.claim)}`,
    `The experiment: ${line(r.title)}`,
    ...(line(r.method) ? [`How it is tested: ${line(r.method)}`] : []),
    ...(line(r.target) ? [`What counts as a pass: ${line(r.target)}`] : []),
  ];
  const tail = ['Include a clear headline, the promise in one sentence, three short benefits, and one call to action that records interest (a sign-up form). Keep it simple and fast to load.'];
  // D1312 (#3432): with a sign-up address, the form posts there; only the count is kept.
  if (r.signupUrl) tail.push(`Make the sign-up form a plain HTML form: method POST, action ${r.signupUrl}, one email field named "email". Do not store the email anywhere else.`);
  return capped(head, list, tail);
}

/**
 * A date in words ("1 December 2026"): the shared check reads a run of digits
 * like 2026-12-01 as a phone number, so a drafted prompt never carries one.
 */
function dayWords(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** LV3: a clickable prototype of the must-haves on Prototype / MVP. */
export function prototypePrompt(r: PrototypeRecord): { prompt: string; dropped: number } {
  const head = [
    `Build a clickable prototype of ${line(r.venture) || 'a new product'}.`,
    ...(line(r.description) ? [`About the product: ${line(r.description)}`] : []),
    ...(dayWords(r.targetDate) ? [`It should be ready to show by ${dayWords(r.targetDate)}.`] : []),
  ];
  const list = r.mustHaves.map((m) => `- ${line(m.title)}${line(m.description) ? `: ${line(m.description)}` : ''}`);
  const tail = [list.length ? 'Build the must-haves above first, each reachable from the first screen. Use sample data only.' : 'No must-haves are recorded yet: build the first screen and one core flow. Use sample data only.'];
  const out = capped([...head, ...(list.length ? ['Must-haves:'] : [])], list, tail);
  return out;
}

/** A finding's kind in words; the matched text is never repeated. */
export const FINDING_WORDS: Record<string, string> = {
  email: 'an email address',
  phone: 'a phone number',
  interviewee_name: 'an interviewee’s name',
  private_in_public: 'a person’s name',
  consent_missing: 'a person’s name',
  tax_id: 'a tax number',
  bank_iban: 'a bank account number',
  card_like: 'a card number',
  member_name: 'a member’s name',
};

/**
 * A finding: its kind, its words, and (D8773, #8773) the 1-based lines of the
 * checked text it was found on. Never the words that matched.
 */
export type Finding = { kind: string; words: string; lines: number[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The 1-based line of a character offset in `text`. */
export function lineOf(text: string, offset: number): number {
  return text.slice(0, Math.max(0, offset)).split('\n').length;
}

/** Every line on which `name` stands as whole words, in any case. */
function wholeWordLines(text: string, name: string): number[] {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?=$|[^\\p{L}\\p{N}])`, 'giu');
  return [...text.matchAll(re)].map((m) => lineOf(text, (m.index ?? 0) + m[1].length));
}

const ascending = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);

/**
 * The privacy check, the same in the dialog's check and at launch: the shared
 * check for text that leaves StudioOS (`lintForSend`, `public`), and this
 * venture's interviewees' names, matched as whole words. Each finding is its
 * kind once, with the lines it is on; never the words that matched.
 */
export async function privacyFindings(env: Env, projectId: number, text: string): Promise<Finding[]> {
  const kinds = new Map<string, Set<number>>();
  const add = (kind: string, lines: number[]) => {
    const s = kinds.get(kind) ?? new Set<number>();
    for (const n of lines) s.add(n);
    kinds.set(kind, s);
  };
  const res = await lintForSend(env, text, 'public');
  if (!res.ok) for (const f of res.findings) add(f.kind, typeof f.offset === 'number' ? [lineOf(text, f.offset)] : []);
  const names = (await env.DB.prepare('SELECT DISTINCT interviewee_name AS name FROM discovery_interviews WHERE project_id = ? AND interviewee_name IS NOT NULL')
    .bind(projectId).all<{ name: string }>()).results || [];
  for (const { name } of names) {
    const n = line(name);
    if (n.length < 3) continue;
    const at = wholeWordLines(text, n);
    if (at.length) add('interviewee_name', at);
  }
  return [...kinds].map(([kind, lines]) => ({ kind, words: FINDING_WORDS[kind] || 'a private detail', lines: ascending(lines) }));
}

/**
 * D8773 (#8773): what the checks above cannot see. A venture named after its
 * founder passes them, because a display name is not a recorded legal name.
 * So the account name and the display name of each member of this venture
 * (the accounts of its founder, and its accepted members not removed) are
 * matched against the text as whole words, 3+ characters, any case. A match
 * is advisory: it asks the founder to keep the name or use an alias, and
 * never refuses a launch. Like a finding, it names lines, never the words.
 */
export async function memberNameAdvisories(env: Env, projectId: number, text: string): Promise<Finding[]> {
  const rows = (await env.DB.prepare(`SELECT u.name AS name, u.display_name AS display_name FROM users u
    WHERE u.id IN (SELECT m.user_id FROM project_members m WHERE m.project_id = ? AND m.status = 'accepted' AND m.removed_at IS NULL)
       OR (u.founder_id IS NOT NULL AND u.founder_id = (SELECT p.founder_id FROM projects p WHERE p.id = ?))
    LIMIT 100`).bind(projectId, projectId).all<{ name: string | null; display_name: string | null }>()).results || [];
  const lines = new Set<number>();
  for (const r of rows) {
    for (const raw of [r.name, r.display_name]) {
      const n = line(raw);
      if (n.length < 3) continue;
      for (const at of wholeWordLines(text, n)) lines.add(at);
    }
  }
  return lines.size ? [{ kind: 'member_name', words: FINDING_WORDS.member_name, lines: ascending(lines) }] : [];
}

/** "in line 3", "in lines 3 and 5", "in lines 1, 2 and 7"; empty when no line is known. */
export function linesWords(lines: number[] | undefined): string {
  const xs = ascending(lines || []);
  if (!xs.length) return '';
  if (xs.length === 1) return `in line ${xs[0]}`;
  return `in lines ${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** LV3's PII row, in the canvas's words, with the lines each kind is on (D8773). */
export function checkLine(findings: Finding[]): string {
  if (!findings.length) return 'No personal data found';
  if (findings.length === 1) {
    const where = linesWords(findings[0].lines);
    return `This prompt contains ${findings[0].words}${where ? `, ${where}` : ''}. Remove it to continue.`;
  }
  const what = findings.map((f) => {
    const where = linesWords(f.lines).replace(/^in /, '');
    return where ? `${f.words} (${where})` : f.words;
  });
  return `This prompt contains ${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}. Remove it to continue.`;
}

/**
 * D8773 (#8773): a neutral alias for this prompt only, typed by the founder
 * (owner question Q2, option A: never saved). One line, 2 to 60 characters,
 * letters, digits, spaces and . , ' & - only. Null when none was sent,
 * false when what was sent is not one.
 */
export function aliasOf(raw: unknown): string | null | false {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (v.length < 2 || v.length > 60 || !/^[\p{L}\p{N} .,'’&-]+$/u.test(v)) return false;
  return v;
}

/** The lines of a drafted prompt that carry the venture's label, as whole words. */
export function labelLines(prompt: string, label: string): number[] {
  const n = line(label);
  return n ? ascending(wholeWordLines(prompt, n)) : [];
}
