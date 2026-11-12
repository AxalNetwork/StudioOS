// D5664: transactional append-only metadata/delivery ledger; SQL and transaction boundaries are injected for runtime tests.
import { validateEvent, eventKey } from './events-v1.mjs';
export class EventLedger {
  constructor(sql, transaction) {
    this.sql = sql; this.transaction = transaction;
    sql.exec('CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, family TEXT NOT NULL, payload TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS deliveries (delivery_id TEXT PRIMARY KEY, event_key TEXT NOT NULL, observed_at TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS gaps (gap_key TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS rejects (code TEXT PRIMARY KEY, count INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS cursors (scope TEXT PRIMARY KEY, until_ms INTEGER NOT NULL)');
  }
  async append(input) {
    const event = validateEvent(input);
    if (await eventKey(event) !== event.key) throw new Error('canonical_event_digest_invalid');
    return this.transaction(() => {
      const previous = this.sql.exec('SELECT event_key FROM deliveries WHERE delivery_id = ?', event.deliveryId).toArray()[0];
      if (previous && previous.event_key !== event.key) throw new Error('delivery_identity_collision');
      this.sql.exec('INSERT OR IGNORE INTO events (event_key, family, payload) VALUES (?, ?, ?)', event.key, event.family, JSON.stringify(event));
      this.sql.exec('INSERT OR IGNORE INTO deliveries (delivery_id, event_key, observed_at) VALUES (?, ?, ?)', event.deliveryId, event.key, event.observedAt);
      return { key: event.key, duplicateDelivery: Boolean(previous), sequence: this.sql.exec('SELECT sequence FROM events WHERE event_key = ?', event.key).toArray()[0].sequence };
    });
  }
  recordGap({ scope, code, from, to }) {
    if (!/^[a-zA-Z0-9_:/.-]{1,180}$/.test(scope) || !/^[a-z_]{1,80}$/.test(code) || !Number.isFinite(from) || !Number.isFinite(to)) throw new Error('gap_invalid');
    const gap = { schema: 1, scope, code, from, to, owner: 'S01', remediation: 'restore_scope_or_replay_authorized_retained_deliveries' };
    this.sql.exec('INSERT OR IGNORE INTO gaps (gap_key, payload) VALUES (?, ?)', `${scope}:${code}:${from}:${to}`, JSON.stringify(gap));
  }
  reject(code) {
    if (!/^[a-z_]{1,80}$/.test(code)) throw new Error('reject_code_invalid');
    this.sql.exec('INSERT INTO rejects (code, count) VALUES (?, 1) ON CONFLICT(code) DO UPDATE SET count = count + 1', code);
  }
  history(after = 0, limit = 100) { return this.sql.exec('SELECT sequence, payload FROM events WHERE sequence > ? ORDER BY sequence LIMIT ?', after, Math.max(1, Math.min(1000, limit))).toArray().map(r => ({ sequence: r.sequence, ...JSON.parse(r.payload) })); }
  pending() {
    const latest = new Map(); let after = 0;
    for (;;) { const page = this.history(after, 1000); if (!page.length) break; for (const e of page) { after = e.sequence; const key = `${e.subject.type}:${e.subject.id}:${e.ids.attempt}`; if (!latest.has(key) || e.occurredAt >= latest.get(key).occurredAt) latest.set(key, e); } }
    return [...latest.values()].filter(e => ['run', 'job', 'check'].includes(e.subject.type) && ['queued', 'waiting', 'requested', 'in_progress', 'pending', 'unknown'].includes(e.state));
  }
  cursor(scope) { return this.sql.exec('SELECT until_ms FROM cursors WHERE scope = ?', scope).toArray()[0]?.until_ms || 0; }
  checkpoint(scope, until) { this.sql.exec('INSERT INTO cursors (scope, until_ms) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET until_ms = MAX(until_ms, excluded.until_ms)', scope, until); }
  counts() { return { schema: 1, rejects: this.sql.exec('SELECT code, count FROM rejects').toArray(), redactedRecords: this.sql.exec('SELECT COUNT(*) AS count FROM events').toArray()[0].count, families: this.sql.exec('SELECT family, COUNT(*) AS count FROM events GROUP BY family').toArray(), deliveries: this.sql.exec('SELECT COUNT(*) AS count FROM deliveries').toArray()[0].count, gaps: this.sql.exec('SELECT payload FROM gaps').toArray().map(r => JSON.parse(r.payload)), pending: this.pending().length }; }
}
