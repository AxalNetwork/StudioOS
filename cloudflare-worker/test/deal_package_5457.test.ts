/**
 * D5457 (#5457, ADP-03) — the deal package manifest, its source adapters and the readiness preflight. Real
 * `node:sqlite` over the schema baseline plus the migrations these stores need (data-room tiers, versions, folder
 * scopes, source kinds and Trash; Raise evidence; the D5454 preparation tables). Every venture, investor, file,
 * figure and digest is invented.
 *
 * What it proves:
 *   - the manifest parser refuses forbidden, unknown, duplicated, noted or oversized selections whole;
 *   - the candidate digest moves with the manifest, a pinned version, the terms, the audience and the issuer, and not
 *     with ordering;
 *   - each source resolves against its own store inside the issuer's project only (two studios cannot see each
 *     other's files or names), in at most one statement per kind, and a failed kind is `unreadable` alone;
 *   - revoking, expiring, unpinning or re-versioning a source after a check moves the sources digest, makes the old
 *     preflight stale and withholds the item at retrieval; frozen content does not bypass it;
 *   - teaser, invited, NDA and closing readiness are separate answers, including an inactive or unreviewed template;
 *   - the picker pages past one page with one statement a page, and a failed read is never an empty page;
 *   - the orchestrated read is admin-only, bounded, deterministic for one revision and writes nothing.
 *
 * MUTATION CHECKS: see D5457.md "Mutation checks" (each was run against this file and turned it red).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_package_5457.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { d1Over } from './_d1_sqlite.mjs';
import {
  MANIFEST_ITEMS_MAX, RECIPIENTS_MAX, type Manifest, type ManifestItem, candidateDigest, parseManifest, sha256Hex,
} from '../src/services/dealPackageManifest.ts';
import {
  PICKER_PAGE_MAX, RESOLVE_QUERY_MAX, admitsAudience, investorManifestView, pickSources, readRecipientFacts,
  resolveManifestSources, retrievalDecision, sourcesDigest, type RecipientFacts, type ResolvedItem,
} from '../src/services/dealPackageSources.ts';
import {
  BLOCKER_MATRIX, READINESS_QUERY_MAX, UNINTEGRATED_DEPENDENCIES, evaluateReadiness, preflightFreshness, readPackageReadiness,
  type ReadinessInput,
} from '../src/services/dealPackageReadiness.ts';
import { PREPARATION_MUTATIONS_ENABLED } from '../src/services/dealPreparation.ts';

const MIG = 'cloudflare-worker/sql/migrations/';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NEEDED = ['463_', '506_', '594_', '596_', '597_', '628_', '_6073_data_room_trash', '_5454_deal_preparations'];
const FILES = readdirSync(resolve(process.cwd(), MIG));

const P = 10; // the issuer's project (company 70)
const OTHER = 11; // another studio's project (company 71)
const SIBLING = 12; // a second project of company 70

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  // Some of these files end in a statement this baseline cannot run (a backfill over a store it lacks); the tables
  // and columns this test needs come before it, and the asserts below fail loudly if one is missing.
  for (const key of NEEDED) {
    const f = FILES.find((n) => (key.startsWith('_') ? n.includes(key) : n.startsWith(key)));
    assert.ok(f, `migration ${key} exists`);
    try { db.exec(read(MIG + f)); } catch { /* checked below */ }
  }
  for (const [t, c] of [['data_room_files', 'removed_at'], ['data_room_files', 'access_tier'], ['data_room_files', 'source_kind'],
    ['data_room_grants', 'folders_scoped'], ['raise_evidence_items', 'private_reason'], ['deal_preparations', 'scope_code'], ['company_profiles', 'archived_at']]) {
    assert.ok((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).some((r) => r.name === c), `${t}.${c} present`);
  }
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active, founder_id) VALUES
      (1, 'admin@example.test', 'Synthetic admin', 'admin', 1, NULL),
      (2, 'partner@example.test', 'Synthetic partner', 'partner', 1, NULL),
      (5, 'founder@example.test', 'Synthetic founder', 'founder', 1, 55),
      (6, 'rival-founder@example.test', 'Synthetic rival founder', 'founder', 1, 66),
      (21, 'inv-full@example.test', 'Investor full', 'investor', 1, NULL),
      (22, 'inv-scoped@example.test', 'Investor scoped', 'investor', 1, NULL),
      (23, 'inv-gone@example.test', 'Investor inactive', 'investor', 0, NULL),
      (24, 'inv-rival@example.test', 'Investor rival', 'investor', 1, NULL),
      (25, 'inv-nogrant@example.test', 'Investor no grant', 'investor', 1, NULL);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Harbor Ledger Inc'), (71, 'co-71', 'Rival Studio Ltd');
    INSERT INTO projects (id, name, company_id, founder_id) VALUES (${P}, 'Harbor Ledger', 70, 55), (${OTHER}, 'Rival Venture', 71, 66), (${SIBLING}, 'Harbor Labs', 70, 55);
    INSERT INTO data_room_folders (id, uid, project_id, name, visibility) VALUES
      (300, 'fo-open', ${P}, 'Company', 'open'), (301, 'fo-nda', ${P}, 'Financials', 'nda'), (310, 'fo-rival', ${OTHER}, 'Rival', 'open');
    INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, visibility, access_tier, access_expires_at, source_kind, removed_at, updated_at) VALUES
      (401, 'f-open', ${P}, 300, 'Harbor overview.pdf', 'k1', 'open', 'invited', NULL, 'document', NULL, '2026-10-01 09:00:00'),
      (402, 'f-nda', ${P}, 301, 'Harbor model.xlsx', 'k2', 'open', 'invited', NULL, 'connector', NULL, '2026-10-02 09:00:00'),
      (403, 'f-committed', ${P}, 300, 'Harbor side letter.pdf', 'k3', 'open', 'committed', NULL, 'signed', NULL, '2026-10-03 09:00:00'),
      (404, 'f-nobody', ${P}, 300, 'Harbor internal.pdf', 'k4', 'open', 'nobody', NULL, 'document', NULL, '2026-10-04 09:00:00'),
      (405, 'f-expired', ${P}, 300, 'Harbor old offer.pdf', 'k5', 'open', 'invited', '2026-01-01', 'document', NULL, '2026-10-05 09:00:00'),
      (406, 'f-trash', ${P}, 300, 'Harbor removed.pdf', 'k6', 'open', 'invited', NULL, 'document', '2026-11-01 09:00:00', '2026-10-06 09:00:00'),
      (407, 'f-loose', ${P}, NULL, 'Harbor loose.pdf', 'k7', 'open', 'invited', NULL, 'document', NULL, '2026-10-07 09:00:00'),
      (410, 'f-rival', ${OTHER}, 310, 'Rival secret term sheet.pdf', 'k10', 'open', 'invited', NULL, 'document', NULL, '2026-10-08 09:00:00'),
      (411, 'f-sibling', ${SIBLING}, NULL, 'Harbor Labs plan.pdf', 'k11', 'open', 'invited', NULL, 'document', NULL, '2026-10-09 09:00:00');
    INSERT INTO data_room_file_versions (file_id, version, r2_key) VALUES (401, 1, 'k1-v1');
    INSERT INTO data_room_grants (id, uid, project_id, investor_user_id, granted_by_user_id, status, folders_scoped) VALUES
      (601, 'g-full', ${P}, 21, 5, 'active', 0), (602, 'g-scoped', ${P}, 22, 5, 'active', 1), (603, 'g-rival', ${OTHER}, 24, 6, 'active', 0);
    INSERT INTO data_room_grant_folders (grant_id, folder_id) VALUES (602, 300);
    INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (5, 21, 'active');
    INSERT INTO raise_prospects (uid, project_id, email, stage) VALUES ('rp-1', ${P}, 'inv-full@example.test', 'committed');
    INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES
      (500, ${P}, 1, '[]', 'Harbor deck v1', 0, '2026-09-01 10:00:00'), (501, ${P}, 2, '[]', 'Harbor deck v2', 1, '2026-10-01 10:00:00'),
      (510, ${OTHER}, 1, '[]', 'Rival deck', 1, '2026-10-01 10:00:00');
  `);
  const ev = db.prepare(`INSERT INTO raise_evidence_items (uid, project_id, area, kind, source_table, source_ref, source_label, strength,
    observed_on, summary, snapshot_hash, state, visibility, private_reason, version, mutation_uid)
    VALUES (?, ?, 'Data room', 'revenue', 'synthetic', ?, ?, 'measured', ?, ?, 'h', ?, ?, ?, ?, ?)`);
  ev.run('e-summary', P, 's1', 'connector', '2026-10-10', 'Harbor monthly revenue', 'pinned', 'summary', null, 1, 'm1');
  ev.run('e-nda', P, 's2', 'document', '2026-10-11', 'Harbor cohort retention', 'pinned', 'after_nda', null, 1, 'm2');
  ev.run('e-private', P, 's3', 'typed', null, 'Harbor private note', 'pinned', 'private', null, 1, 'm3');
  ev.run('e-bank', P, 's4', 'connector', '2026-10-12', 'Harbor cash balance', 'pinned', 'summary', 'bank', 1, 'm4');
  ev.run('e-unpinned', P, 's5', 'typed', null, 'Harbor retired claim', 'unpinned', 'summary', null, 2, 'm5');
  ev.run('e-rival', OTHER, 's6', 'connector', '2026-10-12', 'Rival revenue', 'pinned', 'summary', null, 1, 'm6');
  return db;
}

/** A D1 binding that counts statements and can fail any statement whose SQL names a given store. */
function envOver(db: DatabaseSync, opts: { failOn?: RegExp; branch?: string } = {}) {
  const inner = d1Over(db) as any;
  const counter = { n: 0, sql: [] as string[] };
  const DB = {
    ...inner,
    prepare(sql: string) {
      counter.n += 1;
      counter.sql.push(sql);
      if (opts.failOn && opts.failOn.test(sql)) {
        const boom = async () => { throw new Error('synthetic read failure'); };
        const api: any = { bind: () => api, all: boom, first: boom, run: boom };
        return api;
      }
      return inner.prepare(sql);
    },
  };
  return { env: { DB, ...(opts.branch ? { BRANCH_CODE: opts.branch } : {}) } as any, counter };
}

const item = (kind: ManifestItem['kind'], ref: string, version = 1, purpose: ManifestItem['purpose'] = 'claim_support'): ManifestItem => ({ kind, ref, version, purpose });
const NOW = Date.parse('2026-11-27T12:00:00Z');
const admin = { id: 1, role: 'admin' } as any;

// ---------------------------------------------------------------------------------------------------------------

test('parseManifest refuses a malformed or forbidden selection whole, never as empty', () => {
  const ok = (c: any) => parseManifest(c);
  assert.deepEqual(ok({}), { ok: true, manifest: { items: [], audience: null } });
  const cases: Array<[any, string]> = [
    [{ evidence_refs: 'x' }, 'manifest_not_list'],
    [{ evidence_refs: Array.from({ length: MANIFEST_ITEMS_MAX + 1 }, (_, i) => item('data_room_file', `f${i}`)) }, 'manifest_over_bound'],
    [{ evidence_refs: [{ kind: 'bank_balance', ref: 'x', version: 1, purpose: 'valuation' }] }, 'kind_forbidden'],
    [{ evidence_refs: [{ kind: 'investor_private_note', ref: 'x', version: 1, purpose: 'valuation' }] }, 'kind_forbidden'],
    [{ evidence_refs: [{ kind: 'spreadsheet', ref: 'x', version: 1, purpose: 'valuation' }] }, 'kind_unknown'],
    [{ evidence_refs: [{ ...item('data_room_file', 'f-open'), note: 'internal comment' }] }, 'item_unknown_field'],
    [{ evidence_refs: [item('data_room_file', 'bad ref!')] }, 'ref_invalid'],
    [{ evidence_refs: [{ ...item('data_room_file', 'f-open'), version: 0 }] }, 'version_invalid'],
    [{ evidence_refs: [{ ...item('data_room_file', 'f-open'), version: '1' }] }, 'version_invalid'],
    [{ evidence_refs: [{ ...item('data_room_file', 'f-open'), purpose: 'marketing' }] }, 'purpose_unknown'],
    [{ evidence_refs: [item('data_room_file', 'f-open'), item('data_room_file', 'f-open', 2)] }, 'item_duplicate'],
    [{ audience_manifest: { audience: 'public' } }, 'audience_unknown'],
    [{ audience_manifest: { audience: 'invited', recipients: [21], grant: 'all' } }, 'audience_unknown_field'],
    [{ audience_manifest: { audience: 'marketplace_teaser', recipients: [21] } }, 'recipients_on_teaser'],
    [{ audience_manifest: { audience: 'invited', recipients: Array.from({ length: RECIPIENTS_MAX + 1 }, (_, i) => i + 1) } }, 'recipients_over_bound'],
    [{ audience_manifest: { audience: 'invited', recipients: [21, 21] } }, 'recipient_duplicate'],
    [{ audience_manifest: { audience: 'invited', recipients: ['21'] } }, 'recipients_invalid'],
  ];
  for (const [content, code] of cases) {
    const r = ok(content);
    assert.equal(r.ok, false, code);
    assert.equal((r as any).code, code);
  }
  const good = ok({ evidence_refs: [item('pitch_deck', '501', 2, 'publication_attachment')], audience_manifest: { audience: 'invited', recipients: [22, 21] } });
  assert.deepEqual(good, { ok: true, manifest: { items: [item('pitch_deck', '501', 2, 'publication_attachment')], audience: { audience: 'invited', recipients: [22, 21] } } });
});

test('the candidate digest moves with every pinned input and not with ordering', async () => {
  const base: Manifest = { items: [item('data_room_file', 'f-open', 2), item('raise_evidence_item', 'e-summary')], audience: { audience: 'invited', recipients: [21, 22] } };
  const id = { preparation_uid: 'prep-a', revision_id: 900, content_sha256: 'a'.repeat(64), company_id: 70, project_id: P, manifest: base };
  const d0 = await candidateDigest(id);
  assert.match(d0, /^[0-9a-f]{64}$/);
  const reordered = { ...id, manifest: { items: [...base.items].reverse(), audience: { audience: 'invited' as const, recipients: [22, 21] } } };
  assert.equal(await candidateDigest(reordered), d0, 'order is not identity');
  const variants = [
    { ...id, manifest: { ...base, items: [...base.items, item('pitch_deck', '501', 2)] } },
    { ...id, manifest: { ...base, items: [item('data_room_file', 'f-open', 3), base.items[1]] } },
    { ...id, manifest: { ...base, items: [item('data_room_file', 'f-open', 2, 'counterevidence'), base.items[1]] } },
    { ...id, manifest: { ...base, audience: { audience: 'invited_nda' as const, recipients: [21, 22] } } },
    { ...id, manifest: { ...base, audience: { audience: 'invited' as const, recipients: [21, 22, 25] } } },
    { ...id, content_sha256: 'b'.repeat(64) },
    { ...id, project_id: SIBLING },
    { ...id, company_id: 71 },
    { ...id, revision_id: 901 },
  ];
  const seen = new Set([d0]);
  for (const v of variants) {
    const d = await candidateDigest(v);
    assert.ok(!seen.has(d), 'each variant is a different candidate');
    seen.add(d);
  }
  assert.notEqual(await candidateDigest(id, 'd5457.2'), d0, 'a new policy version is a new candidate');
});

test('sources resolve against their own store, inside the issuer project, one statement per kind', async () => {
  const db = fixture();
  const { env, counter } = envOver(db);
  const items = [
    item('data_room_file', 'f-open', 2), item('data_room_file', 'f-nda'), item('data_room_file', 'f-committed'),
    item('data_room_file', 'f-nobody'), item('data_room_file', 'f-expired'), item('data_room_file', 'f-trash'),
    item('data_room_file', 'f-open-missing'), item('data_room_file', 'f-rival'), item('data_room_file', 'f-sibling'),
    item('raise_evidence_item', 'e-summary'), item('raise_evidence_item', 'e-nda'), item('raise_evidence_item', 'e-private'),
    item('raise_evidence_item', 'e-bank'), item('raise_evidence_item', 'e-unpinned', 2), item('raise_evidence_item', 'e-rival'),
    item('pitch_deck', '500'), item('pitch_deck', '501', 2), item('pitch_deck', '501', 1), item('pitch_deck', '510'), item('pitch_deck', 'not-a-number'),
    item('venture_scorecard', 'sc-1'), item('contract_reference', 'ct-1'),
  ];
  // Duplicate refs are refused by the parser; this test resolves a raw list to see every status side by side.
  const got = await resolveManifestSources(env, P, items, NOW);
  assert.ok(counter.n <= RESOLVE_QUERY_MAX, `bounded: ${counter.n}`);
  assert.equal(counter.n, 3);
  const status = got.map((g) => `${g.kind}:${g.ref}@${g.version}=${g.status}`);
  assert.deepEqual(status, [
    'data_room_file:f-open@2=available', 'data_room_file:f-nda@1=available', 'data_room_file:f-committed@1=available',
    'data_room_file:f-nobody@1=restricted', 'data_room_file:f-expired@1=expired', 'data_room_file:f-trash@1=withdrawn',
    'data_room_file:f-open-missing@1=not_found', 'data_room_file:f-rival@1=out_of_scope', 'data_room_file:f-sibling@1=out_of_scope',
    'raise_evidence_item:e-summary@1=available', 'raise_evidence_item:e-nda@1=available', 'raise_evidence_item:e-private@1=restricted',
    'raise_evidence_item:e-bank@1=restricted', 'raise_evidence_item:e-unpinned@2=withdrawn', 'raise_evidence_item:e-rival@1=out_of_scope',
    'pitch_deck:500@1=available', 'pitch_deck:501@2=available', 'pitch_deck:501@1=version_changed', 'pitch_deck:510@1=out_of_scope',
    'pitch_deck:not-a-number@1=not_found', 'venture_scorecard:sc-1@1=unavailable', 'contract_reference:ct-1@1=unavailable',
  ]);
  const by = (k: string, r: string, v?: number) => got.find((g) => g.kind === k && g.ref === r && (v == null || g.version === v))!;
  assert.equal(by('data_room_file', 'f-open').current_version, 2, 'one prior version row means current is 2');
  assert.equal(by('data_room_file', 'f-nda').access?.visibility, 'nda', 'an NDA folder makes the file NDA');
  assert.equal(by('data_room_file', 'f-nda').category, 'connector');
  assert.equal(by('raise_evidence_item', 'e-summary').category, 'connector');
  assert.equal(by('raise_evidence_item', 'e-summary').as_of, '2026-10-10');
  assert.equal(by('pitch_deck', '500').superseded, true);
  assert.equal(by('pitch_deck', '501', 2).superseded, false);
  for (const g of got.filter((x) => x.status === 'out_of_scope' || x.status === 'not_found' || x.status === 'unavailable')) {
    assert.deepEqual([g.label, g.as_of, g.current_version, g.access, g.category], [null, null, null, null, null], `${g.ref} reveals nothing`);
  }
  assert.ok(!JSON.stringify(got).includes('Rival'), 'no other studio name or title anywhere');
  // A version mismatch on a data-room file.
  assert.equal((await resolveManifestSources(env, P, [item('data_room_file', 'f-open', 1)], NOW))[0].status, 'version_changed');
});

test('a failed read marks its own kind unreadable and leaves the others resolved', async () => {
  const db = fixture();
  const { env } = envOver(db, { failOn: /raise_evidence_items/ });
  const got = await resolveManifestSources(env, P, [item('raise_evidence_item', 'e-summary'), item('data_room_file', 'f-open', 2)], NOW);
  assert.deepEqual(got.map((g) => g.status), ['unreadable', 'available']);
});

test('revoking, expiring, unpinning or re-versioning after a check withholds the item and stales the preflight', async () => {
  const db = fixture();
  const { env } = envOver(db);
  const items = [item('data_room_file', 'f-open', 2), item('raise_evidence_item', 'e-summary'), item('data_room_file', 'f-loose')];
  const facts = await readRecipientFacts(env, P, [21]);
  const before = await resolveManifestSources(env, P, items, NOW);
  assert.deepEqual(before.map((b) => retrievalDecision(b, 'invited', facts[0], NOW)), ['deliver', 'deliver', 'deliver']);
  const digest0 = await sourcesDigest(before);
  const stored = { candidate_digest: 'c'.repeat(64), sources_digest: digest0, policy_version: 'd5457.1', fresh_until: new Date(NOW + 60_000).toISOString() };
  assert.equal(preflightFreshness(stored, { candidate_digest: 'c'.repeat(64), sources_digest: digest0, at: NOW }), 'current');
  assert.equal(preflightFreshness(stored, { candidate_digest: 'c'.repeat(64), sources_digest: digest0, at: NOW + 120_000 }), 'expired');
  assert.equal(preflightFreshness(stored, { candidate_digest: 'd'.repeat(64), sources_digest: digest0, at: NOW }), 'stale');

  // Each change on its own fresh store, so one revocation's effect is measured alone.
  const changes: Array<[string, number, string]> = [
    [`UPDATE data_room_files SET removed_at = '2026-11-26 10:00:00' WHERE uid = 'f-open'`, 0, 'withdrawn'],
    [`UPDATE data_room_files SET access_expires_at = '2026-11-20' WHERE uid = 'f-open'`, 0, 'expired'],
    [`UPDATE data_room_files SET access_tier = 'nobody' WHERE uid = 'f-open'`, 0, 'restricted'],
    [`INSERT INTO data_room_file_versions (file_id, version, r2_key) VALUES (401, 2, 'k1-v2')`, 0, 'version_changed'],
    [`UPDATE raise_evidence_items SET state = 'unpinned' WHERE uid = 'e-summary'`, 1, 'withdrawn'],
    [`UPDATE raise_evidence_items SET visibility = 'private' WHERE uid = 'e-summary'`, 1, 'restricted'],
    [`UPDATE raise_evidence_items SET private_reason = 'bank' WHERE uid = 'e-summary'`, 1, 'restricted'],
    [`UPDATE raise_evidence_items SET version = 2 WHERE uid = 'e-summary'`, 1, 'version_changed'],
    [`UPDATE data_room_files SET project_id = ${OTHER} WHERE uid = 'f-loose'`, 2, 'out_of_scope'],
  ];
  for (const [sql, idx, expected] of changes) {
    const changed = fixture();
    changed.exec(sql);
    const after = await resolveManifestSources(envOver(changed).env, P, items, NOW);
    assert.equal(after[idx].status, expected, sql);
    // Frozen content cannot bypass revocation: retrieval decides from this fresh resolution, not the earlier one.
    assert.equal(retrievalDecision(after[idx], 'invited', facts[0], NOW), 'withhold', `${expected} is withheld at retrieval`);
    const d = await sourcesDigest(after);
    assert.notEqual(d, digest0, `${expected} moves the sources digest`);
    assert.equal(preflightFreshness(stored, { candidate_digest: 'c'.repeat(64), sources_digest: d, at: NOW }), 'stale');
    const view = investorManifestView(after, 'invited', facts[0], NOW);
    assert.deepEqual([view.items.length, view.withheld], [2, 1]);
  }
});

test('release admission separates teaser, invited and NDA audiences; committed-only is closing material', async () => {
  const db = fixture();
  const { env } = envOver(db);
  const got = await resolveManifestSources(env, P, [
    item('data_room_file', 'f-open', 2), item('data_room_file', 'f-nda'), item('data_room_file', 'f-committed'),
    item('raise_evidence_item', 'e-summary'), item('raise_evidence_item', 'e-nda'), item('pitch_deck', '501', 2), item('data_room_file', 'f-trash'),
  ], NOW);
  const table = (a: any) => got.map((g) => admitsAudience(g, a));
  assert.deepEqual(table('marketplace_teaser'), ['exceeds_audience', 'exceeds_audience', 'exceeds_audience', 'admitted', 'exceeds_audience', 'exceeds_audience', 'not_available']);
  assert.deepEqual(table('invited'), ['admitted', 'exceeds_audience', 'exceeds_audience', 'admitted', 'exceeds_audience', 'admitted', 'not_available']);
  assert.deepEqual(table('invited_nda'), ['admitted', 'admitted', 'exceeds_audience', 'admitted', 'admitted', 'admitted', 'not_available']);
});

test('recipients: retrieval follows each investor\'s own grant, folder scope and NDA; views name nothing', async () => {
  const db = fixture();
  const { env, counter } = envOver(db);
  const facts = await readRecipientFacts(env, P, [21, 22, 23, 24, 25, 99]);
  assert.ok(counter.n <= 2, `recipient facts are bounded: ${counter.n}`);
  const by = (id: number) => facts.find((f) => f.user_id === id)!;
  assert.deepEqual([by(21).state, by(21).nda_signed, by(21).committed, by(21).grant?.folders], ['recorded', true, true, null]);
  assert.deepEqual([by(22).state, by(22).nda_signed, [...(by(22).grant?.folders ?? [])]], ['recorded', false, [300]]);
  assert.equal(by(23).state, 'inactive');
  assert.equal(by(24).grant, undefined, 'a grant on another studio\'s project opens nothing here');
  assert.equal(by(25).grant, undefined);
  assert.equal(by(99).state, 'not_found');

  const got = await resolveManifestSources(env, P, [
    item('data_room_file', 'f-open', 2), item('data_room_file', 'f-nda'), item('data_room_file', 'f-loose'),
    item('raise_evidence_item', 'e-summary'), item('raise_evidence_item', 'e-nda'), item('pitch_deck', '501', 2),
  ], NOW);
  const decide = (f: RecipientFacts) => got.map((g) => retrievalDecision(g, 'invited_nda', f, NOW));
  assert.deepEqual(decide(by(21)), ['deliver', 'deliver', 'deliver', 'deliver', 'deliver', 'deliver']);
  // Scoped to folder 300: no NDA folder, no loose file, no NDA evidence.
  assert.deepEqual(decide(by(22)), ['deliver', 'withhold', 'withhold', 'deliver', 'withhold', 'deliver']);
  for (const id of [23, 24, 25, 99]) assert.deepEqual(decide(by(id)), Array(6).fill('withhold'), `recipient ${id}`);

  const view = investorManifestView(got, 'invited_nda', by(22), NOW);
  assert.equal(view.items.length, 3);
  assert.equal(view.withheld, 3);
  const text = JSON.stringify(view);
  for (const leak of ['Harbor', 'f-open', 'f-nda', 'e-summary', '501', 'model.xlsx', 'k1']) assert.ok(!text.includes(leak), `view omits ${leak}`);

  const unreadable = await readRecipientFacts(envOver(db, { failOn: /FROM users u/ }).env, P, [21, 22]);
  assert.deepEqual(unreadable.map((u) => u.state), ['unreadable', 'unreadable']);
  // A scoped grant whose folders cannot be read opens no folder.
  const noScope = await readRecipientFacts(envOver(db, { failOn: /WITH RECURSIVE tree/ }).env, P, [22]);
  assert.deepEqual([...(noScope[0].grant?.folders ?? new Set([-1]))], []);
});

test('the picker pages past one page with one statement a page and never reads failure as empty', async () => {
  const db = fixture();
  const { env, counter } = envOver(db);
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const before = counter.n;
    const page = await pickSources(env, P, 'data_room_file', { limit: 2, cursor });
    assert.equal(counter.n - before, 1, 'one statement a page');
    assert.equal(page.state, 'recorded');
    if (page.state !== 'recorded') break;
    seen.push(...page.rows.map((r) => r.ref));
    cursor = page.next_cursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.ok(pages > 1, 'more than one page');
  // Trash and `nobody` files are not offered; another project's never are.
  assert.deepEqual(seen, ['f-loose', 'f-expired', 'f-committed', 'f-nda', 'f-open']);
  const q = await pickSources(env, P, 'data_room_file', { q: 'MODEL' });
  assert.deepEqual(q.rows?.map((r) => r.ref), ['f-nda']);
  const rivalQ = await pickSources(env, P, 'data_room_file', { q: 'rival' });
  assert.deepEqual(rivalQ.rows, [], 'search cannot reach another studio');
  const ev = await pickSources(env, P, 'raise_evidence_item', {});
  assert.deepEqual(ev.rows?.map((r) => r.ref), ['e-nda', 'e-summary']);
  const decks = await pickSources(env, P, 'pitch_deck', { limit: PICKER_PAGE_MAX + 50 });
  assert.deepEqual(decks.rows?.map((r) => [r.ref, r.version]), [['501', 2], ['500', 1]]);
  assert.equal((await pickSources(env, P, 'venture_scorecard', {})).state, 'unavailable');
  const broken = await pickSources(envOver(db, { failOn: /data_room_files/ }).env, P, 'data_room_file', {});
  assert.deepEqual([broken.state, broken.rows], ['unreadable', null]);
});

// ---------------------------------------------------------------------------------------------------------------
// The evaluator.
// ---------------------------------------------------------------------------------------------------------------

function availableFile(ref: string, visibility: 'open' | 'nda' = 'open'): ResolvedItem {
  return { kind: 'data_room_file', ref, version: 1, purpose: 'claim_support', status: 'available', category: 'document', as_of: '2026-10-01',
    current_version: 1, label: 'x', access: { visibility, tier: 'invited', folder_id: null, expires_at: null }, superseded: false };
}
const recorded = (ok = true, digest?: string) => ({ state: 'recorded' as const, ok, version: 'v1', ...(digest ? { candidate_digest: digest } : {}) });
const fullRecipient: RecipientFacts = { user_id: 21, state: 'recorded', grant: { id: 1, folders: null }, nda_signed: true, committed: false };
const CONTENT = { title: 'Harbor', summary: 'S', description: 'D', sector: 'fintech', instrument: 'SAFE', currency: 'USD', target_raise: 1, minimum_check: 1 };

function input(over: Partial<ReadinessInput> & { audience?: any; content?: any } = {}): ReadinessInput {
  const audience = over.audience === undefined ? { audience: 'invited', recipients: [21] } : over.audience;
  const sources = over.sources ?? [availableFile('f1')];
  return {
    preparation: { uid: 'prep-a', company_id: 70, project_id: P },
    revision: { id: 900, content: over.content ?? CONTENT, content_sha256: 'a'.repeat(64), company_id: 70, project_id: P },
    issuer: { ok: true, company_id: 70, project_id: P },
    current_company: { company_id: 70 },
    manifest: { ok: true, manifest: { items: sources.map((s) => item(s.kind, s.ref, s.version)), audience } },
    sources,
    recipients: [fullRecipient],
    dependencies: {
      terms: recorded(), review: recorded(true, 'c'.repeat(64)), distribution_policy: recorded(), representative_authority: recorded(),
      legal: { state: 'recorded', template_active: true, template_reviewed: true, version: 'v1' },
    },
    candidate_digest: 'c'.repeat(64), sources_digest: 's'.repeat(64), now: NOW,
    ...over,
  } as ReadinessInput;
}
const stateOf = (r: ReturnType<typeof evaluateReadiness>, id: string) => r.checks.find((c) => c.id === id)!;

test('a complete invited candidate is release-ready; closing readiness is its own answer', () => {
  const r = evaluateReadiness(input());
  assert.deepEqual(Object.values(r.dimensions).map((d) => d.state), ['ready', 'ready', 'ready', 'ready']);
  assert.equal(r.release_ready, true);
  assert.equal(r.closing_ready, true);
  assert.equal(r.instrument_family, 'safe');

  const inactive = evaluateReadiness(input({ dependencies: { ...input().dependencies, legal: { state: 'recorded', template_active: false, template_reviewed: true, version: 'v1' } } }));
  assert.equal(stateOf(inactive, 'legal_prerequisites').code, 'template_inactive');
  assert.deepEqual([inactive.release_ready, inactive.closing_ready, inactive.dimensions.closing_readiness.state], [true, false, 'blocked']);
  const unreviewed = evaluateReadiness(input({ dependencies: { ...input().dependencies, legal: { state: 'recorded', template_active: true, template_reviewed: false, version: 'v1' } } }));
  assert.equal(stateOf(unreviewed, 'legal_prerequisites').code, 'template_unreviewed');
  assert.deepEqual([unreviewed.release_ready, unreviewed.closing_ready], [true, false]);
  const legalMissing = evaluateReadiness(input({ dependencies: { ...input().dependencies, legal: { state: 'unavailable' } } }));
  assert.deepEqual([stateOf(legalMissing, 'legal_prerequisites').state, legalMissing.release_ready, legalMissing.closing_ready], ['unavailable', true, false]);
  const legalUnread = evaluateReadiness(input({ dependencies: { ...input().dependencies, legal: { state: 'unreadable' } } }));
  assert.equal(legalUnread.dimensions.closing_readiness.state, 'unreadable');
  assert.equal(legalUnread.closing_ready, false);

  const spv = evaluateReadiness(input({ content: { ...CONTENT, instrument: 'SPV' } }));
  assert.deepEqual([spv.release_ready, stateOf(spv, 'instrument_closing_rules').state, spv.closing_ready], [true, 'unavailable', false]);
});

test('a teaser needs an approved distribution policy and no closing record; it names no recipient', () => {
  const evidence: ResolvedItem = { ...availableFile('e1'), kind: 'raise_evidence_item' };
  const base = input({ audience: { audience: 'marketplace_teaser', recipients: [] }, sources: [evidence], recipients: [],
    content: { title: 'T', summary: 'S', sector: 'fintech', instrument: 'safe', currency: 'EUR' } });
  const noPolicy = evaluateReadiness({ ...base, dependencies: { ...UNINTEGRATED_DEPENDENCIES, review: recorded(true, 'c'.repeat(64)), terms: recorded() } });
  assert.equal(stateOf(noPolicy, 'distribution_policy').state, 'unavailable');
  assert.equal(noPolicy.release_ready, false);
  assert.equal(stateOf(noPolicy, 'recipient_access').state, 'not_applicable');
  // Legal and authority are unavailable, yet they block closing only.
  assert.deepEqual([noPolicy.dimensions.content_completeness.state, noPolicy.dimensions.closing_readiness.state], ['ready', 'blocked']);
  const withPolicy = evaluateReadiness({ ...base, dependencies: { ...UNINTEGRATED_DEPENDENCIES, review: recorded(true, 'c'.repeat(64)), terms: recorded(), distribution_policy: recorded() } });
  assert.deepEqual([withPolicy.release_ready, withPolicy.closing_ready], [true, false]);
  // A document never rides on a teaser.
  const withFile = evaluateReadiness({ ...base, sources: [availableFile('f1')], dependencies: input().dependencies });
  assert.equal(stateOf(withFile, 'audience_projection').code, 'source_exceeds_audience');
  assert.equal(withFile.release_ready, false);
  assert.equal(BLOCKER_MATRIX.invited.distribution_policy, 'not_applicable');
  assert.equal(BLOCKER_MATRIX.marketplace_teaser.recipient_access, 'not_applicable');
});

test('failed reads, unknown cases and missing dependencies never pass', () => {
  const unreadable = evaluateReadiness(input({ sources: [{ ...availableFile('f1'), status: 'unreadable', access: null }] }));
  assert.deepEqual([stateOf(unreadable, 'sources_current').state, unreadable.dimensions.release_eligibility.state, unreadable.release_ready], ['unreadable', 'unreadable', false]);
  const notIntegrated = evaluateReadiness(input({ sources: [{ ...availableFile('sc'), kind: 'venture_scorecard', status: 'unavailable', access: null }] }));
  assert.deepEqual([stateOf(notIntegrated, 'sources_current').state, notIntegrated.release_ready], ['unavailable', false]);
  const unknown = evaluateReadiness(input({ content: { ...CONTENT, instrument: 'revenue share' } }));
  assert.deepEqual([stateOf(unknown, 'instrument_supported').state, unknown.dimensions.content_completeness.state, unknown.release_ready], ['review_required', 'review_required', false]);
  assert.equal(stateOf(unknown, 'instrument_closing_rules').state, 'review_required');
  const otherApproval = evaluateReadiness(input({ dependencies: { ...input().dependencies, review: recorded(true, 'e'.repeat(64)) } }));
  assert.deepEqual([stateOf(otherApproval, 'candidate_review').code, otherApproval.release_ready], ['approval_for_other_candidate', false]);
  const issuerUnread = evaluateReadiness(input({ issuer: 'unreadable' }));
  assert.deepEqual([stateOf(issuerUnread, 'issuer_pair').state, issuerUnread.release_ready], ['unreadable', false]);
  const moved = evaluateReadiness(input({ current_company: { company_id: 71 } }));
  assert.deepEqual([stateOf(moved, 'issuer_pair').code, moved.release_ready], ['issuer_moved', false]);
  const noCompany = evaluateReadiness(input({ issuer: { ok: false, code: 'project_has_no_company' } }));
  assert.equal(stateOf(noCompany, 'issuer_pair').code, 'project_has_no_company');
  const gone = evaluateReadiness(input({ recipients: [{ ...fullRecipient, state: 'inactive' }] }));
  assert.deepEqual([stateOf(gone, 'recipient_access').code, gone.dimensions.investor_access.state], ['recipient_ineligible', 'blocked']);
  const recUnread = evaluateReadiness(input({ recipients: [{ ...fullRecipient, state: 'unreadable' }] }));
  assert.equal(recUnread.dimensions.investor_access.state, 'unreadable');
  const partial = evaluateReadiness(input({ sources: [availableFile('f1'), availableFile('f2', 'nda')], recipients: [{ ...fullRecipient, nda_signed: false }], audience: { audience: 'invited_nda', recipients: [21] } }));
  assert.deepEqual([stateOf(partial, 'recipient_access').level, stateOf(partial, 'recipient_access').counts, partial.release_ready], ['advisory', { full: 0, partial: 1, none: 0, ineligible: 0, unreadable: 0 }, true]);
  const missing = evaluateReadiness(input({ content: { ...CONTENT, summary: ' ', target_raise: null } }));
  assert.deepEqual([stateOf(missing, 'brief_sections').explanation, missing.release_ready], ['Missing: summary, target_raise.', false]);
  const bad = evaluateReadiness(input({ manifest: { ok: false, code: 'kind_forbidden' }, sources: [] }));
  assert.deepEqual([stateOf(bad, 'manifest_valid').code, stateOf(bad, 'sources_current').state, bad.release_ready], ['kind_forbidden', 'fail', false]);
  const noAudience = evaluateReadiness(input({ audience: null }));
  assert.deepEqual([stateOf(noAudience, 'audience_selected').code, noAudience.release_ready], ['audience_missing', false]);
  const noRecipients = evaluateReadiness(input({ audience: { audience: 'invited', recipients: [] }, recipients: [] }));
  assert.equal(stateOf(noRecipients, 'audience_selected').code, 'recipients_missing');
  const today = evaluateReadiness(input({ dependencies: UNINTEGRATED_DEPENDENCIES }));
  assert.equal(today.release_ready, false, 'without ADP-02/ADP-04 nothing is release-ready');
  assert.equal(stateOf(today, 'candidate_review').state, 'unavailable');
  assert.equal(stateOf(today, 'typed_terms').state, 'unavailable');
});

// ---------------------------------------------------------------------------------------------------------------
// The orchestrated read over a real preparation.
// ---------------------------------------------------------------------------------------------------------------

async function seedPreparation(db: DatabaseSync, content: Record<string, unknown>, opts: { scope?: string; uid?: string } = {}) {
  const json = JSON.stringify(content);
  const sha = await sha256Hex(json);
  const uid = opts.uid ?? 'prep-a';
  db.prepare(`INSERT INTO deal_preparations (uid, scope_code, company_id, project_id, origin, created_by_user_id) VALUES (?, ?, 70, ${P}, 'preparation', 1)`).run(uid, opts.scope ?? 'hq');
  const prepId = Number((db.prepare('SELECT id FROM deal_preparations WHERE uid = ?').get(uid) as any).id);
  db.prepare(`INSERT INTO deal_preparation_revisions (uid, preparation_id, revision_no, company_id, project_id, content_json, content_sha256, created_by_user_id)
    VALUES (?, ?, 1, 70, ${P}, ?, ?, 1)`).run(`${uid}-r1`, prepId, json, sha);
  const revId = Number((db.prepare('SELECT id FROM deal_preparation_revisions WHERE uid = ?').get(`${uid}-r1`) as any).id);
  db.prepare('UPDATE deal_preparations SET working_revision_id = ? WHERE id = ?').run(revId, prepId);
  return { prepId, revId };
}

const REVISION = {
  ...CONTENT,
  internal_notes: 'Synthetic internal comment',
  evidence_refs: [item('data_room_file', 'f-open', 2), item('raise_evidence_item', 'e-summary'), item('pitch_deck', '501', 2), item('data_room_file', 'f-rival')],
  audience_manifest: { audience: 'invited', recipients: [21, 22] },
};

test('readPackageReadiness: admin-only, bounded, deterministic for one revision, and writes nothing', async () => {
  const db = fixture();
  await seedPreparation(db, REVISION);
  const changes = () => Number((db.prepare('SELECT total_changes() AS n').get() as any).n);

  for (const u of [null, { id: 2, role: 'partner' }, { id: 21, role: 'investor' }, { id: 1, role: 'admin', support_session: true }]) {
    const { env, counter } = envOver(db);
    assert.deepEqual(await readPackageReadiness(env, u as any, 'prep-a', { writesFrozen: false }), { ok: false, code: 'not_found' });
    assert.equal(counter.n, 0, 'refused before any read');
  }
  assert.equal((await readPackageReadiness(envOver(db).env, admin, 'prep-a', { writesFrozen: false })).ok, true);
  assert.deepEqual(await readPackageReadiness(envOver(db, { branch: 'eu' }).env, admin, 'prep-a', { writesFrozen: false }), { ok: false, code: 'not_found' }, 'another deployment\'s row is not found');
  assert.deepEqual(await readPackageReadiness(envOver(db).env, admin, 'nope', { writesFrozen: false }), { ok: false, code: 'not_found' });
  assert.deepEqual(await readPackageReadiness(envOver(db).env, admin, 'prep-a', { writesFrozen: false, pointer: 'submitted' }), { ok: false, code: 'no_revision' });

  const writesBefore = changes();
  const { env, counter } = envOver(db);
  const a = await readPackageReadiness(env, admin, 'prep-a', { writesFrozen: true, now: NOW });
  assert.ok(counter.n <= READINESS_QUERY_MAX, `bounded: ${counter.n} <= ${READINESS_QUERY_MAX}`);
  assert.ok(counter.sql.every((s) => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(s)), 'read-only statements');
  assert.equal(changes(), writesBefore, 'nothing written');
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const b = await readPackageReadiness(envOver(db).env, admin, 'prep-a', { writesFrozen: false, now: NOW });
  assert.deepEqual(b, a, 'the same revision gives the same checks and digests wherever it is read');

  const r = a.result;
  assert.equal(r.release_ready, false);
  assert.equal(stateOf(r, 'sources_current').code, 'sources_not_current', 'the other studio\'s file is out of scope');
  assert.deepEqual(stateOf(r, 'sources_current').counts, { available: 3, out_of_scope: 1 });
  assert.equal(stateOf(r, 'typed_terms').state, 'unavailable');
  assert.equal(stateOf(r, 'candidate_review').state, 'unavailable');
  assert.equal(stateOf(r, 'issuer_pair').state, 'pass');
  // Neither recipient can receive the out-of-scope file, so both are partial; it is withheld, never granted.
  assert.deepEqual(stateOf(r, 'recipient_access').counts, { full: 0, partial: 2, none: 0, ineligible: 0, unreadable: 0 });
  const text = JSON.stringify(a);
  assert.ok(!text.includes('Rival'), 'no other studio name, title or file name');
  assert.ok(!text.includes('Synthetic internal comment'), 'internal notes are never echoed');
  assert.equal(a.sources.find((s) => s.ref === 'f-rival')?.label, null);

  // Moving the project to another company fails the issuer check; nothing is rewritten.
  db.exec(`UPDATE projects SET company_id = 71 WHERE id = ${P}`);
  const moved = await readPackageReadiness(envOver(db).env, admin, 'prep-a', { writesFrozen: false, now: NOW });
  assert.ok(moved.ok && stateOf(moved.result, 'issuer_pair').code === 'company_mismatch');
  db.exec(`UPDATE projects SET company_id = 70 WHERE id = ${P}`);

  // A failed preparation read is unreadable, not "not found".
  assert.deepEqual(await readPackageReadiness(envOver(db, { failOn: /FROM deal_preparations WHERE uid/ }).env, admin, 'prep-a', { writesFrozen: false }), { ok: false, code: 'unreadable' });
  // The issuer read failing makes the issuer check unreadable.
  const issuerFail = await readPackageReadiness(envOver(db, { failOn: /FROM projects WHERE id/ }).env, admin, 'prep-a', { writesFrozen: false, now: NOW });
  assert.ok(issuerFail.ok && stateOf(issuerFail.result, 'issuer_pair').state === 'unreadable');
});

test('editing the manifest, a version, the terms or the audience changes the candidate digest of the read', async () => {
  const digests = new Set<string>();
  const variants = [
    REVISION,
    { ...REVISION, evidence_refs: REVISION.evidence_refs.slice(0, 3) },
    { ...REVISION, evidence_refs: [item('data_room_file', 'f-open', 1), ...REVISION.evidence_refs.slice(1)] },
    { ...REVISION, valuation_cap: 9000000 },
    { ...REVISION, audience_manifest: { audience: 'invited_nda', recipients: [21, 22] } },
  ];
  for (const [i, content] of variants.entries()) {
    const db = fixture();
    await seedPreparation(db, content, { uid: `prep-${i}` });
    const r = await readPackageReadiness(envOver(db).env, admin, `prep-${i}`, { writesFrozen: false, now: NOW });
    assert.ok(r.ok);
    if (r.ok) digests.add(r.result.candidate_digest);
  }
  assert.equal(digests.size, variants.length);
});

test('the package adds no mutation: preparation writes stay disabled', () => {
  assert.deepEqual(Object.values(PREPARATION_MUTATIONS_ENABLED), [false, false, false, false, false, false]);
});
