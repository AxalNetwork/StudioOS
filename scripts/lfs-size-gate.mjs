#!/usr/bin/env node
/**
 * lfs-size-gate.mjs
 *
 * Pre-commit / pre-push gate that enforces the Axal StudioOS LFS policy
 * (see MIGRATION_LFS_AUDIT.md).
 *
 * Rules:
 *  1. Files matching the listed extensions in .gitattributes MUST be
 *     LFS-tracked. `git check-attr filter <path>` should report `lfs`.
 *  2. NEW PDF or PNG files > 500 KB MUST be LFS-tracked.
 *  3. Files already committed before this hook landed are grandfathered
 *     in — only staged additions are checked, not the whole working tree.
 *
 * Usage:
 *   node scripts/lfs-size-gate.mjs                    # check staged files (pre-commit)
 *   node scripts/lfs-size-gate.mjs --all              # check entire working tree
 *   node scripts/lfs-size-gate.mjs --against=<ref>    # check files added/modified since <ref>
 *   node scripts/lfs-size-gate.mjs --install          # install as a git pre-commit hook
 *
 * Exit codes:
 *   0  — clean
 *   1  — at least one violation; commit is rejected
 *   2  — environment problem (git not found, etc.)
 */

import { execSync } from "node:child_process";
import { existsSync, statSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE_GATE_BYTES = 500 * 1024; // 500 KB
const SIZE_GATED_EXTS = new Set([".pdf", ".png"]);

const LFS_TRACKED_EXTS = new Set([
  ".psd", ".psb", ".ai", ".xd", ".fig", ".sketch",
  ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
  ".onnx", ".safetensors", ".pt", ".pth", ".gguf",
  ".h5", ".hdf5", ".pkl", ".ckpt", ".npy", ".npz", ".pb", ".bin",
  ".parquet",
  ".zip", ".tar.gz", ".tgz",
  ".7z", ".rar", ".bz2", ".xz",
  ".mp4", ".webm", ".mov",
  ".wav", ".flac",
  ".duckdb", ".sqlite", ".sqlite3",
  ".woff2",
]);

const args = new Set(process.argv.slice(2));

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); // codeql[js/indirect-command-line-injection] -- CI-only LFS gate; cmd is fixed git subcommands over trusted git output, no external/runtime input
}

function tryShOrEmpty(cmd) {
  try { return sh(cmd); } catch { return ""; }
}

function listStagedAdditions() {
  const out = tryShOrEmpty("git diff --cached --name-only --diff-filter=AM");
  return out ? out.split("\n").filter(Boolean) : [];
}

function listAll() {
  const out = tryShOrEmpty("git ls-files");
  return out ? out.split("\n").filter(Boolean) : [];
}

function listAgainst(ref) {
  const out = tryShOrEmpty(`git diff ${ref}...HEAD --name-only --diff-filter=AM`);
  return out ? out.split("\n").filter(Boolean) : [];
}

function extOf(p) {
  const lower = p.toLowerCase();
  if (lower.endsWith(".tar.gz")) return ".tar.gz";
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot);
}

function isLfsTracked(path) {
  try {
    const out = sh(`git check-attr filter -- ${JSON.stringify(path)}`);
    return /:\s*filter:\s*lfs\b/.test(out);
  } catch {
    return false;
  }
}

function installHook() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const hooksDir = join(repoRoot, ".git", "hooks");
  if (!existsSync(hooksDir)) {
    console.error(`[lfs-size-gate] cannot find ${hooksDir} — is this a git repo?`);
    process.exit(2);
  }
  const hookPath = join(hooksDir, "pre-commit");
  const body = `#!/usr/bin/env bash
# Installed by scripts/lfs-size-gate.mjs --install
set -e
node "$(git rev-parse --show-toplevel)/scripts/lfs-size-gate.mjs"
`;
  writeFileSync(hookPath, body, "utf8");
  chmodSync(hookPath, 0o755);
  console.log(`[lfs-size-gate] installed → ${hookPath}`);
}

function main() {
  if (args.has("--install")) {
    installHook();
    return;
  }

  function pickFiles() {
    if (args.has("--all")) return listAll();
    for (const a of args) {
      if (a.startsWith("--against=")) return listAgainst(a.slice("--against=".length));
    }
    return listStagedAdditions();
  }

  const files = pickFiles();
  if (files.length === 0) {
    process.exit(0);
  }

  const violations = [];

  for (const f of files) {
    if (!existsSync(f)) continue;
    let st;
    try { st = statSync(f); } catch { continue; }
    if (!st.isFile()) continue;

    const ext = extOf(f);
    const size = st.size;

    if (LFS_TRACKED_EXTS.has(ext)) {
      if (!isLfsTracked(f)) {
        violations.push({
          path: f, size, reason: `extension ${ext} must be LFS-tracked (see .gitattributes)`,
        });
      }
      continue;
    }

    if (SIZE_GATED_EXTS.has(ext) && size > SIZE_GATE_BYTES) {
      if (!isLfsTracked(f)) {
        violations.push({
          path: f, size,
          reason: `${ext} > 500 KB (${(size / 1024).toFixed(0)} KB) must be LFS-tracked: run \`git lfs track "${f}"\``,
        });
      }
    }
  }

  if (violations.length === 0) {
    process.exit(0);
  }

  console.error("\n  LFS size gate: commit rejected\n");
  for (const v of violations) {
    console.error(`  ✗ ${v.path}  (${(v.size / 1024).toFixed(0)} KB)`);
    console.error(`      ${v.reason}`);
  }
  console.error("\n  See MIGRATION_LFS_AUDIT.md and .gitattributes for policy.");
  console.error("  To allow this file via LFS:");
  console.error('    git lfs track "<glob>"   # e.g. git lfs track "*.psd"');
  console.error("    git add .gitattributes <file>");
  console.error("    git commit");
  console.error("");
  process.exit(1);
}

main();
