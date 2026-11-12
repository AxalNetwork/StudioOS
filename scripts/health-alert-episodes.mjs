// D5663: issue-backed health episodes and durable delivery intent; transports are injected for tests/adapters.
import { ALERT_KINDS, message } from './lib/githubAlerts.mjs';
const marker = /\n?<!-- studioos-health:v1 ([^\n]+) -->/g;
const locks = new Map();
export function safeHealthFacts(facts = {}) {
  const out = {};
  for (const key of ['pr', 'queued', 'waitedMin', 'days', 'failedCount']) if (Number.isSafeInteger(Number(facts[key])) && Number(facts[key]) >= 0) out[key] = Number(facts[key]);
  if (/^[a-f0-9]{40}$/.test(facts.sha || '')) out.sha = facts.sha;
  if (['budget_refused', 'configuration_error', 'reviewed', 'duplicate'].includes(facts.outcome)) out.outcome = facts.outcome;
  if (/^[a-zA-Z0-9_ ()/.-]{1,200}$/.test(facts.fingerprint || '')) out.fingerprint = facts.fingerprint;
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/[1-9]\d*$/.test(facts.runUrl || '')) out.runUrl = facts.runUrl;
  return out;
}
const allowedOwners = new Set(['guillaumelauzier', 'github-actions[bot]']);
const serial = async (key, fn) => {
  const before = locks.get(key) || Promise.resolve();
  const next = before.catch(() => {}).then(fn); locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
};
const stateOf = (issue, kind) => {
  const found = [...String(issue.body || '').matchAll(marker)].at(-1);
  let value;
  try { value = found && JSON.parse(found[1]); } catch { /* malformed metadata is not an acknowledgement */ }
  if (value?.schema === 1 && value.kind === kind && Array.isArray(value.intents)
      && value.intents.every(i => ['open', 'recovery'].includes(i.phase) && ['pending', 'sending', 'acknowledged', 'retry', 'ambiguous', 'dead'].includes(i.state) && Number.isSafeInteger(i.attempts) && i.attempts >= 0)) return { ...value, episode: issue.number };
  return { schema: 1, kind, episode: issue.number, adopted: false, source: 0, intents: [{ phase: 'open', state: 'ambiguous', attempts: 0, code: 'legacy_no_receipt' }] };
};
const bodyWith = (issue, state) => `${String(issue.body || '').replace(marker, '').trim()}\n\n<!-- studioos-health:v1 ${JSON.stringify(state)} -->`;
const receipt = value => ({ transport: value?.transport === 'adapter' ? 'adapter' : 'webhook', status: 200,
  ...(typeof value?.channel === 'string' && /^[CG][A-Z0-9]{2,30}$/.test(value.channel) ? { channel: value.channel } : {}),
  ...(typeof value?.ts === 'string' && /^\d{1,20}\.\d{1,10}$/.test(value.ts) ? { ts: value.ts } : {}) });
