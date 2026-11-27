// Atomic file replacement for in-suite mutation checks: a reader sees the old bytes or the new ones, never a truncated copy.
import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Replace the existing `file` with `text` atomically.
 *
 * `writeFileSync(file, …)` truncates the file and then writes it, so another
 * process importing it in between reads an empty or partial module (merge-queue
 * run 43657801960: "does not provide an export named …"). This writes a
 * temporary file beside `file`, in the same directory and so on the same file
 * system, and renames it over `file`. The temporary name starts with a dot and
 * ends in `.tmp`, so no `*.ts`, `*.js` or `*.mjs` walk picks it up.
 *
 * It refuses a `file` that does not exist: a mutation check rewrites a source
 * it has read, and never creates one.
 */
export function writeFileAtomic(file, text) {
  const { mode } = statSync(file);
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(temp, text, { flag: 'wx', mode: mode & 0o777 });
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
