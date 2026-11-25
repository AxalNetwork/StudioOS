/**
 * D8526 (#8526) — the company-scope inventory and its guard (`scripts/build-company-scope-inventory.mjs`).
 *
 * The inventory is read from the code: every mounted route that reads the selected company, its kind (filter or
 * target) and the checks that authorize a target. The guard fails on a reader missing from the ledger
 * (`scripts/baselines/company-scope/`), a stale or re-kinded entry, and a target with no check of its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore — a .mjs script, typed loosely here
import { companyScopeInventory, findings, kindOf, LEDGER, ledgerFile, EXTRA_CHECKS, READS_SELECTION } from '../../scripts/build-company-scope-inventory.mjs';
// @ts-ignore
import { readSplit } from '../../scripts/lib/splitLedger.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rows = companyScopeInventory(ROOT.replace(/\/$/, ''));
const ledger = readSplit(LEDGER, ledgerFile);

test('the inventory passes on this tree: every reader is in the ledger with its kind, and every target names a check', () => {
  assert.ok(rows.length > 500, `only ${rows.length} routes read the selection; the reading lost its reach`);
  assert.deepEqual(findings(rows, ledger), []);
  for (const r of rows.filter((x: any) => x.kind === 'target')) assert.ok(r.checks.length, `${r.key} names no check`);
  assert.equal(Object.keys(ledger).length, rows.length);
});

test('known routes are read as what they are: the cap table record as a target with its gates, a list as a filter', () => {
  const by = (k: string) => rows.find((r: any) => r.key === k);
  const record = by('GET /api/captable/record/:projectId');
  assert.equal(record?.kind, 'target');
  assert.ok(record.checks.includes('getProjectMembershipRole'), record?.checks.join());
  // These five reach `canAccessProject` only through `canReadProject` / `canWriteProject`, one call deeper than the
  // auth inventory's reading: without EXTRA_CHECKS each would read as authorized by the active company alone.
  for (const k of ['GET /api/captable/record/:projectId/export.csv', 'GET /api/captable/record/:projectId/history',
    'GET /api/captable/record/:projectId/closes/:closeUid', 'GET /api/captable/scenarios/by-project/:projectId/today',
    'POST /api/captable/scenarios/by-project/:projectId/simulate']) {
    const r = by(k);
    assert.equal(r?.kind, 'target', k);
    assert.ok(r.checks.some((c: string) => EXTRA_CHECKS.includes(c)), `${k}: ${r?.checks.join()}`);
  }
  const download = by('POST /api/data-room/:projectUid/files/:uid/download');
  assert.equal(download?.kind, 'target');
  assert.ok(rows.some((r: any) => r.kind === 'filter'), 'no filter at all');
  for (const r of rows.filter((x: any) => x.kind === 'filter')) assert.ok(r.method === 'GET' && !/:[A-Za-z_]/.test(r.path), r.key);
});

test('reading the selection: the resolver, the context helper, the header constant or the header itself', () => {
  for (const src of ["resolveActiveCompany(c.env, user, raw)", "await activeCompanyFor(c, user)", "c.req.header(ACTIVE_COMPANY_HEADER)", "c.req.header('X-Company-Id')", 'c.req.header("x-company-id")']) {
    assert.match(src, READS_SELECTION, src);
  }
  assert.doesNotMatch("const companyId = project.company_id", READS_SELECTION);
});

test('kind: a record in the path or a write is a target; a GET with no record is a filter', () => {
  assert.equal(kindOf('GET', '/api/projects'), 'filter');
  assert.equal(kindOf('GET', '/api/projects/:id'), 'target');
  assert.equal(kindOf('POST', '/api/projects'), 'target');
  assert.equal(kindOf('DELETE', '/api/x/:uid/y'), 'target');
});

test('the guard fails on a new reader, a stale entry, a changed kind and a target with no check of its own', () => {
  const row = (key: string, kind: string, checks: string[]) => ({ key, method: key.split(' ')[0], path: key.split(' ')[1], file: 'cloudflare-worker/src/routes/x.ts', line: 1, kind, checks });
  const fresh = row('GET /api/x/:id', 'target', ['canAccessProject']);
  assert.match(findings([fresh], {}).join('\n'), /GET \/api\/x\/:id .* is not in scripts\/baselines\/company-scope\//);
  assert.deepEqual(findings([fresh], { 'GET /api/x/:id': { kind: 'target' } }), []);
  assert.match(findings([], { 'GET /api/x/:id': { kind: 'target' } }).join('\n'), /no longer reads the selected company/);
  assert.match(findings([fresh], { 'GET /api/x/:id': { kind: 'filter' } }).join('\n'), /the ledger says filter, the route is now a target/);
  const trusting = row('POST /api/x/:id', 'target', []);
  assert.match(findings([trusting], { 'POST /api/x/:id': { kind: 'target' } }).join('\n'), /its authorization would be the active company alone/);
  assert.match(findings([], { 'GET /api/y': { kind: 'list' } }).join('\n'), /kind must be one of filter, target/);
});

test('the guard runs in the full suite, and the inventory itself is never committed', () => {
  const guards = JSON.parse(readFileSync(join(ROOT, 'scripts/guard-commands.json'), 'utf8'));
  const g = guards.find((x: any) => x.id === 'build-company-scope-inventory');
  assert.deepEqual(g?.command, ['node', 'scripts/build-company-scope-inventory.mjs', '--check']);
  assert.notEqual(g.full, false);
  assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /^documentation\/architecture\/COMPANY_SCOPE_INVENTORY\.json$/m);
});
