/** D7905/D8010: durable exact-container ownership evidence, kept outside the run's disposable directories. */
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OWNER = /^[1-9][0-9]*-1-[1-9][0-9]*$/, CONTAINER = /^[a-f0-9]{64}$/;
const MAX_RECORDS = 64;
const need = (ok, reason) => { if (!ok) throw new Error(reason); };
export const validRecord = r => r?.version === 1 && CONTAINER.test(r.id ?? '') && OWNER.test(r.owner ?? '');
/** S32 C3: a create intent, written before the engine is asked, carries what exact-name reconciliation needs. */
export const validIntent = i => i?.version === 1 && OWNER.test(i.owner ?? '') && /^sha256:[a-f0-9]{64}$/.test(i.image ?? '') && Number.isSafeInteger(i.deadlineSeconds) && i.deadlineSeconds > 0;
const RECORD_NAME = /^[1-9][0-9]*-1-[1-9][0-9]*\.json$/, INTENT_NAME = /^[1-9][0-9]*-1-[1-9][0-9]*\.create\.json$/;

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
  const intentFile = owner => { need(OWNER.test(owner ?? ''), 'invalid_container_record'); return join(root, `${owner}.create.json`); };
  const exclusive = (path, value) => {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  };
  const unlinkIfPresent = path => { try { unlinkSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  const read = name => {
    const fd = openSync(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return JSON.parse(readFileSync(fd, 'utf8')); } catch { return null; } finally { closeSync(fd); }
  };
  return {
    root,
    /** S32 C3: written before `docker create` is asked, exclusive and fsynced, so a lost create stays recoverable. */
    writeIntent(intent) {
      need(validIntent(intent), 'invalid_container_intent');
      if (create && !present()) mkdirSync(root, { recursive: true, mode: 0o700 });
      check();
      exclusive(intentFile(intent.owner), { version: 1, owner: intent.owner, image: intent.image, deadlineSeconds: intent.deadlineSeconds });
      syncDir();
    },
    /**
     * Written before the container starts: exclusive, no-follow, fsynced with its directory. The exact ID record
     * supersedes the create intent for the same owner, which is dropped only after the record is durable.
     */
    write(record) {
      need(validRecord(record), 'invalid_container_record');
      if (create && !present()) mkdirSync(root, { recursive: true, mode: 0o700 });
      check();
      exclusive(file(record.owner), { version: 1, id: record.id, owner: record.owner });
      syncDir();
      if (unlinkIfPresent(intentFile(record.owner))) syncDir();
    },
    /** Exact ID records, then create intents that have no ID record; a damaged file of either kind is reported. */
    list() {
      if (!present()) return [];
      check();
      const all = readdirSync(root), records = all.filter(name => RECORD_NAME.test(name)).sort(), intents = all.filter(name => INTENT_NAME.test(name)).sort();
      need(records.length + intents.length <= MAX_RECORDS, 'too_many_recovery_records');
      const listed = records.map(name => { const record = read(name); return validRecord(record) && `${record.owner}.json` === name ? record : { invalid: name }; });
      const owners = new Set(records.map(name => name.slice(0, -'.json'.length)));
      for (const name of intents) {
        const owner = name.slice(0, -'.create.json'.length);
        if (owners.has(owner)) continue;
        const intent = read(name);
        listed.push(validIntent(intent) && intent.owner === owner ? { intent } : { invalid: name });
      }
      return listed;
    },
    /** Only after the engine verifiably reports the exact container gone: removes the ID record and any intent. */
    remove(owner) { check(); unlinkSync(file(owner)); unlinkIfPresent(intentFile(owner)); syncDir(); },
    /** Only after the fixed name was observed absent (or its exact container verifiably removed). */
    removeIntent(owner) { check(); unlinkSync(intentFile(owner)); syncDir(); },
  };
}
