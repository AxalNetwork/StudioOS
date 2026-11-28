// D7810 (#7810): record provenance, reviewed references and explicit unreviewed terms.
//
// From frontend/test/README.md (moved by #6472): `company_source_7810.test.mjs` checks stored
// publisher provenance and explicit unreviewed licence terms (D7810).
import test from 'node:test';
import assert from 'node:assert/strict';
import { companySource } from '../src/pages/research/companySource.js';
const reference = (source_name) => ({
  source_name,
  licence_name: 'Recorded reference terms',
  licence_link: 'https://example.test/licence',
  required_attribution: 'Quoted attribution',
  terms_reviewed_on: '2026-11-20',
});
test('stored publisher wins, reference words replace raw licence text, and unknown publishers stay explicit', () => {
  for (const source_name of [
    'Wikidata',
    'Companies House',
    'Norway BRREG',
    'Estonia RIK',
    'Finland PRH',
  ]) {
    const row = {
      source_name,
      source_license: 'raw terms',
      source_url: 'https://example.test/record',
      as_of: '2026-01-01',
    };
    const result = companySource(row, reference(source_name));
    assert.equal(result.label, source_name);
    assert.equal(result.licenceWords, 'Recorded reference terms');
    assert.equal(result.attribution, 'Quoted attribution');
    assert.equal(result.linkText, 'View the source record');
    assert.equal(result.asOf, '2026-01-01');
    const unreviewed = companySource(row);
    assert.match(
      unreviewed.licenceWords,
      /raw terms.*licence terms not reviewed/,
    );
    assert.equal(unreviewed.licenceLink, null);
    assert.equal(unreviewed.attribution, null);
  }
  assert.equal(companySource({}).label, 'Source not recorded');
  const ref = reference('Companies House');
  assert.equal(
    companySource(
      { source_name: 'Companies House', source_license: 'sentence' },
      ref,
    ).licenceWords,
    companySource(
      { source_name: 'Companies House', source_license: 'OGL-3.0' },
      ref,
    ).licenceWords,
  );
  assert.match(
    companySource(
      { source_name: 'Unknown', source_license: 'Original wording' },
      ref,
    ).licenceWords,
    /Original wording.*not reviewed/,
  );
  assert.doesNotMatch(
    JSON.stringify(companySource({ source_name: 'Unknown' })),
    /Wikidata/,
  );
  assert.equal(
    companySource({ source_url: 'javascript:alert(1)' }).sourceLink,
    null,
  );
  assert.equal(
    companySource(
      { source_name: 'Companies House' },
      { ...ref, licence_link: 'javascript:alert(1)' },
    ).licenceLink,
    null,
  );
});
