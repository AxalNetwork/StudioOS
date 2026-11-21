#!/usr/bin/env node
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import catalog from '../engineering-notifications/workflow-channels.json' with { type: 'json' };
import { registryOf } from '../engineering-slack/presentation-v1.mjs';
import { verifiedWorkflowChannel } from '../engineering-slack/transport.mjs';

const registered = catalog.workflows.filter(row => Number.isSafeInteger(row.id) && row.id > 0);
const known = new Set(registered.map(row => row.channel));
class OperatorError extends Error {}

export async function botMemberships(token, teamId, fetchImpl = fetch) {
  if (!token) throw new OperatorError('Set SLACK_BOT_TOKEN for the intended sender.');
  const read = async (method, params = {}) => {
    const url = new URL('https://slack.com/api/' + method);
    url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, {
      headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429) throw new OperatorError('Slack rate limited the lookup. Retry after its rate limit resets.');
    if (!response.ok) throw new OperatorError('Slack rejected the metadata lookup.');
    const body = await response.json();
    if (body.ok !== true) throw new OperatorError('Slack refused access. Check the sender token and groups:read.');
    return body;
  };
  const auth = await read('auth.test');
  if (!auth.bot_id || auth.team_id !== teamId) throw new OperatorError('The sender bot does not match the requested workspace.');
  const rooms = new Map(), seen = new Set();
  let cursor = '';
  do {
    if (seen.has(cursor)) throw new OperatorError('Slack repeated a pagination cursor.');
    seen.add(cursor);
    const page = await read('users.conversations', { team_id: teamId, types: 'private_channel', exclude_archived: 'true', limit: '200', cursor });
    if (!Array.isArray(page.channels)) throw new OperatorError('Slack returned invalid conversation metadata.');
    for (const room of page.channels) {
      const hashtag = '#' + room.name;
      if (!known.has(hashtag)) continue;
      if (!verifiedWorkflowChannel(room, { teamId, hashtag, id: room.id })) throw new OperatorError('Channel no longer private and internal: ' + hashtag);
      if (rooms.has(hashtag) && rooms.get(hashtag) !== room.id) throw new OperatorError('Conflicting Slack channel identities for ' + hashtag);
      rooms.set(hashtag, room.id);
    }
    cursor = page.response_metadata?.next_cursor || '';
  } while (cursor);
  return rooms;
}

export function buildRegistry({ teamId, approvedAt, reviewedBy, retentionDays, enable = [], base, rooms }) {
  if (base) {
    registryOf(base);
    if (base.teamId !== teamId) throw new OperatorError('Base registry belongs to a different workspace.');
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new OperatorError('Provide retention days in 1..3650.');
  if (enable.some(label => !known.has(label) && label !== 'all')) throw new OperatorError('Unknown canary hashtag.');
  const enabled = new Set(enable.includes('all') ? known : enable);
  const channels = { ...base?.channels };
  let matched = 0, active = 0;
  for (const { id, channel } of registered) {
    const role = 'workflow:' + id, room = rooms.get(channel), previous = channels[role];
    if (!room) {
      if (enabled.has(channel) || previous) throw new OperatorError('Sender membership still required for ' + channel);
      continue;
    }
    if (previous && previous.id !== room) throw new OperatorError('Existing channel ID changed for ' + channel + '. Reconcile pending deliveries before rebinding.');
    const publish = enable.length ? enabled.has(channel) : previous?.enabled === true;
    channels[role] = { ...previous, id: room, publisher: 'internal-bot', private: true, retentionDays, enabled: publish };
    matched++;
    if (publish) active++;
  }
  if (!matched) throw new OperatorError('No verified workflow destinations were found.');
  const registry = { ...base, schema: 1, teamId, approvedAt, reviewedBy, version: (base?.version ?? 0) + 1, channels };
  registryOf(registry);
  return { registry, matched, active, missing: registered.length - matched };
}

async function main() {
  const { values } = parseArgs({ options: {
    team: { type: 'string' }, 'approved-at': { type: 'string' }, 'reviewed-by': { type: 'string' },
    'retention-days': { type: 'string' }, enable: { type: 'string', multiple: true },
    base: { type: 'string' }, out: { type: 'string' },
  } });
  if (!values.out || !/^T[A-Z0-9]{2,30}$/.test(values.team) || !Number.isFinite(Date.parse(values['approved-at'])) || values['reviewed-by'] !== 'guillaumelauzier') {
    throw new OperatorError('Provide --out, --team, --approved-at, --reviewed-by and --retention-days. See the workflow Slack rollout runbook.');
  }
  const directory = await realpath(dirname(resolve(values.out)));
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const location = relative(root, directory);
  if (location !== '..' && !location.startsWith('..' + sep)) throw new OperatorError('Write the private registry outside the repository.');
  const base = values.base ? JSON.parse(await readFile(values.base, 'utf8')) : undefined;
  const rooms = await botMemberships(process.env.SLACK_BOT_TOKEN, values.team);
  const { registry, matched, active, missing } = buildRegistry({
    teamId: values.team, approvedAt: values['approved-at'], reviewedBy: values['reviewed-by'],
    retentionDays: Number(values['retention-days']), enable: values.enable, rooms, base,
  });
  // Exclusive create protects existing files, including symlinks, and keeps other users out.
  await writeFile(resolve(directory, basename(values.out)), JSON.stringify(registry) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Verified ${matched} workflow destinations; ${active} enabled; ${missing} awaiting membership.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    // Provider and JSON parsing errors can include private metadata. Only operator errors carry public copy.
    const message = error instanceof OperatorError ? error.message : 'Could not build registry. Check arguments, read access, base approval and that the output file is new.';
    console.error(message);
    process.exitCode = 1;
  });
}
