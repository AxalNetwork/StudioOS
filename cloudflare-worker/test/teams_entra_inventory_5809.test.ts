/**
 * #5809 — the Teams/Entra runbook's inventory is the code's, not a copy that
 * drifts. Each value `documentation/operations/TEAMS_ENTRA_5809.md` §1 names is
 * read from the source it cites, and the meeting call's Graph refusals are
 * exercised against a fake Graph. No test reaches Microsoft; every value is
 * invented.
 *
 *  1. Scopes, authority, tenant default and client env names match the runbook.
 *  2. Each environment's resolved callback is the runbook's, from wrangler.toml.
 *  3. Teams' join-link hosts and every refusal code are named in the runbook.
 *  4. Graph 429 and 5xx answer teams_unreachable, 401/403 teams_reconnect, and
 *     an event without a link is deleted again (teams_personal_account).
 *  5. The calendar client never asks for mail or meeting-bot permissions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { encryptString } from '../src/services/cryptoBox.ts';
import {
  MICROSOFT_CAL_ENV_VARS, MICROSOFT_CAL_FALLBACK_ENV_VARS, microsoftRedirectUri,
} from '../src/services/calendar.ts';
import { TEAMS_ERRORS, TeamsMeetingError, createTeamsMeeting, teamsJoinUrl } from '../src/services/channels/teamsMeet.ts';

const RUNBOOK = readFileSync('documentation/operations/TEAMS_ENTRA_5809.md', 'utf8');
const CALENDAR = readFileSync('cloudflare-worker/src/services/calendar.ts', 'utf8');
const TOML = readFileSync('wrangler.toml', 'utf8');
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

/** The quoted strings of a `const NAME = [ … ];` array in the source. */
function arrayConst(src: string, name: string): string[] {
  const head = `const ${name} = [`;
  const at = src.indexOf(head);
  const end = at < 0 ? -1 : src.indexOf(']', at + head.length);
  assert.ok(end >= 0, `no const ${name}`);
  return [...src.slice(at + head.length, end).matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** One table's `KEY = "value"` lines, up to the next table header. */
function tomlVars(section: string): Record<string, string> {
  const at = TOML.indexOf(`[${section}]`);
  assert.ok(at >= 0, `no [${section}]`);
  const rest = TOML.slice(at + section.length + 2);
  const end = rest.search(/^\[/m);
  const out: Record<string, string> = {};
  for (const m of (end < 0 ? rest : rest.slice(0, end)).matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}

test('1. scopes, authority, tenant default and client env names are the runbook\'s', () => {
  const scopes = arrayConst(CALENDAR, 'MICROSOFT_SCOPES');
  assert.deepEqual(scopes, ['openid', 'profile', 'email', 'offline_access', 'Calendars.ReadWrite', 'User.Read']);
  assert.ok(RUNBOOK.includes(`\`${scopes.join(' ')}\``), 'the runbook names the exact scope string');
  assert.match(CALENDAR, /const MICROSOFT_AUTHORITY = 'https:\/\/login\.microsoftonline\.com';/);
  assert.match(CALENDAR, /return env\.MICROSOFT_TENANT_ID \|\| 'common';/);
  assert.ok(RUNBOOK.includes('`MICROSOFT_TENANT_ID`, else `common`'));
  for (const name of [...MICROSOFT_CAL_ENV_VARS, ...MICROSOFT_CAL_FALLBACK_ENV_VARS, 'MICROSOFT_CALENDAR_REDIRECT_URI']) {
    assert.ok(RUNBOOK.includes(`\`${name}\``), `the runbook names ${name}`);
  }
});

test('2. each environment\'s resolved callback is the runbook\'s', () => {
  const prod = tomlVars('env.production.vars');
  const preview = tomlVars('env.preview.vars');
  const prodUri = microsoftRedirectUri({ ...prod, ENVIRONMENT: 'production' } as any);
  const previewUri = microsoftRedirectUri({ ...preview } as any);
  assert.equal(prodUri, 'https://app.axal.vc/api/calendar/microsoft/callback');
  assert.equal(previewUri, 'https://studioos-preview.workers.dev/api/calendar/microsoft/callback');
  for (const uri of [prodUri, previewUri]) assert.ok(RUNBOOK.includes(`\`${uri}\``), `the runbook lists ${uri}`);
  // A stale workers.dev override is ignored in production, as the runbook says.
  assert.equal(microsoftRedirectUri({ ...prod, ENVIRONMENT: 'production', MICROSOFT_CALENDAR_REDIRECT_URI: 'https://x.workers.dev/cb' } as any), prodUri);
});

test('3. join-link hosts and every refusal code are named in the runbook', () => {
  for (const host of ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']) {
    assert.ok(teamsJoinUrl(`https://${host}/l/meetup-join/x`), host);
    assert.ok(RUNBOOK.includes(`\`${host}\``), host);
  }
  assert.equal(teamsJoinUrl('https://teams.example.test/l/x'), null);
  for (const code of Object.keys(TEAMS_ERRORS)) assert.ok(RUNBOOK.includes(`\`${code}\``), `the runbook names ${code}`);
  assert.ok(RUNBOOK.includes("`onlineMeetingProvider: 'teamsForBusiness'`"));
});

async function graphWorld(t: any, eventAnswer: (n: number) => Response) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(tableFromBaseline(BASELINE, 'microsoft_oauth_tokens'));
  const env: any = {
    DB: d1Over(db), ENVIRONMENT: 'development', KEK_PII: 'k'.repeat(48), JWT_SECRET: 'j'.repeat(48),
    MICROSOFT_CAL_CLIENT_ID: 'fixture-ms-client', MICROSOFT_CAL_CLIENT_SECRET: 'fixture-ms-secret', APP_URL: 'https://axal.test',
  };
  db.prepare('INSERT INTO microsoft_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(2, await encryptString(env, 'fixture-ms-refresh'), 'openid offline_access Calendars.ReadWrite User.Read');
  const calls: string[] = [];
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    calls.push(`${init.method ?? 'GET'} ${url.host}${url.pathname}`);
    if (url.host === 'login.microsoftonline.com') return Response.json({ access_token: 'fixture-ms-access', expires_in: 3600 });
    if (url.host === 'graph.microsoft.com' && init.method === 'POST') return eventAnswer(++posts);
    if (url.host === 'graph.microsoft.com' && init.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`unexpected ${url.host}`);
  });
  return { env, calls };
}

const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof TeamsMeetingError ? e.code : String(e); } };

