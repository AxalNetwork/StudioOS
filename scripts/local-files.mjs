/** D7255 (#7255): descriptor-bound local file access and private operator state, never shared temp names. */
import { constants, closeSync, fchmodSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';

const noFollow = () => {
  if (constants.O_NOFOLLOW === undefined) throw new Error('This platform cannot safely open local state files');
  return constants.O_NOFOLLOW;
};

export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Local state directory must be private and owned by this user');
  return path;
}

/** Validate the opened inode before truncating: a symlink or hard link must never clobber its target. */
export function openPrivateOutput(path, exclusive = false) {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NONBLOCK | noFollow() | (exclusive ? constants.O_EXCL : 0);
  const fd = openSync(path, flags, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Local state file must be a regular, unlinked file owned by this user');
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

export function writePrivateFile(path, data, exclusive = false) {
  const fd = openPrivateOutput(path, exclusive);
  try { writeFileSync(fd, data); } finally { closeSync(fd); }
}

/** Open once, then inspect, read and (optionally) edit that same regular inode. Missing files alone return null. */
export function regularTextFile(path, transform = null, writable = Boolean(transform)) {
  let fd;
  try { fd = openSync(path, (writable ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NONBLOCK | noFollow()); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Expected a regular local file');
    const original = readFileSync(fd, 'utf8');
    if (transform) {
      const updated = transform(original);
      if (typeof updated === 'string' && updated !== original) {
        // Explicit offset: readFileSync advanced this descriptor to the end.
        writeSync(fd, updated, 0, 'utf8');
        ftruncateSync(fd, Buffer.byteLength(updated));
      }
    }
    return original;
  } finally { closeSync(fd); }
}
