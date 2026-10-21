/**
 * D753 (#1875) — the connector pages' data, held to the code.
 *
 *   1. every registry row, LinkedIn, each Mercury variant and each interview
 *      channel (C1) has a page;
 *   2. every tool's `calls` fragment is in its connector's source;
 *   3. every request that writes is named by a tool, and a tool's access
 *      matches the requests it names;
 *   4. "read-only" in a page's words means no write tool;
 *   5. prompts only for a connector Eadwyn reads, proposing only its targets;
 *   6. the trust sentence follows the tools, and nothing can move money;
 *   7. `verified` is a recorded check;
 *   8. shapes: added, links, taglines, makers, modules;
 *   9. endpoints equal the providers' own constants;
 *  10. sign-in kinds;
 *  11. the category order;
 *  12. `pageDescriptor` by viewer, in either import order;
 *  13. `connectorPagePath`;
 *  14. GitHub's revoke wording follows its `registerProvider`;
 *  15. the module imports no provider and fetches nothing.
 *
 * It reads source files as text and calls only pure functions. `fetch`
 * throws, so no provider is ever called.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/connector_pages_d753.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

globalThis.fetch = (() => { throw new Error('connector_pages_d753: no provider may be called'); }) as typeof fetch;

// The order index.ts uses: the registry first.
const registry = await import('../src/integrations/registry.ts');
const pages = await import('../src/integrations/connectorPages.ts');
const { REGISTRY, CONNECTOR_METADATA, getDescriptor } = registry;
const { CONNECTOR_PAGES, FIRST_PARTY_PAGES, CHANNEL_PAGES, CATEGORY_ORDER, PAGE_ALIAS, MONEY_MOVERS, trustFor, pageDescriptor, connectorPagePath, channelPage } = pages;
const { CONNECTOR_READERS } = await import('../src/services/eadwynReaders.ts');
const { SEND_TARGETS, CONNECTOR_KEY_RE } = await import('../src/services/eadwynConnectors.ts');
const { MODULE_LABELS } = await import('../src/integrations/moduleLabels.ts');

const SRC = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const FRONT = (path: string) => readFileSync(new URL(`../../frontend/src/${path}`, import.meta.url), 'utf8');

/** Comments blanked, line numbers kept; a `//` after a colon or a quote (a URL) is code. */
const strip = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** The source with every string literal's contents removed (quotes kept), for checks on code alone. */
function codeOnly(src: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) { quote = null; out += ch; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    out += ch;
  }
  return out;
}

// ── The entries ───────────────────────────────────────────────────────────────

type Page = typeof FIRST_PARTY_PAGES.linkedin;
interface Entry { id: string; key: string; variant?: string; page: Page }

const ENTRIES: Entry[] = [];
for (const [key, entry] of Object.entries(CONNECTOR_PAGES)) {
  if ('entity' in entry) {
    ENTRIES.push({ id: `${key}.entity`, key, variant: 'entity', page: entry.entity });
    for (const [role, page] of Object.entries(entry.personal)) ENTRIES.push({ id: `${key}.personal.${role}`, key, variant: role, page });
  } else {
    ENTRIES.push({ id: key, key, page: entry });
  }
}
ENTRIES.push({ id: 'linkedin', key: 'linkedin', page: FIRST_PARTY_PAGES.linkedin });
for (const [key, page] of Object.entries(CHANNEL_PAGES)) ENTRIES.push({ id: key, key, page });

/** Pages with no registry row: LinkedIn and the channels. */
const CHANNELS = new Set(Object.keys(CHANNEL_PAGES));
const NOT_ROWS = new Set(['linkedin', ...CHANNELS]);

