/**
 * #4570 slice 8 (S1 of #4554): venture scorecards, through the mounted routes
 * on the full schema. The ledger's six `unreviewed` routes under
 * `/api/venture-scores`:
 *
 *   GET  /:projectId              the full read  (founder, accepted owner or co-founder, Operating Partner, Admin, an advisor the founder shared it with)
 *   GET  /:projectId/sharing      who sees it    (the venture's founders only)
 *   GET  /:projectId/trajectory   across models  (the venture's founders, Operating Partner, Admin)
 *   GET  /deal/:dealId            an investor's read, through a deal they are on, by the founder's switch and the NDA
 *   POST /:projectId/corrections  ask to correct an input (the venture's founders only)
 *   POST /:projectId/recompute    re-score       (the venture's founders, Operating Partner, Admin)
 *
 * Operating Partners and Admins read every venture's scorecard in full: that
 * is D1256's rule, matching the deal page's, and it is tested here as such.
 *
 * The callers refused: no credentials, another venture's founder, an
 * investor by venture id, an investor off the deal, an advisor the founder
 * did not share with (or whose share is off), a removed co-founder, a roster
 * advisor who is not a founder, and a disabled account. Each refusal names
 * nothing of the venture (no name, score, input or analyst note), writes no
 * score, correction, sharing or read-log row, and the last test runs each
 * rightful party, so each refusal is the gate.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/authz_venture_scores_d4570.test.ts
 *
 * From cloudflare-worker/test/README.md (moved by #6472): `authz_venture_scores_d4570.test.ts`
 * (#4570, D4570 part 8) asks the six venture-scorecard routes (the full read, sharing, trajectory,
 * the investor's deal read, corrections and recompute) through the mounted router on the full
 * schema. Another venture's founder, an advisor with no share or a share switched off, a removed
 * co-founder, a roster advisor, an investor by venture id or off the deal, a disabled founder and
 * no credentials are refused, with nothing of the venture named and no score, correction, sharing
 * or log row changed; each rightful party then gets its read.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import routes from '../src/routes/venture_scores.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { loadSchema } from './_schema_once.mjs';
import { inputKeysOf } from '../src/services/ventureScoring/access.ts';
import { SCOPE_ORDER } from '../src/services/ventureScoring/model.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in the #4570 slice 8 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const SECRET = 'd4570-venture-scores-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.

// The parties. Venture 10 ('Quokka venture', founder entity 20, deal 100) is the record.
const FOUNDER = 1;            // founder entity 20
const COFOUNDER = 2;          // accepted co-founder on venture 10
const SHARED_ADVISOR = 3;     // the founder shared the scorecard with them
const DEAL_INVESTOR = 4;      // invited to deal 100
const OFF_INVESTOR = 5;       // invited to deal 101 only
const PARTNER = 6;            // Operating Partner
const OTHER_FOUNDER = 7;      // founder entity 30, venture 11
const UNSHARED_ADVISOR = 8;   // an advisor on no share
const OFF_ADVISOR = 9;        // the founder's share with them is switched off
const REMOVED_COFOUNDER = 12; // was a co-founder; removed
const ROSTER_ADVISOR = 13;    // on venture 10's roster as an advisor, not a founder
const DISABLED_FOUNDER = 14;  // founder entity 20, but disabled
const ADMIN = 11;

const ROLES: Record<number, string> = {
  [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [SHARED_ADVISOR]: 'advisor', [DEAL_INVESTOR]: 'investor', [OFF_INVESTOR]: 'investor',
  [PARTNER]: 'partner', [OTHER_FOUNDER]: 'founder', [UNSHARED_ADVISOR]: 'advisor', [OFF_ADVISOR]: 'advisor',
  [REMOVED_COFOUNDER]: 'founder', [ROSTER_ADVISOR]: 'advisor', [DISABLED_FOUNDER]: 'founder', [ADMIN]: 'admin',
};
const WHO: Record<number, string> = {
  [OTHER_FOUNDER]: 'another venture\'s founder', [UNSHARED_ADVISOR]: 'an advisor with no share', [OFF_ADVISOR]: 'an advisor whose share is off',
  [REMOVED_COFOUNDER]: 'a removed co-founder', [ROSTER_ADVISOR]: 'a roster advisor', [DEAL_INVESTOR]: 'the deal\'s investor',
  [OFF_INVESTOR]: 'an investor off the deal', [SHARED_ADVISOR]: 'the shared advisor', [PARTNER]: 'an Operating Partner', [ADMIN]: 'an admin',
  [DISABLED_FOUNDER]: 'a disabled founder',
};

// Markers a leak check can find; none is a real person or company.
const NOTE = 'QUOKKA-ANALYST-NOTE';
const LEAKS = ['Quokka', 'quokka', NOTE];

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

function fixture({ investorsOn = true, nda = false }: { investorsOn?: boolean; nda?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
      (${FOUNDER},'f@example.test','Synthetic Founder','founder',20,1),
      (${COFOUNDER},'c@example.test','Synthetic Cofounder','founder',NULL,1),
      (${SHARED_ADVISOR},'a@example.test','Shared Advisor','advisor',NULL,1),
      (${DEAL_INVESTOR},'i@example.test','Deal Investor','investor',NULL,1),
      (${OFF_INVESTOR},'o@example.test','Off Investor','investor',NULL,1),
      (${PARTNER},'p@example.test','Operating Partner','partner',NULL,1),
      (${OTHER_FOUNDER},'of@example.test','Other Founder','founder',30,1),
      (${UNSHARED_ADVISOR},'ua@example.test','Unshared Advisor','advisor',NULL,1),
      (${OFF_ADVISOR},'oa@example.test','Off Advisor','advisor',NULL,1),
      (${REMOVED_COFOUNDER},'rc@example.test','Removed Cofounder','founder',NULL,1),
      (${ROSTER_ADVISOR},'ra@example.test','Roster Advisor','advisor',NULL,1),
      (${DISABLED_FOUNDER},'df@example.test','Disabled Founder','founder',20,0),
      (${ADMIN},'h@example.test','Plain Admin','admin',NULL,1);
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage,sector) VALUES
      (10,'Quokka venture',20,'spinout','seed','build','fintech'),(11,'Elsewhere venture',30,'spinout','seed','build','health');
    INSERT INTO project_members(project_id,user_id,role,status,removed_at) VALUES
      (10,${COFOUNDER},'cofounder','accepted',NULL),(10,${REMOVED_COFOUNDER},'cofounder','accepted','2026-11-01'),
      (10,${ROSTER_ADVISOR},'advisor','accepted',NULL),(10,${SHARED_ADVISOR},'advisor','accepted',NULL);
    INSERT INTO deals(id,project_id,status) VALUES (100,10,'active'),(101,11,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES (100,${DEAL_INVESTOR}),(101,${OFF_INVESTOR});
    INSERT INTO venture_score_sharing(project_id,audience,user_id,enabled,updated_by,updated_at) VALUES
      (10,'advisor',${SHARED_ADVISOR},1,${FOUNDER},'2026-10-26'),(10,'advisor',${OFF_ADVISOR},0,${FOUNDER},'2026-10-26'),
      (10,'investors',0,${investorsOn ? 1 : 0},${FOUNDER},'2026-10-26');
    INSERT INTO venture_risk_overrides(project_id,layer_key,analyst_score,analyst_band,analyst_note,status,updated_by,updated_at)
      VALUES (10,'market',72,NULL,'${NOTE}','open',${PARTNER},'2026-10-20 10:00:00');
    INSERT INTO score_snapshots(project_id,total_score,tier,is_sandbox,created_at) VALUES (10,91,'A',0,'2026-10-01'),(11,88,'A',0,'2026-10-01');`);
  if (nda) db.exec(`INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES (${FOUNDER},${DEAL_INVESTOR},'active')`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono().route('/api/venture-scores', routes);
  app.onError((e, c) => (e instanceof Response ? e : mapError(c as any, e)));
  const call = async (who: number | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who != null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: ROLES[who] }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const res = await app.request(`/api/venture-scores${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }, env)
      .catch((e) => { if (e instanceof Response) return e; throw e; });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, json };
  };
  // Everything a refused scorecard route could have changed: scores, reviews, corrections, sharing, and the read log.
  const snapshot = () => JSON.stringify(['venture_scores', 'venture_score_corrections', 'venture_score_sharing', 'venture_score_reviews', 'activity_logs']
    .map((t) => { try { return db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(); } catch { return `no ${t}`; } }));
  return { db, env, call, snapshot };
}

const named = (r: { text: string }) => LEAKS.filter((l) => r.text.includes(l));

// A correction the venture's founders may ask: a real scope and input, so a refusal is the gate, never the body.
const SCOPE = SCOPE_ORDER.find((s) => inputKeysOf(s as any).length >= 2)!;
const correction = (i = 0) => ({ scope: SCOPE, input_key: inputKeysOf(SCOPE as any)[i], message: 'This input is out of date; the newer figure is in the deck.' });

const ROUTES = {
  read: (p: number | string) => ['GET', `/${p}`] as const,
  sharing: (p: number | string) => ['GET', `/${p}/sharing`] as const,
  trajectory: (p: number | string) => ['GET', `/${p}/trajectory`] as const,
  corrections: (p: number | string) => ['POST', `/${p}/corrections`] as const,
  recompute: (p: number | string) => ['POST', `/${p}/recompute`] as const,
};

/** The callers each route refuses on venture 10, with the status it gives them. */
const REFUSED: Record<keyof typeof ROUTES, number[]> = {
  read: [OTHER_FOUNDER, UNSHARED_ADVISOR, OFF_ADVISOR, REMOVED_COFOUNDER, ROSTER_ADVISOR, DEAL_INVESTOR, OFF_INVESTOR],
  sharing: [OTHER_FOUNDER, SHARED_ADVISOR, REMOVED_COFOUNDER, ROSTER_ADVISOR, DEAL_INVESTOR, PARTNER, ADMIN],
  trajectory: [OTHER_FOUNDER, SHARED_ADVISOR, UNSHARED_ADVISOR, REMOVED_COFOUNDER, ROSTER_ADVISOR, DEAL_INVESTOR],
  corrections: [OTHER_FOUNDER, SHARED_ADVISOR, REMOVED_COFOUNDER, ROSTER_ADVISOR, DEAL_INVESTOR, PARTNER, ADMIN],
  recompute: [OTHER_FOUNDER, SHARED_ADVISOR, UNSHARED_ADVISOR, REMOVED_COFOUNDER, ROSTER_ADVISOR, DEAL_INVESTOR],
};

