/**
 * D7146 (#7146): what the trusted preview deploy accepts from a pull request's
 * build artifact. The artifact was built by pull-request code, so it is
 * untrusted data: this module reads the zip GitHub serves for it, byte by byte,
 * and either returns the static files it holds or refuses the whole archive.
 * It never executes, imports or interprets a file's contents, and it never
 * writes to disk (`../check-preview-artifact.mjs` does that, into an empty
 * directory). Pure: Node's `zlib` only.
 *
 * Refused, all or nothing:
 *   · more than LIMITS.files files, a file over LIMITS.fileBytes, more than
 *     LIMITS.totalBytes uncompressed in all, or a zip over LIMITS.zipBytes;
 *   · a symlink, device or any entry that is neither a regular file nor a
 *     directory, an encrypted entry, ZIP64, a multi-disk archive, a method
 *     other than stored or deflate, a CRC or size that does not match;
 *   · a name that is absolute, holds a backslash, `.` or `..`, an empty
 *     segment, a character outside [A-Za-z0-9._@+~-], a leading dot (except
 *     the top-level `.well-known/` directory), or that differs from another
 *     only by case;
 *   · an extension outside ALLOWED_EXTENSIONS;
 *   · a file Cloudflare or wrangler reads as configuration rather than serves
 *     (CONTROL_NAMES): those come from `main`, never from the artifact;
 *   · an archive with no `index.html` at its root.
 */
import { inflateRawSync, crc32 } from 'node:zlib';

export const ARTIFACT_NAME = 'pr-preview-docs';

export const LIMITS = Object.freeze({
  /** A PR build has about 1,350 files and no retained assets; production's window is capped at 18,000. */
  files: 5000,
  /** Cloudflare's own per-asset ceiling is 25 MiB. */
  fileBytes: 25 * 1024 * 1024,
  /** A PR build is about 67 MB uncompressed. */
  totalBytes: 200 * 1024 * 1024,
  zipBytes: 200 * 1024 * 1024,
  depth: 12,
  nameLength: 255,
});

/** Static files a browser fetches. No script runs on the deploy side; these are only uploaded. */
export const ALLOWED_EXTENSIONS = Object.freeze([
  'html', 'js', 'mjs', 'css', 'map', 'json', 'webmanifest', 'txt', 'xml', 'md',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'otf',
  // #8468: the program briefs (`frontend/public/program-briefs/*.pdf`, #7801, #7804, #7969) are part of every
  // build, so a preview that refused them refused every pull request.
  'pdf',
]);

/**
 * Names wrangler or Workers static assets read as configuration, at any depth.
 * `_headers` is written by the trusted job from main's `frontend/public/_headers`.
 */
export const CONTROL_NAMES = Object.freeze(['_headers', '_redirects', '_routes.json', '_worker.js', '.assetsignore']);

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._@+~-]*$/;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

/** Why this entry name is refused, or null. `dir` is true for a directory entry (name ends in `/`). */
export function nameProblem(name) {
  if (typeof name !== 'string' || !name) return 'an empty name';
  if (name.length > LIMITS.nameLength) return 'a name longer than ' + LIMITS.nameLength;
  if (name.includes('\\')) return 'a backslash';
  if (name.startsWith('/')) return 'an absolute path';
  const dir = name.endsWith('/');
  const segments = (dir ? name.slice(0, -1) : name).split('/');
  if (segments.length > LIMITS.depth) return 'deeper than ' + LIMITS.depth;
  for (const [i, s] of segments.entries()) {
    if (s === '') return 'an empty segment';
    if (s === '.' || s === '..') return 'a . or .. segment';
    if (s === '.well-known' && i === 0 && (dir || segments.length > 1)) continue;
    if (!SEGMENT.test(s)) return `segment "${s}" is outside [A-Za-z0-9._@+~-] or starts with a dot`;
  }
  if (dir) return null;
  const base = segments[segments.length - 1];
  if (CONTROL_NAMES.includes(base)) return `"${base}" is configuration, not a static file`;
  const ext = /\.([A-Za-z0-9]+)$/.exec(base)?.[1]?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) return `extension ".${ext ?? ''}" is not a static file type this deploy accepts`;
  return null;
}

