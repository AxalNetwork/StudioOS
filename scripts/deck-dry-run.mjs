#!/usr/bin/env node
/**
 * D1509 (#3760, deck v2 A16) — the dry run before The Grid ships: every deck
 * of an owner-exported D1 backup, drawn as v1 draws it and as The Grid draws
 * it, with every difference listed and each one explained or not.
 *
 *   npx wrangler d1 export studioos-db --remote --output=/path/backup.sql   (the owner, out of scope here)
 *   node scripts/deck-dry-run.mjs /path/backup.sql [--all-versions] [--json]
 *
 * WHAT IT COMPARES, per card of each current version (every version with
 * `--all-versions`):
 *   before  what Present draws today (`presentExportModel.cardOf`): the title,
 *           the subtitle, its lines and bullets, and each figure's label and
 *           value.
 *   after   the card on The Grid: a card saved with fields converts through
 *           the same proposal the editor makes (`editorModel.withFieldBlocks`),
 *           and its blocks are what is drawn.
 * The two are compared as bags of words, and the blocks are checked on the
 * grid (`placementProblem`: inside the 12 × 6, no overlap) and for words the
 * block no longer holds at the deck's aspect (`deckReflow.textCapacity`).
 *
 * EXPLAINED (listed, never a failure):
 *   converted    a fields card became blocks, every word kept.
 *   placeholder  a "Not recorded on StudioOS yet" line the conversion leaves
 *                out (the one-click cut, plan §3.4); the figure's own tile
 *                still says Not recorded.
 * UNEXPLAINED (exit 1): words lost, words added, a conversion refused, a block
 * off the grid or over another, a text block over its capacity.
 *
 * KEEPS NO COPY. The dump is read into an in-memory SQLite database and
 * dropped on exit; nothing is written to disk or sent anywhere. The report
 * names deck ids, versions, card numbers, kinds and counts only: never a
 * word of a deck, a venture's name or a person.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

/** The frontend models import extensionless paths: the deck loader resolves them, as it does for the tests. */
let models = null;
export async function loadModels() {
  if (models) return models;
  try { register(new URL('../frontend/test/_deck-loader-hook.mjs', import.meta.url)); } catch { /* already registered */ }
  const [present, editor, reflow, gridModel, absence] = await Promise.all([
    import('../frontend/src/pages/raise/pitch/presentExportModel.js'),
    import('../frontend/src/pages/raise/pitch/editorModel.js'),
    import('../frontend/src/pages/raise/pitch/deckReflow.js'),
    import('../frontend/src/pages/raise/pitch/gridModel.js'),
    import('../frontend/src/lib/absence.js'),
  ]);
  models = { present, editor, reflow, gridModel, NOT_RECORDED: absence.NOT_RECORDED };
  return models;
}

const MODEL = Object.freeze({ grid: { cols: 12, rows: 6 }, max_blocks: 24 });
const words = (t) => String(t ?? '').toLowerCase().split(/[^\p{L}\p{N}%$€£.,]+/u).map((w) => w.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);

function bag(list) {
  const m = new Map();
  for (const w of list) m.set(w, (m.get(w) || 0) + 1);
  return m;
}
/** The words of `a` that `b` lacks, counted. */
function minus(a, b) {
  let n = 0;
  for (const [w, k] of a) n += Math.max(0, k - (b.get(w) || 0));
  return n;
}

/** What v1 draws for a card, as words, and the words of its "Not recorded" lines. */
function beforeWords(m, slide, i) {
  const c = m.present.cardOf(slide, i);
  const nr = m.NOT_RECORDED;
  const placeholder = [];
  const shown = [c.title, c.sub];
  for (const l of c.lines) (String(l).includes(nr) ? placeholder : shown).push(l);
  shown.push(...c.bullets);
  for (const f of c.figures) shown.push(f.k, f.v === nr ? '' : f.v);
  return { shown: words(shown.join(' ')), placeholder: words(placeholder.join(' ')), titleFallback: !String(slide?.title ?? '').trim() };
}

/** What The Grid draws for a card's blocks, as words. */
function afterWords(blocks) {
  // The Grid draws blocks only: a converted card's title is its heading block.
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'text') out.push(b.text);
    else if (b.kind === 'metric') out.push(b.label, b.value);
  }
  return words(out.join(' '));
}

