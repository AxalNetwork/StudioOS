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
