#!/usr/bin/env node
/**
 * D849 (#2472): no log line and no activity row carries a credential.
 *
 * A member API key (`axk_…`, D841) or an OAuth bearer is a password: shown
 * once, kept only as a hash. The one place a plaintext could still leak is a
 * line written for a person to read later — a `console.*` call (it lands in
 * the Worker's deployment logs), a `logActorAct(...)` call, or a write to
 * `activity_logs` (both read back in the admin's activity views). This guard
 * reads every such call in `cloudflare-worker/src` and fails when its
 * arguments name a value that is a bearer or a secret, or carry an `axk_`
 * literal:
 *
 *   - an identifier, outside a string, whose name contains `bearer` or
 *     `secret` (`bearer`, `rawSecret`, `env.JWT_SECRET`, `bearerToken`) —
 *     inside a `${}` too, since that is how a template interpolates one. An
 *     object key (`{ bearer_user_id: id }`) names a field, not a value, and
 *     passes; its value is read like any other argument;
 *   - the text `axk_` anywhere in the arguments, since the only reason to
 *     write the prefix next to a log is to print a key.
 *
 * Prose in a string ("the JWT secret is not set") is not a value and passes.
 * A name that matches but is not a credential is allowlisted below with its
 * reason, so a new match fails until someone has read it.
 *
 * Wired into `npm run test:guards`, so `npm run test:drift` runs it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREE = join(ROOT, 'cloudflare-worker', 'src');

/** `file: identifier` → why naming it in a log is not a leak. */
export const ALLOW = new Map([]);

/** Every `.ts` file under `dir`, read once (no stat-then-read: CodeQL js/file-system-race). */
function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (ent.isFile() && p.endsWith('.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * The index just past the `)` that closes the `(` at `open`, skipping strings,
 * templates (and their `${}`), regex-free comments. -1 when unbalanced.
 */
export function closeParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (ch === "'" || ch === '"') { i = skipQuoted(src, i); if (i < 0) return -1; continue; }
    if (ch === '`') { i = skipTemplate(src, i); if (i < 0) return -1; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}
function skipQuoted(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j;
    if (src[j] === '\n') return j;
  }
  return -1;
}
function skipTemplate(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '`') return j;
    if (src[j] === '$' && src[j + 1] === '{') {
      let depth = 0;
      for (let k = j + 1; k < src.length; k++) {
        const ch = src[k];
        if (ch === "'" || ch === '"') { k = skipQuoted(src, k); if (k < 0) return -1; continue; }
        if (ch === '`') { k = skipTemplate(src, k); if (k < 0) return -1; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { j = k; break; } }
      }
    }
  }
  return -1;
}

/** `text` with string contents and comments blanked, keeping each `${}` expression. */
export function codeOnly(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e - 1; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
    if (ch === "'" || ch === '"') { const e = skipQuoted(text, i); out += ' "" '; i = e < 0 ? text.length : e; continue; }
    if (ch === '`') {
      const e = skipTemplate(text, i);
      const body = text.slice(i + 1, e < 0 ? text.length : e);
      out += ' ';
      for (const m of body.matchAll(/\$\{/g)) {
        const at = m.index + 1;
        let depth = 0, k = at;
        for (; k < body.length; k++) { if (body[k] === '{') depth++; else if (body[k] === '}' && --depth === 0) break; }
        out += ` ${codeOnly(body.slice(at + 1, k))} `;
      }
      i = e < 0 ? text.length : e;
      continue;
    }
    out += ch;
  }
  return out;
}

const SENSITIVE = /^[\w$]*(?:bearer|secret)[\w$]*$/i;

/** The findings for one file's text: `{ line, call, name }`. */
export function scan(src) {
  const spans = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  for (const m of src.matchAll(/\bconsole\.(?:log|info|warn|error|debug|trace)\s*\(|\blogActorAct\s*\(/g)) {
    const before = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index).trim();
    if (before.startsWith('//') || before.startsWith('*') || /\bfunction\s*$/.test(before)) continue;
    const open = m.index + m[0].length - 1;
    const end = closeParen(src, open);
    if (end > 0) spans.push({ at: m.index, call: m[0].replace(/\s*\($/, ''), text: src.slice(open, end) });
  }
  for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+activity_logs\b/g)) {
    const open = src.lastIndexOf('prepare(', m.index);
    if (open < 0) continue;
    const pOpen = open + 'prepare'.length;
    const pEnd = closeParen(src, pOpen);
    if (pEnd < m.index) continue;
    let text = src.slice(pOpen, pEnd);
    const bind = /^\s*\.bind\s*\(/.exec(src.slice(pEnd));
    if (bind) {
      const bOpen = pEnd + bind[0].length - 1;
      const bEnd = closeParen(src, bOpen);
      if (bEnd > 0) text += src.slice(bOpen, bEnd);
    }
    spans.push({ at: m.index, call: 'activity_logs', text });
  }
  const out = [];
  for (const s of spans) {
    if (/axk_/.test(s.text)) out.push({ line: lineOf(s.at), call: s.call, name: 'axk_' });
    const code = codeOnly(s.text);
    const names = new Set();
    for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
      // An object key (`{ bearer_user_id: id }`) names a field, not a value.
      if (/^\s*:(?!:)/.test(code.slice(m.index + m[0].length)) && /[{,]\s*$/.test(code.slice(0, m.index))) continue;
      if (SENSITIVE.test(m[0])) names.add(m[0]);
    }
    for (const name of names) out.push({ line: lineOf(s.at), call: s.call, name });
  }
  return out;
}

function main() {
  const failures = [];
  const used = new Set();
  for (const file of sourceFiles(TREE)) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relative(ROOT, file).split(sep).join('/');
    for (const f of scan(src)) {
      const key = `${rel}: ${f.name}`;
      if (ALLOW.has(key)) { used.add(key); continue; }
      failures.push(`${rel}:${f.line}  ${f.call}(…) names \`${f.name}\``);
    }
  }
  for (const key of ALLOW.keys()) if (!used.has(key)) failures.push(`allowlist entry no longer matches anything: ${key}`);
  if (failures.length) {
    console.error('check-secret-logging: a log line or an activity row may carry a credential (D849).');
    for (const f of failures) console.error(`  ${f}`);
    console.error('Log the key\'s id or prefix, never the bearer, the secret or an axk_ value. If the name is not a credential, add it to ALLOW with the reason.');
    process.exit(1);
  }
  console.log('check-secret-logging: no console.*, logActorAct or activity_logs write names a bearer, a secret or an axk_ value.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
