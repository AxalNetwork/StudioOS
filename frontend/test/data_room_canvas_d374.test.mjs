/**
 * D374 — the readings the founder's data room shares, which outlived the page
 * they were written for. D1109 (#2989, part 8 of #2456) retired that page
 * (`DataRoomPage.jsx`, the "Data Room" backlog canvas's founder view) and its
 * stat strip, tree, activity filters and download label with it; the Data room
 * tool draws those from its own models now (`raise/dataroom/`). What stays is
 * the access rule every investor read applies, restated, and the upload
 * queue's refusal. Those run here in Node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { accessNow, grantAttribution, noAccessReason, queueRefusal, tierOf } from '../src/pages/raise/dataRoomRead.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const reading = read('../src/pages/raise/dataRoomRead.js');

test('with access now is the worker’s gate restated: grant for open, grant and NDA for nda', () => {
  const grants = [
    { uid: 'g1', status: 'active', nda_signed: true },
    { uid: 'g2', status: 'active', nda_signed: false },
    { uid: 'g3', status: 'revoked', nda_signed: true },
  ];
  assert.deepEqual(accessNow({ visibility: 'open' }, grants).map((g) => g.uid), ['g1', 'g2']);
  assert.deepEqual(accessNow({ visibility: 'nda' }, grants).map((g) => g.uid), ['g1']);
  assert.deepEqual(accessNow({ visibility: 'nda' }, [grants[1]]), []);
  assert.match(noAccessReason({ visibility: 'nda' }, [grants[1]]), /needs a signed NDA/);
  assert.match(noAccessReason({ visibility: 'open' }, []), /not shared with anyone yet/);
  assert.match(noAccessReason({ visibility: 'open', access_tier: 'nobody' }, grants), /private to you/);
  assert.equal(tierOf({}), 'invited');
});

test('the queue refuses a file over the cap before it is sent', () => {
  assert.equal(queueRefusal({ size: 20 * 1024 * 1024 }, 20), null);
  assert.equal(queueRefusal({ size: 20 * 1024 * 1024 + 1 }, 20), 'Larger than 20 MB');
  assert.equal(queueRefusal(null, 20), 'No file');
});

test('a grant names who made it, and an older grant with no name says so', () => {
  assert.equal(grantAttribution({ granted_by_name: 'A. Founder', granted_by_role: 'founder' }), 'Granted by A. Founder (founder)');
  assert.equal(grantAttribution({}), 'Granted by Not recorded');
});

test('D1109: the page these readings were written for is gone, and so are its own helpers', () => {
  assert.equal(existsSync(new URL('../src/pages/raise/DataRoomPage.jsx', import.meta.url)), false);
  for (const gone of ['roomStats', 'folderTree', 'filesUnder', 'AUDIT_FILTERS', 'auditMatches', 'auditLine', 'downloadsLabel', 'ACCESS_TIERS']) {
    assert.doesNotMatch(reading, new RegExp(`export (function|const) ${gone}\\b`), `${gone} outlived the retired page`);
  }
  // The backlog canvas the page was built to is superseded by DR1–DR24 (D1101).
  assert.equal(existsSync(new URL('../../design/canvases/backlog/Data Room.dc.html', import.meta.url)), false);
});
