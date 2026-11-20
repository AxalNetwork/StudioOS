# Free repository security — D7899

Maintain the owner's free-only, no-GitHub-AI baseline for `AxalNetwork/StudioOS`.
This runbook governs repository controls and security workflows. It does not
authorize production deployment, a paid subscription, new alert readers or
external model usage.

## Baseline and cost boundary

StudioOS is public. GitHub documents free public-repository code scanning,
secret scanning and dependency review, and free standard hosted Actions runners.
Use `ubuntu-latest` for the new workflows. Reassess eligibility before changing
repository visibility; do not enable a paid license to resolve an upload error.
The Scorecard job refuses private or unknown-visibility events.

| Control | Intended state | Reason |
| --- | --- | --- |
| Secret scanning | On | Detect supported provider secrets. |
| Push protection | On | Block supported secrets before a push is accepted. |
| GitHub generic patterns | Original off state | Feature-specific docs require Secret Protection; use the existing free Gitleaks default rules. |
| Advanced CodeQL setup | Existing workflow | Preserve language coverage and avoid duplicate default setup. |
| Semgrep OSS and Gitleaks | Existing workflows | Keep deterministic source and secret scanning. |
| Dependency graph, Dependabot alerts and malware alerts | On | Track dependency risk. |
| Dependabot security updates and grouped security updates | On | Open reviewable update PRs; this does not auto-merge them or use Copilot. |
| Private vulnerability reporting | On | Keep reports out of public issues. |
| Copilot Autofix, AI-detected secrets, Secret Protection AI Scan | Off | Owner excludes GitHub AI and generated fixes. |
| Copilot automatic-review ruleset and Code Quality | Disabled | No additional GitHub AI review product. |
| External-license Copilot reviews | Blocked | Prevent personal/external licenses from requesting repository reviews. |
| Copilot automations, shared automations and code-review validation | Off | Disable these repository AI execution paths. |
| Validity checks | Off | Optional partner verification is not needed for basic leak detection. |
| GitHub custom secret patterns and delegated bypass | Not added | Free public eligibility is not established by feature-specific documentation. Use Gitleaks for the Axal format. |
| Protected/direct-alert-dismissal controls | Original off state | Avoid introducing entitlement-dependent controls without confirmed free eligibility. |

The settings were inspected on 2026-11-20. Treat this as a dated baseline,
not a guarantee that later organization policy cannot change a switch. The
existing deterministic Dependabot low-impact development-alert preset remains
in place; the new dependency gate still checks high/critical development risks.
Push protection still allows the repository's existing write-access bypass
policy. This work does not claim delegated bypass enforcement.

## Workflow behavior

| Workflow | Event | Result |
| --- | --- | --- |
| `dependency-review.yml` | All PRs to main, including drafts; merge groups | Fail new high/critical vulnerabilities across runtime, development and unknown dependency scopes. |
| `ossf-scorecard.yml` | Saturday 04:23 UTC; manual on public main | Advisory posture findings in code scanning; upload only after a successful scan. |
| `scan-remediation.yml` | Existing two-hour schedule; successful main-scan or manual dispatch | Reconcile scanner alerts with S21 trackers using issue-write permission only. |
| `gitleaks.yml` | Existing PR, merge-group and main coverage | Required `scan` context; includes the project-specific bearer rule. |

Dependency Review reads the graph diff for the event's immutable base/head. It
does not check out or run PR code, install dependencies, comment, or fix code.
Its action's separate external Scorecard lookup is off. The advisory Scorecard
workflow has no external publication, OIDC permission, extra secret or artifact
upload. Its SARIF upload requires security-events-write on trusted public main.

## Roll out the new required check safely

1. Land D7899 through the existing required checks and merge queue. This is a
   security/workflow change; follow the current T2 owner-landing policy.
2. Verify a real PR run reports the exact **Dependency Review** check context.
   Confirm its event SHAs, read-only authority and action result. A passing
   empty diff confirms execution, not the absence of older vulnerable packages.
3. Verify the same workflow on a real `merge_group.checks_requested` candidate.
   Its comparison must use `merge_group.base_sha` and `merge_group.head_sha`.
   If it cannot evaluate the queue event, fix it before requiring the context.
4. Once the workflow is present on main and old queue candidates have drained,
   add **Dependency Review**, provided by GitHub Actions, to the existing main
   ruleset. Preserve all six existing required checks and the required queue.
   Update `scripts/lib/requiredChecks.mjs`, the mirrored queue contract test and
   generated workflow inventory in the same follow-up.
5. Observe the first enforced PR and queue result. Keep Scorecard advisory.
   Do not make path-scoped CodeQL/Semgrep jobs universally required without a
   separate design ensuring that every candidate emits those contexts.

If the new check has a service/configuration failure, remove only the newly
added required context while fixing the workflow. Preserve the existing queue,
Gitleaks, migration and CI requirements. Never use an admin bypass or push main.

## Handle findings without generated fixes

The reconciler creates/updates protected-evidence issue trackers, routes eligible
work to S21 and respects existing assignees and atomic task claims. It can link
an existing same-repository PR, including a legacy remediation branch, but cannot
create or modify a branch or PR. A merged PR is not sufficient to close a finding:
the default-branch scanner must confirm resolution.

Review the alert in the protected Security tab, claim the appropriate tracker,
implement a scoped fix and run the relevant tests. Keep credential values and
private evidence out of public issue/PR bodies. Leaked real credentials require
revocation/rotation; deleting a literal alone is not remediation.

The Axal Gitleaks rule matches a complete bearer, not its public prefix.
Identifier-name and versioned-enum exemptions are scoped to the inherited
generic-key detector so they cannot suppress the dedicated bearer/JWT rules.
Other existing global allowlists still apply. Add new exceptions only for demonstrably synthetic
exact fixtures; do not reinstate the removed blanket JWT-header exemption.

## Sources and maintenance

- [GitHub security billing and free public features](https://docs.github.com/en/billing/concepts/product-billing/github-advanced-security).
- [Standard GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).
- [Generic secret-pattern eligibility](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enabling-secret-scanning-for-generic-patterns).
- [Custom secret-pattern eligibility](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/customize-leak-detection/define-custom-patterns).
- [Protected secret-alert dismissal licensing announcement](https://github.blog/changelog/2025-06-10-delegated-alert-dismissal-for-secret-protection-is-generally-available/).
- [Dependency Review v5 event resolver](https://github.com/actions/dependency-review-action/blob/a1d282b36b6f3519aa1f3fc636f609c47dddb294/src/git-refs.ts).
- [Scorecard action v2.6.0](https://github.com/ossf/scorecard-action/releases/tag/v2.6.0) and [Scorecard v5.7.0 security/failure fixes](https://github.com/ossf/scorecard/releases/tag/v5.7.0).

Dependency Review has its registered workflow ID in the local notification
registry. Scorecard remains pending (`id: null`) until GitHub registers it on
main; resolve that ID after registration. This task does not create Slack
channels or send messages to them. Existing Claude/Codex integrations are outside
the GitHub-AI setting scope; no new model integration is enabled here.
