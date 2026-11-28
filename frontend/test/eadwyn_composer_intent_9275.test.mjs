/**
 * D9275 (#9275) — a slash command in Studio's Eadwyn composer never becomes an
 * interview answer or evidence.
 *
 * `lib/advisor/composerIntent.js` is pure and imported here. `PersonalAdvisor`
 * reaches `lib/advisor/router.js`, which a Node test cannot import, so its
 * `handleSend` is pinned in the source (as task_pick_opens_chat does) to hand
 * each intent to the component's own handlers; the routing is then driven
 * through `routeComposerSend` with `api.advisor` stubbed and handlers that do
 * what `submit`, `submitToolAuto` and `openTutor` do with it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_composer_intent_9275.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { COMMAND_NOT_READY, explainTopic, intentOf, routeComposerSend } from '../src/lib/advisor/composerIntent.js';

const OWNER_EXAMPLE = '/validate/ideal-customer-profile<create-segment>';
const QUESTION = { id: 'build.icp', prompt: 'Who is your ideal customer?' };

/** A composer with `api.advisor` stubbed: every call it would make is recorded. */
function composer({ question = QUESTION, pendingEvidence = null, input = '' } = {}) {
  const calls = [];
  const api = {
    advisor: {
      answer: (conversationId, qid, value, evidence) => { calls.push(['answer', qid, value, evidence]); return { status: 'saved' }; },
      toolAuto: (raw) => { calls.push(['toolAuto', raw]); return { result: null, cta: null }; },
      explainUrl: () => { calls.push(['explain']); return '/api/advisor/explain'; },
    },
  };
  const state = { input, question, pendingEvidence, answeredIds: [], messages: [], tutor: null };
  const handlers = {
    explain: (topic) => { api.advisor.explainUrl(); state.tutor = topic; state.input = ''; },
    tool: (raw) => { state.messages = [...state.messages, { role: 'user', content: raw }]; state.input = ''; api.advisor.toolAuto(raw); },
    command: () => {
      const m = state.messages;
      state.messages = m[m.length - 1]?.content === COMMAND_NOT_READY ? m : [...m, { role: 'assistant', content: COMMAND_NOT_READY, composer_notice: true }];
    },
    answer: (raw) => {
      let value = raw;
      let evidence;
      if (state.pendingEvidence && state.pendingEvidence.qid === state.question.id) {
        value = state.pendingEvidence.value;
        evidence = raw;
      }
      state.messages = [...state.messages, { role: 'user', content: value, question_id: state.question.id }];
      state.answeredIds = [...state.answeredIds, state.question.id];
      state.input = '';
      api.advisor.answer('conv-1', state.question.id, value, evidence);
    },
  };
  const send = () => routeComposerSend(state.input, { question: state.question, pendingEvidence: state.pendingEvidence }, handlers);
  return { calls, state, send };
}

