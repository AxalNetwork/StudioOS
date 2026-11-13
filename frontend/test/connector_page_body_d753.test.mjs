/**
 * D753 (#1955, F7) — a connector's page body, drawn from the Worker's
 * description of it: About, Tools, Prompts, the trust notice and Details
 * (D753 decision 3, items 5 to 10), the header's tagline, the catalogue's new
 * page fields, and the page's own read of it (part 2, through a stubbed
 * `readPage`). No test calls the network.
 *
 * The fixtures are W1's own descriptors for GitHub, HubSpot and Figma
 * (`pageDescriptor` in `cloudflare-worker/src/integrations/connectorPages.ts`
 * merged with `CONNECTOR_METADATA`, as `GET /api/connectors/directory/:key`
 * will send them), copied here with the internal `calls` removed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_page_body_d753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { ConnectorBody, ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import {
  DETAIL_MISSING, addedLabel, bodyDetailsRows, headerTagline, safeHref, toolGroups,
} from '../src/pages/account/connectorPageModel.js';
import { FIRST_PARTY, buildCatalogue } from '../src/pages/account/connectorsModel.js';

const h = React.createElement;
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const clone = (x) => JSON.parse(JSON.stringify(x));

const FX = {
  "github": {
    "display_name": "GitHub",
    "status": "beta",
    "tier": "free",
    "capabilities": [
      "Read issues",
      "Read pull requests",
      "Read releases",
      "Choose repositories"
    ],
    "category": "Code",
    "verified": false,
    "pulls": [
      {
        "what": "Issues",
        "module": "product_roadmap"
      },
      {
        "what": "Pull requests",
        "module": "prototype_mvp"
      },
      {
        "what": "Releases",
        "module": "product_roadmap"
      }
    ],
    "sends": [],
    "feeds": [
      "product_roadmap",
      "prototype_mvp"
    ],
    "permissions": [
      "Read issues in the repositories you choose.",
      "Read pull requests in the repositories you choose.",
      "Read releases in the repositories you choose.",
      "Read repository names and visibility."
    ],
    "tagline": "Issues, pull requests and releases from the repositories you choose. Read-only.",
    "long_description": [
      "Read issues, pull requests and releases from the repositories you choose. Issues link to Product roadmap items and pull requests to Prototype / MVP must-haves. Read-only.",
      "Axal VC connects as a GitHub App with read permissions only. If GitHub ever grants more than read, Axal VC revokes the grant and refuses the connection."
    ],
    "tools": [
      {
        "name": "read_installations",
        "label": "app installations",
        "access": "read",
        "what": "Lists where the Axal VC app is installed for you.",
        "lands_in": null
      },
      {
        "name": "list_repositories",
        "label": "repository names",
        "access": "read",
        "what": "Lists the repositories each installation can see, so you can choose.",
        "lands_in": null
      },
      {
        "name": "read_account",
        "label": "your account name",
        "access": "read",
        "what": "Reads your GitHub login, when you connect.",
        "lands_in": null
      },
      {
        "name": "read_issues",
        "label": "issues",
        "access": "read",
        "what": "Reads issues in the repositories you chose.",
        "lands_in": "product_roadmap"
      },
      {
        "name": "read_pull_requests",
        "label": "pull requests",
        "access": "read",
        "what": "Reads pull requests in the repositories you chose.",
        "lands_in": "prototype_mvp"
      },
      {
        "name": "read_releases",
        "label": "releases",
        "access": "read",
        "what": "Reads releases in the repositories you chose. They are counted under Product roadmap; no row is made.",
        "lands_in": null
      },
      {
        "name": "revoke_grant",
        "label": "the grant",
        "access": "account",
        "what": "Revokes the grant when GitHub grants more than read.",
        "lands_in": null
      }
    ],
    "prompts": [
      {
        "name": "fed_by_github",
        "ask": "What has GitHub brought into this company’s projects?",
        "proposes": null
      },
      {
        "name": "roadmap_from_issues",
        "ask": "How many GitHub issues became roadmap items for <project>?",
        "proposes": null
      }
    ],
    "prompts_reason": null,
    "made_by": {
      "name": "Axal VC"
    },
    "service": {
      "name": "GitHub",
      "href": null
    },
    "sign_in": {
      "kind": "oauth",
      "label": "Sign in with GitHub and choose repositories",
      "key_help_href": null
    },
    "endpoints": {
      "sign_in": "https://github.com/login/oauth/authorize",
      "api": "https://api.github.com"
    },
    "added": "2026-10",
    "links": {
      "help": null,
      "support": null,
      "privacy": null,
      "developer_docs": "https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app"
    },
    "verified_on": null,
    "key": "github",
    "page_key": "github",
    "page_href": "/account/connectors/github",
    "trust": {
      "built_by": "Axal VC",
      "reads": [
        "app installations",
        "repository names",
        "your account name",
        "issues",
        "pull requests",
        "releases"
      ],
      "writes": [],
      "read_only": true,
      "moves_money": false,
      "sentence": "Axal VC built and runs this connector. It reads app installations, repository names, your account name, issues, pull requests and releases from GitHub. It never writes to GitHub. Nothing it does can move money."
    }
  },
  "hubspot": {
    "display_name": "HubSpot",
    "status": "live",
    "tier": "growth",
    "capabilities": [
      "Push deals",
      "Pull contacts",
      "Two-way sync"
    ],
    "category": "CRM",
    "verified": false,
    "pulls": [
      {
        "what": "Deals and contacts",
        "module": "capital_relationships"
      }
    ],
    "sends": [
      {
        "what": "New company",
        "target": "HubSpot company",
        "default_mode": "ask"
      },
      {
        "what": "Deal stage change",
        "target": "HubSpot deal",
        "default_mode": "auto"
      }
    ],
    "feeds": [
      "capital_relationships",
      "network"
    ],
    "permissions": [
      "Connect to your HubSpot account.",
      "Read your HubSpot deals.",
      "Update your HubSpot deals.",
      "Read your HubSpot contacts.",
      "Update your HubSpot contacts.",
      "Read your HubSpot companies.",
      "Update your HubSpot companies.",
      "Read your HubSpot deal fields."
    ],
    "tagline": "Deals, companies and contacts between Axal VC and your HubSpot CRM.",
    "long_description": [
      "Sync deals, companies and contacts between Axal VC and your HubSpot CRM.",
      "Deals read from HubSpot land in Capital relationships. When a deal’s stage changes on Axal VC, its HubSpot deal is updated automatically. A company and its founder contact go to HubSpot only when you ask.",
      "Connect with a HubSpot Private App token, or by signing in with HubSpot. Axal VC never deletes a HubSpot record."
    ],
    "tools": [
      {
        "name": "read_token_info",
        "label": "the token’s account",
        "access": "account",
        "what": "Reads which HubSpot account the token belongs to, when you connect.",
        "lands_in": null
      },
      {
        "name": "search_deals",
        "label": "recently changed deals",
        "access": "read",
        "what": "Searches for deals changed in the last half hour, to keep stages in step.",
        "lands_in": null
      },
      {
        "name": "list_deals",
        "label": "deals",
        "access": "read",
        "what": "Lists your deals with their name, stage, pipeline and amount.",
        "lands_in": "capital_relationships"
      },
      {
        "name": "list_pipelines",
        "label": "deal pipelines",
        "access": "read",
        "what": "Reads your deal pipelines and their stages, to map stages both ways.",
        "lands_in": null
      },
      {
        "name": "create_deal",
        "label": "deals",
        "access": "write",
        "what": "Creates a HubSpot deal, automatically, when a deal’s stage changes on Axal VC and HubSpot has none yet.",
        "lands_in": null
      },
      {
        "name": "update_deal",
        "label": "deal stages",
        "access": "write",
        "what": "Updates the HubSpot deal’s stage, automatically, when its stage changes on Axal VC.",
        "lands_in": null
      },
      {
        "name": "create_company",
        "label": "companies",
        "access": "write",
        "what": "Creates a HubSpot company for a project, when you ask.",
        "lands_in": null
      },
      {
        "name": "update_company",
        "label": "company details",
        "access": "write",
        "what": "Updates the project’s HubSpot company, when you ask.",
        "lands_in": null
      },
      {
        "name": "create_contact",
        "label": "founder contacts",
        "access": "write",
        "what": "Creates the founder’s contact with the company, when you ask and HubSpot has none yet.",
        "lands_in": null
      },
      {
        "name": "receive_deal_updates",
        "label": "deal updates",
        "access": "inbound",
        "what": "HubSpot tells Axal VC when a deal changes.",
        "lands_in": null
      },
      {
        "name": "revoke_refresh_token",
        "label": "the sign-in",
        "access": "account",
        "what": "Revokes the HubSpot sign-in when you disconnect.",
        "lands_in": null
      }
    ],
    "prompts": [
      {
        "name": "recent_deals",
        "ask": "Which HubSpot deals were updated most recently, and at what stage?",
        "proposes": null
      },
      {
        "name": "deal_amounts",
        "ask": "What is each HubSpot deal for <project> worth?",
        "proposes": null
      },
      {
        "name": "send_company",
        "ask": "Add <project> to HubSpot as a company",
        "proposes": "project_id"
      },
      {
        "name": "update_deal",
        "ask": "Update the HubSpot deal for <project>",
        "proposes": "deal_id"
      }
    ],
    "prompts_reason": null,
    "made_by": {
      "name": "Axal VC"
    },
    "service": {
      "name": "HubSpot",
      "href": null
    },
    "sign_in": {
      "kind": "oauth_or_key",
      "label": "Private App token, or sign in with HubSpot",
      "key_help_href": "https://developers.hubspot.com/docs/api/overview"
    },
    "endpoints": {
      "sign_in": "https://app.hubspot.com/oauth/authorize",
      "api": "https://api.hubapi.com"
    },
    "added": "2026-05",
    "links": {
      "help": null,
      "support": null,
      "privacy": null,
      "developer_docs": "https://developers.hubspot.com/docs/api/overview"
    },
    "verified_on": null,
    "key": "hubspot",
    "page_key": "hubspot",
    "page_href": "/account/connectors/hubspot",
    "trust": {
      "built_by": "Axal VC",
      "reads": [
        "recently changed deals",
        "deals",
        "deal pipelines"
      ],
      "writes": [
        "deals",
        "deal stages",
        "companies",
        "company details",
        "founder contacts"
      ],
      "read_only": false,
      "moves_money": false,
      "sentence": "Axal VC built and runs this connector. It reads recently changed deals, deals and deal pipelines from HubSpot. It writes to HubSpot: deals, deal stages, companies, company details and founder contacts. Each tool below says when. Nothing it does can move money."
    }
  },
  "figma": {
    "display_name": "Figma",
    "status": "coming_soon",
    "tier": "free",
    "capabilities": [],
    "category": "Design",
    "verified": false,
    "pulls": [
      {
        "what": "Designs",
        "module": "prototype_mvp"
      }
    ],
    "sends": [],
    "feeds": [
      "prototype_mvp"
    ],
    "permissions": [],
    "tagline": "Design files for Prototype / MVP. Coming soon.",
    "long_description": [
      "Figma will bring design files into Prototype / MVP.",
      "Axal VC has not built this connector yet. Nothing connects, and nothing is read or written."
    ],
    "tools": [],
    "prompts": [],
    "prompts_reason": "Nothing to ask yet: this connector is not built.",
    "made_by": {
      "name": "Axal VC"
    },
    "service": {
      "name": "Figma",
      "href": null
    },
    "sign_in": {
      "kind": "oauth",
      "label": "Sign in with Figma",
      "key_help_href": null
    },
    "endpoints": {
      "sign_in": null,
      "api": null
    },
    "added": null,
    "links": {
      "help": null,
      "support": null,
      "privacy": null,
      "developer_docs": null
    },
    "verified_on": null,
    "key": "figma",
    "page_key": "figma",
    "page_href": "/account/connectors/figma",
    "trust": {
      "built_by": "Axal VC",
      "reads": [],
      "writes": [],
      "read_only": true,
      "moves_money": false,
      "sentence": "Axal VC has not built this connector yet, so it reads and writes nothing. Nothing it does can move money."
    }
  }
};
const GITHUB = FX.github;
const HUBSPOT = FX.hubspot;
const FIGMA = FX.figma;

// The catalogue row the page already holds (F1), for STATUS, PLAN and the band.
const ROW = (c, extra = {}) => ({
  key: c.key, display_name: c.display_name, status: c.status, tier: c.tier, category: c.category,
  description: `${c.display_name} card description.`, capabilities: c.capabilities, auth_type: 'oauth2',
  has_implementation: true, connection: null, ...extra,
});
const body = (c, props = {}) => renderToStaticMarkup(h(ConnectorBody, { connector: c, p: ROW(c), ...props }));
/** The markup of one section, by its test id. */
const section = (html, id) => {
  const at = html.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `${id} is drawn`);
  const start = html.lastIndexOf('<', at);
  const tag = html.slice(start + 1, html.indexOf(' ', start));
  let depth = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[\s>]/g;
  re.lastIndex = start;
  for (let m; (m = re.exec(html));) {
    if (m[2] !== tag) continue;
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
};

