#!/usr/bin/env node
/**
 * Insert the one account a freshly provisioned branch starts with (D.3).
 *
 * WHY THIS IS SQL AND NOT AN API CALL. `admin.ts` refuses to mint an admin —
 * "the only way to grant admin is via direct SQL" — and no migration seeds a
 * user, so on a brand-new branch database there is nobody who can sign in and
 * therefore nobody who can invite anybody. The licence principal is the
 * bootstrap, and it is one row.
 *
 * `INSERT OR IGNORE`, KEYED ON EMAIL, so a re-run after a later step failed
 * does not create a second principal or fail the whole provisioning run. The
 * step is idempotent because provisioning is resumable.
 *
 * THE ROW HAS NO PASSWORD. It is seeded active with `role='admin'` and no
 * credential: the principal signs in through the magic link or Google, which
 * is how every other account on the platform arrives. Writing a password here
 * would mean this workflow's log, or the secret that fed it, was briefly the
 * credential to a subsidiary's console.
 *
 * Inputs from the environment: BRANCH, PRINCIPAL_EMAIL, PRINCIPAL_NAME.
 * A missing PRINCIPAL_EMAIL is a WARNING, not a failure — a branch with no
 * principal yet is provisionable, and HQ can seed one later; a provisioning
 * run that failed at the last step over a missing optional input would leave
 * every resource created and the registry unwritten.
 */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRANCH_CODE_RE } from './lib/branchConfig.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = 'wrangler@4.131.0';

const die = (msg) => { console.error(`✗ seed-branch-principal: ${msg}`); process.exit(1); };

/**
 * A SQLite string literal — doubling the quote, and REFUSING the characters
 * whose meaning depends on which SQL dialect is reading.
 *
 * WHY IT REFUSES RATHER THAN ESCAPING MORE. In SQLite a backslash inside a
 * string literal is just a backslash; in MySQL it is an escape. Doubling the
 * quote is therefore complete *for SQLite* and would be incomplete the day
 * this statement were pointed anywhere else — and `wrangler d1 execute
 * --command` takes no bindings, so this function is the whole defence. A
 * hand-rolled escaper that is correct only under an assumption nobody restates
 * is the shape to remove, not to extend: escaping the backslash as well would
 * be worse, because `C:\x` would then be stored with two of them.
 *
 * Nothing a principal has contains one. An email address is already refused by
 * the caller unless it matches `x@y.z`, and a person's name — accents,
 * apostrophes, hyphens and all — passes untouched. A value that does not is
 * named in the refusal rather than silently mangled.
 */
const UNSAFE_IN_LITERAL = /[\\\u0000-\u001f\u007f]/;

export function sqlLiteral(value) {
  const s = String(value ?? '');
  if (UNSAFE_IN_LITERAL.test(s)) {
    throw new Error(
      `${JSON.stringify(s)} carries a backslash or a control character. Those are not escaped `
      + 'here because their meaning is dialect-dependent, so the value is refused rather than '
      + 'rewritten. Re-run with a plain name.',
    );
  }
  // Doubling, spelled as a split/join: the operation is "put a quote between
  // every piece", which is what a SQLite literal means, rather than a pattern
  // substitution that a reader has to check for completeness.
  return `'${s.split("'").join("''")}'`;
}

/**
 * The statement, built as a pure function so a test can read it without a
 * network. Values are literals rather than `?` parameters because
 * `wrangler d1 execute --command` takes no bindings — which is exactly why
 * `sqlLiteral` exists and is tested against a quote.
 */
export function principalSql(email, name) {
  return (
    'INSERT OR IGNORE INTO users (email, name, role, is_active, created_at) '
    + `VALUES (${sqlLiteral(email)}, ${sqlLiteral(name)}, 'admin', 1, datetime('now'))`
  );
}

function main() {
  try {
    seed();
  } catch (e) {
    // `sqlLiteral` throws rather than exiting so a test can call it; the CLI is
    // where a refusal becomes a failed step with the reason on screen.
    die(e.message);
  }
}

function seed() {
  const code = String(process.env.BRANCH ?? '').trim();
  if (!BRANCH_CODE_RE.test(code)) die(`"${code}" is not a branch code`);

  const email = String(process.env.PRINCIPAL_EMAIL ?? '').trim();
  const name = String(process.env.PRINCIPAL_NAME ?? '').trim() || 'Licence principal';
  if (!email) {
    console.warn(
      '::warning::PRINCIPAL_EMAIL is unset, so no principal was seeded. The branch has NO account '
      + 'and nobody can sign in to it until HQ seeds one. Everything else provisioned normally.',
    );
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die(`PRINCIPAL_EMAIL ${JSON.stringify(email)} is not an email`);

  // `--config` is passed explicitly on every wrangler call in provisioning, so
  // the database is the one the generated config names and the question of
  // whether a bare name resolves through the account never arises.
  execFileSync('npx', [
    '--yes', WRANGLER, 'd1', 'execute', `studioos-${code}`,
    '--config', `wrangler.branch.${code}.toml`,
    '--remote', '--command', principalSql(email, name),
  ], { cwd: ROOT, stdio: 'inherit' });

  console.log(`✓ seeded the licence principal on studioos-${code}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
