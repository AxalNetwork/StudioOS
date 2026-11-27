#!/usr/bin/env node
/**
 * #4573 (Performance P1) — the frontend build's composition, measured from the
 * built bundle in `docs/` (D529: built, never committed). Deterministic: the
 * same build gives the same answer, with no network or browser.
 *
 *   node scripts/perf/bundle-baseline.mjs                 prints the summary
 *   node scripts/perf/bundle-baseline.mjs --json=<file>   also writes the full JSON
 *
 * What it reports:
 *   - the CRITICAL PATH: what `index.html` makes every first visit fetch before
 *     the app can run (the entry module, every `modulepreload`, the local
 *     stylesheets), each with raw, gzip (level 9) and brotli (quality 11) bytes;
 *   - every JS chunk with the same three sizes, and its STATIC CLOSURE: the
 *     chunks its static imports pull in that the critical path does not
 *     already hold (what loading it lazily costs on top of the shell);
 *   - the lazy (dynamic-import) edges, so a route's chunk can be traced;
 *   - totals.
 *
 * Compressed sizes are this script's own zlib output, an estimate of what an
 * edge serves: Cloudflare picks the encoding and level per request. They are
 * comparable build to build, which is what a budget needs.
 *
 * Pure reads of `docs/`: nothing is written unless `--json` is given.
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DOCS = join(ROOT, 'docs');

const sizesOf = (buf) => ({
  raw: buf.byteLength,
  gzip: gzipSync(buf, { level: 9 }).byteLength,
  brotli: brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.byteLength },
  }).byteLength,
});
const add = (a, b) => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip, brotli: a.brotli + b.brotli });
const ZERO = Object.freeze({ raw: 0, gzip: 0, brotli: 0 });

/** The `/assets/…` files `index.html` loads up front: the entry module, its modulepreloads and local stylesheets. */
export function criticalOf(html) {
  const out = { entry: null, preload: [], css: [], external: [] };
  for (const m of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="\/assets\/([^"]+)"/g)) out.entry ??= m[1];
  for (const m of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/assets\/([^"]+)"/g)) out.preload.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/assets\/([^"]+)"/g)) out.css.push(m[1]);
  // Third-party origins the shell reaches before the app runs (outside <noscript>).
  const visible = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  for (const m of visible.matchAll(/<link\b[^>]*\bhref="(https:\/\/[^/"]+)[^"]*"[^>]*>/g)) out.external.push(m[1]);
  out.external = [...new Set(out.external)].sort();
  return out;
}

/** A chunk's static and dynamic imports of sibling chunks (`./x.js`), as Rolldown writes them. */
export function importsOf(code) {
  const stat = new Set();
  const dyn = new Set();
  // Rolldown writes a lazy import with a template literal: import(`./x.js`).
  for (const m of code.matchAll(/\bimport\s*\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g)) dyn.add(m[1]);
  for (const m of code.matchAll(/(?:\bimport|\bexport)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g)) stat.add(m[1]);
  // Vite's preload helper lists a lazy import's dependencies as string literals ("assets/x.js").
  for (const d of dyn) stat.delete(d);
  return { static: [...stat].sort(), dynamic: [...dyn].sort() };
}