/** Each connector's own files. `services/notify.ts` holds Slack's one write but also sends mail, so it is not scanned for coverage. */
const SOURCES: Record<string, string[]> = {
  github: ['integrations/providers/github.ts', 'integrations/providers/github/roadmap.ts', 'integrations/providers/github/solutionDesign.ts', 'integrations/providers/github/team.ts', 'integrations/providers/github/company.ts', 'integrations/providers/github/mvp.ts'],
  // D840: a member's sign-in reads through the MCP client and its typed reads, and signs in through `oauth.ts`.
  mercury: ['services/mercury/client.ts', 'services/mercury/mcp.ts', 'services/mercury/reads.ts', 'services/mercury/oauth.ts'],
  slack: ['integrations/providers/slack.ts', 'services/notify.ts'],
  zoom: ['services/channels/zoom.ts'],
  google_calendar: ['services/calendar.ts', 'services/channels/googleMeet.ts'],
  microsoft_365: ['services/calendar.ts'],
  linkedin: ['routes/linkedin.ts'],
  hubspot: ['integrations/providers/hubspot.ts'],
  calendly: ['integrations/providers/calendly.ts'],
  salesforce: ['integrations/providers/salesforce.ts'],
  carta: ['integrations/providers/carta.ts'],
  docusign: ['integrations/providers/docusign.ts'],
  stripe: ['integrations/providers/stripe.ts'],
  crunchbase: ['integrations/providers/crunchbase.ts'],
  whatsapp: ['services/channels/whatsapp.ts', 'services/channels/outbound.ts'],
  telegram: ['services/channels/telegram.ts', 'services/channels/outbound.ts'],
};
const NOT_SCANNED = new Set(['services/notify.ts']);
const TEXT = new Map<string, string[]>();
const linesOf = (file: string) => {
  if (!TEXT.has(file)) TEXT.set(file, strip(SRC(file)).split('\n'));
  return TEXT.get(file)!;
};

/** The sign-in's own token exchange and refresh: not tools (D753 decision 3). */
const TOKEN_EXCHANGE = ['/oauth/token', '/oauth/v1/token', '/o/token/', '/services/oauth2/token', 'login/oauth/access_token', 'oauth.v2.access', 'GOOGLE_TOKEN_URL', 'msToken(', 'LINKEDIN_TOKEN_URL', 'server.token_endpoint'];
/** A read that is a POST. */
const READ_BY_POST: Record<string, string[]> = { hubspot: ["'/crm/v3/objects/deals/search'"], crunchbase: ["'/searches/organizations'"], mercury: ["jsonrpc: '2.0'"] };
/** Connection plumbing: a revoke, a deauthorize, a webhook subscription or listener, a signing key. */
const ACCOUNT_CALLS: Record<string, string[]> = {
  github: ['/grant`'],
  mercury: ['server.registration_endpoint', 'server.revocation_endpoint'],
  hubspot: ['/oauth/v1/refresh-tokens/'],
  calendly: ['/webhook_subscriptions', "fetch(uri, { method: 'DELETE'"],
  salesforce: ['/services/oauth2/revoke'],
  carta: ['/o/revoke_token/'],
  docusign: ["'/connect'", '/hmac`', '`/connect/${encodeURIComponent(connectId)}`', '/oauth/revoke`'],
  stripe: ['/oauth/deauthorize'],
  zoom: ['/oauth/revoke`'],
  whatsapp: ['/subscribed_apps`'],
};

