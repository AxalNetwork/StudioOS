#!/usr/bin/env node
/**
 * D764 (#2089) — the Worker's model matrix, generated from the owner's canvas.
 *
 *   node scripts/build-rail-matrix.mjs           write the matrix
 *   node scripts/build-rail-matrix.mjs --check   exit 1 when the committed file differs
 *
 * Reads `design/incoming/airail-every-page-data/canvas.json` (the canvas's own
 * tables: profiles, each page's kind of work, each kind's suggested models) and
 * `scripts/lib/railMatrixOverrides.json` (the name → id table, each kind's
 * shape, and the page rows the canvas has no board for), and writes
 * `cloudflare-worker/src/services/ai/railMatrix.json`.
 *
 * One row per page: `{ pageKey, kind, routeTask, models: [{ id, role, line }] }`.
 * The page key is `<Profile> · <Section>` or `<Profile> · <Section> · <Module>`
 * in the canvas's names. `models[0]` is the default and the only card that says
 * Default. A kind on the axal-search index takes the index's own model, because
 * the index is 768-dimensional and only bge-base writes it.
 *
 * The rules D720 §5 sets are checked here as well as in the test, so a bad
 * canvas or override never writes a file: every id is one the pricing file
 * prices, every model fits its kind's shape, every paid-only default has a
 * non-paid alternative of the same shape, and member-visible strings follow
 * the voice rule.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANVAS = 'design/incoming/airail-every-page-data/canvas.json';
const PRICING = 'design/incoming/airail-every-page-data/cloudflare-pricing-2026-10-15.md';
const OVERRIDES = 'scripts/lib/railMatrixOverrides.json';
export const OUT = 'cloudflare-worker/src/services/ai/railMatrix.json';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Every `@cf/…` id the pricing file prices, and its "Paid billing only" list. */
export function readPricing(md) {
  const priced = new Set();
  for (const m of md.matchAll(/^\| `(@cf\/[^`]+)`/gm)) priced.add(m[1]);
  // The list is one paragraph that wraps over several lines: read to its blank line.
  const at = md.indexOf('**Paid billing only:**');
  const end = at < 0 ? at : md.indexOf('\n\n', at);
  const paid = at < 0 ? '' : md.slice(at, end < 0 ? undefined : end);
  const paidOnly = new Set([...paid.matchAll(/`(@cf\/[^`]+)`/g)].map((m) => m[1]));
  return { priced, paidOnly };
}

/** Member-visible words D720 §5 bans. "Advisor" is allowed only as the profile's name, which no role or line carries. */
/** `axal-search` is a 768-dimension index that bge-base writes (wrangler.toml); no other model can read it. */
export const SEARCH_INDEX_MODEL = '@cf/baai/bge-base-en-v1.5';

export const VOICE_BANNED = /\b(advice|advise|advisor|recommend\w*|recommendation|fiduciar\w*)\b/i;

