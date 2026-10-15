/** D694 PR 1: recording outcomes and Validate navigation meet at Customer research. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reviewPath, pillLabel } from '../src/lib/activeRecording.js';
import { liveRedirect } from '../src/pages/founder/RecordLivePage.jsx';
import { ProcessingStages } from '../src/pages/founder/RecordingView.jsx';
import { cycleTabs } from '../src/pages/cycles/cycleModel.js';
import { phoneIndex } from '../src/pages/cycles/validatePhone.js';

const read = (path) => readFileSync(path, 'utf8');

test('recording completion and discard preserve only a valid session venture', () => {
  assert.equal(reviewPath({ id: 7, interview_id: 41, project_id: 3 }), '/validate/customer-research?project_id=3');
  for (const session of [null, { id: 7 }, { id: 7, project_id: 'x' }, { id: 7, project_id: 0 }, { id: 7, project_id: -1 }]) {
    assert.equal(reviewPath(session), '/validate/customer-research');
  }
  assert.equal(liveRedirect({ phase: 'ready', session: { id: 7, project_id: 3 } }, '7'), '/validate/customer-research?project_id=3');
  assert.equal(liveRedirect({ phase: 'discarded', session: { id: 7, project_id: 3 } }, '7'), '/validate/customer-research?project_id=3');
  assert.equal(liveRedirect({ phase: 'discarded', session: null }, '7'), '/validate/customer-research');
});

test('ready pill and processing copy say where the recording lands', () => {
  assert.equal(pillLabel('ready', ''), 'Ready · see it in Interviews');
  const processing = renderToStaticMarkup(React.createElement(ProcessingStages, { processing: { stage: 'transcribing' } }));
  assert.match(processing, /Then it lands in Interviews\./);
  assert.doesNotMatch(processing, /review screen/);
  const pill = read('frontend/src/pages/founder/RecordingPill.jsx');
  assert.match(pill, /to=\{reviewPath\(state\.session\)\}/);
  assert.doesNotMatch(pill, /Open the review/);
  assert.doesNotMatch(pill, /state=\{\{ interview \}\}/);
});

test('Validate has only module tabs and its six phone index rows', () => {
  const cards = [{ slug: 'problem-discovery', name: 'Problem discovery' }, { slug: 'customer-research', name: 'Customer research' }];
  assert.deepEqual(cycleTabs('validate', cards, null, '?project_id=7').map((tab) => tab.name), ['Overview', 'Problem discovery', 'Customer research']);
  assert.deepEqual(phoneIndex({ figures: [], cards: [] }).map((row) => row.key), ['problem-discovery', 'customer-research', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments']);
  for (const [cycle, title] of [['build', 'Tools'], ['raise', 'Calls'], ['grow', 'Updates']]) {
    assert.equal(cycleTabs(cycle, cards)[1].name, title);
  }
});

test('the three breadcrumbs and review delete return to Customer research', () => {
  const review = read('frontend/src/pages/founder/InterviewReviewPage.jsx');
  const session = read('frontend/src/pages/founder/InterviewSessionPage.jsx');
  const inbox = read('frontend/src/pages/founder/ChannelsInbox.jsx');
  for (const page of [review, session, inbox]) {
    assert.match(page, />Customer research<\/Link>/);
    assert.doesNotMatch(page, /<Link to="\/validate\/interviews"/);
  }
  assert.match(review, /navigate\(`\/validate\/customer-research\?project_id=\$\{interview\.project_id\}`/);
});
