/**
 * #2199 — Integration keys: a refused Save or Rotate says why inside the
 * dialog, not behind it.
 *
 * The dialog is a `fixed inset-0 z-50` overlay that stays open on an error,
 * and it used to hand every refusal to the page's toast, drawn behind that
 * overlay: the button spun, stopped, and nothing seemed to happen. Now the
 * refusal is a `role="alert"` under the fields, in the Worker's own words,
 * with both fields as typed. When the Worker has no Cloudflare API token it
 * also gives the wrangler command for each Worker secret the save would have
 * written (names only).
 *
 * The dialog is mounted through the stub DOM with `api`'s two writes stubbed.
 * No key value appears here: the fields hold made-up placeholders.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/integration_keys_dialog_2199.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { adminConsoleSource } from './_adminConsoles.mjs';
import { api } from '../src/lib/api.js';
import { IntegrationKeysEditModal } from '../src/pages/admin/consoles/IntegrationKeysConsole.jsx';
import { TOKEN_MISSING_CODE, TOKEN_MISSING_LEAD, keySaveRefusal, wranglerPutLine } from '../src/lib/integrationKeys.js';

const h = React.createElement;
const TOKEN_MISSING = 'The Cloudflare API token is not set, so keys cannot be changed from here.';
const GH_NAMES = ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'];
const refusal = (message, code) => Object.assign(new Error(message), { status: code === TOKEN_MISSING_CODE ? 503 : 400, ...(code ? { code } : {}) });

async function mount(props, { set, rotate } = {}) {
  const restore = installDocument();
  // The test DOM has no focus(); the dialog's autoFocus calls it on mount.
  const make = document.createElement.bind(document);
  document.createElement = (tag) => Object.assign(make(tag), { focus() {} });
  const real = { set: api.adminSetIntegrationKeys, rotate: api.adminRotateIntegrationKeys };
  const calls = { set: [], rotate: [], saved: 0, closed: 0 };
  api.adminSetIntegrationKeys = async (...a) => { calls.set.push(a); if (set) throw set; return { ok: true }; };
  api.adminRotateIntegrationKeys = async (...a) => { calls.rotate.push(a); if (rotate) throw rotate; return { ok: true }; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => {
    root.render(h(IntegrationKeysEditModal, {
      provider: 'github', envNames: GH_NAMES, onClose: () => { calls.closed += 1; }, onSaved: () => { calls.saved += 1; }, ...props,
    }));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  const tag = (t) => nodes().filter((n) => n.tagName?.toLowerCase() === t);
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    calls, by, pr, tag,
    text: (n) => txt(n).replace(/\s+/g, ' ').trim(),
    alert: () => nodes().find((n) => pr(n).role === 'alert'),
    async type(i, value) { await act(async () => { pr(tag('input')[i]).onChange({ target: { value } }); }); await settle(); },
    value: (i) => pr(tag('input')[i]).value,
    async submit() { await act(async () => { await pr(tag('form')[0]).onSubmit({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); Object.assign(api, { adminSetIntegrationKeys: real.set, adminRotateIntegrationKeys: real.rotate }); restore(); },
  };
}

test('a save refused for a missing Cloudflare token stays open, with the sentence and both wrangler lines inside', async () => {
  const m = await mount({}, { set: refusal(TOKEN_MISSING, TOKEN_MISSING_CODE) });
  try {
    await m.type(0, 'Iv1.placeholder-id');
    await m.type(1, 'placeholder-secret');
    await m.submit();
    assert.equal(m.calls.set.length, 1);
    assert.equal(m.calls.saved, 0, 'a refused save closed the dialog');
    assert.equal(m.calls.closed, 0);
    const alert = m.alert();
    assert.ok(alert, 'no role="alert" inside the dialog');
    assert.equal(m.pr(alert)['data-testid'], 'integration-keys-dialog-error');
    assert.equal(m.text(alert),
      `${TOKEN_MISSING} ${TOKEN_MISSING_LEAD} ${wranglerPutLine('GITHUB_APP_CLIENT_ID')} ${wranglerPutLine('GITHUB_APP_CLIENT_SECRET')}`);
    assert.equal(TOKEN_MISSING_LEAD, 'Set it from the command line instead:');
    // Both fields as typed.
    assert.equal(m.value(0), 'Iv1.placeholder-id');
    assert.equal(m.value(1), 'placeholder-secret');
    // The alert is in the console's red, with its dark pair.
    const cls = m.pr(alert).className;
    for (const c of ['bg-red-50', 'text-red-800', 'border-red-200', 'dark:bg-red-900/30', 'dark:text-red-200', 'dark:border-red-800']) assert.ok(cls.includes(c), `the alert lost ${c}`);
  } finally { await m.unmount(); }
});

test('a rotate refused for a missing token gives the secret\'s line only', async () => {
  const m = await mount({ mode: 'rotate' }, { rotate: refusal(TOKEN_MISSING, TOKEN_MISSING_CODE) });
  try {
    await m.type(0, 'placeholder-new-secret');
    await m.submit();
    assert.equal(m.calls.rotate.length, 1);
    assert.equal(m.text(m.alert()), `${TOKEN_MISSING} ${TOKEN_MISSING_LEAD} ${wranglerPutLine('GITHUB_APP_CLIENT_SECRET')}`);
    assert.equal(m.value(0), 'placeholder-new-secret');
  } finally { await m.unmount(); }
});

test('another refusal shows the Worker\'s own sentence and no wrangler line', async () => {
  const m = await mount({}, { set: refusal('Client ID must be at most 256 characters.') });
  try {
    await m.type(0, 'Iv1.placeholder-id');
    await m.type(1, 'placeholder-secret');
    await m.submit();
    assert.equal(m.text(m.alert()), 'Client ID must be at most 256 characters.');
    assert.equal(m.by('integration-keys-dialog-wrangler'), undefined, 'a wrangler line for a refusal that is not the token');
    assert.equal(m.calls.saved, 0);
  } finally { await m.unmount(); }
});

test('an empty field says the required-fields sentence inside the dialog, and sends nothing', async () => {
  const m = await mount({});
  try {
    assert.equal(m.alert(), undefined, 'an alert before any press');
    await m.type(0, 'Iv1.placeholder-id');
    await m.submit();
    assert.equal(m.text(m.alert()), 'Both Client ID and Client Secret are required.');
    assert.equal(m.calls.set.length, 0);
    assert.equal(m.value(0), 'Iv1.placeholder-id');
  } finally { await m.unmount(); }
  const r = await mount({ mode: 'rotate' });
  try {
    await r.submit();
    assert.equal(r.text(r.alert()), 'A new Client Secret is required.');
    assert.equal(r.calls.rotate.length, 0);
  } finally { await r.unmount(); }
});

test('a success still closes the dialog through onSaved, and a retried save clears the old alert', async () => {
  const m = await mount({});
  try {
    await m.submit();
    assert.ok(m.alert());
    await m.type(0, 'Iv1.placeholder-id');
    await m.type(1, 'placeholder-secret');
    await m.submit();
    assert.equal(m.calls.saved, 1, 'a success did not reach onSaved');
    assert.equal(m.alert(), undefined, 'the old alert stayed after a successful save');
  } finally { await m.unmount(); }
  // The page still toasts a success, and no longer routes refusals to its toast.
  const page = codeOnly(adminConsoleSource());
  assert.match(page, /onSaved=\{\(\) => \{ setEditing\(null\); refresh\(\); showToast\(\{ kind: 'ok'/);
  assert.doesNotMatch(page, /onError=\{/, 'the dialog still sends a refusal to the page');
});

test('keySaveRefusal: the Worker\'s sentence or the fallback; commands only for the token, and only for names', () => {
  assert.deepEqual(keySaveRefusal(refusal('Nope.'), { names: GH_NAMES }), { message: 'Nope.', commands: [] });
  assert.deepEqual(keySaveRefusal(new Error(''), { fallback: 'Failed to rotate' }), { message: 'Failed to rotate', commands: [] });
  assert.deepEqual(keySaveRefusal(undefined), { message: 'Failed to save', commands: [] });
  assert.deepEqual(keySaveRefusal(refusal(TOKEN_MISSING, TOKEN_MISSING_CODE), { names: ['GITHUB_APP_CLIENT_SECRET', 'not a name', 7, ''] }).commands,
    [wranglerPutLine('GITHUB_APP_CLIENT_SECRET')]);
  // The message alone does not decide: the Worker's code does.
  assert.deepEqual(keySaveRefusal(refusal(TOKEN_MISSING), { names: GH_NAMES }).commands, []);
});
