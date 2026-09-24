/**
 * D209 — H14 and S14 state an architecture, so every claim on them is held
 * here to the file that decides it.
 *
 * WHY THIS TEST READS FILES AND NOT PROSE. The canvases drew the topology, and
 * measured against the code most of what they drew was false: Access guards
 * two KYC routes, not /hq and /admin/*; three screens write Worker secrets;
 * four RPC methods have no caller; the branch dimension is a blob, not an
 * index; and, until D253, nothing redeployed a branch. `services/topology.ts` carries the true
 * version as literals, and a literal is exactly how a false claim survives —
 * `branchConfig.test.mjs` once pinned the wrong entrypoint because it pinned
 * what the generator wrote rather than what the far side exports (D207). So
 * each literal is derived again here from its source:
 *
 *   the bindings            ← wrangler.toml's [env.production], and the branch
 *                             config `renderBranchConfig` generates from it
 *   the branch naming rule  ← `derivedNames` in scripts/lib/branchConfig.mjs
 *   the RPC surface         ← rpc/index.ts and every cross-tier call, through
 *                             scripts/lib/rpcSurface.mjs
 *   the deploys             ← .github/workflows/*.yml and the root package.json
 *   the secret writers      ← every `setSecret(` caller
 *   Cloudflare Access       ← every `requireCfAccess()` mount
 *   the AI Gateway          ← every gateway option the Worker builds
 *   Analytics Engine        ← every `aeSql(` and `writeDataPoint(` site
 *
 * and `describeTopology` is then run against HQ-shaped and branch-shaped envs,
 * because the runtime half — what is bound, what the branch cannot do — is read
 * from `env` and must say which way it came out rather than recite.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/topology_d209.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  BINDINGS, RPC_SURFACE, AE_READERS, NOT_FROM_ANALYTICS, DEPLOY_WORKFLOWS, DEPLOY_BY_HAND, BRANCH_DEPLOYED_BY, BRANCH_PROVISIONED_BY,
  SECRET_WRITERS, CF_ACCESS_PATHS, HQ_WORKER, TAIL_CONSUMER, branchResourceNames, describeTopology,
} from '../src/services/topology.ts';
import { GATEWAY_TASKS } from '../src/services/aiRouter.ts';
import {
  parseToml, renderBranchConfig, derivedNames, BRANCH_CALLS_HQ, HQ_CALLS_BRANCH, BRANCH_CODE_RE,
} from '../../scripts/lib/branchConfig.mjs';
import {
  ENTRYPOINT_ROLE, classesForRole, workerSources, hqToBranchCalls, branchToHqCalls,
} from '../../scripts/lib/rpcSurface.mjs';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'cloudflare-worker/src');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const TOML = read('wrangler.toml');
const EXAMPLE = JSON.parse(read('infra/branches/_example.json'));
const RPC = read('cloudflare-worker/src/rpc/index.ts');
const FILES: Array<{ file: string; src: string }> = workerSources(SRC);
const CODE = FILES.map(({ file, src }) => ({ file, code: codeOnly(src) }));

const unq = (v: string | undefined) => (v === undefined ? undefined : JSON.parse(v));

// ── binding tables, read the way wrangler reads them ────────────────────────

/** Keys that name the resource a binding points at. `id` is deliberately absent: a KV id is not a name. */
const RESOURCE_KEYS = ['database_name', 'bucket_name', 'queue', 'class_name', 'index_name', 'dataset', 'directory'];
/** A resource that belongs to one script whatever it is called — a DO class, an assets upload. */
const PER_SCRIPT_KEYS = new Set(['class_name', 'directory']);
/** Tables that are not bindings of this Worker: where it answers, what it is told, when it wakes, who reads its logs. */
const NOT_A_BINDING = new Set(['routes', 'vars', 'triggers', 'migrations', 'tail_consumers', 'queues.consumers', 'rules', 'observability', 'observability.logs', 'observability.traces']);

type Bound = { name: string; table: string; key: string | null; resource: string | null; id: string | null };

/** Every binding in a table set, with the key naming its resource. `prefix` is 'env.production.' for HQ, '' for a branch. */
function boundIn(src: string, prefix: string): Bound[] {
  const out: Bound[] = [];
  for (const s of parseToml(src).sections) {
    if (!s.name.startsWith(prefix)) continue;
    const table = s.name.slice(prefix.length);
    if (!table || table.includes('env.') || NOT_A_BINDING.has(table)) continue;
    const name = unq(s.kv.get('binding') ?? s.kv.get('name'));
    if (!name) continue;
    const key = RESOURCE_KEYS.find((k) => s.kv.has(k)) ?? null;
    out.push({ name, table, key, resource: key ? unq(s.kv.get(key)) : null, id: unq(s.kv.get('id')) ?? null });
  }
  return out;
}

