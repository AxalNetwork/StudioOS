/**
 * D5620: evaluate({base, head}) classifies GitHub's three-dot compare file
 * list with the bundled classifier and fails closed. A list at the 300-file
 * cap, a file without a patch, a malformed response, any API error, any
 * exception and a timeout all return T2 with `action_required`. Only a
 * completed classification of T0 or T1 returns `success`. Posting the check
 * is #5990; this module makes no write.
 *
 * The compare API carries no file mode, so the head commit's recursive tree
 * supplies it: each surviving path gets its head mode, as the script's
 * `git diff --raw` destination mode does, and a symlink or submodule is T2
 * (owner, 2026-11-14). A truncated or malformed tree, or a changed path
 * missing from it, is T2.
 */
import { classify, POLICY_VERSION } from './policy.ts';
import type { ChangedFile, Tier } from './policy.ts';
import { comparePath, treePath } from './github.ts';
import type { GithubApi } from './types.ts';

/** The compare API returns at most 300 files; a list that long cannot prove it is complete. */
export const COMPARE_FILE_CAP = 300;
export const EVALUATE_TIMEOUT_MS = 15_000;
const MAX_REASONS = 50;
const SHA = /^[a-f0-9]{40}$/;
const STATUS: Readonly<Record<string, string>> = { added: 'A', removed: 'D', modified: 'M', renamed: 'R', copied: 'C' };

export type Conclusion = 'success' | 'action_required';
export interface PolicyResult {
  readonly conclusion: Conclusion;
  readonly tier: Tier;
  readonly reasons: readonly string[];
  readonly policy_version: string;
  readonly base: string;
  readonly head: string;
}
export interface EvaluateOptions { api: GithubApi; timeoutMs?: number }

class Refusal extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) { super(reasons[0]); this.reasons = reasons; }
}

function result(input: { base?: unknown; head?: unknown }, tier: Tier, reasons: string[], classified: boolean): PolicyResult {
  const passing = classified && (tier === 'T0' || tier === 'T1');
  return Object.freeze({
    conclusion: passing ? 'success' : 'action_required',
    tier: passing ? tier : 'T2',
    reasons: Object.freeze(reasons.slice(0, MAX_REASONS)),
    policy_version: POLICY_VERSION,
    base: typeof input.base === 'string' ? input.base : '',
    head: typeof input.head === 'string' ? input.head : '',
  });
}

/** Map one compare entry to the classifier's shape, or name why it cannot be classified. */
function changedFile(entry: unknown, problems: string[]): ChangedFile | null {
  if (!entry || typeof entry !== 'object') { problems.push('T2: malformed compare entry'); return null; }
  const { filename, status, previous_filename: previousPath, patch } = entry as Record<string, unknown>;
  if (typeof filename !== 'string' || filename === '') { problems.push('T2: compare entry without a file name'); return null; }
  const code = typeof status === 'string' ? STATUS[status] : undefined;
  if (!code) { problems.push(`T2: unsupported compare status: ${filename}`); return null; }
  if ((code === 'R' || code === 'C') && (typeof previousPath !== 'string' || previousPath === '')) {
    problems.push(`T2: rename or copy without a previous path: ${filename}`); return null;
  }
  if (typeof patch !== 'string' || patch === '') { problems.push(`T2: no patch in the compare response: ${filename}`); return null; }
  return { path: filename, status: code, patch, ...(typeof previousPath === 'string' ? { previousPath } : {}) };
}

const MODE = /^[0-7]{6}$/;

/** Head modes for every path in the head commit; refuses when GitHub truncated the tree. */
async function headModes(api: GithubApi, head: string): Promise<Map<string, string>> {
  let response: unknown;
  try {
    response = await api('GET', treePath(head));
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    throw new Refusal([`T2: GitHub tree unavailable${typeof status === 'number' ? ` (HTTP ${status})` : ''}`]);
  }
  const { tree, truncated } = (response ?? {}) as { tree?: unknown; truncated?: unknown };
  if (truncated !== false) throw new Refusal(['T2: head tree is truncated or does not say it is complete']);
  if (!Array.isArray(tree)) throw new Refusal(['T2: tree response has no entry list']);
  const modes = new Map<string, string>();
  for (const entry of tree) {
    const { path, mode } = (entry ?? {}) as { path?: unknown; mode?: unknown };
    if (typeof path !== 'string' || typeof mode !== 'string' || !MODE.test(mode)) {
      throw new Refusal(['T2: malformed tree entry']);
    }
    modes.set(path, mode);
  }
  return modes;
}

/** Give each file its head mode; a deletion has none, like the script's 000000. */
function withModes(files: ChangedFile[], modes: Map<string, string>): ChangedFile[] {
  const missing: string[] = [];
  const out = files.map((file) => {
    if (file.status === 'D') return { ...file, mode: '000000' };
    const mode = modes.get(file.path);
    if (!mode) { missing.push(`T2: changed path not in the head tree: ${file.path}`); return file; }
    return { ...file, mode };
  });
  if (missing.length) throw new Refusal(missing.sort());
  return out;
}

async function compareFiles(api: GithubApi, base: string, head: string): Promise<ChangedFile[]> {
  let response: unknown;
  try {
    response = await api('GET', comparePath(base, head));
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    throw new Refusal([`T2: GitHub compare unavailable${typeof status === 'number' ? ` (HTTP ${status})` : ''}`]);
  }
  const files = (response as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) throw new Refusal(['T2: compare response has no file list']);
  if (files.length >= COMPARE_FILE_CAP) {
    throw new Refusal([`T2: compare list reached the ${COMPARE_FILE_CAP}-file cap and may be truncated`]);
  }
  const problems: string[] = [];
  const changed = files.map((entry) => changedFile(entry, problems));
  if (problems.length) throw new Refusal(problems.sort());
  return changed.filter((file): file is ChangedFile => file !== null);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Refusal([`T2: evaluation exceeded ${ms} ms`])), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Classify the merge-base diff of head against base. Never throws: every
 * failure is a T2 `action_required` result naming the cause.
 */
export async function evaluate(input: { base: string; head: string }, options: EvaluateOptions): Promise<PolicyResult> {
  const given: { base?: unknown; head?: unknown } = input ?? {};
  try {
    const { base, head } = given;
    if (typeof base !== 'string' || typeof head !== 'string' || !SHA.test(base) || !SHA.test(head)) {
      return result(given, 'T2', ['T2: base and head must be full commit SHAs'], false);
    }
    const ms = options?.timeoutMs ?? EVALUATE_TIMEOUT_MS;
    if (!Number.isSafeInteger(ms) || ms <= 0 || ms > EVALUATE_TIMEOUT_MS) {
      return result(input, 'T2', ['T2: invalid evaluation timeout'], false);
    }
    if (typeof options?.api !== 'function') return result(input, 'T2', ['T2: no GitHub client'], false);
    const api = options.api;
    const files = await withTimeout(
      Promise.all([compareFiles(api, base, head), headModes(api, head)]).then(([changed, modes]) => withModes(changed, modes)),
      ms,
    );
    const { tier, reasons } = classify(files);
    return result(input, tier, reasons, true);
  } catch (error) {
    const reasons = error instanceof Refusal ? error.reasons : ['T2: classification failed'];
    return result(given, 'T2', reasons, false);
  }
}
