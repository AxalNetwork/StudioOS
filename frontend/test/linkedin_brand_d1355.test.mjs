import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PublicFooter from '../src/components/PublicFooter.jsx';
import ShareButtons from '../src/components/ShareButtons.jsx';
import { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { buildCatalogue } from '../src/pages/account/connectorsModel.js';
import BrandIcon, { BRAND_MARKS } from '../src/ui/BrandIcon.jsx';
import LinkedInSignInButton from '../src/ui/LinkedInSignInButton.jsx';
import { LINKEDIN_MARK, LINKEDIN_SIGNIN } from '../src/ui/linkedinBrand.js';
const h = React.createElement;
const render = (props) => renderToStaticMarkup(h(BrandIcon, { provider: 'linkedin', ...props }));
const read = p => readFileSync(p, 'utf8');

test('D1355: the brand registry pins LinkedIn’s own bundle, licence and guidelines', () => {
  assert.deepEqual({ source: BRAND_MARKS.linkedin.source, licence: BRAND_MARKS.linkedin.licence, guidelines: BRAND_MARKS.linkedin.guidelines, version: BRAND_MARKS.linkedin.version }, {
    source: 'https://content.linkedin.com/content/dam/me/business/en-us/amp/xbu/linkedin-revised-brand-guidelines/logos/in-logo.zip',
    licence: 'https://brand.linkedin.com/in-logo', guidelines: 'https://brand.linkedin.com/in-logo', version: '2026-10-28',
  });
  assert.equal(BRAND_MARKS.linkedin, LINKEDIN_MARK);
  assert.deepEqual({source: LINKEDIN_SIGNIN.source, guidelines: LINKEDIN_SIGNIN.guidelines}, {
    source: 'https://content.linkedin.com/content/dam/developer/branding/signin_with_linkedin-buttons.zip',
    guidelines: 'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2#image-resources',
  });
});

test('D1355: every shipped pixel asset is the unmodified official download', () => {
  const expected = {
  "linkedin-in-blue.png": "3c0149f26168b5fe0f43e68664abe40341a6443b3cd435d18a73e12f64f8b600",
  "linkedin-in-white.png": "ed22a5ab46c171e3449708ff34923de7298da00ac204c7f85444db05bf888791",
  "linkedin-signin-default.png": "bea8279a2ca5d22e08d31bfc18a01cab97d689d828cb55435fa43a108e993a2f",
  "linkedin-signin-hover.png": "e56776de5dd22153ab95c2c224349ed7c01070fbb3703bf8bb6d136ed3692191",
  "linkedin-signin-active.png": "6939ae92e9aebbcd8c9b9f3a29951930aa0b333047c77d1a14fb839e25e81f6e"
};
  for (const [name, sha] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(readFileSync('frontend/public/site/'+name)).digest('hex'), sha, name);
  }
});

test('D1355: tiny callers and currentColor cannot shrink or recolour the bug; clear space is reserved', () => {
  for (const size of [12,14,16,18,24,34,48,56]) for (const variant of ['bare','tile']) for (const tone of ['brand','current']) {
    const out = render({size, variant, tone, className:'h-3 w-3 text-red-500'});
    const svg = out.match(/<svg[^>]*>/)[0];
    const glyph = Number(svg.match(/width="(\d+)"/)[1]);
    const frame = Number(out.match(/width:(\d+)px/)[1]);
    const space = Number(out.match(/padding:(\d+)(?:px)?/)[1]);
    assert.ok(glyph >= 28 && (glyph * 537 / 635) >= 21 && space >= 8 && frame >= glyph+space*2+(variant === 'tile' && tone !== 'current' ? 2 : 0), out);
    assert.match(svg, new RegExp(`min-width:${glyph}px;min-height:${glyph}px`));
    assert.doesNotMatch(out, /<path|<filter|transform=|fill="#[0-9a-f]+"/i);
  }
});

test('D1355: light uses the blue file, dark uses the supplied white file, and blue-backed controls use white', () => {
  const out = render({variant:'bare'});
  assert.match(out, /<g class="dark:hidden"><image[^>]*href="\/site\/linkedin-in-blue.png"/);
  assert.match(out, /<g class="hidden dark:inline"><image[^>]*href="\/site\/linkedin-in-white.png"/);
  const inverse = render({variant:'bare',tone:'inverse'});
  assert.ok(inverse.includes('/site/linkedin-in-white.png') && !inverse.includes('/site/linkedin-in-blue.png'));
  const onWhite = render({variant:'bare',tone:'blue'});
  assert.ok(onWhite.includes('/site/linkedin-in-blue.png') && !onWhite.includes('/site/linkedin-in-white.png'));
});

