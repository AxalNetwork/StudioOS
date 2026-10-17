/**
 * The advisory review, start to finish, with every effect handed in.
 *
 * `../claude-review/review.mjs` supplies the real git, GitHub API and
 * Anthropic SDK; `claudeReview.test.mjs` supplies fakes, so the whole path
 * (missing secrets, a fork, an empty or oversized diff, a duplicate, a budget
 * refusal, an authentication failure, a rate limit, a refusal, a malformed
 * answer) is exercised without a key and without spending anything.
 *
 * deps:
 *   env, event, repository           the workflow's variables, the pull_request payload, owner/repo
 *   now()                            a Date
 *   nonce()                          a random hex string for the untrusted-data tags
 *   rates                            the committed rate table, already parsed
 *   github.mergeBase(base, head)     the merge base's sha
 *   github.listArtifacts(sinceIso)   { artifacts: [{ name, created_at, expired }], complete }
 *   git.fetch(sha)                   make a commit available locally (depth 1)
 *   git.diff(from, to)               unified diff text
 *   readLines(path)                  the head version's lines, or null
 *   anthropic.countTokens(params)    { input_tokens }
 *   anthropic.create(params)         the Message; errors carry `kind` (see review.mjs)
 *
 * Returns { outcome, exitCode, summary, annotations, record, findingsFile }.
 * `record` is the artifact to upload (name and JSON body) when tokens were
 * spent or a review succeeded, and null otherwise; `findingsFile` is the
 * validated findings (JSON) uploaded beside it after a successful review. Nothing the model wrote reaches stdout.
 */
import {
  REVIEW_OUTPUT_SCHEMA, SYSTEM_PROMPT, annotations, budgetDecision, buildExcerpts, buildUserMessage,
  estimateCost, estimateTokens, eventGate, mergeRates, parseUnifiedDiff, pickModel, preflightCost,
  readConfig, readLedger, recordName, renderSummary, reportable, reviewKey, selectDiff, validateReview,
} from './claudeReview.mjs';

const ERROR_OUTCOMES = new Set(['configuration_error', 'api_error', 'malformed_response', 'refused', 'truncated', 'diff_error']);

const API_ERROR_TEXT = {
  authentication: 'the credential was rejected (401). With an API key, check the ANTHROPIC_API_KEY secret; with federation, check the rule and its service account.',
  federation: 'GitHub\'s identity token could not be exchanged for an Anthropic token. Check that the job has `id-token: write`, that the federation rule matches this repository (organization AxalNetwork, repository StudioOS, event pull_request, no branch restriction), and that its service account belongs to the rule\'s workspace.',
  permission: 'the API key may not use this model or workspace (403).',
  not_found: 'the model was not found (404). Check that ANTHROPIC_MODEL names a current model.',
  bad_request: 'the request was rejected (400).',
  rate_limit: 'the API rate limit was reached (429) and the bounded retries ran out.',
  billing: 'the Anthropic account could not be billed (402): its credit balance may be exhausted. No paid key or credit was added automatically.',
  overloaded: 'the API was overloaded and the bounded retries ran out.',
  server: 'the API returned a server error and the bounded retries ran out.',
  timeout: 'the request timed out.',
  connection: 'the API could not be reached.',
  unknown: 'the API call failed.',
};

const short = (sha) => String(sha || '').slice(0, 12);
const monthOf = (d) => d.toISOString().slice(0, 7);

function finish(state, outcome, reason, extra = {}) {
  const result = {
    outcome,
    reason,
    minConfidence: state.config?.minConfidence || 'medium',
    limitations: state.limitations,
    ratesAsOf: state.rates?.as_of,
    facts: state.facts,
    ...extra,
  };
  const exitCode = state.config?.failOnError && ERROR_OUTCOMES.has(outcome) ? 1 : 0;
  return {
    outcome,
    exitCode,
    reason,
    summary: renderSummary(result),
    annotations: extra.annotations || [],
    record: extra.record || null,
    findingsFile: extra.findingsFile || null,
  };
}