// ---------------------------------------------------------------- About

test('About: the paragraphs in order, It reads / It writes with their modes, and the permissions', () => {
  const about = section(body(HUBSPOT), 'connector-page-about');
  const text = flat(about);
  let at = -1;
  for (const para of HUBSPOT.long_description) {
    const i = text.indexOf(para);
    assert.ok(i > at, `paragraph in order: ${para.slice(0, 30)}`);
    at = i;
  }
  assert.match(text, /It reads Deals and contacts → Capital relationships Automatically/);
  assert.match(text, /It writes New company → HubSpot company Asks first Deal stage change → HubSpot deal Automatically/);
  assert.match(text, /What Axal VC can access/);
  for (const perm of HUBSPOT.permissions) assert.ok(text.includes(perm), perm);
  assert.equal((about.match(/<li>/g) || []).length, HUBSPOT.permissions.length);

  const gh = flat(section(body(GITHUB), 'connector-page-about'));
  assert.match(gh, /It writes Nothing/, 'an empty sends list says Nothing');
});

test('About: a field the Worker does not send reads "Not recorded" with the registry reason', () => {
  const c = clone(FIGMA);
  delete c.long_description;
  delete c.sends;
  c.permissions = [];
  const about = section(body(c), 'connector-page-about');
  const reasons = about.split(`title="${DETAIL_MISSING}"`).length - 1;
  assert.equal(reasons, 3, 'description, It writes and access each say why');
  assert.match(flat(about), /Not recorded/);
});

