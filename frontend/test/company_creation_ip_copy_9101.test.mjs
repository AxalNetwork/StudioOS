/**
 * D9101 (#9101; Build v2 BD25, BD29, BD30 C, BD31) — Company creation's IP
 * assignment step offers Record IP assignment when the founder's Spin-Out
 * application was accepted and the venture has no IP record, copies it through
 * `POST /cycles/build/project/ip-copy`, and then reads the record back from
 * `facts.ip`. A Super Admin in founder preview sees the founder-only line.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_creation_ip_copy_9101.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AfterFormation } from '../src/pages/cycles/CompanyCreationHome.jsx';
import { ipCopyErrorWords, ipStep, runIpCopy } from '../src/pages/cycles/companyCreationModel.js';
import { isFounderPreview } from '../src/pages/cycles/previewUploadModel.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/company-creation?project_id=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const IP = { origin: 'university', institution: 'Sample University', research_group: 'Materials Lab', tto_status: 'signed', ip: ['patent_filed'] };
const lab = (status) => ({ status: 'ready', application: status ? { id: 42, status } : null });
const FOUNDER = { superAdmin: false, isImpersonating: false, viewMode: 'founder' };
const PREVIEW = { superAdmin: true, isImpersonating: false, viewMode: 'founder' };
const SUPPORT = { superAdmin: true, isImpersonating: true, viewMode: 'founder' };

test('model: a recorded IP step reads the copied record and offers nothing', () => {
  const ip = ipStep({ ip: IP }, lab('accepted'), FOUNDER);
  assert.equal(ip.recorded, true);
  assert.equal(ip.value, 'university · Sample University · Materials Lab · signed · patent filed');
  assert.equal(ip.source, 'Copied spinout IP record');
  assert.equal(ip.action, null);
});

test('model: no record and an accepted application → copy, with that application id', () => {
  const ip = ipStep({ ip: null }, lab('accepted'), FOUNDER);
  assert.equal(ip.recorded, false);
  assert.equal(ip.action, 'copy');
  assert.equal(ip.applicationId, 42);
});

test('model: no record and no accepted application keeps today’s reason and offers no button', () => {
  const today = ipStep({ ip: null }).reason;
  for (const status of ['pending', 'declined', 'withdrawn', null]) {
    const ip = ipStep({ ip: null }, lab(status), FOUNDER);
    assert.equal(ip.action, null, String(status));
    assert.equal(ip.reason, today);
    assert.equal(ip.note, null);
  }
  assert.equal(ipStep({ ip: null }, { status: 'ready', application: { id: 'x', status: 'accepted' } }, FOUNDER).action, null);
});

test('model: the Lab read loading or unreadable is the step’s own state, with no button', () => {
  const loading = ipStep({ ip: null }, { status: 'loading' }, FOUNDER);
  assert.equal(loading.check, 'loading');
  assert.equal(loading.action, null);
  const bad = ipStep({ ip: null }, { status: 'unreadable' }, FOUNDER);
  assert.equal(bad.check, 'unreadable');
  assert.equal(bad.action, null);
  assert.equal(bad.note, 'Could not check your Spin-Out application.');
});

test('model: founder preview says only the founder can copy; a support session is not preview', () => {
  assert.equal(isFounderPreview(PREVIEW), true);
  const ip = ipStep({ ip: null }, lab('accepted'), PREVIEW);
  assert.equal(ip.action, null);
  assert.equal(ip.note, 'Only the founder can copy their own Spin-Out application.');
  assert.equal(isFounderPreview(SUPPORT), false);
  assert.equal(ipStep({ ip: null }, lab('accepted'), SUPPORT).action, 'copy');
});

test('client: ipCopy posts the application id to the venture’s ip-copy route', async () => {
  const calls = [];
  const w = makeCycleWrites((path, opts) => { calls.push([path, opts]); return Promise.resolve({ ip: IP }); });
  await w.build.ipCopy(7, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/cycles/build/project/ip-copy?project=7');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { application_id: 42 });
});

test('press: a landed copy refetches the module; a failed one says why and does not', async () => {
  const ip = ipStep({ ip: null }, lab('accepted'), FOUNDER);
  const sent = [];
  let reloads = 0;
  assert.equal(await runIpCopy(ip, 7, (p, a) => { sent.push([p, a]); return Promise.resolve({ ip: IP }); }, () => { reloads += 1; }), '');
  assert.deepEqual(sent, [[7, 42]]);
  assert.equal(reloads, 1);
  const fail = (status) => () => Promise.reject(Object.assign(new Error('Accepted application not found'), { status }));
  assert.equal(await runIpCopy(ip, 7, fail(404), () => { reloads += 1; }), ipCopyErrorWords({ status: 404 }));
  assert.match(ipCopyErrorWords({ status: 404 }), /No accepted Spin-Out application/);
  assert.match(ipCopyErrorWords({ status: 503 }), /could not be read/);
  assert.match(ipCopyErrorWords(new TypeError('Failed to fetch')), /did not reach Axal/);
  assert.equal(reloads, 1);
  assert.equal(await runIpCopy(ipStep({ ip: null }, lab('pending'), FOUNDER), 7, () => { throw new Error('sent'); }, null), '');
});

const step = (ip, extra = {}) => html(h(AfterFormation, { ip, onCopy: () => {}, onRetryCheck: () => {}, ...extra }));

test('render: the button shows only in the copy state, Record on a phone, 44px', () => {
  const copy = step(ipStep({ ip: null }, lab('accepted'), FOUNDER));
  assert.match(copy, /data-testid="company-ip-copy"[^>]*>Record IP assignment</);
  assert.match(copy, /min-h-\[44px\][^"]*"[^>]*data-testid="company-ip-copy"/);
  assert.match(text(copy), /Not recorded/);
  assert.match(step(ipStep({ ip: null }, lab('accepted'), FOUNDER), { phone: true }), /data-testid="company-ip-copy"[^>]*>Record</);
  for (const ip of [
    ipStep({ ip: IP }, lab('accepted'), FOUNDER),
    ipStep({ ip: null }, lab('pending'), FOUNDER),
    ipStep({ ip: null }, { status: 'loading' }, FOUNDER),
    ipStep({ ip: null }, { status: 'unreadable' }, FOUNDER),
    ipStep({ ip: null }, lab('accepted'), PREVIEW),
  ]) assert.doesNotMatch(step(ip), /company-ip-copy"/, JSON.stringify(ip));
});

test('render: saving, a failed copy, an unreadable Lab read, preview and the copied record', () => {
  const copy = ipStep({ ip: null }, lab('accepted'), FOUNDER);
  assert.match(step(copy, { saving: true }), /disabled=""[^>]*data-testid="company-ip-copy"[^>]*>Saving…</);
  const err = step(copy, { error: ipCopyErrorWords({ status: 503 }) });
  assert.match(err, /role="alert" data-testid="company-ip-error"/);
  assert.match(text(err), /could not be read, so nothing was copied/);
  assert.match(err, /data-testid="company-ip-copy"[^>]*>Try again</);
  const bad = text(step(ipStep({ ip: null }, { status: 'unreadable' }, FOUNDER)));
  assert.match(bad, /Could not check your Spin-Out application\. .*Could not be read Try again/);
  assert.match(text(step(ipStep({ ip: null }, lab('accepted'), PREVIEW))), /Only the founder can copy their own Spin-Out application\./);
  const done = text(step(ipStep({ ip: IP }, null, FOUNDER)));
  assert.match(done, /university · Sample University · Materials Lab · signed · patent filed · Copied spinout IP record/);
  assert.doesNotMatch(done, /Not recorded|[{}]/);
});
