/** D7973: signed transport, durable recovery, executor admission and publication integration. */
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { executeShard, verifiedPlan, verifyRuntime, ownedPaths, main as executionMain } from "../../scripts/ci/runner-execution.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plannerSubmission, main as plannerMain } from "../../scripts/ci/capacity-planner.mjs";
import { buildPlan } from "../../scripts/test-drift-parts.mjs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import "../../merge-control/test/runtime-loader.mjs";
const { CapacityControl } = await import("../../merge-control/src/ciCapacityRuntime.ts");
import { authenticateCapacity, boundedJson, CAPACITY_ISSUER } from "../../merge-control/src/ciCapacityAuth.ts";
import { GithubCapacityPorts, capacityGithubClient } from "../../merge-control/src/ciCapacityGithub.ts";
import { CapacityOutbox } from "../../merge-control/src/ciCapacityOutbox.ts";
import { CiCapacity, SqlCapacityStore } from "../../merge-control/src/ciCapacity.ts";
import { CI_CAPACITY_BUDGETS } from "../../merge-control/src/lib/ciCapacityPolicy.ts";
import { resolveCatalogProfile } from "../../scripts/ci/runners/catalog.mjs";
import { main as admissionMain, admitRunnerJob, githubReadApi } from "../../scripts/ci/runner-admission.mjs";
import { createReceiptReader, submitCapacity, githubOidcToken } from "../../scripts/ci/capacity-client.mjs";
const REPO = "AxalNetwork/StudioOS", PREFIX = "/repos/" + REPO, SOURCE = "a".repeat(40), EXEC = "b".repeat(40);
const SHARDS = Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture-key", alg: "RS256", use: "sig" };
const config = { repository: REPO, repositoryId: 7, executorSha: EXEC, approvedGroupId: 5, selfHostedProfiles:['linux-x64'], prerequisiteJobs: ["fast"], fullSuiteJobs: [], appId: 23, maxExternalWorkerShards: 0, maxIncludedWorkerShards: 0, publication: "pilot" };
const plan = JSON.stringify({ version: 1, parts: SHARDS.map((name) => ({ name, script: "test:worker", files: [] })) });
function submission() {
  return { version: 1, requestId: "00000000-0000-4000-8000-000000007973", repository: REPO, parentRunId: 12, parentAttempt: 1, parentWorkflowId: 9, event: "push", sourceSha: SOURCE, queueBaseSha: null, executorSha: EXEC, planDigest: "sha256:" + createHash("sha256").update(plan).digest("hex"), planArtifactId: 45, shards: SHARDS, prerequisites: ["fast"] };
}
function claims(child) {
  const now = Math.floor(Date.now() / 1e3);
  return { iss: CAPACITY_ISSUER, aud: "fixture-capacity", sub: `repo:${REPO}:ref:refs/heads/main`, exp: now + 300, nbf: now - 1, iat: now, repository: REPO, repository_id: "7", run_id: String(child ?? 12), run_attempt: "1", event_name: child ? "workflow_dispatch" : "push", ref: "refs/heads/main", sha: child ? EXEC : SOURCE, workflow_ref: `${REPO}/.github/workflows/${child ? "runner-executor" : "ci"}.yml@refs/heads/main`, workflow_sha: EXEC, job_workflow_ref: `${REPO}/.github/workflows/capacity-planner.yml@${EXEC}`, job_workflow_sha: EXEC };
}
function token(value = claims()) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url"), body = Buffer.from(JSON.stringify(value)).toString("base64url"), payload = header + "." + body;
  return payload + "." + sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url");
}
function fixture(t) {
  t.mock.timers.enable({apis:['Date'],now:1_800_000_000_000});
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const kv = new Map();
  let alarm = null;
  const storage = { sql: { exec(query, ...values) {
    const rows = db.prepare(query).all(...values);
    return { toArray: () => rows };
  } }, transactionSync(fn) {
    db.exec("BEGIN");
    try {
      const result2 = fn();
      db.exec("COMMIT");
      return result2;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }, get: async (key) => kv.get(key), put: async (key, value) => {
    kv.set(key, value);
  }, setAlarm: async (at) => {
    alarm = at;
  }, deleteAlarm: async () => {
    alarm = null;
  } };
  const repo = { id: 7, full_name: REPO };
  const parent = { id: 12, run_attempt: 1, workflow_id: 9, path: ".github/workflows/ci.yml", head_sha: SOURCE, event: "push", head_branch: "main", repository: repo, head_repository: repo, status: "completed", conclusion: "success" };
  const parentJobs=[{id:10,name:"fast",run_id:12,run_attempt:1,head_sha:SOURCE,status:"completed",conclusion:"success"}];
  const runners=[];
  const children = new Map(), checks = [], calls = [];
  let result = "queued", cancelThrows = false, postLost = false, incomplete=false;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    const url = new URL("https://api.github.com" + path), p = url.pathname;
    if (p === PREFIX + "/git/ref/heads/main") return { ref: "refs/heads/main", object: { type: "commit", sha: EXEC } };
    if (p.startsWith(PREFIX + "/compare/")) return { status: "identical", base_commit: { sha: EXEC }, merge_base_commit: { sha: EXEC } };
    if (p === PREFIX + "/actions/runs/12" || p === PREFIX + "/actions/runs/12/attempts/1") return structuredClone(parent);
    if (p === PREFIX + "/actions/runs/12/artifacts") return { total_count: 1, artifacts: [{ id: 45, name: "suite-plan", expired: false, workflow_run: { id: 12, head_sha: SOURCE, repository_id: 7, head_repository_id: 7 } }] };
    if (p === PREFIX + "/actions/runs/12/attempts/1/jobs") return {total_count:parentJobs.length,jobs:structuredClone(parentJobs)};
    if (p === "/orgs/AxalNetwork/actions/runner-groups/5") return { id: 5, name: "StudioOS Worker Pool", visibility: "selected", allows_public_repositories:true, restricted_to_workflows: true, selected_workflows: [`${REPO}/.github/workflows/runner-executor.yml@refs/heads/main`] };
    if (p.endsWith("/runner-groups/5/repositories")) return { total_count: 1, repositories: [repo] };
    if (p.endsWith("/runner-groups/5/runners")) return { total_count: runners.length, runners:structuredClone(runners) };
    if (p === PREFIX + "/actions/workflows/runner-executor.yml") return { id: 11, path: ".github/workflows/runner-executor.yml", state: "active" };
    if (p === PREFIX + "/actions/workflows/runner-executor.yml/dispatches") {
      const id = 100 + children.size;
      children.set(id, { capacityProfile:body.inputs.profile, id, run_attempt: 1, workflow_id: 11, path: ".github/workflows/runner-executor.yml", head_sha: EXEC, event: "workflow_dispatch", head_branch: "main", repository: repo, head_repository: repo, display_title: `Worker executor | ${body.inputs.request_id} | ${body.inputs.part} | generation ${body.inputs.generation}`, status: "in_progress", conclusion: null });
      return null;
    }
    if (p === PREFIX + "/actions/workflows/runner-executor.yml/runs") return { total_count: children.size, workflow_runs: [...children.values()] };
    const child = /\/actions\/runs\/(\d+)(.*)/.exec(p);
    if (child && children.has(Number(child[1]))) {
      const run = children.get(Number(child[1]));
      if (child[2] === "/cancel") {
        if (cancelThrows) throw new Error("uncertain cancellation");
        run.status = "completed";
        run.conclusion = "cancelled";
        return null;
      }
      if (child[2].endsWith("/jobs")&&incomplete)return {total_count:0,jobs:[]};
      if (child[2].endsWith("/jobs")) return { total_count: 1, jobs: [{ id: run.id + 1e3, name: "Admitted Worker shard", run_id: run.id, run_attempt: 1, head_sha: EXEC, status: result === "queued" ? "in_progress" : "completed", conclusion: result === "queued" ? null : result, labels:run.capacityProfile==='hosted'?['ubuntu-latest']:resolveCatalogProfile(run.capacityProfile).target.labels, started_at: (new Date()).toISOString(), steps: [{ name: "Run admitted Worker shard", status: result === "queued" ? "queued" : "completed", conclusion: result === "queued" ? null : result }] }] };
      return structuredClone(run);
    }
    if (p === PREFIX + "/check-runs" && method === "POST") {
      const check = { ...body, id: 200 + checks.length, app: { id: 23 } };
      checks.push(check);
      if (postLost) throw new Error("POST acknowledgement lost");
      return check;
    }
    if (p.startsWith(PREFIX + "/check-runs/") && method === "PATCH") {
      const check = checks.find((c) => c.id === Number(p.split("/").at(-1)));
      Object.assign(check, body);
      return check;
    }
    if (p.endsWith("/check-runs")) return { total_count: checks.length, check_runs: checks };
    throw new Error("unexpected fixture request " + method + " " + path);
  };
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === CAPACITY_ISSUER) return Response.json({ keys: [jwk] });
    if (url.pathname.includes("/access_tokens")) return Response.json({ token: "fixture-only-installation" });
    try {
      const body = init?.body ? JSON.parse(String(init.body)) : void 0;
      const value = await api(init?.method ?? "GET", url.pathname + url.search, body);
      return value === null ? new Response(null, { status: 204 }) : Response.json(value);
    } catch {
      return new Response("fixture unavailable", { status: 503 });
    }
  };
  const ctx = { storage };
  const env = { REPOSITORY: REPO, CAPACITY_ENABLED: "true", CAPACITY_OWNER_TOKEN: "fixture-owner", CAPACITY_AUDIENCE: "fixture-capacity", CAPACITY_CONFIG: JSON.stringify(config), GITHUB_APP_ID: "23", GITHUB_INSTALLATION_ID: "2", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  let control = new CapacityControl(ctx, env);
  const clientFetch = async (input, init) => control.fetch(new Request(input, init));
  return { storage, api, fetcher, parent, parentJobs, children, runners, missingResults:()=>{incomplete=true;}, checks, calls, env, alarm: () => alarm, restart: () => {
    control = new CapacityControl(ctx, env);
  }, tick: () => control.alarm(), clientFetch, control: () => control, result: (value) => {
    result = value;
    for (const r of children.values()) {
      r.status = value === "queued" ? "in_progress" : "completed";
      r.conclusion = value === "queued" ? null : value;
    }
  }, cancelUncertain: () => {
    cancelThrows = true;
  }, postLost: () => {
    postLost = true;
  } };
}
const options = (fetcher, child) => ({ url: "https://capacity.invalid", audience: "fixture-capacity", oidcToken: async () => token(claims(child)), fetcher });
async function unlock(f) {
  return f.control().fetch(new Request("https://capacity.invalid/capacity/switch", { method: "POST", headers: { authorization: "Bearer fixture-owner" }, body: '{"kill":false}' }));
}
test("signed OIDC transport survives restart, binds executor receipt, and publishes only pilot authority", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", f.fetcher);
  assert.deepEqual(await submitCapacity(submission(), { ...options(f.clientFetch), plan }), { accepted: false, reason: "capacity_disabled" });
  assert.equal(f.calls.length, 0);
  await unlock(f);
  await f.storage.deleteAlarm();
  assert.equal((await submitCapacity(submission(), { ...options(f.clientFetch), plan, enabled: true })).accepted, true);
  assert.notEqual(f.alarm(), null);
  await submitCapacity(submission(), { ...options(f.clientFetch), plan, enabled: true });
  await f.tick();
  f.restart();
  await f.tick();
  assert.equal(f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/dispatches")).length, 6);
  const request = { requestId: submission().requestId, generation: 1, shard: SHARDS[0], profile: "hosted" }, context = { repository: REPO, executorSha: EXEC, childRunId: 100, childAttempt: 1 };
  const readReceipt = createReceiptReader(options(f.clientFetch, 100));
  const admitted = await admitRunnerJob(request, { readReceipt, context, api: f.api, verifyIsolation: async () => true, resolveProfile: resolveCatalogProfile });
  assert.equal(admitted.allowed, true, JSON.stringify(admitted));
  await assert.rejects(readReceipt({ request: { ...request, generation: 2 }, context }), /unavailable|refused/);
  await assert.rejects(createReceiptReader(options(f.clientFetch, 101))({ request, context }), /refused/);
  const generationResponse=await f.clientFetch('https://capacity.invalid/capacity/receipt',{method:'POST',headers:{authorization:'Bearer '+token(claims(100))},body:JSON.stringify({...request,generation:2})});
  assert.equal((await generationResponse.json()).active,false);
  await assert.rejects(readReceipt({request,context:{...context,childRunId:101}}),/refused/);
  await f.control().fetch(new Request('https://capacity.invalid/capacity/switch',{method:'POST',headers:{authorization:'Bearer fixture-owner'},body:'{"kill":true}'}));
  await assert.rejects(readReceipt({request,context}),/unavailable|refused/);
  await unlock(f);
  assert.equal(f.checks[0].status, "in_progress");
  f.result("success");
  await f.tick();
  assert.equal(f.checks[0].name, "ci-capacity/worker-pilot");
  assert.equal(f.checks[0].conclusion, "success");
  assert.equal(f.checks.some((c) => c.name === "ci-capacity/full-suite"), false);
  await f.control().fetch(new Request("https://capacity.invalid/capacity/switch", { method: "POST", headers: { authorization: "Bearer fixture-owner" }, body: '{"kill":true}' }));
  await assert.rejects(readReceipt({ request, context }), /unavailable|refused/);
});
test("invalid signature, audience, expiration, repo and candidate planner identity cannot create durable work", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", f.fetcher);
  await unlock(f);
  for (const patch of [{ aud: "wrong" }, { exp: 0 }, { repository: "fork/StudioOS" }, { job_workflow_sha: SOURCE }, { sha: EXEC }, { run_attempt: "2" }]) {
    const response = await f.clientFetch("https://capacity.invalid/capacity/submit", { method: "POST", headers: { authorization: "Bearer " + token({ ...claims(), ...patch }) }, body: JSON.stringify({ submission: submission(), plan }) });
    assert.equal(response.status, 403);
  }
  const bad = token().split(".");
  bad[2] = Buffer.alloc(256).toString("base64url");
  await assert.rejects(authenticateCapacity(new Request("https://capacity.invalid", { headers: { authorization: "Bearer " + bad.join(".") } }), "fixture-capacity", REPO, f.fetcher), /signature/);
  await assert.rejects(authenticateCapacity(new Request('https://capacity.invalid',{headers:{authorization:'Bearer '+token({...claims(),repository:'fork/StudioOS'})}}),'fixture-capacity',REPO,f.fetcher),/claims_refused/);
  assert.equal(new SqlCapacityStore(f.storage).count(), 0);
});
test("ambiguous publication is discovered after restart without duplicate POST; missing full suite cannot pass", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", f.fetcher);
  await unlock(f);
  f.postLost();
  await submitCapacity(submission(), { ...options(f.clientFetch), enabled: true, plan });
  await f.tick();
  f.restart();
  await f.tick();
  assert.equal(f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/check-runs")).length, 1);
  f.result("success");
  await f.tick();
  assert.equal(f.checks[0].conclusion, "success");
  const settings = { ...config, publication: "full-suite" };
  f.env.CAPACITY_CONFIG = JSON.stringify(settings);
  f.restart();
  await f.tick();
  await f.tick();
  assert.equal(f.checks.find((c) => c.name === "ci-capacity/full-suite")?.status, "in_progress");
});
test("unknown pages/rate limits, wrong group, and excessive bodies fail conservatively", async () => {
  await assert.rejects(boundedJson(Response.json({ oversized: "x".repeat(20) }), 4), /body_bound/);
  await assert.rejects(boundedJson(new Response("", { status: 429 })), /429/);
  const incomplete = new GithubCapacityPorts(async () => ({ total_count: 301, workflow_runs: Array.from({length:100},(_,i)=>({id:i+1})) }), config);
  await assert.rejects(incomplete.pages(PREFIX + "/actions/runs", "workflow_runs"), /incomplete/);
  const duplicate = new GithubCapacityPorts(async () => ({ total_count: 2, workflow_runs: [{ id: 1 }, { id: 1 }] }), config);
  await assert.rejects(duplicate.pages(PREFIX + "/actions/runs", "workflow_runs"), /duplicate/);
  const group = new GithubCapacityPorts(async (_method,path) => path.endsWith('/repositories')?{total_count:1,repositories:[{id:7,full_name:REPO}]}:path.includes('/repositories?')?{total_count:1,repositories:[{id:7,full_name:REPO}]}:path.includes('/runners?')?{total_count:0,runners:[]}:{id:6,name:'StudioOS Worker Pool',visibility:'selected',allows_public_repositories:true,restricted_to_workflows:true,selected_workflows:[`${REPO}/.github/workflows/runner-executor.yml@refs/heads/main`]}, config);
  await assert.rejects(group.inventory(), /unapproved/);
  const rate = new GithubCapacityPorts(async () => {
    throw new Error("429");
  }, config);
  await assert.rejects(rate.parent(submission()), /429/);
});
test("sticky test failure survives completed child and restart", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", f.fetcher);
  await unlock(f);
  await submitCapacity(submission(), { ...options(f.clientFetch), enabled: true, plan });
  await f.tick();
  await f.tick();
  f.result("failure");
  await f.tick();
  assert.equal(f.checks[0].conclusion, "failure");
  f.result("success");
  f.restart();
  await f.tick();
  assert.equal(f.checks[0].conclusion, "failure");
});
test("receipt expiration, stale result, and parent revocation deny without new dispatches", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", f.fetcher);
  await unlock(f);
  await submitCapacity(submission(), { ...options(f.clientFetch), enabled: true, plan });
  await f.tick();
  await f.tick();
  const store = new SqlCapacityStore(f.storage), record = store.get(submission().requestId);
  record.shards[0].attempts[0].startDeadline = Date.now() - 1;
  record.shards[0].attempts[0].executionDeadline = Date.now() - 1;
  store.save(record);
  const request = { requestId: submission().requestId, generation: 1, shard: SHARDS[0], profile: "hosted" }, context = { repository: REPO, executorSha: EXEC, childRunId: 100, childAttempt: 1 };
  await assert.rejects(createReceiptReader(options(f.clientFetch, 100))({ request, context }), /refused/);
  f.parent.run_attempt = 2;
  await f.tick();
  assert.notEqual(f.checks[0].conclusion, "success");
  assert.equal(f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/dispatches")).length, 6);
});
test("start loss and uncertain cancellation remain fenced across restart", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", f.fetcher);
  await unlock(f);
  await submitCapacity(submission(), { ...options(f.clientFetch), enabled: true, plan });
  await f.tick();
  await f.tick();
  const store = new SqlCapacityStore(f.storage), record = store.get(submission().requestId);
  for (const shard of record.shards) {
    shard.attempts[0].startDeadline = Date.now() - 1;
    shard.attempts[0].executionDeadline = Date.now() - 1;
    shard.attempts[0].cancelDeadline = Date.now() - 1;
  }
  store.save(record);
  f.cancelUncertain();
  await f.tick();
  f.restart();
  await f.tick();
  assert.equal(store.get(record.submission.requestId).shards.every((s) => s.attempts.length === 1 && s.attempts[0].phase === "cancellation_unknown"), true);
  assert.equal(f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/dispatches")).length, 6);
  assert.equal(f.checks[0].status, "in_progress");
});
test("the real observation adapter distinguishes infrastructure before tests from verified test failure", async (t) => {
  const f = fixture(t), ports = new GithubCapacityPorts(f.api, config);
  const attempt = { ...submission(), logicalShard: SHARDS[0], profile: "hosted", generation: 1, childRunId: null, childAttempt: 1, startDeadline: Date.now() + 6e4, executionDeadline: Date.now() + 6e5, phase: "reserved", cancelDeadline: null, reason: null };
  await assert.rejects(ports.dispatch(attempt), /discovery_required/);
  const id = await ports.discover(attempt);
  assert.equal(id, 100);
  const receipt = { ...attempt, childRunId: id };
  f.result("failure");
  assert.equal((await ports.observe(receipt))?.testStep, "failure");
  const infra = new GithubCapacityPorts(async (method, path, body) => {
    const value = await f.api(method, path, body);
    if (path.includes("/jobs")) value.jobs[0].steps[0] = { name: "Run admitted Worker shard", status: "completed", conclusion: "skipped" };
    return value;
  }, config);
  assert.equal((await infra.observe(receipt))?.testStep, "not_run");
  const stale = new GithubCapacityPorts(async (method, path, body) => {
    const value = await f.api(method, path, body);
    if (path.includes("/jobs")) value.jobs[0].head_sha = SOURCE;
    return value;
  }, config);
  assert.equal(await stale.observe(receipt), null);
});

