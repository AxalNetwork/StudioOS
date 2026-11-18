#!/usr/bin/env node
/**
 * D7146 (#7146): check a pull request's preview build artifact and unpack it
 * for the trusted deploy. Run by `.github/workflows/pr-preview-deploy.yml`
 * from main's checkout, on the zip GitHub serves for the `pr-preview-docs`
 * artifact of the triggering pull_request run:
 *
 *   node scripts/check-preview-artifact.mjs --zip <artifact.zip> --out <dir>
 *
 * `<dir>` must not exist yet, or be empty. Every rule is in
 * `lib/previewArtifact.mjs`; this file only reads the zip and, when the whole
 * archive passes, writes its regular files and directories under `<dir>`. On
 * any refusal it writes nothing and exits 1, naming each problem.
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { LIMITS, readPreviewArchive } from './lib/previewArtifact.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const zip = arg('--zip');
const outArg = arg('--out');
if (!zip || !outArg) {
  console.error('usage: node scripts/check-preview-artifact.mjs --zip <artifact.zip> --out <dir>');
  process.exit(2);
}
const out = resolve(outArg);
if (existsSync(out) && readdirSync(out).length) {
  console.error(`::error::${outArg} is not empty; the preview is unpacked only into an empty directory`);
  process.exit(1);
}
// One open file: its size and its bytes come from the same descriptor, and at
// most the cap plus one byte is ever read, so a file swapped or grown after the
// size check can neither slip past the cap nor be read in its place.
const fd = openSync(zip, 'r');
let archive;
try {
  const size = fstatSync(fd).size;
  if (size > LIMITS.zipBytes) {
    console.error(`::error::the artifact zip is ${size} bytes; the cap is ${LIMITS.zipBytes}`);
    process.exit(1);
  }
  const buf = Buffer.alloc(size + 1);
  let read = 0;
  for (let n; read < buf.length && (n = readSync(fd, buf, read, buf.length - read, read)) > 0;) read += n;
  if (read > size) {
    console.error('::error::the artifact zip grew while it was being read');
    process.exit(1);
  }
  archive = buf.subarray(0, read);
} finally {
  closeSync(fd);
}

const { files, problems } = readPreviewArchive(archive);
if (problems.length) {
  for (const p of problems.slice(0, 50)) console.error(`::error::preview artifact refused: ${p}`);
  if (problems.length > 50) console.error(`::error::... and ${problems.length - 50} more`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
let bytes = 0;
for (const [name, data] of files) {
  const target = resolve(out, name);
  // nameProblem() already refused every way out of <dir>; this is the belt to that brace.
  if (!target.startsWith(out + sep)) throw new Error(`${name} resolves outside ${outArg}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data, { flag: 'wx', mode: 0o644 });
  bytes += data.length;
}
console.log(`preview artifact accepted: ${files.size} files, ${bytes} bytes, unpacked into ${join(outArg)}`);
