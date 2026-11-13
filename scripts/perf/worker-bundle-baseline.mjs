#!/usr/bin/env node
/**
 * #4574 H3 — where the Worker script's bytes come from. Reads the esbuild
 * metafile `wrangler deploy --dry-run` writes, and prints the script's size
 * (raw, gzip level 9, brotli quality 11) and its bytes by source: each
 * `src/` folder, each npm package, and the largest single inputs.
 *
 *   cd cloudflare-worker && npx wrangler deploy --dry-run --config ../wrangler.toml \
 *     --outdir <dir> --metafile <dir>/meta.json
 *   node scripts/perf/worker-bundle-baseline.mjs <dir>/meta.json [--top=30]
 *
 * "Bytes in output" are esbuild's figures after minification, per input; they
 * add up to the script. Size is not start-up time: isolate start is measured
 * only in production metrics, which this script does not read.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const metaPath = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const top = Number((process.argv.find((a) => a.startsWith('--top=')) || '--top=30').slice(6)) || 30;
if (!metaPath || !existsSync(metaPath)) {
  console.error('usage: node scripts/perf/worker-bundle-baseline.mjs <metafile.json> [--top=N]');
  process.exit(2);
}
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const [outPath, out] = Object.entries(meta.outputs).find(([k]) => /\.m?js$/.test(k)) || [];
if (!out) { console.error('no JS output in the metafile'); process.exit(2); }

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const scriptFile = resolve(process.cwd(), outPath);
const fallback = resolve(dirname(metaPath), outPath.split('/').pop());
const file = existsSync(scriptFile) ? scriptFile : existsSync(fallback) ? fallback : null;
if (file) {
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 }).length;
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  console.log(`script: ${kib(buf.length)} raw, ${kib(gz)} gzip, ${kib(br)} brotli`);
} else {
  console.log(`script: ${kib(out.bytes)} raw (the script file was not found beside the metafile, so no compressed sizes)`);
}

const inputs = Object.entries(out.inputs).map(([k, v]) => [k, v.bytesInOutput]).sort((a, b) => b[1] - a[1]);
const groupOf = (k) => {
  const nm = k.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (nm) return `npm:${nm[1]}`;
  const src = k.match(/(?:^|\/)src\/([^/]+)/);
  return src ? `src/${src[1]}` : k;
};
const groups = new Map();
for (const [k, b] of inputs) groups.set(groupOf(k), (groups.get(groupOf(k)) || 0) + b);
const total = inputs.reduce((s, [, b]) => s + b, 0);
const npm = [...groups].filter(([g]) => g.startsWith('npm:')).reduce((s, [, b]) => s + b, 0);
console.log(`inputs: ${inputs.length}; own source ${kib(total - npm)}, npm packages ${kib(npm)}`);
console.log('\nby folder or package:');
for (const [g, b] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${kib(b).padStart(11)}  ${g}`);
console.log('\nlargest inputs:');
for (const [k, b] of inputs.slice(0, top)) console.log(`  ${kib(b).padStart(11)}  ${k.replace(/^.*?cloudflare-worker\//, '')}`);