const HQ_BOUND = boundIn(TOML, 'env.production.');
// A link PR's `BRANCH_<CODE>` line is HQ's view of a branch, not a binding of
// HQ's own kind; there are none today, and the page lists them apart.
const HQ_OWN = HQ_BOUND.filter((b) => !(b.table === 'services' && /^BRANCH_/.test(b.name)));
const BRANCH_RENDERED = renderBranchConfig(TOML, EXAMPLE);
const BRANCH_BOUND = boundIn(BRANCH_RENDERED, '');

// ── source-slicing helpers ──────────────────────────────────────────────────

/** The balanced `{…}` body that follows `from`, skipping quoted text and line comments. */
function braceBody(src: string, from: number): string {
  const open = src.indexOf('{', from);
  assert.ok(open >= 0, 'no body follows the anchor');
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '\'' || ch === '"') {
      for (i += 1; i < src.length && src[i] !== ch; i += 1) if (src[i] === '\\') i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
  }
  throw new Error('unbalanced body');
}

function uniqueAt(src: string, anchor: string): number {
  const at = src.indexOf(anchor);
  assert.ok(at >= 0, `anchor not found: ${anchor}`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `anchor is not unique: ${anchor}`);
  return at;
}

/** The body of a call or an arrow handler: the first `{` after the anchor. */
function bodyAfter(src: string, anchor: string): string {
  return braceBody(src, uniqueAt(src, anchor) + anchor.length);
}

/**
 * The body of a function DECLARATION whose anchor ends at its `(`. The first
 * `{` after the name is not the body when the parameters or the return type
 * are object types — `gatewayOptionFor`'s return type is one — so this skips
 * the parameter list, then takes the first `{` that ends its line.
 */
