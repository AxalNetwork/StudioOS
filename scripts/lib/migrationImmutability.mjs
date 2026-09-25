/**
 * A migration that has been applied is never edited, deleted or renamed.
 * The rule, with no side effects, so a test can drive it.
 *
 * THE BUG IT CATCHES. `scripts/migrate-d1.mjs` records every migration it
 * applies in `schema_migrations`, keyed on the FILENAME, with a sha256 of the
 * file's text. It only moves forward: a file already in the ledger is never
 * run again, whatever its bytes are now. So editing an applied file changes
 * no database that already has it. What the edit does change is every
 * database built FROM THE FILES — a fresh branch, a restore drill, the
 * fresh-build tests — which from then on carry a schema production never
 * ran. The runner notices at deploy time and only warns ("checksum drift.
 * Forward-only runner will NOT re-run it"), and by then the edit is on main.
 *
 * It has happened eight times, and production's own ledger is the proof:
 * each of the eight drifted checksums equals the file as it stood before
 * exactly one later commit (D269 names them). Seven were comment edits. The
 * eighth, 039, was rewritten outright (55 lines in, 214 out).
 *
 * So this runs on every pull request, against the base branch, and on every
 * push to main, against the commit main pointed at before it (resolveBase
 * says why both). It asks one question of `git diff --name-status`: did this
 * change touch an existing migration? Adding a file is the only permitted
 * change. A migration that has to change gets a NEW migration.
 *
 * "APPLIED" MEANS "ON THE BASE BRANCH". Every push to main runs the deploy
 * workflow, which applies pending migrations before it deploys, so a file on
 * main is either applied or about to be. A file added in the same pull
 * request is not on the base, so git reports it as added and it may be
 * edited as often as its author likes until it merges.
 *
 * WHY THE STATUS IS JUDGED HERE AS WELL AS IN THE DIFF FILTER. The CLI asks
 * git only for `--diff-filter=MDRT`, which keeps the output short, but this
 * module does not rely on that. Each line is judged by its own status
 * letter, and a letter it does not recognise is refused rather than passed.
 * A guard that passes on input it does not understand is not a guard.
 *
 * The CLI is `../migration-immutability-gate.mjs`. The unit test beside this
 * file runs under `npm run test:retention`.
 */

/**
 * The directory the rule covers. The TRAILING SLASH is load-bearing: without
 * it, `cloudflare-worker/sql/migrations_old/…` would count as a migration.
 */
export const MIGRATIONS_DIR = 'cloudflare-worker/sql/migrations/';

/**
 * What the CLI asks git to report: Modified, Deleted, Renamed, Type-changed.
 * An added (A) or copied (C) file leaves every existing file byte-identical,
 * so neither is asked for, and neither is a violation if one is handed in.
 */
export const DIFF_FILTER = 'MDRT';

/** Status letters that leave every existing migration untouched. */
const ALLOWED = new Set(['A', 'C']);

/** Status letters this module can explain. Anything else is refused. */
const RULES = {
  M: 'an applied migration was edited',
  D: 'an applied migration was deleted',
  R: 'an applied migration was renamed; the ledger keys on the filename, so the renamed file would run again as new',
  T: 'an applied migration changed type (file, symlink or submodule)',
};

/**
 * Is this path a migration the rule covers? The runner reads the `*.sql`
 * files directly inside the folder (`listMigrationFiles` in
 * `migrationPlan.mjs`), so that is what counts: not a README beside them,
 * and not anything in a subfolder, which the runner never reads.
 */
export function isMigrationPath(path) {
  if (typeof path !== 'string' || !path.startsWith(MIGRATIONS_DIR)) return false;
  const name = path.slice(MIGRATIONS_DIR.length);
  return name.length > '.sql'.length && !name.includes('/') && name.endsWith('.sql');
}

/**
 * Parse `git diff --name-status` output as a person reads it: one change per
 * line, a status (a letter, optionally followed by a similarity score such as
 * `R100` or `C075`) and one path, or two for a rename or a copy, separated by
 * tabs. The tests speak this form because it is legible.
 */
export function parseNameStatus(text) {
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const [status, ...paths] = line.split('\t');
    const s = status.trim();
    out.push({ status: s, letter: s.charAt(0), paths });
  }
  return out;
}

/**
 * Parse `git diff --name-status -z`, which is what the CLI actually asks for.
 * Without `-z`, git quotes a path holding a non-ASCII byte, a tab or a quote
 * (`"cloudflare-worker/sql/migrations/\303\251.sql"`), and a quoted path does
 * not start with MIGRATIONS_DIR, so an edit to such a file would read as
 * outside the rule and pass. With `-z` every path arrives verbatim.
 *
 * The stream is status, NUL, path, NUL — and for a rename or a copy a second
 * path, NUL. A stream that ends mid-record is refused, not truncated.
 */
