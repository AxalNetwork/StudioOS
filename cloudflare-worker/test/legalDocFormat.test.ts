// Unit tests for the shared legal-document formatting layer.
//
// Focus: `normalizeLegalBody` must remove the Markdown punctuation that was
// leaking into previews/PDFs (`#`, `##`, `**`, `>`, `---`, `- [ ]`) WITHOUT
// corrupting merge tokens, fill-in blanks, or bracket labels; and the chrome
// builders must emit the standardized preamble + execution block.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLegalBody,
  stripTrailingSignatureBlock,
  buildPreamble,
  buildExecutionBlock,
  classifyDocument,
  axalEntityKeyForDoc,
  winAnsiSafe,
  AXAL_LEGAL_ADDRESS,
  AXAL_SIGNATORY_NAME,
  AXAL_SIGNATORY_TITLE,
  AXAL_ENTITIES,
} from '../src/services/legalDocFormat.ts';

test('normalizeLegalBody strips ATX headings but keeps the text', () => {
  assert.equal(normalizeLegalBody('# Accredited Investor Self-Certification'), 'Accredited Investor Self-Certification');
  assert.equal(normalizeLegalBody('## Article I — Formation'), 'Article I — Formation');
});

test('normalizeLegalBody strips blockquotes and bold markers', () => {
  const out = normalizeLegalBody('> **Subject to legal review.** This is a draft.');
  assert.equal(out, 'Subject to legal review. This is a draft.');
  assert.ok(!out.includes('>'));
  assert.ok(!out.includes('**'));
});

test('normalizeLegalBody removes horizontal rules', () => {
  const out = normalizeLegalBody('Clause one.\n\n---\n\nClause two.');
  assert.ok(!out.includes('---'));
  assert.match(out, /Clause one\.\n\nClause two\./);
});

test('normalizeLegalBody converts task list + bullets to clean glyphs', () => {
  assert.equal(normalizeLegalBody('- [ ] Income over USD 200,000'), '[  ] Income over USD 200,000');
  assert.equal(normalizeLegalBody('- [x] Confirmed'), '[X] Confirmed');
  assert.equal(normalizeLegalBody('- A plain bullet'), '• A plain bullet');
});

test('normalizeLegalBody preserves merge tokens, blanks, and bracket labels', () => {
  const src = 'Company: {{company.legal_name}}\nEffective Date: ____________________\nInvestor: [COMPANY NAME]';
  const out = normalizeLegalBody(src);
  assert.ok(out.includes('{{company.legal_name}}'), 'merge token kept verbatim');
  assert.ok(out.includes('____________________'), 'fill-in blank kept');
  assert.ok(out.includes('[COMPANY NAME]'), 'bracket label kept (not treated as a link)');
});

test('normalizeLegalBody does not corrupt snake_case inside tokens (no underscore italics)', () => {
  const out = normalizeLegalBody('Pay {{partner.carry_pct}} to {{partner.contact_name}}.');
  assert.equal(out, 'Pay {{partner.carry_pct}} to {{partner.contact_name}}.');
});

test('normalizeLegalBody resolves markdown links to text (url)', () => {
  assert.equal(normalizeLegalBody('See [BizFile](https://bizfile.gov.sg).'), 'See BizFile (https://bizfile.gov.sg).');
});

test('stripTrailingSignatureBlock removes trailing Signed/Date scaffolding', () => {
  const body = 'Clause two is the last substantive clause.\n\nSigned: ____________________\nDate: ____________________';
  const out = stripTrailingSignatureBlock(body);
  assert.equal(out, 'Clause two is the last substantive clause.');
});

test('stripTrailingSignatureBlock leaves bodies without a signature stanza untouched', () => {
  const body = 'Section 1. The parties agree.\n\nSection 2. Governing law is Delaware.';
  assert.equal(stripTrailingSignatureBlock(body), body);
});

test('buildPreamble emits the standardized opening with the legal address', () => {
  const p = buildPreamble({
    documentTitle: 'Mentor NDA',
    effectiveDate: '2026-06-18',
    axalEntityKey: 'management',
    counterpartyName: 'Jane Founder',
  });
  assert.ok(p.startsWith('This Mentor NDA is made and entered into as of 2026-06-18'));
  assert.ok(p.includes('Axal VC Management LLC, a Delaware limited liability company'));
  assert.ok(p.includes(AXAL_LEGAL_ADDRESS));
  assert.ok(p.includes('Jane Founder (the "Counterparty")'));
});

test('buildPreamble uses placeholders when fields are absent', () => {
  const p = buildPreamble({ documentTitle: 'Service Agreement' });
  assert.ok(p.includes('[Counterparty Legal Name]'));
});

test('buildExecutionBlock: agreements get a dual block with the fixed Axal signatory', () => {
  const b = buildExecutionBlock({ kind: 'agreement', axalEntityName: 'Axal VC Management LLC', counterpartyName: 'Jane Founder' });
  assert.equal(b.parties.length, 2);
  const axal = b.parties.find((p) => p.role === 'axal');
  const cp = b.parties.find((p) => p.role === 'counterparty');
  assert.equal(axal?.heading, 'Axal VC Management LLC');
  assert.equal(axal?.name, `Name: ${AXAL_SIGNATORY_NAME}`);
  assert.equal(axal?.title, `Title: ${AXAL_SIGNATORY_TITLE}`);
  assert.equal(cp?.name, 'Name: Jane Founder');
  assert.equal(cp?.isSigner, true, 'counterparty is the signer on an agreement');
});

