/**
 * D7927 (#7927): read one named entry out of a ZIP archive in a Worker, with bounds. Only what a provider's archive
 * needs: stored (method 0) or deflated (method 8, through the runtime's `DecompressionStream('deflate-raw')`) entries,
 * found through the central directory, size-checked before and after inflating, and CRC-checked. ZIP64, encryption
 * and multi-disk archives are refused, never half-read.
 */
export class ZipReadError extends Error {
  constructor(reason: string) { super(reason); this.name = 'ZipReadError'; }
}

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ZipReadError('entry_too_large'); }
      parts.push(next.value);
    }
  } catch (error) {
    if (error instanceof ZipReadError) throw error;
    throw new ZipReadError('inflate_failed');
  }
  const out = new Uint8Array(size); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/**
 * The bytes of the entry whose name matches `match` (case-insensitive), at most `maxBytes` once inflated. An archive
 * holding no such entry, or more than one, is refused.
 */
export async function readZipEntry(archive: Uint8Array, match: RegExp, maxBytes: number): Promise<{ name: string; bytes: Uint8Array }> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  // The end-of-central-directory record sits in the last 22 + 65,535 bytes.
  let eocd = -1;
  for (let i = archive.byteLength - 22; i >= Math.max(0, archive.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipReadError('not_a_zip');
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) throw new ZipReadError('multi_disk');
  const count = view.getUint16(eocd + 10, true), dirSize = view.getUint32(eocd + 12, true), dirAt = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirAt === 0xffffffff || dirAt + dirSize > eocd) throw new ZipReadError('zip64_or_corrupt');
  const decoder = new TextDecoder();
  const found: { name: string; method: number; flags: number; crc: number; compressed: number; size: number; local: number }[] = [];
  let p = dirAt;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== CENTRAL) throw new ZipReadError('corrupt_directory');
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(archive.subarray(p + 46, p + 46 + nameLen));
    if (match.test(name)) {
      found.push({ name, flags: view.getUint16(p + 8, true), method: view.getUint16(p + 10, true), crc: view.getUint32(p + 16, true),
        compressed: view.getUint32(p + 20, true), size: view.getUint32(p + 24, true), local: view.getUint32(p + 42, true) });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (found.length !== 1) throw new ZipReadError(found.length ? 'ambiguous_entry' : 'entry_missing');
  const e = found[0];
  if (e.flags & 0x1) throw new ZipReadError('encrypted');
  if (e.size === 0xffffffff || e.compressed === 0xffffffff) throw new ZipReadError('zip64_or_corrupt');
  if (e.size > maxBytes) throw new ZipReadError('entry_too_large');
  if (e.local + 30 > archive.byteLength || view.getUint32(e.local, true) !== LOCAL) throw new ZipReadError('corrupt_entry');
  const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
  if (start + e.compressed > archive.byteLength) throw new ZipReadError('corrupt_entry');
  const data = archive.subarray(start, start + e.compressed);
  let bytes: Uint8Array;
  if (e.method === 0) bytes = data.slice();
  else if (e.method === 8) bytes = await inflateRaw(data, maxBytes);
  else throw new ZipReadError('unsupported_method');
  if (bytes.byteLength !== e.size || crc32(bytes) !== e.crc) throw new ZipReadError('checksum_mismatch');
  return { name: e.name, bytes };
}
