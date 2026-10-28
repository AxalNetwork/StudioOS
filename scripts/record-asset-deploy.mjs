#!/usr/bin/env node
// D1361: invoked only after a successful deploy, before its assets are cached.
import fs from 'node:fs';
import { recordAssetDeployment } from './lib/assetRetention.mjs';
import { RETENTION_LEDGER_FILENAME } from './lib/assetsIgnore.mjs';
const ledgerPath = new URL(`../docs/${RETENTION_LEDGER_FILENAME}`, import.meta.url);
const ledger = recordAssetDeployment(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`[assets] recorded successful deployment: ${ledger.builds.length} build(s)`);