// ---------------------------------------------------------------- Tools

test('Tools: grouped as Reads, Writes, Keeps the connection working and Calls Axal VC, each chip described by its what', () => {
  assert.deepEqual(toolGroups(HUBSPOT.tools).map((g) => [g.label, g.tools.length]),
    [['Reads', 3], ['Writes', 5], ['Keeps the connection working', 2], ['Calls Axal VC', 1]]);
  const tools = section(body(HUBSPOT), 'connector-page-tools');
  const text = flat(tools);
  assert.ok(text.indexOf('Reads') < text.indexOf('Writes') && text.indexOf('Writes') < text.indexOf('Keeps the connection working')
    && text.indexOf('Keeps the connection working') < text.indexOf('Calls Axal VC'));
  assert.match(tools, /<ul class="grid grid-cols-2 [^"]*sm:grid-cols-3"/, "chips in 2 or 3 columns");
  const unq = (x) => x.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const chips = [...tools.matchAll(/<li[^>]*aria-describedby="([^"]+)"[^>]*>([^<]*)<span id="([^"]+)" hidden="">([^<]*)<\/span><\/li>/g)]
    .map((m) => { assert.equal(m[1], m[3], 'described by its own span'); return [unq(m[2]), unq(m[4])]; });
  const order = ['read', 'write', 'account', 'inbound'];
  const want = order.flatMap((a) => HUBSPOT.tools.filter((t) => t.access === a).map((t) => [t.label, t.what]));
  assert.deepEqual(chips, want, 'each chip is its label, described by its what, in group order');
  assert.doesNotMatch(tools, /<button/, 'chips are static');
});