test('#4570 slice 8: every venture route refuses the wrong party with 403, names nothing, and changes nothing', async () => {
  const f = fixture();
  for (const [key, callers] of Object.entries(REFUSED) as [keyof typeof ROUTES, number[]][]) {
    for (const who of callers) {
      const before = f.snapshot();
      const [method, path] = ROUTES[key](10);
      const r = await f.call(who, method, path, key === 'corrections' ? correction() : undefined);
      assert.equal(r.status, 403, `${key}: ${WHO[who]} got ${r.status}`);
      assert.deepEqual(named(r), [], `${key}: ${WHO[who]}'s refusal names the venture`);
      assert.equal(f.snapshot(), before, `${key}: ${WHO[who]}'s refusal changed a row`);
    }
  }
});

test('#4570 slice 8: no credentials and a disabled account are refused before any read', async () => {
  const f = fixture();
  const before = f.snapshot();
  for (const key of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
    const [method, path] = ROUTES[key](10);
    for (const who of [null, DISABLED_FOUNDER]) {
      const r = await f.call(who, method, path);
      assert.equal(r.status, 401, `${key}: ${who == null ? 'no credentials' : 'a disabled founder'} got ${r.status}`);
      assert.deepEqual(named(r), []);
    }
  }
  for (const who of [null, DISABLED_FOUNDER]) assert.equal((await f.call(who, 'GET', '/deal/100')).status, 401);
  assert.equal(f.snapshot(), before);
});

