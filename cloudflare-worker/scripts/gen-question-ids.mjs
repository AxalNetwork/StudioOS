#!/usr/bin/env node
/**
 * Task #5 (CH) — Question ID type-gen + manifest builder.
 *
 * Walks the worker question banks and emits:
 *   - cloudflare-worker/src/services/advisor/questionIds.gen.ts
 *       (TS string-literal union of every advisor question id)
 *   - cloudflare-worker/src/services/advisor/banks.manifest.json
 *       (per-id metadata: bank, persona, section, page_target,
 *        doc_anchor, mi_section, partner_subtype) — consumed by the
 *        frontend `lib/advisor/router.js::predictTarget` AS THE
 *        AUTHORITATIVE SOURCE for client-side optimistic page-target
 *        prediction. The legacy frontend `lib/advisor/banks/*.js`
 *        files only seed UI hints; the manifest wins on conflict.
 *
 * Re-run after editing any bank file. Wired into `npm run test:drift`
 * via `scripts/check-advisor-bank-drift.mjs` which calls --check first.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_SRC = resolve(HERE, '../src/services/advisor');

const BANK_FILES = {
  newFounderSpinout: { rel: 'banks/newFounderSpinout.ts', persona: 'founder' },
  existingFounder:   { rel: 'banks/existingFounder.ts',   persona: 'founder' },
  investor:          { rel: 'banks/investor.ts',          persona: 'investor' },
  operatingPartner:  { rel: 'banks/operatingPartner.ts',  persona: 'partner' },
  mentor:            { rel: 'banks/mentor.ts',            persona: 'mentor' },
  admin:             { rel: 'banks/admin.ts',             persona: 'admin' },
};

const PARTNER_SUBTYPE_BY_HELPER = {
  SP: 'service_provider',
  MA: 'mentor_advisor',
  ST: 'strategic',
  CV: 'corporate_venture',
};

// --------------------------------------------------------------------
// Tokenizer-aware scanner: skip string literals + comments so braces
// inside strings don't confuse depth tracking.
// --------------------------------------------------------------------
function skipString(src, i) {
  const q = src[i]; i++;
  while (i < src.length && src[i] !== q) {
    if (src[i] === '\\') i += 2; else i++;
  }
  return i + 1;
}
function skipLineComment(src, i) {
  while (i < src.length && src[i] !== '\n') i++;
  return i;
}
function skipBlockComment(src, i) {
  i += 2;
  while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
  return i + 2;
}

// Find the matching closing char for an opening char at position i.
// Honors string literals and JS/TS comments.
function findMatching(src, i, open, close) {
  let depth = 1; i++;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (ch === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (ch === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    if (ch === open) depth++;
    else if (ch === close) depth--;
    i++;
  }
  return i; // position AFTER matching close
}

// Top-level comma split inside a parenthesised arg list.
function splitArgs(src) {
  const out = []; let depth = 0; let start = 0; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (ch === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (ch === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(src.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function unquote(s) {
  if (!s) return undefined;
  const m = /^['"]([^'"]*)['"]$/.exec(s.trim());
  return m ? m[1] : undefined;
}

// Extract per-row object literal fields we care about.
function parseRowObject(rowSrc, defaults) {
  const out = { ...defaults };
  const idM = /\bid:\s*['"]([^'"]+)['"]/.exec(rowSrc);
  if (!idM) return null;
  out.id = idM[1];
  const get = (key) => {
    const re = new RegExp(`\\b${key}:\\s*(['"][^'"]+['"]|undefined)`);
    const m = re.exec(rowSrc);
    return m ? unquote(m[1]) : undefined;
  };
  const ptOverride = get('page_target');
  if (ptOverride) out.page_target = ptOverride;
  const daOverride = get('doc_anchor');
  if (daOverride) out.doc_anchor = daOverride;
  const sectionOverride = get('section');
  if (sectionOverride) out.section = sectionOverride;
  const personaOverride = get('persona');
  if (personaOverride) out.persona = personaOverride;
  const mi = get('mi_section') || get('mi');
  if (mi) out.mi_section = mi;
  const subtype = get('partner_subtype');
  if (subtype) out.partner_subtype = subtype;
  return out;
}

// Walk an array body `[{...},{...},...]` and return per-row objects
// using the supplied defaults. Honors nested objects via brace match.
function parseRowsBody(body, defaults) {
  const rows = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{') {
      const end = findMatching(body, i, '{', '}');
      const objSrc = body.slice(i + 1, end - 1);
      const row = parseRowObject(objSrc, defaults);
      if (row) rows.push(row);
      i = end;
    } else { i++; }
  }
  return rows;
}

// Find every `block(...)` / SP/MA/ST/CV(...) call and parse it.
function parseHelperCalls(src, defaultPersona) {
  const rows = [];
  const callRe = /\b(block|SP|MA|ST|CV)\s*\(/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const name = m[1];
    const openParen = m.index + name.length;
    const end = findMatching(src, openParen, '(', ')');
    const inner = src.slice(openParen + 1, end - 1);
    const args = splitArgs(inner);

    let section, page, anchor, subtype = PARTNER_SUBTYPE_BY_HELPER[name];
    let bodySrc;

    // Detect array-arg position. SP/MA/ST/CV: rows = args[0]; section/page/anchor follow.
    // block: rows = LAST arg; preceding args are (subtype?,) section, page, anchor.
    if (subtype) {
      bodySrc = args[0];
      section = unquote(args[1]);
      page = unquote(args[2]) ?? '/partner-portal';
      anchor = unquote(args[3]) ?? 'network/partners';
    } else {
      bodySrc = args[args.length - 1];
      const head = args.slice(0, -1);
      // 5-arg variant: subtype is first identifier (or `undefined`).
      if (head.length === 4) {
        const sub = head[0].trim();
        if (sub !== 'undefined' && !sub.startsWith("'") && !sub.startsWith('"')) {
          // Identifier subtype literal — operatingPartner SHARED uses `undefined`
          // so we only land here for hypothetical future variants.
        }
        section = unquote(head[1]);
        page = unquote(head[2]);
        anchor = unquote(head[3]);
      } else {
        section = unquote(head[0]);
        page = unquote(head[1]);
        anchor = unquote(head[2]);
      }
    }

    if (!bodySrc || !bodySrc.startsWith('[')) continue;
    const body = bodySrc.slice(1, -1); // strip outer [ ]
    const defaults = { persona: defaultPersona, section, page_target: page, doc_anchor: anchor };
    if (subtype) defaults.partner_subtype = subtype;
    rows.push(...parseRowsBody(body, defaults));

    // Reset regex cursor past this call so nested calls inside body
    // are still picked up by the outer loop.
    callRe.lastIndex = openParen + 1;
  }
  return rows;
}

// For newFounderSpinout: each row is a flat top-level object literal
// inside the exported array. Walk top-level `{...}` objects.
function parseFlatBank(src, defaultPersona) {
  // Locate the EXPORT array: `export const FOO_BANK[: Question[]] = [`
  const arrM = /export\s+const\s+\w+_BANK[^=]*=\s*\[/.exec(src);
  if (!arrM) return [];
  const startIdx = arrM.index + arrM[0].length - 1; // points at '['
  const end = findMatching(src, startIdx, '[', ']');
  const body = src.slice(startIdx + 1, end - 1);
  return parseRowsBody(body, { persona: defaultPersona });
}

function parseBank(filePath, persona, isFlat) {
  const src = readFileSync(filePath, 'utf8');
  const helperRows = parseHelperCalls(src, persona);
  const flatRows = isFlat ? parseFlatBank(src, persona) : [];
  // De-dupe by id, last-write-wins (helpers run after flat in our files).
  const byId = new Map();
  for (const r of [...flatRows, ...helperRows]) byId.set(r.id, r);
  return [...byId.values()];
}

function buildManifest() {
  const manifest = {};
  for (const [bankName, { rel, persona }] of Object.entries(BANK_FILES)) {
    const isFlat = bankName === 'newFounderSpinout';
    manifest[bankName] = parseBank(resolve(WORKER_SRC, rel), persona, isFlat);
  }
  // Role detector ids from questionBank.ts.
  const qbSrc = readFileSync(resolve(WORKER_SRC, 'questionBank.ts'), 'utf8');
  const detector = [];
  const detectorRegex = /id:\s*['"](role_detect\.[a-z_]+)['"]/g;
  let m;
  while ((m = detectorRegex.exec(qbSrc)) !== null) {
    detector.push({ id: m[1], persona: 'unknown', section: 'ROLE',
      page_target: '/onboarding/persona', doc_anchor: 'getting-started/personas' });
  }
  manifest.roleDetector = detector;
  return manifest;
}

function emit(manifest) {
  const allIds = [];
  for (const rows of Object.values(manifest)) for (const r of rows) allIds.push(r.id);
  const unique = Array.from(new Set(allIds)).sort();

  const tsHeader = `// AUTO-GENERATED by cloudflare-worker/scripts/gen-question-ids.mjs.
// Do NOT edit by hand — re-run \`node cloudflare-worker/scripts/gen-question-ids.mjs\`
// (or \`npm run test:drift\`) after changing any bank file.
//
// Task #5 (CH) — string-literal union of every advisor question id
// across all persona banks + the role detector. Used by writeRouter
// coverage tests + any consumer that needs an exhaustive switch.
`;
  const tsBody = `export type AdvisorQuestionId =\n  | ${unique.map(id => `'${id}'`).join('\n  | ')};\n\nexport const ADVISOR_QUESTION_IDS: readonly AdvisorQuestionId[] = ${JSON.stringify(unique, null, 2)} as const;\n`;
  writeFileSync(resolve(WORKER_SRC, 'questionIds.gen.ts'), tsHeader + '\n' + tsBody);
  writeFileSync(resolve(WORKER_SRC, 'banks.manifest.json'),
    JSON.stringify({ schema: 1, banks: manifest }, null, 2) + '\n');
  return { unique, manifest };
}

function readEmittedIds() {
  try {
    const src = readFileSync(resolve(WORKER_SRC, 'questionIds.gen.ts'), 'utf8');
    const ids = [];
    const re = /'([^']+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) ids.push(m[1]);
    return new Set(ids);
  } catch { return new Set(); }
}

function readEmittedManifest() {
  try {
    const src = readFileSync(resolve(WORKER_SRC, 'banks.manifest.json'), 'utf8');
    return JSON.parse(src);
  } catch { return null; }
}

const args = new Set(process.argv.slice(2));
const manifest = buildManifest();
const expected = new Set();
for (const rows of Object.values(manifest)) for (const r of rows) expected.add(r.id);

if (args.has('--check')) {
  const current = readEmittedIds();
  const missing = [...expected].filter((id) => !current.has(id));
  const stale   = [...current].filter((id) => !expected.has(id));
  // Also assert the manifest's per-id page_target is in sync (not just ids).
  const cur = readEmittedManifest();
  let manifestDrift = false;
  if (cur && cur.banks) {
    for (const [bank, rows] of Object.entries(manifest)) {
      const curRows = cur.banks[bank] || [];
      const curById = new Map(curRows.map((r) => [r.id, r]));
      for (const r of rows) {
        const c = curById.get(r.id);
        if (!c || c.page_target !== r.page_target || c.persona !== r.persona) {
          manifestDrift = true;
          console.error(`  manifest drift: ${bank}/${r.id} (page_target/persona changed)`);
        }
      }
    }
  } else {
    manifestDrift = true;
    console.error('  manifest missing or unreadable');
  }
  if (missing.length || stale.length || manifestDrift) {
    console.error('[gen-question-ids] DRIFT: questionIds.gen.ts / banks.manifest.json out of date.');
    if (missing.length) console.error('  missing:', missing.slice(0, 20).join(', '), missing.length > 20 ? `(+${missing.length - 20})` : '');
    if (stale.length)   console.error('  stale:',   stale.slice(0, 20).join(', '),   stale.length   > 20 ? `(+${stale.length - 20})`   : '');
    console.error('  fix: `node cloudflare-worker/scripts/gen-question-ids.mjs`');
    process.exit(1);
  }
  console.log(`[gen-question-ids] OK — ${expected.size} ids in sync.`);
  process.exit(0);
}

const { unique } = emit(manifest);
console.log(`[gen-question-ids] wrote ${unique.length} ids → questionIds.gen.ts + banks.manifest.json`);
