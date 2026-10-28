/** The emitted Vite dependency map is data, never code to execute. */
export function assetPath(value) {
  if (typeof value !== 'string' || !/^(?:\/|\.\/)?assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(value)) {
    throw new Error('Invalid JS/CSS asset path');
  }
  return '/' + value.replace(/^(?:\/|\.\/)/, '');
}

export function parseViteMapDeps(source) {
  const start = String(source).search(/\b(?:const|let|var)\s+__vite__mapDeps\s*=/);
  if (start < 0) throw new Error('Missing __vite__mapDeps declaration');
  const match = String(source).slice(start).match(/^(?:const|let|var)\s+__vite__mapDeps\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*=\s*__vite__mapDeps\s*,\s*([A-Za-z_$][\w$]*)\s*=\s*\(\s*\2\.f\s*\|\|\s*\(\s*\2\.f\s*=\s*(\[[\s\S]*?\])\s*\)\s*\)\s*\)\s*=>/);
  if (!match) throw new Error('Unreadable __vite__mapDeps list');
  let refs;
  try { refs = JSON.parse(match[4]); } catch { throw new Error('Unreadable __vite__mapDeps list'); }
  if (!Array.isArray(refs) || refs.length === 0) throw new Error('Empty __vite__mapDeps list');
  return [...new Set(refs.map(assetPath))];
}

export function entryRefsFromHtml(html) {
  const refs = [];
  for (const match of String(html).matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) refs.push(assetPath(src));
  }
  return [...new Set(refs)];
}

/** Capture before Vite wipes docs/. Scheduled checks use generation 1 of
 * the already-deployed cache instead of generation 0 of the pre-build cache. */
export function entriesFromLedger({ ledger, generation = 0, readAsset }) {
  if (!Array.isArray(ledger?.builds) || ledger.builds.length === 0) throw new Error('Unreadable retention ledger');
  if (generation === 1 && ledger.builds.length === 1) {
    entriesFromLedger({ ledger, generation: 0, readAsset });
    return { entries: [], reason: 'no-previous-build' };
  }
  const files = ledger.builds[generation]?.files;
  if (!Array.isArray(files) || files.length === 0) throw new Error('Unreadable retained build');
  const entries = [];
  for (const file of new Set(files)) {
    // Validate before handing a cache-controlled filename to the filesystem.
    if (typeof file !== 'string' || !/^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/.test(file)) throw new Error('Invalid retained filename');
    if (!file.endsWith('.js')) continue;
    const source = readAsset(file);
    if (!/\b(?:const|let|var)\s+__vite__mapDeps\s*=/.test(source)) continue;
    parseViteMapDeps(source);
    entries.push(assetPath('assets/' + file));
  }
  if (entries.length === 0) throw new Error('No lazy entry found in retained build');
  return { entries, reason: null };
}

export function assetProblem({ status, ctype }, ref) {
  if (status !== 200) return `HTTP ${status} (expected 200)`;
  const mime = String(ctype ?? '').split(';', 1)[0].trim().toLowerCase();
  const good = ref.endsWith('.css') ? mime === 'text/css' : /^(?:text|application)\/(?:javascript|ecmascript|x-javascript)$/.test(mime);
  return good ? null : `unexpected Content-Type "${mime || '(none)'}" (expected ${ref.endsWith('.css') ? 'text/css' : 'a JS type'})`;
}
