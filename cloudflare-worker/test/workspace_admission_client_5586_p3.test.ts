/**
 * D5586 part 3 (#5586): the `WORKSPACE_ADMISSION` client without a runtime: the one coordinator name, every
 * cross-venture argument refused before any stub call, a stub that throws or answers something unreadable read as
 * `admission_unavailable` (never thrown into the caller), and the wiring (the binding and the `v9-workspace-admission`
 * tag in all three wrangler.toml tables, the topology row, the class export, the Env field).
 * The binding round-trip itself is `workspace_admission_do_5586_p3.test.mjs` (Miniflare).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORKSPACE_ADMISSION_OBJECT, WORKSPACE_ADMISSION_OPS, coordinatorName, scopeRefusal, swarmSnapshotFor, workspaceAdmissionClient,
} from '../src/services/agents/workspaceAdmissionClient.ts';
import { BINDINGS } from '../src/services/topology.ts';
import { parseToml } from '../../scripts/lib/branchConfig.mjs';
import { missingFromProduction } from '../../scripts/check-wrangler-binding-parity.mjs';

const SEVEN = { tenantId: 7, companyId: 70 };
const v7 = { tenant_id: 7, company_id: 70 }, v8 = { tenant_id: 8, company_id: 80 }, v7other = { tenant_id: 7, company_id: 71 };

/** A namespace that records every name and body, answering `answer` (or throwing it). */
function fakeNs(answer: () => Response | Promise<Response>) {
  const names: string[] = [], bodies: any[] = [];
  const ns: any = {
    idFromName: (n: string) => { names.push(n); return { name: n }; },
    get: () => ({ fetch: async (_url: string, init: any) => { bodies.push(JSON.parse(init.body)); return answer(); } }),
  };
  return { ns, names, bodies };
}
const ok = (value: unknown) => () => Response.json({ ok: true, value });

test('every venture reaches the one coordinator by name, with its caller scope in the body', async () => {
  assert.equal(coordinatorName(v7), WORKSPACE_ADMISSION_OBJECT);
  assert.equal(coordinatorName(v8), WORKSPACE_ADMISSION_OBJECT);
  const f = fakeNs(ok({ tickets: {}, audit: [] }));
  const r = await swarmSnapshotFor({ WORKSPACE_ADMISSION: f.ns }, SEVEN);
  assert.deepEqual(r, { ok: true, value: { tickets: {}, audit: [] } });
  assert.deepEqual(f.names, [WORKSPACE_ADMISSION_OBJECT]);
  assert.deepEqual(f.bodies, [{ op: 'swarm.snapshotFor', caller: SEVEN, args: [v7] }]);
});

test('a call naming another venture is refused wrong_tenant before any stub call', async () => {
  const f = fakeNs(ok(null));
  const c = workspaceAdmissionClient({ WORKSPACE_ADMISSION: f.ns }, SEVEN);
  const req = (t: { tenant_id: number; company_id: number }) => ({ ticket_uid: 'run_x', ...t } as any);
  const outs = await Promise.all([
    c.swarm.snapshotFor(v8), c.swarm.snapshotFor(v7other),
    c.swarm.request(req(v8), { ...v7 } as any, {} as any), c.swarm.request(req(v7), { ...v7other } as any, {} as any),
    c.swarm.withdraw('run_x', v8), c.swarm.revoke(v7other, 9),
    c.swarm.promote({ 't8:c80': { policy: { ...v8 } as any, storage_used_bytes: 0 } }),
    c.swarm.promote({ 't7:c70': { policy: { ...v8 } as any, storage_used_bytes: 0 } }),
    c.admission.request({ run_uid: 'run_x', tenant_id: 8 } as any),
  ]);
  for (const o of outs) assert.deepEqual([o.ok, (o as any).code, (o as any).status, (o as any).reasons], [false, 'wrong_tenant', 403, ['wrong_tenant']]);
  assert.equal(f.bodies.length, 0, 'no stub call');
  // The same venture passes the check and reaches the stub.
  assert.equal(scopeRefusal('swarm.promote', SEVEN, [{ 't7:c70': { policy: { ...v7 } } }]), null);
  assert.equal(scopeRefusal('swarm.withdraw', SEVEN, ['run_x', v7]), null);
  assert.equal(scopeRefusal('admission.settle', SEVEN, ['run_x', 1, 2]), null);
  assert.equal(scopeRefusal('nope', SEVEN, [])?.code, 'invalid_admission_call');
  assert.equal(scopeRefusal('swarm.snapshotFor', { tenantId: 0, companyId: 70 }, [v7])?.code, 'invalid_admission_call');
  assert.equal(WORKSPACE_ADMISSION_OPS.length, 9);
});

