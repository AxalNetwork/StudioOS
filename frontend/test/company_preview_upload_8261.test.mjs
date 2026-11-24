/**
 * #8261 (Build v2 BD29 B, with BD22's preview banner) — a Super Admin who
 * previews a founder's Company creation confirms before a paper is uploaded,
 * and the confirm names the Super Admin and the company. Cancel sends nothing;
 * outside founder preview the upload goes straight through, as before.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_preview_upload_8261.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { VentureProvider } from '../src/pages/cycles/VentureContext.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import {
  PREVIEW_UPLOAD_CANCELLED, isFounderPreview, needsPreviewUploadConfirm, previewUploadCopy, uploadedFiles,
} from '../src/pages/cycles/previewUploadModel.js';
import { act } from 'react';
import { h, mountForm } from './_form_d695.mjs';

// Invented values only.
const ADMIN = { id: 9001, name: 'Ada Example', email: 'ada@example.test', role: 'admin', is_super_admin: 1 };
const COMPANY = 'Northwind Example Inc.';
// A name that ends in a full stop takes no second one ("Inc..").
const VENTURE = 4242;
const PREVIEW = { viewMode: 'founder', superAdmin: true, isImpersonating: false, isAdmin: true };
const file = (name = 'proof-83b-mailing.pdf') => ({ name, size: 1234, type: 'application/pdf' });

// The record page's Upload proof form, as `services/records/build.ts` declares it.
const UPLOAD = { key: 'upload-proof', title: 'Upload proof', cta: 'Upload',
  fields: [{ name: 'file', label: 'Proof', kind: 'T', input: 'file', required: true, note: 'PDF, JPEG or PNG, at most 10 MB.' }] };

test('founder preview is a Super Admin in the founder shell, outside a support session', () => {
  assert.equal(isFounderPreview(PREVIEW), true);
  assert.equal(isFounderPreview({ ...PREVIEW, superAdmin: false }), false, 'a plain admin previewing is not asked here');
  assert.equal(isFounderPreview({ ...PREVIEW, isImpersonating: true }), false, 'a support session has its own chrome');
  assert.equal(isFounderPreview({ ...PREVIEW, viewMode: 'admin' }), false, 'the admin view');
  assert.equal(isFounderPreview(null), false, 'no view mode at all (a founder session)');
});

test('only a Company creation upload in founder preview asks; other forms and other modules do not', () => {
  const values = { file: file() };
  assert.equal(needsPreviewUploadConfirm({ cycle: 'build', slug: 'company-creation', mode: PREVIEW, values }), true);
  assert.equal(needsPreviewUploadConfirm({ cycle: 'Build', slug: 'company-creation', mode: PREVIEW, values }), true, 'the cycle as a label');
  assert.equal(needsPreviewUploadConfirm({ cycle: 'build', slug: 'company-creation', mode: PREVIEW, values: { file: null } }), false, 'no file, no question');
  assert.equal(needsPreviewUploadConfirm({ cycle: 'build', slug: 'founding-team', mode: PREVIEW, values }), false, 'another module');
  assert.equal(needsPreviewUploadConfirm({ cycle: 'raise', slug: 'company-creation', mode: PREVIEW, values }), false, 'another cycle');
  assert.equal(needsPreviewUploadConfirm({ cycle: 'build', slug: 'company-creation', mode: { ...PREVIEW, superAdmin: false }, values }), false);
  assert.deepEqual(uploadedFiles({ a: [file('a.pdf'), file('b.png')], b: 'text', c: null }).map((f) => f.name), ['a.pdf', 'b.png']);
});

test('the confirm names the Super Admin, the company and the file, and says so plainly when one is unknown', () => {
  const copy = previewUploadCopy({ admin: ADMIN.name, company: COMPANY, files: [file()] });
  assert.equal(copy.title, 'Upload as Super Admin?');
  assert.equal(copy.cta, 'Upload as Super Admin');
  assert.ok(copy.body.includes(`founder’s view of ${COMPANY} proof-83b-mailing.pdf`), 'one full stop after a name ending in one');
  assert.ok(previewUploadCopy({ company: 'Acme Example', files: [file()] }).body.includes('view of Acme Example. proof'), 'a full stop after any other name');
  assert.ok(copy.body.includes(`proof-83b-mailing.pdf will be stored in ${COMPANY}’s company records`));
  assert.ok(copy.body.includes(`under your name (${ADMIN.name}, Super Admin), not a founder’s`));
  const unknown = previewUploadCopy({ admin: '  ', company: null, files: [file('a.pdf'), file('b.pdf')] });
  assert.ok(unknown.body.includes('this venture’s company records'));
  assert.ok(unknown.body.includes('(you, Super Admin)'));
  assert.ok(unknown.body.startsWith('You are previewing a founder’s view of this venture. 2 files'));
});

/** The Upload proof form under a view mode, the Super Admin signed in, and the venture's list read stubbed. */
async function mounted(mode) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(ADMIN), { status: 200, headers: { 'content-type': 'application/json' } });
  const sent = [];
  const load = async () => [{ id: VENTURE, name: COMPANY }];
  const form = h(FormLightbox, { form: UPLOAD, cycle: 'build', slug: 'company-creation', onSubmit: async (values) => { sent.push(values); return { ok: true }; }, onClose() {} });
  // The signed-in Super Admin, stored before AuthProvider first reads it (mountForm installs a fresh document and storage).
  const SignedIn = ({ children }) => { globalThis.localStorage.setItem('user', JSON.stringify(ADMIN)); return h(AuthProvider, null, children); };
  const tree = h(ViewModeContext.Provider, { value: mode }, h(SignedIn, null, h(VentureProvider, { projectId: VENTURE, load }, form)));
  const m = await mountForm(tree);
  // Press Upload without waiting for the save: in preview the save waits on the confirm's answer.
  const press = async () => {
    const node = m.nodes().find((n) => n.tagName === 'FORM');
    assert.ok(node, 'form exists');
    await act(async () => { void m.props(node).onSubmit({ preventDefault() {} }); });
    await m.flush();
  };
  return { ...m, sent, press, async done() { await m.unmount(); globalThis.fetch = original; globalThis.localStorage?.removeItem?.('user'); } };
}

