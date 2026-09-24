/**
 * D264 — the Durable Object jurisdiction is applied, at every site, and
 * never to HQ.
 *
 * `BRANCH_DO_JURISDICTION` scopes a branch's Durable Objects with
 * `ns.jurisdiction(v)`. A name gives a different object in each jurisdiction
 * and nothing can move one, so two failures matter and both are silent:
 *   - one site that skips the helper creates its objects unrestricted,
 *     outside the jurisdiction the branch was licensed for;
 *   - a helper that defaulted to a jurisdiction when the var is unset would
 *     re-home HQ, whose existing objects (a founder's chat history among
 *     them) were all created unrestricted, onto new, empty ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { doNamespace, DO_JURISDICTIONS } from '../src/util/doNamespace.ts';
import { notifyPipelineRoom } from '../src/services/realtime.ts';
import { DO_JURISDICTIONS as CONFIG_DO_JURISDICTIONS } from '../../scripts/lib/branchConfig.mjs';

/** A namespace that records every call, and whose jurisdiction() returns a recording sub-namespace. */
function recordingNs(label = 'root', log: string[] = []) {
  const ns: any = {
    label,
    log,
    jurisdiction(j: string) { log.push(`${label}.jurisdiction(${j})`); return recordingNs(`${label}/${j}`, log); },
    idFromName(n: string) { log.push(`${label}.idFromName(${n})`); return { name: n, ns: label }; },
    get(id: any) {
      log.push(`${label}.get(${id.name})`);
      return { async fetch() { return new Response('{}', { status: 200 }); } };
    },
  };
  return ns;
}

test('D264: with no var the namespace is returned unchanged, and jurisdiction() is never called', () => {
  for (const env of [{}, { BRANCH_DO_JURISDICTION: '' }, { BRANCH_DO_JURISDICTION: '  ' }, null, undefined]) {
    const ns = recordingNs();
    assert.equal(doNamespace(env as any, ns), ns);
    assert.deepEqual(ns.log, [], 'HQ was given a jurisdiction it never had');
  }
});

test('D264: eu, us and fedramp scope the namespace; anything else throws', () => {
  for (const j of ['eu', 'us', 'fedramp']) {
    const ns = recordingNs();
    const scoped = doNamespace({ BRANCH_DO_JURISDICTION: j } as any, ns);
    assert.equal(scoped.label, `root/${j}`);
    assert.deepEqual(ns.log, [`root.jurisdiction(${j})`]);
  }
  for (const bad of ['uk', 'EU', 'none', 'ch']) {
    assert.throws(() => doNamespace({ BRANCH_DO_JURISDICTION: bad } as any, recordingNs()), /not a Durable Object jurisdiction/,
      `${bad} fell back to an unrestricted namespace`);
  }
});

test('D264: the helper and the config renderer allow the same list', () => {
  assert.deepEqual([...DO_JURISDICTIONS].sort(), [...CONFIG_DO_JURISDICTIONS].sort());
});

test('D264: a broadcast from a branch with eu reaches its objects through the eu sub-namespace', async () => {
  const log: string[] = [];
  const ns = recordingNs('PIPELINE_ROOM', log);
  await notifyPipelineRoom({ PIPELINE_ROOM: ns, BRANCH_DO_JURISDICTION: 'eu' } as any, 7, { type: 'stage_change' });
  const ids = log.filter((l) => l.includes('.idFromName('));
  assert.deepEqual(ids.sort(), ['PIPELINE_ROOM/eu.idFromName(deal:7)', 'PIPELINE_ROOM/eu.idFromName(overview)']);

  const hqLog: string[] = [];
  await notifyPipelineRoom({ PIPELINE_ROOM: recordingNs('PIPELINE_ROOM', hqLog) } as any, 7, { type: 'stage_change' });
  assert.ok(!hqLog.some((l) => l.includes('jurisdiction')), 'HQ\'s broadcast was scoped');
  assert.ok(hqLog.includes('PIPELINE_ROOM.idFromName(deal:7)'));
});

/** Every .ts file under src. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('D264: every Durable Object idFromName and get runs on a namespace doNamespace returned — at least six sites', () => {
  const SRC = resolve(process.cwd(), 'cloudflare-worker/src');
  let sites = 0;
  for (const file of sources(SRC)) {
    if (file.endsWith('doNamespace.ts')) continue;
    const src = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const m of src.matchAll(/([\w.]+)\.(idFromName|idFromString|newUniqueId)\(/g)) {
      sites += 1;
      const recv = m[1];
      assert.ok(/^\w+$/.test(recv), `${file}: ${recv}.${m[2]}( reaches a namespace directly, not through doNamespace`);
      assert.ok(src.includes(`const ${recv} = doNamespace(`),
        `${file}: ${recv} is not a namespace doNamespace returned`);
    }
  }
  assert.ok(sites >= 6, `only ${sites} Durable Object sites found; the scan has stopped seeing them`);
});

test('D264: HQ\'s route, HQ\'s Deploy step and the workflow default to the same jurisdiction', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const wf = read('.github/workflows/branch-provision.yml');
  const input = wf.slice(wf.indexOf('      do_jurisdiction:'), wf.indexOf('options:', wf.indexOf('      do_jurisdiction:')));
  const wfDefault = /default: '([a-z]+)'/.exec(input)?.[1];
  const routeDefault = /String\(body\.do_jurisdiction \?\? '([a-z]+)'\)/.exec(read('cloudflare-worker/src/routes/admin_deployments.ts'))?.[1];
  const uiDefault = /const \[doJur, setDoJur\] = useState\('([a-z]+)'\);/.exec(read('frontend/src/pages/admin/AdminLicences.jsx'))?.[1];
  assert.ok(wfDefault && routeDefault && uiDefault, `a default could not be read: ${wfDefault} ${routeDefault} ${uiDefault}`);
  assert.deepEqual([wfDefault, routeDefault], [uiDefault, uiDefault], 'the three places that choose a DO jurisdiction disagree on the default');
});
