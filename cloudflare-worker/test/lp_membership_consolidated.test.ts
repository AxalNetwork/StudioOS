/**
 * LP membership — one predicate, everywhere.
 *
 * "Is this caller an LP?" was asked at thirteen sites with two different
 * answers. Eleven matched `user_id` alone; two also matched the account email.
 * The result was not a leak but a denial, and an incoherent one: a legacy LP
 * whose `user_id` was never backfilled reached their fund metrics and capital
 * calls through two doors and was refused their LP record, their LP list,
 * their LP reports and their portfolio through the other eleven. `/lp-portal`
 * asked it both ways inside a single handler.
 *
 * These tests read source rather than exercising routes, because the failure
 * they guard is a re-inlined predicate: someone writes `lp.user_id = ?` in a
 * new handler and the split silently reopens. That produces working software
 * that quietly refuses a real LP their own fiduciary records — the same shape
 * of bug, undetectable from the outside.
 *
 * They also hold up the ALLOWLIST entry for `scope.sql` in
 * scripts/check-sql-unsafe.mjs: the interpolation is safe only because
 * tenancyScope.ts interpolates nothing but `alias`, and every call site passes
 * a string literal for it. Both are asserted below rather than asserted in a
 * comment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Comments stripped before any assertion runs — a scanner, not a regex.
 *
 * A regex stripper reads the `/*` inside a Hono route pattern as a
 * block-comment opener and eats the rest of the file. Several assertions in
 * this repo have passed or failed on prose rather than code; the scanner is
 * the default in both the worker and frontend suites for that reason. Every
 * predicate this file looks for also appears in the prose above it.
 */
function stripComments(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const c = input[i], d = input[i + 1];
    if (c === '/' && d === '/') { while (i < input.length && input[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c;
      for (i++; i < input.length; ) {
        if (input[i] === '\\') { out += input.slice(i, i + 2); i += 2; continue; }
        out += input[i];
        const end = input[i] === q; i++;
        if (end) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const SRC = resolve(process.cwd(), 'cloudflare-worker/src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({
  path,
  rel: path.slice(SRC.length + 1),
  src: stripComments(readFileSync(path, 'utf8')),
}));

const file = (rel: string) => {
  const f = FILES.find((x) => x.rel === rel);
  assert.ok(f, `${rel} must exist`);
  return f!.src;
};

const scopeSrc = file('services/tenancyScope.ts');
const claimSrc = file('services/lpClaim.ts');

// ---------- no site may re-inline the predicate ----------

/**
 * The membership predicate, written by hand.
 *
 * Deliberately narrow: it matches a comparison of a `limited_partners`
 * ownership column against a bound parameter, which is what an inlined check
 * looks like and what the scope emits instead. tenancyScope.ts is the one
 * place allowed to contain it.
 */
const INLINED = [
  /\blp\.user_id\s*=\s*\?/,
  /\blimited_partners\s+WHERE\s+user_id\s*=\s*\?/i,
  /\blimited_partners\s+WHERE\s+fund_id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i,
];

/**
 * Files allowed to contain the raw predicate, each for a stated reason.
 * Keep this SHRINKING; a new entry needs an argument, not a line.
 */
const RAW_PREDICATE_ALLOWED = new Map<string, string>([
  ['services/tenancyScope.ts', 'the one place the predicate is defined'],
  ['services/lpClaim.ts', 'the UPDATE that writes user_id — it is the claim, not a read'],
  // A backfill run once against the whole table, not a per-caller gate: it
  // rebuilds users.role from LP standing for EVERY user, so there is no actor
  // to scope by and the scope's deny-by-default would empty the result.
  ['index.ts', 'the users.role backfill — table-wide, no caller to scope by'],
]);

test('no route or model hand-rolls the LP membership predicate', () => {
  const offenders: string[] = [];
  for (const f of FILES) {
    if (RAW_PREDICATE_ALLOWED.has(f.rel)) continue;
    for (const re of INLINED) {
      if (re.test(f.src)) { offenders.push(`${f.rel}  (${re})`); break; }
    }
  }
  assert.deepEqual(offenders, [],
    'these files ask the membership question themselves instead of through '
    + 'lpMembershipScope/lpSelfScope — that is how the two predicates diverged');
});

/**
 * Every backtick template in a file, so a scan can be restricted to the SQL
 * that actually touches a given table.
 *
 * Scanning whole files for `LOWER(email)` was the first version of the test
 * below and it was wrong: `users`, `team_invitations` and the calendar sync all
 * match addresses case-insensitively for reasons that have nothing to do with
 * LP membership. Matching a user by verified address is ordinary; matching a
 * `limited_partners` ROW by address is the thing under control here.
 */
function sqlTemplates(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '`') continue;
    let j = i + 1;
    for (; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === '`') break;
    }
    out.push(src.slice(i + 1, j));
    i = j;
  }
  return out;
}