export function createHealthMonitor({ api, deliver, repo, now = Date.now, log = () => {} }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('repository_invalid');
  const root = `/repos/${repo}`;
  const pages = async query => {
    const rows = [];
    for (let page = 1; page <= 100; page++) {
      const items = await api(`${root}/issues?per_page=100&sort=created&direction=asc&${query}&page=${page}`);
      if (!Array.isArray(items)) throw new Error('issues_response_invalid');
      rows.push(...items.filter(i => !i.pull_request));
      if (items.length < 100) return rows;
    }
    throw new Error('issues_pagination_incomplete');
  };
  const save = async (issue, state, extra = {}) => {
    const names = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name);
    const body = bodyWith(issue, state);
    const result = await api(`${root}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body, labels: [...new Set([...names, 'ci', 'observability'])], ...extra }) });
    return { ...issue, ...result, body, ...extra };
  };
  const owned = i => allowedOwners.has(i.user?.login) && Number.isSafeInteger(i.number) && i.number > 0;
  const reconcile = async (issue, state, facts) => {
    for (const intent of state.intents) {
      if (intent.state === 'sending') { intent.state = 'ambiguous'; intent.code = 'restart_after_send_started'; issue = await save(issue, state); }
      if (!['pending', 'retry'].includes(intent.state) || intent.notBefore > now()) continue;
      if (intent.attempts >= 5) { intent.state = 'dead'; intent.code = 'attempt_limit'; issue = await save(issue, state); continue; }
      intent.state = 'sending'; intent.attempts += 1; intent.lastAttempt = now(); issue = await save(issue, state);
      const key = `health:v1:${repo}:${state.kind}:${issue.number}:${intent.phase}`;
      const text = message(state.kind, intent.phase === 'open' ? 'open' : 'close', { ...safeHealthFacts(intent.facts), issueUrl: `https://github.com/${repo}/issues/${issue.number}` });
      let outcome;
      try { outcome = await deliver({ schema: 1, key, kind: state.kind, phase: intent.phase, issue: issue.number, text }); }
      catch { outcome = { state: 'ambiguous', code: 'transport_outcome_unknown' }; }
      if (outcome?.state === 'acknowledged' && outcome.receipt?.status === 200 && ['webhook', 'adapter'].includes(outcome.receipt?.transport)) { intent.state = 'acknowledged'; intent.receipt = receipt(outcome.receipt); intent.acknowledgedAt = now(); }
      else if (outcome?.state === 'retry') {
        intent.state = 'retry'; intent.code = ['rate_limited', 'provider_unavailable', 'not_configured'].includes(outcome.code) ? outcome.code : 'provider_unavailable';
        const delay = Number.isFinite(outcome.retryAfterMs) ? Math.max(1000, Math.min(86_400_000, outcome.retryAfterMs)) : 1000 * 2 ** intent.attempts;
        intent.notBefore = now() + delay;
      } else { intent.state = outcome?.state === 'dead' ? 'dead' : 'ambiguous'; intent.code = intent.state === 'dead' ? 'destination_refused' : 'transport_outcome_unknown'; }
      issue = await save(issue, state);
      log({ kind: state.kind, issue: issue.number, phase: intent.phase, delivery: intent.state, attempt: intent.attempts });
    }
    return issue;
  };
  return {
    async apply(kind, active, facts = {}, source = now()) {
      if (!ALERT_KINDS[kind] || ![true, false, null].includes(active) || !Number.isFinite(source)) throw new Error('health_observation_invalid');
      facts = safeHealthFacts(facts);
      return serial(`${repo}:${kind}`, async () => {
        let known = (await pages('state=all&labels=ci%2Cobservability')).filter(i => owned(i) && i.title === ALERT_KINDS[kind].title);
        let open = known.filter(i => i.state === 'open');
        if (!open.some(i => stateOf(i, kind).adopted)) {
          const legacy = (await pages('state=open')).filter(i => owned(i) && i.title === ALERT_KINDS[kind].title);
          known = [...new Map([...known, ...legacy].map(i => [i.number, i])).values()]; open = known.filter(i => i.state === 'open');
        }
        open.sort((a, b) => a.number - b.number);
        let issue = open[0], state = issue && stateOf(issue, kind);
        if (issue) {
          state.adopted = true; state.duplicates = [...new Set([...(state.duplicates || []), ...open.slice(1).map(i => i.number)])];
          issue = await save(issue, state);
          for (const duplicate of open.slice(1)) {
            const d = { schema: 1, kind, episode: duplicate.number, duplicateOf: issue.number, intents: [], adopted: true, source };
            await save({ ...duplicate, body: `${duplicate.body || ''}\n\nReconciled duplicate of #${issue.number}; authoritative episode retained there.` }, d, { state: 'closed', state_reason: 'not_planned' });
          }
        }
        const newest = Math.max(0, ...known.map(i => Number(stateOf(i, kind).source) || 0));
        if (active === true && !issue && source > newest) {
          state = { schema: 1, kind, episode: null, adopted: true, source, intents: [{ phase: 'open', state: 'pending', attempts: 0, facts }] };
          issue = await api(`${root}/issues`, { method: 'POST', body: JSON.stringify({ title: ALERT_KINDS[kind].title, body: bodyWith({ body: message(kind, 'open', facts) }, state), labels: ['ci', 'observability'] }) });
          state.episode = issue.number; issue = await save(issue, state);
        }
        if (issue && source >= (state.source || 0)) {
          if (active !== null) state.source = source;
          if (active === false) {
            if (!state.intents.some(i => i.phase === 'recovery')) state.intents.push({ phase: 'recovery', state: 'pending', attempts: 0, facts });
            issue = await save(issue, state, { state: 'closed', state_reason: 'completed' });
          } else issue = await save(issue, state);
        }
        if (issue) await reconcile(issue, state, facts);
        for (const closed of known.filter(i => i.state === 'closed' && i.number !== issue?.number)) {
          const s = stateOf(closed, kind);
          if (s.adopted && !s.duplicateOf) await reconcile(closed, s, facts);
        }
        return { issue: issue?.number || null, active, delivery: state?.intents.map(i => ({ phase: i.phase, state: i.state })) || [] };
      });
    },
    async openIssue(kind) {
      const list = await pages('state=open');
      return list.filter(i => owned(i) && i.title === ALERT_KINDS[kind]?.title).sort((a, b) => a.number - b.number)[0] || null;
    },
  };
}
