/**
 * An in-memory KVNamespace for unit tests: get (text or json), put (with
 * expirationTtl), delete and list (prefix, cursor, limit). Expiry follows
 * `now()`, which a test may move forward. Like Workers KV, `put` refuses an
 * expiry under 60 seconds away (#1903: the OAuth refresh leases asked for 30,
 * and this file accepted it while KV threw).
 */
const KV_MIN_TTL_S = 60;
export function memKV({ now = () => Date.now() } = {}) {
  const m = new Map();
  const live = (k) => { const e = m.get(k); if (!e) return null; if (e.exp && e.exp <= now()) { m.delete(k); return null; } return e; };
  return {
    _map: m,
    async get(key, opts) {
      const e = live(key); if (!e) return null;
      const type = typeof opts === 'string' ? opts : opts?.type;
      return type === 'json' ? JSON.parse(e.v) : e.v;
    },
    async getWithMetadata(key, opts) {
      const e = live(key); if (!e) return { value: null, metadata: null };
      const type = typeof opts === 'string' ? opts : opts?.type;
      return { value: type === 'json' ? JSON.parse(e.v) : e.v, metadata: e.meta ?? null };
    },
    async put(key, value, opts = {}) {
      if (opts.expirationTtl != null && opts.expirationTtl < KV_MIN_TTL_S) {
        throw new Error(`Invalid expiration_ttl of ${opts.expirationTtl}. Expiration TTL must be at least ${KV_MIN_TTL_S}.`);
      }
      if (opts.expiration != null && opts.expiration * 1000 - now() < KV_MIN_TTL_S * 1000) {
        throw new Error(`Invalid expiration of ${opts.expiration}. Expiration times must be at least ${KV_MIN_TTL_S} seconds in the future.`);
      }
      const exp = opts.expirationTtl ? now() + opts.expirationTtl * 1000 : opts.expiration ? opts.expiration * 1000 : null;
      m.set(key, { v: String(value), exp, meta: opts.metadata });
    },
    async delete(key) { m.delete(key); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix) && live(k)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + limit);
      const done = start + limit >= names.length;
      return { keys: page.map((name) => ({ name, metadata: m.get(name)?.meta, expiration: m.get(name)?.exp ? Math.floor(m.get(name).exp / 1000) : undefined })), list_complete: done, cursor: done ? undefined : String(start + limit) };
    },
  };
}
