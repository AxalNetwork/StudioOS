#!/usr/bin/env node
/**
 * D5530 (#5530): the @claude workflow's preflight. It fails with a readable
 * message when the federation variables are missing or malformed, instead of
 * letting the action fail later with a generic authentication error. It prints
 * which identifiers are present, never their values.
 *
 * Usage (the workflow passes the variables through `env:`):
 *   node scripts/check-claude-code-federation.mjs
 */
import { readClaudeCodeFederation, REMEDIATION } from './lib/claudeCodeFederation.mjs';

const { federation, errors } = readClaudeCodeFederation(process.env);
if (!federation) {
  for (const e of errors) console.error(`ERROR: ${e}.`);
  console.error(`\n${REMEDIATION}`);
  process.exit(1);
}
const present = ['rule', 'organization', federation.serviceAccountId && 'service account', federation.workspaceId && 'workspace'].filter(Boolean);
console.log(`Claude Code federation is configured (${present.join(', ')}).`);
