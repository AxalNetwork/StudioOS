/** D7905/D8010: export the candidate's trace files out of the paused container into a private, completed offer. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { receiptIdentity } from '../runner-admission.mjs';

/** D8010's proposed ceilings, unchanged: they are proposals pending the resource owner's review, not measured fits. */
export const EXPORT_LIMITS = Object.freeze({ files: 4096, fileBytes: 1024 * 1024, totalBytes: 64 * 1024 * 1024, archiveBytes: 80 * 1024 * 1024, sealBytes: 2 * 1024 * 1024 });
/** The unchanged tracer's `${pid}-${performance.timeOrigin}.trace.json`, directly under the exported traces/ directory. */
const TRACE = /^traces\/[1-9][0-9]{0,9}-[0-9]{13}(?:\.[0-9]{1,3})?\.trace\.json$/;
const OWNER = /^[1-9][0-9]*-1-[1-9][0-9]*$/, CONTAINER = /^[a-f0-9]{64}$/;
const BLOCK = 512, MAX_TRAILING_ZERO_BYTES = 20 * BLOCK;
export class ExportRefusal extends Error { constructor(code) { super(code); this.code = code; } }
const need = (ok, code) => { if (!ok) throw new ExportRefusal(code); };

const octal = (field, code) => {
  const text = field.toString('latin1').replace(/\0.*$/s, '').trim();
  need(/^[0-7]{1,12}$/.test(text), code);
  const value = parseInt(text, 8);
  need(Number.isSafeInteger(value), code);
  return value;
};
const text = field => { const s = field.toString('latin1'); const end = s.indexOf('\0'); return end < 0 ? s : s.slice(0, end); };

/**
 * Bounded streaming USTAR reader. It never extracts: each admitted member is handed to `onFile` with its bytes,
 * after its header passed every check, and nothing is written for a refused archive beyond the pending stage.
 * Admitted: one `traces/` directory header and direct regular-file trace members owned by the candidate identity.
 * Refused: every other type (links, devices, FIFOs, sparse, GNU/PAX extensions), prefixes, bad checksums or magic,
 * oversize, duplicates, truncation, trailing data after the end markers.
 */
