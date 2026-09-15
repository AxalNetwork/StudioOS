/**
 * `branch-provision.yml` — what can be asserted about a workflow that has
 * never run (D109).
 *
 * NOT "the YAML parses". The properties below are the ones whose absence would
 * be a real incident, and every one of them is checkable as text:
 *
 *   1. NO DISPATCHED INPUT REACHES A `run:` BLOCK AS `${{ }}`. This is the
 *      single most valuable assertion in the file. `${{ }}` is substituted
 *      before the shell parses the line, so a dispatched value carrying `;`
 *      runs as a command on a runner holding `CLOUDFLARE_API_TOKEN`. Semgrep
 *      caught exactly this on PR 3's workflow step; this is the regression
 *      guard for the whole class.
 *   2. NO WRANGLER CALL FALLS THROUGH TO `wrangler.toml`. Every one passes
 *      `--config wrangler.branch.<code>.toml`. A bare call would read HQ's
 *      config, whose `[[routes]]` carry the apex custom domains — deploying a
 *      branch with it would move `axal.vc` onto the branch Worker (leak L10).
 *   3. THE STEP ORDER HOLDS. The generator refuses without the registry file
 *      and the migrator refuses without the generated config, so the order is
 *      a correctness property, not a style one. Secrets before deploy because
 *      a Worker without them answers 503 on every request; deploy before
 *      smoke because there is nothing to smoke otherwise.
 *
 * The pure helpers the workflow calls are tested here too, because they are
 * where a shell would otherwise have interpolated a value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEntry } from '../../scripts/write-branch-registry.mjs';
import { principalSql, sqlLiteral } from '../../scripts/seed-branch-principal.mjs';
import { addServiceBinding, bindingName } from '../../scripts/open-branch-link-pr.mjs';
import { validateBranch } from '../../scripts/lib/branchConfig.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const WF = read('.github/workflows/branch-provision.yml');

/** Every `run:` block's body, as one string per step. */
function runBlocks(yaml) {
  const out = [];
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:- )?run: (\|)?\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (!m[2]) { out.push(m[3]); continue; }
    const indent = m[1].length + 2;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() && (lines[j].length - lines[j].trimStart().length) < indent) break;
      body.push(lines[j]);
    }
    out.push(body.join('\n'));
  }
  return out;
}