export function buildMatrix(canvas, overrides, pricing) {
  const problems = [];
  const modelOf = (name) => {
    const m = overrides.models[name];
    if (!m) problems.push(`no id for the canvas model "${name}"`);
    return m;
  };
  const capsOf = (id) => Object.values(overrides.models).find((m) => m.id === id)?.caps ?? [];

  // Each kind's models, resolved once: ids, the search index, and Default first.
  const kindModels = {};
  for (const [kind, suggested] of Object.entries(canvas.suggested)) {
    const shape = overrides.kinds[kind];
    if (!shape) { problems.push(`kind ${kind} has no shape`); continue; }
    const onIndex = overrides.searchIndexKinds.includes(kind);
    const out = [];
    for (const s of suggested) {
      const m = modelOf(s.t);
      if (!m) continue;
      const id = onIndex && m.caps.includes('embedding') ? overrides.searchIndexModel : m.id;
      if (out.some((x) => x.id === id)) continue; // a second index model on axal-search collapses into the first
      out.push({ id, role: s.role, line: s.line });
    }
    out.forEach((m, i) => { if (i === 0) m.role = 'Default'; });
    kindModels[kind] = out;
  }

  if (overrides.searchIndexModel !== SEARCH_INDEX_MODEL) {
    problems.push(`searchIndexModel is ${overrides.searchIndexModel}: axal-search is 768-dimensional and only ${SEARCH_INDEX_MODEL} reads it`);
  }
  const rows = [];
  const add = (pageKey, kind) => {
    const models = kindModels[kind];
    if (!models) { problems.push(`${pageKey}: kind ${kind} has no models`); return; }
    rows.push({ pageKey, kind, routeTask: `rail_${kind}`, models: models.map((m) => ({ ...m })) });
  };
  for (const [profile, sections] of Object.entries(canvas.profiles)) {
    for (const [section, modules] of Object.entries(sections)) {
      const sectionKind = canvas.task_kind[section];
      if (!sectionKind) problems.push(`${profile} · ${section} has no kind`);
      add(`${profile} · ${section}`, sectionKind);
      for (const mod of modules) {
        const kind = canvas.task_kind[mod];
        if (!kind) problems.push(`${profile} · ${section} · ${mod} has no kind`);
        add(`${profile} · ${section} · ${mod}`, kind);
      }
    }
  }
  for (const [pageKey, o] of Object.entries(overrides.pages)) {
    if (rows.some((r) => r.pageKey === pageKey)) problems.push(`${pageKey} is on the canvas; drop its override`);
    else add(pageKey, o.kind);
  }

  for (const r of rows) problems.push(...rowProblems(r, overrides, pricing, capsOf));
  if (new Set(rows.map((r) => r.pageKey)).size !== rows.length) problems.push('a page key is used twice');
  return { rows, problems };
}

/** D720 §5's rules for one page row; an empty list when it holds. */
export function rowProblems(row, overrides, pricing, capsOf) {
  const out = [];
  const shape = overrides.kinds[row.kind];
  const at = row.pageKey;
  if (!row.models.length) out.push(`${at}: no models`);
  row.models.forEach((m, i) => {
    if (!pricing.priced.has(m.id)) out.push(`${at}: ${m.id} is not in the pricing file`);
    const caps = capsOf(m.id);
    if (!caps.some((c) => shape.allow.includes(c))) out.push(`${at}: ${m.id} does not fit ${row.kind}`);
    if (i === 0 && !caps.includes(shape.defaultNeeds)) out.push(`${at}: the default ${m.id} cannot do ${shape.defaultNeeds}`);
    if (shape.allow.length === 1 && !caps.includes(shape.allow[0])) out.push(`${at}: ${m.id} cannot do ${shape.allow[0]}`);
    if ((m.role === 'Default') !== (i === 0)) out.push(`${at}: only models[0] says Default`);
    for (const s of [m.role, m.line]) if (VOICE_BANNED.test(s)) out.push(`${at}: "${s}" breaks the voice rule`);
    if (overrides.searchIndexKinds.includes(row.kind) && caps.includes('embedding') && m.id !== overrides.searchIndexModel) {
      out.push(`${at}: ${m.id} cannot read axal-search`);
    }
  });
  const def = row.models[0];
  if (def && pricing.paidOnly.has(def.id)) {
    const need = shape.defaultNeeds;
    const ok = row.models.slice(1).some((m) => !pricing.paidOnly.has(m.id) && capsOf(m.id).includes(need));
    if (!ok) out.push(`${at}: the paid-only default ${def.id} has no non-paid ${need} alternative`);
  }
  return out;
}

export function render() {
  const canvas = JSON.parse(read(CANVAS));
  const overrides = JSON.parse(read(OVERRIDES));
  const pricing = readPricing(read(PRICING));
  const { rows, problems } = buildMatrix(canvas, overrides, pricing);
  if (problems.length) throw new Error(`build-rail-matrix:\n  ${problems.join('\n  ')}`);
  const body = {
    _generated: `by scripts/build-rail-matrix.mjs from ${CANVAS} and ${OVERRIDES}. Do not edit by hand (D764).`,
    rows,
  };
  return `${JSON.stringify(body, null, 1)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = render();
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = read(OUT); } catch { /* missing reads as different */ }
    if (committed !== text) {
      console.error(`✖ ${OUT} is not the script's output. Run: node scripts/build-rail-matrix.mjs`);
      process.exit(1);
    }
    console.log(`✓ ${OUT} matches the canvas and the overrides.`);
  } else {
    writeFileSync(join(ROOT, OUT), text);
    console.log(`wrote ${OUT}`);
  }
}