export function analyse(docs = DOCS, { full = true } = {}) {
  const html = readFileSync(join(docs, 'index.html'), 'utf8');
  const assets = join(docs, 'assets');
  const files = readdirSync(assets).filter((f) => statSync(join(assets, f)).isFile()).sort();
  const chunks = {};
  for (const f of files) {
    if (!/\.(js|css)$/.test(f)) continue;
    const buf = readFileSync(join(assets, f));
    // Compressed sizes are computed on first read: a budget run reads only the critical path's.
    let sized = null;
    const size = () => (sized ??= sizesOf(buf));
    chunks[f] = {
      raw: buf.byteLength,
      get gzip() { return size().gzip; },
      get brotli() { return size().brotli; },
      ...(f.endsWith('.js') ? importsOf(buf.toString('utf8')) : { static: [], dynamic: [] }),
    };
  }
  const crit = criticalOf(html);
  const critical = new Set([crit.entry, ...crit.preload, ...crit.css].filter(Boolean));
  // The critical path also holds whatever the entry pulls in statically that index.html did not preload.
  const closure = (start) => {
    const seen = new Set();
    const walk = (f) => { if (!chunks[f] || seen.has(f)) return; seen.add(f); for (const s of chunks[f].static) walk(s); };
    walk(start);
    return seen;
  };
  for (const f of closure(crit.entry)) critical.add(f);
  const criticalTotal = [...critical].reduce((t, f) => (chunks[f] ? add(t, chunks[f]) : t), ZERO);
  const js = Object.entries(chunks).filter(([f]) => f.endsWith('.js'));
  const critOut = {
    entry: crit.entry, modulepreload: crit.preload.length, stylesheets: crit.css.length, external_origins: crit.external,
    files: critical.size, size: criticalTotal,
    largest: [...critical].filter((f) => chunks[f]).map((f) => ({ file: f, ...pick(chunks[f]) })).sort((a, z) => z.brotli - a.brotli).slice(0, 10),
  };
  if (!full) return { critical: critOut };
  const lazy = js.map(([f, c]) => {
    const extra = [...closure(f)].filter((x) => !critical.has(x));
    return { file: f, own: { raw: c.raw, gzip: c.gzip, brotli: c.brotli }, beyond_shell: extra.reduce((t, x) => add(t, chunks[x]), ZERO), beyond_shell_chunks: extra.length };
  }).filter((r) => !critical.has(r.file)).sort((a, z) => z.beyond_shell.brotli - a.beyond_shell.brotli || a.file.localeCompare(z.file));
  const all = Object.values(chunks).reduce(add, ZERO);
  const jsAll = js.reduce((t, [, c]) => add(t, c), ZERO);
  return {
    critical: critOut,
    totals: { js_chunks: js.length, css_files: Object.keys(chunks).length - js.length, js: jsAll, all },
    lazy_heaviest: lazy.slice(0, 25),
    dynamic_edges: js.reduce((n, [, c]) => n + c.dynamic.length, 0),
  };
}
const pick = (c) => ({ raw: c.raw, gzip: c.gzip, brotli: c.brotli });

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
/** Chunk names carry a content hash; the stable part is the name before it. */
export const stem = (file) => file.replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, '.$1');

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(join(DOCS, 'index.html'))) {
    console.error('✖ bundle-baseline: no docs/index.html — run `npm run build` first.');
    process.exit(1);
  }
  const r = analyse();
  const json = process.argv.find((a) => a.startsWith('--json='));
  if (json) writeFileSync(json.slice(7), `${JSON.stringify(r, null, 2)}\n`);
  const s = r.critical.size;
  console.log(`critical path: ${r.critical.files} files (entry ${stem(r.critical.entry)}, ${r.critical.modulepreload} modulepreload, ${r.critical.stylesheets} css) — raw ${kib(s.raw)}, gzip ${kib(s.gzip)}, brotli ${kib(s.brotli)}`);
  console.log(`all JS: ${r.totals.js_chunks} chunks — raw ${kib(r.totals.js.raw)}, gzip ${kib(r.totals.js.gzip)}, brotli ${kib(r.totals.js.brotli)}; ${r.dynamic_edges} lazy edges`);
  console.log('heaviest critical files (brotli):');
  for (const f of r.critical.largest) console.log(`  ${stem(f.file).padEnd(40)} ${kib(f.brotli).padStart(10)}  (raw ${kib(f.raw)})`);
  console.log('heaviest lazy loads beyond the shell (brotli, own + static closure):');
  for (const l of r.lazy_heaviest.slice(0, 10)) console.log(`  ${stem(l.file).padEnd(40)} ${kib(l.beyond_shell.brotli).padStart(10)}  (${l.beyond_shell_chunks} chunks)`);
}