function fnBody(src: string, anchor: string): string {
  assert.ok(anchor.endsWith('('), 'a declaration anchor ends at its opening parenthesis');
  let i = uniqueAt(src, anchor) + anchor.length - 1;
  for (let depth = 0; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
  }
  const open = /\{[ \t]*\n/.exec(src.slice(i));
  assert.ok(open, `no body follows ${anchor}`);
  return braceBody(src, i + open.index);
}

/**
 * Every call to `name(` outside its own definition, as `{file, index}`.
 *
 * A LITERAL SCAN, NOT A PATTERN BUILT FROM THE NAME. The name is compared as
 * the text it is: not preceded by anything that makes it a member access or
 * part of a longer identifier, and followed — past any whitespace — by its
 * `(`. Measured against the regex it replaced, over every call this suite
 * makes: identical results, and a scan broken on purpose disagreed on three
 * names, so the comparison was live rather than vacuous.
 */
function callSites(name: string, files = CODE) {
  const out: Array<{ file: string; index: number }> = [];
  for (const { file, code } of files) {
    for (let at = code.indexOf(name); at >= 0; at = code.indexOf(name, at + 1)) {
      if (at > 0 && /[\w$.]/.test(code[at - 1])) continue;
      let i = at + name.length;
      while (/\s/.test(code[i] ?? '')) i += 1;
      if (code[i] !== '(') continue;
      if (/\bfunction\s+$/.test(code.slice(Math.max(0, at - 24), at))) continue;
      out.push({ file, index: at });
    }
  }
  return out;
}

// ── 1 · the bindings ────────────────────────────────────────────────────────

test('BINDINGS is exactly the set [env.production] declares, each naming the resource HQ binds', () => {
  const names = BINDINGS.map((b) => b.name);
  assert.equal(new Set(names).size, names.length, 'a binding is listed twice');
  assert.deepEqual([...names].sort(), HQ_OWN.map((b) => b.name).sort(),
    'wrangler.toml gained or lost a binding and the topology page does not say so');
  for (const b of BINDINGS) {
    const hq = HQ_OWN.find((x) => x.name === b.name)!;
    assert.equal(b.hq, hq.resource, `${b.name}: the page names ${b.hq}, [env.production] binds ${hq.resource}`);
  }
});

test('a generated branch config binds the same set plus HQ, under the names the page says', () => {
  const names = BRANCH_BOUND.map((b) => b.name).sort();
  assert.deepEqual(names, [...BINDINGS.map((b) => b.name), 'HQ'].sort(),
    'a branch binds every HQ binding and one link to HQ — nothing more');
  for (const b of BINDINGS) {
    const br = BRANCH_BOUND.find((x) => x.name === b.name)!;
    assert.equal(b.branch(EXAMPLE.code), br.resource,
      `${b.name}: the page names ${b.branch(EXAMPLE.code)} on a branch, the generated config binds ${br.resource}`);
  }
});

test('shared means one account-level resource under both configs, and nothing else', () => {
  for (const b of BINDINGS) {
    const hq = HQ_OWN.find((x) => x.name === b.name)!;
    const br = BRANCH_BOUND.find((x) => x.name === b.name)!;
    let shared: boolean;
    if (!hq.key && !hq.id) shared = true; // Workers AI, Browser Rendering: an account service, no resource
    else if (hq.key && PER_SCRIPT_KEYS.has(hq.key)) shared = false; // a DO class or an assets upload is per script
    else shared = hq.key ? hq.resource === br.resource : hq.id === br.id;
    assert.equal(b.shared, shared, `${b.name}: the page says shared=${b.shared}, the two configs say ${shared}`);
  }
  // The one data store every Worker shares is the Analytics Engine dataset (D105).
  assert.deepEqual(BINDINGS.filter((b) => b.shared && b.hq).map((b) => b.name), ['ANALYTICS']);
});

test('the branch naming rule is the generator\'s, for any code', () => {
  for (const code of ['fr', 'dach', 'example', 'ab', 'x1-2y']) {
    assert.ok(BRANCH_CODE_RE.test(code), `${code} must be a valid branch code for this to prove anything`);
    assert.deepEqual(branchResourceNames(code), derivedNames(code), `${code}: the page and the generator name its resources differently`);
  }
});

// ── 2 · the RPC surface ─────────────────────────────────────────────────────

const HARVEST = hqToBranchCalls(FILES);
const TO_BRANCH = new Set(HARVEST.calls.map((c: { method: string }) => c.method));
const TO_HQ = new Set(branchToHqCalls(FILES).map((c: { method: string }) => c.method));

for (const role of ['hqCallsBranch', 'branchCallsHq'] as const) {
  test(`${role}: the page lists the class's own methods, in order, with who calls them and which take a secret`, () => {
    assert.deepEqual(HARVEST.computed, [], 'a cross-tier call whose method is computed cannot be checked');
    const found = classesForRole(RPC, role);
    assert.equal(found.length, 1, `exactly one class is documented as "${ENTRYPOINT_ROLE[role]}"`);
    const cls = found[0];
    const side = RPC_SURFACE[role];
    assert.equal(side.class, cls.name);
    assert.equal(side.class, role === 'hqCallsBranch' ? HQ_CALLS_BRANCH : BRANCH_CALLS_HQ,
      'the page and the generator must name the same class for the same direction');
    assert.ok(ENTRYPOINT_ROLE[role].includes(`\`${side.called_over}\``), `the class is called over ${side.called_over}`);
    assert.equal(side.exported_by, /^Exported by HQ\b/.test(cls.doc) ? 'hq' : 'branch', `${cls.name}'s own doc line says who exports it`);
    assert.deepEqual(side.methods.map((mm) => mm.name), [...cls.params.keys()], 'the methods, in declaration order');
    const called = role === 'hqCallsBranch' ? TO_BRANCH : TO_HQ;
    assert.ok(called.size > 0, 'the harvest found no call at all — it proves nothing');
    for (const mm of side.methods) {
      assert.equal(mm.called, called.has(mm.name),
        `${cls.name}.${mm.name}: the page says called=${mm.called}, the source says ${called.has(mm.name)}`);
      assert.equal(mm.authenticated, cls.params.get(mm.name).includes('secret'),
        `${cls.name}.${mm.name}: the page says authenticated=${mm.authenticated}, its parameter list disagrees`);
    }
  });
}

// ── 3 · the deploys ─────────────────────────────────────────────────────────

const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const WORKFLOWS = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f)).sort()
  .map((file) => ({ file, src: readFileSync(join(WORKFLOW_DIR, file), 'utf8') }));
/** A workflow's lines that are not comments — prose that NAMES `wrangler deploy` does not run it. */
const codeLines = (src: string) => src.split('\n').filter((l) => !/^\s*#/.test(l));
const DEPLOY_RE = /\bwrangler(?:@[\d.]+)?\s+deploy\b/;
const deployLines = (src: string) => codeLines(src).filter((l) => DEPLOY_RE.test(l));

/** The trigger keys under a workflow's top-level `on:`. */
function triggersOf(src: string): string[] {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(at >= 0, 'a workflow with no block `on:`');
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l)) break;
    const k = /^ {2}([a-z_]+):/.exec(l);
    if (k) out.push(k[1]);
  }
  return out;
}