test('no binding answers admission_unbound; a stub that throws, fails or answers garbage is admission_unavailable', async () => {
  assert.deepEqual(await swarmSnapshotFor({}, SEVEN), { ok: false, status: 503, code: 'admission_unbound',
    message: 'This workspace operation is not permitted by its current execution contract.', reasons: ['admission_unbound'] });
  assert.equal((await workspaceAdmissionClient({ WORKSPACE_ADMISSION: undefined }, SEVEN).admission.settle('run_x', 1, 1) as any).code, 'admission_unbound');
  for (const answer of [() => { throw new Error('down'); }, () => new Response('x', { status: 500 }), () => new Response('not json'),
    () => Response.json({ value: 1 }), () => Response.json({ ok: false }), () => Response.json({ ok: true }),
    () => Response.json({ ok: true, value: { tickets: {}, audit: [] } }, { status: 500 })]) {
    const r = await swarmSnapshotFor({ WORKSPACE_ADMISSION: fakeNs(answer).ns }, SEVEN);
    assert.deepEqual([r.ok, (r as any).code, (r as any).status], [false, 'admission_unavailable', 503]);
  }
  const refused = await swarmSnapshotFor({ WORKSPACE_ADMISSION: fakeNs(() => Response.json({ ok: false, status: 403, code: 'ticket_not_found', message: 'm' })).ns }, SEVEN);
  assert.deepEqual(refused, { ok: false, status: 403, code: 'ticket_not_found', message: 'm', reasons: ['ticket_not_found'] }, 'the object\'s refusal passes through');
  assert.equal((await swarmSnapshotFor({ WORKSPACE_ADMISSION: fakeNs(ok(null)).ns }, { tenantId: 7 } as any) as any).code, 'invalid_admission_call');
  assert.equal((await swarmSnapshotFor({ WORKSPACE_ADMISSION: fakeNs(ok(null)).ns }, null as any) as any).code, 'invalid_admission_call', 'no scope is refused, never thrown');
});

test('wiring: WORKSPACE_ADMISSION and v9-workspace-admission in all three tables, the topology, the class export and Env', () => {
  const { sections } = parseToml(readFileSync('wrangler.toml', 'utf8'));
  const unq = (v: string | undefined) => (v === undefined ? undefined : JSON.parse(v));
  for (const prefix of ['', 'env.production.', 'env.preview.']) {
    const dos = sections.filter((x: any) => x.name === `${prefix}durable_objects.bindings` && unq(x.kv.get('name')) === 'WORKSPACE_ADMISSION');
    assert.deepEqual(dos.map((x: any) => [unq(x.kv.get('class_name')), x.kv.get('script_name')]), [['WorkspaceAdmission', undefined]], prefix || 'top');
    const tags = sections.filter((x: any) => x.name === `${prefix}migrations`).map((x: any) => [unq(x.kv.get('tag')), x.kv.get('new_sqlite_classes')]);
    const v8 = tags.findIndex(([tag]: any) => tag === 'v8-work-graph-lease');
    assert.ok(v8 >= 0, prefix);
    assert.deepEqual(tags.slice(v8 + 1), [['v9-workspace-admission', '["WorkspaceAdmission"]']], `${prefix || 'top'}: append-only, last, after v8`);
  }
  assert.match(readFileSync('wrangler.toml', 'utf8'), /^main\s*=\s*"cloudflare-worker\/src\/index\.ts"$/m, 'main unchanged');
  assert.deepEqual(missingFromProduction(), []);
  assert.ok((BINDINGS as any[]).some((b) => b.name === 'WORKSPACE_ADMISSION' && b.hq === 'WorkspaceAdmission' && b.branch() === 'WorkspaceAdmission'));
  assert.match(readFileSync('cloudflare-worker/src/index.ts', 'utf8'), /^export \{ WorkspaceAdmission \} from '\.\/durable-objects\/workspace-admission';$/m);
  assert.match(readFileSync('cloudflare-worker/src/types.ts', 'utf8'), /^\s*WORKSPACE_ADMISSION\?: DurableObjectNamespace;$/m);
});
