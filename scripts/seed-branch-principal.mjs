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

/** SQLite string literal: the only escape inside one is a doubled quote. */
export function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
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
