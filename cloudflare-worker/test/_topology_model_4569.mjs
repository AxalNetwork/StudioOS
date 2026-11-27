/**
 * D4569 (#4569) — the synthetic topology model for options A and D: a test of
 * the design in `documentation/architecture/decisions/D4569.md`, never
 * production code. Nothing here is imported by `cloudflare-worker/src`, and it
 * adds no router, scheduler, ledger or binding: every "database" is an
 * in-memory node:sqlite handle, and every table carries a `poc_` prefix so it
 * can never be mistaken for a real one.
 *
 * WHAT IT MODELS.
 *   · Option A: one database holds identity, agents, runs and every member's
 *     balance home. A run's usage reference is written in the same batch as
 *     its settlement.
 *   · Option D: a core database (identity, agents, runs, the directory) and N
 *     balance-home partitions. A member's balance, holds, ledger and usage
 *     live in exactly one partition (D4569 §3, keyed by the payer), found
 *     through the directory, guarded in the partition by a home marker
 *     (§6.3), and told to core through an outbox and a conditional follower
 *     write (§7 Rules 2 and 3).
 *
 * The money statements copy the shape of the real ones, not their text:
 * `holdStatement`'s conditional insert (`aiBudget.ts:386-414`), the
 * compare-and-set settlement whose every other statement is guarded by
 * `EXISTS(… settlement_uid = token)` (`aiBudget.ts:186-216`), the unique
 * `(user_id, idempotency_key)` hold (migration 525), the append-only ledger
 * with `UNIQUE (kind, source_ref)` (migration 486).
 *
 * GUARDS. Each protective clause is behind a flag in `DEFAULT_GUARDS`, so a
 * test can switch one off and show that `checkInvariants` catches the fault.
 * Those flags exist for the mutation checks only; the model's normal state is
 * every guard on.
 *
 * Every value reaches SQL as a bound parameter; every list read is LIMITed by
 * a bound bound. Faults are injected per database: `down` (every call throws),
 * a batch that fails part-way (rolled back whole, as D1's batch is a
 * transaction), and a batch that commits but answers with an error (the lost
 * acknowledgement the D1 debug page warns of).
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export const DEFAULT_GUARDS = Object.freeze({
  balance: true,          // the hold refuses what the balance cannot cover; CHECK(balance >= 0)
  idempotency: true,      // UNIQUE (user_id, idempotency_key) on holds
  settleCas: true,        // the settlement's status = 'pending' compare-and-set
  attribution: true,      // the usage insert is guarded by the settlement token and UNIQUE (execution_key)
  marker: true,           // debits and credits require the home marker active at the version read
  payerKeyed: true,       // the sponsor pays, never the member who started the run
  capAllPartitions: true, // the agent cap sums every partition its payers used this month
  relayApplyFirst: true,  // the relay applies the follower write, then marks the outbox row delivered
  relayConditional: true, // the follower write changes only a run with no usage reference yet
});

export const MONTH = '2026-11';
const LIST_LIMIT = 100000;

export class DbUnavailable extends Error { constructor(name) { super(`D1_ERROR: ${name} unavailable`); this.code = 'unavailable'; } }
export class InjectedFault extends Error { constructor(name, tag) { super(`injected fault in ${name} (${tag})`); this.code = 'injected'; } }
export class LostAck extends Error { constructor(name, tag) { super(`${name} committed ${tag} but the answer was lost`); this.code = 'lost_ack'; } }

/** Let other in-flight operations run between two database calls, as separate requests would. */
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** One database: a node:sqlite handle with statement metering and fault injection. */
class ModelDb {
  constructor(name, ddl) {
    this.name = name;
    this.db = new DatabaseSync(':memory:');
    this.db.exec(ddl);
    this.down = false;
    this.faults = [];
    this.stats = { statements: 0, roundTrips: 0, batches: 0, moneyStatements: 0 };
  }
  inject(fault) { this.faults.push({ times: 1, ...fault }); }
  #take(tag) {
    const i = this.faults.findIndex((f) => f.tag === tag && f.times > 0);
    if (i < 0) return null;
    const f = this.faults[i];
    f.times -= 1;
    if (f.times === 0) this.faults.splice(i, 1);
    return f;
  }
  async #enter(tag) {
    await turn();
    if (this.down) throw new DbUnavailable(this.name);
    const f = this.#take(tag);
    if (f?.kind === 'unavailable') throw new DbUnavailable(this.name);
    this.stats.roundTrips += 1;
    return f;
  }
  async get(tag, sql, ...binds) { await this.#enter(tag); this.stats.statements += 1; return this.db.prepare(sql).get(...binds) ?? null; }
  async all(tag, sql, ...binds) { await this.#enter(tag); this.stats.statements += 1; return this.db.prepare(sql).all(...binds); }
  async run(tag, sql, ...binds) { await this.#enter(tag); this.stats.statements += 1; return Number(this.db.prepare(sql).run(...binds).changes); }
  /** A batch is one transaction: it commits whole or rolls back whole. */
  async batch(tag, statements, { money = false } = {}) {
    const fault = await this.#enter(tag);
    this.stats.batches += 1;
    this.stats.statements += statements.length;
    if (money) this.stats.moneyStatements += statements.length;
    const changes = [];
    this.db.exec('BEGIN');
    try {
      statements.forEach(([sql, binds], i) => {
        if (fault?.kind === 'fail-mid' && i === (fault.at ?? 1)) throw new InjectedFault(this.name, tag);
        changes.push(Number(this.db.prepare(sql).run(...binds).changes));
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    if (fault?.kind === 'commit-then-throw') throw new LostAck(this.name, tag);
    return changes;
  }
}

const CORE_DDL = `
CREATE TABLE poc_members (id INTEGER PRIMARY KEY);
CREATE TABLE poc_memberships (user_id INTEGER NOT NULL, company_id INTEGER NOT NULL, PRIMARY KEY (user_id, company_id));
CREATE TABLE poc_agents (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, sponsor_user_id INTEGER NOT NULL, cap INTEGER NOT NULL);
CREATE TABLE poc_agent_payers (agent_id INTEGER NOT NULL, month TEXT NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (agent_id, month, user_id));
CREATE TABLE poc_directory (user_id INTEGER PRIMARY KEY, partition INTEGER NOT NULL, version INTEGER NOT NULL);
CREATE TABLE poc_runs (uid TEXT PRIMARY KEY, agent_id INTEGER NOT NULL, company_id INTEGER NOT NULL, payer_user_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('live','done','failed')), usage_ref TEXT);
CREATE UNIQUE INDEX poc_runs_live ON poc_runs(agent_id) WHERE status = 'live';
`;

function homeDdl(g) {
  return `
CREATE TABLE poc_accounts (user_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL ${g.balance ? 'CHECK (balance >= 0)' : ''});
CREATE TABLE poc_home_markers (user_id INTEGER PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('active','frozen','moved')));
CREATE TABLE poc_reservations (uid TEXT PRIMARY KEY, user_id INTEGER NOT NULL, idempotency_key TEXT, execution_key TEXT NOT NULL,
  agent_id INTEGER NOT NULL, held INTEGER NOT NULL CHECK (held > 0), hold_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','refunded')), settlement_uid TEXT UNIQUE, charged INTEGER);
${g.idempotency ? 'CREATE UNIQUE INDEX poc_res_idem ON poc_reservations(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;' : ''}
CREATE TABLE poc_ledger (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('purchase','hold','release','spend')),
  delta INTEGER NOT NULL, source_ref TEXT NOT NULL, token TEXT, UNIQUE (kind, source_ref));
CREATE TRIGGER poc_ledger_no_update BEFORE UPDATE ON poc_ledger BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER poc_ledger_no_delete BEFORE DELETE ON poc_ledger BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE poc_usage (id INTEGER PRIMARY KEY, uid TEXT NOT NULL, execution_key TEXT NOT NULL ${g.attribution ? 'UNIQUE' : ''},
  user_id INTEGER NOT NULL, agent_id INTEGER NOT NULL, company_id INTEGER NOT NULL, reservation_uid TEXT NOT NULL, charged INTEGER NOT NULL, month TEXT NOT NULL);
CREATE INDEX poc_usage_agent ON poc_usage(agent_id, month);
CREATE TABLE poc_outbox (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, target_uid TEXT NOT NULL, source_key TEXT NOT NULL,
  usage_ref TEXT, legacy_ref TEXT, delivered INTEGER NOT NULL DEFAULT 0, UNIQUE (target_uid, source_key));
`;
}

/** The rows a member's balance home holds, in key order: the copy check and the post-move snapshot hash them. */
const HOME_TABLES = [
  ['poc_accounts', 'SELECT user_id, balance FROM poc_accounts WHERE user_id = ? ORDER BY user_id LIMIT ?'],
  ['poc_reservations', 'SELECT uid, user_id, idempotency_key, execution_key, agent_id, held, hold_token, status, settlement_uid, charged FROM poc_reservations WHERE user_id = ? ORDER BY uid LIMIT ?'],
  ['poc_ledger', 'SELECT user_id, kind, delta, source_ref, token FROM poc_ledger WHERE user_id = ? ORDER BY kind, source_ref LIMIT ?'],
  ['poc_usage', 'SELECT uid, execution_key, user_id, agent_id, company_id, reservation_uid, charged, month FROM poc_usage WHERE user_id = ? ORDER BY uid LIMIT ?'],
];
const COPY_SQL = {
  poc_accounts: 'INSERT INTO poc_accounts (user_id, balance) VALUES (?, ?)',
  poc_reservations: 'INSERT INTO poc_reservations (uid, user_id, idempotency_key, execution_key, agent_id, held, hold_token, status, settlement_uid, charged) VALUES (?,?,?,?,?,?,?,?,?,?)',
  poc_ledger: 'INSERT INTO poc_ledger (user_id, kind, delta, source_ref, token) VALUES (?,?,?,?,?)',
  poc_usage: 'INSERT INTO poc_usage (uid, execution_key, user_id, agent_id, company_id, reservation_uid, charged, month) VALUES (?,?,?,?,?,?,?,?)',
};

function hashRows(rows) {
  const h = createHash('sha256');
  for (const r of rows) h.update(JSON.stringify(Object.values(r))).update('\n');
  return h.digest('hex');
}
function memberRowsRaw(db, userId) {
  const out = {};
  for (const [table, sql] of HOME_TABLES) out[table] = db.prepare(sql).all(userId, LIST_LIMIT);
  return out;
}

/**
 * Build a topology. `option` 'A' gives one database; 'D' gives a core plus
 * `partitions` balance homes. `guards` overrides `DEFAULT_GUARDS`.
 */
export function createTopology({ option = 'A', partitions = 16, guards = {} } = {}) {
  const g = { ...DEFAULT_GUARDS, ...guards };
  const n = option === 'A' ? 1 : partitions;
  const core = new ModelDb('core', option === 'A' ? CORE_DDL + homeDdl(g) : CORE_DDL);
  const homes = option === 'A' ? [core] : Array.from({ length: n }, (_, i) => new ModelDb(`p${i}`, homeDdl(g)));
  const t = {
    option, guards: g, core, homes,
    movedSnapshots: [],          // { userId, partition, hash } taken when a home is left
    initial: new Map(),          // userId → seeded balance
    seq: 0,
    stats() {
      const all = option === 'A' ? [core] : [core, ...homes];
      const sum = (k) => all.reduce((s, d) => s + d.stats[k], 0);
      return { statements: sum('statements'), roundTrips: sum('roundTrips'), batches: sum('batches'),
        moneyByHome: homes.map((d) => d.stats.moneyStatements) };
    },
    resetStats() { for (const d of new Set([core, ...homes])) d.stats = { statements: 0, roundTrips: 0, batches: 0, moneyStatements: 0 }; },
  };
  return t;
}

/** Seed members, companies, memberships and agents. Directory assignment is `id mod N` unless `homeOf` says otherwise. */
export function seed(t, { members = [], memberships = [], agents = [], homeOf = (id) => id % t.homes.length }) {
  const c = t.core.db;
  for (const m of members) {
    const p = t.option === 'A' ? 0 : homeOf(m.id);
    c.prepare('INSERT INTO poc_members (id) VALUES (?)').run(m.id);
    c.prepare('INSERT INTO poc_directory (user_id, partition, version) VALUES (?, ?, 1)').run(m.id, p);
    const h = t.homes[p].db;
    h.prepare('INSERT INTO poc_accounts (user_id, balance) VALUES (?, ?)').run(m.id, m.balance);
    h.prepare("INSERT INTO poc_home_markers (user_id, version, state) VALUES (?, 1, 'active')").run(m.id);
    h.prepare("INSERT INTO poc_ledger (user_id, kind, delta, source_ref) VALUES (?, 'purchase', ?, ?)").run(m.id, m.balance, `seed:${m.id}`);
    t.initial.set(m.id, m.balance);
  }
  for (const [userId, companyId] of memberships) c.prepare('INSERT INTO poc_memberships (user_id, company_id) VALUES (?, ?)').run(userId, companyId);
  for (const a of agents) {
    c.prepare('INSERT INTO poc_agents (id, company_id, sponsor_user_id, cap) VALUES (?, ?, ?, ?)').run(a.id, a.companyId, a.sponsor, a.cap ?? 1e12);
    c.prepare('INSERT INTO poc_agent_payers (agent_id, month, user_id) VALUES (?, ?, ?)').run(a.id, MONTH, a.sponsor);
  }
}

/** A Worker isolate: what it may cache across requests is exactly what §6.3 forbids, so a test can make it stale. */
export function worker() { return { cache: new Map() }; }

async function route(t, userId, w) {
  if (t.option === 'A') return { partition: 0, version: 1 };
  const cached = w?.cache.get(userId);
  if (cached) return cached;
  const row = await t.core.get('directory', 'SELECT partition, version FROM poc_directory WHERE user_id = ?', userId);
  if (!row) throw new Error('no directory entry');
  const r = { partition: Number(row.partition), version: Number(row.version) };
  w?.cache.set(userId, r);
  return r;
}

/** The agent's month spend over every partition its payers used; null when any is unreadable (never 0). */
export async function monthSpend(t, agentId, { w } = {}) {
  try {
    const agent = await t.core.get('agent', 'SELECT sponsor_user_id FROM poc_agents WHERE id = ?', agentId);
    const payers = t.guards.capAllPartitions
      ? (await t.core.all('payers', 'SELECT user_id FROM poc_agent_payers WHERE agent_id = ? AND month = ? ORDER BY user_id LIMIT ?', agentId, MONTH, 1000)).map((r) => Number(r.user_id))
      : [Number(agent.sponsor_user_id)];
    const homes = new Set();
    for (const u of payers) homes.add((await route(t, u, w)).partition);
    let sum = 0;
    for (const p of homes) {
      const row = await t.homes[p].get('cap', 'SELECT COALESCE(SUM(charged), 0) AS s FROM poc_usage WHERE agent_id = ? AND month = ?', agentId, MONTH);
      sum += Number(row.s);
    }
    return sum;
  } catch (err) {
    if (err instanceof DbUnavailable) return null;
    throw err;
  }
}

/** §7 Rule 1: the hold, its debit and its ledger row in one batch at the payer's home, guarded by the marker. */
async function hold(t, home, { userId, key, execKey, agentId, amount }) {
  const db = t.homes[home.partition];
  const uid = `res:${randomUUID()}`;
  const token = randomUUID();
  const conds = [];
  const binds = [uid, userId, key, execKey, agentId, amount, token];
  if (t.guards.marker) { conds.push("EXISTS (SELECT 1 FROM poc_home_markers WHERE user_id = ? AND version = ? AND state = 'active')"); binds.push(userId, home.version); }
  if (t.guards.balance) { conds.push('EXISTS (SELECT 1 FROM poc_accounts WHERE user_id = ? AND balance >= ?)'); binds.push(userId, amount); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const [inserted] = await db.batch('hold', [
    [`INSERT OR IGNORE INTO poc_reservations (uid, user_id, idempotency_key, execution_key, agent_id, held, hold_token) SELECT ?, ?, ?, ?, ?, ?, ? ${where}`, binds],
    ['UPDATE poc_accounts SET balance = balance - ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM poc_reservations WHERE uid = ? AND hold_token = ?)', [amount, userId, uid, token]],
    ["INSERT OR IGNORE INTO poc_ledger (user_id, kind, delta, source_ref) SELECT ?, 'hold', ?, ? WHERE EXISTS (SELECT 1 FROM poc_reservations WHERE uid = ? AND hold_token = ?)", [userId, -amount, uid, uid, token]],
  ], { money: true });
  if (inserted === 1) return { status: 'held', uid };
  if (key !== null) {
    const prior = await db.get('held-under', 'SELECT uid, status FROM poc_reservations WHERE user_id = ? AND idempotency_key = ?', userId, key);
    if (prior) return { status: 'held', uid: prior.uid, replay: true };
  }
  if (t.guards.marker) {
    const m = await db.get('marker', 'SELECT version, state FROM poc_home_markers WHERE user_id = ?', userId);
    if (!m || m.state !== 'active' || Number(m.version) !== home.version) return { status: 'stale' };
  }
  return { status: 'refused', reason: 'insufficient' };
}

/**
 * The settlement: compare-and-set on the hold, every other statement guarded
 * by the token, the usage row in the same batch (one attribution per
 * execution), and either the follower write (A, same database) or an outbox
 * row (D). Returns once the hold is no longer pending.
 */
async function settle(t, partition, res, { cost, refund = false, run }) {
  const db = t.homes[partition];
  const token = randomUUID();
  const charged = refund ? 0 : cost;
  const tokenGuard = 'EXISTS (SELECT 1 FROM poc_reservations WHERE uid = ? AND settlement_uid = ?)';
  const stmts = [
    [`UPDATE poc_reservations SET status = ?, settlement_uid = ?, charged = ? WHERE uid = ? ${t.guards.settleCas ? "AND status = 'pending'" : ''}`,
      [refund ? 'refunded' : 'settled', token, charged, res.uid]],
    [`UPDATE poc_accounts SET balance = balance + (SELECT held FROM poc_reservations WHERE uid = ?) - ? WHERE user_id = ? AND ${tokenGuard}`,
      [res.uid, charged, res.userId, res.uid, token]],
    [`INSERT OR IGNORE INTO poc_ledger (user_id, kind, delta, source_ref) SELECT ?, 'release', held, uid FROM poc_reservations WHERE uid = ? AND settlement_uid = ?`,
      [res.userId, res.uid, token]],
  ];
  if (charged > 0) {
    stmts.push([`INSERT OR IGNORE INTO poc_ledger (user_id, kind, delta, source_ref) SELECT ?, 'spend', ?, ? WHERE ${tokenGuard}`, [res.userId, -charged, res.uid, res.uid, token]]);
    const usageUid = `use:${res.execKey}`;
    stmts.push([`INSERT OR IGNORE INTO poc_usage (uid, execution_key, user_id, agent_id, company_id, reservation_uid, charged, month)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? ${t.guards.attribution ? `WHERE ${tokenGuard}` : ''}`,
      [usageUid, res.execKey, res.userId, run.agentId, run.companyId, res.uid, charged, MONTH, ...(t.guards.attribution ? [res.uid, token] : [])]]);
    if (t.option === 'A') {
      stmts.push([`UPDATE poc_runs SET usage_ref = ?, status = 'done' WHERE uid = ? AND usage_ref IS NULL AND ${tokenGuard}`, [usageUid, run.uid, res.uid, token]]);
    } else {
      stmts.push([`INSERT OR IGNORE INTO poc_outbox (user_id, target_uid, source_key, usage_ref, legacy_ref)
        SELECT ?, ?, ?, ?, ? || (SELECT id FROM poc_usage WHERE execution_key = ? ORDER BY id LIMIT 1) WHERE ${tokenGuard}`,
        [res.userId, run.uid, res.execKey, usageUid, `p${partition}:`, res.execKey, res.uid, token]]);
    }
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await db.batch('settle', stmts, { money: true });
      return { status: 'settled' };
    } catch (err) {
      if (!(err instanceof InjectedFault || err instanceof LostAck || err instanceof DbUnavailable)) throw err;
      // The answer is unknown: read the hold before trying again (aiBudget.ts:222).
      try {
        const row = await db.get('settle-read', 'SELECT status FROM poc_reservations WHERE uid = ?', res.uid);
        if (row && row.status !== 'pending') return { status: 'settled', afterError: err.code };
      } catch { /* the read failed too: try again */ }
    }
  }
  return { status: 'unsettled' };
}

/**
 * One agent run, end to end: access, cap, admission, route, hold, a stubbed
 * model call that costs `cost`, settlement, finish. `key` is the run's
 * idempotency key; `idempotent: false` models an unkeyed caller, whose retry
 * is a new execution.
 */
export async function executeRun(t, { key, agentId, actorUserId, cost, hold: amount, idempotent = true, w = null, providerFails = false }) {
  const c = t.core;
  let agent;
  try {
    agent = await c.get('agent', 'SELECT id, company_id, sponsor_user_id, cap FROM poc_agents WHERE id = ?', agentId);
    const member = await c.get('access', 'SELECT 1 AS ok FROM poc_memberships WHERE user_id = ? AND company_id = ?', actorUserId, agent.company_id);
    if (!member) return { status: 'refused', reason: 'forbidden' };
  } catch (err) {
    if (err instanceof DbUnavailable) return { status: 'refused', reason: 'core_unavailable' };
    throw err;
  }
  const payer = t.guards.payerKeyed ? Number(agent.sponsor_user_id) : actorUserId;
  const spent = await monthSpend(t, agentId, { w });
  if (spent === null) return { status: 'refused', reason: 'agent_spend_unreadable' };
  if (spent + amount > Number(agent.cap)) return { status: 'refused', reason: 'agent_cap' };

  t.seq += 1;
  const execKey = idempotent ? key : `${key}#${t.seq}`;
  const run = { uid: `run:${execKey}`, agentId, companyId: Number(agent.company_id) };
  try {
    const admitted = await c.run('admit', "INSERT OR IGNORE INTO poc_runs (uid, agent_id, company_id, payer_user_id, actor_user_id, status) VALUES (?, ?, ?, ?, ?, 'live')",
      run.uid, agentId, run.companyId, payer, actorUserId);
    if (admitted === 0) {
      const same = await c.get('admit-read', 'SELECT status FROM poc_runs WHERE uid = ?', run.uid);
      if (!same) return { status: 'refused', reason: 'agent_busy' };
    }
  } catch (err) {
    if (err instanceof DbUnavailable) return { status: 'refused', reason: 'core_unavailable' };
    throw err;
  }
  const fail = async (reason) => {
    try { await c.run('finish', "UPDATE poc_runs SET status = 'failed' WHERE uid = ? AND status = 'live'", run.uid); } catch { /* the hold expiry and reconciliation cover it */ }
    return { status: 'refused', reason, execKey, payer };
  };

  let home;
  let held;
  try {
    home = await route(t, payer, w);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      held = await hold(t, home, { userId: payer, key: idempotent ? key : null, execKey, agentId, amount });
      if (held.status !== 'stale') break;
      w?.cache.delete(payer);             // §6.3: refused at the old home, reread the directory, start again
      home = await route(t, payer, w);
    }
  } catch (err) {
    if (err instanceof DbUnavailable || err instanceof InjectedFault) return fail('budget_unreadable');
    throw err;
  }
  if (held.status !== 'held') return fail(held.status === 'stale' ? 'stale_home' : held.reason);

  const res = { uid: held.uid, userId: payer, execKey };
  const settled = await settle(t, home.partition, res, { cost, refund: providerFails, run });
  if (settled.status !== 'settled') return { ...(await fail('settlement_unanswered')), reservationUid: res.uid, partition: home.partition };
  if (t.option === 'D' || providerFails) {
    try {
      await c.run('finish', `UPDATE poc_runs SET status = ? WHERE uid = ? AND status = 'live'`, providerFails ? 'failed' : 'done', run.uid);
    } catch (err) {
      if (!(err instanceof DbUnavailable)) throw err;   // the relay closes the run when core answers again
    }
  }
  return { status: providerFails ? 'refunded' : 'settled', execKey, agentId, payer, charged: providerFails ? 0 : cost, partition: home.partition, reservationUid: res.uid, replay: !!held.replay };
}

/** Release every pending hold of a member at their home (the hold expiry). */
export async function expireHolds(t, userId) {
  const { partition } = await route(t, userId, null);
  const db = t.homes[partition];
  const rows = await db.all('expire-list', "SELECT uid, execution_key FROM poc_reservations WHERE user_id = ? AND status = 'pending' ORDER BY uid LIMIT ?", userId, 1000);
  for (const r of rows) await settle(t, partition, { uid: r.uid, userId, execKey: r.execution_key }, { cost: 0, refund: true, run: null });
  return rows.length;
}

/** A payment webhook's credit: idempotent on its reference, refused (and retried by the sender) while the home is frozen. */
export async function credit(t, { userId, ref, amount, w = null }) {
  try {
    const home = await route(t, userId, w);
    const db = t.homes[home.partition];
    const token = randomUUID();
    const marker = t.guards.marker ? "AND EXISTS (SELECT 1 FROM poc_home_markers WHERE user_id = ? AND version = ? AND state = 'active')" : '';
    const [ins] = await db.batch('credit', [
      [`INSERT OR IGNORE INTO poc_ledger (user_id, kind, delta, source_ref, token) SELECT ?, 'purchase', ?, ?, ? WHERE 1 ${marker}`,
        [userId, amount, `pi:${ref}`, token, ...(t.guards.marker ? [userId, home.version] : [])]],
      ["UPDATE poc_accounts SET balance = balance + ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM poc_ledger WHERE kind = 'purchase' AND source_ref = ? AND token = ?)",
        [amount, userId, `pi:${ref}`, token]],
    ], { money: true });
    if (ins === 1) return { status: 'credited' };
    const dup = await db.get('credit-read', "SELECT 1 AS ok FROM poc_ledger WHERE kind = 'purchase' AND source_ref = ?", `pi:${ref}`);
    if (dup) return { status: 'duplicate' };
    w?.cache.delete(userId);
    return { status: 'retry_later' };
  } catch (err) {
    if (err instanceof DbUnavailable) return { status: 'retry_later' };
    throw err;
  }
}

/**
 * §7 Rule 3: deliver outbox rows to core with a write keyed by the run that
 * changes nothing on replay. Applies first, then marks delivered, so a crash
 * between the two is a replay.
 */
export async function relay(t, { limit = 500 } = {}) {
  const out = { delivered: 0, pending: 0, mismatches: 0 };
  if (t.option === 'A') return out;
  for (const db of t.homes) {
    // Page by id until a short page: one bounded read per page, never "the first page is all of it".
    for (let after = 0, more = true; more;) {
      let rows;
      try {
        rows = await db.all('outbox', 'SELECT id, target_uid, usage_ref FROM poc_outbox WHERE delivered = 0 AND id > ? ORDER BY id LIMIT ?', after, limit);
      } catch (err) {
        if (err instanceof DbUnavailable) break;
        throw err;
      }
      more = rows.length === limit;
      if (rows.length) after = Number(rows.at(-1).id);
      await deliver(t, db, rows, out);
    }
  }
  return out;
}

/** Apply one page of outbox rows; a row whose write or mark fails stays undelivered and is counted pending. */
async function deliver(t, db, rows, out) {
  for (const r of rows) {
    const apply = () => t.core.run('relay-apply',
      `UPDATE poc_runs SET usage_ref = ?, status = CASE WHEN status = 'live' THEN 'done' ELSE status END WHERE uid = ? ${t.guards.relayConditional ? 'AND usage_ref IS NULL' : ''}`,
      r.usage_ref, r.target_uid);
    const mark = () => db.run('relay-mark', 'UPDATE poc_outbox SET delivered = 1 WHERE id = ? AND delivered = 0', r.id);
    try {
      let changed;
      if (t.guards.relayApplyFirst) { changed = await apply(); await mark(); } else { await mark(); changed = await apply(); }
      if (changed === 0) {
        const run = await t.core.get('relay-read', 'SELECT usage_ref FROM poc_runs WHERE uid = ?', r.target_uid);
        if (!run || run.usage_ref !== r.usage_ref) out.mismatches += 1;
      }
      out.delivered += 1;
    } catch (err) {
      if (!(err instanceof DbUnavailable)) throw err;
      out.pending += 1;
    }
  }
}

/** Change an agent's sponsor for future runs; the month's payer list keeps both (§6.5). */
export async function changeSponsor(t, agentId, userId) {
  await t.core.batch('sponsor', [
    ['UPDATE poc_agents SET sponsor_user_id = ? WHERE id = ?', [userId, agentId]],
    ['INSERT OR IGNORE INTO poc_agent_payers (agent_id, month, user_id) VALUES (?, ?, ?)', [agentId, MONTH, userId]],
  ]);
}

/** Move an agent's scope to another company: no money row moves, because the payer does not change. */
export async function moveScope(t, agentId, companyId) {
  await t.core.run('scope', 'UPDATE poc_agents SET company_id = ? WHERE id = ?', companyId, agentId);
}

/**
 * Move a member's balance home (§7, D only): freeze, wait for no pending
 * hold, copy and verify, drain the outbox, activate the new home, flip the
 * directory, mark the old home moved. Returns a status per step.
 */
export async function moveMember(t, userId, to) {
  if (t.option !== 'D') throw new Error('moves exist only in option D');
  const dir = await t.core.get('directory', 'SELECT partition, version FROM poc_directory WHERE user_id = ?', userId);
  const from = Number(dir.partition);
  const v = Number(dir.version);
  if (from === to) return { status: 'same_home' };
  const P = t.homes[from];
  const Q = t.homes[to];
  const frozen = await P.run('freeze', "UPDATE poc_home_markers SET state = 'frozen' WHERE user_id = ? AND version = ? AND state IN ('active','frozen')", userId, v);
  if (frozen !== 1) return { status: 'marker_mismatch' };
  const pending = await P.get('pending', "SELECT COUNT(*) AS n FROM poc_reservations WHERE user_id = ? AND status = 'pending'", userId);
  if (Number(pending.n) > 0) return { status: 'waiting_for_holds', pending: Number(pending.n) };
  const drained = await relay(t);
  const left = await P.get('outbox-left', 'SELECT COUNT(*) AS n FROM poc_outbox WHERE user_id = ? AND delivered = 0', userId);
  if (Number(left.n) > 0) return { status: 'waiting_for_outbox', pending: Number(left.n), drained };
  const source = {};
  for (const [table, sql] of HOME_TABLES) source[table] = await P.all('copy-read', sql, userId, LIST_LIMIT);
  const stmts = [];
  for (const [table] of HOME_TABLES) for (const row of source[table]) stmts.push([COPY_SQL[table], Object.values(row)]);
  stmts.push(["INSERT INTO poc_home_markers (user_id, version, state) VALUES (?, ?, 'frozen') ON CONFLICT (user_id) DO UPDATE SET version = excluded.version, state = 'frozen'", [userId, v + 1]]);
  await Q.batch('copy', stmts);
  for (const [table, sql] of HOME_TABLES) {
    const copied = Q.db.prepare(sql).all(userId, LIST_LIMIT);
    if (copied.length !== source[table].length || hashRows(copied) !== hashRows(source[table])) return { status: 'copy_mismatch', table };
  }
  await Q.run('activate', "UPDATE poc_home_markers SET state = 'active' WHERE user_id = ? AND version = ?", userId, v + 1);
  await t.core.run('flip', 'UPDATE poc_directory SET partition = ?, version = ? WHERE user_id = ? AND version = ?', to, v + 1, userId, v);
  await P.run('retire', "UPDATE poc_home_markers SET state = 'moved' WHERE user_id = ? AND version = ?", userId, v);
  t.movedSnapshots.push({ userId, partition: from, hash: hashRows(Object.values(memberRowsRaw(P.db, userId)).flat()) });
  return { status: 'moved', from, to, version: v + 1 };
}

/** A company's usage total: a fan-out over its agents' payers' homes; null when any home is unreadable (never 0). */
export async function companyReport(t, companyId) {
  const agents = await t.core.all('report-agents', 'SELECT id FROM poc_agents WHERE company_id = ? ORDER BY id LIMIT ?', companyId, 10000);
  const payers = new Set();
  for (const a of agents) {
    for (const r of await t.core.all('report-payers', 'SELECT user_id FROM poc_agent_payers WHERE agent_id = ? AND month = ? ORDER BY user_id LIMIT ?', a.id, MONTH, 1000)) payers.add(Number(r.user_id));
  }
  const homes = new Set();
  for (const u of payers) homes.add((await route(t, u, null)).partition);
  let total = 0;
  for (const p of homes) {
    try {
      const row = await t.homes[p].get('report', 'SELECT COALESCE(SUM(charged), 0) AS s FROM poc_usage WHERE company_id = ? AND month = ? AND user_id IN (SELECT user_id FROM poc_home_markers WHERE state = \'active\')', companyId, MONTH);
      total += Number(row.s);
    } catch (err) {
      if (err instanceof DbUnavailable) return { total: null, homesRead: homes.size, unreadable: p };
      throw err;
    }
  }
  return { total, homesRead: homes.size };
}

/**
 * The auditor. Reads every database directly (outages do not hide rows from
 * it) and returns every violated invariant as a string; [] means all hold.
 *
 * `expected`: Map execKey → { payer, charged } for every execution the caller
 * saw settle, one entry per idempotent execution.
 */
export function checkInvariants(t, { expected = new Map(), drained = true } = {}) {
  const v = [];
  const core = t.core.db;
  const members = core.prepare('SELECT id FROM poc_members ORDER BY id LIMIT ?').all(LIST_LIMIT).map((r) => Number(r.id));
  const activeHome = new Map();
  for (const m of members) {
    const actives = t.homes.map((h, i) => [i, h.db.prepare("SELECT version FROM poc_home_markers WHERE user_id = ? AND state = 'active'").get(m)]).filter(([, r]) => r);
    if (actives.length !== 1) { v.push(`markers: member ${m} has ${actives.length} active homes`); continue; }
    const [p, marker] = actives[0];
    activeHome.set(m, p);
    const dir = core.prepare('SELECT partition, version FROM poc_directory WHERE user_id = ?').get(m);
    if (t.option === 'D' && (Number(dir.partition) !== p || Number(dir.version) !== Number(marker.version))) v.push(`directory: member ${m} points at p${dir.partition} v${dir.version}, home is p${p} v${marker.version}`);
    const h = t.homes[p].db;
    const balance = Number(h.prepare('SELECT balance FROM poc_accounts WHERE user_id = ?').get(m).balance);
    if (balance < 0) v.push(`overdraw: member ${m} balance ${balance}`);
    const ledger = Number(h.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM poc_ledger WHERE user_id = ?').get(m).s);
    if (ledger !== balance) v.push(`ledger: member ${m} ledger ${ledger} != balance ${balance}`);
    const settled = h.prepare("SELECT execution_key, COUNT(*) AS n, SUM(charged) AS c FROM poc_reservations WHERE user_id = ? AND status = 'settled' GROUP BY execution_key LIMIT ?").all(m, LIST_LIMIT);
    for (const s of settled) {
      if (Number(s.n) > 1) v.push(`double_settlement: ${s.execution_key} settled ${s.n} times`);
      const exp = expected.get(s.execution_key);
      if (!exp) v.push(`unexpected_charge: ${s.execution_key} charged to member ${m}`);
      else if (exp.payer !== m) v.push(`payer: ${s.execution_key} charged to ${m}, payer is ${exp.payer}`);
      else if (Number(s.c) !== exp.charged) v.push(`overcharge: ${s.execution_key} charged ${s.c}, expected ${exp.charged}`);
      if (Number(s.c) > 0) {
        const n = Number(h.prepare('SELECT COUNT(*) AS n FROM poc_usage WHERE execution_key = ?').get(s.execution_key).n);
        if (n !== 1) v.push(`attribution: ${s.execution_key} has ${n} usage rows`);
      }
    }
    const usageMine = h.prepare('SELECT execution_key, user_id FROM poc_usage WHERE user_id = ? ORDER BY id LIMIT ?').all(m, LIST_LIMIT);
    for (const u of usageMine) if (expected.get(u.execution_key)?.payer !== m) v.push(`usage_payer: usage ${u.execution_key} attributed to ${m}`);
  }
  for (const [key, exp] of expected) {
    if (exp.charged <= 0) continue;
    const p = activeHome.get(exp.payer);
    if (p === undefined) continue;
    const row = t.homes[p].db.prepare("SELECT COUNT(*) AS n FROM poc_reservations WHERE execution_key = ? AND user_id = ? AND status = 'settled'").get(key, exp.payer);
    if (Number(row.n) !== 1) v.push(`missing_charge: ${key} settled ${row.n} times at the payer's home`);
  }
  for (const s of t.movedSnapshots) {
    const now = hashRows(Object.values(memberRowsRaw(t.homes[s.partition].db, s.userId)).flat());
    if (now !== s.hash) v.push(`write_after_move: member ${s.userId}'s old home p${s.partition} changed after the move`);
  }
  const live = core.prepare("SELECT agent_id, COUNT(*) AS n FROM poc_runs WHERE status = 'live' GROUP BY agent_id HAVING n > 1 LIMIT ?").all(LIST_LIMIT);
  for (const l of live) v.push(`single_flight: agent ${l.agent_id} has ${l.n} live runs`);
  if (drained) {
    const runs = core.prepare("SELECT uid, payer_user_id, usage_ref FROM poc_runs WHERE status = 'done' ORDER BY uid LIMIT ?").all(LIST_LIMIT);
    for (const r of runs) {
      const p = activeHome.get(Number(r.payer_user_id));
      if (!r.usage_ref) { v.push(`missing_ref: ${r.uid} has no usage reference`); continue; }
      if (p === undefined) continue;
      const u = t.homes[p].db.prepare('SELECT 1 AS ok FROM poc_usage WHERE uid = ?').get(r.usage_ref);
      if (!u) v.push(`dangling_ref: ${r.uid} names ${r.usage_ref}, absent from the payer's home`);
    }
    for (const [i, h] of t.homes.entries()) {
      if (t.option === 'A') break;
      const n = Number(h.db.prepare('SELECT COUNT(*) AS n FROM poc_outbox WHERE delivered = 0').get().n);
      if (n > 0) v.push(`outbox: p${i} has ${n} undelivered rows`);
    }
  }
  const spent = new Map();
  for (const h of new Set(t.homes)) {
    const rows = h.db.prepare("SELECT agent_id, SUM(charged) AS s FROM poc_usage WHERE month = ? AND user_id IN (SELECT user_id FROM poc_home_markers WHERE state = 'active') GROUP BY agent_id LIMIT ?").all(MONTH, LIST_LIMIT);
    for (const r of rows) spent.set(Number(r.agent_id), (spent.get(Number(r.agent_id)) ?? 0) + Number(r.s));
  }
  for (const a of core.prepare('SELECT id, cap FROM poc_agents ORDER BY id LIMIT ?').all(LIST_LIMIT)) {
    const s = spent.get(Number(a.id)) ?? 0;
    if (s > Number(a.cap)) v.push(`cap: agent ${a.id} spent ${s} over its cap ${a.cap}`);
  }
  return v;
}

/**
 * The settled executions a caller saw, deduplicated by key: the `expected`
 * map for `checkInvariants`. The payer comes from the caller's own fixture
 * (`payerOf(agentId, execKey)`), never from the model, so a model that charges
 * the wrong member cannot vouch for itself.
 */
export function expectedFrom(results, payerOf) {
  const m = new Map();
  for (const r of results) if (r && r.status === 'settled') m.set(r.execKey, { payer: payerOf(r.agentId, r.execKey), charged: r.charged });
  return m;
}
