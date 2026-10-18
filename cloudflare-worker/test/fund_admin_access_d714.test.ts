/**
 * D714 (#1779) decisions 5 and 6 — the act table's read, and the table held
 * to the routes it names.
 *
 *   · `GET /api/fund-admin/access` answers an admin on HQ, in their own
 *     session, and nobody else;
 *   · every route `FUND_ACTS` names is mounted, and its handler asserts that
 *     act; every fund write that runs `requireFundGp` also runs `assertFundAct`;
 *   · `COOL_OFF_ROUTES` holds the three wholly Super Admin routes.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_admin_access_d714.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import fundAdmin from '../src/routes/fund_admin.ts';
import { FUND_ACTS } from '../src/services/fundAdminAccess.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
INSERT INTO users (id, email, name, role) VALUES
  (1, 'admin@example.test', 'Plain Admin', 'admin'), (2, 'super@example.test', 'Super', 'admin'),
  (3, 'founder@example.test', 'Founder', 'founder'), (4, 'partner@example.test', 'Partner', 'partner'),
  (5, 'investor@example.test', 'Investor', 'investor');
INSERT INTO super_admins (user_id) VALUES (2);
`;

const app = new Hono<any>();
app.route('/api/fund-admin', fundAdmin);
app.onError((err: any, c) => {
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

async function access(user: number, opts: { support?: boolean; env?: Record<string, unknown> } = {}) {
  const { DB } = makeD1(SCHEMA);
  const jwt = await new SignJWT({ user_id: user, ...(opts.support ? { impersonated_by: 2 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await (app.request('/api/fund-admin/access', { headers: { Authorization: `Bearer ${jwt}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB, ...(opts.env || {}) }) as Promise<Response>)
    .catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, body: await res.json() as any };
}

test('GET /access answers 403 to a founder, a partner and an investor, on a branch, and in a support session', async () => {
  for (const user of [3, 4, 5]) assert.equal((await access(user)).status, 403, `user ${user}`);
  assert.equal((await access(2, { env: { BRANCH_CODE: 'fr' } })).status, 403, 'a branch');
  const support = await access(2, { support: true });
  assert.equal(support.status, 403);
  assert.equal(support.body.code, 'support_session_refused');
});

test('a plain Admin reads every Super Admin act as not allowed, with its sentence; the Super Admin reads them all allowed', async () => {
  const plain = await access(1);
  assert.equal(plain.status, 200);
  assert.equal(plain.body.super_admin, false);
  assert.equal(plain.body.acts.length, FUND_ACTS.length);
  for (const a of plain.body.acts) {
    assert.equal(a.allowed, a.tier === 'admin', a.act);
    if (a.tier === 'super_admin') assert.match(a.sentence, /^A Super Admin .+\.$/, a.act);
  }
  const sup = await access(2);
  assert.equal(sup.body.super_admin, true);
  assert.ok(sup.body.acts.every((a: any) => a.allowed));
});

test('the table: unique keys, the decision\'s tiers, and a sentence on every Super Admin act', () => {
  const tiers = Object.fromEntries(FUND_ACTS.map((a) => [a.act, a.tier]));
  assert.deepEqual(tiers, {
    'capital_call.preview': 'admin', 'capital_call.issue': 'super_admin', 'capital_call.receipt': 'admin',
    'distribution.preview': 'admin', 'distribution.execute': 'super_admin', 'distribution.mark_paid': 'admin',
    'fund_report.draft': 'admin', 'fund_report.issue': 'super_admin', 'fund_booklet.read': 'admin', 'fund_booklet.withdraw': 'admin', 'fund_notice.preview': 'admin', 'fund_notice.issue': 'super_admin', 'fund.gp_of_record': 'super_admin', 'fund.slug_fund_i': 'super_admin', 'fund.economics': 'super_admin', 'fund.write': 'admin',
    'fund_ledger.administrator': 'super_admin', 'fund_ledger.write': 'admin',
    'bank_account.see': 'super_admin', 'bank_account.change': 'super_admin', 'bank_account.reveal': 'super_admin',
    'fee_terms.confirm': 'super_admin', 'fee_period.issue': 'super_admin', 'fee.write': 'admin',
  });
  for (const a of FUND_ACTS) assert.equal(a.sentence !== null, a.tier === 'super_admin', a.act);
});

// ── The table held to the routes ────────────────────────────────────────

const ROUTERS: Record<string, { file: string; name: string }> = {
  '/api/funds': { file: 'routes/funds.ts', name: 'funds' },
  '/api/capital': { file: 'routes/capital.ts', name: 'capital' },
  '/api/fund-ledger': { file: 'routes/fund_ledger.ts', name: 'r' },
  '/api/fund-reporting': { file: 'routes/fund_reporting.ts', name: 'r' },
  '/api/fund-booklets': { file: 'routes/fund_booklets.ts', name: 'r' },
  '/api/fund-notices': { file: 'routes/fund_notices.ts', name: 'r' },
  '/api/fund-fees': { file: 'routes/fund_fees.ts', name: 'app' },
  '/api/admin/bank-accounts': { file: 'routes/admin_bank_accounts.ts', name: 'r' },
};

/** #1773's rows keep their own gates: each handler is held to the call it makes. */
const OWN_GATES: Record<string, string> = {
  'bank_account.see': 'await requireSuperAdmin(c)',
  'bank_account.change': 'await superAdminWriter(c)',
  'bank_account.reveal': 'await superAdminWriter(c)',
};

