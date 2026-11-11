// D4478: the routed headers share the footer's completion state and route refusal.
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { ItemPage, LessonPage } from '../src/pages/learning/LearningWired.jsx';
import * as model from '../src/pages/learning/learningModel.js';
import { learningApi } from '../src/lib/api/learning.js';

const h = React.createElement;
const text = node => node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '';
const item = { uid: 'r1', kind: 'reading', title: 'Interviews', body: '## Prepare\n\nListen first.', summary: 'A useful introduction.', duration_seconds: 360 };
const course = { uid: 'c1', slug: 'discover', title: 'Discovery' };
const modules = [{ uid: 'm1', title: 'Module 2: Interviews', lessons: [{ uid: 'l1', ref_uid: 'r1', title: 'Interviews', kind: 'reading' }] }];
async function page({ lesson = false, content = item, save = async () => ({ progress: { status: 'completed' } }) } = {}) {
  const old = { ...learningApi };
  learningApi.item = async () => ({ item: content });
  learningApi.course = async () => ({ course, modules });
  learningApi.recordProgress = save;
  let ui;
  try {
    ui = await mountContracts(h(lesson ? LessonPage : ItemPage, lesson ? { slug: 'discover', lessonUid: 'l1' } : { uid: 'r1' }), lesson ? '/learning/courses/discover/l1' : '/learning/items/r1');
    await ui.flush();
    const byId = id => ui.nodes().filter(n => ui.props(n)?.['data-testid'] === id);
    const header = () => ui.nodes().find(n => n.tagName === 'HEADER');
    const headerButton = () => byId('button-mark-complete').find(n => { for (let p = n; p; p = p.parentNode) if (p === header()) return true; return false; });
    return { ...ui, byId, header, headerButton, async close() { await ui.unmount(); Object.assign(learningApi, old); } };
  } catch (error) { await ui?.unmount(); Object.assign(learningApi, old); throw error; }
}

test('D4478 integration: the shared learning model exports the completion and position rules', () => {
  assert.equal(model.lessonPositionLine?.({ index: 2, total: 5 }), 'Lesson 3 of 5');
  assert.equal(model.markCompleteReason?.({ hasBody: false, hasHandler: true }), 'Nothing to complete yet');
});

for (const lesson of [false, true]) {
  test(`D4478 integration: ${lesson ? 'course' : 'standalone'} empty reading puts its only disabled action in the header and omits the lede`, async () => {
    const ui = await page({ lesson, content: { ...item, body: '   ' } });
    try {
      const button = ui.headerButton();
      assert.ok(button);
      assert.equal(ui.props(button).disabled, true);
      assert.equal(ui.props(button).title, 'Nothing to complete yet');
      const reason = ui.nodes().find(n => ui.props(n)?.id === ui.props(button)['aria-describedby']);
      assert.equal(text(reason), 'Nothing to complete yet');
      assert.equal(ui.byId('button-mark-complete').length, 1);
      assert.equal(ui.byId('lesson-footer').length, 0);
      assert.equal(ui.header().childNodes.some(n => n.tagName === 'DIV' && n.childNodes.some(c => c.tagName === 'P')), false);
      assert.match(ui.text(), /No text yet/);
    } finally { await ui.close(); }
  });

  test(`D4478 integration: ${lesson ? 'course' : 'standalone'} completion shares saving state and shows the route refusal`, async () => {
    let reject;
    const calls = [];
    const ui = await page({ lesson, save: body => { calls.push(body); return new Promise((_resolve, fail) => { reject = fail; }); } });
    try {
      const button = ui.headerButton();
      assert.ok(button);
      assert.equal(ui.props(button).disabled, false);
      await act(async () => { ui.props(button).onClick(); });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].subject_kind, lesson ? 'lesson' : 'item');
      assert.equal(ui.props(ui.headerButton()).title, 'Saving');
      assert.equal(ui.byId('button-mark-complete').every(n => ui.props(n).disabled), true);
      await act(async () => { reject(Object.assign(new Error('private internal failure'), { data: { error: { message: 'This content is no longer published.' } } })); });
      assert.match(ui.text(), /This content is no longer published\./);
      assert.doesNotMatch(ui.text(), /private internal failure/);
      assert.equal(ui.props(ui.headerButton()).disabled, false);
    } finally { await ui.close(); }
  });
}

test('D4478 integration: lesson header names its kind, ordered footer and content without an assistant panel', async () => {
  const ui = await page({ lesson: true });
  try {
    assert.match(text(ui.header()), /Learning · Reading/);
    assert.match(text(ui.header()), /Discovery · Module 2: Interviews/);
    assert.match(text(ui.byId('lesson-footer')[0]), /Lesson 1 of 1 in Module 2: Interviews/);
    assert.equal(ui.byId('worker-rail-frame').length, 0);
    assert.doesNotMatch(ui.text(), /Eadwyn|Read-only learning view/);
  } finally { await ui.close(); }
});

test('D4478 integration: no Learning page mounts an assistant rail, including gated and studio pages', () => {
  const directory = new URL('../src/pages/learning/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.jsx'))) {
    assert.doesNotMatch(readFileSync(new URL(file, directory), 'utf8'), /<(?:WorkerRail|AIRail|LearnerRail|StudioRail|SubPageRail)\b/, file);
  }
});
