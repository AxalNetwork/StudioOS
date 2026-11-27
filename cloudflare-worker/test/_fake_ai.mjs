/**
 * D1511 (#3762, deck v2 A18) — the fake Workers AI binding every Grid task and
 * the one-click run test on. It answers from RECORDED outputs, never a model,
 * and can inject each failure a real binding gives:
 *
 *   rate_limited        a 429 (Workers AI "Too Many Requests")
 *   capacity            error 3040, "Capacity temporarily exceeded"
 *   timeout             the call's deadline passing (a TimeoutError)
 *   guard_block         Llama Guard answering "unsafe" on the member's input
 *   bad_json            an answer that is not the JSON the caller asked for
 *   over_capacity_text  the recorded JSON with every string far past any area's room
 *   non_image           an image model answering words instead of an image
 *
 * `fakeAi({ answer, fail, failOn })`:
 *   answer(model, input, prompt)  the recorded output for a call: a string
 *                                 (the chat `response`), an object (sent as
 *                                 JSON) or a Uint8Array (an image, answered
 *                                 base64 as FLUX answers it). Default:
 *                                 `{}`.
 *   fail                          one of FAILURES, injected on the `failOn`th
 *                                 model call (1 by default; the guard's calls
 *                                 are not counted), or on every call with
 *                                 `failOn: 'every'`.
 *
 * The binding records every model call (`calls`, the guard's apart in
 * `guardCalls`) and answers each with fixed usage, so a test's charge is known.
 * Synthetic only: no real model id is called and nothing leaves the process.
 */
export const GUARD_MODEL = '@cf/meta/llama-guard-3-8b';
export const FAILURES = Object.freeze(['rate_limited', 'capacity', 'timeout', 'guard_block', 'bad_json', 'over_capacity_text', 'non_image']);
export const FAKE_USAGE = Object.freeze({ prompt_tokens: 60, completion_tokens: 40 });
/** The text an over-capacity answer puts in every string: longer than any area holds, and no figure in it. */
export const OVER_CAPACITY = 'This sentence keeps going well past what any area on a slide can hold at any size of the type scale '.repeat(5).trim();

const promptOf = (input) => (Array.isArray(input?.messages) ? input.messages : [])
  .map((m) => (typeof m?.content === 'string' ? m.content : '')).join('\n');

function inflate(v) {
  if (typeof v === 'string') return OVER_CAPACITY;
  if (Array.isArray(v)) return v.map(inflate);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inflate(x)]));
  return v;
}

function thrown(kind) {
  if (kind === 'rate_limited') return Object.assign(new Error('429 Too Many Requests: rate limit reached'), { status: 429 });
  if (kind === 'capacity') return new Error('InferenceUpstreamError: 3040: Capacity temporarily exceeded, please try again.');
  return Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
}

export function fakeAi({ answer = () => ({}), fail = null, failOn = 1 } = {}) {
  if (fail != null && !FAILURES.includes(fail)) throw new Error(`unknown failure ${fail}`);
  const calls = [];
  const guardCalls = [];
  const binding = {
    calls,
    guardCalls,
    async run(model, input) {
      if (model === GUARD_MODEL) {
        guardCalls.push({ model });
        // Llama Guard's own answer: "safe", or "unsafe" and a category line.
        return { response: fail === 'guard_block' ? 'unsafe\nS2' : 'safe', usage: { prompt_tokens: 0, completion_tokens: 0 } };
      }
      const prompt = promptOf(input);
      calls.push({ model, prompt, input });
      const hit = fail && fail !== 'guard_block' && (failOn === 'every' || calls.length === failOn);
      if (hit && (fail === 'rate_limited' || fail === 'capacity' || fail === 'timeout')) throw thrown(fail);
      if (hit && fail === 'non_image') return { response: 'I would draw a calm illustration here.', usage: FAKE_USAGE };
      const out = answer(model, input, prompt);
      // An image model answers base64 in `image`, as FLUX on Workers AI does.
      if (out instanceof Uint8Array) return { image: Buffer.from(out).toString('base64') };
      if (hit && fail === 'bad_json') return { response: 'Here are your cards: {"cards": [ {"n": 1, "headline": ', usage: FAKE_USAGE };
      const value = hit && fail === 'over_capacity_text' ? inflate(typeof out === 'string' ? safeParse(out) : out) : out;
      return { response: typeof value === 'string' ? value : JSON.stringify(value), usage: FAKE_USAGE };
    },
  };
  return binding;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}