test('#4570 slice 8: an investor reads only through a deal they are on, by the founder\'s switch, masked before the NDA', async () => {
  const on = fixture();
  const off = await on.call(OFF_INVESTOR, 'GET', '/deal/100');
  assert.deepEqual([off.status, off.json?.error], [403, 'not_on_deal']);
  assert.deepEqual(named(off), []);
  const byId = await on.call(DEAL_INVESTOR, 'GET', '/10');
  assert.deepEqual([byId.status, byId.json?.error], [403, 'read_through_deal']);
  const masked = await on.call(DEAL_INVESTOR, 'GET', '/deal/100');
  assert.equal(masked.status, 200);
  assert.deepEqual([masked.json.locked, masked.json.nda], [false, false]);
  assert.doesNotMatch(masked.text, new RegExp(NOTE), 'no analyst note to an investor');
  const locked = await fixture({ investorsOn: false }).call(DEAL_INVESTOR, 'GET', '/deal/100');
  assert.deepEqual([locked.status, locked.json.locked, locked.json.scopes], [200, true, undefined], 'the founder\'s switch is off: no scopes');
  const signed = await fixture({ nda: true }).call(DEAL_INVESTOR, 'GET', '/deal/100');
  assert.deepEqual([signed.status, signed.json.nda], [200, true], 'the NDA opens the inputs');
  assert.doesNotMatch(signed.text, new RegExp(NOTE), 'not even after the NDA');
  // Another founder asking by this venture's deal is refused the same way as by its id.
  const viaDeal = await on.call(OTHER_FOUNDER, 'GET', '/deal/100');
  assert.deepEqual([viaDeal.status, named(viaDeal)], [403, []]);
});

