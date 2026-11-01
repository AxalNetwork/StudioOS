/**
 * D1511 (#3762, deck v2 A18) — THE FAKE AI BINDING.
 *
 * A stand-in for the Workers AI binding (`env.AI`) that every Grid test and
 * the one-click fixture run on. It answers from RECORDED OUTPUTS
 * (`fixtures/fake_ai_recordings.json`), never a model, and on request it
 * INJECTS each failure Workers AI really gives, in the shape the router
 * (`services/aiRouter.ts`, `services/ai/shapes.ts`) reads it:
 *
 *   rate_limit_429      the call throws an error with `status: 429`
 *   capacity_3040       the call throws "3040: Capacity temporarily exceeded"
 *   timeout             the call never settles; the router's own limit
 *                       (`withTimeout`, 8 s for chat) cuts it — drive it with
 *                       `t.mock.timers`, as ai_router_shapes_d761 does
 *   guard_block         Llama Guard answers `unsafe` with S1
 *   bad_json            the model answers text that is not JSON
 *   over_capacity_text  the recorded answer with every string stretched far
 *                       past what any card area holds
 *   non_image           an image model answers text, not an image
 *
 * A fault is armed with `inject(kind, { model, times })`: `model` is a model
 * id, a RegExp, or omitted for any model; `times` defaults to 1 (Infinity for
 * every call). Faults fire in the order armed. A call with no fault and no
 * recording THROWS, so a test can never pass on an answer nobody recorded.
 *
 * `calls` lists every call as `{ model, prompt, fault }`; the guard's own
 * calls are kept apart in `guardCalls`, so a test's call list is its runs.
 */
import { readFileSync } from 'node:fs';

export const GUARD_MODEL = '@cf/meta/llama-guard-3-8b';
export const FAULTS = Object.freeze(['rate_limit_429', 'capacity_3040', 'timeout', 'guard_block', 'bad_json', 'over_capacity_text', 'non_image']);

/** How far `over_capacity_text` stretches every string: well past any area's capacity (`designSystem.textCapacity`). */
export const OVER_CAPACITY_REPEAT = 40;

export const RECORDINGS = Object.freeze(JSON.parse(readFileSync(new URL('./fixtures/fake_ai_recordings.json', import.meta.url), 'utf8')).recordings);

const promptOf = (input) => {
  if (typeof input?.prompt === 'string') return input.prompt;
  return (Array.isArray(input?.messages) ? input.messages : []).map((m) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
};
const matches = (want, model) => want == null || (want instanceof RegExp ? want.test(model) : want === model);
const stretch = (v) => (typeof v === 'string' ? `${v} `.repeat(OVER_CAPACITY_REPEAT).trim()
  : Array.isArray(v) ? v.map(stretch)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' ? x : stretch(x)])) : v);

/** The recording for a call: the first whose model and prompt pattern both match. */
export function recordingFor(model, prompt, recordings = RECORDINGS) {
  return recordings.find((r) => (r.model == null || r.model === model) && (r.prompt == null || new RegExp(r.prompt, 'm').test(prompt))) ?? null;
}

/** The recorded reply, as the binding returns it: `{ response, usage }` for text, `{ image }` for a drawing. */
function replyOf(rec) {
  if (rec.image != null) return { image: rec.image };
  return { response: typeof rec.response === 'string' ? rec.response : JSON.stringify(rec.response), usage: { ...rec.usage } };
}

export function fakeAI({ recordings = RECORDINGS } = {}) {
  const armed = [];
  const calls = [];
  const guardCalls = [];
  const take = (kinds, model) => {
    const i = armed.findIndex((f) => kinds.includes(f.kind) && matches(f.model, model) && f.left > 0);
    if (i < 0) return null;
    const f = armed[i];
    f.left -= 1;
    return f.kind;
  };
  const ai = {
    calls,
    guardCalls,
    /** Arms one failure; returns the binding so calls chain. */
    inject(kind, { model, times = 1 } = {}) {
      if (!FAULTS.includes(kind)) throw new Error(`fake AI: unknown fault ${kind}`);
      armed.push({ kind, model, left: times });
      return ai;
    },
    /** The faults still armed, by kind: a test can check that each one fired. */
    pending() { return armed.filter((f) => f.left > 0 && f.left !== Infinity).map((f) => f.kind); },
    async run(model, input) {
      const prompt = promptOf(input);
      if (model === GUARD_MODEL) {
        const fault = take(['guard_block'], model) ?? take(['guard_block'], undefined);
        guardCalls.push({ prompt, fault });
        return { response: fault ? 'unsafe\nS1' : 'safe', usage: { prompt_tokens: 0, completion_tokens: 0 } };
      }
      const fault = take(FAULTS.filter((k) => k !== 'guard_block'), model);
      calls.push({ model, prompt, fault });
      if (fault === 'rate_limit_429') throw Object.assign(new Error('429 Too Many Requests: rate limited by the fake AI binding'), { status: 429 });
      if (fault === 'capacity_3040') throw new Error('3040: Capacity temporarily exceeded, please try again.');
      if (fault === 'timeout') return new Promise(() => {});
      if (fault === 'bad_json') return { response: '{"cards": [{"n": 1, "headline": "Close the books', usage: { prompt_tokens: 60, completion_tokens: 12 } };
      if (fault === 'non_image') return { response: 'I am a text model and drew nothing.', usage: { prompt_tokens: 8, completion_tokens: 9 } };
      const rec = recordingFor(model, prompt, recordings);
      if (!rec) throw new Error(`fake AI: no recording for ${model} and this prompt; record one in fixtures/fake_ai_recordings.json`);
      const reply = replyOf(rec);
      if (fault === 'over_capacity_text') {
        const parsed = (() => { try { return JSON.parse(reply.response); } catch { return null; } })();
        return { ...reply, response: parsed ? JSON.stringify(stretch(parsed)) : stretch(reply.response) };
      }
      return reply;
    },
  };
  return ai;
}