test('full-suite publication needs every frontend/rest result and keeps a real prerequisite failure sticky', async t => {
 const f=fixture(t);t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 const names=['suite (frontend-1-of-2)','suite (frontend-2-of-2)','suite (rest)','fast'];
 f.env.CAPACITY_CONFIG=JSON.stringify({...config,publication:'full-suite',fullSuiteJobs:names});f.restart();
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 f.result('success');await f.tick();
 assert.equal(f.checks[0].status,'in_progress');
 for(const [i,name] of names.slice(0,3).entries())f.parentJobs.push({id:20+i,name,run_id:12,run_attempt:1,head_sha:SOURCE,status:'completed',conclusion:'success'});
 await f.tick();assert.equal(f.checks[0].conclusion,'success');
 f.parentJobs[1].conclusion='failure';await f.tick();assert.equal(f.checks[0].conclusion,'failure');
 f.parentJobs[1].conclusion='success';f.restart();await f.tick();assert.equal(f.checks[0].conclusion,'failure');
});

test('a revoked parent cannot acquire a fresh success publication even if Worker receipts all passed',async t=>{
 const f=fixture(t);t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 f.result('success');const store=new SqlCapacityStore(f.storage),record=store.get(submission().requestId);
 for(const shard of record.shards)shard.attempts[0].phase='passed';store.save(record);
 f.parent.status='completed';f.parent.conclusion='cancelled';await f.tick();assert.equal(f.checks[0].conclusion,'cancelled');
});

