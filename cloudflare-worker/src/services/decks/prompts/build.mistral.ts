/** D1519 (#3771): the build prompt for the Mistral family. Mistral tends to wrap JSON in a code fence and title-case headlines; the adapter forbids both. */
import { system as base, template as shared } from './build.default';

export const version = 1;
export const system = `${base} Do not wrap the JSON in a code fence. Write headlines in sentence case.`;
export const template = shared;
