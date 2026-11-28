/**
 * D5454 part 5 (#5454) — the investor projection carries evidence only as the recipient's own
 * `investorManifestView` (D5457), never the revision's raw `evidence_refs`. Real `node:sqlite` over the schema
 * baseline plus the data-room, Raise evidence and D5454 migrations; the view is built from real store reads
 * (`resolveManifestSources`, `readRecipientFacts`). Every venture, investor, file and figure is invented.
 *
 * What it proves:
 *   - an investor's projection never contains a withheld item's ref, version, name or count, and never the raw
 *     `evidence_refs` or `audience_manifest`; it shows each delivered item as kind, source word, date and purpose;
 *   - two investors with different access see different evidence from the same released revision;
 *   - without a view the projection has no evidence at all, and a view's extra keys are never copied;
 *   - the authoring and review projections are unchanged, and ignore a view;
 *   - a preparation that is not `listed` still projects nothing to an investor.
 *
 * MUTATION CHECKS (`scripts/mutation-check.mjs`; 6 mutations, 6 caught, 0 equivalent):
 *   P1  `evidence_refs` back in `PROJECTIONS.investor`                 → withheld-ref and no-view tests fail
 *   P2  copy the view's `withheld` count into the projection             → withheld-ref test fails
 *   P3  copy each view item whole, without the key allowlist          → extra-keys test fails
 *   P4  attach the view to every projection, not only `investor`      → authoring test fails
 *   P5  ignore the view                                               → withheld-ref test fails (no evidence shown)
 *   P6  the `listed` check dropped from audience projections          → not-listed test fails
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_preparation_investor_projection_5454.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { d1Over } from './_d1_sqlite.mjs';
import { parseManifest, type ManifestItem } from '../src/services/dealPackageManifest.ts';
import { investorManifestView, readRecipientFacts, resolveManifestSources } from '../src/services/dealPackageSources.ts';
import { PROJECTIONS, REVISION_CONTENT_KEYS, project } from '../src/services/dealPreparation.ts';

const MIG = 'cloudflare-worker/sql/migrations/';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NEEDED = ['463_', '506_', '594_', '596_', '597_', '628_', '_6073_data_room_trash', '_5454_deal_preparations'];
const FILES = readdirSync(resolve(process.cwd(), MIG));
const P = 10;
const NOW = Date.parse('2026-11-27T12:00:00Z');

/** 5 founder · 21 investor with a full grant, an NDA and a commitment · 22 investor scoped to folder 300, no NDA. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  // As D5457's suite: some of these files end in a backfill this baseline cannot run; the stores used here come first.
  for (const key of NEEDED) {
    const f = FILES.find((n) => (key.startsWith('_') ? n.includes(key) : n.startsWith(key)));
    assert.ok(f, `migration ${key} exists`);
    try { db.exec(read(MIG + f)); } catch { /* the reads below fail loudly if a store is missing */ }
  }
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active, founder_id) VALUES
      (5, 'founder@example.test', 'Synthetic founder', 'founder', 1, 55),
      (21, 'inv-full@example.test', 'Investor full', 'investor', 1, NULL),
      (22, 'inv-scoped@example.test', 'Investor scoped', 'investor', 1, NULL);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Harbor Ledger Inc');
    INSERT INTO projects (id, name, company_id, founder_id) VALUES (${P}, 'Harbor Ledger', 70, 55);
    INSERT INTO data_room_folders (id, uid, project_id, name, visibility) VALUES
      (300, 'fo-open', ${P}, 'Company', 'open'), (301, 'fo-nda', ${P}, 'Financials', 'nda');
    INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, visibility, access_tier, access_expires_at, source_kind, removed_at, updated_at) VALUES
      (401, 'f-open', ${P}, 300, 'Harbor overview.pdf', 'k1', 'open', 'invited', NULL, 'document', NULL, '2026-10-01 09:00:00'),
      (402, 'f-nda', ${P}, 301, 'Harbor model.xlsx', 'k2', 'open', 'invited', NULL, 'connector', NULL, '2026-10-02 09:00:00'),
      (407, 'f-loose', ${P}, NULL, 'Harbor loose.pdf', 'k7', 'open', 'invited', NULL, 'document', NULL, '2026-10-07 09:00:00');
    INSERT INTO data_room_file_versions (file_id, version, r2_key) VALUES (401, 1, 'k1-v1');
    INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, folders_scoped) VALUES
      (601, 'g-full', ${P}, 21, 5, 'active', 0), (602, 'g-scoped', ${P}, 22, 5, 'active', 1);
    INSERT INTO data_room_grant_folders (grant_id, folder_id) VALUES (602, 300);
    INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (5, 21, 'active');
    INSERT INTO raise_prospects (uid, project_id, email, stage) VALUES ('rp-1', ${P}, 'inv-full@example.test', 'committed');
    INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES
      (500, ${P}, 1, '[]', 'Harbor deck v1', 0, '2026-09-01 10:00:00'), (501, ${P}, 2, '[]', 'Harbor deck v2', 1, '2026-10-01 10:00:00');
  `);
  const ev = db.prepare(`INSERT INTO raise_evidence_items (uid, project_id, area, kind, source_table, source_ref, source_label, strength,
    observed_on, summary, snapshot_hash, state, visibility, private_reason, version, mutation_uid)
    VALUES (?, ?, 'Data room', 'revenue', 'synthetic', ?, ?, 'measured', ?, ?, 'h', 'pinned', ?, NULL, 1, ?)`);
  ev.run('e-summary', P, 's1', 'connector', '2026-10-10', 'Harbor monthly revenue', 'summary', 'm1');
  ev.run('e-nda', P, 's2', 'document', '2026-10-11', 'Harbor cohort retention', 'after_nda', 'm2');
  return db;
}

const item = (kind: ManifestItem['kind'], ref: string, version = 1, purpose: ManifestItem['purpose'] = 'claim_support') => ({ kind, ref, version, purpose });
/** The released revision: offering material, an internal note and a manifest of six items for an NDA audience. */
const RELEASED = {
  id: 1021,
  content: {
    title: 'Harbor Ledger Seed', summary: 'Synthetic seed round', instrument: 'safe', currency: 'EUR',
    internal_notes: 'Synthetic internal note',
    evidence_refs: [
      item('data_room_file', 'f-open', 2), item('data_room_file', 'f-nda'), item('data_room_file', 'f-loose'),
      item('raise_evidence_item', 'e-summary'), item('raise_evidence_item', 'e-nda'), item('pitch_deck', '501', 2),
    ],
    audience_manifest: { audience: 'invited_nda', recipients: [21, 22] },
  },
};
/** Refs, versions and names the scoped investor's access withholds (the NDA folder, the loose file, NDA evidence). */
const WITHHELD_FROM_22 = ['f-nda', 'f-loose', 'e-nda', 'Harbor model.xlsx', 'Harbor loose.pdf', 'Harbor cohort retention'];
const PREP = {
  uid: 'prep-pub', deal_id: 2, origin: 'preparation', preparation_state: 'approved', publication_state: 'published',
  company_id: 70, project_id: P, lock_version: 3, updated_at: '2026-11-27 09:00:00',
  working_revision_id: 1022, submitted_revision_id: 1022, approved_revision_id: 1021, released_revision_id: 1021,
};

/** One recipient's view, read fresh from the stores, as an investor retrieval would. */
async function viewFor(db: DatabaseSync, userId: number) {
  const env = { DB: d1Over(db) } as any;
  const parsed = parseManifest(RELEASED.content);
  assert.ok(parsed.ok && parsed.manifest.audience);
  const resolved = await resolveManifestSources(env, P, parsed.manifest.items, NOW);
  const [facts] = await readRecipientFacts(env, P, [userId]);
  return investorManifestView(resolved, parsed.manifest.audience.audience, facts, NOW);
}

test('investor projection: a withheld item is never named, versioned or counted; delivered ones show kind, source, date and purpose', async () => {
  const db = fixture();
  try {
    const view = await viewFor(db, 22);
    assert.equal(view.withheld, 3, 'fixture: the scoped investor is refused three of six items');
    const out = project('investor', PREP, RELEASED, view)!;
    const content = out.content as Record<string, any>;
    assert.ok(!('evidence_refs' in content), 'the raw manifest never reaches an investor');
    assert.ok(!('audience_manifest' in content));
    assert.ok(!('internal_notes' in content));
    assert.equal(content.evidence.length, 3);
    for (const e of content.evidence) assert.deepEqual(Object.keys(e).sort(), ['as_of', 'category', 'kind', 'purpose']);
    assert.deepEqual(content.evidence.map((e: any) => e.kind), ['data_room_file', 'raise_evidence_item', 'pitch_deck']);
    const text = JSON.stringify(out);
    for (const leak of [...WITHHELD_FROM_22, 'f-open', 'e-summary', '"501"', 'withheld', '"version"', 'Harbor overview.pdf']) {
      assert.ok(!text.includes(leak), `investor projection leaks ${leak}`);
    }
  } finally { db.close(); }
});

test('investor projection: each investor sees what their own access delivers from the same release', async () => {
  const db = fixture();
  try {
    const full = project('investor', PREP, RELEASED, await viewFor(db, 21))!;
    const scoped = project('investor', PREP, RELEASED, await viewFor(db, 22))!;
    assert.equal((full.content as any).evidence.length, 6);
    assert.equal((scoped.content as any).evidence.length, 3);
    // The terms are the same release for both.
    assert.equal((full.content as any).title, (scoped.content as any).title);
  } finally { db.close(); }
});

test('investor projection: without a view there is no evidence; a view\'s extra keys are never copied', () => {
  const bare = project('investor', PREP, RELEASED)!.content as Record<string, unknown>;
  assert.deepEqual(Object.keys(bare).sort(), ['currency', 'instrument', 'summary', 'title']);
  assert.ok(!(PROJECTIONS.investor.content as readonly string[]).includes('evidence_refs'));
  const smuggled = { items: [{ kind: 'data_room_file', category: 'document', as_of: '2026-10-02', purpose: 'claim_support', ref: 'f-nda', version: 9, label: 'Harbor model.xlsx' }], withheld: 5 } as any;
  const out = project('investor', PREP, RELEASED, smuggled)!;
  assert.deepEqual((out.content as any).evidence, [{ kind: 'data_room_file', category: 'document', as_of: '2026-10-02', purpose: 'claim_support' }]);
  assert.ok(!JSON.stringify(out).includes('f-nda'));
});

test('authoring and review projections are unchanged and ignore an investor view', async () => {
  const db = fixture();
  try {
    const view = await viewFor(db, 21);
    const working = { id: 1022, content: { ...RELEASED.content, title: 'Harbor Ledger Seed r2', smuggled: 'x' } };
    const authoring = project('authoring', PREP, working, view)!;
    const expected = Object.fromEntries(REVISION_CONTENT_KEYS.filter((k) => k in working.content).map((k) => [k, (working.content as any)[k]]));
    assert.deepEqual(authoring.content, expected, 'every revision key, the raw manifest included, and nothing else');
    assert.deepEqual((authoring.content as any).evidence_refs, RELEASED.content.evidence_refs);
    assert.ok(!('evidence' in (authoring.content as any)));
    assert.deepEqual(authoring, project('authoring', PREP, working), 'a view changes nothing in the authoring projection');
    const review = project('review', PREP, working, view)!;
    assert.deepEqual((review.content as any).evidence_refs, RELEASED.content.evidence_refs);
    assert.ok(!('evidence' in (review.content as any)) && !('internal_notes' in (review.content as any)));
  } finally { db.close(); }
});

test('investor projection: a preparation that is not listed projects nothing, view or not', async () => {
  const db = fixture();
  try {
    const view = await viewFor(db, 21);
    for (const publication_state of ['withdrawn', 'archived', 'unreleased', 'mystery']) {
      assert.equal(project('investor', { ...PREP, publication_state }, RELEASED, view), null, publication_state);
    }
  } finally { db.close(); }
});