test('Tools: Figma has none, and no chip is ever drawn from capabilities', () => {
  assert.match(flat(section(body(FIGMA), 'connector-page-tools')), /Axal VC has no tools for Figma yet\./);
  const c = { ...clone(FIGMA), capabilities: ['SENTINEL-CAPABILITY'] };
  const html = renderToStaticMarkup(h(ConnectorBody, { connector: c, p: ROW(c, { capabilities: ['SENTINEL-CAPABILITY'] }) }));
  assert.ok(!html.includes('SENTINEL-CAPABILITY'), 'capabilities are never drawn as tools');
  const gh = { ...clone(GITHUB), capabilities: ['SENTINEL-CAPABILITY'] };
  assert.ok(!body(gh).includes('SENTINEL-CAPABILITY'));
  assert.ok(!toolGroups([{ name: 'x', label: 'x', access: 'admin', what: 'x' }]).length, 'an unknown access value is not guessed into a group');
});

// ---------------------------------------------------------------- Prompts

test('Prompts: GitHub and HubSpot draw their asks; none when prompts is empty; never a button', () => {
  for (const c of [GITHUB, HUBSPOT]) {
    const prompts = section(body(c), 'connector-page-prompts');
    for (const x of c.prompts) assert.ok(flat(prompts).includes(x.ask), x.ask);
    assert.equal((prompts.match(/<li/g) || []).length, c.prompts.length);
    assert.doesNotMatch(prompts, /<button|<a /);
  }
  assert.ok(!body(FIGMA).includes('connector-page-prompts'));
  assert.ok(!body({ ...clone(HUBSPOT), prompts: [] }).includes('connector-page-prompts'));
});

