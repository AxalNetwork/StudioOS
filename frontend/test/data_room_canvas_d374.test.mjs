/**
 * D374 — the founder's data room, held to the "Data Room" canvas's founder
 * view at both ends: the canvas draws each element and the page renders it,
 * or the page says why it does not. The readings that decide a count, a gate
 * and a filter run here in Node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCESS_TIERS, AUDIT_FILTERS, accessNow, auditLine, auditMatches, downloadsLabel,
  filesUnder, folderTree, noAccessReason, queueRefusal, roomStats,
} from '../src/pages/raise/dataRoomRead.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CANVAS = read('../../design/canvases/backlog/Data Room.dc.html');
const page = read('../src/pages/raise/DataRoomPage.jsx');
const reading = read('../src/pages/raise/dataRoomRead.js');
const both = page + reading;

function bothEnds(drawn, rendered = drawn) {
  assert.ok(CANVAS.includes(drawn), `the canvas no longer draws: ${drawn}`);
  assert.ok(both.includes(rendered), `the page no longer renders: ${rendered}`);
}

test('the page renders every founder-view element the canvas draws', () => {
  for (const s of [
    'Files', 'NDA-gated', 'Investors with access',
    'Upload files', 'Drag files here, or click to browse',
    'Folders', 'New folder', 'Folder settings', 'File settings',
    'Who can see this', 'Everyone invited', 'Committed only', 'Private to you',
    'Require signed NDA', 'With access now',
    'Activity log', 'No activity of this kind yet',
    'downloaded', 'was blocked from',
  ]) bothEnds(s);
  assert.ok(CANVAS.includes("const AF = ['All','View','Download','NDA','Blocked'];"));
  assert.deepEqual(AUDIT_FILTERS, ['All', 'View', 'Download', 'NDA', 'Blocked']);
  // The canvas's third tile, restated as what the log counts.
  bothEnds("k:'Views this week'", 'Room opens this week');
});

test('what the canvas draws and the room cannot do is said, never drawn as working', () => {
  // The cap is the worker's 20 MB, not the canvas's 250.
  assert.ok(CANVAS.includes('up to 250 MB per file'));
  assert.doesNotMatch(both, /250 MB/);
  assert.match(page, /const MAX_MB = 20;/);
  // No watermark, no preview, and a gate change does not reach a saved copy.
  assert.ok(CANVAS.includes('Files are watermarked with the viewer'));
  assert.doesNotMatch(both, /are watermarked|watermarked with/i);
  assert.match(page, /Not watermarked\. A download is a link for one investor that works once and expires after two minutes/);
  assert.ok(CANVAS.includes('including for anyone with the file already open'));
  assert.match(page, /it does not reach a copy already saved/);
  // Per-file figure is downloads; the canvas's "N views" is never rendered as
  // a count, and its "Views this week" tile is not claimed.
  assert.ok(CANVAS.includes('{{ fi.views }}'));
  assert.doesNotMatch(both, /\} views?\b|views this week|\.views\b/i);
  // Two tiers are drawn as not built, each with its reason.
  const unbuilt = ACCESS_TIERS.filter((t) => !t.built).map((t) => t.label);
  assert.deepEqual(unbuilt, ['Committed only', 'Private to you']);
  for (const t of ACCESS_TIERS.filter((x) => !x.built)) assert.match(t.note, /^Not built/);
  // NDA terms have no store.
  assert.match(page, /<Unrecorded reason="The mutual NDA is signed through the e-sign rail; its terms are not stored with this room\." \/>/);
  // The upload bar does not invent a percentage.
  assert.doesNotMatch(page, /pctLabel|%`|\d+%/);
});

test('the stat strip counts the room, and a missing week is Not recorded, never zero', () => {
  const room = {
    folders: [{ id: 1 }],
    files: [{ visibility: 'open' }, { visibility: 'nda' }, { visibility: 'nda' }],
    grants: [{ status: 'active', nda_signed: true }, { status: 'active', nda_signed: false }, { status: 'revoked', nda_signed: true }],
    week: { opened: 12, downloaded: 1, blocked: 3 },
  };
  assert.deepEqual(roomStats(room).map((s) => [s.k, s.v]), [
    ['Files', '3'], ['NDA-gated', '2'], ['Investors with access', '2'], ['Room opens this week', '12'],
  ]);
  assert.equal(roomStats(room)[2].sub, '1 with an NDA on file');
  assert.equal(roomStats(room)[3].sub, '1 download · 3 blocked');
  const noWeek = roomStats({ ...room, week: undefined });
  assert.equal(noWeek[3].v, null);
  assert.doesNotMatch(reading, /\|\| 0|\?\? 0/);
});

test('the tree nests folders, files sit in theirs, and an orphan or a loop lands at the root', () => {
  const folders = [
    { id: 1, uid: 'a', parent_id: null }, { id: 2, uid: 'b', parent_id: 1 },
    { id: 3, uid: 'c', parent_id: 99 }, { id: 4, uid: 'd', parent_id: 5 }, { id: 5, uid: 'e', parent_id: 4 },
  ];
  const files = [{ uid: 'f1', folder_id: 2 }, { uid: 'f2', folder_id: null }, { uid: 'f3', folder_id: 77 }, { uid: 'f4', folder_id: 1 }];
  const t = folderTree(folders, files);
  assert.deepEqual(t.folders.map((n) => n.folder.uid).sort(), ['a', 'c', 'd', 'e']);
  const a = t.folders.find((n) => n.folder.uid === 'a');
  assert.deepEqual(a.folders.map((n) => n.folder.uid), ['b']);
  assert.deepEqual(filesUnder(a).map((f) => f.uid).sort(), ['f1', 'f4']);
  assert.deepEqual(t.files.map((f) => f.uid).sort(), ['f2', 'f3']);
});

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
});

test('the activity filters read the log’s three actions, and NDA is the events on NDA files', () => {
  const ev = [
    { action: 'open_room', file_visibility: null },
    { action: 'download', file_visibility: 'open' },
    { action: 'download', file_visibility: 'nda' },
    { action: 'blocked', file_visibility: 'nda' },
  ];
  const pick = (f) => ev.map((e, i) => (auditMatches(e, f) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(pick('All'), [0, 1, 2, 3]);
  assert.deepEqual(pick('View'), [0]);
  assert.deepEqual(pick('Download'), [1, 2]);
  assert.deepEqual(pick('NDA'), [2, 3]);
  assert.deepEqual(pick('Blocked'), [3]);
  assert.equal(auditLine({ action: 'blocked', file_name: 'Term sheet.pdf' }).verb, 'was blocked from');
  assert.equal(auditLine({ action: 'download', file_name: null }).what, 'a file since deleted');
  assert.equal(auditLine({ action: 'something_new' }).verb, 'something_new');
});

test('a file’s figure is its downloads, and an absent count is not a zero', () => {
  assert.equal(downloadsLabel(0), '0 downloads');
  assert.equal(downloadsLabel(1), '1 download');
  assert.equal(downloadsLabel(undefined), null);
  assert.equal(downloadsLabel('x'), null);
  assert.match(page, /downloadsLabel\(file\.downloads\)/);
});

test('the queue refuses a file over the cap before it is sent, and sends one at a time', () => {
  assert.equal(queueRefusal({ size: 20 * 1024 * 1024 }, 20), null);
  assert.equal(queueRefusal({ size: 20 * 1024 * 1024 + 1 }, 20), 'Larger than 20 MB');
  assert.match(page, /queueRefusal\(file, MAX_MB\)/);
  assert.match(page, /type="file" multiple/);
  // Sequential: each upload is awaited inside the loop.
  const q = page.slice(page.indexOf('async function send('), page.indexOf('const label = {'));
  assert.match(q, /for \(let k = 0; k < rows\.length; k\+\+\)[\s\S]*await api\.dataRoomUploadFile\(/);
});

test('a folder’s gate is carried to its contents only when the founder asks, and says why', () => {
  assert.match(page, /api\.dataRoomUpdateFolder\(projectUid, selected\.uid, \{ visibility, \.\.\.\(carry \? \{ apply_to_contents: true \} : \{\}\) \}\)/);
  assert.match(page, /without this, marking the folder hides only its name/);
});

test('a failed read is Unreadable with a retry, never an empty room', () => {
  assert.match(page, /setState\('unreadable'\)/);
  assert.match(page, /<Unreadable\s+what="This data room"/);
  assert.match(page, /<Unreadable\s+what="Your projects"/);
  // The project list failing is not "No project yet.": the catch marks the
  // read failed, never an empty list, and that state is branched before the
  // empty one.
  const loadList = page.slice(page.indexOf('const loadProjects = useCallback'), page.indexOf('const body = useMemo'));
  assert.match(loadList, /\.catch\(\(e\) => \{ reportError\('data_room_projects_failed', e\); setProjectsFailed\(true\); \}\)/);
  assert.doesNotMatch(loadList.slice(loadList.indexOf('.catch(')), /setProjects\(\[\]\)/,
    'a failed project list became an empty one');
  const body = page.slice(page.indexOf('const body = useMemo'));
  assert.ok(body.indexOf('if (projectsFailed)') >= 0 && body.indexOf('if (projectsFailed)') < body.indexOf('No project yet.'));
});

test('no fixture from the canvas reaches the page', () => {
  for (const src of [page, reading]) {
    assert.doesNotMatch(src, /NovaCraft|Stellar Point|Marguerite|Aubry|Guillaume Lauzier|Series Seed/);
  }
});