test('no LP row is matched on email outside the scope module', () => {
  // funds.ts and spinout_lab.ts both shipped `OR LOWER(email) = LOWER(?)` with
  // no unclaimed-row test, which reaches a row whose user_id names another
  // account. The qualified form lives in tenancyScope.ts and lpClaim.ts only.
  const offenders: string[] = [];
  for (const f of FILES) {
    if (f.rel === 'services/tenancyScope.ts' || f.rel === 'services/lpClaim.ts') continue;
    if (f.rel === 'index.ts') continue; // the table-wide backfill, above
    for (const t of sqlTemplates(f.src)) {
      if (!/\blimited_partners\b/i.test(t)) continue;
      if (/LOWER\(\s*(?:lp\.)?email\s*\)\s*=\s*LOWER\(/i.test(t)) {
        offenders.push(`${f.rel}: ${t.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'these queries match an LP row on email themselves — the arm belongs to '
    + 'lpMembershipScope, which qualifies it with an unclaimed row and pairs it with a claim');
});

// ---------- the claim is paired with the grant ----------

test('every route that grants by email also claims on that request', () => {
  // The email arm is only defensible because reaching a row by email converts
  // it to an account link. A route that scopes without claiming leaves the
  // address as a standing grant, which is the thing the design rejects.
  //
  // Route files, not every file: models/ are library code and claiming inside
  // them would fire the same UPDATE three times for one /lp-portal request.
  // Their callers are checked separately, below.
  for (const f of FILES) {
    if (!f.rel.startsWith('routes/')) continue;
    if (!/\blp(?:Membership|Self)Scope\s*\(/.test(f.src)) continue;
    // admin_lp_applications asks about a THIRD PARTY (the applicant), so it
    // must not claim: linking a row as a side effect of an operator opening a
    // review would put the wrong actor in the audit trail.
    if (f.rel === 'routes/admin_lp_applications.ts') {
      assert.doesNotMatch(f.src, /claimLpRowsByEmail\s*\(/,
        'a reviewer opening an application must not claim the applicant\'s rows');
      continue;
    }
    assert.match(f.src, /claimLpRowsByEmail\s*\(/,
      `${f.rel} scopes LP rows but never claims them — the email grant would never expire`);
  }
});

test('the scoped models are only reached from a handler that claims', () => {
  // LPs.listByUser and Distributions.listByUser grant by email through
  // lpSelfScope but do not claim, so the claim has to happen in the handler
  // that calls them. If a second caller ever appears without one, the grant
  // becomes permanent on that path alone.
  const MODEL_CALLS = /\b(?:LPs|Distributions)\.listByUser\s*\(/;
  const callers = FILES.filter((f) => !f.rel.startsWith('models/') && MODEL_CALLS.test(f.src));
  assert.ok(callers.length > 0, 'the scoped models must have at least one caller');
  for (const f of callers) {
    assert.match(f.src, /claimLpRowsByEmail\s*\(/,
      `${f.rel} reads LP rows through a scoped model without claiming them first`);
  }
});

test('the claim never re-points a row that already has an owner', () => {
  // Without `user_id IS NULL` a shared or mistyped address moves an LP record
  // between accounts on a GET. Re-pointing an LP is an administrative act.
  const updates = claimSrc.match(/UPDATE limited_partners[\s\S]*?`/g) || [];
  assert.ok(updates.length > 0, 'lpClaim must contain the UPDATE');
  for (const u of updates) {
    assert.match(u, /WHERE\s+user_id\s+IS\s+NULL/i,
      'every claim UPDATE must be restricted to unclaimed rows');
  }
});

test('the claim and the scope agree on what "unclaimed" means', () => {
  // If these drift, a row the scope grants by email is one the claim refuses
  // to link — the grant becomes permanent by accident.
  assert.match(scopeSrc, /user_id IS NULL AND LOWER\(/,
    'the scope must qualify its email arm with an unclaimed row');
  assert.match(claimSrc, /user_id IS NULL AND LOWER\(email\) = LOWER\(\?\)/,
    'the claim must select the same rows the scope granted');
});

test('an empty address claims nothing', () => {
  // `LOWER(email) = LOWER('')` matches every row with an empty email, so a
  // blank address must be rejected before the UPDATE, not bound into it.
  assert.match(claimSrc, /if \(!addr[\s\S]{0,120}?return \{ claimed: 0 \}/,
    'lpClaim must bail out before the UPDATE when there is no address');
});

test('a failed claim cannot fail the read it accompanies', () => {
  // The caller is entitled to the rows whether or not the link write lands.
  assert.match(claimSrc, /catch\s*\([\s\S]{0,200}?return \{ claimed: 0 \}/,
    'the claim must swallow its own failure and report zero');
});

// ---------- what makes the sql.unsafe ALLOWLIST entry true ----------

test('the scope producers interpolate nothing but the alias', () => {
  // This is the whole basis for allow-listing `${scope.sql}` in
  // scripts/check-sql-unsafe.mjs. Every VALUE must reach SQL as a bound `?`.
  //
  // The four PRODUCERS only — andScope is excluded deliberately: it composes a
  // baseSql its caller supplies, so it interpolates by definition and is not
  // what the ALLOWLIST entry covers. Its output is never passed to sql.unsafe.
  const PRODUCERS = ['esignEnvelopeScope', 'fundGpScope', 'lpMembershipScope', 'lpSelfScope'];
  let checked = 0;
  for (const name of PRODUCERS) {
    const at = scopeSrc.indexOf(`export function ${name}(`);
    assert.notEqual(at, -1, `${name} must exist`);
    const after = scopeSrc.slice(at);
    const body = after.slice(0, after.indexOf('\n}') + 2);
    for (const m of body.matchAll(/\$\{([^}]+)\}/g)) {
      checked++;
      assert.equal(m[1].trim(), 'alias',
        `${name} interpolates ${JSON.stringify(m[1].trim())} — only the alias may be `
        + 'interpolated, or scope.sql stops being a constant and the ALLOWLIST entry stops being true');
    }
  }
  assert.ok(checked > 0, 'the producers build their fragments with templates');
});

test('andScope is never handed to sql.unsafe, which is why it may interpolate', () => {
  // The exemption above is only safe while nothing routes andScope's output
  // into the raw-query escape hatch.
  for (const f of FILES) {
    if (!/\bandScope\s*\(/.test(f.src)) continue;
    assert.doesNotMatch(f.src, /\.unsafe\(\s*`[^`]*\$\{[^}]*andScope/,
      `${f.rel} passes a composed andScope string to sql.unsafe`);
  }
});

test('every scope call site passes a string-literal alias, or none', () => {
  // The alias is the one interpolated input, so it must never be a variable.
  const CALL = /\b(?:lpMembershipScope|lpSelfScope|esignEnvelopeScope|fundGpScope)\s*\(/g;
  const bad: string[] = [];
  for (const f of FILES) {
    if (f.rel === 'services/tenancyScope.ts') continue;
    for (const m of f.src.matchAll(CALL)) {
      // Read the argument list by depth so a nested call cannot confuse it.
      let i = m.index! + m[0].length, depth = 1, args = '';
      for (; i < f.src.length && depth > 0; i++) {
        const ch = f.src[i];
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) break; }
        args += ch;
      }
      // Split on the top-level comma only.
      let d = 0, cut = -1;
      for (let j = 0; j < args.length; j++) {
        const ch = args[j];
        if (ch === '(' || ch === '{' || ch === '[') d++;
        else if (ch === ')' || ch === '}' || ch === ']') d--;
        else if (ch === ',' && d === 0) { cut = j; break; }
      }
      if (cut === -1) continue;               // one argument: default alias
      const alias = args.slice(cut + 1).trim();
      if (!/^'[A-Za-z_][A-Za-z0-9_]*'$|^"[A-Za-z_][A-Za-z0-9_]*"$/.test(alias)) {
        bad.push(`${f.rel}: alias ${JSON.stringify(alias)}`);
      }
    }
  }
  assert.deepEqual(bad, [],
    'a non-literal alias would let a caller shape the SQL text itself');
});

// ---------- the self/administrative split is real ----------

test('the self-view surfaces use lpSelfScope, not the administrative one', () => {
  // An admin opening /lp-portal or /liquidity/my-portfolio must see their own
  // positions. ALL_ROWS there does not grant oversight, it sums every LP's
  // commitments into one operator's TVPI and calls it their portfolio.
  for (const rel of ['models/funds.ts', 'models/distributions.ts']) {
    assert.match(file(rel), /lpSelfScope\s*\(/, `${rel} backs a self-view`);
    assert.doesNotMatch(file(rel), /lpMembershipScope\s*\(/,
      `${rel} must not widen a personal view to every LP row`);
  }
  const liq = file('routes/liquidity.ts');
  assert.match(liq, /lpSelfScope\s*\(/);
  assert.doesNotMatch(liq, /lpMembershipScope\s*\(/, 'my-portfolio is a self-view');
});

test('lpSelfScope has no unscoped escape at all', () => {
  const body = scopeSrc.slice(scopeSrc.indexOf('export function lpSelfScope'));
  const fn = body.slice(0, body.indexOf('\n}') + 2);
  assert.doesNotMatch(fn, /isUnscoped|ALL_ROWS/,
    'a self-view that can return every row is not a self-view');
});

// ---------- D1 is SQLite ----------

test('no worker SQL calls NOW(), which SQLite does not have', () => {
  // capital.ts shipped five of these — `updated_at = NOW()` and
  // `created_at, updated_at) VALUES (..., NOW(), NOW())` — MySQL/Postgres
  // syntax against a SQLite database. Every one threw `no such function: NOW`,
  // which meant POST /api/capital/investors and POST /api/capital/calls/:id/pay
  // both 500'd in production. The route tests did not catch it because their
  // D1 stub matched on SQL text and swallowed writes; they now run a real
  // database, and this guard states the rule directly so a future INSERT
  // cannot reintroduce it.
  const offenders: string[] = [];
  for (const f of FILES) {
    for (const t of sqlTemplates(f.src)) {
      if (/\bNOW\s*\(\s*\)/.test(t)) {
        offenders.push(`${f.rel}: ${t.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    "use datetime('now') — D1 is SQLite and has no NOW()");
});
