/**
 * D5034 (#5034) part 4 — Eadwyn's Support prompts (canvas SU13): a page's own
 * prompts reach the Ask panel as chips that fill the composer, before the
 * page's run options. Nothing is sent by a prompt, and a page that passes none
 * is unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import AskPanel from '../src/ui/AskPanel.jsx';
import { panelChips, promptOptions, RUN_CHIPS } from '../src/ui/askPanelModel.js';
import { SUPPORT_PROMPTS } from '../src/pages/hq/HqSupportPage.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => codeOnly(readFileSync(resolve(root, p), 'utf8'));
const html = (el) => renderToStaticMarkup(el);
const h = React.createElement;

test('the Support prompts are the canvas’s four, in its order', () => {
  assert.deepEqual([...SUPPORT_PROMPTS], [
    'Summarize current support workload',
    'Explain this SLA status',
    'Draft a response to this escalation',
    'Explain why data is unavailable',
  ]);
  const canvas = readFileSync(resolve(root, 'design/incoming/Support v2 Page.dc.html'), 'utf8');
  for (const p of SUPPORT_PROMPTS) assert.ok(canvas.includes(p), `the canvas does not name "${p}"`);
});

test('a prompt is a chip that fills the composer, never a run chip, and blanks are dropped', () => {
  const opts = promptOptions(['  Summarize current support workload ', '', null, 'Explain this SLA status']);
  assert.deepEqual(opts, [
    { key: 'prompt:1', label: 'Summarize current support workload' },
    { key: 'prompt:2', label: 'Explain this SLA status' },
  ]);
  assert.ok(opts.every((o) => !RUN_CHIPS.includes(o.key)), 'a prompt key is a run chip');
  assert.deepEqual(promptOptions(null), []);
  const chips = panelChips([...opts, { key: 'form:x', label: 'Option' }]);
  assert.deepEqual(chips.map((c) => [c.key, c.run]), [['prompt:1', false], ['prompt:2', false], ['form:x', RUN_CHIPS.includes('form:x')]]);
});

test('the Ask panel draws the prompts first, as composer chips; without prompts nothing changes', () => {
  const withPrompts = html(h(AskPanel, { page: 'Super Admin · Support', label: 'Support', options: [], prompts: SUPPORT_PROMPTS }));
  const keys = [...withPrompts.matchAll(/data-testid="ask-chip-([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['prompt:1', 'prompt:2', 'prompt:3', 'prompt:4']);
  assert.match(withPrompts, /data-run="false"[^>]*data-testid="ask-chip-prompt:3"[^>]*>Draft a response to this escalation</);
  const without = html(h(AskPanel, { page: 'p', label: 'Calendar', options: [] }));
  assert.doesNotMatch(without, /ask-chip-prompt:/);
  assert.doesNotMatch(without, /data-testid="ask-panel-chips"/, 'a page with no prompts and no options gained a chip row');
});

test('the rail hands the page’s prompts to Ask, and Support passes its four', () => {
  assert.match(src('frontend/src/ui/WorkerRail.jsx'), /options=\{rail\.options\}\s+prompts=\{prompts\}/);
  assert.ok(src('frontend/src/ui/AskPanel.jsx').includes('const chips = panelChips([...promptOptions(prompts), ...(options || [])]);'));
  assert.ok(src('frontend/src/pages/hq/HqSupportPage.jsx').includes('prompts={SUPPORT_PROMPTS}'));
});
