/**
 * Projects route — founder-attachment tests.
 *
 * Validates `resolveFounderIdForCreate`, the helper that decides which
 * founder row a newly-created project is attached to. Covers the bug fix
 * for "founder creates project, project never appears in their list":
 *
 *   (a) founder with no founder_id → row auto-created from JWT identity,
 *       users.founder_id back-filled, project attached.
 *   (b) founder with an existing founder_id → that id is forced regardless
 *       of any form input (IDOR guard).
 *   (c) admin / partner with form founder_email → looks up / creates that
 *       founder, ignoring the JWT identity.
 *
 * Run with:  node --test cloudflare-worker/test/projects.test.mjs
 *
 * NOTE: imports the helper out of the source TS file via `.ts` rewrite, then
 * dynamically transpiles with esbuild-on-disk if available. To keep this
 * runner dependency-free we re-implement the helper logic inside `loadHelper`
 * by string-extracting and `new Function`-evaluating it, which guarantees we
 * are testing the SAME source bytes that ship to Cloudflare.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* In-memory mock of the tagged-template `sql` helper used by the     */
/* worker. Records every statement so assertions can verify writes.   */
/* ------------------------------------------------------------------ */
function makeSql(initial = { founders: [], users: [] }) {
  const state = {
    founders: [...initial.founders],
    users: [...initial.users],
    nextFounderId: (initial.founders.at(-1)?.id ?? 0) + 1,
    log: [],
  };

  const sql = async (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    state.log.push({ text, values });

    // SELECT id FROM founders WHERE email = ?
    if (/^SELECT id FROM founders WHERE email = \?$/i.test(text)) {
      const [email] = values;
      return state.founders.filter(f => f.email === email).map(f => ({ id: f.id }));
    }
    // INSERT INTO founders (name, email) VALUES (?, ?) RETURNING id
    if (/^INSERT INTO founders \(name, email\) VALUES \(\?, \?\) RETURNING id$/i.test(text)) {
      const [name, email] = values;
      const row = { id: state.nextFounderId++, name, email };
      state.founders.push(row);
      return [{ id: row.id }];
    }
    // UPDATE users SET founder_id = ? WHERE id = ?
    if (/^UPDATE users SET founder_id = \? WHERE id = \?$/i.test(text)) {
      const [founderId, userId] = values;
      const u = state.users.find(u => u.id === userId);
      if (u) u.founder_id = founderId;
      return [];
    }
    throw new Error(`Unhandled SQL in mock: ${text}`);
  };
  return { sql, state };
}

/* ------------------------------------------------------------------ */
/* Load the helper out of the real TypeScript source. Uses the local  */
/* tsc compiler (already a worker devDep) to strip type annotations   */
/* so we are testing the EXACT source bytes that ship to Cloudflare.  */
/* ------------------------------------------------------------------ */
async function loadHelper() {
  const srcPath = resolve(__dirname, '../src/routes/projects.ts');
  const src = await readFile(srcPath, 'utf8');
  const start = src.indexOf('export async function resolveFounderIdForCreate(');
  assert.notEqual(start, -1, 'resolveFounderIdForCreate not found in projects.ts');

  // 1) Skip past the param list — count parens until depth returns to 0.
  let parenDepth = 0, j = src.indexOf('(', start);
  for (; j < src.length; j++) {
    if (src[j] === '(') parenDepth++;
    else if (src[j] === ')') { parenDepth--; if (parenDepth === 0) { j++; break; } }
  }
  // 2) The next `{` is the function-body open (param-type `{` already skipped).
  let depth = 0, i = src.indexOf('{', j), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, 'failed to balance braces around helper');

  // Wrap in an IIFE so tsc keeps the function declaration (a bare top-level
  // function is elided by transpileModule when there are no module imports).
  const tsBody = src.slice(start, end).replace(/^export\s+/, '');
  const wrapped = `const __helper = (() => { ${tsBody}; return resolveFounderIdForCreate; })();`;
  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });

  const mod = new Function(`${outputText}; return __helper;`);
  return mod();
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */
test('founder with no founder_id: auto-creates founder row + links user', async () => {
  const resolve_ = await loadHelper();
  const { sql, state } = makeSql({
    founders: [],
    users: [{ id: 42, email: 'alice@startup.io', name: 'Alice', role: 'founder', founder_id: null }],
  });
  const user = state.users[0];

  const founderId = await resolve_(user, { name: 'Demo' }, sql);

  assert.equal(typeof founderId, 'number', 'returns numeric founderId');
  assert.equal(state.founders.length, 1, 'a founder row was created');
  assert.equal(state.founders[0].email, 'alice@startup.io');
  assert.equal(state.founders[0].name, 'Alice');
  assert.equal(user.founder_id, founderId, 'users.founder_id was back-filled');
});

