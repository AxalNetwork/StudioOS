#!/usr/bin/env node
/**
 * D1519 (#3771, deck v2 A20) — a changed deck prompt must come with its eval.
 *
 * Every file in `cloudflare-worker/src/services/decks/prompts/` is hashed
 * (sha256 over each file's name and bytes, in name order). The hash the eval
 * last ran against is recorded in `documentation/product/ELEMENT_EVAL.md` as
 * `<!-- prompts-hash: <hex> -->` (D1518's harness). A prompt changed without
 * the eval being re-run fails, unless the pull request carries the owner's
 * `prompt-eval-waiver` label (`PROMPT_EVAL_WAIVER=true`, set by
 * `.github/workflows/prompt-eval-gate.yml`).
 *
 * Usage (from the repository root):
 *   node scripts/check-prompt-eval.mjs           check
 *   node scripts/check-prompt-eval.mjs --write   record the current hash after re-running the eval
 *
 * Exit codes: 0 the hash matches, or the PR is waived; 1 a prompt changed with
 * no eval update; 2 the check could not be made (no prompts, no record).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'check-prompt-eval';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROMPTS_DIR = resolve(root, 'cloudflare-worker/src/services/decks/prompts');
export const EVAL_DOC = resolve(root, 'documentation/product/ELEMENT_EVAL.md');
const MARK = /<!-- prompts-hash: ([0-9a-f]{64}) -->/;

/** The hash of a prompt set: `files` is [[name, contents]], hashed in name order. */
export function promptsHash(files) {
  const h = createHash('sha256');
  for (const [name, body] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) h.update(`${name}\0${body}\0`);
  return h.digest('hex');
}

/** The prompt files on disk, as [[name, contents]]. */
export function promptFiles(dir = PROMPTS_DIR) {
  return readdirSync(dir).filter((n) => n.endsWith('.ts')).map((n) => [n, readFileSync(resolve(dir, n), 'utf8')]);
}

/** The hash ELEMENT_EVAL.md records, or null. */
export const recordedHash = (doc) => MARK.exec(String(doc))?.[1] ?? null;

/** The verdict: `{ code, line }`. */
export function verdict({ current, recorded, waived }) {
  if (!recorded) return { code: 2, line: 'ELEMENT_EVAL.md records no prompts-hash, so there is nothing to compare against.' };
  if (current === recorded) return { code: 0, line: 'the deck prompts are the ones the element eval last ran against.' };
  if (waived) return { code: 0, line: `the deck prompts changed (${current.slice(0, 12)} ≠ ${recorded.slice(0, 12)}), waived by the owner's prompt-eval-waiver label.` };
  return { code: 1, line: `a deck prompt changed (${current.slice(0, 12)} ≠ ${recorded.slice(0, 12)}) and ELEMENT_EVAL.md was not updated. Re-run the element eval and record the hash (node scripts/check-prompt-eval.mjs --write), or ask the owner for the prompt-eval-waiver label.` };
}

function main() {
  let files;
  try { files = promptFiles(); } catch { console.error(`✖ ${NAME}: ${PROMPTS_DIR} could not be read.`); return 2; }
  if (!files.length) { console.error(`✖ ${NAME}: no prompt files.`); return 2; }
  const current = promptsHash(files);
  const doc = readFileSync(EVAL_DOC, 'utf8');
  if (process.argv.includes('--write')) {
    writeFileSync(EVAL_DOC, recordedHash(doc) ? doc.replace(MARK, `<!-- prompts-hash: ${current} -->`) : `${doc.trimEnd()}\n\n<!-- prompts-hash: ${current} -->\n`);
    console.log(`✓ ${NAME}: recorded ${current}.`);
    return 0;
  }
  const v = verdict({ current, recorded: recordedHash(doc), waived: process.env.PROMPT_EVAL_WAIVER === 'true' });
  (v.code === 0 ? console.log : console.error)(`${v.code === 0 ? '✓' : '✖'} ${NAME}: ${v.line}`);
  return v.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
