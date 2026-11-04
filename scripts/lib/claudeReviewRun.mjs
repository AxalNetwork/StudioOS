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
 *   fallbacks[id].create(params)     the credit fallback chain's clients, by step id (claude2,
 *                                    claude3, kimi); used when earlier accounts are unavailable or fail
 *
 * Returns { outcome, exitCode, summary, annotations, record, findingsFile }.
 * `record` is the artifact to upload (name and JSON body) when tokens were
 * spent or a review succeeded, and null otherwise; `findingsFile` is the
 * validated findings (JSON) uploaded beside it after a successful review. Nothing the model wrote reaches stdout.
 */
import {
  REVIEW_OUTPUT_SCHEMA, SYSTEM_PROMPT, annotations, budgetDecision, buildExcerpts, buildUserMessage,
  creditExhausted, estimateCost, fallbackRequest, unfence, estimateTokens, eventGate, mergeRates, parseUnifiedDiff, pickModel, preflightCost,
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

const CLAUDE_FALLBACK_ERROR_TEXT = {
  authentication: 'its key was rejected (401). Check the <secret> repository secret.',
  permission: 'its key may not use this model or workspace (403).',
};

/** One fallback account's failure, in a sentence with its HTTP status and what the API said. */
function stepFailure(e, step) {
  const kind = e?.kind || 'unknown';
  const base = step.provider === 'openai'
    ? ({ authentication: 'the OpenAI key was rejected (401). Check OPENAI_API_KEY.', billing: 'the OpenAI account has insufficient quota or billing credit.', not_found: 'the OpenAI model was not found; check OPENAI_MODEL.', bad_request: 'the OpenAI request was rejected (400).' }[kind] || API_ERROR_TEXT[kind] || API_ERROR_TEXT.unknown)
    : step.provider === 'kimi'
    ? (KIMI_ERROR_TEXT[kind] || API_ERROR_TEXT[kind] || API_ERROR_TEXT.unknown)
    : (CLAUDE_FALLBACK_ERROR_TEXT[kind] || API_ERROR_TEXT[kind] || API_ERROR_TEXT.unknown).replace('<secret>', step.secret);
  const detail = typeof e?.detail === 'string' && e.detail ? ` The API said: ${e.detail}` : '';
  return `${base}${e?.status ? ` (HTTP ${e.status})` : ''}${detail}`;
}

const KIMI_ERROR_TEXT = {
  authentication: 'the Kimi key was rejected (401). Check the KIMI_API_KEY repository secret.',
  not_found: 'the Kimi model was not found (404). Check that KIMI_MODEL names a model your Kimi account offers.',
  billing: 'the Kimi account could not be billed (402): its balance may be used up too.',
  bad_request: 'the Kimi request was rejected (400).',
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
  const jobStart = Date.parse(deps.env.CLAUDE_REVIEW_JOB_STARTED_AT || '') || +started;
  const { config, errors } = readConfig(deps.env);
  state.config = config;
  const deadline = jobStart + (config.jobSeconds - 60) * 1000;
  const left = () => deadline - +deps.now();
  const deadlineError = () => Object.assign(new Error('review deadline'), { kind: 'deadline' });
  state.rates = mergeRates(deps.rates, config.rateOverrides);

  if (!config.enabled) return finish(state, 'disabled', 'CLAUDE_REVIEW_ENABLED is not "true", so no review ran and nothing was spent');
  if (errors.length) return finish(state, 'configuration_error', errors.join('; '));

  const gate = eventGate(deps.event, { repository: deps.repository, reviewDrafts: config.reviewDrafts });
  if (!gate.run) return finish(state, 'skipped', gate.reason);
  const pr = deps.event.pull_request;
  const body = String(pr.body || deps.env.CLAUDE_REVIEW_PR_BODY || '');
  // Inspect only the PR's own Agent section, never dependency or regression prose.
  const agentSection = /^##[ \t]+Agent[ \t]*\r?\n([\s\S]*?)(?=^#{1,6}[ \t]|$(?![\s\S]))/im.exec(body)?.[1] || '';
  const agentLine = agentSection.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).find(line => line.trim())?.trim() || '';
  let commitMarkers = [];
  try { commitMarkers = await deps.git.authorMarkers?.(pr.head.sha) || []; } catch { /* branch and Agent section remain available */ }
  const codexAuthored = /^codex\//i.test(pr.head?.ref || deps.env.CLAUDE_REVIEW_PR_HEAD || '') || /^(?:S\d+\s*[·:|—-]\s*)?Codex\b/i.test(agentLine) || /codex/i.test(pr.user?.login || deps.env.CLAUDE_REVIEW_PR_AUTHOR || '') || commitMarkers.some(marker => /\bcodex\b/i.test(String(marker)));
  const eligibleFallbacks = config.creditFallbacks || [];
  const mainUnavailable = !config.auth ? 'ANTHROPIC_API_KEY is not set and federation is not configured' : !config.model ? 'ANTHROPIC_MODEL is not set' : null;
  const fallbackOff = String(deps.env.CLAUDE_REVIEW_CREDIT_FALLBACK || '').trim().toLowerCase() === 'off';
  if (mainUnavailable) state.limitations.push(`Claude skipped: ${mainUnavailable}.`);
  if (fallbackOff) state.limitations.push('The fallback chain is off (CLAUDE_REVIEW_CREDIT_FALLBACK=off).');
  else for (const [label, key, modelKey] of [['Claude account 2', 'ANTHROPIC_API_KEY_2'], ['Claude account 3', 'ANTHROPIC_API_KEY_3'], ['OpenAI', 'OPENAI_API_KEY', 'OPENAI_MODEL'], ['Kimi', 'KIMI_API_KEY']]) {
    if (!String(deps.env[key] || '').trim()) state.limitations.push(`${label} skipped: ${key} is not set.`);
    else if (modelKey && !String(deps.env[modelKey] || '').trim()) state.limitations.push(`${label} skipped: ${modelKey} is not set.`);
  }
  if (mainUnavailable && !eligibleFallbacks.some(step => deps.fallbacks?.[step.id])) return finish(state, 'skipped', 'No configured review account is available. Nothing was spent.');
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
  let listing = null;
  try {
    listing = await deps.github.listArtifacts(monthStart);
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
    if (mainUnavailable) throw new Error('main account unavailable for token counting');
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
  // The main account's own cap reached is, for the chain, the same as its
  // credit running out: skip the call and let the next account review.
  const hasChain = eligibleFallbacks.some((step) => deps.fallbacks?.[step.id]);
  if (!mainUnavailable && !budget.allow && !hasChain) return finish(state, 'budget_refused', `${budget.reason}. No API call was made.`);
  const mainSkipped = mainUnavailable || (budget.allow ? null : budget.reason);

  const params = {
    model,
    max_tokens: config.maxOutputTokens,
    system: SYSTEM_PROMPT,
    messages,
    output_config: { format: { type: 'json_schema', schema: REVIEW_OUTPUT_SCHEMA }, ...(config.effort ? { effort: config.effort } : {}) },
  };
  if (config.refusalFallback === 'default') Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

  // Who answered: the main Claude account, or the first step of the credit
  // fallback chain whose account still has credit. Every run starts with the
  // main account, so reviews return to it as soon as its credit does.
  let provider = 'anthropic';
  let account = 'Claude';
  let usedModel = model;
  // A review by another model is recorded under that model's key, so it never
  // counts as a duplicate of a Claude review: once Claude's credit is back, it
  // reviews the same inputs again.
  let recordKey = key;
  let accountId = null;
  const costs = new Map();
  let lastRecord = null;
  const record = (status, usd, extra) => {
    usd += costs.get(accountId) || 0;
    const name = recordName({ month, pr: pr.number, key: recordKey, status, usd, account: accountId, runId: deps.env.CLAUDE_REVIEW_RUN_ID || deps.env.GITHUB_RUN_ID, runAttempt: deps.env.CLAUDE_REVIEW_RUN_ATTEMPT || deps.env.GITHUB_RUN_ATTEMPT || '1' });
    const saved = { name, body: JSON.stringify({ name, month, pr: pr.number, head_sha: pr.head.sha, merge_base: mergeBase, key: recordKey, status, model: usedModel, provider, account, account_id: accountId, tier, usd, ...extra, cost_known: (extra?.cost_known ?? true) && !(costs.get(accountId) > 0) }, null, 2) };
    lastRecord = saved;
    deps.persistRecord?.(saved);
    return saved;
  };
  const chain = eligibleFallbacks.filter((step) => deps.fallbacks?.[step.id]);

  // SDK retries are disabled: every paid attempt is reserved on disk before
  // spending and bounded by the one deadline, including retries and fallbacks.
  const paidCall = async (client, request) => {
    const worst = preflightCost({ inputTokens, maxOutputTokens: config.maxOutputTokens, model: usedModel, rates: state.rates });
    for (let retry = 0; ; retry += 1) {
      const remaining = left();
      if (remaining < 60_000) throw deadlineError();
      const prior = costs.get(accountId) || 0;
      const ownLedger = listing ? readLedger(listing.artifacts, { month, key, listingComplete: listing.complete, account: accountId || 'main' }) : ledger;
      const allowed = config.maxCostUsd > 0 && prior + worst > config.maxCostUsd ? { allow: false, reason: 'retry would exceed the per-review cap' } : budgetDecision({ worstCaseUsd: worst, maxCostUsd: config.maxCostUsd, monthlyBudgetUsd: config.monthlyBudgetUsd, ledger: { ...ownLedger, spentUsd: ownLedger.spentUsd + prior } });
      if (!allowed.allow) throw Object.assign(new Error('attempt budget'), { kind: 'billing', detail: allowed.reason });
      record('err', worst, { outcome: 'api_error', error_kind: 'deadline', reason: 'deadline', cost_known: false });
      try {
        return await client.create(request, { timeout: Math.min(config.timeoutSeconds * 1000, remaining), maxRetries: 0, signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(config.timeoutSeconds * 1000, remaining)))) });
      } catch (e) {
        const uncertain = e?.streamStarted === true || !['authentication', 'federation', 'permission', 'not_found', 'bad_request', 'rate_limit', 'billing'].includes(e?.kind);
        record('err', uncertain ? worst : 0, { outcome: 'api_error', error_kind: e?.kind || 'unknown', cost_known: !uncertain });
        costs.set(accountId, prior + (uncertain ? worst : 0));
        if (left() < 60_000) throw deadlineError();
        if (retry >= config.maxRetries || !['rate_limit', 'timeout', 'connection', 'server', 'overloaded'].includes(e?.kind)) throw e;
      }
    }
  };

  // The main account's call, with the one retry without refusal fallbacks
  // when the platform rejects them (a plain 400, unbilled). A credit refusal
  // on either attempt reaches the chain below.
  const mainCall = async () => {
    try {
      return await paidCall(deps.anthropic, params);
    } catch (e) {
      if (creditExhausted(e) || !(e?.kind === 'bad_request' && params.fallbacks)) throw e;
      delete params.fallbacks;
      delete params.betas;
      state.limitations.push('The request was rejected with refusal fallbacks enabled and was retried without them; set CLAUDE_REVIEW_REFUSAL_FALLBACK=off if this model does not support them.');
      return await paidCall(deps.anthropic, params);
    }
  };

  let message;
  try {
    try {
      if (mainSkipped) throw Object.assign(new Error('main account over its budget'), { kind: 'billing', mainSkipped });
      message = await mainCall();
    } catch (e) {
      if (e?.kind === 'deadline' || !chain.length) throw e;
      // The main account refused before doing any work (unbilled): its credit
      // is used up. Walk the chain; a step that is out of credit too passes
      // the review on, any other failure stops here.
      let failed = e;
      const empty = e?.mainSkipped ? (mainUnavailable ? [] : ['Claude (its monthly review budget is used)']) : creditExhausted(e) ? ['Claude'] : [];
      if (e?.mainSkipped) state.limitations.push(`Claude was not called: ${e.mainSkipped}.`);
      // A fallback account that cannot be used (a bad key, a key with no
      // workspace, no rate, its own budget spent) is skipped with its reason,
      // never the end of the chain: the accounts after it still get their turn.
      const skipped = mainUnavailable ? [`Claude skipped: ${mainUnavailable}`] : !e?.mainSkipped && !creditExhausted(e) ? [`Claude failed: ${stepFailure(e, { provider: 'anthropic', secret: 'ANTHROPIC_API_KEY' })}`] : [];
      let onlyBudget = true;
      for (const step of chain) {
        provider = step.provider;
        account = step.label;
        usedModel = step.provider === 'anthropic' ? model : step.model;
        accountId = step.id;
        recordKey = key;
        // Each account has its own balance, so its own month: bound this
        // step by the per-review cap and by what this account has spent.
        const worst = preflightCost({ inputTokens, maxOutputTokens: config.maxOutputTokens, model: usedModel, rates: state.rates });
        const stepLedger = listing ? readLedger(listing.artifacts, { month, key, listingComplete: listing.complete, account: step.id }) : { spentUsd: 0, duplicate: null, complete: false };
        const allowed = budgetDecision({ worstCaseUsd: worst, maxCostUsd: config.maxCostUsd, monthlyBudgetUsd: config.monthlyBudgetUsd, ledger: stepLedger });
        if (step.provider === 'anthropic' && !model) { skipped.push(`${account} was not called: ANTHROPIC_MODEL is not set`); continue; }
        if (!allowed.allow) {
          skipped.push(`${account} was not called: ${allowed.reason}`);
          continue;
        }
        if (usedModel !== model) {
          recordKey = reviewKey({ mergeBase, headSha: pr.head.sha, model: usedModel, config });
          const earlier = listing ? readLedger(listing.artifacts, { month, key: recordKey, listingComplete: listing.complete }).duplicate : null;
          if (earlier) {
            return finish(state, 'duplicate', `${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} out of credit, and ${account} already reviewed these exact inputs (${earlier.name}, ${earlier.created_at}); see that run's summary. Nothing was spent.`);
          }
        }
        const request = step.provider === 'anthropic'
          ? (({ betas, fallbacks, ...rest }) => rest)(params)
          : fallbackRequest(params, usedModel);
        try {
          message = await paidCall(deps.fallbacks[step.id], request);
          failed = null;
          break;
        } catch (e2) {
          if (e2?.kind === 'deadline') throw e2;
          failed = e2;
          if (creditExhausted(e2)) { empty.push(step.label); continue; }
          onlyBudget = false;
          skipped.push(`${account} failed: ${stepFailure(e2, step)}`);
        }
      }
      if (failed) {
        const out = `${empty.length ? `${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} out of credit` : 'The earlier accounts were unavailable'}${skipped.length ? `; ${skipped.join('; ')}` : ''}.`;
        if (skipped.length && onlyBudget) return finish(state, 'budget_refused', `${out} No API call was made to them.`);
        throw Object.assign(failed, { chainSummary: out });
      }
      Object.assign(state.facts, { model: usedModel, account: `${account} (credit fallback)`, ...(provider === 'anthropic' ? {} : { effort: 'n/a' }) });
      state.limitations.push(`Reviewed by ${account} (${usedModel}) because ${empty.length ? `${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} out of credit` : 'earlier accounts were unavailable'}. The next review tries the main Claude account first again.`);
      if (skipped.length) state.limitations.push(`Skipped on the way: ${skipped.join('; ')}.`);
    }
  } catch (e) {
    const kind = e?.kind || 'unknown';
    if (kind === 'deadline') return finish(state, 'api_error', 'Stopped at the time limit; the cost of the cut-off attempt is counted at its worst case.', { record: lastRecord });
    const seconds = ((deps.now() - started) / 1000).toFixed(1);
    state.facts.duration = `${seconds} s`;
    if (e?.requestId) state.facts['request id'] = e.requestId;
    // What the API or the token exchange said, already stripped of anything
    // credential-shaped by the client: the cause, where the kind alone is a guess.
    const detail = typeof e?.detail === 'string' && e.detail ? e.detail : null;
    if (typeof e?.chainSummary === 'string') {
      // The chain ran out: every account is out of credit, skipped or failed,
      // each named with its reason above.
      return finish(state, 'api_error', `No account in the credit fallback chain could review: ${e.chainSummary} Credit has to be added to one of them, or the failing account fixed.`, {
        record: record('err', 0, { outcome: 'api_error', error_kind: kind, http_status: e?.status ?? null, error_detail: detail, duration_seconds: Number(seconds) }),
      });
    }
    return finish(state, 'api_error', `${API_ERROR_TEXT[kind] || API_ERROR_TEXT.unknown}${e?.status ? ` (HTTP ${e.status})` : ''}${detail ? ` The API said: ${detail}` : ''}`, {
      record: record('err', 0, { outcome: 'api_error', error_kind: kind, http_status: e?.status ?? null, error_detail: detail, duration_seconds: Number(seconds) }),
    });
  }

  const reviewNotice = provider === 'openai' && codexAuthored ? "Reviewed by OpenAI, the same vendor as the PR's author. This is not a cross-vendor review under AGENTS.md." : null;
  if (reviewNotice) state.limitations.push(reviewNotice);
  const seconds = ((deps.now() - started) / 1000).toFixed(1);
  state.facts.duration = `${seconds} s`;
  if (message?._request_id) state.facts['request id'] = message._request_id;
  state.facts['stop reason'] = String(message?.stop_reason || 'unknown');
  let usage = estimateCost(message?.usage, usedModel, state.rates);
  if (!Number.isFinite(message?.usage?.input_tokens) || !Number.isFinite(message?.usage?.output_tokens)) {
    // No token counts (more likely from a compatible endpoint than from
    // Anthropic): record the worst case, never $0, so the month's budget
    // keeps counting.
    const worst = preflightCost({ inputTokens, maxOutputTokens: config.maxOutputTokens, model: usedModel, rates: state.rates });
    usage = { ...usage, usd: worst ?? usage.usd, known: false };
    state.limitations.push('The answer carried no token counts, so its worst case was recorded as its cost.');
  }
  const usageFacts = { duration_seconds: Number(seconds), stop_reason: message?.stop_reason, usage: usage.perModel, cost_known: usage.known, fallback_ran: usage.fallbackRan };

  if (message?.stop_reason === 'refusal') {
    const category = message?.stop_details?.category ? ` (category: ${message.stop_details.category})` : '';
    return finish(state, 'refused', `the model declined to review this pull request${category}. Nothing was published as a finding.`, {
      usage, record: record('err', usage.usd, { outcome: 'refused', ...usageFacts }),
    });
  }

  const joined = (message?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  // Kimi has no structured output, so its answer may arrive in a code fence.
  const text = provider === 'kimi' ? unfence(joined) : joined;
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
    pr: pr.number, head_sha: pr.head.sha, merge_base: mergeBase, model: usedModel, provider, account,
    status: checked.review.status, summary: reviewNotice ? `${reviewNotice}\n\n${checked.review.summary}` : checked.review.summary, same_vendor: !!reviewNotice, review_notice: reviewNotice,
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
