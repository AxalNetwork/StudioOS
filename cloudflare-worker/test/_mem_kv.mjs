/**
 * An in-memory KVNamespace for unit tests: get (text or json), put (with
 * expirationTtl), delete and list (prefix, cursor, limit). Expiry follows
 * `now()`, which a test may move forward.
 */
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
