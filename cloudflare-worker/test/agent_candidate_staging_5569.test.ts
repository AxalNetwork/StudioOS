// D5569 part 4: candidate staging against a synthetic Git server that hashes objects itself, with no credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { makeD1 } from './_d1_sqlite.mjs';
import { stageAgentCandidate, gitObjectSha, type GitResponse, type GitStagingTransport, type StagingRequest } from '../src/services/agents/agentCandidateStaging';
import { executeAgentPublication, type PublisherBrokerPorts, type PublisherPreflight } from '../src/services/agents/agentPublisherBroker';
import { type FileChange, type PublishIntent } from '../src/services/agents/agentPublisher';

const NOW = Date.UTC(2026, 10, 25, 12);
const AT = 1795000000;
const IDENTITY = { name: 'StudioOS Publisher', email: 'publisher@example.invalid' };
// Computed with git itself (`git write-tree`, `git commit-tree`) from the fixture below, not by the code under test.
const ORACLE_TREE = 'b3baae5982b84a9e105cb4667dbcbcd19ede234c';
const ORACLE_COMMIT = '27d09a9ba8c3d2db3b3e6dcb89d347e4c8b8c546';
const ORACLE_BASE = 'dc0b02e1f1e0a3d3d6fefa83ff883858c6842fe1';

type Flat = Map<string, { mode: string; sha: string }>;
type Obj = { type: 'blob'; bytes: Buffer } | { type: 'tree'; entries: { path: string; mode: string; type: string; sha: string }[] }
  | { type: 'commit'; tree: string; parents: string[] };

const gitSha = (type: string, body: Buffer) => createHash('sha1').update(type + ' ' + body.length + '\0').update(body).digest('hex');
const sha256 = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const b64 = (text: string) => Buffer.from(text).toString('base64');

/** A small Git object store: flat path maps in, nested trees out, the way GitHub's create-tree applies base_tree. */
function server() {
  const objects = new Map<string, Obj>();
  const blob = (bytes: Buffer) => { const sha = gitSha('blob', bytes); objects.set(sha, { type: 'blob', bytes }); return sha; };
  const build = (flat: Flat): string => {
    const files = new Map<string, Flat>(); const local: [string, string, string][] = [];
    for (const [path, e] of flat) {
      const [head, ...rest] = path.split('/');
      if (rest.length) { if (!files.has(head)) files.set(head, new Map()); files.get(head)!.set(rest.join('/'), e); }
      else local.push([head, e.mode, e.sha]);
    }
    const entries = [...local.map(([path, mode, sha]) => ({ path, mode, type: mode === '160000' ? 'commit' : 'blob', sha })),
      ...[...files].map(([path, sub]) => ({ path, mode: '040000', type: 'tree', sha: build(sub) }))];
    const key = (e: { path: string; type: string }) => Buffer.from(e.type === 'tree' ? e.path + '/' : e.path);
    entries.sort((a, b) => Buffer.compare(key(a), key(b)));
    const body = Buffer.concat(entries.map(e => Buffer.concat([Buffer.from(e.mode.replace(/^0/, '') + ' ' + e.path + '\0'), Buffer.from(e.sha, 'hex')])));
    const sha = gitSha('tree', body);
    objects.set(sha, { type: 'tree', entries });
    return sha;
  };
  const flatten = (tree: string, prefix = '', out: Flat = new Map()): Flat => {
    for (const e of (objects.get(tree) as Extract<Obj, { type: 'tree' }>).entries) {
      if (e.type === 'tree') flatten(e.sha, prefix + e.path + '/', out); else out.set(prefix + e.path, { mode: e.mode, sha: e.sha });
    }
    return out;
  };
  const commit = (tree: string, parents: string[], message: string, who: string) => {
    const body = Buffer.from('tree ' + tree + '\n' + parents.map(p => 'parent ' + p + '\n').join('') + 'author ' + who + '\ncommitter ' + who + '\n\n' + message);
    const sha = gitSha('commit', body);
    objects.set(sha, { type: 'commit', tree, parents });
    return sha;
  };
  const diff = (a: Flat, b: Flat) => {
    const paths = [...new Set([...a.keys(), ...b.keys()])].sort().filter(p => a.get(p)?.sha !== b.get(p)?.sha);
    const files = paths.map(p => ({ filename: p, status: !a.has(p) ? 'added' : !b.has(p) ? 'removed' : 'modified' }));
    return { files, text: paths.map(p => 'diff --git a/' + p + ' b/' + p + '\nindex ' + (a.get(p)?.sha ?? '0') + '..' + (b.get(p)?.sha ?? '0') + '\n').join('') };
  };
  const base: Flat = new Map([
    ['README.md', { mode: '100644', sha: blob(Buffer.from('hello\n')) }],
    ['bin/run.sh', { mode: '100755', sha: blob(Buffer.from('#!/bin/sh\necho run\n')) }],
    ['link', { mode: '120000', sha: blob(Buffer.from('README.md')) }],
    ['src/new.ts', { mode: '100644', sha: blob(Buffer.from('export const n = 0;\n')) }],
    ['src/x.ts', { mode: '100644', sha: blob(Buffer.from('export const x = 1;\n')) }],
  ]);
  const baseTree = build(base);
  const baseSha = commit(baseTree, [], 'base\n', 'Owner <owner@example.invalid> 1790000000 +0000');
  return { objects, blob, build, flatten, commit, diff, base, baseTree, baseSha, head: baseSha };
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): GitResponse =>
  ({ status, body: typeof data === 'string' ? data : JSON.stringify(data), headers: new Headers(headers) });

