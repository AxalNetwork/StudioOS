/**
 * #4609 — the introduction destination contract, both halves of it.
 *
 * `cloudflare-worker/src/services/introDestination.ts` writes a destination and
 * `frontend/src/lib/introDestination.js` reads one. Each is useless if the
 * other disagrees, and before this issue there were NINE hand-written URLs in
 * two incompatible shapes across three files, each honoured by a different
 * component. This asserts the pair round-trips, that the legacy shape still
 * resolves, and that each surface claims only its own records.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTRO_ZONE, introDestination, introTargetIsMine, legacyZonePath, resolveIntroTarget,
} from '../src/lib/introDestination.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const WORKER_MODULE = read('../../cloudflare-worker/src/services/introDestination.ts');
const UID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

test('a built destination resolves back to the record and the system it came from', () => {
  for (const kind of ['proposition', 'request']) {
    const url = introDestination(kind, UID);
    assert.equal(url, `${INTRO_ZONE}?intro=${UID}&kind=${kind}`);
    // The resolver takes the query, as a component holds it.
    const target = resolveIntroTarget(url.slice(url.indexOf('?')));
    assert.deepEqual(target, { uid: UID, kind });
    // Mutation checked: drop `kind` from the builder → the round trip returns
    // `kind: null` and both surfaces claim the uid, which is the ambiguity this
    // whole contract exists to remove.
    assert.equal(introTargetIsMine(target, kind), true);
    assert.equal(introTargetIsMine(target, kind === 'proposition' ? 'request' : 'proposition'), false);
  }
});

test('the Worker and the page agree on the zone and on the two kinds', () => {
  // ONE PATH, NAMED IN BOTH FILES. The bug was two paths: `/network` with
  // `?tab=` (five sites) and `/network/introductions` (four), each honoured by
  // a different component.
  assert.equal(INTRO_ZONE, '/network/introductions');
  assert.match(WORKER_MODULE, /export const INTRO_ZONE = '\/network\/introductions';/);
  assert.match(WORKER_MODULE, /export type IntroKind = 'proposition' \| 'request';/);
  // The builder's own shape, so a change on one side fails here rather than in
  // production on whichever licence reads the other.
  assert.match(WORKER_MODULE, /\$\{INTRO_ZONE\}\?\$\{INTRO_PARAM\}=\$\{encodeURIComponent\(id\)\}&\$\{INTRO_KIND_PARAM\}=\$\{kind\}/);
});

test('a malformed uid degrades to the zone rather than to a URL carrying junk', () => {
  for (const bad of ['', '   ', null, undefined, 'a uid with spaces', '<script>', 'x'.repeat(65)]) {
    assert.equal(introDestination('proposition', bad), INTRO_ZONE, String(bad));
  }
  // And a query naming no record resolves to no record, not to an empty one.
  assert.deepEqual(resolveIntroTarget('?kind=proposition'), { uid: '', kind: null });
  assert.equal(introTargetIsMine({ uid: '', kind: 'proposition' }, 'proposition'), false);
});

test('a legacy notification URL still reaches its record, and both surfaces may claim it', () => {
  // The five sites that wrote this shape are gone, but the links they sent are
  // in people's inboxes for ever. No `kind`, so the kind is unknown — and an
  // unknown kind is claimable by both surfaces, which is exactly the
  // uid-matching behaviour that was there before `kind` existed.
  const legacy = resolveIntroTarget('?tab=introductions&intro=abc123');
  assert.deepEqual(legacy, { uid: 'abc123', kind: null });
  assert.equal(introTargetIsMine(legacy, 'proposition'), true);
  assert.equal(introTargetIsMine(legacy, 'request'), true);
  // An unrecognised kind is not a third system; it reads as unknown.
  assert.deepEqual(resolveIntroTarget('?intro=abc123&kind=banana'), { uid: 'abc123', kind: null });
});

test('a legacy `?tab=` link forwards to the zone it names, carrying the record', () => {
  // THIS IS WHAT PARTNER AND ADVISOR LOST. `NetworkWorkspace` resolves its zone
  // from the pathname, so on `/network` it rendered the overview and dropped
  // the uid. The forward is what makes an already-sent proposition link open
  // its record on every licence.
  assert.equal(legacyZonePath('?tab=introductions&intro=abc123'),
    '/network/introductions?intro=abc123');
  assert.equal(legacyZonePath('?tab=introductions&intro=abc123&kind=proposition'),
    '/network/introductions?intro=abc123&kind=proposition');
  assert.equal(legacyZonePath('?tab=relationships'), '/network/relationships');
  // `project_id` is another feature's and travels; `mode=workspace` is not the
  // destination contract's to carry.
  assert.equal(legacyZonePath('?tab=organizations&project_id=7'), '/network/organizations?project_id=7');
  assert.doesNotMatch(String(legacyZonePath('?tab=introductions&mode=workspace')), /mode/);
  // No `tab` is no forward: `/network` is a real address and renders its own
  // overview, which #3701 owns.
  for (const none of ['', '?intro=abc123', '?tab=nonsense', null]) {
    assert.equal(legacyZonePath(none), null, String(none));
  }
});

test('every notification in the Worker builds its link through the shared module', () => {
  // Mutation checked: restore any one hand-written template and this fails.
  for (const file of [
    '../../cloudflare-worker/src/routes/introductions.ts',
    '../../cloudflare-worker/src/services/introductions.ts',
    '../../cloudflare-worker/src/services/relationships.ts',
  ]) {
    const src = read(file);
    assert.doesNotMatch(src, /`\/network\?tab=introductions/, `${file} still writes a legacy destination`);
    assert.doesNotMatch(src, /`\/network\/introductions\?intro=\$\{/, `${file} still builds its own path`);
    assert.match(src, /(propositionDestination|requestDestination)\(/, `${file} does not use the shared builder`);
  }
  // The two systems are named apart at the call site, not merged into one.
  assert.match(read('../../cloudflare-worker/src/services/relationships.ts'), /const introLink = \(u: string\) => requestDestination\(u\);/);
});

test('the teammate desk no longer reports a proposition as a missing request', () => {
  // The desk matched `?intro=` against its own rows and said "that request is
  // no longer here" when it did not find it — so every proposition link made
  // it announce the loss of a record that was never its own and was sitting
  // intact on the body below it.
  const desk = read('../src/pages/relationships/IntroductionsDesk.jsx');
  assert.match(desk, /introTargetIsMine\(target, 'request'\) \? target\.uid : ''/);
  const investor = read('../src/pages/investor/InvestorNetworkWorkspace.jsx');
  assert.match(investor, /introTargetIsMine\(deepLink, 'proposition'\) \? deepLink\.uid : ''/);
});
