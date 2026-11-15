/**
 * D5568: tenant- and repository-scoped Git mirror cache model and one private worktree per task attempt,
 * checked out from an EXACT base SHA. Unmounted and host-independent: the real partial/shallow fetch sits
 * behind the read-only `GitRemote` port (no push, ref deletion or history rewrite exists on it), and the
 * real disk layout belongs to the executor (#5566/#5571). This is not a Git server.
 */
import { PROVIDERS, workspacePath, workspaceRefusal, workspaceSpecSchema,
  type Provider, type WorkspaceResult, type WorkspaceSpec } from './workspaceSpec';

export const GIT_SHA = /^[a-f0-9]{40}$/;
/** A branch name, tag, abbreviated or uppercase SHA is never an exact base; only 40 lowercase hex characters are. */
export const isExactSha = (value: unknown): value is string => typeof value === 'string' && GIT_SHA.test(value);
const REGION = /^[a-z][a-z0-9-]{1,31}$/;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export type GitObject = { id: string; bytes: number };
export type FetchedCommit = { sha: string; objects: GitObject[]; files: [string, Uint8Array][] };
/** Verified read-only fetch of one commit. `have` lists object ids already in THIS tenant's cache entry only. */
export interface GitRemote { fetchCommit(repo_id: number, sha: string, have: ReadonlySet<string>): Promise<FetchedCommit | null> }
/** Current authorization for a tenant's use of a repository (e.g. the GitHub App installation, D5569). Asked on every checkout. */
export interface RepoAccess { authorize(tenant_id: number, repo_id: number): Promise<{ allowed: boolean; revision: number }> }

/** The ACL boundary: provider, region, tenant and repository are all part of the key. Two tenants never share an entry. */
export function gitCacheKey(provider: Provider, region: string, tenant_id: number, repo_id: number): string | null {
  if (!PROVIDERS.includes(provider) || !REGION.test(region) || !positive(tenant_id) || !positive(repo_id)) return null;
  return `git-cache/${provider}/${region}/t${tenant_id}/r${repo_id}`;
}

export const sha256Hex = async (bytes: Uint8Array | string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes))]
    .map(x => x.toString(16).padStart(2, '0')).join('');

/** Content tree hash (SHA-256 over sorted `path NUL sha256` lines); provider-neutral, recomputed after every restore. */
export async function contentTreeHash(entries: Iterable<[string, Uint8Array]>): Promise<string> {
  const lines: string[] = [];
  for (const [path, bytes] of entries) lines.push(`${path}\u0000${await sha256Hex(bytes)}\n`);
  return sha256Hex(lines.sort().join(''));
}

const inScope = (path: string, scopes: readonly string[]) => workspacePath(path) && scopes.some(scope => path === scope || path.startsWith(scope + '/'));
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * One task attempt's private checkout. Its file map, index (staged set) and branch are its own; the shared base
 * snapshot is read-only and every read or write copies bytes, so no caller can mutate another worktree or the cache.
 */