export function ustarReader({ onFile, limits = EXPORT_LIMITS, candidate = { uid: 10000, gid: 10000 } }) {
  let pending = Buffer.alloc(0), member = null, ended = false, zeroBlocks = 0, trailing = 0;
  let archiveBytes = 0, files = 0, total = 0, sawDirectory = false;
  const seen = new Set();
  const header = block => {
    if (block.every(b => b === 0)) { zeroBlocks++; if (zeroBlocks === 2) ended = true; return; }
    need(zeroBlocks === 0, 'archive_zero_block_inside');
    const stored = octal(block.subarray(148, 156), 'archive_header_checksum');
    let sum = 0; for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : block[i];
    need(sum === stored, 'archive_header_checksum');
    need(block.subarray(257, 263).toString('latin1') === 'ustar\0' && block.subarray(263, 265).toString('latin1') === '00', 'archive_format_unsupported');
    need(text(block.subarray(345, 500)) === '', 'archive_prefix_refused');
    const name = text(block.subarray(0, 100)), type = String.fromCharCode(block[156]);
    need(['0', '\0', '5'].includes(type), 'archive_member_type_refused');
    need(text(block.subarray(157, 257)) === '', 'archive_link_refused');
    const size = octal(block.subarray(124, 136), 'archive_size_invalid');
    const mode = octal(block.subarray(100, 108), 'archive_mode_invalid') & 0o7777;
    const uid = octal(block.subarray(108, 116), 'archive_owner_invalid'), gid = octal(block.subarray(116, 124), 'archive_owner_invalid');
    need(!seen.has(name), 'archive_duplicate_path'); seen.add(name);
    if (type === '5') {
      need(name === 'traces/' && !sawDirectory && size === 0, 'archive_directory_refused');
      sawDirectory = true; return;
    }
    need(type === '0' || type === '\0', 'archive_member_type_refused');
    need(TRACE.test(name), 'archive_path_refused');
    need(uid === candidate.uid && gid === candidate.gid && (mode === 0o600 || mode === 0o644), 'archive_source_identity_refused');
    need(++files <= limits.files, 'archive_file_count_limit');
    need(size > 0 && size <= limits.fileBytes, 'archive_file_size_limit');
    need((total += size) <= limits.totalBytes, 'archive_expanded_size_limit');
    member = { name, size, mode, uid, gid, chunks: [], read: 0, padded: Math.ceil(size / BLOCK) * BLOCK };
  };
  return {
    push(chunk) {
      if (archiveBytes === 0 && chunk.length >= 2) need(!(chunk[0] === 0x1f && chunk[1] === 0x8b), 'archive_compressed_refused');
      need((archiveBytes += chunk.length) <= limits.archiveBytes, 'archive_size_limit');
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= BLOCK || (member && pending.length > 0)) {
        if (ended) {
          need(pending.every(b => b === 0), 'archive_trailing_data');
          need((trailing += pending.length) <= MAX_TRAILING_ZERO_BYTES, 'archive_trailing_data');
          pending = Buffer.alloc(0); return;
        }
        if (member) {
          const take = Math.min(member.padded - member.read, pending.length);
          const data = pending.subarray(0, take); pending = pending.subarray(take);
          const keep = Math.max(0, Math.min(take, member.size - member.read));
          if (keep) member.chunks.push(Buffer.from(data.subarray(0, keep)));
          need(data.subarray(keep).every(b => b === 0), 'archive_padding_invalid');
          member.read += take;
          if (member.read === member.padded) { const done = member; member = null; onFile({ ...done, bytes: Buffer.concat(done.chunks) }); }
          continue;
        }
        const block = pending.subarray(0, BLOCK); pending = pending.subarray(BLOCK);
        header(block);
      }
    },
    end() {
      need(ended && member === null, 'archive_truncated');
      need(pending.every(b => b === 0) && trailing + pending.length <= MAX_TRAILING_ZERO_BYTES, 'archive_trailing_data');
      // D8010: the explicit traces/ directory header is optional; at least one trace file is not.
      need(files > 0, 'archive_missing_traces');
      return { archiveBytes, expandedBytes: total, files };
    },
  };
}

const privateDir = (path, uid) => {
  const st = lstatSync(path);
  need(st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o777) === 0o700 && realpathSync(path) === path, 'export_stage_unsafe');
};
const syncDir = path => { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } };
/** Exclusive, no-follow creation; the final mode is set on the open descriptor after fsync. */
export const writeExclusive = (path, bytes, finalMode) => {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { let at = 0; while (at < bytes.length) at += writeSync(fd, bytes, at); fsyncSync(fd); fchmodSync(fd, finalMode); fsyncSync(fd); } finally { closeSync(fd); }
};
const dockerCopy = args => spawn('/usr/local/bin/docker', args, { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'ignore'], shell: false });

/**
 * The trusted supervisor's exporter. Sequence (D8010): quiesce by pausing the exact container (stopping it would
 * discard its tmpfs), stream `docker cp <id>:/work/traces -` through the bounded reader into a fresh private
 * pending stage, write COMPLETE.json last, then publish pending → ready. Any refusal leaves no ready offer.
 * Pause/copy behaviour and the engine's archive encoding are UNVERIFIED on the pinned runtime (#8010 items 5–6).
 */
