/**
 * D8688 (#8688), part 2 — the 390 px role qualification's server.
 *
 * Serves the BUILT SPA (`docs/`, from `npm run build`) twice, and answers every
 * `/api/*` request with THE REAL WORKER (`cloudflare-worker/src/index.ts`):
 *   · HQ on PORT (default 4795): the qualification's HQ world, from
 *     `cloudflare-worker/test/_role_qualification_8688.ts` `hqWorld()` — the
 *     synthetic Founder, Investor, Advisor, Operating Partner and pending
 *     member of tenant A and tenant B, and the synthetic Super Admin;
 *   · branch `qa8688a` on PORT + 1: a branch deployment (`BRANCH_CODE`) over
 *     its own database, holding HQ's pushed copy of the DRAFT test-territory
 *     licence (`provisionTerritory`, the same push the API run makes), its
 *     principal from `seed-branch-principal.mjs` and one local LP applicant.
 *     The Worker sees the branch's own host, as `assertBranchAppUrl` requires;
 *     the browser only ever talks to 127.0.0.1.
 *
 * The same fixtures, the same fail-closed guard (`assertIsolatedTarget` runs
 * on each database before and after seeding) and the same synthetic domain
 * as the API run. No D1, mail, chat or payment binding is configured, and
 * every outside `fetch` the Worker attempts is refused and counted;
 * `GET /__qualification/manifest` reports the count, and the spec requires
 * it to be zero.
 *
 * `GET /__qualification/manifest` answers each role's session (fixture
 * signing keys, never a service credential) and `/api/auth/me` user, the two
 * origins and the fixture ids, so the spec signs in without a login page.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     frontend/tests/qualification/server.ts       (from the repo root)
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import worker from '../../../cloudflare-worker/src/index.ts';
import {
  BRANCHES, HQ, branchWorld, hqWorld, provisionTerritory, tokenFor, type World,
} from '../../../cloudflare-worker/test/_role_qualification_8688.ts';
import { reportPrivateError } from '../../../cloudflare-worker/src/util/errorPrivacy.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DOCS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 4795);
const BRANCH_PORT = PORT + 1;

if (!existsSync(join(DOCS, 'index.html'))) {
  console.error('[qualification] docs/index.html is missing: run `npm run build` at the repo root first.');
  process.exit(1);
}

/** Every outside request the Worker attempts is refused and counted. */
let outside = 0;
globalThis.fetch = (async () => { outside += 1; throw new Error('outside request refused by the role qualification'); }) as typeof fetch;

/** Rate limits are not under test here: a counter that never counts past one. */
const noLimits = () => ({ async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true }; } });
const ctx: any = { waitUntil() {}, passThroughOnException() {} };

const hq = hqWorld();
// Each role member finished its onboarding, so the app's wizard gate lets it into its workspace (the API run
// never meets the gate: it is the SPA's). The pending member is Exploring and has no wizard to finish.
const onboarded = hq.db.prepare("INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at) VALUES (?, ?, 3, 3, '2026-11-20 09:00:00')");
for (const [id, flow] of [[HQ.founder.A, 'founder'], [HQ.investor.A, 'investor'], [HQ.advisor.A, 'advisor'], [HQ.partner.A, 'partner']] as const) onboarded.run(id, flow);
const branch = branchWorld(BRANCHES[0].code, BRANCHES[0].applicant, 'applicant-a');
await provisionTerritory(hq, [branch]);
for (const w of [hq, branch]) w.env.RATE_LIMITS = noLimits();

type Deployment = { world: World; origin: string; workerOrigin: string };
const HQ_DEPLOYMENT: Deployment = { world: hq, origin: `http://127.0.0.1:${PORT}`, workerOrigin: `http://127.0.0.1:${PORT}` };
// The branch Worker answers only on its own host (`assertBranchAppUrl`); the browser's requests are re-addressed to it.
const BRANCH_DEPLOYMENT: Deployment = { world: branch, origin: `http://127.0.0.1:${BRANCH_PORT}`, workerOrigin: `https://${BRANCHES[0].code}.axal.vc` };

async function session(d: Deployment, userId: number) {
  const token = await tokenFor(d.world, userId);
  const res = await worker.fetch(new Request(`${d.workerOrigin}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } }), d.world.env, ctx);
  const user = res.ok ? await res.json() : null;
  return { token, user, origin: d.origin };
}

async function manifest() {
  return {
    hq: HQ_DEPLOYMENT.origin,
    branch: { origin: BRANCH_DEPLOYMENT.origin, code: BRANCHES[0].code, territory: BRANCHES[0].territory, application_id: branch.applicationId },
    ids: HQ,
    sessions: {
      admin: await session(BRANCH_DEPLOYMENT, branch.principal),
      founder: await session(HQ_DEPLOYMENT, HQ.founder.A),
      investor: await session(HQ_DEPLOYMENT, HQ.investor.A),
      advisor: await session(HQ_DEPLOYMENT, HQ.advisor.A),
      partner: await session(HQ_DEPLOYMENT, HQ.partner.A),
      pending: await session(HQ_DEPLOYMENT, HQ.pending),
    },
    outside_requests: outside,
  };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

function serve(d: Deployment, port: number) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', d.origin);
      if (url.pathname === '/__qualification/manifest') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(await manifest()));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        for (const k of ['origin', 'referer']) if (headers.has(k)) headers.set(k, headers.get(k)!.replace(d.origin, d.workerOrigin));
        headers.set('host', new URL(d.workerOrigin).host);
        const out = await worker.fetch(new Request(`${d.workerOrigin}${url.pathname}${url.search}`, {
          method: req.method, headers, ...(chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}),
        }), d.world.env, ctx);
        const head: Record<string, string> = {};
        out.headers.forEach((v, k) => { head[k] = v; });
        res.writeHead(out.status, head);
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
      // The SPA: a file under docs/ when there is one, else the shell (Workers' single-page-application fallback).
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      let file = join(DOCS, rel);
      if (!file.startsWith(DOCS) || !existsSync(file) || statSync(file).isDirectory()) file = join(DOCS, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (e) {
      // A diagnostic classification only: no exception message, path or stack.
      reportPrivateError('qualification_request', e);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('The qualification server could not answer this request.');
    }
  });
  server.listen(port, '127.0.0.1');
}

serve(HQ_DEPLOYMENT, PORT);
serve(BRANCH_DEPLOYMENT, BRANCH_PORT);
console.log(`[qualification] HQ on ${HQ_DEPLOYMENT.origin}, branch ${BRANCHES[0].code} on ${BRANCH_DEPLOYMENT.origin}; synthetic fixtures only`);
