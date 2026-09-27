/**
 * The Perks Worker test harness, shared by the D412 and D413 suites.
 *
 * The schema is BUILT from the migrations that ship — 186, 198, 228 and 322,
 * read off disk — so a test that passes is a test of the tables production
 * has. The D1 shim runs a batch as one transaction, as D1 does, and a
 * `beforeBatch` hook lets a test land a competing write between a route's read
 * and its batch.
 */
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import perks from '../src/routes/perks.ts';

export const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
export const MIG = (n: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', n), 'utf8');

export const FOUNDER = 1, FOUNDER_B = 2, FREE_FOUNDER = 3, PARTNER = 10, OTHER_PARTNER = 11,
  INVESTOR = 20, ADVISOR = 21, ADMIN = 22, EXPLORING = 23;
export const ROLE: Record<number, string> = {
  [FOUNDER]: 'founder', [FOUNDER_B]: 'founder', [FREE_FOUNDER]: 'founder', [PARTNER]: 'partner',
  [OTHER_PARTNER]: 'partner', [INVESTOR]: 'investor', [ADVISOR]: 'advisor', [ADMIN]: 'admin', [EXPLORING]: 'exploring',
};

export function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
export type Hook = ((db: InstanceType<typeof DatabaseSync>) => void) | null;
export function makeD1(db: InstanceType<typeof DatabaseSync>, hooks: { beforeBatch: Hook }) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      sql,
      bind: (...x: any[]) => { b = coerce(x); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // D1 runs a batch as one transaction; so does this. The hook runs first,
    // outside it — the competing request that committed a moment earlier.
    async batch(x: any[]) {
      if (hooks.beforeBatch) { const h = hooks.beforeBatch; hooks.beforeBatch = null; h(db); }
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of x || []) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

export function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      subscription_tier TEXT, subscription_status TEXT
    );
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL, is_primary_admin INTEGER, created_at TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
  `);
  for (const m of ['186_perks.sql', '198_perk_company.sql', '228_perk_lifecycle_and_grant.sql', '322_perk_value_editorial_redemption_ratings.sql']) {
    db.exec(MIG(m));
  }
  const u = db.prepare('INSERT INTO users (id, role, email, subscription_tier) VALUES (?,?,?,?)');
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, `u${id}@example.test`, Number(id) === FREE_FOUNDER ? 'free' : 'growth');
  return db;
}

export const TODAY = new Date().toISOString().slice(0, 10);
export const day = (offset: number) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

export function addPerk(db: any, uid: string, o: Record<string, any> = {}) {
  const row = {
    partner_user_id: PARTNER, partner_name: 'Acme', category: 'Banking', offer: `Offer ${uid}`,
    kind: 'credits', credits: 0, required_tier: null, fulfilment: 'code', claim_cap: null,
    status: 'live', ends_at: null, value_cents: null, featured: 0, editorial_note: null, ...o,
  };
  db.prepare(`INSERT INTO perks (uid, partner_user_id, partner_name, category, offer, kind, credits, required_tier,
                                 fulfilment, claim_cap, status, ends_at, value_cents, featured, editorial_note)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uid, row.partner_user_id, row.partner_name, row.category, row.offer, row.kind, row.credits, row.required_tier,
    row.fulfilment, row.claim_cap, row.status, row.ends_at, row.value_cents, row.featured, row.editorial_note,
  );
}
export const grant = (db: any, userId: number, delta: number) =>
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref) VALUES (?, ?, 'grant', ?)`)
    .run(userId, delta, `test:${userId}:${Math.random()}`);
export const balance = (db: any, userId: number) =>
  Number(db.prepare('SELECT COALESCE(SUM(delta),0) AS b FROM perk_credit_ledger WHERE user_id = ?').get(userId).b);
export const claims = (db: any) => db.prepare('SELECT * FROM perk_claims ORDER BY id').all();

export async function token(userId: number) {
  return new SignJWT({ user_id: userId, role: ROLE[userId] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
export function harness() {
  const db = freshDb();
  const hooks: { beforeBatch: Hook } = { beforeBatch: null };
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, hooks) };
  const call = async (method: string, path: string, who: number, body?: any) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token(who)}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
    const res = await perks.request(path, init, env);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { db, hooks, call };
}

