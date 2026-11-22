/**
 * D8067 (#8067): the privileged paths, for the gates that are not code. The list itself is
 * `merge-control/src/lib/classify.mjs` PRIVILEGED_PATHS: that file must stay import-free for the Merge Control
 * Worker's bundle, and every landing-bot workflow already checks it out, so the list lives there and this module
 * re-exports it. From it come the CODEOWNERS block (`codeownersBlock`, checked against `.github/CODEOWNERS`) and
 * the ruleset's file-path condition (`rulesetPaths`, printed by `scripts/check-privileged-paths.mjs` for #8060).
 */
import { PRIVILEGED, PRIVILEGED_PATHS, globRegExp, isPrivileged, privilegedFiles } from '../merge-policy.mjs';

export { PRIVILEGED, PRIVILEGED_PATHS, globRegExp, isPrivileged, privilegedFiles };

export const OWNER = '@guillaumelauzier';
export const CODEOWNERS_BEGIN = '# privileged:begin — generated from the privileged-path list; node scripts/check-privileged-paths.mjs --write (D8067)';
export const CODEOWNERS_END = '# privileged:end';

/** A glob as CODEOWNERS writes it: anchored at the root unless it starts with `**`. */
const codeownersPattern = (glob) => (glob.startsWith('**/') ? glob : `/${glob}`);

/** The generated CODEOWNERS block: each entry's reason as a comment, then its pattern and the owner. */
export function codeownersBlock(owner = OWNER) {
  const width = Math.max(...PRIVILEGED_PATHS.map(({ glob }) => codeownersPattern(glob).length)) + 2;
  const lines = [CODEOWNERS_BEGIN];
  let last = null;
  for (const { glob, why } of PRIVILEGED_PATHS) {
    if (why !== last) lines.push(`# ${why}`);
    last = why;
    lines.push(`${codeownersPattern(glob).padEnd(width)}${owner}`);
  }
  lines.push(CODEOWNERS_END);
  return lines.join('\n');
}

/** The block as it stands in a CODEOWNERS text, or null when its markers are missing or out of order. */
export function codeownersBlockIn(text) {
  const s = String(text ?? '');
  const a = s.indexOf(CODEOWNERS_BEGIN);
  const b = s.indexOf(CODEOWNERS_END, a + 1);
  return a < 0 || b < 0 ? null : s.slice(a, b + CODEOWNERS_END.length);
}

/** A CODEOWNERS text with the block replaced, or appended last so it wins over `*` (the last match wins). */
export function withCodeownersBlock(text, owner = OWNER) {
  const s = String(text ?? '');
  const current = codeownersBlockIn(s);
  if (current) return s.replace(current, codeownersBlock(owner));
  return `${s.replace(/\n*$/, '\n\n')}${codeownersBlock(owner)}\n`;
}

/**
 * The ruleset's file-path condition (fnmatch). A name that is not already a folder's contents is also listed with
 * `/**`, so a folder of that name stays covered, as it is in CODEOWNERS and in the classifier.
 */
export function rulesetPaths() {
  return [...new Set(PRIVILEGED_PATHS.flatMap(({ glob }) => (glob.endsWith('/**') ? [glob] : [glob, `${glob}/**`])))];
}
