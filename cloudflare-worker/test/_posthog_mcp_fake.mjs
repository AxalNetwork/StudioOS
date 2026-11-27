/**
 * D1385 (#3731) — a fake PostHog MCP server for PostHog's tests, over the
 * shared fake (`_mcp_fake.mjs`): `mcp.posthog.com` serves the MCP server and
 * `oauth.posthog.com` its OAuth server, as PostHog's region-agnostic hosts
 * do. Nothing here reaches the network; every other host answers 599.
 *
 * `tools/list` offers PostHog's 19 read tools AND tools Axal VC must never
 * call (`execute-sql`, `exec`, a person list and a write), so a test can
 * prove each is refused. Those names live only here, in the test folder.
 *
 * Every MCP request's headers (each POST to `/mcp`) are recorded in `sent`, so a test can prove
 * the read-only and tools-mode headers ride every request and the project
 * header only a pinned one. Answers carry `distinct_id`, `session_id` and a
 * person, so a test can prove none of them leaves `reads.ts`. Projects,
 * insights, experiments, surveys, flags and answers are invented.
 */
import { notesFake } from './_mcp_fake.mjs';

export const POSTHOG_HOST = 'mcp.posthog.com';
export const POSTHOG_AUTH_HOST = 'oauth.posthog.com';
export const POSTHOG_MCP_URL = `https://${POSTHOG_HOST}/mcp`;
export const POSTHOG_ISSUER = `https://${POSTHOG_AUTH_HOST}`;

/** Tools a server offers that Axal VC never calls: named in the test folder only. */
export const FAKE_POSTHOG_FORBIDDEN_TOOLS = ['execute-sql', 'exec', 'persons-list', 'insight-create-from-query', 'feature-flag-update', 'cohorts-actors-list'];

export const READ_TOOLS = [
  'organizations-get', 'projects-get', 'insights-list', 'insight-get', 'insight-query', 'query-trends', 'query-funnel',
  'query-retention', 'query-lifecycle', 'query-web-overview', 'experiment-list', 'experiment-get', 'experiment-results-get',
  'surveys-get-all', 'survey-get', 'survey-stats', 'surveys-responses-list', 'feature-flag-get-all', 'feature-flag-get-definition',
];

export const PROJECT_A = '4242';
export const PROJECT_B = '5151';
export const ORG_A = 'org-fixture-a';
export const INSIGHT_A = 'AbCd1234';
export const SURVEY_A = 'svy-fixture-1';
export const PERSON = 'person-fixture@example.test';

const readOnly = { readOnlyHint: true };
const writes = { readOnlyHint: false, destructiveHint: true };