test('trusted planner validates exact original event and plan; disabled caller performs no I/O',async t=>{
 assert.deepEqual(await plannerMain({}),{accepted:false,reason:'capacity_disabled'});
 const dir=mkdtempSync(join(tmpdir(),'capacity-planner-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const eventPath=join(dir,'event.json'),planPath=join(dir,'plan.json');writeFileSync(eventPath,'{}');
 const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts,exact=JSON.stringify(buildPlan(scripts,{},process.cwd()),null,2)+'\n';writeFileSync(planPath,exact);
 const s={...submission(),planDigest:'sha256:'+createHash('sha256').update(exact).digest('hex')};
 const env={CAPACITY_SUBMISSION:JSON.stringify(s),GITHUB_REPOSITORY:REPO,GITHUB_EVENT_PATH:eventPath,GITHUB_RUN_ID:'12',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:SOURCE,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',CAPACITY_EXECUTOR_SHA:EXEC,CAPACITY_SOURCE_ROOT:process.cwd(),CAPACITY_PLAN_FILE:planPath};
 assert.equal(plannerSubmission(env).plan,exact);
 assert.throws(()=>plannerSubmission({...env,GITHUB_RUN_ATTEMPT:'2'}),/parent_mismatch/);
 assert.throws(()=>plannerSubmission({...env,CAPACITY_SUBMISSION:JSON.stringify({...s,planDigest:'sha256:'+'0'.repeat(64)})}),/digest_mismatch/);
 assert.deepEqual(plannerSubmission(env,'metadata'),{artifact_id:45});
 const base='c'.repeat(40),queue={...s,event:'merge_group',queueBaseSha:base,planArtifactId:null};writeFileSync(eventPath,JSON.stringify({merge_group:{head_sha:SOURCE,base_sha:base}}));
 assert.equal(plannerSubmission({...env,GITHUB_EVENT_NAME:'merge_group',CAPACITY_SUBMISSION:JSON.stringify(queue)}).plan,exact);
 assert.throws(()=>plannerSubmission({...env,GITHUB_EVENT_NAME:'merge_group',CAPACITY_SUBMISSION:JSON.stringify({...queue,queueBaseSha:EXEC})}),/event_mismatch/);
});

test('queue provenance covers every same-repository PR and rejects forks, incomplete graphs and wrong queue bases',async t=>{
 const f=fixture(t),repo={id:7,full_name:REPO},head='c'.repeat(40),branch=`gh-readonly-queue/main/pr-1-${EXEC}`;
 f.parent.event='merge_group';f.parent.head_branch=branch;
 const s={...submission(),event:'merge_group',queueBaseSha:EXEC,planArtifactId:null};
 let fork=false,incomplete=false;
 const ports=new GithubCapacityPorts(async(method,path,body)=>{
  if(path===PREFIX+'/git/ref/heads/'+branch)return {ref:'refs/heads/'+branch,object:{type:'commit',sha:SOURCE}};
  if(path===PREFIX+`/compare/${EXEC}...${SOURCE}?per_page=100`)return {status:'ahead',behind_by:0,ahead_by:2,total_commits:2,base_commit:{sha:EXEC},merge_base_commit:{sha:EXEC},commits:incomplete?[]:[{sha:head,parents:[{sha:EXEC}]},{sha:SOURCE,parents:[{sha:EXEC},{sha:head}]}]};
  if(path===PREFIX+'/pulls/1')return {number:1,state:'open',base:{ref:'main',repo},head:{sha:head,repo:fork?{id:8,full_name:'fork/StudioOS'}:repo}};
  return f.api(method,path,body);
 },config);
 assert.equal((await ports.verify(s)).trustedSource,true);
 fork=true;await assert.rejects(ports.verify(s),/queue_fork/);fork=false;
 incomplete=true;await assert.rejects(ports.verify(s),/comparison/);incomplete=false;
 await assert.rejects(ports.verify({...s,queueBaseSha:head}),/uncovered/);
});

test('real ports allow one confirmed infrastructure fallback and preserve an old-generation test failure',async t=>{
 const f=fixture(t),store=new SqlCapacityStore(f.storage);let infrastructure=true;
 const ports=new GithubCapacityPorts(async(method,path,body)=>{
  if(path.includes('/runner-groups/5/runners'))return {total_count:1,runners:[{id:5,os:'linux',status:'online',busy:false,labels:['self-hosted','Linux','X64','studioos-worker-v1'].map(name=>({name}))}]};
  const value=await f.api(method,path,body);
  if(path.includes('/actions/runs/100')){
   if(path.includes('/jobs')){value.jobs[0].status='completed';value.jobs[0].conclusion='failure';value.jobs[0].labels=['self-hosted','Linux','X64','studioos-worker-v1'];value.jobs[0].steps[0]={name:'Run admitted Worker shard',status:'completed',conclusion:infrastructure?'skipped':'failure'};}
   else if(method==='GET'){value.status='completed';value.conclusion='failure';}
  }
  return value;
 },config);
 const capacity=new CiCapacity(store,ports,REPO,{version:1,maxExternalWorkerShards:1,maxIncludedWorkerShards:0,minimumHostedWorkerShards:1,approvedGroupId:5,budgets:{...CI_CAPACITY_BUDGETS}});
 await capacity.submit(submission());await capacity.tick();await capacity.tick();await capacity.tick();
 const request=store.get(submission().requestId),shard=request.shards[0];
 assert.deepEqual(shard.attempts.map(a=>[a.profile,a.generation]),[['linux-x64',1],['hosted',2]]);
 assert.equal(await capacity.receipt(request.submission.requestId,SHARDS[0],100,1),null);
 infrastructure=false;await capacity.tick();assert.equal(capacity.status(request.submission.requestId).status,'failure');
});

test('bounded publication cursor advances active requests and prunes orphaned intents',async t=>{
 const f=fixture(t);t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});
 const store=new SqlCapacityStore(f.storage),original=store.get(submission().requestId);
 for(let i=1;i<=5;i++){
  const record=structuredClone(original);record.submission.requestId=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;record.submission.parentRunId=12+i;store.save(record);
 }
 const outbox=new CapacityOutbox(f.storage,f.api,config),pending=()=>({status:'pending',reason:'awaiting_verified_results'});
 await outbox.publish(store,pending,'pilot');assert.equal(f.checks.length,4);
 await outbox.publish(store,pending,'pilot');assert.equal(f.checks.length,6);
 const removed=f.checks[0].external_id.slice(0,36);f.storage.sql.exec('DELETE FROM ci_capacity_requests WHERE id = ?',removed);
 await outbox.publish(store,pending,'pilot');
 assert.equal(f.storage.sql.exec('SELECT state FROM capacity_publications WHERE id = ?',removed+':pilot').toArray().length,0);
});

test('capacity App client scopes its token, fixes the API origin and caps authenticated requests',async()=>{
 const calls=[];
 const api=await capacityGithubClient({REPOSITORY:REPO,GITHUB_APP_ID:'23',GITHUB_INSTALLATION_ID:'2',GITHUB_APP_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}).toString()},async(url,init)=>{
  calls.push({url,init});return String(url).endsWith('/access_tokens')?Response.json({token:'fixture-installation'}):Response.json({ok:true});
 });
 assert.deepEqual(JSON.parse(calls[0].init.body),{repositories:['StudioOS'],permissions:{actions:'write',checks:'write',contents:'read',organization_self_hosted_runners:'read'}});
 for(let i=0;i<100;i++)await api('GET',PREFIX+'/actions/runs/12');
 await assert.rejects(api('GET',PREFIX+'/actions/runs/12'),/budget/);
 assert.equal(calls.every(c=>String(c.url).startsWith('https://api.github.com/')),true);
 assert.equal(calls.every(c=>c.init.redirect==='error'&&c.init.signal instanceof AbortSignal),true);
});