export function createTraceExporter({ stagingRoot, engine, spawnCopy = dockerCopy, uid = process.getuid?.(), now = Date.now, limits = EXPORT_LIMITS }) {
  need(typeof stagingRoot === 'string' && stagingRoot.startsWith('/'), 'export_stage_unconfigured');
  return async ({ receipt, container, observedTest, signal, deadline }) => {
    let phase = 'stage';
    try {
      need(CONTAINER.test(container?.id ?? '') && OWNER.test(container?.owner ?? ''), 'export_container_invalid');
      const identity = receiptIdentity(receipt);
      need(container.owner === `${identity.childRunId}-${identity.childAttempt}-${identity.generation}`, 'export_container_invalid');
      need(Number.isSafeInteger(deadline) && deadline - now() > 0 && !signal?.aborted, 'export_budget_exhausted');
      mkdirSync(stagingRoot, { recursive: true, mode: 0o700 }); privateDir(stagingRoot, uid);
      // One offer per context: an existing leaf (even an identical earlier one) is a competing offer.
      const leaf = join(stagingRoot, container.owner);
      try { mkdirSync(leaf, { mode: 0o700 }); } catch (error) { need(error.code !== 'EEXIST', 'export_competing_offer'); throw error; }
      const pending = join(leaf, 'pending'), traces = join(pending, 'traces'), ready = join(leaf, 'ready');
      mkdirSync(pending, { mode: 0o700 }); mkdirSync(traces, { mode: 0o700 });
      for (const dir of [leaf, pending, traces]) privateDir(dir, uid);
      phase = 'quiesce';
      engine(['pause', container.id]);
      phase = 'copy';
      const files = [];
      const reader = ustarReader({ limits, onFile: file => {
        writeExclusive(join(traces, file.name.slice('traces/'.length)), file.bytes, 0o400);
        files.push({ path: file.name, type: 'file', sourceUid: file.uid, sourceGid: file.gid, sourceLinks: 1, sourceMode: file.mode,
          bytes: file.bytes.length, digest: 'sha256:' + createHash('sha256').update(file.bytes).digest('hex') });
      } });
      const transport = await new Promise((accept, reject) => {
        const child = spawnCopy(['cp', `${container.id}:/work/traces`, '-']);
        let failed = null;
        const stop = code => { if (failed) return; failed = code; try { child.kill('SIGKILL'); } catch {} };
        const timer = setTimeout(() => stop('export_budget_exhausted'), Math.max(1, deadline - now()));
        const abort = () => stop('export_cancelled');
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', chunk => { if (failed) return; try { reader.push(chunk); } catch (error) { stop(error instanceof ExportRefusal ? error.code : 'export_write_failed'); } });
        child.once('error', () => stop('export_engine_unavailable'));
        child.once('close', code => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (failed) return reject(new ExportRefusal(failed));
          if (code !== 0) return reject(new ExportRefusal('export_engine_copy_failed'));
          try { accept(reader.end()); } catch (error) { reject(error); }
        });
      });
      phase = 'seal';
      need(readdirSync(traces).length === files.length, 'export_inventory_mismatch');
      const envelope = { schema: 'studioos.trace-export.v1', evidenceClass: 'native-unqualified', receipt: identity,
        container: { id: container.id, owner: container.owner }, observedTest: structuredClone(observedTest ?? null),
        transport: { format: 'uncompressed-ustar', complete: true, archiveBytes: transport.archiveBytes, expandedBytes: transport.expandedBytes }, files };
      const seal = Buffer.from(JSON.stringify(envelope) + '\n');
      need(seal.length <= limits.sealBytes, 'export_seal_limit');
      writeExclusive(join(pending, 'COMPLETE.json'), seal, 0o400);
      syncDir(traces); syncDir(pending);
      // Node exposes no rename-no-replace. The leaf is private to this uid and was created exclusively above, so
      // only this supervisor can race here; an existing ready entry still refuses.
      need(!(() => { try { lstatSync(ready); return true; } catch { return false; } })(), 'export_competing_offer');
      renameSync(pending, ready); syncDir(leaf);
      return { state: 'complete', ready, files: files.length, bytes: transport.expandedBytes };
    } catch (error) {
      return { state: 'failed', phase, reason: error instanceof ExportRefusal ? error.code : 'export_unexpected' };
    }
  };
}