test('exactly the three listed workflows run wrangler deploy, and nothing deploys any other way', () => {
  const deploying = WORKFLOWS.filter((w) => deployLines(w.src).length > 0).map((w) => w.file);
  assert.deepEqual(deploying, DEPLOY_WORKFLOWS.map((w) => w.file).sort());
  for (const w of WORKFLOWS) {
    const code = codeLines(w.src).join('\n');
    assert.doesNotMatch(code, /cloudflare\/wrangler-action/, `${w.file}: the wrangler action deploys without the word "wrangler deploy"`);
    assert.doesNotMatch(code, /\bnpm run deploy\b/, `${w.file}: npm run deploy ships HQ`);
    assert.doesNotMatch(code, /\bwrangler(?:@[\d.]+)?\s+(?:versions|rollback)\b/, `${w.file}: a version deploy or a rollback is a deploy`);
  }
});

test('each workflow deploys what the page says, on the trigger it says', () => {
  const byFile = Object.fromEntries(WORKFLOWS.map((w) => [w.file, w.src]));
  const invocation = (f: string) => deployLines(byFile[f]).filter((l) => /\bnpx\b/.test(l));

  // D253: the push-to-main workflow deploys HQ once, then each branch from
  // one line inside its loop. Two lines, one of each, and nothing else.
  const main = invocation('cloudflare-worker-deploy.yml');
  assert.equal(main.length, 2);
  const hq = main.filter((l) => /--env production\b/.test(l));
  assert.equal(hq.length, 1);
  assert.match(hq[0], /--config \.\.\/wrangler\.toml --env production/);
  const redeploy = main.filter((l) => l !== hq[0]);
  assert.match(redeploy[0], /--config "wrangler\.branch\.\$\{code\}\.toml"/);
  assert.doesNotMatch(redeploy[0], /--env\b|wrangler\.toml/);
  const branch = invocation('branch-provision.yml');
  assert.equal(branch.length, 1);
  assert.match(branch[0], /--config "wrangler\.branch\.\$\{BRANCH\}\.toml"/);
  const preview = invocation('pr-preview.yml');
  assert.equal(preview.length, 1);
  assert.match(preview[0], /--config wrangler\.pr-preview\.toml/);
  // Exactly two workflows deploy with a branch config (D253): provisioning,
  // once, and the push-to-main redeploy, every time after. S14 names the
  // second as what deployed the branch it is shown on, and the first as what
  // provisioned it.
  const branchDeployers = WORKFLOWS.filter((w) => deployLines(w.src).some((l) => l.includes('wrangler.branch.'))).map((w) => w.file);
  assert.deepEqual(branchDeployers, [BRANCH_DEPLOYED_BY, BRANCH_PROVISIONED_BY].sort());
  assert.equal(BRANCH_DEPLOYED_BY, 'cloudflare-worker-deploy.yml');
  assert.equal(BRANCH_PROVISIONED_BY, 'branch-provision.yml');
  assert.ok(DEPLOY_WORKFLOWS.some((w) => w.file === BRANCH_DEPLOYED_BY));
  assert.ok(DEPLOY_WORKFLOWS.some((w) => w.file === BRANCH_PROVISIONED_BY));
  // "It refuses a code that is already provisioned" — the refusal is code, not a comment.
  const refusal = codeLines(byFile['branch-provision.yml']).join('\n');
  assert.match(refusal, /if \[\[ -f "infra\/branches\/\$\{BRANCH\}\.json" \]\]; then\s+fail "infra\/branches\/\$\{BRANCH\}\.json already exists/);

  for (const w of DEPLOY_WORKFLOWS) {
    const on = triggersOf(byFile[w.file]);
    const pushesMain = on.includes('push') && /\n {4}branches: \[main\]/.test(byFile[w.file]);
    assert.equal(/push to main/.test(w.trigger), pushesMain, `${w.file}: "${w.trigger}" against on: ${on}`);
    assert.equal(/by hand/.test(w.trigger), on.includes('workflow_dispatch'), `${w.file}: "${w.trigger}" against on: ${on}`);
    assert.equal(/pull request/.test(w.trigger), on.includes('pull_request'), `${w.file}: "${w.trigger}" against on: ${on}`);
    assert.ok(on.every((k) => ['push', 'workflow_dispatch', 'pull_request'].includes(k)), `${w.file} has a trigger the page does not name: ${on}`);
  }
  // "dispatched by HQ's Deploy step": the one dispatch names this workflow.
  assert.match(read('cloudflare-worker/src/routes/admin_deployments.ts'), /export const PROVISION_WORKFLOW = 'branch-provision\.yml';/);
});

test('by hand, npm run deploy migrates and then deploys HQ, and nothing deploys a branch', () => {
  const root = JSON.parse(read('package.json')).scripts as Record<string, string>;
  const worker = JSON.parse(read('cloudflare-worker/package.json')).scripts as Record<string, string>;
  assert.match(root.predeploy, /\bmigrate-d1\.mjs --remote\b/, 'predeploy applies the pending migrations');
  assert.match(root.deploy, /wrangler deploy --config \.\.\/wrangler\.toml --env production/, 'deploy ships HQ');
  assert.match(DEPLOY_BY_HAND, /npm run deploy/);
  assert.match(DEPLOY_BY_HAND, /migrations/);
  assert.match(DEPLOY_BY_HAND, /Nothing deploys a branch by hand\./);
  for (const [k, v] of [...Object.entries(root), ...Object.entries(worker)]) {
    assert.ok(!v.includes('wrangler.branch.'), `script ${k} deploys a branch config, which the page says nothing does`);
  }
});

// ── 4 · what writes to Cloudflare, and what Access guards ───────────────────

test('the screens that write Worker secrets are the three setSecret callers, and none deploys', () => {
  const SCREEN_OF: Record<string, string> = {
    'routes/admin_integration_keys.ts': 'Integration keys',
    'routes/admin_github.ts': 'GitHub Sync',
    'routes/admin_stripe.ts': 'Stripe',
  };
  const callers = [...new Set(callSites('setSecret').map((s) => s.file))].sort();
  assert.deepEqual(callers, Object.keys(SCREEN_OF).sort(), 'a new setSecret caller is a new screen that writes to Cloudflare');
  assert.deepEqual(SECRET_WRITERS.map((s) => s.screen).sort(), Object.values(SCREEN_OF).sort());
  // The Cloudflare API calls this Worker makes: the secrets endpoint and the AE
  // SQL API. Neither is a deployment, a version or a rollback.
  for (const { file, code } of CODE) {
    assert.doesNotMatch(code, /\/workers\/scripts\/[^'"`\n]*\/(?:deployments|versions)\b/, `${file} calls the Cloudflare deployments API`);
  }
});

test('Cloudflare Access is mounted on the paths the page lists and nowhere else', () => {
  const sites = callSites('requireCfAccess');
  assert.deepEqual([...new Set(sites.map((s) => s.file))], ['index.ts'], 'requireCfAccess is mounted outside index.ts');
  const index = CODE.find((f) => f.file === 'index.ts')!.code;
  const mounts = [...index.matchAll(/app\.use\('([^']+)',\s*requireCfAccess\(\)\)/g)].map((mt) => mt[1]);
  assert.equal(mounts.length, sites.length, 'every requireCfAccess() is an app.use mount the page can name');
  assert.deepEqual(mounts, [...CF_ACCESS_PATHS]);
});

// ── 5 · the AI Gateway ──────────────────────────────────────────────────────

test('two task classes route through the gateway, carrying no metadata, and the dead path stays dead', () => {
  const optionFiles = CODE.filter(({ code }) => /\bgateway\s*[:?]|\{\s*gateway\s*\}/.test(code)).map((f) => f.file).sort();
  assert.deepEqual(optionFiles, ['services/advisor/aiClient.ts', 'services/aiRouter.ts'], 'a new place builds a gateway option');
  for (const { file, code } of CODE) {
    assert.doesNotMatch(code, /cf-aig-metadata/, `${file} sends gateway metadata; the page says nothing does`);
  }
  const router = CODE.find((f) => f.file === 'services/aiRouter.ts')!.code;
  const optionFor = fnBody(router, 'function gatewayOptionFor(');
  assert.match(optionFor, /if \(!GATEWAY_TASKS\.includes\(task\)\) return undefined;/);
  assert.doesNotMatch(optionFor, /metadata/);
  const client = CODE.find((f) => f.file === 'services/advisor/aiClient.ts')!.code;
  assert.doesNotMatch(fnBody(client, 'export function advisorGatewayOption('), /metadata/);
  // aiClient's gateway path runs only through runAdvisorTurn, which nothing calls.
  assert.deepEqual(callSites('runAdvisorTurn'), [], 'runAdvisorTurn gained a caller — its gateway path is live now');
  assert.deepEqual([...new Set(callSites('advisorGatewayOption').map((s) => s.file))], ['services/advisor/aiClient.ts']);

  const routes = describeTopology({} as never).ai_gateway.routes;
  assert.deepEqual(routes.map((r) => r.id), [...GATEWAY_TASKS]);
  assert.equal(new Set(routes.map((r) => r.label)).size, routes.length, 'two routes, two labels');
});

// ── 6 · Analytics Engine ────────────────────────────────────────────────────

test('four functions read the shared dataset, each behind the credential check the page reports', () => {
  const reports = FILES.find((f) => f.file === 'services/analyticsReports.ts')!.src;
  const sites = callSites('aeSql');
  assert.deepEqual([...new Set(sites.map((s) => s.file))], ['services/analyticsReports.ts'], 'aeSql is read outside analyticsReports.ts');
  const reportsCode = CODE.find((f) => f.file === 'services/analyticsReports.ts')!.code;
  const enclosing = sites.map((s) => {
    const before = reportsCode.slice(0, s.index);
    const fns = [...before.matchAll(/(?:export\s+)?async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
    return fns[fns.length - 1][1];
  });
  // D210 added the fourth, H15's weekly accounts read, and the page lists it.
  assert.deepEqual(enclosing, [
    'loadTechnicalFromAnalyticsEngine', 'loadTrafficByBranch', 'loadBranchActionMirror', 'loadActiveAccountsByBranchWeek',
  ]);
  assert.equal(enclosing.length, AE_READERS.length, 'one reader line per function that reads the dataset');
  assert.match(fnBody(reports, 'async function aeSql('), /^\s*if \(!aeReadable\(env\)\) return null;/,
    'aeSql asks aeReadable first, so "readable here" and "can read" are one fact');
  assert.doesNotMatch(reportsCode, /export\s+(?:async\s+)?function\s+aeSql\b/, 'aeSql is private; the four loaders are its only callers');
  assert.equal(NOT_FROM_ANALYTICS.length, 3);
});

test('two places write the dataset, and the branch code rides in the sixth blob', () => {
  const writers = [...new Set(CODE.filter(({ code }) => /\.writeDataPoint\(/.test(code)).map((f) => f.file))].sort();
  assert.deepEqual(writers, ['middleware/observability.ts', 'services/auditMirror.ts']);
  const obs = CODE.find((f) => f.file === 'middleware/observability.ts')!.code;
  const call = bodyAfter(obs, '.writeDataPoint(');
  assert.match(call, /indexes:\s*\[path\.slice\(0, 96\)\]/, 'one index, the path — the branch is not an index');
  const blobs = /blobs:\s*\[([\s\S]*?)\]/.exec(call);
  assert.ok(blobs, 'the request row writes blobs');
  const slots = blobs![1].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).join(' ').split(',').map((x) => x.trim()).filter(Boolean);
  assert.equal(slots.length, 6, 'six blobs');
  assert.match(slots[5], /branch/i, 'the sixth blob carries the branch code');
});

// ── 7 · the tail and the one dispatch route ─────────────────────────────────

test('HQ and every generated branch send their logs to the tail consumer the page names', () => {
  const hq = parseToml(TOML).sections.filter((s) => s.name === 'env.production.tail_consumers');
  const br = parseToml(BRANCH_RENDERED).sections.filter((s) => s.name === 'tail_consumers');
  assert.deepEqual(hq.map((s) => unq(s.kv.get('service'))), [TAIL_CONSUMER]);
  assert.deepEqual(br.map((s) => unq(s.kv.get('service'))), [TAIL_CONSUMER]);
  assert.equal(unq(parseToml(TOML).sections.find((s) => s.name === 'env.production')!.kv.get('name')), HQ_WORKER);
});

test('the one route that dispatches a deploy is super-admin only — "a branch cannot deploy" rests on it', () => {
  const sites = callSites('dispatchWorkflow');
  assert.deepEqual(sites.map((s) => s.file), ['routes/admin_deployments.ts'], 'a second route can dispatch a deploy');
  const src = FILES.find((f) => f.file === 'routes/admin_deployments.ts')!.src;
  const handler = bodyAfter(src, "r.post('/licences/:uid/deploy', async (c) =>");
  assert.match(handler, /^\s*const admin = await requireSuperAdmin\(c\);/, 'the gate is the handler\'s first statement');
  assert.ok(handler.includes('dispatchWorkflow('), 'the dispatch sits inside that handler');
});

// ── 8 · the payload, on each tier ───────────────────────────────────────────

const FAKE = {
  CLOUDFLARE_API_TOKEN: 'cf-token-SECRET-1',
  CLOUDFLARE_ACCOUNT_ID: 'acct-SECRET-2',
  CLOUDFLARE_AE_API_TOKEN: 'ae-token-SECRET-3',
  GITHUB_ACCESS_TOKEN: 'gh-token-SECRET-4',
  GITHUB_REPO_OWNER: 'owner-SECRET-5',
  GITHUB_REPO_NAME: 'repo-SECRET-6',
  RPC_SECRET: 'rpc-SECRET-7',
  HQ_RPC_SECRET: 'hq-rpc-SECRET-8',
  JWT_SECRET: 'jwt-SECRET-9',
  CF_AI_GATEWAY_SLUG_ADVISOR: 'slug-SECRET-10',
};

const hqEnv = (extra: Record<string, unknown> = {}) => ({ DB: {}, ANALYTICS: {}, AI: {}, ...extra }) as never;
const branchEnv = (extra: Record<string, unknown> = {}) => ({ BRANCH_CODE: 'fr', DB: {}, HQ: {}, ...extra }) as never;

test('on HQ: what HQ calls and exports, its branch lines, the naming rule, Access and the dispatch', () => {
  const t = describeTopology(hqEnv()) as any;
  assert.equal(t.tier, 'hq');
  assert.equal(t.code, null);
  assert.equal(t.worker, HQ_WORKER);
  assert.equal(t.rpc.calls.class, HQ_CALLS_BRANCH);
  assert.equal(t.rpc.exports.class, BRANCH_CALLS_HQ);
  assert.deepEqual(t.links, { hq: null, branches: [] });
  assert.deepEqual(t.branch_naming, branchResourceNames('<code>'));
  assert.deepEqual(t.access.paths, [...CF_ACCESS_PATHS]);
  assert.equal('cannot' in t, false);
  assert.equal('hostname' in t, false);
  assert.equal(t.analytics.written_here.length, 2, 'HQ writes request rows and the branch-action mirror');
  assert.equal(t.deploys.by_hand, DEPLOY_BY_HAND);
  assert.equal(t.deploys.branch_deployed_by, BRANCH_DEPLOYED_BY);
  assert.equal(t.deploys.branch_provisioned_by, BRANCH_PROVISIONED_BY);
  assert.equal(t.deploys.branch_redeployed, true, 'D253: the push-to-main workflow redeploys every branch');
  assert.equal(t.deploy_dispatch.available, false, 'no repository token, no dispatch');
  assert.equal(describeTopology(hqEnv(FAKE)).deploy_dispatch.available, true);
  assert.deepEqual(describeTopology(hqEnv({ GITHUB_ACCESS_TOKEN: 'x', GITHUB_REPO_OWNER: 'y' })).deploy_dispatch, { available: false },
    'token and owner without the repository name is not enough');
  // present is read, not assumed.
  const present = Object.fromEntries(t.bindings.map((b: { name: string; present: boolean }) => [b.name, b.present]));
  assert.equal(present.DB, true);
  assert.equal(present.VECTORIZE, false);
  assert.equal(t.secret_writes.target, null, 'no Cloudflare token, nowhere to write');
  assert.equal(describeTopology(hqEnv(FAKE)).secret_writes.target, HQ_WORKER);
  // HQ's lines to branches are read off env.
  const linked = describeTopology(hqEnv({ BRANCH_FR: {}, BRANCH_DACH: {}, BRANCH_CODE: undefined })) as any;
  assert.deepEqual(linked.links.branches, [{ code: 'dach', binding: 'BRANCH_DACH' }, { code: 'fr', binding: 'BRANCH_FR' }]);
});

test('on a branch: its own names, its one link, and a cannot-list that says which way each came out', () => {
  const t = describeTopology(branchEnv()) as any;
  assert.equal(t.tier, 'branch');
  assert.equal(t.code, 'fr');
  assert.equal(t.worker, branchResourceNames('fr').worker);
  assert.equal(t.hostname, 'fr.axal.vc');
  assert.equal(t.rpc.calls.class, BRANCH_CALLS_HQ);
  assert.equal(t.rpc.exports.class, HQ_CALLS_BRANCH);
  assert.deepEqual(t.links.hq, { bound: true, service: HQ_WORKER, entrypoint: BRANCH_CALLS_HQ });
  assert.equal(t.access, null);
  assert.equal('branch_naming' in t, false);
  assert.equal(t.analytics.written_here.length, 1, 'a branch writes request rows only');
  for (const b of t.bindings) {
    assert.equal(b.resource, BINDINGS.find((x) => x.name === b.name)!.branch('fr'), `${b.name} names the branch's resource`);
  }
  const holds = (x: any) => Object.fromEntries(x.cannot.map((c: { what: string; holds: boolean }) => [c.what, c.holds]));
  const aeWhy = (x: any) => x.cannot.find((c: { what: string }) => c.what === 'Read Analytics Engine').why;
  assert.deepEqual(holds(t), { 'Reach another branch': true, 'Read Analytics Engine': true, 'Deploy anything, itself included': true });
  assert.match(aeWhy(t), /not set here/);
  // Reaching another branch flips when a binding is added by hand.
  // Reading Analytics Engine does not: a branch never reads, and the
  // sentence says whether the credentials are present.
  const handAdded = describeTopology(branchEnv({ BRANCH_DE: {} })) as any;
  assert.equal(holds(handAdded)['Reach another branch'], false);
  assert.match(handAdded.cannot[0].why, /\bde\b/);
  const withCreds = describeTopology(branchEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_AE_API_TOKEN: 'b' })) as any;
  assert.equal(holds(withCreds)['Read Analytics Engine'], true,
    'credentials on a branch do not make it able to read Analytics Engine');
  assert.match(aeWhy(withCreds), /credentials are set/);
  assert.doesNotMatch(aeWhy(withCreds), /not set here/);
  assert.equal(holds(describeTopology(branchEnv(FAKE)))['Deploy anything, itself included'], true,
    'no secret on a branch makes it able to deploy');
  assert.equal(describeTopology(branchEnv(FAKE)).deploy_dispatch.available, false);
  assert.equal((describeTopology(branchEnv({ HQ: undefined })) as any).links.hq.bound, false);
  // A branch writes secrets only onto its own script, and only when its config says which that is.
  assert.equal(describeTopology(branchEnv(FAKE)).secret_writes.target, null);
  assert.equal(describeTopology(branchEnv({ ...FAKE, CF_WORKER_SCRIPT_NAME: 'studioos-fr' })).secret_writes.target, 'studioos-fr');
});

test('no secret value, and no word the platform does not use, leaves the Worker', () => {
  const words: string[] = [];
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string') { if (key !== 'id') words.push(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const env of [hqEnv(FAKE), branchEnv(FAKE), branchEnv({ ...FAKE, CF_WORKER_SCRIPT_NAME: 'studioos-fr' })]) {
    const payload = describeTopology(env);
    const json = JSON.stringify(payload);
    for (const [name, value] of Object.entries(FAKE)) {
      assert.ok(!json.includes(value), `${name}'s value reached the payload`);
    }
    walk(payload);
  }
  for (const w of words) {
    assert.doesNotMatch(w, /\badvi[cs]\w*|\brecommend\w*|\bfiduciar\w*/i, `off-voice wording: "${w}"`);
  }
});

// ── 9 · the two routes ──────────────────────────────────────────────────────

test('HQ reads it super-admin only; a branch reads its own admin-only, and only on a branch', () => {
  const platform = FILES.find((f) => f.file === 'routes/admin_platform.ts')!.src;
  const hq = bodyAfter(platform, "r.get('/topology', async (c) =>");
  assert.match(hq, /^\s*await requireSuperAdmin\(c\);\s*return c\.json\(describeTopology\(c\.env\)\);\s*$/);
  const branch = FILES.find((f) => f.file === 'routes/branch_deployment.ts')!.src;
  const own = bodyAfter(branch, "r.get('/deployment', async (c) =>");
  assert.match(own, /await requireAdmin\(c\);\s*requireBranchTier\(c\.env\);\s*return c\.json\(describeTopology\(c\.env\)\);/,
    'the admin gate, then the tier gate, then the read');
  const index = CODE.find((f) => f.file === 'index.ts')!.code;
  const platformAt = index.indexOf("app.route('/api/admin/platform', adminPlatform);");
  const catchAll = index.indexOf("app.route('/api/admin', admin);");
  assert.ok(platformAt > 0 && catchAll > platformAt, '/api/admin/platform is mounted before the /api/admin catch-all');
  assert.ok(index.includes("app.route('/api/branch', branchDeploymentRoutes);"));
});