test('no dispatched input is interpolated into a shell script', () => {
  const blocks = runBlocks(WF);
  assert.ok(blocks.length >= 10, `expected the workflow to have run steps; found ${blocks.length}`);
  const offenders = blocks.filter((b) => /\$\{\{\s*(inputs|github\.event)\./.test(b));
  assert.deepEqual(
    offenders.map((b) => b.trim().split('\n')[0]), [],
    'a `run:` block interpolates a dispatched value — it must come through the job-level env: block instead, '
    + 'because ${{ }} is substituted before the shell parses the line',
  );
});

test('every input is declared in the job env and validated before use', () => {
  // The inputs the form declares...
  const declared = [...WF.matchAll(/^      ([a-z_]+):\n        description:/gm)].map((m) => m[1]);
  assert.ok(declared.includes('code') && declared.includes('licence_uid'));
  // ...each reaches the job as an env var.
  for (const input of declared) {
    assert.match(
      WF, new RegExp(`\\$\\{\\{ inputs\\.${input} \\}\\}`),
      `input ${input} is declared but never read`,
    );
  }
  // And the validation step checks the ones a shell will use.
  const validate = runBlocks(WF).find((b) => b.includes('fail()'));
  assert.ok(validate, 'there must be a step that validates the inputs');
  for (const v of ['BRANCH', 'BRANCH_NAME', 'LICENCE_UID', 'TERRITORY', 'D1_JURISDICTION', 'LOCATION_HINT', 'DO_JURISDICTION']) {
    assert.ok(validate.includes(`$${v}`), `${v} is not validated before it is used`);
  }
  assert.match(validate, /\^\[a-z\]\[a-z0-9-\]\{1,15\}\$/, 'the code must be checked against the same shape branchOf enforces');
});

test('no wrangler call may fall through to HQ\'s own config', () => {
  // Each wrangler invocation either names the branch config explicitly or is
  // one of the create calls, which take a resource name and no config at all.
  // Backslash continuations are joined FIRST. Without it the extractor stops
  // at the line end and reports a call as config-less when its `--config` is
  // on the next line — which is what this assertion did on its first run, and
  // is the same shape of mistake as measuring a guard by a whole-file offset.
  const joined = WF.replace(/\\\n\s*/g, ' ');
  const calls = [...joined.matchAll(/npx --yes wrangler@[\d.]+ (.*)$/gm)].map((m) => m[1]);
  assert.ok(calls.length >= 3, `expected wrangler calls; found ${calls.length}`);
  for (const call of calls) {
    const isCreate = /^("?\$\{args\[@\]\}"?|d1 (create|info)|kv namespace create|r2 bucket create|queues create|vectorize create)/.test(call.trim());
    const namesBranchConfig = call.includes('wrangler.branch.');
    assert.ok(
      isCreate || namesBranchConfig,
      `this wrangler call would read HQ's wrangler.toml, whose routes are the apex custom domains: ${call}`,
    );
  }
  assert.ok(
    !/--config wrangler\.toml/.test(WF),
    'branch provisioning must never name HQ\'s config',
  );
});

test('the steps run in the only order that works', () => {
  const at = (needle) => {
    const i = WF.indexOf(needle);
    assert.ok(i > 0, `step not found: ${needle}`);
    return i;
  };
  const registry = at('node scripts/write-branch-registry.mjs');
  const generate = at('node scripts/gen-branch-wrangler.mjs');
  const migrate = at('node scripts/migrate-d1.mjs --branch');
  const secrets = at('wrangler secret put');
  const deploy = at('name: Deploy the branch Worker');
  const smoke = at('name: Smoke the new host');

  // The generator refuses without the registry file; the migrator refuses
  // without the generated config. Both are real refusals in those scripts.
  assert.ok(registry < generate, 'the registry entry must be written before the config is generated');
  assert.ok(generate < migrate, 'the config must exist before a --branch migration');
  // A Worker deployed without JWT_SECRET answers 503 config_error on every
  // request: up, and refusing everything.
  assert.ok(secrets < deploy, 'secrets must be set before the deploy');
  assert.ok(deploy < smoke, 'there is nothing to smoke before the deploy');
});

test('the deploy retries and the smoke is not allowed to pass quietly', () => {
  assert.match(WF, /for attempt in 1 2 3/, 'a new Worker\'s first deploy needs the 10007 retry');
  assert.ok(!/continue-on-error/.test(WF), 'no step may swallow its own failure');
  assert.match(WF, /api\/health/, '"live" means /api/health answers, not "deployed"');
  assert.match(WF, /SMOKE_HOSTS:/, 'the smoke must target the new host, not the default pair');
});

test('the registry entry this writes is one validateBranch accepts', () => {
  const entry = buildEntry({
    BRANCH: 'fr', BRANCH_NAME: 'Axal VC France', LICENCE_UID: 'lic_fr_001',
    TERRITORY: 'FR, be,LU', D1_JURISDICTION: 'eu', LOCATION_HINT: 'weur',
    DO_JURISDICTION: 'eu', D1_ID: '00000000-0000-4000-8000-000000000001',
    KV_TOKENS: '0'.repeat(31) + '2', KV_RATE_LIMITS: '0'.repeat(31) + '3',
    BRANCH_CREATED_AT: '2026-09-15T00:00:00Z',
  });
  assert.deepEqual(validateBranch(entry), [], 'the entry must satisfy the same guard check-branch-config runs');
  assert.equal(entry.hostname, 'fr.axal.vc');
  assert.deepEqual(entry.territory, ['FR', 'BE', 'LU'], 'codes are normalised, so a stray case never reaches a screen');
  // `provisioning`, not `live`: the Worker is not deployed when this is
  // written, and a status ahead of the deploy is a claim rather than a record.
  assert.equal(entry.status, 'provisioning');
  // R2 follows D1 — EU storage for the database and not the documents would
  // be a residency claim true of half the personal data.
  assert.equal(entry.residency.r2_jurisdiction, 'eu');

  // 'none' is the form's way of saying unset and must not reach the file.
  const hinted = buildEntry({
    BRANCH: 'dubai', BRANCH_NAME: 'Axal VC UAE', LICENCE_UID: 'lic_ae', TERRITORY: 'AE',
    D1_JURISDICTION: 'none', LOCATION_HINT: 'apac', DO_JURISDICTION: 'none',
    D1_ID: '00000000-0000-4000-8000-000000000009',
    KV_TOKENS: '1'.repeat(32), KV_RATE_LIMITS: '2'.repeat(32),
  });
  assert.equal(hinted.residency.d1_jurisdiction, null);
  assert.equal(hinted.residency.location_hint, 'apac');
  assert.deepEqual(validateBranch(hinted), []);
});

test('a value whose escaping would be dialect-dependent is refused, not rewritten', () => {
  // A backslash is an escape in MySQL and a plain character in SQLite, so an
  // escaper that handled it would be wrong in one of the two. Refusing is the
  // only answer that is right in both, and nothing a principal has carries
  // one. Control characters go the same way.
  for (const bad of ['C:\\Users\\sam', 'back\\slash', 'line\nbreak', 'tab\there', 'nul\u0000']) {
    assert.throws(() => sqlLiteral(bad), /backslash or a control character/, `${JSON.stringify(bad)} must be refused`);
  }
  // The other direction, and the half that matters most: every ordinary name
  // still passes, accents and apostrophes included. A guard that refused
  // "Sophie O'Brien" would be a guard nobody could provision a branch with.
  for (const ok of ["Sophie O'Brien", 'Zoë Müller', 'Jean-Luc', 'Ana María', '李雷']) {
    assert.doesNotThrow(() => sqlLiteral(ok), `${ok} must pass`);
  }
});

test('the principal statement escapes a quote rather than ending the literal', () => {
  // `wrangler d1 execute --command` takes no bindings, so the values are
  // literals and the escape is the whole defence.
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  const sql = principalSql("sophie.o'brien@example.com", "Sophie O'Brien");
  assert.match(sql, /INSERT OR IGNORE INTO users/, 're-running provisioning must not create a second principal');
  assert.match(sql, /'sophie\.o''brien@example\.com'/);
  assert.match(sql, /'Sophie O''Brien'/);
  assert.match(sql, /'admin'/, 'the principal is the one admin a new branch has');
  // No password column is written: the principal signs in the way everyone
  // else does, so this workflow's log is never a credential.
  assert.ok(!/password/i.test(sql));
});

test('the HQ binding is added to BOTH tables, once', () => {
  const toml = [
    'name = "studioos"', 'main = "cloudflare-worker/src/index.ts"', '',
    '[[d1_databases]]', 'binding = "DB"', '',
    '[env.production]', 'name = "studioos"', '',
    '[[env.production.d1_databases]]', 'binding = "DB"', '',
  ].join('\n');

  const once = addServiceBinding(toml, 'fr');
  assert.equal(bindingName('fr'), 'BRANCH_FR');
  assert.equal(bindingName('nordics-2'), 'BRANCH_NORDICS_2');
  // Wrangler v2 does not inherit into [env.production]; a binding in one
  // table and not the other exists in dev and vanishes in production, which
  // the parity guard already refuses.
  assert.equal((once.match(/\[\[services\]\]/g) || []).length, 1);
  assert.equal((once.match(/\[\[env\.production\.services\]\]/g) || []).length, 1);
  assert.equal((once.match(/binding = "BRANCH_FR"/g) || []).length, 2);
  assert.match(once, /entrypoint = "HqEntrypoint"/);
  // The top-level block must land BEFORE [env.production] — appended after it
  // would silently become part of the production table.
  assert.ok(once.indexOf('[[services]]') < once.indexOf('[env.production]'));

  // Idempotent: a re-run after a failed push must not stack a second block,
  // which wrangler accepts and which makes the parity counts disagree.
  assert.equal(addServiceBinding(once, 'fr'), once);
});

test('the workflow and its scripts are on the record', () => {
  assert.match(read('.github/workflows/README.md'), /branch-provision\.yml/);
  const scripts = read('scripts/README.md');
  for (const s of ['write-branch-registry', 'seed-branch-principal', 'open-branch-link-pr']) {
    assert.match(scripts, new RegExp(s), `${s}.mjs must be listed in scripts/README.md`);
  }
});
