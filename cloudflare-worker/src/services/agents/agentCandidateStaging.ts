/**
 * D5569 part 4 (#5569): unmounted privileged candidate staging. From an approved publish intent and its file bytes it
 * computes the exact single-parent Git candidate locally (blob, tree and commit SHAs on the verified base), writes only
 * content-addressed objects through an injected repository-scoped transport, and returns the candidate SHA and the
 * digest of GitHub's base-to-candidate diff that `executeAgentPublication` requires. It never creates or moves a ref,
 * never sees a credential, has no D1 access and no clock of its own. A re-run reproduces the same SHAs and writes
 * nothing; an unanswered write is re-read by its expected SHA, never assumed.
 */
import { classifyGithubResponse, publisherEnabled, publishIntentProblem, intentDigest, type PublishIntent } from './agentPublisher';

export const MAX_STAGED_FILE_BYTES = 1024 * 1024;
export const MAX_STAGED_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const NAME = /^[^<>\n\r\0]{1,100}$/;
const EMAIL = /^[^<>\s@]{1,100}@[^<>\s@]{1,100}$/;
/** Regular files only. A symlink, submodule or directory at a changed path needs a new contract. */
const REGULAR = new Set(['100644', '100755']);
const TREE_MODES = new Set(['100644', '100755', '120000', '160000', '40000']);

export type GitResponse = { status: number; body: string; headers: { get(name: string): string | null } };
/**
 * The broker's repository-scoped transport. It holds the short-lived installation credential, prefixes the fixed API
 * origin and `/repos/<owner>/<name>`, rejects redirects and bounds time and size. It throws when no response arrived.
 */
export type GitStagingTransport = {
  readonly repository_full_name: string;
  get(path: string, accept?: 'json' | 'diff'): Promise<GitResponse>;
  post(path: string, body: Record<string, unknown>): Promise<GitResponse>;
};
export type StagedFile = { path: string; content_base64: string };
export type StagingRequest = {
  intent: PublishIntent;
  /** Exactly one per added or modified file of the intent; none for a removed file. */
  files: StagedFile[];
  /** The write App's commit identity, configured by the broker, never by the workspace. */
  identity: { name: string; email: string };
  /** Fixed by the server for this intent (for example its reservation time) so a re-run reproduces the commit SHA. */
  committed_at_s: number;
  /** Limited responses in a row before this attempt, for backoff. */
  consecutive_limited?: number;
};
export type StagingPorts = { transport: GitStagingTransport; now(): number };

export type StagingRefusalCode =
  | 'publisher_disabled' | 'invalid_intent' | 'invalid_content' | 'unsupported_content' | 'repository_mismatch'
  | 'base_unknown' | 'base_moved' | 'candidate_conflict' | 'candidate_mismatch' | 'patch_digest_mismatch'
  | 'github_unauthorized' | 'github_forbidden' | 'github_rate_limited' | 'github_rejected' | 'github_unavailable'
  | 'staging_unknown';
export type StagingRefusal = { ok: false; code: StagingRefusalCode; retryable: boolean; retry_at?: string; field?: string; paths?: string[] };
export type StagedCandidate = {
  ok: true; candidate_sha: string; tree_sha: string; base_sha: string; patch_digest: string;
  /** The candidate already existed: nothing was written. */
  replayed: boolean;
  writes: number;
};
export type StagingResult = StagedCandidate | StagingRefusal;

type Entry = { mode: string; type: 'blob' | 'tree' | 'commit'; sha: string };
type Json = Record<string, unknown>;

class Refused extends Error {
  readonly refusal: StagingRefusal;
  constructor(refusal: StagingRefusal) { super(refusal.code); this.refusal = refusal; }
}
const refuse = (code: StagingRefusalCode, retryable: boolean, extra: Omit<StagingRefusal, 'ok' | 'code' | 'retryable'> = {}): never => {
  throw new Refused({ ok: false, code, retryable, ...extra });
};

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
};

/** Git's object id: SHA-1 of `<type> <length>\0<body>`. */
export async function gitObjectSha(type: 'blob' | 'tree' | 'commit', body: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-1', concat([enc.encode(type + ' ' + body.byteLength + '\0'), body])));
}