test('in founder preview, Upload asks first, naming the Super Admin and the company; Upload as Super Admin sends', async () => {
  const m = await mounted(PREVIEW);
  try {
    await m.input('file', file());
    await m.press();
    assert.equal(m.sent.length, 0, 'nothing is sent before the answer');
    const body = m.by('preview-upload-body');
    assert.ok(body, 'the confirm is open');
    assert.ok(m.text().includes(`${ADMIN.name}, Super Admin`), 'names the Super Admin');
    assert.ok(m.text().includes(`${COMPANY}’s company records`), 'names the company it lands in');
    await m.click('Upload as Super Admin');
    await m.flush();
    assert.equal(m.sent.length, 1, 'the upload is sent once');
    assert.equal(m.sent[0].file.name, 'proof-83b-mailing.pdf');
    assert.equal(m.by('preview-upload-body'), undefined, 'the confirm closes');
  } finally { await m.done(); }
});

test('Cancel uploads nothing and says so on the form, which stays open', async () => {
  const m = await mounted(PREVIEW);
  try {
    await m.input('file', file());
    await m.press();
    await m.click('Cancel');
    await m.flush();
    assert.equal(m.sent.length, 0, 'nothing was sent');
    assert.equal(m.by('preview-upload-body'), undefined, 'the confirm closes');
    assert.ok(m.text().includes(PREVIEW_UPLOAD_CANCELLED), 'the form says nothing was uploaded');
    assert.ok(m.by('cycle-form-save'), 'the form stays open to try again');
  } finally { await m.done(); }
});

test('outside founder preview the upload goes straight through, with no confirm', async () => {
  for (const mode of [null, { ...PREVIEW, viewMode: 'admin' }, { ...PREVIEW, superAdmin: false }, { ...PREVIEW, isImpersonating: true }]) {
    const m = await mounted(mode);
    try {
      await m.input('file', file());
      await m.submit();
      await m.flush();
      assert.equal(m.by('preview-upload-body'), undefined, `no confirm: ${JSON.stringify(mode)}`);
      assert.equal(m.sent.length, 1, `sent at once: ${JSON.stringify(mode)}`);
    } finally { await m.done(); }
  }
});