test('handleSend hands every intent to the component\'s own handlers, and a command only adds the notice line', () => {
  // Mutations checked: answer wired to submitToolAuto; the command clearing the input; pendingEvidence left out of the context; explain keeping the input.
  const src = codeOnly(readFileSync('frontend/src/components/advisor/PersonalAdvisor.jsx', 'utf8'));
  const start = src.indexOf('const handleSend = useCallback(() => {');
  const END = '}, [input, openTutor, submit, submitToolAuto, question, pendingEvidence]);';
  assert.ok(start > 0 && src.indexOf(END, start) > start, 'handleSend moved');
  const send = src.slice(start, src.indexOf(END, start) + END.length);
  assert.match(send, /routeComposerSend\(input, \{ question, pendingEvidence \}, \{/);
  assert.match(send, /explain: \(topic\) => \{\s*openTutor\(topic\);\s*setInput\(''\);\s*\}/);
  assert.match(send, /tool: submitToolAuto,/);
  assert.match(send, /answer: submit,/);
  const command = send.slice(send.indexOf('command:'), send.indexOf('answer: submit'));
  assert.match(command, /setMessages\(/);
  assert.match(command, /COMMAND_NOT_READY/);
  assert.doesNotMatch(command, /setInput|setPendingEvidence|setAnsweredIds|setQuestion|api\./);
  assert.doesNotMatch(send, /\bsubmit\(|isToolish/);
});

test('an active question and the owner\'s command: no answer call, the text stays in the box', () => {
  // Mutations checked: the leading-slash branch removed (falls to answer); the command handed to answer; the notice text changed.
  const c = composer({ input: `  ${OWNER_EXAMPLE} ` });
  assert.equal(c.send(), 'command');
  assert.deepEqual(c.calls, []);
  assert.equal(c.state.input, `  ${OWNER_EXAMPLE} `);
  assert.deepEqual(c.state.answeredIds, []);
  assert.deepEqual(c.state.messages, [{ role: 'assistant', content: COMMAND_NOT_READY, composer_notice: true }]);
  assert.equal(COMMAND_NOT_READY, 'Nothing was sent. Commands are coming to Eadwyn.');
  // Pressing send again shows the line once, not twice.
  c.send();
  assert.equal(c.state.messages.length, 1);
});

test('pending evidence and /x: no call, pendingEvidence kept', () => {
  // Mutation checked: the text classified untrimmed.
  const pendingEvidence = { qid: QUESTION.id, value: 'Mid-market SaaS CFOs' };
  const c = composer({ pendingEvidence, input: '/x' });
  assert.equal(c.send(), 'command');
  assert.deepEqual(c.calls, []);
  assert.equal(c.state.pendingEvidence, pendingEvidence);
  assert.deepEqual(c.state.pendingEvidence, { qid: QUESTION.id, value: 'Mid-market SaaS CFOs' });
  assert.equal(c.state.input, '/x');
  assert.equal(intentOf('/x', { question: null, pendingEvidence }), 'command', 'a command with no question is still a command');
  assert.equal(intentOf('  /x ', { question: QUESTION, pendingEvidence }), 'command', 'the slash is read after trimming');
});

test('/find investors goes to toolAuto as today, and so do the other six prefixes', () => {
  // Mutations checked: TOOL_SLASH dropped (every slash a command); its \b dropped; a no-question line answering.
  const c = composer({ input: '/find investors' });
  assert.equal(c.send(), 'tool');
  assert.deepEqual(c.calls, [['toolAuto', '/find investors']]);
  for (const p of ['/tool x', '/open deck', '/book a call', '/schedule Friday', '/draft memo', '/start', '/FIND seed funds']) {
    assert.equal(intentOf(p, { question: QUESTION }), 'tool', p);
  }
  assert.equal(intentOf('/findings', { question: QUESTION }), 'command', 'a prefix is a whole word');
  assert.equal(intentOf('find investors', { question: QUESTION }), 'tool');
  assert.equal(intentOf('we sell to CFOs', { question: null }), 'tool', 'no question: the tool endpoint, as before');
});

test('explain churn opens the tutor as today', () => {
  // Mutation checked: the explain check removed.
  const c = composer({ input: 'explain churn' });
  assert.equal(c.send(), 'explain');
  assert.deepEqual(c.calls, [['explain']]);
  assert.equal(c.state.tutor, 'churn');
  assert.equal(c.state.input, '');
  assert.equal(explainTopic("  what's a SAFE "), 'a SAFE');
});

test('prose with a slash is an answer, and with pending evidence it is filed as that evidence', () => {
  // Mutation checked: the slash test made unanchored (raw.includes('/')).
  const c = composer({ input: 'Founders and/or CFOs at https://example.com/customers' });
  assert.equal(c.send(), 'answer');
  assert.deepEqual(c.calls, [['answer', QUESTION.id, 'Founders and/or CFOs at https://example.com/customers', undefined]]);
  assert.deepEqual(c.state.answeredIds, [QUESTION.id]);
  const e = composer({ pendingEvidence: { qid: QUESTION.id, value: 'CFOs' }, input: 'see our pipeline/CRM export' });
  assert.equal(e.send(), 'answer');
  assert.deepEqual(e.calls, [['answer', QUESTION.id, 'CFOs', 'see our pipeline/CRM export']]);
});

test('blank text sends nothing', () => {
  // Mutation checked: blank text classified as an answer.
  const c = composer({ input: '   ' });
  assert.equal(c.send(), null);
  assert.deepEqual(c.calls, []);
  assert.deepEqual(c.state.messages, []);
});
