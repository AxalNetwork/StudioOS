#!/usr/bin/env node
/** D5815 (#5815): print the Teams recorder's offline deployment matrix; pass/fail per row, never a value. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { teamsMatrix, formatMatrix } from './lib/meetingBotTeamsMatrix.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const rows = teamsMatrix({
  site: read('wrangler.toml'), bot: read('wrangler.meeting-bot.toml'),
  workflow: read('.github/workflows/meeting-bot-deploy.yml'), dockerfile: read('meeting-bot/Dockerfile'),
  botPackage: read('meeting-bot/package.json'), container: read('meeting-bot/worker/container.ts'),
});
console.log(formatMatrix(rows));
if (rows.some(r => !r.ok)) { console.error('meeting_bot_teams_matrix_failed'); process.exitCode = 1; }
