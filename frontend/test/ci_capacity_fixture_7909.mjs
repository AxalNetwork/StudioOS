/** D7909: shared synthetic provider/supervisor facts; real RSA, SQLite, ingress and coordinator. Never live evidence. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import '../../merge-control/test/runtime-loader.mjs';
const { CapacityControl } = await import('../../merge-control/src/ciCapacityRuntime.ts');
const { default: worker } = await import('../../merge-control/src/index.ts');
import { CAPACITY_ISSUER } from '../../merge-control/src/ciCapacityAuth.ts';
import { resolveCatalogProfile } from '../../scripts/ci/runners/catalog.mjs';
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
function fixture(t,{callbackResults=false}={}) {
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
  const childResults=new Map();
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
      const result = childResults.get(run.id)?.status ?? (run.status === "completed" ? run.conclusion : "queued");
      if (child[2] === "/cancel") {
        if (cancelThrows) throw new Error("uncertain cancellation");
        run.status = "completed";
        run.conclusion = "cancelled";
        return null;
      }
      if (child[2].endsWith("/jobs")&&incomplete)return {total_count:0,jobs:[]};
      if (child[2].endsWith("/jobs")) return { total_count: 1, jobs: [{ id: run.id + 1e3, name: "Admitted Worker shard", check_run_url: `https://api.github.com/repos/${REPO}/check-runs/${run.id + 1e3}`, run_id: run.id, run_attempt: 1, head_sha: run.head_sha, status: result === "queued" ? "in_progress" : "completed", conclusion: result === "queued" ? null : result, labels:run.capacityProfile==='hosted'?['ubuntu-latest']:resolveCatalogProfile(run.capacityProfile).target.labels, started_at: (new Date()).toISOString(), completed_at: result === "queued" ? null : (new Date()).toISOString(), steps: [{ name: "Run admitted Worker shard", status: result === "queued" ? "queued" : "completed", conclusion: result === "queued" ? null : result, completed_at: result === "queued" ? null : (new Date()).toISOString() }] }] };
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
  const env = { REPOSITORY: REPO, CAPACITY_ENABLED: "true", CAPACITY_OWNER_TOKEN: "fixture-owner", CAPACITY_AUDIENCE: "fixture-capacity", CAPACITY_CONFIG: JSON.stringify(config), GITHUB_APP_ID: "23", GITHUB_INSTALLATION_ID: "2", CAPACITY_INVENTORY_TOKEN: "fixture-inventory-only", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  // Simulated supervisor evidence, deliberately separate from the wrapper's GitHub conclusion.
  class FixtureControl extends CapacityControl {
    executionResultReader = async (receipt, jobId) => {
      const observed=childResults.get(receipt.childRunId),state=observed?.status??result;
      return {receipt,jobId,observedAt:Date.now(),testStep:observed?.testStep??(state==='failure'?'failure':state==='success'?'success':'not_run'),
        executionOutcome:observed?.executionOutcome??(state==='queued'?'unknown':'completed'),
        cleanupConfirmed:observed?.cleanupConfirmed??(children.get(receipt.childRunId)?.status==='completed')};
    };
  }
  const Control=callbackResults?CapacityControl:FixtureControl;
  let control = new Control(ctx, env);
  env.CAPACITY_CONTROL = { getByName: name => { if(name !== REPO)throw Error("wrong authority atom"); return control; } };
  const clientFetch = async (input, init) => worker.fetch(new Request(input, init),env);
  return { storage, api, fetcher, reportChild:(id,observation)=>{
    childResults.set(id,observation);const run=children.get(id);run.status='completed';run.conclusion=observation.status;
  }, parent, parentJobs, children, runners, missingResults:()=>{incomplete=true;}, checks, calls, env, alarm: () => alarm, restart: () => {
    control = new Control(ctx, env);
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

export { REPO, PREFIX, SOURCE, EXEC, SHARDS, privateKey, publicKey, jwk, config, plan, submission, claims, token, fixture, options, unlock };
