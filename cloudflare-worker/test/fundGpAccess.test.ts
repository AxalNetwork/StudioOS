/**
 * requireFundGp — the gate that replaced requireAdmin on the fund controls.
 *
 * These routes include capital calls and distribution execution, so the tests
 * here are about what must be IMPOSSIBLE rather than what works: a GP reaching
 * another GP's fund, a professional-tier account reaching any fund, and an
 * unowned legacy fund becoming writable by anyone who upgrades.
 *
 * D1 is stubbed to the smallest thing that answers the one query the helper
 * makes, so the assertions are about the helper's logic and not about SQLite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/** Answers the one ownership query the helper makes, from a fixture. */
function stubDb(funds: Array<Record<string, any>>) {
  return {
    DB: {
      prepare(_sql: string) {
        return {
          bind(...binds: any[]) {
            return {
              async first() {
                // Mimic the real clause: id must match, and when the scope
                // carries a gp bind, gp_user_id must equal it.
                const [id, gp] = binds;
                return funds.find((f) =>
                  f.id === id && (gp === undefined || f.gp_user_id === gp)) ?? null;
              },
            };
          },
        };
      },
    },
  };
}

// requireFundGp itself needs a live request for requireAuth/getCurrentUser,
// which is out of reach here. Its DECISIONS are what matter and they are all
// reachable: the scope clause it composes, exercised against the stub above,
// and the shape of its refusals, asserted against its source further down.
import { fundGpScope } from '../src/services/tenancyScope.ts';

test('the ownership query binds the caller, so it cannot match another GP', () => {
  const gpA = fundGpScope({ id: 11, role: 'investor' });
  const gpB = fundGpScope({ id: 22, role: 'investor' });
  assert.deepEqual(gpA.binds, [11]);
  assert.deepEqual(gpB.binds, [22]);
  assert.notDeepEqual(gpA.binds, gpB.binds, 'two GPs must never resolve the same rows');
});

test('an unowned legacy fund is unreachable by any non-admin', async () => {
  const db = stubDb([{ id: 7, gp_user_id: null, name: 'Legacy Fund I' }]);
  const scope = fundGpScope({ id: 99, role: 'investor' });
  const row = await db.DB.prepare(`SELECT f.* FROM vc_funds f WHERE f.id = ? AND ${scope.sql}`)
    .bind(7, ...scope.binds).first();
  assert.equal(row, null, 'gp_user_id NULL must not match any user id');
});

test('an admin resolves the same fund without an ownership bind', async () => {
  const db = stubDb([{ id: 7, gp_user_id: null, name: 'Legacy Fund I' }]);
  const scope = fundGpScope({ id: 1, role: 'admin' });
  assert.deepEqual(scope.binds, [], 'admin carries no ownership bind');
  const row: any = await db.DB.prepare(`SELECT f.* FROM vc_funds f WHERE f.id = ? AND ${scope.sql}`)
    .bind(7, ...scope.binds).first();
  assert.equal(row?.id, 7, 'admin still administers an unowned fund');
});

test('the GP of record reaches their own fund and no other', async () => {
  const db = stubDb([
    { id: 1, gp_user_id: 11, name: 'Fund A' },
    { id: 2, gp_user_id: 22, name: 'Fund B' },
  ]);
  const scope = fundGpScope({ id: 11, role: 'investor' });
  const mine: any = await db.DB.prepare(`x ${scope.sql}`).bind(1, ...scope.binds).first();
  const theirs: any = await db.DB.prepare(`x ${scope.sql}`).bind(2, ...scope.binds).first();
  assert.equal(mine?.name, 'Fund A');
  assert.equal(theirs, null, "another GP's fund must be invisible");
});

// ---------- the shape of the refusals ----------

const src = (await import('node:fs')).readFileSync(
  (await import('node:path')).resolve(process.cwd(), 'cloudflare-worker/src/services/fundGpAccess.ts'), 'utf8');

test('tier is checked before ownership, so ownership is not an id oracle', () => {
  const tierAt = src.indexOf('ensureInvestorTier');
  const ownAt = src.indexOf('fundGpScope(');
  assert.ok(tierAt > 0 && ownAt > 0 && tierAt < ownAt,
    'a sub-tier caller must get 402 for every id, existing or not');
});

test('a fund that is absent and a fund that is someone else\'s are indistinguishable', () => {
  // Two call sites, one body. A distinct message for "exists but not yours"
  // would count the platform's funds on a sequential id.
  assert.equal((src.match(/throw notFound\(\)/g) || []).length, 2);
  assert.equal((src.match(/'Fund not found'/g) || []).length, 1);
  assert.doesNotMatch(src, /status: 403/);
});

test('the institutional tier is the one required, and admins skip it', () => {
  assert.match(src, /ensureInvestorTier\(user as any, 'institutional'\)/);
  assert.match(src, /if \(!viaAdmin\) ensureInvestorTier/);
});

test('fund creation gates on tier but cannot gate on ownership', () => {
  // POST /funds has no fund yet; requiring ownership would make it uncallable.
  assert.match(src, /export async function requireFundCreator/);
  const creator = src.slice(src.indexOf('export async function requireFundCreator'));
  assert.match(creator, /ensureInvestorTier/, 'still tier-gated');
  assert.doesNotMatch(creator.slice(0, 400), /fundGpScope/, 'but not ownership-gated');
});
