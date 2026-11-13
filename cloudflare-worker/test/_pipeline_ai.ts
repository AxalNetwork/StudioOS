/**
 * D1505 (#3756) — a Workers AI stand-in that answers the deck image pipeline's
 * seven runs the way a passing image would: the expansion (a sentence with no
 * numbers), the draw (a 1 × 1 PNG), the face and text checks (NO), the screen
 * (NO), the style check (YES) and the alt text. Each answer can be overridden,
 * so a test can make one step refuse or fail; `calls` records every run with
 * the step it was, so a test can assert on the draws alone.
 */
import { FACE_MODEL } from '../src/services/ai/postDraw.ts';

export const PIPELINE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export type PipelineStep = 'expand' | 'draw' | 'face' | 'text' | 'screen' | 'style' | 'alt';
export type PipelineCall = { model: string; step: PipelineStep; prompt: string };
/** What a step answers: a string is the model's words; `throw` makes the run fail. */
export type PipelineAnswers = Partial<Record<PipelineStep, string | 'throw'>>;

/** Which pipeline step a Workers AI call is, read from the model and its question. */
export function stepOf(model: string, input: any): PipelineStep {
  const text = JSON.stringify(input ?? {});
  if (/flux|phoenix|lucid|stable-diffusion/i.test(model)) return 'draw';
  if (model === FACE_MODEL) return /written text/.test(text) ? 'text' : 'face';
  if (/nudity/.test(text)) return 'screen';
  if (/illustration, in /.test(text)) return 'style';
  if (/visually-impaired/.test(text)) return 'alt';
  return 'expand';
}

const DEFAULTS: Record<Exclude<PipelineStep, 'draw'>, string> = {
  expand: 'A calm desk at month end, soft daylight, a closed ledger and a cup.',
  face: 'NO', text: 'NO', screen: 'NO', style: 'YES',
  alt: 'A tidy desk at month end in soft light.',
};

/** The `run` a fixture's AI binding uses; `calls` fills as the pipeline runs. */
export function pipelineAI(answers: PipelineAnswers = {}, png: string = PIPELINE_PNG) {
  const calls: PipelineCall[] = [];
  const run = async (model: string, input: any) => {
    const step = stepOf(model, input);
    calls.push({ model, step, prompt: String(input?.prompt ?? '') });
    const a = answers[step];
    if (a === 'throw') throw new Error(`synthetic ${step} failure`);
    if (step === 'draw') return { image: png };
    const words = a ?? DEFAULTS[step];
    if (model === FACE_MODEL) return { answer: words };
    return { response: words, usage: { prompt_tokens: 40, completion_tokens: 8 } };
  };
  return { run, calls, draws: () => calls.filter((c) => c.step === 'draw') };
}
