/** D694: recording outcomes and Validate navigation meet at Customer research (PR 1; test 9, `finishPath`, is PR 2's). */
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
import { finishPath } from '../src/pages/cycles/CycleRoute.jsx';
import { openingStep } from '../src/pages/founder/assistantSession.js';

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
  // D757 (#1927): Customer research still, unless Axal drafted the summary; then the session.
  assert.match(pill, /to=\{finish \? finish\.href : reviewPath\(state\.session\)\}/);
  assert.doesNotMatch(pill, /Open the review/);
  assert.doesNotMatch(pill, /state=\{\{ interview \}\}/);
});

test('Validate has only module tabs and its six phone index rows', () => {
  const cards = [{ slug: 'problem-discovery', name: 'Problem discovery' }, { slug: 'customer-research', name: 'Customer research' }];
  assert.deepEqual(cycleTabs('validate', cards, null, '?project_id=7').map((tab) => tab.name), ['Overview', 'Problem discovery', 'Customer research']);
  // D703 (#1665's PR 1b): the six rows are the Worker's (#1701's PR 1b), drawn as sent; the browser builds none.
  const six = ['problem-discovery', 'customer-research', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments'];
  assert.deepEqual(phoneIndex({ index: six.map((key) => ({ key, title: key, detail: '', value: null, href: `/validate/${key}` })), cards: [] }).map((row) => row.key), six);
  assert.deepEqual(phoneIndex({ figures: [], cards: [] }), []);
  for (const [cycle, title] of [['build', 'Tools'], ['raise', 'Calls'], ['grow', 'Reporting']]) {
    assert.equal(cycleTabs(cycle, cards)[1].name, title);
  }
});

test('the three breadcrumbs and review delete return to Customer research', () => {
  const review = read('frontend/src/pages/founder/InterviewReviewPage.jsx');
  const session = read('frontend/src/pages/founder/InterviewSessionPage.jsx');
  const inbox = read('frontend/src/pages/founder/ChannelsInbox.jsx');
  for (const page of [session, inbox]) {
    assert.match(page, />Customer research<\/Link>/);
    assert.doesNotMatch(page, /<Link to="\/validate\/interviews"/);
  }
  // D697 (#1659): the review is Customer research's record inside the cycle, so the
  // cycle's "‹ Back to Customer research" tab replaces its breadcrumb, and Delete
  // lands through afterDelete, on Customer research for the same venture.
  assert.doesNotMatch(review, /\/validate\/interviews/);
  assert.match(review, /navigate\(afterDelete\(projectId\), \{ replace: true \}\)/);
});

// ---------- PR 2: every Record a session finish (test 9) ----------------------

function assertFinishes(finish) {
  const research = '/validate/customer-research?project_id=3';
  assert.equal(finish({ id: 12, project_id: 3, status: 'draft', submitted_via: 'meeting_bot' }, undefined, 3), '/validate/session/12', 'Send opens the bot status page');
  assert.equal(finish({ id: 5, project_id: 3, status: 'transcribed' }, 'session', 3), research, 'a pasted chat');
  assert.equal(finish({ id: 6 }, 'session', 3), research, "an imported thread takes the page's venture");
  assert.equal(finish({ id: 5, project_id: 3 }, 'session', 9), research, "the session's venture wins over the page's");
  assert.equal(finish({ id: 7, project_id: 3, status: 'draft', submitted_via: 'whatsapp' }, 'session', 3), '/validate/session/7', 'a text chat still waiting keeps its page');
  assert.equal(finish({ id: 8, project_id: 3, status: 'draft', submitted_via: 'zoom' }, 'session', 3), '/validate/session/8', 'a call still waiting keeps its page');
  assert.equal(finish({ id: 7, project_id: 3, status: 'transcribed', submitted_via: 'whatsapp' }, 'session', 3), research, 'a channel session no longer draft lands on Customer research');
  assert.equal(finish({ id: 9, project_id: 3 }, 'live', 3), '/validate/record/live?session=9');
  assert.equal(finish({ id: 6 }, 'session', null), '/validate/customer-research', 'no venture, no query');
  assert.equal(finish({ id: 6, project_id: 'x' }, 'session', 3), '/validate/customer-research', 'only a positive integer reaches the address');
}

test('finishPath: every finish lands on Customer research in the session\'s venture, a waiting channel session keeps its page', () => {
  assertFinishes(finishPath);
  // The same rules from the source, each mutation run against them.
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  const fn = /export function finishPath\(session, where, projectId\) \{\n[\s\S]*?\n\}\n/.exec(route)?.[0];
  assert.ok(fn, 'finishPath is found');
  const build = (text) => new Function('openingStep', 'reviewPath', `${text.replace('export function', 'function')}\nreturn finishPath;`)(openingStep, reviewPath);
  assertFinishes(build(fn));
  for (const [before, after] of [
    ["where === 'live'", "where === 'record'"],
    ["session?.submitted_via === 'meeting_bot'", 'false'],
    ["openingStep(session) === 'channel'", "openingStep(session) === 'transcript'"],
    ['project_id: session?.project_id ?? projectId', 'project_id: projectId ?? session?.project_id'],
    ['project_id: session?.project_id ?? projectId', 'project_id: session?.project_id'],
  ]) {
    assert.ok(fn.includes(before), 'mutation target: ' + before);
    assert.throws(() => assertFinishes(build(fn.replace(before, after))), { name: 'AssertionError' }, 'mutation must fail: ' + after);
  }
  assertFinishes(build(fn));

  // onDone navigates to it, replacing /record, and hands the interview only to the session page.
  const onDone = (text) => {
    const branch = /const onDone = cycle === 'validate'\n\s*\? \(session, interview, where\) => \{([\s\S]*?)\n\s*\}\n/.exec(text)?.[1];
    assert.ok(branch, "onDone's Validate branch");
    assert.match(branch, /const to = finishPath\(session, where, projectId\);/);
    assert.match(branch, /navigate\(to, to\.startsWith\('\/validate\/session\/'\) \? \{ state: \{ interview \}, replace: true \} : \{ replace: true \}\);/);
  };
  onDone(route);
  for (const [before, after] of [
    ['finishPath(session, where, projectId);', 'finishPath(session, where);'],
    [': { replace: true });', ': {});'],
    ["{ state: { interview }, replace: true } :", '{ state: { interview } } :'],
  ]) {
    assert.ok(route.includes(before), 'mutation target: ' + before);
    assert.throws(() => onDone(route.replace(before, after)), { name: 'AssertionError' }, 'mutation must fail: ' + after);
  }
});
