// D753 (#1992) step 2 — the last in-app links to Connectors open the
// connector's own page, not the hub. Mercury's followed in PR 2, once its page
// landed (#1991). A sign-in return naming Mercury still goes to the hub
// (`connectorsRedirect`, D715 decision 3): Mercury has no sign-in.
//
//   node --test frontend/test/connector_links_d753.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

const LINKS = [
  ['pages/ProjectDetail.jsx', 'crunchbase', /Connect it in Account → Connectors/],
  ['pages/CapTablePage.jsx', 'carta', /Connect Carta/],
  ['pages/SettingsPage.jsx', 'slack', /Slack joins this table once it is connected in/],
  ['pages/admin/consoles/PartnerProfilesConsole.jsx', 'docusign', /connect DocuSign/],
  ['components/MercuryMatch.jsx', 'mercury', /Open Connectors/],
  ['components/spinout/MercuryCreditImport.jsx', 'mercury', /Open Connectors/],
  ['components/spinout/MercurySpend.jsx', 'mercury', /Open Connectors/],
];

test('each provider link opens that connector\'s page', () => {
  for (const [file, key, words] of LINKS) {
    const s = src(file);
    assert.match(s, words, `${file}: the link's words moved`);
    assert.ok(s.includes(`/account/connectors/${key}"`), `${file}: no link to /account/connectors/${key}`);
    assert.doesNotMatch(s, /["']\/account\/connectors["']/, `${file}: a provider link still opens the hub`);
  }
  // Carta has two: Connect and Manage.
  assert.equal(src('pages/CapTablePage.jsx').split('href="/account/connectors/carta"').length - 1, 2);
});

test('proof of funds\' "Connectors › Mercury" opens Mercury\'s page', () => {
  assert.match(src('pages/investor/proofOfFundsModel.js'), /CONNECTORS_LINK = \{ text: 'Connectors › Mercury', href: '\/account\/connectors\/mercury' \}/);
});

test('Eadwyn\'s list: Browse opens Discover, and a blocked row\'s reason opens its page', () => {
  const s = src('ui/EadwynComposer.jsx');
  assert.match(s, /const DISCOVER_PAGE = '\/account\/connectors\?tab=discover';/);
  assert.match(s, /<RouteLink to=\{DISCOVER_PAGE\} data-testid="link-eadwyn-browse-connectors">/);
  assert.match(s, /<RouteLink to=\{CONNECTORS_PAGE\} data-testid="link-eadwyn-manage-connectors">/);
  assert.match(s, /\{blocked && <RouteLink to=\{connectorPagePath\(c\.key\)\}/);
});