/** Git orders a tree by name bytes, a subtree's name compared as if it ended in `/`. */
function treeBody(entries: Map<string, Entry>): Uint8Array {
  const key = (name: string, e: Entry) => enc.encode(e.type === 'tree' ? name + '/' : name);
  const sorted = [...entries].map(([name, e]) => ({ name, e, k: key(name, e) })).sort((a, b) => {
    for (let i = 0; i < Math.min(a.k.length, b.k.length); i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
    return a.k.length - b.k.length;
  });
  return concat(sorted.flatMap(({ name, e }) => [
    enc.encode(e.mode + ' ' + name + '\0'),
    Uint8Array.from(e.sha.match(/../g)!.map(h => parseInt(h, 16))),
  ]));
}

function decodeContent(path: string, base64: unknown): Uint8Array {
  if (typeof base64 !== 'string') return refuse('invalid_content', false, { field: path });
  let binary: string;
  try { binary = atob(base64); } catch { return refuse('invalid_content', false, { field: path }); }
  if (btoa(binary) !== base64) refuse('invalid_content', false, { field: path });
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (bytes.byteLength > MAX_STAGED_FILE_BYTES) refuse('invalid_content', false, { field: path });
  // The diff digest binds content only when GitHub renders it as text: no NUL byte, valid UTF-8.
  if (bytes.includes(0)) refuse('unsupported_content', false, { field: path });
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { refuse('unsupported_content', false, { field: path }); }
  return bytes;
}

/** Trusted fields only: the agent's summary and log never enter the commit. */
async function commitMessage(intent: PublishIntent): Promise<string> {
  const p = intent.provenance;
  return 'agent/' + p.task_id + '/' + p.attempt + ': staged candidate\n\n'
    + 'StudioOS-Agent: ' + p.agent_id + '\nStudioOS-Task: ' + p.task_id + '\nStudioOS-Run: ' + p.run_uuid
    + '\nStudioOS-Intent: ' + await intentDigest(intent) + '\nStudioOS-Patch: ' + intent.patch_digest + '\n';
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Disabled by default. No route, queue handler or Env binding calls this entry point. */
export async function stageAgentCandidate(request: StagingRequest, flag: unknown, ports: StagingPorts): Promise<StagingResult> {
  if (!publisherEnabled(flag)) return { ok: false, code: 'publisher_disabled', retryable: false };
  const intent = request?.intent;
  const invalid = publishIntentProblem(intent);
  if (invalid) return { ok: false, code: 'invalid_intent', retryable: false, field: invalid };
  const t = ports.transport;
  if (typeof t?.repository_full_name !== 'string' || !sameRepo(t.repository_full_name, intent.repository_full_name)) {
    return { ok: false, code: 'repository_mismatch', retryable: false };
  }
  const { identity, committed_at_s: at } = request;
  if (!identity || !NAME.test(identity.name) || identity.name.trim() !== identity.name || !EMAIL.test(identity.email)) {
    return { ok: false, code: 'invalid_content', retryable: false, field: 'identity' };
  }
  if (!Number.isSafeInteger(at) || at <= 0) return { ok: false, code: 'invalid_content', retryable: false, field: 'committed_at_s' };
  let writes = 0;
  try {
    // 1. Exactly the declared bytes: one per added/modified path, none for a removal, nothing else.
    const staged = Array.isArray(request.files) ? request.files : refuse('invalid_content', false, { field: 'files' });
    const byPath = new Map<string, Uint8Array>();
    let total = 0;
    for (const file of staged) {
      const declared = intent.files.find(f => f.path === file?.path);
      if (!declared || declared.change === 'removed' || byPath.has(file.path)) refuse('invalid_content', false, { field: String(file?.path) });
      const bytes = decodeContent(file.path, file.content_base64);
      total += bytes.byteLength;
      byPath.set(file.path, bytes);
    }
    if (total > MAX_STAGED_BYTES) refuse('invalid_content', false, { field: 'files' });
    const unstaged = intent.files.filter(f => f.change !== 'removed' && !byPath.has(f.path)).map(f => f.path);
    if (unstaged.length) refuse('invalid_content', false, { field: 'files', paths: unstaged });

    const call = async (method: 'get' | 'post', path: string, body?: Json, accept?: 'json' | 'diff') => {
      if (method === 'post') writes++;
      const response = method === 'post' ? await t.post(path, body!) : await t.get(path, accept);
      if (typeof response?.body !== 'string' || enc.encode(response.body).byteLength > MAX_RESPONSE_BYTES) throw new Error('unreadable');
      return response;
    };
    const failure = (response: GitResponse, notFound: StagingRefusalCode): never => {
      const s = response.status;
      if (s === 401) refuse('github_unauthorized', false);
      if (s === 403 || s === 429) {
        const seconds = response.headers.get('retry-after');
        const g = classifyGithubResponse({
          status: s, at_ms: ports.now(), consecutive: (request.consecutive_limited ?? 0) + 1,
          secondary: /secondary rate limit|abuse detection/i.test(response.body),
          retry_after_s: seconds === null ? null : Number(seconds),
          ratelimit_remaining: response.headers.get('x-ratelimit-remaining') === '0' ? 0 : null,
          ratelimit_reset_s: Number(response.headers.get('x-ratelimit-reset')) || null,
        });
        if (g.kind === 'rate_limited') refuse('github_rate_limited', true, { retry_at: new Date(g.retry_at_ms).toISOString() });
        refuse('github_forbidden', false);
      }
      if (s === 404) refuse(notFound, false);
      if (s === 409 || s === 422) refuse('github_rejected', false);
      return refuse('github_unavailable', true);
    };
    const parse = (response: GitResponse): Json | null => {
      try { const v = JSON.parse(response.body); return v && typeof v === 'object' && !Array.isArray(v) ? v as Json : null; } catch { return null; }
    };
    /** A read: a missing answer is safe to retry later. */
    const read = async (path: string, notFound: StagingRefusalCode): Promise<Json> => {
      let response: GitResponse;
      try { response = await call('get', path); } catch { return refuse('github_unavailable', true); }
      if (response.status !== 200) failure(response, notFound);
      return parse(response) ?? refuse('github_unavailable', true);
    };
    /** Does the object with this expected SHA exist? `null` when GitHub did not say. */
    const exists = async (kind: 'blobs' | 'trees' | 'commits', sha: string): Promise<boolean | null> => {
      try {
        const response = await call('get', '/git/' + kind + '/' + sha);
        if (response.status === 404) return false;
        return response.status === 200 && parse(response)?.sha === sha ? true : null;
      } catch { return null; }
    };
    /** A content-addressed write. An unanswered one is re-read by its SHA, never assumed either way. */
    const write = async (kind: 'blobs' | 'trees' | 'commits', body: Json, expected: string) => {
      let response: GitResponse | null = null;
      try { response = await call('post', '/git/' + kind, body); } catch { response = null; }
      if (response && response.status >= 200 && response.status < 300) {
        const returned = parse(response)?.sha;
        if (typeof returned === 'string' && SHA.test(returned)) {
          if (returned !== expected) refuse('candidate_mismatch', false);
          return;
        }
      } else if (response && response.status < 500) failure(response, 'github_rejected');
      if (await exists(kind, expected) !== true) refuse('staging_unknown', true);
    };

    // 2. The verified base: the protected ref still points at the approved SHA, and its tree.
    const refPath = '/git/ref/' + intent.target_ref.slice('refs/'.length).split('/').map(encodeURIComponent).join('/');
    const ref = await read(refPath, 'base_unknown');
    if ((ref.object as { sha?: unknown } | undefined)?.sha !== intent.base_sha) refuse('base_moved', false);
    const baseCommit = await read('/git/commits/' + intent.base_sha, 'base_unknown');
    const baseTree = (baseCommit.tree as { sha?: unknown } | undefined)?.sha;
    if (baseCommit.sha !== intent.base_sha || typeof baseTree !== 'string' || !SHA.test(baseTree)) refuse('github_unavailable', true);

    // 3. Load each directory on a changed path, checking GitHub's entries hash to the tree SHA it named.
    const dirs = new Map<string, Map<string, Entry>>();
    const loadTree = async (sha: string) => {
      const tree = await read('/git/trees/' + sha, 'base_unknown');
      const listed = tree.tree;
      if (tree.sha !== sha || tree.truncated !== false || !Array.isArray(listed)) return refuse('candidate_mismatch', false);
      const entries = new Map<string, Entry>();
      for (const raw of listed as Json[]) {
        const mode = String(raw?.mode).replace(/^0+(?=40000$)/, '');
        const type = raw?.type;
        if (typeof raw?.path !== 'string' || !raw.path || raw.path.includes('/') || entries.has(raw.path) || !TREE_MODES.has(mode)
            || (type !== 'blob' && type !== 'tree' && type !== 'commit') || typeof raw.sha !== 'string' || !SHA.test(raw.sha)) {
          return refuse('candidate_mismatch', false);
        }
        entries.set(raw.path, { mode, type, sha: raw.sha });
      }
      if (await gitObjectSha('tree', treeBody(entries)) !== sha) refuse('candidate_mismatch', false);
      return entries;
    };
    const load = async (dir: string): Promise<Map<string, Entry> | null> => {
      if (dirs.has(dir)) return dirs.get(dir)!;
      let entries: Map<string, Entry> | null;
      if (dir === '') entries = await loadTree(baseTree as string);
      else {
        const parent = await load(dirOf(dir));
        const entry = parent?.get(baseName(dir));
        if (entry && entry.type !== 'tree') refuse('candidate_conflict', false, { paths: [dir] });
        entries = entry ? await loadTree(entry.sha) : new Map();
      }
      dirs.set(dir, entries!);
      return entries;
    };

    // 4. Apply exactly the declared operations to regular files.
    const blobs = new Map<string, { sha: string; base64: string }>();
    const changes: Json[] = [];
    for (const file of intent.files) {
      const dir = dirOf(file.path);
      const entries = (await load(dir))!;
      const existing = entries.get(baseName(file.path));
      const conflict = () => refuse('candidate_conflict', false, { paths: [file.path] });
      if (file.change === 'added' ? existing : !existing || existing.type !== 'blob' || !REGULAR.has(existing.mode)) conflict();
      if (file.change === 'removed') {
        entries.delete(baseName(file.path));
        changes.push({ path: file.path, mode: existing!.mode, type: 'blob', sha: null });
        continue;
      }
      const bytes = byPath.get(file.path)!;
      const sha = await gitObjectSha('blob', bytes);
      if (existing?.sha === sha) conflict();
      const mode = existing?.mode ?? '100644';
      entries.set(baseName(file.path), { mode, type: 'blob', sha });
      blobs.set(sha, { sha, base64: staged.find(s => s.path === file.path)!.content_base64 });
      changes.push({ path: file.path, mode, type: 'blob', sha });
    }
    // An added file may not stand where the candidate needs a directory.
    const clash = intent.files.filter(f => f.change === 'added' && dirs.has(f.path)).map(f => f.path);
    if (clash.length) refuse('candidate_conflict', false, { paths: clash });

    // 5. The expected trees bottom-up (an emptied directory disappears), then the commit.
    const depth = (d: string) => (d === '' ? 0 : d.split('/').length);
    let treeSha = '';
    for (const dir of [...dirs.keys()].sort((a, b) => depth(b) - depth(a))) {
      const entries = dirs.get(dir)!;
      const sha = await gitObjectSha('tree', treeBody(entries));
      if (dir === '') { treeSha = sha; continue; }
      const parent = dirs.get(dirOf(dir))!;
      if (entries.size) parent.set(baseName(dir), { mode: '40000', type: 'tree', sha });
      else parent.delete(baseName(dir));
    }
    const stamp = String(at) + ' +0000';
    const person = identity.name + ' <' + identity.email + '> ' + stamp;
    const message = await commitMessage(intent);
    const candidate = await gitObjectSha('commit', enc.encode(
      'tree ' + treeSha + '\nparent ' + intent.base_sha + '\nauthor ' + person + '\ncommitter ' + person + '\n\n' + message));

    // 6. A duplicate attempt finds the candidate by its content address and writes nothing.
    const already = await exists('commits', candidate);
    if (already === null) refuse('github_unavailable', true);
    if (!already) {
      for (const blob of blobs.values()) await write('blobs', { content: blob.base64, encoding: 'base64' }, blob.sha);
      await write('trees', { base_tree: baseTree, tree: changes }, treeSha);
      const date = new Date(at * 1000).toISOString().replace('.000Z', 'Z');
      const who = { name: identity.name, email: identity.email, date };
      await write('commits', { message, tree: treeSha, parents: [intent.base_sha], author: who, committer: who }, candidate);
    }

    // 7. What executeAgentPublication will check: one commit, exactly these paths and operations, the diff digest.
    const comparePath = '/compare/' + intent.base_sha + '...' + candidate;
    const comparison = await read(comparePath, 'candidate_mismatch');
    const listed = comparison.files as { filename?: unknown; status?: unknown }[] | undefined;
    if (comparison.total_commits !== 1 || !Array.isArray(listed) || listed.length !== intent.files.length
        || intent.files.some(f => listed.filter(l => l?.filename === f.path && l.status === f.change).length !== 1)) {
      refuse('candidate_mismatch', false);
    }
    let diff: GitResponse;
    try { diff = await call('get', comparePath, undefined, 'diff'); } catch { return refuse('github_unavailable', true); }
    if (diff.status !== 200) failure(diff, 'candidate_mismatch');
    const digest = 'sha256:' + hex(await crypto.subtle.digest('SHA-256', enc.encode(diff.body)));
    if (digest !== intent.patch_digest) refuse('patch_digest_mismatch', false);
    return { ok: true, candidate_sha: candidate, tree_sha: treeSha, base_sha: intent.base_sha, patch_digest: digest, replayed: !!already, writes };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    return { ok: false, code: writes ? 'staging_unknown' : 'github_unavailable', retryable: true };
  }
}
