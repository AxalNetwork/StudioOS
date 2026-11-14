/**
 * D1548 (#3793, deck v2 B17): publishing A19's legal drafts waits on counsel.
 *
 * The owner decided V, X and Y on 2026-11-01 and kept the counsel text his:
 * only wording counsel has given is published. None has been given, so B17
 * builds the mechanism and publishes nothing. This file holds that line:
 *
 *   · the Terms re-acceptance switch stays off while the v4 slot is still
 *     A19's draft, and the live documents are still the ones members accepted;
 *   · the ten days' notice the DPA promises (§6.1) is the notice the Trust
 *     center's Publish enforces, in the Worker and in HQ's editor, so starting
 *     it there keeps the DPA's word.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/legal_publish_d1548.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TERMS_REACCEPT_FROM, LEGAL_DOCUMENT_VERSIONS } from '../src/services/trust.ts';
import { NOTICE_DAYS } from '../src/services/trustContent.ts';

const LEGAL = 'cloudflare-worker/src/templates/legal';
const read = (p: string) => readFileSync(p, 'utf8');
const DRAFT = '<!-- DRAFT (A19, #3763)';

test('no Terms re-acceptance is asked while the v4 slot is still a draft for counsel', () => {
  const v4 = read(join(LEGAL, 'tos_v4.md'));
  const mod = read('cloudflare-worker/src/services/legalTemplates.ts');
  const draft = v4.startsWith(DRAFT);
  if (draft) {
    assert.equal(TERMS_REACCEPT_FROM, null,
      'the re-acceptance switch is on while tos_v4.md is still A19\'s draft: members would be asked to accept text counsel has not given');
    assert.match(mod, /import tos\s+from '\.\.\/templates\/legal\/tos_v3\.md\?raw';/, 'the live Terms template moved off v3 before counsel\'s text');
  } else {
    // Counsel's text has landed: the switch may be on, but only with the v4
    // template live and a version the accept writer records.
    assert.match(mod, /import tos\s+from '\.\.\/templates\/legal\/tos_v4\.md\?raw';/);
    if (TERMS_REACCEPT_FROM !== null) assert.ok(TERMS_REACCEPT_FROM <= LEGAL_DOCUMENT_VERSIONS.tos_v1);
  }
});

test('the privacy and DPA drafts are unpublished: still marked draft, and the live privacy template is v2', () => {
  for (const f of ['privacy_v3.md', 'dpa_v2.md']) {
    assert.ok(read(join(LEGAL, f)).startsWith(DRAFT), `${f} lost its DRAFT banner without counsel's text in it`);
  }
  assert.match(read('cloudflare-worker/src/services/legalTemplates.ts'),
    /import privacy\s+from '\.\.\/templates\/legal\/privacy_v2\.md\?raw';/);
});

test('the Trust center\'s notice is the DPA\'s ten days, in the Worker and in HQ\'s editor', () => {
  const clause = /notice of new\s+Sub-processors \(via the Service or email\) at least ten \(10\) days\s+before granting access to Personal Data/;
  for (const f of ['dpa_v1.md', 'dpa_v2.md']) assert.match(read(join(LEGAL, f)), clause, `${f} §6.1 changed`);
  assert.equal(NOTICE_DAYS, 10, 'Publish no longer holds a new subprocessor back ten days');
  assert.match(read('frontend/src/pages/hq/trustContentModel.js'), /export const NOTICE_DAYS = 10;/,
    'HQ\'s editor tells the admin a different notice than the Worker enforces');
  assert.match(read('cloudflare-worker/src/services/trustContent.ts'), /const earliest = addDays\(today\(now\), NOTICE_DAYS\);/);
});