// ---------------------------------------------------------------- Trust

test('Trust: the Worker\'s sentence byte for byte, as a note with an aria-hidden icon', () => {
  for (const c of [GITHUB, HUBSPOT, FIGMA]) {
    const trust = section(body(c), 'connector-page-trust');
    assert.match(trust, /^<div role="note"/);
    assert.match(trust, /<svg[^>]*aria-hidden="true"/);
    const inner = /<span class="min-w-0">([^<]*)<\/span>/.exec(trust)[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    assert.equal(inner, c.trust.sentence);
  }
});

// ---------------------------------------------------------------- Details

test('Details: every label, in order, from the Worker; a sign-in connector also has its sign-in URL', () => {
  const rows = bodyDetailsRows(HUBSPOT, ROW(HUBSPOT));
  assert.deepEqual(rows.map((r) => r.label), ['Made by', 'Service', 'Category', 'Sign-in', 'Connector URL', 'Sign-in URL', 'Added', 'Status', 'Plan', 'More info']);
  const v = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(v['Made by'], 'Axal VC');
  assert.equal(v.Service, HUBSPOT.service.name);
  assert.equal(v.Category, 'CRM');
  assert.equal(v['Sign-in'], 'Private App token, or sign in with HubSpot');
  assert.equal(v['Connector URL'], 'https://api.hubapi.com');
  assert.equal(v['Sign-in URL'], 'https://app.hubspot.com/oauth/authorize');
  assert.equal(v.Added, 'May 2026');
  assert.equal(v['More info'], 'Documentation');

  const details = section(body(HUBSPOT), 'connector-page-details');
  assert.match(details, /^<section/);
  assert.match(details, /<dl class="grid grid-cols-1 [^"]*sm:grid-cols-2/);
  for (const label of ['Made by', 'Service', 'Category', 'Sign-in', 'Connector URL', 'Sign-in URL', 'Added', 'Status', 'Plan', 'More info']) {
    assert.ok(details.includes(`>${label}</dt>`), label);
  }
  assert.match(details, /<span class="break-all font-mono[^"]*">https:\/\/api\.hubapi\.com<\/span>/);
  assert.match(details, /<a href="https:\/\/developers\.hubspot\.com\/docs\/api\/overview" target="_blank" rel="noopener noreferrer"[^>]*>Documentation ↗<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/);

  const key = { ...clone(HUBSPOT), sign_in: { kind: 'key', label: 'API key', key_help_href: null } };
  assert.ok(!bodyDetailsRows(key, ROW(key)).some((r) => r.label === 'Sign-in URL'), 'a key connector has no sign-in URL');
});