export function parseNameStatusZ(text) {
  const tokens = String(text ?? '').split('\0');
  if (tokens.length && tokens[tokens.length - 1] === '') tokens.pop();
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    const letter = status.charAt(0);
    const want = letter === 'R' || letter === 'C' ? 2 : 1;
    if (!status || i + want > tokens.length) {
      throw new Error(`git diff --name-status -z ended mid-record after '${status}'; refusing to judge a partial list`);
    }
    out.push({ status, letter, paths: tokens.slice(i, i + want) });
    i += want;
  }
  return out;
}

/**
 * Every change in `entries` (from either parser) that alters an existing
 * migration. A rename counts when EITHER end is a migration: moving one out of
 * the folder removes it from every fresh build, and moving one in under a new
 * name runs it again as new.
 */
export function findViolations(entries) {
  const violations = [];
  for (const entry of entries) {
    if (!entry.paths.some(isMigrationPath)) continue;
    if (ALLOWED.has(entry.letter)) continue;
    const rule = RULES[entry.letter]
      ?? `git reported this change as '${entry.status}', which this guard does not recognise, so it refuses it`;
    violations.push({ status: entry.status, path: entry.paths.join(' -> '), rule });
  }
  return violations;
}

/**
 * A base branch name the CLI may hand to git: a plain branch name only. No
 * leading dash (git would read it as an option), no `..`, and nothing a shell
 * or git would read as syntax.
 */
const REF_NAME = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;

/** A full commit id, and the all-zero id GitHub sends when there is none. */
const SHA = /^[0-9a-f]{40}$/;
const NO_SHA = /^0{40}$/;

/**
 * What to compare against. Two modes, chosen by the event, never by which
 * variable happens to be set:
 *
 *   · a pull request (or a local run): the base branch, GITHUB_BASE_REF, or
 *     `main` when there is none. Returns `{ ok, mode: 'branch', branch,
 *     remoteRef }`.
 *   · a push to main (GITHUB_EVENT_NAME=push): the commit main pointed at
 *     before this push, MIGRATION_GATE_BEFORE. Returns `{ ok, mode: 'push',
 *     sha, remoteRef: sha }`.
 *
 * WHY PUSHES ARE CHECKED AT ALL. Six of the eight edits D269 records arrived
 * in one commit pushed straight to main (1563f0aa8), not through a pull
 * request. A gate that ran on pull requests alone would have seen two of the
 * eight. On a push it cannot stop the edit, which is already on main, but it
 * can turn main red the minute it lands instead of at the next deploy's
 * warning.
 *
 * A push with no usable `before` is refused rather than downgraded to branch
 * mode: on main, `origin/main...HEAD` is empty, so the fallback would be a
 * pass over nothing.
 */
export function resolveBase(env) {
  const e = env || {};
  if (e.GITHUB_EVENT_NAME === 'push') {
    const before = typeof e.MIGRATION_GATE_BEFORE === 'string' ? e.MIGRATION_GATE_BEFORE.trim().toLowerCase() : '';
    if (!SHA.test(before) || NO_SHA.test(before)) {
      return {
        ok: false,
        reason: `a push needs MIGRATION_GATE_BEFORE, the commit main pointed at before it, and '${before}' is not one, so no base can be resolved`,
      };
    }
    return { ok: true, mode: 'push', sha: before, remoteRef: before };
  }
  const raw = typeof e.GITHUB_BASE_REF === 'string' ? e.GITHUB_BASE_REF.trim() : '';
  const branch = raw || 'main';
  if (!REF_NAME.test(branch)) {
    return { ok: false, reason: `GITHUB_BASE_REF '${raw}' is not a plain branch name, so no base can be resolved from it` };
  }
  return { ok: true, mode: 'branch', branch, remoteRef: `origin/${branch}` };
}

/**
 * The report the CLI prints when it finds violations. On a push the edit is
 * already on main, so the remedy is different and says so.
 */
export function formatViolations(violations, base, { onMain = false } = {}) {
  const n = violations.length;
  const lines = [
    `✖ migration-immutability-gate: ${n} applied migration${n === 1 ? '' : 's'} changed against ${base}.`,
    '',
  ];
  for (const v of violations) lines.push(`  ${v.status}\t${v.path}`, `      ${v.rule}`);
  lines.push(
    '',
    '  A migration in the ledger never runs again, so this change reaches no database that',
    '  already has it. It reaches only databases built from the files, which then disagree',
    '  with production.',
  );
  if (onMain) {
    lines.push(
      '  This is already on main: revert the edit in a new commit, and put the change in a',
      '  NEW file under cloudflare-worker/sql/migrations/. There is no bypass flag (D269).',
    );
  } else {
    lines.push(
      '  Put the change in a NEW file under cloudflare-worker/sql/migrations/ instead.',
      '  There is no bypass flag (D269).',
    );
  }
  return lines.join('\n');
}
