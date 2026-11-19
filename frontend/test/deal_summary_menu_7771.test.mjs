/** #7771: the mounted More menu offers only an admitted PDF, preserves the
 * Worker's filename/refusal, and cannot finish a download after unmount. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { DealMoreActions } from '../src/pages/deal/DealFrame.jsx';
import { useNavigate } from 'react-router-dom';
import { dealSummaryApi } from '../src/lib/api/dealSummary.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function NextTab() {
  const navigate = useNavigate();
  return React.createElement('button', { onClick: () => navigate('/deals/17/terms') }, 'Next tab');
}
async function fixture(availability, pdfBlob = async () => { throw new Error('Unexpected download'); }) {
  const original = { ...dealSummaryApi };
  const calls = [];
  dealSummaryApi.availability = async id => { calls.push(id); return availability(); };
  dealSummaryApi.pdfBlob = pdfBlob;
  const v = await mountContracts(React.createElement(React.Fragment, null, React.createElement(DealMoreActions, { dealId: 17, profileUrl: '/startups/harbor' }), React.createElement(NextTab)), '/deals/17');
  return { ...v, calls, async close() { await v.unmount(); Object.assign(dealSummaryApi, original); } };
}
function downloads() {
  const doc = document;
  const create = doc.createElement;
  const createUrl = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const saved = [], blobs = [], revoked = [];
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:summary'; };
  URL.revokeObjectURL = url => revoked.push(url);
  document.createElement = tag => {
    const node = create(tag);
    if (tag === 'a') node.click = () => saved.push({ filename: node.download, href: node.href });
    return node;
  };
  return { saved, blobs, revoked, restore() { doc.createElement = create; URL.createObjectURL = createUrl; URL.revokeObjectURL = revoke; } };
}

test('hidden while loading or refused; only literal available:true offers the action; every open reads again', async () => {
  const first = deferred();
  let answer = () => first.promise;
  const v = await fixture(() => answer());
  try {
    assert.deepEqual(v.calls, [], 'no availability read before opening');
    await v.click('⋯');
    assert.doesNotMatch(v.text(), /Download summary/);
    await act(async () => first.resolve({ available: true }));
    assert.match(v.text(), /Download summary \(PDF\)/);
    assert.match(v.text(), /Copy link/);
    assert.match(v.text(), /Open company profile/);
    for (const result of [ { available: false, code: 'nda_required' }, { available: false, code: 'plan_required' }, { available: false, code: 'not_found' }, { available: 'true' }, null ]) {
      await v.click('⋯');
      answer = async () => result;
      await v.click('⋯');
      assert.doesNotMatch(v.text(), /Download summary/);
    }
    await v.click('⋯');
    answer = async () => { throw new Error('Access changed'); };
    await v.click('⋯');
    assert.doesNotMatch(v.text(), /Download summary/);
    assert.ok(v.calls.every(id => id === 17));
    assert.equal(v.calls.length, 7);
  } finally { await v.close(); }
});

test('selection downloads the returned blob and filename, and releases its object URL', async () => {
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  let signal;
  const v = await fixture(async () => ({ available: true }), async (id, options) => {
    assert.equal(id, 17); signal = options.signal;
    return { blob, filename: 'worker-summary-17.pdf' };
  });
  const dl = downloads();
  try {
    await v.click('⋯');
    await v.click('Download summary (PDF)');
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    assert.deepEqual(dl.blobs, [blob]);
    assert.deepEqual(dl.saved, [{ filename: 'worker-summary-17.pdf', href: 'blob:summary' }]);
    assert.deepEqual(dl.revoked, ['blob:summary']);
    assert.match(v.text(), /Summary downloaded/);
    assert.ok(!document.body.childNodes.some(n => n.href === 'blob:summary'));
  } finally { dl.restore(); await v.close(); }
});

test('a download-time refusal shows the Worker message and never saves a file', async () => {
  const v = await fixture(async () => ({ available: true }), async () => { throw new Error('Sign the NDA with this venture to download its summary.'); });
  const dl = downloads();
  try {
    await v.click('⋯');
    await v.click('Download summary (PDF)');
    assert.match(v.text(), /Sign the NDA with this venture to download its summary\./);
    assert.deepEqual(dl.saved, []);
    assert.deepEqual(dl.blobs, []);
  } finally { dl.restore(); await v.close(); }
});

test('unmount aborts the request; even a late successful response creates no download', async () => {
  const pending = deferred();
  let signal;
  const v = await fixture(async () => ({ available: true }), async (_id, options) => { signal = options.signal; return pending.promise; });
  const dl = downloads();
  try {
    await v.click('⋯');
    await v.click('Download summary (PDF)');
    assert.equal(signal.aborted, false);
    await v.close();
    assert.equal(signal.aborted, true);
    await act(async () => pending.resolve({ blob: new Blob(['pdf']), filename: 'late.pdf' }));
    assert.deepEqual(dl.saved, []);
    assert.deepEqual(dl.blobs, []);
  } finally { dl.restore(); }
});

test('a late availability reply cannot override the newer menu opening', async () => {
  const old = deferred();
  let answer = () => old.promise;
  const v = await fixture(() => answer());
  try {
    await v.click('⋯');
    await v.click('⋯');
    answer = async () => ({ available: true });
    await v.click('⋯');
    assert.match(v.text(), /Download summary/);
    await act(async () => old.resolve({ available: false }));
    assert.match(v.text(), /Download summary/);
  } finally { await v.close(); }
});

test('reopening and selecting during a pending download does not start a second request', async () => {
  const pending = deferred();
  let requests = 0;
  const v = await fixture(async () => ({ available: true }), async () => { requests += 1; return pending.promise; });
  const dl = downloads();
  try {
    await v.click('⋯');
    await v.click('Download summary (PDF)');
    await v.click('⋯');
    await v.click('Download summary (PDF)');
    assert.equal(requests, 1);
    await act(async () => pending.resolve({ blob: new Blob(['pdf']), filename: 'once.pdf' }));
    assert.deepEqual(dl.saved, [{ filename: 'once.pdf', href: 'blob:summary' }]);
  } finally { dl.restore(); await v.close(); }
});


test('navigation aborts a pending download and reports cancellation on the new tab', async () => {
  const pending = deferred();
  let signal;
  const v = await fixture(async () => ({ available: true }), async (_id, options) => { signal = options.signal; return pending.promise; });
  const dl = downloads();
  try {
    await v.click('⋯');
    await v.click('Download summary (PDF)');
    assert.match(v.text(), /Downloading summary/);
    await v.click('Next tab');
    assert.equal(signal.aborted, true);
    assert.match(v.text(), /Summary download cancelled\./);
    await act(async () => pending.resolve({ blob: new Blob(['pdf']), filename: 'cancelled.pdf' }));
    assert.deepEqual(dl.saved, []);
    assert.match(v.text(), /Summary download cancelled\./);
  } finally { dl.restore(); await v.close(); }
});
