/**
 * D687 (#1646) — every service's mark, coded once in `ui/BrandIcon.jsx`.
 *
 * The guard reads every key the app draws from its sources (the Worker
 * registry as text, the frontend lists as modules or text) and holds each to
 * exactly one of BRAND_MARKS, BRAND_GENERIC or BRAND_MONOGRAM; checks each
 * mark's record, its contrast in both modes and its rendering; and renders
 * the surfaces that now draw a mark.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/brand_icons_d687.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import BrandIcon, {
  BRAND_ALIAS, BRAND_GENERIC, BRAND_MARKS, BRAND_MONOGRAM, MULTI_TILE_CLASS, SIMPLE_ICONS, TILE_CLASS, TILE_HEX, VENDOR_MARKS, resolveBrand,
} from '../src/ui/BrandIcon.jsx';
import * as uiBarrel from '../src/ui/index.js';
import { FIRST_PARTY } from '../src/pages/account/connectorsModel.js';
import { CHANNEL_PROVIDERS } from '../src/pages/account/channelsModel.js';
import { ASSISTANTS } from '../src/pages/account/assistantSetup.js';
import { PROVIDERS } from '../src/pages/founder/recordSetup.js';
import { SOCIAL_LINKS } from '../src/lib/siteLinks.js';
import { SOCIALS } from '../src/components/AuthorCard.jsx';

const read = (p) => readFileSync(p, 'utf8');
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

// ── The sources ─────────────────────────────────────────────────────────────

/** The Worker registry's keys, read as text inside the REGISTRY array (figma's entry is one line). */
function registryKeys() {
  const src = read('cloudflare-worker/src/integrations/registry.ts');
  const start = src.indexOf('export const REGISTRY: ProviderDescriptor[] = [');
  assert.ok(start >= 0, 'the REGISTRY array is where this test reads it');
  const end = src.indexOf('\n];', start);
  return [...src.slice(start, end).matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
}
/** The keys of an object literal named `name` in a source file. */
function literalKeys(file, name) {
  const src = read(file);
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `${name} is where this test reads it in ${file}`);
  const body = src.slice(start, src.indexOf('\n};', start));
  return [...body.matchAll(/^\s+([a-z0-9_]+):/gm)].map((m) => m[1]);
}
/** `key: '…'` inside a span of a file, from `from` to the first `to` after it. */
function keysBetween(file, from, to) {
  const src = read(file);
  const start = src.indexOf(from);
  assert.ok(start >= 0, `${from} is where this test reads it in ${file}`);
  return [...src.slice(start, src.indexOf(to, start)).matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

const SOURCES = {
  registry: registryKeys(),
  firstParty: FIRST_PARTY.map((p) => p.key),
  channels: [...CHANNEL_PROVIDERS],
  assistants: ASSISTANTS.map((a) => a.key),
  record: Object.values(PROVIDERS).flat().map((p) => p.value),
  integrationKeys: literalKeys('frontend/src/pages/admin/consoles/IntegrationKeysConsole.jsx', 'PROVIDER_LABELS'),
  socialLinks: SOCIAL_LINKS.map((l) => l.key),
  referrals: keysBetween('frontend/src/pages/ReferralsPage.jsx', 'sharePlatforms', '];'),
  shareButtons: keysBetween('frontend/src/components/ShareButtons.jsx', 'const targets = [', '];'),
  articleShare: keysBetween('frontend/src/pages/ArticleReaderPage.jsx', 'const targets = [', '];'),
  authorSocials: SOCIALS.map((s) => s.key),
  profileLinks: [...read('frontend/src/pages/PublicProfilePage.jsx').match(/const Icon = \{([^}]*)\}/)[1].matchAll(/([a-z0-9_]+):/g)].map((m) => m[1]),
};
const ALL_KEYS = [...new Set(Object.values(SOURCES).flat())].sort();
const canon = (k) => (Object.hasOwn(BRAND_ALIAS, k) ? BRAND_ALIAS[k] : k);
const TABLES = { mark: BRAND_MARKS, generic: BRAND_GENERIC, monogram: BRAND_MONOGRAM };

const SIMPLE_ICONS_KEYS = ['figma', 'hubspot', 'calendly', 'crunchbase', 'stripe', 'github', 'zoom', 'google_meet', 'telegram', 'whatsapp', 'signal', 'claude', 'gemini', 'x', 'facebook', 'instagram', 'youtube', 'tiktok'];
const VENDOR_OR_MONOGRAM = ['google', 'salesforce', 'slack', 'docusign', 'carta', 'affinity', 'microsoft', 'teams', 'linkedin', 'chatgpt', 'grok', 'mercury'];
const GENERIC = { phone_speaker: 'Phone', sms: 'MessageSquare', paste: 'ClipboardPaste', other: 'Bot', website: 'Globe', email: 'Mail' };

// ── 1. Every key is classified ──────────────────────────────────────────────

test('1. every key the app draws is classified, exactly once', () => {
  assert.deepEqual(SOURCES.registry, ['figma', 'hubspot', 'calendly', 'salesforce', 'carta', 'slack', 'docusign', 'crunchbase', 'stripe', 'affinity', 'github', 'zoom', 'google_calendar', 'microsoft_365', 'mercury'], 'the Worker registry\'s 15 keys, figma\'s one-line entry included');
  for (const key of ALL_KEYS) {
    const c = canon(key);
    const homes = Object.entries(TABLES).filter(([, t]) => Object.hasOwn(t, c)).map(([n]) => n);
    assert.equal(homes.length, 1, `${key} (${c}) is in exactly one table, not ${JSON.stringify(homes)}`);
  }
  const classified = [...new Set(ALL_KEYS.map(canon))].sort();
  assert.equal(classified.length, 36);
  assert.deepEqual(classified, [...SIMPLE_ICONS_KEYS, ...VENDOR_OR_MONOGRAM, ...Object.keys(GENERIC)].sort());
  assert.deepEqual(BRAND_ALIAS, { google_calendar: 'google', microsoft_365: 'microsoft', twitter: 'x', gcip: 'google' });
  assert.deepEqual(Object.keys(BRAND_MARKS).sort(), [...SIMPLE_ICONS_KEYS, ...Object.keys(VENDOR_MARKS)].sort(), 'Simple Icons and the recorded vendor artwork');
  for (const k of VENDOR_OR_MONOGRAM) assert.ok(Object.hasOwn(BRAND_MARKS, k) || Object.hasOwn(BRAND_MONOGRAM, k), `${k}: the vendor's mark or a monogram`);
  for (const [k, icon] of Object.entries(GENERIC)) assert.equal(BRAND_GENERIC[k].Icon.displayName, icon, `${k} draws lucide ${icon}`);
});

test('D752 (#1907): Mercury stays the monogram, never lucide Landmark and never the canvas placeholder #5b6cff', () => {
  assert.ok(Object.hasOwn(BRAND_MONOGRAM, 'mercury'), 'mercury is a monogram entry');
  assert.ok(!Object.hasOwn(BRAND_MARKS, 'mercury') && !Object.hasOwn(BRAND_GENERIC, 'mercury'), 'and in no other table');
  assert.equal(resolveBrand('mercury').kind, 'monogram');
  assert.match(BRAND_MONOGRAM.mercury.reason, /re-checked 2026-10-18/);
  for (const variant of ['tile', 'bare']) {
    const out = html(h(BrandIcon, { provider: 'mercury', name: 'Mercury', variant }));
    assert.match(out, /data-brand="monogram"[^>]*data-provider="mercury"[^>]*>M</, variant);
    assert.doesNotMatch(out, /lucide|landmark|<svg/i, `${variant}: no lucide glyph`);
    assert.doesNotMatch(out, /5b6cff/i, `${variant}: never the placeholder colour`);
  }
  assert.doesNotMatch(JSON.stringify(BRAND_MONOGRAM.mercury), /5b6cff/i);
  const src = read('frontend/src/ui/BrandIcon.jsx');
  assert.doesNotMatch(src, /5b6cff/i, 'BrandIcon.jsx never names the placeholder colour');
  assert.doesNotMatch(/import \{([^}]*)\} from 'lucide-react'/.exec(src)[1], /\bLandmark\b/, 'BrandIcon.jsx imports no lucide Landmark');
});

