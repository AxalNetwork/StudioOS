/**
 * D765 (#2090), D720 §6 — a queue job no member started runs as a SYSTEM call:
 * through the router as `userId 0`, so it is logged at cost in
 * `ai_usage_logs` and charged to no member. These jobs called
 * `env.AI.run('@cf/meta/llama-3.1-8b-instruct')` directly before, so no row
 * recorded them at all, on a model Cloudflare marks deprecated.
 *
 * The answer keeps Workers AI's `{ response }` shape, so each job's parsing
 * and its fallback on an empty answer are unchanged; a refusal reads as empty.
 */
import type { Env } from '../src/types';
import { run } from '../src/services/aiRouter';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

export async function systemRun(env: Env, input: { messages: Message[]; max_tokens: number }): Promise<{ response: string }> {
  const r = await run(env, { task: 'system_job', userId: 0, messages: input.messages, maxTokens: input.max_tokens });
  return { response: r.ok ? String(r.output ?? '') : '' };
}
