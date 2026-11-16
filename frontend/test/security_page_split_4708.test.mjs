/**
 * D4708 part 3 (#4708) — HQ Security's page was split into `pages/hq/security/` without a change in behaviour.
 *
 * What the split must keep: every name the page exported is still exported from the page's path (its importers are
 * unchanged); the page alone makes the requests and the view it renders makes none; and the list the source-reading
 * tests read (`_securitySource.mjs`) names files that exist, so a moved rule cannot drop out of those tests unseen.
 * Mutations checked: a re-export removed from `SecurityPage.jsx` (the export test fails); an `api.` call added to
 * `SecurityConsole.jsx` (the request test fails); a part renamed without the list (the list test fails).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { SECURITY_DIR, SECURITY_PAGE, SECURITY_PAGE_PARTS, missingParts, securityFile } from './_securitySource.mjs';
import * as page from '../src/pages/hq/SecurityPage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// The page's exports before the split (6814bb6163), by name.
const EXPORTED_BEFORE = [
  'default', 'SecurityConsole', 'UNAVAILABLE', 'EMPTY_CONTROLS', 'IDENTITY_KIND_LABEL', 'identityLine',
  'impersonationNote', 'AiSafety', 'TokenAnomalies', 'NotRecordedList', 'DsrSubject', 'DsrKindsNotRecorded',
  'actLeavesOperatorSignedIn', 'runSessionAct', 'SessionsPanel', 'securityEventsBar', 'dsrBranchesSentence',
  'Sanctions', 'drillSentence', 'backupSentence', 'BackupDr',
];

test('every name the page exported is still exported from its path', () => {
  assert.deepEqual(EXPORTED_BEFORE.filter((k) => !(k in page)), []);
  assert.equal(typeof page.default, 'function');
  assert.equal(typeof page.UNAVAILABLE, 'symbol');
});

test('the page makes the three reads and the acts; the view and its zones make no request', () => {
  const shell = codeOnly(read(SECURITY_PAGE));
  for (const call of ['api.hqSecurityOverview(', 'api.hqSecuritySessions(', 'api.hqGovernance(', 'adminMfaPolicyApi.get(']) {
    assert.ok(shell.includes(call), `the page no longer makes ${call}`);
  }
  assert.match(shell, /export async function runSessionAct\(/);
  for (const name of SECURITY_PAGE_PARTS) {
    const src = codeOnly(securityFile(name));
    assert.doesNotMatch(src, /\bapi\.|from '\.\.\/\.\.\/\.\.\/lib\/api/, `${SECURITY_DIR}/${name} makes a request`);
  }
});

test('the list the source-reading tests read names the files the page was split into', () => {
  assert.deepEqual(missingParts(), []);
  // Each part is reached from the page: imported or re-exported by it, or imported by the view it renders.
  const reach = read(SECURITY_PAGE) + securityFile('SecurityConsole.jsx');
  for (const name of SECURITY_PAGE_PARTS) {
    assert.ok(reach.includes(`/security/${name}'`) || reach.includes(`'./${name}'`), `${name} is no longer reached from the page`);
  }
});
