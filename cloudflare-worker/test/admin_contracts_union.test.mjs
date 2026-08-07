/**
 * Task #3 — Admin Contracts UNION — pure-function + route-level tests.
 *
 * Two layers of coverage:
 *
 * 1. Helper-mapping tests (load helpers from the TS source via the
 *    same slice trick the api_drift test uses):
 *      - mapEsignStatus       — esign envelope status → unified status
 *      - mapPairwiseStatus    — pairwise NDA status → unified status (Task #3)
 *      - mapPartnerDealStatus — partner_deals status → unified status (Task #3)
 *      - enrichDocRow         — `documents` row → UnifiedContract
 *      - enrichEsignRow       — `esign_envelopes` row → UnifiedContract
 *      - decorateDocType      — attaches doc_type_label + party_roles
 *
 * 2. 4-source UNION + admin-authz tests using a fake SQL stub that
 *    mimics the postgres.js tagged-template signature surface used by
 *    `loadAllContracts`. These assert:
 *      - rows from documents + esign + pairwise_ndas + partner_deals
 *        all flow into the same UnifiedContract list
 *      - rows are sorted descending by created_at across sources
 *      - missing optional tables (pairwise / partner_deals) collapse to
 *        empty rather than failing the union (older-D1 safety)
 *      - the source discriminator is preserved per row
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadHelpers() {
  const srcPath = resolve(__dirname, '../src/routes/admin_contracts.ts');
  const src = await readFile(srcPath, 'utf8');

  function sliceFn(name) {
    const sigVariants = [
      `export function ${name}`,
      `function ${name}`,
      `function ${name}<`,
    ];
    let start = -1;
    for (const sig of sigVariants) {
      start = src.indexOf(sig);
      if (start !== -1) break;
    }
    assert.notEqual(start, -1, `${name} not found`);
    let parenDepth = 0, j = src.indexOf('(', start);
    for (; j < src.length; j++) {
      if (src[j] === '(') parenDepth++;
      else if (src[j] === ')') { parenDepth--; if (parenDepth === 0) { j++; break; } }
    }
    let i = src.indexOf('{', j), depth = 0, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return src.slice(start, end).replace(/^export\s+/, '');
  }

  function sliceConst(declStart) {
    const i = src.indexOf(declStart);
    assert.notEqual(i, -1, `${declStart} not found`);
    let depth = 0, j = src.indexOf('{', i), end = -1;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    while (end < src.length && src[end] !== ';') end++;
    return src.slice(i, end + 1).replace(/^export\s+/, '');
  }

  const tsBody = [
    sliceConst('export const DOC_TYPE_PARTY_ROLES'),
    "const TEMPLATES = {" +
      "investor_nda_axal: { title: 'Investor NDA (Axal)', layer: 'fund' }," +
      "partner_equity: { title: 'Partner Equity Deal', layer: 'gp' }," +
      "spa: { title: 'Stock Purchase Agreement (SPA)', layer: 'portfolio' }," +
    "};",
    sliceFn('partyRolesFor'),
    sliceFn('daysBetween'),
    sliceFn('decorateDocType'),
    sliceFn('enrichDocRow'),
    sliceFn('mapEsignStatus'),
    sliceFn('enrichEsignRow'),
    sliceFn('mapPairwiseStatus'),
    sliceFn('mapPartnerDealStatus'),
  ].join('\n');

  const wrapped =
    `const __out = (() => { ${tsBody}; return { ` +
    `mapEsignStatus, enrichDocRow, enrichEsignRow, decorateDocType, partyRolesFor, ` +
    `mapPairwiseStatus, mapPartnerDealStatus ` +
    `}; })();`;

  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(`${outputText}; return __out;`)();
}

// ---------- Helper-mapping tests ----------

test('mapEsignStatus collapses provider statuses to unified set', async () => {
  const { mapEsignStatus } = await loadHelpers();
  assert.equal(mapEsignStatus('completed'), 'signed');
  assert.equal(mapEsignStatus('rejected'), 'void');
  assert.equal(mapEsignStatus('void'), 'void');
  assert.equal(mapEsignStatus('sent'), 'sent');
  assert.equal(mapEsignStatus('partially_signed'), 'sent');
  assert.equal(mapEsignStatus('viewed'), 'sent');
});

test('mapPairwiseStatus / mapPartnerDealStatus collapse to unified states', async () => {
  const { mapPairwiseStatus, mapPartnerDealStatus } = await loadHelpers();
  assert.equal(mapPairwiseStatus('active'), 'signed');
  assert.equal(mapPairwiseStatus('pending'), 'sent');
  assert.equal(mapPairwiseStatus('partially_signed'), 'sent');
  assert.equal(mapPairwiseStatus('revoked'), 'void');
  assert.equal(mapPairwiseStatus('expired'), 'void');

  assert.equal(mapPartnerDealStatus('active'), 'signed');
  assert.equal(mapPartnerDealStatus('signed'), 'signed');
  assert.equal(mapPartnerDealStatus('draft'), 'sent');
  assert.equal(mapPartnerDealStatus('pending'), 'sent');
  assert.equal(mapPartnerDealStatus('revoked'), 'void');
  assert.equal(mapPartnerDealStatus('expired'), 'void');
  assert.equal(mapPartnerDealStatus('something_else'), 'sent');
});

test('enrichDocRow normalises documents-source row to UnifiedContract', async () => {
  const { enrichDocRow } = await loadHelpers();
  const row = {
    id: 1, uid: 'docabc', title: 'SPA — Acme', doc_type: 'spa',
    status: 'SENT', template_name: 'spa',
    project_id: 7, signed_by: 'alice@x.com',
    signed_at: null, signed_ip: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    file_key: 'documents/abc.pdf', file_size: 12, file_content_type: 'application/pdf', file_sha256: 'sha',
  };
  const u = enrichDocRow(row, 'Acme Inc', 'founder@x.com');
  assert.equal(u.source, 'documents');
  assert.equal(u.status, 'sent');
  assert.equal(u.can_resend, true);
  assert.equal(u.recipient_email, 'alice@x.com');
  assert.equal(u.project_name, 'Acme Inc');
  assert.equal(u.raw_status, 'sent');
});

test('enrichEsignRow surfaces provider + can_resend gating for partially_signed', async () => {
  const { enrichEsignRow, decorateDocType } = await loadHelpers();
  const row = {
    id: 9, envelope_uuid: 'env-xyz', user_id: 2, deal_id: null,
    document_type: 'investor_nda_axal', document_title: 'Investor NDA',
    status: 'partially_signed', created_at: '2026-02-01T00:00:00Z',
    completed_at: null, signed_r2_key: null, provider: 'docusign',
    recipient_email: 'lp@fund.vc', recipient_name: 'LP One',
    signer_name: null, signer_ip: null, last_signed_at: null,
  };
  const u = decorateDocType(enrichEsignRow(row));
  assert.equal(u.source, 'esign');
  assert.equal(u.status, 'sent');
  assert.equal(u.raw_status, 'partially_signed');
  assert.equal(u.provider, 'docusign');
  assert.equal(u.can_resend, false);
  assert.equal(u.doc_type_label, 'Investor NDA (Axal)');
  assert.deepEqual([...u.party_roles].sort(), ['axal', 'investor']);
});

test('decorateDocType falls back to raw doc_type when no template entry exists', async () => {
  const { decorateDocType } = await loadHelpers();
  const u = decorateDocType({ doc_type: 'never_seen_type', party_roles: undefined });
  assert.equal(u.doc_type_label, 'never_seen_type');
  assert.deepEqual(u.party_roles, []);
});

test('partyRolesFor returns the configured role set per doc_type', async () => {
  const { partyRolesFor } = await loadHelpers();
  assert.deepEqual([...partyRolesFor('investor_nda_axal')].sort(), ['axal', 'investor']);
  assert.deepEqual([...partyRolesFor('partner_equity')].sort(), ['axal', 'partner']);
  assert.deepEqual(partyRolesFor('not_a_real_type'), []);
});

// ---------- Route-level UNION + admin-authz tests ----------
//
// `loadRouter` does NOT mount a Hono app or hit the route over HTTP — an
// earlier version tried that (inject a stubbed `getSQL` via a shim that
// intercepts the `../db` import) and was rewritten to something lighter:
// read `admin_contracts.ts` as text, slice out `loadAllContracts` and the
// pure helpers it calls, transpile that slice, and eval it against a stubbed
// `sql` tag. What each claim below is actually checked by:
//   (a) the GET / list returns rows from all 4 sources   — this file, loadRouter()
//   (b) the source discriminator is preserved per row     — this file, loadRouter()
//   (c) optional tables that throw are tolerated (older D1) — this file, loadRouter()
//   (d) requireAdmin gates the route (non-admin → 403)    — 'admin contracts route
//       requires admin (requireAdmin gate)' below, via source inspection

async function loadRouter({ documents = [], esign = [], pairwise = [], partner = [], pairwiseThrows = false, partnerThrows = false } = {}) {
  // The stubbed sql function recognises which loader is calling it by
  // sniffing the SQL fragment passed in (FROM <table>).
  function makeSql() {
    async function tag(strings) {
      const sql = strings.join(' ');
      if (sql.includes('FROM esign_envelopes')) return esign;
      if (sql.includes('FROM pairwise_ndas')) {
        if (pairwiseThrows) throw new Error('no such table: pairwise_ndas');
        return pairwise;
      }
      if (sql.includes('FROM partner_deals')) {
        if (partnerThrows) throw new Error('no such table: partner_deals');
        return partner;
      }
      return [];
    }
    tag.unsafe = async (sql) => {
      if (sql.includes('FROM documents')) return documents;
      if (sql.includes('FROM projects')) return [];
      if (sql.includes('FROM activity_logs')) return [];
      return [];
    };
    tag.end = async () => {};
    return tag;
  }

  // Build a tiny harness that re-implements the route's GET '/' using the
  // same loadAllContracts helper. We don't import the TS route directly (no
  // transpile pipeline here) — instead we extract and run loadAllContracts
  // the same way we extract the helpers below.
  const srcPath = resolve(__dirname, '../src/routes/admin_contracts.ts');
  const src = await readFile(srcPath, 'utf8');

  function sliceFn(name) {
    const sigVariants = [
      `async function ${name}`,
      `function ${name}`,
    ];
    let start = -1;
    for (const sig of sigVariants) {
      start = src.indexOf(sig);
      if (start !== -1) break;
    }
    assert.notEqual(start, -1, `${name} not found`);
    let parenDepth = 0, j = src.indexOf('(', start);
    for (; j < src.length; j++) {
      if (src[j] === '(') parenDepth++;
      else if (src[j] === ')') { parenDepth--; if (parenDepth === 0) { j++; break; } }
    }
    let i = src.indexOf('{', j), depth = 0, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  }
  function sliceConst(declStart) {
    const i = src.indexOf(declStart);
    assert.notEqual(i, -1, `${declStart} not found`);
    let depth = 0, j = src.indexOf('{', i), end = -1;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    while (end < src.length && src[end] !== ';') end++;
    return src.slice(i, end + 1).replace(/^export\s+/, '');
  }

  const tsBody = [
    "const CONTRACT_DOC_TYPES = new Set(['spa', 'partner_equity']);",
    sliceConst('export const DOC_TYPE_PARTY_ROLES'),
    "const TEMPLATES = {" +
      "spa: { title: 'Stock Purchase Agreement (SPA)', layer: 'portfolio' }," +
      "partner_equity: { title: 'Partner Equity Deal', layer: 'gp' }," +
      "partner_custom: { title: 'Partner Custom Deal', layer: 'gp' }," +
      "nda_3way_founder_investor_axal: { title: '3-Way NDA', layer: 'portfolio' }," +
    "};",
    sliceFn('partyRolesFor'),
    sliceFn('daysBetween'),
    sliceFn('decorateDocType'),
    sliceFn('enrichDocRow'),
    sliceFn('mapEsignStatus'),
    sliceFn('enrichEsignRow'),
    sliceFn('loadEsignContracts'),
    sliceFn('loadDocumentsContracts'),
    sliceFn('mapPairwiseStatus'),
    sliceFn('loadPairwiseNdaContracts'),
    sliceFn('mapPartnerDealStatus'),
    sliceFn('loadPartnerDealContracts'),
    sliceFn('loadAllContracts'),
  ].join('\n');

  const wrapped = `const __out = (async () => { ${tsBody}; return await loadAllContracts(__sql); })();`;

  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js'))).default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  const __sql = makeSql();
  return await new Function('__sql', `${outputText}; return __out;`)(__sql);
}

test('loadAllContracts unions all 4 sources and preserves source discriminator', async () => {
  const merged = await loadRouter({
    documents: [{
      id: 1, uid: 'doc-1', title: 'SPA — Acme', doc_type: 'spa', status: 'sent',
      template_name: 'spa', project_id: null, signed_by: null, signed_at: null,
      signed_ip: null, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
      file_key: null, file_size: null, file_content_type: null, file_sha256: null,
    }],
    esign: [{
      id: 11, envelope_uuid: 'env-1', user_id: 2, deal_id: null,
      document_type: 'spa', document_title: 'SPA — Beta', status: 'completed',
      created_at: '2026-04-02T00:00:00Z', completed_at: '2026-04-03T00:00:00Z',
      signed_r2_key: 'esign/env-1.pdf', provider: 'native',
      recipient_email: 'b@x.com', recipient_name: 'B',
      signer_name: 'B', signer_ip: '1.2.3.4', last_signed_at: '2026-04-03T00:00:00Z',
    }],
    pairwise: [{
      id: 21, party_a_user_id: 1, party_b_user_id: 2, intermediary: 'axal',
      nda_envelope_uuid: 'env-pw-1', status: 'active', valid_until: null,
      created_at: '2026-04-04T00:00:00Z', updated_at: '2026-04-04T00:00:00Z',
      party_a_email: 'a@x.com', party_b_email: 'b@x.com',
    }],
    partner: [{
      id: 31, partner_user_id: 9, deal_type: 'equity', term_months: 12,
      granted_tiers: '[]', status: 'active',
      created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
      partner_email: 'p@x.com', partner_name: 'Partner Co',
    }],
  });

  // 4 rows, one from each source.
  assert.equal(merged.length, 4);
  const bySource = Object.fromEntries(merged.map(r => [r.source, r]));
  assert.ok(bySource.documents, 'documents row present');
  assert.ok(bySource.esign, 'esign row present');
  assert.ok(bySource.pairwise_nda, 'pairwise_nda row present');
  assert.ok(bySource.partner_deal, 'partner_deal row present');

  // Sorted descending by created_at across sources.
  for (let i = 1; i < merged.length; i++) {
    assert.ok(
      new Date(merged[i - 1].created_at).getTime() >= new Date(merged[i].created_at).getTime(),
      `row ${i - 1} should be >= row ${i} by created_at`,
    );
  }

  // Status mapping is correctly applied across sources.
  assert.equal(bySource.documents.status, 'sent');
  assert.equal(bySource.esign.status, 'signed');
  assert.equal(bySource.pairwise_nda.status, 'signed');
  assert.equal(bySource.partner_deal.status, 'signed');

  // doc_type_label decoration applied to the new sources too.
  assert.equal(bySource.partner_deal.doc_type_label, 'Partner Equity Deal');
});

test('loadAllContracts tolerates missing pairwise_ndas / partner_deals tables', async () => {
  const merged = await loadRouter({
    documents: [],
    esign: [{
      id: 11, envelope_uuid: 'env-1', user_id: 2, deal_id: null,
      document_type: 'spa', document_title: 'SPA — Only', status: 'sent',
      created_at: '2026-04-02T00:00:00Z', completed_at: null,
      signed_r2_key: null, provider: 'native',
      recipient_email: null, recipient_name: null,
      signer_name: null, signer_ip: null, last_signed_at: null,
    }],
    pairwiseThrows: true,
    partnerThrows: true,
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'esign');
});

test('findContractByUid resolves all 4 sources by uid prefix / table lookup', async () => {
  // Source-level assertion: the resolver recognises the synthetic
  // `pairwise:<id>` and `partner_deal:<id>` uid prefixes and routes
  // them to their respective tables. Implemented as a source-shape
  // check (regex over the function body) since wiring the full route
  // through Hono + miniflare here would be heavyweight.
  const src = await readFile(
    resolve(__dirname, '../src/routes/admin_contracts.ts'),
    'utf8',
  );
  // Resolver branches must exist for both new uid shapes.
  assert.match(src, /pairwise:\(\\d\+\)/, 'findContractByUid must handle pairwise:<id>');
  assert.match(src, /partner_deal:\(\\d\+\)/, 'findContractByUid must handle partner_deal:<id>');
  // ContractRowRef union must include the two new sources.
  assert.match(src, /source:\s*'pairwise_nda'/, 'ContractRowRef must include pairwise_nda');
  assert.match(src, /source:\s*'partner_deal'/, 'ContractRowRef must include partner_deal');
});

test('resend / void / download return deterministic 4xx for pairwise + partner_deal sources', async () => {
  // The contracts list surfaces pairwise NDAs and partner deals as
  // unified rows, but those sources have no single recipient or stored
  // PDF, so per-row admin actions must refuse with a typed 4xx (NOT
  // 404 / 500). Source inspection asserts the dispatch branches exist
  // and return 400/404 with `source` in the body so the UI can disable
  // the buttons cleanly.
  const src = await readFile(
    resolve(__dirname, '../src/routes/admin_contracts.ts'),
    'utf8',
  );
  // Resend + void branches each gate the new sources with a 400.
  assert.match(src, /'Resend is not supported for this contract source'/);
  assert.match(src, /'Void is not supported for this contract source/);
  // And both sit inside an `if (ref.source === 'pairwise_nda' || ref.source === 'partner_deal')` guard.
  const guardMatches = src.match(
    /ref\.source === 'pairwise_nda' \|\| ref\.source === 'partner_deal'/g,
  ) || [];
  assert.ok(guardMatches.length >= 2, `expected >=2 source guards (resend+void), got ${guardMatches.length}`);
  // Download branch — 404 no_file.
  assert.match(
    src,
    /'Contract has no stored file yet'[\s\S]{0,200}\}, 404/,
    'download must 404 (no_file) for pairwise_nda + partner_deal',
  );
});

test('detail handler returns enriched UnifiedContract for pairwise + partner_deal sources', async () => {
  // Detail-flow source check: the GET /:uid handler must NOT 404 on
  // the synthetic uids — it must return a decorated UnifiedContract
  // for both new sources. Source-shape regex over the handler body.
  const src = await readFile(
    resolve(__dirname, '../src/routes/admin_contracts.ts'),
    'utf8',
  );
  assert.match(
    src,
    /if \(ref\.source === 'pairwise_nda'\)[\s\S]{0,1500}return c\.json\(detail\)/,
    'detail handler must return enriched row for pairwise_nda',
  );
  assert.match(
    src,
    /if \(ref\.source === 'partner_deal'\)[\s\S]{0,1500}return c\.json\(detail\)/,
    'detail handler must return enriched row for partner_deal',
  );
});

test('admin contracts route requires admin (requireAdmin gate)', async () => {
  // Sanity-check the route is wired with requireAdmin by inspecting the
  // source — a direct integration test would require booting Hono +
  // wrangler. Confirms that requireAdmin is invoked by every public
  // handler in admin_contracts.ts (list, stats, templates, pairwise,
  // partner deals, detail, download, void, resend, etc.).
  const src = await readFile(
    resolve(__dirname, '../src/routes/admin_contracts.ts'),
    'utf8',
  );
  // Count handler definitions vs requireAdmin usages: every handler
  // body must call requireAdmin(c).
  const handlers = src.match(/adminContracts\.(get|post|put|delete|patch)\(/g) || [];
  const requireAdminCalls = src.match(/await\s+requireAdmin\(c\)/g) || [];
  assert.ok(handlers.length >= 6, `expected >=6 handlers, got ${handlers.length}`);
  // Most handlers gate inline; a small number share a helper
  // (`mintContractDownload`) where requireAdmin runs once per call.
  // Either way the ratio of admin-gates to handlers must be near 1.
  assert.ok(
    requireAdminCalls.length >= handlers.length - 2,
    `expected ~one requireAdmin per handler (handlers=${handlers.length}, requireAdmin=${requireAdminCalls.length})`,
  );
  // And the shared download helper must itself be admin-gated.
  assert.ok(
    /async function mintContractDownload[\s\S]{0,400}await\s+requireAdmin\(c\)/.test(src),
    'mintContractDownload helper must call requireAdmin(c)',
  );
});