/** The central directory, read without trusting the local headers. Throws on anything malformed. */
export function readCentralDirectory(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('not a buffer');
  if (buf.length > LIMITS.zipBytes) throw new Error(`the zip is ${buf.length} bytes; the cap is ${LIMITS.zipBytes}`);
  if (buf.length < 22) throw new Error('too short to be a zip');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('ZIP64 is not accepted');
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new Error('a multi-disk zip is not accepted');
  if (total > LIMITS.files * 2) throw new Error(`${total} entries; the cap is ${LIMITS.files} files`);
  if (cdOffset + cdSize > eocd) throw new Error('the central directory overruns the archive');
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdOffset + cdSize || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('a malformed central directory entry');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > cdOffset + cdSize) throw new Error('a central directory entry overruns it');
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    const name = nameBytes.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(nameBytes)) throw new Error('an entry name that is not UTF-8');
    entries.push({
      name,
      madeBy: buf.readUInt16LE(p + 4) >> 8,
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      diskStart: buf.readUInt16LE(p + 34),
      mode: buf.readUInt32LE(p + 38) >>> 16,
      dosAttrs: buf.readUInt32LE(p + 38) & 0xff,
      localOffset: buf.readUInt32LE(p + 42),
    });
    p = end;
  }
  if (p !== cdOffset + cdSize) throw new Error('the central directory size does not match its entries');
  return entries;
}

/** 'file', 'dir', or why the entry is neither. */
function kindOf(e) {
  const dirName = e.name.endsWith('/');
  if (e.madeBy === 3 && e.mode) {
    const type = e.mode & S_IFMT;
    if (type === S_IFDIR) return dirName ? 'dir' : 'a directory mode on a file name';
    if (type === S_IFREG) return dirName ? 'a file mode on a directory name' : 'file';
    return type === 0o120000 ? 'a symlink' : 'not a regular file (mode ' + type.toString(8) + ')';
  }
  return dirName ? 'dir' : 'file';
}

/**
 * Check every entry and inflate the files. Returns `{ files: Map<name, Buffer>, problems: string[] }`;
 * `files` is empty whenever `problems` is not. Nothing is read twice or trusted from a local header
 * except its own name and extra lengths, which must agree with the central directory's name.
 */
export function readPreviewArchive(buf) {
  let entries;
  try {
    entries = readCentralDirectory(buf);
  } catch (error) {
    return { files: new Map(), problems: [error.message] };
  }
  const problems = [];
  const seen = new Set();
  const out = new Map();
  let fileCount = 0;
  let totalBytes = 0;
  for (const e of entries) {
    const label = JSON.stringify(e.name.slice(0, 120));
    const bad = nameProblem(e.name);
    if (bad) { problems.push(`${label}: ${bad}`); continue; }
    const key = e.name.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) { problems.push(`${label}: a duplicate name (case-insensitive)`); continue; }
    seen.add(key);
    const kind = kindOf(e);
    if (kind !== 'file' && kind !== 'dir') { problems.push(`${label}: ${kind}`); continue; }
    if (e.flags & 0x1) { problems.push(`${label}: encrypted`); continue; }
    if (e.diskStart !== 0) { problems.push(`${label}: on another disk`); continue; }
    if (kind === 'dir') {
      if (e.size) problems.push(`${label}: a directory with content`);
      continue;
    }
    fileCount++;
    if (e.method !== 0 && e.method !== 8) { problems.push(`${label}: compression method ${e.method}`); continue; }
    if (e.size > LIMITS.fileBytes) { problems.push(`${label}: ${e.size} bytes; the per-file cap is ${LIMITS.fileBytes}`); continue; }
    totalBytes += e.size;
    if (fileCount > LIMITS.files) { problems.push(`more than ${LIMITS.files} files`); break; }
    if (totalBytes > LIMITS.totalBytes) { problems.push(`more than ${LIMITS.totalBytes} bytes uncompressed`); break; }
    const at = e.localOffset;
    if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) { problems.push(`${label}: no local header where the directory says`); continue; }
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    if (!buf.subarray(at + 30, at + 30 + nameLen).equals(Buffer.from(e.name, 'utf8'))) { problems.push(`${label}: the local header names another file`); continue; }
    const start = at + 30 + nameLen + extraLen;
    if (start + e.compressedSize > buf.length) { problems.push(`${label}: data overruns the archive`); continue; }
    const raw = buf.subarray(start, start + e.compressedSize);
    let data;
    try {
      data = e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
    } catch (error) {
      problems.push(`${label}: does not inflate to its declared size (${error.code || error.message})`);
      continue;
    }
    if (data.length !== e.size) { problems.push(`${label}: ${data.length} bytes, but the directory says ${e.size}`); continue; }
    if ((crc32(data) >>> 0) !== e.crc) { problems.push(`${label}: CRC mismatch`); continue; }
    out.set(e.name, data);
  }
  if (!problems.length && !out.has('index.html')) problems.push('no index.html at the root: this is not a docs/ build');
  return problems.length ? { files: new Map(), problems } : { files: out, problems };
}
