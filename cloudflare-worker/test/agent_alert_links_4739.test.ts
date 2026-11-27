// #4739: every link the agent alerts and the skill-evaluation notices send the bell to is a page the SPA
// serves. `/admin/agents` and `/admin/operations` were not: App.jsx's `/admin/*` catch-all drew NotFoundPage.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/agent_alert_links_4739.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haltAlert } from '../src/services/agents/alerts.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ROUTES = [...read('frontend/src/App.jsx').matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

/** Whether the SPA has a route for this path (a `:param` segment matches any one segment). */
const served = (path: string) => ROUTES.some((r) => {
  const a = r.split('/'), b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
});

/** Every `link: '…'` or link: `…${x}…` in a source file, with `${…}` read as one path segment. */
function linksIn(file: string): string[] {
  return [...read(file).matchAll(/\blink:\s*(['`])([^'`]*)\1/g)].map((m) => m[2].replace(/\$\{[^}]+\}/g, ':param'));
}

test('the route table is read', () => {
  assert.ok(ROUTES.length > 100);
  assert.ok(served('/hq/ai-agents/operations/policies'));
  assert.equal(served('/admin/agents'), false, 'the old halt link has no route');
  assert.equal(served('/admin/operations'), false, 'the old dead-letter link has no route');
});

test('every link in the agent alerts and the skill evaluation notices is a page the SPA serves', () => {
  for (const file of ['cloudflare-worker/src/services/agents/alerts.ts', 'cloudflare-worker/src/services/agents/skillEval.ts']) {
    const links = linksIn(file);
    assert.ok(links.length > 0, `${file} sends at least one link`);
    for (const l of links) assert.ok(served(l), `${file}: ${l} is not a route in App.jsx`);
  }
});

test('the dead-letter and gateway alerts open Operations, and the halt alerts open Policies', () => {
  const alerts = read('cloudflare-worker/src/services/agents/alerts.ts');
  assert.equal([...alerts.matchAll(/link: '\/hq\/ai-agents\/operations'/g)].length, 2);
  assert.equal([...alerts.matchAll(/link: '\/hq\/ai-agents\/operations\/policies'/g)].length, 2);
  assert.doesNotMatch(alerts, /\/admin\/agents|\/admin\/operations/);
});

test('a halt set or cleared tells HQ with the Policies link', async () => {
  const sent: any[] = [];
  const tellHq = async (_env: unknown, n: any) => { sent.push(n); return 1; };
  await haltAlert({} as any, true, 'Provider incident', 'Sue Super', { tellHq });
  await haltAlert({} as any, false, null, 'Sue Super', { tellHq });
  assert.deepEqual(sent.map((n) => [n.type, n.link]), [
    ['agents_halt_set', '/hq/ai-agents/operations/policies'],
    ['agents_halt_cleared', '/hq/ai-agents/operations/policies'],
  ]);
  for (const n of sent) assert.ok(served(n.link));
});
