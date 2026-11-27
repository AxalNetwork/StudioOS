import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adapterRead, draftState, linkedCardCoverage, nextPitchStep, pitchVersionHref, selectedPitchVersion, versionReadiness,
} from '../src/pages/raise/pitch/pitchHomeModel.js';
import { pitchFocusMode } from '../src/pages/raise/pitch/pitchRoutes.js';
import { investorActivity } from '../src/pages/raise/pitch/pitchOverviewModel.js';

const current = { id: 31, version: 7, is_current: true };
const checked = (counts) => new Map([[31, { checked: true, counts }]]);
const checks = { backed: 3, founders_figure: 0, mismatch: 0, not_backed: 0 };
const empty = draftState({ status: 'ok', data: { cards: [], doc: null } });
const working = draftState({ status: 'ok', data: { cards: [{ uid: 'cover' }], doc: null, updated_at: '2026-11-11' } });
const readLinks = (...links) => ({ status: 'ok', data: { links } });
const step = (input = {}) => nextPitchStep({ current, readiness: versionReadiness(checked(checks), current), draft: empty,
  links: readLinks(), readOnly: false, ...input });

test('PS-02 gives the unchecked or flagged saved version the one action even when a draft exists', () => {
  const unchecked = versionReadiness(new Map([[31, { checked: false }]]), current);
  const issues = versionReadiness(checked({ ...checks, mismatch: 1 }), current);
  assert.match(step({ readiness: unchecked, draft: working }).title, /Review v7 before sharing/);
  assert.match(step({ readiness: issues, draft: working }).title, /flagged figures in v7/);
  assert.equal(step({ readiness: issues, draft: working }).path, '/raise/pitch/review');
});

test('PS-02 opens an actual draft before suggesting sharing a checked version', () => {
  assert.equal(working.kind, 'saved');
  assert.equal(working.at, '2026-11-11');
  assert.equal(draftState({ status: 'ok', data: { cards: [], doc: { rev: 1 } } }).kind, 'saved');
  assert.equal(step({ draft: working }).kind, 'draft');
  assert.equal(step().kind, 'share');
  assert.equal(step({ links: readLinks({ status: 'withdrawn' }) }).kind, 'share');
  assert.equal(step({ links: readLinks({ status: 'live' }) }), null);
});

test('no action is invented from a read that is pending, missing, unavailable or refused', () => {
  for (const kind of ['loading', 'unavailable', 'refused']) {
    assert.equal(step({ readiness: { kind } }), null);
    assert.equal(step({ draft: { kind } }), null);
    assert.equal(step({ links: { status: kind } }), null);
  }
  assert.equal(step({ links: readLinks({}) }), null);
  assert.equal(step({ current: null }), null);
  assert.equal(step({ readOnly: true }), null);
  assert.equal(versionReadiness(new Map(), current).kind, 'unavailable');
  assert.equal(versionReadiness('error', current).kind, 'unavailable');
  assert.equal(versionReadiness('refused', current).kind, 'refused');
  assert.deepEqual(adapterRead({ available: false, status: 403 }), { status: 'refused', data: null });
  assert.equal(draftState({ status: 'ok', data: {} }).kind, 'unavailable');
});

test('source coverage counts only cards with all their recorded figures linked', () => {
  const deck = { slides: [{}, {}, {}] };
  assert.deepEqual(linkedCardCoverage(deck, { figures: [
    { card: 0, state: 'linked' }, { card: 0, state: 'linked' }, { card: 1, state: 'linked' }, { card: 1, state: 'uncited' },
  ] }), { linked: 1, total: 3 });
  assert.deepEqual(linkedCardCoverage(deck, { figures: [] }), { linked: 0, total: 3 });
  assert.equal(linkedCardCoverage(deck, { figures: [{ card: 4, state: 'linked' }] }), null);
  assert.equal(linkedCardCoverage(deck, null), null);
});

test('navigation keeps focused paths distinct and saved-version links scoped to the venture', () => {
  const versions = [current, { id: 30, version: 6 }];
  assert.equal(pitchFocusMode('/raise/pitch/edit'), true);
  assert.equal(pitchFocusMode('/raise/pitch/present/'), true);
  assert.equal(pitchFocusMode('/raise/pitch/decks'), false);
  assert.equal(pitchFocusMode('/raise/pitch'), false);
  assert.equal(pitchVersionHref('/raise/pitch/review', '?project_id=7', 30), '/raise/pitch/review?project_id=7&deck=30');
  assert.equal(selectedPitchVersion(versions, '30').version, 6);
  assert.equal(selectedPitchVersion(versions, '99'), null);
  assert.equal(selectedPitchVersion(versions, null), current);
});

test('recent activity can label a recorded unopened link with its actual version', () => {
  const link = { id: 1, analytics: { views: 0 }, created_at: '2026-11-12T12:00:00Z' };
  const [row] = investorActivity({ version: 6, links: [link] }, undefined, { showUnopened: true });
  assert.equal(row.version, 6);
  assert.equal(row.line, 'Link created · Not opened');
  assert.equal(investorActivity({ version: 6, links: [{ ...link, analytics: {} }] }, undefined, { showUnopened: true }).length, 0);
});