/** Answers repository-relative Git Data API paths; the broker test routes `/repos/venture/example/...` here too. */
function handle(s: ReturnType<typeof server>, method: string, path: string, body: Record<string, any> | null, accept: string): GitResponse {
  const obj = (sha: string) => s.objects.get(sha);
  if (method === 'GET') {
    if (path === '/git/ref/heads/main' || path === '/git/ref/heads%2Fmain') return json({ ref: 'refs/heads/main', object: { sha: s.head, type: 'commit' } });
    const m = path.match(/^\/git\/(blobs|trees|commits)\/([a-f0-9]{40})$/);
    if (m) {
      const o = obj(m[2]);
      if (!o || o.type !== m[1].slice(0, -1)) return json({ message: 'Not Found' }, 404);
      if (o.type === 'tree') return json({ sha: m[2], tree: o.entries, truncated: false });
      if (o.type === 'commit') return json({ sha: m[2], tree: { sha: o.tree }, parents: o.parents.map(sha => ({ sha })) });
      return json({ sha: m[2], size: o.bytes.length });
    }
    const c = path.match(/^\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/);
    if (c) {
      const [a, b] = [obj(c[1]), obj(c[2])];
      if (a?.type !== 'commit' || b?.type !== 'commit') return json({ message: 'Not Found' }, 404);
      const d = s.diff(s.flatten(a.tree), s.flatten(b.tree));
      return accept.includes('diff') ? json(d.text) : json({ total_commits: b.parents[0] === c[1] ? 1 : 2, files: d.files });
    }
  }
  if (method === 'POST' && body) {
    if (path === '/git/blobs') return json({ sha: s.blob(Buffer.from(body.content, 'base64')) }, 201);
    if (path === '/git/trees') {
      if (!obj(body.base_tree)) return json({ message: 'Invalid tree' }, 422);
      const flat = s.flatten(body.base_tree);
      for (const e of body.tree) { if (e.sha === null) flat.delete(e.path); else flat.set(e.path, { mode: e.mode, sha: e.sha }); }
      return json({ sha: s.build(flat) }, 201);
    }
    if (path === '/git/commits') {
      const who = (p: { name: string; email: string; date: string }) => p.name + ' <' + p.email + '> ' + Date.parse(p.date) / 1000 + ' +0000';
      assert.equal(who(body.author), who(body.committer));
      return json({ sha: s.commit(body.tree, body.parents, body.message, who(body.author)) }, 201);
    }
  }
  throw new Error('unexpected ' + method + ' ' + path);
}

