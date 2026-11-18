// #6473: the SDK adapters (three Claude accounts, Codex, Gemini) and the one map of the secret and variable names they read.
/**
 * Each adapter drives its SDK's tool-calling loop with the workspace tools
 * only. The SDKs are this folder's own pinned dependencies (package.json),
 * imported lazily so the pure modules and their tests need no install.
 *
 * Claude prefers workload identity federation: with the four
 * ANTHROPIC_*_ID variables set in the `repair` environment, the job's OIDC
 * token is exchanged per run and ANTHROPIC_API_KEY is not read.
 */
import { readFederation } from '../../lib/claudeReview.mjs';

/** Every credential and setting the runner reads, in one place. The owner confirmed these names on #6473. */
export const NAMES = Object.freeze({
  claude: Object.freeze({ secret: 'ANTHROPIC_API_KEY', model: 'LANDING_BOT_CLAUDE_MODEL', federation: ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID'] }),
  // Audit 2026-11-17 (P1): the review loop's two further Claude accounts (CLAUDE_REVIEW.md §6a). Key only, no federation.
  'claude-2': Object.freeze({ secret: 'ANTHROPIC_API_KEY_2', model: 'LANDING_BOT_CLAUDE_MODEL' }),
  'claude-3': Object.freeze({ secret: 'ANTHROPIC_API_KEY_3', model: 'LANDING_BOT_CLAUDE_MODEL' }),
  codex: Object.freeze({ secret: 'OPENAI_API_KEY', model: 'LANDING_BOT_OPENAI_MODEL' }),
  gemini: Object.freeze({ secret: 'GEMINI_API_KEY', model: 'LANDING_BOT_GEMINI_MODEL' }),
  order: 'LANDING_BOT_PROVIDERS',
});
export const DEFAULT_MODELS = Object.freeze({ claude: 'claude-opus-5-5', codex: 'gpt-5.3-codex', gemini: null });
const MAX_OUTPUT = 16_000;
const OIDC_AUDIENCE = 'https://api.anthropic.com';

const read = (env, k) => String(env[k] ?? '').trim();

/** JSON schema for one tool from TOOL_SPECS's small param notation. */
export function schemaOf(spec) {
  const properties = {};
  const required = [];
  for (const [k, t] of Object.entries(spec.params)) {
    const optional = t.endsWith('?');
    properties[k] = { type: optional ? t.slice(0, -1) : t };
    if (!optional) required.push(k);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Kinds for errors no SDK classifies by status: federation and GitHub identity failures. */
function federationKind(e) {
  for (let c = e, d = 0; c && d < 4; c = c.cause, d += 1) {
    if (c?.name === 'WorkloadIdentityError' || c?.name === 'GithubIdentityError') return 'federation';
  }
  return null;
}
// An account that is out of credit: Anthropic answers 400 "credit balance" or 429 enforced_spend_limit_reached.
const creditRefusal = (e) => (e?.status === 400 && /credit balance/i.test(String(e?.error?.error?.message ?? e?.message ?? '')))
  || (e?.error?.error?.details?.error_code ?? e?.error?.details?.error_code) === 'enforced_spend_limit_reached';
const tagged = (e) => {
  const kind = federationKind(e);
  if (kind) { const out = new Error(`federation failed`); out.kind = kind; return out; }
  if (['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(e?.code || e?.error?.code) || creditRefusal(e)) { const out = new Error('billing'); out.kind = 'billing'; return out; }
  // Keep status and code only: an SDK error's message can quote a request.
  const out = new Error(`provider error${e?.status ? ` (HTTP ${e.status})` : ''}`);
  out.status = e?.status; out.code = e?.code;
  return out;
};

function githubIdentityToken(env) {
  return async () => {
    const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    const fail = (m) => { const e = new Error(m); e.name = 'GithubIdentityError'; return e; };
    if (!url || !bearer) throw fail('GitHub issued no identity token: the job needs id-token: write');
    const u = new URL(url);
    u.searchParams.set('audience', OIDC_AUDIENCE);
    const res = await fetch(u, { headers: { Authorization: `bearer ${bearer}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw fail(`identity token request failed (HTTP ${res.status})`);
    const body = await res.json().catch(() => null);
    if (typeof body?.value !== 'string' || !body.value) throw fail('GitHub returned no identity token');
    return body.value;
  };
}

/** One Claude account. `claude` is the primary (federation preferred, else its key); `claude-2` and `claude-3` use their keys. */
function claude(env, importSdk, name = 'claude') {
  const names = NAMES[name];
  const fedErrors = [];
  const federation = name === 'claude' ? readFederation(env, fedErrors) : null;
  const apiKey = read(env, names.secret);
  const model = read(env, names.model) || DEFAULT_MODELS.claude;
  return {
    name, model, available: Boolean(federation || apiKey) && !fedErrors.length,
    async run({ system, prompt, tools, call, signal }) {
      const { default: Anthropic } = await importSdk('@anthropic-ai/sdk');
      let client;
      if (federation) {
        const { oidcFederationProvider } = await importSdk('@anthropic-ai/sdk/lib/credentials/oidc-federation');
        const credentials = oidcFederationProvider({
          identityTokenProvider: githubIdentityToken(env), federationRuleId: federation.ruleId, organizationId: federation.organizationId,
          serviceAccountId: federation.serviceAccountId || undefined, workspaceId: federation.workspaceId || undefined,
          baseURL: 'https://api.anthropic.com', fetch: globalThis.fetch,
        });
        client = new Anthropic({ apiKey: null, authToken: null, credentials, maxRetries: 0 });
      } else client = new Anthropic({ apiKey, maxRetries: 0 });
      const spec = tools.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) }));
      const messages = [{ role: 'user', content: prompt }];
      for (;;) {
        call.turn();
        let res;
        try { res = await client.messages.create({ model, max_tokens: MAX_OUTPUT, system, tools: spec, messages }, { signal }); } catch (e) { throw tagged(e); }
        messages.push({ role: 'assistant', content: res.content });
        const uses = (res.content || []).filter((b) => b.type === 'tool_use');
        if (res.stop_reason !== 'tool_use' || !uses.length) return { stop: 'done' };
        messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: call.tool(u.name, u.input) })) });
      }
    },
  };
}

function codex(env, importSdk) {
  const apiKey = read(env, NAMES.codex.secret);
  const model = read(env, NAMES.codex.model) || DEFAULT_MODELS.codex;
  return {
    name: 'codex', model, available: Boolean(apiKey),
    async run({ system, prompt, tools, call, signal }) {
      const { default: OpenAI } = await importSdk('openai');
      const client = new OpenAI({ apiKey, maxRetries: 0 });
      const spec = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: schemaOf(t), strict: false }));
      let input = [{ role: 'user', content: prompt }];
      let previous;
      for (;;) {
        call.turn();
        let res;
        try {
          res = await client.responses.create({ model, instructions: system, input, tools: spec, max_output_tokens: MAX_OUTPUT, ...(previous ? { previous_response_id: previous } : {}) }, { signal });
        } catch (e) { throw tagged(e); }
        previous = res.id;
        const calls = (res.output || []).filter((o) => o.type === 'function_call');
        if (!calls.length) return { stop: 'done' };
        input = calls.map((c) => {
          let args = {};
          try { args = JSON.parse(c.arguments || '{}'); } catch { /* the tool reports the bad call */ }
          return { type: 'function_call_output', call_id: c.call_id, output: call.tool(c.name, args) };
        });
      }
    },
  };
}

function gemini(env, importSdk) {
  const apiKey = read(env, NAMES.gemini.secret);
  const model = read(env, NAMES.gemini.model) || DEFAULT_MODELS.gemini;
  return {
    name: 'gemini', model, available: Boolean(apiKey && model),
    async run({ system, prompt, tools, call, signal }) {
      const { GoogleGenAI } = await importSdk('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const decl = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: schemaOf(t) }));
      const contents = [{ role: 'user', parts: [{ text: prompt }] }];
      for (;;) {
        call.turn();
        let res;
        try {
          res = await ai.models.generateContent({ model, contents, config: { systemInstruction: system, tools: [{ functionDeclarations: decl }], maxOutputTokens: MAX_OUTPUT, abortSignal: signal } });
        } catch (e) { throw tagged(e); }
        const parts = res.candidates?.[0]?.content?.parts ?? [];
        contents.push({ role: 'model', parts });
        const fcs = parts.filter((p) => p.functionCall);
        if (!fcs.length) return { stop: 'done' };
        contents.push({ role: 'user', parts: fcs.map((p) => ({ functionResponse: { id: p.functionCall.id, name: p.functionCall.name, response: { result: call.tool(p.functionCall.name, p.functionCall.args || {}) } } })) });
      }
    },
  };
}

/** The adapters for this environment. `importSdk` is `(name) => import(name)` resolved from this folder. */
export function makeProviders(env, importSdk = (name) => import(name)) {
  return {
    claude: claude(env, importSdk), 'claude-2': claude(env, importSdk, 'claude-2'), 'claude-3': claude(env, importSdk, 'claude-3'),
    codex: codex(env, importSdk), gemini: gemini(env, importSdk),
  };
}
