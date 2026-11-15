/** D5568: synthetic Git remote, revocable repo access, faultable R2-shaped store, atomic memory pointer store and tenant AES-GCM cipher; tests only, no network. */
import type { FetchedCommit, GitRemote, RepoAccess } from '../src/services/agents/workspaceGitCache.ts';
import { sha256Hex } from '../src/services/agents/workspaceGitCache.ts';
import type { CheckpointCipher, CheckpointObjectStore, CheckpointPointer, CheckpointPointerStore } from '../src/services/agents/workspaceCheckpoint.ts';

const text = (value: string) => new TextEncoder().encode(value);
export const BASE_SHA = '1'.repeat(40);
export const NEXT_SHA = '2'.repeat(40);
/** An invented repository: a few files at two commits. */
export function syntheticRepo(): Map<string, [string, Uint8Array][]> {
  const base: [string, Uint8Array][] = [['src/app.ts', text('export const answer = 1;\n')], ['src/util.ts', text('export const x = 2;\n')],
    ['test/app.test.ts', text('// synthetic test\n')], ['README.md', text('synthetic\n')]];
  return new Map([[BASE_SHA, base], [NEXT_SHA, [...base, ['src/new.ts', text('export {};\n')]]]]);
}

/** Read-only by construction: it has no push, delete or ref-update method. `pushes` stays 0 unless a caller could push. */
export function fakeRemote(repos = new Map([[61, syntheticRepo()]])) {
  const counters = { fetches: 0, bytes_served: 0, pushes: 0 };
  const remote: GitRemote = {
    async fetchCommit(repo_id, sha, have): Promise<FetchedCommit | null> {
      const files = repos.get(repo_id)?.get(sha);
      if (!files) return null;
      counters.fetches++;
      const objects = [];
      for (const [path, bytes] of files) objects.push({ id: (await sha256Hex(`blob ${path} ${await sha256Hex(bytes)}`)).slice(0, 40), bytes: bytes.length });
      objects.push({ id: sha, bytes: 200 });
      const missing = objects.filter(o => !have.has(o.id));
      counters.bytes_served += missing.reduce((n, o) => n + o.bytes, 0);
      return { sha, objects: missing, files: files.map(([p, b]) => [p, new Uint8Array(b)]) };
    },
  };
  return { remote, counters };
}

export function fakeAccess() {
  const revoked = new Set<string>(), calls = { count: 0 };
  const access: RepoAccess = { async authorize(tenant_id, repo_id) { calls.count++; return { allowed: !revoked.has(`${tenant_id}/${repo_id}`), revision: 1 }; } };
  return { access, calls, revoke: (tenant_id: number, repo_id: number) => revoked.add(`${tenant_id}/${repo_id}`) };
}

export function memoryObjects() {
  const data = new Map<string, Uint8Array>();
  const faults = { crashAfterPuts: Infinity, corruptNextPut: false, onPut: null as null | ((key: string) => Promise<void>) };
  const counts = { puts: 0, deletes: 0 };
  const store: CheckpointObjectStore = {
    async put(key, bytes) {
      if (faults.crashAfterPuts <= 0) throw new Error('synthetic crash');
      faults.crashAfterPuts--; counts.puts++;
      const copy = new Uint8Array(bytes);
      if (faults.corruptNextPut) { faults.corruptNextPut = false; copy[0] ^= 0xff; }
      data.set(key, copy);
      if (faults.onPut) await faults.onPut(key);
    },
    async get(key) { const v = data.get(key); return v ? new Uint8Array(v) : null; },
    async list(prefix) { return [...data].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length })); },
    async delete(key) { counts.deletes++; data.delete(key); },
  };
  return { store, data, faults, counts, tamper(key: string) { const v = data.get(key)!; v[v.length - 1] ^= 1; } };
}

export function memoryPointers(): CheckpointPointerStore & { inspect(): Map<string, CheckpointPointer>; failNext(): void; rows: () => Map<string, CheckpointPointer> } {
  let rows = new Map<string, CheckpointPointer>(), pending: Promise<unknown> = Promise.resolve(), fail = false;
  return {
    async transaction<T>(change: (r: Map<string, CheckpointPointer>) => T): Promise<T> {
      const next = pending.then(() => {
        if (fail) { fail = false; throw new Error('synthetic pointer store outage'); }
        const copy = structuredClone(rows); const result = change(copy); rows = copy; return result;
      });
      pending = next.catch(() => {});
      return next;
    },
    inspect: () => structuredClone(rows), failNext: () => { fail = true; }, rows: () => rows,
  };
}

/** Real WebCrypto AES-256-GCM with per-tenant synthetic keys generated in-process. */
export function tenantCipher(): CheckpointCipher {
  const keys = new Map<string, Promise<CryptoKey>>();
  const keyFor = (tenant: number, id: string) => {
    const k = `${tenant}/${id}`;
    if (!keys.has(k)) keys.set(k, crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>);
    return keys.get(k)!;
  };
  return {
    async seal(tenant, id, aad, plain) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text(aad) }, await keyFor(tenant, id), plain));
      const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
    },
    async open(tenant, id, aad, sealed) {
      try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: text(aad) }, await keyFor(tenant, id), sealed.slice(12))); }
      catch { return null; }
    },
  };
}