test('Details: a missing value reads "Not recorded" with DETAIL_MISSING; an http: or javascript: link is never drawn', () => {
  const c = clone(HUBSPOT);
  delete c.endpoints.api;
  c.added = null;
  c.service = { name: 'HubSpot', href: 'javascript:alert(1)' };
  c.links = { help: 'http://example.test/help', developer_docs: 'javascript:alert(1)', support: 'https://example.test/support', privacy: 'data:text/html,x' };
  const rows = Object.fromEntries(bodyDetailsRows(c, ROW(c)).map((r) => [r.label, r]));
  assert.deepEqual([rows['Connector URL'].value, rows['Connector URL'].reason], [null, DETAIL_MISSING]);
  assert.deepEqual([rows.Added.value, rows.Added.reason], [null, DETAIL_MISSING]);
  assert.equal(rows.Service.href, null);
  assert.deepEqual(rows['More info'].links, [{ label: 'Support', href: 'https://example.test/support' }]);

  const html = body(c);
  assert.ok(!/javascript:|http:\/\/example|data:text/.test(html), 'no unsafe link reaches the page');
  assert.ok(section(html, 'connector-page-details').includes(`title="${DETAIL_MISSING}">Not recorded`));
  assert.ok(html.includes('>Support ↗'));

  assert.equal(safeHref('https://example.test/x'), 'https://example.test/x');
  for (const bad of ['http://example.test', 'javascript:alert(1)', '//example.test', '/relative', '', null, 7]) assert.equal(safeHref(bad), null, String(bad));
  assert.equal(addedLabel('2026-10'), 'October 2026');
  for (const bad of ['2026-13', '2026-00', '2026-1', 'October', null]) assert.equal(addedLabel(bad), null, String(bad));

  const none = clone(FIGMA);
  none.links = { help: null, developer_docs: null, support: null, privacy: null };
  const more = bodyDetailsRows(none, ROW(none)).find((r) => r.label === 'More info');
  assert.deepEqual([more.value, more.reason], [null, DETAIL_MISSING]);
});

// ---------------------------------------------------------------- states and the page

test('An unreadable or loading body holds each section on its own, with Retry, and draws no guess', () => {
  let retried = 0;
  const html = renderToStaticMarkup(h(ConnectorBody, { state: 'unreadable', connector: null, p: ROW(GITHUB), onRetry: () => { retried += 1; } }));
  for (const id of ['connector-page-about', 'connector-page-tools', 'connector-page-details']) {
    const s = section(html, id);
    assert.match(flat(s), /This connector’s description could not be read\. Retry/, id);
  }
  assert.ok(!html.includes('connector-page-prompts') && !html.includes('connector-page-trust'));
  assert.equal(retried, 0);
  const loading = renderToStaticMarkup(h(ConnectorBody, { state: 'loading', connector: GITHUB, p: ROW(GITHUB) }));
  assert.ok(!loading.includes(GITHUB.trust.sentence), 'a loading body draws nothing from a stale object');
  assert.equal((flat(loading).match(/Loading…/g) || []).length, 3);
});

const pageData = (row) => ({ status: 'ready', catalogue: [row], items: [], itemsFailed: false, suggestions: [], suggestionsNote: '', reload() {} });
const page = (props) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/hubspot'] },
  h(ConnectorPageView, { data: pageData(ROW(HUBSPOT)), connectorKey: 'hubspot', ...props })));