const authorityModule=new URL('../../scripts/ci/executor-authority.mjs',import.meta.url);
const jointAuthority=existsSync(authorityModule);
async function executorTestDependencies({env,verifyIsolation,fetcher}) {
 const common={api:githubReadApi(env.GH_TOKEN,fetcher),verifyIsolation};
 if(jointAuthority){
  const {trustedAuthority}=await import(authorityModule.href);
  return {...common,...await trustedAuthority(env)};
 }
 // Main before #7972: exercise the same real reader/catalog ports without copying its production adapter.
 return {...common,resolveProfile:resolveCatalogProfile,readReceipt:createReceiptReader({url:env.CAPACITY_AUTHORITY_URL,audience:env.CAPACITY_AUTHORITY_AUDIENCE,oidcToken:githubOidcToken(env,fetcher),fetcher})};
}

const linuxMember=()=>({id:5,os:'linux',status:'online',busy:false,labels:['self-hosted','Linux','X64','studioos-worker-v1'].map(name=>({name}))});
const macMember=(capability='studioos-macbook')=>({id:6,os:'osx',status:'online',busy:false,labels:['self-hosted','macOS','ARM64',capability].map(name=>({name}))});
test('mixed inventory retains Linux while legacy and fully capable Macs stay outside the explicit milestone',async t=>{
 const f=fixture(t),ports=new GithubCapacityPorts(f.api,config);
 f.runners.push(linuxMember(),macMember(),{...macMember('studioos-worker-v1'),id:7});
 const inventory=await ports.inventory();
 assert.deepEqual(inventory.runners.map(r=>[r.id,r.profile]),[[5,'linux-x64']]);
 t.mock.method(globalThis,'fetch',f.fetcher);f.env.CAPACITY_CONFIG=JSON.stringify({...config,maxExternalWorkerShards:1});f.restart();await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});
 const stored=new SqlCapacityStore(f.storage).get(submission().requestId);
 assert.deepEqual(stored.shards.map(s=>s.attempts[0].profile),['linux-x64','hosted','hosted','hosted','hosted','hosted']);
 assert.throws(()=>new GithubCapacityPorts(f.api,{...config,selfHostedProfiles:['linux-x64','macos-arm64']}),/milestone_policy/);
 assert.throws(()=>new GithubCapacityPorts(f.api,{...config,selfHostedProfiles:undefined}),/milestone_policy/);
 await assert.rejects(ports.dispatch({...stored.shards[0].attempts[0],profile:'macos-arm64'}),/profile_disabled/);
});

