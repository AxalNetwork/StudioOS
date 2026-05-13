#!/usr/bin/env node
/**
 * Task #5 (CH) — Advisor question-bank drift CI.
 *
 * Asserts:
 *   1. Every worker bank meets its size target (BANK_SIZE_TARGETS).
 *   2. Each operatingPartner sub-type has ≥ operatingPartnerPerSubtype.
 *   3. Every MISection has ≥ 3 source questions across persona banks.
 *   4. ≥ 30 followup branches exist across the whole worker bank.
 *   5. The frontend's legacy `lib/advisor/banks/*.js` files reference
 *      ONLY ids that the worker also defines (frontend ⊆ worker).
 *   6. `questionIds.gen.ts` is in sync (re-runs gen-question-ids
 *      with --check).
 *
 * Wired into `npm run test:drift`. Fast — no TS compile required;
 * regex-based extraction over .ts source.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const WORKER_SRC = resolve(ROOT, 'cloudflare-worker/src/services/advisor');
const FRONTEND_BANKS = resolve(ROOT, 'frontend/src/lib/advisor/banks');

// Hard-coded from questionBank.ts BANK_SIZE_TARGETS — kept in sync
// manually here so the CI script stays zero-dependency.
const SIZE_TARGETS = {
  newFounderSpinout: 80,
  existingFounder: 120,
  investor: 60,
  mentor: 30,
  operatingPartnerPerSubtype: 50, // ×4 sub-types
};

const MI_SECTIONS = [
  'sentiment','talc','demand_supply','fit','partner_pulse',
  'capital_velocity','sector_heat','sentiment_geo','investor_signals',
];

const PARTNER_SUBTYPES = [
  'service_provider','mentor_advisor','strategic','corporate_venture',
];

const BANK_FILES = {
  newFounderSpinout: 'banks/newFounderSpinout.ts',
  existingFounder:   'banks/existingFounder.ts',
  investor:          'banks/investor.ts',
  operatingPartner:  'banks/operatingPartner.ts',
  mentor:            'banks/mentor.ts',
};

const errors = [];
const warnings = [];

function read(p) { return readFileSync(p, 'utf8'); }

function countIds(src) {
  return (src.match(/\bid:\s*['"][^'"]+['"]/g) || []).length;
}

function extractIds(src) {
  const re = /\bid:\s*['"]([^'"]+)['"]/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function countOccurrences(src, needle) {
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return (src.match(re) || []).length;
}

// 1. Per-bank size targets ----------------------------------------------
const idsByBank = {};
for (const [name, rel] of Object.entries(BANK_FILES)) {
  const src = read(resolve(WORKER_SRC, rel));
  const ids = extractIds(src);
  idsByBank[name] = ids;
  if (name === 'operatingPartner') continue; // checked per sub-type below
  const target = SIZE_TARGETS[name];
  if (ids.length < target) {
    errors.push(`bank "${name}" has ${ids.length} questions, needs ≥ ${target}`);
  } else {
    console.log(`  ✓ ${name}: ${ids.length} ≥ ${target}`);
  }
}

// 2. operatingPartner sub-type coverage --------------------------------
const opSrc = read(resolve(WORKER_SRC, 'banks/operatingPartner.ts'));
for (const sub of PARTNER_SUBTYPES) {
  // Each sub-type's helper (SP/MA/ST/CV) emits rows by passing the sub
  // string to block(). We count `partner.<sub_short>.` ids as a proxy:
  //   service_provider → 'partner.sp.'
  //   mentor_advisor   → 'partner.ma.'
  //   strategic        → 'partner.st.'
  //   corporate_venture→ 'partner.cv.'
  const prefix = {
    service_provider: 'partner.sp.',
    mentor_advisor:   'partner.ma.',
    strategic:        'partner.st.',
    corporate_venture:'partner.cv.',
  }[sub];
  const count = idsByBank.operatingPartner.filter((id) => id.startsWith(prefix)).length;
  const target = SIZE_TARGETS.operatingPartnerPerSubtype;
  if (count < target) {
    errors.push(`operatingPartner sub-type "${sub}" (${prefix}*) has ${count} questions, needs ≥ ${target}`);
  } else {
    console.log(`  ✓ operatingPartner.${sub}: ${count} ≥ ${target}`);
  }
}

// 3. MI section coverage (≥3 questions tagged per section) -------------
const allBankSrc = Object.values(BANK_FILES)
  .map((rel) => read(resolve(WORKER_SRC, rel))).join('\n');
for (const sec of MI_SECTIONS) {
  // count `mi: 'sec'` and `mi_section: 'sec'` (helpers use mi:)
  const countA = countOccurrences(allBankSrc, `mi: '${sec}'`);
  const countB = countOccurrences(allBankSrc, `mi_section: '${sec}'`);
  const total = countA + countB;
  if (total < 3) {
    errors.push(`MI section "${sec}" has ${total} tagged questions, needs ≥ 3`);
  } else {
    console.log(`  ✓ mi_section.${sec}: ${total} ≥ 3`);
  }
}

// 4. ≥30 followup branches (count individual followup IDs across arrays) -
let followupBranches = 0;
const followupArrayRe = /followups:\s*\[([^\]]*)\]/g;
let fm;
while ((fm = followupArrayRe.exec(allBankSrc)) !== null) {
  const inner = fm[1];
  followupBranches += (inner.match(/'[^']+'/g) || []).length;
}
if (followupBranches < 30) {
  errors.push(`only ${followupBranches} followup branches across worker banks (need ≥ 30)`);
} else {
  console.log(`  ✓ followups: ${followupBranches} branches ≥ 30`);
}

// 5. Frontend legacy banks ⊆ worker ------------------------------------
const workerIdSet = new Set();
for (const ids of Object.values(idsByBank)) for (const id of ids) workerIdSet.add(id);
// also pick up role_detect.* from questionBank.ts so the frontend's
// fallback table is allowed to reference them.
const qbSrc = read(resolve(WORKER_SRC, 'questionBank.ts'));
for (const id of extractIds(qbSrc)) workerIdSet.add(id);

const frontendIds = new Set();
let frontendBankFiles = [];
try {
  frontendBankFiles = readdirSync(FRONTEND_BANKS).filter((f) => f.endsWith('.js'));
} catch {}
for (const f of frontendBankFiles) {
  const src = read(resolve(FRONTEND_BANKS, f));
  for (const id of extractIds(src)) frontendIds.add(id);
}
const orphaned = [...frontendIds].filter((id) => !workerIdSet.has(id));
if (orphaned.length) {
  errors.push(
    `frontend bank ids not present in worker (frontend ⊄ worker):\n    ${orphaned.slice(0, 10).join(', ')}` +
    (orphaned.length > 10 ? ` (+${orphaned.length - 10} more)` : '')
  );
} else {
  console.log(`  ✓ frontend ⊆ worker (${frontendIds.size} ids verified)`);
}

// 6. questionIds.gen.ts is in sync -------------------------------------
try {
  execFileSync(process.execPath, [resolve(WORKER_SRC, '../../../scripts/gen-question-ids.mjs'), '--check'],
               { stdio: 'inherit' });
} catch {
  errors.push('questionIds.gen.ts is out of sync — run `node cloudflare-worker/scripts/gen-question-ids.mjs`');
}

// Summary --------------------------------------------------------------
if (warnings.length) {
  console.warn('\nWarnings:');
  for (const w of warnings) console.warn('  - ' + w);
}
if (errors.length) {
  console.error('\n[advisor-bank-drift] FAIL:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\n[advisor-bank-drift] OK');
