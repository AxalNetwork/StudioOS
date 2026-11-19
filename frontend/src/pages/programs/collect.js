/**
 * D6966 (#6966) — the program presentation map's rules: the availability words, the shape of
 * one map entry, and `collectPrograms`, which turns the files under `catalog/` into the map.
 *
 * Plain JavaScript with no imports, so the Node scripts (the PDF builder, the Open Graph
 * prerender and its validator) read the same rules the SPA does. `registry.jsx` hands this the
 * Vite glob of `catalog/*.js`; `scripts/lib/programCatalog.mjs` hands it the same files read
 * from disk. A map entry that breaks a rule throws, naming its file: a presentation link that
 * points nowhere is the failure this exists to stop.
 */

/**
 * Availability, in words (PGS00 §1). The glyph and the word carry the meaning; the tint only
 * helps. A sibling that needs another word adds it here in key order, in its own line.
 */
export const AVAILABILITY = Object.freeze({
  apply: Object.freeze({ label: 'By application', glyph: '◆' }),
  assigned: Object.freeze({ label: 'Assigned by an admin', glyph: '◇' }),
  closed: Object.freeze({ label: 'Closed', glyph: '○' }),
  invite: Object.freeze({ label: 'By invitation only', glyph: '◇' }),
  notyet: Object.freeze({ label: 'Not open yet', glyph: '◷' }),
  open: Object.freeze({ label: 'Open to all members', glyph: '●' }),
  proposed: Object.freeze({ label: 'Proposed · not open', glyph: '◌' }),
});

/** The five sections every presentation has, in this order (PGS00 §3). */
export const SECTION_TITLES = Object.freeze(['Who it helps', 'What they do', 'How participation works', 'Access required', 'Next step']);
export const SECTION_IDS = Object.freeze(['who', 'what', 'how', 'access', 'next']);

/** A key is the registry's (`programsModel.js` PROGRAMS): lowercase words joined by hyphens. */
export const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The committed file's public path for a key: `/program-briefs/axal-vc-<key>-v<n>.pdf`. */
export const pdfPattern = (key) => new RegExp(`^/program-briefs/axal-vc-${key}-v[1-9][0-9]*\\.pdf$`);

/** The file name a Download PDF link saves under. */
export const pdfFileName = (pdf) => String(pdf).split('/').pop();

/** The alias every program answers at, whatever its canonical page. */
export const aliasOf = (key) => `/programs/${key}`;

const REQUIRED = ['key', 'name', 'group', 'avail', 'purpose', 'audience', 'canonical', 'pdf', 'edition', 'slides', 'og', 'card'];

/**
 * One map entry, checked. `file` is the catalog file's own name (`spinout-lab.js`), and the
 * key must be the file's stem, so two programs can never claim one key.
 */
export function checkEntry(entry, file) {
  const where = `programs/catalog/${file}`;
  if (!entry || typeof entry !== 'object') throw new Error(`${where}: default-export the program's map entry`);
  for (const k of REQUIRED) {
    if (entry[k] === undefined || entry[k] === null || entry[k] === '') throw new Error(`${where}: \`${k}\` is required`);
  }
  const stem = file.replace(/\.js$/, '');
  if (entry.key !== stem) throw new Error(`${where}: key "${entry.key}" must be the file's name ("${stem}")`);
  if (!KEY_PATTERN.test(entry.key)) throw new Error(`${where}: key "${entry.key}" is not lowercase-hyphenated`);
  if (!AVAILABILITY[entry.avail]) throw new Error(`${where}: avail "${entry.avail}" is not one of ${Object.keys(AVAILABILITY).join(', ')}`);
  if (entry.availText !== undefined && (typeof entry.availText !== 'string' || !entry.availText)) throw new Error(`${where}: availText, when given, is the label's words`);
  if (!pdfPattern(entry.key).test(entry.pdf)) throw new Error(`${where}: pdf "${entry.pdf}" must be /program-briefs/axal-vc-${entry.key}-v<n>.pdf`);
  if (!/^\/[a-z0-9/-]*$/.test(entry.canonical) || entry.canonical.includes('//')) throw new Error(`${where}: canonical "${entry.canonical}" must be a same-origin path`);
  if (!Number.isInteger(entry.slides) || entry.slides < 4 || entry.slides > 6) throw new Error(`${where}: slides must be 4 to 6`);
  if (!entry.og.title || !entry.og.description) throw new Error(`${where}: og needs a title and a description`);
  if (!entry.card.who) throw new Error(`${where}: card.who is required`);
  return Object.freeze({ ...entry, alias: aliasOf(entry.key), file: pdfFileName(entry.pdf) });
}

/**
 * The map, from `{ './catalog/<key>.js': module }`. Sorted by `order` (0 when absent), then by
 * name. Two entries with one PDF file name, or one canonical page, throw: a wrong-program
 * download is a filename collision nobody sees until it is opened.
 */
export function collectPrograms(globbed) {
  const out = [];
  for (const [path, mod] of Object.entries(globbed || {})) {
    const file = path.replace(/^.*\//, '');
    out.push({ order: Number.isFinite(mod?.order) ? mod.order : 0, entry: checkEntry(mod?.default, file) });
  }
  const seen = new Map();
  for (const { entry } of out) {
    for (const [what, v] of [['pdf', entry.file], ['canonical page', entry.canonical]]) {
      const k = `${what}:${v}`;
      if (seen.has(k)) throw new Error(`programs/catalog: ${entry.key} and ${seen.get(k)} share the ${what} ${v}`);
      seen.set(k, entry.key);
    }
  }
  return Object.freeze(out
    .sort((a, b) => (a.order - b.order) || a.entry.name.localeCompare(b.entry.name))
    .map((o) => o.entry));
}
