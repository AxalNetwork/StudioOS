// D5530: the @claude workflow's federation identifiers, read and checked before the action runs.
/**
 * `claude-code.yml` authenticates to the Claude API by workload identity
 * federation (#5530, owner answer B): the action exchanges the job's GitHub
 * OIDC token for a short-lived Anthropic token. No API key is stored.
 *
 * It has its own rule, so it reads its own repository variables, prefixed
 * `CLAUDE_CODE_`. The advisory review's rule (`ANTHROPIC_FEDERATION_RULE_ID`)
 * matches pull-request runs only; the @claude workflow runs on comments and
 * issues, whose token carries the default branch, so that rule refuses it.
 *
 * The shapes are checked by the review's own `readFederation`, so the two
 * workflows can never disagree on what a rule or organization ID looks like.
 */
import { readFederation } from './claudeReview.mjs';

export const CLAUDE_CODE_VARIABLES = Object.freeze({
  CLAUDE_CODE_FEDERATION_RULE_ID: 'ANTHROPIC_FEDERATION_RULE_ID',
  CLAUDE_CODE_ORGANIZATION_ID: 'ANTHROPIC_ORGANIZATION_ID',
  CLAUDE_CODE_SERVICE_ACCOUNT_ID: 'ANTHROPIC_SERVICE_ACCOUNT_ID',
  CLAUDE_CODE_WORKSPACE_ID: 'ANTHROPIC_WORKSPACE_ID',
});

/**
 * Returns `{ federation, errors }`. `federation` is null whenever `errors` is
 * not empty. Error text names variables, never their values.
 */
export function readClaudeCodeFederation(env = {}) {
  const mapped = {};
  for (const [ours, theirs] of Object.entries(CLAUDE_CODE_VARIABLES)) mapped[theirs] = env[ours];
  const errors = [];
  const federation = readFederation(mapped, errors);
  const named = errors.map((e) => {
    let out = e;
    for (const [ours, theirs] of Object.entries(CLAUDE_CODE_VARIABLES)) out = out.split(theirs).join(ours);
    return out;
  });
  if (!federation && named.length === 0) named.push('CLAUDE_CODE_FEDERATION_RULE_ID is not set');
  return { federation: named.length ? null : federation, errors: named };
}

export const REMEDIATION = `The @claude workflow authenticates by workload identity federation; it holds no API key.
Set these repository variables (Settings -> Secrets and variables -> Actions -> Variables):
  CLAUDE_CODE_FEDERATION_RULE_ID   fdrl_...  (required)
  CLAUDE_CODE_ORGANIZATION_ID      the organization UUID (required)
  CLAUDE_CODE_SERVICE_ACCOUNT_ID   svac_...  (optional)
  CLAUDE_CODE_WORKSPACE_ID         wrkspc_... (optional when the rule targets one workspace)
The rule's setup is in documentation/operations/CLAUDE_REVIEW.md section 4b.`;
