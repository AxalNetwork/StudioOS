/** D7905/D8010: durable exact-container ownership evidence, kept outside the run's disposable directories. */
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OWNER = /^[1-9][0-9]*-1-[1-9][0-9]*$/, CONTAINER = /^[a-f0-9]{64}$/;
const MAX_RECORDS = 64;
const need = (ok, reason) => { if (!ok) throw new Error(reason); };
export const validRecord = r => r?.version === 1 && CONTAINER.test(r.id ?? '') && OWNER.test(r.owner ?? '');

/**
 * The listener's own state directory: not under RUNNER_TEMP or the workspace (which the cleanup step deletes and a
 * lost host takes with it), and never mounted into a candidate container. Linux candidates run nothing on the host.
 */
export const defaultRecoveryRoot = () => join(homedir(), '.local', 'state', 'studioos-runner', 'containers');

/**
 * create:false (cleanup/prepare on any host) never creates the directory: an absent root holds no records.
 * Every use re-checks the root: a real directory, owned by this uid, mode 0700, reached through no link.
 */
export function recoveryStore({ root = defaultRecoveryRoot(), create = false, uid = process.getuid?.() } = {}) {
  const check = () => {
    const st = lstatSync(root);
    need(st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o777) === 0o700 && realpathSync(root) === root, 'unsafe_recovery_root');
  };
  const present = () => { try { lstatSync(root); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  const syncDir = () => { const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } };
  const file = owner => { need(OWNER.test(owner ?? ''), 'invalid_container_record'); return join(root, `${owner}.json`); };
  return {
    root,
    /** Written before the container starts: exclusive, no-follow, fsynced with its directory. */
    write(record) {
      need(validRecord(record), 'invalid_container_record');
      if (create && !present()) mkdirSync(root, { recursive: true, mode: 0o700 });
      check();
      const fd = openSync(file(record.owner), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeSync(fd, JSON.stringify({ version: 1, id: record.id, owner: record.owner }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
      syncDir();
    },
    list() {
      if (!present()) return [];
      check();
      const names = readdirSync(root).filter(name => /^[1-9][0-9]*-1-[1-9][0-9]*\.json$/.test(name)).sort();
      need(names.length <= MAX_RECORDS, 'too_many_recovery_records');
      return names.map(name => {
        const fd = openSync(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
        let record;
        try { record = JSON.parse(readFileSync(fd, 'utf8')); } catch { record = null; } finally { closeSync(fd); }
        return validRecord(record) && `${record.owner}.json` === name ? record : { invalid: name };
      });
    },
    /** Only after the engine verifiably reports the exact container gone. */
    remove(owner) { check(); unlinkSync(file(owner)); syncDir(); },
  };
}