test('#4570 slice 8: an unknown venture or deal is 404, and a malformed id never reaches SQL as text', async () => {
  const f = fixture();
  for (const key of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
    for (const p of [999, "10' OR 1=1--", -1, '1e3']) {
      const [method, path] = ROUTES[key](encodeURIComponent(String(p)));
      assert.equal((await f.call(FOUNDER, method, path)).status, 404, `${key} ${p}`);
    }
  }
  assert.equal((await f.call(DEAL_INVESTOR, 'GET', '/deal/999')).status, 404);
});

test('#4570 slice 8: each rightful party is let through, so every refusal above is the gate', async () => {
  const f = fixture();
  const ok = async (who: number, key: keyof typeof ROUTES, status = 200, body?: unknown) => {
    const [method, path] = ROUTES[key](10);
    const r = await f.call(who, method, path, body);
    assert.equal(r.status, status, `${key}: ${WHO[who] ?? who} got ${r.status} ${r.text.slice(0, 160)}`);
    return r;
  };
  for (const who of [FOUNDER, COFOUNDER, PARTNER, ADMIN]) await ok(who, 'read');
  const advisor = await ok(SHARED_ADVISOR, 'read');
  assert.equal(advisor.json.read_only, true);
  assert.doesNotMatch(advisor.text, new RegExp(NOTE), 'the shared advisor gets no analyst note');
  const staff = await ok(PARTNER, 'read');
  assert.match(staff.text, new RegExp(NOTE), 'staff read the analyst note (D1256, D1260)');
  for (const who of [FOUNDER, COFOUNDER]) await ok(who, 'sharing');
  for (const who of [FOUNDER, COFOUNDER, PARTNER, ADMIN]) await ok(who, 'trajectory');
  for (const who of [FOUNDER, COFOUNDER, PARTNER, ADMIN]) await ok(who, 'recompute');
  await ok(FOUNDER, 'corrections', 201, correction(0));
  await ok(COFOUNDER, 'corrections', 201, correction(1));
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM venture_score_corrections WHERE project_id = 10').get() as any).n, 2);
  // A staff or advisor read is logged; the founder's own is not.
  const logs = f.db.prepare("SELECT user_id FROM activity_logs WHERE action = 'venture_score_read' ORDER BY id").all().map((r: any) => r.user_id);
  assert.ok(logs.includes(PARTNER) && logs.includes(ADMIN) && logs.includes(SHARED_ADVISOR));
  assert.ok(!logs.includes(FOUNDER));
});
