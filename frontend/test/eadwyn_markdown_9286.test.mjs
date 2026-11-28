/**
 * D9286 (#9286) — Eadwyn's messages render Markdown safely, and an Explain
 * press names the question's own options.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_markdown_9286.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EadwynMarkdown, explainRequestBody } from '../src/lib/eadwynMarkdown.jsx';

const ADVISOR = readFileSync(new URL('../src/components/advisor/PersonalAdvisor.jsx', import.meta.url), 'utf8');
const html = (text) => renderToStaticMarkup(React.createElement(EadwynMarkdown, { text }));

test('D9286: **Daily** renders bold and "- " lines render as a list, as the audit saw them printed raw', () => {
  const out = html('Pick one:\n\n- **Daily** — every morning\n- **Weekly**\n- Off');
  assert.match(out, /<strong>Daily<\/strong>/);
  assert.match(out, /<ul><li><strong>Daily<\/strong> — every morning<\/li><li><strong>Weekly<\/strong><\/li><li>Off<\/li><\/ul>/);
  assert.doesNotMatch(out, /\*\*/, 'a Markdown marker reached the page as text');
});

test('D9286: <script> and raw HTML stay text; a javascript: link is not a link', () => {
  const out = html('Hi <script>alert(1)</script> <img src=x onerror=alert(2)> [x](javascript:alert(3)) **ok**');
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<img/i);
  assert.doesNotMatch(out, /href="javascript:/i);
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out, /<strong>ok<\/strong>/);
  // An attribute cannot be broken out of: the quote is escaped before the link is built.
  const link = html('[go](/build" onmouseover="alert(4))');
  assert.doesNotMatch(link, /onmouseover="/);
});

test('D9286: the Explain body carries the active question\'s id, type and options', () => {
  const q = { id: 'notify.frequency', prompt: 'How often should we nudge you?', input_kind: 'select', options: ['Daily', 'Weekly', 'Off'] };
  assert.deepEqual(explainRequestBody(q.prompt, q, 'conv-1'), {
    topic: q.prompt, conversation_id: 'conv-1',
    question_id: 'notify.frequency', question_type: 'select', options: ['Daily', 'Weekly', 'Off'],
  });
  // Pressed by id, the same.
  assert.equal(explainRequestBody(q.id, q, 'conv-1').question_id, 'notify.frequency');
  // A free-text question names itself and sends no options.
  assert.deepEqual(explainRequestBody('Your name?', { id: 'name', prompt: 'Your name?', input_kind: 'short' }, null).options, []);
  // A typed "explain churn" about something else stays a free-form topic.
  assert.deepEqual(explainRequestBody('churn', q, 'conv-1'), { topic: 'churn', conversation_id: 'conv-1' });
  assert.deepEqual(explainRequestBody('churn', null, 'conv-1'), { topic: 'churn', conversation_id: 'conv-1' });
});

test('D9286: the Studio sends that body, and renders assistant and tutor text through the escaping renderer', () => {
  const tutorAt = ADVISOR.indexOf('const openTutor = useCallback');
  const tutor = ADVISOR.slice(tutorAt, ADVISOR.indexOf('}, [conversationId, question, explainKey]);', tutorAt));
  assert.match(tutor, /body: JSON\.stringify\(explainRequestBody\(topic, question, conversationId\)\)/);
  const bubble = ADVISOR.slice(ADVISOR.indexOf('function Bubble('), ADVISOR.indexOf('function ToolPreview('));
  assert.match(bubble, /m\.role === 'assistant' \? \(\s*\/\/[^\n]*\n\s*<EadwynMarkdown text=\{m\.content\} \/>/);
  const panel = ADVISOR.slice(ADVISOR.indexOf('function TutorPanel('), ADVISOR.indexOf('function WeekBanner('));
  assert.match(panel, /tutor\.text \? <EadwynMarkdown text=\{tutor\.text\} \/>/);
  // The only HTML the Studio injects is the renderer's own.
  assert.doesNotMatch(ADVISOR, /dangerouslySetInnerHTML/);
  const mod = readFileSync(new URL('../src/lib/eadwynMarkdown.jsx', import.meta.url), 'utf8');
  assert.match(mod, /dangerouslySetInnerHTML=\{\{ __html: renderMarkdown\(|const html = renderMarkdown\(String\(text \?\? ''\)\);[\s\S]*__html: html/);
});
