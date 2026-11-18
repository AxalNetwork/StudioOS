// #6473: what a patch may contain, checked when it is made and again, independently, before verify applies it.
import { sha256 } from './workspace.mjs';
import { safeRelativePath } from './task.mjs';

const START = /^<{7}(?: |$)/m;
const END = /^>{7}(?: |$)/m;
const MID = /^={7}$/m;

/** True when text holds a merge conflict block (a lone `=======` is a Markdown underline, so it alone is not). */
export function hasConflictMarkers(text) {
  if (typeof text !== 'string') return false;
  return START.test(text) || END.test(text) || (MID.test(text) && (START.test(text) || END.test(text)));
}

/**
 * Problems with a set of changes `[{ path, before, after }]` against the allowed list.
 * An empty list means the patch may be emitted.
 */
export function checkChanges(changes, allowed, { resolving = false } = {}) {
  const allow = new Set(allowed);
  const problems = [];
  if (!changes.length) problems.push('the patch changes nothing');
  for (const c of changes) {
    if (!safeRelativePath(c.path) || !allow.has(c.path)) problems.push(`touches a file outside the allowed list: ${c.path}`);
    if (c.after === null || c.after === undefined) problems.push(`deletes a file: ${c.path}`);
    else if (hasConflictMarkers(c.after) && (resolving || !hasConflictMarkers(c.before ?? ''))) {
      problems.push(resolving ? `leaves conflict markers: ${c.path}` : `adds conflict markers: ${c.path}`);
    }
  }
  // #6475: a resolution resolves every conflicted file, so each allowed file must be in the patch.
  if (resolving) for (const p of allow) if (!changes.some((c) => c.path === p)) problems.push(`leaves ${p} unresolved`);
  return problems;
}

/** The manifest the edit job emits. Callers treat it as untrusted and re-check it with main's code. */
export function manifestFor({ baseSha, round, result, changes }) {
  return {
    version: 1,
    base_sha: baseSha,
    round,
    provider: result.provider,
    model: result.model,
    turns: result.turns,
    attempts: result.attempts,
    files: changes.map((c) => ({ path: c.path, before_sha256: c.before === null ? null : sha256(c.before), after_sha256: sha256(c.after) })),
  };
}

/** The patch the edit job emits: whole-file replacements, text only. */
export function patchFor({ baseSha, changes }) {
  return { version: 1, base_sha: baseSha, files: changes.map((c) => ({ path: c.path, content: c.after })) };
}

/**
 * Problems with a patch before verify (or a caller) applies it, read again with
 * main's code: it must name exactly the manifest's files, all allowed, its
 * contents must hash to the manifest, and `readBefore(path)` (the checkout's
 * current text, or null) must hash to the manifest's before value.
 */
export function checkPatch(patch, manifest, allowed, readBefore, { resolving = false } = {}) {
  const problems = [];
  if (patch?.version !== 1 || !Array.isArray(patch.files) || !patch.files.length) return ['the patch is malformed or empty'];
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) return ['the manifest is malformed'];
  if (patch.base_sha !== manifest.base_sha) problems.push('the patch and its manifest name different base commits');
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  const seen = new Set();
  const changes = [];
  for (const f of patch.files) {
    if (typeof f?.path !== 'string' || typeof f.content !== 'string') { problems.push('a patch entry is not a path and text'); continue; }
    if (seen.has(f.path)) problems.push(`the patch repeats ${f.path}`);
    seen.add(f.path);
    const m = byPath.get(f.path);
    if (!m) { problems.push(`the manifest does not name ${f.path}`); continue; }
    if (sha256(f.content) !== m.after_sha256) problems.push(`the content of ${f.path} does not match the manifest`);
    const before = readBefore(f.path);
    if ((before === null ? null : sha256(before)) !== m.before_sha256) problems.push(`${f.path} is not the file the patch was made from`);
    changes.push({ path: f.path, before, after: f.content });
  }
  for (const p of byPath.keys()) if (!seen.has(p)) problems.push(`the patch leaves out ${p}, which the manifest names`);
  problems.push(...checkChanges(changes, allowed, { resolving }).filter((x) => x !== 'the patch changes nothing'));
  return problems;
}
