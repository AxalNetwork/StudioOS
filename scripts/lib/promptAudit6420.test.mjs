// #6420: the instruction-file and skill fixes from the prompt audit, pinned so the stale text does not come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// GitHub's heading anchor: lower case, punctuation dropped, each space a hyphen.
const anchor = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

test('CLAUDE.md sends a migration through the deploy workflow, never a hand-run command on studioos-db', () => {
  const doc = read('CLAUDE.md');
  assert.doesNotMatch(doc, /applied via `wrangler d1 execute studioos-db/);
  assert.match(doc, /do not apply one to `studioos-db` by\s+hand/);
  assert.match(doc, /`node scripts\/migrate-d1\.mjs --remote`/);
  // The commands it names exist.
  assert.ok(existsSync(join(ROOT, 'scripts/migrate-d1.mjs')));
  assert.ok(JSON.parse(read('package.json')).scripts['d1:migrate:local']);
  assert.match(read('.github/workflows/cloudflare-worker-deploy.yml'), /run: node scripts\/migrate-d1\.mjs --remote\n/);
});

test('replit.md: the gotcha links resolve to the file and to a heading in it', () => {
  const doc = read('replit.md');
  assert.doesNotMatch(doc, /\]\(\.\/GOTCHAS\.md/);
  const links = [...doc.matchAll(/\]\((documentation\/architecture\/GOTCHAS\.md)(?:#([^)]+))?\)/g)];
  assert.equal(links.length, 9);
  const gotchas = read('documentation/architecture/GOTCHAS.md');
  const anchors = new Set([...gotchas.matchAll(/^#{1,6} (.+)$/gm)].map((m) => anchor(m[1])));
  for (const [, file, hash] of links) {
    assert.ok(existsSync(join(ROOT, file)), file);
    if (hash) assert.ok(anchors.has(hash), `no heading for #${hash}`);
  }
});

test('replit.md: the dev commands, the Vite major and the migration name match the repository', () => {
  const doc = read('replit.md');
  assert.doesNotMatch(doc, /python backend\/main\.py/);
  assert.ok(!existsSync(join(ROOT, 'backend/main.py')));
  assert.ok(existsSync(join(ROOT, 'backend/app/main.py')));
  assert.match(doc, /\*\*Dev\*\*: `cd frontend && npm run dev` \(frontend\) \+ `uv run uvicorn backend\.app\.main:app /);
  assert.ok(JSON.parse(read('frontend/package.json')).scripts.dev);

  const major = /(\d+)/.exec(JSON.parse(read('frontend/package.json')).devDependencies.vite)[1];
  assert.match(doc, new RegExp(`React 19 \\+ Vite ${major} \\+ Tailwind 4`));
  assert.match(read('README.md'), new RegExp(`React 19 \\+ Vite ${major} \\+ Tailwind 4`));

  assert.match(doc, /a new file is `YYYYMMDDHHMM_<issue>_<slug>\.sql`/);
  // The redirect handler is named by its first line, which is in index.ts, not by a line range.
  assert.doesNotMatch(doc, /`index\.ts` \(\d+-\d+\)/);
  const first = /`index\.ts` \(the handler that starts `([^`]+)`\)/.exec(doc)?.[1];
  assert.ok(first && read('cloudflare-worker/src/index.ts').includes(first), 'the quoted first line is in index.ts');
});

test('replit.md: the admin docs section is imported, and the text says to keep it', () => {
  const doc = read('replit.md');
  assert.doesNotMatch(doc, /is not imported by `sections\/index\.js`/);
  assert.match(doc, /`sections\/admin\.js` is imported by `sections\/index\.js` and sits last in `SECTIONS`/);
  const index = read('frontend/src/pages/docs/sections/index.js');
  assert.match(index, /^import admin from '\.\/admin';$/m);
  assert.match(index, /\n {2}admin,\n\];/);
});

test('README.md and AGENTS.md name a file and a CI job that exist', () => {
  const link = /\]\(([^)]*LEGAL_ENTITIES\.md)\)/.exec(read('README.md'))?.[1];
  assert.equal(link, 'documentation/architecture/LEGAL_ENTITIES.md');
  assert.ok(existsSync(join(ROOT, link)));

  const job = /`routing-docs` artifact of the\s+`([^`]+)` job/.exec(read('AGENTS.md'))?.[1];
  assert.equal(job, 'ci / fast');
  const ci = read('.github/workflows/ci.yml');
  // That job is the one that uploads the artifact.
  const fast = ci.slice(ci.indexOf(`    name: ${job}\n`));
  assert.ok(fast.startsWith(`    name: ${job}\n`), 'ci.yml has the job');
  const next = fast.slice(1).search(/\n {2}[\w-]+:\n/);
  assert.match(next < 0 ? fast : fast.slice(0, next + 1), /name: routing-docs\n/);
});

test('coordinator-audit workflow.js needs args.repo and carries no machine path', async () => {
  const src = read('.claude/skills/coordinator-audit/workflow.js');
  assert.doesNotMatch(src, /\/home\/user/);
  // The workflow runtime runs the file as an async body with `args` in scope.
  const AsyncFunction = (async () => {}).constructor;
  const run = (args) => new AsyncFunction('args', src.replace(/^export const /gm, 'const '))(args);
  await assert.rejects(run({ out: '/tmp/o', mainSha: 'abc', runId: 'r' }), /args\.repo is required/);
  // With a repo it gets past the check (and stops later, on the workflow runtime this test does not supply).
  const err = await run({ out: '/tmp/o', mainSha: 'abc', runId: 'r', repo: '/some/checkout' }).then(() => null, (e) => e);
  assert.doesNotMatch(String(err?.message || ''), /args\.repo is required/);
});

test('skills state rules, not one day\'s tally', () => {
  const skill = (name) => read(`.claude/skills/${name}/SKILL.md`);
  assert.doesNotMatch(skill('verify-before-push'), /Fourteen pairs|1-hour background/);
  assert.doesNotMatch(skill('land-pr'), /On 2026-11-14 none of the three held|Today the answer is almost always/);
  assert.match(skill('land-pr'), /Read all three every time/);
  assert.doesNotMatch(skill('task-lifecycle'), /On 2026-11-14 alone/);
  assert.doesNotMatch(skill('schema-change'), /between #5855 and #5822/);
  assert.doesNotMatch(skill('add-worker-endpoint'), /expected 19 normalised comparisons/);
  // Both skills that hand out the one-call suite point at the skill that runs it in parts.
  for (const name of ['task-lifecycle', 'build-screen-to-canvas']) assert.match(skill(name), /`verify-before-push` skill when one\s+run would outlast the session/);
  // The live-check rule is stated once, under the heading that says it is not in AGENTS.md.
  const rules = read('.claude/skills/coordinator-audit/RULES.md');
  assert.equal(rules.match(/owner's live check/g).length, 1);
  assert.ok(rules.indexOf("owner's live check") > rules.indexOf('not in AGENTS.md'));
});
