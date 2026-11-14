/**
 * D1542 (#3780, deck v2 B4) — the one-click path's record-placed diagrams are
 * left alone. `recordDiagrams` (`services/decks/visuals.ts`, D903 §10), which
 * `routes/deck_new.ts` places on the roadmap, use-of-funds, market and
 * competition cards, must give exactly what it gave before the `grid_diagram`
 * job landed: this file pins its whole output for one synthetic venture, the
 * composer's blocks drawn from it, and that neither file reaches the job.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_record_diagrams_pin_d1542.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { recordDiagrams } from '../src/services/decks/visuals.ts';
import { buildCards, standardOutline } from '../src/services/decks/newDeck.ts';
import { fitProblems } from '../src/services/decks/designSystem.ts';
import { fullRecords, wordsFor } from './fixtures/pitchStoryFixtures.ts';

function venture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO projects(id,name,founder_id,use_of_funds,updated_at) VALUES (1,'Synthetic venture',100,?,'2026-10-05 09:00:00')")
    .run(JSON.stringify([{ label: 'Product & engineering', pct: 30 }, { label: 'GTM: sales and marketing', pct: 15 }, { label: 'Operations, legal & compliance', pct: 55 }]));
  db.exec(`INSERT INTO roadmap_okrs(id,project_id,objective,kanban_status,quarter,sort_order,updated_at) VALUES
    (1,1,'Self-serve onboarding','later','2027-Q2',0,'2026-10-01'),(2,1,'Multi-entity close','now','2026-Q4',1,'2026-10-02'),
    (3,1,'Auditor workspace','next',NULL,0,'2026-10-03'),(4,1,'Old launch','done','2026-Q1',0,'2026-10-04')`);
  db.exec(`INSERT INTO competitor_analyses(id,user_id,project_id) VALUES ('a1',1,1);
    INSERT INTO competitor_candidates(id,analysis_id,name) VALUES ('c1','a1','Ledgerly'),('c2','a1','CloseKit');
    INSERT INTO competitor_tracking(id,uid,project_id,name_norm,price_position,depth_position,updated_at) VALUES
      (1,'t1',1,'ledgerly','higher','broader','2026-10-01'),(2,'t2',1,'closekit','lower','narrower','2026-10-02')`);
  return { DB: d1Over(db) } as any;
}

const bind = (source_key: string, record_ref: string, as_of: string, snapshot_hash: string) => ({ source_key, record_ref, as_of, grade: 'Stated', snapshot_hash });
const FUNDS = bind('raise.use_of_funds', 'projects:1', '2026-10-05', '070e83bc6b367c8b00d98470');
const COMP = bind('validate.competitors', 'competitor_tracking:1,2', '2026-10-02', '09564c897f4d1d566754ee33');
const MATRIX = {
  v: 1, type: 'matrix', axes: { x: 'Price against ours', y: 'Depth against ours' },
  items: [
    { label: 'Cheaper and broader', detail: 'None recorded here', binding: COMP },
    { label: 'Pricier and broader', detail: 'Ledgerly', binding: COMP },
    { label: 'Cheaper and narrower', detail: 'CloseKit', binding: COMP },
    { label: 'Pricier and narrower', detail: 'None recorded here', binding: COMP },
  ],
};
const PINNED = {
  diagrams: {
    roadmap: {
      v: 1, type: 'timeline', items: [
        { label: 'Multi-entity close', detail: 'Now · 2026-Q4', binding: bind('build.roadmap', 'roadmap_okrs:2', '2026-10-02', 'de0f1d175d8df236d10e4c82') },
        { label: 'Auditor workspace', detail: 'Next', binding: bind('build.roadmap', 'roadmap_okrs:3', '2026-10-03', '9545e8c038616f838f4bb4ca') },
        { label: 'Self-serve onboarding', detail: 'Later · 2027-Q2', binding: bind('build.roadmap', 'roadmap_okrs:1', '2026-10-01', 'f1f85336858f6d8acc450ed8') },
      ],
    },
    use_of_funds: {
      v: 1, type: 'flow', items: [
        { label: 'Operations, legal & compliance', binding: FUNDS }, { label: 'Product & engineering', binding: FUNDS }, { label: 'GTM: sales and marketing', binding: FUNDS },
      ],
    },
    market: MATRIX,
    competition: MATRIX,
  },
  rows: { market: 2, competition: 2 },
};

test('recordDiagrams is unchanged: the whole output for one venture, key by key, record by record', async () => {
  // Mutation checked: drop the quarter from roadmapDiagram's detail → "Now · 2026-Q4" becomes "Now" and this fails;
  // and drop the competition key in recordDiagrams → this fails.
  assert.deepEqual(await recordDiagrams(venture(), 1), PINNED);
});

test('the one-click composer still draws those diagrams as they are, and every card fits', async () => {
  const { diagrams, rows } = await recordDiagrams(venture(), 1);
  const rec = fullRecords();
  const outline = standardOutline('full', 'seed_fund');
  const { slides, problems } = buildCards(outline, rec.items as any, wordsFor(outline), 'Synthetic venture', new Set(), { series: rec.series as any, diagrams, rows });
  assert.deepEqual(problems, []);
  assert.deepEqual(fitProblems(slides.filter((s: any) => !s.appendix)), []);
  const drawn = (id: string) => slides.find((s: any) => s.spec_id === `new:${id}`)?.blocks.find((b: any) => b.kind === 'graphic')?.diagram;
  assert.deepEqual(drawn('roadmap'), PINNED.diagrams.roadmap, 'the dated details keep their quarters: the job\'s number stripping never reaches here');
  assert.deepEqual(drawn('use_of_funds'), PINNED.diagrams.use_of_funds);
  assert.deepEqual(drawn('market'), PINNED.diagrams.market);
});

test('the one-click path does not reach the grid_diagram job', () => {
  // Mutation checked: import gridDiagram into deck_new.ts → this fails.
  for (const f of ['cloudflare-worker/src/services/decks/visuals.ts', 'cloudflare-worker/src/services/decks/newDeck.ts', 'cloudflare-worker/src/routes/deck_new.ts']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /gridDiagram/, f);
  }
  assert.match(readFileSync('cloudflare-worker/src/routes/deck_new.ts', 'utf8'), /import \{ recordDiagrams \} from '\.\.\/services\/decks\/visuals';/);
});
