/**
 * Trust Center — POST /api/trust/intro/request branch coverage.
 *
 * Drives `requestIntroLogic` (extracted in routes/trust.ts under Task #17)
 * with fully mocked dependencies, covering the five branches the spec
 * cares about:
 *
 *   1. cannot-intro-self                       → 400
 *   2. founder-not-found                       → 404
 *   3. target-is-not-a-founder                 → 400
 *   4. already-active short-circuit            → 200 + envelope_uuid
 *   5. happy path → founder receives a 'contract_sign_request' notify
 *      call (which CRITICAL_CATEGORIES routes to notifications_inbox).
 *
 * Same source-extraction + tsc.transpileModule pattern used by
 * `projects.test.mjs` / `spinout_lab.test.mjs` so we test the EXACT
 * source bytes that ship to Cloudflare. No new test deps.
 *
 * Run with:  node --test cloudflare-worker/test/trust_intro.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Slice `requestIntroLogic` out of routes/trust.ts and transpile the */
/* TypeScript so we can `new Function`-eval it without real imports.  */
/* The function takes `deps` so all collaborator surfaces are mocked  */
/* — no need to stub `getSQL`, `getPairwiseNda`, etc. in scope.       */
/* ------------------------------------------------------------------ */
async function loadLogic() {
  const srcPath = resolve(__dirname, '../src/routes/trust.ts');
  const src = await readFile(srcPath, 'utf8');
  const start = src.indexOf('export async function requestIntroLogic(');
  assert.notEqual(start, -1, 'requestIntroLogic not found in trust.ts');

  // Skip past the param list (param-types contain `{`/`}` we must not count).
  let parenDepth = 0, j = src.indexOf('(', start);
  for (; j < src.length; j++) {
    if (src[j] === '(') parenDepth++;
    else if (src[j] === ')') { parenDepth--; if (parenDepth === 0) { j++; break; } }
  }
  // The next `{` starts the body.
  let depth = 0, i = src.indexOf('{', j), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, 'failed to balance braces around requestIntroLogic');

  const tsBody = src.slice(start, end).replace(/^export\s+/, '');
  const wrapped = `const __logic = (() => { ${tsBody}; return requestIntroLogic; })();`;
  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(`${outputText}; return __logic;`)();
}

/* ------------------------------------------------------------------ */
/* Helper: build a fresh deps mock with spies + per-test overrides.   */
/* Defaults express the happy path; tests override only what matters. */
/* ------------------------------------------------------------------ */
function makeDeps(overrides = {}) {
  const calls = {
    lookupFounder: [],
    getPairwise: [],
    isPairwiseActive: [],
    upsertPairwise: [],
    createEnvelope: [],
    notify: [],
  };
  const deps = {
    lookupFounder: async (env, id) => {
      calls.lookupFounder.push({ id });
      return { id, email: 'founder@startup.io', name: 'Founder Name', role: 'founder' };
    },
    getPairwise: async (env, fid, iid) => {
      calls.getPairwise.push({ fid, iid });
      return null;
    },
    isPairwiseActive: async (env, fid, iid) => {
      calls.isPairwiseActive.push({ fid, iid });
      return false;
    },
    upsertPairwise: async (env, fid, iid, uuid) => {
      calls.upsertPairwise.push({ fid, iid, uuid });
    },
    createEnvelope: async (env, args) => {
      calls.createEnvelope.push({ args });
      return {
        envelope_uuid: 'env-uuid-happy',
        signing_urls: {
          investor: 'https://axal.vc/esign/investor-token',
          founder:  'https://axal.vc/esign/founder-token',
          axal:     'https://axal.vc/esign/axal-token',
        },
      };
    },
    notify: async (env, args) => {
      calls.notify.push({ args });
    },
    ...overrides,
  };
  return { deps, calls };
}

const ENV = { APP_URL: 'https://axal.vc' };
const INVESTOR = { id: 100, role: 'investor', email: 'inv@vc.com', name: 'Capital Partners' };

/* ------------------------------------------------------------------ */
/* Branch tests                                                       */
/* ------------------------------------------------------------------ */

test('cannot_intro_self: investor.id === founder_user_id → 400', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps, calls } = makeDeps();
  const r = await requestIntroLogic(ENV, INVESTOR, { founder_user_id: INVESTOR.id }, deps);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'cannot_intro_self');
  // Short-circuit before any DB / envelope work.
  assert.equal(calls.lookupFounder.length, 0);
  assert.equal(calls.createEnvelope.length, 0);
  assert.equal(calls.notify.length, 0);
});

test('founder_not_found: lookupFounder returns null → 404', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps, calls } = makeDeps({
    lookupFounder: async () => null,
  });
  const r = await requestIntroLogic(ENV, INVESTOR, { founder_user_id: 999 }, deps);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'founder_not_found');
  // Never reached envelope / notify.
  assert.equal(calls.createEnvelope.length, 0);
  assert.equal(calls.notify.length, 0);
});