interface Request { file: string; line: number; window: string }
const WRITE_METHOD = /method:\s*([^,}\n]*)/;
function requestsIn(file: string): Request[] {
  const lines = linesOf(file);
  const out: Request[] = [];
  lines.forEach((text, i) => {
    const m = WRITE_METHOD.exec(text);
    if (!m || !/['"](POST|PUT|PATCH|DELETE)['"]/.test(m[1])) return;
    out.push({ file, line: i + 1, window: lines.slice(Math.max(0, i - 4), i + 1).join('\n') });
  });
  return out;
}
const isTokenExchange = (r: Request) => TOKEN_EXCHANGE.some((f) => r.window.includes(f));
const sourcesOf = (e: Entry) => SOURCES[e.key] ?? (e.page.tools.length ? [`integrations/providers/${e.key}.ts`] : []);

test('1. every registry row, LinkedIn and each Mercury variant has a page, and nothing else does', () => {
  const keys = Object.keys(CONNECTOR_PAGES).sort();
  assert.deepEqual(keys, REGISTRY.map((r) => r.key).sort());
  assert.ok(FIRST_PARTY_PAGES.linkedin, 'LinkedIn has no page');
  assert.equal(getDescriptor('linkedin'), null, 'LinkedIn must not be a registry row');
  assert.deepEqual(Object.keys(CHANNEL_PAGES).sort(), ['telegram', 'whatsapp']);
  for (const key of CHANNELS) assert.equal(getDescriptor(key), null, `${key} must not be a registry row`);
  // The channel keys are the ones GET /api/channels reports.
  const providers = /export const MESSAGING_PROVIDERS = \[([^\]]+)\]/.exec(FRONT('pages/account/channelsModel.js'));
  assert.ok(providers, 'channelsModel.js has no MESSAGING_PROVIDERS');
  assert.deepEqual([...providers![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort(), [...CHANNELS].sort(), 'the channel pages are not the messaging providers');
  for (const row of REGISTRY) {
    const entry = CONNECTOR_PAGES[row.key];
    if (!row.entity_roles && !row.personal_roles) {
      assert.equal('entity' in entry, false, `${row.key} has variants with no audience fields`);
      continue;
    }
    assert.ok('entity' in entry, `${row.key} has audience fields but no variants`);
    if (row.entity_roles?.length) assert.ok(entry.entity, `${row.key} has no entity page`);
    assert.deepEqual(Object.keys(entry.personal).sort(), [...(row.personal_roles ?? [])].sort(), `${row.key}: a personal variant per role in personal_roles`);
  }
  const front = FRONT('pages/account/connectorsModel.js');
  const alias = /REGISTRY_ALIAS = Object\.freeze\(\{([^}]+)\}\)/.exec(front)![1];
  const pairs = Object.fromEntries([...alias.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[2], m[1]]));
  assert.deepEqual({ ...PAGE_ALIAS }, pairs, 'PAGE_ALIAS is not the inverse of REGISTRY_ALIAS');
});

test('2. every tool fragment is in its connector\'s source, and tool names are unique snake_case', () => {
  for (const e of ENTRIES) {
    const texts = sourcesOf(e).map((f) => linesOf(f).join('\n'));
    const names = new Set<string>();
    for (const t of e.page.tools) {
      assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${e.id}: ${t.name}`);
      assert.equal(names.has(t.name), false, `${e.id}: ${t.name} twice`);
      names.add(t.name);
      assert.ok(t.calls.length > 0, `${e.id}.${t.name} names no call`);
      for (const f of t.calls) assert.ok(texts.some((s) => s.includes(f)), `${e.id}.${t.name}: "${f}" is not in ${sourcesOf(e).join(', ')}`);
    }
  }
});

test('3. every request that writes is named by a tool, and each tool\'s access matches what it names', () => {
  const byFile = new Map<string, Entry[]>();
  for (const e of ENTRIES) for (const f of sourcesOf(e)) byFile.set(f, [...(byFile.get(f) ?? []), e]);
  for (const [file, entries] of byFile) {
    if (NOT_SCANNED.has(file)) continue;
    for (const r of requestsIn(file)) {
      if (isTokenExchange(r)) continue;
      const named = entries.some((e) => e.page.tools.some((t) => t.calls.some((f) => r.window.includes(f))));
      assert.ok(named, `${file}:${r.line} writes, and no tool names it`);
    }
  }
  for (const e of ENTRIES) {
    for (const t of e.page.tools) {
      const reqs = sourcesOf(e).flatMap((f) => requestsIn(f))
        .filter((r) => !isTokenExchange(r) && t.calls.some((f) => r.window.includes(f)));
      if (t.access === 'write') assert.ok(reqs.length > 0, `${e.id}.${t.name} is a write tool but names no request that writes`);
      if (t.access === 'read') {
        for (const r of reqs) assert.ok((READ_BY_POST[e.key] ?? []).some((f) => r.window.includes(f)), `${e.id}.${t.name} reads, but names ${r.file}:${r.line}, which writes`);
      }
      if (t.access === 'account') {
        for (const r of reqs) assert.ok((ACCOUNT_CALLS[e.key] ?? []).some((f) => r.window.includes(f)), `${e.id}.${t.name} names ${r.file}:${r.line}, which is not connection plumbing`);
      }
      if (t.access === 'inbound') assert.deepEqual(reqs, [], `${e.id}.${t.name} is inbound but names an outbound write`);
    }
  }
  const writes = (id: string) => ENTRIES.filter((e) => e.id === id || e.key === id).some((e) => e.page.tools.some((t) => t.access === 'write'));
  for (const id of ['github', 'mercury', 'stripe', 'carta', 'crunchbase', 'calendly', 'linkedin']) assert.equal(writes(id), false, `${id} has a write tool`);
  for (const id of ['hubspot', 'salesforce', 'docusign', 'zoom', 'google_calendar', 'microsoft_365', 'slack', 'whatsapp', 'telegram']) assert.equal(writes(id), true, `${id} has no write tool`);
});

test('4. read_only is "no write tool", and a page that says read-only is read-only', () => {
  for (const e of ENTRIES) {
    const trust = trustFor(e.key, e.variant)!;
    assert.equal(trust.read_only, !e.page.tools.some((t) => t.access === 'write'), e.id);
    const words = [e.page.tagline, ...e.page.long_description].join(' ');
    if (/read-only/i.test(words)) assert.equal(trust.read_only, true, `${e.id} says read-only but writes`);
  }
});

test('5. prompts only for a connector Eadwyn reads and that is not coming soon; proposals only to its own targets', () => {
  for (const e of ENTRIES) {
    const p = e.page;
    assert.equal(p.prompts_reason === null, p.prompts.length > 0, `${e.id}: prompts_reason is null exactly when there are prompts`);
    if (p.prompts.length) {
      assert.ok(Object.hasOwn(CONNECTOR_READERS, e.key), `${e.id} has prompts, but Eadwyn has no reader for it`);
      assert.notEqual(getDescriptor(e.key)?.status, 'coming_soon', `${e.id} is coming soon but has prompts`);
    }
    const fields = (SEND_TARGETS[e.key] ?? []).map((t) => t.field);
    for (const q of p.prompts) {
      assert.ok(q.proposes === null || fields.includes(q.proposes), `${e.id}.${q.name} proposes ${q.proposes}`);
      assert.doesNotMatch(q.ask, /advi[cs]e|recommend|fiduciar/i, `${e.id}.${q.name}`);
    }
  }
  assert.deepEqual(ENTRIES.filter((e) => e.page.prompts.length).map((e) => e.id).sort(), ['github', 'hubspot', 'stripe']);
});

const MONEY_PATHS = [/\/v1\/(payouts|transfers|refunds|payment_intents|charges)/, /send-money/, /request-send-money/, /\/transfer\b/];

test('6. the trust sentence follows the tools, and no connector can move money', () => {
  for (const e of ENTRIES) {
    const t = trustFor(e.key, e.variant)!;
    const comingSoon = getDescriptor(e.key)?.status === 'coming_soon';
    if (comingSoon && e.page.tools.length === 0) assert.match(t.sentence, /^Axal VC has not built this connector yet, so it reads and writes nothing\./, e.id);
    else assert.ok(t.sentence.startsWith(comingSoon ? 'New connections are paused. Axal VC built and runs this connector.' : 'Axal VC built and runs this connector.'), e.id);
    if (/never writes/.test(t.sentence)) assert.equal(t.read_only, true, `${e.id} says never writes`);
    if (!t.read_only) assert.doesNotMatch(t.sentence, /never writes/, e.id);
    if (t.sentence.includes('Nothing it does can move money.')) assert.equal(t.moves_money, false, e.id);
    assert.equal(t.moves_money, MONEY_MOVERS.has(e.key), e.id);
    assert.equal(t.sentence.includes('Nothing it does can move money.'), !t.moves_money, `${e.id}: the money sentence follows moves_money`);
    for (const label of t.reads) assert.ok(t.sentence.includes(label), `${e.id}: "${label}" is not in the sentence`);
    assert.equal(t.built_by, 'Axal VC');
  }
  assert.equal(MONEY_MOVERS.size, 0, 'a connector can move money');
  for (const file of new Set(Object.values(SOURCES).flat())) {
    for (const r of requestsIn(file)) for (const re of MONEY_PATHS) assert.doesNotMatch(r.window, re, `${file}:${r.line} writes to a money path`);
  }
});

test('7. verified means a recorded check, and no check is recorded yet', () => {
  for (const e of ENTRIES) {
    assert.ok(e.page.verified_on === null || /^\d{4}-\d{2}-\d{2}$/.test(e.page.verified_on), e.id);
    if (NOT_ROWS.has(e.key)) continue;
    assert.equal(CONNECTOR_METADATA[e.key].verified, e.page.verified_on !== null, `${e.id}: verified without a recorded date, or the reverse`);
  }
  for (const k of ['hubspot', 'calendly', 'slack', 'stripe', 'google_calendar', 'microsoft_365']) assert.equal(CONNECTOR_METADATA[k].verified, false, k);
  assert.ok(CONNECTOR_METADATA.google_calendar.permissions.includes('Gmail (read-only) is asked for at sign-in; Axal VC does not read your Gmail.'));
  assert.equal(CONNECTOR_METADATA.google_calendar.permissions.some((p) => /Read Gmail messages/.test(p)), false);
});

const ADDED: Record<string, string | null> = {
  hubspot: '2026-05', calendly: '2026-05', slack: '2026-05', stripe: '2026-05', linkedin: '2026-05',
  carta: '2026-09', docusign: '2026-09', crunchbase: '2026-09',
  github: '2026-10', zoom: '2026-10', google_calendar: '2026-10', microsoft_365: '2026-10', mercury: '2026-10',
  figma: null, salesforce: null, affinity: null,
  // D754 and D756 switch them on; until then nothing connects on production.
  whatsapp: null, telegram: null,
};
const HTTPS = (v: string | null) => v === null || v.startsWith('https://');

test('8. shapes: added, links, taglines, makers, modules', () => {
  for (const e of ENTRIES) {
    const p = e.page;
    assert.ok(p.added === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(p.added), `${e.id}: added ${p.added}`);
    assert.equal(p.added, ADDED[e.key], `${e.id}: added`);
    for (const [k, v] of Object.entries(p.links)) assert.ok(HTTPS(v), `${e.id}: links.${k}`);
    assert.ok(HTTPS(p.service.href), `${e.id}: service.href`);
    assert.ok(HTTPS(p.sign_in.key_help_href), `${e.id}: key_help_href`);
    assert.equal(p.links.help, null, `${e.id}: help is filled by a docs task`);
    if (!NOT_ROWS.has(e.key)) assert.equal(p.links.developer_docs, getDescriptor(e.key)!.docs_url, `${e.id}: developer_docs`);
    assert.equal(p.sign_in.key_help_href !== null, ['key', 'oauth_or_key'].includes(p.sign_in.kind), `${e.id}: key_help_href`);
    assert.ok(p.tagline.length >= 1 && p.tagline.length <= 120, `${e.id}: tagline is ${p.tagline.length} characters`);
    assert.ok(p.long_description.length >= 1 && p.long_description.length <= 4, `${e.id}: long_description`);
    assert.equal(p.made_by.name, 'Axal VC', e.id);
    assert.equal(/Coming soon\.$/.test(p.tagline), getDescriptor(e.key)?.status === 'coming_soon', `${e.id}: the tagline says coming soon exactly when the row is`);
    for (const t of p.tools) assert.ok(t.lands_in === null || Object.hasOwn(MODULE_LABELS, t.lands_in), `${e.id}.${t.name}: lands_in ${t.lands_in}`);
  }
});

/** A provider constant's string value, by name: `const NAME = '…'`. */
const constant = (src: string, name: string) => {
  const head = `const ${name} = '`;
  const at = src.indexOf(head);
  assert.ok(at >= 0, `no constant ${name}`);
  const start = at + head.length;
  return src.slice(start, src.indexOf("'", start));
};
const ENDPOINTS: Record<string, { file: string; sign_in: [string, string] | null; api: string | null }> = {
  hubspot: { file: 'integrations/providers/hubspot.ts', sign_in: ['HS_AUTH', '/oauth/authorize'], api: 'HS_API' },
  calendly: { file: 'integrations/providers/calendly.ts', sign_in: ['CL_AUTH', '/oauth/authorize'], api: 'CL_API' },
  salesforce: { file: 'integrations/providers/salesforce.ts', sign_in: ['PROD_HOST', '/services/oauth2/authorize'], api: null },
  carta: { file: 'integrations/providers/carta.ts', sign_in: ['AUTH_HOST', '/o/authorize/'], api: 'API_BASE' },
  slack: { file: 'integrations/providers/slack.ts', sign_in: ['AUTH_HOST', '/oauth/v2/authorize'], api: null },
  docusign: { file: 'integrations/providers/docusign.ts', sign_in: ['PROD_AUTH_HOST', '/oauth/auth'], api: null },
  crunchbase: { file: 'integrations/providers/crunchbase.ts', sign_in: null, api: 'CB_BASE' },
  stripe: { file: 'integrations/providers/stripe.ts', sign_in: ['STRIPE_CONNECT', '/oauth/authorize'], api: 'STRIPE_API' },
  github: { file: 'integrations/providers/github.ts', sign_in: null, api: 'API' },
  zoom: { file: 'services/channels/zoom.ts', sign_in: ['ZOOM_AUTH', '/oauth/authorize'], api: 'ZOOM_API' },
  google_calendar: { file: 'services/calendar.ts', sign_in: ['GOOGLE_AUTH_URL', ''], api: 'GOOGLE_CALENDAR_API' },
  microsoft_365: { file: 'services/calendar.ts', sign_in: ['MICROSOFT_AUTHORITY', '/common/oauth2/v2.0/authorize'], api: 'MICROSOFT_GRAPH' },
  mercury: { file: 'services/mercury/client.ts', sign_in: null, api: 'MERCURY_API_BASE' },
  // D840: a member's page names the MCP server their sign-in reads through.
  mercury_personal: { file: 'services/mercury/mcp.ts', sign_in: ['MERCURY_MCP_URL', ''], api: null },
  linkedin: { file: 'routes/linkedin.ts', sign_in: ['LINKEDIN_AUTHORIZE_URL', ''], api: 'LINKEDIN_USERINFO_URL' },
  // Both sign in inside the provider's own app (Meta's popup, the bot link), so neither has a sign-in URL.
  whatsapp: { file: 'services/channels/whatsapp.ts', sign_in: null, api: 'GRAPH_BASE' },
  telegram: { file: 'services/channels/telegram.ts', sign_in: null, api: 'TELEGRAM_API' },
};

test('9. endpoints equal the providers\' own constants', () => {
  for (const e of ENTRIES) {
    const spec = ENDPOINTS[e.key];
    if (e.key === 'mercury' && e.variant !== 'entity') {
      const mcp = ENDPOINTS.mercury_personal;
      assert.equal(e.page.endpoints.sign_in, constant(SRC(mcp.file), mcp.sign_in![0]), `${e.id}: sign_in`);
      assert.equal(e.page.endpoints.api, constant(SRC(spec.file), spec.api!), `${e.id}: api`);
      continue;
    }
    if (!spec) {
      assert.deepEqual(e.page.endpoints, { sign_in: null, api: null }, `${e.id} has no implementation, so no endpoints`);
      continue;
    }
    const src = SRC(spec.file);
    if (e.key === 'whatsapp') {
      // GRAPH_BASE is a template on GRAPH_VERSION.
      assert.ok(src.includes('export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;'), 'WhatsApp\'s Graph base');
      assert.equal(e.page.endpoints.api, `https://graph.facebook.com/${constant(src, 'GRAPH_VERSION')}`, `${e.id}: api`);
      assert.equal(e.page.endpoints.sign_in, null, `${e.id}: sign_in`);
      continue;
    }
    if (e.key === 'github') {
      assert.ok(src.includes(`${e.page.endpoints.sign_in}?`), 'GitHub\'s authorize literal');
    } else if (spec.sign_in) {
      const [name, path] = spec.sign_in;
      assert.equal(e.page.endpoints.sign_in, constant(src, name) + path, `${e.id}: sign_in`);
      if (path) assert.ok(src.includes(path.replace('/common', '')), `${e.id}: the source builds ${path}`);
    } else {
      assert.equal(e.page.endpoints.sign_in, null, `${e.id}: sign_in`);
    }
    assert.equal(e.page.endpoints.api, spec.api ? constant(src, spec.api) : null, `${e.id}: api`);
  }
  assert.match(SRC('services/calendar.ts'), /\|\| 'common'/, 'Microsoft\'s default tenant');
});

test('10. sign-in kinds', () => {
  for (const e of ENTRIES) {
    const row = getDescriptor(e.key);
    const kind = e.page.sign_in.kind;
    if (e.variant === 'entity') assert.equal(kind, 'entity', e.id);
    else if (CHANNELS.has(e.key)) assert.equal(kind, 'channel', e.id);
    else if (['google_calendar', 'microsoft_365', 'linkedin'].includes(e.key)) assert.equal(kind, 'first_party', e.id);
    // D840: a member signs in with Mercury or pastes a Read Only token.
    else if (e.key === 'mercury') assert.equal(kind, 'oauth_or_key', e.id);
    else if (row!.auth_type === 'api_key') assert.equal(kind, 'key', e.id);
    else if (row!.supports_pat) assert.equal(kind, 'oauth_or_key', e.id);
    else assert.equal(kind, 'oauth', e.id);
    assert.ok(e.page.sign_in.label.length > 0, e.id);
  }
});

test('11. CATEGORY_ORDER holds every category once, with the Connectors page\'s list as its prefix', () => {
  const union = /export type ConnectorCategory = ([^;]+);/.exec(SRC('integrations/registry.ts'))![1];
  const members = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...CATEGORY_ORDER].sort(), [...members].sort());
  assert.equal(new Set(CATEGORY_ORDER).size, CATEGORY_ORDER.length);
  for (const m of Object.values(CONNECTOR_METADATA)) assert.ok(CATEGORY_ORDER.includes(m.category), m.category);
  const front = /export const CATEGORY_ORDER = \[([^\]]+)\]/.exec(FRONT('pages/account/connectorsModel.js'))![1];
  const list = [...front.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(CATEGORY_ORDER.slice(0, list.length), list);
});

test('12. pageDescriptor picks Mercury\'s variant by viewer, and works in either import order', async () => {
  const mercury = getDescriptor('mercury')!;
  const v = (role: string, hq: boolean) => ({ role, hq });
  assert.equal(pageDescriptor(mercury, v('admin', true))!.tagline, (CONNECTOR_PAGES.mercury as any).entity.tagline);
  assert.equal(pageDescriptor(mercury, v('founder', true))!.tagline, (CONNECTOR_PAGES.mercury as any).personal.founder.tagline);
  assert.equal(pageDescriptor(mercury, v('partner', false))!.tagline, (CONNECTOR_PAGES.mercury as any).personal.partner.tagline);
  // D752: an investor reads their own page on HQ, and none on a branch.
  assert.equal(pageDescriptor(mercury, v('investor', true))!.tagline, (CONNECTOR_PAGES.mercury as any).personal.investor.tagline);
  for (const viewer of [v('admin', false), v('investor', false), v('advisor', true)]) assert.equal(pageDescriptor(mercury, viewer), null, JSON.stringify(viewer));
  const gh = pageDescriptor(getDescriptor('github')!, v('investor', false))!;
  assert.equal(gh.key, 'github');
  assert.equal(gh.page_href, '/account/connectors/github');
  assert.equal(gh.page_key, 'github');
  assert.match(gh.trust.sentence, /^Axal VC built and runs this connector\./);
  assert.equal('has_implementation' in gh, false, 'pageDescriptor merged publicDescriptor');
  assert.equal(pageDescriptor(getDescriptor('google_calendar')!)!.page_key, 'google');
  assert.equal(pageDescriptor({ key: 'linkedin' })!.tagline, FIRST_PARTY_PAGES.linkedin.tagline);
  assert.equal(pageDescriptor({ key: 'notion' }), null);
  for (const key of CHANNELS) {
    const d = channelPage(key)!;
    assert.equal(d.tagline, (CHANNEL_PAGES as any)[key].tagline, key);
    assert.equal(d.page_href, `/account/connectors/${key}`, key);
    assert.equal(d.trust.read_only, false, `${key} sends messages`);
    assert.deepEqual(pageDescriptor({ key }), d, key);
  }
  for (const bad of ['github', 'linkedin', 'signal', '', 'hasOwnProperty']) assert.equal(channelPage(bad), null, bad);
  // The channel page draws these words itself until #1878 serves them: held equal here.
  const front = await import('../../frontend/src/pages/account/channelPageModel.js');
  assert.deepEqual([...front.CHANNEL_PAGE_KEYS].sort(), [...CHANNELS].sort());
  for (const key of CHANNELS) {
    const page = (CHANNEL_PAGES as any)[key];
    const text = front.CHANNEL_PAGE_TEXT[key];
    assert.equal(text.tagline, page.tagline, `${key}: the frontend tagline`);
    assert.deepEqual([...text.about], page.long_description, `${key}: the frontend About`);
    assert.equal(text.signIn, page.sign_in.label, `${key}: the frontend sign-in`);
    assert.equal(text.docs, page.links.developer_docs, `${key}: the frontend documentation link`);
  }

  // The other order: connectorPages first, in a fresh process.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const script = "const p = await import('./cloudflare-worker/src/integrations/connectorPages.ts');"
    + "const r = await import('./cloudflare-worker/src/integrations/registry.ts');"
    + "const d = p.pageDescriptor(r.getDescriptor('mercury'), { role: 'admin', hq: true });"
    + "process.stdout.write(d && d.sign_in.kind);";
  const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs', '--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(out, 'entity');
});

test('13. connectorPagePath', () => {
  assert.equal(connectorPagePath('github'), '/account/connectors/github');
  assert.equal(connectorPagePath('google_calendar'), '/account/connectors/google');
  assert.equal(connectorPagePath('google'), '/account/connectors/google');
  assert.equal(connectorPagePath('microsoft_365'), '/account/connectors/microsoft');
  assert.equal(connectorPagePath('linkedin'), '/account/connectors/linkedin');
  assert.equal(connectorPagePath('whatsapp'), '/account/connectors/whatsapp');
  assert.equal(connectorPagePath('telegram'), '/account/connectors/telegram');
  for (const bad of ['', '../x', 'Github', 'a/b', 'notion']) assert.equal(connectorPagePath(bad), '/account/connectors', bad);
  const re = /const PAGE_KEY_RE = \/(.+)\/;/.exec(SRC('integrations/connectorPages.ts'))![1];
  assert.equal(re, CONNECTOR_KEY_RE.source);
});

test('14. GitHub\'s revoke wording follows its registerProvider', () => {
  const src = strip(SRC('integrations/providers/github.ts'));
  const block = src.slice(src.indexOf('registerProvider({'), src.indexOf('});', src.indexOf('registerProvider({')));
  const revoke = (CONNECTOR_PAGES.github as Page).tools.find((t) => t.name === 'revoke_grant')!;
  assert.equal(/disconnect/.test(revoke.what), /\bdisconnect\b/.test(block), 'revoke_grant.what and GitHub\'s disconnect disagree');
});

test('15. the module imports only ./registry and fetches nothing', () => {
  const src = SRC('integrations/connectorPages.ts');
  const from = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(from)], ['./registry']);
  // The `calls` fragments are strings that quote `fetch(`; code outside a string may not call it.
  assert.equal(/\bfetch\(/.test(codeOnly(strip(src))), false, 'connectorPages.ts calls fetch');
  // One re-export line, last in registry.ts, naming every export of this module.
  const reg = SRC('integrations/registry.ts');
  const line = /\nexport \{([^}]+)\} from '\.\/connectorPages';\n$/.exec(reg);
  assert.ok(line, 'registry.ts does not end with its connectorPages re-export');
  const named = line![1].split(',').map((n) => n.trim().replace(/^type\s+/, '')).sort();
  const exported = [...src.matchAll(/^export (?:const|function|type|interface) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(named, exported, 'registry.ts re-exports a different list than connectorPages.ts exports');
});
