/**
 * Every source file under frontend/src whose CODE (comments stripped) contains
 * `needle` (a string, or a RegExp tested against the file), as repo-relative
 * paths.
 *
 * For "only one file does this" pins: a pin that reads one named file goes
 * blind the day that file is deleted, where a walk of the tree still sees a
 * second file doing the same thing. Directory entries carry their own type, so
 * nothing is stat-ed and then read.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

export function srcFilesWith(needle) {
  const hit = needle instanceof RegExp ? (src) => needle.test(src) : (src) => src.includes(needle);
  const root = resolve(process.cwd(), 'frontend/src');
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(entry.name) && hit(codeOnly(readFileSync(p, 'utf8')))) {
        hits.push(relative(process.cwd(), p));
      }
    }
  };
  walk(root);
  return hits.sort();
}
