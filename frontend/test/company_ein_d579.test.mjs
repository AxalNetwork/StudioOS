/**
 * D579 (#1206) — the company's EIN on the Lab Incorporate page.
 *
 * The owner chose 1A (store it) and 2A (the founder, company editors and
 * admins read it; investors do not). What this pins:
 *   - the card shows the last four digits, Not recorded with its reason, or
 *     Unreadable, never an invented value;
 *   - the investor preview's tile never shows the number: Not shared when one
 *     is stored, Not recorded when none is, and the old "Pending" is gone;
 *   - the page reads it for its project and folds no failure into "none";
 *   - the client calls the Worker's routes.
 * The Worker's half is cloudflare-worker/test/company_ein_d579.test.ts.
 * Every number here is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_ein_d579.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import CompanyEinCard, {
  EIN_NOT_SHARED, EIN_REASONS, EIN_SHAPE, EinPreviewValue, EinValue,
} from '../src/components/spinout/CompanyEinCard.jsx';

const PAGE = readFileSync(resolve(process.cwd(), 'frontend/src/pages/SpinoutLabIncorporatePage.jsx'), 'utf8');
const WORKER = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/companyEin.ts'), 'utf8');
const render = (el) => renderToStaticMarkup(el);
const RECORDED = { status: 'ready', data: { recorded: true, last4: '6789', masked: '••-•••6789', recorded_at: '2026-10-06 10:00:00' } };
const NONE = { status: 'ready', data: { recorded: false, last4: null, masked: null, recorded_at: null } };

test('the card\'s value: the last four, Not recorded with its reason, or Unreadable', () => {
  assert.equal(render(h(EinValue, { ein: RECORDED })), '••-•••6789');
  assert.equal(render(h(EinValue, { ein: NONE })), `<span class="italic text-gray-500 dark:text-gray-400" title="${EIN_REASONS.none}">Not recorded</span>`);
  assert.match(render(h(EinValue, { ein: { status: 'unreadable', data: null } })), new RegExp(`title="${EIN_REASONS.unreadable}">Unreadable<`));
  assert.match(render(h(EinValue, { ein: { status: 'no-project', data: null } })), new RegExp(`title="${EIN_REASONS.noProject}">Not recorded<`));
});

test('the investor preview never shows the number', () => {
  const stored = render(h(EinPreviewValue, { ein: RECORDED }));
  assert.ok(stored.includes(`title="${EIN_NOT_SHARED}">Not shared<`), stored);
  assert.ok(!stored.includes('6789'), 'the preview shows the digits');
  assert.match(render(h(EinPreviewValue, { ein: NONE })), new RegExp(`title="${EIN_REASONS.none}">Not recorded<`));
  assert.match(render(h(EinPreviewValue, { ein: { status: 'unreadable', data: null } })), />Unreadable</);
  assert.match(EIN_NOT_SHARED, /do not see the EIN/);
});

test('the card offers Add EIN with none stored and Edit with one, and nothing while unreadable', () => {
  const none = render(h(CompanyEinCard, { projectId: 1, ein: NONE }));
  assert.match(none, /data-testid="button-edit-company-ein"[^>]*>Add EIN</);
  const stored = render(h(CompanyEinCard, { projectId: 1, ein: RECORDED }));
  assert.match(stored, /data-testid="text-company-ein">••-•••6789</);
  assert.match(stored, />Edit</);
  const unreadable = render(h(CompanyEinCard, { projectId: 1, ein: { status: 'unreadable', data: null } }));
  assert.doesNotMatch(unreadable, /button-edit-company-ein/, 'an edit is offered over a read that failed');
  assert.doesNotMatch(render(h(CompanyEinCard, { projectId: null, ein: { status: 'no-project', data: null } })), /button-edit-company-ein/);
});

test('the shape is the Worker\'s: NN-NNNNNNN', () => {
  assert.equal(EIN_SHAPE.test('12-3456789'), true);
  for (const bad of ['123456789', '12-345678', '12-34567890', 'ab-cdefghi', '12 3456789']) assert.equal(EIN_SHAPE.test(bad), false, bad);
  assert.ok(WORKER.includes(`export const EIN_SHAPE = ${EIN_SHAPE.toString()};`), 'the card and the Worker accept different shapes');
});

test('the page reads the EIN for its project, and a failure is Unreadable, never none', () => {
  const code = codeOnly(PAGE);
  assert.match(code, /companyEinApi\.read\(proj\.id\)\.then\(\s*\(data\) => \(\{ status: 'ready', data \}\),\s*\(e\) => \{ reportError\('spinout-inc:ein', e\); return \{ status: 'unreadable', data: null \}; \},/);
  assert.match(code, /setEin\(einRead\);/);
  assert.match(code, /if \(!proj\) setEin\(\{ status: projects === null \? 'unreadable' : 'no-project', data: null \}\);/);
  assert.match(code, /<CompanyEinCard projectId=\{project\?\.id\} ein=\{ein\} onSaved=\{\(data\) => setEin\(\{ status: 'ready', data \}\)\} \/>/);
  assert.match(code, /data-testid="investor-ein"><EinPreviewValue ein=\{ein\} \/>/);
  assert.doesNotMatch(code, /\{paid \? 'Pending' : '—'\}/, 'the preview still prints EIN Pending');
});

test('the client calls the Worker\'s EIN routes', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { companyEinApi } = await import('../src/lib/api/companyEin.js');
    await companyEinApi.read(4);
    await companyEinApi.read(4, { full: true });
    await companyEinApi.save(4, '12-3456789');
    assert.deepEqual(calls, [
      ['GET', '/company-ein/4', null],
      ['GET', '/company-ein/4?full=1', null],
      ['PUT', '/company-ein/4', { ein: '12-3456789' }],
    ]);
  } finally { globalThis.fetch = original; }
  assert.match(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8'), /app\.route\('\/api\/company-ein', companyEin\);/);
});