export async function runReview(deps) {
  const started = deps.now();
  const state = { limitations: [], facts: {}, config: null, rates: null };
  const { config, errors } = readConfig(deps.env);
  state.config = config;
  state.rates = mergeRates(deps.rates, config.rateOverrides);

  if (!config.enabled) return finish(state, 'disabled', 'CLAUDE_REVIEW_ENABLED is not "true", so no review ran and nothing was spent');
  if (errors.length) return finish(state, 'configuration_error', errors.join('; '));

  const gate = eventGate(deps.event, { repository: deps.repository, reviewDrafts: config.reviewDrafts });
  if (!gate.run) return finish(state, 'skipped', gate.reason);
  const pr = deps.event.pull_request;
  const prInfo = { number: pr.number, title: pr.title, body: pr.body, baseRef: pr.base?.ref || 'main' };

  let mergeBase;
  let files;
  try {
    mergeBase = await deps.github.mergeBase(pr.base.sha, pr.head.sha);
    await deps.git.fetch(mergeBase);
    files = parseUnifiedDiff(await deps.git.diff(mergeBase, pr.head.sha));
  } catch (e) {
    return finish(state, 'diff_error', `the pull request's diff could not be computed: ${e?.message || 'unknown error'}`);
  }
  state.facts = { 'merge base': short(mergeBase), head: short(pr.head.sha) };

  const selection = selectDiff(files, config);
  state.facts['files changed'] = String(files.length);
  state.facts['files reviewed'] = String(selection.included.length);
  if (selection.excluded.length) state.limitations.push(`${selection.excluded.length} file(s) excluded by rule (lockfiles, build output, generated or binary files, deletions): not reviewed.`);
  if (selection.omitted.length) state.limitations.push(`${selection.omitted.length} file(s) over the size or file limits were not reviewed: ${selection.omitted.slice(0, 10).map((o) => o.path).join(', ')}${selection.omitted.length > 10 ? ', …' : ''}.`);
  if (!selection.included.length) return finish(state, 'empty_diff', files.length ? 'every changed file is excluded or over the limits, so there was nothing to send' : 'the pull request changes nothing against its merge base');

  const { model, tier } = pickModel(config, selection.highRisk);
  Object.assign(state.facts, { model, tier, effort: config.effort ?? 'default', credential: config.auth === 'federation' ? 'workload identity federation' : 'API key' });

  const key = reviewKey({ mergeBase, headSha: pr.head.sha, model, config });
  const month = monthOf(started);
  const monthStart = `${month}-01T00:00:00Z`;
  let ledger;
  try {
    const listing = await deps.github.listArtifacts(monthStart);
    ledger = readLedger(listing.artifacts, { month, key, listingComplete: listing.complete });
  } catch {
    ledger = { spentUsd: 0, duplicate: null, complete: false };
    state.limitations.push('This month\'s review records could not be read, so a repeat of an earlier review could not be detected.');
  }
  if (ledger.duplicate) {
    return finish(state, 'duplicate', `these exact inputs were already reviewed (${ledger.duplicate.name}, ${ledger.duplicate.created_at}); see that run's summary. Nothing was spent.`);
  }

  const excerpts = buildExcerpts(selection.included, deps.readLines, config);
  if (excerpts.skipped.length) state.limitations.push(`No surrounding source was sent for ${excerpts.skipped.length} file(s): ${excerpts.skipped.slice(0, 10).join(', ')}.`);
  state.facts['diff bytes'] = String(selection.bytes);
  state.facts['context bytes'] = String(excerpts.bytes);

  const userMessage = buildUserMessage({ pr: prInfo, selection, excerpts, nonce: deps.nonce() });
  const messages = [{ role: 'user', content: userMessage }];
  let inputTokens;
  try {
    const counted = await deps.anthropic.countTokens({ model, system: SYSTEM_PROMPT, messages });
    inputTokens = Math.ceil((counted.input_tokens + 400) * 1.05);
    state.facts['input tokens (counted)'] = String(counted.input_tokens);
  } catch {
    inputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(userMessage) + 400;
    state.facts['input tokens (estimated)'] = String(inputTokens);
  }

  const worstCaseUsd = preflightCost({ inputTokens, maxOutputTokens: config.maxOutputTokens, model, rates: state.rates });
  state.facts['month spend recorded'] = ledger.complete ? `$${ledger.spentUsd.toFixed(2)}` : 'unreadable';
  const budget = budgetDecision({ worstCaseUsd, maxCostUsd: config.maxCostUsd, monthlyBudgetUsd: config.monthlyBudgetUsd, ledger });
  if (!budget.allow) return finish(state, 'budget_refused', `${budget.reason}. No API call was made.`);

  const params = {
    model,
    max_tokens: config.maxOutputTokens,
    system: SYSTEM_PROMPT,
    messages,
    output_config: { format: { type: 'json_schema', schema: REVIEW_OUTPUT_SCHEMA }, ...(config.effort ? { effort: config.effort } : {}) },
  };
  if (config.refusalFallback === 'default') Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

  const record = (status, usd, extra) => {
    const name = recordName({ month, pr: pr.number, key, status, usd });
    return { name, body: JSON.stringify({ name, month, pr: pr.number, head_sha: pr.head.sha, merge_base: mergeBase, key, status, model, tier, usd, ...extra }, null, 2) };
  };

  let message;
  try {
    try {
      message = await deps.anthropic.create(params);
    } catch (e) {
      // A model or platform that does not accept server-side fallbacks rejects
      // the request outright (400, unbilled). Retry once without them.
      if (e?.kind === 'bad_request' && params.fallbacks) {
        delete params.fallbacks;
        delete params.betas;
        state.limitations.push('The request was rejected with refusal fallbacks enabled and was retried without them; set CLAUDE_REVIEW_REFUSAL_FALLBACK=off if this model does not support them.');
        message = await deps.anthropic.create(params);
      } else {
        throw e;
      }
    }
  } catch (e) {
    const kind = e?.kind || 'unknown';
    const seconds = ((deps.now() - started) / 1000).toFixed(1);
    state.facts.duration = `${seconds} s`;
    if (e?.requestId) state.facts['request id'] = e.requestId;
    // What the API or the token exchange said, already stripped of anything
    // credential-shaped by the client: the cause, where the kind alone is a guess.
    const detail = typeof e?.detail === 'string' && e.detail ? e.detail : null;
    return finish(state, 'api_error', `${API_ERROR_TEXT[kind] || API_ERROR_TEXT.unknown}${e?.status ? ` (HTTP ${e.status})` : ''}${detail ? ` The API said: ${detail}` : ''}`, {
      record: record('err', 0, { outcome: 'api_error', error_kind: kind, http_status: e?.status ?? null, error_detail: detail, duration_seconds: Number(seconds) }),
    });
  }

  const seconds = ((deps.now() - started) / 1000).toFixed(1);
  state.facts.duration = `${seconds} s`;
  if (message?._request_id) state.facts['request id'] = message._request_id;
  state.facts['stop reason'] = String(message?.stop_reason || 'unknown');
  const usage = estimateCost(message?.usage, model, state.rates);
  const usageFacts = { duration_seconds: Number(seconds), stop_reason: message?.stop_reason, usage: usage.perModel, cost_known: usage.known, fallback_ran: usage.fallbackRan };

  if (message?.stop_reason === 'refusal') {
    const category = message?.stop_details?.category ? ` (category: ${message.stop_details.category})` : '';
    return finish(state, 'refused', `the model declined to review this pull request${category}. Nothing was published as a finding.`, {
      usage, record: record('err', usage.usd, { outcome: 'refused', ...usageFacts }),
    });
  }

  const text = (message?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  const checked = validateReview(text, selection.included);
  if (!checked.ok) {
    const truncated = message?.stop_reason === 'max_tokens';
    return finish(state, truncated ? 'truncated' : 'malformed_response',
      truncated
        ? `the answer hit the output limit of ${config.maxOutputTokens} tokens before it was complete (CLAUDE_REVIEW_MAX_OUTPUT_TOKENS). Nothing was published as a finding.`
        : `the answer did not validate (${checked.errors.join('; ')}). Nothing was published as a finding.`,
      { usage, record: record('err', usage.usd, { outcome: truncated ? 'truncated' : 'malformed_response', ...usageFacts }) });
  }

  const shown = reportable(checked.review.findings, config.minConfidence);
  // The validated findings, for whoever fixes them: a person, or an agent that
  // downloads this run's artifact (a job summary cannot be read through the
  // API). Untrusted model text, already checked against the diff.
  const findingsFile = JSON.stringify({
    schema_version: checked.review.schema_version,
    pr: pr.number, head_sha: pr.head.sha, merge_base: mergeBase, model,
    status: checked.review.status, summary: checked.review.summary,
    min_confidence: config.minConfidence, findings: shown, limitations: checked.review.limitations,
  }, null, 2);
  return finish(state, 'reviewed', '', {
    review: checked.review,
    usage,
    findingsFile,
    annotations: config.annotations ? annotations(shown) : [],
    record: record('ok', usage.usd, {
      outcome: 'reviewed',
      review_status: checked.review.status,
      findings: checked.review.findings.length,
      findings_reported: shown.length,
      ...usageFacts,
    }),
  });
}