test('malformed inventory still refuses the snapshot; valid ineligible members are not authority errors',async t=>{
 const f=fixture(t),ports=new GithubCapacityPorts(f.api,config);
 f.runners.push(linuxMember());
 for(const patch of [{busy:'unknown'},{labels:null},{labels:[{name:7}]},{os:'unknown'},{id:0},{os:'linux',labels:macMember('studioos-worker-v1').labels}]){
  f.runners[1]={...macMember(),...patch};await assert.rejects(ports.inventory(),/runner_shape|runner_profile/);
 }
 f.runners[1]=macMember();assert.equal((await ports.inventory()).runners.length,1);
 f.runners[1]={...macMember(),busy:null};
 t.mock.method(globalThis,'fetch',f.fetcher);f.env.CAPACITY_CONFIG=JSON.stringify({...config,maxExternalWorkerShards:1});f.restart();await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});
 assert.equal(new SqlCapacityStore(f.storage).get(submission().requestId).shards.every(s=>s.attempts[0].profile==='hosted'),true);
});

test('composed Linux catalog and trusted executor preserve success, failures, revocation and incomplete results',async t=>{
 for(const outcome of ['success','failure','incomplete','revoked','isolation-denied'])await t.test(outcome,async t=>{
  const f=fixture(t);t.mock.method(globalThis,'fetch',f.fetcher);
  f.runners.push(linuxMember(),macMember('studioos-worker-v1'));f.env.CAPACITY_CONFIG=JSON.stringify({...config,maxExternalWorkerShards:1});f.restart();await unlock(f);
  const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts,bytes=JSON.stringify(buildPlan(scripts,{},process.cwd()),null,2)+'\n';
  const s={...submission(),planDigest:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
  await submitCapacity(s,{...options(f.clientFetch),plan:bytes,enabled:true});await f.tick();await f.tick();
  const dir=mkdtempSync(join(tmpdir(),'capacity-composed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const oldCapability=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='fixture-trusted-boundary-only';t.after(()=>{if(oldCapability===undefined)delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;else process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN=oldCapability;});
  const profile=resolveCatalogProfile('linux-x64');
  const env={REQUEST_ID:s.requestId,LEASE_GENERATION:'1',PART:SHARDS[0],PROFILE:'linux-x64',GITHUB_REPOSITORY:REPO,GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1',EXECUTOR_SHA:EXEC,GH_TOKEN:'fixture-read-only',GITHUB_OUTPUT:join(dir,'admission-output'),CAPACITY_AUTHORITY_URL:'https://capacity.invalid',CAPACITY_AUTHORITY_AUDIENCE:'fixture-capacity',ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/oidc',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture-trusted-boundary-only'};
  let isolationChecks=0,started=0,oidcReads=0;
  // Test double for S09's trusted Linux boundary; this is not an actual-node isolation proof.
  const boundary={ready:outcome!=='isolation-denied',generation:1,childRunId:100};
  const fetcher=async(input,init)=>{
   const url=new URL(input);
   if(url.hostname==='pipelines.actions.githubusercontent.com'){oidcReads++;return Response.json({value:token(claims(100))});}
   return url.hostname==='capacity.invalid'?f.clientFetch(input,init):f.fetcher(input,init);
  };
  t.mock.method(globalThis,'fetch',fetcher);
  const dependencies=await executorTestDependencies({env,fetcher,verifyIsolation:async({receipt,profile,phase})=>{
   isolationChecks++;
   return boundary.ready&&phase==='execute'&&profile.id==='linux-x64'&&profile.approvedGroupId===5&&receipt.profile===profile.id&&receipt.generation===boundary.generation&&receipt.childRunId===boundary.childRunId;
  }});
  let liveChecks=0;
  if(jointAuthority){
   dependencies.admissionIsolation=dependencies.verifyIsolation;
   dependencies.executionIsolation=async args=>{liveChecks++;return boundary.live===true&&await dependencies.verifyIsolation(args);};
   dependencies.job={owned:null,create(identity){this.owned={containerId:'fixture-container',identity};this.onOwned(this.owned);boundary.live=true;},async runCandidateInterruptible({receipt,admitted:live,signal}){
    if(signal.aborted||!boundary.live||JSON.stringify(receipt)!==JSON.stringify(live.identity))throw new Error('fixture_boundary_denied');
    if(outcome==='failure')throw new Error('candidate_test_failed');
   },cleanup(){this.owned=null;boundary.live=false;}};
  }
  t.diagnostic(jointAuthority?'actual S09 authority and container entrypoints':'base entrypoints with real reader/catalog');
  const code=await admissionMain(env,dependencies);
  if(outcome==='isolation-denied'){
   assert.equal(code,1);assert.equal(started,0);assert.notEqual(f.checks[0].conclusion,'success');return;
  }
  assert.equal(code,0);
  const admitted=JSON.parse(readFileSync(env.GITHUB_OUTPUT,'utf8').split('\n').find(line=>line.startsWith('admitted_json=')).slice('admitted_json='.length));
  assert.deepEqual(admitted.profile,profile);
  assert.equal(verifiedPlan({event:'push',part:admitted.shard,expectedDigest:admitted.plan.digest,artifactBytes:bytes,scripts,sourceRoot:process.cwd()}).toString(),bytes);
  assert.deepEqual(verifyRuntime(profile,{platform:profile.platform,arch:profile.arch,node:profile.nodeVersion,sqlite:()=>true}),{platform:'linux',arch:'x64',node:profile.nodeVersion});
  const request={requestId:s.requestId,generation:1,shard:SHARDS[0],profile:'linux-x64'},context={repository:REPO,executorSha:EXEC,childRunId:100,childAttempt:1};
  const liveRead=()=>admitRunnerJob(request,{...dependencies,context,phase:'execute'});
  const planPath=join(dir,'suite-plan.json');writeFileSync(planPath,bytes);
  // Execute both real CLI stages with mocked native facts/process boundary; no candidate code or container runs.
  const nativeVersion=Object.getOwnPropertyDescriptor(process.versions,'node');
  Object.defineProperty(process.versions,'node',{...nativeVersion,value:profile.nodeVersion});
  t.mock.method(childProcess,'execFileSync',(command,args)=>{
   if(command==='python3')return `x86_64\n${profile.pythonVersion}\n3.45.0\n`;
   if(command==='git'&&args[0]==='rev-parse')return SOURCE+'\n';
   if(command==='git'&&args[0]==='diff')return '';
   throw new Error('unexpected native operation');
  });
  t.mock.method(childProcess,'spawn',(_binary,_args,options)=>{
   assert.equal(Object.keys(options.env).some(key=>/TOKEN|CAPACITY|OIDC/.test(key)),false);
   const child=new EventEmitter();child.pid=12345;queueMicrotask(()=>child.emit('close',outcome==='failure'?23:0,null));return child;
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();Object.defineProperty(process.versions,'node',nativeVersion);});
  const nativeTemp=join(dir,'native-temp'),workspace=join(dir,'native-workspace');mkdirSync(nativeTemp);mkdirSync(workspace);
  const cliEnv={...env,RUNNER_TEMP:nativeTemp,GITHUB_WORKSPACE:workspace,ADMITTED_JSON:JSON.stringify(admitted)};
  await executionMain('prepare',cliEnv);
  const nativePaths=ownedPaths({runnerTemp:nativeTemp,workspace,childRunId:100,childAttempt:1});
  symlinkSync(process.cwd(),nativePaths.source,'dir');mkdirSync(join(nativePaths.temp,'parent-plan'));
  writeFileSync(join(nativePaths.temp,'parent-plan','suite-plan.json'),bytes);
  assert.equal(await executionMain('verify-plan',cliEnv,dependencies),0);
  if(outcome==='revoked'){
   await f.control().fetch(new Request('https://capacity.invalid/capacity/switch',{method:'POST',headers:{authorization:'Bearer fixture-owner'},body:'{"kill":true}'}));
   await assert.rejects(executionMain('run',cliEnv,dependencies),/superseded_before_execution/);
  }else{
   assert.equal(await executionMain('run',cliEnv,dependencies),outcome==='failure'?(jointAuthority?1:23):0);
   if(jointAuthority)assert.equal(liveChecks>0,true);
  }
  if(outcome==='revoked')await f.control().fetch(new Request('https://capacity.invalid/capacity/switch',{method:'POST',headers:{authorization:'Bearer fixture-owner'},body:'{"kill":true}'}));
  const execution=()=>executeShard({admitted,paths:{source:process.cwd(),temp:dir},testDriver:join(process.cwd(),'scripts/test-drift-parts.mjs'),planPath,readReceipt:liveRead,gitHead:()=>SOURCE,gitClean:()=>true,killGroup:()=>{},run:(_binary,_args,options)=>{
   started++;
   assert.equal(Object.keys(options.env).some(key=>/TOKEN|CAPACITY|OIDC/.test(key)),false);
   const child=new EventEmitter();child.pid=12345;queueMicrotask(()=>child.emit('close',outcome==='failure'?23:0,null));return child;
  }});
  if(outcome==='revoked'){await assert.rejects(execution(),/superseded_before_execution/);assert.equal(started,0);return;}
  const result=await execution();assert.equal(result.code,outcome==='failure'?23:0);assert.equal(started,1);
  assert.equal(isolationChecks>=2,true);
  assert.equal(oidcReads,2,'the two trusted reader lifetimes each reuse a short-lived token; authority still verifies every read');
  if(outcome==='incomplete')f.missingResults();
  f.result(outcome==='failure'?'failure':'success');await f.tick();
  assert.equal(f.checks[0].status,outcome==='incomplete'?'in_progress':'completed');
  assert.equal(f.checks[0].conclusion,outcome==='incomplete'?undefined:outcome);
  if(outcome==='failure'){f.result('success');await f.tick();assert.equal(f.checks[0].conclusion,'failure');}
 });
});

test('a persisted Mac generation cannot retrieve a receipt under the Linux milestone policy',async t=>{
 const f=fixture(t);t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 const store=new SqlCapacityStore(f.storage),record=store.get(submission().requestId);record.shards[0].attempts[0].profile='macos-arm64';store.save(record);
 const response=await f.clientFetch('https://capacity.invalid/capacity/receipt',{method:'POST',headers:{authorization:'Bearer '+token(claims(100))},body:JSON.stringify({requestId:record.submission.requestId,shard:SHARDS[0],generation:1,profile:'macos-arm64'})});
 assert.deepEqual(await response.json(),{active:false,receipt:null});
});