function fixture(installationUid = 'f'.repeat(32)) {
  const s = server();
  const changes: FileChange[] = [
    { path: 'src/x.ts', change: 'modified' }, { path: 'src/new/y.ts', change: 'added' }, { path: 'bin/run.sh', change: 'removed' },
  ];
  const content: Record<string, string> = { 'src/x.ts': 'export const x = 2;\n', 'src/new/y.ts': 'export const y = 1;\n' };
  const expected = new Map(s.base);
  expected.set('src/x.ts', { mode: '100644', sha: gitSha('blob', Buffer.from(content['src/x.ts'])) });
  expected.set('src/new/y.ts', { mode: '100644', sha: gitSha('blob', Buffer.from(content['src/new/y.ts'])) });
  expected.delete('bin/run.sh');
  const intent: PublishIntent = {
    version: 1, tenant_id: 1, company_id: 2, project_id: 3, installation_uid: installationUid, repository_full_name: 'venture/example',
    target_ref: 'refs/heads/main', base_sha: s.baseSha, patch_digest: sha256(s.diff(s.base, expected).text), files: changes,
    provenance: { agent_id: 'agent:1', task_id: 'task-1', run_uuid: '11111111-2222-4333-8444-555555555555',
      attempt: 1, image_digest: 'sha256:' + 'c'.repeat(64), evidence_digest: 'sha256:' + 'd'.repeat(64) },
    agent_checks: { tests: 'passed', scan: 'passed' }, idempotency_key: 'publish:task-1:1', summary: '/approve @owner',
  };
  const calls: { method: string; path: string; body: Record<string, any> | null }[] = [];
  let override: ((method: string, path: string, body: Record<string, any> | null) => GitResponse | 'throw' | null) | null = null;
  const transport: GitStagingTransport = {
    repository_full_name: 'venture/example',
    get: async (path, accept = 'json') => {
      calls.push({ method: 'GET', path, body: null });
      const o = override?.('GET', path, null);
      if (o === 'throw') throw new Error('timeout');
      return o ?? handle(s, 'GET', path, null, accept);
    },
    post: async (path, body) => {
      calls.push({ method: 'POST', path, body });
      const o = override?.('POST', path, body);
      if (o === 'throw') throw new Error('timeout');
      return o ?? handle(s, 'POST', path, body, 'json');
    },
  };
  const request = (): StagingRequest => ({
    intent: structuredClone(intent), identity: { ...IDENTITY }, committed_at_s: AT,
    files: Object.entries(content).map(([path, text]) => ({ path, content_base64: b64(text) })),
  });
  return {
    s, intent, calls, transport, request, expected,
    override(fn: typeof override) { override = fn; },
    stage: (req: StagingRequest = request(), flag: unknown = 'on') => stageAgentCandidate(req, flag, { transport, now: () => NOW }),
    posts: () => calls.filter(c => c.method === 'POST'),
  };
}