/** The source of one handler: from its registration to the next one on the same router. */
function handler(file: string, router: string, method: string, path: string): string | null {
  const text = src(file);
  const opener = `${router}.${method.toLowerCase()}('${path}'`;
  const at = text.indexOf(opener);
  if (at < 0) return null;
  const rest = text.slice(at + opener.length);
  const next = rest.search(/\n[A-Za-z]+\.(get|post|put|patch|delete|use)\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

test('every route FUND_ACTS names is mounted, and its handler asserts that act', () => {
  const index = src('index.ts');
  for (const prefix of Object.keys(ROUTERS)) {
    assert.ok(index.split(`app.route('${prefix}', `).length > 1, `${prefix} is not mounted in index.ts`);
  }
  const ledger = src('routes/fund_ledger.ts');
  const accessFn = ledger.slice(ledger.indexOf('async function access('), ledger.indexOf('const body=(c:any)'));
  assert.ok(accessFn.includes("write===true ? 'fund_ledger.write' : write") && accessFn.includes('await assertAdminAct(c,user,act)'),
    "the ledger's access() no longer asserts its act");
  const fees = src('routes/fund_fees.ts');
  const writeGate = fees.slice(fees.indexOf('async function writeGate('), fees.indexOf("app.use('*'"));
  assert.ok(writeGate.includes('await requireFundGp(c, fundId)') && writeGate.includes('await assertFundAct(c, g, act)'),
    "the fee router's writeGate no longer asserts its act");
  const funds = src('routes/funds.ts');
  const patchAct = funds.slice(funds.indexOf('function fundPatchAct('), funds.indexOf('const FUND_CONTROL_FIELDS'));

  for (const row of FUND_ACTS) {
    for (const route of row.routes) {
      const [method, full] = route.replace(/\s*\(.*\)$/, '').split(' ');
      const prefix = Object.keys(ROUTERS).find((p) => full === p || full.startsWith(`${p}/`));
      assert.ok(prefix, `${route}: no router owns this prefix`);
      const { file, name } = ROUTERS[prefix!];
      const body = handler(file, name, method, full.slice(prefix!.length) || '/');
      assert.ok(body, `${route} (${row.act}) is not a route in ${file}`);
      if (OWN_GATES[row.act]) {
        assert.ok(body!.includes(OWN_GATES[row.act]), `${route} no longer runs ${OWN_GATES[row.act]}`);
      } else if (file === 'routes/fund_fees.ts') {
        assert.ok(body!.includes(`await writeGate(c, '${row.act}')`), `${route} does not assert ${row.act}`);
      } else if (file === 'routes/fund_ledger.ts') {
        const expected = row.act === 'fund_ledger.administrator' ? "access(c,'fund_ledger.administrator')" : 'access(c,true)';
        assert.ok(body!.includes(expected), `${route} does not assert ${row.act}`);
      } else if (method === 'PATCH') {
        assert.ok(body!.includes('fundPatchAct(gp.fund, body)') && body!.includes('assertFundAct(c, gp, act)'), route);
        assert.ok(patchAct.includes(`'${row.act}'`), `fundPatchAct never answers ${row.act}`);
      } else {
        assert.ok(body!.includes(`'${row.act}'`), `${route} does not name ${row.act}`);
        assert.ok(/assert(Fund|Admin)Act\(/.test(body!), `${route} does not assert its act`);
      }
    }
  }
});

test('every fund write that runs requireFundGp also runs assertFundAct, before it writes', () => {
  const text = src('routes/funds.ts');
  const re = /\nfunds\.(post|put|patch|delete)\('([^']+)'/g;
  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = re.exec(text))) {
    const body = handler('routes/funds.ts', 'funds', m[1], m[2])!;
    if (!body.includes('requireFundGp(')) continue;
    seen += 1;
    const gate = body.indexOf('assertFundAct(');
    assert.ok(gate > 0, `${m[1].toUpperCase()} ${m[2]} runs requireFundGp and no act`);
    for (const write of ['LPs.create(', 'Funds.update(', 'issueFundCall(', 'recordReceipt(', 'saveFundPeriod(', 'Jobs.enqueue(', 'DB.batch(', 'addCommunication(']) {
      const at = body.indexOf(write);
      if (at >= 0) assert.ok(gate < at, `${m[2]}: ${write} runs before the act is asserted`);
    }
  }
  assert.ok(seen >= 12, `only ${seen} gated writes found`);
});