// ── 2. No orphans, no duplicates ────────────────────────────────────────────

test('2. no table entry or alias without a source, and no key in two tables', () => {
  const used = new Set(ALL_KEYS.map(canon));
  for (const [name, t] of Object.entries(TABLES)) for (const k of Object.keys(t)) assert.ok(used.has(k), `${name}.${k} is drawn by no source`);
  for (const [alias, to] of Object.entries(BRAND_ALIAS)) {
    assert.ok(ALL_KEYS.includes(alias), `alias ${alias} comes from a source`);
    assert.ok(!Object.values(TABLES).some((t) => Object.hasOwn(t, alias)), `alias ${alias} is not itself a table key`);
    assert.ok(Object.values(TABLES).some((t) => Object.hasOwn(t, to)), `alias ${alias} → ${to}, a classified key`);
  }
  const all = Object.values(TABLES).flatMap((t) => Object.keys(t));
  assert.equal(new Set(all).size, all.length, 'the three tables do not overlap');
});

// ── 3. Safe lookup ──────────────────────────────────────────────────────────

test('3. constructor, __proto__, toString and an unknown key draw the monogram, never a mark', () => {
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'notion', '', null, undefined, 7, { key: 'github' }]) {
    assert.equal(resolveBrand(k).kind, 'unknown', String(k));
    const out = html(h(BrandIcon, { provider: k, name: 'Some Tool' }));
    assert.match(out, /data-brand="monogram"/, String(k));
    assert.doesNotMatch(out, /<svg/, String(k));
    assert.match(out, />ST</);
  }
  assert.equal(resolveBrand('GitHub').key, 'github', 'keys are case-insensitive');
  assert.equal(resolveBrand('twitter').key, 'x');
  assert.equal(html(h(BrandIcon, { provider: 'constructor', fallback: 'none' })), '');
});