test('buildExecutionBlock: resolutions sign as Axal; unilateral filings sign as the counterparty', () => {
  const res = buildExecutionBlock({ kind: 'resolution' });
  assert.equal(res.parties.length, 1);
  assert.equal(res.parties[0].role, 'axal');
  assert.equal(res.parties[0].isSigner, true);

  const uni = buildExecutionBlock({ kind: 'unilateral' });
  assert.equal(uni.parties.length, 1);
  assert.equal(uni.parties[0].role, 'counterparty');
  assert.equal(uni.parties[0].isSigner, true);
});

test('classifyDocument routes kinds', () => {
  assert.equal(classifyDocument('service_agreement'), 'agreement');
  assert.equal(classifyDocument('carried_interest'), 'agreement');
  assert.equal(classifyDocument('section_83b'), 'unilateral');
  assert.equal(classifyDocument('accreditation_v1'), 'unilateral');
  assert.equal(classifyDocument('ic_charter'), 'resolution');
  assert.equal(classifyDocument('bylaws'), 'corporate');
  assert.equal(classifyDocument('operating_agreement'), 'corporate');
  assert.equal(classifyDocument('tos_v1'), 'policy');
});

test('buildExecutionBlock: corporate docs sign as the Company (no Axal party)', () => {
  const b = buildExecutionBlock({ kind: 'corporate', counterpartyName: 'Acme, Inc.' });
  assert.equal(b.parties.length, 1);
  assert.equal(b.parties[0].role, 'counterparty');
  assert.equal(b.parties[0].heading, 'Acme, Inc.');
  assert.equal(b.parties[0].isSigner, true);
});

test('axalEntityKeyForDoc routes fund/holdings/management', () => {
  assert.equal(axalEntityKeyForDoc('lpa'), 'gp');
  assert.equal(axalEntityKeyForDoc('ip_license'), 'holdings');
  assert.equal(axalEntityKeyForDoc('mentor_nda_axal'), 'management');
});

test('winAnsiSafe downgrades the 3-way NDA arrow', () => {
  assert.equal(winAnsiSafe('Founder ↔ Investor ↔ Axal'), 'Founder <-> Investor <-> Axal');
  // cp1252-mappable punctuation (em dash, bullet) is preserved.
  assert.equal(winAnsiSafe('A — B • C'), 'A — B • C');
});

// ---------------------------------------------------------------------------
// D705 (#1716) — the Fund's legal name, titles by party, and the Fund signs
// through its general partner.
// ---------------------------------------------------------------------------

const FUND_SIGNS = [
  'subscription', 'investor_subscription_pro', 'investor_subscription_inst', 'subscription booklet & lpa',
  'co-investment side letter', 'safe', 'term_sheet', 'spa', 'voting_rights',
];
const STAYS_GP = [
  'lpa', 'ppm', 'mgmt_company', 'carried_interest', 'investor_nda_axal', 'accreditation_v1',
  'spv joinder agreement', 'strategic side letter / focused spv', 'secondary purchase agreement',
  'fund formation memo',
];

test('D705: the nine documents the Fund signs route to fund; the rest of the fund set stays gp', () => {
  for (const s of FUND_SIGNS) assert.equal(axalEntityKeyForDoc(s), 'fund', s);
  for (const s of STAYS_GP) assert.equal(axalEntityKeyForDoc(s), 'gp', s);
  assert.equal(axalEntityKeyForDoc('SAFE'), 'fund', 'the slug is read case-insensitively');
});

test('D705: the Fund is Axal VC Spin-Out Lab Fund I LP, acting by its general partner', () => {
  assert.equal(AXAL_ENTITIES.fund.name, 'Axal VC Spin-Out Lab Fund I LP');
  const p = buildPreamble({ documentTitle: 'Subscription Agreement', axalEntityKey: axalEntityKeyForDoc('subscription') });
  assert.ok(p.includes('by and between Axal VC Spin-Out Lab Fund I LP, a Delaware limited partnership, acting by its general partner Axal VC GP LLC with its principal legal address'), p);
});

test('D705: each Axal party signs under its own title; the Fund signs through its GP', () => {
  const party = (key: 'fund' | 'gp' | 'management' | 'holdings') =>
    buildExecutionBlock({ kind: 'agreement', axalEntityKey: key }).parties.find((x) => x.role === 'axal')!;
  const fund = party('fund');
  assert.deepEqual([fund.heading, fund.through, fund.by, fund.name, fund.title], [
    'Axal VC Spin-Out Lab Fund I LP', 'By: Axal VC GP LLC, its general partner', 'By: ___________________________',
    `Name: ${AXAL_SIGNATORY_NAME}`, 'Title: General Partner',
  ]);
  const gp = party('gp');
  assert.deepEqual([gp.heading, gp.through, gp.title], ['Axal VC GP LLC', undefined, 'Title: General Partner']);
  const mgmt = party('management');
  assert.deepEqual([mgmt.heading, mgmt.through, mgmt.title], ['Axal VC Management LLC', undefined, 'Title: Managing Partner']);
  assert.equal(party('holdings').title, 'Title: Managing Partner');
  // A resolution signed by the GP carries the GP's title too.
  assert.equal(buildExecutionBlock({ kind: 'resolution', axalEntityKey: 'gp' }).parties[0].title, 'Title: General Partner');
  // Management's constant keeps its value for the graduation certificate.
  assert.equal(AXAL_SIGNATORY_TITLE, 'Managing Partner');
});
