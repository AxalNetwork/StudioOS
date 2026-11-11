// D5613: stable per-entry ledger files; duplicate keys and misplaced entries fail closed.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const entryFile = (name) => `${encodeURIComponent(name)}.json`;
// Default formats used by the two ledgers. Other callers may supply their own resolver.
export function fileOf(key) {
  const sql = key.lastIndexOf(' @ ');
  if (sql >= 0) return entryFile(key.slice(sql + 3));
  const route = /^[A-Z]+ (\/\S*)$/.exec(key);
  return entryFile(route ? route[1].split('/').slice(0, 3).join('/') : key);
}

function filename(value) {
  if (typeof value !== 'string' || !/^[\w%.~-]+\.json$/.test(value)) throw new Error(`invalid split ledger filename: ${value}`);
  return value;
}

export function readSplit(dir, resolveFile = fileOf) {
  if (!existsSync(dir)) throw new Error(`split ledger directory missing: ${dir}`);
  const entries = new Map();
  const sources = new Map();
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(dir, name);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(`expected entry map: ${path}`);
    for (const [key, value] of Object.entries(data)) {
      if (sources.has(key)) throw new Error(`duplicate key ${key}: ${sources.get(key)} and ${path}`);
      entries.set(key, value); sources.set(key, path);
    }
  }
  for (const [key, path] of sources) {
    const expected = join(dir, filename(resolveFile(key)));
    if (expected !== path) throw new Error(`wrong file for ${key}: ${path}; expected ${expected}`);
  }
  return Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function writeSplit(dir, map, resolveFile = fileOf) {
  if (existsSync(dir)) readSplit(dir, resolveFile);
  const groups = new Map();
  for (const [key, value] of Object.entries(map).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const name = filename(resolveFile(key));
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push([key, value]);
  }
  mkdirSync(dir, { recursive: true });
  const changed = [];
  for (const [name, entries] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const path = join(dir, name);
    const bytes = `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
    try {
      if (readFileSync(path, 'utf8') === bytes) continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Publish one complete entry at a time, without changing an existing inode.
    const temporary = mkdtempSync(join(dir, '.split-ledger-'));
    try {
      const entry = join(temporary, 'entry');
      writeFileSync(entry, bytes, { flag: 'wx' });
      renameSync(entry, path);
      changed.push(path);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    if (groups.has(name)) continue;
    const path = join(dir, name); unlinkSync(path); changed.push(path);
  }
  return changed;
}
