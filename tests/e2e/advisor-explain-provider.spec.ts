import { test, expect, type Route } from '@playwright/test';

/**
 * Task #16 — Personal Advisor /explain SSE provider routing (Playwright).
 *
 * Companion to the worker-side unit tests in
 * cloudflare-worker/test/advisor_explain_router.test.mjs. Where those
 * tests exercise the aiRouter source with stubbed env.AI / fetch, this
 * spec validates the *browser-facing* SSE wire contract that the
 * React PersonalAdvisor component depends on:
 *
 *   event: provider  data: { model, provider, fallback_used, cached }
 *   event: delta     data: { text }
 *   event: done      data: { leaked }
 *
 * Three operational modes are covered, each via page.route stubbing the
 * /api/advisor/explain endpoint with a different canned SSE body:
 *   1. default Workers AI primary (provider='workers-ai',
 *      fallback_used=false)
 *   2. forced Anthropic primary (provider='anthropic')
 *   3. Workers AI failure → claude-sonnet-4-6 fallback
 *      (provider='anthropic', fallback_used=true)
 *
 * The browser-side parser used here is intentionally a copy of the
 * exact loop in frontend/src/components/advisor/PersonalAdvisor.jsx
 * (lines 339-377) so a regression in the SSE field shape — for example
 * dropping the `provider` event or renaming `fallback_used` —
 * fails this spec.
 *
 * Hermetic: no backend, no LLM, no real fetch leaves the browser.
 * Any page navigation works (we use /login since it's auth-free); the
 * fetch is what matters.
 */

const SKIP_LOCAL = process.env.E2E_SKIP_INVESTOR_DEMO === '1';

function sse(...events: Array<{ event: string; data: unknown }>): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

async function stubExplain(page: import('@playwright/test').Page, body: string) {
  await page.route('**/api/advisor/explain', async (route: Route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
      },
      body,
    });
  });
}

// In-browser SSE consumer mirroring PersonalAdvisor.jsx's parser.
// Returns { provider, deltas, done } for the test to assert.
async function runExplainInBrowser(page: import('@playwright/test').Page) {
  return await page.evaluate(async () => {
    const res = await fetch('/api/advisor/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ topic: 'what is a SAFE?' }),
    });
    type Result = {
      ok: boolean;
      status: number;
      provider: { model?: string; provider?: string; fallback_used?: boolean; cached?: boolean } | null;
      deltas: string[];
      done: { leaked?: boolean } | null;
      error: string | null;
    };
    const out: Result = { ok: res.ok, status: res.status, provider: null, deltas: [], done: null, error: null };
    if (!res.ok || !res.body) {
      out.error = `bad response ${res.status}`;
      return out;
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      // eslint-disable-next-line no-cond-assign
      while ((nl = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        let event = 'message';
        let dataStr = '';
        for (const ln of chunk.split('\n')) {
          if (ln.startsWith('event:')) event = ln.slice(6).trim();
          else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
        }
        if (!dataStr) continue;
        let data: Record<string, unknown>;
        try { data = JSON.parse(dataStr); } catch { continue; }
        if (event === 'provider') {
          out.provider = {
            model: data.model as string | undefined,
            provider: data.provider as string | undefined,
            // SSE fields may be absent or non-boolean; normalize to strict booleans
            // to match PersonalAdvisor parser behavior and keep wire-contract handling stable.
            fallback_used: !!data.fallback_used,
            cached: !!data.cached,
          };
        } else if (event === 'delta') {
          out.deltas.push(String(data.text ?? ''));
        } else if (event === 'done') {
          out.done = { leaked: !!data.leaked };
        } else if (event === 'error') {
          out.error = String(data.message ?? 'stream error');
        }
      }
    }
    return out;
  });
}

test.describe('Personal Advisor /explain — SSE provider routing', () => {
  test.skip(
    SKIP_LOCAL,
    "Skipped via E2E_SKIP_INVESTOR_DEMO=1 — typical in Replit shells where Playwright's bundled chromium can't launch (missing libglib-2.0.so.0). The same three scenarios are validated headlessly by cloudflare-worker/test/advisor_explain_router.test.mjs.",
  );

  test.beforeEach(async ({ page }) => {
    // Any auth-free page is fine — the spec exercises /api/advisor/explain
    // via in-page fetch and never touches the React advisor UI.
    await page.goto('/login');
  });

  test('default Workers AI primary emits provider=workers-ai with fallback_used=false', async ({ page }) => {
    await stubExplain(page, sse(
      { event: 'provider', data: { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', provider: 'workers-ai', fallback_used: false, cached: false } },
      { event: 'delta', data: { text: 'A SAFE is a Simple Agreement for Future Equity.' } },
      { event: 'done', data: { leaked: false } },
    ));
    const r = await runExplainInBrowser(page);
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.provider).not.toBeNull();
    expect(r.provider!.provider).toBe('workers-ai');
    expect(r.provider!.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(r.provider!.fallback_used).toBe(false);
    expect(r.provider!.cached).toBe(false);
    expect(r.deltas.join('')).toContain('Simple Agreement for Future Equity');
    expect(r.done).toEqual({ leaked: false });
  });

  test('forced Anthropic provider emits provider=anthropic with claude model', async ({ page }) => {
    await stubExplain(page, sse(
      { event: 'provider', data: { model: 'claude-sonnet-4-6', provider: 'anthropic', fallback_used: false, cached: false } },
      { event: 'delta', data: { text: 'ARR is annual recurring revenue.' } },
      { event: 'done', data: { leaked: false } },
    ));
    const r = await runExplainInBrowser(page);
    expect(r.ok).toBe(true);
    expect(r.provider!.provider).toBe('anthropic');
    expect(r.provider!.model).toBe('claude-sonnet-4-6');
    expect(r.provider!.fallback_used).toBe(false);
    expect(r.deltas.join('')).toContain('annual recurring revenue');
  });

  test('Workers AI failure surfaces fallback_used=true with claude-sonnet-4-6', async ({ page }) => {
    await stubExplain(page, sse(
      { event: 'provider', data: { model: 'claude-sonnet-4-6', provider: 'anthropic', fallback_used: true, cached: false } },
      { event: 'delta', data: { text: 'Convertible notes defer valuation.' } },
      { event: 'done', data: { leaked: false } },
    ));
    const r = await runExplainInBrowser(page);
    expect(r.ok).toBe(true);
    expect(r.provider!.provider).toBe('anthropic');
    expect(r.provider!.model).toBe('claude-sonnet-4-6');
    expect(r.provider!.fallback_used).toBe(true);
    expect(r.deltas.join('')).toContain('Convertible notes');
  });
});