export class Worktree {
  readonly id: string; readonly branch: string; readonly cache_key: string;
  readonly tenant_id: number; readonly repo_id: number; readonly run_id: string; readonly generation: number;
  readonly base_sha: string; readonly scope_paths: readonly string[]; readonly provider: Provider; readonly region: string;
  #files: Map<string, Uint8Array>; readonly #base: ReadonlyMap<string, Uint8Array>; #index = new Set<string>(); #open = true;
  readonly #release: (worktree: Worktree) => void;
  constructor(meta: { id: string; cache_key: string; spec: WorkspaceSpec; provider: Provider; region: string },
    base: ReadonlyMap<string, Uint8Array>, release: (worktree: Worktree) => void) {
    this.id = meta.id; this.cache_key = meta.cache_key; this.tenant_id = meta.spec.tenant_id; this.repo_id = meta.spec.repo_id;
    this.run_id = meta.spec.run_id; this.generation = meta.spec.execution_generation; this.base_sha = meta.spec.base_sha;
    this.scope_paths = Object.freeze([...meta.spec.scope_paths]); this.provider = meta.provider; this.region = meta.region;
    this.branch = `workspace/${meta.spec.run_id}/g${meta.spec.execution_generation}`;
    this.#base = base; this.#files = new Map([...base].map(([path, bytes]) => [path, new Uint8Array(bytes)])); this.#release = release;
  }
  get open(): boolean { return this.#open; }
  read(path: string): Uint8Array | null { const bytes = this.#files.get(path); return bytes ? new Uint8Array(bytes) : null; }
  paths(): string[] { return [...this.#files.keys()].sort(); }
  staged(): string[] { return [...this.#index].sort(); }
  bytes(): number { let total = 0; for (const value of this.#files.values()) total += value.length; return total; }
  write(path: string, bytes: Uint8Array): WorkspaceResult<{ path: string }> {
    if (!this.#open) return workspaceRefusal('worktree_closed');
    if (!inScope(path, this.scope_paths) || !(bytes instanceof Uint8Array)) return workspaceRefusal('path_not_allowed', 422);
    this.#files.set(path, new Uint8Array(bytes)); this.#index.add(path);
    return { ok: true, value: { path } };
  }
  remove(path: string): WorkspaceResult<{ path: string }> {
    if (!this.#open) return workspaceRefusal('worktree_closed');
    if (!inScope(path, this.scope_paths) || !this.#files.has(path)) return workspaceRefusal('path_not_allowed', 422);
    this.#files.delete(path); this.#index.add(path);
    return { ok: true, value: { path } };
  }
  /** Tracked changes against the exact base: the minimum reproducible content of a checkpoint. */
  changes(): { written: [string, Uint8Array][]; deleted: string[] } {
    const written: [string, Uint8Array][] = [], deleted: string[] = [];
    for (const [path, bytes] of this.#files) { const base = this.#base.get(path); if (!base || !equalBytes(base, bytes)) written.push([path, new Uint8Array(bytes)]); }
    for (const path of this.#base.keys()) if (!this.#files.has(path)) deleted.push(path);
    return { written: written.sort(([a], [b]) => a < b ? -1 : 1), deleted: deleted.sort() };
  }
  treeHash(): Promise<string> { return contentTreeHash(this.#files); }
  release(): void { if (this.#open) { this.#open = false; this.#release(this); } }
}

type CacheEntry = { key: string; tenant_id: number; repo_id: number; objects: Set<string>; commits: Map<string, ReadonlyMap<string, Uint8Array>>;
  bytes: number; last_used: number; worktrees: Set<string> };
export type GitCacheStats = { fetches: number; cache_hits: number; cache_misses: number; clone_bytes: number; refusals: number };
export type CacheEvictionPolicy = { idle_ttl_ms: number; max_bytes_per_tenant: number };

/**
 * One executor location's cache (`provider`/`region`). The entry map is keyed by `gitCacheKey`, so every lookup
 * names its tenant; a concurrent miss on the same key and commit is fetched once.
 */
export function createGitCache({ provider, region, remote, access, clock }: { provider: Provider; region: string; remote: GitRemote; access: RepoAccess; clock: () => number }) {
  if (!PROVIDERS.includes(provider) || !REGION.test(region)) throw new Error('Invalid Git cache location');
  const entries = new Map<string, CacheEntry>(), inflight = new Map<string, Promise<WorkspaceResult<ReadonlyMap<string, Uint8Array>>>>();
  const live = new Set<string>();
  const stats: GitCacheStats = { fetches: 0, cache_hits: 0, cache_misses: 0, clone_bytes: 0, refusals: 0 };
  const refuse = (code: string, status: 403 | 409 | 422 | 503 = 409) => { stats.refusals++; return workspaceRefusal(code, status); };

  async function commitFor(entry: CacheEntry, sha: string): Promise<WorkspaceResult<ReadonlyMap<string, Uint8Array>>> {
    const cached = entry.commits.get(sha);
    if (cached) { stats.cache_hits++; return { ok: true, value: cached }; }
    const flight = `${entry.key}@${sha}`, pending = inflight.get(flight);
    if (pending) { stats.cache_hits++; return pending; }
    stats.cache_misses++;
    const work = (async (): Promise<WorkspaceResult<ReadonlyMap<string, Uint8Array>>> => {
      stats.fetches++;
      const fetched = await remote.fetchCommit(entry.repo_id, sha, new Set(entry.objects));
      if (!fetched || fetched.sha !== sha || !Array.isArray(fetched.objects) || !Array.isArray(fetched.files)) return refuse('fetch_unverified', 503);
      if (fetched.objects.some(o => !isExactSha(o.id) || !Number.isSafeInteger(o.bytes) || o.bytes < 0)) return refuse('fetch_unverified', 503);
      const files = new Map<string, Uint8Array>();
      for (const [path, bytes] of fetched.files) {
        if (!workspacePath(path) || !(bytes instanceof Uint8Array) || files.has(path)) return refuse('fetch_unverified', 503);
        files.set(path, new Uint8Array(bytes));
      }
      for (const o of fetched.objects) if (!entry.objects.has(o.id)) { entry.objects.add(o.id); entry.bytes += o.bytes; stats.clone_bytes += o.bytes; }
      entry.commits.set(sha, files);
      return { ok: true, value: files };
    })();
    inflight.set(flight, work);
    try { return await work; } finally { inflight.delete(flight); }
  }

  return {
    provider, region, stats,
    /** A new private worktree for one task attempt at the spec's exact `base_sha`, after a fresh repository authorization. */
    async checkout(input: WorkspaceSpec): Promise<WorkspaceResult<Worktree>> {
      const parsed = workspaceSpecSchema.safeParse(input);
      if (!parsed.success) return refuse(isExactSha((input as WorkspaceSpec | null)?.base_sha) ? 'invalid_workspace_spec' : 'invalid_base_sha', 422);
      const spec = parsed.data;
      const key = gitCacheKey(provider, region, spec.tenant_id, spec.repo_id);
      if (!key) return refuse('invalid_cache_scope', 422);
      const grant = await access.authorize(spec.tenant_id, spec.repo_id);
      if (!grant || grant.allowed !== true) return refuse('repo_access_revoked', 403);
      const id = `wt-${spec.tenant_id}-${spec.run_id}-g${spec.execution_generation}`;
      if (live.has(id)) return refuse('worktree_exists');
      let entry = entries.get(key);
      if (!entry) { entry = { key, tenant_id: spec.tenant_id, repo_id: spec.repo_id, objects: new Set(), commits: new Map(), bytes: 0, last_used: clock(), worktrees: new Set() }; entries.set(key, entry); }
      if (entry.tenant_id !== spec.tenant_id || entry.repo_id !== spec.repo_id) return refuse('cache_scope_mismatch', 403);
      live.add(id);
      const base = await commitFor(entry, spec.base_sha);
      if (!base.ok) { live.delete(id); return base; }
      entry.last_used = clock(); entry.worktrees.add(id);
      const owner = entry;
      const worktree = new Worktree({ id, cache_key: key, spec, provider, region }, base.value, tree => { live.delete(tree.id); owner.worktrees.delete(tree.id); owner.last_used = clock(); });
      return { ok: true, value: worktree };
    },
    /** Derived mirror data only: idle/over-budget entries with no open worktree. GitHub is canonical and is never touched. */
    evict(policy: CacheEvictionPolicy): string[] {
      if (!Number.isSafeInteger(policy.idle_ttl_ms) || policy.idle_ttl_ms < 0 || !Number.isSafeInteger(policy.max_bytes_per_tenant) || policy.max_bytes_per_tenant < 0) throw new Error('Invalid eviction policy');
      const now = clock(), evicted: string[] = [];
      const idle = [...entries.values()].filter(e => e.worktrees.size === 0).sort((a, b) => a.last_used - b.last_used);
      for (const e of idle) if (now >= e.last_used + policy.idle_ttl_ms) { entries.delete(e.key); evicted.push(e.key); }
      const byTenant = new Map<number, number>();
      for (const e of entries.values()) byTenant.set(e.tenant_id, (byTenant.get(e.tenant_id) ?? 0) + e.bytes);
      for (const e of idle) {
        if (!entries.has(e.key) || (byTenant.get(e.tenant_id) ?? 0) <= policy.max_bytes_per_tenant) continue;
        entries.delete(e.key); evicted.push(e.key); byTenant.set(e.tenant_id, (byTenant.get(e.tenant_id) ?? 0) - e.bytes);
      }
      return evicted;
    },
    /** Counts only: no object ids, paths or content. */
    inventory(): { key: string; tenant_id: number; repo_id: number; objects: number; bytes: number; open_worktrees: number }[] {
      return [...entries.values()].map(e => ({ key: e.key, tenant_id: e.tenant_id, repo_id: e.repo_id, objects: e.objects.size, bytes: e.bytes, open_worktrees: e.worktrees.size }));
    },
    /** Cache bytes plus open worktree bytes are what the executor's disk holds. */
    diskBytes(open: Iterable<Worktree> = []): number {
      let total = 0; for (const e of entries.values()) total += e.bytes;
      for (const tree of open) if (tree.open && tree.provider === provider && tree.region === region) total += tree.bytes();
      return total;
    },
  };
}
export type GitCache = ReturnType<typeof createGitCache>;