test('The page: the body replaces F1\'s About and Details, the tagline comes from it, and the band and Connect stay', () => {
  const html = page({ body: { state: 'ready', connector: HUBSPOT } });
  assert.ok(section(html, 'connector-page-tagline').includes(HUBSPOT.tagline));
  assert.ok(!html.includes('HubSpot card description.'));
  assert.equal((html.match(/data-testid="connector-page-about"/g) || []).length, 1);
  assert.ok(html.includes('data-testid="connector-page-body"'));
  // D753 F2 (#1908): Connect is the band's action now.
  assert.ok(html.includes('data-testid="connector-page-band"') && html.includes('data-testid="connector-page-action"'));

  const failed = page({ body: { state: 'unreadable', connector: null } });
  assert.ok(failed.includes('HubSpot card description.'), 'an unreadable body keeps F1\'s line');
  assert.ok(failed.includes('data-testid="connector-page-action"'), 'Connect keeps working from the catalogue');

  const f1 = page({});
  assert.ok(!f1.includes('connector-page-body'), 'without a body the page is F1\'s');
  assert.ok(f1.includes('HubSpot card description.'));
  assert.equal(headerTagline({ description: 'card' }, { tagline: '' }), 'card');
  assert.equal(headerTagline({ description: 'card' }, { tagline: 'body' }), 'body');
});

// ---------------------------------------------------------------- the read (part 2)