test('git object ids match git for the empty tree and a known blob', async () => {
  assert.equal(await gitObjectSha('tree', new Uint8Array()), '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.equal(await gitObjectSha('blob', new TextEncoder().encode('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(fixture().s.baseSha, ORACLE_BASE);
});

test('stages the exact single-parent candidate git computes, writes objects only, and returns the diff digest', async () => {
  const f = fixture();
  const result = await f.stage();
  assert.deepEqual(result, { ok: true, candidate_sha: ORACLE_COMMIT, tree_sha: ORACLE_TREE, base_sha: f.s.baseSha,
    patch_digest: f.intent.patch_digest, replayed: false, writes: 4 });
  assert.deepEqual(f.posts().map(c => c.path), ['/git/blobs', '/git/blobs', '/git/trees', '/git/commits']);
  const tree = f.posts()[2].body!;
  assert.equal(tree.base_tree, f.s.baseTree);
  assert.deepEqual(tree.tree.find((e: any) => e.path === 'bin/run.sh'), { path: 'bin/run.sh', mode: '100755', type: 'blob', sha: null });
  const commit = f.posts()[3].body!;
  assert.deepEqual(commit.parents, [f.s.baseSha]);
  assert.equal(commit.author.date, '2026-11-18T11:06:40Z');
  assert.doesNotMatch(commit.message, /approve|@owner/);
  assert.match(commit.message, /^agent\/task-1\/1: staged candidate\n\n[^]*StudioOS-Run: 11111111-2222-4333-8444-555555555555\n/);
  // Nothing addresses a ref: the broker alone creates agent/<task>/<attempt>.
  assert.equal(f.calls.some(c => c.path.startsWith('/git/refs') || c.path.startsWith('/pulls')), false);
  const stored = f.s.objects.get(ORACLE_COMMIT) as { tree: string; parents: string[] };
  assert.deepEqual(stored, { type: 'commit', tree: ORACLE_TREE, parents: [f.s.baseSha] });
  assert.equal([...f.s.flatten(ORACLE_TREE).keys()].some(p => p.startsWith('bin/')), false);
});

test('a duplicate attempt finds the candidate by its content address and writes nothing', async () => {
  const f = fixture();
  assert.equal((await f.stage()).ok, true);
  const before = f.posts().length;
  const again = await f.stage();
  assert.deepEqual(again, { ok: true, candidate_sha: ORACLE_COMMIT, tree_sha: ORACLE_TREE, base_sha: f.s.baseSha,
    patch_digest: f.intent.patch_digest, replayed: true, writes: 0 });
  assert.equal(f.posts().length, before);
  // Concurrent duplicates write the same objects and agree on one SHA.
  const g = fixture();
  const both = await Promise.all([g.stage(), g.stage()]);
  assert.deepEqual(both.map(r => r.ok && r.candidate_sha), [ORACLE_COMMIT, ORACLE_COMMIT]);
});

test('disabled, another repository, a moved or unknown base refuse before any write', async () => {
  const f = fixture();
  for (const flag of [null, 'off', 'ON', true]) assert.deepEqual(await f.stage(f.request(), flag), { ok: false, code: 'publisher_disabled', retryable: false });
  assert.deepEqual(await stageAgentCandidate(f.request(), undefined, { transport: f.transport, now: () => NOW }),
    { ok: false, code: 'publisher_disabled', retryable: false });
  assert.equal(f.calls.length, 0);
  const other = stageAgentCandidate(f.request(), 'on', { transport: { ...f.transport, repository_full_name: 'venture/other' }, now: () => NOW });
  assert.deepEqual(await other, { ok: false, code: 'repository_mismatch', retryable: false });
  assert.equal(f.calls.length, 0);
  f.s.head = 'e'.repeat(40);
  assert.deepEqual(await f.stage(), { ok: false, code: 'base_moved', retryable: false });
  f.s.head = f.s.baseSha;
  f.override((m, p) => (p === '/git/ref/heads/main' ? json({ message: 'Not Found' }, 404) : null));
  assert.deepEqual(await f.stage(), { ok: false, code: 'base_unknown', retryable: false });
  f.override((m, p) => (p === '/git/commits/' + f.s.baseSha ? json({ message: 'Not Found' }, 404) : null));
  assert.deepEqual(await f.stage(), { ok: false, code: 'base_unknown', retryable: false });
  assert.equal(f.posts().length, 0);
});

test('exact paths and operations: every mismatch with the base or the declared bytes refuses with no write', async () => {
  const cases: [string, (r: StagingRequest) => void, string, string[]?][] = [
    ['added over an existing file', r => { r.intent.files.push({ path: 'README.md', change: 'added' }); r.files.push({ path: 'README.md', content_base64: b64('x\n') }); }, 'candidate_conflict', ['README.md']],
    ['modified a missing file', r => { r.intent.files.push({ path: 'src/gone.ts', change: 'modified' }); r.files.push({ path: 'src/gone.ts', content_base64: b64('x\n') }); }, 'candidate_conflict', ['src/gone.ts']],
    ['removed a missing file', r => { r.intent.files.push({ path: 'src/gone.ts', change: 'removed' }); }, 'candidate_conflict', ['src/gone.ts']],
    ['modified a symlink', r => { r.intent.files.push({ path: 'link', change: 'modified' }); r.files.push({ path: 'link', content_base64: b64('x') }); }, 'candidate_conflict', ['link']],
    ['added below a file', r => { r.intent.files.push({ path: 'README.md/x', change: 'added' }); r.files.push({ path: 'README.md/x', content_base64: b64('x\n') }); }, 'candidate_conflict', ['README.md']],
    ['added a file where a directory is', r => { r.intent.files.push({ path: 'src/new', change: 'added' }); r.files.push({ path: 'src/new', content_base64: b64('x\n') }); }, 'candidate_conflict', ['src/new']],
    ['modified with identical bytes', r => { r.files[0].content_base64 = b64('export const x = 1;\n'); }, 'candidate_conflict', ['src/x.ts']],
    ['bytes for an undeclared path', r => { r.files.push({ path: 'src/extra.ts', content_base64: b64('x\n') }); }, 'invalid_content'],
    ['bytes for a removal', r => { r.files.push({ path: 'bin/run.sh', content_base64: b64('x\n') }); }, 'invalid_content'],
    ['missing bytes', r => { r.files.pop(); }, 'invalid_content', ['src/new/y.ts']],
    ['the same path twice', r => { r.files.push({ ...r.files[0] }); }, 'invalid_content'],
    ['non-canonical base64', r => { r.files[0].content_base64 = 'eA'; }, 'invalid_content'],
    ['binary content', r => { r.files[0].content_base64 = Buffer.from([0x61, 0, 0x62]).toString('base64'); }, 'unsupported_content'],
    ['invalid UTF-8', r => { r.files[0].content_base64 = Buffer.from([0xff, 0xfe]).toString('base64'); }, 'unsupported_content'],
    ['an identity that forges a header', r => { r.identity.email = 'a@b>\ncommitter x'; }, 'invalid_content'],
    ['no fixed commit time', r => { r.committed_at_s = 0; }, 'invalid_content'],
    ['an invalid intent', r => { r.intent.base_sha = 'nope'; }, 'invalid_intent'],
  ];
  for (const [name, mutate, code, paths] of cases) {
    const f = fixture();
    const req = f.request();
    mutate(req);
    const result = await f.stage(req);
    assert.equal(result.ok, false, name);
    assert.equal(!result.ok && result.code, code, name);
    if (paths) assert.deepEqual(!result.ok && result.paths, paths, name);
    assert.equal(f.posts().length, 0, name);
  }
});

test('the base tree GitHub lists must hash to the SHA it named and be complete', async () => {
  const f = fixture();
  f.override((m, p) => {
    if (p !== '/git/trees/' + f.s.baseTree) return null;
    const listed = handle(f.s, 'GET', p, null, 'json');
    const tree = JSON.parse(listed.body);
    tree.tree = tree.tree.filter((e: { path: string }) => e.path !== 'link');
    return json(tree);
  });
  assert.deepEqual(await f.stage(), { ok: false, code: 'candidate_mismatch', retryable: false });
  f.override((m, p) => (p === '/git/trees/' + f.s.baseTree ? json({ ...JSON.parse(handle(f.s, 'GET', p, null, 'json').body), truncated: true }) : null));
  assert.deepEqual(await f.stage(), { ok: false, code: 'candidate_mismatch', retryable: false });
  assert.equal(f.posts().length, 0);
});

test('a SHA GitHub returns that differs from the computed one stops staging before the next object', async () => {
  const f = fixture();
  f.override((m, p) => (m === 'POST' && p === '/git/trees' ? json({ sha: 'e'.repeat(40) }, 201) : null));
  assert.deepEqual(await f.stage(), { ok: false, code: 'candidate_mismatch', retryable: false });
  assert.equal(f.posts().some(c => c.path === '/git/commits'), false);
  const g = fixture();
  g.override((m, p) => (m === 'POST' && p === '/git/blobs' ? json({ sha: 'e'.repeat(40) }, 201) : null));
  assert.deepEqual(await g.stage(), { ok: false, code: 'candidate_mismatch', retryable: false });
  assert.equal(g.posts().length, 1);
});

test('an unanswered write is re-read by its expected SHA: found continues, absent is unknown, a re-run completes', async () => {
  const f = fixture();
  // The commit landed but the answer was lost.
  f.override((m, p, body) => { if (m === 'POST' && p === '/git/commits') { handle(f.s, m, p, body, 'json'); return 'throw'; } return null; });
  const landed = await f.stage();
  assert.equal(landed.ok && landed.candidate_sha, ORACLE_COMMIT);
  assert.equal(f.calls.filter(c => c.path === '/git/commits/' + ORACLE_COMMIT).length, 2);
  // A 5xx on the tree after GitHub stored it.
  const g = fixture();
  g.override((m, p, body) => { if (m === 'POST' && p === '/git/trees') { handle(g.s, m, p, body, 'json'); return json('', 502); } return null; });
  assert.equal((await g.stage()).ok, true);
  // The commit never landed: unknown, retryable, and nothing is assumed.
  const h = fixture();
  h.override((m, p) => (m === 'POST' && p === '/git/commits' ? 'throw' : null));
  assert.deepEqual(await h.stage(), { ok: false, code: 'staging_unknown', retryable: true });
  assert.equal(h.s.objects.has(ORACLE_COMMIT), false);
  // The re-read itself goes unanswered: still unknown, never a success.
  const k = fixture();
  k.override((m, p) => (p === '/git/commits' || (m === 'GET' && p === '/git/commits/' + ORACLE_COMMIT && k.posts().length) ? 'throw' : null));
  assert.deepEqual(await k.stage(), { ok: false, code: 'staging_unknown', retryable: true });
  h.override(null);
  const rerun = await h.stage();
  assert.equal(rerun.ok && rerun.candidate_sha, ORACLE_COMMIT);
});

test('403, 429, 401, 404, 409 and 422 are classified; a read timeout is retryable', async () => {
  const at = (status: number, body = '{}', headers: Record<string, string> = {}) => {
    const f = fixture();
    f.override((m, p) => (m === 'POST' && p === '/git/trees' ? json(body, status, headers) : null));
    return f.stage();
  };
  assert.deepEqual(await at(403, '{"message":"Resource not accessible by integration"}'), { ok: false, code: 'github_forbidden', retryable: false });
  assert.deepEqual(await at(403, '{"message":"You have exceeded a secondary rate limit"}'),
    { ok: false, code: 'github_rate_limited', retryable: true, retry_at: new Date(NOW + 60_000).toISOString() });
  assert.deepEqual(await at(429, '{}', { 'retry-after': '120' }),
    { ok: false, code: 'github_rate_limited', retryable: true, retry_at: new Date(NOW + 120_000).toISOString() });
  assert.deepEqual(await at(401), { ok: false, code: 'github_unauthorized', retryable: false });
  assert.deepEqual(await at(404), { ok: false, code: 'github_rejected', retryable: false });
  assert.deepEqual(await at(409), { ok: false, code: 'github_rejected', retryable: false });
  assert.deepEqual(await at(422), { ok: false, code: 'github_rejected', retryable: false });
  const f = fixture();
  f.override((m, p) => (p === '/git/ref/heads/main' ? 'throw' : null));
  assert.deepEqual(await f.stage(), { ok: false, code: 'github_unavailable', retryable: true });
  f.override((m, p) => (p === '/git/ref/heads/main' ? json('', 503) : null));
  assert.deepEqual(await f.stage(), { ok: false, code: 'github_unavailable', retryable: true });
});

test('the candidate must compare as one commit with exactly the declared files and the approved diff digest', async () => {
  const f = fixture();
  f.intent.patch_digest = sha256('another patch');
  const req = f.request();
  req.intent.patch_digest = sha256('another patch');
  assert.deepEqual(await f.stage(req), { ok: false, code: 'patch_digest_mismatch', retryable: false });
  const g = fixture();
  g.override((m, p) => (m === 'GET' && p.startsWith('/compare/') && !p.endsWith('diff')
    ? json({ total_commits: 1, files: [{ filename: 'src/x.ts', status: 'modified' }, { filename: 'src/new/y.ts', status: 'added' }, { filename: 'bin/run.sh', status: 'modified' }] }) : null));
  assert.deepEqual(await g.stage(), { ok: false, code: 'candidate_mismatch', retryable: false });
});

test('executeAgentPublication accepts the staged candidate and only then creates the agent ref and draft PR', async (t: TestContext) => {
  const { DB, db } = makeD1(`
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY, archived_at TEXT);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO company_profiles VALUES(2,NULL); INSERT INTO projects VALUES(3,2,NULL); INSERT INTO users VALUES(5);
  `);
  t.after(() => db.close());
  for (const path of ['202611122104_5569_venture_git_installations.sql', '202611190937_5569_agent_publish_requests.sql']) {
    db.exec(readFileSync(new URL('../sql/migrations/' + path, import.meta.url), 'utf8'));
  }
  db.exec('CREATE TABLE team_agents(id INTEGER PRIMARY KEY); CREATE TABLE scope_tasks(id INTEGER PRIMARY KEY); ' +
    'CREATE TABLE agent_scope_settings(id INTEGER PRIMARY KEY); CREATE TABLE ai_agent_policy(id INTEGER PRIMARY KEY);');
  db.exec(readFileSync(new URL('../sql/migrations/202611221909_8071_agent_budgets.sql', import.meta.url), 'utf8'));
  const uid = db.prepare(`INSERT INTO venture_git_installations(tenant_id,company_id,project_id,app_id,installation_id,
    repository_id,repository_full_name,base_ref,approved_at,approved_by_user_id)
    VALUES(1,2,3,20,30,40,'venture/example','refs/heads/main','2026-11-19',5) RETURNING uid`).get()!.uid as string;
  const f = fixture(uid);
  const staged = await f.stage();
  assert.equal(staged.ok, true);
  const candidate = staged.ok ? staged.candidate_sha : '';
  const writes: string[] = [];
  const evidence: PublisherPreflight = {
    candidate_sha: candidate,
    observations: {
      now_ms: NOW, enabled: true,
      installation: { uid, tenant_id: 1, company_id: 2, project_id: 3, repository_full_name: 'venture/example', base_ref: 'refs/heads/main',
        revoked_at: null, approved_by_user_id: 5, github_status: 'active', allowed_paths: ['src/', 'bin/'], observed_at_ms: NOW },
      base_head_sha: f.s.baseSha, existing_prs: [], last_github_response: null,
      candidate_checks: { required: ['test'], results: { test: 'success' } },
      approvals: [{ user_id: 5, decision_uid: 'e'.repeat(32) }],
    },
    work_intent: { uid: 'work-1', tenant_id: 1, company_id: 2, project_id: 3, repository_full_name: 'venture/example',
      task_id: 'task-1', agent_id: 'agent:1', run_uuid: f.intent.provenance.run_uuid, base_sha: f.s.baseSha,
      paths: f.intent.files.map(x => x.path), expires_at_ms: NOW + 60_000, state: 'active' },
  };
  const ports: PublisherBrokerPorts = {
    now: () => NOW, authorize: async () => true, preflight: async () => structuredClone(evidence), appJwt: async () => 'synthetic-app-jwt',
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(String(init.body)) : null;
      const accept = String((init.headers as Record<string, string>).Accept);
      const reply = (r: GitResponse) => new Response(r.body, { status: r.status });
      if (url.pathname === '/app/installations/30') return Response.json({ id: 30, app_id: 20, suspended_at: null });
      if (url.pathname.endsWith('/access_tokens')) return Response.json({ token: 'synthetic-token', expires_at: new Date(NOW + 3_600_000).toISOString() }, { status: 201 });
      if (url.pathname === '/repos/venture/example') return Response.json({ id: 40, full_name: 'venture/example' });
      const path = url.pathname.slice('/repos/venture/example'.length);
      if (init.method === 'POST') writes.push(path);
      if (path === '/git/refs') return Response.json({ ref: body.ref, object: { sha: body.sha } }, { status: 201 });
      if (path === '/pulls') return Response.json({ number: 9, html_url: 'https://github.com/venture/example/pull/9', draft: true, head: { sha: candidate } }, { status: 201 });
      return reply(handle(f.s, String(init.method), path, body, accept));
    },
  };
  const published = await executeAgentPublication({ DB }, { tenant_id: 1, company_id: 2, project_id: 3 }, f.intent, candidate, 'on', ports);
  assert.deepEqual(published, { ok: true, number: 9, url: 'https://github.com/venture/example/pull/9', commit_sha: candidate, replayed: false });
  assert.deepEqual(writes, ['/git/refs', '/pulls']);
  assert.equal(db.prepare('SELECT candidate_sha FROM agent_publish_requests').get()!.candidate_sha, candidate);
});