test('target_is_not_a_founder: looked-up user.role !== "founder" → 400', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps, calls } = makeDeps({
    lookupFounder: async (env, id) => ({
      id, email: 'advisor@axal.vc', name: 'Advisor Bob', role: 'advisor',
    }),
  });
  const r = await requestIntroLogic(ENV, INVESTOR, { founder_user_id: 200 }, deps);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'target_is_not_a_founder');
  assert.equal(calls.createEnvelope.length, 0);
  assert.equal(calls.notify.length, 0);
});

test('already_active short-circuit: existing pairwise NDA + active → returns existing envelope', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps, calls } = makeDeps({
    getPairwise: async () => ({
      nda_envelope_uuid: 'env-uuid-existing',
      valid_until: '2027-01-01T00:00:00Z',
      status: 'active',
    }),
    isPairwiseActive: async () => true,
  });
  const r = await requestIntroLogic(ENV, INVESTOR, { founder_user_id: 200 }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'already_active');
  assert.equal(r.body.envelope_uuid, 'env-uuid-existing');
  assert.equal(r.body.valid_until, '2027-01-01T00:00:00Z');
  // Short-circuit BEFORE issuing a new envelope or notifying.
  assert.equal(calls.createEnvelope.length, 0);
  assert.equal(calls.upsertPairwise.length, 0);
  assert.equal(calls.notify.length, 0);
});

test('happy path: founder receives a contract_sign_request notify call', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps, calls } = makeDeps();
  const r = await requestIntroLogic(ENV, INVESTOR, { founder_user_id: 200 }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'envelope_issued');
  assert.equal(r.body.envelope_uuid, 'env-uuid-happy');
  // SECURITY: only the investor's own signing URL is leaked back.
  assert.equal(r.body.signing_url, 'https://axal.vc/esign/investor-token');
  assert.equal(r.body.founder_signing_url, undefined);
  assert.equal(r.body.axal_signing_url, undefined);
  // Pairwise row was upserted with the new envelope UUID.
  assert.deepEqual(calls.upsertPairwise[0], { fid: 200, iid: 100, uuid: 'env-uuid-happy' });
  // Founder got the notification — type + category + recipient + payload.
  assert.equal(calls.notify.length, 1);
  const n = calls.notify[0].args;
  assert.equal(n.userId, 200, 'notify routed to FOUNDER (not investor)');
  assert.equal(n.type, 'contract_sign_request');
  assert.equal(n.category, 'contract_sign_request',
    'category MUST be contract_sign_request — CRITICAL_CATEGORIES bypasses quiet hours');
  assert.equal(n.link, '/trust');
  assert.equal(n.payload.envelope_uuid, 'env-uuid-happy');
  assert.equal(n.payload.investor_user_id, 100);
  assert.match(n.body, /Capital Partners/, 'body mentions investor display name');
});

test('admin role is permitted to act as an investor', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps } = makeDeps();
  const admin = { id: 1, role: 'admin', email: 'admin@axal.vc', name: 'Admin' };
  const r = await requestIntroLogic(ENV, admin, { founder_user_id: 200 }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'envelope_issued');
});

test('non-investor non-admin role is rejected with 403', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps, calls } = makeDeps();
  const founder = { id: 200, role: 'founder', email: 'f@s.io', name: 'F' };
  const r = await requestIntroLogic(ENV, founder, { founder_user_id: 300 }, deps);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'investor_role_required');
  assert.equal(calls.lookupFounder.length, 0);
});

test('invalid founder_user_id (NaN / 0 / negative) → 400', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps } = makeDeps();
  for (const bad of [undefined, null, 0, -1, 'abc', 1.5]) {
    const r = await requestIntroLogic(ENV, INVESTOR, { founder_user_id: bad }, deps);
    assert.equal(r.status, 400, `expected 400 for founder_user_id=${bad}`);
    assert.equal(r.body.error, 'founder_user_id required');
  }
});

test('envelope creation throwing → 500 envelope_creation_failed', async () => {
  const requestIntroLogic = await loadLogic();
  const { deps, calls } = makeDeps({
    createEnvelope: async () => { throw new Error('docusign down'); },
  });
  // Silence the expected console.error noise for this branch.
  const origErr = console.error;
  console.error = () => {};
  try {
    const r = await requestIntroLogic(ENV, INVESTOR, { founder_user_id: 200 }, deps);
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'envelope_creation_failed');
    assert.match(r.body.message, /docusign down/);
    assert.equal(calls.upsertPairwise.length, 0);
    assert.equal(calls.notify.length, 0);
  } finally {
    console.error = origErr;
  }
});