async function mountPage(props, url = '/account/connectors/hubspot') {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(ConnectorPageView, props))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n = container) => textOf(n).replace(/\s+/g, ' ').trim();
  const buttons = (n = container) => walk(n).filter((x) => x.tagName === 'BUTTON' || x.nodeName === 'BUTTON');
  return {
    by, text, buttons, settle,
    async press(node) { await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}
const reader = (answers) => {
  const calls = [];
  return { calls, readPage: async (key) => { calls.push(key); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; if (a instanceof Error) throw a; return a; } };
};

test('The read: one call on mount, by the row\'s page_key; the answer fills the body and the tagline', async () => {
  const r = reader([{ ok: true, connector: HUBSPOT }]);
  const m = await mountPage({ data: pageData(ROW(HUBSPOT, { page_key: 'hubspot' })), connectorKey: 'hubspot', readPage: r.readPage });
  try {
    assert.deepEqual(r.calls, ['hubspot'], 'exactly one read on mount');
    assert.equal(m.text(m.by('connector-page-tagline')), HUBSPOT.tagline);
    assert.ok(m.text(m.by('connector-page-trust')).includes(HUBSPOT.trust.sentence.slice(0, 30)));
    await m.settle();
    assert.equal(r.calls.length, 1, 'no second read after the answer lands');
  } finally { await m.unmount(); }

  const alias = reader([{ ok: true, connector: HUBSPOT }]);
  const a = await mountPage({ data: pageData(ROW(HUBSPOT, { page_key: 'hubspot-directory' })), connectorKey: 'hubspot', readPage: alias.readPage });
  try { assert.deepEqual(alias.calls, ['hubspot-directory'], 'the Worker\'s page_key, not the row key'); } finally { await a.unmount(); }
});

test('The read: a refused or malformed answer makes each section unreadable with Retry; the band and Connect keep working; Retry reads once more', async () => {
  for (const bad of [new Error('network'), { ok: false, error: 'nope' }, { ok: false, connector: HUBSPOT }, { ok: 'true', connector: HUBSPOT }, { ok: true }, { ok: true, connector: 'text' }, null]) {
    const r = reader([bad, { ok: true, connector: HUBSPOT }]);
    const m = await mountPage({ data: pageData(ROW(HUBSPOT, { available: true })), connectorKey: 'hubspot', readPage: r.readPage });
    try {
      assert.deepEqual(r.calls, ['hubspot']);
      const about = m.by('connector-page-about');
      const tools = m.by('connector-page-tools');
      const details = m.by('connector-page-details');
      for (const sec of [about, tools, details]) {
        assert.match(m.text(sec), /This connector’s description could not be read\. Retry/, String(bad?.message ?? JSON.stringify(bad)));
      }
      assert.equal(m.by('connector-page-trust'), undefined, 'no trust sentence without the Worker\'s');
      assert.equal(m.text(m.by('connector-page-tagline')), 'HubSpot card description.', 'the band keeps the catalogue\'s line');
      const connect = m.by('connector-page-action');
      assert.ok(connect && m.buttons(connect).length > 0, 'Connect keeps its buttons');
      assert.ok(m.buttons(connect).every((b) => !b.disabled), 'and they are live');

      const retry = m.buttons(about).find((b) => /Retry/.test(m.text(b)));
      await m.press(retry);
      assert.deepEqual(r.calls, ['hubspot', 'hubspot'], 'Retry reads exactly once more');
      assert.equal(m.text(m.by('connector-page-tagline')), HUBSPOT.tagline, 'and its answer fills the page');
      assert.doesNotMatch(m.text(), /could not be read/);
    } finally { await m.unmount(); }
  }
});

test('The read: none without readPage, none while the connector is unknown, and a handed body wins', async () => {
  const r = reader([{ ok: true, connector: HUBSPOT }]);
  const loading = await mountPage({ data: { status: 'loading', catalogue: [], items: [], reload() {} }, connectorKey: 'hubspot', readPage: r.readPage });
  try { assert.equal(r.calls.length, 0, 'nothing to read until the row is known'); } finally { await loading.unmount(); }
  const handed = await mountPage({ data: pageData(ROW(HUBSPOT)), connectorKey: 'hubspot', readPage: r.readPage, body: { state: 'ready', connector: GITHUB } });
  try {
    assert.equal(r.calls.length, 0, 'a body handed in is not read again');
    assert.equal(m_text(handed), GITHUB.tagline);
  } finally { await handed.unmount(); }
  const src = readFileSync('frontend/src/pages/account/ConnectorPage.jsx', 'utf8');
  assert.match(src, /readPage=\{connectorsApi\.page\}/, 'the routed page reads through connectorsApi.page');
});
const m_text = (m) => m.text(m.by('connector-page-tagline'));

// ---------------------------------------------------------------- the catalogue

test('The catalogue: the page fields reach the first-party rows, and Made by is Axal VC', () => {
  const page = { tagline: 'Calendar line.', made_by: { name: 'Axal VC' }, service: { name: 'Google', href: 'https://google.com' }, sign_in: { kind: 'first_party', label: 'Sign in with Google', key_help_href: null }, added: '2026-03', verified_on: '2026-10-01', read_only: false, page_key: 'google', page_href: '/account/connectors/google', configured: true };
  const cat = buildCatalogue({
    providers: [
      { key: 'google_calendar', display_name: 'Google Calendar', status: 'live', ...page },
      { key: 'hubspot', display_name: 'HubSpot', status: 'live', category: 'CRM', made_by: { name: 'Axal VC' } },
      { key: 'figma', display_name: 'Figma', status: 'coming_soon', category: 'Design' },
    ],
  });
  const google = cat.find((p) => p.key === 'google');
  for (const [k, v] of Object.entries(page)) assert.deepEqual(google[k], v, k);
  assert.equal(cat.find((p) => p.key === 'hubspot').by, 'Axal VC');
  assert.equal(cat.find((p) => p.key === 'figma').by, 'Figma', 'no made_by: the name, as before');

  // FIRST_PARTY holds identity only; LinkedIn's words are its `first_party` card's (W2).
  for (const fp of FIRST_PARTY) assert.deepEqual(Object.keys(fp).sort(), ['auth_type', 'display_name', 'first_party', 'key', 'status', 'tier'], fp.key);
  const card = { key: 'linkedin', display_name: 'LinkedIn (card)', category: 'Data', first_party: true, tagline: 'LinkedIn card line.', made_by: { name: 'Axal VC' }, page_key: 'linkedin' };
  const li = buildCatalogue({ providers: [], firstPartyCards: [card, { display_name: 'no key' }] }).find((p) => p.key === 'linkedin');
  assert.equal(li.category, 'Data');
  assert.equal(li.by, 'Axal VC');
  assert.equal(li.description, 'LinkedIn card line.', 'a card with no description reads its tagline');
  assert.equal(li.page_key, 'linkedin');
  assert.equal(li.display_name, 'LinkedIn', 'identity stays FIRST_PARTY\'s');
  assert.equal(buildCatalogue({ providers: [] }).find((p) => p.key === 'linkedin').by, 'LinkedIn', 'no card: the name');

});

test('No HTML is built from the Worker\'s words, and the body holds no descriptive copy', () => {
  const src = readFileSync('frontend/src/pages/account/ConnectorPage.jsx', 'utf8');
  assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML/);
  assert.doesNotMatch(src, /capabilities/, 'the page never reads capabilities');
});
