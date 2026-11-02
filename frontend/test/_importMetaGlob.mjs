/**
 * #4105 — Vite's `import.meta.glob`, for the node test loader.
 *
 * `App.jsx` collects its route modules with
 * `import.meta.glob('./routes/*.jsx', { eager: true })`. Vite expands that at
 * build time into one static import per file; under plain node the call does
 * not exist, so every test that renders `App.jsx` (`_airailRender.mjs`,
 * `admin_page_refusals_d940`) would throw. `_deck-loader-hook.mjs` hands each
 * source it transforms through `expandImportMetaGlob`, which does what Vite
 * does for the one shape the SPA uses:
 *
 *   - a single string-literal pattern, relative (`./` or `../`), with one `*`
 *     in its last segment and no `**`, `{…}` or `!`;
 *   - options absent, `{ eager: true }` or `{ eager: false }`.
 *
 * Eager becomes `{ './routes/a.jsx': __glob_0_0, … }` over prepended
 * `import * as __glob_0_0 from './routes/a.jsx'`; lazy becomes
 * `{ './routes/a.jsx': () => import('./routes/a.jsx'), … }`. Keys are the
 * matched paths as written relative to the importing file, sorted. Any other
 * shape throws, naming the file: a test must not pass against a glob this
 * stub only pretends to expand.
 */
import { readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';

const CALL = /import\.meta\.glob\(\s*(['"])([^'"]+)\1\s*(?:,\s*(\{[^}]*\})\s*)?\)/g;

export function expandImportMetaGlob(source, filename) {
  if (!source.includes('import.meta.glob')) return source;
  const imports = [];
  let n = 0;
  const out = source.replace(CALL, (_, _q, pattern, opts) => {
    const at = n++;
    let eager = false;
    if (opts !== undefined) {
      const m = /^\{\s*eager\s*:\s*(true|false)\s*,?\s*\}$/.exec(opts.trim());
      if (!m) throw new Error(`${filename}: import.meta.glob options ${opts} are not supported by the test loader`);
      eager = m[1] === 'true';
    }
    if (!/^\.\.?\//.test(pattern) || /\*\*|[{}!]/.test(pattern)) {
      throw new Error(`${filename}: import.meta.glob('${pattern}') is not a pattern the test loader expands`);
    }
    const slash = pattern.lastIndexOf('/');
    const dirPart = pattern.slice(0, slash);
    const filePart = pattern.slice(slash + 1);
    if (dirPart.includes('*') || filePart.split('*').length !== 2) {
      throw new Error(`${filename}: import.meta.glob('${pattern}') needs exactly one * in its last segment`);
    }
    const [pre, post] = filePart.split('*');
    const dir = resolve(dirname(filename), dirPart);
    const names = existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.startsWith(pre) && e.name.endsWith(post) && e.name.length >= pre.length + post.length)
        .map((e) => e.name)
        .sort()
      : [];
    const entries = names.map((name, i) => {
      const rel = posix.join(dirPart, name);
      const key = rel.startsWith('.') ? rel : `./${rel}`;
      if (eager) {
        const id = `__glob_${at}_${i}`;
        imports.push(`import * as ${id} from ${JSON.stringify(key)};`);
        return `${JSON.stringify(key)}: ${id}`;
      }
      return `${JSON.stringify(key)}: () => import(${JSON.stringify(key)})`;
    });
    return `({ ${entries.join(', ')} })`;
  });
  // On the first line, so every line number in the file stays where it was.
  return imports.length ? `${imports.join(' ')} ${out}` : out;
}