test('founder with existing founder_id: ignores form, returns own id', async () => {
  const resolve_ = await loadHelper();
  const { sql, state } = makeSql({
    founders: [{ id: 7, email: 'alice@startup.io', name: 'Alice' }],
    users: [{ id: 42, email: 'alice@startup.io', name: 'Alice', role: 'founder', founder_id: 7 }],
  });
  const user = state.users[0];

  const founderId = await resolve_(
    user,
    // A malicious payload trying to attach the project to someone else.
    { founder_email: 'victim@other.co', founder_name: 'Victim' },
    sql,
  );

  assert.equal(founderId, 7, 'ignores form, uses user.founder_id');
  assert.equal(state.founders.length, 1, 'no new founder row created');
  assert.equal(state.log.length, 0, 'short-circuited — no SQL fired');
});

test('admin with form founder_email: creates new founder row', async () => {
  const resolve_ = await loadHelper();
  const { sql, state } = makeSql({
    founders: [],
    users: [{ id: 1, email: 'admin@axal.vc', name: 'Admin', role: 'admin', founder_id: null }],
  });

  const founderId = await resolve_(
    state.users[0],
    { founder_email: 'newbie@startup.io', founder_name: 'Newbie' },
    sql,
  );

  assert.equal(state.founders.length, 1);
  assert.equal(state.founders[0].email, 'newbie@startup.io');
  assert.equal(state.founders[0].id, founderId);
  // Admin path must NOT touch users.founder_id.
  assert.equal(state.users[0].founder_id, null);
});

test('admin with existing founder_email: returns existing id, no insert', async () => {
  const resolve_ = await loadHelper();
  const { sql, state } = makeSql({
    founders: [{ id: 99, email: 'returning@startup.io', name: 'Returning' }],
    users: [{ id: 1, email: 'admin@axal.vc', name: 'Admin', role: 'admin', founder_id: null }],
  });

  const founderId = await resolve_(
    state.users[0],
    { founder_email: 'returning@startup.io' },
    sql,
  );

  assert.equal(founderId, 99);
  assert.equal(state.founders.length, 1, 'no duplicate insert');
});

test('partner with no founder_email in form: returns null (legacy behaviour)', async () => {
  const resolve_ = await loadHelper();
  const { sql, state } = makeSql({
    founders: [],
    users: [{ id: 5, email: 'partner@vc.com', name: 'Partner', role: 'partner', founder_id: null }],
  });

  const founderId = await resolve_(state.users[0], {}, sql);

  assert.equal(founderId, null);
  assert.equal(state.founders.length, 0);
});

/* ------------------------------------------------------------------ */
/* GET /:id 404-for-missing contract (NICE-500-04).                   */
/*                                                                    */
/* A missing project id must return a clean 404 — not a 500 — under   */
/* auth. We slice the real `projects.get('/:id', …)` closure from     */
/* source (transpiling away its TS annotations) and invoke it with a  */
/* stubbed `sql` that returns no rows, then assert the 404 reply. A   */
/* positive control proves the 404 is missing-only, not blanket.     */
/* ------------------------------------------------------------------ */
async function loadGetByIdHandler() {
  const src = await readFile(resolve(__dirname, '../src/routes/projects.ts'), 'utf8');
  const marker = "projects.get('/:id', async (c) => {";
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, "projects.get('/:id', …) not found in projects.ts");
  const bodyOpen = i + marker.length - 1; // index of the body-opening '{'
  let depth = 0, close = -1;
  for (let j = bodyOpen; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { close = j; break; } }
  }
  assert.notEqual(close, -1, 'failed to balance /:id handler braces');
  const body = src.slice(bodyOpen + 1, close); // contains TS annotations → must transpile
  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const wrapped = `const __run = async (c, __deps) => {
    const { requireAuth, getSQL, ensureProjectDataRoomColumns, ensureProjectRevenueProofColumns, ensureFounderCompanyColumn, canAccessFounderResource } = __deps;
    ${body}
  };`;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(`${outputText}; return __run;`)();
}

