/**
 * Secondary settlement routes — proceeds calculator + ROFR notice.
 *
 * services/secondaryProceeds.ts was written, tested, and then reachable
 * by nobody; these routes are the wiring, and this file covers the
 * wiring rather than the arithmetic (secondaryProceeds.test.ts already
 * pins the waterfall itself).
 *
 * Two things can go wrong at a boundary like this, and both are here:
 *
 *   1. UNITS. routes/liquidity.ts transits integer cents and the engine
 *      works in dollars. A missed conversion is a silent 100x error on
 *      a wire transfer, so the round trip is asserted against exact
 *      cent values rather than eyeballed.
 *   2. ACCESS. A proceeds breakdown states the seller's cost basis and
 *      their net take. Partners and investors can already read the
 *      marketplace and broker matches; they must not be able to read
 *      this.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/liquidity_settlement.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import liquidity from '../src/routes/liquidity.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const SELLER = 10;
const OTHER = 11;
const ADMIN = 12;
const LISTING = 5;

// Mirrors the production error mapping (index.ts:940).
const app = new Hono();
app.route('/', liquidity);
app.onError((err: any, c) => {
  const msg = (err?.message ?? '') as string;
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
  return c.json({ detail: 'Internal server error' }, 500);
});

const USERS: any[] = [
  { id: SELLER, name: 'Sal Seller', role: 'founder', email: 'sal@example.com', is_active: 1 },
  { id: OTHER, name: 'Bree Broker', role: 'partner', email: 'bree@example.com', is_active: 1 },
  { id: ADMIN, name: 'Ada Admin', role: 'admin', email: 'ada@example.com', is_active: 1 },
];

async function mintToken(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function makeEnv() {
  // 250,000 dollars as the asking price, expressed the way the table does.
  const listing = {
    id: LISTING, user_id: SELLER, subsidiary_id: 3, shares: 10_000,
    asking_price_cents: 25_000_000, status: 'open',
  };
  let notice: any = null;

  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase().replace(/\s+/g, ' ');
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async all() {
        if (s.includes('from users where id')) {
          const u = USERS.find((x) => x.id === bound[0]);
          return { results: u ? [u] : [] };
        }
        return { results: [] };
      },
      async first() {
        if (s.includes('from secondary_listings where id')) {
          return bound[0] === LISTING ? { ...listing } : null;
        }
        if (s.includes('from secondary_rofr_notices')) return notice ? { ...notice } : null;
        return null;
      },
      async run() {
        if (s.includes('insert into secondary_rofr_notices')) {
          // listing_id, notice_date, window_days, shares_offered,
          // company_elected, investors_elected, waived, notes, created_by
          notice = {
            listing_id: bound[0], notice_date: bound[1], window_days: bound[2],
            shares_offered: bound[3], company_elected: bound[4],
            investors_elected: bound[5], waived: bound[6], notes: bound[7],
            created_by: bound[8],
          };
        }
        return { meta: { changes: 1 } };
      },
    };
    return api;
  };

  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
}

function req(env: any, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } },
    env,
  );
}

const proceeds = (env: any, token: string, terms: any) =>
  req(env, token, `/listings/${LISTING}/proceeds`, { method: 'POST', body: JSON.stringify(terms) });

// ---------- units ----------

test('the cents/dollars round trip is exact, not approximately right', async () => {
  const env = makeEnv();
  const r = await (await proceeds(env, await mintToken(SELLER, 'founder'), {
    cost_basis_cents: 10_000_000,   // $100,000
    transfer_fee_pct: 0.02,         // 2% of $250,000 = $5,000
    flat_fees_cents: 150_000,       // $1,500
    carry_pct: 0.20,                // 20% of the $150,000 gain = $30,000
  })).json() as any;

  // $250,000 − 5,000 − 1,500 − 30,000 = $213,500.
  assert.equal(r.gross_cents, 25_000_000);
  assert.equal(r.gain_cents, 15_000_000);
  assert.equal(r.net_cents, 21_350_000);
  // Every line is in cents too — a dollar figure slipping through here
  // would read as a 100x shortfall on the seller's wire.
  const byKey = Object.fromEntries(r.lines.map((l: any) => [l.key, l]));
  assert.equal(byKey.gross.amount_cents, 25_000_000);
  assert.equal(byKey.transfer_fee.amount_cents, -500_000);
  assert.equal(byKey.flat_fees.amount_cents, -150_000);
  assert.equal(byKey.carry.amount_cents, -3_000_000);
  assert.equal(byKey.carry.balance_cents, r.net_cents);
});

test('the asking price is the default gross, and an override replaces it', async () => {
  const env = makeEnv();
  const token = await mintToken(SELLER, 'founder');

  const asked = await (await proceeds(env, token, {})).json() as any;
  assert.equal(asked.gross_cents, 25_000_000, 'defaults to the listing');

  const modelled = await (await proceeds(env, token, { gross_cents: 30_000_000 })).json() as any;
  assert.equal(modelled.gross_cents, 30_000_000, '"what if they offer 300k"');
  assert.equal(modelled.net_cents, 30_000_000, 'no fees supplied, so nothing comes off');
});

test('no cost basis means carry is skipped and said so, not charged on gross', async () => {
  const env = makeEnv();
  const r = await (await proceeds(env, await mintToken(SELLER, 'founder'), {
    carry_pct: 0.20,
  })).json() as any;
  assert.equal(r.net_cents, 25_000_000, '20% of gross would have been 5,000,000 cents');
  assert.equal(r.gain_cents, null);
  assert.ok(r.warnings.some((w: string) => /no cost basis/i.test(w)));
});

// ---------- access ----------

test('a broker cannot read the seller\'s proceeds', async () => {
  // This user is a partner: allowed on /marketplace and /match, which
  // carry the asking price only. Cost basis and net take are not theirs.
  const env = makeEnv();
  const res = await proceeds(env, await mintToken(OTHER, 'partner'), {});
  assert.equal(res.status, 404);
});

test('the refusal is a 404, so it does not confirm the listing exists', async () => {
  const env = makeEnv();
  const token = await mintToken(OTHER, 'partner');
  const mine = await proceeds(env, token, {});
  const nonexistent = await req(env, token, '/listings/999999/proceeds', {
    method: 'POST', body: '{}',
  });
  assert.equal(mine.status, nonexistent.status, 'a 403 here would leak existence');
});

test('an admin can read it', async () => {
  const env = makeEnv();
  const res = await proceeds(env, await mintToken(ADMIN, 'admin'), {});
  assert.equal(res.status, 200);
});

test('settlement requires auth at all', async () => {
  const env = makeEnv();
  const res = await app.request(`/listings/${LISTING}/proceeds`, { method: 'POST', body: '{}' }, env);
  assert.equal(res.status, 401);
});

// ---------- ROFR ----------

test('a listing with no notice on file is NOT clear to transfer', async () => {
  const env = makeEnv();
  const r = await (await req(env, await mintToken(SELLER, 'founder'), `/listings/${LISTING}/rofr`)).json() as any;
  assert.equal(r.status.state, 'not_started');
  assert.equal(r.status.clear_to_transfer, false, 'silence is not permission');
  assert.equal(r.notice, null);
});

test('serving a notice blocks transfer and returns the deadline', async () => {
  const env = makeEnv();
  const token = await mintToken(SELLER, 'founder');
  const saved = await (await req(env, token, `/listings/${LISTING}/rofr`, {
    method: 'PUT',
    // Dated far enough ahead that the window is open whenever this runs.
    body: JSON.stringify({ notice_date: '2099-01-01', window_days: 30 }),
  })).json() as any;
  assert.equal(saved.status.state, 'notice_served');
  assert.equal(saved.status.clear_to_transfer, false);
  assert.equal(saved.status.deadline, '2099-01-31');

  // And it persists — a reload must not lose the notice.
  const reloaded = await (await req(env, token, `/listings/${LISTING}/rofr`)).json() as any;
  assert.equal(reloaded.notice.notice_date, '2099-01-01');
  assert.equal(reloaded.status.state, 'notice_served');
});

test('a waiver frees the block', async () => {
  const env = makeEnv();
  const token = await mintToken(SELLER, 'founder');
  const r = await (await req(env, token, `/listings/${LISTING}/rofr`, {
    method: 'PUT', body: JSON.stringify({ waived: true }),
  })).json() as any;
  assert.equal(r.status.state, 'waived');
  assert.equal(r.status.clear_to_transfer, true);
  assert.equal(r.status.transferable_shares, 10_000);
});

test('elections above the offered block are refused, not silently clamped', async () => {
  const env = makeEnv();
  const res = await req(env, await mintToken(SELLER, 'founder'), `/listings/${LISTING}/rofr`, {
    method: 'PUT',
    body: JSON.stringify({
      notice_date: '2099-01-01', shares_offered: 10_000,
      company_elected: 7_000, investors_elected: 6_000,
    }),
  });
  assert.equal(res.status, 400, 'clamping would hide a data-entry error behind a plausible number');
  const body = await res.json() as any;
  assert.match(body.error, /13000 shares but only 10000/);
});

test('a partial election releases only the remainder', async () => {
  const env = makeEnv();
  const r = await (await req(env, await mintToken(SELLER, 'founder'), `/listings/${LISTING}/rofr`, {
    method: 'PUT',
    body: JSON.stringify({
      notice_date: '2099-01-01', shares_offered: 10_000, company_elected: 4_000,
    }),
  })).json() as any;
  assert.equal(r.status.state, 'partially_exercised');
  assert.equal(r.status.claimed_shares, 4_000);
  assert.equal(r.status.transferable_shares, 6_000);
  assert.equal(r.status.clear_to_transfer, false, 'the window is still open');
});

test('a malformed notice date is refused rather than stored', async () => {
  const env = makeEnv();
  const res = await req(env, await mintToken(SELLER, 'founder'), `/listings/${LISTING}/rofr`, {
    method: 'PUT', body: JSON.stringify({ notice_date: 'next tuesday' }),
  });
  assert.equal(res.status, 400);
});

test('a broker cannot serve or read a ROFR notice either', async () => {
  const env = makeEnv();
  const token = await mintToken(OTHER, 'partner');
  assert.equal((await req(env, token, `/listings/${LISTING}/rofr`)).status, 404);
  assert.equal((await req(env, token, `/listings/${LISTING}/rofr`, {
    method: 'PUT', body: JSON.stringify({ waived: true }),
  })).status, 404);
});

test('the shares offered default to the listing when the caller omits them', async () => {
  // Defaulting to 0 would be the dangerous slip here: a notice recording
  // an empty block reads as "nothing to transfer" during the window and
  // then, once it expires, frees nothing.
  const env = makeEnv();
  const token = await mintToken(SELLER, 'founder');
  await req(env, token, `/listings/${LISTING}/rofr`, {
    method: 'PUT', body: JSON.stringify({ notice_date: '2099-01-01' }),
  });
  const reloaded = await (await req(env, token, `/listings/${LISTING}/rofr`)).json() as any;
  assert.equal(reloaded.notice.shares_offered, 10_000, 'the whole listed block was offered');

  // Proof it carries through: waive it and the full block is released.
  const waived = await (await req(env, token, `/listings/${LISTING}/rofr`, {
    method: 'PUT', body: JSON.stringify({ waived: true }),
  })).json() as any;
  assert.equal(waived.status.transferable_shares, 10_000);
});
