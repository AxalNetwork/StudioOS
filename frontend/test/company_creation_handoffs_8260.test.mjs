/**
 * #8260 (D8260, Build v2 BD25) — Company creation's hand-offs on its page: Export filings and proofs
 * beside the filings table, and Add to Data room under the Documents list, each for the company's
 * members (shown only when the papers block read as a member's).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_creation_handoffs_8260.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { FilingsExport, PapersToDataRoom } from '../src/pages/cycles/CompanyCreationHandoffs.jsx';
import { companyCreationHandoffsApi } from '../src/lib/api/companyCreationHandoffs.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/company-creation?project_id=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const PAPERS = {
  can_add: true, reason: null,
  papers: [
    { kind: 'certificate_of_incorporation', label: 'Certificate of incorporation', state: 'Stored', document_uid: 'd1', in_room: true, preselected: false },
    { kind: 'bylaws', label: 'Bylaws', state: 'Stored', document_uid: 'd2', in_room: false, preselected: true },
    { kind: 'tax_id_letter', label: 'Tax ID letter', state: 'Missing', document_uid: null, in_room: false, preselected: false },
    { kind: 'registered_agent_agreement', label: 'Registered agent agreement', state: 'Unreadable', document_uid: 'd4', in_room: false, preselected: false },
  ],
};

test('Export filings and proofs is a button that names what it exports', () => {
  const out = html(h(FilingsExport, { projectId: 7 }));
  assert.match(out, /data-testid="company-filings-export"/);
  assert.match(text(out), /Export filings and proofs/);
  assert.match(out, /<button type="button"/);
});

test('Add to Data room starts closed, as one button', () => {
  const out = html(h(PapersToDataRoom, { projectId: 7 }));
  assert.match(out, /data-testid="company-papers-to-room"/);
  assert.match(text(out), /Add to Data room/);
  assert.doesNotMatch(out, /type="checkbox"/);
});

test('opened: the stored paper not in the room is ticked; one in the room, a missing and an unreadable one are not tickable', () => {
  const out = html(h(PapersToDataRoom, { projectId: 7, initial: PAPERS }));
  const boxes = [...out.matchAll(/<input[^>]*id="paper-([a-z_]+)"[^>]*>/g)].map((m) => [m[1], /checked=""/.test(m[0]), /disabled=""/.test(m[0])]);
  assert.deepEqual(boxes, [
    ['certificate_of_incorporation', false, true],
    ['bylaws', true, false],
    ['tax_id_letter', false, true],
    ['registered_agent_agreement', false, true],
  ]);
  const t = text(out);
  assert.match(t, /Already in the data room/);
  assert.match(t, /Missing: upload it on the company first/);
  assert.match(t, /Unreadable/);
  assert.match(t, /Add 1 to Data room/);
  assert.match(t, /under NDA and shared with nobody until you share them/);
});

test('a member without the room\'s upload right sees the papers and the reason, and no Add', () => {
  const out = html(h(PapersToDataRoom, { projectId: 7, initial: { ...PAPERS, can_add: false, reason: 'Only the venture’s owner or a co-founder adds papers to its data room.' } }));
  assert.doesNotMatch(out, /company-papers-room-add/);
  assert.match(text(out), /owner or a co-founder/);
});

test('the client calls the routes the Worker mounts, naming the venture on each', () => {
  const src = readFileSync('frontend/src/lib/api/companyCreationHandoffs.js', 'utf8');
  for (const path of ['/cycles/build/company-creation/filings/export', '/cycles/build/company-creation/data-room']) assert.ok(src.includes(path), path);
  const worker = readFileSync('cloudflare-worker/src/routes/company_creation_handoffs.ts', 'utf8');
  assert.match(worker, /r\.get\('\/company-creation\/filings\/export'/);
  assert.match(worker, /r\.get\('\/company-creation\/data-room'/);
  assert.match(worker, /r\.post\('\/company-creation\/data-room'/);
  assert.match(worker, /path: '\/api\/cycles\/build'/);
  assert.equal(typeof companyCreationHandoffsApi.exportFilings, 'function');
  assert.equal(typeof companyCreationHandoffsApi.addToDataRoom, 'function');
});

test('the page draws both hand-offs only where the papers read as a member\'s', () => {
  const page = readFileSync('frontend/src/pages/cycles/CompanyCreationHome.jsx', 'utf8');
  assert.match(page, /docs\.state === 'ok' && <FilingsExport projectId=\{projectId\} \/>/);
  assert.match(page, /docs\.state === 'ok' && <PapersToDataRoom projectId=\{projectId\} \/>/);
});