function makeStubSql(rows) {
  const sql = (_strings, ..._values) => Promise.resolve(rows);
  sql.end = async () => {};
  return sql;
}

const PROJECT_DEPS = {
  ensureProjectDataRoomColumns: async () => {},
  ensureProjectRevenueProofColumns: async () => {},
  ensureFounderCompanyColumn: async () => {},
  canAccessFounderResource: () => true,
};

test('GET /:id: missing project → 404 (not 500) under auth', async () => {
  const run = await loadGetByIdHandler();
  let captured;
  const c = {
    env: {},
    req: { param: () => '99999' },
    json: (b, status) => { captured = { b, status: status ?? 200 }; return captured; },
  };
  await run(c, {
    ...PROJECT_DEPS,
    requireAuth: async () => ({ id: 1, role: 'founder', founder_id: 1 }),
    getSQL: () => makeStubSql([]), // no rows → not found
  });
  assert.equal(captured.status, 404);
  assert.deepEqual(captured.b, { error: 'Project not found' });
});

test('GET /:id: existing project → 200 (404 is missing-only, not blanket)', async () => {
  const run = await loadGetByIdHandler();
  let captured;
  const project = { id: 5, name: 'Demo', founder_id: null };
  const c = {
    env: {},
    req: { param: () => '5' },
    json: (b, status) => { captured = { b, status: status ?? 200 }; return captured; },
  };
  await run(c, {
    ...PROJECT_DEPS,
    requireAuth: async () => ({ id: 1, role: 'admin', founder_id: null }),
    getSQL: () => makeStubSql([project]), // row present → returned, not 404
  });
  assert.equal(captured.status, 200);
  assert.equal(captured.b.id, 5);
});

/* ------------------------------------------------------------------ */
/* POST /:projectId/spinout-deck — RBAC + data-source contract.       */
/* (Task #41)                                                          */
/*                                                                    */
/* The deck is assembled from the PROJECT OWNER's user-scoped Lab data */
/* (fillAxalSpinoutDemoDay reads founder profile, lab milestones,     */
/* advisor answers, cap-table fallback, team graph by userId). The    */
/* route MUST source from the owner, never the viewer — otherwise a   */
/* staff member generating on behalf would leak their own data into a */
/* founder's deck. We slice the real handler from source and inject   */
/* stubbed deps, then assert WHICH userId reaches the assembler.      */
/* ------------------------------------------------------------------ */
async function loadSpinoutDeckHandler() {
  const src = await readFile(resolve(__dirname, '../src/routes/projects.ts'), 'utf8');
  const marker = "projects.post('/:projectId/spinout-deck', async (c) => {";
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, "projects.post('/:projectId/spinout-deck', …) not found");
  const bodyOpen = i + marker.length - 1; // index of the body-opening '{'
  let depth = 0, close = -1;
  for (let j = bodyOpen; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { close = j; break; } }
  }
  assert.notEqual(close, -1, 'failed to balance spinout-deck handler braces');
  const body = src.slice(bodyOpen + 1, close);
  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const wrapped = `const __run = async (c, __deps) => {
    const { requireAuth, getSQL, ensureMethodAllowed, PREMIUM_METHOD_IDS, assembleSpinoutDeckData } = __deps;
    ${body}
  };`;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(`${outputText}; return __run;`)();
}

/** A `sql` stub that routes by statement text (project lookup vs owner lookup). */
function makeRoutedSql(routes) {
  const sql = (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    for (const r of routes) if (r.test.test(text)) return Promise.resolve(r.rows);
    return Promise.resolve([]);
  };
  sql.end = async () => {};
  return sql;
}

const PROJECT_RE = /SELECT id, founder_id FROM projects WHERE id = \?/i;
const OWNER_RE = /SELECT id FROM users WHERE founder_id = \? ORDER BY id ASC LIMIT 1/i;

