/**
 * #8828 — the account recovery page's email field is named by its visible label.
 *
 * "Account email" sat above an input with no id, so a screen reader announced the field by its placeholder,
 * "you@company.com". The label now names the input with a matching `htmlFor`/`id`, the example stays in the
 * placeholder only, and the page-level error is described to the field (with `aria-invalid`) only when it is the
 * empty-email message; an error from a later step leaves the field alone.
 *
 * The page is mounted with the stub DOM the form harness uses; no recovery request leaves the test: `fetch` is
 * replaced by a refusal.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/recover_email_label_8828.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { h, mountForm, textOf } from './_form_d695.mjs';

const { default: RecoverPage } = await import('../src/pages/RecoverPage.jsx');

const props = (node) => node && Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};

async function mount() {
  const view = await mountForm(h(RecoverPage));
  const input = () => view.nodes().find((n) => n.tagName === 'INPUT' && props(n).type === 'email');
  const label = () => view.nodes().find((n) => n.tagName === 'LABEL');
  const byId = (id) => view.nodes().find((n) => props(n).id === id);
  const button = () => view.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'See my options');
  // The button is disabled while the field is empty; its handler is called directly to reach the empty-email check.
  const press = async () => { await act(async () => { await props(button()).onClick(); }); await view.flush(); };
  const type = async (value) => { await act(async () => props(input()).onChange({ target: { value } })); };
  return { view, input, label, byId, button, press, type };
}

test('the "Account email" label names the email input before and after typing; the example is only the placeholder', async () => {
  const page = await mount();
  try {
    const check = () => {
      const label = page.label();
      assert.equal(textOf(label).trim(), 'Account email');
      const id = props(label).htmlFor;
      assert.ok(id, 'the label has htmlFor');
      assert.equal(props(page.input()).id, id, 'the label names the email input');
      assert.equal(page.input(), page.byId(id), 'no other element carries that id');
      assert.equal(props(page.input())['aria-label'], undefined, 'no aria-label overrides the visible label');
      assert.equal(props(page.input())['aria-labelledby'], undefined);
      assert.equal(props(page.input()).placeholder, 'you@company.com');
      assert.equal(props(page.input()).autoComplete, 'email');
      assert.ok(!textOf(label).includes('you@company.com'), 'the example is not in the label');
    };
    check();
    await page.type('founder@example.org');
    check();
    // Focus order is unchanged: the label, then the input, then the button.
    const order = page.view.nodes();
    assert.ok(order.indexOf(page.label()) < order.indexOf(page.input()));
    assert.ok(order.indexOf(page.input()) < order.indexOf(page.button()));
    assert.equal(props(page.input()).tabIndex, undefined);
  } finally { await page.view.unmount(); }
});

test('the empty-email error is described to the field and marks it invalid', async () => {
  const page = await mount();
  try {
    assert.equal(props(page.input())['aria-describedby'], undefined, 'no description before an error');
    assert.equal(props(page.input())['aria-invalid'], undefined);
    await page.press();
    const described = props(page.input())['aria-describedby'];
    assert.ok(described, 'the field is described once the email error shows');
    assert.equal(textOf(page.byId(described)).trim(), 'Enter your account email.');
    assert.equal(props(page.input())['aria-invalid'], true);
  } finally { await page.view.unmount(); }
});

test('an error from the recovery request itself is not described to the email field', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Too many attempts.' }), { status: 429, headers: { 'content-type': 'application/json' } });
  const page = await mount();
  try {
    await page.type('founder@example.org');
    await page.press();
    const shown = page.view.nodes().find((n) => n.tagName === 'DIV' && /Too many attempts\./.test(textOf(n)) && !props(n).className?.includes('min-h-screen'));
    assert.ok(shown, 'the request error is shown');
    assert.ok(!page.view.text().includes('Enter your account email.'));
    assert.equal(props(page.input())['aria-describedby'], undefined, 'the field is not described by an unrelated error');
    assert.equal(props(page.input())['aria-invalid'], undefined, 'the field is not marked invalid by an unrelated error');
  } finally { await page.view.unmount(); globalThis.fetch = realFetch; }
});
