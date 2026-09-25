#!/usr/bin/env node
/**
 * Every comment in the Worker that mentions Cloudflare Access must be one the
 * ledger vouches for.
 *
 * Task #33 took the Access middleware off /api/admin/*, /api/monitoring/* and
 * /api/infra/* because it answered legitimate admins with a fail-closed 403,
 * and index.ts records why. Comments across the route files went on
 * describing the removed perimeter as live — "sits inside the existing
 * `/api/admin/*` Cf-Access perimeter", "(in prod) pass the /api/admin/*
 * Cloudflare Access perimeter" — so anyone reading a handler believed its
 * `requireAdmin` was the second line of defence when it is the only one. The
 * only mounts left are the two KYC document routes.
 *
 * The rule, the lexer and the reasons for both live in lib/accessComments.mjs,
 * so a test can drive them without a filesystem. This file walks
 * cloudflare-worker/src, reads access-comment-allowlist.json, and reports.
 *
 * It fails on:
 *   - a mention in a comment that no entry quotes (the bug, again);
 *   - an entry whose phrase is in no comment of its file any more (the ledger
 *     outliving the sentence it vouched for);
 *   - an entry with no Access mention in its phrase, a duplicate, or no reason;
 *   - a walk that found no source file at all.
 *
 * Wired into `npm run test:guards`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAccessComments } from './lib/accessComments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'cloudflare-worker', 'src');
const LEDGER = join(ROOT, 'scripts', 'access-comment-allowlist.json');

// One readdir per directory and one read per file, each in its own try:
// checking existence first and reading second is the race CodeQL flags.
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      let src;
      try {
        src = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      out.push({ path: relative(SRC, full).split(sep).join('/'), src });
    }
  }
  return out;
}

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

let ledger;
try {
  ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
} catch (e) {
  fail([`✖ check-access-comments: cannot read scripts/access-comment-allowlist.json (${e.message})`]);
}

const files = walk(SRC);
const { scanned, mentions, findings } = auditAccessComments(files, ledger.entries);

if (findings.length) {
  const out = [];
  for (const f of findings) {
    if (f.kind === 'unlisted') {
      out.push(`✖ check-access-comments: cloudflare-worker/src/${f.file}:${f.line} mentions "${f.match}" in a comment no entry vouches for`);
      out.push(`    …${f.text}…`);
    } else if (f.kind === 'nothing-scanned') {
      out.push(`✖ check-access-comments: ${f.detail}`);
    } else {
      out.push(`✖ check-access-comments: ${f.kind} entry for ${f.file || '(no file)'} — ${f.detail}`);
      if (f.phrase) out.push(`    phrase: "${f.phrase}"`);
    }
  }
  out.push('');
  out.push(`  ${ledger.resolve_with || ''}`);
  fail(out);
}

console.log(
  `✓ check-access-comments: ${mentions} Access mention${mentions === 1 ? '' : 's'} in comments across ${scanned} source files, every one vouched for by the ${ledger.entries.length}-entry ledger.`,
);