function runSpinoutDeck({ user, projectRows, ownerRows, methodThrows = false }) {
  const calls = { assembleUserId: undefined, assembleProjectId: undefined };
  const deps = {
    requireAuth: async () => user,
    ensureMethodAllowed: () => { if (methodThrows) { const e = new Error('PAYWALL'); throw e; } },
    PREMIUM_METHOD_IDS: ['axal_spinout_demoday'],
    getSQL: () => makeRoutedSql([
      { test: PROJECT_RE, rows: projectRows },
      { test: OWNER_RE, rows: ownerRows },
    ]),
    assembleSpinoutDeckData: async (_env, userId, projectId) => {
      calls.assembleUserId = userId;
      calls.assembleProjectId = projectId;
      return { data: { ok: true }, notes: { cover: 'n' }, gaps: ['g1'], draft: true, programDay: 16 };
    },
  };
  let captured;
  const c = {
    env: {},
    req: { param: (k) => (k === 'projectId' ? '5' : undefined) },
    json: (b, status) => { captured = { b, status: status ?? 200 }; return captured; },
  };
  return loadSpinoutDeckHandler().then((run) => run(c, deps)).then(() => ({ captured, calls }));
}

test('spinout-deck: founder-owner → 200, sources from the founder themselves', async () => {
  const { captured, calls } = await runSpinoutDeck({
    user: { id: 42, role: 'founder', founder_id: 7 },
    projectRows: [{ id: 5, founder_id: 7 }],
    ownerRows: [{ id: 42 }],
  });
  assert.equal(captured.status, 200);
  assert.equal(captured.b.program_day, 16);
  assert.deepEqual(captured.b.gaps, ['g1']);
  assert.equal(captured.b.draft, true);
  assert.equal(calls.assembleUserId, 42, 'owner sources from their own user id');
  assert.equal(calls.assembleProjectId, 5);
});

test('spinout-deck: non-owner founder → 403, assembler never runs', async () => {
  const { captured, calls } = await runSpinoutDeck({
    user: { id: 99, role: 'founder', founder_id: 3 },
    projectRows: [{ id: 5, founder_id: 7 }],
    ownerRows: [{ id: 42 }],
  });
  assert.equal(captured.status, 403);
  assert.equal(calls.assembleUserId, undefined, 'no deck assembled for a non-owner');
});

test('spinout-deck: admin on behalf → sources the OWNER id, not the admin', async () => {
  const { captured, calls } = await runSpinoutDeck({
    user: { id: 1, role: 'admin', founder_id: null },
    projectRows: [{ id: 5, founder_id: 7 }],
    ownerRows: [{ id: 42 }], // the founder's user account
  });
  assert.equal(captured.status, 200);
  assert.equal(calls.assembleUserId, 42, 'staff-on-behalf must source the founder, not themselves');
});

test('spinout-deck: investor → 403 even though the paywall would let them pass', async () => {
  const { captured, calls } = await runSpinoutDeck({
    user: { id: 2, role: 'investor', founder_id: null },
    projectRows: [{ id: 5, founder_id: 7 }],
    ownerRows: [{ id: 42 }],
    methodThrows: false, // investors bypass ensureMethodAllowed — AUTHZ must still block
  });
  assert.equal(captured.status, 403);
  assert.equal(calls.assembleUserId, undefined, 'investor must not receive unmasked deck data');
});

test('spinout-deck: premium gate → 402 upgrade payload', async () => {
  const { captured, calls } = await runSpinoutDeck({
    user: { id: 50, role: 'founder', founder_id: 7 },
    projectRows: [{ id: 5, founder_id: 7 }],
    ownerRows: [{ id: 50 }],
    methodThrows: true,
  });
  assert.equal(captured.status, 402);
  assert.equal(captured.b.code, 'PAYWALL_PREMIUM_METHOD');
  assert.equal(calls.assembleUserId, undefined);
});

test('spinout-deck: staff on behalf but project has no founder account → 409', async () => {
  const { captured, calls } = await runSpinoutDeck({
    user: { id: 1, role: 'admin', founder_id: null },
    projectRows: [{ id: 5, founder_id: 7 }],
    ownerRows: [], // no user linked to the founder
  });
  assert.equal(captured.status, 409);
  assert.equal(calls.assembleUserId, undefined);
});

test('spinout-deck: missing project → 404', async () => {
  const { captured, calls } = await runSpinoutDeck({
    user: { id: 1, role: 'admin', founder_id: null },
    projectRows: [], // not found
    ownerRows: [],
  });
  assert.equal(captured.status, 404);
  assert.equal(calls.assembleUserId, undefined);
});