export function defaultPosthogTools() {
  return [
    ...READ_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' }, annotations: readOnly })),
    { name: 'execute-sql', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, annotations: readOnly },
    { name: 'exec', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
    { name: 'persons-list', inputSchema: { type: 'object' }, annotations: readOnly },
    { name: 'cohorts-actors-list', inputSchema: { type: 'object' }, annotations: readOnly },
    { name: 'insight-create-from-query', inputSchema: { type: 'object' }, annotations: writes },
    { name: 'feature-flag-update', inputSchema: { type: 'object' }, annotations: writes },
  ];
}

/** Each read tool's answer. Every argument is recorded in `args`. */
function answers(args) {
  return (tool, a) => {
    args.push({ tool, args: a });
    switch (tool) {
      case 'organizations-get': return { results: [{ id: ORG_A, name: 'Fixture Org' }, { id: 'bad org id', name: 'Dropped' }] };
      case 'projects-get': return { results: [
        { id: Number(PROJECT_A), name: 'Fixture web app', organization: ORG_A, region: 'eu' },
        { id: Number(PROJECT_B), name: 'Fixture mobile', organization: ORG_A, region: 'US' },
        { id: 'not-digits', name: 'Dropped: its id is not PostHog\'s' },
      ] };
      case 'insights-list': return { results: [{ short_id: INSIGHT_A, name: 'Weekly active users', query: { kind: 'InsightVizNode', source: { kind: 'TrendsQuery' } }, last_refresh: '2026-10-20T10:00:00Z' }] };
      case 'insight-get': return { short_id: INSIGHT_A, name: 'Weekly active users', query: { kind: 'InsightVizNode', source: { kind: 'TrendsQuery', series: [{ event: '$pageview' }] } } };
      case 'insight-query': return { results: [{ label: 'WAU', data: [1180, 1240], distinct_id: 'd-1', persons: [{ email: PERSON }] }] };
      case 'query-trends': case 'query-funnel': case 'query-retention': case 'query-lifecycle':
        return { results: [{ count: 31, actors: [{ distinct_id: 'd-2' }], $session_id: 's-1' }] };
      case 'query-web-overview': return { results: [{ key: 'visitors', value: 820 }, { key: 'sessions', value: 1104 }] };
      case 'experiment-list': return { results: [{ id: 7, name: 'Shorter onboarding', feature_flag_key: 'short-onboarding', start_date: '2026-10-01T00:00:00Z' }] };
      case 'experiment-get': return { id: 7, name: 'Shorter onboarding', feature_flag_key: 'short-onboarding' };
      case 'experiment-results-get': return { variants: [{ key: 'test', exposure: 900, uplift: 3.1, distinct_ids: ['d-3'] }] };
      case 'surveys-get-all': return { results: [{ id: SURVEY_A, name: 'Would you pay for team boards?', type: 'popover' }] };
      case 'survey-get': return { id: SURVEY_A, name: 'Would you pay for team boards?', questions: [{ id: 'q1', question: 'Would you pay?', type: 'open' }] };
      case 'survey-stats': return { responses: 46, shown: 400, dismissed: 12 };
      case 'surveys-responses-list': return { results: [
        { timestamp: '2026-10-21T09:00:00Z', distinct_id: 'd-4', session_id: 's-2', person: { email: PERSON }, properties: { $survey_response: 'We\'d pay if it synced with our calendar.', $ip: '203.0.113.9', email: PERSON } },
      ] };
      case 'feature-flag-get-all': return { results: [{ id: 3, key: 'new-onboarding', name: 'New onboarding', active: true, filters: { groups: [{ rollout_percentage: 25 }] } }] };
      case 'feature-flag-get-definition': return { id: 3, key: 'new-onboarding', name: 'New onboarding', active: true, rollout_percentage: 25 };
      default: return { tool, arguments: a };
    }
  };
}

/** The PostHog fake: the shared fake on PostHog's hosts, with PostHog's tools, its read scopes and invented answers. */
export function posthogFake(opts = {}) {
  const args = [];
  const sent = [];
  const fake = notesFake({
    era: opts.era ?? 'modern',
    hosts: { mcp: POSTHOG_HOST, auth: POSTHOG_AUTH_HOST },
    resource: POSTHOG_MCP_URL,
    tools: defaultPosthogTools(),
    scope: opts.scope === undefined ? 'organization:read insight:read query:read experiment:read survey:read feature_flag:read openid email' : opts.scope,
    answer: answers(args),
  });
  fake.state.meta.cimd = opts.cimd ?? false;
  const inner = fake.fetch;
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === POSTHOG_HOST && u.pathname === '/mcp' && String(init.method || 'GET').toUpperCase() === 'POST') {
      const h = new Headers(init.headers || {});
      sent.push({ readOnly: h.get('x-posthog-read-only'), mode: h.get('x-posthog-mcp-mode'), project: h.get('x-posthog-project-id') });
    }
    return inner(url, init);
  };
  return {
    ...fake,
    fetch,
    /** Every `tools/call`'s arguments, in order. */
    args,
    /** The PostHog headers on every MCP request, in order. */
    sent,
    forbiddenCalls: () => fake.toolCalls().filter((t) => FAKE_POSTHOG_FORBIDDEN_TOOLS.includes(t)),
  };
}
