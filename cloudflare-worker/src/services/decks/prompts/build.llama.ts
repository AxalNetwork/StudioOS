/** D1519 (#3771): the build prompt for the Llama family. Llama tends to open with a preface; the adapter forbids it. */
import { system as base, template as shared } from './build.default';

export const version = 1;
export const system = `${base} Begin your answer with the opening brace of the JSON: no preface, no closing remark.`;
export const template = shared;
