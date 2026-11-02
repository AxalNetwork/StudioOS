/** D1519 (#3771): the build prompt for the GLM family. GLM may reason aloud before answering; the adapter asks for the answer alone. */
import { system as base, template as shared } from './build.default';

export const version = 2;
export const system = `${base} Do not show your reasoning: answer with the JSON alone.`;
export const template = shared;
