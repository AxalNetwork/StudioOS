// D5665: durable per-destination logical outbox; snapshots are sanitized before SQL, retries and uncertain sends remain explicit.
import { registryOf, prepare, row, pages, mentionFor } from './presentation-v1.mjs';
const uuid = async value => {
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export class SlackOutbox {
  constructor({ sql, transaction, registry, deliver, now = Date.now, jitter = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * 250 }) {
    this.sql = sql; this.transaction = transaction; this.registry = registryOf(registry); this.deliver = deliver; this.now = now; this.jitter = jitter; this.busy = false;
    sql.exec('CREATE TABLE IF NOT EXISTS outbox (logical_key TEXT PRIMARY KEY, channel TEXT NOT NULL, role TEXT NOT NULL, priority INTEGER NOT NULL, state TEXT NOT NULL, not_before INTEGER NOT NULL, payload TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS activity (event_key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, payload TEXT NOT NULL, chunk_key TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS subjects (subject_key TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS pacing (channel TEXT PRIMARY KEY, not_before INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS redacted (event_key TEXT PRIMARY KEY, code TEXT NOT NULL)');
    // Constructed once per actor incarnation, before external I/O. Started sends are not blindly repeated.
    for (const r of sql.exec("SELECT logical_key, payload FROM outbox WHERE state = 'sending'").toArray()) { const p = JSON.parse(r.payload); this.save(r.logical_key, { ...p, code: 'restart_after_send_started' }, 'ambiguous'); }
  }
  save(key, value, state, notBefore = 0) { this.sql.exec('UPDATE outbox SET payload = ?, state = ?, not_before = ? WHERE logical_key = ?', JSON.stringify(value), state, notBefore, key); }
  insert({ key, role, text, parent = null, operation = 'post', priority = 10, items = [] }) {
    const channel = this.registry.channels[role]; if (!channel) throw new Error('destination_unapproved');
    this.sql.exec('INSERT OR IGNORE INTO outbox (logical_key, channel, role, priority, state, not_before, payload) VALUES (?, ?, ?, ?, ?, ?, ?)', key, channel.id, role, priority, 'pending', 0, JSON.stringify({ schema: 1, key, role, text, parent, operation, items, attempts: 0, createdAt: this.now(), registryVersion: this.registry.version }));
    return key;
  }
  enqueueHealth(intent) {
    const match = /^health:v1:([\w.-]+\/[\w.-]+):(main-red|queue|queue-stalled|review-blocked|future-clock):([1-9]\d*):(open|recovery)$/.exec(intent?.key || '');
    if (!match || intent.kind !== match[2] || String(intent.issue) !== match[3] || intent.phase !== match[4]) throw new Error('health_intent_invalid');
    const [, repository, kind, issue, phase] = match, root = `health-episode:${repository}:${kind}:${issue}`;
    return this.transaction(() => {
      this.insert({ key: root, role: 'health', text: `[health] ${kind} <https://github.com/${repository}/issues/${issue}|incident>`, priority: 0 });
      this.insert({ key: intent.key, role: 'health', parent: root, text: `[health] [${phase === 'open' ? 'action' : 'recovery'}] ${kind} <https://github.com/${repository}/issues/${issue}|incident>`, priority: 0, items: [intent.key] });
      return { state: this.get(intent.key).state, key: intent.key };
    });
  }
  enqueue(event, policy) {
    let item;
    try { item = prepare(event, policy); if (!this.registry.channels[item.role]) throw new Error('destination_unapproved');
      if (this.now() - Date.parse(item.observedAt) > this.registry.channels[item.role].retentionDays * 86_400_000) throw new Error('retention_expired'); }
    catch { const key = /^[a-f0-9]{64}$/.test(event?.key || '') ? event.key : 'invalid'; this.sql.exec('INSERT OR IGNORE INTO redacted (event_key, code) VALUES (?, ?)', key, 'event_or_destination_refused'); return { state: 'redacted', key }; }
    return this.transaction(() => {
      const bucket = Math.floor(Date.parse(item.observedAt) / 300_000) * 300_000;
      // Restricted activity stays in its restricted role; it never falls back to the broad activity channel.
      const activityRole = item.visibility === 'restricted' ? 'security' : 'activity';
      if (!this.registry.channels[activityRole]) throw new Error('activity_destination_unapproved');
      this.sql.exec('INSERT OR IGNORE INTO activity (event_key, bucket, payload) VALUES (?, ?, ?)', item.key, bucket, JSON.stringify({ ...item, activityRole }));
      if (item.material && item.subject) {
        const root = `subject:${item.repository}:${item.subject}:${item.role}`;
        this.insert({ key: root, role: item.role, text: `[${item.family}] ${item.subject} — current state follows in this thread`, priority: 0 });
        this.insert({ key: `transition:${root}:${item.key}`, role: item.role, text: `${mentionFor(item, this.registry)} ${row(item)}`.trim(), parent: root, priority: 0, items: [item.key] });
        const previous = this.sql.exec('SELECT revision FROM subjects WHERE subject_key = ?', root).toArray()[0];
        if (!previous || item.revision > previous.revision) {
          this.sql.exec('INSERT INTO subjects (subject_key, revision) VALUES (?, ?) ON CONFLICT(subject_key) DO UPDATE SET revision = excluded.revision', root, item.revision);
          // Retain replies for old transitions but do not let a late event overwrite a newer root.
          this.sql.exec("UPDATE outbox SET state = 'superseded' WHERE state IN ('pending', 'retry') AND json_extract(payload, '$.parent') = ? AND json_extract(payload, '$.operation') = 'update'", root);
          this.insert({ key: `update:${root}:${item.key}`, role: item.role, text: row(item), parent: root, operation: 'update', priority: 1, items: [item.key] });
        }
      }
      return { state: 'pending', key: item.key };
    });
  }
  flush() {
    const due = this.sql.exec('SELECT event_key, bucket, payload FROM activity WHERE chunk_key IS NULL AND bucket + 300000 <= ? ORDER BY bucket, event_key', this.now()).toArray();
    const groups = new Map(); for (const r of due) { const p = JSON.parse(r.payload), group = `${p.activityRole}:${r.bucket}`; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(p); }
    this.transaction(() => { for (const items of groups.values()) {
      const role = items[0].activityRole, bucket = Math.floor(Date.parse(items[0].observedAt) / 300_000) * 300_000, hour = Math.floor(bucket / 3_600_000) * 3_600_000;
      const parent = `hour:${role}:${hour}`; this.insert({ key: parent, role, text: `[activity] ${new Date(hour).toISOString()} — five-minute itemized batches`, priority: 10 });
      const rendered = pages(items), sequence = new Date(bucket).toISOString();
      const index = `batch:${role}:${bucket}:${items[0].key}`;
      this.insert({ key: index, role, parent, text: `[activity] ${sequence}–${new Date(bucket + 300_000).toISOString()} items:${items.length} pages:${rendered.length} source-gaps:${items.reduce((n, i) => n + i.gaps.length, 0)} missing-record-count:${items.some(i => i.gaps.length) ? 'unknown' : '0'}`, priority: 10 });
      let offset = 0;
      for (let page = 0; page < rendered.length; page++) {
        const count = rendered[page].split('\n').length, keys = items.slice(offset, offset + count).map(i => i.key); offset += count;
        const key = `${index}:page:${page + 1}`;
        this.insert({ key, role, parent, text: `[activity] ${sequence} sequence:${page + 1}/${rendered.length}\n${rendered[page]}`, priority: 10, items: keys });
        for (const eventKey of keys) this.sql.exec('UPDATE activity SET chunk_key = ? WHERE event_key = ?', key, eventKey);
      }
    } });
    return due.length;
  }
  get(key) { const r = this.sql.exec('SELECT * FROM outbox WHERE logical_key = ?', key).toArray()[0]; return r ? { ...JSON.parse(r.payload), state: r.state, channel: r.channel, notBefore: r.not_before } : null; }
  async tick() {
    if (this.busy) return { state: 'busy' }; this.busy = true;
    try {
      this.flush();
      const candidates = this.sql.exec("SELECT logical_key, channel, role FROM outbox WHERE state IN ('pending', 'retry') AND not_before <= ? ORDER BY priority, rowid", this.now()).toArray();
      for (const candidate of candidates) {
        const value = this.get(candidate.logical_key), channel = this.registry.channels[value.role];
        if (!channel?.enabled) continue;
        if (this.now() - value.createdAt > channel.retentionDays * 86_400_000) { this.save(value.key, { ...value, code: 'retention_expired' }, 'dead'); continue; }
        if (channel.id !== candidate.channel) { this.save(value.key, { ...value, code: 'registry_destination_changed' }, 'dead'); continue; }
        const pace = this.sql.exec('SELECT not_before FROM pacing WHERE channel = ?', channel.id).toArray()[0]?.not_before || 0;
        if (pace > this.now()) continue;
        const parent = value.parent && this.get(value.parent);
        if (value.parent && parent?.state !== 'acknowledged') continue;
        if (value.attempts >= 5) { this.save(value.key, { ...value, code: 'attempt_limit' }, 'dead'); continue; }
        const started = { ...value, attempts: value.attempts + 1, attemptedAt: this.now() };
        this.transaction(() => { this.save(value.key, started, 'sending'); this.sql.exec('INSERT INTO pacing (channel, not_before) VALUES (?, ?) ON CONFLICT(channel) DO UPDATE SET not_before = excluded.not_before', channel.id, this.now() + 1000); });
        let outcome;
        try { outcome = await this.deliver({ registry: this.registry, channel, text: value.text, operation: value.operation, ts: value.operation === 'update' ? parent?.receipt?.ts : undefined, threadTs: value.operation === 'post' ? parent?.receipt?.ts : undefined, clientId: await uuid(value.key) }); }
        catch { outcome = { state: 'ambiguous', code: 'transport_outcome_unknown' }; }
        this.sql.exec('UPDATE pacing SET not_before = ? WHERE channel = ?', this.now() + 1000, channel.id);
        if (outcome?.state === 'acknowledged' && outcome.receipt?.status === 200 && outcome.receipt?.transport === 'adapter' && outcome.receipt?.channel === channel.id && /^\d{1,20}\.\d{1,10}$/.test(outcome.receipt?.ts || '')) this.save(value.key, { ...started, receipt: outcome.receipt, acknowledgedAt: this.now() }, 'acknowledged');
        else if (outcome?.state === 'retry') {
          const delay = Math.max(1000, Math.min(86_400_000, Number(outcome.retryAfterMs) || 1000 * 2 ** started.attempts)) + this.jitter();
          this.save(value.key, { ...started, code: ['rate_limited', 'provider_unavailable', 'not_configured', 'preflight_unavailable'].includes(outcome.code) ? outcome.code : 'provider_unavailable' }, started.attempts >= 5 ? 'dead' : 'retry', this.now() + delay);
        } else this.save(value.key, { ...started, code: outcome?.state === 'dead' ? 'destination_refused' : 'transport_outcome_unknown' }, outcome?.state === 'dead' ? 'dead' : 'ambiguous');
        return { state: this.get(value.key).state, key: value.key };
      }
      return { state: 'idle' };
    } finally { this.busy = false; }
  }
  nextWake() {
    let next = Infinity;
    for (const r of this.sql.exec('SELECT bucket FROM activity WHERE chunk_key IS NULL ORDER BY bucket LIMIT 1').toArray()) next = Math.min(next, Math.max(this.now() + 1000, r.bucket + 300000));
    for (const r of this.sql.exec("SELECT logical_key FROM outbox WHERE state IN ('pending', 'retry')").toArray()) {
      const value = this.get(r.logical_key), channel = this.registry.channels[value.role];
      if (!channel?.enabled || value.parent && this.get(value.parent)?.state !== 'acknowledged') continue;
      const pace = this.sql.exec('SELECT not_before FROM pacing WHERE channel = ?', channel.id).toArray()[0]?.not_before || 0;
      next = Math.min(next, Math.max(this.now() + 1000, value.notBefore, pace));
    }
    return Number.isFinite(next) ? next : null;
  }
  summary() {
    const states = this.sql.exec('SELECT role, state, COUNT(*) AS count FROM outbox GROUP BY role, state').toArray();
    return { schema: 1, states, lastAttemptAt: this.sql.exec("SELECT MAX(json_extract(payload, '$.attemptedAt')) AS time FROM outbox").toArray()[0].time, lastAcknowledgedAt: this.sql.exec("SELECT MAX(json_extract(payload, '$.acknowledgedAt')) AS time FROM outbox").toArray()[0].time, itemCount: this.sql.exec('SELECT COUNT(*) AS count FROM activity').toArray()[0].count, redacted: this.sql.exec('SELECT COUNT(*) AS count FROM redacted').toArray()[0].count, unbatched: this.sql.exec('SELECT COUNT(*) AS count FROM activity WHERE chunk_key IS NULL').toArray()[0].count };
  }
}
