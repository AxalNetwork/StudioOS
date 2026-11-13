// Minimal store-only (no compression) ZIP builder for Cloudflare Workers.
// Workers have no Node `zlib`, so we emit an uncompressed but fully valid
// .zip (correct CRC32 + central directory). Mirrors the FastAPI data-room
// export in backend/app/api/routes/deals.py.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; content: string; }

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const fileParts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = enc.encode(e.content);
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);   // version needed
    lh.setUint16(6, 0, true);    // flags
    lh.setUint16(8, 0, true);    // method 0 = store
    lh.setUint16(10, 0, true);   // mod time
    lh.setUint16(12, 0, true);   // mod date
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);  // compressed size
    lh.setUint32(22, data.length, true);  // uncompressed size
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);   // extra len
    const lhBytes = new Uint8Array(lh.buffer);
    fileParts.push(lhBytes, nameBytes, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);   // version made by
    ch.setUint16(6, 20, true);   // version needed
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true);   // method
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);   // extra
    ch.setUint16(32, 0, true);   // comment
    ch.setUint16(34, 0, true);   // disk
    ch.setUint16(36, 0, true);   // internal attrs
    ch.setUint32(38, 0, true);   // external attrs
    ch.setUint32(42, offset, true); // local header offset
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += lhBytes.length + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const centralOffset = offset;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);
  end.setUint16(20, 0, true);

  const all = [...fileParts, ...central, new Uint8Array(end.buffer)];
  const total = all.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const b of all) { out.set(b, pos); pos += b.length; }
  return out;
}
