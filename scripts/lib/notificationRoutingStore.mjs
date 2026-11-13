// D5666: atomic local routing decision/checkpoint store; writes metadata only, with an injected SQLite transaction.
export class SqliteRoutingStore {
  constructor(sql, transaction) {
    this.sql = sql; this.transaction = transaction; this.locks = new Map();
    sql.exec('CREATE TABLE IF NOT EXISTS routing_decisions (event_key TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS routing_current (subject_key TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  }
  async get(key) {
    const row = key.includes(':event:') ? this.sql.exec('SELECT payload FROM routing_decisions WHERE event_key = ?', key).toArray()[0] : this.sql.exec('SELECT payload FROM routing_current WHERE subject_key = ?', key).toArray()[0];
    return row ? JSON.parse(row.payload) : null;
  }
  async commit(eventKey, subjectKey, value) {
    return this.transaction(() => {
      if (this.sql.exec('SELECT payload FROM routing_decisions WHERE event_key = ?', eventKey).toArray().length) return;
      this.sql.exec('INSERT INTO routing_decisions (event_key, payload) VALUES (?, ?)', eventKey, JSON.stringify(value));
      const row = this.sql.exec('SELECT payload FROM routing_current WHERE subject_key = ?', subjectKey).toArray()[0];
      if (value.state && (!row || JSON.parse(row.payload).revision <= value.state.revision)) this.sql.exec('INSERT INTO routing_current (subject_key, payload) VALUES (?, ?) ON CONFLICT(subject_key) DO UPDATE SET payload = excluded.payload', subjectKey, JSON.stringify(value.state));
    });
  }
  async withLock(key, fn) {
    const before = this.locks.get(key) || Promise.resolve(), next = before.catch(() => {}).then(fn); this.locks.set(key, next);
    try { return await next; } finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }
}