/** One card's differences: `{ explained: [kind], unexplained: [{ kind, n? }] }`. */
export function compareCard(m, slide, i, aspect = '16:9') {
  const explained = [];
  const unexplained = [];
  if (!slide || typeof slide !== 'object') return { explained, unexplained };
  const hadBlocks = Array.isArray(slide.blocks) && slide.blocks.length > 0;
  const r = m.editor.withFieldBlocks(slide, MODEL);
  if (r.error) return { explained, unexplained: [{ kind: 'conversion_refused' }] };
  const card = r.card;
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  if (!hadBlocks && blocks.length) explained.push('converted');
  if (!hadBlocks) {
    const before = beforeWords(m, slide, i);
    const after = bag(afterWords(blocks));
    // v1 names an untitled card "Card N"; that is chrome, not the deck's words.
    const shown = bag(before.titleFallback ? before.shown.filter((w, k) => !(k < 2 && (w === 'card' || /^\d+$/.test(w)))) : before.shown);
    const lost = minus(shown, after);
    const added = minus(after, bag([...before.shown, ...before.placeholder]));
    if (before.placeholder.length) explained.push('placeholder');
    if (lost) unexplained.push({ kind: 'words_lost', n: lost });
    if (added) unexplained.push({ kind: 'words_added', n: added });
  }
  for (const b of blocks) {
    if (!b?.grid) continue;
    const problem = m.editor.placementProblem(card, b.grid, MODEL, b.id);
    if (problem) { unexplained.push({ kind: /overlap/i.test(problem) ? 'overlap' : 'off_grid' }); continue; }
    if (b.kind === 'text') {
      const cap = m.reflow.textCapacity(b.grid, m.reflow.typeRoleOf(b.style, card.layout ?? null), aspect);
      if (String(b.text ?? '').length > cap) unexplained.push({ kind: 'over_capacity' });
    }
  }
  return { explained, unexplained };
}

/** The report for a dump's text: `{ decks, cards, explained: {kind: n}, unexplained: [{ deck, version, card, kind, n? }] }`. */
export async function dryRun(sqlText, { allVersions = false } = {}) {
  const m = await loadModels();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sqlText);
    const cols = new Set(db.prepare('PRAGMA table_info(pitch_decks)').all().map((c) => c.name));
    const theme = cols.has('theme_json') ? 'theme_json' : 'NULL AS theme_json';
    const rows = db.prepare(`SELECT id, version, slides, ${theme} FROM pitch_decks ${allVersions ? '' : 'WHERE is_current = 1'} ORDER BY id`).all();
    const report = { decks: 0, cards: 0, explained: {}, unexplained: [] };
    for (const row of rows) {
      report.decks += 1;
      let slides;
      try { slides = JSON.parse(row.slides); } catch { report.unexplained.push({ deck: row.id, version: row.version, card: null, kind: 'slides_unreadable' }); continue; }
      let aspect = '16:9';
      try { aspect = m.gridModel.aspectOf(JSON.parse(row.theme_json || 'null')?.aspect); } catch { /* 16:9 */ }
      (Array.isArray(slides) ? slides : []).forEach((s, i) => {
        report.cards += 1;
        const d = compareCard(m, s, i, aspect);
        for (const k of d.explained) report.explained[k] = (report.explained[k] || 0) + 1;
        for (const u of d.unexplained) report.unexplained.push({ deck: row.id, version: row.version, card: i + 1, ...u });
      });
    }
    return report;
  } finally {
    db.close();
  }
}

function print(report) {
  const lines = [`Decks: ${report.decks} · cards: ${report.cards}`];
  const ex = Object.entries(report.explained);
  lines.push(ex.length ? `Explained: ${ex.map(([k, n]) => `${k} ${n}`).join(' · ')}` : 'Explained: none');
  lines.push(`Unexplained: ${report.unexplained.length}`);
  for (const u of report.unexplained) lines.push(`  deck ${u.deck} v${u.version}${u.card ? ` card ${u.card}` : ''}: ${u.kind}${u.n ? ` (${u.n})` : ''}`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) { console.error('Usage: node scripts/deck-dry-run.mjs <backup.sql> [--all-versions] [--json]'); process.exit(2); }
  const report = await dryRun(readFileSync(file, 'utf8'), { allVersions: process.argv.includes('--all-versions') });
  console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : print(report));
  process.exit(report.unexplained.length ? 1 : 0);
}
