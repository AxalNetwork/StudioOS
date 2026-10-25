// Run by use_toast_guard_1437.test.mjs in a child process with
// --experimental-test-module-mocks. Renders the real admin panels with a
// `useToast` that already holds a message, and prints one JSON line:
// { "<Panel>:<kind>": { html, error } }.
import { mock } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

let current = null;
mock.module(new URL('../src/components/useToast.js', import.meta.url).href, {
  namedExports: {
    useToast: () => ({ toast: current, showToast() {}, dismissToast() {}, success() {}, error() {} }),
  },
});

// D648 — the panels live in their own console files.
const { BillingPanel } = await import('../src/pages/admin/consoles/BillingConsole.jsx');
const { SignedDocLightbox } = await import('../src/pages/admin/consoles/LegalConsole.jsx');
const { default: AdminNetworkProfiles } = await import('../src/pages/admin/AdminNetworkProfiles.jsx');

const panels = {
  BillingPanel: () => h(BillingPanel),
  SignedDocLightbox: () => h(SignedDocLightbox, { uid: 'doc-1', onClose() {}, onChanged() {} }),
  AdminNetworkProfiles: () => h(AdminNetworkProfiles),
};
const payloads = { success: { kind: 'ok', msg: 'the success message' }, error: { kind: 'err', msg: 'the error message' } };

const out = {};
for (const [name, make] of Object.entries(panels)) {
  for (const [kind, toast] of Object.entries(payloads)) {
    current = toast;
    try {
      out[`${name}:${kind}`] = { html: renderToStaticMarkup(h(MemoryRouter, null, make())), error: null };
    } catch (e) {
      out[`${name}:${kind}`] = { html: '', error: String(e?.message || e).slice(0, 300) };
    }
  }
}
console.log(JSON.stringify(out));
