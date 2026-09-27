/**
 * D449 — registrar chips name where the person publishes the records, and
 * Copy all copies one whole record. The records themselves do not change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DomainWizard, { REGISTRARS, dnsRecordClipboard } from '../src/components/licence/DomainWizard.jsx';

const DOMAIN = {
  hostname: 'app.example.com',
  state: 'pending',
  records: [
    { kind: 'ownership', type: 'TXT', name: '_axal-challenge.app.example.com', value: 'axal-verify=abc', ttl: 300 },
    { kind: 'traffic', type: 'CNAME', name: 'app.example.com', value: 'cname.os.axal.vc', ttl: 300 },
  ],
};

const render = (props) => renderToStaticMarkup(createElement(DomainWizard, props));

test('Copy all carries type, name, value and a finite TTL, and leaves a missing TTL off', () => {
  assert.equal(
    dnsRecordClipboard(DOMAIN.records[0]),
    'Type TXT\nName _axal-challenge.app.example.com\nValue axal-verify=abc\nTTL 300',
  );
  assert.equal(
    dnsRecordClipboard({ type: 'CNAME', name: 'app.example.com', value: 'cname.os.axal.vc', ttl: null }),
    'Type CNAME\nName app.example.com\nValue cname.os.axal.vc',
  );
  assert.equal(dnsRecordClipboard({ type: 'TXT', name: 'n', value: 'v' }).includes('TTL'), false);
});

test('the bound wizard shows the six registrars unpressed, and Copy all on each record', () => {
  const html = render({ domain: DOMAIN, available: true });
  assert.match(html, /data-testid="domain-checklist"/);
  assert.match(html, /data-testid="domain-registrars"/);
  for (const name of REGISTRARS) {
    assert.match(html, new RegExp(`aria-pressed="false"[^>]*>${name}<`));
  }
  assert.equal(html.includes('aria-pressed="true"'), false);
  assert.equal(html.includes('domain-registrar-picked'), false);
  assert.match(html, /data-testid="domain-copy-all-ownership"/);
  assert.match(html, /data-testid="domain-copy-all-traffic"/);
  assert.match(html, />Copy all</);
  assert.match(html, /The records below are the same at each of these/);
});

test('a detached host still offers no control', () => {
  const html = render({
    domain: { hostname: 'app.example.com', state: 'detached', detach_reason: 'collision' },
    available: true,
  });
  assert.match(html, /data-testid="domain-detached"/);
  assert.equal(html.includes('domain-registrars'), false);
  assert.equal(html.includes('Copy all'), false);
  assert.equal(html.includes('<button'), false);
});
