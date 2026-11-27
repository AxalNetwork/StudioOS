/**
 * D1519 (#3771, deck v2 A20) — the prompt registry. Every deck prompt is a
 * file `<element>.<family>.ts` beside this one, exporting `{ version, system,
 * template }`; `promptFor` picks the element's file for the model's family
 * (or its `default`), opens the system prompt with the voice preamble, wraps
 * it in the untrusted-data rule (D1506) and names the result
 * `<element>.<family>@v<version>`: the `prompt_version` every reply carries,
 * so a weak batch can be traced to the prompt that wrote it.
 *
 * A change to any file here changes `promptsHash()`; CI fails unless
 * `documentation/product/ELEMENT_EVAL.md` records the new hash (the eval was
 * re-run, D1518) or the PR carries the owner's `prompt-eval-waiver` label
 * (`scripts/check-prompt-eval.mjs`).
 */
import { withUntrustedRule } from '../../ai/untrusted';
import { familyOf, voicePreamble, type Family } from './voice';
import * as outlineDefault from './outline.default';
import * as buildDefault from './build.default';
import * as buildLlama from './build.llama';
import * as buildMistral from './build.mistral';
import * as buildGlm from './build.glm';

export type PromptFile = { version: number; system: string; template: string };
export type PromptElement = 'outline' | 'build';

/** Every prompt file, by element and family. A family missing here falls back to `default`. */
export const REGISTRY: Readonly<Record<PromptElement, Partial<Record<Family, PromptFile>>>> = Object.freeze({
  outline: { default: outlineDefault },
  build: { default: buildDefault, llama: buildLlama, mistral: buildMistral, glm: buildGlm },
});

export type Prompt = { prompt_version: string; family: Family; system: string; template: string };

/** The prompt an element's run sends to a model, with the theme's voice. */
export function promptFor(element: PromptElement, modelId?: string | null, voice?: unknown): Prompt {
  const files = REGISTRY[element];
  const asked = familyOf(modelId);
  const family: Family = files[asked] ? asked : 'default';
  const file = files[family]!;
  return {
    prompt_version: `${element}.${family}@v${file.version}`,
    family,
    system: withUntrustedRule(`${voicePreamble(voice)} ${file.system}`),
    template: file.template,
  };
}

export { familyOf, glossaryProblems, deckGlossary, voicePreamble, GLOSSARY, HOUSE_VOICE, FAMILIES } from './voice';
