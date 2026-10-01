/**
 * The investor Research root's question desk is wired to `/research/ask`.
 *
 * WHAT WAS HERE. IR1's compressed question box set a local flag on submit and
 * showed a panel claiming "There is no scoped research-chat service on this
 * route" — false: `POST /research/ask` (research.ts) is open to every
 * signed-in user and `api.research.ask` has wrapped it all along. The rail
 * repeated the sentence. The box now submits to the route — on the press,
 * never on a visit — and prints what comes back.
 *
 * WHAT IS PINNED. The wiring (the route is called from the submit handler and
 * from nothing else), the three answer shapes rendered distinctly, the two
 * `no_source` meanings kept apart, a failed ask rendered as unreadable with a
 * retry rather than as no answer, and the false sentence gone from both the
 * desk and the rail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const code = codeOnly(read('frontend/src/pages/investor/InvestorResearchWorkspace.jsx'));

test('the box submits to the real ask route, on the press only', () => {
  assert.match(code, /api\.research\.ask\(q\)/,
    'the question desk must post the trimmed question to /research/ask');
  // The submit handler is the only caller: a visit must spend nothing, so the
  // evidence batch (`load`) must not ask.
  const load = code.slice(code.indexOf('const load = useCallback'), code.indexOf('}, []);'));
  assert.ok(!/research\.ask/.test(load), 'the page asks on load — a visit would spend money');
  assert.match(code, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); runAsk\(\); \}\}/,
    'the form must run the ask rather than set a flag');
  assert.match(code, /disabled=\{asking \|\| !question\.trim\(\)\}/,
    'an empty question or an in-flight one must not spend');
});

test('the three route outcomes are rendered as three different states', () => {
  assert.match(code, /asked\.reason === 'answered' \? asked\.answer/,
    'an answered question must print the answer');
  assert.match(code, /asked\.reason === 'no_source'/,
    'no_source must be its own state, not a generic failure');
  // The two no_source meanings: an empty library and a library with nothing
  // on this are different facts with different next actions.
  assert.match(code, /Number\(asked\.indexed_documents\) === 0/,
    'no_source must distinguish an empty library from one with nothing close');
  assert.match(code, /model_unavailable|no answer could be written/i,
    'a model failure must not be reported as the library having nothing');
  // Citations travel with the answer.
  assert.match(code, /asked\.citations/, 'the citations the route returned are dropped');
});

test('a failed ask is unreadable with a retry, never a silent absence', () => {
  assert.match(code, /<Unreadable what="The answer"/, 'a failed ask must render as a failed read');
  assert.match(code, /onRetry=\{runAsk\}/, 'the retry must re-run the ask');
});

test('the false sentence is gone from the desk and the rail', () => {
  // Absence is asserted on STRIPPED code: the file's own comments record what
  // used to be claimed here, and that history is worth keeping.
  assert.ok(!/no scoped research-chat service/i.test(code),
    'the page still claims there is no scoped research-chat service — POST /research/ask exists');
  assert.ok(!/no answer has been generated/i.test(code),
    'the desk still claims no answer can be generated');
  // The rail's replacement names what is genuinely unavailable instead.
  assert.match(code, /General-knowledge answers/,
    'the rail must name the real boundary: answers come from the reader’s own library, not general knowledge');
});
