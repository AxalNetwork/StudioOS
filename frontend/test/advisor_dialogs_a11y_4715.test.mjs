// #4715 (D4715) — the booking and review dialogs are dialogs: a role, a
// name, labelled fields, an announced error, a named close, Escape; the
// rating is five named, pressed-state buttons, and a rating someone reads is
// one image with its value in words. The slot buttons say which slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';

const API_IMPORT = "import { api } from '../lib/api';";
const START = new Date(Date.now() + 2 * 86_400_000).toISOString();
const slot = { id: 7, uid: 's-7', advisor_id: 1, starts_at: START, ends_at: new Date(Date.parse(START) + 45 * 60_000).toISOString(), capacity: 1, taken: 0, available: 1, is_cancelled: false, has_meeting_link: false };

async function page(apiStub) {
  const src = readFileSync(new URL('../src/pages/AdvisorsPage.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes(API_IMPORT));
  globalThis.__apiA11y4715 = { api: apiStub };
  return sourceModule(src.replace(API_IMPORT, 'const { api } = globalThis.__apiA11y4715;'), 'pages/AdvisorsPage.jsx');
}
const dialogs = (f) => f.nodes().filter((n) => f.props(n).role === 'dialog');

test('the booking dialog: named, labelled, announces its error, closes on Escape', async () => {
  const calls = [];
  const mod = await page({ listAdvisorSlots: async () => ({ items: [slot] }), bookAdvisorSlot: async (...a) => { calls.push(a); return {}; } });
  const f = await mountForm(h(mod.AdvisorDetail, { advisor: { uid: 'a-1', display_name: 'Synthetic Advisor' }, onClose() {} }), { modal: true });
  try {
    await f.flush();
    const book = f.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Book');
    assert.match(f.props(book)['aria-label'], /^Book .+, 45 minutes$/, 'the slot button names its slot');
    await f.click('Book');
    const dialog = dialogs(f).find((n) => f.props(n)['data-testid'] === 'booking-dialog' || /Book Synthetic Advisor/.test(f.props(n)['aria-label'] || ''));
    assert.ok(dialog, 'the booking form is a dialog');
    assert.equal(f.props(dialog)['aria-modal'], 'true');
    const named = f.props(dialog)['aria-label'] || textOf(f.nodes().find((n) => f.props(n).id && f.props(n).id === f.props(dialog)['aria-labelledby']) || { nodeType: 3, textContent: '' });
    assert.match(named, /Book Synthetic Advisor/, 'the dialog is named for whom it books');
    const close = f.nodes().find((n) => n.tagName === 'BUTTON' && f.props(n)['aria-label'] === 'Close' && f.props(n)['data-testid'] === 'booking-dialog-close');
    assert.ok(close, 'the close control has a name');
    const labels = f.nodes().filter((n) => n.tagName === 'LABEL');
    for (const want of ['Topic', 'Questions / context']) {
      const label = labels.find((l) => textOf(l).trim() === want);
      assert.ok(label, `label ${want}`);
      const field = f.nodes().find((n) => f.props(n).id === f.props(label).htmlFor);
      assert.ok(field && ['INPUT', 'TEXTAREA'].includes(field.tagName), `${want} is joined to its field`);
    }
    const form = f.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => f.props(form).onSubmit({ preventDefault() {} }));
    assert.equal(calls.length, 0, 'no request without a topic');
    const alert = f.nodes().find((n) => f.props(n).role === 'alert');
    assert.ok(alert && /Topic is required/.test(textOf(alert)), 'the error is announced');
    const topic = f.nodes().find((n) => n.tagName === 'INPUT' && f.props(n).placeholder === 'GTM strategy review');
    assert.equal(f.props(topic)['aria-invalid'], 'true');
    assert.equal(f.props(topic)['aria-describedby'], f.props(alert).id);
    await f.escape();
    assert.equal(dialogs(f).filter((n) => f.props(n)['data-testid'] === 'booking-dialog').length, 0, 'Escape closes the booking dialog');
  } finally { await f.unmount(); }
});

test('the review dialog: a named rating group of pressed-state stars and a labelled comment', async () => {
  const mod = await page({ fileAdvisorReview: async () => ({ ok: true }) });
  const f = await mountForm(h(mod.ReviewModal, { booking: { id: 3, topic: 'Synthetic topic' }, onClose() {}, onSubmitted() {} }), { modal: true });
  try {
    await f.flush();
    const dialog = dialogs(f)[0];
    assert.ok(dialog && f.props(dialog)['aria-modal'] === 'true', 'the review form is a dialog');
    const stars = f.nodes().filter((n) => n.tagName === 'BUTTON' && /^\d stars?$/.test(f.props(n)['aria-label'] || ''));
    assert.deepEqual(stars.map((n) => f.props(n)['aria-label']), ['1 star', '2 stars', '3 stars', '4 stars', '5 stars']);
    assert.deepEqual(stars.map((n) => f.props(n)['aria-pressed']), [false, false, false, false, true], 'five is the starting rating');
    await act(async () => f.props(stars[2]).onClick());
    const after = f.nodes().filter((n) => n.tagName === 'BUTTON' && /^\d stars?$/.test(f.props(n)['aria-label'] || ''));
    assert.deepEqual(after.map((n) => f.props(n)['aria-pressed']), [false, false, true, false, false]);
    const group = f.nodes().find((n) => f.props(n).role === 'group');
    assert.equal(f.props(group)['aria-label'], 'Rating: 3 of 5');
    const label = f.nodes().find((n) => n.tagName === 'LABEL' && /Comment/.test(textOf(n)));
    assert.ok(f.nodes().find((n) => n.tagName === 'TEXTAREA' && f.props(n).id === f.props(label).htmlFor), 'the comment is labelled');
  } finally { await f.unmount(); }
});

test('a rating someone reads is one image with its value, not five buttons', async () => {
  const mod = await page({});
  const f = await mountForm(h(mod.StarRow, { rating: 4 }));
  try {
    assert.equal(f.nodes().filter((n) => n.tagName === 'BUTTON').length, 0);
    const img = f.nodes().find((n) => f.props(n).role === 'img');
    assert.equal(f.props(img)['aria-label'], 'Rated 4 of 5');
  } finally { await f.unmount(); }
});
