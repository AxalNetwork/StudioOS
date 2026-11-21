/**
 * D6097 (#6097): a feedback record's Add to roadmap opens Build's Add item at
 * `/build/product-roadmap/new?project_id=<id>&feedback_theme=<theme>`, and
 * `buildItem.fromQuery` chooses that theme under Answers feedback theme. The
 * Worker half (the action, its href, who sees it, and the link it makes) is
 * `cloudflare-worker/test/cycle_records_grow_d691.test.ts`.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/feedback_to_roadmap_d6097.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { h, mountForm, mutationCheck, propsOf } from './_form_d695.mjs';

const path = 'pages/cycles/forms.js';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const P = 3;
const THEMES = [{ value: 'Speed', label: 'Speed' }, { value: 'Speed & scale', label: 'Speed & scale' }, { value: 'Pricing', label: 'Pricing' }];

function writes() {
  const calls = [];
  const build = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { id: 1 }; } });
  return { calls, w: { build, formOptions: async () => ({ feedback_theme: { options: THEMES } }) } };
}

async function open(form, search) {
  const { calls, w } = writes();
  const ui = await mountForm(h(FormLightbox, { form, cycle: 'build', slug: 'product-roadmap', search,
    loadOptions: () => form.loadOptions(w, P), onSubmit: (v) => form.submit(w, P, v), onClose() {} }));
  await ui.flush();
  const chosen = () => ui.nodes().filter((n) => n.tagName === 'INPUT' && propsOf(n).name === 'feedback_theme' && propsOf(n).checked).map((n) => propsOf(n).value);
  return { ...ui, calls, chosen };
}

async function assertPrefill(m) {
  const item = m.BUILD_FORMS['product-roadmap'][0];
  assert.equal(item.key, 'item');
  // The address a Grow record links to: the theme is chosen, and saving sends it.
  const linked = await open(item, '?project_id=3&feedback_theme=Speed%20%26%20scale');
  try {
    assert.deepEqual(linked.chosen(), ['Speed & scale']);
    await linked.input('title', 'Faster exports');
    await linked.submit();
    assert.equal(linked.calls.length, 1);
    assert.equal(linked.calls[0][0], 'roadmapItem');
    assert.equal(linked.calls[0][2].feedback_theme, 'Speed & scale');
  } finally { await linked.unmount(); }
  // Opened from Build itself: None stays chosen and nothing is sent.
  const plain = await open(item, '?project_id=3');
  try {
    assert.deepEqual(plain.chosen(), ['']);
    await plain.input('title', 'Audit log');
    await plain.submit();
    assert.equal(plain.calls[0][2].feedback_theme, null);
  } finally { await plain.unmount(); }
  // What a stored theme cannot be chooses nothing.
  const q = (s) => item.fromQuery(new URLSearchParams(s));
  assert.deepEqual(q('feedback_theme=%20Speed%20'), { feedback_theme: 'Speed' });
  assert.deepEqual(q(''), {});
  assert.deepEqual(q('feedback_theme=%20%20'), {});
  assert.deepEqual(q(`feedback_theme=${'x'.repeat(81)}`), {}, 'longer than a stored theme');
  assert.deepEqual(q(`feedback_theme=${'x'.repeat(80)}`), { feedback_theme: 'x'.repeat(80) });
  assert.deepEqual(q('feedback_theme=a%0Ab'), {}, 'a control character');
}

test('D6097: Add item opened with ?feedback_theme= has that theme chosen and sends it', async () => {
  await mutationCheck(source, path, assertPrefill, [
    ["  fromQuery: (q) => feedbackThemeOf(q.get('feedback_theme')),\n", ''],
    ["fromQuery: (q) => feedbackThemeOf(q.get('feedback_theme'))", "fromQuery: (q) => feedbackThemeOf(q.get('theme'))"],
    ["const theme = typeof raw === 'string' ? raw.trim() : '';", "const theme = typeof raw === 'string' ? raw : '';"],
    ['theme && theme.length <= 80 &&', 'theme &&'],
    ['!/[\\u0000-\\u001f\\u007f]/.test(theme)', 'true'],
  ]);
});