// ── 4. Every mark is recorded ───────────────────────────────────────────────

test('4. every mark records its path, colour, source and licence; every monogram its reason', () => {
  assert.deepEqual(SIMPLE_ICONS, { version: '16.35.0', licence: 'CC0-1.0', source: 'https://www.npmjs.com/package/simple-icons/v/16.35.0' });
  for (const [k, m] of Object.entries(BRAND_MARKS)) {
    if (m.artwork) {
      assert.ok(m.artwork.length > 0, `${k}: recorded SVG elements`);
      assert.match(m.sourceBlob, /^[a-f0-9]{40}$/, `${k}: immutable source blob`);
      assert.match(m.viewBox, /^[.0-9 -]+$/, `${k}: original coordinate system`);
    } else {
      assert.match(m.path, /^[MmZzLlHhVvCcSsQqTtAa0-9.,\s-]+$/, `${k}: SVG path characters only`);
      assert.ok(m.path.length > 40, `${k}: a real path`);
    }
    for (const c of ['hex', 'dark']) assert.match(m[c], /^#[0-9A-Fa-f]{6}$/, `${k}.${c}`);
    assert.ok(m.source && m.licence, `${k}: source and licence`);
    if (SIMPLE_ICONS_KEYS.includes(k)) {
      assert.equal(m.licence, 'CC0-1.0', k);
      assert.equal(m.version, '16.35.0', k);
      assert.ok(m.source.includes('16.35.0') && m.source.includes(`icons/${m.slug}.svg`), `${k}: ${m.source}`);
    }
  }
  assert.equal(BRAND_MARKS.google_meet.slug, 'googlemeet');
  assert.equal(BRAND_MARKS.gemini.slug, 'googlegemini');
  assert.match(BRAND_MARKS.x.path, /^M14\.234 10\.162/, 'X is 16.35.0\'s path, not an older release\'s');
  for (const [k, m] of Object.entries(BRAND_MONOGRAM)) assert.ok(typeof m.reason === 'string' && m.reason.length > 40, `${k}: a monogram says why`);
  assert.match(BRAND_MONOGRAM.teams.reason, /never be used without an express license/);
  assert.match(read('frontend/src/ui/BrandIcon.jsx'), /CC0-1\.0[\s\S]*4\(a\) waives no trademark[\s\S]*nominative use/, 'the module\'s header is the notice');
});

// ── 5. Contrast in both modes ───────────────────────────────────────────────

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('5. each mark reads on its tile in light and in dark', () => {
  assert.deepEqual(TILE_HEX, { light: '#ffffff', dark: '#1e2939' });
  const white = [];
  for (const [k, m] of Object.entries(BRAND_MARKS)) {
    if (m.multicolour || m.paths) { assert.match(MULTI_TILE_CLASS, /dark:bg-white/, `${k}: a multi-colour mark sits on white`); continue; }
    assert.ok(contrast(m.hex, TILE_HEX.light) >= 1.5, `${k}: light ${contrast(m.hex, TILE_HEX.light).toFixed(2)}:1`);
    assert.ok(contrast(m.dark, TILE_HEX.dark) >= 3, `${k}: dark ${contrast(m.dark, TILE_HEX.dark).toFixed(2)}:1`);
    if (m.dark.toLowerCase() === '#ffffff') white.push(k);
    else assert.equal(m.dark, m.hex, `${k} keeps its brand colour in dark mode`);
  }
  assert.deepEqual(white.sort(), ['chatgpt', 'github', 'grok', 'linkedin', 'signal', 'tiktok', 'x', 'zoom']);
});

// ── 6. Rendering ────────────────────────────────────────────────────────────

test('6. a mark is decoration: aria-hidden, unfocusable, no title, with its key; the tile has its dark classes', () => {
  for (const k of Object.keys(BRAND_MARKS)) {
    for (const props of [{}, { size: 24 }, { variant: 'bare', size: 16 }, { tone: 'current', size: 18 }]) {
      const out = html(h(BrandIcon, { provider: k, name: k, ...props }));
      const svg = out.match(/<svg[^>]*>/)[0];
      assert.match(svg, /aria-hidden="true"/, k);
      assert.match(svg, /focusable="false"/, k);
      assert.match(svg, new RegExp(`data-provider="${k}"`), k);
      assert.doesNotMatch(out, /<title/, k);
      if (props.tone === 'current') assert.doesNotMatch(svg, /--brand/, `${k}: currentColor, no brand colour`);
      else if (BRAND_MARKS[k].multicolour) {
        assert.match(out, /dark:bg-white/, `${k}: retain the brand palette on white`);
      } else assert.match(svg, /text-\[color:var\(--brand\)\] dark:text-\[color:var\(--brand-dark\)\]/, k);
    }
  }
  const tile = html(h(BrandIcon, { provider: 'stripe', name: 'Stripe' }));
  for (const cls of ['rounded-[9px]', 'bg-white', 'dark:bg-gray-800', 'dark:border-gray-700']) assert.ok(tile.includes(cls), cls);
  assert.match(tile, /width:34px;height:34px/);
  assert.match(tile, /<svg[^>]*width="18"/);
  assert.match(html(h(BrandIcon, { provider: 'stripe', size: 24 })), /width:24px;height:24px[\s\S]*<svg[^>]*width="14"/);
  assert.match(html(h(BrandIcon, { provider: 'stripe', variant: 'bare', size: 20 })), /^<svg[^>]*width="20"/, 'bare: the glyph alone at its own size');
  const mono = html(h(BrandIcon, { provider: 'carta', name: 'Carta' }));
  for (const cls of ['bg-axal-lavender', 'text-axal-violet-deep', 'dark:bg-violet-900/30', 'dark:text-violet-300']) assert.ok(mono.includes(cls), cls);
  assert.match(mono, /data-provider="carta"[^>]*>C</);
  assert.equal(TILE_CLASS.includes('dark:bg-gray-800'), true);
  assert.equal(uiBarrel.BrandIcon, BrandIcon, 'imported from the ui barrel');
  assert.match(read('frontend/src/ui/README.md'), /`BrandIcon\.jsx`/, 'listed in ui/README');
});

// ── 7. Each surface draws its mark ──────────────────────────────────────────

import { ConnectorCard, YoursTable } from '../src/pages/account/AccountConnectors.jsx';
import { MeetingChannelCard } from '../src/pages/account/ChannelsGroup.jsx';
import { SetupCard, GrantsList } from '../src/pages/account/AssistantsGroup.jsx';
import { ProviderTag } from '../src/pages/founder/InterviewChannels.jsx';
import { ChannelOriginBadge } from '../src/pages/founder/ChannelOriginBadge.jsx';
import { ConsentView } from '../src/pages/connect/ConnectAssistantPage.jsx';
import { Sheet, Row } from '../src/pages/account/ConnectorSheet.jsx';
import { ProofOfFundsSheet, SharedProofOfFunds } from '../src/pages/investor/ProofOfFunds.jsx';
const routed = (el) => html(h(MemoryRouter, null, el));
/** The provider's mark (or monogram) with the visible name after it. */
const markThenName = (out, key, name) => {
  const mark = `data-provider="${key}"`;
  const at = out.indexOf(mark);
  assert.ok(at >= 0 && out.includes(name, at + mark.length), `${key} → ${name}`);
};

test('7. Connectors, Build\'s rows, channel cards, setup cards, provider tags and origin badges draw the mark beside the name', () => {
  const p = { key: 'stripe', display_name: 'Stripe', by: 'Stripe', description: 'Payments.', available: true, has_implementation: true, status: 'live' };
  markThenName(routed(h(ConnectorCard, { p, onOpen() {} })), 'stripe', 'Stripe');
  assert.match(routed(h(ConnectorCard, { p })), /data-testid="connector-card-stripe"[\s\S]*?width:34px;height:34px/, 'the card keeps the 34px tile');
  markThenName(routed(h(YoursTable, { rows: [{ p: { ...p, key: 'github', display_name: 'GitHub', by: 'GitHub' }, status: { label: 'Connected', tone: 'ok' } }], onOpen() {} })), 'github', 'GitHub');
  markThenName(routed(h(ConnectorCard, { p: { ...p, key: 'salesforce', display_name: 'Salesforce' }, onOpen() {} })), 'salesforce', 'Salesforce');
  markThenName(routed(h(Sheet, { title: 'HubSpot', provider: 'hubspot', providerName: 'HubSpot', onClose() {} })), 'hubspot', 'HubSpot');
  markThenName(routed(h(Row, { icon: h(BrandIcon, { provider: 'zoom', size: 24 }), a: 'Zoom' })), 'zoom', 'Zoom');
  // D752 (#1891): the investor's share sheet title and the shared section's heading.
  const never = () => new Promise(() => {});
  const stub = { targets: never, accounts: never, share: never, list: never, revoke: never };
  markThenName(routed(h(ProofOfFundsSheet, { target: { purpose: 'deal_commitment', target_id: 1, label: 'Deal', max_cents: 100000, attestable: true, active: null }, consent: { version: 'v', template: '' }, minimumCents: 100000, onClose() {}, api: stub, personal: { status: never } })), 'mercury', 'Mercury');
  markThenName(routed(h(SharedProofOfFunds, { targetsState: { status: 'loading' }, api: stub })), 'mercury', 'Mercury');
  assert.match(read('frontend/src/pages/account/ConnectToolSheet.jsx'), /<Row icon=\{<BrandIcon provider=\{p\.key\} name=\{p\.display_name\} size=\{24\} \/>\}/, 'Build\'s rows pass the 24px tile');
  for (const [provider, title] of [['zoom', 'Zoom'], ['google_meet', 'Google Meet']]) {
    markThenName(routed(h(MeetingChannelCard, { card: { provider, state: 'unavailable', tone: 'neutral', label: 'Not set up' } })), provider, title);
  }
  markThenName(routed(h(SetupCard, { a: { key: 'claude', name: 'Claude', by: 'Anthropic', steps: ['One'], doc: 'https://example.test/doc' } })), 'claude', 'Claude');
  markThenName(routed(h(SetupCard, { a: { key: 'chatgpt', name: 'ChatGPT', by: 'OpenAI', steps: ['One'], doc: 'https://example.test/doc' } })), 'chatgpt', 'ChatGPT');
  for (const [provider, label] of [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['zoom', 'Zoom'], ['google_meet', 'Google Meet']]) {
    assert.match(html(h(ProviderTag, { provider })), new RegExp(`data-testid="provider-tag"[^>]*><svg[^>]*data-provider="${provider}"[\\s\\S]*</svg>${label}<`), provider);
    const badge = html(h(ChannelOriginBadge, { session: { channel: 'text', submitted_via: provider } }));
    assert.match(badge, new RegExp(`<svg[^>]*data-provider="${provider}"[\\s\\S]*</svg>From ${label}<`), provider);
  }
  assert.doesNotMatch(html(h(ProviderTag, { provider: 'other' })), /<svg/, 'other draws no assistant Bot');
});

test('7b. the surfaces this test cannot mount pass the key to BrandIcon at the agreed size', () => {
  const has = (file, re, why) => assert.match(read(file), re, `${file}: ${why}`);
  has('frontend/src/pages/CalendarPage.jsx', /<BrandIcon provider=\{provider\} name=\{name\} size=\{24\} \/><strong>\{name\}<\/strong>/, 'the provider card\'s 24px tile');
  has('frontend/src/pages/CalendarPage.jsx', /provider="google_calendar" name="Google Calendar"[\s\S]*provider="microsoft_365" name="Microsoft Outlook"/, 'both providers, by key');
  has('frontend/src/pages/admin/consoles/IntegrationKeysConsole.jsx', /<BrandIcon provider=\{row\.provider_key\} name=\{label\} size=\{24\} \/>/, 'a 24px tile by each label');
  has('frontend/src/pages/hq/PlatformPage.jsx', /<BrandIcon provider=\{k\.provider_key\} name=\{PROVIDER_LABEL\[k\.provider_key\] \|\| k\.provider_key\} size=\{24\} \/>/, 'a 24px tile by each label');
  has('frontend/src/pages/admin/consoles/GithubSyncConsole.jsx', /<BrandIcon provider="github" name="GitHub" size=\{18\} variant="bare" tone="current" className="text-gray-800 dark:text-gray-100" \/>/, 'the GitHub mark in GitHub\'s documented monochrome, as the console drew it, not lucide\'s GitBranch');
  has('frontend/src/pages/account/AccountConnectors.jsx', /<BrandIcon provider="telegram" name="Telegram" \/>\s*<span className="text-sm font-bold[^"]*">Telegram · Axal VC channels/, 'the Telegram card\'s tile');
  has('frontend/src/pages/account/AccountConnectors.jsx', /<VerifiedBadge on=\{p\.verified_on\} \/>/, 'the Verified mark is the one primitive');
  has('frontend/src/ui/VerifiedBadge.jsx', /role="img" aria-label="Verified"/, 'the Verified mark is an image');
  assert.doesNotMatch(read('frontend/src/pages/account/AccountConnectors.jsx'), /title="Built and verified by Axal"/, 'the unrecorded ✓ is gone');
  has('frontend/src/pages/account/connectorTools.jsx', /<BrandIcon provider="hubspot" name="HubSpot" size=\{24\} \/>HubSpot pipeline/, 'HubSpot\'s modal title');
  has('frontend/src/pages/account/connectorTools.jsx', /<BrandIcon provider="salesforce" name="Salesforce" size=\{24\} \/>Salesforce field mapping/, 'Salesforce\'s modal title');
  has('frontend/src/pages/account/GithubSyncSheet.jsx', /title=\{`\$\{name\} is synced`\} provider="github"[\s\S]*title=\{`Connect \$\{name\}`\} provider="github"/, 'both GitHub sheet headers');
  has('frontend/src/pages/account/ConnectorSheet.jsx', /footer=\{footer\} provider=\{p\.key\} providerName=\{p\.display_name\}/, 'the connector sheet passes its catalogue key');
  has('frontend/src/pages/founder/InterviewChannels.jsx', /<BrandIcon provider=\{p\.key\} size=\{16\} variant="bare"/, 'Call on chips: the bare 16px mark');
  has('frontend/src/components/ProofOfFunds.jsx', /<BrandIcon provider="mercury" name="Mercury" size=\{24\} \/>/, 'the proof of funds row\'s 24px tile');
  has('frontend/src/pages/investor/ProofOfFunds.jsx', /const MARK = <BrandIcon provider="mercury" name="Mercury" size=\{24\} \/>;[\s\S]*\{MARK\}\s*<span>\{door\.text\}<\/span>/, 'each door\'s chip: the 24px tile before the words naming Mercury');
  assert.deepEqual(SOCIAL_LINKS.map((l) => [l.key, l.label]), [['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['x', 'X'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['telegram', 'Telegram'], ['tiktok', 'TikTok']]);
});

// ── 8. Assistant marks follow the server ────────────────────────────────────

test('8. the consent page draws a mark only for the identity the Worker verified; grant rows draw none', () => {
  const REQUEST = { redirect_host: 'chatgpt.example', redirect_uri: 'https://chatgpt.example/cb', scopes: ['validate:read'], companies: [{ id: 7, name: 'Northwind' }] };
  const spoof = html(h(ConsentView, { request: { ...REQUEST, client_name: 'ChatGPT' } }));
  assert.doesNotMatch(spoof, /data-provider="chatgpt"/, 'a self-declared ChatGPT wears no ChatGPT mark');
  assert.match(spoof, /data-testid="consent-assistant-identity"[^>]*><svg[^>]*data-provider="other"[\s\S]*?Unverified assistant</, 'the generic client glyph');
  const real = html(h(ConsentView, { request: { ...REQUEST, client_name: 'Whatever', verified_assistant: 'Claude' } }));
  assert.match(real, /data-testid="consent-assistant-identity"[^>]*><svg[^>]*data-provider="claude"[\s\S]*?Claude</);
  for (const v of ['ChatGPT', 'Gemini', 'Grok']) {
    const k = { ChatGPT: 'chatgpt', Gemini: 'gemini', Grok: 'grok' }[v];
    assert.match(html(h(ConsentView, { request: { ...REQUEST, verified_assistant: v } })), new RegExp(`consent-assistant-identity[^>]*>(<svg|<span)[^>]*data-provider="${k}"`), v);
  }
  assert.match(read('frontend/src/pages/connect/ConnectAssistantPage.jsx'), /\{request\.verified_assistant \|\| 'Unverified assistant'\}/, 'the identity text is unchanged');
  const grants = [{ id: 'g1', client_name: 'Claude', redirect_host: 'claude.example', companies: [], connected_at: null, last_used_at: null }, { id: 'g2', client_name: 'ChatGPT', redirect_host: 'x.example', companies: [], connected_at: null, last_used_at: null }];
  assert.doesNotMatch(html(h(GrantsList, { grants })), /data-provider=/, 'grant rows show self-declared names: no mark');
});

// ── 9 (part). The GitHub glyph alias is gone from the console ───────────────

test('9. no file imports lucide\'s GitBranch as a GitHub icon; GitHub Sync draws GitHub\'s mark (#1742)', async () => {
  const { srcFilesWith } = await import('./_srcFilesWith.mjs');
  assert.deepEqual(srcFilesWith(/GitBranch as Github/), []);
  // The Admin Console's GitHub Sync entry, which drew the mark, is gone: the
  // owner's ruling (2026-10-20) moved GitHub Sync to HQ's Integration keys
  // page, whose section has a heading and no menu icon.
  const admin = read('frontend/src/pages/AdminPage.jsx');
  assert.doesNotMatch(admin, /value: 'github'/);
  assert.doesNotMatch(admin, /GitBranch/);
  // Drawn the way the menu draws every entry's icon: the mark, its key, the passed size and colour.
  const out = html(h(BrandIcon, { provider: 'github', size: 14, variant: 'bare', tone: 'current', className: 'shrink-0 text-gray-400 dark:text-gray-500' }));
  assert.match(out, /data-provider="github"/);
  assert.match(out, /width="14"/);
  assert.match(out, /text-gray-400 dark:text-gray-500/);
  assert.doesNotMatch(read('frontend/src/pages/account/connectorTools.jsx'), /export const Linkedin|predates the `Linkedin` glyph/, 'the hand-copied LinkedIn glyph and its wrong comment are gone');
});

// ── 10. LinkedIn in the CSV import ──────────────────────────────────────────

test('10. the LinkedIn CSV import draws LinkedIn\'s recorded treatment, through BrandIcon', () => {
  const src = read('frontend/src/pages/account/connectorTools.jsx');
  assert.match(src, /<BrandIcon provider="linkedin" name="LinkedIn" size=\{16\} variant="bare" \/>/);
  // The follow-up records LinkedIn's blue mark, so the import keeps its brand colour.
  const out = html(h(BrandIcon, { provider: 'linkedin', name: 'LinkedIn', size: 16, variant: 'bare' }));
  if (Object.hasOwn(BRAND_MARKS, 'linkedin')) assert.match(out, /--brand:#0A66C2/i);
  else assert.match(out, /data-brand="monogram"[^>]*data-provider="linkedin"[^>]*>L</);
});

test('vendor follow-up: all seven recovered brands draw artwork, including catalogue aliases', () => {
  assert.deepEqual(Object.keys(VENDOR_MARKS).sort(), ['chatgpt', 'google', 'grok', 'linkedin', 'microsoft', 'salesforce', 'slack']);
  for (const provider of [...Object.keys(VENDOR_MARKS), 'google_calendar', 'microsoft_365']) {
    const resolved = resolveBrand(provider);
    const out = html(h(BrandIcon, { provider, name: provider }));
    assert.equal(resolved.kind, 'mark', provider);
    assert.match(out, /data-brand="mark"/, provider);
    assert.doesNotMatch(out, /data-brand="monogram"/, provider);
    assert.match(out, /<(path|rect)\b/, provider);
    assert.doesNotMatch(out, /<script|<image|<foreignObject|<img|https?:\/\//i, provider);
    assert.ok(out.includes(`viewBox="${resolved.mark.viewBox}"`), provider);
  }
});

test('vendor gradients: repeated icons have unique IDs and every reference stays inside its own SVG', () => {
  const out = html(h(React.Fragment, null,
    h(BrandIcon, { provider: 'google' }), h(BrandIcon, { provider: 'google' })));
  const svgs = [...out.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.equal(svgs.length, 2);
  const all = [];
  for (const svg of svgs) {
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const refs = [...svg.matchAll(/(?:url\(#([^)]*)\)|href="#([^"]+)")/g)].map((m) => m[1] || m[2]);
    assert.ok(ids.length > 10 && refs.length > 10, 'exercise the original gradient and clip paths');
    assert.ok(refs.every((id) => ids.includes(id)), 'no reference borrows another icon’s definitions');
    all.push(...ids);
  }
  assert.equal(new Set(all).size, all.length, 'no duplicate IDs across instances');
});

test('vendor palettes: Microsoft and Slack keep their supplied colours in dark tiles', () => {
  for (const [provider, colours] of [
    ['microsoft', ['#f25022', '#00a4ef', '#7fba00', '#ffb900']],
    ['slack', ['#36c5f0', '#2eb67d', '#ecb22e', '#e01e5a']],
  ]) {
    const out = html(h(BrandIcon, { provider }));
    assert.match(out, /dark:bg-white/);
    for (const colour of colours) assert.ok(out.toLowerCase().includes(`fill="${colour}"`), `${provider}: ${colour}`);
  }
});

// ── 10 (step 10). Record a session's Provider chips ─────────────────────────

import { Radios } from '../src/pages/founder/RecordLightbox.jsx';
import PublicFooter from '../src/components/PublicFooter.jsx';
import { codeOnly } from './_codeOnly.mjs';
import ShareButtons from '../src/components/ShareButtons.jsx';

test('step 10. Record a session\'s Provider chips draw the bare 16px mark before the label, real marks only', () => {
  const src = read('frontend/src/pages/founder/RecordLightbox.jsx');
  // Only the Provider group passes an icon; mode, model, thread and consent stay text.
  assert.equal((src.match(/icon: <BrandIcon/g) || []).length, 1, 'one Radios group passes marks');
  assert.match(src, /<Radios label="Provider"[\s\S]*?icon: <BrandIcon provider=\{c\.value\} size=\{16\} variant="bare" fallback="none" \/>/);
  const chips = ['zoom', 'google_meet', 'slack', 'linkedin', 'teams', 'phone_speaker', 'paste'];
  const out = html(h(Radios, { label: 'Provider', value: 'zoom', onChange() {}, testId: 'p',
    options: chips.map((k) => ({ value: k, label: `${k} · Ready`, disabled: k === 'slack',
      icon: h(BrandIcon, { provider: k, size: 16, variant: 'bare', fallback: 'none' }) })) }));
  for (const k of ['zoom', 'google_meet', 'slack', 'linkedin']) {
    assert.match(out, new RegExp(`data-testid="p-${k}"[^>]*>(<span[^>]*>)?<svg[^>]*width="16"[^>]*data-provider="${k}"[\\s\\S]*?<span>${k} · Ready</span></button>`), `${k}: the mark, then its label`);
  }
  for (const k of ['teams', 'phone_speaker', 'paste']) {
    assert.match(out, new RegExp(`data-testid="p-${k}"[^>]*><span>${k} · Ready</span></button>`), `${k}: text only (fallback none)`);
  }
  // A disabled chip dims its mark with it: the mark sits inside the chip that carries disabled:opacity-50.
  const slack = out.match(/<button[^>]*data-testid="p-slack"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(slack, /\sdisabled=""/, 'the slack fixture chip is disabled');
  assert.match(slack, /class="[^"]*disabled:opacity-50/, 'a disabled chip dims');
  assert.match(slack, /<svg[^>]*data-provider="slack"/, 'the dimmed chip holds its mark, so the mark dims with it');
  assert.match(out, /disabled:opacity-50[^"]* inline-flex items-center gap-1\.5/, 'the chip lays its mark out inline');
  // Radios without icons renders exactly as before.
  const plain = html(h(Radios, { label: 'How', value: 'a', onChange() {}, options: [{ value: 'a', label: 'A' }] }));
  assert.doesNotMatch(plain, /inline-flex|<svg|<span>/);
});

// ── 11. One copy of every mark ──────────────────────────────────────────────

test('step 11. the footer, share buttons, author card and Referrals draw BrandIcon\'s marks, each surface in its own colour', () => {
  const footer = html(h(MemoryRouter, null, h(PublicFooter)));
  for (const { key, label } of SOCIAL_LINKS) {
    assert.match(footer, new RegExp(`aria-label="${label}" title="${label}"><svg[^>]*data-provider="${key}"`), `footer: ${label}`);
  }
  assert.doesNotMatch(footer, /lucide-send/, 'Telegram is its own mark, not lucide Send');
  assert.doesNotMatch(footer, /--brand:/, 'the footer stays monochrome (tone="current")');

  const share = html(h(ShareButtons, { url: 'https://axal.vc/a', title: 'A' }));
  for (const [k, label] of [['x', 'Share on X'], ['linkedin', 'Share on LinkedIn'], ['facebook', 'Share on Facebook'], ['whatsapp', 'Share on WhatsApp']]) {
    assert.match(share, new RegExp(`aria-label="${label}" title="${label}"[^>]*><svg[^>]*data-provider="${k}"`), label);
  }
  assert.doesNotMatch(share, /--brand:/);

  for (const { key, Icon } of SOCIALS.filter((s) => s.key !== 'website')) {
    assert.match(html(h(Icon, { size: 14 })), new RegExp(`width="14"[^>]*data-provider="${canon(key)}"`), `AuthorCard: ${key}`);
  }

  const referrals = read('frontend/src/pages/ReferralsPage.jsx');
  for (const k of ['linkedin', 'x', 'whatsapp', 'facebook', 'telegram']) {
    assert.match(referrals, new RegExp(`icon: <BrandIcon provider="${k}" size=\\{16\\} variant="bare" tone="current" \\/>`), `Referrals: ${k}`);
  }
  assert.doesNotMatch(codeOnly(referrals), /𝕏|>WA<|>TG</, 'the text stand-ins screen readers read aloud are gone');
  assert.match(referrals, /<BrandIcon provider="linkedin" size=\{14\} variant="bare" tone="current" \/> Import from LinkedIn/);

  const wrappers = [
    ['frontend/src/pages/ArticleReaderPage.jsx', ['x', 'linkedin', 'facebook']],
    ['frontend/src/pages/PublicProfilePage.jsx', ['linkedin', 'x', 'github']],
    ['frontend/src/pages/admin/AdminTeam.jsx', ['linkedin', 'x']],
    ['frontend/src/pages/AdvisoryPage.jsx', ['linkedin']],
    ['frontend/src/pages/jobs/JobManagePage.jsx', ['linkedin']],
    ['frontend/src/components/CompanyProfilePanel.jsx', ['linkedin']],
  ];
  for (const [file, keys] of wrappers) {
    const src = read(file);
    for (const k of keys) assert.match(src, new RegExp(`<BrandIcon provider="${k}" size=\\{(size|16)\\} variant="bare" tone="current"`), `${file}: ${k}`);
    assert.doesNotMatch(src, /<svg[^>]*viewBox="0 0 24 24"[^>]*fill="currentColor"/, `${file} still hand-draws a mark`);
    assert.doesNotMatch(src, /predates the `Linkedin` glyph|inline minimal SVGs instead/, `${file}: the stale lucide comment`);
  }
});

test('9. one copy of every mark: each BRAND_MARKS path lives only in ui/BrandIcon.jsx, and no old copy survives', async () => {
  const { srcFilesWith } = await import('./_srcFilesWith.mjs');
  const firstPath = (m) => m.path || m.paths?.[0]?.d || (function walk(nodes) {
    for (const n of nodes || []) { if (n.attrs?.d) return n.attrs.d; const d = walk(n.children); if (d) return d; }
    return null;
  })(m.artwork);
  const firstFill = (nodes) => { for (const n of nodes || []) { if (n.attrs?.fill?.startsWith('#')) return n.attrs.fill; const f = firstFill(n.children); if (f) return f; } return null; };
  for (const [k, m] of Object.entries(BRAND_MARKS)) {
    // A mark drawn only from shapes (Microsoft's four squares) has no path; its first fill is its fingerprint.
    const print = firstPath(m)?.slice(0, 16) || firstFill(m.artwork);
    assert.ok(print, `${k} has a path or a coloured shape`);
    assert.deepEqual(srcFilesWith(new RegExp(print.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')), ['frontend/src/ui/BrandIcon.jsx'], `${k}'s mark is copied outside BrandIcon.jsx`);
  }
  for (const old of ['M20.447 20.452', 'M4.98 3.5', 'M16 8a6 6', 'M18.244 2.25', 'M18.244 2H21', 'M24 12.073', 'M14 9V6.8', 'M12 2.163c3.204', 'M12 .5C5.73', 'M16.6 5.82']) {
    assert.deepEqual(srcFilesWith(old), [], `an old copy (${old}) survives`);
  }
  // The sign-in G is the one exemption: Google's own Sign in with Google G is
  // not recorded yet (D687's open row, #1008 item 22), and a monogram must
  // never sit on a Continue with Google button, so the three buttons keep it.
  assert.deepEqual(srcFilesWith('#FFC107'), ['frontend/src/pages/LoginPage.jsx', 'frontend/src/pages/RegisterPage.jsx', 'frontend/src/pages/SettingsPage.jsx']);
});