test('D1355: the official sign-in wording and all button states survive busy/disabled state', () => {
  const out = renderToStaticMarkup(h(LinkedInSignInButton, {'data-testid':'signin'}));
  assert.match(out, /<button data-testid="signin"[^>]*type="button"[^>]*aria-label="Sign in with LinkedIn"/);
  assert.deepEqual([...out.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)].map(m=>m[1]), ['/site/linkedin-signin-default.png','/site/linkedin-signin-hover.png','/site/linkedin-signin-active.png']);
  const busy = renderToStaticMarkup(h(LinkedInSignInButton, {busy:true}));
  assert.ok(/disabled=""/.test(busy) && /aria-busy="true"/.test(busy) && /Opening LinkedIn…/.test(busy));
  assert.doesNotMatch(out, /opacity-|filter:|scale|rotate/);
  assert.match(busy, /<span role="status" class="(?![^"]*sr-only)[^"]*">Opening LinkedIn…<\/span>/);
  const reconnect=renderToStaticMarkup(h(LinkedInSignInButton,{context:'Reconnect', 'aria-description':'Reconnect LinkedIn'}));
  assert.ok(reconnect.includes('aria-label="Sign in with LinkedIn — Reconnect"') && reconnect.includes('aria-description="Reconnect LinkedIn"') && />Reconnect<\/span>/.test(reconnect));
  const unavailable=renderToStaticMarkup(h(LinkedInSignInButton,{disabled:true}));
  assert.ok(unavailable.includes('cursor-not-allowed') && unavailable.includes('Sign-in unavailable') && !unavailable.includes('cursor-wait'));

});

test('D1355: every LinkedIn surface goes through the registry; only actual OAuth uses the sign-in button', () => {
  const files = readdirSync('frontend/src', {recursive:true}).filter(p=>/\.(jsx|js)$/.test(p));
  const rogue = files.filter(p=>/import[^;]*\bLinkedin\b[^;]*from ['"]lucide-react['"]/.test(read('frontend/src/'+p)));
  assert.deepEqual(rogue, []);
  for (const file of ['ConnectorPage.jsx','ConnectorSheet.jsx']) {
    const src=read('frontend/src/pages/account/'+file);
    assert.match(src, /p.key === 'linkedin'[\s\S]*?<LinkedInSignInButton[^>]*onClick=\{(?:press|startOauth)\}/);
  }
  const referral=read('frontend/src/pages/ReferralsPage.jsx');
  assert.ok(referral.includes('Import from LinkedIn') && referral.includes("const importLinkedin = () => setLinkedinSheet(true)") && !referral.includes('LinkedInSignInButton'));
  assert.match(read('frontend/src/pages/SettingsPage.jsx'), /Import from connected account/);
});

test('D1355: real footer and share links reserve space, and the footer stays blue on its white backing', () => {
  const footer=renderToStaticMarkup(h(MemoryRouter,null,h(PublicFooter)));
  const link=footer.match(/<a[^>]*aria-label="LinkedIn"[^>]*>[\s\S]*?<\/a>/)[0];
  const anchor=link.match(/^<a[^>]*>/)[0];
  assert.ok(anchor.includes('min-width:44px;min-height:44px') && link.includes('/site/linkedin-in-blue.png') && !link.includes('/site/linkedin-in-white.png'));
  const share=renderToStaticMarkup(h(ShareButtons,{url:'https://example.invalid',title:'Synthetic',size:'sm'}));
  const target=share.match(/<a[^>]*data-testid="share-linkedin"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.ok(target.includes('min-h-[44px] min-w-[44px]') && target.includes('min-width:28px;min-height:28px'));
});


test('D1355: the real LinkedIn page retains unavailable and reconnect context', () => {
  const catalogue=buildCatalogue({firstParty:{linkedin:{configured:false,connected:false}}});
  const page=()=>renderToStaticMarkup(h(MemoryRouter,null,h(ConnectorPageView,{connectorKey:'linkedin',phone:true,data:{status:'ready',catalogue,reload() {}}})));
  const unavailable=page();
  assert.match(unavailable, /<button[^>]*disabled=""[^>]*aria-describedby="linkedin-unavailable-note"[^>]*data-testid="connector-page-unavailable"[^>]*>Not set up here<\/button>/);
  assert.doesNotMatch(unavailable, /linkedin-signin-/);
  const row=catalogue.find(p=>p.key === 'linkedin');
  row.available=true;
  row.connection={first_party:true,status:'error',last_error:'invalid_grant: expired'};
  const reconnect=page();
  assert.match(reconnect, /aria-label="Sign in with LinkedIn — Reconnect"/);
  assert.match(reconnect, /aria-description="Reconnect LinkedIn"/);
  assert.match(reconnect, /max-sm:flex-1/);
  assert.match(reconnect, /max-sm:flex-col max-sm:gap-2/);
  assert.match(reconnect, />Reconnect<\/span>/);
});
