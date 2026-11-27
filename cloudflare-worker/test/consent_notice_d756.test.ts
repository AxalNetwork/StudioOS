// D756 §1.7 (#1894): the interviewee notice's version and its link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_NOTICE_VERSION, CONSENT_NOTICE_PATH, consentNoticeUrl } from '../src/services/channels/consentNotice.ts';

const url = (env: Record<string, string | undefined>) => consentNoticeUrl(env as any);

test('D756 the notice link is the https base, the path and the version, and nothing else', () => {
  assert.equal(CONSENT_NOTICE_PATH, '/privacy/interviews');
  assert.equal(url({ PUBLIC_BASE_URL: 'https://axal.vc' }), 'https://axal.vc/privacy/interviews?n=1');
  assert.equal(url({ PUBLIC_BASE_URL: 'https://axal.vc/' }), 'https://axal.vc/privacy/interviews?n=1');
  assert.equal(url({ PUBLIC_BASE_URL: '  https://axal.vc//  ' }), 'https://axal.vc/privacy/interviews?n=1');
  assert.equal(url({ APP_URL: 'https://app.axal.vc' }), 'https://app.axal.vc/privacy/interviews?n=1', 'APP_URL when PUBLIC_BASE_URL is unset');
  assert.equal(url({ PUBLIC_BASE_URL: 'https://axal.vc', APP_URL: 'https://other.example' }), 'https://axal.vc/privacy/interviews?n=1');
});

test('D756 no https base, no link: a sender must refuse rather than send a notice without it', () => {
  for (const base of ['http://axal.vc', '', '   ', 'axal.vc', 'https://axal.vc/app', 'https://', 'javascript:alert(1)']) {
    assert.equal(url({ PUBLIC_BASE_URL: base }), null, JSON.stringify(base));
  }
  assert.equal(url({}), null, 'neither base set');
});

test('D756 the version is a positive whole number', () => {
  assert.ok(Number.isSafeInteger(CONSENT_NOTICE_VERSION) && CONSENT_NOTICE_VERSION > 0);
});