test('every fee write is a row of the table, under the act its writeGate asserts', () => {
  const text = src('routes/fund_fees.ts');
  const re = /\napp\.(post|put|patch|delete)\('([^']+)', async \(c\) => \{\n  const g = await writeGate\(c, '([^']+)'\)/g;
  const named = new Map<string, string>();
  for (const row of FUND_ACTS) for (const route of row.routes) named.set(route, row.act);
  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = re.exec(text))) {
    seen += 1;
    const route = `${m[1].toUpperCase()} /api/fund-fees${m[2]}`;
    assert.equal(named.get(route), m[3], `${route} is not in FUND_ACTS under ${m[3]}`);
  }
  assert.equal(seen, (text.match(/\napp\.(post|put|patch|delete)\(/g) || []).length, 'a fee write does not open with writeGate');
  assert.equal(seen, 8);
});

test('COOL_OFF_ROUTES holds decision 5\'s three routes', () => {
  const index = src('index.ts');
  const list = index.slice(index.indexOf('const COOL_OFF_ROUTES = ['), index.indexOf('for (const p of COOL_OFF_ROUTES)'));
  for (const route of ['/api/funds/:id/capital-call', '/api/funds/distributions/execute', '/api/fund-ledger/:id/administrator']) {
    assert.ok(list.includes(`'${route}'`), `${route} is not in COOL_OFF_ROUTES`);
  }
  assert.ok(index.split("app.route('/api/fund-admin', fundAdmin)").length > 1, '/api/fund-admin is not mounted');
});

test('execute asserts its act after the body read, which names the fund', () => {
  const body = handler('routes/funds.ts', 'funds', 'POST', '/distributions/execute')!;
  const read = body.indexOf('await c.req.json');
  const gate = body.indexOf("assertFundAct(c, gp, 'distribution.execute')");
  assert.ok(read >= 0 && gate > read, 'the execute gate moved before the body read');
});