test('4. Graph throttled or down, refused, and a personal account each answer their own code', async (t) => {
  for (const [status, expected] of [[429, 'teams_unreachable'], [503, 'teams_unreachable'], [500, 'teams_unreachable'], [401, 'teams_reconnect'], [403, 'teams_reconnect'], [400, 'teams_create_failed']] as const) {
    const w = await graphWorld(t, () => new Response('{}', { status }));
    assert.equal(await code(createTeamsMeeting(w.env, 2, { topic: 'Fixture', durationMin: 30 })), expected, `Graph ${status}`);
    t.mock.restoreAll();
  }
  const personal = await graphWorld(t, () => Response.json({ id: 'fixture-event-1', onlineMeeting: null }));
  assert.equal(await code(createTeamsMeeting(personal.env, 2, { topic: 'Fixture', durationMin: 30 })), 'teams_personal_account');
  assert.deepEqual(personal.calls.filter((c) => c.startsWith('DELETE')), ['DELETE graph.microsoft.com/v1.0/me/events/fixture-event-1'], 'the link-less event is cleaned up');
  t.mock.restoreAll();
  const work = await graphWorld(t, () => Response.json({ id: 'fixture-event-2', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/fixture' } }));
  assert.deepEqual(await createTeamsMeeting(work.env, 2, { topic: 'Fixture', durationMin: 30 }), { joinUrl: 'https://teams.microsoft.com/l/meetup-join/fixture' });
  assert.equal(work.calls.filter((c) => c.startsWith('DELETE')).length, 0);
});

test('5. the calendar client asks for calendar permissions only', () => {
  const scopes = arrayConst(CALENDAR, 'MICROSOFT_SCOPES');
  for (const s of scopes) assert.doesNotMatch(s, /^(Mail\.|OnlineMeetings\.|Calls\.|Chat\.)/, `${s} is not a calendar permission`);
  // The mail adapter's own client is separate when configured; the shared fallback is the runbook's finding 1.
  const mail = readFileSync('cloudflare-worker/src/services/mail/adapters/oauth.ts', 'utf8');
  assert.match(mail, /env\.MAIL_MICROSOFT_CLIENT_ID \|\| env\.MICROSOFT_CLIENT_ID/);
  assert.ok(RUNBOOK.includes('`MAIL_MICROSOFT_*`') && RUNBOOK.includes('**Shared fallback client.**'));
});
