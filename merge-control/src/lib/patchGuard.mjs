/**
 * D5622 (#5622): the patch guard for red-PR repair, pure and platform-free.
 *
 * A model asked to make a pull request's own CI failure pass has an easy wrong answer: weaken what failed. So
 * `validate` refuses every patch that changes an existing test, a test helper or fixture, a baseline, ledger or
 * allowlist, a guard script, a shard list or a timeout; that deletes or renames anything; that adds a `skip`, `only`
 * or `todo`; that leaves a file with fewer `test(`/`it(` calls or assertions; that is binary, changes a file mode or
 * is larger than the caller's caps. A privileged path (`classify.mjs` PRIVILEGED_PATHS, the one list T2, CODEOWNERS
 * and the landing bot's PROTECTED read) is refused whatever its content.
 *
 * Plain JavaScript, like `classify.mjs`, so the Actions job that applies a repair loads it with no build step. No
 * I/O, no command, no model call. A refusal is final for that patch: the caller hands the pull request back with
 * `needs-session`, it never retries with a looser rule.
 *
 * CLOSED BY DEFAULT: the caps come from the caller (the owner's variables). A cap of 0, or one that is not a whole
 * number, refuses every patch.
 */
import { isPrivileged } from './classify.mjs';

/** A test file, a test folder, or a Python test module (the same shape `classify.mjs` reads). */
const TEST_FILE = /\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
const TEST_DIR = /(?:^|\/)(?:tests?|__tests__|fixtures?|__fixtures__|__snapshots__|snapshots?)(?:\/|$)/;
const BASELINE = /(?:^|\/)baselines?\/|[-_.](?:baseline|ledger|snapshot)\.[^/]+$|\.snap$/i;
const ALLOWLIST = /allow-?list|safe-?list|ignore-?list|(?:^|\/)\.[\w-]*ignore$/i;
const GUARD = /(?:^|\/)[^/]*guard[^/]*$|(?:^|\/)check-[^/]+$/i;
const SHARDS = /(?:^|\/)[^/]*(?:shard|drift-parts)[^/]*$/i;
const TIMEOUT = /timeout/i;
const SKIPPED = /(?<![\w$])(?:test|it|describe|suite)\.(?:skip|only|todo)\b|[{,]\s*(?:skip|only|todo)\s*:\s*(?!false\b)|\bt\.(?:skip|todo)\s*\(/g;
const TEST_CALL = /(?<![\w$.])(?:test|it)(?:\.(?:each|concurrent|serial)\b[^(]*)?\s*\(/g;
const ASSERTION = /\b(?:assert|expect)\s*(?=[.(])/g;
const MODES = new Set([undefined, null, '100644']);
/** One file's whole text: past this, a repair is not a bounded fix. */
export const MAX_FILE_BYTES = 200_000;

const count = (re, text) => (String(text ?? '').match(re) || []).length;
const cap = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
const lines = (text) => (text == null ? [] : String(text).split(/\r?\n/));

/** Lines in `b` that `a` does not have, as a multiset difference. */
function extra(a, b) {
  const have = new Map();
  for (const l of a) have.set(l, (have.get(l) ?? 0) + 1);
  const out = [];
  for (const l of b) {
    const n = have.get(l) ?? 0;
    if (n > 0) have.set(l, n - 1);
    else out.push(l);
  }
  return out;
}

/** Lines added plus lines removed: the size of one file's change. */
export function changedLines(before, after) {
  const a = lines(before);
  const b = lines(after);
  return extra(a, b).length + extra(b, a).length;
}

/** A repository-relative path a repair may write: no traversal, no `.git`, nothing absolute or odd. */
export function safePath(p) {
  if (typeof p !== 'string' || !p || p.length > 300 || p.startsWith('/') || p.startsWith('-') || p.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  const parts = p.split('/');
  return parts.every((s) => s && s !== '.' && s !== '..') && !parts.includes('.git');
}

/** Why a path may never be written by a repair, whatever the content, or null. `existed` is true for an edit. */
export function pathRefusal(path, existed) {
  if (!safePath(path)) return 'not a safe relative path';
  if (isPrivileged(path)) return 'a privileged path (workflows, scripts, Merge Control, dependencies, schema)';
  if (BASELINE.test(path)) return 'a baseline, ledger or snapshot';
  if (ALLOWLIST.test(path)) return 'an allowlist or ignore list';
  if (GUARD.test(path)) return 'a guard or check script';
  if (SHARDS.test(path)) return 'a suite shard list';
  if (TEST_DIR.test(path) && !TEST_FILE.test(path)) return 'a test helper, loader or fixture';
  if (TEST_FILE.test(path) && existed) return 'changes an existing test';
  return null;
}

/**
 * Problems with one changed file; [] means it may be written.
 * @param c { path, before: string|null (null: a new file), after: string|null (null: deleted),
 *            previousPath?: string (a rename), mode?: string (git's mode, default 100644) }
 */
export function fileProblems(c) {
  const path = c?.path;
  const problems = [];
  const say = (why) => problems.push(`${String(path)}: ${why}`);
  if (c?.previousPath != null && c.previousPath !== path) say(`renames ${String(c.previousPath)}`);
  if (c?.after === null || c?.after === undefined) { say('deletes the file'); return problems; }
  if (typeof c.after !== 'string' || (c.before !== null && typeof c.before !== 'string')) { say('is not text'); return problems; }
  const why = pathRefusal(path, c.before !== null);
  if (why) say(why);
  if (c.previousPath != null) { const w = pathRefusal(c.previousPath, true); if (w) say(`its old path is ${w}`); }
  if (!MODES.has(c.mode)) say(`sets the file mode ${String(c.mode)}`);
  if (c.after.includes('\0')) say('is binary');
  if (Buffer.byteLength(c.after) > MAX_FILE_BYTES) say(`is larger than ${MAX_FILE_BYTES} bytes`);
  if (c.before !== null && c.before.trim() && !c.after.trim()) say('empties the file');
  const before = c.before ?? '';
  if (count(SKIPPED, c.after) > count(SKIPPED, before)) say('adds a skip, only or todo');
  if (count(TEST_CALL, c.after) < count(TEST_CALL, before)) say('has fewer test calls');
  if (count(ASSERTION, c.after) < count(ASSERTION, before)) say('has fewer assertions');
  const a = lines(before).filter((l) => TIMEOUT.test(l));
  const b = lines(c.after).filter((l) => TIMEOUT.test(l));
  if (extra(a, b).length || extra(b, a).length) say('changes a timeout');
  return problems;
}

/**
 * The whole patch: every file's problems, then the caller's caps.
 * @param changes [{ path, before, after, previousPath?, mode? }]
 * @param limits  { maxFiles, maxLines } whole numbers from the owner's variables; 0 or missing refuses everything
 * @returns { ok, problems: string[], files, lines }
 */
export function validate(changes, limits = {}) {
  const problems = [];
  const maxFiles = cap(limits?.maxFiles);
  const maxLines = cap(limits?.maxLines);
  if (!maxFiles || !maxLines) problems.push('the repair limits are not set, so every patch is refused');
  if (!Array.isArray(changes) || !changes.length) return { ok: false, problems: [...problems, 'the patch changes nothing'], files: 0, lines: 0 };
  const seen = new Set();
  let total = 0;
  for (const c of changes) {
    if (seen.has(c?.path)) problems.push(`${String(c?.path)}: named twice`);
    seen.add(c?.path);
    problems.push(...fileProblems(c));
    total += changedLines(c?.before, c?.after);
  }
  if (maxFiles && changes.length > maxFiles) problems.push(`${changes.length} files, above the limit of ${maxFiles}`);
  if (maxLines && total > maxLines) problems.push(`${total} changed lines, above the limit of ${maxLines}`);
  return { ok: problems.length === 0, problems, files: changes.length, lines: total };
}
